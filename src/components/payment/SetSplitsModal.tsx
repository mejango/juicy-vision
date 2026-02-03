import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { encodeFunctionData, type Chain, createPublicClient, http, fallback, type PublicClient } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, formatEthBalance, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { useOmnichainSetSplits, type ChainState } from '../../hooks/relayr'
import { JB_CONTROLLER_ABI } from '../../constants/abis/jbController'
import { SPLIT_GROUP_RESERVED, getPayoutSplitGroup, NATIVE_TOKEN } from '../../constants/abis/jbSplits'
import { USDC_ADDRESSES, RPC_ENDPOINTS, VIEM_CHAINS, type SupportedChainId } from '../../constants'
import { getProjectController } from '../../utils/paymentTerminal'
import ChainPaymentSelector from './ChainPaymentSelector'
import TechnicalDetails from '../shared/TechnicalDetails'

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

// Data passed from the form
interface ChainSplitsData {
  chainId: number
  projectId: number
  rulesetId: string
  baseCurrency: number
  selected: boolean
}

// Split format from the form
interface EditableSplit {
  id: string
  percent: string
  beneficiary: string
  projectId: string
  preferAddToBalance: boolean
  lockedUntil: number
  hook: string
  isLocked: boolean
  isNew: boolean
}

interface SetSplitsModalProps {
  isOpen: boolean
  onClose: () => void
  projectName?: string
  chainSplitsData: ChainSplitsData[]
  payoutSplits: EditableSplit[]
  reservedSplits: EditableSplit[]
  baseCurrency: number
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

// Convert display percent (0-100) to basis points (0-1_000_000_000)
function toBasisPoints(displayPercent: string): number {
  const pct = parseFloat(displayPercent) || 0
  return Math.floor((pct / 100) * 1_000_000_000)
}

export default function SetSplitsModal({
  isOpen,
  onClose,
  projectName,
  chainSplitsData,
  payoutSplits,
  reservedSplits,
  baseCurrency,
  onConfirmed,
  onError,
}: SetSplitsModalProps) {
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

  // State for legacy mode (single chain at a time)
  const [chainStates, setChainStates] = useState<ChainTxState[]>([])
  const [currentChainIndex, setCurrentChainIndex] = useState<number>(-1)
  const [isStarted, setIsStarted] = useState(false)

  // Relayr omnichain mode
  const [useOmnichain, setUseOmnichain] = useState(true)
  const {
    setSplits,
    bundleState,
    isExecuting,
    isComplete: omnichainComplete,
    hasError: omnichainError,
    reset: resetOmnichain,
    setPaymentChain,
  } = useOmnichainSetSplits({
    onSuccess: (bundleId, txHashes) => {
      console.log('Omnichain set splits completed:', bundleId, txHashes)
    },
    onError: (error) => {
      console.error('Omnichain set splits failed:', error)
    },
  })

  const hasGasBalance = totalEth >= 0.001
  const isOmnichain = chainSplitsData.length > 1
  const canProceed = hasGasBalance

  // Derive chain states from bundle state when in omnichain mode
  const effectiveChainStates = useOmnichain && bundleState.bundleId
    ? bundleState.chainStates.map((cs: ChainState) => ({
        chainId: cs.chainId,
        projectId: cs.projectId || chainSplitsData.find(cd => cd.chainId === cs.chainId)?.projectId || 0,
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

  // Call parent callbacks when transactions complete
  useEffect(() => {
    if (allSucceeded) {
      const txHashes: Record<number, string> = {}
      if (useOmnichain) {
        bundleState.chainStates.forEach((cs: ChainState) => {
          if (cs.txHash) txHashes[cs.chainId] = cs.txHash
        })
        onConfirmed?.(txHashes, bundleState.bundleId || undefined)
      } else {
        chainStates.forEach((cs: ChainTxState) => {
          if (cs.txHash) txHashes[cs.chainId] = cs.txHash
        })
        onConfirmed?.(txHashes)
      }
    } else if (anyFailed) {
      const failedChain = useOmnichain
        ? bundleState.chainStates.find((cs: ChainState) => cs.status === 'failed')
        : chainStates.find((cs: ChainTxState) => cs.status === 'failed')
      onError?.(failedChain?.error || bundleState.error || 'Transaction failed')
    }
  }, [allSucceeded, anyFailed, useOmnichain, bundleState.chainStates, bundleState.bundleId, bundleState.error, chainStates, onConfirmed, onError])

  // Initialize chain states
  useEffect(() => {
    if (isOpen) {
      setChainStates(
        chainSplitsData.map(cd => ({
          chainId: cd.chainId,
          projectId: cd.projectId,
          status: 'pending',
        }))
      )
      setCurrentChainIndex(-1)
      setIsStarted(false)
      resetOmnichain()
      setUseOmnichain(isOmnichain)
    }
  }, [isOpen, chainSplitsData, isOmnichain, resetOmnichain])

  const updateChainState = useCallback((chainId: number, update: Partial<ChainTxState>) => {
    setChainStates(prev =>
      prev.map(cs =>
        cs.chainId === chainId
          ? { ...cs, ...update }
          : cs
      )
    )
  }, [])

  // Build split struct for contract call
  const buildSplitStruct = (split: EditableSplit) => ({
    preferAddToBalance: split.preferAddToBalance,
    percent: toBasisPoints(split.percent),
    projectId: BigInt(split.projectId || 0),
    beneficiary: (split.beneficiary || '0x0000000000000000000000000000000000000000') as `0x${string}`,
    lockedUntil: split.lockedUntil,
    hook: (split.hook || '0x0000000000000000000000000000000000000000') as `0x${string}`,
  })

  // Build split groups for a chain
  const buildSplitGroups = (chainData: ChainSplitsData) => {
    const payoutToken = chainData.baseCurrency === 2
      ? USDC_ADDRESSES[chainData.chainId as SupportedChainId]
      : NATIVE_TOKEN

    const groups: Array<{
      groupId: bigint
      splits: ReturnType<typeof buildSplitStruct>[]
    }> = []

    // Payout splits (keyed by token address)
    const validPayoutSplits = payoutSplits.filter(s => s.percent && parseFloat(s.percent) > 0)
    if (validPayoutSplits.length > 0) {
      groups.push({
        groupId: getPayoutSplitGroup(payoutToken),
        splits: validPayoutSplits.map(buildSplitStruct),
      })
    }

    // Reserved splits (always group ID 1)
    const validReservedSplits = reservedSplits.filter(s => s.percent && parseFloat(s.percent) > 0)
    if (validReservedSplits.length > 0) {
      groups.push({
        groupId: SPLIT_GROUP_RESERVED,
        splits: validReservedSplits.map(buildSplitStruct),
      })
    }

    return groups
  }

  // Set splits on a single chain (legacy mode)
  const setSplitsOnChain = useCallback(async (chainData: ChainSplitsData) => {
    if (isManagedMode) {
      if (!managedAddress) {
        throw new Error('Managed wallet not available')
      }
    } else {
      if (!walletClient || !address) {
        throw new Error('Wallet not connected')
      }
    }

    const chain = CHAINS[chainData.chainId]
    if (!chain) {
      throw new Error(`Unsupported chain: ${chainData.chainId}`)
    }

    updateChainState(chainData.chainId, { status: 'signing' })

    try {
      // Fetch controller address from JBDirectory
      const viemChain = VIEM_CHAINS[chainData.chainId as SupportedChainId]
      const rpcUrls = RPC_ENDPOINTS[chainData.chainId]
      if (!viemChain || !rpcUrls || rpcUrls.length === 0) {
        throw new Error(`No RPC endpoint for chain ${chainData.chainId}`)
      }

      // Use fallback transport with all RPCs to handle timeouts
      const publicClient = createPublicClient({
        chain: viemChain,
        transport: fallback(rpcUrls.map(url => http(url))),
      }) as PublicClient

      const controllerAddress = await getProjectController(
        publicClient,
        BigInt(chainData.projectId)
      )

      const txId = addTransaction({
        type: 'deploy',
        projectId: String(chainData.projectId),
        chainId: chainData.chainId,
        amount: '0',
        status: 'pending',
      })

      const splitGroups = buildSplitGroups(chainData)

      const callData = encodeFunctionData({
        abi: JB_CONTROLLER_ABI,
        functionName: 'setSplitGroupsOf',
        args: [
          BigInt(chainData.projectId),
          BigInt(chainData.rulesetId),
          splitGroups,
        ],
      })

      updateChainState(chainData.chainId, { status: 'submitted' })

      let hash: string

      if (isManagedMode) {
        hash = await executeManagedTransaction(chainData.chainId, controllerAddress, callData, '0')
      } else {
        await switchChainAsync({ chainId: chainData.chainId })
        hash = await walletClient!.sendTransaction({
          to: controllerAddress,
          data: callData,
          value: 0n,
        })
      }

      updateChainState(chainData.chainId, { status: 'confirmed', txHash: hash })
      updateTransaction(txId, { hash, status: 'submitted' })

      return hash
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Transaction failed'
      updateChainState(chainData.chainId, { status: 'failed', error: errorMessage })
      throw err
    }
  }, [walletClient, address, payoutSplits, reservedSplits, addTransaction, updateTransaction, updateChainState, switchChainAsync, isManagedMode, managedAddress])

  // Start the set splits process
  const handleStart = useCallback(async () => {
    const activeAddress = isManagedMode ? managedAddress : address
    if (!activeAddress || chainSplitsData.length === 0) return

    setIsStarted(true)

    if (useOmnichain && isOmnichain) {
      // Use Relayr omnichain execution
      await setSplits({
        chainData: chainSplitsData.map(cd => ({
          chainId: cd.chainId,
          projectId: cd.projectId,
          rulesetId: cd.rulesetId,
          baseCurrency: cd.baseCurrency,
        })),
        payoutSplits: payoutSplits.map(s => ({
          percent: s.percent,
          beneficiary: s.beneficiary,
          projectId: s.projectId,
          preferAddToBalance: s.preferAddToBalance,
          lockedUntil: s.lockedUntil,
          hook: s.hook,
        })),
        reservedSplits: reservedSplits.map(s => ({
          percent: s.percent,
          beneficiary: s.beneficiary,
          projectId: s.projectId,
          preferAddToBalance: s.preferAddToBalance,
          lockedUntil: s.lockedUntil,
          hook: s.hook,
        })),
      })
    } else {
      // Legacy: process chains sequentially
      for (let i = 0; i < chainSplitsData.length; i++) {
        setCurrentChainIndex(i)
        try {
          await setSplitsOnChain(chainSplitsData[i])
        } catch (err) {
          console.error(`Set splits failed on chain ${chainSplitsData[i].chainId}:`, err)
        }
      }
      setCurrentChainIndex(-1)
    }
  }, [walletClient, address, chainSplitsData, setSplitsOnChain, isManagedMode, managedAddress, useOmnichain, isOmnichain, setSplits, payoutSplits, reservedSplits])

  const handleClose = useCallback(() => {
    resetOmnichain()
    onClose()
  }, [resetOmnichain, onClose])

  if (!isOpen) return null

  const showOmnichainSelector = isOmnichain && !isStarted && !isManagedMode

  // Count non-empty splits for display
  const payoutCount = payoutSplits.filter(s => parseFloat(s.percent) > 0).length
  const reservedCount = reservedSplits.filter(s => parseFloat(s.percent) > 0).length

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
                  : isDark ? 'bg-green-500/20' : 'bg-green-100'
            }`}>
              {allSucceeded ? '✓' : anyFailed ? '!' : '📊'}
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {allSucceeded
                  ? 'Splits Updated'
                  : anyFailed && allCompleted
                    ? 'Some Updates Failed'
                    : isStarted
                      ? 'Updating Splits...'
                      : 'Confirm Split Update'}
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
          {/* Summary of changes */}
          <div className={`p-3 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
            <div className={`text-xs font-medium mb-1 ${isDark ? 'text-green-300' : 'text-green-700'}`}>
              Splits to Update
            </div>
            <div className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {payoutCount > 0 && <div>{payoutCount} payout split{payoutCount > 1 ? 's' : ''}</div>}
              {reservedCount > 0 && <div>{reservedCount} reserved split{reservedCount > 1 ? 's' : ''}</div>}
              {payoutCount === 0 && reservedCount === 0 && <div>Clear all splits</div>}
            </div>
          </div>

          {/* Omnichain mode toggle (for multi-chain) */}
          {showOmnichainSelector && (
            <div className={`p-3 ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useOmnichain}
                  onChange={(e) => setUseOmnichain(e.target.checked)}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <div className={`text-sm font-medium ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                    Use Relayr for single-signature execution
                  </div>
                  <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Pay gas on one chain, execute on all {chainSplitsData.length} chains
                  </div>
                </div>
              </label>
            </div>
          )}

          {/* Payment chain selector (for omnichain mode with payment options) */}
          {useOmnichain && bundleState.paymentOptions.length > 0 && !isStarted && (
            <ChainPaymentSelector
              paymentOptions={bundleState.paymentOptions}
              selectedChainId={bundleState.selectedPaymentChain}
              onSelect={setPaymentChain}
            />
          )}

          {/* Chain Status */}
          <div className="space-y-2">
            {effectiveChainStates.map((cs: ChainTxState, idx: number) => {
              const chainInfo = CHAIN_INFO[cs.chainId]
              const isCurrent = idx === currentChainIndex

              return (
                <div
                  key={cs.chainId}
                  className={`p-3 flex items-center justify-between ${
                    isCurrent
                      ? isDark ? 'bg-green-500/20 border border-green-500/50' : 'bg-green-100 border border-green-300'
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
                        <div className="animate-spin w-3 h-3 border-2 border-green-500 border-t-transparent rounded-full" />
                        <span className={`text-xs ${isDark ? 'text-green-300' : 'text-green-600'}`}>
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
              {effectiveChainStates.filter((cs: ChainTxState) => cs.status === 'failed').map((cs: ChainTxState) => (
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

              {isOmnichain && !useOmnichain && (
                <div className={`p-3 text-sm ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                  You will need to sign {chainSplitsData.length} transactions, one for each chain.
                </div>
              )}

              {isOmnichain && useOmnichain && (
                <div className={`p-3 text-sm ${isDark ? 'bg-green-500/10 text-green-300' : 'bg-green-50 text-green-700'}`}>
                  Sign once to update splits on all {chainSplitsData.length} chains via Relayr
                </div>
              )}

              {/* Technical Details */}
              <TechnicalDetails
                contract="JB_CONTROLLER"
                contractAddress="(varies per chain)"
                functionName="setSplitGroupsOf"
                chainId={chainSplitsData[0]?.chainId || 1}
                projectId={chainSplitsData[0]?.projectId?.toString()}
                parameters={{
                  rulesetId: chainSplitsData[0]?.rulesetId || '0',
                  payoutSplitsCount: payoutCount,
                  reservedSplitsCount: reservedCount,
                }}
                isDark={isDark}
                allChains={isOmnichain ? chainSplitsData.map(cd => ({
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
                className="flex-1 py-3 font-bold bg-green-500 text-black hover:bg-green-500/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Update{isOmnichain ? ` on ${chainSplitsData.length} Chains` : ''}
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
              className="w-full py-3 font-medium bg-green-500 text-black hover:bg-green-500/90 transition-colors"
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
