import { useState, useEffect, useMemo } from 'react'
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
  fetchConnectedChains,
} from '../../../services/bendystraw'
import { resolveEnsNames, truncateAddress } from '../../../utils/ens'
import { formatPercentage, PIE_COLORS, CHAIN_NAMES } from './utils'
import ChainToggleBar from './ChainToggleBar'

interface HoldersChartProps {
  projectId: string
  chainId?: string
  limit?: number
}

interface ChartDataPoint {
  name: string
  address: string
  ensName: string | null
  value: number
  balance: string
  chains: number[]
  [key: string]: string | number | number[] | null
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
  const [connectedChains, setConnectedChains] = useState<number[]>([])
  const [selectedChains, setSelectedChains] = useState<Set<number> | 'all'>('all')

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        // Fetch project info and connected chains in parallel
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

        // Fetch aggregated participants (with fallback to single-chain if no suckerGroup or query fails)
        const { participants } = await fetchAggregatedParticipants(
          suckerGroupId || '',
          limit,
          projectId,
          parseInt(chainId)
        )

        setTotalHolders(participants.length)

        if (participants.length === 0) {
          setError('No token holders found')
          return
        }

        // Resolve ENS names with rate limiting
        const ensNames = await resolveEnsNames(
          participants.map(p => p.address)
        )

        // Transform to chart data
        const chartData: ChartDataPoint[] = participants.map((p, i) => ({
          name: ensNames[i] || truncateAddress(p.address),
          address: p.address,
          ensName: ensNames[i],
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
            ensName: null,
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

  // Filter data by selected chains
  const filteredData = useMemo(() => {
    if (selectedChains === 'all') {
      return data
    }

    // Filter holders who have tokens on at least one selected chain
    const filtered = data.filter(d => {
      // Keep "Others" slice when filtering
      if (d.address === '') return true
      // Check if holder has tokens on any selected chain
      return d.chains.some(c => (selectedChains as Set<number>).has(c))
    })

    // Recalculate percentages for filtered data
    const holdersWithBalances = filtered.filter(d => d.address !== '')
    const totalBalance = holdersWithBalances.reduce((sum, d) => sum + parseFloat(d.balance), 0)

    if (totalBalance === 0) return filtered

    const recalculated = holdersWithBalances.map(d => ({
      ...d,
      value: (parseFloat(d.balance) / totalBalance) * 100,
    }))

    // Recalculate Others
    const totalPercentage = recalculated.reduce((sum, d) => sum + d.value, 0)
    if (totalPercentage < 99.9) {
      recalculated.push({
        name: 'Others',
        address: '',
        ensName: null,
        value: 100 - totalPercentage,
        balance: '...',
        chains: [],
      })
    }

    return recalculated
  }, [data, selectedChains])

  const handleChainToggle = (chainId: number) => {
    if (selectedChains === 'all') {
      // Switch from "all" to just this chain
      setSelectedChains(new Set([chainId]))
    } else {
      const newSelected = new Set(selectedChains)
      if (newSelected.has(chainId)) {
        newSelected.delete(chainId)
        // If none selected, go back to "all"
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
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null

    const item = payload[0].payload as ChartDataPoint

    return (
      <div className={`px-3 py-2 border shadow-lg text-sm ${
        isDark
          ? 'bg-zinc-900 border-zinc-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}>
        {item.address ? (
          <>
            {item.ensName && (
              <div className="font-medium mb-1">{item.ensName}</div>
            )}
            <div className="font-mono text-xs mb-1 opacity-70">{item.address}</div>
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
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 justify-center mt-4">
        {payload.slice(0, 5).map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-1.5 text-xs">
            <span
              className="w-2.5 h-2.5"
              style={{ backgroundColor: entry.color }}
            />
            <span className={`font-mono ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
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
    <div className="w-full">
      <div className={`max-w-md border overflow-hidden ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Token Holders
              </span>
            </div>
            {totalHolders > 0 && (
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Top {Math.min(limit, totalHolders)} holders
              </span>
            )}
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
        <div className="p-4">
          {loading ? (
            <div className={`h-[300px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              Loading...
            </div>
          ) : error ? (
            <div className={`h-[300px] flex items-center justify-center text-red-400`}>
              {error}
            </div>
          ) : filteredData.length === 0 ? (
            <div className={`h-[300px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              No holder data available
            </div>
          ) : (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={filteredData}
                    cx="50%"
                    cy="42%"
                    innerRadius="40%"
                    outerRadius="80%"
                    paddingAngle={1}
                    dataKey="value"
                    nameKey="name"
                    isAnimationActive={false}
                  >
                    {filteredData.map((_, index) => (
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
    </div>
  )
}
