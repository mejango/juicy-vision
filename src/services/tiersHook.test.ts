import { describe, expect, it } from 'vitest'
import { encodeAdjustTiers, type JB721TierConfigInput } from './tiersHook'

const unlimitedTier: JB721TierConfigInput = {
  price: '5000000',
  initialSupply: 999999999,
  votingUnits: 0,
  reserveFrequency: 0,
  reserveBeneficiary: '0x0000000000000000000000000000000000000000',
  encodedIPFSUri: '0x0000000000000000000000000000000000000000000000000000000000000001',
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
  ...unlimitedTier,
  price: '25000000',
  initialSupply: 50,
}

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
    expect(encodeAdjustTiers({
      tiersToAdd: [],
      tierIdsToRemove: [1, 2, 3],
    })).toMatch(/^0x/)
  })

  it('encodes calldata for combined changes', () => {
    expect(encodeAdjustTiers({
      tiersToAdd: [unlimitedTier, limitedTier],
      tierIdsToRemove: [5],
    })).toMatch(/^0x/)
  })
})
