/**
 * Claim credits → ERC-20: mint the holder's unclaimed credits as transferable
 * tokens, one JBController.claimTokensFor per chain that has credits. Ports
 * website/src/discover.js buildClaimModal (:17238) onto the shared guarded
 * transaction runner (reverify → simulate → send → confirm).
 */

import { useEffect, useState } from 'react'
import { encodeFunctionData, formatUnits } from 'viem'
import { type JBChainId } from '@bananapus/nana-sdk-core'
import { buildClaimTokensTx, getCreditBalance } from '@bananapus/nana-sdk-core/v6'
import { useThemeStore } from '../../../stores'
import { CHAINS } from '../../../constants'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { publicClientFor, type GuardedTxPhase } from '../../../services/projectTx'
import ChainLogo from '../../ui/ChainLogo'
import DialogShell from '../../ui/DialogShell'

export interface ClaimCreditsRow {
  chainId: number
  /** The project's id ON this chain (V6 ids differ per chain) — the claim targets THIS id. */
  projectId: number | string
  /** The unclaimed credit balance captured at review time (18 decimals). */
  creditBalance: bigint
}

export interface ClaimCreditsModalProps {
  isOpen: boolean
  onClose: () => void
  /** Home-chain project id — display only. Each row carries the id ON ITS chain,
   *  which is what the claim/reverify actually use (V6 ids differ per chain). */
  projectId: number | string
  tokenSymbol?: string | null
  rows: ClaimCreditsRow[]
  /** Fired after a chain's claim confirms so the caller can refresh balances. */
  onClaimed?: (chainId: number) => void
}

type RowStatus =
  | { kind: 'idle' }
  | { kind: 'review' }
  | { kind: 'running'; phase: GuardedTxPhase }
  | { kind: 'done'; txHash: `0x${string}` }
  | { kind: 'error'; message: string }

const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: 'Re-checking your credit balance…',
  switching: 'Switching network…',
  approving: 'Approving…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
}

function formatCredits(value: bigint): string {
  const amount = parseFloat(formatUnits(value, 18))
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export function ClaimCreditsModal({
  isOpen,
  onClose,
  tokenSymbol,
  rows,
  onClaimed,
}: ClaimCreditsModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const [statuses, setStatuses] = useState<Record<number, RowStatus>>({})

  useEffect(() => {
    if (isOpen) setStatuses({})
  }, [isOpen])

  if (!isOpen) return null

  const symbol = tokenSymbol || 'tokens'
  const setStatus = (chainId: number, status: RowStatus) =>
    setStatuses(previous => ({ ...previous, [chainId]: status }))

  const claim = async (row: ClaimCreditsRow) => {
    if (!activeAddress) {
      setStatus(row.chainId, { kind: 'error', message: 'Connect a wallet first.' })
      return
    }
    const chainName = CHAINS[row.chainId]?.name ?? `chain ${row.chainId}`
    const claimAmount = row.creditBalance
    try {
      // Build the exact calldata from the SDK; the decoded summary below shows
      // this same request — what you review is what gets sent.
      // Claim targets the project's id ON row.chainId (V6 ids differ per chain),
      // never the home id — that would claim against the wrong project off-home.
      const request = buildClaimTokensTx({
        chainId: row.chainId as JBChainId,
        holder: activeAddress,
        projectId: BigInt(row.projectId),
        tokenCount: claimAmount,
        beneficiary: activeAddress,
      })
      const data = encodeFunctionData({
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
      })
      const txHash = await run({
        chainId: row.chainId,
        to: request.address,
        data,
        review: {
          title: 'Review credit claim',
          label: `Claim ${formatCredits(claimAmount)} ${symbol} as transferable tokens`,
          contractName: 'JBController',
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
        },
        // Reviewed-state re-verification: the runner calls this before the send
        // (and again after any chain switch). Abort when the live credit
        // balance dropped below the reviewed claim amount.
        reverify: async () => {
          const fresh = await getCreditBalance(publicClientFor(row.chainId), {
            chainId: row.chainId as JBChainId,
            projectId: BigInt(row.projectId),
            holder: activeAddress,
          })
          if (fresh < claimAmount) {
            throw new Error(`Your credit balance on ${chainName} dropped below the reviewed amount. Reopen to refresh.`)
          }
        },
        onPhase: phase => setStatus(row.chainId, { kind: 'running', phase }),
      })
      setStatus(row.chainId, { kind: 'done', txHash })
      onClaimed?.(row.chainId)
    } catch (error) {
      setStatus(row.chainId, {
        kind: 'error',
        message: error instanceof Error ? error.message : 'The claim transaction failed.',
      })
    }
  }

  const anyRunning = Object.values(statuses).some(status => status.kind === 'running')

  return (
    <DialogShell isOpen onClose={onClose} dismissible={!anyRunning} labelledBy="claim-credits-modal-title">
      <div
        className={`relative w-full max-w-lg border ${
          isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
        }`}
      >
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <h2 id="claim-credits-modal-title" className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Claim credits</h2>
          {!anyRunning ? (
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

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Claim your credits into transferable {symbol} ERC-20 tokens. Credits and ERC-20s have the same
            value; claiming just makes them transferable. Done per chain.
          </p>

          {rows.length === 0 ? (
            <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No unclaimed credits.</p>
          ) : (
            <div className="space-y-3">
              {rows.map(row => {
                const status = statuses[row.chainId] ?? { kind: 'idle' }
                const chain = CHAINS[row.chainId]
                const chainName = chain?.name ?? `Chain ${row.chainId}`
                return (
                  <div
                    key={row.chainId}
                    className={`border p-3 space-y-2 ${isDark ? 'border-white/10' : 'border-gray-200'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`text-sm inline-flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-gray-900'}`}
                      >
                        <ChainLogo chainId={row.chainId} size={14} />
                        {chainName}
                      </span>
                      <span className={`text-sm font-mono ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {formatCredits(row.creditBalance)} credits
                      </span>
                      {status.kind === 'idle' ? (
                        <button
                          onClick={() => setStatus(row.chainId, { kind: 'review' })}
                          className={`px-3 py-1 text-sm border transition-colors ${
                            isDark
                              ? 'border-white/20 text-white hover:bg-white/10'
                              : 'border-gray-300 text-gray-800 hover:bg-gray-50'
                          }`}
                        >
                          Claim
                        </button>
                      ) : null}
                    </div>

                    {/* Decoded review — the exact call, shown before anything is sent. */}
                    {status.kind === 'review' && activeAddress ? (
                      <div className={`p-3 space-y-2 text-xs ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                        <div className={`font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                          JBController.claimTokensFor on {chainName}
                        </div>
                        <div className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                          <span>holder</span>
                          <span className="break-all">{activeAddress}</span>
                          <span>projectId</span>
                          <span>{String(row.projectId)}</span>
                          <span>tokenCount</span>
                          <span>
                            {row.creditBalance.toString()} ({formatCredits(row.creditBalance)} credits)
                          </span>
                          <span>beneficiary</span>
                          <span className="break-all">{activeAddress}</span>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => claim(row)}
                            className="px-3 py-1 text-xs font-bold bg-amber-500 text-black hover:bg-amber-500/90 transition-colors"
                          >
                            Confirm claim
                          </button>
                          <button
                            onClick={() => setStatus(row.chainId, { kind: 'idle' })}
                            className={`px-3 py-1 text-xs border transition-colors ${
                              isDark
                                ? 'border-white/20 text-white hover:bg-white/10'
                                : 'border-gray-300 text-gray-800 hover:bg-gray-50'
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
                        {PHASE_LABELS[status.phase]}
                      </div>
                    ) : null}

                    {status.kind === 'done' ? (
                      <div className={`text-sm ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                        Claimed on {chainName}.{' '}
                        {chain ? (
                          <a
                            href={`${chain.explorerTx}${status.txHash}`}
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
                        {status.message}{' '}
                        <button
                          onClick={() => setStatus(row.chainId, { kind: 'idle' })}
                          className="underline decoration-dotted"
                        >
                          Try again
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          {anyRunning ? (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Do not close this window
            </div>
          ) : (
            <button
              onClick={onClose}
              className={`w-full py-3 font-medium border-2 transition-colors ${
                isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </DialogShell>
  )
}
