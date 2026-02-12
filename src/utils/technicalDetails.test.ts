import { describe, it, expect } from 'vitest'
import {
  isUsdcCurrency,
  getCurrencyLabel,
  USDC_CURRENCIES,
  CHAIN_NAMES,
} from './technicalDetails'

describe('isUsdcCurrency', () => {
  describe('testnet USDC currency codes', () => {
    it('returns true for Sepolia USDC currency (909516616)', () => {
      expect(isUsdcCurrency(909516616)).toBe(true)
    })

    it('returns true for OP Sepolia USDC currency (3530704773)', () => {
      expect(isUsdcCurrency(3530704773)).toBe(true)
    })

    it('returns true for Base Sepolia USDC currency (3169378579)', () => {
      expect(isUsdcCurrency(3169378579)).toBe(true)
    })

    it('returns true for Arb Sepolia USDC currency (1156540465)', () => {
      expect(isUsdcCurrency(1156540465)).toBe(true)
    })
  })

  describe('mainnet USDC currency codes', () => {
    it('returns true for Ethereum mainnet USDC currency', () => {
      expect(isUsdcCurrency(USDC_CURRENCIES['1'])).toBe(true)
    })

    it('returns true for Optimism USDC currency', () => {
      expect(isUsdcCurrency(USDC_CURRENCIES['10'])).toBe(true)
    })

    it('returns true for Base USDC currency', () => {
      expect(isUsdcCurrency(USDC_CURRENCIES['8453'])).toBe(true)
    })

    it('returns true for Arbitrum USDC currency', () => {
      expect(isUsdcCurrency(USDC_CURRENCIES['42161'])).toBe(true)
    })
  })

  describe('non-USDC currencies', () => {
    it('returns false for ETH currency code (1)', () => {
      expect(isUsdcCurrency(1)).toBe(false)
    })

    it('returns false for base USD currency (2)', () => {
      expect(isUsdcCurrency(2)).toBe(false)
    })

    it('returns false for random number', () => {
      expect(isUsdcCurrency(12345)).toBe(false)
    })

    it('returns false for zero', () => {
      expect(isUsdcCurrency(0)).toBe(false)
    })

    it('returns false for ETH internal currency code (61166)', () => {
      expect(isUsdcCurrency(61166)).toBe(false)
    })
  })
})

describe('getCurrencyLabel', () => {
  it('returns "ETH" for ETH currency code (61166)', () => {
    expect(getCurrencyLabel(61166)).toBe('ETH')
  })

  it('returns "USDC" for USDC currency codes', () => {
    expect(getCurrencyLabel(909516616)).toBe('USDC')
    expect(getCurrencyLabel(3530704773)).toBe('USDC')
    expect(getCurrencyLabel(3169378579)).toBe('USDC')
    expect(getCurrencyLabel(1156540465)).toBe('USDC')
  })

  it('returns null for unknown currency codes', () => {
    expect(getCurrencyLabel(1)).toBeNull()
    expect(getCurrencyLabel(2)).toBeNull()
    expect(getCurrencyLabel(999)).toBeNull()
  })
})

describe('USDC_CURRENCIES mapping', () => {
  it('has entries for all supported testnets', () => {
    expect(USDC_CURRENCIES['11155111']).toBeDefined() // Sepolia
    expect(USDC_CURRENCIES['11155420']).toBeDefined() // OP Sepolia
    expect(USDC_CURRENCIES['84532']).toBeDefined() // Base Sepolia
    expect(USDC_CURRENCIES['421614']).toBeDefined() // Arb Sepolia
  })

  it('has entries for all supported mainnets', () => {
    expect(USDC_CURRENCIES['1']).toBeDefined() // Ethereum
    expect(USDC_CURRENCIES['10']).toBeDefined() // Optimism
    expect(USDC_CURRENCIES['8453']).toBeDefined() // Base
    expect(USDC_CURRENCIES['42161']).toBeDefined() // Arbitrum
  })
})

describe('tier price display helpers', () => {
  // These tests verify the logic used in NFTTierCard and other components
  // to determine whether to show USD or ETH as the primary price

  const isUsdBasedTier = (currency: number): boolean => {
    return currency === 2 || isUsdcCurrency(currency)
  }

  describe('isUsdBasedTier logic', () => {
    it('returns true for base USD currency (2)', () => {
      expect(isUsdBasedTier(2)).toBe(true)
    })

    it('returns true for Sepolia USDC currency', () => {
      expect(isUsdBasedTier(909516616)).toBe(true)
    })

    it('returns true for all chain-specific USDC currencies', () => {
      expect(isUsdBasedTier(USDC_CURRENCIES['11155111'])).toBe(true) // Sepolia
      expect(isUsdBasedTier(USDC_CURRENCIES['11155420'])).toBe(true) // OP Sepolia
      expect(isUsdBasedTier(USDC_CURRENCIES['84532'])).toBe(true) // Base Sepolia
      expect(isUsdBasedTier(USDC_CURRENCIES['421614'])).toBe(true) // Arb Sepolia
      expect(isUsdBasedTier(USDC_CURRENCIES['1'])).toBe(true) // Ethereum
      expect(isUsdBasedTier(USDC_CURRENCIES['10'])).toBe(true) // Optimism
      expect(isUsdBasedTier(USDC_CURRENCIES['8453'])).toBe(true) // Base
      expect(isUsdBasedTier(USDC_CURRENCIES['42161'])).toBe(true) // Arbitrum
    })

    it('returns false for ETH currency (1)', () => {
      expect(isUsdBasedTier(1)).toBe(false)
    })

    it('returns false for unknown currencies', () => {
      expect(isUsdBasedTier(0)).toBe(false)
      expect(isUsdBasedTier(999)).toBe(false)
    })
  })

  describe('USD price calculation', () => {
    // USDC has 6 decimals, so 5000000 = $5.00
    const calculateUsdPrice = (priceRaw: bigint): number => {
      return Number(priceRaw) / Math.pow(10, 6)
    }

    it('converts USDC raw value to dollars correctly', () => {
      expect(calculateUsdPrice(5000000n)).toBe(5)
      expect(calculateUsdPrice(1000000n)).toBe(1)
      expect(calculateUsdPrice(10000000n)).toBe(10)
      expect(calculateUsdPrice(500000n)).toBe(0.5)
      expect(calculateUsdPrice(100000000n)).toBe(100)
    })

    it('handles small amounts', () => {
      expect(calculateUsdPrice(1000n)).toBe(0.001)
      expect(calculateUsdPrice(100n)).toBe(0.0001)
      expect(calculateUsdPrice(1n)).toBe(0.000001)
    })

    it('handles zero', () => {
      expect(calculateUsdPrice(0n)).toBe(0)
    })
  })
})
