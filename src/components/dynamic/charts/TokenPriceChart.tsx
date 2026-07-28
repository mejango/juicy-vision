import { useState, useEffect, useMemo } from 'react'
import { defaultChainId } from '../../../config/environment'
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
  fetchAllRulesets,
  fetchIndexedAmmPriceHistory,
  isRevnetProject,
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
import { issuancePriceDomain } from './priceDomain'
import { RangeSelector, ChartState, TooltipShell, ChartFooter } from './shared'
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
  cashOutMinPrice?: number
  poolPrice?: number
  cashOutChangeReason?: string
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

// Find the applicable tax rate for a given timestamp: the latest snapshot
// whose start is at or before it.
function findApplicableTaxRate(timestamp: number, taxSnapshots: CashOutTaxSnapshot[]): number | null {
  const sorted = [...taxSnapshots].sort((a, b) => a.start - b.start)
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].start <= timestamp) return sorted[i].cashOutTax
  }
  return null
}

type CashOutObservation = {
  balance: bigint
  tokenSupply: bigint
  cashOutTax: number
  price: number
}

function explainCashOutChange(
  previous: CashOutObservation | undefined,
  current: CashOutObservation,
): string {
  if (!previous) return 'First indexed cash-out price observation.'
  const causes: string[] = []
  const balanceRose = current.balance > previous.balance
  const balanceFell = current.balance < previous.balance
  const supplyRose = current.tokenSupply > previous.tokenSupply
  const supplyFell = current.tokenSupply < previous.tokenSupply
  const ratioLeft = current.balance * previous.tokenSupply
  const ratioRight = previous.balance * current.tokenSupply
  const backingRatio = ratioLeft > ratioRight ? 1 : ratioLeft < ratioRight ? -1 : 0

  if (balanceRose && supplyRose) {
    causes.push(backingRatio < 0
      ? 'a payment increased token supply faster than backing, diluting backing per token'
      : backingRatio > 0
        ? 'a payment increased backing faster than token supply'
        : 'a payment added backing and tokens at the same backing-per-token ratio')
  }
  else if (balanceFell && supplyFell) {
    causes.push(backingRatio > 0
      ? 'a cash out burned supply faster than it removed backing, increasing backing per remaining token'
      : backingRatio < 0
        ? 'a cash out removed backing faster than it burned supply'
        : 'a cash out removed backing and supply at the same ratio')
  }
  else {
    if (balanceRose) causes.push('funds were added to the project')
    if (balanceFell) causes.push('a payout reduced project backing')
    if (supplyRose) causes.push('token supply increased')
    if (supplyFell) causes.push('tokens were burned')
  }
  if (current.cashOutTax !== previous.cashOutTax) {
    const pct = (value: number) => `${(value / 100).toFixed(2).replace(/\.?0+$/, '')}%`
    causes.push(`the cash-out tax changed from ${pct(previous.cashOutTax)} to ${pct(current.cashOutTax)}`)
  }
  const direction = current.price > previous.price
    ? 'rose'
    : current.price < previous.price
      ? 'fell'
      : 'was unchanged'
  if (!causes.length) {
    return `Cash-out price ${direction}; the indexed backing, supply, and tax inputs did not change.`
  }
  const joined = causes.length === 1
    ? causes[0]
    : `${causes.slice(0, -1).join(', ')} and ${causes[causes.length - 1]}`
  return `Cash-out price ${direction} because ${joined}.`
}

export default function TokenPriceChart({
  projectId,
  chainId = defaultChainId(),
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
  const [accountingCurrency, setAccountingCurrency] = useState(1)
  const [indexedPoolAvailable, setIndexedPoolAvailable] = useState(false)

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

        // Fetch the token symbol and floor price data (sucker group moments
        // and tax snapshots) in parallel
        const [symbol, suckerGroupId, currentBalance] = await Promise.all([
          fetchProjectTokenSymbol(projectId, parseInt(chainId)),
          fetchProjectSuckerGroupId(projectId, parseInt(chainId)),
          fetchSuckerGroupBalance(projectId, parseInt(chainId)),
        ])
        setTokenSymbol(symbol || 'TOKEN')
        if (currentBalance.balanceAvailable === false) {
          throw new Error('Cash-out price unavailable for this accounting configuration')
        }
        setAccountingToken(resolveAccountingToken(currentBalance.currency, currentBalance.decimals))
        setAccountingCurrency(currentBalance.currency)

        const current = project.currentRuleset
        if (isRevnetProject(project) && current.baseCurrency === currentBalance.currency) {
          try {
            const stageRulesets = await fetchAllRulesets(projectId, parseInt(chainId))
            setRulesets(stageRulesets)
            setProjectStart(stageRulesets.length > 0
              ? Math.min(...stageRulesets.map(stage => stage.start))
              : current.start || Math.floor(Date.now() / 1000))
          } catch (err) {
            // Keep independently available pool and cash-out series visible if
            // this one on-chain schedule read is temporarily unavailable.
            console.error('Failed to load Revnet issuance series:', err)
            setRulesets([])
            setProjectStart(current.start || Math.floor(Date.now() / 1000))
          }
        } else if (!current.useDataHookForPay && current.baseCurrency === currentBalance.currency && current.start) {
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
  const legacyPoolMatchesAccounting = discoveredPool?.quoteToken === expectedPoolQuote
  const poolMatchesAccounting = indexedPoolAvailable || legacyPoolMatchesAccounting

  // Load pool price data when pool is available (explicit or discovered)
  useEffect(() => {
    async function loadPoolData() {
      const effectivePoolAddress = discoveredPool?.address
      const effectiveTokenAddress = tokenAddress

      try {
        const indexed = await fetchIndexedAmmPriceHistory({
          projectId,
          chainId: parseInt(chainId),
          currency: accountingCurrency,
          terminalDecimals: accountingToken.decimals,
        })
        if (indexed.hasPool) {
          setIndexedPoolAvailable(true)
          setPoolPriceData(indexed.points)
          return
        }

        setIndexedPoolAvailable(false)
        if (!effectivePoolAddress || !effectiveTokenAddress || !legacyPoolMatchesAccounting) {
          setPoolPriceData([])
          return
        }
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
        // New Bendystraw fields may be unavailable during a coordinated
        // deploy. Preserve the existing V3 history as a temporary fallback.
        setIndexedPoolAvailable(false)
        if (!effectivePoolAddress || !effectiveTokenAddress || !legacyPoolMatchesAccounting) {
          console.error('Failed to load pool price data:', err)
          setPoolPriceData([])
          return
        }
        const startTimestamp = getPoolRangeStartTimestamp(range, projectStart)
        const useHourly = shouldUseHourlyData(range)
        const priceData = await fetchPoolPriceHistory(
          effectivePoolAddress,
          effectiveTokenAddress,
          parseInt(chainId),
          startTimestamp,
          useHourly,
          theGraphApiKey || DEFAULT_THEGRAPH_API_KEY,
        )
        setPoolPriceData(priceData)
      }
    }

    loadPoolData()
  }, [
    accountingToken.decimals,
    accountingCurrency,
    chainId,
    discoveredPool,
    legacyPoolMatchesAccounting,
    projectId,
    projectStart,
    range,
    theGraphApiKey,
    tokenAddress,
  ])

  // Prepare chart data
  const chartData = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const rangeStart = range === 'all' ? projectStart : Math.max(projectStart, getRangeStartTimestamp(range))
    const rangeEnd = now

    // Sort rulesets chronologically
    const sortedRulesets = [...rulesets].sort((a, b) => a.start - b.start)

    // Preserve intraday trades for the short ranges; longer views aggregate
    // into daily buckets to keep the chart compact.
    const dataByDay = new Map<number, DataPoint>()
    const DAY_SECONDS = 86400
    const BUCKET_SECONDS = shouldUseHourlyData(range) ? 3600 : DAY_SECONDS

    const toBucketBoundary = (ts: number) =>
      Math.floor(ts / BUCKET_SECONDS) * BUCKET_SECONDS

    // For USD-based projects (USDC pools), don't convert - show raw values
    // The pool price is already in USDC, and for USDC-terminal projects,
    // issuance/floor are also effectively in USDC-equivalent terms
    // This keeps all three lines on the same scale

    // Generate issuance price data at daily intervals
    const interval = BUCKET_SECONDS
    if (sortedRulesets.length > 0) {
      for (let t = rangeStart; t <= rangeEnd; t += interval) {
        const dayTs = toBucketBoundary(t)
        const price = calculatePriceAtTimestamp(t, sortedRulesets)

        if (price !== undefined && isFinite(price)) {
          const existing = dataByDay.get(dayTs) || { timestamp: dayTs }
          existing.issuancePrice = price
          const taxRate = findApplicableTaxRate(t, taxSnapshots)
          if (taxRate !== null) {
            existing.cashOutMinPrice =
              price * (1 - Math.max(0, Math.min(10_000, taxRate)) / 10_000)
          }
          dataByDay.set(dayTs, existing)
        }
      }
    }

    // Add floor price data from moments
    // Use correct decimals for balance: 6 for USDC, 18 for ETH
    const balanceDecimals = accountingToken.decimals

    if (moments.length > 0 && taxSnapshots.length > 0) {
      let previous: CashOutObservation | undefined
      for (const moment of [...moments].sort((a, b) => a.timestamp - b.timestamp)) {
        const dayTs = toBucketBoundary(moment.timestamp)
        if (dayTs < rangeStart) continue

        const balance = BigInt(moment.balance)
        const supply = BigInt(moment.tokenSupply)
        const taxRate = findApplicableTaxRate(moment.timestamp, taxSnapshots)

        if (taxRate === null) continue
        const floorPrice = calculateFloorPrice(balance, supply, taxRate, balanceDecimals)

        if (floorPrice > 0) {
          const existing = dataByDay.get(dayTs) || { timestamp: dayTs }
          existing.cashOutPrice = floorPrice
          const observation = {
            balance,
            tokenSupply: supply,
            cashOutTax: taxRate,
            price: floorPrice,
          }
          existing.cashOutChangeReason = explainCashOutChange(previous, observation)
          previous = observation
          dataByDay.set(dayTs, existing)
        }
      }
    }

    // Add pool price data (already in correct denomination - USD for USDC pools, ETH for ETH pools)
    const orderedPoolPoints = [...poolPriceData].sort((a, b) => a.timestamp - b.timestamp)
    const priorPoolPoints = orderedPoolPoints.filter(
      point => point.timestamp < rangeStart,
    )
    const previousPoolPoint = priorPoolPoints[priorPoolPoints.length - 1]
    if (previousPoolPoint) {
      const seedTs = toBucketBoundary(rangeStart)
      const existing = dataByDay.get(seedTs) || { timestamp: seedTs }
      existing.poolPrice = previousPoolPoint.price
      dataByDay.set(seedTs, existing)
    }
    for (const poolPoint of orderedPoolPoints) {
      const dayTs = toBucketBoundary(poolPoint.timestamp)
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
    let lastCashOutMin: number | undefined
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

      if (point.cashOutMinPrice !== undefined) {
        lastCashOutMin = point.cashOutMinPrice
      } else if (lastCashOutMin !== undefined) {
        point.cashOutMinPrice = lastCashOutMin
      }

      if (point.poolPrice !== undefined) {
        lastPool = point.poolPrice
      } else if (lastPool !== undefined) {
        point.poolPrice = lastPool
      }
    }

    return sortedData
  }, [rulesets, moments, taxSnapshots, poolPriceData, range, projectStart, accountingToken.decimals])

  const yDomain = useMemo(
    () => issuancePriceDomain(chartData.map(d => d.issuancePrice)),
    [chartData],
  )

  // Check if we have data for each series
  const hasIssuanceData = chartData.some(d => d.issuancePrice !== undefined)
  const hasCashOutData = chartData.some(d => d.cashOutPrice !== undefined)
  const hasCashOutMinData = chartData.some(d => d.cashOutMinPrice !== undefined)
  const hasPoolData = chartData.some(d => d.poolPrice !== undefined)

  // Get current prices
  const currentIssuancePrice = chartData.length > 0 ? chartData[chartData.length - 1]?.issuancePrice : undefined
  const currentCashOutPrice = chartData.length > 0 ? chartData[chartData.length - 1]?.cashOutPrice : undefined
  const currentCashOutMinPrice = chartData.length > 0 ? chartData[chartData.length - 1]?.cashOutMinPrice : undefined
  const currentPoolPrice = chartData.length > 0 ? chartData[chartData.length - 1]?.poolPrice : undefined
  const showCashOutMin =
    currentCashOutPrice !== undefined &&
    currentCashOutMinPrice !== undefined &&
    currentCashOutPrice > 0 &&
    currentCashOutMinPrice > 0 &&
    currentCashOutPrice > currentCashOutMinPrice

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
      <TooltipShell isDark={isDark}>
        <div className={`text-xs mb-2 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          {new Date(data.timestamp * 1000).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </div>
        {data.issuancePrice !== undefined && showIssuance && (
          <div className="flex items-center gap-2 mb-1 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS.issuance }} />
            <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>Issuance:</span>
            <span className="font-mono">{formatPrice(data.issuancePrice)} {isUsdBased ? 'USDC' : 'ETH'}</span>
          </div>
        )}
        {data.poolPrice !== undefined && showPool && (
          <div className="flex items-center gap-2 mb-1 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS.pool }} />
            <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>Pool:</span>
            <span className="font-mono">{formatPrice(data.poolPrice)} {isUsdBased ? 'USDC' : 'ETH'}</span>
          </div>
        )}
        {data.cashOutPrice !== undefined && showCashOut && (
          <div className="flex items-center gap-2 mb-1 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS.cashOut }} />
            <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>Cash-out baseline:</span>
            <span className="font-mono">{formatPrice(data.cashOutPrice)} {isUsdBased ? 'USDC' : 'ETH'}</span>
          </div>
        )}
        {data.cashOutMinPrice !== undefined && showCashOut && showCashOutMin && (
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS.cashOut, opacity: 0.55 }} />
            <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>Min cash out:</span>
            <span className="font-mono">{formatPrice(data.cashOutMinPrice)} {isUsdBased ? 'USDC' : 'ETH'}</span>
          </div>
        )}
        {data.cashOutChangeReason && showCashOut && (
          <p className={`mt-2 max-w-xs text-xs leading-snug ${isDark ? 'text-zinc-300' : 'text-gray-600'}`}>
            {data.cashOutChangeReason}
          </p>
        )}
      </TooltipShell>
    )
  }

  // Toggle button component
  const ToggleButton = ({
    label,
    active,
    disabled,
    color,
    onClick,
    title,
  }: {
    label: string
    active: boolean
    disabled: boolean
    color: string
    onClick: () => void
    title?: string
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        group relative flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border transition-all
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
      {/* Native title tooltips carry a fixed ~1s OS delay; render the explanation instantly on hover. */}
      {title && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-0 top-full z-10 mt-1.5 hidden w-max max-w-[16rem] whitespace-normal rounded border px-2 py-1.5 text-left text-[11px] font-normal normal-case leading-snug group-hover:block ${
            isDark ? 'border-white/20 bg-juice-dark text-gray-200' : 'border-gray-200 bg-white text-gray-700 shadow-sm'
          }`}
        >
          {title}
        </span>
      )}
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
            <RangeSelector options={PRICE_RANGE_OPTIONS} range={range} onChange={setRange} isDark={isDark} />
          </div>
          {/* Toggle buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <ToggleButton
              label="Issuance price"
              active={showIssuance}
              disabled={!hasIssuanceData}
              color={CHART_COLORS.issuance}
              onClick={() => setShowIssuance(!showIssuance)}
              title={`What paying the project costs per ${tokenSymbol} right now: 1 ÷ the ruleset's issuance weight.`}
            />
            {poolMatchesAccounting && (
              <ToggleButton
                label="Pool price"
                active={showPool}
                disabled={!hasPoolData}
                color={CHART_COLORS.pool}
                onClick={() => setShowPool(!showPool)}
                title={`What the Uniswap pool charges per ${tokenSymbol} right now — kept between the issuance price and the cash out floor by arbitrage.`}
              />
            )}
            <ToggleButton
              label="Cash-out baseline"
              active={showCashOut}
              disabled={!hasCashOutData}
              color={CHART_COLORS.cashOut}
              onClick={() => setShowCashOut(!showCashOut)}
              title={`Live quote for cashing out 1 ${tokenSymbol}: (balance ÷ supply) × ((1 − tax) + tax × your share of supply). As supply grows it approaches the dashed minimum, (1 − tax) × balance ÷ supply — payments can only raise that minimum; only payouts lower it.`}
            />
          </div>
        </div>

        {/* Chart */}
        <div className="px-2 py-3">
          <ChartState
            heightClass="h-[200px]"
            isDark={isDark}
            loading={loading}
            error={error}
            isEmpty={chartData.length === 0}
            emptyMessage="No price data available"
          >
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
                    domain={yDomain}
                    allowDataOverflow={yDomain[0] !== 'auto'}
                    stroke={isDark ? '#666' : '#999'}
                    fontSize={11}
                  />
                  <Tooltip content={<CustomTooltip />} />

                  {/* Pool Price line */}
                  {showPool && hasPoolData && (
                    <Line
                      type="monotone"
                      dataKey="poolPrice"
                      stroke={CHART_COLORS.pool}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  )}

                  {/* Payment asymptote: issuance price × the post-tax factor. */}
                  {showCashOut && hasCashOutMinData && showCashOutMin && (
                    <Line
                      type="stepAfter"
                      dataKey="cashOutMinPrice"
                      stroke={CHART_COLORS.cashOut}
                      strokeOpacity={0.55}
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
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
                      stroke={CHART_COLORS.cashOut}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  )}

                  {/* Issuance Price line */}
                  {showIssuance && hasIssuanceData && (
                    <Line
                      type="stepAfter"
                      dataKey="issuancePrice"
                      stroke={CHART_COLORS.issuance}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
          </ChartState>
        </div>

        {/* Footer with current prices */}
        {!loading && !error && chartData.length > 0 && (
          <ChartFooter isDark={isDark}>
            {showIssuance && currentIssuancePrice !== undefined && (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS.issuance }} />
                Issuance: {formatPrice(currentIssuancePrice)} {isUsdBased ? 'USDC' : 'ETH'} / {tokenSymbol}
              </span>
            )}
            {showPool && currentPoolPrice !== undefined && (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS.pool }} />
                Pool: {formatPrice(currentPoolPrice)} {isUsdBased ? 'USDC' : 'ETH'} / {tokenSymbol}
              </span>
            )}
            {showCashOut && currentCashOutPrice !== undefined && (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS.cashOut }} />
                Cash-out baseline: {formatPrice(currentCashOutPrice)} {isUsdBased ? 'USDC' : 'ETH'} / {tokenSymbol}
              </span>
            )}
          </ChartFooter>
        )}
      </div>
    </div>
  )
}
