import { describe, it, expect } from 'vitest'
import {
  validateTierChange,
  validateDiscountChange,
  getBlockedOperations,
} from './index'
import type { JB721HookFlags, TierPermissions } from './types'
import type { JB721TierConfigInput } from '../tiersHook'

// Helper to create default hook flags
function createHookFlags(overrides: Partial<JB721HookFlags> = {}): JB721HookFlags {
  return {
    noNewTiersWithReserves: false,
    noNewTiersWithVotes: false,
    noNewTiersWithOwnerMinting: false,
    preventOverspending: false,
    ...overrides,
  }
}

// Helper to create default tier config
function createTierConfig(overrides: Partial<JB721TierConfigInput> = {}): JB721TierConfigInput {
  return {
    price: '1000000000000000000', // 1 ETH
    initialSupply: 100,
    votingUnits: 0,
    reserveFrequency: 0,
    reserveBeneficiary: '0x0000000000000000000000000000000000000000',
    encodedIPFSUri: '0x0000000000000000000000000000000000000000000000000000000000000000',
    category: 0,
    discountPercent: 0,
    allowOwnerMint: false,
    useReserveBeneficiaryAsDefault: false,
    transfersPausable: false,
    useVotingUnits: false,
    cannotBeRemoved: false,
    cannotIncreaseDiscountPercent: false,
    ...overrides,
  }
}

// Helper to create tier permissions
function createTierPermissions(overrides: Partial<TierPermissions> = {}): TierPermissions {
  return {
    cannotBeRemoved: false,
    cannotIncreaseDiscountPercent: false,
    ...overrides,
  }
}

describe('validateTierChange', () => {
  describe('tier removal validation', () => {
    it('allows removal when cannotBeRemoved is false', () => {
      const flags = createHookFlags()
      const permissions = createTierPermissions({ cannotBeRemoved: false })

      const result = validateTierChange(null, flags, permissions, true)

      expect(result.allowed).toBe(true)
      expect(result.blockedReason).toBeUndefined()
      expect(result.suggestNewHook).toBe(false)
    })

    it('blocks removal when cannotBeRemoved is true', () => {
      const flags = createHookFlags()
      const permissions = createTierPermissions({ cannotBeRemoved: true })

      const result = validateTierChange(null, flags, permissions, true)

      expect(result.allowed).toBe(false)
      expect(result.blockedReason).toBe('This tier has been configured to be non-removable')
      expect(result.suggestNewHook).toBe(false)
    })

    it('allows removal when no existing tier permissions', () => {
      const flags = createHookFlags()

      const result = validateTierChange(null, flags, undefined, true)

      expect(result.allowed).toBe(true)
    })
  })

  describe('new tier validation - reserve frequency', () => {
    it('allows tiers with reserves when noNewTiersWithReserves is false', () => {
      const flags = createHookFlags({ noNewTiersWithReserves: false })
      const tier = createTierConfig({ reserveFrequency: 10 })

      const result = validateTierChange(tier, flags)

      expect(result.allowed).toBe(true)
    })

    it('blocks tiers with reserves when noNewTiersWithReserves is true', () => {
      const flags = createHookFlags({ noNewTiersWithReserves: true })
      const tier = createTierConfig({ reserveFrequency: 10 })

      const result = validateTierChange(tier, flags)

      expect(result.allowed).toBe(false)
      expect(result.blockedReason).toBe('This collection does not allow new tiers with reserved NFT minting')
      expect(result.suggestNewHook).toBe(true)
    })

    it('allows tiers without reserves even when noNewTiersWithReserves is true', () => {
      const flags = createHookFlags({ noNewTiersWithReserves: true })
      const tier = createTierConfig({ reserveFrequency: 0 })

      const result = validateTierChange(tier, flags)

      expect(result.allowed).toBe(true)
    })
  })

  describe('new tier validation - voting units', () => {
    it('allows tiers with votes when noNewTiersWithVotes is false', () => {
      const flags = createHookFlags({ noNewTiersWithVotes: false })
      const tier = createTierConfig({ votingUnits: 100 })

      const result = validateTierChange(tier, flags)

      expect(result.allowed).toBe(true)
    })

    it('blocks tiers with votes when noNewTiersWithVotes is true', () => {
      const flags = createHookFlags({ noNewTiersWithVotes: true })
      const tier = createTierConfig({ votingUnits: 100 })

      const result = validateTierChange(tier, flags)

      expect(result.allowed).toBe(false)
      expect(result.blockedReason).toBe('This collection does not allow new tiers with voting power')
      expect(result.suggestNewHook).toBe(true)
    })

    it('allows tiers without votes even when noNewTiersWithVotes is true', () => {
      const flags = createHookFlags({ noNewTiersWithVotes: true })
      const tier = createTierConfig({ votingUnits: 0 })

      const result = validateTierChange(tier, flags)

      expect(result.allowed).toBe(true)
    })
  })

  describe('new tier validation - owner minting', () => {
    it('allows tiers with owner mint when noNewTiersWithOwnerMinting is false', () => {
      const flags = createHookFlags({ noNewTiersWithOwnerMinting: false })
      const tier = createTierConfig({ allowOwnerMint: true })

      const result = validateTierChange(tier, flags)

      expect(result.allowed).toBe(true)
    })

    it('blocks tiers with owner mint when noNewTiersWithOwnerMinting is true', () => {
      const flags = createHookFlags({ noNewTiersWithOwnerMinting: true })
      const tier = createTierConfig({ allowOwnerMint: true })

      const result = validateTierChange(tier, flags)

      expect(result.allowed).toBe(false)
      expect(result.blockedReason).toBe('This collection does not allow new tiers with owner minting enabled')
      expect(result.suggestNewHook).toBe(true)
    })

    it('allows tiers without owner mint even when noNewTiersWithOwnerMinting is true', () => {
      const flags = createHookFlags({ noNewTiersWithOwnerMinting: true })
      const tier = createTierConfig({ allowOwnerMint: false })

      const result = validateTierChange(tier, flags)

      expect(result.allowed).toBe(true)
    })
  })

  describe('combined flag validation', () => {
    it('allows basic tier when all flags are restrictive', () => {
      const flags = createHookFlags({
        noNewTiersWithReserves: true,
        noNewTiersWithVotes: true,
        noNewTiersWithOwnerMinting: true,
        preventOverspending: true,
      })
      const tier = createTierConfig({
        reserveFrequency: 0,
        votingUnits: 0,
        allowOwnerMint: false,
      })

      const result = validateTierChange(tier, flags)

      expect(result.allowed).toBe(true)
    })

    it('blocks on first failing restriction', () => {
      const flags = createHookFlags({
        noNewTiersWithReserves: true,
        noNewTiersWithVotes: true,
        noNewTiersWithOwnerMinting: true,
      })
      const tier = createTierConfig({
        reserveFrequency: 10,
        votingUnits: 100,
        allowOwnerMint: true,
      })

      const result = validateTierChange(tier, flags)

      // Should block on reserves first (order of checks)
      expect(result.allowed).toBe(false)
      expect(result.blockedReason).toContain('reserved NFT minting')
    })
  })

  describe('null tier validation', () => {
    it('allows null tier when not a removal', () => {
      const flags = createHookFlags()

      const result = validateTierChange(null, flags)

      expect(result.allowed).toBe(true)
    })
  })
})

describe('validateDiscountChange', () => {
  it('allows decreasing discount percent', () => {
    const permissions = createTierPermissions({ cannotIncreaseDiscountPercent: true })

    const result = validateDiscountChange(10, 20, permissions)

    expect(result.allowed).toBe(true)
  })

  it('allows same discount percent', () => {
    const permissions = createTierPermissions({ cannotIncreaseDiscountPercent: true })

    const result = validateDiscountChange(20, 20, permissions)

    expect(result.allowed).toBe(true)
  })

  it('allows increasing discount when cannotIncreaseDiscountPercent is false', () => {
    const permissions = createTierPermissions({ cannotIncreaseDiscountPercent: false })

    const result = validateDiscountChange(30, 20, permissions)

    expect(result.allowed).toBe(true)
  })

  it('blocks increasing discount when cannotIncreaseDiscountPercent is true', () => {
    const permissions = createTierPermissions({ cannotIncreaseDiscountPercent: true })

    const result = validateDiscountChange(30, 20, permissions)

    expect(result.allowed).toBe(false)
    expect(result.blockedReason).toBe('This tier does not allow increasing the discount percentage')
    expect(result.suggestNewHook).toBe(false)
  })
})

describe('getBlockedOperations', () => {
  it('returns empty array when no restrictions', () => {
    const flags = createHookFlags()

    const blocked = getBlockedOperations(flags)

    expect(blocked).toEqual([])
  })

  it('returns reserve restriction message', () => {
    const flags = createHookFlags({ noNewTiersWithReserves: true })

    const blocked = getBlockedOperations(flags)

    expect(blocked).toContain('Adding tiers with reserved NFT minting')
  })

  it('returns voting restriction message', () => {
    const flags = createHookFlags({ noNewTiersWithVotes: true })

    const blocked = getBlockedOperations(flags)

    expect(blocked).toContain('Adding tiers with voting power')
  })

  it('returns owner minting restriction message', () => {
    const flags = createHookFlags({ noNewTiersWithOwnerMinting: true })

    const blocked = getBlockedOperations(flags)

    expect(blocked).toContain('Adding tiers with owner minting')
  })

  it('returns overspending restriction message', () => {
    const flags = createHookFlags({ preventOverspending: true })

    const blocked = getBlockedOperations(flags)

    expect(blocked).toContain('Overspending on tier purchases')
  })

  it('returns all restriction messages when all flags set', () => {
    const flags = createHookFlags({
      noNewTiersWithReserves: true,
      noNewTiersWithVotes: true,
      noNewTiersWithOwnerMinting: true,
      preventOverspending: true,
    })

    const blocked = getBlockedOperations(flags)

    expect(blocked).toHaveLength(4)
    expect(blocked).toContain('Adding tiers with reserved NFT minting')
    expect(blocked).toContain('Adding tiers with voting power')
    expect(blocked).toContain('Adding tiers with owner minting')
    expect(blocked).toContain('Overspending on tier purchases')
  })
})
