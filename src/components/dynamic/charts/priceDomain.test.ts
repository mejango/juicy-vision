import { describe, it, expect } from 'vitest'
import { issuancePriceDomain } from './priceDomain'

describe('issuancePriceDomain', () => {
  it('anchors the domain to the max issuance value with 5% headroom', () => {
    expect(issuancePriceDomain([0.5, 2, 1.25])).toEqual([0, 2 * 1.05])
  })

  it('returns auto when there are no values', () => {
    expect(issuancePriceDomain([])).toEqual(['auto', 'auto'])
  })

  it('returns auto when no value is positive and finite', () => {
    expect(issuancePriceDomain([0, -1, NaN, Infinity, -Infinity, undefined, null]))
      .toEqual(['auto', 'auto'])
  })

  it('ignores non-finite and non-positive values when computing the max', () => {
    expect(issuancePriceDomain([NaN, Infinity, -100, undefined, null, 2, 0.1]))
      .toEqual([0, 2 * 1.05])
  })
})
