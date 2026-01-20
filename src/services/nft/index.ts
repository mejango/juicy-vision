// NFT tier fetching service for Juicebox 721 hooks

import { createPublicClient, http, zeroAddress } from 'viem'
import { VIEM_CHAINS, RPC_ENDPOINTS, JB_CONTRACTS, type SupportedChainId } from '../../constants/chains'
import { resolveIpfsUri } from '../../utils/ipfs'
import {
  JB721TierStoreAbi,
  JBControllerRulesetAbi,
} from './queries'
import type { NFTTier, NFTTierMetadata, ResolvedNFTTier } from './types'

export * from './types'
export * from './queries'

// JB721TiersHookStore address (same on all chains via CREATE2)
const JB721_TIER_STORE = '0x4ae9af188c2b63cba768e53f7e6c1b62b2e86ce7' as const

/**
 * Get the 721 data hook address for a project from its current ruleset
 */
export async function getProjectDataHook(
  projectId: string,
  chainId: number
): Promise<`0x${string}` | null> {
  const chain = VIEM_CHAINS[chainId as SupportedChainId]
  if (!chain) return null

  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    // Get current ruleset from controller to check for data hook
    const result = await client.readContract({
      address: JB_CONTRACTS.JBController,
      abi: JBControllerRulesetAbi,
      functionName: 'currentRulesetOf',
      args: [BigInt(projectId)],
    })

    // result is [ruleset, metadata]
    const metadata = result[1]
    const dataHook = metadata.dataHook

    // Check if data hook is set and it's using data hook for pay
    if (dataHook && dataHook !== zeroAddress && metadata.useDataHookForPay) {
      return dataHook
    }

    return null
  } catch (err) {
    console.error('Failed to get project data hook:', err)
    return null
  }
}

/**
 * Fetch all NFT tiers for a project's 721 hook
 */
export async function fetchNFTTiers(
  hookAddress: `0x${string}`,
  chainId: number,
  maxTiers: number = 100
): Promise<NFTTier[]> {
  const chain = VIEM_CHAINS[chainId as SupportedChainId]
  if (!chain) return []

  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    // Fetch all tiers with resolved URIs
    const tiers = await client.readContract({
      address: JB721_TIER_STORE,
      abi: JB721TierStoreAbi,
      functionName: 'tiersOf',
      args: [
        hookAddress,
        [], // All categories
        true, // Include resolved URI
        0n, // Starting from tier 0
        BigInt(maxTiers),
      ],
    })

    // Map raw tier data to our NFTTier type
    return tiers.map((tier) => ({
      tierId: Number(tier.id),
      name: `Tier ${tier.id}`, // Will be replaced by metadata
      price: BigInt(tier.price),
      currency: 1, // Default to ETH, can be determined from project config
      initialSupply: Number(tier.initialSupply),
      remainingSupply: Number(tier.remainingSupply),
      reservedRate: Number(tier.reservedRate),
      votingUnits: BigInt(tier.votingUnits),
      category: Number(tier.category),
      allowOwnerMint: tier.allowOwnerMint,
      transfersPausable: tier.transfersPausable,
      encodedIPFSUri: tier.resolvedUri || undefined,
    }))
  } catch (err) {
    console.error('Failed to fetch NFT tiers:', err)
    return []
  }
}

/**
 * Fetch a single NFT tier
 */
export async function fetchNFTTier(
  hookAddress: `0x${string}`,
  tierId: number,
  chainId: number
): Promise<NFTTier | null> {
  const chain = VIEM_CHAINS[chainId as SupportedChainId]
  if (!chain) return null

  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    const tier = await client.readContract({
      address: JB721_TIER_STORE,
      abi: JB721TierStoreAbi,
      functionName: 'tierOf',
      args: [hookAddress, BigInt(tierId), true],
    })

    return {
      tierId: Number(tier.id),
      name: `Tier ${tier.id}`,
      price: BigInt(tier.price),
      currency: 1,
      initialSupply: Number(tier.initialSupply),
      remainingSupply: Number(tier.remainingSupply),
      reservedRate: Number(tier.reservedRate),
      votingUnits: BigInt(tier.votingUnits),
      category: Number(tier.category),
      allowOwnerMint: tier.allowOwnerMint,
      transfersPausable: tier.transfersPausable,
      encodedIPFSUri: tier.resolvedUri || undefined,
    }
  } catch (err) {
    console.error('Failed to fetch NFT tier:', err)
    return null
  }
}

/**
 * Fetch tier metadata from IPFS
 */
export async function fetchTierMetadata(uri: string): Promise<NFTTierMetadata | null> {
  const url = resolveIpfsUri(uri)
  if (!url) return null

  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const data = await response.json()
    return data as NFTTierMetadata
  } catch {
    return null
  }
}

/**
 * Fetch NFT tiers with resolved metadata
 */
export async function fetchResolvedNFTTiers(
  hookAddress: `0x${string}`,
  chainId: number,
  maxTiers: number = 100
): Promise<ResolvedNFTTier[]> {
  const tiers = await fetchNFTTiers(hookAddress, chainId, maxTiers)

  // Fetch metadata for all tiers in parallel
  const resolvedTiers = await Promise.all(
    tiers.map(async (tier) => {
      let metadata: NFTTierMetadata | null = null

      if (tier.encodedIPFSUri) {
        metadata = await fetchTierMetadata(tier.encodedIPFSUri)
      }

      return {
        ...tier,
        name: metadata?.name || tier.name,
        description: metadata?.description,
        imageUri: metadata?.image || metadata?.imageUri,
        metadata: metadata || undefined,
      }
    })
  )

  return resolvedTiers
}

/**
 * Fetch all NFT tiers for a project (by project ID)
 * This looks up the 721 hook from the project's ruleset
 */
export async function fetchProjectNFTTiers(
  projectId: string,
  chainId: number
): Promise<ResolvedNFTTier[]> {
  const hookAddress = await getProjectDataHook(projectId, chainId)
  if (!hookAddress) return []

  return fetchResolvedNFTTiers(hookAddress, chainId)
}

/**
 * Check if a project has a 721 hook configured
 */
export async function hasNFTHook(
  projectId: string,
  chainId: number
): Promise<boolean> {
  const hookAddress = await getProjectDataHook(projectId, chainId)
  return hookAddress !== null
}

/**
 * Get the number of tiers for a 721 hook
 */
export async function getNumberOfTiers(
  hookAddress: `0x${string}`,
  chainId: number
): Promise<number> {
  const chain = VIEM_CHAINS[chainId as SupportedChainId]
  if (!chain) return 0

  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    const count = await client.readContract({
      address: JB721_TIER_STORE,
      abi: JB721TierStoreAbi,
      functionName: 'numberOfTiersOf',
      args: [hookAddress],
    })

    return Number(count)
  } catch {
    return 0
  }
}
