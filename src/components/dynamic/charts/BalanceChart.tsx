import { useState, useEffect, useMemo } from 'react'
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
  fetchSuckerGroupMoments,
  fetchProject,
  fetchProjectSuckerGroupId,
  fetchConnectedChains,
  fetchProjectMoments,
  type ProjectMoment,
} from '../../../services/bendystraw'
import {
  TimeRange,
  RANGE_OPTIONS,
  formatXAxis,
  formatYAxis,
  formatEthValue,
  filterToRange,
  calculateYDomain,
  CHART_COLORS,
  getChainColor,
  getChainName,
} from './utils'
import ChainToggleBar from './ChainToggleBar'

interface BalanceChartProps {
  projectId: string
  chainId?: string
  range?: TimeRange
}

interface DataPoint {
  timestamp: number
  balance: number
  [key: string]: number // balance_<chainId> for per-chain values
}

export default function BalanceChart({
  projectId,
  chainId = '1',
  range: initialRange = '30d',
}: BalanceChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [range, setRange] = useState<TimeRange>(initialRange)
  const [aggregatedData, setAggregatedData] = useState<DataPoint[]>([])
  const [perChainData, setPerChainData] = useState<Map<number, DataPoint[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const [connectedChains, setConnectedChains] = useState<number[]>([])
  const [selectedChains, setSelectedChains] = useState<Set<number> | 'all'>('all')

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        // Fetch project, connected chains, and suckerGroupId in parallel
        const [project, chains] = await Promise.all([
          fetchProject(projectId, parseInt(chainId)),
          fetchConnectedChains(projectId, parseInt(chainId)),
        ])

        if (project?.metadata) {
          const metadata = typeof project.metadata === 'string'
            ? JSON.parse(project.metadata)
            : project.metadata
          setProjectName(metadata?.name || '')
        }

        // Extract unique chain IDs from connected chains
        const chainIds = chains.length > 0
          ? [...new Set(chains.map(c => c.chainId))]
          : [parseInt(chainId)]
        setConnectedChains(chainIds)

        // Fetch the actual suckerGroupId from the project
        const suckerGroupId = await fetchProjectSuckerGroupId(projectId, parseInt(chainId))

        // Fetch aggregated moments
        let aggregatedMoments: DataPoint[] = []
        if (suckerGroupId) {
          const moments = await fetchSuckerGroupMoments(suckerGroupId, 1000, parseInt(chainId))
          aggregatedMoments = moments.map(m => ({
            timestamp: m.timestamp,
            balance: parseFloat(m.balance) / 1e18,
          }))
        }

        if (aggregatedMoments.length === 0) {
          // Fallback: create a single point with current balance
          const currentBalance = project?.balance ? parseFloat(project.balance) / 1e18 : 0
          aggregatedMoments = [{
            timestamp: Math.floor(Date.now() / 1000),
            balance: currentBalance,
          }]
        }

        setAggregatedData(aggregatedMoments)

        // Fetch per-chain moments if we have multiple chains
        if (chainIds.length > 1) {
          const perChainMap = new Map<number, DataPoint[]>()

          await Promise.all(chainIds.map(async (cid) => {
            try {
              // Get the projectId for this chain from connected chains
              const chainInfo = chains.find(c => c.chainId === cid)
              const chainProjectId = chainInfo?.projectId?.toString() || projectId

              const moments = await fetchProjectMoments(chainProjectId, cid)
              const points: DataPoint[] = moments.map((m: ProjectMoment) => ({
                timestamp: m.timestamp,
                balance: parseFloat(m.balance) / 1e18,
              }))
              perChainMap.set(cid, points)
            } catch (err) {
              console.warn(`Failed to fetch moments for chain ${cid}:`, err)
              perChainMap.set(cid, [])
            }
          }))

          setPerChainData(perChainMap)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load balance data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [projectId, chainId])

  // Build chart data based on selection
  const chartData = useMemo(() => {
    let data: DataPoint[]

    if (selectedChains === 'all') {
      // Show aggregated data
      data = filterToRange(aggregatedData, range)
    } else {
      // Build merged per-chain data
      const selectedChainIds = Array.from(selectedChains as Set<number>)
      const allTimestamps = new Set<number>()

      selectedChainIds.forEach(cid => {
        const chainData = perChainData.get(cid) || []
        chainData.forEach(d => allTimestamps.add(d.timestamp))
      })

      const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b)

      // Create merged data points
      const merged: DataPoint[] = sortedTimestamps.map(ts => {
        const point: DataPoint = { timestamp: ts, balance: 0 }

        selectedChainIds.forEach(cid => {
          const chainData = perChainData.get(cid) || []
          // Find the closest balance at or before this timestamp
          let balance = 0
          for (const d of chainData) {
            if (d.timestamp <= ts) {
              balance = d.balance
            } else {
              break
            }
          }
          point[`balance_${cid}`] = balance
          point.balance += balance // Sum for total
        })

        return point
      })

      data = filterToRange(merged, range)
    }

    // If only one data point, duplicate it to draw a horizontal line
    if (data.length === 1) {
      const point = data[0]
      const now = Math.floor(Date.now() / 1000)
      // Create a point at the start of the range and one at end
      const rangeSeconds: Record<TimeRange, number> = {
        '7d': 7 * 24 * 60 * 60,
        '30d': 30 * 24 * 60 * 60,
        '90d': 90 * 24 * 60 * 60,
        '3m': 90 * 24 * 60 * 60,
        '1y': 365 * 24 * 60 * 60,
        'all': 365 * 24 * 60 * 60,
      }
      const rangeStart = now - rangeSeconds[range]
      return [
        { ...point, timestamp: rangeStart },
        { ...point, timestamp: now },
      ]
    }

    return data
  }, [aggregatedData, perChainData, selectedChains, range])

  // Calculate Y domain - always ground at 0 for balance charts
  const yDomain = useMemo((): [number, number] => {
    if (chartData.length === 0) return [0, 1]

    let maxValue = 0

    if (selectedChains === 'all') {
      maxValue = Math.max(...chartData.map(d => d.balance))
    } else {
      const selectedChainIds = Array.from(selectedChains as Set<number>)
      chartData.forEach(d => {
        selectedChainIds.forEach(cid => {
          const val = d[`balance_${cid}`] || 0
          if (val > maxValue) maxValue = val
        })
      })
    }

    const [, maxY] = calculateYDomain([0, maxValue])
    return [0, maxY]
  }, [chartData, selectedChains])

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
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string; payload: DataPoint }> }) => {
    if (!active || !payload?.length) return null

    const data = payload[0]?.payload
    if (!data?.timestamp) return null

    const date = new Date(data.timestamp * 1000)

    return (
      <div className={`px-3 py-2 border shadow-lg text-sm ${
        isDark
          ? 'bg-zinc-900 border-zinc-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}>
        <div className={`text-xs mb-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          {date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </div>
        {selectedChains === 'all' ? (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS.primary }} />
            <span className="font-mono font-medium">{formatEthValue(data.balance)}</span>
          </div>
        ) : (
          Array.from(selectedChains as Set<number>).map(cid => {
            const value = data[`balance_${cid}`]
            if (value === undefined) return null
            return (
              <div key={cid} className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getChainColor(cid) }} />
                <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>{getChainName(cid)}:</span>
                <span className="font-mono">{formatEthValue(value)}</span>
              </div>
            )
          })
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
                Balance
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
            <ChainToggleBar
              availableChains={connectedChains}
              selectedChains={selectedChains}
              onToggle={handleChainToggle}
              onSelectAll={handleSelectAll}
            />
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
          ) : chartData.length === 0 ? (
            <div className={`h-[180px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              No data available for this range
            </div>
          ) : (
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
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

                  {selectedChains === 'all' ? (
                    <Line
                      type="monotone"
                      dataKey="balance"
                      stroke={CHART_COLORS.primary}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ) : (
                    Array.from(selectedChains as Set<number>).map(cid => (
                      <Line
                        key={cid}
                        type="monotone"
                        dataKey={`balance_${cid}`}
                        stroke={getChainColor(cid)}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                    ))
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Footer with current value(s) */}
        {!loading && !error && chartData.length > 0 && (
          <div className={`px-4 py-2 text-xs border-t flex flex-wrap gap-x-4 gap-y-1 ${
            isDark ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
          }`}>
            {selectedChains === 'all' ? (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2" style={{ backgroundColor: CHART_COLORS.primary }} />
                Current: {formatEthValue(chartData[chartData.length - 1]?.balance || 0)}
              </span>
            ) : (
              Array.from(selectedChains as Set<number>).map(cid => {
                const lastPoint = chartData[chartData.length - 1]
                const value = lastPoint?.[`balance_${cid}`] || 0
                return (
                  <span key={cid} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getChainColor(cid) }} />
                    {getChainName(cid)}: {formatEthValue(value)}
                  </span>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
