import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { defaultChainId } from '../../config/environment'
import { formatEther } from 'viem'
import { useThemeStore } from '../../stores'
import {
  fetchPayEventsPage,
  fetchCashOutEventsPage,
  fetchProject,
  fetchSuckerGroupBalance,
  type PayEventHistoryItem,
  type CashOutEventHistoryItem,
} from '../../services/bendystraw'
import { formatBalanceNative } from '../../utils/currency'
import { MAINNET_CHAINS } from '../../constants'

interface ActivityFeedProps {
  projectId: string
  chainId?: string
  limit?: number
  compact?: boolean // For sidebar display mode - removes outer container styling
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

const PAGE_SIZE = 15

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

function formatIndexedUsd(scaledUsd?: string): string {
  if (!scaledUsd) return ''
  try {
    const usd = Number(BigInt(scaledUsd) / 1_000_000_000_000n) / 1e6
    if (usd <= 0) return ''
    return usd.toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: usd < 1 ? 4 : 2,
    })
  } catch {
    return ''
  }
}

export default function ActivityFeed({
  projectId,
  chainId = defaultChainId(),
  compact = false
}: ActivityFeedProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [payEvents, setPayEvents] = useState<PayEventHistoryItem[]>([])
  const [cashOutEvents, setCashOutEvents] = useState<CashOutEventHistoryItem[]>([])
  const [projectName, setProjectName] = useState<string>('')
  // Ecosystem convention: amounts render in the accounting token when the
  // project has exactly ONE token kind across its chains, USD otherwise.
  // The homogeneity signal is the dashboard's group-balance service
  // (balanceAvailable = recognized, homogeneous denomination on every chain).
  const [accounting, setAccounting] = useState<{ currency: number; decimals: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [activityError, setActivityError] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)

  // Cursor-based pagination state
  const [payCursor, setPayCursor] = useState<string | null>(null)
  const [cashOutCursor, setCashOutCursor] = useState<string | null>(null)
  const [payHasMore, setPayHasMore] = useState(true)
  const [cashOutHasMore, setCashOutHasMore] = useState(true)

  const containerRef = useRef<HTMLDivElement>(null)

  const chainIdNum = parseInt(chainId)
  const explorerUrl = (MAINNET_CHAINS[chainIdNum] || MAINNET_CHAINS[1]).explorer

  useEffect(() => {
    async function loadActivity() {
      setLoading(true)
      setDisplayCount(PAGE_SIZE)
      setPayCursor(null)
      setCashOutCursor(null)
      setPayHasMore(true)
      setCashOutHasMore(true)
      setPayEvents([])
      setCashOutEvents([])
      setAccounting(null)
      setActivityError(false)

      try {
        // Fetch project info, currency info, and first page of events in parallel.
        // The token-homogeneity probe is best-effort: without it the feed keeps
        // its USD rendering. No per-row reads — one group lookup per load.
        const [project, payPage, cashOutPage, groupBalance] = await Promise.all([
          fetchProject(projectId, chainIdNum),
          fetchPayEventsPage(projectId, chainIdNum, 6, PAGE_SIZE * 2),
          fetchCashOutEventsPage(projectId, chainIdNum, 6, PAGE_SIZE * 2),
          (async () => {
            try {
              return await fetchSuckerGroupBalance(projectId, chainIdNum)
            } catch {
              return null
            }
          })(),
        ])

        if (project?.name) {
          setProjectName(project.name)
        }
        if (
          groupBalance?.balanceAvailable &&
          Number.isFinite(groupBalance.currency) &&
          Number.isFinite(groupBalance.decimals)
        ) {
          setAccounting({ currency: groupBalance.currency, decimals: groupBalance.decimals })
        }

        setPayEvents(payPage.items)
        setPayCursor(payPage.endCursor)
        setPayHasMore(payPage.hasNextPage)

        setCashOutEvents(cashOutPage.items)
        setCashOutCursor(cashOutPage.endCursor)
        setCashOutHasMore(cashOutPage.hasNextPage)
      } catch (err) {
        console.error('Failed to load activity:', err)
        setActivityError(true)
      } finally {
        setLoading(false)
      }
    }

    loadActivity()
  }, [projectId, chainId, chainIdNum])

  // Combine and sort events
  const events = useMemo(() => {
    const combined: ActivityEvent[] = []

    // Single accounting-token kind across the project's chains → render the
    // raw amount in that token (decimal-safe); heterogeneous → indexed USD.
    const inAccounting = (raw: string): string =>
      formatBalanceNative(raw, accounting!.currency, accounting!.decimals)

    // Add pay events
    for (const e of payEvents) {
      combined.push({
        type: 'pay',
        txHash: e.txHash,
        timestamp: e.timestamp,
        from: e.from,
        amount: accounting ? inAccounting(e.amount) : formatIndexedUsd(e.amountUsd),
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
        amount: accounting ? inAccounting(e.reclaimAmount) : formatIndexedUsd(e.reclaimAmountUsd),
        tokenAmount: formatTokenAmount(e.cashOutCount),
      })
    }

    // Sort by timestamp descending (most recent first)
    return combined.sort((a, b) => b.timestamp - a.timestamp)
  }, [payEvents, cashOutEvents, accounting])

  const displayedEvents = events.slice(0, displayCount)
  // Has more if there are more events to display OR if server has more data
  const hasMoreToDisplay = displayCount < events.length
  const hasMoreFromServer = payHasMore || cashOutHasMore
  const hasMore = hasMoreToDisplay || hasMoreFromServer
  // Reached end when nothing more to display and server is exhausted
  const reachedEnd = !hasMore && events.length > 0

  // Fetch more events from server
  const fetchMoreFromServer = useCallback(async () => {
    if (loadingMore || (!payHasMore && !cashOutHasMore)) return

    setLoadingMore(true)
    try {
      const [payPage, cashOutPage] = await Promise.all([
        payHasMore
          ? fetchPayEventsPage(projectId, chainIdNum, 6, PAGE_SIZE, payCursor)
          : Promise.resolve(null),
        cashOutHasMore
          ? fetchCashOutEventsPage(projectId, chainIdNum, 6, PAGE_SIZE, cashOutCursor)
          : Promise.resolve(null),
      ])

      if (payPage) {
        setPayEvents(prev => [...prev, ...payPage.items])
        setPayCursor(payPage.endCursor)
        setPayHasMore(payPage.hasNextPage)
      }

      if (cashOutPage) {
        setCashOutEvents(prev => [...prev, ...cashOutPage.items])
        setCashOutCursor(cashOutPage.endCursor)
        setCashOutHasMore(cashOutPage.hasNextPage)
      }
    } catch (err) {
      console.error('Failed to load more activity:', err)
      setActivityError(true)
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, payHasMore, cashOutHasMore, projectId, chainIdNum, payCursor, cashOutCursor])

  // Load more function - first show more from loaded events, then fetch from server
  const loadMore = useCallback(() => {
    if (displayCount < events.length) {
      // Show more of what we have
      setDisplayCount(prev => Math.min(prev + PAGE_SIZE, events.length))
    } else if (hasMoreFromServer && !loadingMore) {
      // Need to fetch more from server
      fetchMoreFromServer()
    }
  }, [events.length, displayCount, hasMoreFromServer, loadingMore, fetchMoreFromServer])

  // Auto-increase displayCount when new events are fetched from server
  useEffect(() => {
    if (events.length > displayCount) {
      setDisplayCount(events.length)
    }
  }, [events.length, displayCount])

  // Scroll-based infinite loading
  useEffect(() => {
    if (loading || events.length === 0) return

    const container = containerRef.current
    if (!container) return

    // Find the scrollable parent (traverse up looking for overflow-y-auto)
    let scrollParent: HTMLElement | null = container.parentElement
    while (scrollParent) {
      const style = window.getComputedStyle(scrollParent)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        break
      }
      scrollParent = scrollParent.parentElement
    }

    if (!scrollParent) return

    const handleScroll = () => {
      // Don't trigger if already loading more
      if (loadingMore) return

      const { scrollTop, scrollHeight, clientHeight } = scrollParent!
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight

      // Load more when 150px from bottom
      if (distanceFromBottom < 150) {
        loadMore()
      }
    }

    scrollParent.addEventListener('scroll', handleScroll, { passive: true })

    // Check immediately in case content is already scrolled
    handleScroll()

    return () => {
      scrollParent?.removeEventListener('scroll', handleScroll)
    }
  }, [loading, loadingMore, events.length, loadMore])

  const getEventColor = (type: ActivityEvent['type']) => {
    switch (type) {
      case 'pay': return 'text-emerald-400'
      case 'cashout': return 'text-amber-400'
    }
  }

  const EventRow = ({ event, idx }: { event: ActivityEvent; idx: number }) => (
    <div
      key={`${event.txHash}-${idx}`}
      className={`px-4 py-3 flex items-start gap-3 ${
        isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'
      }`}
    >
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
            {event.amount || 'View transaction'}
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
  )

  // Compact mode for sidebar - no outer container
  if (compact) {
    return (
      <div ref={containerRef} className={`divide-y ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
        {loading ? (
          <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Loading activity...
          </div>
        ) : activityError && displayedEvents.length === 0 ? (
          <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Activity unavailable
          </div>
        ) : displayedEvents.length === 0 ? (
          <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            No activity yet
          </div>
        ) : (
          <>
            {displayedEvents.map((event, idx) => (
              <EventRow key={`${event.txHash}-${idx}`} event={event} idx={idx} />
            ))}
            {/* Infinite scroll indicator */}
            {loadingMore && (
              <div className={`px-4 py-3 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <span className="text-xs">Loading more...</span>
              </div>
            )}
            {reachedEnd && (
              <div className={`px-4 py-4 text-center ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                <span className="text-xs opacity-60">That's all the activity</span>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full">
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
          ) : activityError && displayedEvents.length === 0 ? (
            <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Activity unavailable
            </div>
          ) : displayedEvents.length === 0 ? (
            <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              No activity yet
            </div>
          ) : (
            <>
              {displayedEvents.map((event, idx) => (
                <EventRow key={`${event.txHash}-${idx}`} event={event} idx={idx} />
              ))}
              {/* Infinite scroll indicator */}
              {loadingMore && (
                <div className={`px-4 py-3 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  <span className="text-xs">Loading more...</span>
                </div>
              )}
              {reachedEnd && (
                <div className={`px-4 py-4 text-center ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                  <span className="text-xs opacity-60">That's all the activity</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
