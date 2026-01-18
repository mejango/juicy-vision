import { useState, useEffect } from 'react'
import { useThemeStore } from '../../stores'

interface ActivityFeedProps {
  projectId: string
  chainId?: string
  limit?: number
}

interface ActivityEvent {
  type: 'pay' | 'cashout' | 'payout'
  txHash: string
  timestamp: number
  from: string
  amount: string
  tokenAmount?: string
  memo?: string
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

export default function ActivityFeed({
  projectId,
  chainId = '1',
  limit = 5
}: ActivityFeedProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    // Simulate loading activity - replace with real bendystraw query
    setLoading(true)
    const timeout = setTimeout(() => {
      const mockEvents: ActivityEvent[] = [
        {
          type: 'pay',
          txHash: '0x123...abc',
          timestamp: Date.now() / 1000 - 120,
          from: '0x1234567890abcdef1234567890abcdef12345678',
          amount: '0.5 ETH',
          tokenAmount: '50,000',
          memo: 'LFG!',
        },
        {
          type: 'pay',
          txHash: '0x456...def',
          timestamp: Date.now() / 1000 - 3600,
          from: '0xabcdef1234567890abcdef1234567890abcdef12',
          amount: '1.0 ETH',
          tokenAmount: '100,000',
        },
        {
          type: 'cashout',
          txHash: '0x789...ghi',
          timestamp: Date.now() / 1000 - 7200,
          from: '0x9876543210fedcba9876543210fedcba98765432',
          amount: '0.2 ETH',
          tokenAmount: '20,000',
        },
        {
          type: 'payout',
          txHash: '0xabc...jkl',
          timestamp: Date.now() / 1000 - 86400,
          from: '0x1111222233334444555566667777888899990000',
          amount: '2.5 ETH',
        },
        {
          type: 'pay',
          txHash: '0xdef...mno',
          timestamp: Date.now() / 1000 - 172800,
          from: '0xaaaa1111bbbb2222cccc3333dddd4444eeee5555',
          amount: '0.1 ETH',
          tokenAmount: '10,000',
          memo: 'First contribution!',
        },
      ]
      setEvents(mockEvents)
      setLoading(false)
    }, 500)

    return () => clearTimeout(timeout)
  }, [projectId, chainId])

  const displayedEvents = expanded ? events : events.slice(0, limit)

  const getEventIcon = (type: ActivityEvent['type']) => {
    switch (type) {
      case 'pay': return '💰'
      case 'cashout': return '🔄'
      case 'payout': return '📤'
    }
  }

  const getEventColor = (type: ActivityEvent['type']) => {
    switch (type) {
      case 'pay': return 'text-emerald-400'
      case 'cashout': return 'text-amber-400'
      case 'payout': return 'text-blue-400'
    }
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between ${
        isDark ? 'border-white/10' : 'border-gray-100'
      }`}>
        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Activity
        </span>
        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Project #{projectId}
        </span>
      </div>

      {/* Events list */}
      <div className="divide-y divide-white/5">
        {loading ? (
          <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Loading activity...
          </div>
        ) : displayedEvents.length === 0 ? (
          <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            No activity yet
          </div>
        ) : (
          displayedEvents.map((event) => (
            <div
              key={event.txHash}
              className={`px-4 py-3 flex items-start gap-3 ${
                isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'
              }`}
            >
              <span className="text-lg">{getEventIcon(event.type)}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {formatAddress(event.from)}
                  </span>
                  <span className={`text-sm ${getEventColor(event.type)}`}>
                    {event.type === 'pay' && 'paid'}
                    {event.type === 'cashout' && 'cashed out'}
                    {event.type === 'payout' && 'sent payouts'}
                  </span>
                  <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {event.amount}
                  </span>
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
  )
}
