/**
 * REVLoans data + math layer for the revnet loans surface.
 *
 * Ports website/src/discover.js loanOutstandingFee (:14138), loanOpeningAmounts /
 * loanFeeFracAt / loanPrepaidDurationLabel (:18660..), the repay drift guard
 * (:19303), and the BENDYSTRAW_LOANS_QUERY listing (:14128). All fee math is
 * pure and BigInt so the UI cannot drift from what REVLoans charges.
 *
 * Loans have NO interest rate. The cost model is: a prepaid fee (25–500 of
 * 1000, paid to the source revnet at open) buys a zero-additional-cost window
 * of prepaidFeePercent/500 × 3650 days; after the window the cost to unlock
 * ramps linearly from 0 to 100% of the UN-prepaid portion at 3650 days (10
 * years), when the loan liquidates and the collateral is lost.
 *
 * Loan IDs CHURN: a partial repayment or reallocation burns the loan NFT and
 * mints a NEW id. Never key UI state on a loan id across a mutation — re-read
 * `loanOf` at submit time and re-query the indexer after any loan tx.
 */

import { type Address, type PublicClient } from 'viem'
import { jbContractAddress, revLoansAbi, type JBChainId } from '@bananapus/nana-sdk-core'
import { getBorrowableAmount } from '@bananapus/nana-sdk-core/v6'
import { NATIVE_TOKEN, USDC_ADDRESSES, type SupportedChainId } from '../constants'
import { getNetworkOption, safeRequest } from './bendystraw/client'

// ---------------------------------------------------------------------------
// Constants (REVLoans.sol — percents are out of MAX_FEE = 1000)
// ---------------------------------------------------------------------------

/** Denominator for all REVLoans fee percents (25 = 2.5%). */
export const LOAN_MAX_FEE = 1000n
/** Minimum prepaid fee percent borrowFrom accepts — 0 REVERTS on-chain. */
export const LOAN_MIN_PREPAID = 25
/** Maximum prepaid fee percent (fully prepaid — the fee never grows). */
export const LOAN_MAX_PREPAID = 500
/** Liquidation horizon: 3650 days. After this the collateral is lost. */
export const LOAN_LIQUIDATION_SECONDS = 3650 * 86400
/** Upfront fee routed to the $REV revnet on every borrow: 10/1000 = 1%. */
export const LOAN_REV_FEE_PERCENT = 10n

// ---------------------------------------------------------------------------
// Pure fee math
// ---------------------------------------------------------------------------

/** The indexed/on-chain loan facts the fee math needs. */
export interface LoanFeeInputs {
  /** Debt in source-token units (includes fees taken at creation). */
  borrowAmount: bigint | string
  /** 25–500, out of 1000. */
  prepaidFeePercent: number
  /** Seconds of zero-extra-cost repayment from createdAt. */
  prepaidDuration: number
  /** Unix seconds the loan was created. */
  createdAt: number
}

/**
 * The source fee still owed on full repayment NOW, beyond what was prepaid at
 * open — mirrors REVLoans sourceFeeAmountFrom: 0 inside the prepaid window,
 * then a linear ramp of the un-prepaid remainder from 0 (window end) to 100%
 * (liquidation at 3650 days). Returns null once the loan has expired (no
 * longer repayable).
 */
export function loanOutstandingFee(loan: LoanFeeInputs, nowSec: number): bigint | null {
  const amount = BigInt(loan.borrowAmount)
  const prepaidPct = BigInt(Number(loan.prepaidFeePercent || 0))
  const prepaidDur = Number(loan.prepaidDuration || 0)
  const elapsed = nowSec - Number(loan.createdAt || 0)
  if (elapsed <= prepaidDur) return 0n
  if (elapsed > LOAN_LIQUIDATION_SECONDS) return null
  const prepaid = (amount * prepaidPct) / LOAN_MAX_FEE
  const rampPct = (BigInt(elapsed - prepaidDur) * LOAN_MAX_FEE) / BigInt(LOAN_LIQUIDATION_SECONDS - prepaidDur)
  return ((amount - prepaid) * rampPct) / LOAN_MAX_FEE
}

/** The zero-extra-cost window a prepaid fee percent buys: p/500 of 3650 days. */
export function prepaidWindowSeconds(prepaidFeePercent: number): number {
  return Math.floor((prepaidFeePercent * LOAN_LIQUIDATION_SECONDS) / LOAN_MAX_PREPAID)
}

/** Human label for when the time-based fee starts growing. */
export function loanPrepaidDurationLabel(prepaidFeePercent: number): string {
  const days = (prepaidFeePercent * 3650) / LOAN_MAX_PREPAID
  if (days >= 3650) return 'never'
  if (days >= 365) {
    const years = Math.round((days / 365) * 10) / 10
    return `${years} ${years === 1 ? 'year' : 'years'}`
  }
  if (days >= 60) return `${Math.round(days / 30.4)} months`
  return `${Math.round(days)} days`
}

export interface LoanOpeningAmounts {
  gross: bigint
  /** 2.5% terminal fee (gross/40) → JB project #1; waived when REVLoans is feeless. */
  protocolFee: bigint
  /** 1% → the $REV revnet. */
  revFee: bigint
  /** The chosen prepaid fee, paid into the source revnet now. */
  sourceFee: bigint
  /** What the borrower receives now. */
  net: bigint
}

/**
 * Opening amounts shown in the loan summary. One pure helper so the prominent
 * net-proceeds figure cannot drift from the fee breakdown beneath it.
 */
export function loanOpeningAmounts(
  gross: bigint | string,
  prepaidFeePercent: number,
  feeless: boolean,
): LoanOpeningAmounts {
  const amount = BigInt(gross || 0)
  const protocolFee = feeless ? 0n : amount / 40n
  const revFee = (amount * LOAN_REV_FEE_PERCENT) / LOAN_MAX_FEE
  const sourceFee = (amount * BigInt(prepaidFeePercent)) / LOAN_MAX_FEE
  return { gross: amount, protocolFee, revFee, sourceFee, net: amount - protocolFee - revFee - sourceFee }
}

/**
 * "Additional cost to unlock" (fraction of the borrowed principal) at time
 * `tYears`, for prepaid percent `p`: 0 through the prepaid window (p/500 ×
 * 10y), then linear up to (1 − p/1000) at year 10. Drives the fee chart.
 */
export function loanFeeFracAt(tYears: number, prepaidFeePercent: number): number {
  if (prepaidFeePercent >= LOAN_MAX_PREPAID) return 0
  const windowYears = (prepaidFeePercent / LOAN_MAX_PREPAID) * 10
  if (tYears <= windowYears) return 0
  return (1 - prepaidFeePercent / Number(LOAN_MAX_FEE)) * ((tYears - windowYears) / (10 - windowYears))
}

/** Whether the chosen prepaid percent fully prepays the fee (it never grows). */
export function loanUnlockNever(prepaidFeePercent: number): boolean {
  return prepaidFeePercent >= LOAN_MAX_PREPAID
}

/**
 * The submitted minBorrowAmount floor: 99% of the reviewed live quote.
 * REVLoans compares it against the gross borrow in the source token's own
 * accounting context.
 */
export function borrowMinAmountFromQuote(quote: bigint): bigint {
  return (quote * 99n) / 100n
}

/**
 * The repay ceiling sent as maxRepayBorrowAmount: principal + the current fee
 * + a small drift guard covering the fee's per-second growth while the tx is
 * in flight (~120s of ramp). REVLoans refunds anything unused. For native
 * loans this is also the msg.value.
 */
export function loanRepayCeiling(
  principal: bigint,
  prepaidFeePercent: number,
  prepaidDuration: number,
  currentFee: bigint,
): bigint {
  const prepaid = (principal * BigInt(Number(prepaidFeePercent || 0))) / LOAN_MAX_FEE
  const ramp = Math.max(1, LOAN_LIQUIDATION_SECONDS - Number(prepaidDuration || 0))
  const driftGuard = ((principal - prepaid) * 120n) / BigInt(ramp) + 1n
  return principal + currentFee + driftGuard
}

// ---------------------------------------------------------------------------
// Borrowable-quote handling
// ---------------------------------------------------------------------------

export interface BorrowableQuote {
  /** Currently borrowable — 0 while the revnet's cash-out delay is active (time-locked, NOT an error). */
  borrowableNow: bigint
  /** The full capacity the collateral represents (values existing collateral). */
  borrowableCapacity: bigint
}

/**
 * REVLoans.borrowableAmountFrom returns a TUPLE (borrowableAmount,
 * collateralCount) — never treat it as single-valued. Normalizes the SDK's
 * named object, a raw tuple, or a legacy single value into one shape.
 */
export function normalizeBorrowable(
  result:
    | bigint
    | readonly [bigint, bigint]
    | { borrowableNow: bigint; borrowableCapacity: bigint }
    | null
    | undefined,
): BorrowableQuote | null {
  if (result == null) return null
  if (typeof result === 'bigint') return { borrowableNow: result, borrowableCapacity: result }
  if (Array.isArray(result)) {
    return { borrowableNow: BigInt(result[0]), borrowableCapacity: BigInt(result[1] ?? result[0]) }
  }
  const named = result as { borrowableNow: bigint; borrowableCapacity: bigint }
  return { borrowableNow: named.borrowableNow, borrowableCapacity: named.borrowableCapacity }
}

/** Live borrowable quote for a collateral count, in the source token's own context. */
export async function quoteBorrowable(
  client: PublicClient,
  args: { chainId: number; revnetId: bigint; collateralCount: bigint; decimals: number; currency: number },
): Promise<BorrowableQuote> {
  const result = await getBorrowableAmount(client, {
    chainId: args.chainId as JBChainId,
    revnetId: args.revnetId,
    collateralCount: args.collateralCount,
    decimals: BigInt(args.decimals),
    currency: BigInt(args.currency),
  })
  const quote = normalizeBorrowable(result)
  if (!quote) throw new Error('Could not read the live loan quote')
  return quote
}

// ---------------------------------------------------------------------------
// On-chain loan reads (repay flow)
// ---------------------------------------------------------------------------

export function revLoansAddress(chainId: number): Address | null {
  const byChain = jbContractAddress['6'].REVLoans as Record<string, Address> | undefined
  return byChain?.[String(chainId)] ?? null
}

/** The on-chain REVLoan struct (loanOf). amount/createdAt of 0 = no longer open. */
export interface OnChainLoan {
  amount: bigint
  collateral: bigint
  createdAt: number
  prepaidFeePercent: number
  prepaidDuration: number
  sourceToken: Address
}

export async function readLoanOf(client: PublicClient, chainId: number, loanId: bigint): Promise<OnChainLoan | null> {
  const address = revLoansAddress(chainId)
  if (!address) return null
  const loan = await client.readContract({ address, abi: revLoansAbi, functionName: 'loanOf', args: [loanId] })
  return {
    amount: BigInt(loan.amount),
    collateral: BigInt(loan.collateral),
    createdAt: Number(loan.createdAt),
    prepaidFeePercent: Number(loan.prepaidFeePercent),
    prepaidDuration: Number(loan.prepaidDuration),
    sourceToken: loan.sourceToken,
  }
}

/** The exact source fee REVLoans would charge to repay `amount` right now. */
export async function readSourceFeeAmount(
  client: PublicClient,
  chainId: number,
  loan: OnChainLoan,
  amount: bigint,
): Promise<bigint> {
  const address = revLoansAddress(chainId)
  if (!address) throw new Error(`REVLoans is not deployed on chain ${chainId}`)
  const fee = await client.readContract({
    address,
    abi: revLoansAbi,
    functionName: 'determineSourceFeeAmount',
    args: [
      {
        amount: loan.amount,
        collateral: loan.collateral,
        createdAt: loan.createdAt,
        prepaidFeePercent: loan.prepaidFeePercent,
        prepaidDuration: loan.prepaidDuration,
        sourceToken: loan.sourceToken,
      },
      amount,
    ],
  })
  return BigInt(fee)
}

// ---------------------------------------------------------------------------
// Source-token display metadata
// ---------------------------------------------------------------------------

export interface LoanTokenMeta {
  symbol: string
  decimals: number
}

/**
 * Display unit for a loan's source token. Loans are denominated in the source
 * token's accounting context, not the ruleset base currency: proven native →
 * ETH (18), canonical USDC → USDC (6). Unknown tokens return null so amounts
 * render as raw units instead of a wrong division.
 */
export function describeLoanToken(chainId: number, token: string): LoanTokenMeta | null {
  const normalized = String(token || '').toLowerCase()
  if (normalized === NATIVE_TOKEN.toLowerCase()) return { symbol: 'ETH', decimals: 18 }
  if (normalized === USDC_ADDRESSES[chainId as SupportedChainId]?.toLowerCase()) return { symbol: 'USDC', decimals: 6 }
  return null
}

// ---------------------------------------------------------------------------
// Bendystraw loans listing
// ---------------------------------------------------------------------------

/** One active loan as indexed by Bendystraw (fully repaid/liquidated loans drop out). */
export interface IndexedLoan {
  /** On-chain loan id (revnetId * 1e18 + loanNumber). CHURNS on partial repay/reallocate. */
  id: string
  chainId: number
  borrowAmount: string
  collateral: string
  beneficiary: string
  owner: string
  createdAt: number
  prepaidFeePercent: number
  prepaidDuration: number
  sourceFeeAmount: string
  /** Source token (native = 0x…EEEe). */
  token: string
}

export const LOANS_QUERY = `
  query Loans($projectId: Int!, $version: Int!, $chainIds: [Int!], $limit: Int!, $offset: Int!) {
    loans(
      where: { projectId: $projectId, version: $version, chainId_in: $chainIds }
      orderBy: "createdAt"
      orderDirection: "desc"
      limit: $limit
      offset: $offset
    ) {
      items {
        id
        chainId
        borrowAmount
        collateral
        beneficiary
        owner
        createdAt
        prepaidFeePercent
        prepaidDuration
        sourceFeeAmount
        token
      }
      totalCount
    }
  }
`

interface LoansResponse {
  loans: { items: IndexedLoan[]; totalCount: number }
}

const LOANS_PAGE_SIZE = 100

/** A chain the project lives on, with the project's id ON THAT CHAIN (V6 ids differ per chain). */
export interface LoanChainProject {
  chainId: number
  projectId: number | string
}

/**
 * Every active indexed loan for a project across its chains (V6 only), newest
 * first. Each chain is queried with ITS OWN project id — a single projectId +
 * chainId_in filter would read the WRONG project on any chain whose id diverges
 * from the home id.
 */
export async function fetchProjectLoans(chainProjects: ReadonlyArray<LoanChainProject>): Promise<IndexedLoan[]> {
  if (!chainProjects.length) return []

  const perChain = await Promise.all(
    chainProjects.map(async ({ chainId, projectId }) => {
      const pid = Number(projectId)
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid project ID')
      const rows: IndexedLoan[] = []
      let totalCount = 0
      do {
        const data = await safeRequest<LoansResponse>(LOANS_QUERY, {
          projectId: pid,
          version: 6,
          chainIds: [chainId],
          limit: LOANS_PAGE_SIZE,
          offset: rows.length,
        }, getNetworkOption(chainId))
        const page = data.loans?.items || []
        totalCount = data.loans?.totalCount ?? page.length
        rows.push(...page)
        if (!page.length) break
      } while (rows.length < totalCount)
      return rows
    }),
  )
  // Per-chain pages were independent, so re-sort the merged rows newest-first.
  return perChain.flat().sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
}
