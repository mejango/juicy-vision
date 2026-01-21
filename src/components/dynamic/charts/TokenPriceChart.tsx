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
import { useThemeStore, useSettingsStore, DEFAULT_THEGRAPH_API_KEY } from '../../../stores'
import {
  fetchProjectWithRuleset,
  fetchProjectTokenSymbol,
  fetchProjectTokenAddress,
  fetchProjectTokenSupply,
  fetchAllRulesets,
  fetchProjectSuckerGroupId,
  fetchSuckerGroupMoments,
  fetchCashOutTaxSnapshots,
  calculateFloorPrice,
  type SimpleRuleset,
  type SuckerGroupMoment,
  type CashOutTaxSnapshot,
} from '../../../services/bendystraw'
import {
  fetchPoolPriceHistory,
  shouldUseHourlyData,
  getPoolRangeStartTimestamp,
  discoverUniswapPool,
  type PoolPriceDataPoint,
  type PoolInfo,
} from '../../../services/uniswap'
import {
  TimeRange,
  PRICE_RANGE_OPTIONS,
  formatXAxis,
  getRangeStartTimestamp,
} from './utils'

interface TokenPriceChartProps {
  projectId: string
  chainId?: string
  range?: TimeRange
  // Optional pool price props
  poolAddress?: string
  projectTokenAddress?: string
}

interface DataPoint {
  timestamp: number
  issuancePrice?: number
  cashOutPrice?: number
  poolPrice?: number
}

interface Ruleset {
  start: number
  duration: number
  weight: string
  weightCutPercent: number
}

// Calculate the issuance price at a specific timestamp
function calculatePriceAtTimestamp(timestamp: number, rulesets: Ruleset[]): number | undefined {
  const active = rulesets.find((r, i) => {
    const end = rulesets[i + 1]?.start ?? Infinity
    return timestamp >= r.start && timestamp < end
  })

  if (!active) return undefined

  const elapsed = timestamp - active.start
  const cycles = active.duration > 0 ? Math.floor(elapsed / active.duration) : 0
  const weight = parseFloat(active.weight) / 1e18

  if (weight <= 0) return undefined

  const currentWeight = weight * Math.pow(1 - active.weightCutPercent, cycles)
  return currentWeight > 0 ? 1 / currentWeight : undefined
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

// Chart colors for the price series
const PRICE_COLORS = {
  issuance: '#10b981', // emerald green
  cashOut: '#94a3b8',  // slate gray (visible on dark backgrounds)
  pool: '#60a5fa',     // light blue
}

export default function TokenPriceChart({
  projectId,
  chainId = '1',
  range: initialRange = '1y',
  poolAddress,
  projectTokenAddress,
}: TokenPriceChartProps) {
  const { theme } = useThemeStore()
  const { theGraphApiKey } = useSettingsStore()
  const isDark = theme === 'dark'

  const [range, setRange] = useState<TimeRange>(initialRange)
  const [rulesets, setRulesets] = useState<Ruleset[]>([])
  const [moments, setMoments] = useState<SuckerGroupMoment[]>([])
  const [taxSnapshots, setTaxSnapshots] = useState<CashOutTaxSnapshot[]>([])
  const [poolPriceData, setPoolPriceData] = useState<PoolPriceDataPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tokenSymbol, setTokenSymbol] = useState('TOKEN')
  const [projectStart, setProjectStart] = useState<number>(0)
  // Auto-discovered pool info
  const [discoveredPool, setDiscoveredPool] = useState<PoolInfo | null>(null)
  const [tokenAddress, setTokenAddress] = useState<string | null>(null)

  // Toggle state for series visibility
  const [showIssuance, setShowIssuance] = useState(true)
  const [showCashOut, setShowCashOut] = useState(true)
  const [showPool, setShowPool] = useState(true)

  // Load base project data (rulesets, moments, tax snapshots)
  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        const project = await fetchProjectWithRuleset(projectId, parseInt(chainId))
        if (!project || !project.currentRuleset) {
          setError('No ruleset data available')
          setLoading(false)
          return
        }

        // Get token symbol
        const symbol = await fetchProjectTokenSymbol(projectId, parseInt(chainId))
        setTokenSymbol(symbol || 'TOKEN')

        // Fetch all historical rulesets using JBRulesets.allOf
        let loadedRulesets: Ruleset[] = []
        let loadedProjectStart = 0

        const allRulesets = await fetchAllRulesets(projectId, parseInt(chainId))

        if (allRulesets.length > 0) {
          // allRulesets are already in SimpleRuleset format with weightCutPercent as raw number
          loadedRulesets = allRulesets.map((r: SimpleRuleset) => ({
            start: r.start,
            duration: r.duration,
            weight: r.weight,
            weightCutPercent: r.weightCutPercent / 1e9, // Convert from 1e9 basis points
          }))
          loadedProjectStart = loadedRulesets[0]?.start || Math.floor(Date.now() / 1000)
        } else {
          // Fallback to current ruleset only
          const current = project.currentRuleset
          const startTime = current.start || Math.floor(Date.now() / 1000) - 86400 * 30
          loadedRulesets = [{
            start: startTime,
            duration: current.duration,
            weight: current.weight,
            weightCutPercent: parseFloat(current.decayPercent) / 1e9,
          }]
          loadedProjectStart = startTime
        }

        setRulesets(loadedRulesets)
        setProjectStart(loadedProjectStart)

        // Fetch floor price data (sucker group moments and tax snapshots)
        const suckerGroupId = await fetchProjectSuckerGroupId(projectId, parseInt(chainId))

        let hasSuckerGroupData = false
        if (suckerGroupId) {
          const [momentsData, taxData] = await Promise.all([
            fetchSuckerGroupMoments(suckerGroupId),
            fetchCashOutTaxSnapshots(suckerGroupId),
          ])
          if (momentsData.length > 0 && taxData.length > 0) {
            setMoments(momentsData)
            setTaxSnapshots(taxData)
            hasSuckerGroupData = true
          }
        }

        // Fallback: Create a single current cash out price point if no sucker group data
        if (!hasSuckerGroupData && project.currentRuleset?.cashOutTaxRate !== undefined) {
          const tokenSupply = await fetchProjectTokenSupply(projectId, parseInt(chainId))
          if (tokenSupply && project.balance) {
            const now = Math.floor(Date.now() / 1000)
            // Create a synthetic moment with current balance and supply
            setMoments([{
              timestamp: now,
              balance: project.balance,
              tokenSupply: tokenSupply,
              suckerGroupId: '',
            }])
            // Create a synthetic tax snapshot with current ruleset's cash out tax rate
            setTaxSnapshots([{
              cashOutTax: project.currentRuleset.cashOutTaxRate,
              start: loadedProjectStart,
              duration: project.currentRuleset.duration,
              rulesetId: '',
              suckerGroupId: '',
            }])
          }
        }

        // Auto-discover Uniswap pool if no pool address was provided
        if (!poolAddress) {
          const tokenAddr = await fetchProjectTokenAddress(projectId, parseInt(chainId))
          console.log('[TokenPriceChart] Token address:', tokenAddr)
          setTokenAddress(tokenAddr)

          if (tokenAddr) {
            const pool = await discoverUniswapPool(tokenAddr, parseInt(chainId))
            console.log('[TokenPriceChart] Discovered pool:', pool)
            setDiscoveredPool(pool)
          } else {
            console.log('[TokenPriceChart] No token address found, skipping pool discovery')
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load price data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [projectId, chainId, poolAddress])

  // Determine if this is a USD-based project (USDC pool)
  const isUsdBased = discoveredPool?.quoteToken === 'USDC'

  // Load pool price data when pool is available (explicit or discovered)
  useEffect(() => {
    async function loadPoolData() {
      // Use explicit pool address if provided, otherwise use discovered pool
      const effectivePoolAddress = poolAddress || discoveredPool?.address
      const effectiveTokenAddress = projectTokenAddress || tokenAddress

      if (!effectivePoolAddress || !effectiveTokenAddress) {
        setPoolPriceData([])
        return
      }

      try {
        const startTimestamp = getPoolRangeStartTimestamp(range, projectStart)
        const useHourly = shouldUseHourlyData(range)

        const priceData = await fetchPoolPriceHistory(
          effectivePoolAddress,
          effectiveTokenAddress,
          parseInt(chainId),
          startTimestamp,
          useHourly,
          theGraphApiKey || DEFAULT_THEGRAPH_API_KEY
        )

        setPoolPriceData(priceData)
      } catch (err) {
        console.error('Failed to load pool price data:', err)
        setPoolPriceData([])
      }
    }

    loadPoolData()
  }, [poolAddress, projectTokenAddress, discoveredPool, tokenAddress, chainId, range, projectStart, theGraphApiKey])

  // Prepare chart data
  const chartData = useMemo(() => {
    if (rulesets.length === 0) return []

    const now = Math.floor(Date.now() / 1000)
    const rangeStart = range === 'all' ? projectStart : Math.max(projectStart, getRangeStartTimestamp(range))
    const rangeEnd = now

    // Sort rulesets chronologically
    const sortedRulesets = [...rulesets].sort((a, b) => a.start - b.start)

    // Create data points map keyed by day
    const dataByDay = new Map<number, DataPoint>()
    const DAY_SECONDS = 86400

    // Normalize timestamp to day boundary
    const toDayBoundary = (ts: number) => Math.floor(ts / DAY_SECONDS) * DAY_SECONDS

    // For USD-based projects (USDC pools), don't convert - show raw values
    // The pool price is already in USDC, and for USDC-terminal projects,
    // issuance/floor are also effectively in USDC-equivalent terms
    // This keeps all three lines on the same scale

    // Generate issuance price data at daily intervals
    const interval = DAY_SECONDS
    for (let t = rangeStart; t <= rangeEnd; t += interval) {
      const dayTs = toDayBoundary(t)
      const price = calculatePriceAtTimestamp(t, sortedRulesets)

      if (price !== undefined && isFinite(price)) {
        const existing = dataByDay.get(dayTs) || { timestamp: dayTs }
        existing.issuancePrice = price
        dataByDay.set(dayTs, existing)
      }
    }

    // Add floor price data from moments
    // Use correct decimals for balance: 6 for USDC, 18 for ETH
    const balanceDecimals = isUsdBased ? 6 : 18

    if (moments.length > 0 && taxSnapshots.length > 0) {
      for (const moment of moments) {
        const dayTs = toDayBoundary(moment.timestamp)
        if (dayTs < rangeStart) continue

        const balance = BigInt(moment.balance)
        const supply = BigInt(moment.tokenSupply)
        const taxRate = findApplicableTaxRate(moment.timestamp, taxSnapshots)

        const floorPrice = calculateFloorPrice(balance, supply, taxRate, balanceDecimals)

        if (floorPrice > 0) {
          const existing = dataByDay.get(dayTs) || { timestamp: dayTs }
          existing.cashOutPrice = floorPrice
          dataByDay.set(dayTs, existing)
        }
      }
    }

    // Add pool price data (already in correct denomination - USD for USDC pools, ETH for ETH pools)
    for (const poolPoint of poolPriceData) {
      const dayTs = toDayBoundary(poolPoint.timestamp)
      if (dayTs < rangeStart) continue

      const existing = dataByDay.get(dayTs) || { timestamp: dayTs }
      existing.poolPrice = poolPoint.price
      dataByDay.set(dayTs, existing)
    }

    // Convert to sorted array
    const sortedData = Array.from(dataByDay.values()).sort((a, b) => a.timestamp - b.timestamp)

    // Forward-fill missing values
    let lastIssuance: number | undefined
    let lastCashOut: number | undefined
    let lastPool: number | undefined

    for (const point of sortedData) {
      if (point.issuancePrice !== undefined) {
        lastIssuance = point.issuancePrice
      } else if (lastIssuance !== undefined) {
        point.issuancePrice = lastIssuance
      }

      if (point.cashOutPrice !== undefined) {
        lastCashOut = point.cashOutPrice
      } else if (lastCashOut !== undefined) {
        point.cashOutPrice = lastCashOut
      }

      if (point.poolPrice !== undefined) {
        lastPool = point.poolPrice
      } else if (lastPool !== undefined) {
        point.poolPrice = lastPool
      }
    }

    return sortedData
  }, [rulesets, moments, taxSnapshots, poolPriceData, range, projectStart, isUsdBased])

  // Check if we have data for each series
  const hasIssuanceData = chartData.some(d => d.issuancePrice !== undefined)
  const hasCashOutData = chartData.some(d => d.cashOutPrice !== undefined)
  const hasPoolData = chartData.some(d => d.poolPrice !== undefined)

  // Get current prices
  const currentIssuancePrice = chartData.length > 0 ? chartData[chartData.length - 1]?.issuancePrice : undefined
  const currentCashOutPrice = chartData.length > 0 ? chartData[chartData.length - 1]?.cashOutPrice : undefined
  const currentPoolPrice = chartData.length > 0 ? chartData[chartData.length - 1]?.poolPrice : undefined

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
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string; payload: DataPoint }> }) => {
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
        {data.issuancePrice !== undefined && showIssuance && (
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRICE_COLORS.issuance }} />
            <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>Issuance:</span>
            <span className="font-mono">{formatPrice(data.issuancePrice)} {isUsdBased ? 'USDC' : 'ETH'}</span>
          </div>
        )}
        {data.poolPrice !== undefined && showPool && (
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRICE_COLORS.pool }} />
            <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>Pool:</span>
            <span className="font-mono">{formatPrice(data.poolPrice)} {isUsdBased ? 'USDC' : 'ETH'}</span>
          </div>
        )}
        {data.cashOutPrice !== undefined && showCashOut && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRICE_COLORS.cashOut }} />
            <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>Cash out:</span>
            <span className="font-mono">{formatPrice(data.cashOutPrice)} {isUsdBased ? 'USDC' : 'ETH'}</span>
          </div>
        )}
      </div>
    )
  }

  // Toggle button component
  const ToggleButton = ({
    label,
    active,
    disabled,
    color,
    onClick,
  }: {
    label: string
    active: boolean
    disabled: boolean
    color: string
    onClick: () => void
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-all
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        ${active && !disabled
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
        style={{ backgroundColor: active && !disabled ? color : isDark ? '#666' : '#ccc' }}
      />
      <span className={active && !disabled ? (isDark ? 'text-white' : 'text-gray-900') : (isDark ? 'text-gray-500' : 'text-gray-400')}>
        {label}
      </span>
    </button>
  )

  return (
    <div className="w-full">
      <div className={`border overflow-hidden ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header with title, toggles, and range selector */}
        <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <div className="flex items-center justify-between gap-4 mb-2">
            <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Token Price History
            </span>
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
          {/* Toggle buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <ToggleButton
              label="Issuance price"
              active={showIssuance}
              disabled={!hasIssuanceData}
              color={PRICE_COLORS.issuance}
              onClick={() => setShowIssuance(!showIssuance)}
            />
            {/* Show pool toggle if pool address is provided or discovered */}
            {(poolAddress || discoveredPool) && (
              <ToggleButton
                label="Pool price"
                active={showPool}
                disabled={!hasPoolData}
                color={PRICE_COLORS.pool}
                onClick={() => setShowPool(!showPool)}
              />
            )}
            <ToggleButton
              label="Cash out price"
              active={showCashOut}
              disabled={!hasCashOutData}
              color={PRICE_COLORS.cashOut}
              onClick={() => setShowCashOut(!showCashOut)}
            />
          </div>
        </div>

        {/* Chart */}
        <div className="px-2 py-3">
          {loading ? (
            <div className={`h-[200px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              Loading...
            </div>
          ) : error ? (
            <div className="h-[200px] flex items-center justify-center text-red-400">
              {error}
            </div>
          ) : chartData.length === 0 ? (
            <div className={`h-[200px] flex items-center justify-center ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              No price data available
            </div>
          ) : (
            <div className="h-[200px]">
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

                  {/* Issuance Price line */}
                  {showIssuance && hasIssuanceData && (
                    <Line
                      type="stepAfter"
                      dataKey="issuancePrice"
                      stroke={PRICE_COLORS.issuance}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  )}

                  {/* Pool Price line */}
                  {showPool && hasPoolData && (
                    <Line
                      type="monotone"
                      dataKey="poolPrice"
                      stroke={PRICE_COLORS.pool}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  )}

                  {/* Cash Out Price line */}
                  {showCashOut && hasCashOutData && (
                    <Line
                      type="stepAfter"
                      dataKey="cashOutPrice"
                      stroke={PRICE_COLORS.cashOut}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Footer with current prices */}
        {!loading && !error && chartData.length > 0 && (
          <div className={`px-4 py-2 text-xs border-t flex flex-wrap gap-x-4 gap-y-1 ${
            isDark ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
          }`}>
            {showIssuance && currentIssuancePrice !== undefined && (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRICE_COLORS.issuance }} />
                Issuance: {formatPrice(currentIssuancePrice)} {isUsdBased ? 'USDC' : 'ETH'} / {tokenSymbol}
              </span>
            )}
            {showPool && currentPoolPrice !== undefined && (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRICE_COLORS.pool }} />
                Pool: {formatPrice(currentPoolPrice)} {isUsdBased ? 'USDC' : 'ETH'} / {tokenSymbol}
              </span>
            )}
            {showCashOut && currentCashOutPrice !== undefined && (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PRICE_COLORS.cashOut }} />
                Cash out: {formatPrice(currentCashOutPrice)} {isUsdBased ? 'USDC' : 'ETH'} / {tokenSymbol}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
