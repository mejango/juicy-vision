import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { parseEther, encodeFunctionData, type Hex, type Address, type Chain } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, formatEthBalance, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { CHAINS as CHAIN_INFO, NATIVE_TOKEN } from '../../constants'

// Contract constants
const JB_MULTI_TERMINAL = '0x52869db3d61dde1e391967f2ce5039ad0ecd371c' as const

const TERMINAL_PAY_ABI = [
  {
    name: 'pay',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'minReturnedTokens', type: 'uint256' },
      { name: 'memo', type: 'string' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [{ name: 'beneficiaryTokenCount', type: 'uint256' }],
  },
] as const

// viem chain objects for wallet operations
const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
}

interface PayModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName?: string
  chainId: number
  amount: string
  memo: string
  payUs: boolean
  feeAmount: string
  juicyProjectId: number
  estimatedTokens?: number
  estimatedJuicyTokens?: number
  /** Token symbol for display - 'ETH' or 'USDC'. Defaults to 'ETH' */
  token?: 'ETH' | 'USDC'
}

type PaymentStatus = 'preview' | 'signing' | 'pending' | 'confirmed' | 'failed'

export default function PayModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  chainId,
  amount,
  memo,
  payUs,
  feeAmount,
  juicyProjectId,
  estimatedTokens = 0,
  estimatedJuicyTokens = 0,
  token = 'ETH',
}: PayModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const { addTransaction, updateTransaction } = useTransactionStore()
  const { totalEth } = useWalletBalances()

  // Managed mode support
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address: managedAddress } = useManagedWallet()

  const [status, setStatus] = useState<PaymentStatus>('preview')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chainInfo = CHAIN_INFO[chainId] || CHAIN_INFO[1]
  const chainName = chainInfo.name
  const amountNum = parseFloat(amount) || 0
  const feeNum = parseFloat(feeAmount) || 0
  const totalAmount = amountNum + feeNum
  const hasEnoughBalance = totalEth >= totalAmount + 0.001 // Leave some for gas

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('preview')
      setTxHash(null)
      setError(null)
    }
  }, [isOpen])

  const buildPayCallData = useCallback((
    projId: number,
    amountWei: bigint,
    beneficiary: Address,
    memoText: string
  ): Hex => {
    return encodeFunctionData({
      abi: TERMINAL_PAY_ABI,
      functionName: 'pay',
      args: [
        BigInt(projId),
        NATIVE_TOKEN,
        amountWei,
        beneficiary,
        0n,
        memoText,
        '0x' as Hex,
      ],
    })
  }, [])

  const handleConfirm = async () => {
    // Check wallet connection based on mode
    const activeAddress = isManagedMode ? managedAddress : address
    if (isManagedMode) {
      if (!managedAddress) {
        setError('Managed wallet not available')
        return
      }
    } else {
      if (!walletClient || !address || !isConnected) {
        setError('Wallet not connected')
        return
      }
    }

    setStatus('signing')
    setError(null)

    const beneficiary = activeAddress as Address
    const chain = CHAINS[chainId]

    if (!chain) {
      setError('Unsupported chain')
      setStatus('failed')
      return
    }

    try {
      // Create transaction record
      const txId = addTransaction({
        type: 'pay',
        projectId,
        chainId,
        amount,
        status: 'pending',
      })

      const projectAmount = parseEther(amount)
      const juicyFeeAmount = payUs ? parseEther(feeAmount) : 0n

      setStatus('pending')

      if (isManagedMode) {
        // Execute via backend for managed mode
        const projectCallData = buildPayCallData(parseInt(projectId), projectAmount, beneficiary, memo)
        const hash = await executeManagedTransaction(chainId, JB_MULTI_TERMINAL, projectCallData, projectAmount.toString())
        setTxHash(hash)
        updateTransaction(txId, { hash, status: 'submitted' })

        // Send JUICY fee if enabled
        if (payUs && juicyFeeAmount > 0n) {
          const feeCallData = buildPayCallData(juicyProjectId, juicyFeeAmount, beneficiary, 'juicy fee')
          await executeManagedTransaction(chainId, JB_MULTI_TERMINAL, feeCallData, juicyFeeAmount.toString())
        }

        setStatus('confirmed')
      } else {
        // Execute via wallet for self-custody mode
        // Switch to the correct chain if needed
        const currentChainId = await walletClient!.getChainId()
        if (currentChainId !== chainId) {
          await switchChainAsync({ chainId })
        }

        if (payUs && juicyFeeAmount > 0n) {
          // Try batched transaction first
          const calls = [
            {
              to: JB_MULTI_TERMINAL as Address,
              data: buildPayCallData(parseInt(projectId), projectAmount, beneficiary, memo),
              value: projectAmount,
            },
            {
              to: JB_MULTI_TERMINAL as Address,
              data: buildPayCallData(juicyProjectId, juicyFeeAmount, beneficiary, 'juicy fee'),
              value: juicyFeeAmount,
            },
          ]

          const walletWithBatch = walletClient as typeof walletClient & { sendCalls?: unknown }
          if (typeof walletWithBatch.sendCalls === 'function') {
            try {
              const batchResult = await (walletWithBatch.sendCalls as (params: unknown) => Promise<{ id?: string }>)({
                account: beneficiary,
                chain,
                calls,
              })
              const hash = batchResult.id || String(batchResult)
              setTxHash(hash)
              updateTransaction(txId, { hash, status: 'submitted' })
              setStatus('confirmed')
              return
            } catch {
              // Batch not supported, falling back to sequential
            }
          }

          // Sequential fallback
          const projectHash = await walletClient!.sendTransaction({
            to: JB_MULTI_TERMINAL,
            data: buildPayCallData(parseInt(projectId), projectAmount, beneficiary, memo),
            value: projectAmount,
            chain,
            account: address,
          })

          setTxHash(projectHash)
          updateTransaction(txId, { hash: projectHash, status: 'submitted' })

          // Send JUICY fee
          await walletClient!.sendTransaction({
            to: JB_MULTI_TERMINAL,
            data: buildPayCallData(juicyProjectId, juicyFeeAmount, beneficiary, 'juicy fee'),
            value: juicyFeeAmount,
            chain,
            account: address,
          })

          setStatus('confirmed')
        } else {
          // Single transaction
          const hash = await walletClient!.sendTransaction({
            to: JB_MULTI_TERMINAL,
            data: buildPayCallData(parseInt(projectId), projectAmount, beneficiary, memo),
            value: projectAmount,
            chain,
            account: address,
          })

          setTxHash(hash)
          updateTransaction(txId, { hash, status: 'submitted' })
          setStatus('confirmed')
        }
      }
    } catch (err) {
      console.error('Payment failed:', err)
      setError(err instanceof Error ? err.message : 'Transaction failed')
      setStatus('failed')
    }
  }

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
              💰
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {status === 'confirmed' ? 'Payment Sent' : status === 'failed' ? 'Payment Failed' : 'Confirm Payment'}
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
                  Payment successful
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

          {/* Payment Details */}
          {(status === 'preview' || status === 'signing' || status === 'pending') && (
            <>
              {/* Project */}
              <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className={`text-xs uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Paying
                </div>
                <div className={`font-semibold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {projectName || `Project #${projectId}`}
                </div>
                {estimatedTokens > 0 && (
                  <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    You receive ~{estimatedTokens.toLocaleString()} tokens
                  </p>
                )}
              </div>

              {/* Amount breakdown */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Amount</span>
                  <span className={`font-mono font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {amountNum.toFixed(token === 'USDC' ? 2 : 4)} {token}
                  </span>
                </div>

                {payUs && feeNum > 0 && (
                  <div className="flex justify-between items-center">
                    <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>
                      + Pay us (2.5%)
                    </span>
                    <span className={`font-mono ${isDark ? 'text-juice-orange' : 'text-orange-600'}`}>
                      {feeNum.toFixed(token === 'USDC' ? 2 : 4)} {token}
                    </span>
                  </div>
                )}

                <div className={`flex justify-between items-center pt-2 border-t ${
                  isDark ? 'border-white/10' : 'border-gray-200'
                }`}>
                  <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Total</span>
                  <span className={`font-mono font-bold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {totalAmount.toFixed(token === 'USDC' ? 2 : 4)} {token}
                  </span>
                </div>
              </div>

              {/* Balance check */}
              <div className={`flex justify-between items-center text-sm ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}>
                <span>Your balance</span>
                <span className={`font-mono ${!hasEnoughBalance ? 'text-red-400' : ''}`}>
                  {formatEthBalance(totalEth)} {token}
                </span>
              </div>

              {!hasEnoughBalance && (
                <div className={`p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
                  Insufficient balance for this payment
                </div>
              )}

              {memo && (
                <div className={`p-3 text-sm ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Memo: </span>
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>{memo}</span>
                </div>
              )}
            </>
          )}

          {/* Tokens received summary (for confirmed) */}
          {status === 'confirmed' && (
            <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Paid</span>
                  <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {totalAmount.toFixed(token === 'USDC' ? 2 : 4)} {token}
                  </span>
                </div>
                {estimatedTokens > 0 && (
                  <div className="flex justify-between items-center">
                    <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Project tokens</span>
                    <span className={`font-mono text-green-500`}>
                      +{estimatedTokens.toLocaleString()}
                    </span>
                  </div>
                )}
                {payUs && estimatedJuicyTokens > 0 && (
                  <div className="flex justify-between items-center">
                    <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>$JUICY tokens</span>
                    <span className={`font-mono text-juice-orange`}>
                      +{estimatedJuicyTokens.toLocaleString()}
                    </span>
                  </div>
                )}
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
                disabled={!hasEnoughBalance}
                className="flex-1 py-3 font-bold bg-juice-orange text-black hover:bg-juice-orange/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm & Pay
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
