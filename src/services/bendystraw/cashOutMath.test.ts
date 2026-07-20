import { describe, expect, it } from 'vitest'
import { calculateCashOutValue, calculateFloorPrice, calculateFloorMinPrice } from './client'

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

// Real project state (Base Sepolia #11 "BEN", 2026-07-13): backing pinned at the 0.0001 ETH/BEN
// issuance rate, 40% cash out tax.
const BAL = 1013906664594272n // ~0.0010139 ETH
const SUP = 10138952920494645629n // ~10.139 BEN
const TAX = 4000 // 40% in bps

describe('cash-out floor minimum (Base Sepolia #11)', () => {
  it('quotes the marginal 1-token cash out on the bonding curve', () => {
    const v = calculateFloorPrice(BAL, SUP, TAX, 18)
    expect(v).toBeGreaterThan(0.0000639)
    expect(v).toBeLessThan(0.0000645) // matches the observed 0.000064 ETH/BEN
  })

  it('minimum is (1 − tax) × balance ÷ supply, always below the live quote', () => {
    const min = calculateFloorMinPrice(BAL, SUP, TAX, 18)
    expect(min).toBeCloseTo(0.00006, 7) // (1 − 0.40) × 0.0001
    expect(min).toBeLessThan(calculateFloorPrice(BAL, SUP, TAX, 18))
  })

  it('live quote converges to the minimum as supply grows', () => {
    const small = calculateFloorPrice(BAL, SUP, TAX, 18) - calculateFloorMinPrice(BAL, SUP, TAX, 18)
    const bigger = calculateFloorPrice(BAL * 100n, SUP * 100n, TAX, 18)
      - calculateFloorMinPrice(BAL * 100n, SUP * 100n, TAX, 18)
    expect(bigger).toBeGreaterThan(0)
    expect(bigger).toBeLessThan(small / 50)
  })

  it('zero tax: quote equals the minimum (pure pro-rata)', () => {
    expect(calculateFloorPrice(BAL, SUP, 0, 18)).toBeCloseTo(calculateFloorMinPrice(BAL, SUP, 0, 18), 12)
  })

  it('fails closed at the 10000 disabled sentinel and on empty inputs', () => {
    expect(calculateFloorMinPrice(BAL, SUP, 10_000, 18)).toBe(0)
    expect(calculateFloorMinPrice(0n, SUP, TAX, 18)).toBe(0)
    expect(calculateFloorMinPrice(BAL, 0n, TAX, 18)).toBe(0)
  })
})
