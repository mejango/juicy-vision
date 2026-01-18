import { useState, useEffect } from 'react'
import { useThemeStore } from '../../stores'
import { fetchProjectWithRuleset } from '../../services/bendystraw'

interface PriceChartProps {
  projectId: string
  chainId?: string
  type?: 'issuance' | 'cashout' | 'all'
  range?: '7d' | '30d' | '90d' | '1y' | 'all'
}

interface DataPoint {
  timestamp: number
  issuancePrice?: number
  cashOutPrice?: number
  cycleStart?: boolean
}

const RANGE_OPTIONS = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
]

// Calculate token price from weight (price = 1/weight in ETH terms, adjusted for 18 decimals)
function weightToPrice(weight: string): number {
  const w = parseFloat(weight)
  if (w === 0) return 0
  // weight is tokens per ETH (with 18 decimals), price is ETH per token
  return 1e18 / w
}

// Calculate cash out price based on cashOutTaxRate
function calculateCashOutPrice(issuancePrice: number, cashOutTaxRate: number): number {
  // cashOutTaxRate of 0 = 100% return, 10000 = 0% return
  const returnPercent = (10000 - cashOutTaxRate) / 10000
  return issuancePrice * returnPercent
}

export default function PriceChart({
  projectId,
  chainId = '1',
  type = 'all',
  range: initialRange = '30d'
}: PriceChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [range, setRange] = useState(initialRange)
  const [showIssuance, setShowIssuance] = useState(type === 'all' || type === 'issuance')
  const [showCashOut, setShowCashOut] = useState(type === 'all' || type === 'cashout')
  const [data, setData] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [_error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadPriceData() {
      setLoading(true)
      setError(null)

      try {
        const project = await fetchProjectWithRuleset(projectId, parseInt(chainId))

        if (!project || !project.currentRuleset) {
          setError('No ruleset data available')
          setLoading(false)
          return
        }

        const { weight, decayPercent, duration, cashOutTaxRate } = project.currentRuleset

        // Calculate current issuance price from weight
        const currentIssuancePrice = weightToPrice(weight)

        // Calculate historical prices by working backwards through cycles
        const now = Date.now() / 1000
        const points: DataPoint[] = []
        const decayRate = parseFloat(decayPercent) / 1e9 // Convert to decimal
        const cycleDuration = duration || 604800 // Default 7 days if no duration

        // Determine number of days to show based on range
        const rangeDays: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365, 'all': 365 }
        const numDays = rangeDays[range] || 30

        for (let dayOffset = numDays; dayOffset >= 0; dayOffset--) {
          const timestamp = now - dayOffset * 86400
          const cyclesAgo = Math.floor((dayOffset * 86400) / cycleDuration)

          // Price at this point = current price / (1 - decay)^cycles since then
          // Working backwards: earlier price was lower
          let historicalPrice = currentIssuancePrice
          if (decayRate > 0 && cyclesAgo > 0) {
            historicalPrice = currentIssuancePrice / Math.pow(1 + decayRate, cyclesAgo)
          }

          const historicalCashOut = calculateCashOutPrice(historicalPrice, cashOutTaxRate)

          // Mark cycle boundaries
          const dayInCycle = (dayOffset * 86400) % cycleDuration
          const isCycleStart = dayInCycle < 86400

          points.push({
            timestamp,
            issuancePrice: historicalPrice,
            cashOutPrice: historicalCashOut,
            cycleStart: isCycleStart,
          })
        }

        setData(points)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load price data')
      } finally {
        setLoading(false)
      }
    }

    loadPriceData()
  }, [projectId, chainId, range])

  const maxPrice = Math.max(...data.flatMap(d => [d.issuancePrice || 0, d.cashOutPrice || 0]))
  const minPrice = Math.min(...data.filter(d => d.issuancePrice || d.cashOutPrice).flatMap(d => [d.issuancePrice || Infinity, d.cashOutPrice || Infinity]))
  const priceRange = maxPrice - minPrice || 1

  const chartHeight = 120
  const chartWidth = 280

  const getY = (price: number) => {
    return chartHeight - ((price - minPrice) / priceRange) * (chartHeight - 20) - 10
  }

  const issuancePath = data
    .filter(d => d.issuancePrice)
    .map((d, i, arr) => {
      const x = (i / (arr.length - 1)) * chartWidth
      const y = getY(d.issuancePrice!)
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')

  const cashOutPath = data
    .filter(d => d.cashOutPrice)
    .map((d, i, arr) => {
      const x = (i / (arr.length - 1)) * chartWidth
      const y = getY(d.cashOutPrice!)
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')

  return (
    <div className={`rounded-lg border overflow-hidden ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between ${
        isDark ? 'border-white/10' : 'border-gray-100'
      }`}>
        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Token Price
        </span>
        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Project #{projectId}
        </span>
      </div>

      {/* Controls */}
      <div className={`px-4 py-2 flex items-center justify-between gap-2 border-b ${
        isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'
      }`}>
        <div className="flex gap-2">
          <button
            onClick={() => setShowIssuance(!showIssuance)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
              showIssuance
                ? 'bg-emerald-500/20 text-emerald-400'
                : isDark ? 'bg-white/5 text-gray-500' : 'bg-gray-100 text-gray-400'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Issuance
          </button>
          <button
            onClick={() => setShowCashOut(!showCashOut)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
              showCashOut
                ? 'bg-amber-500/20 text-amber-400'
                : isDark ? 'bg-white/5 text-gray-500' : 'bg-gray-100 text-gray-400'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            Cash Out
          </button>
        </div>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value as typeof range)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                range === opt.value
                  ? isDark ? 'bg-white/10 text-white' : 'bg-gray-200 text-gray-900'
                  : isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="p-4">
        {loading ? (
          <div className={`h-[120px] flex items-center justify-center ${
            isDark ? 'text-gray-500' : 'text-gray-400'
          }`}>
            Loading...
          </div>
        ) : (
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-[120px]">
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map(pct => (
              <line
                key={pct}
                x1={0}
                y1={chartHeight - pct * (chartHeight - 20) - 10}
                x2={chartWidth}
                y2={chartHeight - pct * (chartHeight - 20) - 10}
                stroke={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                strokeDasharray="4 4"
              />
            ))}

            {/* Issuance price line */}
            {showIssuance && issuancePath && (
              <path
                d={issuancePath}
                fill="none"
                stroke="#10b981"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Cash out price line */}
            {showCashOut && cashOutPath && (
              <path
                d={cashOutPath}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        )}
      </div>

      {/* Footer with current prices */}
      <div className={`px-4 py-2 flex gap-4 text-xs ${
        isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-500'
      }`}>
        {showIssuance && data.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            {data[data.length - 1]?.issuancePrice?.toFixed(6)} ETH
          </span>
        )}
        {showCashOut && data.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            {data[data.length - 1]?.cashOutPrice?.toFixed(6)} ETH
          </span>
        )}
      </div>
    </div>
  )
}
