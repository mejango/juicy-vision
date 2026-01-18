import { useState } from 'react'
import { Button, Input } from '../ui'
import { useTransactionStore } from '../../stores'

interface SendPayoutsFormProps {
  projectId: string
  chainId?: string
}

export default function SendPayoutsForm({ projectId, chainId = '1' }: SendPayoutsFormProps) {
  const [amount, setAmount] = useState('')
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
        type: 'deploy', // Reusing deploy type for now, should add 'payout' type
        projectId,
        chainId: parseInt(chainId),
        amount,
        status: 'pending',
      })

      // Dispatch event for wallet to pick up
      window.dispatchEvent(new CustomEvent('juice:send-payouts', {
        detail: {
          txId,
          projectId,
          chainId: parseInt(chainId),
          amount,
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
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
        Distribute Payouts - Project #{projectId}
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
          placeholder="1.0"
          required
        />

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          loading={loading}
        >
          Send Payouts
        </Button>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Distribute funds to payout splits. A 2.5% protocol fee applies to payouts.
      </p>
    </form>
  )
}
