import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { encodeFunctionData, createPublicClient, http, isAddress, type Address } from 'viem'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { GasBalanceStatus } from './GasBalanceStatus'
import { useOmnichainQueueRuleset } from '../../hooks/relayr'
import { type JBRulesetConfig } from '../../services/relayr'
import { fetchProjectSplits } from '../../services/bendystraw'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifyQueueRulesetParams } from '../../utils/transactionVerification'
import { simulateTransaction, waitForSuccessfulTransaction } from '../../utils/transactionSafety'
import { RPC_ENDPOINTS, VIEM_CHAINS, type SupportedChainId } from '../../constants'
import {
  assertRulesetConfigurationTrusted,
  resolveRulesetQueueRoute,
} from '../../utils/projectTrust'
import {
  assertPreservedSplitGroups,
  assertRulesetConfigurationSafe,
} from '../../utils/rulesetSafety'
import { useReviewedTransactionAccount } from '../../hooks/useReviewedTransactionAccount'

// ABI for queueRulesetsOf
const CONTROLLER_QUEUE_RULESETS_ABI = [
  {
    name: 'queueRulesetsOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      {
        name: 'rulesetConfigurations',
        type: 'tuple[]',
        components: [
          { name: 'mustStartAtOrAfter', type: 'uint48' },
          { name: 'duration', type: 'uint32' },
          { name: 'weight', type: 'uint112' },
          { name: 'weightCutPercent', type: 'uint32' },
          { name: 'approvalHook', type: 'address' },
          {
            name: 'metadata',
            type: 'tuple',
            components: [
              { name: 'reservedPercent', type: 'uint16' },
              { name: 'cashOutTaxRate', type: 'uint16' },
              { name: 'baseCurrency', type: 'uint32' },
              { name: 'pausePay', type: 'bool' },
              { name: 'pauseCreditTransfers', type: 'bool' },
              { name: 'allowOwnerMinting', type: 'bool' },
              { name: 'allowSetCustomToken', type: 'bool' },
              { name: 'allowTerminalMigration', type: 'bool' },
              { name: 'allowSetTerminals', type: 'bool' },
              { name: 'allowSetController', type: 'bool' },
              { name: 'allowAddAccountingContext', type: 'bool' },
              { name: 'allowAddPriceFeed', type: 'bool' },
              { name: 'ownerMustSendPayouts', type: 'bool' },
              { name: 'holdFees', type: 'bool' },
              { name: 'scopeCashOutsToLocalBalances', type: 'bool' },
              { name: 'useDataHookForPay', type: 'bool' },
              { name: 'useDataHookForCashOut', type: 'bool' },
              { name: 'dataHook', type: 'address' },
              { name: 'metadata', type: 'uint16' },
            ],
          },
          {
            name: 'splitGroups',
            type: 'tuple[]',
            components: [
              { name: 'groupId', type: 'uint256' },
              {
                name: 'splits',
                type: 'tuple[]',
                components: [
                  { name: 'percent', type: 'uint32' },
                  { name: 'projectId', type: 'uint64' },
                  { name: 'beneficiary', type: 'address' },
                  { name: 'preferAddToBalance', type: 'bool' },
                  { name: 'lockedUntil', type: 'uint48' },
                  { name: 'hook', type: 'address' },
                ],
              },
            ],
          },
          {
            name: 'fundAccessLimitGroups',
            type: 'tuple[]',
            components: [
              { name: 'terminal', type: 'address' },
              { name: 'token', type: 'address' },
              {
                name: 'payoutLimits',
                type: 'tuple[]',
                components: [
                  { name: 'amount', type: 'uint224' },
                  { name: 'currency', type: 'uint32' },
                ],
              },
              {
                name: 'surplusAllowances',
                type: 'tuple[]',
                components: [
                  { name: 'amount', type: 'uint224' },
                  { name: 'currency', type: 'uint32' },
                ],
              },
            ],
          },
        ],
      },
      { name: 'memo', type: 'string' },
    ],
    outputs: [{ name: 'rulesetId', type: 'uint256' }],
  },
] as const

const CHAIN_INFO: Record<number, { name: string; shortName: string; color: string }> = {
  1: { name: 'Ethereum', shortName: 'ETH', color: '#627EEA' },
  10: { name: 'Optimism', shortName: 'OP', color: '#FF0420' },
  8453: { name: 'Base', shortName: 'BASE', color: '#0052FF' },
  42161: { name: 'Arbitrum', shortName: 'ARB', color: '#28A0F0' },
}

const EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  8453: 'https://basescan.org/tx/',
  42161: 'https://arbiscan.io/tx/',
}

interface ChainRulesetData {
  chainId: number
  projectId: number
  currentRulesetId: string
  expectedQueueTarget: Address
}

interface QueueRulesetModalProps {
  isOpen: boolean
  onClose: () => void
  projectName?: string
  chainRulesetData: ChainRulesetData[]
  rulesetConfigsByChain: Record<number, JBRulesetConfig>
  synchronizedStartTime: number
  memo: string
  // Transaction status callbacks for persistence
  onConfirmed?: (txHashes: Record<number, string>, bundleId?: string) => void
  onError?: (error: string) => void
}

type ChainStatus = 'pending' | 'signing' | 'submitted' | 'confirmed' | 'failed'

interface ChainTxState {
  chainId: number
  projectId: number
  status: ChainStatus
  txHash?: string
  error?: string
}

export default function QueueRulesetModal({
  isOpen,
  onClose,
  projectName,
  chainRulesetData,
  rulesetConfigsByChain,
  synchronizedStartTime,
  memo,
  onConfirmed,
  onError,
}: QueueRulesetModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const { addTransaction, updateTransaction } = useTransactionStore()
  const { totalEth, perChain, loading: balancesLoading, available: balancesAvailable } = useWalletBalances()

  // Managed mode support
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address: managedAddress } = useManagedWallet()
  const reviewedActiveAddress = isManagedMode ? managedAddress : address
  const { assertCurrentAccount } = useReviewedTransactionAccount(
    isOpen,
    reviewedActiveAddress,
    isManagedMode ? 'managed' : 'self_custody',
  )

  // State for legacy mode (single chain at a time)
  const [chainStates, setChainStates] = useState<ChainTxState[]>([])
  const [currentChainIndex, setCurrentChainIndex] = useState<number>(-1)
  const [isStarted, setIsStarted] = useState(false)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)

  // Queue targets are resolved from the live controller and current data-hook route.
  const [queueTargets, setQueueTargets] = useState<Record<number, Address>>({})
  const [controllersLoading, setControllersLoading] = useState(false)
  const [controllerError, setControllerError] = useState<string | null>(null)

  // Relayr omnichain mode
  const [useOmnichain, setUseOmnichain] = useState(false)
  const {
    queue,
    bundleState,
    isExecuting,
    isComplete: omnichainComplete,
    hasError: omnichainError,
    reset: resetOmnichain,
  } = useOmnichainQueueRuleset({
    onSuccess: (bundleId, txHashes) => {
      console.log('Omnichain queue completed:', bundleId, txHashes)
    },
    onError: (error) => {
      console.error('Omnichain queue failed:', error)
    },
  })

  const hasGasBalance = isManagedMode || (balancesAvailable && (useOmnichain
    ? perChain.some(balance => balance.eth > 0n)
    : chainRulesetData.every(chainData =>
        (perChain.find(balance => balance.chainId === chainData.chainId)?.eth ?? 0n) > 0n
      )))
  const isOmnichain = chainRulesetData.length > 1
  const startDate = new Date(synchronizedStartTime * 1000)
  const primaryRulesetConfig = rulesetConfigsByChain[chainRulesetData[0]?.chainId]

  // Verify transaction parameters
  const verificationResult = useMemo(() => {
    const results = chainRulesetData.map(chainData => verifyQueueRulesetParams({
      projectId: chainData.projectId,
      rulesetConfigurations: rulesetConfigsByChain[chainData.chainId]
        ? [rulesetConfigsByChain[chainData.chainId]]
        : [],
      memo,
    }))
    return {
      isValid: results.every(result => result.isValid),
      doubts: results.flatMap(result => result.doubts),
      warnings: results.flatMap(result => result.warnings),
      verifiedParams: results[0]?.verifiedParams || {},
    }
  }, [chainRulesetData, rulesetConfigsByChain, memo])

  const hasWarnings = verificationResult.doubts.length > 0
  const hasCriticalDoubts = verificationResult.doubts.some(d => d.severity === 'critical')
  const allQueueTargetsLoaded = chainRulesetData.every(cd => queueTargets[cd.chainId])
  const canProceed = hasGasBalance && !hasCriticalDoubts && (!hasWarnings || warningsAcknowledged) && allQueueTargetsLoaded && !controllersLoading && !controllerError

  // Derive chain states from bundle state when in omnichain mode
  const effectiveChainStates = useOmnichain && bundleState.bundleId
    ? bundleState.chainStates.map(cs => ({
        chainId: cs.chainId,
        projectId: cs.projectId || chainRulesetData.find(cd => cd.chainId === cs.chainId)?.projectId || 0,
        status: cs.status as ChainStatus,
        txHash: cs.txHash,
        error: cs.error,
      }))
    : chainStates

  // All chains completed (success or fail)
  const allCompleted = useOmnichain
    ? omnichainComplete || omnichainError
    : chainStates.length > 0 && chainStates.every(cs => cs.status === 'confirmed' || cs.status === 'failed')
  const anyFailed = useOmnichain
    ? omnichainError
    : chainStates.some(cs => cs.status === 'failed')
  const allSucceeded = useOmnichain
    ? omnichainComplete
    : chainStates.length > 0 && chainStates.every(cs => cs.status === 'confirmed')

  // Call parent callbacks when transactions complete (for persistence)
  useEffect(() => {
    if (allSucceeded) {
      const txHashes: Record<number, string> = {}
      if (useOmnichain) {
        bundleState.chainStates.forEach(cs => {
          if (cs.txHash) txHashes[cs.chainId] = cs.txHash
        })
        onConfirmed?.(txHashes, bundleState.bundleId || undefined)
      } else {
        chainStates.forEach(cs => {
          if (cs.txHash) txHashes[cs.chainId] = cs.txHash
        })
        onConfirmed?.(txHashes)
      }
    } else if (anyFailed) {
      const failedChain = useOmnichain
        ? bundleState.chainStates.find(cs => cs.status === 'failed')
        : chainStates.find(cs => cs.status === 'failed')
      onError?.(failedChain?.error || 'Transaction failed')
    }
  }, [allSucceeded, anyFailed, useOmnichain, bundleState.chainStates, bundleState.bundleId, chainStates, onConfirmed, onError])

  // Initialize chain states
  useEffect(() => {
    if (isOpen) {
      setChainStates(
        chainRulesetData.map(cd => ({
          chainId: cd.chainId,
          projectId: cd.projectId,
          status: 'pending',
        }))
      )
      setCurrentChainIndex(-1)
      setIsStarted(false)
      setWarningsAcknowledged(false)
      resetOmnichain()
      setUseOmnichain(isManagedMode && isOmnichain)
    }
  }, [isOpen, chainRulesetData, isManagedMode, isOmnichain, resetOmnichain])

  // Resolve the live queue route for all chains.
  useEffect(() => {
    if (!isOpen || chainRulesetData.length === 0) {
      setQueueTargets({})
      setControllerError(null)
      return
    }

    const fetchQueueTargets = async () => {
      setControllersLoading(true)
      setControllerError(null)
      const addresses: Record<number, Address> = {}

      try {
        for (const cd of chainRulesetData) {
          const chain = VIEM_CHAINS[cd.chainId as SupportedChainId]
          if (!chain) throw new Error(`Unsupported chain ${cd.chainId}`)

          const rpcUrl = RPC_ENDPOINTS[cd.chainId]?.[0]
          if (!rpcUrl) throw new Error(`No RPC endpoint for chain ${cd.chainId}`)

          const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
          })

          const route = await resolveRulesetQueueRoute({
            client: publicClient,
            projectId: BigInt(cd.projectId),
            expectedRulesetId: BigInt(cd.currentRulesetId),
          })
          if (route.target.toLowerCase() !== cd.expectedQueueTarget.toLowerCase()) {
            throw new Error(`The project queue route changed on chain ${cd.chainId}`)
          }
          addresses[cd.chainId] = route.target
        }
        setQueueTargets(addresses)
      } catch (err) {
        console.error('Failed to resolve ruleset queue targets:', err)
        setControllerError(err instanceof Error ? err.message : 'Failed to resolve the project ruleset queue route')
      } finally {
        setControllersLoading(false)
      }
    }

    fetchQueueTargets()
  }, [isOpen, chainRulesetData])

  const updateChainState = useCallback((chainId: number, update: Partial<ChainTxState>) => {
    setChainStates(prev =>
      prev.map(cs =>
        cs.chainId === chainId
          ? { ...cs, ...update }
          : cs
      )
    )
  }, [])

  // Convert ruleset config to contract format
  const buildRulesetArgs = useCallback((chainId: number) => {
    const rulesetConfig = rulesetConfigsByChain[chainId]
    if (!rulesetConfig) throw new Error(`Ruleset configuration missing for chain ${chainId}`)
    return [{
      mustStartAtOrAfter: rulesetConfig.mustStartAtOrAfter,
      duration: rulesetConfig.duration,
      weight: BigInt(rulesetConfig.weight),
      weightCutPercent: rulesetConfig.weightCutPercent,
      approvalHook: rulesetConfig.approvalHook as `0x${string}`,
      metadata: {
        reservedPercent: rulesetConfig.metadata.reservedPercent,
        cashOutTaxRate: rulesetConfig.metadata.cashOutTaxRate,
        baseCurrency: rulesetConfig.metadata.baseCurrency,
        pausePay: rulesetConfig.metadata.pausePay,
        pauseCreditTransfers: rulesetConfig.metadata.pauseCreditTransfers,
        allowOwnerMinting: rulesetConfig.metadata.allowOwnerMinting,
        allowSetCustomToken: rulesetConfig.metadata.allowSetCustomToken,
        allowTerminalMigration: rulesetConfig.metadata.allowTerminalMigration,
        allowSetTerminals: rulesetConfig.metadata.allowSetTerminals,
        allowSetController: rulesetConfig.metadata.allowSetController,
        allowAddAccountingContext: rulesetConfig.metadata.allowAddAccountingContext,
        allowAddPriceFeed: rulesetConfig.metadata.allowAddPriceFeed,
        ownerMustSendPayouts: rulesetConfig.metadata.ownerMustSendPayouts,
        holdFees: rulesetConfig.metadata.holdFees,
        scopeCashOutsToLocalBalances: rulesetConfig.metadata.scopeCashOutsToLocalBalances,
        useDataHookForPay: rulesetConfig.metadata.useDataHookForPay,
        useDataHookForCashOut: rulesetConfig.metadata.useDataHookForCashOut,
        dataHook: rulesetConfig.metadata.dataHook as `0x${string}`,
        metadata: rulesetConfig.metadata.metadata,
      },
      splitGroups: rulesetConfig.splitGroups.map(sg => ({
        groupId: BigInt(sg.groupId),
        splits: sg.splits.map(s => ({
          percent: s.percent,
          projectId: BigInt(s.projectId),
          beneficiary: s.beneficiary as `0x${string}`,
          preferAddToBalance: s.preferAddToBalance,
          lockedUntil: Number(s.lockedUntil),
          hook: s.hook as `0x${string}`,
        })),
      })),
      fundAccessLimitGroups: rulesetConfig.fundAccessLimitGroups.map(fg => ({
        terminal: fg.terminal as `0x${string}`,
        token: fg.token as `0x${string}`,
        payoutLimits: fg.payoutLimits.map(pl => ({
          amount: BigInt(pl.amount),
          currency: pl.currency,
        })),
        surplusAllowances: fg.surplusAllowances.map(sa => ({
          amount: BigInt(sa.amount),
          currency: sa.currency,
        })),
      })),
    }]
  }, [rulesetConfigsByChain])

  const validateFreshChainConfiguration = useCallback(async (chainData: ChainRulesetData) => {
    const chain = VIEM_CHAINS[chainData.chainId as SupportedChainId]
    const rpcUrl = RPC_ENDPOINTS[chainData.chainId]?.[0]
    if (!chain || !rpcUrl) throw new Error(`Unsupported chain ${chainData.chainId}`)
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    const route = await resolveRulesetQueueRoute({
      client: publicClient,
      projectId: BigInt(chainData.projectId),
      expectedRulesetId: BigInt(chainData.currentRulesetId),
    })
    if (route.target.toLowerCase() !== chainData.expectedQueueTarget.toLowerCase()) {
      throw new Error(`The project queue route changed on chain ${chainData.chainId}`)
    }
    const config = rulesetConfigsByChain[chainData.chainId]
    if (!config) throw new Error(`Ruleset configuration missing for chain ${chainData.chainId}`)
    if (
      config.metadata.dataHook.toLowerCase() !== route.dataHook.toLowerCase() ||
      config.metadata.useDataHookForPay !== route.useDataHookForPay ||
      config.metadata.useDataHookForCashOut !== route.useDataHookForCashOut
    ) {
      throw new Error(`The project hook route changed on chain ${chainData.chainId}`)
    }
    const freshConfiguration = await fetchProjectSplits(
      String(chainData.projectId),
      chainData.chainId,
      chainData.currentRulesetId,
    )
    if (!freshConfiguration.configurationComplete) {
      throw new Error(`Could not verify the latest split configuration on chain ${chainData.chainId}`)
    }
    assertRulesetConfigurationSafe(
      chainData.chainId,
      config,
      freshConfiguration.accountingContexts || [],
    )
    assertPreservedSplitGroups(config.splitGroups, freshConfiguration.splitGroups || [])
    await assertRulesetConfigurationTrusted({
      client: publicClient,
      projectId: BigInt(chainData.projectId),
      rulesetId: BigInt(chainData.currentRulesetId),
      approvalHook: config.approvalHook,
      dataHook: route.dataHook,
      splitGroups: config.splitGroups,
    })
    return route.target
  }, [rulesetConfigsByChain])

  // Queue ruleset on a single chain (legacy mode)
  const queueOnChain = useCallback(async (chainData: ChainRulesetData) => {
    if (isManagedMode) {
      if (!managedAddress) {
        throw new Error('Managed wallet not available')
      }
    } else {
      if (!walletClient || !address) {
        throw new Error('Wallet not connected')
      }
    }

    const chain = VIEM_CHAINS[chainData.chainId as SupportedChainId]
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainData.chainId}`)
    }

    try {
      assertCurrentAccount(isManagedMode ? undefined : walletClient?.account?.address)
      const queueTarget = await validateFreshChainConfiguration(chainData)

      const rulesetArgs = buildRulesetArgs(chainData.chainId)

      const callData = encodeFunctionData({
        abi: CONTROLLER_QUEUE_RULESETS_ABI,
        functionName: 'queueRulesetsOf',
        args: [
          BigInt(chainData.projectId),
          rulesetArgs,
          memo,
        ],
      })

      const activeAddress = (isManagedMode ? managedAddress : address) as Address | undefined
      if (!activeAddress || !isAddress(activeAddress)) throw new Error('Active wallet address is invalid')
      await simulateTransaction({
        chainId: chainData.chainId,
        account: activeAddress,
        to: queueTarget,
        data: callData,
      })

      const txId = addTransaction({
        type: 'deploy',
        projectId: String(chainData.projectId),
        chainId: chainData.chainId,
        amount: '0',
        status: 'pending',
      })

      let hash: string

      if (isManagedMode) {
        assertCurrentAccount()
        updateChainState(chainData.chainId, { status: 'submitted' })
        hash = await executeManagedTransaction(chainData.chainId, queueTarget, callData, '0')
      } else {
        updateChainState(chainData.chainId, { status: 'signing' })
        await switchChainAsync({ chainId: chainData.chainId })
        if (await walletClient!.getChainId() !== chainData.chainId) {
          throw new Error(`Wallet did not switch to chain ${chainData.chainId}`)
        }
        const finalQueueTarget = await validateFreshChainConfiguration(chainData)
        if (finalQueueTarget.toLowerCase() !== queueTarget.toLowerCase()) {
          throw new Error(`The project queue route changed on chain ${chainData.chainId}`)
        }
        await simulateTransaction({
          chainId: chainData.chainId,
          account: activeAddress,
          to: finalQueueTarget,
          data: callData,
        })
        assertCurrentAccount(walletClient!.account?.address)
        hash = await walletClient!.sendTransaction({
          to: finalQueueTarget,
          data: callData,
          value: 0n,
        })
        updateChainState(chainData.chainId, { status: 'submitted', txHash: hash })
      }

      updateTransaction(txId, { hash, status: 'submitted' })
      if (!isManagedMode) await waitForSuccessfulTransaction(chainData.chainId, hash as `0x${string}`)
      updateChainState(chainData.chainId, { status: 'confirmed', txHash: hash })

      return hash
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed'
      updateChainState(chainData.chainId, { status: 'failed', error: errorMessage })
      throw err
    }
  }, [walletClient, address, memo, buildRulesetArgs, addTransaction, updateTransaction, updateChainState, switchChainAsync, isManagedMode, managedAddress, validateFreshChainConfiguration, assertCurrentAccount])

  // Start the queuing process
  const handleStart = useCallback(async () => {
    const activeAddress = isManagedMode ? managedAddress : address
    if (!activeAddress || chainRulesetData.length === 0) return

    try {
      assertCurrentAccount(isManagedMode ? undefined : walletClient?.account?.address)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The reviewed account could not be verified'
      setControllerError(message)
      onError?.(message)
      return
    }

    if (useOmnichain && isOmnichain) {
      try {
        const freshQueueTargets = Object.fromEntries(await Promise.all(
          chainRulesetData.map(async chainData => [
            chainData.chainId,
            await validateFreshChainConfiguration(chainData),
          ] as const),
        ))
        setIsStarted(true)
        const projectIds: Record<number, number> = {}
        chainRulesetData.forEach(cd => {
          projectIds[cd.chainId] = cd.projectId
        })
        assertCurrentAccount()
        await queue({
          chainIds: chainRulesetData.map(cd => cd.chainId),
          projectIds,
          rulesetConfigurationsByChain: Object.fromEntries(
            chainRulesetData.map(cd => [cd.chainId, [rulesetConfigsByChain[cd.chainId]]])
          ),
          queueTargets: freshQueueTargets,
          memo,
          mustStartAtOrAfter: synchronizedStartTime,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Ruleset configuration could not be verified'
        setControllerError(message)
        onError?.(message)
      }
    } else {
      setIsStarted(true)
      // Legacy: process chains sequentially
      for (let i = 0; i < chainRulesetData.length; i++) {
        setCurrentChainIndex(i)
        try {
          await queueOnChain(chainRulesetData[i])
        } catch (err) {
          console.error(`Queue failed on chain ${chainRulesetData[i].chainId}:`, err)
        }
      }
      setCurrentChainIndex(-1)
    }
  }, [walletClient, address, chainRulesetData, queueOnChain, isManagedMode, managedAddress, useOmnichain, isOmnichain, queue, rulesetConfigsByChain, memo, synchronizedStartTime, validateFreshChainConfiguration, onError, assertCurrentAccount])

  const handleClose = useCallback(() => {
    resetOmnichain()
    onClose()
  }, [resetOmnichain, onClose])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={!isStarted || allCompleted ? handleClose : undefined}
      />

      {/* Modal */}
      <div className={`relative w-full max-w-md border ${
        isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${
          isDark ? 'border-white/10' : 'border-gray-100'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center text-xl ${
              allSucceeded
                ? 'bg-green-500/20'
                : anyFailed
                  ? 'bg-red-500/20'
                  : isDark ? 'bg-purple-500/20' : 'bg-purple-100'
            }`}>
              {allSucceeded ? '✓' : anyFailed ? '!' : '⚙️'}
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {allSucceeded
                  ? 'Ruleset Queued'
                  : anyFailed && allCompleted
                    ? 'Some Queues Failed'
                    : isStarted
                      ? 'Queueing Ruleset...'
                      : 'Confirm Queue Ruleset'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {projectName || 'Project'}
              </p>
            </div>
          </div>
          {(!isStarted || allCompleted) && (
            <button
              onClick={handleClose}
              className={`p-2 transition-colors ${
                isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Synchronized Start Time */}
          <div className={`p-3 ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
            <div className={`text-xs font-medium ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>
              Synchronized Start Time
            </div>
            <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {startDate.toLocaleString()}
            </div>
            {isOmnichain && (
              <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                All chains will activate at the same time
              </div>
            )}
          </div>

          {/* Chain Status */}
          <div className="space-y-2">
            {effectiveChainStates.map((cs, idx) => {
              const chainInfo = CHAIN_INFO[cs.chainId]
              const isCurrent = idx === currentChainIndex

              return (
                <div
                  key={cs.chainId}
                  className={`p-3 flex items-center justify-between ${
                    isCurrent
                      ? isDark ? 'bg-purple-500/20 border border-purple-500/50' : 'bg-purple-100 border border-purple-300'
                      : isDark ? 'bg-white/5' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: chainInfo?.color || '#888' }}
                    />
                    <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {chainInfo?.name || `Chain ${cs.chainId}`}
                    </span>
                    <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Project #{cs.projectId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {cs.status === 'pending' && (
                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Waiting...
                      </span>
                    )}
                    {cs.status === 'signing' && (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full" />
                        <span className={`text-xs ${isDark ? 'text-purple-300' : 'text-purple-600'}`}>
                          Sign in wallet
                        </span>
                      </div>
                    )}
                    {cs.status === 'submitted' && (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin w-3 h-3 border-2 border-juice-cyan border-t-transparent rounded-full" />
                        <span className={`text-xs ${isDark ? 'text-juice-cyan' : 'text-cyan-600'}`}>
                          Confirming...
                        </span>
                      </div>
                    )}
                    {cs.status === 'confirmed' && (
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">✓</span>
                        {cs.txHash && (
                          <a
                            href={`${EXPLORER_URLS[cs.chainId]}${cs.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-juice-cyan hover:underline"
                          >
                            View
                          </a>
                        )}
                      </div>
                    )}
                    {cs.status === 'failed' && (
                      <span className="text-xs text-red-400">
                        Failed
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Error details */}
          {anyFailed && (
            <div className={`p-3 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              {effectiveChainStates.filter(cs => cs.status === 'failed').map(cs => (
                <div key={cs.chainId} className="text-xs">
                  <span className={isDark ? 'text-red-400' : 'text-red-600'}>
                    {CHAIN_INFO[cs.chainId]?.name || `Chain ${cs.chainId}`}:
                  </span>
                  <span className={`ml-1 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>
                    {cs.error || bundleState.error || 'Unknown error'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Pre-queue info */}
          {!isStarted && (
            <>
              {/* Gas balance check */}
              <GasBalanceStatus
                balance={totalEth}
                hasGasBalance={hasGasBalance}
                loading={balancesLoading}
                available={balancesAvailable}
                managed={isManagedMode}
                isDark={isDark}
              />

              {controllersLoading && (
                <div className={`p-3 text-sm flex items-center gap-2 ${isDark ? 'bg-purple-500/10 text-purple-300' : 'bg-purple-50 text-purple-600'}`}>
                  <div className="animate-spin w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full" />
                  Loading controller addresses...
                </div>
              )}

              {controllerError && (
                <div className={`p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
                  {controllerError}
                </div>
              )}

              {isOmnichain && !useOmnichain && (
                <div className={`p-3 text-sm ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                  You will need to sign {chainRulesetData.length} transactions, one for each chain.
                </div>
              )}

              {isOmnichain && useOmnichain && (
                <div className={`p-3 text-sm ${isDark ? 'bg-green-500/10 text-green-300' : 'bg-green-50 text-green-700'}`}>
                  Sign once to queue on all {chainRulesetData.length} chains via Relayr
                </div>
              )}

              {/* Transaction Summary */}
              <TransactionSummary
                type="queueRuleset"
                details={{
                  projectId: chainRulesetData[0]?.projectId?.toString() || '',
                  projectName,
                  effectiveDate: startDate.toLocaleString(),
                  changes: [
                    { field: 'Duration', to: primaryRulesetConfig?.duration ? `${primaryRulesetConfig.duration / 86400} days` : 'Ongoing' },
                    { field: 'Token issuance', to: `${primaryRulesetConfig?.weight || '0'} tokens/unit` },
                    { field: 'Reserved rate', to: `${((primaryRulesetConfig?.metadata.reservedPercent || 0) / 100).toFixed(1)}%` },
                    { field: 'Cash-out curve rate', to: `${((primaryRulesetConfig?.metadata.cashOutTaxRate || 0) / 100).toFixed(1)}%` },
                  ],
                }}
                isDark={isDark}
              />

              {/* Transaction Warning */}
              {hasWarnings && (
                <TransactionWarning
                  doubts={verificationResult.doubts}
                  onConfirm={() => setWarningsAcknowledged(true)}
                  onCancel={handleClose}
                  isDark={isDark}
                />
              )}

              {/* Technical Details */}
              <TechnicalDetails
                contract="Verified ruleset queue target"
                contractAddress={queueTargets[chainRulesetData[0]?.chainId] || '0x...'}
                functionName="queueRulesetsOf"
                chainId={chainRulesetData[0]?.chainId || 1}
                projectId={chainRulesetData[0]?.projectId?.toString()}
                parameters={verificationResult.verifiedParams}
                isDark={isDark}
                allChains={isOmnichain ? chainRulesetData.map(cd => ({
                  chainId: cd.chainId,
                  chainName: CHAIN_INFO[cd.chainId]?.name || `Chain ${cd.chainId}`,
                  projectId: cd.projectId,
                })) : undefined}
              />
            </>
          )}

          {/* Processing indicator for omnichain */}
          {isExecuting && (
            <div className={`p-3 flex items-center gap-3 ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-juice-cyan border-t-transparent rounded-full" />
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {bundleState.status === 'creating' ? 'Creating bundle...' :
                   bundleState.status === 'awaiting_payment' ? 'Awaiting payment...' :
                   'Processing transactions...'}
                </p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Relayr is executing on all chains
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          {!isStarted && (
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className={`flex-1 py-3 font-medium border-2 transition-colors ${
                  isDark
                    ? 'border-white/20 text-white hover:bg-white/10'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleStart}
                disabled={!canProceed}
                className="flex-1 py-3 font-bold bg-purple-500 text-white hover:bg-purple-500/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Queue{isOmnichain ? ` on ${chainRulesetData.length} Chains` : ''}
              </button>
            </div>
          )}

          {isStarted && !allCompleted && !isExecuting && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Please sign each transaction in your wallet
            </div>
          )}

          {isExecuting && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Do not close this window
            </div>
          )}

          {allCompleted && (
            <button
              onClick={handleClose}
              className="w-full py-3 font-medium bg-purple-500 text-white hover:bg-purple-500/90 transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
