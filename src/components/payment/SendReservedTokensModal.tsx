import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useWallet, useClient } from '@getpara/react-sdk'
import { createParaViemClient } from '@getpara/viem-v2-integration'
import { encodeFunctionData, http, type Chain } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useThemeStore, useTransactionStore } from '../../stores'
import { useWalletBalances, formatEthBalance } from '../../hooks'

// Contract constants
const JB_CONTROLLER = '0x8C32BBA37a7C42b3A1Fa25E2eaF4D6539C481a16' as const

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

interface SendReservedTokensModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName?: string
  chainId: number
  tokenSymbol: string
  amount: string // Raw amount in wei
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
}: SendReservedTokensModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { data: wallet } = useWallet()
  const paraClient = useClient()
  const { addTransaction, updateTransaction } = useTransactionStore()
  const { totalEth } = useWalletBalances()

  const [status, setStatus] = useState<DistributeStatus>('preview')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`
  const tokenAmount = parseFloat(amount) / 1e18
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
    if (!paraClient || !wallet?.address) {
      setError('Wallet not connected')
      return
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
        type: 'deploy',
        projectId,
        chainId,
        amount: tokenAmount.toString(),
        status: 'pending',
      })

      const walletClient = createParaViemClient(paraClient, {
        chain,
        transport: http(),
      })

      const callData = encodeFunctionData({
        abi: CONTROLLER_SEND_RESERVED_ABI,
        functionName: 'sendReservedTokensToSplitsOf',
        args: [BigInt(projectId)],
      })

      setStatus('pending')

      const hash = await walletClient.sendTransaction({
        to: JB_CONTROLLER,
        data: callData,
        value: 0n,
      })

      setTxHash(hash)
      updateTransaction(txId, { hash, status: 'submitted' })
      setStatus('confirmed')
    } catch (err) {
      console.error('Send reserved tokens failed:', err)
      setError(err instanceof Error ? err.message : 'Transaction failed')
      setStatus('failed')
    }
  }, [paraClient, wallet, chainId, projectId, tokenAmount, addTransaction, updateTransaction])

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
              isDark ? 'bg-amber-500/20' : 'bg-amber-100'
            }`}>
              🎟️
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {status === 'confirmed' ? 'Tokens Distributed' : status === 'failed' ? 'Distribution Failed' : 'Confirm Distribution'}
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
                  {tokenSymbol} distributed
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

          {/* Distribution Details */}
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

              {/* Amount */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Reserved {tokenSymbol}</span>
                  <span className={`font-mono font-medium text-lg ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                    {tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {tokenSymbol}
                  </span>
                </div>
              </div>

              <div className={`p-3 text-sm ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                These tokens will be distributed to the configured reserved token recipients.
                Anyone can trigger this distribution.
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
          {status === 'confirmed' && (
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
                className="flex-1 py-3 font-bold bg-amber-500 text-black hover:bg-amber-500/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Distribute {tokenSymbol}
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
