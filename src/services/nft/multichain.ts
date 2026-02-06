// Multi-chain NFT tier supply aggregation
// Fetches tier supply data across connected chains for omnichain projects

import { createPublicClient, http, zeroAddress } from 'viem'
import { VIEM_CHAINS, MAINNET_VIEM_CHAINS, RPC_ENDPOINTS, MAINNET_RPC_ENDPOINTS, type SupportedChainId } from '../../constants/chains'
import { CHAINS, MAINNET_CHAINS } from '../../constants'
import { JB721TiersHookAbi, JB721TierStoreAbi } from './queries'
import { getProjectDataHook } from './index'

export interface ChainSupply {
  chainId: number
  chainName: string
  remaining: number
  initial: number
}

export interface MultiChainTierSupply {
  totalRemaining: number
  totalInitial: number
  perChain: ChainSupply[]
}

/**
 * Fetch tier supply for a single chain
 * Returns null if the chain doesn't have a 721 hook or the tier doesn't exist
 */
async function fetchChainTierSupply(
  projectId: number,
  tierId: number,
  chainId: number
): Promise<ChainSupply | null> {
  const chain = VIEM_CHAINS[chainId as SupportedChainId] ||
    MAINNET_VIEM_CHAINS[chainId as keyof typeof MAINNET_VIEM_CHAINS]
  if (!chain) return null

  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0] ||
    MAINNET_RPC_ENDPOINTS[chainId as keyof typeof MAINNET_RPC_ENDPOINTS]?.[0]
  if (!rpcUrl) return null

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    // Get the hook address for this project on this chain
    const hookAddress = await getProjectDataHook(String(projectId), chainId)
    if (!hookAddress) return null

    // Get the store address
    const storeAddress = await client.readContract({
      address: hookAddress,
      abi: JB721TiersHookAbi,
      functionName: 'STORE',
    })

    if (!storeAddress || storeAddress === zeroAddress) return null

    // Fetch the specific tier
    const tier = await client.readContract({
      address: storeAddress,
      abi: JB721TierStoreAbi,
      functionName: 'tierOf',
      args: [hookAddress, BigInt(tierId), false],
    })

    const chainConfig = CHAINS[chainId] || MAINNET_CHAINS[chainId]
    return {
      chainId,
      chainName: chainConfig?.name || `Chain ${chainId}`,
      remaining: Number(tier.remainingSupply),
      initial: Number(tier.initialSupply),
    }
  } catch (err) {
    console.warn(`[MultiChain] Failed to fetch tier ${tierId} on chain ${chainId}:`, err)
    return null
  }
}

/**
 * Fetch tier supply across multiple connected chains
 * Aggregates supply from all chains and returns per-chain breakdown
 */
export async function fetchMultiChainTierSupply(
  tierId: number,
  connectedChains: Array<{ chainId: number; projectId: number }>
): Promise<MultiChainTierSupply> {
  if (connectedChains.length === 0) {
    return {
      totalRemaining: 0,
      totalInitial: 0,
      perChain: [],
    }
  }

  // Fetch all chains in parallel
  const results = await Promise.all(
    connectedChains.map(({ chainId, projectId }) =>
      fetchChainTierSupply(projectId, tierId, chainId)
    )
  )

  // Filter out failed fetches and aggregate
  const perChain = results.filter((r): r is ChainSupply => r !== null)

  const totalRemaining = perChain.reduce((sum, c) => sum + c.remaining, 0)
  const totalInitial = perChain.reduce((sum, c) => sum + c.initial, 0)

  return {
    totalRemaining,
    totalInitial,
    perChain,
  }
}
