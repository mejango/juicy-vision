import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { parseUnits, encodeFunctionData, createPublicClient, http, type Chain, type Address } from 'viem'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { useReviewedTransactionAccount } from '../../hooks/useReviewedTransactionAccount'
import { GasBalanceStatus } from './GasBalanceStatus'
import {
  ALL_VIEM_CHAINS,
  CHAINS as CHAIN_INFO,
  NATIVE_TOKEN,
  RPC_ENDPOINTS,
  USDC_ADDRESSES,
  type SupportedChainId,
} from '../../constants'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifySendPayoutsParams } from '../../utils/transactionVerification'
import { getPaymentTerminal } from '../../utils/paymentTerminal'
import { simulateTransaction, waitForSuccessfulTransaction } from '../../utils/transactionSafety'
import { assertSimpleStoredSplitGroups } from '../../utils/splitSafety'
import {
  fetchDistributablePayout,
  fetchProjectSplits,
  fetchProjectWithRuleset,
} from '../../services/bendystraw'
import { ProjectSplitRoute } from '../dynamic/ProjectSplitRoute'

const TERMINAL_SEND_PAYOUTS_ABI = [
  {
    name: 'sendPayoutsOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'currency', type: 'uint256' },
      { name: 'minTokensPaidOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountPaidOut', type: 'uint256' }],
  },
] as const

// viem chain objects for wallet operations
const CHAINS: Record<number, Chain> = ALL_VIEM_CHAINS

interface SendPayoutsModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName?: string
  chainId: number
  amount: string
  baseCurrency?: number // 1 = ETH, 2 = USD
  payoutCurrency: number
  payoutTokenAddress: Address
  payoutTokenDecimals: number
  splits?: Array<{
    beneficiary: string
    percent: number
    hook?: string
    projectId?: number
    preferAddToBalance?: boolean
    lockedUntil?: number
  }>
  // Transaction status callbacks for persistence
  onSubmitted?: (txHash: string) => void
  onConfirmed?: (txHash: string) => void
  onError?: (error: string) => void
}

type PayoutStatus = 'preview' | 'signing' | 'pending' | 'confirmed' | 'failed'

export default function SendPayoutsModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  chainId,
  amount,
  payoutCurrency,
  payoutTokenAddress,
  payoutTokenDecimals,
  splits = [],
  onSubmitted,
  onConfirmed,
  onError,
}: SendPayoutsModalProps) {
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

  const [status, setStatus] = useState<PayoutStatus>('preview')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const [terminalAddress, setTerminalAddress] = useState<Address | null>(null)
  const [terminalLoading, setTerminalLoading] = useState(false)

  const chainInfo = CHAIN_INFO[chainId] || CHAIN_INFO[1]
  const chainName = chainInfo.name
  const payoutToken = payoutTokenAddress
  const canonicalUsdc = USDC_ADDRESSES[chainId as SupportedChainId]
  const currencyLabel = payoutToken.toLowerCase() === NATIVE_TOKEN.toLowerCase()
    ? 'ETH'
    : canonicalUsdc && payoutToken.toLowerCase() === canonicalUsdc.toLowerCase()
      ? 'USDC'
      : 'TOKEN'
  const amountDecimals = payoutTokenDecimals
  const amountNum = parseFloat(amount) || 0
  const maximumProtocolFee = amountNum * 0.025
  const hasGasBalance = isManagedMode || (balancesAvailable &&
    (perChain.find(balance => balance.chainId === chainId)?.eth ?? 0n) > 0n
  )

  const payoutAmount = useMemo(() => {
    try {
      const parsed = parseUnits(amount, amountDecimals)
      return parsed > 0n ? parsed : null
    } catch {
      return null
    }
  }, [amount, amountDecimals])

  // Verify transaction parameters
  const verificationResult = useMemo(() => {
    return verifySendPayoutsParams({
      projectId: BigInt(projectId),
      token: payoutToken,
      amount: payoutAmount ?? 0n,
      currency: BigInt(payoutCurrency),
      minTokensPaidOut: payoutAmount ?? 0n,
    })
  }, [projectId, payoutAmount, payoutCurrency, payoutToken])

  const hasWarnings = verificationResult.doubts.length > 0
  const hasCriticalDoubts = verificationResult.doubts.some(d => d.severity === 'critical')
  const canProceed = payoutAmount !== null && hasGasBalance && !hasCriticalDoubts && (!hasWarnings || warningsAcknowledged) && !!terminalAddress && !terminalLoading

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
        const terminal = await getPaymentTerminal(publicClient, chainId, BigInt(projectId), payoutToken, 'accounting')
        setTerminalAddress(terminal.address)
      } catch (err) {
        console.error('Failed to fetch payment terminal:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch payment terminal')
      } finally {
        setTerminalLoading(false)
      }
    }

    fetchTerminal()
  }, [isOpen, projectId, chainId, payoutToken])

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

    // Single chain execution
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
      const splitSignature = (entries: Array<{
        beneficiary: string
        percent: number
        hook?: string
        projectId?: number
        preferAddToBalance?: boolean
        lockedUntil?: number
      }>) =>
        entries.map(split => [
          split.beneficiary.toLowerCase(),
          split.percent,
          (split.hook || '').toLowerCase(),
          split.projectId ?? 0,
          split.preferAddToBalance === true,
          split.lockedUntil ?? 0,
        ].join(':')).join('|')
      if (payoutAmount === null) throw new Error('Enter a valid payout amount')
      const tokenCurrency = Number(BigInt(payoutToken) & 0xffffffffn)
      if (payoutCurrency !== tokenCurrency) {
        throw new Error('Payout currency conversion is not supported in this view')
      }
      const preparePayout = async () => {
        const freshTerminal = await getPaymentTerminal(
          publicClient,
          chainId,
          BigInt(projectId),
          payoutToken,
          'accounting',
        )
        const freshProject = await fetchProjectWithRuleset(projectId, chainId)
        const currentRulesetId = freshProject?.currentRuleset?.id
        if (!currentRulesetId) throw new Error('Current ruleset is unavailable')
        const freshConfiguration = await fetchProjectSplits(projectId, chainId, currentRulesetId)
        if (!freshConfiguration.configurationComplete) {
          throw new Error('Payout configuration could not be verified')
        }
        const matchingGroups = (freshConfiguration.fundAccessLimitGroups || []).filter(group =>
          group.terminal.toLowerCase() === freshTerminal.address.toLowerCase() &&
          group.token.toLowerCase() === payoutToken.toLowerCase() &&
          group.payoutLimits.some(limit => limit.currency === payoutCurrency)
        )
        if (matchingGroups.length !== 1 ||
            matchingGroups[0].payoutLimits.filter(limit => limit.currency === payoutCurrency).length !== 1) {
          throw new Error('The selected payout limit is no longer uniquely configured')
        }
        const freshSplits = freshConfiguration.splitGroups?.find(
          group => group.groupId === BigInt(payoutToken).toString(),
        )?.splits || []
        assertSimpleStoredSplitGroups([{ splits: freshSplits }], {
          kind: 'payout',
          sourceProjectId: projectId,
        })
        if (splitSignature(freshSplits) !== splitSignature(splits)) {
          throw new Error('Payout recipients changed. Close this review and load the latest configuration.')
        }
        const freshPayout = await fetchDistributablePayout(
          projectId,
          chainId,
          payoutCurrency,
          payoutToken,
          payoutTokenDecimals,
        )
        if (!freshPayout || payoutAmount > freshPayout.available) {
          throw new Error('The requested payout is no longer available')
        }
        const args = [
          BigInt(projectId),
          payoutToken,
          payoutAmount,
          BigInt(payoutCurrency),
          payoutAmount,
        ] as const
        const { result: quotedAmount } = await publicClient.simulateContract({
          address: freshTerminal.address,
          abi: TERMINAL_SEND_PAYOUTS_ABI,
          functionName: 'sendPayoutsOf',
          args,
          account: activeAddress as Address,
        })
        if (quotedAmount <= 0n) throw new Error('This payout would not send any tokens')
        if (quotedAmount !== payoutAmount) {
          throw new Error('The full reviewed payout is no longer available')
        }
        const data = encodeFunctionData({
          abi: TERMINAL_SEND_PAYOUTS_ABI,
          functionName: 'sendPayoutsOf',
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
      const prepared = await preparePayout()

      const txId = addTransaction({
        type: 'deploy', // Reusing for now
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
        const finalPrepared = await preparePayout()
        if (
          finalPrepared.target.toLowerCase() !== prepared.target.toLowerCase() ||
          finalPrepared.quotedAmount !== prepared.quotedAmount
        ) {
          throw new Error('The payout quote changed. Close this review and try again.')
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
      console.error('Send payouts failed:', err)
      setError(err instanceof Error ? err.message : 'Transaction failed')
      setStatus('failed')
    }
  }, [walletClient, address, activeAddress, chainId, projectId, amount, payoutAmount, payoutCurrency, payoutToken, payoutTokenDecimals, splits, addTransaction, updateTransaction, switchChainAsync, isManagedMode, managedAddress, onSubmitted, assertCurrentAccount])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  if (!isOpen) return null

  const isProcessing = status === 'signing' || status === 'pending'
  const showConfirmed = status === 'confirmed'
  const showFailed = status === 'failed'

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
              isDark ? 'bg-juice-orange/20' : 'bg-orange-100'
            }`}>
              📤
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {showConfirmed ? 'Payouts Sent' : showFailed ? 'Payout Failed' : 'Confirm Payouts'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {chainName}
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
          {status === 'signing' && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-juice-orange/10' : 'bg-orange-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-juice-orange border-t-transparent rounded-full" />
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

          {showConfirmed && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
              <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Payouts distributed
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
              </div>
            </div>
          )}

          {showFailed && error && (
            <div className={`p-4 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              <p className={`font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                Transaction failed
              </p>
              <p className={`text-sm mt-1 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>
                {error}
              </p>
            </div>
          )}

          {/* Payout Details */}
          {(status === 'preview' || isProcessing) && !showConfirmed && !showFailed && (
            <>
              {/* Project */}
              <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className={`text-xs uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Distributing from
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
                <p className={`pt-2 border-t text-xs ${
                  isDark ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'
                }`}>
                  Fees are calculated per recipient. Recognized project-to-project destinations may be fee-free.
                </p>
              </div>

              {/* Splits preview */}
              {splits.length > 0 && (
                <div className={`p-3 space-y-1 text-sm ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className={`text-xs uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    Recipients
                  </div>
                  {splits.slice(0, 3).map((split, i) => (
                    <div key={i} className="flex items-start justify-between gap-3">
                      {split.projectId ? (
                        <ProjectSplitRoute
                          projectId={split.projectId}
                          chainId={chainId}
                          beneficiary={split.beneficiary}
                          kind="payout"
                          preferAddToBalance={split.preferAddToBalance}
                          hook={split.hook}
                          isDark={isDark}
                        />
                      ) : (
                        <span className={`font-mono ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {split.beneficiary.slice(0, 6)}...{split.beneficiary.slice(-4)}
                        </span>
                      )}
                      <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>
                        {((split.percent / 1_000_000_000) * 100).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                  {splits.length > 3 && (
                    <div className={`text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      +{splits.length - 3} more
                    </div>
                  )}
                </div>
              )}

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
                type="sendPayouts"
                details={{
                  projectId,
                  projectName,
                  amount: amountNum.toString(),
                  amountFormatted: `${amountNum.toFixed(currencyLabel === 'USDC' ? 2 : 4)} ${currencyLabel}`,
                  fee: maximumProtocolFee.toString(),
                  feeFormatted: `${maximumProtocolFee.toFixed(currencyLabel === 'USDC' ? 2 : 4)} ${currencyLabel}`,
                  recipients: splits.map(s => ({
                    address: s.beneficiary,
                    percent: s.percent,
                  })),
                  currency: currencyLabel,
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

              {/* Terminal loading indicator */}
              {terminalLoading && (
                <div className={`p-3 text-sm flex items-center gap-2 ${isDark ? 'bg-juice-cyan/10 text-juice-cyan' : 'bg-cyan-50 text-cyan-700'}`}>
                  <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  Fetching payment terminal...
                </div>
              )}

              {/* Technical Details */}
              <TechnicalDetails
                contract="JB_MULTI_TERMINAL"
                contractAddress={terminalAddress || '0x0000000000000000000000000000000000000000'}
                functionName="sendPayoutsOf"
                chainId={chainId}
                chainName={chainName}
                projectId={projectId}
                parameters={verificationResult.verifiedParams}
                isDark={isDark}
              />
            </>
          )}

          {/* Summary (for confirmed) */}
          {showConfirmed && (
            <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Requested payout</span>
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
                className="flex-1 py-3 font-bold bg-juice-orange text-black hover:bg-juice-orange/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send Payouts
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
