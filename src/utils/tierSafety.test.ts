import { describe, expect, it } from 'vitest'
import type { JB721TierConfigInput } from '../services/tiersHook'
import type { NFTTier } from '../services/nft/types'
import { assertSafeNftPaymentSelection, assertSafeTierAdjustments } from './tierSafety'

const tier: JB721TierConfigInput = {
  price: '1000000',
  initialSupply: 100,
  votingUnits: 0,
  reserveFrequency: 0,
  reserveBeneficiary: '0x0000000000000000000000000000000000000000',
  encodedIPFSUri: `0x${'0'.repeat(63)}1`,
  category: 0,
  discountPercent: 0,
  allowOwnerMint: false,
  useReserveBeneficiaryAsDefault: false,
  transfersPausable: false,
  useVotingUnits: false,
  cannotBeRemoved: false,
  cannotIncreaseDiscountPercent: false,
}

describe('tier adjustment safety', () => {
  it('accepts an explicit ordinary tier', () => {
    expect(() => assertSafeTierAdjustments([tier], [])).not.toThrow()
  })

  it('blocks no-op updates', () => {
    expect(() => assertSafeTierAdjustments([], [])).toThrow('add or remove')
  })

  it('blocks collection-wide reserve beneficiary changes', () => {
    expect(() => assertSafeTierAdjustments([{
      ...tier,
      reserveFrequency: 5,
      reserveBeneficiary: '0x1234567890123456789012345678901234567890',
      useReserveBeneficiaryAsDefault: true,
    }], [])).toThrow('collection-wide reserve beneficiary')
  })

  it('blocks advanced per-tier payment routing', () => {
    expect(() => assertSafeTierAdjustments([{
      ...tier,
      splitPercent: 500_000_000,
      splits: [{
        percent: 1_000_000_000,
        projectId: 0,
        beneficiary: '0x1234567890123456789012345678901234567890',
        preferAddToBalance: false,
        lockedUntil: 0,
        hook: '0x0000000000000000000000000000000000000000',
      }],
    }], [])).toThrow('advanced payment routing')
  })

  it('blocks duplicate removal IDs', () => {
    expect(() => assertSafeTierAdjustments([], [1, 1n])).toThrow('Duplicate tier ID')
  })
})

const purchasableTier: NFTTier = {
  tierId: 1,
  name: 'Membership',
  price: 10_000_000n,
  currency: 2,
  pricingDecimals: 6,
  initialSupply: 10,
  remainingSupply: 2,
  reservedRate: 0,
  votingUnits: 0n,
  category: 0,
  allowOwnerMint: false,
  transfersPausable: false,
  discountPercent: 0,
}

describe('NFT payment safety', () => {
  it('verifies multiple quantities against the fresh total', () => {
    expect(assertSafeNftPaymentSelection({
      tiers: [purchasableTier],
      tierIds: [1, 1],
      paymentToken: 'USDC',
      paymentAmount: 20_000_000n,
      paymentDecimals: 6,
    })).toMatchObject({
      totalTierPrice: 20_000_000n,
      minimumPaymentAmount: 20_000_000n,
      items: [{ tierId: 1, quantity: 2 }],
    })
  })

  it('blocks sold-out and limited-supply selections', () => {
    expect(() => assertSafeNftPaymentSelection({
      tiers: [{ ...purchasableTier, remainingSupply: 0 }],
      tierIds: [1],
      paymentToken: 'USDC',
      paymentAmount: 10_000_000n,
      paymentDecimals: 6,
    })).toThrow('enough supply')
    expect(() => assertSafeNftPaymentSelection({
      tiers: [purchasableTier],
      tierIds: [1, 1, 1],
      paymentToken: 'USDC',
      paymentAmount: 30_000_000n,
      paymentDecimals: 6,
    })).toThrow('enough supply')
  })

  it('blocks insufficient payment amounts and mismatched tokens', () => {
    expect(() => assertSafeNftPaymentSelection({
      tiers: [purchasableTier],
      tierIds: [1],
      paymentToken: 'USDC',
      paymentAmount: 9_999_999n,
      paymentDecimals: 6,
    })).toThrow('below the selected NFT total')
    expect(() => assertSafeNftPaymentSelection({
      tiers: [purchasableTier],
      tierIds: [1],
      paymentToken: 'ETH',
      paymentAmount: 10_000_000_000_000_000_000n,
      paymentDecimals: 18,
    })).toThrow('cannot be bought with ETH')
  })

  it('rounds a higher-precision price up when enforcing a lower-decimal payment', () => {
    expect(assertSafeNftPaymentSelection({
      tiers: [{ ...purchasableTier, price: 1_000_001n, pricingDecimals: 7 }],
      tierIds: [1],
      paymentToken: 'USDC',
      paymentAmount: 100_001n,
      paymentDecimals: 6,
    }).minimumPaymentAmount).toBe(100_001n)
  })
})
