/**
 * Hook for setting splits across multiple chains using Relayr bundling.
 * Calls setSplitGroupsOf on JBController (not JBSplits directly) for each chain.
 *
 * The controller is fetched from JBDirectory.controllerOf for each chain since
 * different projects may use different controller versions (V5 vs V5.1).
 */

import { useCallback, useEffect, useRef, useMemo } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { encodeFunctionData, createPublicClient, http, fallback, type PublicClient } from 'viem'
import { useAuthStore } from '../../stores'
import { useManagedWallet } from '../useManagedWallet'
import { createPrepaidBundle, createBalanceBundle } from '../../services/relayr'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import type { BundleState } from './types'
import { JB_CONTROLLER_ABI } from '../../constants/abis/jbController'
import { SPLIT_GROUP_RESERVED, getPayoutSplitGroup, NATIVE_TOKEN } from '../../constants/abis/jbSplits'
import { USDC_ADDRESSES, RPC_ENDPOINTS, VIEM_CHAINS, type SupportedChainId } from '../../constants'
import { getProjectController } from '../../utils/paymentTerminal'

// Relayr app ID for sponsored bundles
const RELAYR_APP_ID = import.meta.env.VITE_RELAYR_APP_ID || 'juicy-vision'

// Split data as used in the form
export interface FormSplit {
  percent: string // 0-100
  beneficiary: string
  projectId: string
  preferAddToBalance: boolean
  lockedUntil: number
  hook: string
}

// Chain data for setting splits
export interface ChainSplitData {
  chainId: number
  projectId: number
  rulesetId: string
  baseCurrency: number
}

interface UseOmnichainSetSplitsOptions {
  onSuccess?: (bundleId: string, txHashes: Record<number, string>) => void
  onError?: (error: string) => void
}

interface UseOmnichainSetSplitsReturn {
  setSplits: (params: {
    chainData: ChainSplitData[]
    payoutSplits: FormSplit[]
    reservedSplits: FormSplit[]
  }) => Promise<void>
  bundleState: BundleState
  isExecuting: boolean
  isComplete: boolean
  hasError: boolean
  reset: () => void
  setPaymentChain: (chainId: number) => void
}

// Convert form percent (0-100) to basis points (0-1_000_000_000)
function toBasisPoints(displayPercent: string): number {
  const pct = parseFloat(displayPercent) || 0
  return Math.floor((pct / 100) * 1_000_000_000)
}

// Build JBSplit struct from form data
// Note: JBController uses uint56 for projectId (not uint64 like JBSplits directly)
function buildSplit(split: FormSplit): {
  preferAddToBalance: boolean
  percent: number
  projectId: bigint
  beneficiary: `0x${string}`
  lockedUntil: number
  hook: `0x${string}`
} {
  return {
    preferAddToBalance: split.preferAddToBalance,
    percent: toBasisPoints(split.percent),
    projectId: BigInt(split.projectId || 0),
    beneficiary: (split.beneficiary || '0x0000000000000000000000000000000000000000') as `0x${string}`,
    lockedUntil: split.lockedUntil,
    hook: (split.hook || '0x0000000000000000000000000000000000000000') as `0x${string}`,
  }
}

export function useOmnichainSetSplits(
  options: UseOmnichainSetSplitsOptions = {}
): UseOmnichainSetSplitsReturn {
  const { onSuccess, onError } = options

  // Use refs for callbacks to avoid infinite loops
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onSuccessRef.current = onSuccess
    onErrorRef.current = onError
  })

  // Auth state
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  // Wallet state
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { address: managedAddress } = useManagedWallet()

  // Bundle state management
  const bundle = useRelayrBundle() as ReturnType<typeof useRelayrBundle> & {
    _initializeBundle: (
      bundleId: string,
      chainIds: number[],
      projectIds: Record<number, number>,
      paymentOptions: Array<{ chainId: number; token: string; amount: string; estimatedGas: string }>,
      synchronizedStartTime?: number,
      expiresAt?: number
    ) => void
    _setCreating: () => void
    _setProcessing: (txHash: string) => void
    _setError: (error: string) => void
  }
  const { bundleState, reset, setPaymentChain, updateFromStatus } = bundle

  // Status polling
  const { data: statusData } = useRelayrStatus({
    bundleId: bundleState.bundleId,
    enabled: bundleState.status === 'processing',
    stopOnComplete: true,
  })

  // Update bundle state from polling
  useEffect(() => {
    if (statusData) {
      updateFromStatus(statusData)
    }
  }, [statusData, updateFromStatus])

  // Call onSuccess when complete
  const hasCalledSuccessRef = useRef(false)
  useEffect(() => {
    if (bundleState.status === 'completed' && bundleState.bundleId && !hasCalledSuccessRef.current) {
      hasCalledSuccessRef.current = true
      const txHashes: Record<number, string> = {}
      bundleState.chainStates.forEach((cs: { chainId: number; txHash?: string }) => {
        if (cs.txHash) {
          txHashes[cs.chainId] = cs.txHash
        }
      })
      onSuccessRef.current?.(bundleState.bundleId, txHashes)
    }
    if (bundleState.status === 'idle') {
      hasCalledSuccessRef.current = false
    }
  }, [bundleState.status, bundleState.bundleId, bundleState.chainStates])

  // Call onError when failed
  const hasCalledErrorRef = useRef(false)
  useEffect(() => {
    if ((bundleState.status === 'failed' || bundleState.status === 'expired') && bundleState.error && !hasCalledErrorRef.current) {
      hasCalledErrorRef.current = true
      onErrorRef.current?.(bundleState.error)
    }
    if (bundleState.status === 'idle') {
      hasCalledErrorRef.current = false
    }
  }, [bundleState.status, bundleState.error])

  const setSplits = useCallback(async (params: {
    chainData: ChainSplitData[]
    payoutSplits: FormSplit[]
    reservedSplits: FormSplit[]
  }) => {
    const { chainData, payoutSplits, reservedSplits } = params

    // Validate wallet
    const activeAddress = isManagedMode ? managedAddress : address
    if (!activeAddress) {
      bundle._setError('Wallet not connected')
      return
    }

    bundle._setCreating()

    try {
      // Fetch controller address for each chain from JBDirectory
      console.log('Fetching controller addresses for each chain...')
      const chainDataWithControllers = await Promise.all(
        chainData.map(async (chain) => {
          const viemChain = VIEM_CHAINS[chain.chainId as SupportedChainId]
          if (!viemChain) {
            throw new Error(`Unsupported chain ID: ${chain.chainId}`)
          }

          const rpcUrls = RPC_ENDPOINTS[chain.chainId]
          if (!rpcUrls || rpcUrls.length === 0) {
            throw new Error(`No RPC endpoint configured for chain ${chain.chainId}`)
          }

          // Use fallback transport with all RPCs to handle timeouts
          const publicClient = createPublicClient({
            chain: viemChain,
            transport: fallback(rpcUrls.map(url => http(url))),
          }) as PublicClient

          const controller = await getProjectController(
            publicClient,
            BigInt(chain.projectId)
          )

          console.log(`Chain ${chain.chainId}: Project ${chain.projectId} uses controller ${controller}`)

          return {
            ...chain,
            controller,
          }
        })
      )

      // Build transactions for each chain using the controller
      const transactions = chainDataWithControllers.map(chain => {
        // Determine payout token based on baseCurrency
        const payoutToken = chain.baseCurrency === 2
          ? USDC_ADDRESSES[chain.chainId as SupportedChainId]
          : NATIVE_TOKEN

        // Build split groups
        const splitGroups: Array<{
          groupId: bigint
          splits: ReturnType<typeof buildSplit>[]
        }> = []

        // Add payout splits group (keyed by token address)
        const validPayoutSplits = payoutSplits.filter(s => s.percent && parseFloat(s.percent) > 0)
        if (validPayoutSplits.length > 0) {
          splitGroups.push({
            groupId: getPayoutSplitGroup(payoutToken),
            splits: validPayoutSplits.map(buildSplit),
          })
        }

        // Add reserved splits group (always group ID 1)
        const validReservedSplits = reservedSplits.filter(s => s.percent && parseFloat(s.percent) > 0)
        if (validReservedSplits.length > 0) {
          splitGroups.push({
            groupId: SPLIT_GROUP_RESERVED,
            splits: validReservedSplits.map(buildSplit),
          })
        }

        // Encode the setSplitGroupsOf call targeting the controller
        const calldata = encodeFunctionData({
          abi: JB_CONTROLLER_ABI,
          functionName: 'setSplitGroupsOf',
          args: [
            BigInt(chain.projectId),
            BigInt(chain.rulesetId),
            splitGroups,
          ],
        })

        return {
          chain: chain.chainId,
          target: chain.controller, // Use controller, not JBSplits
          data: calldata,
          value: '0',
        }
      })

      // Build projectIds mapping
      const projectIds: Record<number, number> = {}
      chainData.forEach(cd => {
        projectIds[cd.chainId] = cd.projectId
      })

      if (isManagedMode) {
        // MANAGED MODE: Create balance-sponsored bundle
        const bundleResponse = await createBalanceBundle({
          app_id: RELAYR_APP_ID,
          transactions,
          perform_simulation: true,
          virtual_nonce_mode: 'Disabled',
        })

        bundle._initializeBundle(
          bundleResponse.bundle_uuid,
          chainData.map(cd => cd.chainId),
          projectIds,
          []
        )
        bundle._setProcessing('sponsored')
      } else {
        // SELF-CUSTODY MODE: Create prepaid bundle
        if (!walletClient) {
          throw new Error('Wallet client not available')
        }

        const bundleResponse = await createPrepaidBundle({
          signer_address: activeAddress,
          transactions,
        })

        bundle._initializeBundle(
          bundleResponse.bundle_uuid,
          chainData.map(cd => cd.chainId),
          projectIds,
          bundleResponse.payment_options,
          undefined,
          bundleResponse.expires_at
        )
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create bundle'
      bundle._setError(errorMessage)
      onErrorRef.current?.(errorMessage)
    }
  }, [isManagedMode, managedAddress, address, walletClient, bundle])

  const isExecuting = bundleState.status === 'creating' ||
    bundleState.status === 'awaiting_payment' ||
    bundleState.status === 'processing'

  return useMemo(() => ({
    setSplits,
    bundleState,
    isExecuting,
    isComplete: bundleState.status === 'completed',
    hasError: bundleState.status === 'failed' || bundleState.status === 'partial' || bundleState.status === 'expired',
    reset,
    setPaymentChain,
  }), [
    setSplits,
    bundleState,
    isExecuting,
    reset,
    setPaymentChain,
  ])
}
