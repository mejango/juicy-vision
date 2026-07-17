/**
 * Remove market liquidity — burn a Uniswap V4 LP position back to its two
 * tokens. Ports website/src/discover.js openRemoveLiquidityModal (:21416):
 * list the wallet's positions in this project's buyback pools (the current
 * hook's pool AND a prior hook's, so stranded positions stay removable),
 * re-verify the picked position, show what it returns right now, then
 * BURN_POSITION + TAKE_PAIR through PositionManager.modifyLiquidities.
 *
 * No approval is needed — the NFT owner burns their own position. The 95%
 * minimum floors come from prepareRemoveLiquidity, and the review renders the
 * SAME plan object that is submitted, so a displayed minimum is always the
 * parameter that goes on-chain.
 */

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatUnits } from 'viem'
import { useThemeStore } from '../../../stores'
import { CHAINS } from '../../../constants'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import type { GuardedTxPhase } from '../../../services/projectTx'
import type { Project } from '../../../services/bendystraw'
import { makeProjectIdResolver } from '../../../utils/projectChains'
import {
  ammChainAvailable,
  buildRemoveLiquidityTx,
  lpHookErrorText,
  prepareRemoveLiquidity,
  readUserLpPositions,
  refreshLpPosition,
  type RemoveLiquidityPlan,
  type UserLpPosition,
} from '../../../services/ammMarket'

export interface RemoveLiquidityModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project
  /** The sucker-group chains the project lives on (home chain first). */
  chainIds: number[]
  /** Per-chain project ids (V6 ids differ per chain); reads/txs target the id ON that chain. */
  chainProjects?: Array<{ chainId: number; projectId: number | string }>
}

type Status =
  | { kind: 'idle' }
  | { kind: 'refreshing'; tokenId: bigint }
  | { kind: 'review'; position: UserLpPosition; plan: RemoveLiquidityPlan }
  | { kind: 'running'; phase: GuardedTxPhase }
  | { kind: 'done'; txHash: `0x${string}`; chainId: number }
  | { kind: 'error'; message: string }

const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: 'Re-checking the position…',
  switching: 'Switching network…',
  approving: 'Approving…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
}

function formatAmount(value: bigint, decimals: number, symbol: string): string {
  const amount = parseFloat(formatUnits(value, decimals))
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}`
}

export function RemoveLiquidityModal({ isOpen, onClose, project, chainIds, chainProjects }: RemoveLiquidityModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const lpChains = useMemo(() => chainIds.filter(ammChainAvailable), [chainIds])
  const [chainId, setChainId] = useState<number>(lpChains[0] ?? 0)
  const [positions, setPositions] = useState<UserLpPosition[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [reloadNonce, setReloadNonce] = useState(0)

  const symbol = project.tokenSymbol || 'tokens'
  const pidFor = useMemo(
    () => makeProjectIdResolver(chainProjects, { chainId: project.chainId, projectId: project.projectId }),
    [chainProjects, project.chainId, project.projectId],
  )
  // The selected chain's own project id (V6 ids differ per chain); null = not this project on that chain.
  const projectId = pidFor(chainId)

  useEffect(() => {
    if (isOpen) {
      setStatus({ kind: 'idle' })
      if (!lpChains.includes(chainId)) setChainId(lpChains[0] ?? 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !chainId || !activeAddress || projectId == null) return
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    setPositions(null)
    readUserLpPositions(chainId, projectId, activeAddress)
      .then(loaded => {
        if (!cancelled) setPositions(loaded)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, chainId, projectId, activeAddress, reloadNonce])

  // Re-verify the position (owner, liquidity, ticks, live pool price) and
  // derive the plan from THOSE fresh amounts — the list can sit open while the
  // market moves, and a stale amount must never become a reviewed minimum.
  const review = async (position: UserLpPosition) => {
    if (!activeAddress) return
    setStatus({ kind: 'refreshing', tokenId: position.tokenId })
    try {
      const fresh = await refreshLpPosition(chainId, position, activeAddress)
      setStatus({ kind: 'review', position: fresh, plan: prepareRemoveLiquidity(fresh, activeAddress) })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not refresh this position.'
      setStatus({ kind: 'error', message: lpHookErrorText(message, symbol) || message })
    }
  }

  const execute = async (position: UserLpPosition, plan: RemoveLiquidityPlan) => {
    if (!activeAddress) return
    try {
      const tx = buildRemoveLiquidityTx(chainId, plan)
      const txHash = await run({
        chainId,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        // Abort when the position shrank since review: the reviewed 95% floors
        // were derived from the reviewed liquidity, so a smaller position would
        // either revert at settlement or return less than what was shown.
        reverify: async () => {
          const fresh = await refreshLpPosition(chainId, position, activeAddress)
          if (fresh.liquidity < position.liquidity) {
            throw new Error('This position lost liquidity while you were reviewing. Reopen and review the updated amounts.')
          }
        },
        onPhase: phase => setStatus({ kind: 'running', phase }),
      })
      setStatus({ kind: 'done', txHash, chainId })
      setReloadNonce(nonce => nonce + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Remove liquidity failed.'
      setStatus({ kind: 'error', message: lpHookErrorText(message, symbol) || message })
    }
  }

  if (!isOpen) return null

  const running = status.kind === 'running'
  const chain = CHAINS[chainId]
  const mutedClass = `text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`
  const labelClass = `block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`

  const reviewing = status.kind === 'review' ? status : null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={running ? undefined : onClose} />
      <div
        className={`relative w-full max-w-lg max-h-[90vh] overflow-y-auto border ${
          isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
        }`}
      >
        <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Remove market liquidity</h2>
          {!running ? (
            <button
              onClick={onClose}
              className={`p-2 transition-colors ${
                isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>

        <div className="p-5 space-y-4">
          <ExplainerMessage>
            Your Uniswap V4 LP positions in this project&rsquo;s buyback pools. Removing burns the position NFT and
            returns both tokens to your wallet — no approval needed.
          </ExplainerMessage>

          {!lpChains.length ? (
            <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              No Uniswap V4 position manager on this project&rsquo;s chains.
            </p>
          ) : !activeAddress ? (
            <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Connect a wallet to see your positions.
            </p>
          ) : (
            <>
              {lpChains.length > 1 ? (
                <div>
                  <label className={labelClass}>Chain</label>
                  <select
                    value={chainId}
                    onChange={event => {
                      setChainId(Number(event.target.value))
                      setStatus({ kind: 'idle' })
                    }}
                    disabled={running}
                    className={`select-caret pl-3 pr-6 py-2 text-sm border bg-transparent ${
                      isDark ? 'border-white/20 text-white' : 'border-gray-300 text-gray-900'
                    }`}
                  >
                    {lpChains.map(id => (
                      <option key={id} value={id}>
                        {CHAINS[id]?.name ?? `Chain ${id}`}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {loading ? (
                <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Reading your positions…</p>
              ) : loadError ? (
                <p className="text-sm text-red-400" role="alert">
                  Could not load positions.
                </p>
              ) : positions && !positions.length ? (
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  No LP positions found for your wallet on {chain?.name ?? `chain ${chainId}`}.
                </p>
              ) : positions ? (
                <div className="space-y-2">
                  {positions.map(position => {
                    const refreshing = status.kind === 'refreshing' && status.tokenId === position.tokenId
                    const shown = reviewing?.position.tokenId === position.tokenId ? reviewing.position : position
                    return (
                      <div
                        key={`${position.poolId}:${position.tokenId}`}
                        className={`flex items-start justify-between gap-3 p-3 border ${
                          isDark ? 'border-white/10' : 'border-gray-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            Position #{shown.tokenId.toString()}
                            <span className={`ml-2 font-normal ${mutedClass}`}>
                              {shown.hookIsCurrent ? 'current pool' : 'old pool'}
                            </span>
                          </div>
                          <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                            {formatAmount(shown.tokenAmount, 18, symbol)} + {formatAmount(shown.pairAmount, shown.pair.decimals, shown.pair.symbol)}
                          </div>
                          <div className={mutedClass}>
                            ticks {shown.tickLower} → {shown.tickUpper}
                          </div>
                        </div>
                        <button
                          onClick={() => review(position)}
                          disabled={running || refreshing || Boolean(reviewing)}
                          className={`px-3 py-1 text-xs border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-300 text-gray-800 hover:bg-gray-50'
                          }`}
                        >
                          {refreshing ? 'Refreshing…' : 'Remove'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : null}

              {/* Decoded review — the exact burn, its minimums, and its recipient. */}
              {reviewing ? (
                <div className={`p-3 space-y-2 text-xs ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className={`font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    Uniswap V4 PositionManager.modifyLiquidities on {chain?.name ?? `chain ${chainId}`}
                  </div>
                  <div className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    <span>actions</span>
                    <span>BURN_POSITION, TAKE_PAIR (0x0311)</span>
                    <span>position</span>
                    <span>#{reviewing.position.tokenId.toString()}</span>
                    <span>expected</span>
                    <span>
                      {formatAmount(reviewing.position.tokenAmount, 18, symbol)} +{' '}
                      {formatAmount(reviewing.position.pairAmount, reviewing.position.pair.decimals, reviewing.position.pair.symbol)}
                    </span>
                    <span>minimum</span>
                    <span>
                      {formatAmount(reviewing.plan.tokenMin, 18, symbol)} +{' '}
                      {formatAmount(reviewing.plan.pairMin, reviewing.position.pair.decimals, reviewing.position.pair.symbol)}
                    </span>
                    <span>recipient</span>
                    <span className="break-all">{activeAddress}</span>
                  </div>
                  <p className={mutedClass}>
                    The whole position is burned. The minimums above are the exact amount0Min/amount1Min sent with the
                    burn — a bigger adverse move than 5% reverts instead of returning less.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => execute(reviewing.position, reviewing.plan)}
                      disabled={running}
                      className="px-3 py-1 text-xs font-bold bg-amber-500 text-black hover:bg-amber-500/90 transition-colors disabled:opacity-40"
                    >
                      Confirm &amp; remove
                    </button>
                    <button
                      onClick={() => setStatus({ kind: 'idle' })}
                      disabled={running}
                      className={`px-3 py-1 text-xs border transition-colors disabled:opacity-40 ${
                        isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-300 text-gray-800 hover:bg-gray-50'
                      }`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {status.kind === 'running' ? (
                <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                  <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  Remove liquidity: {PHASE_LABELS[status.phase]}
                </div>
              ) : null}
              {status.kind === 'done' ? (
                <div className={`text-sm ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                  Liquidity removed.{' '}
                  {CHAINS[status.chainId] ? (
                    <a
                      href={`${CHAINS[status.chainId].explorerTx}${status.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-juice-cyan hover:underline"
                    >
                      View on explorer →
                    </a>
                  ) : null}
                </div>
              ) : null}
              {status.kind === 'error' ? (
                <div className="text-sm text-red-400" role="alert">
                  {status.message}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
