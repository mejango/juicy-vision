import { useState, useEffect, useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useThemeStore } from '../../../stores'
import {
  fetchPayEventsHistory,
  fetchProject,
} from '../../../services/bendystraw'
import {
  TimeRange,
  RANGE_OPTIONS,
  formatXAxis,
  formatYAxis,
  formatEthValue,
  getRangeStartTimestamp,
  calculateYDomain,
  CHART_COLORS,
} from './utils'

interface VolumeChartProps {
  projectId: string
  chainId?: string
  range?: TimeRange
}

interface DataPoint {
  timestamp: number
  date: string
  volume: number
  count: number
}

// Aggregate pay events into daily buckets
function aggregateByDay(
  events: Array<{ amount: string; timestamp: number }>,
  rangeStart: number
): DataPoint[] {
  const buckets: Record<string, { volume: bigint; count: number; timestamp: number }> = {}

  for (const event of events) {
    if (event.timestamp < rangeStart) continue

    const date = new Date(event.timestamp * 1000)
    const dayKey = date.toISOString().split('T')[0]
    const dayTimestamp = Math.floor(new Date(dayKey).getTime() / 1000)

    if (!buckets[dayKey]) {
      buckets[dayKey] = { volume: 0n, count: 0, timestamp: dayTimestamp }
    }

    buckets[dayKey].volume += BigInt(event.amount)
    buckets[dayKey].count += 1
  }

  return Object.entries(buckets)
    .map(([date, data]) => ({
      timestamp: data.timestamp,
      date,
      volume: Number(data.volume) / 1e18,
      count: data.count,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

export default function VolumeChart({
  projectId,
  chainId = '1',
  range: initialRange = '30d',
}: VolumeChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [range, setRange] = useState<TimeRange>(initialRange)
  const [rawEvents, setRawEvents] = useState<Array<{ amount: string; timestamp: number }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string>('')

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        // Fetch project info
        const project = await fetchProject(projectId, parseInt(chainId))
        if (project?.metadata) {
          const metadata = typeof project.metadata === 'string'
            ? JSON.parse(project.metadata)
            : project.metadata
          setProjectName(metadata?.name || '')
        }

        // Fetch pay events
        const events = await fetchPayEventsHistory(projectId, parseInt(chainId))

        setRawEvents(events.map(e => ({
          amount: e.amount,
          timestamp: e.timestamp,
        })))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load volume data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [projectId, chainId])

  // Aggregate data based on selected range
  const data = useMemo(() => {
    const rangeStart = getRangeStartTimestamp(range)
    return aggregateByDay(rawEvents, rangeStart)
  }, [rawEvents, range])

  // Calculate totals
  const totals = useMemo(() => {
    const totalVolume = data.reduce((sum, d) => sum + d.volume, 0)
    const totalCount = data.reduce((sum, d) => sum + d.count, 0)
    return { volume: totalVolume, count: totalCount }
  }, [data])

  // Calculate Y domain
  const yDomain = calculateYDomain(data.map(d => d.volume))

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null

    const point = payload[0].payload as DataPoint
    const date = new Date(point.timestamp * 1000)

    return (
      <div className={`px-3 py-2 rounded-lg border shadow-lg text-sm ${
        isDark
          ? 'bg-zinc-900 border-zinc-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}>
        <div className={`text-xs mb-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          {date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          })}
        </div>
        <div className="font-mono font-medium">
          {formatEthValue(point.volume)}
        </div>
        <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
          {point.count} payment{point.count !== 1 ? 's' : ''}
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between ${
        isDark ? 'border-white/10' : 'border-gray-100'
      }`}>
        <div>
          <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Payment Volume
          </span>
          {projectName && (
            <span className={`ml-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {projectName}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
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
          <div className={`h-[200px] flex items-center justify-center ${
            isDark ? 'text-gray-500' : 'text-gray-400'
          }`}>
            Loading...
          </div>
        ) : error ? (
          <div className={`h-[200px] flex items-center justify-center text-red-400`}>
            {error}
          </div>
        ) : data.length === 0 ? (
          <div className={`h-[200px] flex items-center justify-center ${
            isDark ? 'text-gray-500' : 'text-gray-400'
          }`}>
            No payment data for this range
          </div>
        ) : (
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={isDark ? CHART_COLORS.grid : CHART_COLORS.gridLight}
                  vertical={false}
                />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(ts) => formatXAxis(ts, range)}
                  stroke={isDark ? '#666' : '#999'}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={yDomain}
                  tickFormatter={formatYAxis}
                  stroke={isDark ? '#666' : '#999'}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={50}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar
                  dataKey="volume"
                  fill={CHART_COLORS.secondary}
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Footer with totals */}
      {!loading && !error && data.length > 0 && (
        <div className={`px-4 py-2 text-xs border-t flex gap-4 ${
          isDark ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
        }`}>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS.secondary }} />
            Total: {formatEthValue(totals.volume)}
          </span>
          <span>
            {totals.count} payment{totals.count !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
