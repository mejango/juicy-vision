import { useMemo, useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { useThemeStore } from '../../../stores'
import {
  activeStageIndexAt,
  formatIssuanceRate,
  issuanceAtTime,
  sortStagesByStart,
  type StageTerms,
} from '../../../services/revnetStages'
import { CHART_COLORS, formatYAxis } from './utils'

// Issuance schedule chart — port of the website's in-card schedule chart
// (discover.js renderIssuance :13354 + issuanceChartSvg :13463): a stepped
// projection of the issuance rate (tokens per base unit) across stages and
// cut cycles, with stage dividers, a "Today" marker, and 1Y/5Y/10Y/All range
// buttons. Rendered inside TermsTab's "Token issuance" card.

// ---------------------------------------------------------------------------
// Pure data shaping (unit-tested in charts.parity.test.tsx)
// ---------------------------------------------------------------------------

export const YEAR_SECONDS = 365 * 86400

export type ScheduleRange = '1y' | '5y' | '10y' | 'all'

export const SCHEDULE_RANGE_OPTIONS: { value: ScheduleRange; label: string; years: number }[] = [
  { value: '1y', label: '1Y', years: 1 },
  { value: '5y', label: '5Y', years: 5 },
  { value: '10y', label: '10Y', years: 10 },
  { value: 'all', label: 'All', years: 0 },
]

/**
 * Forward-looking window for the schedule, matching the website's
 * priceChartTimeBounds (:13414) projection branch: start at the earlier of
 * the first stage start and now; end `years` from now, or 5 years past the
 * last stage start for "All". Always spans at least a year.
 */
export function scheduleTimeBounds(
  firstStart: number,
  lastStart: number,
  now: number,
  years: number,
): { t0: number; t1: number } {
  const t0 = Math.min(firstStart, now)
  let t1 = years > 0 ? now + years * YEAR_SECONDS : lastStart + 5 * YEAR_SECONDS
  if (t1 <= t0) t1 = t0 + YEAR_SECONDS
  return { t0, t1 }
}

export interface SchedulePoint {
  timestamp: number
  rate: number
}

/**
 * Merge every stage's cut cycles into one stepped issuance-rate series over
 * [t0, t1]. A point is emitted at each boundary (window edges, stage starts,
 * and cut times) carrying the rate that takes effect there, so a stepAfter
 * line renders exact steps. Dense schedules are thinned to ~maxPoints while
 * always keeping the window edges and stage starts.
 */
export function buildIssuanceStepSeries(
  stages: readonly StageTerms[],
  t0: number,
  t1: number,
  maxPoints = 800,
): SchedulePoint[] {
  if (stages.length === 0 || t1 <= t0) return []
  const sorted = sortStagesByStart(stages)
  const hardCap = maxPoints * 4
  const times = new Set<number>([t0, t1])

  for (let i = 0; i < sorted.length && times.size < hardCap; i++) {
    const stage = sorted[i]
    if (stage.start > t0 && stage.start < t1) times.add(stage.start)
    if (stage.duration <= 0 || stage.weightCutPercent <= 0) continue

    // Cut boundaries inside this stage's active window, clipped to [t0, t1].
    const stageEnd = Math.min(i + 1 < sorted.length ? sorted[i + 1].start : t1, t1)
    const from = Math.max(stage.start, t0)
    const firstCut = Math.max(1, Math.ceil((from - stage.start) / stage.duration))
    for (let k = firstCut; times.size < hardCap; k++) {
      const cut = stage.start + k * stage.duration
      if (cut >= stageEnd) break
      times.add(cut)
    }
  }

  let boundaries = [...times].sort((a, b) => a - b)
  if (boundaries.length > maxPoints) {
    const keep = new Set<number>([t0, t1])
    for (const stage of sorted) {
      if (stage.start > t0 && stage.start < t1) keep.add(stage.start)
    }
    const step = Math.ceil(boundaries.length / maxPoints)
    boundaries = boundaries.filter((t, index) => index % step === 0 || keep.has(t))
  }

  return boundaries.map(t => ({ timestamp: t, rate: issuanceAtTime(sorted, t) }))
}

/** Axis tick for a window spanning `span` seconds (website priceChartAxisLabel :13434). */
export function formatScheduleTick(timestamp: number, span: number): string {
  const date = new Date(timestamp * 1000)
  if (span < YEAR_SECONDS) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  if (span < 2 * YEAR_SECONDS) {
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  }
  return String(date.getFullYear())
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface IssuanceScheduleChartProps {
  /** The revnet's stage terms (any order; sorted internally). */
  stages: StageTerms[]
  /** Project token symbol, e.g. "REV". */
  tokenSymbol: string
  /** Base unit the rate is quoted per, e.g. "ETH". */
  unit: string
}

export default function IssuanceScheduleChart({
  stages,
  tokenSymbol,
  unit,
}: IssuanceScheduleChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [range, setRange] = useState<ScheduleRange>('1y')

  const now = useMemo(() => Math.floor(Date.now() / 1000), [])

  const { chartData, bounds, sortedStages } = useMemo(() => {
    const sorted = sortStagesByStart(stages)
    if (sorted.length === 0) {
      return { chartData: [] as SchedulePoint[], bounds: { t0: 0, t1: 1 }, sortedStages: sorted }
    }
    const years = SCHEDULE_RANGE_OPTIONS.find(option => option.value === range)?.years ?? 1
    const timeBounds = scheduleTimeBounds(
      sorted[0].start,
      sorted[sorted.length - 1].start,
      now,
      years,
    )
    return {
      chartData: buildIssuanceStepSeries(sorted, timeBounds.t0, timeBounds.t1),
      bounds: timeBounds,
      sortedStages: sorted,
    }
  }, [stages, range, now])

  const span = bounds.t1 - bounds.t0
  const stageDividers = sortedStages
    .map((stage, index) => ({ start: stage.start, name: `Stage ${index + 1}` }))
    .filter(stage => stage.start > bounds.t0 && stage.start < bounds.t1)

  const CustomTooltip = ({ active, payload }: {
    active?: boolean
    payload?: Array<{ payload: SchedulePoint; value: number }>
  }) => {
    if (!active || !payload?.length) return null
    const data = payload[0]?.payload
    if (!data?.timestamp) return null
    const stageIndex = activeStageIndexAt(sortedStages, data.timestamp)

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
        <div className={`text-xs mb-2 uppercase tracking-wider font-semibold ${
          isDark ? 'text-zinc-500' : 'text-gray-400'
        }`}>
          Stage {stageIndex + 1}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2" style={{ backgroundColor: CHART_COLORS.issuance }} />
          <span className={isDark ? 'text-zinc-400' : 'text-gray-500'}>Issuance:</span>
          <span className="font-mono">
            {formatIssuanceRate(data.rate)} {tokenSymbol} / {unit}
          </span>
        </div>
      </div>
    )
  }

  if (chartData.length === 0) return null

  return (
    <div className="w-full">
      {/* Range selector */}
      <div className="flex justify-end gap-1">
        {SCHEDULE_RANGE_OPTIONS.map(option => (
          <button
            key={option.value}
            onClick={() => setRange(option.value)}
            className={`px-2 py-0.5 text-xs transition-colors ${
              range === option.value
                ? isDark ? 'bg-white/10 text-white' : 'bg-gray-200 text-gray-900'
                : isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="mt-1 h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ left: 0, right: 12, top: 24, bottom: 0 }}>
            <defs>
              <linearGradient id="issuanceScheduleFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.issuance} stopOpacity={0.3} />
                <stop offset="100%" stopColor={CHART_COLORS.issuance} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={isDark ? CHART_COLORS.grid : CHART_COLORS.gridLight}
              vertical={false}
            />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={[bounds.t0, bounds.t1]}
              tickLine={false}
              axisLine={false}
              tickMargin={12}
              tickFormatter={value => formatScheduleTick(value, span)}
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
              domain={[0, 'auto']}
              stroke={isDark ? '#666' : '#999'}
              fontSize={11}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Issuance rate steps */}
            <Area
              type="stepAfter"
              dataKey="rate"
              stroke={CHART_COLORS.issuance}
              strokeWidth={2}
              fill="url(#issuanceScheduleFill)"
              isAnimationActive={false}
            />

            {/* Stage dividers */}
            {stageDividers.map(stage => (
              <ReferenceLine
                key={stage.name}
                x={stage.start}
                stroke={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'}
                strokeDasharray="3 3"
                label={{
                  value: stage.name,
                  position: 'insideTopLeft',
                  fill: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
                  fontSize: 10,
                }}
              />
            ))}

            {/* Today marker */}
            {now > bounds.t0 && now < bounds.t1 && (
              <ReferenceLine
                x={now}
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
    </div>
  )
}
