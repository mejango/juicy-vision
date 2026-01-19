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
  fetchConnectedChains,
} from '../../../services/bendystraw'
import {
  TimeRange,
  RANGE_OPTIONS,
  formatXAxis,
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

// Aggregate pay events into daily buckets, filling all days in range
function aggregateByDay(
  events: Array<{ amount: string; timestamp: number }>,
  rangeStart: number,
  rangeEnd: number = Math.floor(Date.now() / 1000)
): DataPoint[] {
  // Create buckets for events
  const eventBuckets: Record<string, { volume: bigint; count: number }> = {}

  for (const event of events) {
    if (event.timestamp < rangeStart) continue

    const date = new Date(event.timestamp * 1000)
    const dayKey = date.toISOString().split('T')[0]

    if (!eventBuckets[dayKey]) {
      eventBuckets[dayKey] = { volume: 0n, count: 0 }
    }

    eventBuckets[dayKey].volume += BigInt(event.amount)
    eventBuckets[dayKey].count += 1
  }

  // Generate all days in the range for proper time-based positioning
  const result: DataPoint[] = []
  const startDate = new Date(rangeStart * 1000)
  startDate.setUTCHours(0, 0, 0, 0)
  const endDate = new Date(rangeEnd * 1000)
  endDate.setUTCHours(0, 0, 0, 0)

  const currentDate = new Date(startDate)
  while (currentDate <= endDate) {
    const dayKey = currentDate.toISOString().split('T')[0]
    const dayTimestamp = Math.floor(currentDate.getTime() / 1000)
    const bucket = eventBuckets[dayKey]

    result.push({
      timestamp: dayTimestamp,
      date: dayKey,
      volume: bucket ? Number(bucket.volume) / 1e18 : 0,
      count: bucket ? bucket.count : 0,
    })

    currentDate.setUTCDate(currentDate.getUTCDate() + 1)
  }

  return result
}

export default function VolumeChart({
  projectId,
  chainId = '1',
  range: initialRange = '1y',
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

        // Fetch connected chains (sucker group)
        const connectedChains = await fetchConnectedChains(projectId, parseInt(chainId))

        // If we have connected chains, fetch pay events from all of them
        const chainsToFetch = connectedChains.length > 0
          ? connectedChains
          : [{ projectId: parseInt(projectId), chainId: parseInt(chainId) }]

        // Fetch pay events from all chains in parallel
        const allEventsPromises = chainsToFetch.map(async (chain) => {
          try {
            const events = await fetchPayEventsHistory(
              String(chain.projectId),
              chain.chainId
            )
            return events.map(e => ({
              amount: e.amount,
              timestamp: e.timestamp,
              chainId: chain.chainId,
            }))
          } catch {
            return []
          }
        })

        const allEventsArrays = await Promise.all(allEventsPromises)
        const allEvents = allEventsArrays.flat()

        setRawEvents(allEvents.map(e => ({
          amount: e.amount,
          timestamp: e.timestamp,
        })))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load payment data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [projectId, chainId])

  // Aggregate data based on selected range
  const data = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const rangeStart = getRangeStartTimestamp(range)
    return aggregateByDay(rawEvents, rangeStart, now)
  }, [rawEvents, range])

  // Calculate totals
  const totals = useMemo(() => {
    const totalVolume = data.reduce((sum, d) => sum + d.volume, 0)
    const totalCount = data.reduce((sum, d) => sum + d.count, 0)
    return { volume: totalVolume, count: totalCount }
  }, [data])

  // Calculate Y domain for count
  const yDomain = calculateYDomain(data.map(d => d.count))

  // Format Y axis for counts (integers)
  const formatCountAxis = (value: number) => {
    if (value >= 1000) return `${(value / 1000).toFixed(0)}k`
    return String(Math.round(value))
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null

    const point = payload[0].payload as DataPoint
    const date = new Date(point.timestamp * 1000)

    return (
      <div className={`px-3 py-2 border shadow-lg text-sm ${
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
          {point.count} payment{point.count !== 1 ? 's' : ''}
        </div>
        {point.volume > 0 && (
          <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
            {point.volume.toFixed(4)} ETH
          </div>
        )}
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
          <div>
            <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Payments
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
          <div className={`h-[180px] flex items-center justify-center ${
            isDark ? 'text-gray-500' : 'text-gray-400'
          }`}>
            Loading...
          </div>
        ) : error ? (
          <div className={`h-[180px] flex items-center justify-center text-red-400`}>
            {error}
          </div>
        ) : data.length === 0 ? (
          <div className={`h-[180px] flex items-center justify-center ${
            isDark ? 'text-gray-500' : 'text-gray-400'
          }`}>
            No payment data for this range
          </div>
        ) : (
          <div className="h-[180px]">
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
                  tickFormatter={formatCountAxis}
                  stroke={isDark ? '#666' : '#999'}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={35}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} cursor={false} />
                <Bar
                  dataKey="count"
                  fill={CHART_COLORS.secondary}
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
              <span className="w-2 h-2" style={{ backgroundColor: CHART_COLORS.secondary }} />
              {totals.count} payment{totals.count !== 1 ? 's' : ''}
            </span>
            <span>
              {totals.volume.toFixed(4)} ETH total
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
