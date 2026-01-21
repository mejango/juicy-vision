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
  fetchProjectSuckerGroupId,
  fetchSuckerGroupMoments,
  fetchSuckerGroupBalance,
  fetchCashOutTaxSnapshots,
  fetchPayEventsHistory,
  fetchCashOutEventsHistory,
  calculateFloorPrice,
  type SuckerGroupMoment,
  type CashOutTaxSnapshot,
} from '../../../services/bendystraw'
import {
  TimeRange,
  PRICE_RANGE_OPTIONS,
  formatXAxis,
  getRangeStartTimestamp,
} from './utils'

// Special ID for combined/aggregate line
const COMBINED_ID = -1

// Chain metadata for display (including combined)
const CHAIN_INFO: Record<number, { name: string; color: string; shortName: string }> = {
  [COMBINED_ID]: { name: 'Combined', color: '#F5A623', shortName: 'All' }, // juice-orange
  1: { name: 'Ethereum', color: '#627EEA', shortName: 'ETH' },
  10: { name: 'Optimism', color: '#FF0420', shortName: 'OP' },
  8453: { name: 'Base', color: '#0052FF', shortName: 'Base' },
  42161: { name: 'Arbitrum', color: '#28A0F0', shortName: 'ARB' },
}

interface MultiChainCashOutChartProps {
  projectId: string
  chainId?: string // Primary chain for lookup
  chains?: string // Comma-separated list of chain IDs to show, e.g., "1,10,8453,42161"
  range?: TimeRange
}

interface ChainDataPoint {
  timestamp: number
  [chainKey: string]: number | undefined // e.g., cashOut_1, cashOut_10, etc.
}

// Calculate cash out price at a specific timestamp using the formula
function calculateCashOutValue(
  balance: bigint,
  supply: bigint,
  taxRate: number,
  decimals: number
): number {
  return calculateFloorPrice(balance, supply, taxRate, decimals)
}

// Find the applicable tax rate for a given timestamp
function findApplicableTaxRate(timestamp: number, taxSnapshots: CashOutTaxSnapshot[]): number {
  const sorted = [...taxSnapshots].sort((a, b) => a.start - b.start)

  let applicableTax = 0
  for (const snapshot of sorted) {
    if (snapshot.start <= timestamp) {
      applicableTax = snapshot.cashOutTax
    } else {
      break
    }
  }

  return applicableTax
}

export default function MultiChainCashOutChart({
  projectId,
  chainId = '1',
  chains = '1,10,8453,42161',
  range: initialRange = '1y',
}: MultiChainCashOutChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [range, setRange] = useState<TimeRange>(initialRange)
  const [aggregatedMoments, setAggregatedMoments] = useState<SuckerGroupMoment[]>([])
  const [taxSnapshots, setTaxSnapshots] = useState<CashOutTaxSnapshot[]>([])
  const [perChainPayEvents, setPerChainPayEvents] = useState<Map<number, Array<{ timestamp: number; amount: string }>>>(new Map())
  const [perChainCashOutEvents, setPerChainCashOutEvents] = useState<Map<number, Array<{ timestamp: number; amount: string }>>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectStart, setProjectStart] = useState<number>(0)
  const [projectCurrency, setProjectCurrency] = useState<number>(1) // 1=ETH, 2=USD
  const [projectDecimals, setProjectDecimals] = useState<number>(18) // 18 for ETH, 6 for USDC

  // Parse chain IDs from prop
  const chainIds = useMemo(() => {
    return chains.split(',').map(c => parseInt(c.trim())).filter(c => !isNaN(c))
  }, [chains])

  // Toggle state for each chain's visibility (including combined)
  const [visibleChains, setVisibleChains] = useState<Set<number>>(() => new Set([COMBINED_ID, ...chainIds]))
  const [showCombined, setShowCombined] = useState(true)

  // Load data
  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        // Get sucker group ID from primary chain
        const suckerGroupId = await fetchProjectSuckerGroupId(projectId, parseInt(chainId))

        if (!suckerGroupId) {
          setError('Project not found or not part of a multi-chain group')
          setLoading(false)
          return
        }

        // Fetch aggregated moments, tax snapshots, and project balance (for currency/decimals)
        const [moments, taxes, balanceInfo] = await Promise.all([
          fetchSuckerGroupMoments(suckerGroupId),
          fetchCashOutTaxSnapshots(suckerGroupId),
          fetchSuckerGroupBalance(projectId, parseInt(chainId)),
        ])

        setAggregatedMoments(moments)
        setTaxSnapshots(taxes)
        setProjectCurrency(balanceInfo.currency)
        setProjectDecimals(balanceInfo.decimals)

        if (moments.length > 0) {
          setProjectStart(moments[0].timestamp)
        }

        // Fetch per-chain pay and cash out events to derive per-chain balances over time
        const payEventsMap = new Map<number, Array<{ timestamp: number; amount: string }>>()
        const cashOutEventsMap = new Map<number, Array<{ timestamp: number; amount: string }>>()

        await Promise.all(chainIds.map(async (cid) => {
          try {
            const [payEvents, cashOutEvents] = await Promise.all([
              fetchPayEventsHistory(projectId, cid),
              fetchCashOutEventsHistory(projectId, cid),
            ])

            payEventsMap.set(cid, payEvents.map(e => ({
              timestamp: e.timestamp,
              amount: e.amount
            })))
            cashOutEventsMap.set(cid, cashOutEvents.map(e => ({
              timestamp: e.timestamp,
              amount: e.reclaimAmount
            })))
          } catch (err) {
            console.warn(`Failed to fetch events for chain ${cid}:`, err)
            payEventsMap.set(cid, [])
            cashOutEventsMap.set(cid, [])
          }
        }))

        setPerChainPayEvents(payEventsMap)
        setPerChainCashOutEvents(cashOutEventsMap)

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [projectId, chainId, chainIds])

  // Compute per-chain cash out values over time
  // This reconstructs per-chain balances from pay/cashout events
  const chartData = useMemo(() => {
    if (aggregatedMoments.length === 0) return []

    const rangeStart = range === 'all' ? projectStart : Math.max(projectStart, getRangeStartTimestamp(range))
    const DAY_SECONDS = 86400

    // Build time series at daily granularity
    const dataByDay = new Map<number, ChainDataPoint>()
    const toDayBoundary = (ts: number) => Math.floor(ts / DAY_SECONDS) * DAY_SECONDS

    // For each chain, calculate running balance from events
    const chainBalances = new Map<number, Map<number, bigint>>() // chainId -> (dayTs -> balance)

    // Sort events by timestamp for each chain
    chainIds.forEach(cid => {
      const payEvents = perChainPayEvents.get(cid) || []
      const cashOutEvents = perChainCashOutEvents.get(cid) || []

      // Combine and sort all events
      const allEvents = [
        ...payEvents.map(e => ({ ...e, type: 'pay' as const })),
        ...cashOutEvents.map(e => ({ ...e, type: 'cashOut' as const })),
      ].sort((a, b) => a.timestamp - b.timestamp)

      // Build running balance
      let runningBalance = 0n
      const balanceByDay = new Map<number, bigint>()

      for (const event of allEvents) {
        const dayTs = toDayBoundary(event.timestamp)
        const amount = BigInt(event.amount || '0')

        if (event.type === 'pay') {
          runningBalance += amount
        } else {
          runningBalance -= amount
          if (runningBalance < 0n) runningBalance = 0n
        }

        balanceByDay.set(dayTs, runningBalance)
      }

      chainBalances.set(cid, balanceByDay)
    })

    // Get total supply from aggregated moments (same for all chains in a sucker group)
    // and calculate per-chain cash out values
    for (const moment of aggregatedMoments) {
      const dayTs = toDayBoundary(moment.timestamp)
      if (dayTs < rangeStart) continue

      const totalSupply = BigInt(moment.tokenSupply)
      const taxRate = findApplicableTaxRate(moment.timestamp, taxSnapshots)

      // Create data point for this day
      const point: ChainDataPoint = dataByDay.get(dayTs) || { timestamp: dayTs }

      // Calculate COMBINED cash out value from aggregated data
      const totalBalance = BigInt(moment.balance)
      if (totalSupply > 0n && totalBalance > 0n) {
        const combinedCashOut = calculateCashOutValue(totalBalance, totalSupply, taxRate, projectDecimals)
        if (combinedCashOut > 0) {
          point[`cashOut_${COMBINED_ID}`] = combinedCashOut
        }
      }

      // For each chain, calculate its cash out value based on its balance
      chainIds.forEach(cid => {
        const balanceByDay = chainBalances.get(cid)
        if (!balanceByDay) return

        // Find the closest balance on or before this day
        let chainBalance = 0n
        const sortedDays = Array.from(balanceByDay.keys()).sort((a, b) => a - b)
        for (const d of sortedDays) {
          if (d <= dayTs) {
            chainBalance = balanceByDay.get(d) || 0n
          } else {
            break
          }
        }

        // Calculate cash out value for this chain
        // Each chain has its own balance but shares the total supply and tax rate
        // This gives the cash out value per token IF all tokens were on this chain
        if (totalSupply > 0n && chainBalance > 0n) {
          const cashOutValue = calculateCashOutValue(chainBalance, totalSupply, taxRate, projectDecimals)
          if (cashOutValue > 0) {
            point[`cashOut_${cid}`] = cashOutValue
          }
        }
      })

      dataByDay.set(dayTs, point)
    }

    // Convert to sorted array and forward-fill missing values
    const sortedData = Array.from(dataByDay.values()).sort((a, b) => a.timestamp - b.timestamp)

    // Forward fill for each chain (including combined)
    const lastValues: Record<string, number> = {}
    const allIds = [COMBINED_ID, ...chainIds]
    for (const point of sortedData) {
      allIds.forEach(cid => {
        const key = `cashOut_${cid}`
        if (point[key] !== undefined) {
          lastValues[key] = point[key] as number
        } else if (lastValues[key] !== undefined) {
          point[key] = lastValues[key]
        }
      })
    }

    return sortedData
  }, [aggregatedMoments, taxSnapshots, perChainPayEvents, perChainCashOutEvents, chainIds, range, projectStart, projectDecimals])

  // Currency symbol for display (ETH or USDC)
  const currencySymbol = projectCurrency === 2 ? 'USDC' : 'ETH'

  // Check which chains have data (including combined)
  const chainsWithData = useMemo(() => {
    return chainIds.filter(cid =>
      chartData.some(d => d[`cashOut_${cid}`] !== undefined)
    )
  }, [chartData, chainIds])

  // Check if combined has data
  const hasCombinedData = useMemo(() => {
    return chartData.some(d => d[`cashOut_${COMBINED_ID}`] !== undefined)
  }, [chartData])

  // Format price for display
  const formatPrice = (value: number) => {
    if (value >= 1) return value.toFixed(4)
    if (value >= 0.001) return value.toFixed(6)
    if (value >= 0.000001) return value.toFixed(8)
    return value.toExponential(2)
  }

  // Format Y axis
  const formatYAxis = (value: number) => {
    if (value >= 1) return value.toFixed(2)
    if (value >= 0.001) return value.toFixed(4)
    return value.toExponential(2)
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string; payload: ChainDataPoint }> }) => {
    if (!active || !payload?.length) return null

    const data = payload[0]?.payload
    if (!data?.timestamp) return null

    return (
      <div className={`px-3 py-2 border shadow-lg text-sm ${
        isDark
          ? 'bg-zinc-900 border-zinc-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}>
        <div className={`text-xs mb-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          {new Date(data.timestamp * 1000).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </div>
        {/* Combined value first */}
        {(() => {
          const combinedValue = data[`cashOut_${COMBINED_ID}`]
          if (combinedValue === undefined || !showCombined) return null
          const info = CHAIN_INFO[COMBINED_ID]
          return (
            <div className="flex items-center gap-2 mb-1 pb-1 border-b border-zinc-700">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: info?.color || '#888' }} />
              <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>{info?.name}:</span>
              <span className="font-mono font-semibold">{formatPrice(combinedValue)} {currencySymbol}</span>
            </div>
          )
        })()}
        {chainIds.map(cid => {
          const value = data[`cashOut_${cid}`]
          if (value === undefined || !visibleChains.has(cid)) return null
          const info = CHAIN_INFO[cid]
          return (
            <div key={cid} className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: info?.color || '#888' }} />
              <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>{info?.name || `Chain ${cid}`}:</span>
              <span className="font-mono">{formatPrice(value)} {currencySymbol}</span>
            </div>
          )
        })}
      </div>
    )
  }

  // Toggle button for chains
  const ChainToggle = ({ chainId: cid }: { chainId: number }) => {
    const info = CHAIN_INFO[cid]
    const hasData = chainsWithData.includes(cid)
    const isVisible = visibleChains.has(cid)

    return (
      <button
        onClick={() => {
          const newVisible = new Set(visibleChains)
          if (isVisible) {
            newVisible.delete(cid)
          } else {
            newVisible.add(cid)
          }
          setVisibleChains(newVisible)
        }}
        disabled={!hasData}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-all
          ${!hasData ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
          ${isVisible && hasData
            ? isDark
              ? 'border-white/20 bg-white/5'
              : 'border-gray-300 bg-gray-50'
            : isDark
              ? 'border-white/10 hover:border-white/20'
              : 'border-gray-200 hover:border-gray-300'
          }
        `}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: isVisible && hasData ? info?.color : isDark ? '#666' : '#ccc' }}
        />
        <span className={isVisible && hasData ? (isDark ? 'text-white' : 'text-gray-900') : (isDark ? 'text-gray-500' : 'text-gray-400')}>
          {info?.name || `Chain ${cid}`}
        </span>
      </button>
    )
  }

  return (
    <div className="w-full">
      <div className={`border overflow-hidden ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header with chain toggles and range selector */}
        <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Combined toggle + chain toggles */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Combined toggle */}
              {hasCombinedData && (
                <button
                  onClick={() => setShowCombined(!showCombined)}
                  className={`
                    flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-all cursor-pointer
                    ${showCombined
                      ? isDark
                        ? 'border-juice-orange/40 bg-juice-orange/10'
                        : 'border-juice-orange/40 bg-juice-orange/10'
                      : isDark
                        ? 'border-white/10 hover:border-white/20'
                        : 'border-gray-200 hover:border-gray-300'
                    }
                  `}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: showCombined ? CHAIN_INFO[COMBINED_ID].color : isDark ? '#666' : '#ccc' }}
                  />
                  <span className={showCombined ? 'text-juice-orange' : (isDark ? 'text-gray-500' : 'text-gray-400')}>
                    Combined
                  </span>
                </button>
              )}
              {/* Per-chain toggles */}
              {chainIds.map(cid => (
                <ChainToggle key={cid} chainId={cid} />
              ))}
            </div>

            {/* Range selector */}
            <div className="flex gap-1">
              {PRICE_RANGE_OPTIONS.map(opt => (
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
        </div>

        {/* Chart */}
        <div className="px-2 py-3">
          {loading ? (
            <div className={`h-[250px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              Loading per-chain data...
            </div>
          ) : error ? (
            <div className="h-[250px] flex items-center justify-center text-red-400">
              {error}
            </div>
          ) : chartData.length === 0 || chainsWithData.length === 0 ? (
            <div className={`h-[250px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              No per-chain cash out data available
            </div>
          ) : (
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="timestamp"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={12}
                    tickFormatter={(v) => formatXAxis(v, range)}
                    minTickGap={50}
                    stroke={isDark ? '#666' : '#999'}
                    fontSize={11}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={formatYAxis}
                    width={60}
                    domain={['auto', 'auto']}
                    stroke={isDark ? '#666' : '#999'}
                    fontSize={11}
                  />
                  <Tooltip content={<CustomTooltip />} />

                  {/* Combined line (aggregate) */}
                  {hasCombinedData && showCombined && (
                    <Line
                      type="monotone"
                      dataKey={`cashOut_${COMBINED_ID}`}
                      stroke={CHAIN_INFO[COMBINED_ID].color}
                      strokeWidth={2.5}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                      name="Combined"
                    />
                  )}

                  {/* Lines for each chain */}
                  {chainIds.map(cid => {
                    const info = CHAIN_INFO[cid]
                    const hasData = chainsWithData.includes(cid)
                    const isVisible = visibleChains.has(cid)

                    if (!hasData || !isVisible) return null

                    return (
                      <Line
                        key={cid}
                        type="monotone"
                        dataKey={`cashOut_${cid}`}
                        stroke={info?.color || '#888'}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls={false}
                        name={info?.name || `Chain ${cid}`}
                      />
                    )
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Footer with current values */}
        {!loading && !error && chartData.length > 0 && chainsWithData.length > 0 && (
          <div className={`px-4 py-2 text-xs border-t flex flex-wrap gap-x-4 gap-y-1 ${
            isDark ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
          }`}>
            {/* Combined value first */}
            {hasCombinedData && showCombined && (() => {
              const lastPoint = chartData[chartData.length - 1]
              const value = lastPoint?.[`cashOut_${COMBINED_ID}`]
              if (value === undefined) return null
              return (
                <span className="flex items-center gap-2 font-medium">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHAIN_INFO[COMBINED_ID].color }} />
                  Combined: {formatPrice(value)} {currencySymbol}
                </span>
              )
            })()}
            {/* Per-chain values */}
            {chainIds.map(cid => {
              const lastPoint = chartData[chartData.length - 1]
              const value = lastPoint?.[`cashOut_${cid}`]
              const info = CHAIN_INFO[cid]

              if (value === undefined || !visibleChains.has(cid)) return null

              return (
                <span key={cid} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: info?.color || '#888' }} />
                  {info?.name || `Chain ${cid}`}: {formatPrice(value)} {currencySymbol}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
