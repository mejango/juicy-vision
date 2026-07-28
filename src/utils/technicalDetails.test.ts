import { describe, it, expect } from 'vitest'
import {
  isUsdcCurrency,
  getCurrencyLabel,
  USDC_CURRENCIES,
  formatSimpleValue,
} from './technicalDetails'
import { CANONICAL_USDC_BY_CHAIN } from '../../shared/chains'

describe('isUsdcCurrency', () => {
  describe('testnet USDC currency codes', () => {
    it('returns true for Sepolia USDC currency', () => {
      expect(isUsdcCurrency(USDC_CURRENCIES['11155111'])).toBe(true)
    })

    it('returns true for OP Sepolia USDC currency', () => {
      expect(isUsdcCurrency(USDC_CURRENCIES['11155420'])).toBe(true)
    })

    it('returns true for Base Sepolia USDC currency', () => {
      expect(isUsdcCurrency(USDC_CURRENCIES['84532'])).toBe(true)
    })

    it('returns true for Arb Sepolia USDC currency', () => {
      expect(isUsdcCurrency(USDC_CURRENCIES['421614'])).toBe(true)
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
    expect(getCurrencyLabel(USDC_CURRENCIES['11155111'])).toBe('USDC')
    expect(getCurrencyLabel(USDC_CURRENCIES['11155420'])).toBe('USDC')
    expect(getCurrencyLabel(USDC_CURRENCIES['84532'])).toBe('USDC')
    expect(getCurrencyLabel(USDC_CURRENCIES['421614'])).toBe('USDC')
  })

  it('labels ETH and USD base currencies', () => {
    expect(getCurrencyLabel(1)).toBe('ETH')
    expect(getCurrencyLabel(2)).toBe('USD')
  })

  it('returns null for unknown currency codes', () => {
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
      expect(isUsdBasedTier(USDC_CURRENCIES['11155111'])).toBe(true)
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

describe('formatSimpleValue', () => {
  const WEIGHT = '1000000000000000000000000' // 1M tokens (18 decimals)

  describe('weight denomination follows the ruleset baseCurrency', () => {
    it('labels tokens/USD only for base-USD rulesets', () => {
      expect(formatSimpleValue(WEIGHT, 'weight', undefined, { baseCurrency: 2 })).toBe('1.0M tokens/USD')
    })

    it('labels tokens/ETH for base-ETH rulesets', () => {
      expect(formatSimpleValue(WEIGHT, 'weight', undefined, { baseCurrency: 1 })).toBe('1.0M tokens/ETH')
    })

    it('defaults to tokens/ETH when no baseCurrency is resolvable (default launch)', () => {
      expect(formatSimpleValue(WEIGHT, 'weight')).toBe('1.0M tokens/ETH')
    })
  })

  describe('groupId labels derive from the canonical per-chain USDC table', () => {
    it('labels every real per-chain USDC group id', () => {
      for (const address of Object.values(CANONICAL_USDC_BY_CHAIN)) {
        const groupId = BigInt(address).toString()
        expect(formatSimpleValue(groupId, 'groupId')).toBe('USDC payouts')
      }
    })

    it('never labels an unknown group id — renders the raw id', () => {
      // The previously hardcoded id does not match any canonical USDC address.
      const bogus = '918640019851866092946544831648579639063834485832'
      expect(formatSimpleValue(bogus, 'groupId')).toBe(bogus)
    })
  })

  describe('large values are only labeled ETH when the field is native-denominated', () => {
    const ONE_ETH = '1000000000000000000'

    it('labels known native fields', () => {
      expect(formatSimpleValue(ONE_ETH, 'ethAmount')).toContain('ETH')
      expect(formatSimpleValue(ONE_ETH, 'value')).toContain('ETH')
      expect(formatSimpleValue(ONE_ETH, 'nativeAmount')).toContain('ETH')
    })

    it('renders raw values for currency-dependent fields (amount, payout limits)', () => {
      expect(formatSimpleValue(ONE_ETH, 'amount')).toBe(ONE_ETH)
      expect(formatSimpleValue(ONE_ETH, 'payoutLimit')).toBe(ONE_ETH)
    })

    it('keeps the uint224 max unlimited marker', () => {
      const UINT224_MAX = '26959946667150639794667015087019630673637144422540572481103610249215'
      expect(formatSimpleValue(UINT224_MAX, 'amount')).toBe(`UNLIMITED_MARKER:${UINT224_MAX}`)
    })
  })
})
