// Shared chart utilities and formatting functions

export type TimeRange = '7d' | '30d' | '90d' | '3m' | '1y' | 'all'

export const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
]

// Extended range options for price charts (matches revnet-app)
export const PRICE_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '3m', label: '3M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
]

// Get timestamp for start of range
export function getRangeStartTimestamp(range: TimeRange): number {
  const now = Math.floor(Date.now() / 1000)
  const day = 86400

  switch (range) {
    case '7d':
      return now - 7 * day
    case '30d':
      return now - 30 * day
    case '90d':
    case '3m':
      return now - 90 * day
    case '1y':
      return now - 365 * day
    case 'all':
      return 0
  }
}

// Format timestamp for X axis based on range
export function formatXAxis(timestamp: number, range: TimeRange): string {
  const date = new Date(timestamp * 1000)

  if (range === '7d') {
    return date.toLocaleDateString('en-US', { weekday: 'short' })
  }
  if (range === '30d' || range === '90d' || range === '3m') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

// Format Y axis values (ETH amounts)
export function formatYAxis(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  if (value >= 1) return value.toFixed(2)
  if (value >= 0.001) return value.toFixed(4)
  return value.toFixed(6)
}

// Format ETH values for tooltips
export function formatEthValue(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K ETH`
  if (value >= 1) return `${value.toFixed(4)} ETH`
  return `${value.toFixed(6)} ETH`
}

// Format percentage
export function formatPercentage(value: number): string {
  if (value >= 10) return `${value.toFixed(1)}%`
  if (value >= 1) return `${value.toFixed(2)}%`
  return `${value.toFixed(3)}%`
}

// Format address for display
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return ''
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

// Filter data points to range
export function filterToRange<T extends { timestamp: number }>(
  data: T[],
  range: TimeRange
): T[] {
  const startTs = getRangeStartTimestamp(range)
  return data.filter(d => d.timestamp >= startTs)
}

// Calculate smart Y domain with padding
export function calculateYDomain(
  data: number[]
): [number, number] {
  if (data.length === 0) return [0, 1]

  const min = Math.min(...data)
  const max = Math.max(...data)

  if (min === max) {
    // All same value - expand by 10%
    const padding = max * 0.1 || 0.1
    return [Math.max(0, min - padding), max + padding]
  }

  // Add 5% padding
  const padding = (max - min) * 0.05
  return [Math.max(0, min - padding), max + padding]
}

// Chart colors - canonical source for all chart styling
export const CHART_COLORS = {
  // Data series colors
  primary: '#F5A623',    // juice-orange
  secondary: '#5CEBDF',  // juice-cyan
  tertiary: '#10b981',   // emerald
  quaternary: '#f59e0b', // amber
  // Axis & grid (dark mode)
  axis: '#666666',
  grid: 'rgba(255,255,255,0.1)',
  // Axis & grid (light mode)
  axisLight: '#999999',
  gridLight: 'rgba(0,0,0,0.1)',
  // Semantic colors
  positive: '#22c55e',   // green-500
  negative: '#ef4444',   // red-500
  // Token price chart specific
  issuance: '#10b981',   // emerald - issuance price
  cashOut: '#94a3b8',    // slate - cash out price
  pool: '#60a5fa',       // blue - pool/market price
}

// Chain colors for multi-chain charts
export const CHAIN_COLORS: Record<number, string> = {
  1: '#627EEA',      // Ethereum
  10: '#FF0420',     // Optimism
  8453: '#0052FF',   // Base
  42161: '#28A0F0',  // Arbitrum
}

// Get chain color with fallback
export function getChainColor(chainId: number): string {
  return CHAIN_COLORS[chainId] || '#888888'
}

// Pie chart color palette
export const PIE_COLORS = [
  '#F5A623', '#5CEBDF', '#FF6B6B', '#4ECDC4', '#45B7D1',
  '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F8B739', '#82E0AA', '#F1948A',
  '#AED6F1', '#F9E79F', '#D7BDE2', '#A3E4D7', '#FAD7A0',
]
