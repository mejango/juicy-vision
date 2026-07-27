/**
 * Hook for setting splits across multiple chains using Relayr bundling.
 * Calls setSplitGroupsOf on JBController (not JBSplits directly) for each chain.
 *
 * The controller is fetched from JBDirectory.controllerOf for each chain since
 * all projects use the single V6 controller set.
 */

import { useCallback, useEffect, useRef, useMemo } from 'react'
import { encodeFunctionData, createPublicClient, http, fallback, isAddress, type Address, type PublicClient } from 'viem'
import { useAuthStore } from '../../stores'
import { useManagedWallet, createManagedRelayrBundle, type RelayrTransaction } from '../useManagedWallet'
import { assertTransactionAccountUnchanged } from '../useReviewedTransactionAccount'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import type { BundleState } from './types'
import { JB_CONTROLLER_ABI } from '../../constants/abis/jbController'
import { SPLIT_GROUP_RESERVED } from '../../constants/abis/jbSplits'
import { RPC_ENDPOINTS, VIEM_CHAINS, type SupportedChainId } from '../../constants'
import { getProjectController } from '../../utils/paymentTerminal'
import { assertCurrentRulesetId } from '../../utils/projectTrust'
import { buildSplitGroup } from '../../utils/splitSafety'
import { fetchProjectSplits, type JBSplitData } from '../../services/bendystraw'
import { useGuardedTx } from '../useGuardedTx'

// Split data as used in the form
export interface FormSplit {
  percent: string // 0-100
  beneficiary: string
  projectId: string
  preferAddToBalance: boolean
  lockedUntil: number
  hook: string
  isNew?: boolean
}

// Chain data for setting splits
interface ChainSplitData {
  chainId: number
  projectId: number
  rulesetId: string
  baseCurrency: number
  payoutGroupId: string | null
  payoutSplits: JBSplitData[]
  reservedSplits: JBSplitData[]
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
}

export function submitManagedSplitsBundle(
  transactions: RelayrTransaction[],
  activeAddress: string,
  managedAddress: string,
  submit?: typeof createManagedRelayrBundle,
): Promise<{ bundleId: string }> {
  if (submit) return submit(transactions, activeAddress, managedAddress)
  return createManagedRelayrBundle(transactions, activeAddress, managedAddress)
}

/**
 * Pure transaction boundary for the controller's V6 setSplitGroupsOf call.
 * Keeping construction separate from RPC discovery lets tests pin the exact
 * project, ruleset, group IDs, and contract-shaped split tuples handed to the
 * reviewed/simulated Relayr path.
 */
export function buildSetSplitsTransaction(params: {
  chainId: number
  projectId: number
  rulesetId: string
  payoutGroupId: string | null
  payoutSplits: FormSplit[]
  reservedSplits: FormSplit[]
  controller: Address
}): {
  chain: number
  target: Address
  data: `0x${string}`
  value: '0'
} {
  if (!params.payoutGroupId) {
    throw new Error(`Payout split group unavailable on chain ${params.chainId}`)
  }
  const splitGroups = [
    {
      groupId: BigInt(params.payoutGroupId),
      splits: buildSplitGroup(params.payoutSplits, 'Payout splits', {
        kind: 'payout',
        sourceProjectId: params.projectId,
      }),
    },
    {
      groupId: SPLIT_GROUP_RESERVED,
      splits: buildSplitGroup(params.reservedSplits, 'Reserved-token splits', {
        kind: 'reserved',
        sourceProjectId: params.projectId,
      }),
    },
  ]

  return {
    chain: params.chainId,
    target: params.controller,
    data: encodeFunctionData({
      abi: JB_CONTROLLER_ABI,
      functionName: 'setSplitGroupsOf',
      args: [BigInt(params.projectId), BigInt(params.rulesetId), splitGroups],
    }),
    value: '0',
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

  const { address: managedAddress } = useManagedWallet()
  const latestManagedAddress = useRef(managedAddress)
  latestManagedAddress.current = managedAddress

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
    _setDirectCompleted: (
      chainId: number,
      projectId: number,
      txHash: string,
    ) => void
    _setError: (error: string) => void
  }
  const { bundleState, reset, updateFromStatus } = bundle
  const { run: runGuardedTx } = useGuardedTx()

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

    if (chainData.length === 0 || new Set(chainData.map(chain => chain.chainId)).size !== chainData.length) {
      bundle._setError('Split chains must be a non-empty unique list')
      return
    }

    // Validate wallet
    if (!isManagedMode || !managedAddress || !isAddress(managedAddress)) {
      bundle._setError('Omnichain split updates require an active managed account')
      return
    }
    const activeAddress = managedAddress
    const simulationAccount = managedAddress as Address

    try {
      const splitFingerprint = (split: JBSplitData) => [
        split.percent,
        split.projectId,
        split.beneficiary.toLowerCase(),
        split.preferAddToBalance,
        split.lockedUntil,
        split.hook.toLowerCase(),
      ].join(':')
      const assertReviewedSplitsUnchanged = async (chain: ChainSplitData) => {
        const fresh = await fetchProjectSplits(
          String(chain.projectId),
          chain.chainId,
          chain.rulesetId,
        )
        const matches = (left: JBSplitData[], right: JBSplitData[]) =>
          left.length === right.length && left.every((split, index) =>
            splitFingerprint(split) === splitFingerprint(right[index])
          )
        if (
          !matches(fresh.payoutSplits, chain.payoutSplits) ||
          !matches(fresh.reservedSplits, chain.reservedSplits)
        ) {
          throw new Error(`Splits changed on chain ${chain.chainId}. Reload before submitting.`)
        }
      }

      // Fetch controller address for each chain from JBDirectory
      console.log('Fetching controller addresses for each chain...')
      const chainDataWithControllers = await Promise.all(
        chainData.map(async (chain) => {
          await assertReviewedSplitsUnchanged(chain)
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
          await assertCurrentRulesetId({
            client: publicClient,
            projectId: BigInt(chain.projectId),
            expectedRulesetId: BigInt(chain.rulesetId),
          })

          console.log(`Chain ${chain.chainId}: Project ${chain.projectId} uses controller ${controller}`)

          return {
            ...chain,
            controller,
            publicClient,
          }
        })
      )

      // Build transactions for each chain using the controller
      const transactions = await Promise.all(chainDataWithControllers.map(async chain => {
        const transaction = buildSetSplitsTransaction({
          chainId: chain.chainId,
          projectId: chain.projectId,
          rulesetId: chain.rulesetId,
          payoutGroupId: chain.payoutGroupId,
          payoutSplits,
          reservedSplits,
          controller: chain.controller,
        })

        await chain.publicClient.call({
          account: simulationAccount,
          to: transaction.target,
          data: transaction.data,
        })

        return transaction
      }))

      // Close the gap between preview construction and handing the bundle to Relayr.
      await Promise.all(chainData.map(assertReviewedSplitsUnchanged))
      assertTransactionAccountUnchanged(activeAddress, latestManagedAddress.current)

      // Build projectIds mapping
      const projectIds: Record<number, number> = {}
      chainData.forEach(cd => {
        projectIds[cd.chainId] = cd.projectId
      })

      // Transactions are wrapped through SmartAccount.execute() so that
      // _msgSender() inside the target contract = smart account = project owner.
      console.log('=== SERVER SIGNING MODE (setSplits) ===')
      console.log(`Smart account routing: ${managedAddress}`)

      bundle._setCreating()

      const relayrTransactions: RelayrTransaction[] = transactions.map(tx => ({
        chainId: tx.chain,
        target: tx.target,
        data: tx.data,
        value: tx.value,
      }))

      assertTransactionAccountUnchanged(activeAddress, latestManagedAddress.current)
      if (relayrTransactions.length === 1) {
        const transaction = relayrTransactions[0]
        const reviewedChain = chainDataWithControllers[0]
        if (!transaction || !reviewedChain) {
          throw new Error('Missing single-chain split transaction')
        }
        const hash = await runGuardedTx({
          chainId: transaction.chainId,
          to: transaction.target as Address,
          data: transaction.data as `0x${string}`,
          value: BigInt(transaction.value),
          reverify: async () => {
            assertTransactionAccountUnchanged(activeAddress, latestManagedAddress.current)
            await assertReviewedSplitsUnchanged(reviewedChain)
            const currentController = await getProjectController(
              reviewedChain.publicClient,
              BigInt(reviewedChain.projectId),
            )
            if (currentController.toLowerCase() !== reviewedChain.controller.toLowerCase()) {
              throw new Error(`The project controller changed on chain ${reviewedChain.chainId}`)
            }
            await assertCurrentRulesetId({
              client: reviewedChain.publicClient,
              projectId: BigInt(reviewedChain.projectId),
              expectedRulesetId: BigInt(reviewedChain.rulesetId),
            })
          },
          review: {
            title: 'Review project split update',
            description: 'Review the exact single-chain split update before submitting it directly.',
            label: 'Set project splits',
            contractName: 'JBController',
          },
        })
        bundle._setDirectCompleted(
          transaction.chainId,
          reviewedChain.projectId,
          hash,
        )
        return
      }

      const result = await submitManagedSplitsBundle(
        relayrTransactions,
        activeAddress,
        managedAddress
      )

      bundle._initializeBundle(
        result.bundleId,
        chainData.map(cd => cd.chainId),
        projectIds,
        []
      )
      bundle._setProcessing('sponsored')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create bundle'
      bundle._setError(errorMessage)
      onErrorRef.current?.(errorMessage)
    }
  }, [isManagedMode, managedAddress, bundle, runGuardedTx])

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
  }), [
    setSplits,
    bundleState,
    isExecuting,
    reset,
  ])
}
