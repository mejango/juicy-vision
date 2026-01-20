import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { parseEther, encodeFunctionData, type Chain } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, formatEthBalance, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { CHAINS as CHAIN_INFO, NATIVE_TOKEN } from '../../constants'

// Contract constants
const JB_MULTI_TERMINAL = '0x52869db3d61dde1e391967f2ce5039ad0ecd371c' as const

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
const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
}

interface SendPayoutsModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName?: string
  chainId: number
  amount: string
  baseCurrency?: number // 1 = ETH, 2 = USD
  splits?: Array<{ beneficiary: string; percent: number }>
}

type PayoutStatus = 'preview' | 'signing' | 'pending' | 'confirmed' | 'failed'

export default function SendPayoutsModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  chainId,
  amount,
  baseCurrency = 1,
  splits = [],
}: SendPayoutsModalProps) {
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

  const [status, setStatus] = useState<PayoutStatus>('preview')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chainInfo = CHAIN_INFO[chainId] || CHAIN_INFO[1]
  const chainName = chainInfo.name
  const currencyLabel = baseCurrency === 2 ? 'USDC' : 'ETH'
  const amountNum = parseFloat(amount) || 0
  const protocolFee = amountNum * 0.025 // 2.5% protocol fee
  const netPayout = amountNum - protocolFee
  const hasGasBalance = totalEth >= 0.001

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('preview')
      setTxHash(null)
      setError(null)
    }
  }, [isOpen])

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
        type: 'deploy', // Reusing for now
        projectId,
        chainId,
        amount,
        status: 'pending',
      })

      const payoutAmount = parseEther(amount)

      const callData = encodeFunctionData({
        abi: TERMINAL_SEND_PAYOUTS_ABI,
        functionName: 'sendPayoutsOf',
        args: [
          BigInt(projectId),
          NATIVE_TOKEN,
          payoutAmount,
          BigInt(baseCurrency), // Currency (1 = ETH, 2 = USD)
          0n, // minTokensPaidOut
        ],
      })

      setStatus('pending')

      let hash: string

      if (isManagedMode) {
        // Execute via backend for managed mode
        hash = await executeManagedTransaction(chainId, JB_MULTI_TERMINAL, callData, '0')
      } else {
        // Execute via wallet for self-custody mode
        await switchChainAsync({ chainId })
        hash = await walletClient!.sendTransaction({
          to: JB_MULTI_TERMINAL,
          data: callData,
          value: 0n,
        })
      }

      setTxHash(hash)
      updateTransaction(txId, { hash, status: 'submitted' })
      setStatus('confirmed')
    } catch (err) {
      console.error('Send payouts failed:', err)
      setError(err instanceof Error ? err.message : 'Transaction failed')
      setStatus('failed')
    }
  }, [walletClient, address, chainId, projectId, amount, baseCurrency, addTransaction, updateTransaction, switchChainAsync, isManagedMode, managedAddress])

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
              isDark ? 'bg-juice-orange/20' : 'bg-orange-100'
            }`}>
              📤
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {status === 'confirmed' ? 'Payouts Sent' : status === 'failed' ? 'Payout Failed' : 'Confirm Payouts'}
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

          {status === 'confirmed' && (
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

          {/* Payout Details */}
          {(status === 'preview' || status === 'signing' || status === 'pending') && (
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
                    Protocol fee (2.5%)
                  </span>
                  <span className={`font-mono ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
                    -{protocolFee.toFixed(4)} {currencyLabel}
                  </span>
                </div>

                <div className={`flex justify-between items-center pt-2 border-t ${
                  isDark ? 'border-white/10' : 'border-gray-200'
                }`}>
                  <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Net to splits</span>
                  <span className={`font-mono font-bold text-lg ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                    {netPayout.toFixed(4)} {currencyLabel}
                  </span>
                </div>
              </div>

              {/* Splits preview */}
              {splits.length > 0 && (
                <div className={`p-3 space-y-1 text-sm ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className={`text-xs uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    Recipients
                  </div>
                  {splits.slice(0, 3).map((split, i) => (
                    <div key={i} className="flex justify-between">
                      <span className={`font-mono ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {split.beneficiary.slice(0, 6)}...{split.beneficiary.slice(-4)}
                      </span>
                      <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>
                        {split.percent}%
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
              <div className={`flex justify-between items-center text-sm ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}>
                <span>Your ETH balance (for gas)</span>
                <span className={`font-mono ${!hasGasBalance ? 'text-red-400' : ''}`}>
                  {formatEthBalance(totalEth)} {currencyLabel}
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
          {status === 'confirmed' && (
            <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Distributed</span>
                  <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {amountNum.toFixed(4)} {currencyLabel}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Protocol fee</span>
                  <span className={`font-mono ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
                    -{protocolFee.toFixed(4)} {currencyLabel}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Sent to splits</span>
                  <span className={`font-mono text-green-500`}>
                    {netPayout.toFixed(4)} {currencyLabel}
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
                disabled={!hasGasBalance}
                className="flex-1 py-3 font-bold bg-juice-orange text-black hover:bg-juice-orange/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send Payouts
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
