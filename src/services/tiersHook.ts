/**
 * JB721TiersHook transaction encoding service.
 * Encodes calldata for tier management: add/remove tiers, set metadata, mint reserves.
 * Note: Hook address is per-project, must be provided for each transaction.
 */

import { encodeFunctionData } from 'viem'
import { JB_721_TIERS_HOOK_ABI } from '../constants/abis'

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

/**
 * Format tier configurations for ABI encoding.
 */
function formatTierConfigs(tiers: JB721TierConfigInput[]) {
  return tiers.map(tier => ({
    price: BigInt(tier.price),
    initialSupply: tier.initialSupply,
    votingUnits: tier.votingUnits,
    reserveFrequency: tier.reserveFrequency,
    reserveBeneficiary: tier.reserveBeneficiary as `0x${string}`,
    encodedIPFSUri: tier.encodedIPFSUri as `0x${string}`,
    category: tier.category,
    discountPercent: tier.discountPercent,
    allowOwnerMint: tier.allowOwnerMint,
    useReserveBeneficiaryAsDefault: tier.useReserveBeneficiaryAsDefault,
    transfersPausable: tier.transfersPausable,
    useVotingUnits: tier.useVotingUnits,
    cannotBeRemoved: tier.cannotBeRemoved,
    cannotIncreaseDiscountPercent: tier.cannotIncreaseDiscountPercent,
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
 * Build transaction for adjusting tiers on a specific hook.
 */
export function buildAdjustTiersTransaction(params: {
  chainId: number
  hookAddress: `0x${string}`
  tiersToAdd: JB721TierConfigInput[]
  tierIdsToRemove: (number | bigint)[]
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeAdjustTiers(params)

  return {
    chainId: params.chainId,
    to: params.hookAddress,
    data,
    value: '0x0',
  }
}

/**
 * Build transactions for adjusting tiers on multiple chains.
 * Assumes same hook address on all chains (CREATE2 deployed).
 */
export function buildOmnichainAdjustTiersTransactions(params: {
  chainIds: number[]
  hookAddress: `0x${string}`
  tiersToAdd: JB721TierConfigInput[]
  tierIdsToRemove: (number | bigint)[]
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  return params.chainIds.map(chainId =>
    buildAdjustTiersTransaction({
      ...params,
      chainId,
    })
  )
}

/**
 * Encode setMetadata calldata for JB721TiersHook.
 * Updates base URI, contract URI, token URI resolver, or tier-specific IPFS URI.
 */
export function encodeSetMetadata(params: {
  baseUri: string
  contractUri: string
  tokenUriResolver: `0x${string}`
  encodedIPFSTUriTierId: number | bigint
  encodedIPFSUri: `0x${string}`
}): `0x${string}` {
  const {
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
      baseUri,
      contractUri,
      tokenUriResolver,
      BigInt(encodedIPFSTUriTierId),
      encodedIPFSUri,
    ],
  })
}

/**
 * Build transaction for setting metadata on a specific hook.
 */
export function buildSetMetadataTransaction(params: {
  chainId: number
  hookAddress: `0x${string}`
  baseUri: string
  contractUri: string
  tokenUriResolver: `0x${string}`
  encodedIPFSTUriTierId: number | bigint
  encodedIPFSUri: `0x${string}`
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeSetMetadata(params)

  return {
    chainId: params.chainId,
    to: params.hookAddress,
    data,
    value: '0x0',
  }
}

/**
 * Build transactions for setting metadata on multiple chains.
 */
export function buildOmnichainSetMetadataTransactions(params: {
  chainIds: number[]
  hookAddress: `0x${string}`
  baseUri: string
  contractUri: string
  tokenUriResolver: `0x${string}`
  encodedIPFSTUriTierId: number | bigint
  encodedIPFSUri: `0x${string}`
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  return params.chainIds.map(chainId =>
    buildSetMetadataTransaction({
      ...params,
      chainId,
    })
  )
}

/**
 * Encode setDiscountPercentOf calldata for JB721TiersHook.
 * Sets discount percentage for a single tier.
 */
export function encodeSetDiscountPercentOf(params: {
  tierId: number | bigint
  discountPercent: number | bigint
}): `0x${string}` {
  return encodeFunctionData({
    abi: JB_721_TIERS_HOOK_ABI,
    functionName: 'setDiscountPercentOf',
    args: [
      BigInt(params.tierId),
      BigInt(params.discountPercent),
    ],
  })
}

/**
 * Build transaction for setting discount percent on a single tier.
 */
export function buildSetDiscountPercentOfTransaction(params: {
  chainId: number
  hookAddress: `0x${string}`
  tierId: number | bigint
  discountPercent: number | bigint
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeSetDiscountPercentOf(params)

  return {
    chainId: params.chainId,
    to: params.hookAddress,
    data,
    value: '0x0',
  }
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
 * Build transaction for batch setting discount percentages.
 */
export function buildSetDiscountPercentsOfTransaction(params: {
  chainId: number
  hookAddress: `0x${string}`
  configs: JB721DiscountPercentConfig[]
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeSetDiscountPercentsOf(params)

  return {
    chainId: params.chainId,
    to: params.hookAddress,
    data,
    value: '0x0',
  }
}

/**
 * Build transactions for batch setting discounts on multiple chains.
 */
export function buildOmnichainSetDiscountPercentsOfTransactions(params: {
  chainIds: number[]
  hookAddress: `0x${string}`
  configs: JB721DiscountPercentConfig[]
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  return params.chainIds.map(chainId =>
    buildSetDiscountPercentsOfTransaction({
      ...params,
      chainId,
    })
  )
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
 * Build transaction for minting pending reserves.
 */
export function buildMintPendingReservesForTransaction(params: {
  chainId: number
  hookAddress: `0x${string}`
  tierId: number | bigint
  count: number | bigint
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeMintPendingReservesFor(params)

  return {
    chainId: params.chainId,
    to: params.hookAddress,
    data,
    value: '0x0',
  }
}

/**
 * Build transactions for minting reserves on multiple chains.
 */
export function buildOmnichainMintPendingReservesForTransactions(params: {
  chainIds: number[]
  hookAddress: `0x${string}`
  tierId: number | bigint
  count: number | bigint
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  return params.chainIds.map(chainId =>
    buildMintPendingReservesForTransaction({
      ...params,
      chainId,
    })
  )
}

/**
 * Encode mintFor calldata for JB721TiersHook.
 * Mints specific tiers to beneficiaries (owner only).
 */
export function encodeMintFor(params: {
  mintConfigs: JB721MintConfig[]
}): `0x${string}` {
  return encodeFunctionData({
    abi: JB_721_TIERS_HOOK_ABI,
    functionName: 'mintFor',
    args: [
      params.mintConfigs.map(c => ({
        tierId: c.tierId,
        count: c.count,
        beneficiary: c.beneficiary as `0x${string}`,
      })),
    ],
  })
}

/**
 * Build transaction for minting to beneficiaries.
 */
export function buildMintForTransaction(params: {
  chainId: number
  hookAddress: `0x${string}`
  mintConfigs: JB721MintConfig[]
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeMintFor(params)

  return {
    chainId: params.chainId,
    to: params.hookAddress,
    data,
    value: '0x0',
  }
}

/**
 * Build transactions for minting on multiple chains.
 */
export function buildOmnichainMintForTransactions(params: {
  chainIds: number[]
  hookAddress: `0x${string}`
  mintConfigs: JB721MintConfig[]
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  return params.chainIds.map(chainId =>
    buildMintForTransaction({
      ...params,
      chainId,
    })
  )
}
