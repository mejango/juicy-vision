import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from 'recharts'
import { useThemeStore } from '../../stores'
import {
  fetchProjectWithRuleset,
  fetchProjectTokenSymbol,
  fetchRulesetHistory,
  fetchRevnetStages,
  isRevnet,
  type RulesetHistoryEntry,
  type RevnetStage,
} from '../../services/bendystraw'

type RangeValue = '3m' | '6m' | '1y' | '2y' | '5y' | '10y' | 'all'

interface PriceChartProps {
  projectId: string
  chainId?: string
  range?: RangeValue
}

interface DataPoint {
  timestamp: number
  price: number
  visualX: number
}

interface Stage {
  name: string
  start: number
}

interface StageArea extends Stage {
  x1: number
  x2: number
}

const RANGE_OPTIONS = [
  { value: '3m', label: '3M', years: 0.25 },
  { value: '6m', label: '6M', years: 0.5 },
  { value: '1y', label: '1Y', years: 1 },
  { value: '2y', label: '2Y', years: 2 },
  { value: '5y', label: '5Y', years: 5 },
  { value: '10y', label: '10Y', years: 10 },
  { value: 'all', label: 'All', years: 50 },
]

const SECONDS_PER_DAY = 86400

function getRangeYears(range: string): number {
  const opt = RANGE_OPTIONS.find(o => o.value === range)
  return opt?.years ?? 1
}

// Ruleset type for price calculation
interface Ruleset {
  start: number
  duration: number
  weight: string
  weightCutPercent: number
}

// Calculate the issuance price at a specific timestamp
// Price = 1 / weight (after applying weight cuts for elapsed cycles)
function calculatePriceAtTimestamp(timestamp: number, rulesets: Ruleset[]): number | undefined {
  // Find the active ruleset for this timestamp
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

export default function PriceChart({
  projectId,
  chainId = '1',
  range: initialRange = '1y',
}: PriceChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [range, setRange] = useState(initialRange)
  const [rulesets, setRulesets] = useState<Ruleset[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tokenSymbol, setTokenSymbol] = useState('TOKEN')

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

        // Check if this is a Revnet - if so, fetch stages
        const projectIsRevnet = isRevnet(project.owner)
        let stageData: Stage[] = []

        if (projectIsRevnet) {
          const revnetStages = await fetchRevnetStages(projectId, parseInt(chainId))
          if (revnetStages && revnetStages.stages.length > 0) {
            // Convert Revnet stages to rulesets for price calculation
            const stageRulesets: Ruleset[] = revnetStages.stages.map((stage: RevnetStage) => ({
              start: stage.startsAtOrAfter,
              duration: stage.issuanceDecayFrequency,
              weight: stage.initialIssuance,
              weightCutPercent: stage.issuanceDecayPercent / 1e9, // Convert from basis points
            }))
            setRulesets(stageRulesets)

            // Build stage labels
            stageData = revnetStages.stages.map((s: RevnetStage, i: number) => ({
              name: `Stage ${i + 1}`,
              start: s.startsAtOrAfter,
            }))
            setStages(stageData)
            setLoading(false)
            return
          }
        }

        // For regular projects, fetch ruleset history
        const history = await fetchRulesetHistory(
          projectId,
          parseInt(chainId),
          project.currentRuleset.id || '1',
          50
        )

        if (history.length > 0) {
          const historyRulesets: Ruleset[] = history.map((r: RulesetHistoryEntry) => ({
            start: r.start,
            duration: r.duration,
            weight: r.weight,
            weightCutPercent: r.weightCutPercent / 1e9, // Convert from stored format
          }))
          setRulesets(historyRulesets)

          // Build cycle labels
          stageData = history.map((r: RulesetHistoryEntry) => ({
            name: `Cycle ${r.cycleNumber}`,
            start: r.start,
          }))
          setStages(stageData)
        } else {
          // Fallback to current ruleset only
          const current = project.currentRuleset
          setRulesets([{
            start: current.start || Math.floor(Date.now() / 1000) - 86400 * 30,
            duration: current.duration,
            weight: current.weight,
            weightCutPercent: parseFloat(current.decayPercent) / 1e9,
          }])
          setStages([{ name: 'Cycle 1', start: current.start || Math.floor(Date.now() / 1000) }])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load price data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [projectId, chainId])

  // Prepare chart data
  const { chartData, stageAreas, sortedStages, todayTimestamp, chartDomain } = useMemo(() => {
    if (rulesets.length === 0) {
      return { chartData: [], stageAreas: [], sortedStages: [], todayTimestamp: null, chartDomain: [0, 1] as [number, number] }
    }

    // Sort rulesets chronologically (oldest first) for price calculation
    const sortedRulesets = [...rulesets].sort((a, b) => a.start - b.start)

    const now = Math.floor(Date.now() / 1000)
    const projectStart = sortedRulesets[0].start // First ruleset start = project start
    const rangeSeconds = getRangeYears(range) * 365 * SECONDS_PER_DAY

    // Center "now" in the middle: always use symmetric range around now
    const desiredStart = now - rangeSeconds / 2
    const desiredEnd = now + rangeSeconds / 2

    // Data generation starts from project start (can't have data before project exists)
    const dataStart = Math.max(projectStart, desiredStart)
    const interval = SECONDS_PER_DAY * 10

    // Generate data points using sorted rulesets
    const dataPoints: { timestamp: number; price: number }[] = []
    for (let t = dataStart; t <= desiredEnd; t += interval) {
      const price = calculatePriceAtTimestamp(t, sortedRulesets)
      if (price !== undefined && isFinite(price)) {
        dataPoints.push({ timestamp: t, price })
      }
    }

    if (dataPoints.length === 0) {
      return { chartData: [], stageAreas: [], sortedStages: [], todayTimestamp: null, chartDomain: [0, 1] as [number, number] }
    }

    // Extend first data point back to chart start to fill dead space
    // Shows the initial issuance price for the period before project started
    if (dataPoints.length > 0 && dataPoints[0].timestamp > desiredStart) {
      dataPoints.unshift({
        timestamp: desiredStart,
        price: dataPoints[0].price,
      })
    }

    // Use timestamp directly as X (no visual scaling) - this keeps "now" centered
    const chartData: DataPoint[] = dataPoints.map(d => ({
      ...d,
      visualX: d.timestamp,
    }))

    // Chart domain is always centered on "now" for consistent positioning
    const chartDomain: [number, number] = [desiredStart, desiredEnd]

    // Sort stages chronologically (oldest first) for area calculation
    const sortedStages = [...stages].sort((a, b) => a.start - b.start)

    // Calculate stage areas using timestamps
    const stageAreas: StageArea[] = sortedStages
      .map((stage, i) => {
        const nextStart = sortedStages[i + 1]?.start ?? desiredEnd
        if (stage.start > desiredEnd || nextStart < desiredStart) return null
        return {
          ...stage,
          x1: Math.max(stage.start, desiredStart),
          x2: Math.min(nextStart, desiredEnd),
        }
      })
      .filter((a): a is StageArea => a !== null)

    return { chartData, stageAreas, sortedStages, todayTimestamp: now, chartDomain }
  }, [rulesets, stages, range])

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: DataPoint; value: number }> }) => {
    if (!active || !payload?.length) return null

    const data = payload[0]?.payload
    if (!data?.timestamp) return null

    // Find the most recent stage that has started (sortedStages is chronological, so filter and take last)
    const startedStages = sortedStages.filter((s: Stage) => data.timestamp >= s.start)
    const stage = startedStages.length > 0 ? startedStages[startedStages.length - 1] : null
    const value = payload[0].value

    return (
      <div className={`px-3 py-2 border shadow-lg text-sm ${
        isDark
          ? 'bg-zinc-900 border-zinc-700 text-white'
          : 'bg-white border-gray-200 text-gray-900'
      }`}>
        <div className={`text-xs mb-1 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
          {new Date(data.timestamp * 1000).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </div>
        {stage && (
          <div className={`text-xs mb-2 uppercase tracking-wider font-semibold ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
            {stage.name}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-400" />
          <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>Price:</span>
          <span className="font-mono">
            {value?.toFixed(6)} ETH / {tokenSymbol}
          </span>
        </div>
      </div>
    )
  }

  const formatYAxis = (value: number) => {
    if (value >= 1) return value.toFixed(2)
    if (value >= 0.001) return value.toFixed(4)
    return value.toExponential(2)
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
              Issuance Price Forecast
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Zoom out (longer range) */}
            <button
              onClick={() => {
                const idx = RANGE_OPTIONS.findIndex(o => o.value === range)
                if (idx < RANGE_OPTIONS.length - 1) {
                  setRange(RANGE_OPTIONS[idx + 1].value as RangeValue)
                }
              }}
              disabled={range === 'all'}
              className={`w-6 h-6 flex items-center justify-center text-sm transition-colors ${
                range === 'all'
                  ? isDark ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 cursor-not-allowed'
                  : isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
              title="Zoom out"
            >
              −
            </button>
            {/* Range options */}
            <div className="flex gap-1">
              {RANGE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setRange(opt.value as RangeValue)}
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
            {/* Zoom in (shorter range) */}
            <button
              onClick={() => {
                const idx = RANGE_OPTIONS.findIndex(o => o.value === range)
                if (idx > 0) {
                  setRange(RANGE_OPTIONS[idx - 1].value as RangeValue)
                }
              }}
              disabled={range === '3m'}
              className={`w-6 h-6 flex items-center justify-center text-sm transition-colors ${
                range === '3m'
                  ? isDark ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 cursor-not-allowed'
                  : isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
              title="Zoom in"
            >
              +
            </button>
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
                <AreaChart data={chartData} margin={{ left: 0, right: 12, top: 24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="visualX"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={12}
                    tickFormatter={(v) => {
                      const date = new Date(v * 1000)
                      // Short ranges: show month + day
                      if (range === '3m' || range === '6m') {
                        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      }
                      // Medium ranges: show month + year
                      if (range === '1y' || range === '2y' || range === '5y') {
                        return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                      }
                      // Long ranges: show year only
                      return date.getFullYear().toString()
                    }}
                    minTickGap={50}
                    type="number"
                    domain={chartDomain}
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

                  {/* Stage background areas - alternating subtle shading */}
                  {stageAreas.map((area, i) => (
                    <ReferenceArea
                      key={area.name}
                      x1={area.x1}
                      x2={area.x2}
                      fill={isDark
                        ? i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)'
                        : i % 2 === 0 ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.03)'
                      }
                      fillOpacity={1}
                    />
                  ))}

                  {/* Price area */}
                  <Area
                    type="stepAfter"
                    dataKey="price"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#priceFill)"
                    isAnimationActive={false}
                  />

                  {/* Stage boundary lines (no labels - labels are inside areas) */}
                  {stageAreas.slice(1).map((area) => (
                    <ReferenceLine
                      key={`line-${area.name}`}
                      x={area.x1}
                      stroke={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'}
                      strokeDasharray="3 3"
                    />
                  ))}

                  {/* Today indicator */}
                  {todayTimestamp !== null && (
                    <ReferenceLine
                      x={todayTimestamp}
                      stroke="#f59e0b"
                      strokeDasharray="4 4"
                      strokeWidth={1}
                      label={{
                        value: 'Today',
                        position: 'top',
                        fill: '#f59e0b',
                        fontSize: 10,
                      }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Footer with current price */}
        {!loading && !error && chartData.length > 0 && (() => {
          // Find the data point closest to "now"
          const now = Math.floor(Date.now() / 1000)
          const currentPoint = chartData.reduce((closest, point) =>
            Math.abs(point.timestamp - now) < Math.abs(closest.timestamp - now) ? point : closest
          , chartData[0])
          return (
            <div className={`px-4 py-2 text-xs border-t ${
              isDark ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-gray-50 border-gray-100 text-gray-500'
            }`}>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-400" />
                Current: {currentPoint?.price?.toFixed(6)} ETH / {tokenSymbol}
              </span>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
