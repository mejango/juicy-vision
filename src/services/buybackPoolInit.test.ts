import { describe, expect, it } from 'vitest'
import { derivePoolInitState } from './permissionsAdmin'

describe('derivePoolInitState', () => {
  it('reports no hook when the registry has none', () => {
    expect(derivePoolInitState(false, [])).toBe('no hook set')
    // A hook-less project is "no hook set" regardless of probe noise.
    expect(derivePoolInitState(false, [{ label: 'native', twapWindow: 1800 }])).toBe('no hook set')
  })

  it('reports "not initialized" when every probe has a zero TWAP window', () => {
    expect(derivePoolInitState(true, [{ label: 'native', twapWindow: 0 }])).toBe('not initialized')
    expect(
      derivePoolInitState(true, [
        { label: 'native', twapWindow: 0 },
        { label: 'USDC', twapWindow: 0 },
      ]),
    ).toBe('not initialized')
  })

  it('names each initialized pair with its TWAP window', () => {
    expect(derivePoolInitState(true, [{ label: 'native', twapWindow: 1800 }])).toBe('native pool (TWAP 1800s)')
  })

  it('joins multiple initialized pairs and drops uninitialized ones', () => {
    expect(
      derivePoolInitState(true, [
        { label: 'native', twapWindow: 0 },
        { label: 'USDC', twapWindow: 600 },
      ]),
    ).toBe('USDC pool (TWAP 600s)')
    expect(
      derivePoolInitState(true, [
        { label: 'native', twapWindow: 1800 },
        { label: 'USDC', twapWindow: 600 },
      ]),
    ).toBe('native pool (TWAP 1800s), USDC pool (TWAP 600s)')
  })
})
