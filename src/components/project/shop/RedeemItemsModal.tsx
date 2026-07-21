/**
 * Redeem store items (721 tokens) for a share of the project's surplus.
 * Ports website/src/discover.js buildRedeemItemsModal (:18322) onto juicy's
 * guarded transaction runner.
 *
 * The hook burns its OWN tokens after verifying ownership, so there is no
 * ERC-721 approval. The redeemed token ids ride in the cash-out metadata, and
 * `cashOutCount` MUST be 0 (fungible tokens must not co-redeem). previewCashOutFrom
 * validated the exact metadata envelope on-chain — see buildTierCashOutMetadata.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createPublicClient, http, encodeFunctionData, formatUnits, type Address, type Chain, type Hex } from 'viem'
import { type JBChainId } from '@bananapus/nana-sdk-core'
import { getAccountingContexts } from '@bananapus/nana-sdk-core/v6'
import { useThemeStore } from '../../../stores'
import { CHAINS, JB_CONTRACTS, RPC_ENDPOINTS, ALL_VIEM_CHAINS } from '../../../constants'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { SkeletonLines } from '../../ui/Skeleton'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { type GuardedTxPhase } from '../../../services/projectTx'
import { getPaymentTerminal } from '../../../utils/paymentTerminal'
import { describeAccountingToken } from '../../../services/youPosition'
import { cashOutProtocolFee, quotedOutputFloor, TERMINAL_PREVIEW_CASH_OUT_ABI } from '../../../utils/terminalPreview'
import { getProjectDataHook } from '../../../services/nft'
import {
  buildTierCashOutMetadata,
  fetchOwnedItems,
  resolveShopItemNames,
  itemLabelFrom,
  type OwnedItem,
  type ItemNames,
  type ShopChain,
} from '../../../services/shopCustomers'

const METADATA_ID_TARGET_ABI = [{
  name: 'METADATA_ID_TARGET',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}] as const

const FEE_FREE_SURPLUS_ABI = [{
  name: 'feeFreeSurplusOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const

const FEELESS_FOR_ABI = [{
  name: 'isFeelessFor',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'addr', type: 'address' },
    { name: 'projectId', type: 'uint256' },
    { name: 'caller', type: 'address' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const

const CASH_OUT_TOKENS_ABI = [{
  name: 'cashOutTokensOf',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'holder', type: 'address' },
    { name: 'projectId', type: 'uint256' },
    { name: 'cashOutCount', type: 'uint256' },
    { name: 'tokenToReclaim', type: 'address' },
    { name: 'minTokensReclaimed', type: 'uint256' },
    { name: 'beneficiary', type: 'address' },
    { name: 'metadata', type: 'bytes' },
  ],
  outputs: [{ name: 'reclaimAmount', type: 'uint256' }],
}] as const

const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: 'Re-checking the live redemption value…',
  switching: 'Switching network…',
  approving: 'Approving…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
}

export interface RedeemItemsModalProps {
  isOpen: boolean
  onClose: () => void
  /** The chains the project lives on, with per-chain project ids (V6 ids differ per chain). */
  chains: ShopChain[]
  /** Chain to open on (defaults to the first). */
  defaultChainId?: number
  /** Fired after a confirmed redemption so the caller can refresh reads. */
  onRedeemed?: (chainId: number) => void
}

interface ReclaimToken {
  address: Address
  symbol: string
  decimals: number
}

interface Preview {
  net: bigint
  idTarget: Address
  reclaimToken: ReclaimToken
  terminal: Address
}

function publicClientFor(chainId: number) {
  const chain = (ALL_VIEM_CHAINS as Record<number, Chain>)[chainId]
  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
  if (!chain || !rpcUrl) throw new Error(`Unsupported chain ${chainId}`)
  return createPublicClient({ chain, transport: http(rpcUrl) })
}

function formatAmount(value: bigint, token: ReclaimToken): string {
  const amount = parseFloat(formatUnits(value, token.decimals))
  if (value > 0n && amount < 0.0001) return `<0.0001 ${token.symbol}`
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: token.decimals === 6 ? 2 : 5 })} ${token.symbol}`
}

/** Resolve the project's accounting (reclaim) token + validated multi terminal on a chain. */
async function resolveReclaimTarget(
  client: ReturnType<typeof publicClientFor>,
  chainId: number,
  projectId: bigint,
): Promise<{ reclaimToken: ReclaimToken; terminal: Address }> {
  const contexts = await getAccountingContexts(client, { chainId: chainId as JBChainId, projectId })
  if (!contexts.length) throw new Error('No accounting token on this chain.')
  const described = contexts.map(context =>
    describeAccountingToken(chainId, { token: context.token, decimals: Number(context.decimals), currency: Number(context.currency) }),
  )
  // Prefer a recognized reclaim token (ETH/USDC); fall back to the first context.
  const chosen = described.find(t => t.symbol !== 'TOKEN') ?? described[0]
  const terminal = await getPaymentTerminal(client, chainId, projectId, chosen.token, 'accounting')
  return {
    reclaimToken: { address: chosen.token, symbol: chosen.symbol, decimals: chosen.decimals },
    terminal: terminal.address,
  }
}

export function RedeemItemsModal({ isOpen, onClose, chains, defaultChainId, onRedeemed }: RedeemItemsModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const chainList = useMemo(() => (chains.length ? chains : []), [chains])
  const [chainId, setChainId] = useState<number>(defaultChainId ?? chainList[0]?.chainId ?? 1)
  const projectIdFor = useCallback(
    (cid: number): bigint => BigInt(chainList.find(c => c.chainId === cid)?.projectId ?? chainList[0]?.projectId ?? 0),
    [chainList],
  )

  const [names, setNames] = useState<ItemNames>({})
  const [hook, setHook] = useState<Address | null>(null)
  const [owned, setOwned] = useState<OwnedItem[] | null>(null)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [loadError, setLoadError] = useState<string | null>(null)

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewMsg, setPreviewMsg] = useState<string>('')
  const [previewing, setPreviewing] = useState(false)
  const previewSeq = useRef(0)

  const [phase, setPhase] = useState<GuardedTxPhase | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const running = phase !== null

  const selectedTokenIds = useCallback(
    () => Object.keys(selected).filter(id => selected[id]),
    [selected],
  )

  // Reset when opened / chain switched.
  useEffect(() => {
    if (!isOpen) return
    setChainId(defaultChainId ?? chainList[0]?.chainId ?? 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Load owned items + names for the selected chain.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setOwned(null)
    setHook(null)
    setSelected({})
    setPreview(null)
    setPreviewMsg('')
    setLoadError(null)
    setStatus(null)
    setDone(false)
    if (!activeAddress) return
    const projectId = String(projectIdFor(chainId))

    resolveShopItemNames(projectId, chainId).then(n => {
      if (!cancelled) setNames(n)
    })

    ;(async () => {
      try {
        const hookAddress = await getProjectDataHook(projectId, chainId)
        if (cancelled) return
        if (!hookAddress) {
          setOwned([])
          setLoadError('This shop has no redeemable items on this chain.')
          return
        }
        setHook(hookAddress)
        const items = await fetchOwnedItems(chainId, projectId, hookAddress, activeAddress)
        if (cancelled) return
        setOwned(items)
        // Default: everything selected.
        const next: Record<string, boolean> = {}
        for (const o of items) next[o.tokenId] = true
        setSelected(next)
      } catch {
        if (!cancelled) {
          setOwned([])
          setLoadError('Could not read your items.')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isOpen, chainId, activeAddress, projectIdFor])

  // Debounced preview whenever the selection changes.
  useEffect(() => {
    if (!isOpen || !activeAddress || !hook) return
    const ids = selectedTokenIds()
    setPreview(null)
    if (!ids.length) {
      setPreviewMsg(owned && owned.length ? 'Select items to redeem.' : '')
      return
    }
    const seq = ++previewSeq.current
    setPreviewing(true)
    setPreviewMsg('Estimating…')
    const timer = setTimeout(async () => {
      try {
        const projectId = projectIdFor(chainId)
        const client = publicClientFor(chainId)
        const idTarget = (await client.readContract({
          address: hook,
          abi: METADATA_ID_TARGET_ABI,
          functionName: 'METADATA_ID_TARGET',
        })) as Address
        const { reclaimToken, terminal } = await resolveReclaimTarget(client, chainId, projectId)
        const metadata = buildTierCashOutMetadata(idTarget, ids)
        const [previewResult, feeFreeSurplus, beneficiaryIsFeeless] = await Promise.all([
          client.readContract({
            address: terminal,
            abi: TERMINAL_PREVIEW_CASH_OUT_ABI,
            functionName: 'previewCashOutFrom',
            args: [activeAddress, projectId, 0n, reclaimToken.address, activeAddress, metadata],
          }),
          client.readContract({
            address: terminal,
            abi: FEE_FREE_SURPLUS_ABI,
            functionName: 'feeFreeSurplusOf',
            args: [projectId, reclaimToken.address],
          }).catch(() => 0n),
          client.readContract({
            address: JB_CONTRACTS.JBFeelessAddresses,
            abi: FEELESS_FOR_ABI,
            functionName: 'isFeelessFor',
            args: [activeAddress, projectId, activeAddress],
          }).catch(() => false),
        ])
        if (previewSeq.current !== seq) return
        const reclaimAmount = previewResult[1] as bigint
        const cashOutTaxRate = previewResult[2] as bigint
        const fee = cashOutProtocolFee({
          reclaimAmount,
          cashOutTaxRate,
          beneficiaryIsFeeless: Boolean(beneficiaryIsFeeless),
          feeFreeSurplus: feeFreeSurplus as bigint,
        })
        const net = reclaimAmount - fee
        setPreviewing(false)
        if (net <= 0n) {
          setPreview(null)
          setPreviewMsg('No surplus to redeem against right now.')
          return
        }
        setPreview({ net, idTarget, reclaimToken, terminal })
        setPreviewMsg('')
      } catch {
        if (previewSeq.current !== seq) return
        setPreviewing(false)
        setPreview(null)
        setPreviewMsg('This redemption can’t be previewed — the shop may not allow cash outs, or there’s no surplus.')
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [isOpen, activeAddress, hook, chainId, selected, owned, projectIdFor, selectedTokenIds])

  const submit = async () => {
    setStatus(null)
    const ids = selectedTokenIds()
    if (!activeAddress) {
      setStatus('Connect a wallet.')
      return
    }
    if (!ids.length) {
      setStatus('Select at least one item.')
      return
    }
    if (!preview || preview.net <= 0n) {
      setStatus('Preview still loading…')
      return
    }
    const { idTarget, reclaimToken, terminal, net: reviewedNet } = preview
    const projectId = projectIdFor(chainId)
    const metadata: Hex = buildTierCashOutMetadata(idTarget, ids)
    const minReclaimed = quotedOutputFloor(reviewedNet, 9900n) // 1% floor under the reviewed net
    const data = encodeFunctionData({
      abi: CASH_OUT_TOKENS_ABI,
      functionName: 'cashOutTokensOf',
      args: [activeAddress, projectId, 0n, reclaimToken.address, minReclaimed, activeAddress, metadata],
    })
    try {
      await run({
        chainId,
        to: terminal,
        data,
        // Re-quote before the send: abort if the live net dropped below the
        // reviewed 99% floor (never silently lower the floor).
        reverify: async () => {
          const client = publicClientFor(chainId)
          const [previewResult, feeFreeSurplus, beneficiaryIsFeeless] = await Promise.all([
            client.readContract({
              address: terminal,
              abi: TERMINAL_PREVIEW_CASH_OUT_ABI,
              functionName: 'previewCashOutFrom',
              args: [activeAddress, projectId, 0n, reclaimToken.address, activeAddress, metadata],
            }),
            client.readContract({
              address: terminal,
              abi: FEE_FREE_SURPLUS_ABI,
              functionName: 'feeFreeSurplusOf',
              args: [projectId, reclaimToken.address],
            }).catch(() => 0n),
            client.readContract({
              address: JB_CONTRACTS.JBFeelessAddresses,
              abi: FEELESS_FOR_ABI,
              functionName: 'isFeelessFor',
              args: [activeAddress, projectId, activeAddress],
            }).catch(() => false),
          ])
          const liveNet = (previewResult[1] as bigint) - cashOutProtocolFee({
            reclaimAmount: previewResult[1] as bigint,
            cashOutTaxRate: previewResult[2] as bigint,
            beneficiaryIsFeeless: Boolean(beneficiaryIsFeeless),
            feeFreeSurplus: feeFreeSurplus as bigint,
          })
          if (liveNet < minReclaimed) {
            throw new Error('The live redemption value dropped below the reviewed minimum. Review the new value and try again.')
          }
        },
        onPhase: setPhase,
      })
      setPhase(null)
      setDone(true)
      setStatus(`Redeemed ${ids.length} item${ids.length === 1 ? '' : 's'} for ~${formatAmount(reviewedNet, reclaimToken)}.`)
      onRedeemed?.(chainId)
    } catch (err) {
      setPhase(null)
      setStatus(err instanceof Error ? err.message : 'The redemption failed.')
    }
  }

  if (!isOpen) return null

  const cardBorder = isDark ? 'border-white/10' : 'border-gray-200'
  const keyText = isDark ? 'text-gray-400' : 'text-gray-600'
  const selectClass = `select-caret pl-3 pr-6 py-2 text-sm border bg-transparent focus:outline-none ${
    isDark ? 'border-white/20 text-white' : 'border-gray-300 text-gray-900'
  }`

  const byTier: Record<number, OwnedItem[]> = {}
  for (const o of owned ?? []) (byTier[o.tierId] = byTier[o.tierId] || []).push(o)
  const allSelected = (owned?.length ?? 0) > 0 && selectedTokenIds().length === owned!.length

  const toggleAll = (checked: boolean) => {
    const next: Record<string, boolean> = {}
    for (const o of owned ?? []) next[o.tokenId] = checked
    setSelected(next)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={running ? undefined : onClose} />
      <div className={`relative w-full max-w-md max-h-[90vh] overflow-y-auto border ${isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'}`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${cardBorder}`}>
          <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Redeem items</h2>
          {!running ? (
            <button
              onClick={onClose}
              className={`p-2 transition-colors ${isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>

        <div className="p-5 space-y-4">
          <ExplainerMessage>
            Redeem your items to burn them for a share of the project&rsquo;s surplus. A cash out tax may apply.
          </ExplainerMessage>

          {/* Chain selector (only when multi-chain) */}
          {chainList.length > 1 ? (
            <div className="flex items-center gap-2">
              <span className={`text-sm ${keyText}`}>Redeem on</span>
              <select className={selectClass} value={chainId} onChange={e => setChainId(Number(e.target.value))} disabled={running}>
                {chainList.map(c => (
                  <option key={c.chainId} value={c.chainId}>
                    {CHAINS[c.chainId]?.name ?? `Chain ${c.chainId}`}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Items */}
          <div>
            <div className={`text-xs uppercase tracking-wide mb-2 ${keyText}`}>Your items</div>
            {!activeAddress ? (
              <p className={`text-sm ${keyText}`}>Connect a wallet to redeem your items.</p>
            ) : owned == null ? (
              <SkeletonLines lines={5} className="mt-3" />
            ) : loadError && !owned.length ? (
              <p className={`text-sm ${keyText}`}>{loadError}</p>
            ) : !owned.length ? (
              <p className={`text-sm ${keyText}`}>You own no items on {CHAINS[chainId]?.name ?? `chain ${chainId}`}.</p>
            ) : (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={allSelected} disabled={running} onChange={e => toggleAll(e.target.checked)} />
                  <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>Select all ({owned.length})</span>
                </label>
                {Object.keys(byTier).map(tid => (
                  <div key={tid}>
                    <div className={`text-xs font-medium mt-2 ${keyText}`}>
                      {itemLabelFrom(names, tid)} ({byTier[Number(tid)].length})
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      {byTier[Number(tid)].map(o => (
                        <label key={o.tokenId} className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={!!selected[o.tokenId]}
                            disabled={running}
                            onChange={e => setSelected(prev => ({ ...prev, [o.tokenId]: e.target.checked }))}
                          />
                          <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>#{o.tokenId}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preview */}
          {activeAddress && owned && owned.length ? (
            <div className={`text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
              {previewing ? (
                <span className={keyText}>Estimating…</span>
              ) : preview ? (
                <>
                  You&rsquo;ll receive ~ {formatAmount(preview.net, preview.reclaimToken)} for {selectedTokenIds().length} item
                  {selectedTokenIds().length === 1 ? '' : 's'}
                  <div className={`text-xs mt-0.5 ${keyText}`}>
                    Minimum: {formatAmount(quotedOutputFloor(preview.net, 9900n), preview.reclaimToken)}
                  </div>
                </>
              ) : (
                <span className={keyText}>{previewMsg}</span>
              )}
            </div>
          ) : null}

          {/* Status / phase */}
          {running ? (
            <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
              <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
              {PHASE_LABELS[phase]}
            </div>
          ) : null}
          {status ? (
            <div className={`text-sm ${done ? 'text-green-400' : 'text-red-400'}`} role={done ? undefined : 'alert'}>
              {status}
            </div>
          ) : null}

          {/* Actions */}
          {done ? (
            <button
              onClick={onClose}
              className="w-full py-3 font-medium bg-juice-cyan text-black hover:bg-juice-cyan/90 transition-colors"
            >
              Done
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={running || !preview || preview.net <= 0n}
              className={`w-full py-3 font-bold transition-colors ${
                running || !preview || preview.net <= 0n
                  ? isDark
                    ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-juice-cyan text-black hover:bg-juice-cyan/90'
              }`}
            >
              Redeem
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
