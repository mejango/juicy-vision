import { useState, useEffect, useMemo } from 'react'
import { formatEther, formatUnits } from 'viem'
import { useThemeStore } from '../../stores'
import {
  fetchPayEventsHistory,
  fetchCashOutEventsHistory,
  fetchProject,
  fetchSuckerGroupBalance,
  type PayEventHistoryItem,
  type CashOutEventHistoryItem,
} from '../../services/bendystraw'

interface ActivityFeedProps {
  projectId: string
  chainId?: string
  limit?: number
}

type ActivityEvent = {
  type: 'pay' | 'cashout'
  txHash: string
  timestamp: number
  from: string
  amount: string
  tokenAmount?: string
  memo?: string
}

const CHAIN_EXPLORER: Record<number, string> = {
  1: 'https://etherscan.io',
  10: 'https://optimistic.etherscan.io',
  8453: 'https://basescan.org',
  42161: 'https://arbiscan.io',
}

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatTimeAgo(timestamp: number) {
  const seconds = Math.floor(Date.now() / 1000 - timestamp)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function formatTokenAmount(wei: string): string {
  try {
    const num = parseFloat(formatEther(BigInt(wei)))
    if (num === 0) return '0'
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    if (num >= 1) return num.toLocaleString(undefined, { maximumFractionDigits: 0 })
    // For small numbers, show at least 1 significant figure
    if (num >= 0.01) return num.toFixed(2)
    if (num >= 0.0001) return num.toFixed(4)
    // Very small numbers - use scientific notation
    return num.toExponential(1)
  } catch {
    return wei
  }
}

function formatCurrencyAmount(wei: string, decimals: number, currency: number): string {
  try {
    const num = parseFloat(formatUnits(BigInt(wei), decimals))
    const symbol = currency === 2 ? 'USDC' : 'ETH'
    // More decimals for USDC display since values are often smaller
    const precision = currency === 2 ? 2 : 4
    return `${num.toFixed(precision)} ${symbol}`
  } catch {
    const symbol = currency === 2 ? 'USDC' : 'ETH'
    return `${wei} ${symbol}`
  }
}

export default function ActivityFeed({
  projectId,
  chainId = '1',
  limit = 5
}: ActivityFeedProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [payEvents, setPayEvents] = useState<PayEventHistoryItem[]>([])
  const [cashOutEvents, setCashOutEvents] = useState<CashOutEventHistoryItem[]>([])
  const [projectName, setProjectName] = useState<string>('')
  const [currency, setCurrency] = useState<number>(1) // 1 = ETH, 2 = USDC
  const [decimals, setDecimals] = useState<number>(18)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const chainIdNum = parseInt(chainId)
  const explorerUrl = CHAIN_EXPLORER[chainIdNum] || CHAIN_EXPLORER[1]

  useEffect(() => {
    async function loadActivity() {
      setLoading(true)
      try {
        // Fetch project info, currency info, and events in parallel
        const [project, balanceInfo, pays, cashOuts] = await Promise.all([
          fetchProject(projectId, chainIdNum),
          fetchSuckerGroupBalance(projectId, chainIdNum),
          fetchPayEventsHistory(projectId, chainIdNum, 5, 100),
          fetchCashOutEventsHistory(projectId, chainIdNum, 5, 100),
        ])

        if (project?.name) {
          setProjectName(project.name)
        }

        // Set currency info from balance response
        setCurrency(balanceInfo.currency)
        setDecimals(balanceInfo.decimals)

        setPayEvents(pays)
        setCashOutEvents(cashOuts)
      } catch (err) {
        console.error('Failed to load activity:', err)
      } finally {
        setLoading(false)
      }
    }

    loadActivity()
  }, [projectId, chainId, chainIdNum])

  // Combine and sort events
  const events = useMemo(() => {
    const combined: ActivityEvent[] = []

    // Add pay events
    for (const e of payEvents) {
      combined.push({
        type: 'pay',
        txHash: e.txHash,
        timestamp: e.timestamp,
        from: e.from,
        amount: formatCurrencyAmount(e.amount, decimals, currency),
        tokenAmount: formatTokenAmount(e.newlyIssuedTokenCount),
        memo: e.memo,
      })
    }

    // Add cash out events
    for (const e of cashOutEvents) {
      combined.push({
        type: 'cashout',
        txHash: e.txHash,
        timestamp: e.timestamp,
        from: e.from,
        amount: formatCurrencyAmount(e.reclaimAmount, decimals, currency),
        tokenAmount: formatTokenAmount(e.cashOutCount),
      })
    }

    // Sort by timestamp descending (most recent first)
    return combined.sort((a, b) => b.timestamp - a.timestamp)
  }, [payEvents, cashOutEvents, decimals, currency])

  const displayedEvents = expanded ? events : events.slice(0, limit)

  const getEventIcon = (type: ActivityEvent['type']) => {
    switch (type) {
      case 'pay': return '💰'
      case 'cashout': return '🔄'
    }
  }

  const getEventColor = (type: ActivityEvent['type']) => {
    switch (type) {
      case 'pay': return 'text-emerald-400'
      case 'cashout': return 'text-amber-400'
    }
  }

  return (
    <div className="w-full">
      <div className={`max-w-md border overflow-hidden ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className={`px-4 py-3 border-b flex items-center justify-between ${
          isDark ? 'border-white/10' : 'border-gray-100'
        }`}>
          <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Activity
          </span>
          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {projectName || `Project #${projectId}`}
          </span>
        </div>

        {/* Events list */}
        <div className={`divide-y ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
          {loading ? (
            <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Loading activity...
            </div>
          ) : displayedEvents.length === 0 ? (
            <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              No activity yet
            </div>
          ) : (
            displayedEvents.map((event, idx) => (
              <div
                key={`${event.txHash}-${idx}`}
                className={`px-4 py-3 flex items-start gap-3 ${
                  isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'
                }`}
              >
                <span className="text-lg">{getEventIcon(event.type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a
                      href={`${explorerUrl}/address/${event.from}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-sm font-medium font-mono hover:underline ${isDark ? 'text-white' : 'text-gray-900'}`}
                    >
                      {formatAddress(event.from)}
                    </a>
                    <span className={`text-sm ${getEventColor(event.type)}`}>
                      {event.type === 'pay' && 'paid'}
                      {event.type === 'cashout' && 'cashed out'}
                    </span>
                    <a
                      href={`${explorerUrl}/tx/${event.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-sm font-medium hover:underline ${isDark ? 'text-white' : 'text-gray-900'}`}
                    >
                      {event.amount}
                    </a>
                  </div>
                  {event.tokenAmount && (
                    <div className={`text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {event.type === 'pay' ? 'Received' : 'Burned'} {event.tokenAmount} tokens
                    </div>
                  )}
                  {event.memo && (
                    <div className={`text-xs mt-1 italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      "{event.memo}"
                    </div>
                  )}
                </div>
                <span className={`text-xs whitespace-nowrap ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {formatTimeAgo(event.timestamp)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Load more */}
        {events.length > limit && (
          <button
            onClick={() => setExpanded(!expanded)}
            className={`w-full px-4 py-2 text-sm text-center border-t transition-colors ${
              isDark
                ? 'border-white/10 text-gray-400 hover:text-white hover:bg-white/5'
                : 'border-gray-100 text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {expanded ? 'Show less' : `Show ${events.length - limit} more`}
          </button>
        )}
      </div>
    </div>
  )
}
