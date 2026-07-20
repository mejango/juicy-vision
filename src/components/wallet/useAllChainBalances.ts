import { useState, useEffect, useCallback } from 'react'
import { createPublicClient, http, formatEther, erc20Abi } from 'viem'
import { VIEM_CHAINS, USDC_ADDRESSES, RPC_ENDPOINTS, type SupportedChainId } from '../../constants'
import { CHAINS, ALL_CHAIN_IDS } from '../../constants'

export interface ChainBalance {
  chainId: number
  chainName: string
  eth: string
  usdc: string
}

/**
 * Fetch ETH and USDC balances for an address across all supported chains.
 *
 * Consolidates the identical fetchAllBalances callbacks previously duplicated
 * between WalletPanel's SelfCustodyWalletView and PasskeyWalletView.
 */
export function useAllChainBalances(address: string | undefined) {
  const [balances, setBalances] = useState<ChainBalance[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch balances across all chains
  const fetchAllBalances = useCallback(async () => {
    if (!address) return
    setLoading(true)

    const results: ChainBalance[] = []

    await Promise.all(
      ALL_CHAIN_IDS.map(async (chainId) => {
        const chain = VIEM_CHAINS[chainId as SupportedChainId]
        const chainInfo = CHAINS[chainId]
        if (!chain || !chainInfo) return

        try {
          const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
          const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
          })

          // Fetch ETH balance
          const ethBalance = await publicClient.getBalance({
            address: address as `0x${string}`,
          })

          // Fetch USDC balance
          const usdcAddress = USDC_ADDRESSES[chainId as SupportedChainId]
          let usdcBalance = BigInt(0)
          if (usdcAddress) {
            try {
              usdcBalance = await publicClient.readContract({
                address: usdcAddress,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address as `0x${string}`],
              })
            } catch {
              // USDC might not exist on this chain
            }
          }

          results.push({
            chainId,
            chainName: chainInfo.shortName,
            eth: formatEther(ethBalance),
            usdc: (Number(usdcBalance) / 1e6).toString(),
          })
        } catch (err) {
          console.error(`Failed to fetch balance for chain ${chainId}:`, err)
        }
      })
    )

    // Sort by chainId for consistent ordering
    results.sort((a, b) => a.chainId - b.chainId)
    setBalances(results)
    setLoading(false)
  }, [address])

  useEffect(() => {
    fetchAllBalances()
  }, [fetchAllBalances])

  return { balances, loading }
}
