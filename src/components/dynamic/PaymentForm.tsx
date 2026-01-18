import { useState } from 'react'
import { Button, Input } from '../ui'
import { useTransactionStore, useThemeStore } from '../../stores'

interface PaymentFormProps {
  projectId: string
  chainId?: string
}

const CHAIN_NAMES: Record<string, string> = {
  '1': 'Ethereum',
  '10': 'Optimism',
  '8453': 'Base',
  '42161': 'Arbitrum',
}

export default function PaymentForm({ projectId, chainId = '1' }: PaymentFormProps) {
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const { addTransaction } = useTransactionStore()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount')
      return
    }

    setError(null)
    setLoading(true)

    try {
      // Create pending transaction
      const txId = addTransaction({
        type: 'pay',
        projectId,
        chainId: parseInt(chainId),
        amount,
        status: 'pending',
      })

      // Dispatch event for wallet to pick up
      window.dispatchEvent(new CustomEvent('juice:pay-project', {
        detail: {
          txId,
          projectId,
          chainId: parseInt(chainId),
          amount,
          memo,
        }
      }))

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`rounded-lg border overflow-hidden ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between ${
        isDark ? 'border-white/10 bg-juice-orange/10' : 'border-gray-100 bg-orange-50'
      }`}>
        <div className="flex items-center gap-2">
          <span className="text-xl">💰</span>
          <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Pay Project #{projectId}
          </span>
        </div>
        <span className={`px-2 py-0.5 text-xs font-medium rounded ${
          isDark ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'
        }`}>
          {chainName}
        </span>
      </div>

      {/* Form body */}
      <div className="p-4">
        {error && (
          <div className="mb-3 p-2 bg-red-500/20 text-red-300 text-sm rounded">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <Input
            label="Amount (ETH)"
            type="number"
            step="0.0001"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.1"
            required
          />

          <Input
            label="Memo (optional)"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Supporting this project!"
          />

          {/* Transaction details toggle */}
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className={`flex items-center gap-1 text-xs ${
              isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <svg
              className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            What happens when I pay?
          </button>

          {showDetails && (
            <div className={`text-xs p-3 rounded space-y-2 ${
              isDark ? 'bg-white/5 text-gray-300' : 'bg-gray-50 text-gray-600'
            }`}>
              <p><strong>Contract:</strong> JBMultiTerminal.pay()</p>
              <p><strong>Action:</strong> Send {amount || '0'} ETH to project treasury</p>
              <p><strong>You receive:</strong> Project tokens based on issuance rate</p>
              <p><strong>Beneficiary:</strong> Your connected wallet</p>
              {memo && <p><strong>Memo:</strong> "{memo}"</p>}
              <p className="text-yellow-500/80 mt-2">
                Tokens represent your stake. They can be cashed out for treasury funds (subject to cash out tax rate).
              </p>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={loading}
          >
            {loading ? 'Preparing...' : `Pay ${amount || '0'} ETH`}
          </Button>
        </div>
      </div>

      {/* Footer */}
      <div className={`px-4 py-2 text-xs flex items-center gap-2 ${
        isDark ? 'bg-white/5 text-gray-500' : 'bg-gray-50 text-gray-400'
      }`}>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        You'll receive project tokens proportional to your contribution.
      </div>
    </form>
  )
}
