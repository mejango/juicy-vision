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
  getChainColor,
  getChainName,
} from './utils'
import ChainToggleBar from './ChainToggleBar'

interface VolumeChartProps {
  projectId: string
  chainId?: string
  range?: TimeRange
}

interface RawEvent {
  amount: string
  timestamp: number
  chainId: number
}

interface DataPoint {
  timestamp: number
  date: string
  volume: number
  count: number
  [key: string]: number | string // count_<chainId>, volume_<chainId> for per-chain values
}

// Aggregate pay events into daily buckets, filling all days in range
function aggregateByDay(
  events: RawEvent[],
  rangeStart: number,
  rangeEnd: number,
  perChain: boolean
): DataPoint[] {
  // Create buckets for events
  const eventBuckets: Record<string, { volume: bigint; count: number; perChain: Record<number, { volume: bigint; count: number }> }> = {}

  for (const event of events) {
    if (event.timestamp < rangeStart) continue

    const date = new Date(event.timestamp * 1000)
    const dayKey = date.toISOString().split('T')[0]

    if (!eventBuckets[dayKey]) {
      eventBuckets[dayKey] = { volume: 0n, count: 0, perChain: {} }
    }

    eventBuckets[dayKey].volume += BigInt(event.amount)
    eventBuckets[dayKey].count += 1

    if (perChain) {
      if (!eventBuckets[dayKey].perChain[event.chainId]) {
        eventBuckets[dayKey].perChain[event.chainId] = { volume: 0n, count: 0 }
      }
      eventBuckets[dayKey].perChain[event.chainId].volume += BigInt(event.amount)
      eventBuckets[dayKey].perChain[event.chainId].count += 1
    }
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

    const point: DataPoint = {
      timestamp: dayTimestamp,
      date: dayKey,
      volume: bucket ? Number(bucket.volume) / 1e18 : 0,
      count: bucket ? bucket.count : 0,
    }

    // Add per-chain data if available
    if (bucket?.perChain) {
      for (const [chainIdStr, chainData] of Object.entries(bucket.perChain)) {
        const chainId = parseInt(chainIdStr)
        point[`count_${chainId}`] = chainData.count
        point[`volume_${chainId}`] = Number(chainData.volume) / 1e18
      }
    }

    result.push(point)
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
  const [rawEvents, setRawEvents] = useState<RawEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const [connectedChains, setConnectedChains] = useState<number[]>([])
  const [selectedChains, setSelectedChains] = useState<Set<number> | 'all'>('all')
  const [showBreakdown, setShowBreakdown] = useState(false)

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
        const chains = await fetchConnectedChains(projectId, parseInt(chainId))

        // Extract unique chain IDs
        const chainIds = chains.length > 0
          ? [...new Set(chains.map(c => c.chainId))]
          : [parseInt(chainId)]
        setConnectedChains(chainIds)

        // If we have connected chains, fetch pay events from all of them
        const chainsToFetch = chains.length > 0
          ? chains
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

        setRawEvents(allEvents)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load payment data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [projectId, chainId])

  // Aggregate data based on selected range and chains
  const data = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const rangeStart = getRangeStartTimestamp(range)

    // If specific chains are selected, filter events
    let eventsToAggregate = rawEvents
    if (selectedChains !== 'all') {
      eventsToAggregate = rawEvents.filter(e => (selectedChains as Set<number>).has(e.chainId))
    }

    return aggregateByDay(eventsToAggregate, rangeStart, now, selectedChains !== 'all')
  }, [rawEvents, range, selectedChains])

  // Calculate totals
  const totals = useMemo(() => {
    if (selectedChains === 'all') {
      const totalVolume = data.reduce((sum, d) => sum + d.volume, 0)
      const totalCount = data.reduce((sum, d) => sum + d.count, 0)
      return { volume: totalVolume, count: totalCount, perChain: {} as Record<number, { volume: number; count: number }> }
    }

    const perChain: Record<number, { volume: number; count: number }> = {}
    let totalVolume = 0
    let totalCount = 0

    Array.from(selectedChains as Set<number>).forEach(cid => {
      const chainVolume = data.reduce((sum, d) => sum + ((d[`volume_${cid}`] as number) || 0), 0)
      const chainCount = data.reduce((sum, d) => sum + ((d[`count_${cid}`] as number) || 0), 0)
      perChain[cid] = { volume: chainVolume, count: chainCount }
      totalVolume += chainVolume
      totalCount += chainCount
    })

    return { volume: totalVolume, count: totalCount, perChain }
  }, [data, selectedChains])

  // Calculate Y domain for count
  const yDomain = useMemo(() => {
    if (selectedChains === 'all') {
      return calculateYDomain(data.map(d => d.count))
    }

    // For stacked bars, calculate max total height
    const maxTotal = Math.max(...data.map(d => {
      let total = 0
      Array.from(selectedChains as Set<number>).forEach(cid => {
        total += (d[`count_${cid}`] as number) || 0
      })
      return total
    }))

    return calculateYDomain([0, maxTotal])
  }, [data, selectedChains])

  // Format Y axis for counts (integers)
  const formatCountAxis = (value: number) => {
    if (value >= 1000) return `${(value / 1000).toFixed(0)}k`
    return String(Math.round(value))
  }

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

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; fill: string; payload: DataPoint }> }) => {
    if (!active || !payload?.length) return null

    const point = payload[0].payload
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
        {selectedChains === 'all' ? (
          <>
            <div className="font-mono font-medium">
              {point.count} payment{point.count !== 1 ? 's' : ''}
            </div>
            {point.volume > 0 && (
              <div className={`text-xs ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
                {point.volume.toFixed(4)} ETH
              </div>
            )}
          </>
        ) : (
          <>
            {Array.from(selectedChains as Set<number>).map(cid => {
              const count = (point[`count_${cid}`] as number) || 0
              const volume = (point[`volume_${cid}`] as number) || 0
              if (count === 0) return null
              return (
                <div key={cid} className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getChainColor(cid) }} />
                  <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>{getChainName(cid)}:</span>
                  <span className="font-mono">{count} ({volume.toFixed(4)} ETH)</span>
                </div>
              )
            })}
          </>
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
        <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Payments
              </span>
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
          {connectedChains.length > 1 && (
            <div>
              <button
                onClick={() => setShowBreakdown(!showBreakdown)}
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
                    availableChains={connectedChains}
                    selectedChains={selectedChains}
                    onToggle={handleChainToggle}
                    onSelectAll={handleSelectAll}
                  />
                </div>
              )}
            </div>
          )}
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

                  {selectedChains === 'all' ? (
                    <Bar
                      dataKey="count"
                      fill={CHART_COLORS.secondary}
                      isAnimationActive={false}
                    />
                  ) : (
                    Array.from(selectedChains as Set<number>).map(cid => (
                      <Bar
                        key={cid}
                        dataKey={`count_${cid}`}
                        stackId="a"
                        fill={getChainColor(cid)}
                        isAnimationActive={false}
                      />
                    ))
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Footer with totals */}
        {!loading && !error && data.length > 0 && (
          <div className={`px-4 py-2 text-xs border-t flex flex-wrap gap-x-4 gap-y-1 ${
            isDark ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
          }`}>
            {selectedChains === 'all' ? (
              <>
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2" style={{ backgroundColor: CHART_COLORS.secondary }} />
                  {totals.count} payment{totals.count !== 1 ? 's' : ''}
                </span>
                <span>
                  {totals.volume.toFixed(4)} ETH total
                </span>
              </>
            ) : (
              <>
                {Array.from(selectedChains as Set<number>).map(cid => {
                  const chainTotals = totals.perChain[cid]
                  if (!chainTotals) return null
                  return (
                    <span key={cid} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getChainColor(cid) }} />
                      {getChainName(cid)}: {chainTotals.count} ({chainTotals.volume.toFixed(4)} ETH)
                    </span>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
