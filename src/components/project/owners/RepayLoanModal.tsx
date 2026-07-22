/**
 * Repay an open REVLoans loan: reads the exact on-chain loan + current source
 * fee, repays principal + fee and reclaims all collateral. Ports
 * website/src/discover.js buildRepayModal (:19237) onto the shared guarded
 * transaction runner.
 *
 * Loan IDs CHURN — a partial repayment or reallocation burns the loan NFT and
 * mints a NEW id. So both at submit time AND inside the runner's reverify the
 * loan is re-read from chain; if it moved (or is no longer open) the send
 * aborts instead of quoting stale principal/collateral.
 *
 * Native (ETH) loans pay via msg.value (excess auto-refunded by REVLoans);
 * ERC-20 loans get an approval pre-step from the guarded runner. A small
 * drift guard over the current fee covers per-second ramp growth in flight.
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { encodeFunctionData, formatUnits } from 'viem'
import { type JBChainId } from '@bananapus/nana-sdk-core'
import { buildRepayLoanTx } from '@bananapus/nana-sdk-core/v6'
import { useThemeStore } from '../../../stores'
import { CHAINS, NATIVE_TOKEN } from '../../../constants'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { publicClientFor, type GuardedTxPhase } from '../../../services/projectTx'
import type { Project } from '../../../services/bendystraw'
import {
  describeLoanToken,
  loanRepayCeiling,
  readLoanOf,
  readSourceFeeAmount,
  revLoansAddress,
  type IndexedLoan,
  type OnChainLoan,
} from '../../../services/revLoans'

export interface RepayLoanModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project
  /** The indexed loan row the user picked. Its id is re-read on-chain before anything is sent. */
  loan: IndexedLoan
  /** Fired after the repayment confirms so the caller can refresh the loans list. */
  onRepaid?: (chainId: number) => void
}

const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: 'Re-checking the loan…',
  switching: 'Switching network…',
  approving: 'Approving the repayment token…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
}

type Step =
  | { kind: 'idle' }
  | { kind: 'refreshing' }
  | { kind: 'running'; phase: GuardedTxPhase }
  | { kind: 'done'; txHash: `0x${string}`; collateral: bigint }

function formatTokens18(value: bigint): string {
  const amount = parseFloat(formatUnits(value, 18))
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

export function RepayLoanModal({ isOpen, onClose, project, loan, onRepaid }: RepayLoanModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const symbol = project.tokenSymbol || 'tokens'
  const chainId = Number(loan.chainId) || project.chainId
  const chain = CHAINS[chainId]
  const loanId = BigInt(loan.id)

  const [onChain, setOnChain] = useState<OnChainLoan | null>(null)
  const [fee, setFee] = useState<bigint | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)

  // Read the exact live loan + fee on open — never trust the indexed snapshot.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setOnChain(null)
    setFee(null)
    setLoadError(null)
    setStep({ kind: 'idle' })
    setError(null)
    ;(async () => {
      const client = publicClientFor(chainId)
      const live = await readLoanOf(client, chainId, loanId)
      if (!live || live.createdAt === 0 || live.amount === 0n) {
        throw new Error('This loan is no longer open. It may have been repaid or replaced by a new loan id — refresh the list.')
      }
      const currentFee = await readSourceFeeAmount(client, chainId, live, live.amount)
      if (cancelled) return
      setOnChain(live)
      setFee(currentFee)
    })().catch(readError => {
      if (cancelled) return
      setLoadError(readError instanceof Error ? readError.message : 'Could not verify the exact current loan and repayment fee. Nothing can be sent.')
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, chainId, loanId])

  if (!isOpen) return null

  const sourceMeta = onChain ? describeLoanToken(chainId, onChain.sourceToken) : describeLoanToken(chainId, loan.token)
  const formatSource = (value: bigint) => {
    if (!sourceMeta) return `${value.toLocaleString('en-US')} raw units`
    const amount = parseFloat(formatUnits(value, sourceMeta.decimals))
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: sourceMeta.decimals === 6 ? 2 : 5 })} ${sourceMeta.symbol}`
  }

  const running = step.kind === 'refreshing' || step.kind === 'running'

  const submit = async () => {
    setError(null)
    if (!activeAddress) {
      setError('Connect a wallet first.')
      return
    }
    const loans = revLoansAddress(chainId)
    if (!loans) {
      setError('Loans are not available on this chain.')
      return
    }
    try {
      setStep({ kind: 'refreshing' })
      const client = publicClientFor(chainId)
      // Re-read the loan itself as well as its fee immediately before review —
      // a partial repayment elsewhere replaces the loan id.
      const fresh = await readLoanOf(client, chainId, loanId)
      if (!fresh || fresh.createdAt === 0 || fresh.amount === 0n) {
        throw new Error('This loan is no longer open. Refresh the list and select its current loan.')
      }
      const freshFee = await readSourceFeeAmount(client, chainId, fresh, fresh.amount)
      setOnChain(fresh)
      setFee(freshFee)

      const maxRepay = loanRepayCeiling(fresh.amount, fresh.prepaidFeePercent, fresh.prepaidDuration, freshFee)
      const nativeSource = fresh.sourceToken.toLowerCase() === NATIVE_TOKEN.toLowerCase()
      const request = buildRepayLoanTx({
        chainId: chainId as JBChainId,
        loanId,
        maxRepayBorrowAmount: maxRepay,
        collateralCountToReturn: fresh.collateral,
        beneficiary: activeAddress,
        // allowance defaults to EMPTY_SINGLE_ALLOWANCE — native pays via value,
        // ERC-20s use the runner's plain approval pre-step.
        value: nativeSource ? maxRepay : 0n,
      })
      const txHash = await run({
        chainId,
        to: request.address,
        data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }),
        value: request.value,
        approval: nativeSource
          ? undefined
          : { token: fresh.sourceToken, spender: loans, amount: maxRepay },
        review: {
          title: 'Review loan repayment',
          label: `Repay loan #${loanId.toString()} and reclaim collateral`,
          contractName: 'REVLoans',
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
        },
        // Drift guard: abort if the loan moved between review and send (repaid,
        // reallocated, or replaced — the id would then point at stale state).
        reverify: async () => {
          const live = await readLoanOf(client, chainId, loanId)
          if (!live || live.createdAt === 0 || live.amount === 0n) {
            throw new Error('This loan is no longer open. Refresh the list and select its current loan.')
          }
          if (live.amount !== fresh.amount || live.collateral !== fresh.collateral) {
            throw new Error('The loan changed while the repayment was loading. Review the new amounts and try again.')
          }
          // The fee ramps per-second; maxRepay only baked ~120s of that ramp at
          // review. A slow ERC-20 repay (approval + send) can outrun the guard —
          // re-read the live fee and abort if the owed amount now exceeds maxRepay
          // (which would revert on-chain) instead of quoting a stale ceiling.
          const liveFee = await readSourceFeeAmount(client, chainId, live, live.amount)
          if (live.amount + liveFee > maxRepay) {
            throw new Error('The repayment fee grew past the reviewed ceiling while the transaction was loading. Review the new total and try again.')
          }
        },
        onPhase: phase => setStep({ kind: 'running', phase }),
      })
      setStep({ kind: 'done', txHash, collateral: fresh.collateral })
      onRepaid?.(chainId)
    } catch (submitError) {
      setStep({ kind: 'idle' })
      setError(submitError instanceof Error ? submitError.message : 'The repayment transaction failed.')
    }
  }

  const keyText = isDark ? 'text-gray-400' : 'text-gray-600'
  const valueText = isDark ? 'text-gray-200' : 'text-gray-800'
  const total = onChain != null && fee != null ? onChain.amount + fee : null

  const summaryRow = (key: string, value: string, emphasize = false) => (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className={`text-sm ${emphasize ? (isDark ? 'text-white font-medium' : 'text-gray-900 font-medium') : keyText}`}>{key}</span>
      <span className={`text-sm text-right ${emphasize ? (isDark ? 'text-white font-medium' : 'text-gray-900 font-medium') : valueText}`}>{value}</span>
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={running ? undefined : onClose} />
      <div className={`relative w-full max-w-md border ${isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'}`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Repay loan</h2>
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

        {step.kind === 'done' ? (
          <div className="p-5 space-y-3">
            <div className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Loan repaid</div>
            <p className={`text-sm ${keyText}`}>
              Your {formatTokens18(step.collateral)} {symbol} collateral is back in your wallet.
            </p>
            {chain ? (
              <a
                href={`${chain.explorerTx}${step.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-juice-cyan hover:underline"
              >
                View transaction →
              </a>
            ) : null}
            <button
              onClick={onClose}
              className={`w-full py-3 font-medium border-2 transition-colors ${isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
            >
              Done
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <ExplainerMessage>
              Repays the principal plus the current fee in {sourceMeta?.symbol ?? 'the loan source token'} on{' '}
              {chain?.name ?? `chain ${chainId}`} and returns your collateral. The small fee-drift guard is
              refunded if unused.
            </ExplainerMessage>

            {loadError ? (
              <div className="text-sm text-red-400" role="alert">
                {loadError}
              </div>
            ) : onChain == null || fee == null ? (
              <div className={`flex items-center gap-2 text-sm ${keyText}`}>
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                Reading loan…
              </div>
            ) : (
              <div>
                {summaryRow('Principal', formatSource(onChain.amount))}
                {summaryRow('Outstanding fee', fee > 0n ? `+ ${formatSource(fee)}` : '— (within prepaid window)')}
                {summaryRow('Total to repay', total != null ? formatSource(total) : '—', true)}
                {summaryRow('Reclaim collateral', `${formatTokens18(onChain.collateral)} ${symbol}`)}
              </div>
            )}

            {step.kind === 'refreshing' ? (
              <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                Refreshing the current fee…
              </div>
            ) : null}
            {step.kind === 'running' ? (
              <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                {PHASE_LABELS[step.phase]}
              </div>
            ) : null}
            {error ? (
              <div className="text-sm text-red-400" role="alert">
                {error}
              </div>
            ) : null}

            <button
              onClick={submit}
              disabled={running || onChain == null || fee == null || !!loadError}
              className={`w-full py-3 font-bold transition-colors ${
                running || onChain == null || fee == null || !!loadError
                  ? isDark
                    ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-amber-500 text-black hover:bg-amber-500/90'
              }`}
            >
              Repay loan
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
