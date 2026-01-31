import { useState } from 'react'
import { useDebugStore } from '../../stores'
import { useThemeStore } from '../../stores'

/**
 * Debug panel that shows Bendystraw query errors
 * Only visible in development or when manually enabled
 */
export function QueryErrorPanel() {
  const { queryErrors, showDebugInfo, clearQueryErrors } = useDebugStore()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (!showDebugInfo || queryErrors.length === 0) {
    return null
  }

  return (
    <div
      className={`fixed bottom-4 right-4 max-w-lg max-h-96 overflow-auto rounded-lg shadow-xl z-50 ${
        isDark ? 'bg-red-950 border border-red-800' : 'bg-red-50 border border-red-200'
      }`}
    >
      <div className={`sticky top-0 flex items-center justify-between px-3 py-2 ${
        isDark ? 'bg-red-900/80 backdrop-blur' : 'bg-red-100'
      }`}>
        <span className={`text-sm font-medium ${isDark ? 'text-red-200' : 'text-red-800'}`}>
          Bendystraw Errors ({queryErrors.length})
        </span>
        <button
          onClick={clearQueryErrors}
          className={`text-xs px-2 py-1 rounded ${
            isDark ? 'text-red-300 hover:bg-red-800' : 'text-red-600 hover:bg-red-200'
          }`}
        >
          Clear
        </button>
      </div>

      <div className="p-2 space-y-2">
        {queryErrors.map((err) => (
          <div
            key={err.id}
            className={`rounded p-2 text-xs ${
              isDark ? 'bg-red-900/50' : 'bg-red-100/50'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className={`font-mono font-semibold ${isDark ? 'text-red-300' : 'text-red-700'}`}>
                  {err.queryName}
                </span>
                <span className={`ml-2 ${isDark ? 'text-red-400' : 'text-red-500'}`}>
                  {new Date(err.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <button
                onClick={() => setExpandedId(expandedId === err.id ? null : err.id)}
                className={`text-xs ${isDark ? 'text-red-400 hover:text-red-300' : 'text-red-600 hover:text-red-700'}`}
              >
                {expandedId === err.id ? 'Hide' : 'Details'}
              </button>
            </div>

            <div className={`mt-1 ${isDark ? 'text-red-200' : 'text-red-800'}`}>
              {err.error}
            </div>

            {expandedId === err.id && (
              <div className="mt-2 space-y-2">
                <div>
                  <div className={`text-xs font-medium mb-1 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                    Variables:
                  </div>
                  <pre className={`text-xs p-2 rounded overflow-auto max-h-32 ${
                    isDark ? 'bg-black/30 text-red-200' : 'bg-white text-red-900'
                  }`}>
                    {JSON.stringify(err.variables, null, 2)}
                  </pre>
                </div>

                <div>
                  <div className={`text-xs font-medium mb-1 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                    Query:
                  </div>
                  <pre className={`text-xs p-2 rounded overflow-auto max-h-48 ${
                    isDark ? 'bg-black/30 text-red-200' : 'bg-white text-red-900'
                  }`}>
                    {err.query.trim()}
                  </pre>
                </div>

                {err.errorDetails != null && (
                  <div>
                    <div className={`text-xs font-medium mb-1 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                      Error Details:
                    </div>
                    <pre className={`text-xs p-2 rounded overflow-auto max-h-32 ${
                      isDark ? 'bg-black/30 text-red-200' : 'bg-white text-red-900'
                    }`}>
                      {String(typeof err.errorDetails === 'string'
                        ? err.errorDetails
                        : JSON.stringify(err.errorDetails, null, 2))}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
