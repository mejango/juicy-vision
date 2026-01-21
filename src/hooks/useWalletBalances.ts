import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { createPublicClient, http, formatEther, erc20Abi } from 'viem'
import { VIEM_CHAINS, USDC_ADDRESSES, RPC_ENDPOINTS, type SupportedChainId } from '../constants'

const CHAIN_IDS = Object.keys(VIEM_CHAINS).map(Number) as SupportedChainId[]

export interface WalletBalances {
  totalEth: bigint
  totalUsdc: bigint
  perChain: {
    chainId: number
    eth: bigint
    usdc: bigint
  }[]
  loading: boolean
}

export function useWalletBalances(overrideAddress?: string): WalletBalances {
  const { address: connectedAddress } = useAccount()
  const address = overrideAddress || connectedAddress
  const [totalEth, setTotalEth] = useState<bigint>(0n)
  const [totalUsdc, setTotalUsdc] = useState<bigint>(0n)
  const [perChain, setPerChain] = useState<WalletBalances['perChain']>([])
  const [loading, setLoading] = useState(false)

  const fetchBalances = useCallback(async () => {
    if (!address) {
      setTotalEth(0n)
      setTotalUsdc(0n)
      setPerChain([])
      return
    }

    setLoading(true)
    try {
      const results = await Promise.all(
        CHAIN_IDS.map(async (chainId) => {
          const chain = VIEM_CHAINS[chainId]
          const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
          const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
          })

          const [ethBalance, usdcBalance] = await Promise.all([
            publicClient.getBalance({
              address: address as `0x${string}`,
            }),
            publicClient.readContract({
              address: USDC_ADDRESSES[chainId],
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [address as `0x${string}`],
            }).catch(() => 0n),
          ])

          return {
            chainId,
            eth: ethBalance,
            usdc: usdcBalance as bigint,
          }
        })
      )

      const ethSum = results.reduce((sum, r) => sum + r.eth, 0n)
      const usdcSum = results.reduce((sum, r) => sum + r.usdc, 0n)

      setPerChain(results)
      setTotalEth(ethSum)
      setTotalUsdc(usdcSum)
    } catch (err) {
      console.error('Failed to fetch wallet balances:', err)
    } finally {
      setLoading(false)
    }
  }, [address])

  useEffect(() => {
    fetchBalances()
  }, [fetchBalances])

  return { totalEth, totalUsdc, perChain, loading }
}

export function formatEthBalance(wei: bigint): string {
  const eth = parseFloat(formatEther(wei))
  if (eth === 0) return '0'
  if (eth < 0.0001) return '<0.0001'
  if (eth < 1) return eth.toFixed(4)
  return eth.toFixed(3)
}

export function formatUsdcBalance(amount: bigint): string {
  const usdc = Number(amount) / 1e6
  if (usdc === 0) return '0'
  if (usdc < 0.01) return '<0.01'
  if (usdc < 1) return usdc.toFixed(2)
  if (usdc < 1000) return usdc.toFixed(2)
  if (usdc < 1000000) return `${(usdc / 1000).toFixed(1)}k`
  return `${(usdc / 1000000).toFixed(1)}M`
}
