import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { encodeFunctionData, keccak256, toBytes, type Chain } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, formatEthBalance, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { useOmnichainDeployERC20 } from '../../hooks/relayr'
import ChainPaymentSelector from './ChainPaymentSelector'

// Contract constants
const JB_CONTROLLER = '0x8C32BBA37a7C42b3A1Fa25E2eaF4D6539C481a16' as const

const CONTROLLER_DEPLOY_ERC20_ABI = [
  {
    name: 'deployERC20For',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [{ name: 'token', type: 'address' }],
  },
] as const

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  8453: 'Base',
  42161: 'Arbitrum',
}

const EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  8453: 'https://basescan.org/tx/',
  42161: 'https://arbiscan.io/tx/',
}

interface ChainProjectData {
  chainId: number
  projectId: number | string
}

interface DeployERC20ModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName?: string
  chainId: number
  tokenName: string
  tokenSymbol: string
  // New: for omnichain support - deploy same token on all chains with same address
  allChainProjects?: ChainProjectData[]
}

type DeployStatus = 'preview' | 'signing' | 'pending' | 'confirmed' | 'failed'

export default function DeployERC20Modal({
  isOpen,
  onClose,
  projectId,
  projectName,
  chainId,
  tokenName,
  tokenSymbol,
  allChainProjects,
}: DeployERC20ModalProps) {
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

  const [status, setStatus] = useState<DeployStatus>('preview')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Omnichain mode
  const [useAllChains, setUseAllChains] = useState(false)
  const {
    deploy,
    bundleState,
    isExecuting,
    isComplete: omnichainComplete,
    hasError: omnichainError,
    reset: resetOmnichain,
    setPaymentChain,
  } = useOmnichainDeployERC20({
    onSuccess: (bundleId, txHashes) => {
      console.log('Omnichain ERC20 deployment completed:', bundleId, txHashes)
      setStatus('confirmed')
    },
    onError: (err) => {
      console.error('Omnichain ERC20 deployment failed:', err)
      setError(err.message)
      setStatus('failed')
    },
  })

  const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`
  const hasGasBalance = totalEth >= 0.001

  // Check if omnichain is available
  const hasMultipleChains = allChainProjects && allChainProjects.length > 1

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('preview')
      setTxHash(null)
      setError(null)
      setUseAllChains(false)
      resetOmnichain()
    }
  }, [isOpen, resetOmnichain])

  const handleConfirm = useCallback(async () => {
    // Check wallet connection based on mode
    const activeAddress = isManagedMode ? managedAddress : address
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
      // Use Relayr omnichain deployment - same token address on all chains
      setStatus('signing')
      setError(null)

      const projectIds: Record<number, number> = {}
      allChainProjects.forEach(cp => {
        projectIds[cp.chainId] = typeof cp.projectId === 'string' ? parseInt(cp.projectId) : cp.projectId
      })

      await deploy({
        chainIds: allChainProjects.map(cp => cp.chainId),
        projectIds,
        tokenName,
        tokenSymbol,
      })
      return
    }

    // Single chain deployment
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
        amount: '0',
        status: 'pending',
      })

      // Generate a salt based on project, timestamp, and wallet address for uniqueness
      const saltInput = `${projectId}-${tokenSymbol}-${Date.now()}-${activeAddress}`
      const salt = keccak256(toBytes(saltInput))

      const callData = encodeFunctionData({
        abi: CONTROLLER_DEPLOY_ERC20_ABI,
        functionName: 'deployERC20For',
        args: [
          BigInt(projectId),
          tokenName,
          tokenSymbol,
          salt,
        ],
      })

      setStatus('pending')

      let hash: string

      if (isManagedMode) {
        // Execute via backend for managed mode
        hash = await executeManagedTransaction(chainId, JB_CONTROLLER, callData, '0')
      } else {
        // Execute via wallet for self-custody mode
        await switchChainAsync({ chainId })
        hash = await walletClient!.sendTransaction({
          to: JB_CONTROLLER,
          data: callData,
          value: 0n,
        })
      }

      setTxHash(hash)
      updateTransaction(txId, { hash, status: 'submitted' })
      setStatus('confirmed')
    } catch (err) {
      console.error('Deploy ERC20 failed:', err)
      setError(err instanceof Error ? err.message : 'Transaction failed')
      setStatus('failed')
    }
  }, [walletClient, address, chainId, projectId, tokenName, tokenSymbol, addTransaction, updateTransaction, switchChainAsync, isManagedMode, managedAddress, useAllChains, allChainProjects, deploy])

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
              isDark ? 'bg-juice-cyan/20' : 'bg-cyan-100'
            }`}>
              🪙
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {showConfirmed ? 'Token Deployed' : showFailed ? 'Deployment Failed' : 'Confirm Deployment'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {useAllChains && allChainProjects ? `${allChainProjects.length} Chains • Same Address` : chainName}
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
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-juice-cyan border-t-transparent rounded-full" />
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
                   'Deploying on all chains...'}
                </p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Relayr is deploying ${tokenSymbol} everywhere
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
                  Deploying on {chainName}
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
                  ${tokenSymbol} deployed
                </p>
                {txHash && (
                  <a
                    href={`${EXPLORER_URLS[chainId]}${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-juice-cyan hover:underline"
                  >
                    View on explorer
                  </a>
                )}
                {useAllChains && omnichainComplete && (
                  <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Same address on all {allChainProjects?.length} chains
                  </p>
                )}
              </div>
            </div>
          )}

          {showFailed && (error || bundleState.error) && (
            <div className={`p-4 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              <p className={`font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                Transaction failed
              </p>
              <p className={`text-sm mt-1 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>
                {error || bundleState.error}
              </p>
            </div>
          )}

          {/* Deployment Details */}
          {(status === 'preview' || isProcessing) && !showConfirmed && !showFailed && (
            <>
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
                        Deploy on all {allChainProjects?.length} chains
                      </div>
                      <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Same token address everywhere via CREATE2
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

              {/* Project */}
              <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className={`text-xs uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Deploying for
                </div>
                <div className={`font-semibold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {projectName || `Project #${projectId}`}
                </div>
              </div>

              {/* Token details */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Token Name</span>
                  <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {tokenName}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Token Symbol</span>
                  <span className={`font-mono font-bold text-lg ${isDark ? 'text-juice-cyan' : 'text-cyan-600'}`}>
                    ${tokenSymbol}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Network</span>
                  <span className={isDark ? 'text-white' : 'text-gray-900'}>
                    {useAllChains && allChainProjects ? `${allChainProjects.length} chains` : chainName}
                  </span>
                </div>
              </div>

              <div className={`p-3 text-sm ${isDark ? 'bg-juice-cyan/10 text-juice-cyan' : 'bg-cyan-50 text-cyan-700'}`}>
                {useAllChains
                  ? 'Deploy the same ERC-20 token contract at the same address on all chains. Token holders can claim and transfer freely on any chain.'
                  : 'This will create a new ERC-20 token contract. Token holders can then claim their tokens and transfer them freely.'}
              </div>

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
            </>
          )}

          {/* Summary (for confirmed) */}
          {showConfirmed && (
            <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Token Name</span>
                  <span className={isDark ? 'text-white' : 'text-gray-900'}>
                    {tokenName}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Symbol</span>
                  <span className={`font-mono text-juice-cyan`}>
                    ${tokenSymbol}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Network</span>
                  <span className={isDark ? 'text-white' : 'text-gray-900'}>
                    {useAllChains && allChainProjects ? `${allChainProjects.length} chains` : chainName}
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
                disabled={!hasGasBalance}
                className="flex-1 py-3 font-bold bg-juice-cyan text-black hover:bg-juice-cyan/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {useAllChains ? `Deploy on ${allChainProjects?.length} Chains` : `Deploy $${tokenSymbol}`}
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
              className="w-full py-3 font-medium bg-juice-cyan text-black hover:bg-juice-cyan/90 transition-colors"
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
