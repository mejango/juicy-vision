import { describe, expect, it } from 'vitest'
import { calculateCashOutValue, calculateFloorPrice } from './client'

describe('cash-out display math', () => {
  const surplus = 1_000_000n
  const supply = 1_000n * 10n ** 18n

  it('matches the linear contract case', () => {
    expect(calculateCashOutValue(surplus, supply, 100n * 10n ** 18n, 0)).toBe(100_000n)
  })

  it('matches the curved contract case and its integer rounding', () => {
    expect(calculateCashOutValue(surplus, supply, 100n * 10n ** 18n, 1_000)).toBe(91_000n)
  })

  it('returns all surplus for a full-supply cash out below the sentinel', () => {
    expect(calculateCashOutValue(surplus, supply, supply, 9_999)).toBe(surplus)
  })

  it('returns zero at the 10000 disabled sentinel, even for the full supply', () => {
    expect(calculateCashOutValue(surplus, supply, supply, 10_000)).toBe(0n)
    expect(calculateFloorPrice(surplus, supply, 10_000, 6)).toBe(0)
  })

  it('fails closed for invalid rates and empty inputs', () => {
    expect(calculateCashOutValue(surplus, supply, 1n, -1)).toBe(0n)
    expect(calculateCashOutValue(surplus, supply, 1n, 10_001)).toBe(0n)
    expect(calculateCashOutValue(surplus, 0n, 1n, 0)).toBe(0n)
  })
})
