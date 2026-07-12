import { describe, expect, it } from 'vitest'
import { assertSafeErc20TokenMetadata, requireNonzeroBytes32 } from './erc20Safety'

describe('ERC-20 deployment safety', () => {
  it('accepts ordinary token metadata and a nonzero salt', () => {
    expect(() => assertSafeErc20TokenMetadata('Juice Token', 'JUICE')).not.toThrow()
    expect(requireNonzeroBytes32(`0x${'0'.repeat(63)}1`, 'Salt')).toMatch(/^0x/)
  })

  it.each([
    ['', 'JUICE'],
    [' Juice Token', 'JUICE'],
    ['Juice Token', 'J'],
    ['Juice Token', 'JUICE!'],
  ])('blocks ambiguous or invalid metadata', (name, symbol) => {
    expect(() => assertSafeErc20TokenMetadata(name, symbol)).toThrow()
  })

  it('blocks a zero salt', () => {
    expect(() => requireNonzeroBytes32(`0x${'0'.repeat(64)}`, 'Salt')).toThrow('non-zero')
  })
})
