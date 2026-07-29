/**
 * Open a REVLoans loan against revnet tokens. Ports website/src/discover.js
 * buildLoanModal (:18716) onto the shared guarded transaction runner.
 *
 * Loans have NO interest rate: the prepaid fee (25–500 permil, slider) buys a
 * zero-extra-cost window; afterwards the unlock cost ramps linearly to 100% of
 * the un-prepaid portion at 10 years, when the loan liquidates.
 *
 * Two guarded runs when the one-off BURN_TOKENS grant is missing:
 *   1. JBPermissions.setPermissionsFor granting REVLoans BURN_TOKENS ("step 1 of 2")
 *   2. REVLoans.borrowFrom with minBorrowAmount = 99% floor of the reviewed
 *      quote; its reverify re-quotes borrowableAmountFrom and aborts if the
 *      live quote dropped below the floor.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { encodeFunctionData, formatUnits, parseUnits } from 'viem'
import { jbContractAddress, jbMultiTerminalAbi, jbTokensAbi, type JBChainId } from '@bananapus/nana-sdk-core'
import {
  JBPermissionIdsV6,
  buildBorrowTx,
  buildSetPermissionsTx,
  getAccountingContexts,
  hasPermissions,
} from '@bananapus/nana-sdk-core/v6'
import { useThemeStore } from '../../../stores'
import { CHAINS } from '../../../constants'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { publicClientFor, type GuardedTxPhase } from '../../../services/projectTx'
import type { Project } from '../../../services/bendystraw'
import { describeAccountingToken, hasRevLoans, type YouAccountingToken } from '../../../services/youPosition'
import {
  LOAN_MAX_PREPAID,
  LOAN_MIN_PREPAID,
  borrowMinAmountFromQuote,
  loanFeeFracAt,
  loanOpeningAmounts,
  loanPrepaidDurationLabel,
  loanUnlockNever,
  quoteBorrowable,
  revLoansAddress,
} from '../../../services/revLoans'
import DialogShell from '../../ui/DialogShell'

export interface OpenLoanModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project
  /** The sucker-group chains the revnet lives on (home chain first). */
  chainIds: number[]
  /** Per-chain project ids — the revnetId differs per chain. Falls back to the home id. */
  chainProjects?: Array<{ chainId: number; projectId: number | string }>
  /** Fired after the borrow confirms so the caller can refresh loan/balance reads. */
  onOpened?: (chainId: number) => void
}

const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: 'Re-checking the live loan quote…',
  switching: 'Switching network…',
  approving: 'Approving…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
}

type Step =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'granting'; phase: GuardedTxPhase }
  | { kind: 'borrowing'; phase: GuardedTxPhase; granted: boolean }
  | { kind: 'done'; txHash: `0x${string}`; guaranteedNet: bigint; collateral: bigint }

const FEELESS_ABI = [{
  type: 'function',
  name: 'isFeeless',
  stateMutability: 'view',
  inputs: [{ name: 'addr', type: 'address' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const

function formatTokens18(value: bigint): string {
  const amount = parseFloat(formatUnits(value, 18))
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

/** Static ramp chart of the extra unlock cost over the 10-year loan life. */
function LoanFeeChart({ prepaidFee, isDark }: { prepaidFee: number; isDark: boolean }) {
  const W = 460
  const H = 140
  const padL = 30
  const padR = 12
  const padT = 12
  const padB = 26
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const windowYears = (prepaidFee / LOAN_MAX_PREPAID) * 10
  const maxFrac = prepaidFee >= LOAN_MAX_PREPAID ? 0 : loanFeeFracAt(10, prepaidFee)
  const X = (year: number) => padL + (year / 10) * plotW
  const Y = (frac: number) => padT + (1 - frac) * plotH
  const axis = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'
  const grid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const label = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Additional cost to unlock over time">
      {Array.from({ length: 11 }, (_, year) => (
        <line key={year} x1={X(year)} y1={padT} x2={X(year)} y2={padT + plotH} stroke={grid} strokeWidth={0.6} strokeDasharray="2 3" />
      ))}
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke={axis} strokeWidth={1} />
      <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} stroke={axis} strokeWidth={1} />
      {windowYears > 0.02 && windowYears < 9.98 ? (
        <line x1={X(windowYears)} y1={padT} x2={X(windowYears)} y2={padT + plotH} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 2" opacity={0.55} />
      ) : null}
      <path
        d={`M${X(0)},${Y(0)} L${X(windowYears)},${Y(0)} L${X(10)},${Y(maxFrac)}`}
        fill="none"
        stroke="#f59e0b"
        strokeWidth={2}
      />
      {[0, 2, 4, 6, 8, 10].map(year => (
        <text key={year} x={X(year)} y={padT + plotH + 13} fontSize={9} fill={label} textAnchor="middle">
          {year}
        </text>
      ))}
      <text x={padL + plotW / 2} y={H - 2} fontSize={9} fill={label} textAnchor="middle">
        Time (years)
      </text>
    </svg>
  )
}

export function OpenLoanModal({ isOpen, onClose, project, chainIds, chainProjects, onOpened }: OpenLoanModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const symbol = project.tokenSymbol || 'tokens'
  const loanChains = chainIds.filter(hasRevLoans)

  const [chainId, setChainId] = useState<number>(loanChains[0] ?? chainIds[0] ?? project.chainId)
  // V6 revnet ids are independent per chain — the borrow's revnetId must be the
  // id on the SELECTED chain, not the home id.
  const revnetIdFor = useCallback(
    (cid: number): bigint =>
      BigInt(chainProjects?.find(cp => cp.chainId === cid)?.projectId ?? project.projectId),
    [chainProjects, project.projectId],
  )
  const [amountInput, setAmountInput] = useState('')
  const [prepaidFee, setPrepaidFee] = useState(LOAN_MIN_PREPAID)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [contexts, setContexts] = useState<YouAccountingToken[] | null>(null)
  const [sourceToken, setSourceToken] = useState<string | null>(null)
  const [feeless, setFeeless] = useState(false)
  const [quote, setQuote] = useState<bigint | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState(false)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const quoteSeq = useRef(0)

  const source = contexts?.find(context => context.token.toLowerCase() === sourceToken?.toLowerCase()) ?? contexts?.[0] ?? null

  let collateral = 0n
  try {
    collateral = amountInput ? parseUnits(amountInput, 18) : 0n
  } catch {
    collateral = 0n
  }

  const formatSource = useCallback(
    (value: bigint) => {
      if (!source) return '—'
      const amount = parseFloat(formatUnits(value, source.decimals))
      return `${amount.toLocaleString(undefined, { maximumFractionDigits: source.decimals === 6 ? 2 : 5 })} ${source.symbol}`
    },
    [source],
  )

  // Reset on open.
  useEffect(() => {
    if (!isOpen) return
    setStep({ kind: 'idle' })
    setError(null)
    setAmountInput('')
    setQuote(null)
    setQuoteError(false)
    setPrepaidFee(LOAN_MIN_PREPAID)
  }, [isOpen])

  // Per-chain reads: your balance, the accounting (source) tokens, feeless status.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setBalance(null)
    setContexts(null)
    setSourceToken(null)
    setFeeless(false)
    setQuote(null)
    const cid = chainId as JBChainId
    const projectId = revnetIdFor(chainId)
    let client: ReturnType<typeof publicClientFor>
    try {
      client = publicClientFor(chainId)
    } catch {
      return
    }
    if (activeAddress) {
      const jbTokens = (jbContractAddress['6'].JBTokens as Record<string, `0x${string}`>)[String(chainId)]
      if (jbTokens) {
        client
          .readContract({ address: jbTokens, abi: jbTokensAbi, functionName: 'totalBalanceOf', args: [activeAddress, projectId] })
          .then(value => { if (!cancelled) setBalance(value) })
          .catch(() => { if (!cancelled) setBalance(null) })
      }
    }
    getAccountingContexts(client, { chainId: cid, projectId })
      .then(list => {
        if (cancelled) return
        const described = list.map(context => describeAccountingToken(chainId, context))
        setContexts(described)
        setSourceToken(described[0]?.token ?? null)
      })
      .catch(() => { if (!cancelled) setContexts([]) })
    // REVLoans is both caller and beneficiary of the terminal allowance. A failed
    // read conservatively shows the 2.5% fee — a waived fee only increases proceeds.
    const loans = revLoansAddress(chainId)
    const terminal = (jbContractAddress['6'].JBMultiTerminal as Record<string, `0x${string}`>)[String(chainId)]
    if (loans && terminal) {
      client
        .readContract({ address: terminal, abi: jbMultiTerminalAbi, functionName: 'FEELESS_ADDRESSES' })
        .then(feelessAddresses =>
          client.readContract({ address: feelessAddresses, abi: FEELESS_ABI, functionName: 'isFeeless', args: [loans] }),
        )
        .then(value => { if (!cancelled) setFeeless(Boolean(value)) })
        .catch(() => { if (!cancelled) setFeeless(false) })
    }
    return () => {
      cancelled = true
    }
  }, [isOpen, chainId, project.projectId, activeAddress, revnetIdFor])

  // Live borrowable preview (debounced). borrowableAmountFrom returns 0 for ALL
  // collateral while the revnet's cash-out delay is active — time-locked, not an error.
  useEffect(() => {
    if (!isOpen) return
    const seq = ++quoteSeq.current
    setQuoteError(false)
    if (collateral <= 0n || !source) {
      setQuote(null)
      setQuoteLoading(false)
      return
    }
    setQuoteLoading(true)
    const timer = setTimeout(() => {
      let client: ReturnType<typeof publicClientFor>
      try {
        client = publicClientFor(chainId)
      } catch {
        setQuote(null)
        setQuoteError(true)
        setQuoteLoading(false)
        return
      }
      quoteBorrowable(client, {
        chainId,
        revnetId: revnetIdFor(chainId),
        collateralCount: collateral,
        decimals: source.decimals,
        currency: source.currency,
      })
        .then(result => {
          if (quoteSeq.current !== seq) return
          setQuote(result.borrowableNow)
          setQuoteLoading(false)
        })
        .catch(() => {
          if (quoteSeq.current !== seq) return
          setQuote(null)
          setQuoteError(true)
          setQuoteLoading(false)
        })
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, chainId, collateral, source?.token, project.projectId, revnetIdFor])

  if (!isOpen) return null

  const running = step.kind === 'checking' || step.kind === 'granting' || step.kind === 'borrowing'
  const opening = quote != null && quote > 0n ? loanOpeningAmounts(quote, prepaidFee, feeless) : null

  const submit = async () => {
    setError(null)
    if (!activeAddress) {
      setError('Connect a wallet first.')
      return
    }
    if (collateral <= 0n) {
      setError('Enter a collateral amount.')
      return
    }
    if (balance == null) {
      setError('Your collateral balance is still loading or could not be verified.')
      return
    }
    if (collateral > balance) {
      setError('Collateral exceeds your balance on this chain.')
      return
    }
    if (!source) {
      setError('Could not resolve the loan source token for this chain.')
      return
    }
    const loans = revLoansAddress(chainId)
    if (!loans) {
      setError('Loans are not available on this chain.')
      return
    }
    const cid = chainId as JBChainId
    const projectId = revnetIdFor(chainId)
    const client = publicClientFor(chainId)
    const reviewedPrepaidFee = prepaidFee
    // The floor comes from the quote the user actually saw in the panel — not a
    // fresh re-quote — so the submitted minBorrowAmount equals what was reviewed.
    const reviewedBorrowable = quote
    if (reviewedBorrowable == null || reviewedBorrowable === 0n) {
      setError('The loan quote is still loading. Wait for it to settle and try again.')
      return
    }
    const minBorrow = borrowMinAmountFromQuote(reviewedBorrowable)
    // A dust quote floors the 99% minBorrow to 0, which would send a
    // value-bearing param at 0 (no lower bound on what's borrowed). Abort.
    if (minBorrow === 0n) {
      setError('The loan quote is too small to borrow. Add more collateral and try again.')
      return
    }
    try {
      setStep({ kind: 'checking' })
      // Fresh quote at submit time — abort (never silently lower the floor) if the
      // live borrowable dropped below the reviewed minimum.
      const fresh = await quoteBorrowable(client, {
        chainId,
        revnetId: projectId,
        collateralCount: collateral,
        decimals: source.decimals,
        currency: source.currency,
      })
      if (fresh.borrowableNow === 0n) {
        throw new Error('Nothing borrowable yet — loans are locked until this revnet’s cash out delay passes.')
      }
      if (fresh.borrowableNow < minBorrow) {
        setQuote(fresh.borrowableNow)
        throw new Error('The live loan quote dropped below the reviewed minimum. Review the new quote and try again.')
      }
      const guaranteedNet = loanOpeningAmounts(minBorrow, reviewedPrepaidFee, feeless).net
      setQuote(fresh.borrowableNow)

      // Opening a loan burns the collateral via the controller, so REVLoans needs
      // the one-off BURN_TOKENS grant from the holder — its own guarded run.
      const hasGrant = await hasPermissions(client, {
        chainId: cid,
        operator: loans,
        account: activeAddress,
        projectId,
        permissionIds: [JBPermissionIdsV6.BURN_TOKENS],
      })
      let granted = false
      if (!hasGrant) {
        granted = true
        const grantRequest = buildSetPermissionsTx({
          chainId: cid,
          account: activeAddress,
          operator: loans,
          projectId,
          permissionIds: [JBPermissionIdsV6.BURN_TOKENS],
        })
        await run({
          chainId,
          to: grantRequest.address,
          data: encodeFunctionData({ abi: grantRequest.abi, functionName: grantRequest.functionName, args: grantRequest.args }),
          review: {
            title: 'Review loan permission grant',
            label: 'Allow REVLoans to burn collateral for this project',
            contractName: 'JBPermissions',
            abi: grantRequest.abi,
            functionName: grantRequest.functionName,
            args: grantRequest.args,
          },
          onPhase: phase => setStep({ kind: 'granting', phase }),
        })
      }

      const borrowRequest = buildBorrowTx({
        chainId: cid,
        revnetId: projectId,
        token: source.token,
        minBorrowAmount: minBorrow,
        collateralCount: collateral,
        beneficiary: activeAddress,
        prepaidFeePercent: BigInt(reviewedPrepaidFee),
        holder: activeAddress,
      })
      const txHash = await run({
        chainId,
        to: borrowRequest.address,
        data: encodeFunctionData({ abi: borrowRequest.abi, functionName: borrowRequest.functionName, args: borrowRequest.args }),
        review: {
          title: 'Review loan opening',
          label: `Borrow against ${formatTokens18(collateral)} ${project.tokenSymbol || 'tokens'}`,
          contractName: 'REVLoans',
          abi: borrowRequest.abi,
          functionName: borrowRequest.functionName,
          args: borrowRequest.args,
        },
        // Re-quote before the send: abort if the live quote dropped below the
        // reviewed 99% floor, or the grant is (no longer) in place.
        reverify: async () => {
          const live = await quoteBorrowable(client, {
            chainId,
            revnetId: projectId,
            collateralCount: collateral,
            decimals: source.decimals,
            currency: source.currency,
          })
          if (live.borrowableNow < minBorrow) {
            throw new Error('The live loan quote dropped below the reviewed minimum. Review the new quote and try again.')
          }
          const stillGranted = await hasPermissions(client, {
            chainId: cid,
            operator: loans,
            account: activeAddress,
            projectId,
            permissionIds: [JBPermissionIdsV6.BURN_TOKENS],
          })
          if (!stillGranted) throw new Error('The loan contract is not approved to burn your collateral. Approve it and try again.')
        },
        onPhase: phase => setStep({ kind: 'borrowing', phase, granted }),
      })
      setStep({ kind: 'done', txHash, guaranteedNet, collateral })
      onOpened?.(chainId)
    } catch (submitError) {
      setStep({ kind: 'idle' })
      setError(submitError instanceof Error ? submitError.message : 'The loan transaction failed.')
    }
  }

  const chain = CHAINS[chainId]
  const inputClass = `w-full px-3 py-2 text-sm border bg-transparent focus:outline-none ${
    isDark ? 'border-white/20 text-white placeholder-gray-600' : 'border-gray-300 text-gray-900 placeholder-gray-400'
  }`
  const selectClass = `select-caret pl-3 pr-6 py-2 text-sm border bg-transparent focus:outline-none ${
    isDark ? 'border-white/20 text-white' : 'border-gray-300 text-gray-900'
  }`
  const keyText = isDark ? 'text-gray-400' : 'text-gray-600'
  const valueText = isDark ? 'text-gray-200' : 'text-gray-800'

  const summaryRow = (key: string, value: string, emphasize = false) => (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className={`text-sm ${emphasize ? (isDark ? 'text-white font-medium' : 'text-gray-900 font-medium') : keyText}`}>{key}</span>
      <span className={`text-sm text-right ${emphasize ? (isDark ? 'text-white font-medium' : 'text-gray-900 font-medium') : valueText}`}>{value}</span>
    </div>
  )

  return (
    <DialogShell isOpen onClose={onClose} dismissible={!running} labelledBy="open-loan-modal-title">
      <div className={`relative w-full max-w-lg max-h-[90vh] overflow-y-auto border ${isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'}`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <h2 id="open-loan-modal-title" className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Get a loan</h2>
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
            <div className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Loan opened</div>
            <p className={`text-sm ${keyText}`}>
              {formatTokens18(step.collateral)} {symbol} is now collateral — repay anytime to reclaim it.
            </p>
            <div>
              <div className={`text-xs uppercase tracking-wide ${keyText}`}>Minimum protocol payout</div>
              <div className={`text-lg font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{formatSource(step.guaranteedNet)}</div>
            </div>
            <p className={`text-sm ${keyText}`}>You also received a loan NFT to reclaim your collateral when you repay.</p>
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
              Borrow against your {symbol} without selling it. Your collateral is burned while the loan is
              open and reissued when you repay. There is no interest rate — the prepaid fee buys a window of
              zero extra cost, after which the cost to unlock grows until the loan liquidates at 10 years.
            </ExplainerMessage>

            {/* Chain + collateral */}
            <div className="space-y-2">
              {loanChains.length > 1 ? (
                <select className={selectClass} value={chainId} onChange={event => setChainId(Number(event.target.value))} disabled={running}>
                  {loanChains.map(id => (
                    <option key={id} value={id}>
                      {CHAINS[id]?.name ?? `Chain ${id}`}
                    </option>
                  ))}
                </select>
              ) : null}
              <div>
                <div className={`text-xs uppercase tracking-wide mb-1 ${keyText}`}>Collateral</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={amountInput}
                    onChange={event => setAmountInput(event.target.value)}
                    disabled={running}
                    className={inputClass}
                  />
                  <span className={`text-sm whitespace-nowrap ${valueText}`}>{symbol}</span>
                </div>
                <div className={`text-xs mt-1 ${keyText}`}>
                  {balance != null ? (
                    <>
                      Balance: {formatTokens18(balance)} {symbol}{' '}
                      <button
                        onClick={() => setAmountInput(formatUnits(balance, 18))}
                        disabled={running}
                        className="underline decoration-dotted"
                      >
                        Max
                      </button>
                    </>
                  ) : activeAddress ? (
                    'Loading your balance…'
                  ) : (
                    'Connect a wallet to see your balance.'
                  )}
                </div>
              </div>
              {contexts && contexts.length > 1 ? (
                <div>
                  <div className={`text-xs uppercase tracking-wide mb-1 ${keyText}`}>Borrow token</div>
                  <select
                    className={selectClass}
                    value={sourceToken ?? ''}
                    onChange={event => setSourceToken(event.target.value)}
                    disabled={running}
                  >
                    {contexts.map(context => (
                      <option key={context.token} value={context.token}>
                        {context.symbol} ({context.decimals} decimals)
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            {/* Live quote */}
            {collateral > 0n ? (
              <div className={`text-sm ${valueText}`}>
                {quoteLoading
                  ? 'Calculating…'
                  : quoteError
                    ? 'Could not verify the live loan quote. Try again shortly.'
                    : quote == null
                      ? null
                      : quote > 0n
                        ? `You’ll borrow ~ ${formatSource(quote)}`
                        : 'Nothing borrowable yet — loans unlock after this revnet’s cash out delay passes.'}
              </div>
            ) : null}

            {/* Prepaid-fee slider + ramp chart */}
            <div className="space-y-2">
              <div className={`text-sm ${valueText}`}>
                Prepaid fee: {prepaidFee / 10}%
                {opening ? ` | ~ ${formatSource(opening.sourceFee)} now` : ''}
              </div>
              <input
                type="range"
                min={LOAN_MIN_PREPAID}
                max={LOAN_MAX_PREPAID}
                step={5}
                value={prepaidFee}
                onChange={event => setPrepaidFee(Number(event.target.value))}
                disabled={running}
                className="w-full accent-amber-500"
              />
              <div className={`flex justify-between text-xs ${keyText}`}>
                <span>Less upfront cost</span>
                <span>More upfront cost</span>
              </div>
              <LoanFeeChart prepaidFee={prepaidFee} isDark={isDark} />
              <div className={`text-xs ${keyText}`}>
                {prepaidFee >= LOAN_MAX_PREPAID
                  ? 'Fully prepaid — no additional cost over time.'
                  : `Fees increase after ${loanPrepaidDurationLabel(prepaidFee)}.`}
              </div>
            </div>

            {/* Fee anatomy summary */}
            {opening ? (
              <div className={`border-t pt-3 ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                {summaryRow('You borrow', `~ ${formatSource(opening.gross)}`)}
                {summaryRow('2.5% protocol fee', feeless ? 'Waived (feeless)' : `~ ${formatSource(opening.protocolFee)}`)}
                {summaryRow('1% revnet fee', `~ ${formatSource(opening.revFee)}`)}
                {summaryRow(`${prepaidFee / 10}% prepaid source fee (now)`, `~ ${formatSource(opening.sourceFee)}`)}
                {summaryRow('You receive now', `~ ${formatSource(opening.net)}`, true)}
                {summaryRow(
                  'Later unlock fee',
                  loanUnlockNever(prepaidFee)
                    ? 'Never grows — fully prepaid'
                    : `Grows after ${loanPrepaidDurationLabel(prepaidFee)}; up to ~ ${formatSource(opening.gross - opening.sourceFee)} by year 10`,
                )}
              </div>
            ) : null}

            <ul className={`text-xs space-y-1 list-disc pl-4 ${keyText}`}>
              <li>{collateral > 0n ? `${formatTokens18(collateral)} ${symbol}` : `Your ${symbol}`} is burned as collateral while the loan is open.</li>
              <li>You receive an NFT to reclaim it when you repay.</li>
              <li>After 10 years the loan is liquidated and the collateral is lost.</li>
              <li>First-time loans need a one-off approval to let the loan contract burn your collateral.</li>
            </ul>

            {/* Status / error */}
            {step.kind === 'checking' ? (
              <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                Checking the current loan amount, fees, and approval…
              </div>
            ) : null}
            {step.kind === 'granting' ? (
              <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                Step 1 of 2 — approve the loan contract (this is NOT the loan yet): {PHASE_LABELS[step.phase]}
              </div>
            ) : null}
            {step.kind === 'borrowing' ? (
              <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                {step.granted ? 'Step 2 of 2 — open the loan: ' : ''}
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
              disabled={running || quoteLoading || quote == null || quote === 0n}
              className={`w-full py-3 font-bold transition-colors ${
                running || quoteLoading || quote == null || quote === 0n
                  ? isDark
                    ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-amber-500 text-black hover:bg-amber-500/90'
              }`}
            >
              Open loan
            </button>
          </div>
        )}
      </div>
    </DialogShell>
  )
}
