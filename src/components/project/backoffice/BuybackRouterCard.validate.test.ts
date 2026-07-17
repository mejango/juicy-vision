import { describe, expect, it } from 'vitest'
import { validateInitPoolParams } from './BuybackRouterCard'

// A valid, fully-populated param set — each case below perturbs one field.
const OK = {
  fee: '10000',
  tickSpacing: '200',
  twapWindow: '1800',
  terminalToken: '0x0000000000000000000000000000000000000001',
  sqrtPriceX96: '79228162514264337593543950336',
}

describe('validateInitPoolParams', () => {
  it('accepts a fully-valid initializePoolFor param set', () => {
    expect(validateInitPoolParams(OK)).toBeNull()
  })

  // twapWindow: 0 disables TWAP-manipulation protection — a permanent footgun.
  it('rejects a zero TWAP window', () => {
    expect(validateInitPoolParams({ ...OK, twapWindow: '0' })).toMatch(/TWAP window must be greater than 0/)
  })

  // tickSpacing: 0 would make the pool uninitializable.
  it('rejects a zero tick spacing', () => {
    expect(validateInitPoolParams({ ...OK, tickSpacing: '0' })).toMatch(/Tick spacing must be non-zero/)
  })

  it('accepts a negative tick spacing (still non-zero)', () => {
    expect(validateInitPoolParams({ ...OK, tickSpacing: '-200' })).toBeNull()
  })

  // fee: 0 is not a real Uniswap tier.
  it('rejects a zero or out-of-range fee tier', () => {
    expect(validateInitPoolParams({ ...OK, fee: '0' })).toMatch(/Fee tier/)
    expect(validateInitPoolParams({ ...OK, fee: '1000000' })).toMatch(/Fee tier/)
  })

  it('accepts standard Uniswap fee tiers', () => {
    for (const fee of ['100', '500', '3000', '10000']) {
      expect(validateInitPoolParams({ ...OK, fee })).toBeNull()
    }
  })

  it('rejects a non-address terminal token', () => {
    expect(validateInitPoolParams({ ...OK, terminalToken: '0xnotanaddress' })).toMatch(/terminal token/)
  })

  it('rejects a zero or missing starting price', () => {
    expect(validateInitPoolParams({ ...OK, sqrtPriceX96: '0' })).toMatch(/sqrtPriceX96/)
    expect(validateInitPoolParams({ ...OK, sqrtPriceX96: '' })).toMatch(/sqrtPriceX96/)
  })

  it('rejects non-numeric fee / twap inputs', () => {
    expect(validateInitPoolParams({ ...OK, fee: 'abc' })).toMatch(/fee tier/)
    expect(validateInitPoolParams({ ...OK, twapWindow: 'x' })).toMatch(/TWAP window/)
  })
})
