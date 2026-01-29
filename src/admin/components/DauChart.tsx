import { useState, useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useThemeStore } from '../../stores'
import { useDauData, type DauDataPoint } from '../hooks/useDauData'
import {
  TimeRange,
  CHART_COLORS,
} from '../../components/dynamic/charts/utils'

const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
]

interface DauChartProps {
  includeAnonymous?: boolean
  onToggleAnonymous?: (include: boolean) => void
}

function getRangeDays(range: TimeRange): number {
  switch (range) {
    case '7d': return 7
    case '30d': return 30
    case '90d': return 90
    default: return 90
  }
}

function filterToRange(data: DauDataPoint[], range: TimeRange): DauDataPoint[] {
  const days = getRangeDays(range)
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().split('T')[0]
  return data.filter(d => d.date >= cutoffStr)
}

function formatXAxis(dateStr: string, range: TimeRange): string {
  const date = new Date(dateStr + 'T00:00:00')
  if (range === '7d') {
    return date.toLocaleDateString('en-US', { weekday: 'short' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function DauChart({ includeAnonymous = false, onToggleAnonymous }: DauChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [range, setRange] = useState<TimeRange>('30d')

  const { data, isLoading, error } = useDauData(includeAnonymous)

  const filteredData = useMemo(() => {
    if (!data) return []
    return filterToRange(data, range)
  }, [data, range])

  // Calculate stats
  const stats = useMemo(() => {
    if (filteredData.length === 0) return { current: 0, average: 0, peak: 0 }
    const dauValues = filteredData.map(d => d.dau)
    return {
      current: dauValues[dauValues.length - 1] || 0,
      average: Math.round(dauValues.reduce((a, b) => a + b, 0) / dauValues.length),
      peak: Math.max(...dauValues),
    }
  }, [filteredData])

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null

    const point = payload[0].payload as DauDataPoint
    const date = new Date(point.date + 'T00:00:00')

    return (
      <div className={`px-3 py-2 border shadow-lg text-sm ${
        isDark
          ? 'bg-zinc-900 border-zinc-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}>
        <div className={`text-xs mb-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          {date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </div>
        <div className="font-mono font-medium">
          {point.dau.toLocaleString()} users
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className={`border overflow-hidden ${
        isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`px-4 py-3 border-b flex items-center justify-between ${
          isDark ? 'border-zinc-700' : 'border-gray-100'
        }`}>
          <div className="flex items-center gap-3">
            <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Daily Active Users
            </span>
            {onToggleAnonymous && (
              <label className={`flex items-center gap-1.5 text-xs cursor-pointer ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}>
                <input
                  type="checkbox"
                  checked={includeAnonymous}
                  onChange={(e) => onToggleAnonymous(e.target.checked)}
                  className="w-3 h-3 rounded"
                />
                Include anonymous
              </label>
            )}
          </div>
          <div className="flex gap-1">
            {RANGE_OPTIONS.map(opt => (
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
          {isLoading ? (
            <div className={`h-[200px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              Loading...
            </div>
          ) : error ? (
            <div className="h-[200px] flex items-center justify-center text-red-400">
              {error instanceof Error ? error.message : 'Failed to load data'}
            </div>
          ) : filteredData.length === 0 ? (
            <div className={`h-[200px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              No data available
            </div>
          ) : (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filteredData}>
                  <defs>
                    <linearGradient id="dauGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={isDark ? CHART_COLORS.grid : CHART_COLORS.gridLight}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => formatXAxis(d, range)}
                    stroke={isDark ? '#666' : '#999'}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke={isDark ? '#666' : '#999'}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="dau"
                    stroke={CHART_COLORS.primary}
                    fill="url(#dauGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Stats footer */}
        {!isLoading && !error && filteredData.length > 0 && (
          <div className={`px-4 py-2 text-xs border-t grid grid-cols-3 gap-4 ${
            isDark ? 'bg-white/5 border-zinc-700 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
          }`}>
            <div>
              <span className="block font-medium">Today</span>
              <span className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {stats.current.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="block font-medium">Average</span>
              <span className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {stats.average.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="block font-medium">Peak</span>
              <span className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {stats.peak.toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
