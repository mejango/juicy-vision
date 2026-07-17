import { describe, expect, it, vi } from 'vitest'
import {
  LOAN_LIQUIDATION_SECONDS,
  LOAN_MAX_PREPAID,
  LOAN_MIN_PREPAID,
  borrowMinAmountFromQuote,
  describeLoanToken,
  fetchProjectLoans,
  loanFeeFracAt,
  loanOpeningAmounts,
  loanOutstandingFee,
  loanPrepaidDurationLabel,
  loanRepayCeiling,
  normalizeBorrowable,
  prepaidWindowSeconds,
  type LoanFeeInputs,
} from './revLoans'

// Capture the projectId each chain's loans query is issued with.
const safeRequestMock = vi.fn()
vi.mock('./bendystraw/client', () => ({
  safeRequest: (...args: unknown[]) => safeRequestMock(...args),
  getNetworkOption: () => ({}),
}))

const DAY = 86_400
const ONE_ETH = 10n ** 18n

function loan(overrides: Partial<LoanFeeInputs> = {}): LoanFeeInputs {
  return {
    borrowAmount: ONE_ETH,
    prepaidFeePercent: 25,
    prepaidDuration: prepaidWindowSeconds(25),
    createdAt: 0,
    ...overrides,
  }
}

describe('prepaidWindowSeconds', () => {
  it('is prepaidFeePercent/500 of the 3650-day liquidation span', () => {
    expect(prepaidWindowSeconds(25)).toBe(Math.floor((25 * LOAN_LIQUIDATION_SECONDS) / 500))
    expect(prepaidWindowSeconds(25)).toBe(182.5 * DAY) // 25/500 × 3650d
    expect(prepaidWindowSeconds(250)).toBe(1825 * DAY) // half the span
    expect(prepaidWindowSeconds(LOAN_MAX_PREPAID)).toBe(LOAN_LIQUIDATION_SECONDS) // fully prepaid
  })
})

describe('loanOutstandingFee', () => {
  it('is zero for the entire prepaid window, including the exact boundary', () => {
    const window = prepaidWindowSeconds(25)
    const subject = loan({ prepaidFeePercent: 25, prepaidDuration: window })
    expect(loanOutstandingFee(subject, 0)).toBe(0n)
    expect(loanOutstandingFee(subject, Math.floor(window / 2))).toBe(0n)
    expect(loanOutstandingFee(subject, window)).toBe(0n) // elapsed == prepaidDuration → still free
    // The ramp is permil-granular: the first non-zero step lands one permil into the remaining span.
    const firstStep = window + Math.ceil((LOAN_LIQUIDATION_SECONDS - window) / 1000)
    expect(loanOutstandingFee(subject, firstStep)).toBeGreaterThan(0n)
  })

  it('ramps to exactly half the un-prepaid portion at the ramp midpoint', () => {
    const window = prepaidWindowSeconds(250) // 1825 days prepaid
    const subject = loan({ prepaidFeePercent: 250, prepaidDuration: window })
    const midpoint = window + (LOAN_LIQUIDATION_SECONDS - window) / 2
    // prepaid = 25% of 1 ETH; un-prepaid remainder = 0.75 ETH; midpoint → half of it.
    // The integer ramp (permil floor) makes this exact at the true midpoint.
    expect(loanOutstandingFee(subject, midpoint)).toBe((ONE_ETH * 750n) / 1000n / 2n)
  })

  it('reaches 100% of the UN-prepaid portion at exactly 3650 days', () => {
    const window = prepaidWindowSeconds(25)
    const subject = loan({ prepaidFeePercent: 25, prepaidDuration: window })
    const prepaid = (ONE_ETH * 25n) / 1000n
    expect(loanOutstandingFee(subject, LOAN_LIQUIDATION_SECONDS)).toBe(ONE_ETH - prepaid)
  })

  it('returns null once the loan has expired (past 3650 days — no longer repayable)', () => {
    expect(loanOutstandingFee(loan(), LOAN_LIQUIDATION_SECONDS + 1)).toBeNull()
  })

  it('never charges anything extra on a fully prepaid loan', () => {
    const subject = loan({ prepaidFeePercent: LOAN_MAX_PREPAID, prepaidDuration: prepaidWindowSeconds(LOAN_MAX_PREPAID) })
    expect(loanOutstandingFee(subject, LOAN_LIQUIDATION_SECONDS)).toBe(0n)
    expect(loanOutstandingFee(subject, LOAN_LIQUIDATION_SECONDS + 1)).toBeNull()
  })

  it('accepts string borrowAmount as read from the indexer and offsets by createdAt', () => {
    const window = prepaidWindowSeconds(25)
    const createdAt = 1_700_000_000
    const subject = loan({ borrowAmount: ONE_ETH.toString(), createdAt, prepaidDuration: window })
    expect(loanOutstandingFee(subject, createdAt + window)).toBe(0n)
    expect(loanOutstandingFee(subject, createdAt + LOAN_LIQUIDATION_SECONDS)).toBe(ONE_ETH - (ONE_ETH * 25n) / 1000n)
  })
})

describe('loanOpeningAmounts', () => {
  it('splits the gross into 2.5% protocol + 1% REV + prepaid source fee', () => {
    const amounts = loanOpeningAmounts(ONE_ETH, 25, false)
    expect(amounts.protocolFee).toBe(ONE_ETH / 40n) // 2.5%
    expect(amounts.revFee).toBe((ONE_ETH * 10n) / 1000n) // 1%
    expect(amounts.sourceFee).toBe((ONE_ETH * 25n) / 1000n) // 2.5% prepaid
    expect(amounts.net).toBe(ONE_ETH - amounts.protocolFee - amounts.revFee - amounts.sourceFee)
  })

  it('waives only the protocol fee when the allowance is feeless', () => {
    const amounts = loanOpeningAmounts(ONE_ETH, 100, true)
    expect(amounts.protocolFee).toBe(0n)
    expect(amounts.revFee).toBe((ONE_ETH * 10n) / 1000n)
    expect(amounts.sourceFee).toBe((ONE_ETH * 100n) / 1000n)
    expect(amounts.net).toBe(ONE_ETH - amounts.revFee - amounts.sourceFee)
  })
})

describe('loanFeeFracAt', () => {
  it('is zero through the prepaid window and linear to (1 − p/1000) at year 10', () => {
    // p = 250 → window = 5 years; max frac = 0.75 at year 10.
    expect(loanFeeFracAt(0, 250)).toBe(0)
    expect(loanFeeFracAt(5, 250)).toBe(0)
    expect(loanFeeFracAt(7.5, 250)).toBeCloseTo(0.375, 10)
    expect(loanFeeFracAt(10, 250)).toBeCloseTo(0.75, 10)
  })

  it('stays flat at zero when fully prepaid', () => {
    expect(loanFeeFracAt(10, LOAN_MAX_PREPAID)).toBe(0)
  })
})

describe('loanPrepaidDurationLabel', () => {
  it('labels the window the prepaid percent buys', () => {
    expect(loanPrepaidDurationLabel(LOAN_MIN_PREPAID)).toBe('6 months') // 182.5 days
    expect(loanPrepaidDurationLabel(50)).toBe('1 year') // 365 days
    expect(loanPrepaidDurationLabel(250)).toBe('5 years')
    expect(loanPrepaidDurationLabel(LOAN_MAX_PREPAID)).toBe('never')
  })
})

describe('borrowMinAmountFromQuote', () => {
  it('floors the submitted minimum at 99% of the live quote', () => {
    expect(borrowMinAmountFromQuote(100n)).toBe(99n)
    expect(borrowMinAmountFromQuote(ONE_ETH)).toBe((ONE_ETH * 99n) / 100n)
    expect(borrowMinAmountFromQuote(0n)).toBe(0n)
  })

  // A dust quote of 1 raw unit rounds the 99% floor to 0 — OpenLoanModal must
  // abort rather than send minBorrowAmount: 0 (a value-bearing param at 0).
  it('rounds a 1-raw-unit quote down to a 0 minimum', () => {
    expect(borrowMinAmountFromQuote(1n)).toBe(0n)
    // 2 is the first quote that yields a non-zero floor.
    expect(borrowMinAmountFromQuote(2n)).toBeGreaterThan(0n)
  })
})

describe('loanRepayCeiling', () => {
  it('adds ~120s of ramp drift (plus 1 wei) over principal + current fee', () => {
    const window = prepaidWindowSeconds(25)
    const principal = ONE_ETH
    const fee = 12_345n
    const prepaid = (principal * 25n) / 1000n
    const ramp = LOAN_LIQUIDATION_SECONDS - window
    const expectedGuard = ((principal - prepaid) * 120n) / BigInt(ramp) + 1n
    expect(loanRepayCeiling(principal, 25, window, fee)).toBe(principal + fee + expectedGuard)
  })

  it('never divides by zero even for a fully prepaid loan', () => {
    const ceiling = loanRepayCeiling(ONE_ETH, LOAN_MAX_PREPAID, LOAN_LIQUIDATION_SECONDS, 0n)
    expect(ceiling).toBeGreaterThan(ONE_ETH)
  })
})

describe('normalizeBorrowable', () => {
  it('handles the raw on-chain tuple — borrowableAmountFrom returns TWO values', () => {
    expect(normalizeBorrowable([5n, 9n] as const)).toEqual({ borrowableNow: 5n, borrowableCapacity: 9n })
  })

  it('handles the SDK named-object shape', () => {
    expect(normalizeBorrowable({ borrowableNow: 3n, borrowableCapacity: 7n })).toEqual({
      borrowableNow: 3n,
      borrowableCapacity: 7n,
    })
  })

  it('handles a legacy single value and null', () => {
    expect(normalizeBorrowable(4n)).toEqual({ borrowableNow: 4n, borrowableCapacity: 4n })
    expect(normalizeBorrowable(null)).toBeNull()
    expect(normalizeBorrowable(undefined)).toBeNull()
  })
})

describe('describeLoanToken', () => {
  it('recognizes the native sentinel as ETH with 18 decimals', () => {
    expect(describeLoanToken(1, '0x000000000000000000000000000000000000EEEe')).toEqual({
      symbol: 'ETH',
      decimals: 18,
    })
  })

  it('returns null for unrecognized tokens so amounts render as raw units, never a wrong division', () => {
    expect(describeLoanToken(1, '0x1111111111111111111111111111111111111111')).toBeNull()
  })
})

describe('fetchProjectLoans per-chain project id', () => {
  it('queries each chain with ITS OWN project id — never the home id off-home', async () => {
    // Divergent per-chain ids: #7 on chain 1 (home), #42 on chain 8453.
    safeRequestMock.mockImplementation((_query: string, variables: { projectId: number; chainIds: number[] }) => ({
      loans: {
        items: [{ id: `${variables.chainIds[0]}-1`, chainId: variables.chainIds[0], createdAt: variables.chainIds[0] }],
        totalCount: 1,
      },
    }))

    const rows = await fetchProjectLoans([
      { chainId: 1, projectId: 7 },
      { chainId: 8453, projectId: 42 },
    ])

    const varsByChain = new Map<number, { projectId: number; chainIds: number[] }>()
    for (const call of safeRequestMock.mock.calls) {
      const vars = call[1] as { projectId: number; chainIds: number[] }
      varsByChain.set(vars.chainIds[0], vars)
    }
    expect(varsByChain.get(1)?.projectId).toBe(7)
    expect(varsByChain.get(8453)?.projectId).toBe(42)
    // The off-home chain must be filtered to just its own chain, never lumped with home.
    expect(varsByChain.get(8453)?.chainIds).toEqual([8453])
    // Both chains' loans are merged.
    expect(rows.map(row => row.chainId).sort()).toEqual([1, 8453])
  })
})
