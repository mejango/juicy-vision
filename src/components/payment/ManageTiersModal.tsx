import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { formatEther, type Chain, createPublicClient, http } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, formatEthBalance, executeManagedTransaction, useManagedWallet } from '../../hooks'
import {
  buildAdjustTiersTransaction,
  type JB721TierConfigInput,
} from '../../services/tiersHook'
import type { JB721HookFlags, TierPermissions } from '../../services/nft'
import ChainPaymentSelector from './ChainPaymentSelector'
import TechnicalDetails from '../shared/TechnicalDetails'
import { RPC_ENDPOINTS } from '../../constants'

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
}

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

interface TierMetadata {
  name: string
  description?: string
  image?: string
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
  metadataUpdates: Array<{ tierId: number; uri: string; metadata: TierMetadata }>
  discountUpdates: Array<{ tierId: number; discountPercent: number }>
}

interface ManageTiersModalProps {
  isOpen: boolean
  onClose: () => void
  projectName?: string
  chainHookData: ChainHookData[]
  pendingChanges: PendingChanges
  onComplete?: () => void
}

type ChainStatus = 'pending' | 'signing' | 'submitted' | 'confirmed' | 'failed'

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
  onComplete,
}: ManageTiersModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const { addTransaction, updateTransaction } = useTransactionStore()
  const { totalEth } = useWalletBalances()

  // Managed mode support
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address: managedAddress } = useManagedWallet()

  // Transaction state
  const [chainStates, setChainStates] = useState<ChainTxState[]>([])
  const [currentChainIndex, setCurrentChainIndex] = useState<number>(-1)
  const [isStarted, setIsStarted] = useState(false)

  // Filter to only chains with hooks
  const validChainData = useMemo(() =>
    chainHookData.filter(cd => cd.hookAddress && cd.selected),
    [chainHookData]
  )

  const hasGasBalance = totalEth >= 0.001
  const isOmnichain = validChainData.length > 1

  // Summary of changes
  const changeSummary = useMemo(() => {
    const adds = pendingChanges.tiersToAdd.length
    const removes = pendingChanges.tierIdsToRemove.length
    const updates = pendingChanges.metadataUpdates.length + pendingChanges.discountUpdates.length
    return { adds, removes, updates, total: adds + removes + updates }
  }, [pendingChanges])

  // All chains completed
  const allCompleted = chainStates.length > 0 && chainStates.every(
    cs => cs.status === 'confirmed' || cs.status === 'failed'
  )
  const anyFailed = chainStates.some(cs => cs.status === 'failed')
  const allSucceeded = chainStates.length > 0 && chainStates.every(cs => cs.status === 'confirmed')

  const canProceed = hasGasBalance && validChainData.length > 0 && changeSummary.total > 0

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

  // Execute adjustTiers on a single chain
  const adjustTiersOnChain = useCallback(async (chainState: ChainTxState) => {
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

    updateChainState(chainState.chainId, { status: 'signing' })

    try {
      const txId = addTransaction({
        type: 'deploy',
        projectId: String(chainState.projectId),
        chainId: chainState.chainId,
        amount: '0',
        status: 'pending',
      })

      // Build the transaction
      const tx = buildAdjustTiersTransaction({
        chainId: chainState.chainId,
        hookAddress: chainState.hookAddress,
        tiersToAdd: pendingChanges.tiersToAdd.map(t => t.config),
        tierIdsToRemove: pendingChanges.tierIdsToRemove,
      })

      updateChainState(chainState.chainId, { status: 'submitted' })

      let hash: string

      if (isManagedMode) {
        hash = await executeManagedTransaction(
          chainState.chainId,
          tx.to,
          tx.data,
          tx.value
        )
      } else {
        await switchChainAsync({ chainId: chainState.chainId })
        hash = await walletClient!.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: BigInt(tx.value),
        })
      }

      updateChainState(chainState.chainId, { status: 'confirmed', txHash: hash })
      updateTransaction(txId, { hash, status: 'submitted' })

      return hash
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed'
      updateChainState(chainState.chainId, { status: 'failed', error: errorMessage })
      throw err
    }
  }, [
    walletClient, address, pendingChanges, addTransaction,
    updateTransaction, updateChainState, switchChainAsync,
    isManagedMode, managedAddress
  ])

  // Start the execution process
  const handleStart = useCallback(async () => {
    const activeAddress = isManagedMode ? managedAddress : address
    if (!activeAddress || validChainData.length === 0) return

    setIsStarted(true)

    // Process chains sequentially
    for (let i = 0; i < chainStates.length; i++) {
      setCurrentChainIndex(i)
      try {
        await adjustTiersOnChain(chainStates[i])
      } catch (err) {
        console.error(`Adjust tiers failed on chain ${chainStates[i].chainId}:`, err)
      }
    }
    setCurrentChainIndex(-1)
  }, [address, chainStates, adjustTiersOnChain, isManagedMode, managedAddress, validChainData])

  const handleClose = useCallback(() => {
    if (allSucceeded && onComplete) {
      onComplete()
    }
    onClose()
  }, [allSucceeded, onComplete, onClose])

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
                  : isDark ? 'bg-juice-orange/20' : 'bg-orange-100'
            }`}>
              {allSucceeded ? 'ok' : anyFailed ? '!' : 'NFT'}
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {allSucceeded
                  ? 'Tiers Updated'
                  : anyFailed && allCompleted
                    ? 'Some Updates Failed'
                    : isStarted
                      ? 'Updating Tiers...'
                      : 'Confirm Tier Changes'}
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
                      {metadata.name} - {formatEther(BigInt(config.price))} ETH × {config.initialSupply}
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

            {changeSummary.total === 0 && (
              <div className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                No changes to apply
              </div>
            )}
          </div>

          {/* Chain Status */}
          <div className="space-y-2">
            {chainStates.map((cs, idx) => {
              const chainInfo = CHAIN_INFO[cs.chainId]
              const isCurrent = idx === currentChainIndex

              return (
                <div
                  key={cs.chainId}
                  className={`p-3 flex items-center justify-between ${
                    isCurrent
                      ? isDark ? 'bg-juice-orange/20 border border-juice-orange/50' : 'bg-orange-100 border border-orange-300'
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
                  </div>
                  <div className="flex items-center gap-2">
                    {cs.status === 'pending' && (
                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Waiting...
                      </span>
                    )}
                    {cs.status === 'signing' && (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin w-3 h-3 border-2 border-juice-orange border-t-transparent rounded-full" />
                        <span className={`text-xs ${isDark ? 'text-juice-orange' : 'text-orange-600'}`}>
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
                        <span className="text-green-500">ok</span>
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
              <div className={`flex justify-between items-center text-sm ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}>
                <span>Your ETH balance (for gas)</span>
                <span className={`font-mono ${!hasGasBalance ? 'text-red-400' : ''}`}>
                  {formatEthBalance(totalEth)} ETH
                </span>
              </div>

              {!hasGasBalance && (
                <div className={`p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
                  Insufficient ETH for gas fees
                </div>
              )}

              {isOmnichain && (
                <div className={`p-3 text-sm ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                  You will need to sign {chainStates.length} transactions, one for each chain.
                </div>
              )}

              {/* Technical Details */}
              {chainStates.length > 0 && (
                <TechnicalDetails
                  contract="JB721_TIERS_HOOK"
                  contractAddress={chainStates[0].hookAddress}
                  functionName="adjustTiers"
                  chainId={chainStates[0].chainId}
                  projectId={chainStates[0].projectId.toString()}
                  parameters={{
                    tiersToAdd: pendingChanges.tiersToAdd.length,
                    tierIdsToRemove: pendingChanges.tierIdsToRemove,
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
              onClick={handleClose}
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
