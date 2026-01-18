import { useState } from 'react'
import { Button, Input } from '../ui'
import { useTransactionStore } from '../../stores'

interface CashOutFormProps {
  projectId: string
  chainId?: string
}

export default function CashOutForm({ projectId, chainId = '1' }: CashOutFormProps) {
  const [tokenAmount, setTokenAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { addTransaction } = useTransactionStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!tokenAmount || parseFloat(tokenAmount) <= 0) {
      setError('Please enter a valid token amount')
      return
    }

    setError(null)
    setLoading(true)

    try {
      // Create pending transaction
      const txId = addTransaction({
        type: 'cashout',
        projectId,
        chainId: parseInt(chainId),
        amount: tokenAmount,
        status: 'pending',
      })

      // Dispatch event for wallet to pick up
      window.dispatchEvent(new CustomEvent('juice:cash-out', {
        detail: {
          txId,
          projectId,
          chainId: parseInt(chainId),
          tokenAmount,
        }
      }))

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="glass p-4">
      <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
        <svg className="w-5 h-5 text-juice-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Cash Out from Project #{projectId}
      </h4>

      {error && (
        <div className="mb-3 p-2 bg-red-500/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <Input
          label="Token Amount"
          type="number"
          step="1"
          min="0"
          value={tokenAmount}
          onChange={(e) => setTokenAmount(e.target.value)}
          placeholder="10000"
          required
        />

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          loading={loading}
        >
          Cash Out Tokens
        </Button>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        You'll burn your tokens and receive ETH based on the treasury balance and cash out tax rate.
      </p>
    </form>
  )
}
