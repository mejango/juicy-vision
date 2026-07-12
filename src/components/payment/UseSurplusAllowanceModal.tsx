import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { parseUnits, encodeFunctionData, createPublicClient, http, type Chain, type Address } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { useReviewedTransactionAccount } from '../../hooks/useReviewedTransactionAccount'
import { GasBalanceStatus } from './GasBalanceStatus'
import {
  NATIVE_TOKEN,
  RPC_ENDPOINTS,
  USDC_ADDRESSES,
  type SupportedChainId,
} from '../../constants'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifyUseAllowanceParams } from '../../utils/transactionVerification'
import { getPaymentTerminal } from '../../utils/paymentTerminal'
import { simulateTransaction, waitForSuccessfulTransaction } from '../../utils/transactionSafety'
import { fetchProjectSplits, fetchProjectWithRuleset } from '../../services/bendystraw'

const TERMINAL_USE_ALLOWANCE_ABI = [
  {
    name: 'useAllowanceOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'currency', type: 'uint256' },
      { name: 'minTokensPaidOut', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'feeBeneficiary', type: 'address' },
      { name: 'memo', type: 'string' },
    ],
    outputs: [{ name: 'amountPaidOut', type: 'uint256' }],
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

interface UseSurplusAllowanceModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName?: string
  chainId: number
  amount: string
  allowanceCurrency: number
  allowanceTokenAddress: Address
  allowanceTokenDecimals: number
  // Transaction status callbacks for persistence
  onSubmitted?: (txHash: string) => void
  onConfirmed?: (txHash: string) => void
  onError?: (error: string) => void
}

type WithdrawStatus = 'preview' | 'signing' | 'pending' | 'confirmed' | 'failed'

export default function UseSurplusAllowanceModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  chainId,
  amount,
  allowanceCurrency,
  allowanceTokenAddress,
  allowanceTokenDecimals,
  onSubmitted,
  onConfirmed,
  onError,
}: UseSurplusAllowanceModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const { addTransaction, updateTransaction } = useTransactionStore()
  const { perChain, loading: balancesLoading, available: balancesAvailable } = useWalletBalances()

  // Managed mode support
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address: managedAddress } = useManagedWallet()

  const [status, setStatus] = useState<WithdrawStatus>('preview')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const [terminalAddress, setTerminalAddress] = useState<Address | null>(null)
  const [terminalLoading, setTerminalLoading] = useState(false)

  const activeAddress = isManagedMode ? managedAddress : address
  const { assertCurrentAccount } = useReviewedTransactionAccount(
    isOpen,
    activeAddress,
    isManagedMode ? 'managed' : 'self_custody',
  )
  const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`
  const withdrawToken = allowanceTokenAddress
  const canonicalUsdc = USDC_ADDRESSES[chainId as SupportedChainId]
  const currencyLabel = withdrawToken.toLowerCase() === NATIVE_TOKEN.toLowerCase()
    ? 'ETH'
    : canonicalUsdc && withdrawToken.toLowerCase() === canonicalUsdc.toLowerCase()
      ? 'USDC'
      : 'TOKEN'
  const amountDecimals = allowanceTokenDecimals
  const amountNum = parseFloat(amount) || 0
  const maximumProtocolFee = amountNum * 0.025
  const minimumWithdraw = amountNum - maximumProtocolFee
  const chainGasBalance = perChain.find(balance => balance.chainId === chainId)?.eth ?? 0n
  const hasGasBalance = isManagedMode || (balancesAvailable && chainGasBalance > 0n)

  const withdrawalAmount = useMemo(() => {
    try {
      const parsed = parseUnits(amount, amountDecimals)
      return parsed > 0n ? parsed : null
    } catch {
      return null
    }
  }, [amount, amountDecimals])

  // Verify transaction parameters
  const verificationResult = useMemo(() => {
    const defaultAddress = '0x0000000000000000000000000000000000000000'
    const verifiedAmount = withdrawalAmount ?? 0n
    const minimumTokensPaidOut = verifiedAmount - (verifiedAmount / 40n)
    return verifyUseAllowanceParams({
      projectId: BigInt(projectId),
      token: withdrawToken,
      amount: verifiedAmount,
      currency: BigInt(allowanceCurrency),
      minTokensPaidOut: minimumTokensPaidOut,
      beneficiary: activeAddress || defaultAddress,
      feeBeneficiary: activeAddress || defaultAddress,
      memo: '',
    })
  }, [projectId, withdrawalAmount, allowanceCurrency, activeAddress, withdrawToken])

  const hasWarnings = verificationResult.doubts.length > 0
  const hasCriticalDoubts = verificationResult.doubts.some(d => d.severity === 'critical')
  const canProceed = withdrawalAmount !== null && hasGasBalance && !hasCriticalDoubts && (!hasWarnings || warningsAcknowledged) && !!terminalAddress && !terminalLoading

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('preview')
      setTxHash(null)
      setError(null)
      setWarningsAcknowledged(false)
    }
  }, [isOpen])

  // Call parent callbacks when status changes (for persistence)
  useEffect(() => {
    if (status === 'confirmed' && txHash) {
      onConfirmed?.(txHash)
    } else if (status === 'failed' && error) {
      onError?.(error)
    }
  }, [status, txHash, error, onConfirmed, onError])

  // Fetch the project's terminal from JBDirectory
  useEffect(() => {
    if (!isOpen || !projectId || !chainId) {
      setTerminalAddress(null)
      return
    }

    const fetchTerminal = async () => {
      setTerminalLoading(true)
      try {
        const chain = CHAINS[chainId]
        if (!chain) {
          console.error('Unsupported chain for terminal lookup:', chainId)
          return
        }

        const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        })

        // The token comes from the project's live accounting configuration.
        const terminal = await getPaymentTerminal(publicClient, chainId, BigInt(projectId), withdrawToken, 'accounting')
        setTerminalAddress(terminal.address)
      } catch (err) {
        console.error('Failed to fetch payment terminal:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch payment terminal')
      } finally {
        setTerminalLoading(false)
      }
    }

    fetchTerminal()
  }, [isOpen, projectId, chainId, withdrawToken])

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
      if (withdrawalAmount === null) throw new Error('Enter a valid withdrawal amount')
      const withdrawAmount = withdrawalAmount
      const tokenCurrency = Number(BigInt(withdrawToken) & 0xffffffffn)
      if (allowanceCurrency !== tokenCurrency) {
        throw new Error('Surplus allowance currency conversion is not supported in this view')
      }
      const minimumTokensPaidOut = withdrawAmount - (withdrawAmount / 40n)
      const prepareAllowance = async () => {
        const freshTerminal = await getPaymentTerminal(
          publicClient,
          chainId,
          BigInt(projectId),
          withdrawToken,
          'accounting',
        )
        const freshProject = await fetchProjectWithRuleset(projectId, chainId)
        const currentRulesetId = freshProject?.currentRuleset?.id
        if (!currentRulesetId) throw new Error('Current ruleset is unavailable')
        const freshConfiguration = await fetchProjectSplits(projectId, chainId, currentRulesetId)
        if (!freshConfiguration.configurationComplete) {
          throw new Error('Surplus allowance configuration could not be verified')
        }
        const matchingGroups = (freshConfiguration.fundAccessLimitGroups || []).filter(group =>
          group.terminal.toLowerCase() === freshTerminal.address.toLowerCase() &&
          group.token.toLowerCase() === withdrawToken.toLowerCase() &&
          group.surplusAllowances.some(allowance => allowance.currency === allowanceCurrency)
        )
        if (matchingGroups.length !== 1) {
          throw new Error('The selected surplus allowance is no longer uniquely configured')
        }
        const matchingAllowances = matchingGroups[0].surplusAllowances.filter(
          allowance => allowance.currency === allowanceCurrency,
        )
        if (matchingAllowances.length !== 1) {
          throw new Error('The selected surplus allowance is no longer uniquely configured')
        }
        const allowance = matchingAllowances[0]
        const limit = BigInt(allowance.amount)
        const used = BigInt(allowance.usedAmount)
        const currentSurplus = BigInt(allowance.currentSurplus)
        const remaining = limit > used ? limit - used : 0n
        const available = remaining < currentSurplus ? remaining : currentSurplus
        if (withdrawAmount > available) {
          throw new Error('The requested surplus withdrawal is no longer available')
        }
        const args = [
          BigInt(projectId),
          withdrawToken,
          withdrawAmount,
          BigInt(allowanceCurrency),
          minimumTokensPaidOut,
          activeAddress as Address,
          activeAddress as Address,
          '',
        ] as const
        const { result: quotedAmount } = await publicClient.simulateContract({
          address: freshTerminal.address,
          abi: TERMINAL_USE_ALLOWANCE_ABI,
          functionName: 'useAllowanceOf',
          args,
          account: activeAddress as Address,
        })
        if (quotedAmount < minimumTokensPaidOut) {
          throw new Error('This withdrawal would return less than the reviewed minimum')
        }
        const data = encodeFunctionData({
          abi: TERMINAL_USE_ALLOWANCE_ABI,
          functionName: 'useAllowanceOf',
          args,
        })
        await simulateTransaction({
          chainId,
          account: activeAddress as Address,
          to: freshTerminal.address,
          data,
        })
        return { target: freshTerminal.address, data, quotedAmount }
      }
      const prepared = await prepareAllowance()

      const txId = addTransaction({
        type: 'deploy',
        projectId,
        chainId,
        amount,
        status: 'pending',
      })

      let hash: string

      if (isManagedMode) {
        // Execute via backend for managed mode
        assertCurrentAccount()
        setStatus('pending')
        hash = await executeManagedTransaction(chainId, prepared.target, prepared.data, '0')
      } else {
        // Execute via wallet for self-custody mode
        setStatus('signing')
        await switchChainAsync({ chainId })
        if (await walletClient!.getChainId() !== chainId) {
          throw new Error(`Wallet did not switch to chain ${chainId}`)
        }
        const finalPrepared = await prepareAllowance()
        if (
          finalPrepared.target.toLowerCase() !== prepared.target.toLowerCase() ||
          finalPrepared.quotedAmount !== prepared.quotedAmount
        ) {
          throw new Error('The surplus withdrawal quote changed. Close this review and try again.')
        }
        assertCurrentAccount(walletClient!.account?.address)
        hash = await walletClient!.sendTransaction({
          to: finalPrepared.target,
          data: finalPrepared.data,
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
      console.error('Use surplus allowance failed:', err)
      setError(err instanceof Error ? err.message : 'Transaction failed')
      setStatus('failed')
    }
  }, [walletClient, address, chainId, projectId, amount, withdrawalAmount, allowanceCurrency, withdrawToken, addTransaction, updateTransaction, switchChainAsync, isManagedMode, managedAddress, onSubmitted, assertCurrentAccount])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={status === 'preview' || status === 'confirmed' || status === 'failed' ? onClose : undefined}
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
              isDark ? 'bg-purple-500/20' : 'bg-purple-100'
            }`}>
              💰
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {status === 'confirmed' ? 'Funds Withdrawn' : status === 'failed' ? 'Withdrawal Failed' : 'Confirm Withdrawal'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {chainName}
              </p>
            </div>
          </div>
          {(status === 'preview' || status === 'confirmed' || status === 'failed') && (
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
          {/* Status Messages */}
          {status === 'signing' && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full" />
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

          {status === 'pending' && (
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

          {status === 'confirmed' && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
              <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Funds withdrawn
                </p>
                {txHash && (
                  <a
                    href={`${EXPLORER_URLS[chainId]}${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-juice-cyan hover:underline"
                  >
                    View on explorer →
                  </a>
                )}
              </div>
            </div>
          )}

          {status === 'failed' && error && (
            <div className={`p-4 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              <p className={`font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                Transaction failed
              </p>
              <p className={`text-sm mt-1 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>
                {error}
              </p>
            </div>
          )}

          {/* Withdrawal Details */}
          {(status === 'preview' || status === 'signing' || status === 'pending') && (
            <>
              {/* Project */}
              <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className={`text-xs uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Withdrawing from
                </div>
                <div className={`font-semibold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {projectName || `Project #${projectId}`}
                </div>
              </div>

              {/* Amount breakdown */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Amount</span>
                  <span className={`font-mono font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {amountNum.toFixed(4)} {currencyLabel}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>
                    Maximum protocol fee (2.5%)
                  </span>
                  <span className={`font-mono ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
                    up to {maximumProtocolFee.toFixed(4)} {currencyLabel}
                  </span>
                </div>

                <div className={`flex justify-between items-center pt-2 border-t ${
                  isDark ? 'border-white/10' : 'border-gray-200'
                }`}>
                  <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>You receive at least</span>
                  <span className={`font-mono font-bold text-lg ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
                    {minimumWithdraw.toFixed(4)} {currencyLabel}
                  </span>
                </div>
              </div>

              <div className={`p-3 text-sm ${isDark ? 'bg-purple-500/10 text-purple-300' : 'bg-purple-50 text-purple-700'}`}>
                Funds will be sent to your connected wallet address.
              </div>

              {/* Gas balance check */}
              <GasBalanceStatus
                balance={chainGasBalance}
                hasGasBalance={hasGasBalance}
                loading={balancesLoading}
                available={balancesAvailable}
                managed={isManagedMode}
                isDark={isDark}
              />

              {/* Transaction Summary */}
              <TransactionSummary
                type="useAllowance"
                details={{
                  projectId,
                  projectName,
                  amount: amountNum.toString(),
                  amountFormatted: `${amountNum.toFixed(currencyLabel === 'USDC' ? 2 : 4)} ${currencyLabel}`,
                  fee: maximumProtocolFee.toString(),
                  feeFormatted: `${maximumProtocolFee.toFixed(currencyLabel === 'USDC' ? 2 : 4)} ${currencyLabel}`,
                  netAmount: minimumWithdraw.toString(),
                  netAmountFormatted: `${minimumWithdraw.toFixed(currencyLabel === 'USDC' ? 2 : 4)} ${currencyLabel}`,
                  destination: activeAddress || '',
                  currency: currencyLabel,
                }}
                isDark={isDark}
              />

              {/* Transaction Warning */}
              {hasWarnings && (
                <TransactionWarning
                  doubts={verificationResult.doubts}
                  onConfirm={() => setWarningsAcknowledged(true)}
                  onCancel={onClose}
                  isDark={isDark}
                />
              )}

              {/* Technical Details */}
              {/* Terminal loading indicator */}
              {terminalLoading && (
                <div className={`p-3 text-sm flex items-center gap-2 ${isDark ? 'bg-juice-cyan/10 text-juice-cyan' : 'bg-cyan-50 text-cyan-700'}`}>
                  <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  Fetching payment terminal...
                </div>
              )}

              <TechnicalDetails
                contract="JB_MULTI_TERMINAL"
                contractAddress={terminalAddress || '0x0000000000000000000000000000000000000000'}
                functionName="useAllowanceOf"
                chainId={chainId}
                chainName={chainName}
                projectId={projectId}
                parameters={verificationResult.verifiedParams}
                isDark={isDark}
              />
            </>
          )}

          {/* Summary (for confirmed) */}
          {status === 'confirmed' && (
            <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Withdrawn</span>
                  <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {amountNum.toFixed(4)} {currencyLabel}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Maximum protocol fee</span>
                  <span className={`font-mono ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
                    up to {maximumProtocolFee.toFixed(4)} {currencyLabel}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Minimum expected</span>
                  <span className={`font-mono text-purple-500`}>
                    {minimumWithdraw.toFixed(4)} {currencyLabel}
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
                onClick={handleConfirm}
                disabled={!canProceed}
                className="flex-1 py-3 font-bold bg-purple-500 text-white hover:bg-purple-500/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Withdraw
              </button>
            </div>
          )}

          {(status === 'signing' || status === 'pending') && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Do not close this window
            </div>
          )}

          {(status === 'confirmed' || status === 'failed') && (
            <button
              onClick={onClose}
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
