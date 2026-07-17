import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  YEAR_SECONDS,
  SCHEDULE_RANGE_OPTIONS,
  scheduleTimeBounds,
  buildIssuanceStepSeries,
  formatScheduleTick,
} from './IssuanceScheduleChart'
import IssuanceScheduleChart from './IssuanceScheduleChart'
import { filterToRange, getRangeStartTimestamp } from './utils'
import { issuanceAtTime, nextCutAt, type StageTerms } from '../../../services/revnetStages'
import { useThemeStore } from '../../../stores'

// Mock recharts so the smoke test exercises data flow, not pixels.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => <div data-testid="area" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ReferenceLine: () => <div data-testid="reference-line" />,
}))

const DAY = 86400

// A two-stage revnet schedule: stage 1 cuts 10% every 30 days, stage 2 is
// perpetual at half the initial rate.
const T0 = 1_700_000_000
const stage1: StageTerms = {
  start: T0,
  duration: 30 * DAY,
  weight: (1000n * 10n ** 18n).toString(), // 1000 tokens per unit
  weightCutPercent: 100_000_000, // 10% (out of 1e9)
}
const stage2: StageTerms = {
  start: T0 + 100 * DAY,
  duration: 0,
  weight: (500n * 10n ** 18n).toString(),
  weightCutPercent: 0,
}
const stages = [stage1, stage2]

describe('scheduleTimeBounds', () => {
  const now = T0 + 10 * DAY

  it('spans from min(firstStart, now) to now + years for fixed ranges', () => {
    const bounds = scheduleTimeBounds(T0, stage2.start, now, 1)
    expect(bounds.t0).toBe(T0)
    expect(bounds.t1).toBe(now + YEAR_SECONDS)
  })

  it('starts at now when the first stage has not begun yet', () => {
    const future = T0 - 5 * DAY
    const bounds = scheduleTimeBounds(T0, stage2.start, future, 1)
    expect(bounds.t0).toBe(future)
  })

  it('extends 5 years past the last stage start for the All range', () => {
    const bounds = scheduleTimeBounds(T0, stage2.start, now, 0)
    expect(bounds.t1).toBe(stage2.start + 5 * YEAR_SECONDS)
  })

  it('always keeps a drawable window of at least a year', () => {
    // Last stage started long ago: All would collapse without the guard.
    const lateNow = T0 + 20 * YEAR_SECONDS
    const bounds = scheduleTimeBounds(T0, T0, lateNow, 0)
    expect(bounds.t1).toBeGreaterThan(bounds.t0)
    expect(bounds.t1 - bounds.t0).toBeGreaterThanOrEqual(YEAR_SECONDS)
  })
})

describe('buildIssuanceStepSeries', () => {
  it('returns an empty series without stages or with an inverted window', () => {
    expect(buildIssuanceStepSeries([], T0, T0 + DAY)).toEqual([])
    expect(buildIssuanceStepSeries(stages, T0 + DAY, T0)).toEqual([])
  })

  it('renders a perpetual stage as a flat two-point series', () => {
    const series = buildIssuanceStepSeries([stage2], stage2.start, stage2.start + YEAR_SECONDS)
    expect(series).toHaveLength(2)
    expect(series[0].rate).toBe(500)
    expect(series[1].rate).toBe(500)
  })

  it('emits a boundary at every cut with the compounding decayed rate', () => {
    const t1 = T0 + 95 * DAY // 3 cuts inside stage 1 (days 30, 60, 90)
    const series = buildIssuanceStepSeries([stage1], T0, t1)
    const timestamps = series.map(p => p.timestamp)
    expect(timestamps).toEqual([
      T0,
      T0 + 30 * DAY,
      T0 + 60 * DAY,
      T0 + 90 * DAY,
      t1,
    ])
    const rates = series.map(p => p.rate)
    expect(rates[0]).toBe(1000)
    expect(rates[1]).toBeCloseTo(900, 6)
    expect(rates[2]).toBeCloseTo(810, 6)
    expect(rates[3]).toBeCloseTo(729, 6)
    // The window edge continues the last step (stepAfter holds it flat).
    expect(rates[4]).toBeCloseTo(729, 6)
  })

  it('agrees with issuanceAtTime/nextCutAt at each cut boundary', () => {
    const t1 = T0 + 95 * DAY
    const series = buildIssuanceStepSeries([stage1], T0, t1)
    // The first cut the series emits is exactly where nextCutAt points from T0.
    const firstCut = nextCutAt(stage1, T0)
    expect(series[1].timestamp).toBe(firstCut)
    // Every emitted rate is the canonical issuance at that instant.
    for (const point of series) {
      expect(point.rate).toBeCloseTo(issuanceAtTime([stage1], point.timestamp), 9)
    }
  })

  it('merges stages: the stage-2 start boundary switches to the new weight', () => {
    const t1 = stage2.start + 10 * DAY
    const series = buildIssuanceStepSeries(stages, T0, t1)
    const atStage2 = series.find(p => p.timestamp === stage2.start)
    expect(atStage2).toBeDefined()
    expect(atStage2!.rate).toBe(500)
    // No stage-1 cut boundaries leak past the stage-2 start (day 120 cut is clipped).
    expect(series.some(p => p.timestamp > stage2.start && p.rate !== 500)).toBe(false)
    // Rates before the switch are stage-1 decayed values.
    const beforeSwitch = series.filter(p => p.timestamp < stage2.start)
    expect(beforeSwitch[0].rate).toBe(1000)
    expect(beforeSwitch[beforeSwitch.length - 1].rate).toBeCloseTo(729, 6)
  })

  it('clips to a window opening mid-stage with the already-decayed rate', () => {
    const from = T0 + 45 * DAY // one cut already elapsed
    const series = buildIssuanceStepSeries([stage1], from, T0 + 65 * DAY)
    expect(series[0].timestamp).toBe(from)
    expect(series[0].rate).toBeCloseTo(900, 6)
    // Only the day-60 cut falls inside the window.
    expect(series.filter(p => p.timestamp > from && p.timestamp < T0 + 65 * DAY))
      .toHaveLength(1)
  })

  it('thins dense schedules but keeps window edges and stage starts', () => {
    const daily: StageTerms = { ...stage1, duration: DAY } // ~3650 cuts over 10y
    const t1 = T0 + 10 * YEAR_SECONDS
    const series = buildIssuanceStepSeries([daily, stage2], T0, t1, 200)
    expect(series.length).toBeLessThanOrEqual(2 * 200)
    expect(series[0].timestamp).toBe(T0)
    expect(series[series.length - 1].timestamp).toBe(t1)
    expect(series.some(p => p.timestamp === stage2.start)).toBe(true)
    // Monotonic time.
    for (let i = 1; i < series.length; i++) {
      expect(series[i].timestamp).toBeGreaterThan(series[i - 1].timestamp)
    }
  })
})

describe('range filtering (shared chart utils)', () => {
  const now = Math.floor(Date.now() / 1000)
  const points = [
    { timestamp: now - 400 * DAY, value: 1 },
    { timestamp: now - 20 * DAY, value: 2 },
    { timestamp: now - 2 * DAY, value: 3 },
  ]

  it('7d keeps only the last week', () => {
    expect(filterToRange(points, '7d').map(p => p.value)).toEqual([3])
  })

  it('30d keeps the last month', () => {
    expect(filterToRange(points, '30d').map(p => p.value)).toEqual([2, 3])
  })

  it('all keeps everything', () => {
    expect(getRangeStartTimestamp('all')).toBe(0)
    expect(filterToRange(points, 'all')).toHaveLength(3)
  })
})

describe('formatScheduleTick', () => {
  const ts = Date.UTC(2026, 6, 16) / 1000

  it('uses month + day inside a year window', () => {
    expect(formatScheduleTick(ts, YEAR_SECONDS - 1)).toMatch(/Jul \d+/)
  })

  it('uses month + year inside a two-year window', () => {
    expect(formatScheduleTick(ts, 1.5 * YEAR_SECONDS)).toMatch(/Jul \d{2}/)
  })

  it('uses the year alone for long windows', () => {
    expect(formatScheduleTick(ts, 3 * YEAR_SECONDS)).toBe('2026')
  })
})

describe('IssuanceScheduleChart (smoke)', () => {
  it('renders the chart with range buttons and stage/today markers', () => {
    useThemeStore.setState({ theme: 'dark' })
    render(<IssuanceScheduleChart stages={stages} tokenSymbol="REV" unit="ETH" />)

    expect(screen.getByTestId('area-chart')).toBeInTheDocument()
    for (const option of SCHEDULE_RANGE_OPTIONS) {
      expect(screen.getByText(option.label)).toBeInTheDocument()
    }
    // Range switching re-renders without crashing.
    fireEvent.click(screen.getByText('All'))
    expect(screen.getByTestId('area-chart')).toBeInTheDocument()
  })

  it('renders nothing without stages', () => {
    useThemeStore.setState({ theme: 'dark' })
    const { container } = render(
      <IssuanceScheduleChart stages={[]} tokenSymbol="REV" unit="ETH" />,
    )
    expect(container.firstChild).toBeNull()
  })
})
