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

// Config for minting to beneficiaries
export interface JB721MintConfig {
  tierId: number
  count: number
  beneficiary: string
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
 * Encode setMetadata calldata for JB721TiersHook (V6).
 * Updates name, symbol, base URI, contract URI, token URI resolver, or tier-specific IPFS URI.
 * V6 signature: setMetadata(name, symbol, baseUri, contractUri, tokenUriResolver, encodedIpfsUriTierId, encodedIpfsUri)
 */
export function encodeSetMetadata(params: {
  name?: string
  symbol?: string
  baseUri: string
  contractUri: string
  tokenUriResolver: `0x${string}`
  encodedIPFSTUriTierId: number | bigint
  encodedIPFSUri: `0x${string}`
}): `0x${string}` {
  const {
    name = '',
    symbol = '',
    baseUri,
    contractUri,
    tokenUriResolver,
    encodedIPFSTUriTierId,
    encodedIPFSUri,
  } = params

  return encodeFunctionData({
    abi: JB_721_TIERS_HOOK_ABI,
    functionName: 'setMetadata',
    args: [
      name,
      symbol,
      baseUri,
      contractUri,
      tokenUriResolver,
      BigInt(encodedIPFSTUriTierId),
      encodedIPFSUri,
    ],
  })
}

/**
 * Encode a single-tier discount update for JB721TiersHook.
 * V6 removed setDiscountPercentOf - this encodes setDiscountPercentsOf with one entry.
 */
export function encodeSetDiscountPercentOf(params: {
  tierId: number | bigint
  discountPercent: number | bigint
}): `0x${string}` {
  return encodeFunctionData({
    abi: JB_721_TIERS_HOOK_ABI,
    functionName: 'setDiscountPercentsOf',
    args: [
      [{
        tierId: Number(params.tierId),
        discountPercent: Number(params.discountPercent),
      }],
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

/**
 * Encode mintPendingReservesFor calldata for JB721TiersHook.
 * Mints pending reserved NFTs from a specific tier.
 */
export function encodeMintPendingReservesFor(params: {
  tierId: number | bigint
  count: number | bigint
}): `0x${string}` {
  return encodeFunctionData({
    abi: JB_721_TIERS_HOOK_ABI,
    functionName: 'mintPendingReservesFor',
    args: [
      BigInt(params.tierId),
      BigInt(params.count),
    ],
  })
}

/**
 * Encode mintFor calldata for JB721TiersHook.
 * Mints specific tiers to a beneficiary (owner only).
 *
 * V6 signature is mintFor(uint16[] tierIds, address beneficiary) - one
 * beneficiary per call. Configs are expanded (tierId repeated `count` times);
 * all configs in a single call MUST share the same beneficiary.
 */
export function encodeMintFor(params: {
  mintConfigs: JB721MintConfig[]
}): `0x${string}` {
  const { mintConfigs } = params
  if (mintConfigs.length === 0) {
    throw new Error('encodeMintFor: at least one mint config is required')
  }

  const beneficiary = mintConfigs[0].beneficiary
  const mismatched = mintConfigs.find(c => c.beneficiary.toLowerCase() !== beneficiary.toLowerCase())
  if (mismatched) {
    throw new Error(
      'encodeMintFor: V6 mintFor takes a single beneficiary per call - split configs by beneficiary and encode one transaction each'
    )
  }

  // Expand each config into `count` copies of its tierId
  const tierIds: number[] = []
  for (const c of mintConfigs) {
    for (let i = 0; i < c.count; i++) {
      tierIds.push(c.tierId)
    }
  }

  return encodeFunctionData({
    abi: JB_721_TIERS_HOOK_ABI,
    functionName: 'mintFor',
    args: [
      tierIds,
      beneficiary as `0x${string}`,
    ],
  })
}
