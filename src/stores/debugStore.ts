import { create } from 'zustand'

export interface QueryError {
  id: string
  timestamp: number
  queryName: string
  query: string
  variables: Record<string, unknown>
  error: string
  errorDetails?: unknown
}

interface DebugState {
  // Query errors for debugging
  queryErrors: QueryError[]
  // Whether to show debug info in UI (dev mode)
  showDebugInfo: boolean

  // Actions
  addQueryError: (error: Omit<QueryError, 'id' | 'timestamp'>) => void
  clearQueryErrors: () => void
  toggleDebugInfo: () => void
}

// Extract query name from GraphQL query string
function extractQueryName(query: string): string {
  const match = query.match(/(?:query|mutation)\s+(\w+)/)
  return match?.[1] || 'Unknown'
}

export const useDebugStore = create<DebugState>()((set, get) => ({
  queryErrors: [],
  showDebugInfo: typeof window !== 'undefined' && window.location.hostname === 'localhost',

  addQueryError: (error) => {
    const newError: QueryError = {
      ...error,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      queryName: error.queryName || extractQueryName(error.query),
    }

    // Keep only last 20 errors
    const errors = [newError, ...get().queryErrors].slice(0, 20)
    set({ queryErrors: errors })

    // Also log to console with full details for debugging
    console.error(`[Bendystraw Error] ${newError.queryName}:`, {
      query: newError.query,
      variables: newError.variables,
      error: newError.error,
      details: newError.errorDetails,
    })
  },

  clearQueryErrors: () => set({ queryErrors: [] }),

  toggleDebugInfo: () => set({ showDebugInfo: !get().showDebugInfo }),
}))
