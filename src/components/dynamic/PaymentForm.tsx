import { useState } from 'react'
import { Button, Input } from '../ui'
import { useTransactionStore } from '../../stores'

interface PaymentFormProps {
  projectId: string
  chainId?: string
}

export default function PaymentForm({ projectId, chainId = '1' }: PaymentFormProps) {
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { addTransaction } = useTransactionStore()

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
    <form onSubmit={handleSubmit} className="glass p-4">
      <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
        <svg className="w-5 h-5 text-juice-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Pay Project #{projectId}
      </h4>

      {error && (
        <div className="mb-3 p-2 bg-red-500/20 text-red-300 text-sm">
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

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          loading={loading}
        >
          Pay Project
        </Button>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        You'll receive project tokens proportional to your contribution.
      </p>
    </form>
  )
}
