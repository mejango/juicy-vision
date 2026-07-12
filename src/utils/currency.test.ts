import { describe, it, expect } from 'vitest'
import {
  resolveAccountingToken,
  resolveBaseCurrency,
  toTokenFloat,
  formatBalanceUsd,
  formatBalanceNative,
  formatAxisValue,
} from './currency'

describe('currency util', () => {
  it('resolves ETH vs USDC by currency code', () => {
    expect(resolveAccountingToken(1)).toEqual({ symbol: 'ETH', decimals: 18, isUsd: false })
    expect(resolveAccountingToken(2)).toEqual({ symbol: 'USDC', decimals: 6, isUsd: true })
    // explicit decimals override
    expect(resolveAccountingToken(2, 6).decimals).toBe(6)
    expect(resolveAccountingToken(undefined).symbol).toBe('ETH')
  })

  it('never treats an unknown token-derived currency as ETH', () => {
    expect(resolveAccountingToken(61167, 6)).toEqual({
      symbol: 'TOKEN',
      decimals: 6,
      isUsd: false,
    })
    expect(formatBalanceUsd('1000000', 2000, 61167, 6)).toBe('$--')
    expect(formatBalanceNative('1000000', 61167, 6)).toBe('1 TOKEN')
  })

  it('labels ruleset base currencies independently from accounting tokens', () => {
    expect(resolveBaseCurrency(1)).toBe('ETH')
    expect(resolveBaseCurrency(2)).toBe('USD')
    expect(resolveBaseCurrency(61167)).toBe('currency 61167')
  })

  it('parses raw amounts at the correct decimals (USDC=6, not 18)', () => {
    // 856.48 USDC = 856_480_000 at 6 decimals
    expect(toTokenFloat('856480000', 6)).toBeCloseTo(856.48, 2)
    // 1.5 ETH at 18 decimals
    expect(toTokenFloat('1500000000000000000', 18)).toBeCloseTo(1.5, 6)
    // the old bug: 856 USDC divided by 1e18 would read as ~8.5e-10 — guard against it
    expect(toTokenFloat('856480000', 18)).toBeLessThan(0.001)
  })

  it('formats USD: converts ETH via price, passes USDC through', () => {
    expect(formatBalanceUsd('1000000000000000000', 2000, 1, 18)).toBe('$2.00K')
    expect(formatBalanceUsd('856480000', null, 2, 6)).toBe('$856.48')
    expect(formatBalanceUsd('1000000000000000000', null, 1, 18)).toBe('$--') // no price for ETH
  })

  it('formats native: ETH shows ETH, USDC shows dollars', () => {
    expect(formatBalanceNative('1500000000000000000', 1, 18)).toBe('1.5 ETH')
    expect(formatBalanceNative('856480000', 2, 6)).toBe('$856.48')
  })

  it('axis labels carry the right unit', () => {
    expect(formatAxisValue(1500, resolveAccountingToken(1))).toBe('1.5K ETH')
    expect(formatAxisValue(856.48, resolveAccountingToken(2))).toBe('$856.48')
  })
})
