import { describe, expect, it } from 'vitest'
import {
  formatFundsAccessLimits,
  projectCycle,
  projectedWeight,
  ruleChanges,
  rulesetRows,
  rulesetSignature,
  UNLIMITED_FUND_ACCESS_FLOOR,
  type CarouselCycle,
  type CycleMetadata,
  type CycleRules,
} from './rulesetCarousel'

const ONE_ETH = 10n ** 18n

function makeRules(overrides: Partial<CycleRules> = {}): CycleRules {
  return {
    cycleNumber: 5,
    id: 1700000000,
    basedOnId: 0,
    start: 1_760_000_000,
    duration: 86400 * 7,
    weight: ONE_ETH,
    weightCutPercent: 0,
    approvalHook: '0x0000000000000000000000000000000000000000',
    ...overrides,
  }
}

function makeMetadata(overrides: Partial<CycleMetadata> = {}): CycleMetadata {
  return {
    reservedPercent: 2500,
    cashOutTaxRate: 1000,
    baseCurrency: 1,
    pausePay: false,
    pauseCreditTransfers: false,
    allowOwnerMinting: false,
    allowSetCustomToken: false,
    allowTerminalMigration: false,
    allowSetTerminals: false,
    allowSetController: false,
    allowAddAccountingContext: false,
    allowAddPriceFeed: false,
    ownerMustSendPayouts: false,
    holdFees: false,
    scopeCashOutsToLocalBalances: false,
    useDataHookForPay: false,
    useDataHookForCashOut: false,
    dataHook: '0x0000000000000000000000000000000000000000',
    ...overrides,
  }
}

function makeCycle(
  rules: Partial<CycleRules> = {},
  metadata: Partial<CycleMetadata> = {},
): CarouselCycle {
  return {
    relation: 'current',
    rules: makeRules(rules),
    metadata: makeMetadata(metadata),
    reservedSplits: [],
    fundsAccess: [],
  }
}

describe('projectedWeight', () => {
  it('keeps the weight when there is no cut', () => {
    expect(projectedWeight(ONE_ETH, 0, 3)).toBe(ONE_ETH)
  })

  it('cuts out of 1e9 per cycle boundary', () => {
    // 10% cut = 1e8 out of 1e9.
    expect(projectedWeight(ONE_ETH, 100_000_000, 1)).toBe(9n * 10n ** 17n)
    expect(projectedWeight(ONE_ETH, 100_000_000, 2)).toBe(81n * 10n ** 16n)
    // 1% cut = 1e7 out of 1e9.
    expect(projectedWeight(ONE_ETH, 10_000_000, 1)).toBe(99n * 10n ** 16n)
  })

  it('rounds to the nearest unit', () => {
    // 10 * (1e9 - 333333333)/1e9 = 6.66666667 → 7.
    expect(projectedWeight(10n, 333_333_333, 1)).toBe(7n)
  })

  it('un-decays for negative offsets', () => {
    expect(projectedWeight(9n * 10n ** 17n, 100_000_000, -1)).toBe(ONE_ETH)
    expect(projectedWeight(81n * 10n ** 16n, 100_000_000, -2)).toBe(ONE_ETH)
  })

  it('handles a full cut', () => {
    expect(projectedWeight(ONE_ETH, 1_000_000_000, 1)).toBe(0n)
    // No pre-image exists behind a 100% cut — the base weight is kept.
    expect(projectedWeight(ONE_ETH, 1_000_000_000, -1)).toBe(ONE_ETH)
  })

  it('keeps a zero weight at zero', () => {
    expect(projectedWeight(0n, 100_000_000, 4)).toBe(0n)
    expect(projectedWeight(0n, 100_000_000, -4)).toBe(0n)
  })
})

describe('projectCycle', () => {
  it('returns the same cycle for a zero offset', () => {
    const cycle = makeCycle()
    expect(projectCycle(cycle, 0)).toBe(cycle)
  })

  it('shifts start and cycle number at cycle boundaries and decays the weight', () => {
    const cycle = makeCycle({ weightCutPercent: 100_000_000 })
    const projected = projectCycle(cycle, 2)
    expect(projected.relation).toBe('projected')
    expect(projected.rules.cycleNumber).toBe(7)
    expect(projected.rules.start).toBe(cycle.rules.start + 2 * cycle.rules.duration)
    expect(projected.rules.weight).toBe(81n * 10n ** 16n)
    // Rules other than timing/weight are unchanged.
    expect(projected.rules.duration).toBe(cycle.rules.duration)
    expect(projected.metadata).toBe(cycle.metadata)
    expect(projected.reservedSplits).toBe(cycle.reservedSplits)
  })

  it('projects backward, un-decaying the weight', () => {
    const cycle = makeCycle({ weightCutPercent: 100_000_000 })
    const projected = projectCycle(cycle, -1)
    expect(projected.rules.cycleNumber).toBe(4)
    expect(projected.rules.start).toBe(cycle.rules.start - cycle.rules.duration)
    expect(projected.rules.weight).toBe((ONE_ETH * 10n ** 9n + 45n * 10n ** 7n) / (9n * 10n ** 8n))
  })

  it('floors the cycle number at 1', () => {
    const projected = projectCycle(makeCycle({ cycleNumber: 2 }), -5)
    expect(projected.rules.cycleNumber).toBe(1)
  })

  it('does not move start when the ruleset does not auto-cycle', () => {
    const projected = projectCycle(makeCycle({ duration: 0 }), 3)
    expect(projected.rules.start).toBe(makeRules().start)
  })
})

describe('rulesetSignature', () => {
  it('matches across chains when only timing differs', () => {
    const a = makeCycle()
    const b = makeCycle({ start: 1, cycleNumber: 99, weight: 123n, id: 42, basedOnId: 7 })
    expect(rulesetSignature(a)).toBe(rulesetSignature(b))
  })

  it('differs when a rule differs', () => {
    const base = makeCycle()
    expect(rulesetSignature(makeCycle({ duration: 0 }))).not.toBe(rulesetSignature(base))
    expect(rulesetSignature(makeCycle({ weightCutPercent: 1 }))).not.toBe(rulesetSignature(base))
    expect(rulesetSignature(makeCycle({}, { holdFees: true }))).not.toBe(rulesetSignature(base))
    expect(rulesetSignature(makeCycle({}, { reservedPercent: 0 }))).not.toBe(rulesetSignature(base))
    expect(rulesetSignature(makeCycle({}, { cashOutTaxRate: 0 }))).not.toBe(rulesetSignature(base))
    expect(rulesetSignature(makeCycle({}, { baseCurrency: 2 }))).not.toBe(rulesetSignature(base))
    expect(
      rulesetSignature(makeCycle({}, { dataHook: '0x1111111111111111111111111111111111111111' })),
    ).not.toBe(rulesetSignature(base))
  })

  it('compares the data hook case-insensitively', () => {
    const lower = makeCycle({}, { dataHook: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' })
    const upper = makeCycle({}, { dataHook: '0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD' })
    expect(rulesetSignature(lower)).toBe(rulesetSignature(upper))
  })
})

describe('rulesetRows', () => {
  const now = 1_750_000_000

  it('inverts the v6 scoped-cash-outs flag into the total-surplus row', () => {
    const scoped = rulesetRows(makeCycle({}, { scopeCashOutsToLocalBalances: true }), 'ETH', now)
    const total = rulesetRows(makeCycle({}, { scopeCashOutsToLocalBalances: false }), 'ETH', now)
    const label = 'Cash outs use total surplus'
    expect(scoped.find(row => row.label === label)?.value).toBe('Disabled')
    expect(total.find(row => row.label === label)?.value).toBe('Enabled')
  })

  it('formats percents and the issuance rate', () => {
    const rows = rulesetRows(makeCycle({ weightCutPercent: 10_000_000 }), 'ETH', now)
    expect(rows.find(row => row.label === 'Issuance cut percent')?.value).toBe('1.00%')
    expect(rows.find(row => row.label === 'Reserved rate')?.value).toBe('25%')
    expect(rows.find(row => row.label === 'Cash out tax rate')?.value).toBe('10%')
    expect(rows.find(row => row.label === 'Total issuance rate')?.value).toBe('1 / ETH')
  })
})

describe('ruleChanges', () => {
  it('skips start time and reports only differing rows', () => {
    const current = makeCycle()
    const upcoming = makeCycle(
      { start: current.rules.start + current.rules.duration, weightCutPercent: 20_000_000 },
      { holdFees: true },
    )
    const changes = ruleChanges(current, upcoming, 'ETH', 'ETH')
    expect(changes.map(change => change.label)).toEqual(['Issuance cut percent', 'Hold fees'])
    expect(changes[0]).toMatchObject({ section: 'TOKEN', from: '0.00%', to: '2.00%' })
    expect(changes[1]).toMatchObject({ section: 'OTHER RULES', from: 'Disabled', to: 'Enabled' })
  })

  it('reports nothing when only timing differs', () => {
    const current = makeCycle()
    const next = projectCycle(current, 1)
    expect(ruleChanges(current, next, 'ETH', 'ETH')).toEqual([])
  })
})

describe('formatFundsAccessLimits', () => {
  const context = { currency: 61166, symbol: 'ETH', decimals: 18 }

  it('renders None for an empty set', () => {
    expect(formatFundsAccessLimits([], context)).toBe('None')
  })

  it('renders the unlimited sentinel', () => {
    expect(formatFundsAccessLimits([{ amount: UNLIMITED_FUND_ACCESS_FLOOR, currency: 61166 }], context))
      .toBe('Unlimited ETH')
  })

  it('joins multiple currencies with the accounting decimals', () => {
    expect(formatFundsAccessLimits(
      [
        { amount: 15n * 10n ** 17n, currency: 61166 },
        { amount: 100n * 10n ** 18n, currency: 2 },
      ],
      context,
    )).toBe('1.5 ETH + 100 USD')
  })
})
