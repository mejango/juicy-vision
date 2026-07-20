/**
 * JB721TiersHook transaction encoding service.
 * Encodes calldata for tier management: add/remove tiers, set metadata, mint reserves.
 * Note: Hook address is per-project, must be provided for each transaction.
 */

import { encodeFunctionData } from 'viem'
import { JB_721_TIERS_HOOK_ABI } from '../constants/abis'
import { assertSafeTierAdjustments } from '../utils/tierSafety'

// Tier configuration for adding new tiers
export interface JB721TierConfigInput {
  price: string | bigint
  initialSupply: number
  votingUnits: number
  reserveFrequency: number
  reserveBeneficiary: string
  encodedIPFSUri: string  // bytes32 encoded IPFS CID
  category: number
  discountPercent: number
  allowOwnerMint: boolean
  useReserveBeneficiaryAsDefault: boolean
  transfersPausable: boolean
  useVotingUnits: boolean
  cannotBeRemoved: boolean
  cannotIncreaseDiscountPercent: boolean
  /** V6: if true, the tier cannot be bought with pay credits. */
  cannotBuyWithCredits?: boolean
  /** V6: percent of tier price routed to the tier's splits (out of 1e9). */
  splitPercent?: number
  /** V6: splits receiving the tier's splitPercent. */
  splits?: Array<{
    percent: number
    projectId: number
    beneficiary: string
    preferAddToBalance: boolean
    lockedUntil: number
    hook: string
  }>
}

// Config for batch discount updates
export interface JB721DiscountPercentConfig {
  tierId: number
  discountPercent: number
}

function assertSafeDiscountPercents(configs: JB721DiscountPercentConfig[]): void {
  if (configs.length === 0) {
    throw new Error('At least one tier discount is required')
  }
  if (configs.length > 100) {
    throw new Error('At most 100 tier discounts can be changed at once')
  }

  const tierIds = new Set<number>()
  for (const config of configs) {
    if (!Number.isInteger(config.tierId) || config.tierId <= 0 || config.tierId > 0xffffffff) {
      throw new Error(`Invalid tier ID: ${config.tierId}`)
    }
    if (
      !Number.isInteger(config.discountPercent) ||
      config.discountPercent < 0 ||
      config.discountPercent > 200
    ) {
      throw new Error(`Invalid discount for tier ${config.tierId}`)
    }
    if (tierIds.has(config.tierId)) {
      throw new Error(`Duplicate discount for tier ${config.tierId}`)
    }
    tierIds.add(config.tierId)
  }
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/**
 * Format tier configurations for ABI encoding (V6 JB721TierConfig:
 * nested `flags` tuple, `encodedIpfsUri` casing, splitPercent + splits).
 */
function formatTierConfigs(tiers: JB721TierConfigInput[]) {
  return tiers.map(tier => ({
    price: BigInt(tier.price),
    initialSupply: tier.initialSupply,
    votingUnits: tier.votingUnits,
    reserveFrequency: tier.reserveFrequency,
    reserveBeneficiary: tier.reserveBeneficiary as `0x${string}`,
    encodedIpfsUri: tier.encodedIPFSUri as `0x${string}`,
    category: tier.category,
    discountPercent: tier.discountPercent,
    flags: {
      allowOwnerMint: tier.allowOwnerMint,
      useReserveBeneficiaryAsDefault: tier.useReserveBeneficiaryAsDefault,
      transfersPausable: tier.transfersPausable,
      useVotingUnits: tier.useVotingUnits,
      cantBeRemoved: tier.cannotBeRemoved,
      cantIncreaseDiscountPercent: tier.cannotIncreaseDiscountPercent,
      cantBuyWithCredits: tier.cannotBuyWithCredits ?? false,
    },
    splitPercent: tier.splitPercent ?? 0,
    splits: (tier.splits ?? []).map(s => ({
      percent: s.percent,
      projectId: BigInt(s.projectId),
      beneficiary: s.beneficiary as `0x${string}`,
      preferAddToBalance: s.preferAddToBalance,
      lockedUntil: s.lockedUntil,
      hook: (s.hook || ZERO_ADDRESS) as `0x${string}`,
    })),
  }))
}

/**
 * Encode adjustTiers calldata for JB721TiersHook.
 * Adds new tiers and/or removes existing tiers.
 */
export function encodeAdjustTiers(params: {
  tiersToAdd: JB721TierConfigInput[]
  tierIdsToRemove: (number | bigint)[]
}): `0x${string}` {
  const { tiersToAdd, tierIdsToRemove } = params
  assertSafeTierAdjustments(tiersToAdd, tierIdsToRemove)

  return encodeFunctionData({
    abi: JB_721_TIERS_HOOK_ABI,
    functionName: 'adjustTiers',
    args: [
      formatTierConfigs(tiersToAdd),
      tierIdsToRemove.map(id => BigInt(id)),
    ],
  })
}

/**
 * Encode setDiscountPercentsOf calldata for JB721TiersHook.
 * Batch sets discount percentages for multiple tiers.
 */
export function encodeSetDiscountPercentsOf(params: {
  configs: JB721DiscountPercentConfig[]
}): `0x${string}` {
  assertSafeDiscountPercents(params.configs)

  return encodeFunctionData({
    abi: JB_721_TIERS_HOOK_ABI,
    functionName: 'setDiscountPercentsOf',
    args: [
      params.configs.map(c => ({
        tierId: c.tierId,
        discountPercent: c.discountPercent,
      })),
    ],
  })
}
