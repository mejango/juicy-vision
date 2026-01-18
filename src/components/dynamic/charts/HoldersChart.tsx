import { useState, useEffect } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { useThemeStore } from '../../../stores'
import {
  fetchAggregatedParticipants,
  fetchProject,
  fetchProjectSuckerGroupId,
  type AggregatedParticipant,
} from '../../../services/bendystraw'
import { shortenAddress, formatPercentage, PIE_COLORS } from './utils'

interface HoldersChartProps {
  projectId: string
  chainId?: string
  limit?: number
}

interface ChartDataPoint {
  name: string
  address: string
  value: number
  balance: string
  chains: number[]
}

// Chain name mapping
const CHAIN_NAMES: Record<number, string> = {
  1: 'ETH',
  10: 'OP',
  8453: 'Base',
  42161: 'Arb',
}

export default function HoldersChart({
  projectId,
  chainId = '1',
  limit = 10,
}: HoldersChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [data, setData] = useState<ChartDataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const [totalHolders, setTotalHolders] = useState<number>(0)

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

        // Fetch the actual suckerGroupId from the project
        const suckerGroupId = await fetchProjectSuckerGroupId(projectId, parseInt(chainId))

        if (!suckerGroupId) {
          setError('No multi-chain data available')
          return
        }

        // Fetch aggregated participants
        const { participants, totalSupply } = await fetchAggregatedParticipants(suckerGroupId, limit)

        setTotalHolders(participants.length)

        if (participants.length === 0) {
          setError('No token holders found')
          return
        }

        // Transform to chart data
        const chartData: ChartDataPoint[] = participants.map((p) => ({
          name: shortenAddress(p.address),
          address: p.address,
          value: p.percentage,
          balance: (Number(p.balance) / 1e18).toFixed(2),
          chains: p.chains,
        }))

        // If there are more holders, add "Others" slice
        const totalPercentage = chartData.reduce((sum, d) => sum + d.value, 0)
        if (totalPercentage < 99.9) {
          chartData.push({
            name: 'Others',
            address: '',
            value: 100 - totalPercentage,
            balance: '...',
            chains: [],
          })
        }

        setData(chartData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load holder data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [projectId, chainId, limit])

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null

    const item = payload[0].payload as ChartDataPoint

    return (
      <div className={`px-3 py-2 rounded-lg border shadow-lg text-sm ${
        isDark
          ? 'bg-zinc-900 border-zinc-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}>
        {item.address ? (
          <>
            <div className="font-mono text-xs mb-1">{item.address}</div>
            <div className="flex items-center gap-2">
              <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>
                {item.balance} tokens
              </span>
              <span className="font-medium">
                ({formatPercentage(item.value)})
              </span>
            </div>
            {item.chains.length > 0 && (
              <div className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
                Chains: {item.chains.map(c => CHAIN_NAMES[c] || c).join(', ')}
              </div>
            )}
          </>
        ) : (
          <div>
            <span className="font-medium">Others</span>
            <span className={`ml-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
              ({formatPercentage(item.value)})
            </span>
          </div>
        )}
      </div>
    )
  }

  // Custom legend
  const renderLegend = (props: any) => {
    const { payload } = props
    if (!payload) return null

    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-2">
        {payload.slice(0, 5).map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-1.5 text-xs">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>
              {entry.value}
            </span>
          </div>
        ))}
        {payload.length > 5 && (
          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            +{payload.length - 5} more
          </span>
        )}
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
            Token Holders
          </span>
          {projectName && (
            <span className={`ml-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {projectName}
            </span>
          )}
        </div>
        {totalHolders > 0 && (
          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Top {Math.min(limit, totalHolders)} holders
          </span>
        )}
      </div>

      {/* Chart */}
      <div className="p-4">
        {loading ? (
          <div className={`h-[220px] flex items-center justify-center ${
            isDark ? 'text-gray-500' : 'text-gray-400'
          }`}>
            Loading...
          </div>
        ) : error ? (
          <div className={`h-[220px] flex items-center justify-center text-red-400`}>
            {error}
          </div>
        ) : data.length === 0 ? (
          <div className={`h-[220px] flex items-center justify-center ${
            isDark ? 'text-gray-500' : 'text-gray-400'
          }`}>
            No holder data available
          </div>
        ) : (
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="45%"
                  innerRadius="45%"
                  outerRadius="75%"
                  paddingAngle={1}
                  dataKey="value"
                  nameKey="name"
                >
                  {data.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend content={renderLegend} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
