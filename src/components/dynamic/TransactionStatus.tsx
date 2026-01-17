import { useTransactionStore, type TransactionStatus as TxStatus } from '../../stores'

interface TransactionStatusProps {
  txId: string
}

const statusConfig: Record<TxStatus, { color: string; icon: string; label: string }> = {
  pending: {
    color: 'text-yellow-400',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    label: 'Pending',
  },
  submitted: {
    color: 'text-juice-cyan',
    icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    label: 'Submitted',
  },
  confirmed: {
    color: 'text-green-400',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    label: 'Confirmed',
  },
  failed: {
    color: 'text-red-400',
    icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
    label: 'Failed',
  },
}

export default function TransactionStatus({ txId }: TransactionStatusProps) {
  const { getTransaction } = useTransactionStore()
  const tx = getTransaction(txId)

  if (!tx) {
    return (
      <div className="glass  p-3 text-gray-400 text-sm">
        Transaction not found
      </div>
    )
  }

  const config = statusConfig[tx.status]

  return (
    <div className="glass  p-3">
      <div className="flex items-center gap-3">
        <div className={`${config.color}`}>
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={config.icon} />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-medium ${config.color}`}>{config.label}</span>
            <span className="text-xs text-gray-500 capitalize">{tx.type}</span>
          </div>

          {tx.hash && (
            <a
              href={`https://etherscan.io/tx/${tx.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-juice-cyan hover:underline truncate block"
            >
              {tx.hash.slice(0, 10)}...{tx.hash.slice(-8)}
            </a>
          )}

          {tx.error && (
            <p className="text-xs text-red-400 mt-1">{tx.error}</p>
          )}
        </div>

        {tx.amount && (
          <div className="text-right">
            <p className="font-mono text-white">{tx.amount} ETH</p>
          </div>
        )}
      </div>
    </div>
  )
}
