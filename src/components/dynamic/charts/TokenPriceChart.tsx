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
  fetchPendingReservedTokens,
  fetchProjectSuckerGroupId,
  fetchSuckerGroupBalance,
  fetchSuckerGroupMoments,
  fetchCashOutTaxSnapshots,
  calculateFloorPrice,
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
  CHART_COLORS,
} from './utils'
import { resolveAccountingToken } from '../../../utils/currency'
import { deriveCycledWeight, issuancePriceFromWeight } from '../../../utils/rulesetMath'

interface TokenPriceChartProps {
  projectId: string
  chainId?: string
  range?: TimeRange
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
  try {
    return issuancePriceFromWeight(
      deriveCycledWeight(active.weight, active.weightCutPercent, cycles),
    )
  } catch {
    return undefined
  }
}

// Find the applicable tax rate for a given timestamp
function findApplicableTaxRate(timestamp: number, taxSnapshots: CashOutTaxSnapshot[]): number | null {
  const sorted = [...taxSnapshots].sort((a, b) => a.start - b.start)

  let applicableTax: number | null = null
  for (const snapshot of sorted) {
    if (snapshot.start <= timestamp) {
      applicableTax = snapshot.cashOutTax
    } else {
      break
    }
  }

  return applicableTax
}

// Use centralized chart colors
const PRICE_COLORS = {
  issuance: CHART_COLORS.issuance,
  cashOut: CHART_COLORS.cashOut,
  pool: CHART_COLORS.pool,
}

export default function TokenPriceChart({
  projectId,
  chainId = '1',
  range: initialRange = '1y',
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
  const [accountingToken, setAccountingToken] = useState(resolveAccountingToken())

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

        // Fetch floor price data (sucker group moments and tax snapshots)
        const [suckerGroupId, currentBalance] = await Promise.all([
          fetchProjectSuckerGroupId(projectId, parseInt(chainId)),
          fetchSuckerGroupBalance(projectId, parseInt(chainId)),
        ])
        if (currentBalance.balanceAvailable === false) {
          throw new Error('Cash-out price unavailable for this accounting configuration')
        }
        setAccountingToken(resolveAccountingToken(currentBalance.currency, currentBalance.decimals))

        const current = project.currentRuleset
        if (!current.useDataHookForPay && current.baseCurrency === currentBalance.currency && current.start) {
          setRulesets([{
            start: current.start,
            duration: current.duration,
            weight: current.weight,
            weightCutPercent: current.weightCutPercent ?? Number(current.decayPercent),
          }])
          setProjectStart(current.start)
        } else {
          setRulesets([])
          setProjectStart(current.start || Math.floor(Date.now() / 1000))
        }

        let hasSuckerGroupData = false
        const chainIdNum = parseInt(chainId)
        if (suckerGroupId) {
          const [momentsData, taxData] = await Promise.all([
            fetchSuckerGroupMoments(suckerGroupId, 1000, chainIdNum),
            fetchCashOutTaxSnapshots(suckerGroupId, 1000, chainIdNum),
          ])
          if (momentsData.length > 0 && taxData.length > 0) {
            setMoments(momentsData)
            setTaxSnapshots(taxData)
            setProjectStart(Math.min(
              current.start || Number.MAX_SAFE_INTEGER,
              ...momentsData.map(moment => moment.timestamp),
            ))
            hasSuckerGroupData = true
          }
        }

        // A local current point is only valid for a single-chain project. Using
        // local balance/supply as an omnichain fallback would overstate its floor.
        if (!suckerGroupId && !hasSuckerGroupData && project.currentRuleset?.cashOutTaxRate !== undefined) {
          const [tokenSupply, pendingReserved] = await Promise.all([
            fetchProjectTokenSupply(projectId, parseInt(chainId)),
            fetchPendingReservedTokens(projectId, parseInt(chainId)),
          ])
          if (tokenSupply !== null && /^\d+$/.test(currentBalance.totalBalance)) {
            const now = Math.floor(Date.now() / 1000)
            const cashOutSupply = BigInt(tokenSupply) + BigInt(pendingReserved)
            // Create a synthetic moment with current balance and supply
            setMoments([{
              timestamp: now,
              balance: currentBalance.totalBalance,
              tokenSupply: cashOutSupply.toString(),
              suckerGroupId: '',
            }])
            // Create a synthetic tax snapshot with current ruleset's cash out tax rate
            setTaxSnapshots([{
              cashOutTax: project.currentRuleset.cashOutTaxRate,
              start: current.start || now,
              duration: project.currentRuleset.duration,
              rulesetId: '',
              suckerGroupId: '',
            }])
          }
        }

        // Derive both addresses from the live project's recognized token contract.
        const tokenAddr = await fetchProjectTokenAddress(projectId, parseInt(chainId))
        setTokenAddress(tokenAddr)
        if (tokenAddr) {
          const pool = await discoverUniswapPool(tokenAddr, parseInt(chainId))
          setDiscoveredPool(pool)
        } else {
          setDiscoveredPool(null)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load price data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [projectId, chainId])

  const isUsdBased = accountingToken.isUsd
  const expectedPoolQuote = accountingToken.isUsd ? 'USDC' : 'WETH'
  const poolMatchesAccounting = discoveredPool?.quoteToken === expectedPoolQuote

  // Load pool price data when pool is available (explicit or discovered)
  useEffect(() => {
    async function loadPoolData() {
      const effectivePoolAddress = discoveredPool?.address
      const effectiveTokenAddress = tokenAddress

      if (!effectivePoolAddress || !effectiveTokenAddress || !poolMatchesAccounting) {
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
  }, [discoveredPool, tokenAddress, chainId, range, projectStart, theGraphApiKey, poolMatchesAccounting])

  // Prepare chart data
  const chartData = useMemo(() => {
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
    if (sortedRulesets.length > 0) {
      for (let t = rangeStart; t <= rangeEnd; t += interval) {
        const dayTs = toDayBoundary(t)
        const price = calculatePriceAtTimestamp(t, sortedRulesets)

        if (price !== undefined && isFinite(price)) {
          const existing = dataByDay.get(dayTs) || { timestamp: dayTs }
          existing.issuancePrice = price
          dataByDay.set(dayTs, existing)
        }
      }
    }

    // Add floor price data from moments
    // Use correct decimals for balance: 6 for USDC, 18 for ETH
    const balanceDecimals = accountingToken.decimals

    if (moments.length > 0 && taxSnapshots.length > 0) {
      for (const moment of moments) {
        const dayTs = toDayBoundary(moment.timestamp)
        if (dayTs < rangeStart) continue

        const balance = BigInt(moment.balance)
        const supply = BigInt(moment.tokenSupply)
        const taxRate = findApplicableTaxRate(moment.timestamp, taxSnapshots)

        if (taxRate === null) continue
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
  }, [rulesets, moments, taxSnapshots, poolPriceData, range, projectStart, accountingToken.decimals])

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
            <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>Cash-out baseline:</span>
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
            {poolMatchesAccounting && (
              <ToggleButton
                label="Pool price"
                active={showPool}
                disabled={!hasPoolData}
                color={PRICE_COLORS.pool}
                onClick={() => setShowPool(!showPool)}
              />
            )}
            <ToggleButton
              label="Cash-out baseline"
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
                Cash-out baseline: {formatPrice(currentCashOutPrice)} {isUsdBased ? 'USDC' : 'ETH'} / {tokenSymbol}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
