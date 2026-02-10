import { useMemo, useState, useCallback } from 'react'
import { useThemeStore } from '../../../stores'

interface RedemptionCurveChartProps {
  /** Cash out tax rate in basis points (0-10000). 0 = linear, 10000 = full curve */
  cashOutTaxRate: number
  /** Total treasury balance in smallest unit */
  balance?: bigint
  /** Total token supply in smallest unit */
  supply?: bigint
  /** Number of tokens the user holds (for highlighting their position) */
  userTokens?: bigint
}

/**
 * Bonding curve chart showing % tokens cashed out vs % funds received.
 *
 * Formula: y = x * ((1 - r) + r * x)
 *
 * Where:
 * - x = fraction of tokens cashed out (0-1)
 * - r = cash out tax rate (0-1)
 * - y = fraction of funds received (0-1)
 *
 * At r=0 (linear): y = x (straight diagonal)
 * At r=1 (full curve): y = x² (quadratic)
 *
 * The curve always starts at (0,0) and ends at (1,1).
 */
export default function RedemptionCurveChart({
  cashOutTaxRate,
  userTokens,
  supply,
}: RedemptionCurveChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  // Convert tax rate from basis points (0-10000) to decimal (0-1)
  const r = cashOutTaxRate / 10000

  // Bonding curve formula: y = x * ((1 - r) + r * x)
  const calculateY = useCallback((x: number) => {
    return x * ((1 - r) + r * x)
  }, [r])

  // Generate curve points from origin to top-right
  const curvePoints = useMemo(() => {
    const points: { x: number; y: number }[] = []
    const STEPS = 50

    for (let i = 0; i <= STEPS; i++) {
      const x = i / STEPS
      const y = calculateY(x)
      points.push({ x, y })
    }

    return points
  }, [calculateY])

  // Chart dimensions
  const width = 200
  const height = 200
  const padding = { top: 4, right: 4, bottom: 4, left: 4 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // Scale functions (Y is inverted in SVG)
  const scaleX = (x: number) => padding.left + x * chartWidth
  const scaleY = (y: number) => padding.top + chartHeight - y * chartHeight

  // Generate SVG path
  const pathD = useMemo(() => {
    if (curvePoints.length === 0) return ''

    const first = curvePoints[0]
    let d = `M ${scaleX(first.x)} ${scaleY(first.y)}`

    for (let i = 1; i < curvePoints.length; i++) {
      const point = curvePoints[i]
      d += ` L ${scaleX(point.x)} ${scaleY(point.y)}`
    }

    return d
  }, [curvePoints])

  // Calculate user's position if they have tokens
  const userPosition = useMemo(() => {
    if (!userTokens || !supply || supply === 0n) return null

    const fraction = Number(userTokens) / Number(supply)
    if (fraction <= 0 || fraction > 1) return null

    const fundsReceived = calculateY(fraction)
    return {
      x: scaleX(fraction),
      y: scaleY(fundsReceived),
      tokenPercent: fraction * 100,
      fundsPercent: fundsReceived * 100,
    }
  }, [userTokens, supply, calculateY])

  // Hover state
  const [hoverFraction, setHoverFraction] = useState<number | null>(null)

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const x = e.clientX - rect.left

    const scale = width / rect.width
    const viewBoxX = x * scale
    const fraction = (viewBoxX - padding.left) / chartWidth

    if (fraction >= 0 && fraction <= 1) {
      setHoverFraction(fraction)
    } else {
      setHoverFraction(null)
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    setHoverFraction(null)
  }, [])

  // Calculate hover point
  const hoverPoint = useMemo(() => {
    if (hoverFraction === null) return null
    const fundsReceived = calculateY(hoverFraction)
    return {
      x: scaleX(hoverFraction),
      y: scaleY(fundsReceived),
      tokenPercent: hoverFraction * 100,
      fundsPercent: fundsReceived * 100,
    }
  }, [hoverFraction, calculateY])

  // Colors
  const curveColor = isDark ? '#22c55e' : '#16a34a'
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
  const textColor = isDark ? '#6b7280' : '#9ca3af'

  return (
    <div className="relative w-full max-w-[120px]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full select-none cursor-crosshair"
        style={{ height: 'auto', aspectRatio: '1' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Axes */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + chartHeight}
          stroke={gridColor}
          strokeWidth={1}
        />
        <line
          x1={padding.left}
          y1={padding.top + chartHeight}
          x2={padding.left + chartWidth}
          y2={padding.top + chartHeight}
          stroke={gridColor}
          strokeWidth={1}
        />

        {/* Diagonal reference (linear case) */}
        {r > 0.01 && (
          <line
            x1={scaleX(0)}
            y1={scaleY(0)}
            x2={scaleX(1)}
            y2={scaleY(1)}
            stroke={gridColor}
            strokeWidth={1}
            strokeDasharray="4,4"
          />
        )}

        {/* Fill under curve */}
        <path
          d={`${pathD} L ${scaleX(1)} ${scaleY(0)} L ${scaleX(0)} ${scaleY(0)} Z`}
          fill={curveColor}
          fillOpacity={0.15}
        />

        {/* The curve */}
        <path
          d={pathD}
          fill="none"
          stroke={curveColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* User position dot */}
        {userPosition && (
          <circle
            cx={userPosition.x}
            cy={userPosition.y}
            r={6}
            fill={curveColor}
            stroke={isDark ? '#000' : '#fff'}
            strokeWidth={2}
          />
        )}

        {/* Hover indicator */}
        {hoverPoint && (
          <circle
            cx={hoverPoint.x}
            cy={hoverPoint.y}
            r={5}
            fill={curveColor}
            stroke={isDark ? '#000' : '#fff'}
            strokeWidth={1.5}
          />
        )}

        {/* Corner labels */}
        <text x={padding.left + 2} y={padding.top + 10} fontSize={12} fill={textColor}>
          100%
        </text>
        <text x={padding.left + 2} y={height - padding.bottom - 2} fontSize={12} fill={textColor}>
          0
        </text>
        <text x={width - padding.right - 2} y={height - padding.bottom - 2} fontSize={12} fill={textColor} textAnchor="end">
          100%
        </text>
      </svg>

      {/* Tooltip */}
      {hoverPoint && (
        <div
          className={`absolute text-[9px] px-1.5 py-0.5 rounded shadow-lg pointer-events-none whitespace-nowrap ${
            isDark ? 'bg-gray-800 text-white' : 'bg-white text-gray-900 border border-gray-200'
          }`}
          style={{
            left: `${(hoverPoint.x / width) * 100}%`,
            top: `${(hoverPoint.y / height) * 100}%`,
            transform: 'translate(-50%, -120%)',
          }}
        >
          {hoverPoint.tokenPercent.toFixed(0)}% tokens → {hoverPoint.fundsPercent.toFixed(0)}% funds
        </div>
      )}
    </div>
  )
}
