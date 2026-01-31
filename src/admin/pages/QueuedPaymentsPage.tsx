import { useState } from 'react'
import { useThemeStore } from '../../stores'
import {
  useAdminJuiceSpends,
  useAdminJuiceStats,
  useProcessSpend,
  type JuiceSpend,
} from '../hooks'

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  8453: 'Base',
  42161: 'Arbitrum',
}

const CHAIN_EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  8453: 'https://basescan.org/tx/',
  42161: 'https://arbiscan.io/tx/',
}

function StatusBadge({ status, isDark }: { status: string; isDark: boolean }) {
  const colors: Record<string, string> = {
    pending: isDark ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-700',
    executing: isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700',
    completed: isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700',
    failed: isDark ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700',
    refunded: isDark ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-100 text-gray-600',
  }

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors[status] || colors.pending}`}>
      {status}
    </span>
  )
}

function StatsCard({
  label,
  value,
  subValue,
  isDark,
  highlight,
}: {
  label: string
  value: string | number
  subValue?: string
  isDark: boolean
  highlight?: boolean
}) {
  return (
    <div className={`p-4 border ${
      isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'
    }`}>
      <div className={`text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${
        highlight
          ? 'text-juice-orange'
          : isDark ? 'text-white' : 'text-gray-900'
      }`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subValue && (
        <div className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {subValue}
        </div>
      )}
    </div>
  )
}

function SpendRow({
  spend,
  isDark,
  onProcess,
  isProcessing,
}: {
  spend: JuiceSpend
  isDark: boolean
  onProcess: () => void
  isProcessing: boolean
}) {
  const createdAt = new Date(spend.createdAt)
  const chainName = CHAIN_NAMES[spend.chainId] || `Chain ${spend.chainId}`

  return (
    <tr className={isDark ? 'border-zinc-700' : 'border-gray-200'}>
      <td className={`px-4 py-3 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        <div>{createdAt.toLocaleDateString()}</div>
        <div className="text-xs">{createdAt.toLocaleTimeString()}</div>
      </td>
      <td className={`px-4 py-3 text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
        {spend.userEmail || (
          <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
            {spend.userId.slice(0, 8)}...
          </span>
        )}
      </td>
      <td className={`px-4 py-3 text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
        <div>Project #{spend.projectId}</div>
        <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {chainName}
        </div>
      </td>
      <td className={`px-4 py-3 text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
        ${spend.juiceAmount.toFixed(2)}
      </td>
      <td className={`px-4 py-3 text-sm font-mono ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        <span title={spend.beneficiaryAddress}>
          {spend.beneficiaryAddress.slice(0, 6)}...{spend.beneficiaryAddress.slice(-4)}
        </span>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={spend.status} isDark={isDark} />
        {spend.retryCount > 0 && (
          <span className={`ml-2 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            ({spend.retryCount} retries)
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        {spend.status === 'pending' && (
          <button
            onClick={onProcess}
            disabled={isProcessing}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              isProcessing
                ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600 text-black'
            }`}
          >
            {isProcessing ? 'Processing...' : 'Process'}
          </button>
        )}
        {spend.txHash && (
          <a
            href={`${CHAIN_EXPLORERS[spend.chainId] || 'https://etherscan.io/tx/'}${spend.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-xs underline ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
          >
            View Tx
          </a>
        )}
        {spend.errorMessage && (
          <span
            title={spend.errorMessage}
            className={`text-xs ${isDark ? 'text-red-400' : 'text-red-500'}`}
          >
            Error
          </span>
        )}
      </td>
    </tr>
  )
}

export default function QueuedPaymentsPage() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [processingId, setProcessingId] = useState<string | null>(null)

  const { data: spendsData, isLoading: spendsLoading } = useAdminJuiceSpends(page, 50, statusFilter)
  const { data: stats, isLoading: statsLoading } = useAdminJuiceStats()
  const processSpendMutation = useProcessSpend()

  const handleProcess = async (spendId: string) => {
    setProcessingId(spendId)
    try {
      await processSpendMutation.mutateAsync(spendId)
    } catch (error) {
      console.error('Failed to process spend:', error)
      alert(error instanceof Error ? error.message : 'Failed to process spend')
    } finally {
      setProcessingId(null)
    }
  }

  const spends = spendsData?.spends || []
  const pagination = spendsData?.pagination

  return (
    <div className="p-6">
      <h1 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
        Queued Payments
      </h1>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatsCard
          label="Pending"
          value={stats?.pending.count || 0}
          subValue={stats?.pending.totalUsd ? `$${stats.pending.totalUsd.toFixed(2)}` : undefined}
          isDark={isDark}
          highlight
        />
        <StatsCard
          label="Executing"
          value={stats?.executing.count || 0}
          isDark={isDark}
        />
        <StatsCard
          label="Today Completed"
          value={stats?.today.completedCount || 0}
          subValue={stats?.today.completedUsd ? `$${stats.today.completedUsd.toFixed(2)}` : undefined}
          isDark={isDark}
        />
        <StatsCard
          label="This Week"
          value={stats?.week.completedCount || 0}
          subValue={stats?.week.completedUsd ? `$${stats.week.completedUsd.toFixed(2)}` : undefined}
          isDark={isDark}
        />
        <StatsCard
          label="Failed"
          value={stats?.failed.count || 0}
          isDark={isDark}
        />
      </div>

      {/* Status filter */}
      <div className="mb-4 flex items-center gap-2">
        <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Filter:</span>
        {['pending', 'executing', 'completed', 'failed', 'refunded'].map((status) => (
          <button
            key={status}
            onClick={() => {
              setStatusFilter(status)
              setPage(1)
            }}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              statusFilter === status
                ? isDark
                  ? 'bg-white/10 text-white'
                  : 'bg-gray-200 text-gray-900'
                : isDark
                  ? 'text-gray-400 hover:text-white hover:bg-white/5'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Spends table */}
      <div className={`border overflow-hidden ${
        isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'
      }`}>
        {spendsLoading ? (
          <div className="p-8 text-center">
            <div className="w-8 h-8 border-2 border-juice-orange border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : spends.length === 0 ? (
          <div className={`p-8 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            No {statusFilter} payments found
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className={isDark ? 'bg-zinc-800' : 'bg-gray-50'}>
                  <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Created
                  </th>
                  <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    User
                  </th>
                  <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Project
                  </th>
                  <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Amount
                  </th>
                  <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Beneficiary
                  </th>
                  <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Status
                  </th>
                  <th className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-zinc-700' : 'divide-gray-200'}`}>
                {spends.map((spend) => (
                  <SpendRow
                    key={spend.id}
                    spend={spend}
                    isDark={isDark}
                    onProcess={() => handleProcess(spend.id)}
                    isProcessing={processingId === spend.id}
                  />
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className={`px-4 py-3 flex items-center justify-between border-t ${
                isDark ? 'border-zinc-700' : 'border-gray-200'
              }`}>
                <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Showing {(page - 1) * pagination.limit + 1} to{' '}
                  {Math.min(page * pagination.limit, pagination.total)} of {pagination.total}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className={`px-3 py-1 text-sm transition-colors ${
                      page === 1
                        ? 'opacity-50 cursor-not-allowed'
                        : isDark
                          ? 'text-gray-300 hover:bg-white/5'
                          : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page >= pagination.totalPages}
                    className={`px-3 py-1 text-sm transition-colors ${
                      page >= pagination.totalPages
                        ? 'opacity-50 cursor-not-allowed'
                        : isDark
                          ? 'text-gray-300 hover:bg-white/5'
                          : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
