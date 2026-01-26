import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { encodeFunctionData, createPublicClient, http, type Chain, type Address } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, formatEthBalance, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { useOmnichainDistribute } from '../../hooks/relayr'
import { CHAINS as CHAIN_INFO, RPC_ENDPOINTS } from '../../constants'
import ChainPaymentSelector from './ChainPaymentSelector'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifySendReservedTokensParams } from '../../utils/transactionVerification'
import { getProjectController } from '../../utils/paymentTerminal'

const CONTROLLER_SEND_RESERVED_ABI = [
  {
    name: 'sendReservedTokensToSplitsOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
    ],
    outputs: [{ name: 'tokenCount', type: 'uint256' }],
  },
] as const

// viem chain objects for wallet operations
const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
}

interface ChainProjectData {
  chainId: number
  projectId: number | string
}

interface ReservedSplit {
  name?: string
  address: string
  percent: number
  projectId?: number
  lockedUntil?: number
}

interface SendReservedTokensModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName?: string
  chainId: number
  tokenSymbol: string
  amount: string // Raw amount in wei
  reservedRate?: number // Percentage (0-100)
  splits?: ReservedSplit[] // Reserved token recipients
  // New: for omnichain support
  allChainProjects?: ChainProjectData[]
}

type DistributeStatus = 'preview' | 'signing' | 'pending' | 'confirmed' | 'failed'

export default function SendReservedTokensModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  chainId,
  tokenSymbol,
  amount,
  reservedRate,
  splits,
  allChainProjects,
}: SendReservedTokensModalProps) {
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

  const [status, setStatus] = useState<DistributeStatus>('preview')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warningAcknowledged, setWarningAcknowledged] = useState(false)
  const [controllerAddress, setControllerAddress] = useState<Address | null>(null)
  const [controllerLoading, setControllerLoading] = useState(false)

  // Omnichain mode
  const [useAllChains, setUseAllChains] = useState(false)
  const {
    distribute,
    bundleState,
    isExecuting,
    isComplete: omnichainComplete,
    hasError: omnichainError,
    reset: resetOmnichain,
    setPaymentChain,
  } = useOmnichainDistribute({
    onSuccess: (bundleId, txHashes) => {
      console.log('Omnichain reserves distribution completed:', bundleId, txHashes)
      setStatus('confirmed')
    },
    onError: (err) => {
      console.error('Omnichain reserves distribution failed:', err)
      setError(err.message)
      setStatus('failed')
    },
  })

  const chainInfo = CHAIN_INFO[chainId] || CHAIN_INFO[1]
  const chainName = chainInfo.name
  const tokenAmount = parseFloat(amount) / 1e18
  const hasGasBalance = totalEth >= 0.001

  // Check if omnichain is available
  const hasMultipleChains = allChainProjects && allChainProjects.length > 1

  // Transaction verification
  const verificationResult = useMemo(() => {
    return verifySendReservedTokensParams({
      projectId: BigInt(projectId),
      pendingReservedTokens: BigInt(amount),
      reservedRate,
      splits: splits?.map(s => ({
        beneficiary: s.address,
        percent: s.percent,
        projectId: s.projectId,
        lockedUntil: s.lockedUntil,
      })),
    })
  }, [projectId, amount, reservedRate, splits])

  const hasWarnings = verificationResult.doubts.length > 0
  const hasCriticalDoubts = verificationResult.doubts.some(d => d.severity === 'critical')
  const canProceed = hasGasBalance && (!hasWarnings || warningAcknowledged) && !hasCriticalDoubts && !!controllerAddress && !controllerLoading

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('preview')
      setTxHash(null)
      setError(null)
      setUseAllChains(false)
      setWarningAcknowledged(false)
      resetOmnichain()
    }
  }, [isOpen, resetOmnichain])

  // Fetch the project's controller from JBDirectory
  useEffect(() => {
    if (!isOpen || !projectId || !chainId) {
      setControllerAddress(null)
      return
    }

    const fetchController = async () => {
      setControllerLoading(true)
      try {
        const chain = CHAINS[chainId]
        if (!chain) {
          console.error('Unsupported chain for controller lookup:', chainId)
          return
        }

        const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        })

        const controller = await getProjectController(publicClient, BigInt(projectId))
        setControllerAddress(controller)
      } catch (err) {
        console.error('Failed to fetch project controller:', err)
        setError('Failed to fetch project controller')
      } finally {
        setControllerLoading(false)
      }
    }

    fetchController()
  }, [isOpen, projectId, chainId])

  const handleConfirm = useCallback(async () => {
    // Check wallet connection based on mode
    if (isManagedMode) {
      if (!managedAddress) {
        setError('Managed wallet not available')
        return
      }
    } else {
      if (!walletClient || !address) {
        setError('Wallet not connected')
        return
      }
    }

    if (useAllChains && allChainProjects && allChainProjects.length > 1) {
      // Use Relayr omnichain distribution
      setStatus('signing')
      setError(null)

      const projectIds: Record<number, number> = {}
      allChainProjects.forEach(cp => {
        projectIds[cp.chainId] = typeof cp.projectId === 'string' ? parseInt(cp.projectId) : cp.projectId
      })

      await distribute({
        chainIds: allChainProjects.map(cp => cp.chainId),
        projectIds,
        type: 'reserves',
      })
      return
    }

    // Single chain execution
    setStatus('signing')
    setError(null)

    const chain = CHAINS[chainId]

    if (!chain) {
      setError('Unsupported chain')
      setStatus('failed')
      return
    }

    try {
      // Create transaction record
      const txId = addTransaction({
        type: 'deploy',
        projectId,
        chainId,
        amount: tokenAmount.toString(),
        status: 'pending',
      })

      const callData = encodeFunctionData({
        abi: CONTROLLER_SEND_RESERVED_ABI,
        functionName: 'sendReservedTokensToSplitsOf',
        args: [BigInt(projectId)],
      })

      setStatus('pending')

      if (!controllerAddress) {
        setError('Controller address not available')
        setStatus('failed')
        return
      }

      let hash: string

      if (isManagedMode) {
        // Execute via backend for managed mode
        hash = await executeManagedTransaction(chainId, controllerAddress, callData, '0')
      } else {
        // Execute via wallet for self-custody mode
        await switchChainAsync({ chainId })
        hash = await walletClient!.sendTransaction({
          to: controllerAddress,
          data: callData,
          value: 0n,
        })
      }

      setTxHash(hash)
      updateTransaction(txId, { hash, status: 'submitted' })
      setStatus('confirmed')
    } catch (err) {
      console.error('Send reserved tokens failed:', err)
      setError(err instanceof Error ? err.message : 'Transaction failed')
      setStatus('failed')
    }
  }, [walletClient, address, chainId, projectId, tokenAmount, addTransaction, updateTransaction, switchChainAsync, isManagedMode, managedAddress, useAllChains, allChainProjects, distribute, controllerAddress])

  const handleClose = useCallback(() => {
    resetOmnichain()
    onClose()
  }, [resetOmnichain, onClose])

  if (!isOpen) return null

  const isProcessing = status === 'signing' || status === 'pending' || isExecuting
  const showConfirmed = status === 'confirmed' || omnichainComplete
  const showFailed = status === 'failed' || omnichainError

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={status === 'preview' || showConfirmed || showFailed ? handleClose : undefined}
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
              isDark ? 'bg-amber-500/20' : 'bg-amber-100'
            }`}>
              🎟️
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {showConfirmed ? 'Tokens Distributed' : showFailed ? 'Distribution Failed' : 'Confirm Distribution'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {useAllChains && allChainProjects ? `${allChainProjects.length} Chains` : chainName}
              </p>
            </div>
          </div>
          {(status === 'preview' || showConfirmed || showFailed) && (
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
          {/* Status Messages */}
          {status === 'signing' && !isExecuting && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-amber-500/10' : 'bg-amber-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full" />
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Waiting for signature...
                </p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Check your wallet
                </p>
              </div>
            </div>
          )}

          {isExecuting && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-juice-cyan border-t-transparent rounded-full" />
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {bundleState.status === 'creating' ? 'Creating bundle...' :
                   bundleState.status === 'awaiting_payment' ? 'Awaiting payment...' :
                   'Distributing on all chains...'}
                </p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Relayr is processing transactions
                </p>
              </div>
            </div>
          )}

          {status === 'pending' && !isExecuting && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-juice-cyan border-t-transparent rounded-full" />
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Transaction pending...
                </p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Confirming on {chainName}
                </p>
              </div>
            </div>
          )}

          {showConfirmed && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
              <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {tokenSymbol} distributed
                </p>
                {txHash && (
                  <a
                    href={`${chainInfo.explorerTx}${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-juice-cyan hover:underline"
                  >
                    View on explorer →
                  </a>
                )}
                {useAllChains && omnichainComplete && (
                  <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Distributed on all {allChainProjects?.length} chains
                  </p>
                )}
              </div>
            </div>
          )}

          {showFailed && error && (
            <div className={`p-4 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              <p className={`font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                Transaction failed
              </p>
              <p className={`text-sm mt-1 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>
                {error || bundleState.error}
              </p>
            </div>
          )}

          {/* Distribution Details */}
          {(status === 'preview' || isProcessing) && !showConfirmed && !showFailed && (
            <>
              {/* Transaction Summary */}
              <TransactionSummary
                type="sendReservedTokens"
                details={{
                  projectId,
                  projectName,
                  pendingTokens: amount,
                  pendingTokensFormatted: `${tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenSymbol}`,
                  reservedRate,
                  recipients: splits?.map(s => ({
                    name: s.name,
                    address: s.address,
                    percent: s.percent,
                    tokens: s.percent && tokenAmount
                      ? `${((tokenAmount * s.percent) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                      : undefined,
                    isProject: !!s.projectId,
                    projectId: s.projectId,
                  })),
                }}
                isDark={isDark}
              />

              {/* Transaction Warnings */}
              {hasWarnings && status === 'preview' && (
                <TransactionWarning
                  doubts={verificationResult.doubts}
                  onConfirm={() => setWarningAcknowledged(true)}
                  onCancel={onClose}
                  isDark={isDark}
                />
              )}

              {/* Omnichain toggle */}
              {hasMultipleChains && !isManagedMode && status === 'preview' && (
                <div className={`p-3 ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useAllChains}
                      onChange={(e) => setUseAllChains(e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    <div>
                      <div className={`text-sm font-medium ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                        Distribute on all {allChainProjects?.length} chains
                      </div>
                      <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Pay gas once via Relayr, execute everywhere
                      </div>
                    </div>
                  </label>
                </div>
              )}

              {/* Payment chain selector */}
              {useAllChains && bundleState.paymentOptions.length > 0 && status === 'preview' && (
                <ChainPaymentSelector
                  paymentOptions={bundleState.paymentOptions}
                  selectedChainId={bundleState.selectedPaymentChain}
                  onSelect={setPaymentChain}
                />
              )}

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

              {controllerLoading && (
                <div className={`p-3 text-sm flex items-center gap-2 ${isDark ? 'bg-juice-cyan/10 text-juice-cyan' : 'bg-cyan-50 text-cyan-700'}`}>
                  <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  Fetching project controller...
                </div>
              )}
            </>
          )}

          {/* Summary (for confirmed) */}
          {showConfirmed && (
            <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Distributed</span>
                  <span className={`font-mono text-amber-400`}>
                    {tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {tokenSymbol}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          {status === 'preview' && (
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
                onClick={handleConfirm}
                disabled={!canProceed}
                className="flex-1 py-3 font-bold bg-amber-500 text-black hover:bg-amber-500/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {useAllChains ? `Distribute on ${allChainProjects?.length} Chains` : `Distribute ${tokenSymbol}`}
              </button>
            </div>
          )}

          {isProcessing && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Do not close this window
            </div>
          )}

          {(showConfirmed || showFailed) && (
            <button
              onClick={handleClose}
              className="w-full py-3 font-medium bg-amber-500 text-black hover:bg-amber-500/90 transition-colors"
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
