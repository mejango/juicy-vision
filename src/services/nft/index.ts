// NFT tier fetching service for Juicebox 721 hooks

import { createPublicClient, http, zeroAddress } from 'viem'
import { VIEM_CHAINS, MAINNET_VIEM_CHAINS, RPC_ENDPOINTS, MAINNET_RPC_ENDPOINTS, JB_CONTRACTS, type SupportedChainId, MAINNET_CHAIN_IDS } from '../../constants/chains'
import { REV_DEPLOYER_ADDRESS, REV_DEPLOYER_TIERED_721_HOOK_ABI } from '../../constants/abis/revDeployer'
import { resolveIpfsUri } from '../../utils/ipfs'
import { isRevnet, fetchProject } from '../bendystraw'
import {
  JB721TierStoreAbi,
  JB721TiersHookAbi,
  JBControllerRulesetAbi,
} from './queries'
import type {
  NFTTier,
  NFTTierMetadata,
  ResolvedNFTTier,
  JB721HookFlags,
  TierPermissions,
  TierChangeValidation,
  NFTTierWithPermissions,
} from './types'
import type { JB721TierConfigInput } from '../tiersHook'

export * from './types'
export * from './queries'

// JB721TiersHookStore address (same on all chains via CREATE2)
const JB721_TIER_STORE = '0x4ae9af188c2b63cba768e53f7e6c1b62b2e86ce7' as const

/**
 * Get the 721 data hook address for a project.
 * For revnets, this queries the REVDeployer's hookOf function since the
 * ruleset's data hook points to the REVDeployer, not the 721 hook directly.
 */
export async function getProjectDataHook(
  projectId: string,
  chainId: number
): Promise<`0x${string}` | null> {
  // Support both testnet and mainnet chains
  const chain = VIEM_CHAINS[chainId as SupportedChainId] ||
    MAINNET_VIEM_CHAINS[chainId as keyof typeof MAINNET_VIEM_CHAINS]
  if (!chain) {
    console.warn('[NFT] Unsupported chainId:', chainId)
    return null
  }

  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0] ||
    MAINNET_RPC_ENDPOINTS[chainId as keyof typeof MAINNET_RPC_ENDPOINTS]?.[0]
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    console.log('[NFT] getProjectDataHook starting:', { projectId, chainId })

    // First check if this is a revnet by fetching the project owner
    let project
    try {
      project = await fetchProject(projectId, chainId)
      console.log('[NFT] fetchProject result:', { owner: project?.owner })
    } catch (fetchErr) {
      console.error('[NFT] fetchProject failed:', fetchErr)
    }

    const projectIsRevnet = project?.owner ? isRevnet(project.owner) : false

    console.log('[NFT] getProjectDataHook:', { projectId, chainId, owner: project?.owner, projectIsRevnet })

    if (projectIsRevnet) {
      // For revnets, query the REVDeployer's tiered721HookOf function
      try {
        console.log('[NFT] Querying tiered721HookOf for revnet:', projectId)
        const hookAddress = await client.readContract({
          address: REV_DEPLOYER_ADDRESS,
          abi: REV_DEPLOYER_TIERED_721_HOOK_ABI,
          functionName: 'tiered721HookOf',
          args: [BigInt(projectId)],
        })
        console.log('[NFT] tiered721HookOf result:', hookAddress)

        if (hookAddress && hookAddress !== zeroAddress) {
          return hookAddress
        }
      } catch (err) {
        console.error('[NFT] Failed to get revnet tiered721 hook:', err)
      }
      return null
    }

    // For non-revnets, get data hook from ruleset
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
  console.log('[NFT] hasNFTHook called:', { projectId, chainId })
  const hookAddress = await getProjectDataHook(projectId, chainId)
  console.log('[NFT] hasNFTHook result:', { projectId, hookAddress, hasHook: hookAddress !== null })
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

/**
 * Fetch the hook flags for a JB721TiersHook contract
 * These flags determine what operations are allowed on the collection
 */
export async function fetchHookFlags(
  hookAddress: `0x${string}`,
  chainId: number
): Promise<JB721HookFlags | null> {
  const chain = VIEM_CHAINS[chainId as SupportedChainId]
  if (!chain) return null

  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    const flags = await client.readContract({
      address: hookAddress,
      abi: JB721TiersHookAbi,
      functionName: 'FLAGS',
    })

    return {
      noNewTiersWithReserves: flags.noNewTiersWithReserves,
      noNewTiersWithVotes: flags.noNewTiersWithVotes,
      noNewTiersWithOwnerMinting: flags.noNewTiersWithOwnerMinting,
      preventOverspending: flags.preventOverspending,
    }
  } catch (err) {
    console.error('Failed to fetch hook flags:', err)
    return null
  }
}

/**
 * Fetch NFT tiers with their permission flags
 */
export async function fetchNFTTiersWithPermissions(
  hookAddress: `0x${string}`,
  chainId: number,
  maxTiers: number = 100
): Promise<NFTTierWithPermissions[]> {
  const chain = VIEM_CHAINS[chainId as SupportedChainId]
  if (!chain) return []

  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
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

    return tiers.map((tier) => ({
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
      permissions: {
        cannotBeRemoved: tier.cannotBeRemoved,
        cannotIncreaseDiscountPercent: tier.cannotIncreaseDiscountPercent,
      },
    }))
  } catch (err) {
    console.error('Failed to fetch NFT tiers with permissions:', err)
    return []
  }
}

/**
 * Validate a tier configuration change against hook flags and tier permissions
 *
 * @param tier - The tier configuration being added or modified
 * @param hookFlags - The collection-wide flags from the hook contract
 * @param existingTier - If modifying an existing tier, its current permissions
 * @param isRemoval - If true, this is a tier removal operation
 * @returns Validation result with allowed status and any block reason
 */
export function validateTierChange(
  tier: JB721TierConfigInput | null,
  hookFlags: JB721HookFlags,
  existingTier?: TierPermissions,
  isRemoval: boolean = false
): TierChangeValidation {
  // Tier removal validation
  if (isRemoval) {
    if (existingTier?.cannotBeRemoved) {
      return {
        allowed: false,
        blockedReason: 'This tier has been configured to be non-removable',
        suggestNewHook: false,
      }
    }
    return { allowed: true, suggestNewHook: false }
  }

  // New tier validation
  if (!tier) {
    return { allowed: true, suggestNewHook: false }
  }

  // Check hook-level restrictions for new tiers
  if (tier.reserveFrequency > 0 && hookFlags.noNewTiersWithReserves) {
    return {
      allowed: false,
      blockedReason: 'This collection does not allow new tiers with reserved NFT minting',
      suggestNewHook: true,
    }
  }

  if (tier.votingUnits > 0 && hookFlags.noNewTiersWithVotes) {
    return {
      allowed: false,
      blockedReason: 'This collection does not allow new tiers with voting power',
      suggestNewHook: true,
    }
  }

  if (tier.allowOwnerMint && hookFlags.noNewTiersWithOwnerMinting) {
    return {
      allowed: false,
      blockedReason: 'This collection does not allow new tiers with owner minting enabled',
      suggestNewHook: true,
    }
  }

  return { allowed: true, suggestNewHook: false }
}

/**
 * Validate a discount percent change against tier permissions
 *
 * @param newDiscountPercent - The new discount percent value
 * @param currentDiscountPercent - The current discount percent value
 * @param tierPermissions - The tier's permission flags
 * @returns Validation result
 */
export function validateDiscountChange(
  newDiscountPercent: number,
  currentDiscountPercent: number,
  tierPermissions: TierPermissions
): TierChangeValidation {
  // Increasing discount is restricted if cannotIncreaseDiscountPercent is set
  if (newDiscountPercent > currentDiscountPercent && tierPermissions.cannotIncreaseDiscountPercent) {
    return {
      allowed: false,
      blockedReason: 'This tier does not allow increasing the discount percentage',
      suggestNewHook: false,
    }
  }

  return { allowed: true, suggestNewHook: false }
}

/**
 * Get a summary of what operations are blocked by hook flags
 */
export function getBlockedOperations(flags: JB721HookFlags): string[] {
  const blocked: string[] = []

  if (flags.noNewTiersWithReserves) {
    blocked.push('Adding tiers with reserved NFT minting')
  }
  if (flags.noNewTiersWithVotes) {
    blocked.push('Adding tiers with voting power')
  }
  if (flags.noNewTiersWithOwnerMinting) {
    blocked.push('Adding tiers with owner minting')
  }
  if (flags.preventOverspending) {
    blocked.push('Overspending on tier purchases')
  }

  return blocked
}
