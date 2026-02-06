import { useState, useEffect } from 'react'
import {
  AreaChart,
  Area,
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
} from './utils'

interface BalanceChartProps {
  projectId: string
  chainId?: string
  range?: TimeRange
}

interface DataPoint {
  timestamp: number
  balance: number
}

export default function BalanceChart({
  projectId,
  chainId = '1',
  range: initialRange = '30d',
}: BalanceChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [range, setRange] = useState<TimeRange>(initialRange)
  const [data, setData] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string>('')

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        // Fetch project to get suckerGroupId
        const project = await fetchProject(projectId, parseInt(chainId))
        if (project?.metadata) {
          const metadata = typeof project.metadata === 'string'
            ? JSON.parse(project.metadata)
            : project.metadata
          setProjectName(metadata?.name || '')
        }

        // Fetch the actual suckerGroupId from the project
        const suckerGroupId = await fetchProjectSuckerGroupId(projectId, parseInt(chainId))

        if (!suckerGroupId) {
          // Fallback: show current balance only
          const currentBalance = project?.balance ? parseFloat(project.balance) / 1e18 : 0
          setData([{
            timestamp: Math.floor(Date.now() / 1000),
            balance: currentBalance,
          }])
          return
        }

        const moments = await fetchSuckerGroupMoments(suckerGroupId, 1000, parseInt(chainId))

        if (moments.length === 0) {
          // Fallback: create a single point with current balance
          const currentBalance = project?.balance ? parseFloat(project.balance) / 1e18 : 0
          setData([{
            timestamp: Math.floor(Date.now() / 1000),
            balance: currentBalance,
          }])
        } else {
          // Transform moments to data points
          const points: DataPoint[] = moments.map(m => ({
            timestamp: m.timestamp,
            balance: parseFloat(m.balance) / 1e18,
          }))

          setData(points)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load balance data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [projectId, chainId])

  // Filter data to selected range
  const filteredData = filterToRange(data, range)

  // Calculate Y domain - always ground at 0 for balance charts
  const [, maxY] = calculateYDomain(filteredData.map(d => d.balance))
  const yDomain: [number, number] = [0, maxY]

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
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </div>
        <div className="font-mono font-medium">
          {formatEthValue(point.balance)}
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
          <div>
            <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Balance
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
        ) : filteredData.length === 0 ? (
          <div className={`h-[180px] flex items-center justify-center ${
            isDark ? 'text-gray-500' : 'text-gray-400'
          }`}>
            No data available for this range
          </div>
        ) : (
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={filteredData}>
                <defs>
                  <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
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
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke={CHART_COLORS.primary}
                  fill="url(#balanceGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

        {/* Footer with current value */}
        {!loading && !error && filteredData.length > 0 && (
          <div className={`px-4 py-2 text-xs border-t ${
            isDark ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
          }`}>
            <span className="flex items-center gap-2">
              <span className="w-2 h-2" style={{ backgroundColor: CHART_COLORS.primary }} />
              Current: {formatEthValue(filteredData[filteredData.length - 1]?.balance || 0)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
