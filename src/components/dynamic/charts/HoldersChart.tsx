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
  fetchMultiChainParticipants,
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
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [showAllMembers, setShowAllMembers] = useState(false)

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

        // Build the connected chains array for multi-chain fetch
        // If we have connected chains from suckerGroup, use those; otherwise use current chain
        const connectedChainsArray = chains.length > 0
          ? chains.map(c => ({ chainId: c.chainId, projectId: c.projectId }))
          : [{ chainId: parseInt(chainId), projectId: parseInt(projectId) }]

        // Fetch the suckerGroupId for accurate total supply calculation
        const suckerGroupId = await fetchProjectSuckerGroupId(projectId, parseInt(chainId))
        console.log('[HoldersChart] suckerGroupId:', suckerGroupId, 'connectedChains:', connectedChainsArray.length)

        // Fetch participants from all connected chains and aggregate them
        const { participants, totalSupply } = await fetchMultiChainParticipants(
          connectedChainsArray,
          limit,
          suckerGroupId || undefined
        )
        console.log('[HoldersChart] participants:', participants.length, 'totalSupply:', totalSupply.toString())
        if (participants.length > 0) {
          console.log('[HoldersChart] top participant:', participants[0])
        }

        setTotalHolders(participants.length)

        if (participants.length === 0) {
          setError('No members found')
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
        setError(err instanceof Error ? err.message : 'Failed to load member data')
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
                Top Members
              </span>
            </div>
            {totalHolders > 0 && (
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Top {Math.min(limit, totalHolders)} by ownership
              </span>
            )}
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
              No member data available
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

        {/* Members List */}
        {!loading && !error && filteredData.length > 0 && (
          <div className={`px-4 pb-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
            <div className="pt-3 space-y-2">
              {filteredData
                .filter(d => d.address !== '') // Exclude "Others"
                .slice(0, showAllMembers ? undefined : 5)
                .map((member, index) => (
                  <div
                    key={member.address}
                    className={`flex items-center justify-between py-1.5 ${
                      index > 0 ? `border-t ${isDark ? 'border-white/5' : 'border-gray-50'}` : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 flex-shrink-0"
                        style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                      />
                      <span className={`text-xs font-mono truncate ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        {member.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {parseFloat(member.balance).toLocaleString()} tokens
                      </span>
                      <span className={`text-xs font-medium w-12 text-right ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {formatPercentage(member.value)}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
            {filteredData.filter(d => d.address !== '').length > 5 && (
              <button
                onClick={() => setShowAllMembers(!showAllMembers)}
                className={`w-full mt-2 py-1.5 text-xs transition-colors ${
                  isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'
                }`}
              >
                {showAllMembers
                  ? 'Show less'
                  : `View ${filteredData.filter(d => d.address !== '').length - 5} more`
                }
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
