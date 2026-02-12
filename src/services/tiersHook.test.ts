import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  encodeAdjustTiers,
  buildAdjustTiersTransaction,
  buildOmnichainAdjustTiersTransactions,
  type JB721TierConfigInput,
  type TiersChainConfigOverride,
} from './tiersHook'

// Mock console.log to avoid noisy test output
vi.spyOn(console, 'log').mockImplementation(() => {})

// Sample tier configurations
const unlimitedTier: JB721TierConfigInput = {
  price: '5000000', // $5 USDC (6 decimals)
  initialSupply: 4294967295, // Max uint32 = "unlimited"
  votingUnits: 0,
  reserveFrequency: 0,
  reserveBeneficiary: '0x0000000000000000000000000000000000000000',
  encodedIPFSUri: '0x0000000000000000000000000000000000000000000000000000000000000000',
  category: 1,
  discountPercent: 0,
  allowOwnerMint: false,
  useReserveBeneficiaryAsDefault: false,
  transfersPausable: false,
  useVotingUnits: false,
  cannotBeRemoved: false,
  cannotIncreaseDiscountPercent: false,
}

const limitedTier: JB721TierConfigInput = {
  price: '25000000', // $25 USDC
  initialSupply: 50, // Limited to 50
  votingUnits: 0,
  reserveFrequency: 0,
  reserveBeneficiary: '0x0000000000000000000000000000000000000000',
  encodedIPFSUri: '0x0000000000000000000000000000000000000000000000000000000000000000',
  category: 1,
  discountPercent: 0,
  allowOwnerMint: false,
  useReserveBeneficiaryAsDefault: false,
  transfersPausable: false,
  useVotingUnits: false,
  cannotBeRemoved: false,
  cannotIncreaseDiscountPercent: false,
}

describe('tiersHook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('encodeAdjustTiers', () => {
    it('encodes calldata for adding tiers', () => {
      const calldata = encodeAdjustTiers({
        tiersToAdd: [unlimitedTier],
        tierIdsToRemove: [],
      })

      expect(calldata).toMatch(/^0x/)
      expect(calldata.length).toBeGreaterThan(10)
    })

    it('encodes calldata for removing tiers', () => {
      const calldata = encodeAdjustTiers({
        tiersToAdd: [],
        tierIdsToRemove: [1, 2, 3],
      })

      expect(calldata).toMatch(/^0x/)
    })

    it('encodes calldata for both adding and removing tiers', () => {
      const calldata = encodeAdjustTiers({
        tiersToAdd: [unlimitedTier, limitedTier],
        tierIdsToRemove: [5],
      })

      expect(calldata).toMatch(/^0x/)
    })
  })

  describe('buildAdjustTiersTransaction', () => {
    it('builds transaction with correct structure', () => {
      const tx = buildAdjustTiersTransaction({
        chainId: 1,
        hookAddress: '0x1234567890123456789012345678901234567890',
        tiersToAdd: [unlimitedTier],
        tierIdsToRemove: [],
      })

      expect(tx.chainId).toBe(1)
      expect(tx.to).toBe('0x1234567890123456789012345678901234567890')
      expect(tx.data).toMatch(/^0x/)
      expect(tx.value).toBe('0x0')
    })
  })

  describe('buildOmnichainAdjustTiersTransactions', () => {
    const hookAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`

    it('builds transactions for multiple chains with same tiers by default', () => {
      const transactions = buildOmnichainAdjustTiersTransactions({
        chainIds: [1, 10, 8453],
        hookAddress,
        tiersToAdd: [unlimitedTier, limitedTier],
        tierIdsToRemove: [],
      })

      expect(transactions).toHaveLength(3)
      expect(transactions[0].chainId).toBe(1)
      expect(transactions[1].chainId).toBe(10)
      expect(transactions[2].chainId).toBe(8453)

      // All chains get the same tiers by default
      expect(transactions[0].data).toBe(transactions[1].data)
      expect(transactions[1].data).toBe(transactions[2].data)
    })

    it('applies per-chain tier overrides for limited supply single-chain deployment', () => {
      // For limited supply tiers, add:
      // - Unlimited tiers on ALL chains
      // - Limited tiers ONLY on the primary chain
      const chainConfigs: TiersChainConfigOverride[] = [
        {
          chainId: 1, // Primary chain - gets ALL tiers
          tiersToAdd: [unlimitedTier, limitedTier],
        },
        {
          chainId: 10, // Secondary chain - gets ONLY unlimited
          tiersToAdd: [unlimitedTier],
        },
        {
          chainId: 8453, // Secondary chain - gets ONLY unlimited
          tiersToAdd: [unlimitedTier],
        },
      ]

      const transactions = buildOmnichainAdjustTiersTransactions({
        chainIds: [1, 10, 8453],
        hookAddress,
        tiersToAdd: [unlimitedTier, limitedTier], // Default (not used when override exists)
        tierIdsToRemove: [],
        chainConfigs,
      })

      expect(transactions).toHaveLength(3)

      // Ethereum (primary) has different calldata than others (2 tiers vs 1)
      expect(transactions[0].data).not.toBe(transactions[1].data)

      // Optimism and Base have same calldata (both have 1 tier)
      expect(transactions[1].data).toBe(transactions[2].data)

      // Primary chain calldata should be longer (more tiers)
      expect(transactions[0].data.length).toBeGreaterThan(transactions[1].data.length)
    })

    it('uses default tiers when no chainConfig override is provided', () => {
      // Only override Ethereum, let others use defaults
      const chainConfigs: TiersChainConfigOverride[] = [
        {
          chainId: 1,
          tiersToAdd: [unlimitedTier, limitedTier], // Both tiers
        },
      ]

      const transactions = buildOmnichainAdjustTiersTransactions({
        chainIds: [1, 10],
        hookAddress,
        tiersToAdd: [unlimitedTier], // Default: just unlimited
        tierIdsToRemove: [],
        chainConfigs,
      })

      expect(transactions).toHaveLength(2)

      // Ethereum (override) has 2 tiers
      // Optimism (default) has 1 tier
      expect(transactions[0].data.length).toBeGreaterThan(transactions[1].data.length)
    })

    it('handles empty tiers array in per-chain override', () => {
      const chainConfigs: TiersChainConfigOverride[] = [
        {
          chainId: 10, // No tiers for Optimism
          tiersToAdd: [],
        },
      ]

      const transactions = buildOmnichainAdjustTiersTransactions({
        chainIds: [1, 10],
        hookAddress,
        tiersToAdd: [unlimitedTier, limitedTier],
        tierIdsToRemove: [],
        chainConfigs,
      })

      expect(transactions).toHaveLength(2)

      // Optimism should have shorter calldata (no tiers)
      expect(transactions[1].data.length).toBeLessThan(transactions[0].data.length)
    })

    it('preserves tier removal across all chains', () => {
      const chainConfigs: TiersChainConfigOverride[] = [
        {
          chainId: 1,
          tiersToAdd: [limitedTier], // Only add limited on primary
        },
        {
          chainId: 10,
          tiersToAdd: [], // No new tiers on secondary
        },
      ]

      const transactions = buildOmnichainAdjustTiersTransactions({
        chainIds: [1, 10],
        hookAddress,
        tiersToAdd: [unlimitedTier], // Default (overridden)
        tierIdsToRemove: [5, 6], // Remove same tiers on all chains
        chainConfigs,
      })

      expect(transactions).toHaveLength(2)

      // Both transactions should include tier removal
      // (even though they have different tiersToAdd)
      expect(transactions[0].data).not.toBe(transactions[1].data)
    })

    it('handles single chain deployment correctly', () => {
      const transactions = buildOmnichainAdjustTiersTransactions({
        chainIds: [1],
        hookAddress,
        tiersToAdd: [unlimitedTier, limitedTier],
        tierIdsToRemove: [],
      })

      expect(transactions).toHaveLength(1)
      expect(transactions[0].chainId).toBe(1)
    })
  })
})
