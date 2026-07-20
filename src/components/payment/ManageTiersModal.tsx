import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { formatUnits, type Chain, createPublicClient, http } from 'viem'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { GasBalanceStatus } from './GasBalanceStatus'
import {
  encodeAdjustTiers,
  encodeSetDiscountPercentsOf,
  type JB721DiscountPercentConfig,
  type JB721TierConfigInput,
} from '../../services/tiersHook'
import {
  getProjectDataHook,
  requireRecognized721Hook,
  type JB721HookFlags,
} from '../../services/nft'
import TechnicalDetails from '../shared/TechnicalDetails'
import ChainStatusRow from './ChainStatusRow'
import { ALL_VIEM_CHAINS, CHAINS as CHAIN_INFO, RPC_ENDPOINTS } from '../../constants'
import { simulateTransaction, waitForSuccessfulTransaction } from '../../utils/transactionSafety'
import { isUsdcCurrency } from '../../utils/technicalDetails'
import { useReviewedTransactionAccount } from '../../hooks/useReviewedTransactionAccount'
import { txErrorMessage } from '../../utils/txErrors'

const CHAINS: Record<number, Chain> = ALL_VIEM_CHAINS

interface TierMetadata {
  name: string
  description?: string
  image?: string
  categoryName?: string
}

interface ChainHookData {
  chainId: number
  projectId: number
  hookAddress: `0x${string}` | null
  flags: JB721HookFlags | null
  selected: boolean
}

interface PendingChanges {
  tiersToAdd: Array<{ config: JB721TierConfigInput; metadata: TierMetadata }>
  tierIdsToRemove: number[]
  discountPercents: JB721DiscountPercentConfig[]
}

interface ManageTiersModalProps {
  isOpen: boolean
  onClose: () => void
  projectName?: string
  chainHookData: ChainHookData[]
  pendingChanges: PendingChanges
  pricingCurrency: number
  pricingDecimals: number
  onComplete?: (txHash?: string) => void
  onError?: (error: string) => void
}

type ChainStatus = 'pending' | 'authorizing' | 'submitted' | 'confirmed' | 'failed'

interface ChainTxState {
  chainId: number
  projectId: number
  hookAddress: `0x${string}`
  status: ChainStatus
  txHash?: string
  error?: string
}

export default function ManageTiersModal({
  isOpen,
  onClose,
  projectName,
  chainHookData,
  pendingChanges,
  pricingCurrency,
  pricingDecimals,
  onComplete,
  onError,
}: ManageTiersModalProps) {
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

  // Transaction state
  const [chainStates, setChainStates] = useState<ChainTxState[]>([])
  const [currentChainIndex, setCurrentChainIndex] = useState<number>(-1)
  const [isStarted, setIsStarted] = useState(false)

  // Filter to only chains with hooks
  const validChainData = useMemo(() =>
    chainHookData.filter(cd => cd.hookAddress && cd.selected),
    [chainHookData]
  )

  const hasGasBalance = isManagedMode || (balancesAvailable && validChainData.every(chainData =>
    (perChain.find(balance => balance.chainId === chainData.chainId)?.eth || 0n) > 0n
  ))
  const isOmnichain = validChainData.length > 1

  // Summary of changes
  const changeSummary = useMemo(() => {
    const adds = pendingChanges.tiersToAdd.length
    const removes = pendingChanges.tierIdsToRemove.length
    const discounts = pendingChanges.discountPercents.length
    const transactionsPerChain = Number(adds + removes > 0) + Number(discounts > 0)
    return { adds, removes, discounts, total: adds + removes + discounts, transactionsPerChain }
  }, [pendingChanges])
  const pricingLabel = pricingCurrency === 2 || isUsdcCurrency(pricingCurrency) ? 'USD' : 'ETH'

  // All chains completed
  const allCompleted = chainStates.length > 0 && chainStates.every(
    cs => cs.status === 'confirmed' || cs.status === 'failed'
  )
  const anyFailed = chainStates.some(cs => cs.status === 'failed')
  const allSucceeded = chainStates.length > 0 && chainStates.every(cs => cs.status === 'confirmed')

  const canProceed = hasGasBalance && validChainData.length > 0 && changeSummary.total > 0

  // Call parent callbacks when transactions complete (for persistence)
  useEffect(() => {
    if (allSucceeded && isStarted) {
      const firstTxHash = chainStates.find(cs => cs.txHash)?.txHash
      onComplete?.(firstTxHash)
    } else if (anyFailed && isStarted) {
      const failedChain = chainStates.find(cs => cs.status === 'failed')
      onError?.(failedChain?.error || 'Transaction failed')
    }
  }, [allSucceeded, anyFailed, isStarted, chainStates, onComplete, onError])

  // Initialize chain states
  useEffect(() => {
    if (isOpen) {
      setChainStates(
        validChainData.map(cd => ({
          chainId: cd.chainId,
          projectId: cd.projectId,
          hookAddress: cd.hookAddress!,
          status: 'pending',
        }))
      )
      setCurrentChainIndex(-1)
      setIsStarted(false)
    }
  }, [isOpen, validChainData])

  const updateChainState = useCallback((chainId: number, update: Partial<ChainTxState>) => {
    setChainStates(prev =>
      prev.map(cs =>
        cs.chainId === chainId ? { ...cs, ...update } : cs
      )
    )
  }, [])

  // Execute the reviewed tier operations on a single chain.
  const updateTiersOnChain = useCallback(async (chainState: ChainTxState) => {
    if (isManagedMode) {
      if (!managedAddress) {
        throw new Error('Managed wallet not available')
      }
    } else {
      if (!walletClient || !address) {
        throw new Error('Wallet not connected')
      }
    }

    const chain = CHAINS[chainState.chainId]
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainState.chainId}`)
    }

    try {
      assertCurrentAccount(isManagedMode ? undefined : walletClient?.account?.address)
      const rpcUrl = RPC_ENDPOINTS[chainState.chainId]?.[0]
      if (!rpcUrl) {
        throw new Error(`No RPC endpoint configured for chain ${chainState.chainId}`)
      }
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      })
      const resolveFreshHook = async () => {
        const currentHook = await getProjectDataHook(String(chainState.projectId), chainState.chainId)
        if (!currentHook || currentHook.toLowerCase() !== chainState.hookAddress.toLowerCase()) {
          throw new Error('The project NFT hook changed. Close this review and load the latest collection.')
        }
        return requireRecognized721Hook(publicClient, currentHook, BigInt(chainState.projectId))
      }
      const activeAddress = (isManagedMode ? managedAddress : address) as `0x${string}`
      const operations: `0x${string}`[] = []
      if (pendingChanges.tiersToAdd.length > 0 || pendingChanges.tierIdsToRemove.length > 0) {
        operations.push(encodeAdjustTiers({
          tiersToAdd: pendingChanges.tiersToAdd.map(t => t.config),
          tierIdsToRemove: pendingChanges.tierIdsToRemove,
        }))
      }
      if (pendingChanges.discountPercents.length > 0) {
        operations.push(encodeSetDiscountPercentsOf({ configs: pendingChanges.discountPercents }))
      }

      if (!isManagedMode) {
        await switchChainAsync({ chainId: chainState.chainId })
        if (await walletClient!.getChainId() !== chainState.chainId) {
          throw new Error(`Wallet did not switch to chain ${chainState.chainId}`)
        }
      }

      let hash = ''
      for (const data of operations) {
        const finalHook = await resolveFreshHook()
        await simulateTransaction({
          chainId: chainState.chainId,
          account: activeAddress,
          to: finalHook,
          data,
          value: 0n,
        })

        const txId = addTransaction({
          type: 'deploy',
          projectId: String(chainState.projectId),
          chainId: chainState.chainId,
          amount: '0',
          status: 'pending',
        })
        updateChainState(chainState.chainId, { status: 'authorizing' })

        if (isManagedMode) {
          assertCurrentAccount()
          hash = await executeManagedTransaction(chainState.chainId, finalHook, data, '0x0')
        } else {
          assertCurrentAccount(walletClient!.account?.address)
          hash = await walletClient!.sendTransaction({ to: finalHook, data, value: 0n })
        }
        updateChainState(chainState.chainId, { status: 'submitted', txHash: hash })
        await waitForSuccessfulTransaction(chainState.chainId, hash as `0x${string}`)
        updateTransaction(txId, { hash, status: 'confirmed' })
      }

      updateChainState(chainState.chainId, { status: 'confirmed', txHash: hash })

      return hash
    } catch (err) {
      const errorMessage = txErrorMessage(err, 'Transaction failed')
      updateChainState(chainState.chainId, { status: 'failed', error: errorMessage })
      throw err
    }
  }, [
    walletClient, address, pendingChanges, addTransaction,
    updateTransaction, updateChainState, switchChainAsync,
    isManagedMode, managedAddress, assertCurrentAccount
  ])

  // Start the execution process
  const handleStart = useCallback(async () => {
    const activeAddress = isManagedMode ? managedAddress : address
    if (!activeAddress || validChainData.length === 0) return

    try {
      assertCurrentAccount(isManagedMode ? undefined : walletClient?.account?.address)
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'The reviewed account could not be verified')
      return
    }
    setIsStarted(true)

    // Process chains sequentially
    for (let i = 0; i < chainStates.length; i++) {
      setCurrentChainIndex(i)
      try {
        await updateTiersOnChain(chainStates[i])
      } catch (err) {
        console.error(`Adjust tiers failed on chain ${chainStates[i].chainId}:`, err)
      }
    }
    setCurrentChainIndex(-1)
  }, [address, chainStates, updateTiersOnChain, isManagedMode, managedAddress, validChainData, walletClient, assertCurrentAccount, onError])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={!isStarted || allCompleted ? onClose : undefined}
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
                  : isDark ? 'bg-juice-orange/20' : 'bg-orange-100'
            }`}>
              {allSucceeded ? 'ok' : anyFailed ? '!' : 'NFT'}
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {allSucceeded
                  ? 'Items Updated'
                  : anyFailed && allCompleted
                    ? 'Some Updates Failed'
                    : isStarted
                      ? 'Updating Items...'
                      : 'Confirm Item Changes'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {projectName || 'Project'}
              </p>
            </div>
          </div>
          {(!isStarted || allCompleted) && (
            <button
              onClick={onClose}
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
          {/* Changes Summary */}
          <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Pending Changes
            </div>

            {/* Tiers to Add */}
            {pendingChanges.tiersToAdd.length > 0 && (
              <div className="mb-3">
                <div className={`text-sm font-medium mb-1 ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                  +{pendingChanges.tiersToAdd.length} tier{pendingChanges.tiersToAdd.length !== 1 ? 's' : ''} to add
                </div>
                <div className="space-y-1">
                  {pendingChanges.tiersToAdd.map(({ metadata, config }, idx) => (
                    <div key={idx} className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {metadata.name} - {formatUnits(BigInt(config.price), pricingDecimals)} {pricingLabel} × {config.initialSupply}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tiers to Remove */}
            {pendingChanges.tierIdsToRemove.length > 0 && (
              <div className="mb-3">
                <div className={`text-sm font-medium mb-1 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                  -{pendingChanges.tierIdsToRemove.length} tier{pendingChanges.tierIdsToRemove.length !== 1 ? 's' : ''} to remove
                </div>
                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Tier IDs: {pendingChanges.tierIdsToRemove.join(', ')}
                </div>
              </div>
            )}

            {pendingChanges.discountPercents.length > 0 && (
              <div className="mb-3">
                <div className={`text-sm font-medium mb-1 ${isDark ? 'text-cyan-300' : 'text-cyan-700'}`}>
                  {pendingChanges.discountPercents.length} discount change{
                    pendingChanges.discountPercents.length === 1 ? '' : 's'
                  }
                </div>
                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {pendingChanges.discountPercents.map(update => (
                    `#${update.tierId}: ${update.discountPercent / 2}%`
                  )).join(' · ')}
                </div>
              </div>
            )}

            {changeSummary.total === 0 && (
              <div className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                No changes to apply
              </div>
            )}
          </div>

          {/* Chain Status */}
          <div className="space-y-2">
            {chainStates.map((cs, idx) => (
              <ChainStatusRow
                key={cs.chainId}
                chainId={cs.chainId}
                status={cs.status === 'authorizing' ? 'signing' : cs.status}
                txHash={cs.txHash}
                highlighted={idx === currentChainIndex}
                accent="orange"
                signingLabel={isManagedMode ? 'Submitting...' : 'Confirm in wallet'}
                confirmedGlyph="ok"
                isDark={isDark}
              />
            ))}
          </div>

          {/* Error details */}
          {anyFailed && (
            <div className={`p-3 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              {chainStates.filter(cs => cs.status === 'failed').map(cs => (
                <div key={cs.chainId} className="text-xs">
                  <span className={isDark ? 'text-red-400' : 'text-red-600'}>
                    {CHAIN_INFO[cs.chainId]?.name || `Chain ${cs.chainId}`}:
                  </span>
                  <span className={`ml-1 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>
                    {cs.error || 'Unknown error'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Pre-execution info */}
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

              {isOmnichain && (
                <div className={`p-3 text-sm ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                  You will need to confirm {
                    chainStates.length * changeSummary.transactionsPerChain
                  } transactions across {chainStates.length} chains.
                </div>
              )}

              {!isOmnichain && changeSummary.transactionsPerChain > 1 && (
                <div className={`p-3 text-sm ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                  Adding or removing tiers and changing discounts use separate contract calls. You will confirm 2 transactions.
                </div>
              )}

              {/* Technical Details */}
              {chainStates.length > 0 && (
                <TechnicalDetails
                  contract="JB721_TIERS_HOOK"
                  contractAddress={chainStates[0].hookAddress}
                  functionName={changeSummary.transactionsPerChain > 1
                    ? 'adjustTiers + setDiscountPercentsOf'
                    : pendingChanges.discountPercents.length > 0
                      ? 'setDiscountPercentsOf'
                      : 'adjustTiers'}
                  chainId={chainStates[0].chainId}
                  projectId={chainStates[0].projectId.toString()}
                  parameters={{
                    tiersToAdd: pendingChanges.tiersToAdd.length,
                    tierIdsToRemove: pendingChanges.tierIdsToRemove,
                    discountPercents: pendingChanges.discountPercents,
                  }}
                  isDark={isDark}
                  allChains={isOmnichain ? chainStates.map(cs => ({
                    chainId: cs.chainId,
                    chainName: CHAIN_INFO[cs.chainId]?.name || `Chain ${cs.chainId}`,
                    projectId: cs.projectId,
                  })) : undefined}
                />
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          {!isStarted && (
            <div className="flex gap-3">
              <button
                onClick={onClose}
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
                className="flex-1 py-3 font-bold bg-juice-orange text-black hover:bg-juice-orange/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm{isOmnichain ? ` on ${chainStates.length} Chains` : ''}
              </button>
            </div>
          )}

          {isStarted && !allCompleted && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Please sign each transaction in your wallet
            </div>
          )}

          {allCompleted && (
            <button
              onClick={onClose}
              className="w-full py-3 font-medium bg-juice-orange text-black hover:bg-juice-orange/90 transition-colors"
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
