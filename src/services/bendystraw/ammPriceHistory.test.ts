import { describe, expect, it } from 'vitest'
import { priceFromSqrtPriceX96 } from './ammPriceHistory'

describe('indexed AMM price history', () => {
  it('converts the ART pool registration and trade prices', () => {
    const initial = priceFromSqrtPriceX96(0x2af49f5c8594347614n, true, 6)
    const traded = priceFromSqrtPriceX96(800571923982999312419n, true, 6)

    expect(initial).toBeCloseTo(0.0001000274, 10)
    expect(traded).toBeCloseTo(0.0001021037, 10)
    expect(traded!).toBeGreaterThan(initial!)
  })
})
