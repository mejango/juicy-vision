import { describe, expect, it } from 'vitest'
import { calculatePayerTokenCount, deriveCycledWeight, issuancePriceFromWeight } from './rulesetMath'

describe('ruleset math', () => {
  it('matches per-cycle Solidity floor rounding', () => {
    expect(deriveCycledWeight('101', 100_000_000, 2)).toBe(81n)
  })

  it('handles a complete issuance cut', () => {
    expect(deriveCycledWeight(10n ** 18n, 1_000_000_000, 1)).toBe(0n)
  })

  it('converts an 18-decimal issuance weight to its reciprocal price', () => {
    expect(issuancePriceFromWeight(2_000n * 10n ** 18n)).toBe(0.0005)
  })

  it('rejects configurations the contract cannot derive in one read', () => {
    expect(() => deriveCycledWeight('1', 1, 20_001)).toThrow('invalid')
  })

  it('matches terminal issuance and controller reserved-share floor rounding', () => {
    expect(calculatePayerTokenCount(
      2_000_000n,
      6,
      1_000n * 10n ** 18n,
      2_500,
    )).toBe(1_500n * 10n ** 18n)
  })

  it('rejects an out-of-range reserved rate', () => {
    expect(() => calculatePayerTokenCount(1n, 18, 1n, 10_001)).toThrow('invalid')
  })
})
