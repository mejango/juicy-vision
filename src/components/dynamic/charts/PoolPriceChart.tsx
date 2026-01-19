import { useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useThemeStore } from '../../../stores'
import {
  fetchPoolPriceHistory,
  shouldUseHourlyData,
  getPoolRangeStartTimestamp,
  type PoolPriceDataPoint,
} from '../../../services/uniswap'
import {
  TimeRange,
  PRICE_RANGE_OPTIONS,
  formatXAxis,
} from './utils'

interface PoolPriceChartProps {
  poolAddress: string
  projectTokenAddress: string
  chainId?: string
  tokenSymbol?: string
  range?: TimeRange
}

// Pool price color (light blue like revnet-app)
const POOL_PRICE_COLOR = '#60a5fa' // blue-400

export default function PoolPriceChart({
  poolAddress,
  projectTokenAddress,
  chainId = '1',
  tokenSymbol = 'TOKEN',
  range: initialRange = '1y',
}: PoolPriceChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [range, setRange] = useState<TimeRange>(initialRange)
  const [data, setData] = useState<PoolPriceDataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      if (!poolAddress || !projectTokenAddress) {
        setError('Pool address and project token address required')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      try {
        const startTimestamp = getPoolRangeStartTimestamp(range)
        const useHourly = shouldUseHourlyData(range)

        const priceData = await fetchPoolPriceHistory(
          poolAddress,
          projectTokenAddress,
          parseInt(chainId),
          startTimestamp,
          useHourly
        )

        if (priceData.length === 0) {
          setError('No pool price data available')
        } else {
          setData(priceData)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load pool price data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [poolAddress, projectTokenAddress, chainId, range])

  // Get current price
  const currentPrice = data.length > 0 ? data[data.length - 1]?.price : undefined

  // Format price for display
  const formatPrice = (value: number) => {
    if (value >= 1) return value.toFixed(4)
    if (value >= 0.001) return value.toFixed(6)
    if (value >= 0.000001) return value.toFixed(8)
    return value.toExponential(2)
  }

  // Format Y axis
  const formatYAxis = (value: number) => {
    if (value >= 1) return value.toFixed(2)
    if (value >= 0.001) return value.toFixed(4)
    return value.toExponential(2)
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ value: number; payload: PoolPriceDataPoint }> }) => {
    if (!active || !payload?.length) return null

    const point = payload[0]?.payload
    if (!point?.timestamp) return null

    return (
      <div className={`px-3 py-2 border shadow-lg text-sm ${
        isDark
          ? 'bg-zinc-900 border-zinc-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}>
        <div className={`text-xs mb-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          {new Date(point.timestamp * 1000).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            ...(shouldUseHourlyData(range) ? { hour: '2-digit', minute: '2-digit' } : {}),
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: POOL_PRICE_COLOR }} />
          <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>Pool Price:</span>
          <span className="font-mono">{formatPrice(point.price)} ETH</span>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className={`border overflow-hidden ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className={`px-4 py-3 border-b flex items-center justify-between ${
          isDark ? 'border-white/10' : 'border-gray-100'
        }`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: POOL_PRICE_COLOR }} />
            <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Pool Price
            </span>
            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              (Uniswap)
            </span>
          </div>
          <div className="flex gap-1">
            {PRICE_RANGE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
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
        </div>

        {/* Chart */}
        <div className="px-2 py-3">
          {loading ? (
            <div className={`h-[200px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              Loading...
            </div>
          ) : error ? (
            <div className={`h-[200px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              {error}
            </div>
          ) : data.length === 0 ? (
            <div className={`h-[200px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              No pool price data available
            </div>
          ) : (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="timestamp"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={12}
                    tickFormatter={(v) => formatXAxis(v, range)}
                    minTickGap={50}
                    stroke={isDark ? '#666' : '#999'}
                    fontSize={11}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={formatYAxis}
                    width={60}
                    domain={['auto', 'auto']}
                    stroke={isDark ? '#666' : '#999'}
                    fontSize={11}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke={POOL_PRICE_COLOR}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Footer with current price */}
        {!loading && !error && currentPrice !== undefined && (
          <div className={`px-4 py-2 text-xs border-t ${
            isDark ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
          }`}>
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: POOL_PRICE_COLOR }} />
              Current: {formatPrice(currentPrice)} ETH / {tokenSymbol}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
