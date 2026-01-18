import { useState } from 'react'
import { useThemeStore } from '../../stores'

interface TransactionPreviewProps {
  action: string
  contract: string
  chainId: string
  projectId?: string
  parameters: string // JSON string of parameters
  explanation: string
}

const CHAIN_NAMES: Record<string, string> = {
  '1': 'Ethereum',
  '10': 'Optimism',
  '8453': 'Base',
  '42161': 'Arbitrum',
}

const CHAIN_COLORS: Record<string, string> = {
  '1': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  '10': 'bg-red-500/20 text-red-300 border-red-500/30',
  '8453': 'bg-blue-400/20 text-blue-200 border-blue-400/30',
  '42161': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
}

const ACTION_ICONS: Record<string, string> = {
  pay: '💰',
  cashOut: '🔄',
  sendPayouts: '📤',
  useAllowance: '💸',
  mintTokens: '🪙',
  burnTokens: '🔥',
  launchProject: '🚀',
  queueRuleset: '📋',
  deployERC20: '🎟️',
}

export default function TransactionPreview({
  action,
  contract,
  chainId,
  projectId,
  parameters,
  explanation,
}: TransactionPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  let parsedParams: Record<string, string> = {}
  try {
    parsedParams = JSON.parse(parameters)
  } catch {
    parsedParams = { raw: parameters }
  }

  const chainName = CHAIN_NAMES[chainId] || `Chain ${chainId}`
  const chainColor = CHAIN_COLORS[chainId] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'
  const actionIcon = ACTION_ICONS[action] || '📝'

  return (
    <div className={`inline-block border overflow-hidden ${
      isDark
        ? 'bg-juice-dark-lighter border-white/10'
        : 'bg-white border-gray-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${
        isDark ? 'border-white/10' : 'border-gray-200'
      }`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">{actionIcon}</span>
            <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Summary
            </span>
          </div>
          <span className={`px-2 py-0.5 text-xs font-medium border ${chainColor}`}>
            {chainName}
          </span>
        </div>
      </div>

      {/* Explanation */}
      <div className="px-4 py-3">
        <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
          {explanation}
        </p>
      </div>

      {/* Expandable details for advanced users */}
      <div className={`px-4 py-2 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-2 text-xs ${
            isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'
          }`}
        >
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {expanded ? 'Hide' : 'Show'} technical details
        </button>

        {expanded && (
          <div className="mt-3 space-y-1.5 text-xs">
            <div className={`flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
              <span>Contract</span>
              <span className="font-mono">{contract}</span>
            </div>

            <div className={`flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
              <span>Action</span>
              <span className="font-mono">{action}</span>
            </div>

            {projectId && (
              <div className={`flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                <span>Project</span>
                <span className="font-mono">#{projectId}</span>
              </div>
            )}

            {Object.entries(parsedParams).map(([key, value]) => (
              <div key={key} className={`flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                <span>{formatParamName(key)}</span>
                <span className="font-mono text-right max-w-[60%] truncate" title={String(value)}>
                  {formatParamValue(key, value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

// Helper to format parameter names
function formatParamName(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim()
}

// Helper to format parameter values
function formatParamValue(_key: string, value: string): string {
  // Handle addresses
  if (value.startsWith('0x') && value.length === 42) {
    return `${value.slice(0, 6)}...${value.slice(-4)}`
  }

  // Handle large numbers (likely wei)
  if (/^\d{18,}$/.test(value)) {
    const eth = parseFloat(value) / 1e18
    return `${eth.toFixed(4)} ETH`
  }

  return value
}
