// Shared building blocks for the dashboard charts (Balance, Volume, TokenPrice, Holders)
import { useState, type ReactElement, type ReactNode } from 'react'
import { TimeRange } from './utils'
import ChainToggleBar from './ChainToggleBar'

// Row of range buttons shown in each chart header
export function RangeSelector({
  options,
  range,
  onChange,
  isDark,
}: {
  options: { value: TimeRange; label: string }[]
  range: TimeRange
  onChange: (range: TimeRange) => void
  isDark: boolean
}) {
  return (
    <div className="flex gap-1">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2 py-0.5 text-xs transition-colors ${
            range === opt.value
              ? isDark ? 'bg-white/10 text-white' : 'bg-gray-200 text-gray-900'
              : isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// Loading / error / empty / chart states. `heightClass` must be a literal
// Tailwind class (e.g. "h-[180px]") at the call site so the JIT scanner sees it.
export function ChartState({
  heightClass,
  isDark,
  loading,
  error,
  errorNode,
  isEmpty,
  emptyMessage,
  children,
}: {
  heightClass: string
  isDark: boolean
  loading: boolean
  error: string | null
  errorNode?: ReactElement
  isEmpty: boolean
  emptyMessage: string
  children: ReactNode
}) {
  if (loading) {
    return (
      <div className={`${heightClass} flex items-center justify-center ${
        isDark ? 'text-gray-500' : 'text-gray-400'
      }`}>
        Loading...
      </div>
    )
  }
  if (error) {
    return errorNode ?? (
      <div className={`${heightClass} flex items-center justify-center text-red-400`}>
        {error}
      </div>
    )
  }
  if (isEmpty) {
    return (
      <div className={`${heightClass} flex items-center justify-center ${
        isDark ? 'text-gray-500' : 'text-gray-400'
      }`}>
        {emptyMessage}
      </div>
    )
  }
  return <div className={heightClass}>{children}</div>
}

// Outer container for custom recharts tooltips
export function TooltipShell({ isDark, children }: { isDark: boolean; children: ReactNode }) {
  return (
    <div className={`w-max px-3 py-2 border shadow-lg text-sm ${
      isDark
        ? 'bg-zinc-900 border-zinc-700 text-white'
        : 'bg-white border-gray-200 text-gray-900'
    }`}>
      {children}
    </div>
  )
}

// Footer strip below the chart with current values / totals
export function ChartFooter({ isDark, children }: { isDark: boolean; children: ReactNode }) {
  return (
    <div className={`px-4 py-2 text-xs border-t flex flex-wrap gap-x-4 gap-y-1 ${
      isDark ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
    }`}>
      {children}
    </div>
  )
}

// Per-chain selection state: 'all' means aggregated view; toggling the last
// selected chain off returns to 'all'.
export function useChainSelection() {
  const [selectedChains, setSelectedChains] = useState<Set<number> | 'all'>('all')

  const handleChainToggle = (chainId: number) => {
    if (selectedChains === 'all') {
      setSelectedChains(new Set([chainId]))
    } else {
      const newSelected = new Set(selectedChains)
      if (newSelected.has(chainId)) {
        newSelected.delete(chainId)
        if (newSelected.size === 0) {
          setSelectedChains('all')
        } else {
          setSelectedChains(newSelected)
        }
      } else {
        newSelected.add(chainId)
        setSelectedChains(newSelected)
      }
    }
  }

  const handleSelectAll = () => {
    setSelectedChains('all')
  }

  return { selectedChains, handleChainToggle, handleSelectAll }
}

// "Breakdown" disclosure with the per-chain toggle bar
export function BreakdownToggle({
  isDark,
  showBreakdown,
  onToggle,
  availableChains,
  selectedChains,
  onChainToggle,
  onSelectAll,
}: {
  isDark: boolean
  showBreakdown: boolean
  onToggle: () => void
  availableChains: number[]
  selectedChains: Set<number> | 'all'
  onChainToggle: (chainId: number) => void
  onSelectAll: () => void
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
      >
        <span>Breakdown</span>
        <svg
          className={`w-3 h-3 transition-transform ${showBreakdown ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {showBreakdown && (
        <div className="mt-2">
          <ChainToggleBar
            availableChains={availableChains}
            selectedChains={selectedChains}
            onToggle={onChainToggle}
            onSelectAll={onSelectAll}
          />
        </div>
      )}
    </div>
  )
}
