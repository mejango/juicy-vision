import { useMemo } from 'react'
import { useThemeStore } from '../../../stores'

interface RedemptionCurveChartProps {
  /** Cash out tax rate in basis points (0-10000). 0 = no tax, 10000 = 100% tax */
  cashOutTaxRate: number
  /** Total treasury balance in smallest unit */
  balance?: bigint
  /** Total token supply in smallest unit */
  supply?: bigint
  /** Number of tokens the user holds (for highlighting their position) */
  userTokens?: bigint
}

/**
 * Mini inline SVG chart showing the redemption curve.
 *
 * The bonding curve formula:
 * y = (o * x / s) * ((1 - r) + (r * x / s))
 *
 * Where:
 * - o = treasury balance
 * - s = total supply
 * - x = tokens being cashed out
 * - r = cash out tax rate (0-1, where 1 means 100% tax = no redemption)
 *
 * This visualizes how cashing out many tokens at once returns less per token
 * than cashing out one at a time (due to the bonding curve mechanics).
 */
export default function RedemptionCurveChart({
  cashOutTaxRate,
  balance,
  supply,
  userTokens,
}: RedemptionCurveChartProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  // Convert tax rate from basis points (0-10000) to decimal (0-1)
  // r = 0 means linear (no tax), r = 1 means 100% tax (no redemption)
  const r = cashOutTaxRate / 10000

  // Generate curve points
  const curvePoints = useMemo(() => {
    const points: { x: number; y: number }[] = []
    const STEPS = 50

    // For each percentage of supply cashed out (0% to 100%)
    for (let i = 0; i <= STEPS; i++) {
      const fraction = i / STEPS // 0 to 1 (percentage of supply)

      // Calculate value per token at this point using the bonding curve formula
      // Simplified: when cashing out fraction f of supply, you get:
      // valuePerToken = (1 - r) + (r * f)
      // where r is the tax rate
      //
      // At f=0 (cashing out tiny amount): valuePerToken = 1 - r
      // At f=1 (cashing out everything): valuePerToken = 1
      const valuePerToken = (1 - r) + (r * fraction)

      points.push({
        x: fraction,
        y: valuePerToken,
      })
    }

    return points
  }, [r])

  // Chart dimensions
  const width = 200
  const height = 80
  const padding = { top: 8, right: 8, bottom: 16, left: 24 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // Scale functions
  const scaleX = (x: number) => padding.left + x * chartWidth
  const scaleY = (y: number) => padding.top + chartHeight - (y * chartHeight)

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

    const valuePerToken = (1 - r) + (r * fraction)
    return {
      x: scaleX(fraction),
      y: scaleY(valuePerToken),
      fraction,
      valuePerToken,
    }
  }, [userTokens, supply, r])

  // Colors
  const curveColor = isDark ? '#22c55e' : '#16a34a' // green-500/green-600
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'
  const textColor = isDark ? '#9ca3af' : '#6b7280' // gray-400/gray-500
  const userDotColor = '#22c55e'

  // Calculate the retention percentage (what you get per token if cashing out 1 token)
  const minRetention = (1 - r) * 100 // At smallest redemption
  const maxRetention = 100 // At 100% redemption

  return (
    <div className="flex flex-col">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="select-none"
      >
        {/* Grid lines */}
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

        {/* Horizontal grid lines at 25%, 50%, 75% */}
        {[0.25, 0.5, 0.75].map((y) => (
          <line
            key={y}
            x1={padding.left}
            y1={scaleY(y)}
            x2={padding.left + chartWidth}
            y2={scaleY(y)}
            stroke={gridColor}
            strokeWidth={1}
            strokeDasharray="2,2"
          />
        ))}

        {/* The curve */}
        <path
          d={pathD}
          fill="none"
          stroke={curveColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Fill under the curve */}
        <path
          d={`${pathD} L ${scaleX(1)} ${padding.top + chartHeight} L ${scaleX(0)} ${padding.top + chartHeight} Z`}
          fill={curveColor}
          fillOpacity={0.1}
        />

        {/* User position dot */}
        {userPosition && (
          <circle
            cx={userPosition.x}
            cy={userPosition.y}
            r={4}
            fill={userDotColor}
            stroke={isDark ? '#000' : '#fff'}
            strokeWidth={1.5}
          />
        )}

        {/* X-axis labels */}
        <text
          x={padding.left}
          y={height - 2}
          fontSize={9}
          fill={textColor}
          textAnchor="start"
        >
          0%
        </text>
        <text
          x={padding.left + chartWidth}
          y={height - 2}
          fontSize={9}
          fill={textColor}
          textAnchor="end"
        >
          100%
        </text>

        {/* Y-axis labels */}
        <text
          x={padding.left - 4}
          y={padding.top + chartHeight}
          fontSize={9}
          fill={textColor}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {minRetention.toFixed(0)}%
        </text>
        <text
          x={padding.left - 4}
          y={padding.top}
          fontSize={9}
          fill={textColor}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {maxRetention}%
        </text>
      </svg>

      {/* Legend */}
      <div className={`flex items-center justify-between text-[10px] px-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        <span>% of supply redeemed →</span>
        <span>value/token ↑</span>
      </div>
    </div>
  )
}
