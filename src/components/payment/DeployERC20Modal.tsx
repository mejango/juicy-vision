import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { encodeFunctionData, keccak256, toBytes, createPublicClient, http, type Chain, type Address } from 'viem'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { GasBalanceStatus } from './GasBalanceStatus'
import { useOmnichainDeployERC20 } from '../../hooks/relayr'
import { ALL_VIEM_CHAINS, CHAINS as CHAIN_INFO, EXPLORER_URLS, RPC_ENDPOINTS } from '../../constants'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifyDeployERC20Params } from '../../utils/transactionVerification'
import { getProjectController } from '../../utils/paymentTerminal'
import { simulateTransaction, waitForSuccessfulTransaction } from '../../utils/transactionSafety'
import { assertSafeErc20TokenMetadata } from '../../utils/erc20Safety'
import { useReviewedTransactionAccount } from '../../hooks/useReviewedTransactionAccount'

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

const CHAINS: Record<number, Chain> = ALL_VIEM_CHAINS

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
  // Transaction status callbacks for persistence
  onSubmitted?: (txHash: string) => void
  onConfirmed?: (txHash: string) => void
  onError?: (error: string) => void
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
  onSubmitted,
  onConfirmed,
  onError,
}: DeployERC20ModalProps) {
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
  const activeAddress = isManagedMode ? managedAddress : address
  const { assertCurrentAccount } = useReviewedTransactionAccount(
    isOpen,
    activeAddress,
    isManagedMode ? 'managed' : 'self_custody',
  )

  const [status, setStatus] = useState<DeployStatus>('preview')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const [controllerAddress, setControllerAddress] = useState<Address | null>(null)
  const [controllerLoading, setControllerLoading] = useState(false)
  // Ref-based in-flight lock: the mutex that stops two same-tick clicks (a
  // state flag alone can't — both reads see the stale `false`). `submitting`
  // only mirrors it into the button's disabled state for the UI.
  const inFlightRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)

  // Omnichain mode
  const [useAllChains, setUseAllChains] = useState(false)
  const {
    deploy,
    bundleState,
    isExecuting,
    isComplete: omnichainComplete,
    hasError: omnichainError,
    reset: resetOmnichain,
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

  const chainName = CHAIN_INFO[chainId]?.name || `Chain ${chainId}`
  const hasGasBalance = isManagedMode || (balancesAvailable && (useAllChains
    ? perChain.some(balance => balance.eth > 0n)
    : (perChain.find(balance => balance.chainId === chainId)?.eth ?? 0n) > 0n))

  // Verify transaction parameters
  const verificationResult = useMemo(() => {
    return verifyDeployERC20Params({
      projectId: BigInt(projectId),
      name: tokenName,
      symbol: tokenSymbol,
      salt: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`, // Placeholder
    })
  }, [projectId, tokenName, tokenSymbol])

  const hasWarnings = verificationResult.doubts.length > 0
  const hasCriticalDoubts = verificationResult.doubts.some(d => d.severity === 'critical')
  const canProceed = hasGasBalance && !hasCriticalDoubts && (!hasWarnings || warningsAcknowledged) && !!controllerAddress && !controllerLoading && !submitting && !isExecuting

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('preview')
      setTxHash(null)
      setError(null)
      setUseAllChains(false)
      setWarningsAcknowledged(false)
      inFlightRef.current = false
      setSubmitting(false)
      resetOmnichain()
    }
  }, [isOpen, resetOmnichain])

  // Call parent callbacks when status changes (for persistence)
  useEffect(() => {
    if (status === 'confirmed' && txHash) {
      onConfirmed?.(txHash)
    } else if (status === 'failed' && error) {
      onError?.(error)
    }
  }, [status, txHash, error, onConfirmed, onError])

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
        setError(err instanceof Error ? err.message : 'Failed to fetch project controller')
      } finally {
        setControllerLoading(false)
      }
    }

    fetchController()
  }, [isOpen, projectId, chainId])

  const handleConfirm = useCallback(async () => {
    // Acquire the in-flight lock before any await. A second concurrent click
    // returns here (outside the try below) without resetting the lock, so
    // only one deployment flow can ever reach send.
    if (inFlightRef.current) return
    inFlightRef.current = true
    setSubmitting(true)
    try {
    try {
      assertSafeErc20TokenMetadata(tokenName, tokenSymbol)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Token metadata is invalid')
      return
    }
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
      // Use Relayr omnichain deployment - same token address on all chains
      setError(null)
      try {
        assertCurrentAccount(isManagedMode ? undefined : walletClient?.account?.address)
        const projectIds: Record<number, number> = {}
        allChainProjects.forEach(cp => {
          projectIds[cp.chainId] = typeof cp.projectId === 'string' ? parseInt(cp.projectId) : cp.projectId
        })

        const controllerEntries = await Promise.all(allChainProjects.map(async cp => {
          const chain = CHAINS[cp.chainId]
          const rpcUrl = RPC_ENDPOINTS[cp.chainId]?.[0]
          if (!chain || !rpcUrl) throw new Error(`Unsupported chain ${cp.chainId}`)
          const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
          const controller = await getProjectController(publicClient, BigInt(projectIds[cp.chainId]))
          return [cp.chainId, controller] as const
        }))

        assertCurrentAccount(isManagedMode ? undefined : walletClient?.account?.address)
        await deploy({
          chainIds: allChainProjects.map(cp => cp.chainId),
          projectIds,
          tokenName,
          tokenSymbol,
          controllerAddresses: Object.fromEntries(controllerEntries),
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Token deployment preflight failed')
        setStatus('failed')
      }
      return
    }

    // Single chain deployment
    setError(null)

    const chain = CHAINS[chainId]

    if (!chain) {
      setError('Unsupported chain')
      setStatus('failed')
      return
    }

    try {
      assertCurrentAccount(isManagedMode ? undefined : walletClient?.account?.address)
      const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
      if (!rpcUrl) throw new Error(`No RPC endpoint configured for chain ${chainId}`)
      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
      const freshController = await getProjectController(publicClient, BigInt(projectId))

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
      await simulateTransaction({
        chainId,
        account: activeAddress as `0x${string}`,
        to: freshController,
        data: callData,
      })

      const txId = addTransaction({
        type: 'deploy',
        projectId,
        chainId,
        amount: '0',
        status: 'pending',
      })

      let hash: string

      if (isManagedMode) {
        // Execute via backend for managed mode
        assertCurrentAccount()
        setStatus('pending')
        hash = await executeManagedTransaction(chainId, freshController, callData, '0')
      } else {
        // Execute via wallet for self-custody mode
        setStatus('signing')
        await switchChainAsync({ chainId })
        if (await walletClient!.getChainId() !== chainId) {
          throw new Error(`Wallet did not switch to chain ${chainId}`)
        }
        const finalController = await getProjectController(publicClient, BigInt(projectId))
        if (finalController.toLowerCase() !== freshController.toLowerCase()) {
          throw new Error('The project controller changed. Close this review and try again.')
        }
        await simulateTransaction({
          chainId,
          account: activeAddress as `0x${string}`,
          to: finalController,
          data: callData,
        })
        assertCurrentAccount(walletClient!.account?.address)
        hash = await walletClient!.sendTransaction({
          to: finalController,
          data: callData,
          value: 0n,
        })
        setStatus('pending')
      }

      setTxHash(hash)
      updateTransaction(txId, { hash, status: 'submitted' })
      onSubmitted?.(hash)
      if (!isManagedMode) await waitForSuccessfulTransaction(chainId, hash as `0x${string}`)
      updateTransaction(txId, { hash, status: 'confirmed' })
      setStatus('confirmed')
    } catch (err) {
      console.error('Deploy ERC20 failed:', err)
      setError(err instanceof Error ? err.message : 'Transaction failed')
      setStatus('failed')
    }
    } finally {
      inFlightRef.current = false
      setSubmitting(false)
    }
  }, [walletClient, address, activeAddress, chainId, projectId, tokenName, tokenSymbol, addTransaction, updateTransaction, switchChainAsync, isManagedMode, managedAddress, useAllChains, allChainProjects, deploy, onSubmitted, assertCurrentAccount])

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
              <GasBalanceStatus
                balance={totalEth}
                hasGasBalance={hasGasBalance}
                loading={balancesLoading}
                available={balancesAvailable}
                managed={isManagedMode}
                isDark={isDark}
              />

              {/* Transaction Summary */}
              <TransactionSummary
                type="deployERC20"
                details={{
                  projectId,
                  projectName,
                  tokenName,
                  tokenSymbol,
                  chainIds: useAllChains && allChainProjects ? allChainProjects.map(cp => cp.chainId) : [chainId],
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
              {/* Controller loading indicator */}
              {controllerLoading && (
                <div className={`p-3 text-sm flex items-center gap-2 ${isDark ? 'bg-juice-cyan/10 text-juice-cyan' : 'bg-cyan-50 text-cyan-700'}`}>
                  <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  Fetching project controller...
                </div>
              )}

              <TechnicalDetails
                contract="JB_CONTROLLER"
                contractAddress={controllerAddress || '0x0000000000000000000000000000000000000000'}
                functionName="deployERC20For"
                chainId={chainId}
                chainName={useAllChains ? `${allChainProjects?.length} chains` : chainName}
                projectId={projectId}
                parameters={verificationResult.verifiedParams}
                isDark={isDark}
                allChains={useAllChains && allChainProjects ? allChainProjects.map(cp => ({
                  chainId: cp.chainId,
                  chainName: CHAIN_INFO[cp.chainId]?.name || `Chain ${cp.chainId}`,
                  projectId: typeof cp.projectId === 'string' ? parseInt(cp.projectId) : cp.projectId,
                })) : undefined}
              />
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
                disabled={!canProceed}
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
