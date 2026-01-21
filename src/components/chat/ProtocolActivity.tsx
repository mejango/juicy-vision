import { useEffect, useRef } from 'react'
import { useThemeStore, useActivityStore } from '../../stores'
import ActivityItem from './ActivityItem'

interface ProtocolActivityProps {
  onProjectClick?: (query: string) => void
}

export default function ProtocolActivity({ onProjectClick }: ProtocolActivityProps) {
  const { theme } = useThemeStore()
  const {
    events,
    loading,
    loadingMore,
    hasMore,
    error,
    initialize,
    loadMore,
    startPolling,
    stopPolling,
  } = useActivityStore()
  const containerRef = useRef<HTMLDivElement>(null)
  // Store refs for scroll handler to avoid stale closures
  const hasMoreRef = useRef(hasMore)
  const loadingMoreRef = useRef(loadingMore)
  const loadMoreRef = useRef(loadMore)

  // Keep refs in sync
  useEffect(() => {
    hasMoreRef.current = hasMore
    loadingMoreRef.current = loadingMore
    loadMoreRef.current = loadMore
  }, [hasMore, loadingMore, loadMore])

  // Initial load and polling
  useEffect(() => {
    initialize()
    startPolling()
    return () => stopPolling()
  }, [initialize, startPolling, stopPolling])

  // Scroll-based infinite loading
  // Re-run when loading finishes so we can attach to the scrollable parent
  useEffect(() => {
    // Wait until loading is done and we have events
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

    if (!scrollParent) {
      console.warn('[Activity] No scrollable parent found')
      return
    }

    // Scroll handler - load more when near bottom
    const handleScroll = () => {
      if (!hasMoreRef.current || loadingMoreRef.current) return

      const { scrollTop, scrollHeight, clientHeight } = scrollParent!
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight

      // Load more when 150px from bottom
      if (distanceFromBottom < 150) {
        loadMoreRef.current()
      }
    }

    scrollParent.addEventListener('scroll', handleScroll, { passive: true })

    // Also check immediately in case content is already scrolled
    handleScroll()

    return () => {
      scrollParent?.removeEventListener('scroll', handleScroll)
    }
  }, [loading, events.length]) // Re-run when loading finishes

  // Skeleton loading card
  const SkeletonCard = () => (
    <div className={`px-3 py-3 -mx-4 border-b animate-pulse ${
      theme === 'dark' ? 'border-white/10' : 'border-gray-200'
    }`}>
      {/* Top row: Project name + time */}
      <div className="flex items-center gap-2">
        <div className={`h-3 w-20 rounded ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
        <div className="flex-1" />
        <div className={`h-2 w-12 rounded ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
      </div>
      {/* Middle row: Action + Amount */}
      <div className="flex items-center gap-2 mt-1.5">
        <div className={`h-2 w-10 rounded ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
        <div className={`h-3 w-16 rounded ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
      </div>
      {/* Bottom row: address on CHAIN */}
      <div className="flex items-center gap-1.5 mt-1.5">
        <div className={`h-2 w-24 rounded ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
        <div className={`h-3 w-8 rounded ${theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'}`} />
      </div>
    </div>
  )

  return (
    <div ref={containerRef} className="h-full">
      {loading ? (
        <div>
          {[...Array(100)].map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : error ? (
        <div className={`py-8 text-center text-sm ${
          theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
        }`}>
          {error}
        </div>
      ) : events.length === 0 ? (
        <div className={`py-8 text-center text-sm ${
          theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
        }`}>
          No recent activity
        </div>
      ) : (
        <>
          {events.map((event) => (
            <ActivityItem key={event.id} event={event} onProjectClick={onProjectClick} />
          ))}
          {/* Infinite scroll loader / load more button */}
          <div className="min-h-[48px]">
            {loadingMore ? (
              <>
                {[...Array(3)].map((_, i) => (
                  <SkeletonCard key={`loading-${i}`} />
                ))}
              </>
            ) : hasMore ? (
              <div className="py-4 text-center">
                <button
                  onClick={() => loadMore()}
                  className={`text-xs transition-colors ${
                    theme === 'dark'
                      ? 'text-gray-500 hover:text-gray-300'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  Load more
                </button>
              </div>
            ) : events.length > 15 ? (
              <div className="py-4 text-center">
                <span className={`text-xs ${theme === 'dark' ? 'text-gray-600' : 'text-gray-400'}`}>
                  End of activity
                </span>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
