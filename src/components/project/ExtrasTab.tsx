/**
 * Extras tab — port of the website's renderExtrasSection (discover.js).
 *
 * "Payer address" — deploy JBProjectPayer forwarding contracts via
 * JBProjectPayerDeployer, plus the list of already-deployed payers.
 *
 * The "Copy this project" (.jb export) card was removed to match the website
 * (commit 160e46e); the create flow's own Import/Export .jb covers that need.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { isAddress, zeroAddress } from 'viem'
import { useThemeStore } from '../../stores'
import { ExplainerMessage } from '../ui/ExplainerMessage'
import { CHAINS } from '../../constants'
import { useGuardedTx } from '../../hooks/useGuardedTx'
import type { GuardedTxPhase } from '../../services/projectTx'
import {
  buildProjectPayerDeployCall,
  fetchProjectPayers,
  normalizeProjectPayerMetadata,
  type ProjectPayerRow,
} from '../../services/projectPayers'
import { resolveEnsToAddress, truncateAddress } from '../../utils/ens'

interface ExtrasTabProps {
  projectId: string
  chainId: string
  tokenSymbol?: string
  /** Every chain the project exists on, with its per-chain project ID. */
  connectedChains?: Array<{ chainId: number; projectId: number }>
}

type StatusKind = 'idle' | 'pending' | 'success' | 'error'
interface Status {
  kind: StatusKind
  text: string
}

const IDLE: Status = { kind: 'idle', text: '' }

const PHASE_TEXT: Record<GuardedTxPhase, string> = {
  reverifying: 'Checking live state…',
  switching: 'Switching network…',
  approving: 'Approving…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Waiting for confirmation…',
}

function chainName(chainId: number): string {
  return CHAINS[chainId]?.name || `Chain ${chainId}`
}

/** Bendystraw USD aggregates are scaled by 1e18. */
function formatFacilitated(row: ProjectPayerRow): string {
  try {
    const usd = BigInt(String(row.totalFacilitatedUsd || '0').split('.')[0] || '0')
    if (usd > 0n) {
      const cents = usd / 10n ** 16n
      const value = Number(cents) / 100
      return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
    // Raw aggregate mixes payment-token decimals; only the USD figure has an honest denomination.
    return BigInt(String(row.totalFacilitated || '0').split('.')[0] || '0') > 0n ? 'Unpriced' : '$0'
  } catch {
    return '$0'
  }
}

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(timestamp))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 365) return `${days}d ago`
  return `${Math.floor(days / 365)}y ago`
}

function countsText(row: ProjectPayerRow): string {
  const parts: string[] = []
  if (Number(row.paymentsCount || 0)) parts.push(`${row.paymentsCount} pay`)
  if (Number(row.addToBalanceCount || 0)) parts.push(`${row.addToBalanceCount} balance`)
  return parts.length ? parts.join(' | ') : 'No payments yet'
}

/** Resolve a 0x address or ENS name to a checksummable address, or throw. */
async function resolveAddressInput(raw: string, label: string): Promise<string> {
  const value = (raw || '').trim()
  if (isAddress(value, { strict: false })) return value
  if (value.includes('.')) {
    const resolved = await resolveEnsToAddress(value)
    if (resolved && isAddress(resolved, { strict: false })) return resolved
  }
  throw new Error(`Enter a valid address or ENS name for the ${label}.`)
}

export default function ExtrasTab({ projectId, chainId, tokenSymbol, connectedChains }: ExtrasTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const pageChainId = parseInt(chainId)
  const tokenLabel = tokenSymbol || 'tokens'

  // Every chain the project exists on; falls back to the page chain alone.
  const chains = useMemo(() => {
    const list = (connectedChains || []).filter((c) => c.chainId && c.projectId)
    if (!list.some((c) => c.chainId === pageChainId)) {
      list.unshift({ chainId: pageChainId, projectId: parseInt(projectId) })
    }
    return list
  }, [connectedChains, pageChainId, projectId])


  // -------------------------------------------------------------------------
  // Payer address form
  // -------------------------------------------------------------------------
  const [mode, setMode] = useState<'pay' | 'balance'>('pay')
  const [originalPayer, setOriginalPayer] = useState(true)
  const [beneficiary, setBeneficiary] = useState('')
  const [memo, setMemo] = useState('')
  const [editable, setEditable] = useState(false)
  const [adminAddress, setAdminAddress] = useState('')

  // Seed the admin field with the connected account when Editable is switched on.
  useEffect(() => {
    if (editable && !adminAddress && activeAddress) setAdminAddress(activeAddress)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable])
  const [metadataHex, setMetadataHex] = useState('0x')
  const [selectedChains, setSelectedChains] = useState<number[]>(() => chains.map((c) => c.chainId))
  const [deployStatus, setDeployStatus] = useState<Status>(IDLE)
  const [deployBusy, setDeployBusy] = useState(false)

  // Existing payers (Bendystraw)
  const [payers, setPayers] = useState<ProjectPayerRow[] | null>(null)
  const [payersError, setPayersError] = useState(false)

  const loadPayers = useCallback(async () => {
    try {
      setPayersError(false)
      const rows = await fetchProjectPayers(parseInt(projectId), chains.map((c) => c.chainId))
      setPayers(rows)
    } catch {
      setPayersError(true)
      setPayers(null)
    }
  }, [projectId, chains])

  useEffect(() => { loadPayers() }, [loadPayers])

  // Keep the chain checklist in sync if connected chains resolve late.
  useEffect(() => {
    setSelectedChains((previous) => {
      const known = chains.map((c) => c.chainId)
      const kept = previous.filter((id) => known.includes(id))
      const added = known.filter((id) => !previous.includes(id) && !kept.includes(id))
      return [...kept, ...added]
    })
  }, [chains])

  // Surface identical already-deployed payers so nobody redeploys one they
  // could just reuse — matching behavior + beneficiary on a selected chain.
  const duplicates = useMemo(() => {
    if (!payers?.length) return []
    const wantBalance = mode === 'balance'
    let formBeneficiary: string | null
    if (originalPayer) formBeneficiary = ''
    else {
      const raw = beneficiary.trim()
      formBeneficiary = isAddress(raw, { strict: false }) ? raw.toLowerCase() : null // null = can't compare yet
    }
    if (formBeneficiary === null) return []
    return payers.filter((row) => {
      if (!selectedChains.includes(Number(row.chainId))) return false
      if (!!row.defaultAddToBalance !== wantBalance) return false
      const rowBeneficiary = row.defaultBeneficiary && !/^0x0{40}$/i.test(row.defaultBeneficiary)
        ? row.defaultBeneficiary.toLowerCase()
        : ''
      return rowBeneficiary === formBeneficiary
    })
  }, [payers, mode, originalPayer, beneficiary, selectedChains])

  const handleDeploy = useCallback(async () => {
    if (deployBusy) return
    const targets = chains.filter((c) => selectedChains.includes(c.chainId))
    if (!targets.length) {
      setDeployStatus({ kind: 'error', text: 'Select at least one chain.' })
      return
    }
    if (!activeAddress) {
      setDeployStatus({ kind: 'error', text: 'Connect a wallet to deploy payer addresses.' })
      return
    }
    setDeployBusy(true)
    try {
      const resolvedBeneficiary = originalPayer
        ? zeroAddress
        : await resolveAddressInput(beneficiary, 'beneficiary')
      let owner: string = zeroAddress
      if (editable) {
        owner = await resolveAddressInput(adminAddress || activeAddress, 'address admin')
        if (/^0x0{40}$/i.test(owner)) throw new Error('Editable payer addresses need a nonzero address admin.')
      }
      const metadata = normalizeProjectPayerMetadata(metadataHex)
      for (const target of targets) {
        const call = buildProjectPayerDeployCall({
          chainId: target.chainId,
          projectId: target.projectId,
          beneficiary: resolvedBeneficiary,
          memo,
          metadata,
          addToBalance: mode === 'balance',
          owner,
        })
        await run({
          chainId: call.chainId,
          to: call.to,
          data: call.data,
          onPhase: (phase) => setDeployStatus({
            kind: 'pending',
            text: `${chainName(target.chainId)}: ${PHASE_TEXT[phase]}`,
          }),
        })
      }
      setDeployStatus({
        kind: 'success',
        text: `Payer address deployment complete on ${targets.length} chain${targets.length === 1 ? '' : 's'}.`,
      })
      loadPayers()
    } catch (error) {
      setDeployStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Could not deploy the payer address.',
      })
    } finally {
      setDeployBusy(false)
    }
  }, [deployBusy, chains, selectedChains, activeAddress, originalPayer, beneficiary, editable, adminAddress, metadataHex, memo, mode, run, loadPayers])

  // -------------------------------------------------------------------------
  // Shared styles
  // -------------------------------------------------------------------------
  const card = `border p-4 space-y-3 ${isDark ? 'border-white/10' : 'border-gray-200'}`
  const cardTitle = `text-sm font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-gray-700'}`
  const label = `block text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`
  const input = `w-full px-3 py-2 text-sm border outline-none ${
    isDark
      ? 'bg-juice-dark border-white/15 text-white placeholder-gray-500'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
  }`
  const select = `select-caret pl-3 pr-6 py-2 text-sm border outline-none ${
    isDark ? 'bg-juice-dark border-white/15 text-white' : 'bg-white border-gray-300 text-gray-900'
  }`
  const button = 'px-4 py-2 text-sm font-medium bg-juice-orange text-juice-dark hover:bg-juice-orange/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const subText = `text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`
  const statusClass = (status: Status) =>
    status.kind === 'error'
      ? (isDark ? 'text-red-300' : 'text-red-700')
      : status.kind === 'success'
        ? (isDark ? 'text-green-300' : 'text-green-700')
        : (isDark ? 'text-gray-400' : 'text-gray-500')

  const renderStatus = (status: Status) =>
    status.text ? <div className={`text-sm ${statusClass(status)}`}>{status.text}</div> : null

  return (
    <div className="space-y-6">
      {/* Payer address */}
      <div className={card}>
        <h3 className={cardTitle}>Payer address</h3>
        <ExplainerMessage>
          A payer address lets anyone pay this project by simple transfer — send the native token
          (ETH) straight to it, no app needed. Sending ERC-20 tokens directly to it does not trigger
          a payment. Anyone can create any number of payer addresses.
        </ExplainerMessage>

        {/* Behavior */}
        <div className="space-y-1">
          <label className={label}>Behavior</label>
          <select
            className={select}
            value={mode}
            onChange={(e) => setMode(e.target.value === 'balance' ? 'balance' : 'pay')}
          >
            <option value="pay">Pay</option>
            <option value="balance">Add to balance</option>
          </select>
          <div className={subText}>
            {mode === 'balance'
              ? 'Adds funds to the project without minting tokens.'
              : `Pays the project and mints ${tokenLabel} to the beneficiary.`}
          </div>
        </div>

        {/* Beneficiary */}
        <div className="space-y-1">
          <label className={label}>{tokenLabel} beneficiary</label>
          <label className={`flex items-center gap-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            <input
              type="checkbox"
              checked={originalPayer}
              onChange={(e) => setOriginalPayer(e.target.checked)}
            />
            Original payer
          </label>
          {!originalPayer && (
            <input
              className={input}
              type="text"
              placeholder="0x… or name.eth"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
              spellCheck={false}
            />
          )}
        </div>

        {/* Memo */}
        <div className="space-y-1">
          <label className={label}>Default memo</label>
          <input
            className={input}
            type="text"
            placeholder="optional memo attached to payments"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        {/* Editable / admin */}
        <div className="space-y-1">
          <label className={`flex items-center gap-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            <input type="checkbox" checked={editable} onChange={(e) => setEditable(e.target.checked)} />
            Editable
          </label>
          {editable ? (
            <>
              <input
                className={input}
                type="text"
                placeholder="0x… or name.eth"
                value={adminAddress}
                onChange={(e) => setAdminAddress(e.target.value)}
                spellCheck={false}
              />
              <div className={subText}>
                The address admin can later change this payer address’s destination project,
                Pay/Add to Balance behavior, beneficiary, memo, and metadata, or transfer or renounce
                the admin role. The role does not receive payments or control either project.
              </div>
            </>
          ) : (
            <div className={subText}>
              Off by default: no address admin. This payer address’s destination project,
              Pay/Add to Balance behavior, beneficiary, memo, and metadata are permanent.
            </div>
          )}
        </div>

        {/* Extra options */}
        <details>
          <summary className={`cursor-pointer text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Extra options
          </summary>
          <div className="mt-2 space-y-1">
            <label className={label}>Default metadata</label>
            <input
              className={input}
              type="text"
              placeholder="0x"
              value={metadataHex}
              onChange={(e) => setMetadataHex(e.target.value)}
              spellCheck={false}
            />
            <div className={subText}>
              Hex bytes forwarded to pay/addToBalance. Leave 0x unless you need custom terminal metadata.
            </div>
          </div>
        </details>

        {/* Deploy on */}
        <div className="space-y-1">
          <label className={label}>Deploy on</label>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {chains.map((c) => (
              <label
                key={c.chainId}
                className={`flex items-center gap-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}
              >
                <input
                  type="checkbox"
                  checked={selectedChains.includes(c.chainId)}
                  onChange={(e) => setSelectedChains((previous) =>
                    e.target.checked
                      ? [...previous, c.chainId]
                      : previous.filter((id) => id !== c.chainId))}
                />
                {chainName(c.chainId)}
              </label>
            ))}
          </div>
        </div>

        {/* Duplicate detection */}
        {duplicates.length > 0 && (
          <div className={`p-3 text-sm border ${
            isDark ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200' : 'border-yellow-400 bg-yellow-50 text-yellow-800'
          }`}>
            This project already has a payer address with these settings:{' '}
            {duplicates.map((row) => `${chainName(row.chainId)} ${truncateAddress(row.address)}`).join(', ')}.
            Anyone can pay it directly — deploying again creates another address that behaves the same.
          </div>
        )}

        {renderStatus(deployStatus)}
        <button className={button} onClick={handleDeploy} disabled={deployBusy || !selectedChains.length}>
          {deployBusy
            ? 'Deploying…'
            : `Deploy payer address${selectedChains.length > 1 ? 'es' : ''}`}
        </button>

        {/* Deployed payer addresses */}
        <div className="pt-2 space-y-2">
          <div className={label}>Deployed payer addresses</div>
          {payers === null && !payersError && (
            <div className={subText}>Loading payer addresses from Bendystraw…</div>
          )}
          {payersError && (
            <div className={subText}>Could not load payer addresses from Bendystraw.</div>
          )}
          {payers !== null && payers.length === 0 && (
            <div className={subText}>No deployed payer addresses indexed yet.</div>
          )}
          {payers !== null && payers.length > 0 && (
            <div className={`divide-y ${isDark ? 'divide-white/10' : 'divide-gray-200'}`}>
              {payers.map((row) => {
                const customBeneficiary = row.defaultBeneficiary && !/^0x0{40}$/i.test(row.defaultBeneficiary)
                  ? row.defaultBeneficiary
                  : null
                return (
                  <div
                    key={`${row.chainId}-${row.address}`}
                    className="py-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1"
                  >
                    <div>
                      <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`} title={row.address}>
                        {truncateAddress(row.address)}
                        <span className={`ml-2 font-sans ${subText}`}>{chainName(row.chainId)}</span>
                      </div>
                      <div className={subText}>
                        {row.defaultAddToBalance
                          ? 'Add to balance | No tokens minted'
                          : customBeneficiary
                            ? `Pay | Tokens mint to ${truncateAddress(customBeneficiary)}`
                            : 'Pay | Tokens mint to the sender'}
                        {' | '}
                        {countsText(row)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {formatFacilitated(row)}
                      </div>
                      <div className={subText}>
                        {row.lastUsedAt ? `Last used ${timeAgo(row.lastUsedAt)}` : 'Never used'}
                        {row.createdAt ? ` | Created ${timeAgo(row.createdAt)}` : ''}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
