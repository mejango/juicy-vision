// Generic in-memory cache with TTL

interface CacheEntry<T> {
  value: T
  timestamp: number
}

export function createCache<T>(durationMs: number) {
  const cache = new Map<string, CacheEntry<T>>()

  return {
    get(key: string): T | null {
      const entry = cache.get(key)
      if (!entry) return null
      if (Date.now() - entry.timestamp > durationMs) {
        cache.delete(key)
        return null
      }
      return entry.value
    },

    set(key: string, value: T): void {
      cache.set(key, { value, timestamp: Date.now() })
    },

    has(key: string): boolean {
      return this.get(key) !== null
    },

    delete(key: string): void {
      cache.delete(key)
    },

    clear(): void {
      cache.clear()
    },
  }
}

// Common cache durations
export const CACHE_DURATIONS = {
  SHORT: 30 * 1000,        // 30 seconds
  MEDIUM: 5 * 60 * 1000,   // 5 minutes
  LONG: 60 * 60 * 1000,    // 1 hour
  DAY: 24 * 60 * 60 * 1000, // 24 hours
} as const
