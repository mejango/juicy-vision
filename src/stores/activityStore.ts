import { create } from 'zustand'
import { ActivityEvent, fetchActivityEvents } from '../services/bendystraw/client'
import { ACTIVITY_PAGE_SIZE, ACTIVITY_POLL_INTERVAL } from '../constants'

interface ActivityState {
  events: ActivityEvent[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: string | null
  serverOffset: number
  initialized: boolean
  pollInterval: ReturnType<typeof setInterval> | null

  // Actions
  initialize: () => Promise<void>
  loadMore: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

export const useActivityStore = create<ActivityState>()((set, get) => ({
  events: [],
  loading: true,
  loadingMore: false,
  hasMore: true,
  error: null,
  serverOffset: 0,
  initialized: false,
  pollInterval: null,

  initialize: async () => {
    const state = get()
    // Only load once, unless we need to retry (hasMore false but have few events)
    if (state.initialized && state.hasMore) return

    set({ initialized: true, loading: !state.initialized, hasMore: true })

    try {
      const data = await fetchActivityEvents(ACTIVITY_PAGE_SIZE, 0)
      set({
        events: data,
        serverOffset: ACTIVITY_PAGE_SIZE,
        // Assume there's more unless we got nothing
        // (filtered results may be fewer than requested)
        hasMore: data.length > 0,
        loading: false,
      })
    } catch {
      set({
        error: 'Failed to load activity',
        loading: false,
      })
    }
  },

  loadMore: async () => {
    const { loadingMore, hasMore, serverOffset } = get()
    if (loadingMore || !hasMore) return

    set({ loadingMore: true })
    try {
      const data = await fetchActivityEvents(ACTIVITY_PAGE_SIZE, serverOffset)
      set(state => {
        const existingIds = new Set(state.events.map(e => e.id))
        const newEvents = data.filter(e => !existingIds.has(e.id))
        return {
          events: [...state.events, ...newEvents],
          serverOffset: serverOffset + ACTIVITY_PAGE_SIZE,
          // Only stop when we get no new events
          // (filtered results may be fewer than requested)
          hasMore: newEvents.length > 0,
          loadingMore: false,
        }
      })
    } catch {
      set({ loadingMore: false })
    }
  },

  startPolling: () => {
    const existing = get().pollInterval
    if (existing) return // Already polling

    const interval = setInterval(async () => {
      try {
        const data = await fetchActivityEvents(ACTIVITY_PAGE_SIZE, 0)
        set(state => {
          const existingIds = new Set(state.events.map(e => e.id))
          const newEvents = data.filter(e => !existingIds.has(e.id))
          if (newEvents.length === 0) return state
          return { events: [...newEvents, ...state.events] }
        })
      } catch {
        // Silently fail on poll
      }
    }, ACTIVITY_POLL_INTERVAL)

    set({ pollInterval: interval })
  },

  stopPolling: () => {
    const interval = get().pollInterval
    if (interval) {
      clearInterval(interval)
      set({ pollInterval: null })
    }
  },
}))
