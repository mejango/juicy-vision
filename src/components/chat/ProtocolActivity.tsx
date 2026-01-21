import { useState, useEffect, useRef, useCallback } from 'react'
import { useThemeStore } from '../../stores'
import { fetchActivityEvents, ActivityEvent } from '../../services/bendystraw/client'
import { ACTIVITY_PAGE_SIZE, ACTIVITY_POLL_INTERVAL } from '../../constants'
import ActivityItem from './ActivityItem'

interface ProtocolActivityProps {
  onProjectClick?: (query: string) => void
}

export default function ProtocolActivity({ onProjectClick }: ProtocolActivityProps) {
  const { theme } = useThemeStore()
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loaderRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Track server offset separately from events.length (which includes polled new events)
  const serverOffsetRef = useRef(0)

  // Initial load
  useEffect(() => {
    let mounted = true

    const loadEvents = async () => {
      try {
        const data = await fetchActivityEvents(ACTIVITY_PAGE_SIZE, 0)
        if (mounted) {
          setEvents(data)
          serverOffsetRef.current = ACTIVITY_PAGE_SIZE // Track what we requested, not what came back
          setHasMore(data.length > 0) // If we got any events, assume there might be more
          setLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setError('Failed to load activity')
          setLoading(false)
        }
      }
    }

    loadEvents()

    // Poll for new events
    const interval = setInterval(async () => {
      try {
        const data = await fetchActivityEvents(ACTIVITY_PAGE_SIZE, 0)
        if (mounted) {
          // Merge new events at the top
          setEvents(prev => {
            const existingIds = new Set(prev.map(e => e.id))
            const newEvents = data.filter(e => !existingIds.has(e.id))
            return [...newEvents, ...prev]
          })
        }
      } catch {
        // Silently fail on poll
      }
    }, ACTIVITY_POLL_INTERVAL)

    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  // Load more when scrolling
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return

    setLoadingMore(true)
    try {
      const offset = serverOffsetRef.current
      const data = await fetchActivityEvents(ACTIVITY_PAGE_SIZE, offset)
      serverOffsetRef.current = offset + ACTIVITY_PAGE_SIZE // Track what we requested
      setEvents(prev => {
        // Dedupe in case of overlap with polled events
        const existingIds = new Set(prev.map(e => e.id))
        const newEvents = data.filter(e => !existingIds.has(e.id))
        return [...prev, ...newEvents]
      })
      // Only stop if we got zero events (truly exhausted)
      setHasMore(data.length > 0)
    } catch {
      // Silently fail
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore])

  // Intersection observer for infinite scroll
  useEffect(() => {
    const loader = loaderRef.current
    const container = containerRef.current
    if (!loader || !container) return

    // Find the scrollable parent (the one with overflow-y-auto)
    const scrollableParent = container.closest('.overflow-y-auto') as HTMLElement | null

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore()
        }
      },
      {
        root: scrollableParent, // Use scrollable parent instead of viewport
        threshold: 0.1,
        rootMargin: '100px' // Load more before reaching the very bottom
      }
    )

    observer.observe(loader)
    return () => observer.disconnect()
  }, [loadMore, hasMore, loadingMore])

  return (
    <div ref={containerRef} className="h-full">
      {loading ? (
        <div className="py-8 text-center">
          <div className="inline-block w-6 h-6 border-2 border-juice-orange border-t-transparent rounded-full animate-spin" />
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
          {/* Infinite scroll loader */}
          {hasMore && (
            <div ref={loaderRef} className="py-4 text-center">
              {loadingMore && (
                <div className="inline-block w-5 h-5 border-2 border-juice-orange border-t-transparent rounded-full animate-spin" />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
