import { useState, useEffect } from 'react'
import { formatUnits } from 'viem'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
  type DefaultLegendContentProps,
  type TooltipContentProps,
} from 'recharts'
import { useThemeStore } from '../../../stores'
import {
  fetchMultiChainParticipants,
  fetchConnectedChains,
} from '../../../services/bendystraw'
import { resolveEnsNames, truncateAddress } from '../../../utils/ens'
import { formatPercentage, PIE_COLORS, CHAIN_NAMES } from './utils'

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

function formatProjectTokenBalance(balance: bigint): string {
  if (balance > 0n && balance < 1_000_000_000_000n) return '<0.000001'

  const [whole, fraction = ''] = formatUnits(balance, 18).split('.')
  const visibleFraction = fraction.slice(0, whole === '0' ? 6 : 4).replace(/0+$/, '')
  const formattedWhole = BigInt(whole).toLocaleString('en-US')
  return visibleFraction ? `${formattedWhole}.${visibleFraction}` : formattedWhole
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
  const [totalHolders, setTotalHolders] = useState<number>(0)
  const [showAllMembers, setShowAllMembers] = useState(false)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        const chains = await fetchConnectedChains(projectId, parseInt(chainId))

        const connectedChainsArray = chains.length > 0
          ? chains.map(c => ({ chainId: c.chainId, projectId: c.projectId }))
          : [{ chainId: parseInt(chainId), projectId: parseInt(projectId) }]

        const { participants } = await fetchMultiChainParticipants(
          connectedChainsArray,
          limit,
        )

        setTotalHolders(participants.length)

        if (participants.length === 0) {
          setError('No members yet')
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
          balance: formatProjectTokenBalance(p.balance),
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

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: TooltipContentProps<number, string>) => {
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
  const renderLegend = (props: DefaultLegendContentProps) => {
    const { payload } = props
    if (!payload) return null

    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 justify-center mt-4">
        {payload.slice(0, 5).map((entry, index) => (
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
                Showing {totalHolders} by ownership
              </span>
            )}
          </div>
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
          ) : data.length === 0 ? (
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
                    data={data}
                    cx="50%"
                    cy="42%"
                    innerRadius="40%"
                    outerRadius="80%"
                    paddingAngle={1}
                    dataKey="value"
                    nameKey="name"
                    isAnimationActive={false}
                  >
                    {data.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={CustomTooltip} />
                  <Legend content={renderLegend} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Members List */}
        {!loading && !error && data.length > 0 && (
          <div className={`px-4 pb-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
            <div className="pt-3 space-y-2">
              {data
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
                        {member.balance} tokens
                      </span>
                      <span className={`text-xs font-medium w-12 text-right ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {formatPercentage(member.value)}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
            {data.filter(d => d.address !== '').length > 5 && (
              <button
                onClick={() => setShowAllMembers(!showAllMembers)}
                className={`w-full mt-2 py-1.5 text-xs transition-colors ${
                  isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'
                }`}
              >
                {showAllMembers
                  ? 'Show less'
                  : `View ${data.filter(d => d.address !== '').length - 5} more`
                }
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
