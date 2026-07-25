import { describe, expect, it } from 'vitest'
import {
  activeStageIndexAt,
  cutsElapsed,
  decodeStageMetadata,
  formatCountdown,
  formatCutPercent,
  formatIssuanceRate,
  formatTokenCount18,
  issuanceAtTime,
  nextCutAt,
  percentFromBasisPoints,
  sortStagesByStart,
  sumAutoIssuanceByStage,
  type StageTerms,
} from './revnetStages'

const DAY = 86_400

function stage(overrides: Partial<StageTerms>): StageTerms {
  return { start: 0, duration: 0, weight: (10n ** 18n).toString(), weightCutPercent: 0, ...overrides }
}

describe('decodeStageMetadata', () => {
  it('unpacks reservedPercent, cashOutTaxRate, and baseCurrency from the packed layout', () => {
    const packed = (2500n << 4n) | (3000n << 20n) | (61166n << 36n)
    expect(decodeStageMetadata(packed)).toEqual({
      reservedPercent: 2500,
      cashOutTaxRate: 3000,
      baseCurrency: 61166,
    })
  })

  it('accepts decimal-string input as read from indexed data', () => {
    const packed = ((500n << 4n) | (1000n << 20n) | (1n << 36n)).toString()
    expect(decodeStageMetadata(packed)).toEqual({
      reservedPercent: 500,
      cashOutTaxRate: 1000,
      baseCurrency: 1,
    })
  })

  it('decodes an all-zero metadata word', () => {
    expect(decodeStageMetadata(0n)).toEqual({ reservedPercent: 0, cashOutTaxRate: 0, baseCurrency: 0 })
  })

  it('rejects negative input', () => {
    expect(() => decodeStageMetadata(-1)).toThrow()
  })
})

describe('issuanceAtTime', () => {
  const weight = (1000n * 10n ** 18n).toString() // 1000 tokens per base unit

  it('returns the stage weight before any cut cycle has elapsed', () => {
    const stages = [stage({ start: 1000, duration: 10 * DAY, weight, weightCutPercent: 100_000_000 })]
    expect(issuanceAtTime(stages, 1000)).toBe(1000)
    expect(issuanceAtTime(stages, 1000 + 10 * DAY - 1)).toBe(1000)
  })

  it('cuts exactly at each cycle boundary', () => {
    const stages = [stage({ start: 0, duration: DAY, weight, weightCutPercent: 100_000_000 })] // 10% cut
    expect(issuanceAtTime(stages, DAY - 1)).toBe(1000)
    expect(issuanceAtTime(stages, DAY)).toBeCloseTo(900, 9)
    expect(issuanceAtTime(stages, 2 * DAY - 1)).toBeCloseTo(900, 9)
    expect(issuanceAtTime(stages, 2 * DAY)).toBeCloseTo(810, 9)
    expect(issuanceAtTime(stages, 5 * DAY)).toBeCloseTo(1000 * 0.9 ** 5, 9)
  })

  it('treats duration 0 as perpetual with no cuts', () => {
    const stages = [stage({ start: 0, duration: 0, weight, weightCutPercent: 100_000_000 })]
    expect(issuanceAtTime(stages, 1_000_000 * DAY)).toBe(1000)
  })

  it('switches to the active stage at its start and restarts that stage\'s cut clock', () => {
    const stages = [
      stage({ start: 0, duration: DAY, weight, weightCutPercent: 100_000_000 }),
      stage({ start: 100 * DAY, duration: 2 * DAY, weight: (500n * 10n ** 18n).toString(), weightCutPercent: 380_000_000 }),
    ]
    expect(issuanceAtTime(stages, 100 * DAY - 1)).toBeCloseTo(1000 * 0.9 ** 99, 6)
    expect(issuanceAtTime(stages, 100 * DAY)).toBe(500)
    expect(issuanceAtTime(stages, 102 * DAY)).toBeCloseTo(500 * 0.62, 9) // one 38% cut
  })

  it('returns zero before the first stage has started', () => {
    const stages = [stage({ start: 5000, duration: DAY, weight, weightCutPercent: 100_000_000 })]
    expect(issuanceAtTime(stages, 0)).toBe(0)
  })

  it('returns 0 for an empty schedule and for a zero weight', () => {
    expect(issuanceAtTime([], 123)).toBe(0)
    expect(issuanceAtTime([stage({ weight: '0' })], 123)).toBe(0)
  })
})

describe('stage helpers', () => {
  it('sortStagesByStart orders ascending without mutating input', () => {
    const input = [{ start: 30 }, { start: 10 }, { start: 20 }]
    const sorted = sortStagesByStart(input)
    expect(sorted.map(s => s.start)).toEqual([10, 20, 30])
    expect(input.map(s => s.start)).toEqual([30, 10, 20])
  })

  it('activeStageIndexAt picks the last started stage', () => {
    const sorted = [{ start: 0 }, { start: 100 }, { start: 200 }]
    expect(activeStageIndexAt(sorted, 99)).toBe(0)
    expect(activeStageIndexAt(sorted, 100)).toBe(1)
    expect(activeStageIndexAt(sorted, 500)).toBe(2)
  })

  it('cutsElapsed floors at cycle boundaries and clamps below stage start', () => {
    const s = { start: 100, duration: 50 }
    expect(cutsElapsed(s, 99)).toBe(0)
    expect(cutsElapsed(s, 149)).toBe(0)
    expect(cutsElapsed(s, 150)).toBe(1)
    expect(cutsElapsed(s, 251)).toBe(3)
    expect(cutsElapsed({ start: 100, duration: 0 }, 10_000)).toBe(0)
  })

  it('nextCutAt returns the upcoming boundary, or null when the stage never cuts', () => {
    const s = stage({ start: 100, duration: 50, weightCutPercent: 100_000_000 })
    expect(nextCutAt(s, 100)).toBe(150)
    expect(nextCutAt(s, 149)).toBe(150)
    expect(nextCutAt(s, 150)).toBe(200)
    expect(nextCutAt(stage({ start: 100, duration: 0, weightCutPercent: 100_000_000 }), 120)).toBeNull()
    expect(nextCutAt(stage({ start: 100, duration: 50, weightCutPercent: 0 }), 120)).toBeNull()
  })
})

describe('formatting', () => {
  it('formatIssuanceRate matches the website tiers', () => {
    expect(formatIssuanceRate(Number.NaN)).toBe('—')
    expect(formatIssuanceRate(0)).toBe('0')
    expect(formatIssuanceRate(1234.5)).toBe('1,235')
    expect(formatIssuanceRate(2.5)).toBe('2.50')
    expect(formatIssuanceRate(0.0012345)).toBe('0.00123')
  })

  it('formatCutPercent trims trailing zeros', () => {
    expect(formatCutPercent(380_000_000)).toBe('38%')
    expect(formatCutPercent(75_000_000)).toBe('7.5%')
    expect(formatCutPercent(0)).toBe('0%')
    expect(formatCutPercent(12_340_000)).toBe('1.23%')
    expect(formatCutPercent(9_496)).toBe('0.0009496%')
  })

  it('percentFromBasisPoints renders out-of-10000 values', () => {
    expect(percentFromBasisPoints(0)).toBe('0%')
    expect(percentFromBasisPoints(500)).toBe('5%')
    expect(percentFromBasisPoints(2550)).toBe('25.50%')
    expect(percentFromBasisPoints(null)).toBe('—')
    expect(percentFromBasisPoints(undefined)).toBe('—')
  })

  it('formatCountdown steps through day/hour/minute units', () => {
    expect(formatCountdown(2 * DAY + 3 * 3600)).toBe('2d 3h')
    expect(formatCountdown(2 * DAY)).toBe('2d')
    expect(formatCountdown(3 * 3600 + 120)).toBe('3h 2m')
    expect(formatCountdown(120)).toBe('2m')
    expect(formatCountdown(59)).toBe('<1m')
    expect(formatCountdown(0)).toBe('now')
  })

  it('formatTokenCount18 renders 1e18 counts compactly', () => {
    expect(formatTokenCount18(0n)).toBe('0')
    expect(formatTokenCount18(1_500_000n * 10n ** 18n)).toBe('1,500,000')
    expect(formatTokenCount18(5n * 10n ** 17n)).toBe('0.500')
  })
})

describe('sumAutoIssuanceByStage', () => {
  const stageIdsByChain = {
    1: ['11', '12', '13'],
    8453: ['81', '82', '83'],
  }

  it('sums across chains and beneficiaries into stage indexes', () => {
    const totals = sumAutoIssuanceByStage([
      { chainId: 1, stageId: '11', beneficiary: '0xaa', count: 100n },
      { chainId: 1, stageId: '11', beneficiary: '0xbb', count: 50n },
      { chainId: 8453, stageId: '81', beneficiary: '0xaa', count: 25n },
      { chainId: 8453, stageId: '83', beneficiary: '0xcc', count: 7n },
    ], stageIdsByChain)
    expect(totals).toEqual({ 0: 175n, 2: 7n })
  })

  it('dedupes re-indexed copies of the same allocation', () => {
    const row = { chainId: 1, stageId: '12', beneficiary: '0xAA', count: 100n }
    const totals = sumAutoIssuanceByStage(
      [row, { ...row, beneficiary: '0xaa' }],
      stageIdsByChain,
    )
    expect(totals).toEqual({ 1: 100n })
  })

  it('drops rows from superseded rulesets and zero counts', () => {
    const totals = sumAutoIssuanceByStage([
      { chainId: 1, stageId: '99', beneficiary: '0xaa', count: 100n }, // unknown stage id
      { chainId: 10, stageId: '11', beneficiary: '0xaa', count: 100n }, // unknown chain
      { chainId: 1, stageId: '11', beneficiary: '0xaa', count: 0n },
    ], stageIdsByChain)
    expect(totals).toEqual({})
  })
})
