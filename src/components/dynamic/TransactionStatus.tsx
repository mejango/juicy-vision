import {
  useTransactionStore,
  type PaymentStage,
  type TransactionStatus as TxStatus,
} from '../../stores'
import { ALL_VIEM_CHAINS } from '../../constants/chains'
import ChainLogo from '../ui/ChainLogo'

interface TransactionStatusProps {
  txId: string
}

const statusConfig: Record<TxStatus, { color: string; icon: string; label: string }> = {
  pending: {
    color: 'text-yellow-400',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    label: 'Pending',
  },
  'safe-proposed': {
    color: 'text-amber-300',
    icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2h-1V8a5 5 0 00-10 0v3H6a2 2 0 00-2 2v6a2 2 0 002 2zm3-10a3 3 0 00-6 0v3h6V5z',
    label: 'Awaiting Safe execution',
  },
  'relayr-pending': {
    color: 'text-purple-300',
    icon: 'M8 7V3m8 4V3M5 11h14M7 21h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v12a2 2 0 002 2z',
    label: 'Relayr in progress',
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
  cancelled: {
    color: 'text-gray-400',
    icon: 'M6 18L18 6M6 6l12 12',
    label: 'Cancelled',
  },
  queued: {
    color: 'text-green-400',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    label: 'Queued',
  },
}

const stageLabels: Record<PaymentStage, string> = {
  checking: 'Checking current onchain state',
  switching: 'Switching network',
  approving: 'Waiting for token approval',
  submitting: 'Waiting for signature or submission',
  confirming: 'Waiting for onchain confirmation',
  queueing: 'Queueing payment',
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
  const chain = ALL_VIEM_CHAINS[tx.chainId as keyof typeof ALL_VIEM_CHAINS]
  const explorer = chain?.blockExplorers?.default.url
  const safePrefix: Record<number, string> = {
    1: 'eth',
    10: 'oeth',
    8453: 'base',
    42161: 'arb1',
    11155111: 'sep',
    11155420: 'sep',
    84532: 'basesep',
    421614: 'arbsep',
  }
  const safeHref = tx.safeTxHash && tx.account && safePrefix[tx.chainId]
    ? `https://app.safe.global/transactions/queue?safe=${safePrefix[tx.chainId]}:${tx.account}`
    : null

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
            <span className="text-xs text-gray-500">{tx.label ?? tx.type}</span>
          </div>

          {tx.stage && (
            <p className="mt-1 text-xs text-gray-400">{stageLabels[tx.stage]}</p>
          )}

          {tx.hash && explorer && (
            <a
              href={`${explorer}/tx/${tx.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-juice-cyan hover:underline truncate block"
            >
              {tx.hash.slice(0, 10)}...{tx.hash.slice(-8)}
            </a>
          )}

          {safeHref && (
            <a
              href={safeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-xs text-amber-300 hover:underline"
            >
              Safe proposal {tx.safeTxHash!.slice(0, 10)}…{tx.safeTxHash!.slice(-8)}
            </a>
          )}

          {tx.bundleUuid && (
            <p className="block truncate font-mono text-[10px] text-purple-300">
              Relayr bundle {tx.bundleUuid}
            </p>
          )}

          {tx.chainStates && tx.chainStates.length > 0 && (
            <div className="mt-2 grid gap-1 text-[10px] text-gray-400">
              {tx.chainStates.map(state => {
                const stateChain = ALL_VIEM_CHAINS[state.chainId as keyof typeof ALL_VIEM_CHAINS]
                const stateExplorer = stateChain?.blockExplorers?.default.url
                const content = <>
                  <span className="inline-flex items-center gap-1">
                    <ChainLogo chainId={state.chainId} size={12} />
                    {stateChain?.name ?? `Chain ${state.chainId}`}
                  </span>
                  {`: ${state.status}`}
                  {state.txHash ? ` · ${state.txHash.slice(0, 8)}…${state.txHash.slice(-6)}` : ''}
                  {state.error ? ` · ${state.error}` : ''}
                </>
                return state.txHash && stateExplorer ? (
                  <a
                    key={state.chainId}
                    href={`${stateExplorer}/tx/${state.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-juice-cyan hover:underline"
                  >
                    {content}
                  </a>
                ) : <span key={state.chainId}>{content}</span>
              })}
            </div>
          )}

          {tx.error && (
            <p className="text-xs text-red-400 mt-1">{tx.error}</p>
          )}
        </div>

        {tx.amount && (
          <div className="text-right">
            <p className="font-mono text-white">{tx.amount} {tx.token ?? 'ETH'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
