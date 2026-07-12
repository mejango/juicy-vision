import { useEffect, useMemo, useState } from 'react'
import { CHAINS, MAINNET_CHAINS } from '../../constants'
import { getSessionTransactions, getUserTransactions, type Transaction as PersistedTransaction } from '../../api/transactions'
import { getSessionId } from '../../services/session'
import { useAuthStore, useThemeStore, useTransactionStore } from '../../stores'

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

export default function TransactionHistory() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const localTransactions = useTransactionStore(state => state.transactions)
  const token = useAuthStore(state => state.token)
  const [persisted, setPersisted] = useState<PersistedTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const request = token
      ? getUserTransactions(50, 0)
      : getSessionTransactions(getSessionId(), 50)
    request
      .then(transactions => {
        if (!cancelled) setPersisted(transactions)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'History unavailable')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const rows = useMemo(() => {
    const seen = new Set<string>()
    const local = localTransactions.map(transaction => ({
      key: `local:${transaction.id}`,
      type: transaction.type,
      chainId: transaction.chainId,
      projectId: transaction.projectId,
      amount: transaction.amount,
      status: transaction.status,
      hash: transaction.hash,
      timestamp: transaction.createdAt,
    }))
    const remote = persisted.map(transaction => ({
      key: `remote:${transaction.id}`,
      type: 'onchain',
      chainId: transaction.chainId,
      projectId: transaction.projectId ?? undefined,
      amount: transaction.amount,
      status: transaction.status,
      hash: transaction.txHash ?? undefined,
      timestamp: new Date(transaction.createdAt).getTime(),
    }))
    return [...local, ...remote]
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter(row => {
        const identity = row.hash?.toLowerCase() || row.key
        if (seen.has(identity)) return false
        seen.add(identity)
        return true
      })
      .slice(0, 50)
  }, [localTransactions, persisted])

  return (
    <div className={`w-full max-w-2xl border ${isDark ? 'border-white/10 bg-juice-dark-lighter' : 'border-gray-200 bg-white'}`}>
      <div className={`border-b px-4 py-3 ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
        <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Your transaction history</h3>
        <p className={`mt-1 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Transactions reviewed on this device, plus your persisted payment records.
        </p>
      </div>
      {loading && rows.length === 0 ? (
        <div className={`p-4 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Loading history…</div>
      ) : rows.length === 0 ? (
        <div className={`p-4 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          No reviewed transactions yet.{error ? ` ${error}.` : ''}
        </div>
      ) : (
        <div className={`divide-y ${isDark ? 'divide-white/10' : 'divide-gray-100'}`}>
          {rows.map(row => {
            const chain = CHAINS[row.chainId] || MAINNET_CHAINS[row.chainId]
            return (
              <div key={row.key} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {row.type}{row.projectId ? ` · Project #${row.projectId}` : ''}
                  </div>
                  <div className={`mt-0.5 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {chain?.name || `Chain ${row.chainId}`}{row.amount ? ` · ${row.amount}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-xs uppercase ${row.status === 'confirmed' ? 'text-green-500' : row.status === 'failed' ? 'text-red-500' : isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {row.status}
                  </div>
                  {row.hash && chain?.explorerTx && (
                    <a
                      href={`${chain.explorerTx}${row.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block font-mono text-xs text-juice-cyan hover:underline"
                    >
                      {shortHash(row.hash)}
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
