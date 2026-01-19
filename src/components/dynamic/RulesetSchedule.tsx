import { useState, useEffect, useMemo } from 'react'
import { useWallet } from '@getpara/react-sdk'
import { useThemeStore } from '../../stores'
import {
  fetchProjectWithRuleset,
  fetchProjectTokenSymbol,
  fetchConnectedChains,
  isRevnet,
  fetchRevnetOperator,
  fetchRevnetStages,
  fetchQueuedRulesets,
  fetchRulesetHistory,
  fetchProjectSplits,
  fetchPendingReservedTokens,
  type ProjectRuleset,
  type RevnetStage,
  type RulesetHistoryEntry,
  type JBSplitData,
  type FundAccessLimits,
  type ConnectedChain,
  type ProjectSplitsData,
} from '../../services/bendystraw'
import { resolveEnsName, truncateAddress } from '../../utils/ens'

// Chain info for display
const CHAIN_INFO: Record<number, { name: string; shortName: string; color: string }> = {
  1: { name: 'Ethereum', shortName: 'ETH', color: '#627EEA' },
  10: { name: 'Optimism', shortName: 'OP', color: '#FF0420' },
  8453: { name: 'Base', shortName: 'BASE', color: '#0052FF' },
  42161: { name: 'Arbitrum', shortName: 'ARB', color: '#28A0F0' },
}

// Per-chain ruleset data
interface ChainRuleset {
  chainId: number
  projectId: number
  ruleset: ProjectRuleset | null
  splits: ProjectSplitsData
  pendingReserved: string
  owner: string
  projectName: string
}

// Omnichain state
interface OmnichainRulesetState {
  isOmnichain: boolean           // Has >1 chain
  rulesetsMatch: boolean         // All rulesets identical (core params)
  differences: string[]          // List of differing fields
  chainRulesets: ChainRuleset[]  // Per-chain data
  selectedChainId: number | null // For per-chain view (null = unified)
}

interface RulesetScheduleProps {
  projectId: string
  chainId?: string
}

// Format duration in human readable form
function formatDuration(seconds: number) {
  if (seconds === 0) return 'Forever'
  const days = Math.floor(seconds / 86400)
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`
  const hours = Math.floor(seconds / 3600)
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} minute${minutes !== 1 ? 's' : ''}`
}

// Format remaining time as countdown
function formatRemainingTime(seconds: number) {
  if (seconds <= 0) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// Format basis points to percentage
function formatPercent(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`
}

// Format issuance weight to tokens per base currency (ETH or USD)
function formatIssuance(weight: string, tokenSymbol: string, baseCurrency: number = 1) {
  try {
    const num = parseFloat(weight) / 1e18
    const currencyLabel = baseCurrency === 2 ? 'USD' : 'ETH'
    // Show more precision for nuanced numbers
    if (num >= 1e9) return `${(num / 1e9).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}B ${tokenSymbol}/${currencyLabel}`
    if (num >= 1e6) return `${(num / 1e6).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}M ${tokenSymbol}/${currencyLabel}`
    if (num >= 1e3) return `${(num / 1e3).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}K ${tokenSymbol}/${currencyLabel}`
    if (num >= 1) return `${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${tokenSymbol}/${currencyLabel}`
    return `${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} ${tokenSymbol}/${currencyLabel}`
  } catch {
    return weight
  }
}

// Format decay rate with cycle duration
function formatDecay(decayPercent: string, duration: number) {
  const decay = parseFloat(decayPercent) / 1e9 * 100
  if (decay === 0) return '0%'
  const days = Math.floor(duration / 86400)
  if (days > 0) {
    return `${decay.toFixed(2)}% every ${days} day${days !== 1 ? 's' : ''}`
  }
  return `${decay.toFixed(2)}%`
}

// Compare two rulesets and return list of differing fields
function compareRulesets(r1: ProjectRuleset | null, r2: ProjectRuleset | null): string[] {
  if (!r1 && !r2) return []
  if (!r1 || !r2) return ['ruleset'] // One has ruleset, one doesn't

  const differences: string[] = []

  // Compare core ruleset parameters
  if (r1.duration !== r2.duration) differences.push('duration')
  if (r1.weight !== r2.weight) differences.push('issuance')
  if (r1.decayPercent !== r2.decayPercent) differences.push('decay')
  if (r1.reservedPercent !== r2.reservedPercent) differences.push('reservedPercent')
  if (r1.cashOutTaxRate !== r2.cashOutTaxRate) differences.push('cashOutTaxRate')
  if (r1.pausePay !== r2.pausePay) differences.push('pausePay')
  if (r1.allowOwnerMinting !== r2.allowOwnerMinting) differences.push('allowOwnerMinting')
  if (r1.baseCurrency !== r2.baseCurrency) differences.push('baseCurrency')

  return differences
}

// Compare all chain rulesets and find differences
function findOmnichainDifferences(chainRulesets: ChainRuleset[]): { match: boolean; differences: string[] } {
  if (chainRulesets.length <= 1) return { match: true, differences: [] }

  const first = chainRulesets[0]
  const allDifferences = new Set<string>()

  for (let i = 1; i < chainRulesets.length; i++) {
    const diffs = compareRulesets(first.ruleset, chainRulesets[i].ruleset)
    diffs.forEach(d => allDifferences.add(d))
  }

  return {
    match: allDifferences.size === 0,
    differences: Array.from(allDifferences),
  }
}

// Generate a high-level summary of the project based on ruleset data
// Oriented towards action items: contributing, cashing out, holding
interface JuicySummaryInput {
  ruleset: ProjectRuleset | null
  upcomingRuleset: RulesetHistoryEntry | null
  isRevnet: boolean
  isUnlocked: boolean
  isOmnichain: boolean
  tokenSymbol: string
  remainingSeconds: number
  chainCount: number
  baseCurrency: number // 1 = ETH, 2 = USD
}

interface JuicySummaryOutput {
  tagline: string // One-liner about what kind of project this is
  actionItems: Array<{
    action: 'contribute' | 'cash-out' | 'hold' | 'wait' | 'caution'
    message: string
    urgency?: 'now' | 'soon' | 'info'
  }>
  upcomingChange: string | null // Alert about upcoming ruleset change
}

function generateJuicySummary(input: JuicySummaryInput): JuicySummaryOutput {
  const {
    ruleset,
    upcomingRuleset,
    isRevnet,
    isUnlocked,
    isOmnichain,
    tokenSymbol,
    remainingSeconds,
    chainCount,
    baseCurrency,
  } = input

  const actionItems: JuicySummaryOutput['actionItems'] = []
  let upcomingChange: string | null = null

  if (!ruleset) {
    return {
      tagline: 'Project not configured',
      actionItems: [{ action: 'caution', message: 'No active ruleset - payments may not be accepted', urgency: 'info' }],
      upcomingChange: null,
    }
  }

  // Determine tagline based on project type
  let tagline = ''
  const currencyLabel = baseCurrency === 2 ? 'USD' : 'ETH'
  const issuanceNum = parseFloat(ruleset.weight) / 1e18
  const issuanceStr = issuanceNum >= 1e6
    ? `${(issuanceNum / 1e6).toFixed(1)}M`
    : issuanceNum >= 1e3
      ? `${(issuanceNum / 1e3).toFixed(1)}K`
      : issuanceNum.toFixed(0)

  if (isRevnet) {
    tagline = `Autonomous Revnet${isOmnichain ? ` across ${chainCount} chains` : ''} - immutable rules, no owner control`
  } else if (isUnlocked) {
    tagline = `Unlocked project${isOmnichain ? ` on ${chainCount} chains` : ''} - rules can change anytime`
  } else {
    const days = Math.floor(ruleset.duration / 86400)
    tagline = `${days > 0 ? `${days}-day` : 'Timed'} cycles${isOmnichain ? ` across ${chainCount} chains` : ''} - rules locked until cycle ends`
  }

  // Analyze upcoming ruleset changes
  if (upcomingRuleset) {
    const currentIssuance = parseFloat(ruleset.weight)
    const nextIssuance = parseFloat(upcomingRuleset.weight)

    if (nextIssuance !== currentIssuance) {
      const changePercent = ((nextIssuance - currentIssuance) / currentIssuance * 100).toFixed(1)
      const direction = nextIssuance < currentIssuance ? 'decreases' : 'increases'
      const timeUntil = remainingSeconds > 0 ? formatRemainingTime(remainingSeconds) : 'soon'
      upcomingChange = `Issuance ${direction} ${Math.abs(parseFloat(changePercent))}% in ${timeUntil}`
    } else if (upcomingRuleset.cashOutTaxRate !== undefined && upcomingRuleset.cashOutTaxRate !== ruleset.cashOutTaxRate) {
      const timeUntil = remainingSeconds > 0 ? formatRemainingTime(remainingSeconds) : 'soon'
      upcomingChange = `Cash out rate changes in ${timeUntil}`
    } else if (upcomingRuleset.reservedPercent !== undefined && upcomingRuleset.reservedPercent !== ruleset.reservedPercent) {
      const timeUntil = remainingSeconds > 0 ? formatRemainingTime(remainingSeconds) : 'soon'
      upcomingChange = `Reserved rate changes in ${timeUntil}`
    }
  }

  // Payment status
  if (ruleset.pausePay) {
    actionItems.push({ action: 'caution', message: 'Payments currently paused', urgency: 'info' })
  }

  // Contributing - issuance rate action item
  const decay = parseFloat(ruleset.decayPercent) / 1e9 * 100
  if (!ruleset.pausePay) {
    if (decay > 0 && upcomingRuleset) {
      // Issuance is decreasing - urgency to contribute now
      actionItems.push({
        action: 'contribute',
        message: `Contributing now: ${issuanceStr} ${tokenSymbol}/${currencyLabel}. Rate drops ${decay.toFixed(1)}% next cycle.`,
        urgency: 'now',
      })
    } else if (decay > 0) {
      actionItems.push({
        action: 'contribute',
        message: `Current rate: ${issuanceStr} ${tokenSymbol}/${currencyLabel}, decreasing ${decay.toFixed(1)}% each cycle`,
        urgency: 'soon',
      })
    } else {
      actionItems.push({
        action: 'contribute',
        message: `Current rate: ${issuanceStr} ${tokenSymbol}/${currencyLabel}`,
        urgency: 'info',
      })
    }
  }

  // Cash out - redemption value using bonding curve formula
  // Formula: y = x * ((1 - r) + (r * x)) where x = % of supply, r = tax rate, y = % of treasury
  const cashOutTaxRate = ruleset.cashOutTaxRate / 10000 // Convert basis points to 0-1
  if (cashOutTaxRate >= 1) {
    actionItems.push({ action: 'caution', message: 'Cash outs disabled - tokens cannot be redeemed', urgency: 'info' })
  } else if (cashOutTaxRate > 0) {
    // Calculate what cashing out 10% of supply would return
    const x = 0.1 // 10% of supply
    const y = x * ((1 - cashOutTaxRate) + (cashOutTaxRate * x))
    const returnPercent = (y * 100).toFixed(1)
    actionItems.push({
      action: 'cash-out',
      message: `Cashing out 10% of ${tokenSymbol} gets ~${returnPercent}% of treasury`,
      urgency: 'info',
    })
  } else {
    actionItems.push({
      action: 'cash-out',
      message: 'Full proportional treasury redemption (no exit tax)',
      urgency: 'info',
    })
  }

  // Reserved rate note
  const reservedPercent = ruleset.reservedPercent / 100
  if (reservedPercent > 50) {
    actionItems.push({
      action: 'caution',
      message: `${reservedPercent}% of new tokens reserved for project recipients`,
      urgency: 'info',
    })
  }

  // Trust warnings for non-Revnets
  if (!isRevnet) {
    if (isUnlocked) {
      actionItems.push({
        action: 'caution',
        message: 'Owner can change rules without notice - verify trust before contributing',
        urgency: 'now',
      })
    }
    if (ruleset.allowOwnerMinting) {
      actionItems.push({
        action: 'caution',
        message: 'Owner can mint tokens without payment',
        urgency: 'info',
      })
    }
  }

  // Transfer restrictions
  if (ruleset.pauseCreditTransfers) {
    actionItems.push({ action: 'caution', message: 'Token transfers paused', urgency: 'info' })
  }

  return { tagline, actionItems, upcomingChange }
}

// Chain tab component for omnichain selector
function ChainTab({
  chainId,
  isSelected,
  onClick,
  isDark,
  showBadge = false,
}: {
  chainId: number
  isSelected: boolean
  onClick: () => void
  isDark: boolean
  showBadge?: boolean
}) {
  const chain = CHAIN_INFO[chainId] || { name: `Chain ${chainId}`, shortName: String(chainId), color: '#888888' }
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium transition-colors relative ${
        isSelected
          ? isDark
            ? 'bg-white/10 text-white'
            : 'bg-gray-100 text-gray-900'
          : isDark
            ? 'text-gray-400 hover:text-white hover:bg-white/5'
            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
      }`}
      style={{
        borderBottom: isSelected ? `2px solid ${chain.color}` : '2px solid transparent',
      }}
    >
      <span className="flex items-center gap-1.5">
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: chain.color }}
        />
        {chain.shortName}
        {showBadge && (
          <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" title="Differs from other chains" />
        )}
      </span>
    </button>
  )
}

// Unified/All chains tab for omnichain selector
function UnifiedTab({
  isSelected,
  onClick,
  isDark,
  hasDifferences,
}: {
  isSelected: boolean
  onClick: () => void
  isDark: boolean
  hasDifferences: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
        isSelected
          ? isDark
            ? 'bg-white/10 text-white border-b-2 border-juice-orange'
            : 'bg-gray-100 text-gray-900 border-b-2 border-orange-500'
          : isDark
            ? 'text-gray-400 hover:text-white hover:bg-white/5 border-b-2 border-transparent'
            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50 border-b-2 border-transparent'
      }`}
    >
      <span className="flex items-center gap-1.5">
        All
        {hasDifferences && (
          <span className="text-amber-400" title="Some values differ across chains">⚠</span>
        )}
      </span>
    </button>
  )
}

// Small chain badge for indicating which chain a split applies to
function ChainBadge({ chainId, isDark }: { chainId: number; isDark: boolean }) {
  const chain = CHAIN_INFO[chainId] || { name: `Chain ${chainId}`, shortName: String(chainId), color: '#888888' }
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium ${
        isDark ? 'bg-white/10' : 'bg-gray-100'
      }`}
      title={chain.name}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: chain.color }}
      />
      {chain.shortName}
    </span>
  )
}

// Difference indicator for values that differ across chains
function DifferenceIndicator({
  chainValues,
  isDark,
}: {
  fieldName?: string // Optional - for debugging
  chainValues: Array<{ chainId: number; value: string | number }>
  isDark: boolean
}) {
  if (chainValues.length <= 1) return null

  return (
    <div className={`mt-1 text-[10px] ${isDark ? 'text-amber-400/80' : 'text-amber-600'}`}>
      <span className="mr-1">⚠</span>
      Differs:
      {chainValues.map((cv, i) => {
        const chain = CHAIN_INFO[cv.chainId] || { shortName: String(cv.chainId) }
        return (
          <span key={cv.chainId} className="ml-1">
            {chain.shortName}: {cv.value}{i < chainValues.length - 1 ? ',' : ''}
          </span>
        )
      })}
    </div>
  )
}

// Inline chain selector for sections with chain-specific data (used when rulesets match)
function InlineChainSelector({
  chainRulesets,
  selectedChainId,
  onSelect,
  isDark,
}: {
  chainRulesets: ChainRuleset[]
  selectedChainId: number | null
  onSelect: (chainId: number | null) => void
  isDark: boolean
}) {
  if (chainRulesets.length <= 1) return null

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {chainRulesets.map(cr => {
        const chain = CHAIN_INFO[cr.chainId] || { name: `Chain ${cr.chainId}`, shortName: String(cr.chainId), color: '#888888' }
        const isSelected = selectedChainId === cr.chainId
        return (
          <button
            key={cr.chainId}
            onClick={() => onSelect(isSelected ? null : cr.chainId)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium transition-colors ${
              isSelected
                ? isDark
                  ? 'bg-white/20 text-white'
                  : 'bg-gray-200 text-gray-900'
                : isDark
                  ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: chain.color }}
            />
            {chain.shortName}
          </button>
        )
      })}
    </div>
  )
}

// Cash out bonding curve visualization
// Formula: y = (o * x / s) * ((1 - r) + (r * x / s))
// Normalized: y = x * ((1 - r) + (r * x)) where x is % of supply cashed out
function CashOutCurve({ taxRate, isDark }: { taxRate: number; isDark: boolean }) {
  const r = taxRate / 10000 // Convert basis points to 0-1
  const width = 200
  const height = 100
  const padding = { left: 30, right: 10, top: 10, bottom: 25 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // Calculate y for a given x (% of supply being cashed out)
  // y represents the % of treasury reclaimable
  const calcY = (x: number) => x * ((1 - r) + (r * x))

  // Generate path points
  const points: string[] = []
  for (let i = 0; i <= 50; i++) {
    const x = i / 50 // 0 to 1
    const y = calcY(x)
    const px = padding.left + x * chartWidth
    const py = padding.top + (1 - y) * chartHeight
    points.push(`${i === 0 ? 'M' : 'L'} ${px} ${py}`)
  }
  const path = points.join(' ')

  // Calculate some key values for the legend
  const at25 = calcY(0.25) // Cashing out 25% of supply
  const at50 = calcY(0.50) // Cashing out 50% of supply
  const at100 = calcY(1.0) // Cashing out 100% of supply

  return (
    <div className={`mt-3 p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
      <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
        Cash Out Curve
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(v => (
          <line
            key={`h-${v}`}
            x1={padding.left}
            y1={padding.top + (1 - v) * chartHeight}
            x2={width - padding.right}
            y2={padding.top + (1 - v) * chartHeight}
            stroke={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            strokeDasharray="2 2"
          />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map(v => (
          <line
            key={`v-${v}`}
            x1={padding.left + v * chartWidth}
            y1={padding.top}
            x2={padding.left + v * chartWidth}
            y2={height - padding.bottom}
            stroke={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
            strokeDasharray="2 2"
          />
        ))}

        {/* Linear reference line (r=0) */}
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={padding.top}
          stroke={isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'}
          strokeDasharray="4 4"
        />

        {/* Bonding curve */}
        <path
          d={path}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {/* Axes labels */}
        <text
          x={padding.left + chartWidth / 2}
          y={height - 3}
          textAnchor="middle"
          className={`text-[8px] ${isDark ? 'fill-gray-500' : 'fill-gray-400'}`}
        >
          % supply cashed out
        </text>
        <text
          x={8}
          y={padding.top + chartHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90, 8, ${padding.top + chartHeight / 2})`}
          className={`text-[8px] ${isDark ? 'fill-gray-500' : 'fill-gray-400'}`}
        >
          % reclaimable
        </text>

        {/* Y axis values */}
        <text x={padding.left - 3} y={padding.top + 3} textAnchor="end" className={`text-[7px] ${isDark ? 'fill-gray-500' : 'fill-gray-400'}`}>100%</text>
        <text x={padding.left - 3} y={padding.top + chartHeight / 2 + 2} textAnchor="end" className={`text-[7px] ${isDark ? 'fill-gray-500' : 'fill-gray-400'}`}>50%</text>
        <text x={padding.left - 3} y={height - padding.bottom + 3} textAnchor="end" className={`text-[7px] ${isDark ? 'fill-gray-500' : 'fill-gray-400'}`}>0%</text>

        {/* X axis values */}
        <text x={padding.left} y={height - padding.bottom + 12} textAnchor="middle" className={`text-[7px] ${isDark ? 'fill-gray-500' : 'fill-gray-400'}`}>0</text>
        <text x={padding.left + chartWidth / 2} y={height - padding.bottom + 12} textAnchor="middle" className={`text-[7px] ${isDark ? 'fill-gray-500' : 'fill-gray-400'}`}>50%</text>
        <text x={width - padding.right} y={height - padding.bottom + 12} textAnchor="middle" className={`text-[7px] ${isDark ? 'fill-gray-500' : 'fill-gray-400'}`}>100%</text>
      </svg>

      {/* Key values */}
      <div className={`mt-2 grid grid-cols-3 gap-1 text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        <div className="text-center">
          <div className={isDark ? 'text-gray-500' : 'text-gray-400'}>25% out</div>
          <div className="font-mono text-amber-400">{(at25 * 100).toFixed(1)}%</div>
        </div>
        <div className="text-center">
          <div className={isDark ? 'text-gray-500' : 'text-gray-400'}>50% out</div>
          <div className="font-mono text-amber-400">{(at50 * 100).toFixed(1)}%</div>
        </div>
        <div className="text-center">
          <div className={isDark ? 'text-gray-500' : 'text-gray-400'}>100% out</div>
          <div className="font-mono text-amber-400">{(at100 * 100).toFixed(1)}%</div>
        </div>
      </div>
    </div>
  )
}

export default function RulesetSchedule({
  projectId,
  chainId = '1',
}: RulesetScheduleProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ruleset, setRuleset] = useState<ProjectRuleset | null>(null)
  const [owner, setOwner] = useState<string>('')
  const [ownerEns, setOwnerEns] = useState<string | null>(null)
  const [operator, setOperator] = useState<string | null>(null)
  const [operatorEns, setOperatorEns] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const [tokenSymbol, setTokenSymbol] = useState<string>('tokens')
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [showCashOutCurve, setShowCashOutCurve] = useState(false)
  // Revnet stages
  const [revnetStages, setRevnetStages] = useState<RevnetStage[] | null>(null)
  const [_currentStageNum, setCurrentStageNum] = useState<number>(0)
  // Upcoming rulesets
  const [upcomingRuleset, setUpcomingRuleset] = useState<RulesetHistoryEntry | null>(null)
  // Ruleset history and navigation
  const [rulesetHistory, setRulesetHistory] = useState<RulesetHistoryEntry[]>([])
  const [selectedCycleIndex, setSelectedCycleIndex] = useState<number>(0) // 0 = current, negative = future, positive = past
  // Fund access / splits
  const [payoutSplits, setPayoutSplits] = useState<JBSplitData[]>([])
  const [reservedSplits, setReservedSplits] = useState<JBSplitData[]>([])
  const [fundAccessLimits, setFundAccessLimits] = useState<FundAccessLimits | null>(null)
  const [splitEnsNames, setSplitEnsNames] = useState<Record<string, string>>({})
  const [pendingReservedTokens, setPendingReservedTokens] = useState<string>('0')

  // Omnichain state
  const [omnichainState, setOmnichainState] = useState<OmnichainRulesetState>({
    isOmnichain: false,
    rulesetsMatch: true,
    differences: [],
    chainRulesets: [],
    selectedChainId: null,
  })

  // Inline chain selector for splits sections (used when rulesets match but project is omnichain)
  const [splitsChainId, setSplitsChainId] = useState<number | null>(null)

  // Determine which chain's splits to show
  // If rulesets differ, use omnichainState.selectedChainId (top-level tabs)
  // If rulesets match, use splitsChainId (inline selector in splits sections)
  const effectiveSplitsChainId = !omnichainState.rulesetsMatch
    ? omnichainState.selectedChainId
    : splitsChainId

  // Get wallet for permission checking
  const { data: wallet } = useWallet()

  // Check if connected wallet is project owner or operator
  const canManage = useMemo(() => {
    if (!wallet?.address) return false
    const walletAddr = wallet.address.toLowerCase()
    // Check if owner (direct ownership)
    if (owner && walletAddr === owner.toLowerCase()) return true
    // Check if operator (for Revnets)
    if (operator && walletAddr === operator.toLowerCase()) return true
    return false
  }, [wallet?.address, owner, operator])

  // Get chain name for prompts
  const getChainName = (cId: number) => CHAIN_INFO[cId]?.name || `Chain ${cId}`

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        const primaryChainId = parseInt(chainId)

        // 1. First fetch basic project data and connected chains in parallel
        const [project, symbol, connectedChains] = await Promise.all([
          fetchProjectWithRuleset(projectId, primaryChainId),
          fetchProjectTokenSymbol(projectId, primaryChainId),
          fetchConnectedChains(projectId, primaryChainId),
        ])

        if (!project) {
          setError('Project not found')
          return
        }

        // Set primary chain data for backwards compatibility
        setProjectName(project.name)
        setOwner(project.owner)
        setRuleset(project.currentRuleset)
        setTokenSymbol(symbol || 'tokens')

        // Calculate remaining time
        if (project.currentRuleset && project.currentRuleset.duration > 0) {
          const start = project.currentRuleset.start || 0
          const duration = project.currentRuleset.duration
          const endTime = start + duration
          const remaining = endTime - Math.floor(Date.now() / 1000)
          setRemainingSeconds(Math.max(0, remaining))
        }

        // Resolve owner ENS
        if (project.owner) {
          const ens = await resolveEnsName(project.owner)
          setOwnerEns(ens)
        }

        // 2. Determine if this is an omnichain project
        // Use connected chains if available, otherwise just the primary chain
        const chainsToFetch: ConnectedChain[] = connectedChains.length > 0
          ? connectedChains
          : [{ chainId: primaryChainId, projectId: parseInt(projectId) }]

        const isOmnichain = chainsToFetch.length > 1

        // 3. Fetch rulesets and splits from all connected chains in parallel
        const chainRulesetsPromises = chainsToFetch.map(async (chain): Promise<ChainRuleset> => {
          try {
            // First fetch project data to get ruleset ID
            const chainProject = await fetchProjectWithRuleset(String(chain.projectId), chain.chainId)

            // Then fetch splits and pending tokens (need ruleset ID for splits)
            const [chainSplits, chainPending] = await Promise.all([
              chainProject?.currentRuleset?.id
                ? fetchProjectSplits(String(chain.projectId), chain.chainId, chainProject.currentRuleset.id)
                : Promise.resolve({ payoutSplits: [], reservedSplits: [] } as ProjectSplitsData),
              fetchPendingReservedTokens(String(chain.projectId), chain.chainId),
            ])

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              ruleset: chainProject?.currentRuleset || null,
              splits: chainSplits,
              pendingReserved: chainPending,
              owner: chainProject?.owner || '',
              projectName: chainProject?.name || `Project #${chain.projectId}`,
            }
          } catch (err) {
            console.error(`Failed to fetch ruleset for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              ruleset: null,
              splits: { payoutSplits: [], reservedSplits: [] },
              pendingReserved: '0',
              owner: '',
              projectName: `Project #${chain.projectId}`,
            }
          }
        })

        const chainRulesets = await Promise.all(chainRulesetsPromises)

        // 4. Compare rulesets across chains
        const { match: rulesetsMatch, differences } = findOmnichainDifferences(chainRulesets)

        // Update omnichain state
        setOmnichainState({
          isOmnichain,
          rulesetsMatch,
          differences,
          chainRulesets,
          selectedChainId: null, // Start with unified view if rulesets match
        })

        // Set splits from primary chain for backwards compatibility
        const primaryChainData = chainRulesets.find(cr => cr.chainId === primaryChainId)
        if (primaryChainData) {
          setPayoutSplits(primaryChainData.splits.payoutSplits)
          setReservedSplits(primaryChainData.splits.reservedSplits)
          setPendingReservedTokens(primaryChainData.pendingReserved)
        }

        // Fetch Revnet-specific data if this is a Revnet
        if (isRevnet(project.owner)) {
          // Fetch operator
          const op = await fetchRevnetOperator(projectId, primaryChainId)
          setOperator(op)
          if (op) {
            const opEns = await resolveEnsName(op)
            setOperatorEns(opEns)
          }

          // Fetch Revnet stages (past, current, future)
          const stagesData = await fetchRevnetStages(projectId, primaryChainId)
          if (stagesData) {
            setRevnetStages(stagesData.stages)
            setCurrentStageNum(stagesData.currentStage)
          }
        }

        // Fetch upcoming/queued rulesets (for all projects)
        const queued = await fetchQueuedRulesets(projectId, primaryChainId)
        if (queued.upcoming) {
          setUpcomingRuleset(queued.upcoming)
        }

        // Fetch ruleset history if we have a current ruleset ID
        if (project.currentRuleset?.id) {
          const history = await fetchRulesetHistory(
            projectId,
            primaryChainId,
            project.currentRuleset.id,
            20 // Get up to 20 historical rulesets
          )
          setRulesetHistory(history)

          // Fetch fund access limits for the primary chain
          const splitsData = await fetchProjectSplits(
            projectId,
            primaryChainId,
            project.currentRuleset.id
          )
          if (splitsData.fundAccessLimits) {
            setFundAccessLimits(splitsData.fundAccessLimits)
          }

          // Resolve ENS names for split beneficiaries across all chains
          const allBeneficiaries = chainRulesets.flatMap(cr => [
            ...cr.splits.payoutSplits.map(s => s.beneficiary),
            ...cr.splits.reservedSplits.map(s => s.beneficiary),
          ]).filter(b => b && b !== '0x0000000000000000000000000000000000000000')
          const uniqueBeneficiaries = [...new Set(allBeneficiaries)]

          const ensPromises = uniqueBeneficiaries.map(async (addr) => {
            const ens = await resolveEnsName(addr)
            return { addr, ens }
          })
          const ensResults = await Promise.all(ensPromises)
          const ensMap: Record<string, string> = {}
          for (const { addr, ens } of ensResults) {
            if (ens) ensMap[addr.toLowerCase()] = ens
          }
          setSplitEnsNames(ensMap)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load ruleset')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [projectId, chainId])

  // Countdown timer
  useEffect(() => {
    if (remainingSeconds <= 0) return
    const timer = setInterval(() => {
      setRemainingSeconds(prev => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [remainingSeconds])

  const isUnlocked = !ruleset || ruleset.duration === 0

  // Get active splits based on selected chain
  const getActiveSplits = () => {
    if (effectiveSplitsChainId && omnichainState.chainRulesets.length > 0) {
      const chainData = omnichainState.chainRulesets.find(
        cr => cr.chainId === effectiveSplitsChainId
      )
      return {
        payoutSplits: chainData?.splits.payoutSplits || [],
        reservedSplits: chainData?.splits.reservedSplits || [],
        pendingReserved: chainData?.pendingReserved || '0',
        fundAccessLimits: chainData?.splits.fundAccessLimits || null,
      }
    }
    // Use primary chain's splits (default state variables)
    return {
      payoutSplits,
      reservedSplits,
      pendingReserved: pendingReservedTokens,
      fundAccessLimits,
    }
  }

  const activeSplits = getActiveSplits()

  // Check if splits differ across chains
  const splitsDifferAcrossChains = () => {
    if (!omnichainState.isOmnichain || omnichainState.chainRulesets.length <= 1) return false

    const firstChain = omnichainState.chainRulesets[0]
    for (let i = 1; i < omnichainState.chainRulesets.length; i++) {
      const otherChain = omnichainState.chainRulesets[i]
      // Check payout splits count
      if (firstChain.splits.payoutSplits.length !== otherChain.splits.payoutSplits.length) return true
      // Check reserved splits count
      if (firstChain.splits.reservedSplits.length !== otherChain.splits.reservedSplits.length) return true
      // Check individual splits
      for (let j = 0; j < firstChain.splits.payoutSplits.length; j++) {
        const s1 = firstChain.splits.payoutSplits[j]
        const s2 = otherChain.splits.payoutSplits[j]
        if (!s2 || s1.beneficiary.toLowerCase() !== s2.beneficiary.toLowerCase() || s1.percent !== s2.percent) {
          return true
        }
      }
      for (let j = 0; j < firstChain.splits.reservedSplits.length; j++) {
        const s1 = firstChain.splits.reservedSplits[j]
        const s2 = otherChain.splits.reservedSplits[j]
        if (!s2 || s1.beneficiary.toLowerCase() !== s2.beneficiary.toLowerCase() || s1.percent !== s2.percent) {
          return true
        }
      }
    }
    return false
  }

  const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
    <div className={`border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
      <button
        onClick={() => setExpandedSection(expandedSection === id ? null : id)}
        className={`w-full px-4 py-3 flex items-center justify-between text-left ${
          isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'
        }`}
      >
        <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {title}
        </span>
        <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {expandedSection === id ? '−' : '+'}
        </span>
      </button>
      {expandedSection === id && (
        <div className={`px-4 pb-4 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          {children}
        </div>
      )}
    </div>
  )

  return (
    <div className="w-full">
      <div className={`max-w-md border overflow-hidden ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className={`px-4 py-3 border-b flex items-center justify-between ${
          isDark ? 'border-white/10' : 'border-gray-100'
        }`}>
          <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Ruleset
          </span>
          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {projectName || `Project #${projectId}`}
          </span>
        </div>

        {/* Chain Selector Tabs - only show when rulesets DIFFER across chains */}
        {omnichainState.isOmnichain && omnichainState.chainRulesets.length > 1 && !omnichainState.rulesetsMatch && (
          <div className={`px-4 py-2 border-b flex items-center gap-1 overflow-x-auto ${
            isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'
          }`}>
            <UnifiedTab
              isSelected={omnichainState.selectedChainId === null}
              onClick={() => setOmnichainState(prev => ({ ...prev, selectedChainId: null }))}
              isDark={isDark}
              hasDifferences={!omnichainState.rulesetsMatch}
            />
            {omnichainState.chainRulesets.map(cr => (
              <ChainTab
                key={cr.chainId}
                chainId={cr.chainId}
                isSelected={omnichainState.selectedChainId === cr.chainId}
                onClick={() => setOmnichainState(prev => ({ ...prev, selectedChainId: cr.chainId }))}
                isDark={isDark}
                showBadge={omnichainState.differences.length > 0}
              />
            ))}
          </div>
        )}

        {loading ? (
          <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Loading ruleset...
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center text-red-400">
            {error}
          </div>
        ) : !ruleset ? (
          <div className={`px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            No active ruleset
          </div>
        ) : (
          <>
            {/* Juicy Summary - distinctive callout that feels like an alternative view */}
            {(() => {
              const summary = generateJuicySummary({
                ruleset,
                upcomingRuleset,
                isRevnet: isRevnet(owner),
                isUnlocked,
                isOmnichain: omnichainState.isOmnichain,
                tokenSymbol,
                remainingSeconds,
                chainCount: omnichainState.chainRulesets.length || 1,
                baseCurrency: ruleset?.baseCurrency || 1,
              })

              const getActionIcon = (action: string) => {
                switch (action) {
                  case 'contribute': return '→'
                  case 'cash-out': return '←'
                  case 'hold': return '◆'
                  case 'wait': return '◷'
                  case 'caution': return '⚠'
                  default: return '•'
                }
              }

              const getActionColor = (action: string, urgency?: string) => {
                if (urgency === 'now') return 'text-juice-orange'
                if (urgency === 'soon') return isDark ? 'text-emerald-400' : 'text-emerald-600'
                switch (action) {
                  case 'contribute': return isDark ? 'text-blue-400' : 'text-blue-600'
                  case 'cash-out': return isDark ? 'text-purple-400' : 'text-purple-600'
                  case 'caution': return 'text-amber-400'
                  default: return isDark ? 'text-gray-400' : 'text-gray-500'
                }
              }

              const isExpanded = expandedSection === 'summary'

              return (
                <div className={`mx-3 my-3 border transition-all ${
                  isDark
                    ? 'border-juice-orange/30 bg-juice-orange/5'
                    : 'border-orange-200 bg-orange-50/50'
                }`}>
                  <button
                    onClick={() => setExpandedSection(isExpanded ? null : 'summary')}
                    className={`w-full px-3 py-2 flex items-center justify-between text-left ${
                      isDark ? 'hover:bg-juice-orange/10' : 'hover:bg-orange-100/50'
                    }`}
                  >
                    <span className={`text-xs font-medium ${
                      isDark ? 'text-juice-orange' : 'text-orange-600'
                    }`}>
                      Juicy Summary
                    </span>
                    <span className={`text-xs ${isDark ? 'text-juice-orange/60' : 'text-orange-400'}`}>
                      {isExpanded ? '−' : '+'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className={`px-3 pb-3 space-y-3 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {/* Tagline */}
                      <p className={isDark ? 'text-gray-300' : 'text-gray-600'}>
                        {summary.tagline}
                      </p>

                      {/* Upcoming change alert */}
                      {summary.upcomingChange && (
                        <div className={`px-3 py-2 text-xs font-medium flex items-center gap-2 ${
                          isDark
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : 'bg-purple-50 text-purple-700 border border-purple-200'
                        }`}>
                          <span>◷</span>
                          <span>{summary.upcomingChange}</span>
                        </div>
                      )}

                      {/* Action items */}
                      <div className="space-y-2">
                        {summary.actionItems.map((item, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className={`mt-0.5 ${getActionColor(item.action, item.urgency)}`}>
                              {getActionIcon(item.action)}
                            </span>
                            <span className={`${
                              item.urgency === 'now'
                                ? isDark ? 'text-white' : 'text-gray-900'
                                : isDark ? 'text-gray-400' : 'text-gray-600'
                            }`}>
                              {item.message}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Tell me more button */}
                      <button
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('juice:send-message', {
                            detail: { message: `Tell me more about this project's ruleset configuration and what it means for contributors.` }
                          }))
                        }}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                          isDark
                            ? 'text-juice-orange hover:bg-juice-orange/10'
                            : 'text-orange-600 hover:bg-orange-50'
                        }`}
                      >
                        Tell me more...
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Cycle Navigation Header */}
            {(() => {
              // Build combined list: [future cycles..., upcoming, ...history (current first, then past)]
              const allCycles: RulesetHistoryEntry[] = []

              // Generate future cycles based on upcoming ruleset (or current if no upcoming)
              const baseForFuture = upcomingRuleset || (rulesetHistory[0] ? {
                ...rulesetHistory[0],
                cycleNumber: rulesetHistory[0].cycleNumber + 1,
                start: rulesetHistory[0].start + rulesetHistory[0].duration,
              } : null)

              if (baseForFuture && baseForFuture.duration > 0) {
                // Generate up to 20 future cycles
                const futureCycles: RulesetHistoryEntry[] = []
                let prevCycle = baseForFuture
                const decayMultiplier = 1 - (baseForFuture.weightCutPercent / 1e9)

                for (let i = 0; i < 20; i++) {
                  const cycleNum = prevCycle.cycleNumber + i
                  const cycleStart = prevCycle.start + (i * prevCycle.duration)
                  const cycleWeight = BigInt(Math.floor(
                    parseFloat(prevCycle.weight) * Math.pow(decayMultiplier, i)
                  ))

                  futureCycles.push({
                    cycleNumber: cycleNum,
                    id: prevCycle.id,
                    start: cycleStart,
                    duration: prevCycle.duration,
                    weight: String(cycleWeight),
                    weightCutPercent: prevCycle.weightCutPercent,
                    reservedPercent: prevCycle.reservedPercent,
                    cashOutTaxRate: prevCycle.cashOutTaxRate,
                    pausePay: prevCycle.pausePay,
                    allowOwnerMinting: prevCycle.allowOwnerMinting,
                    status: 'upcoming',
                  })
                }

                // Add future cycles (furthest first so index 0 is furthest future)
                allCycles.push(...futureCycles.reverse())
              }

              // Add history (current first, then past)
              allCycles.push(...rulesetHistory)

              // Find the index of the current cycle
              const currentIndex = allCycles.findIndex(c => c.status === 'current')
              const viewingIndex = currentIndex + selectedCycleIndex // negative = future, positive = past
              const canGoNewer = viewingIndex > 0
              const canGoOlder = viewingIndex < allCycles.length - 1

              // Get the ruleset we're viewing
              const viewingRuleset = allCycles[viewingIndex] || null
              const isViewingCurrent = selectedCycleIndex === 0
              const isViewingUpcoming = selectedCycleIndex < 0
              const isViewingPast = selectedCycleIndex > 0

              // Use viewed ruleset for display, or fall back to current
              const displayRuleset = viewingRuleset ? {
                ...ruleset,
                cycleNumber: viewingRuleset.cycleNumber,
                start: viewingRuleset.start,
                duration: viewingRuleset.duration,
                weight: viewingRuleset.weight,
                decayPercent: String(viewingRuleset.weightCutPercent), // weightCutPercent is already in decayPercent format
                reservedPercent: viewingRuleset.reservedPercent ?? ruleset?.reservedPercent ?? 0,
                cashOutTaxRate: viewingRuleset.cashOutTaxRate ?? ruleset?.cashOutTaxRate ?? 0,
                pausePay: viewingRuleset.pausePay ?? ruleset?.pausePay ?? false,
                allowOwnerMinting: viewingRuleset.allowOwnerMinting ?? ruleset?.allowOwnerMinting ?? false,
              } : ruleset

              return (
                <>
                  <div className={`px-4 py-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                    {/* Navigation arrows - Left=Past, Right=Future (timeline order) */}
                    <div className="flex items-stretch justify-between mb-2">
                      <button
                        onClick={() => setSelectedCycleIndex(prev => prev + 1)}
                        disabled={!canGoOlder}
                        className={`p-2 flex items-center gap-1 transition-colors ${
                          canGoOlder
                            ? isDark ? 'text-white hover:bg-white/10' : 'text-gray-900 hover:bg-gray-100'
                            : isDark ? 'text-gray-700 cursor-not-allowed' : 'text-gray-300 cursor-not-allowed'
                        }`}
                        title="Older cycle"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        <span className={`text-xs ${canGoOlder ? '' : 'opacity-50'}`}>Past</span>
                      </button>

                      <div className="text-center flex-1">
                        <div className="flex items-center justify-center gap-2">
                          <span className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            Cycle #{displayRuleset?.cycleNumber || 1}
                          </span>
                          <span className={`px-2 py-0.5 text-xs font-medium ${
                            isViewingCurrent
                              ? 'bg-juice-orange/20 text-juice-orange'
                              : isViewingUpcoming
                                ? 'bg-purple-500/20 text-purple-400'
                                : isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'
                          }`}>
                            {isViewingCurrent ? 'Current' : isViewingUpcoming ? 'Upcoming' : 'Past'}
                          </span>
                        </div>
                        {displayRuleset?.start && (
                          <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            {isViewingUpcoming
                              ? `Starts ${new Date(displayRuleset.start * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                              : `Started ${new Date(displayRuleset.start * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                            }
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => setSelectedCycleIndex(prev => prev - 1)}
                        disabled={!canGoNewer}
                        className={`p-2 flex items-center gap-1 transition-colors ${
                          canGoNewer
                            ? isDark ? 'text-white hover:bg-white/10' : 'text-gray-900 hover:bg-gray-100'
                            : isDark ? 'text-gray-700 cursor-not-allowed' : 'text-gray-300 cursor-not-allowed'
                        }`}
                        title="Newer cycle"
                      >
                        <span className={`text-xs ${canGoNewer ? '' : 'opacity-50'}`}>Future</span>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>

                    {/* Cycle indicator dots - displayed in timeline order (oldest left, newest right) */}
                    {allCycles.length > 1 && (() => {
                      // Reverse allCycles for display so oldest is on left, future on right
                      const displayCycles = [...allCycles].reverse()
                      const displayCurrentIndex = allCycles.length - 1 - currentIndex
                      const displayViewingIndex = allCycles.length - 1 - viewingIndex

                      // Show a sliding window of dots centered on current view
                      const maxDots = 7
                      const halfWindow = Math.floor(maxDots / 2)
                      let startIdx = Math.max(0, displayViewingIndex - halfWindow)
                      let endIdx = Math.min(displayCycles.length, startIdx + maxDots)
                      // Adjust start if we're near the end
                      if (endIdx - startIdx < maxDots) {
                        startIdx = Math.max(0, endIdx - maxDots)
                      }
                      const visibleCycles = displayCycles.slice(startIdx, endIdx)
                      const hasMoreBefore = startIdx > 0
                      const hasMoreAfter = endIdx < displayCycles.length

                      const countBefore = startIdx
                      const countAfter = displayCycles.length - endIdx

                      return (
                        <div className="flex items-center justify-center gap-1 mt-2">
                          {hasMoreBefore && (
                            <button
                              onClick={() => {
                                // Navigate to the oldest visible cycle when clicking left arrow
                                const targetDisplayIdx = Math.max(0, startIdx - 1)
                                const targetOriginalIdx = allCycles.length - 1 - targetDisplayIdx
                                setSelectedCycleIndex(targetOriginalIdx - currentIndex)
                              }}
                              className={`text-xs mr-1 font-mono ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
                              title={`${countBefore} more cycle${countBefore > 1 ? 's' : ''} before`}
                            >
                              ← {countBefore} more
                            </button>
                          )}
                          {visibleCycles.map((cycle, idx) => {
                            const displayIdx = startIdx + idx
                            // Map display index back to original allCycles index
                            const originalIdx = allCycles.length - 1 - displayIdx
                            return (
                              <button
                                key={cycle.cycleNumber}
                                onClick={() => setSelectedCycleIndex(originalIdx - currentIndex)}
                                className={`w-2 h-2 rounded-full transition-colors ${
                                  displayIdx === displayViewingIndex
                                    ? 'bg-juice-orange'
                                    : displayIdx === displayCurrentIndex
                                      ? isDark ? 'bg-white/40' : 'bg-gray-400'
                                      : isDark ? 'bg-white/20 hover:bg-white/30' : 'bg-gray-200 hover:bg-gray-300'
                                }`}
                                title={`Cycle ${cycle.cycleNumber}${cycle.status === 'upcoming' ? ' (scheduled)' : ''}`}
                              />
                            )
                          })}
                          {hasMoreAfter && (
                            <button
                              onClick={() => {
                                // Navigate to the next cycle after visible window when clicking right arrow
                                const targetDisplayIdx = Math.min(displayCycles.length - 1, endIdx)
                                const targetOriginalIdx = allCycles.length - 1 - targetDisplayIdx
                                setSelectedCycleIndex(targetOriginalIdx - currentIndex)
                              }}
                              className={`text-xs ml-1 font-mono ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
                              title={`${countAfter} more cycle${countAfter > 1 ? 's' : ''} after`}
                            >
                              {countAfter} more →
                            </button>
                          )}
                        </div>
                      )
                    })()}

                    {/* Jump to current button when viewing past/future */}
                    {!isViewingCurrent && (
                      <button
                        onClick={() => setSelectedCycleIndex(0)}
                        className={`mt-2 w-full text-xs py-1 transition-colors ${
                          isDark ? 'text-juice-orange hover:bg-juice-orange/10' : 'text-orange-600 hover:bg-orange-50'
                        }`}
                      >
                        Jump to current cycle
                      </button>
                    )}
                  </div>

                  {/* Status Bar - using displayRuleset */}
                  <div className={`grid grid-cols-3 gap-2 px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                    <div className={`p-2 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                      <div className={`text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Cycle #</div>
                      <div className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {displayRuleset?.cycleNumber || 1}
                      </div>
                    </div>
                    <div className={`p-2 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                      <div className={`text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Status</div>
                      <div className={`font-semibold ${
                        isViewingPast
                          ? isDark ? 'text-gray-400' : 'text-gray-500'
                          : isViewingUpcoming
                            ? 'text-purple-400'
                            : (!displayRuleset || displayRuleset.duration === 0) ? 'text-amber-400' : 'text-emerald-400'
                      }`}>
                        {isViewingPast ? 'Ended' : isViewingUpcoming ? 'Scheduled' : (!displayRuleset || displayRuleset.duration === 0) ? 'Unlocked' : 'Locked'}
                      </div>
                    </div>
                    <div className={`p-2 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                      <div className={`text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {isViewingPast ? 'Duration' : isViewingUpcoming ? 'Starts in' : 'Remaining'}
                      </div>
                      <div className={`font-semibold font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {isViewingPast
                          ? formatDuration(displayRuleset?.duration || 0)
                          : isViewingUpcoming
                            ? formatRemainingTime(Math.max(0, (displayRuleset?.start || 0) - Math.floor(Date.now() / 1000)))
                            : (!displayRuleset || displayRuleset.duration === 0) ? '-' : formatRemainingTime(remainingSeconds)}
                      </div>
                    </div>
                  </div>

                  {/* Current Ruleset Details - using displayRuleset */}
                  <Section id="current" title="Rules">
                    <div className="space-y-3 text-sm">
                      {/* Show chain indicator in section when omnichain */}
                      {omnichainState.isOmnichain && omnichainState.selectedChainId && (
                        <div className={`flex items-center gap-2 pb-2 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Viewing:</span>
                          <ChainBadge chainId={omnichainState.selectedChainId} isDark={isDark} />
                        </div>
                      )}
                      {omnichainState.isOmnichain && !omnichainState.selectedChainId && !omnichainState.rulesetsMatch && (
                        <div className={`flex items-center gap-2 pb-2 border-b text-xs ${isDark ? 'border-white/10 text-amber-400' : 'border-gray-100 text-amber-600'}`}>
                          <span>⚠</span>
                          <span>Some values differ across chains. Select a chain to see specific values.</span>
                        </div>
                      )}
                      <div>
                        <div className="flex justify-between">
                          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Cycle Duration</span>
                          <span className="font-mono">{formatDuration(displayRuleset?.duration || 0)}</span>
                        </div>
                        <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {displayRuleset?.duration === 0
                            ? 'Rules can change at any time without warning'
                            : 'Rules are locked until the cycle ends'}
                        </div>
                        {/* Show difference indicator in unified view */}
                        {!omnichainState.selectedChainId && omnichainState.differences.includes('duration') && (
                          <DifferenceIndicator
                            fieldName="duration"
                            chainValues={omnichainState.chainRulesets.map(cr => ({
                              chainId: cr.chainId,
                              value: formatDuration(cr.ruleset?.duration || 0),
                            }))}
                            isDark={isDark}
                          />
                        )}
                      </div>
                      <div>
                        <div className="flex justify-between">
                          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{tokenSymbol} Issuance</span>
                          <span className="font-mono">{formatIssuance(displayRuleset?.weight || '0', tokenSymbol, ruleset?.baseCurrency)}</span>
                        </div>
                        <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {tokenSymbol} minted per {ruleset?.baseCurrency === 2 ? 'USD' : 'ETH'} contributed
                        </div>
                        {!omnichainState.selectedChainId && omnichainState.differences.includes('issuance') && (
                          <DifferenceIndicator
                            fieldName="issuance"
                            chainValues={omnichainState.chainRulesets.map(cr => ({
                              chainId: cr.chainId,
                              value: formatIssuance(cr.ruleset?.weight || '0', tokenSymbol, ruleset?.baseCurrency),
                            }))}
                            isDark={isDark}
                          />
                        )}
                      </div>
                      <div>
                        <div className="flex justify-between">
                          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Cut</span>
                          <span className="font-mono">{formatDecay(displayRuleset?.decayPercent || '0', displayRuleset?.duration || 0)}</span>
                        </div>
                        <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {parseFloat(displayRuleset?.decayPercent || '0') > 0
                            ? 'Issuance decreases each cycle - early contributors get more'
                            : 'Issuance stays constant across cycles'}
                        </div>
                        {!omnichainState.selectedChainId && omnichainState.differences.includes('decay') && (
                          <DifferenceIndicator
                            fieldName="cut"
                            chainValues={omnichainState.chainRulesets.map(cr => ({
                              chainId: cr.chainId,
                              value: formatDecay(cr.ruleset?.decayPercent || '0', cr.ruleset?.duration || 0),
                            }))}
                            isDark={isDark}
                          />
                        )}
                      </div>
                      <div>
                        <div className="flex justify-between">
                          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{tokenSymbol} Reserved Rate</span>
                          <span className="font-mono">{formatPercent(displayRuleset?.reservedPercent || 0)}</span>
                        </div>
                        <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {(displayRuleset?.reservedPercent || 0) > 0
                            ? `Portion of minted ${tokenSymbol} kept for project recipients`
                            : `All ${tokenSymbol} go directly to contributors`}
                        </div>
                        {!omnichainState.selectedChainId && omnichainState.differences.includes('reservedPercent') && (
                          <DifferenceIndicator
                            fieldName="reservedPercent"
                            chainValues={omnichainState.chainRulesets.map(cr => ({
                              chainId: cr.chainId,
                              value: formatPercent(cr.ruleset?.reservedPercent || 0),
                            }))}
                            isDark={isDark}
                          />
                        )}
                      </div>
                      <div>
                        <div className="flex justify-between">
                          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Cash Out Tax Rate</span>
                          <span className="font-mono">{((displayRuleset?.cashOutTaxRate || 0) / 10000).toFixed(2)}</span>
                        </div>
                        <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {(displayRuleset?.cashOutTaxRate || 0) >= 10000
                            ? 'Cash outs disabled - tokens cannot be redeemed'
                            : (displayRuleset?.cashOutTaxRate || 0) > 0
                              ? 'Higher tax = more funds retained for remaining holders'
                              : 'No tax - redeem tokens for proportional share of treasury'}
                        </div>
                        {!omnichainState.selectedChainId && omnichainState.differences.includes('cashOutTaxRate') && (
                          <DifferenceIndicator
                            fieldName="cashOutTaxRate"
                            chainValues={omnichainState.chainRulesets.map(cr => ({
                              chainId: cr.chainId,
                              value: ((cr.ruleset?.cashOutTaxRate || 0) / 10000).toFixed(2),
                            }))}
                            isDark={isDark}
                          />
                        )}
                      </div>

                      {/* Cash Out Curve Toggle */}
                      <button
                        onClick={() => setShowCashOutCurve(!showCashOutCurve)}
                        className={`w-full text-left text-xs py-2 transition-colors ${
                          isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
                        }`}
                      >
                        {showCashOutCurve ? '− Hide cash out curve' : '+ Show cash out curve'}
                      </button>
                      {showCashOutCurve && (
                        <CashOutCurve taxRate={displayRuleset?.cashOutTaxRate || 0} isDark={isDark} />
                      )}

                      {/* Data Hook Address */}
                      {displayRuleset?.dataHook && displayRuleset.dataHook !== '0x0000000000000000000000000000000000000000' && (
                        <div>
                          <div className="flex justify-between">
                            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Data Hook</span>
                            <div className="flex items-center gap-2">
                              {isRevnet(owner) && (
                                <span className={`text-xs px-1.5 py-0.5 ${isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                                  Revnet
                                </span>
                              )}
                              <a
                                href={`https://etherscan.io/address/${displayRuleset.dataHook}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-juice-orange hover:underline text-xs"
                              >
                                {displayRuleset.dataHook.slice(0, 6)}...{displayRuleset.dataHook.slice(-4)}
                              </a>
                            </div>
                          </div>
                          <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {isRevnet(owner)
                              ? 'Revnet buyback hook - optimizes token pricing via DEX arbitrage'
                              : 'Contract that customizes payment and cash out behavior'}
                          </div>
                        </div>
                      )}

                      {/* Show changes from current if viewing past/future */}
                      {!isViewingCurrent && ruleset && (
                        <div className={`mt-3 p-2 text-xs ${
                          isDark ? 'bg-white/5 border border-white/10' : 'bg-gray-50 border border-gray-200'
                        }`}>
                          <div className={`font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                            {isViewingPast ? 'Changes since this cycle:' : 'Changes from current:'}
                          </div>
                          <div className="space-y-1">
                            {displayRuleset?.weight !== ruleset.weight && (
                              <div className="flex justify-between">
                                <span>Issuance</span>
                                <span className="text-amber-400">
                                  {formatIssuance(displayRuleset?.weight || '0', tokenSymbol, ruleset?.baseCurrency)} → {formatIssuance(ruleset.weight, tokenSymbol, ruleset?.baseCurrency)}
                                </span>
                              </div>
                            )}
                            {displayRuleset?.cashOutTaxRate !== ruleset.cashOutTaxRate && (
                              <div className="flex justify-between">
                                <span>Cash Out Tax</span>
                                <span className="text-amber-400">
                                  {((displayRuleset?.cashOutTaxRate || 0) / 10000).toFixed(2)} → {(ruleset.cashOutTaxRate / 10000).toFixed(2)}
                                </span>
                              </div>
                            )}
                            {displayRuleset?.reservedPercent !== ruleset.reservedPercent && (
                              <div className="flex justify-between">
                                <span>Reserved Rate</span>
                                <span className="text-amber-400">
                                  {formatPercent(displayRuleset?.reservedPercent || 0)} → {formatPercent(ruleset.reservedPercent)}
                                </span>
                              </div>
                            )}
                            {displayRuleset?.duration !== ruleset.duration && (
                              <div className="flex justify-between">
                                <span>Duration</span>
                                <span className="text-amber-400">
                                  {formatDuration(displayRuleset?.duration || 0)} → {formatDuration(ruleset.duration)}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Buttons */}
                      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                        <button
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('juice:send-message', {
                              detail: { message: `Show me a token price chart for project ${projectId} on ${getChainName(parseInt(chainId))}` }
                            }))
                          }}
                          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                            isDark
                              ? 'text-teal-400 border border-teal-400/30 hover:bg-teal-500/10 rounded'
                              : 'text-teal-600 border border-teal-300 hover:bg-teal-50 rounded'
                          }`}
                        >
                          View price chart
                        </button>
                      </div>
                    </div>
                  </Section>
                </>
              )
            })()}

            {/* Revnet Stages - shows past, current, and future stages */}
            {isRevnet(owner) && revnetStages && revnetStages.length > 0 && (
              <Section id="stages" title="Stages">
                <div className="space-y-3">
                  {revnetStages.map((stage, idx) => {
                    const isPast = stage.isPast
                    const isCurrent = stage.isCurrent
                    const isFuture = stage.isFuture

                    return (
                      <div
                        key={idx}
                        className={`p-3 border ${
                          isCurrent
                            ? isDark ? 'border-juice-orange bg-juice-orange/10' : 'border-orange-300 bg-orange-50'
                            : isPast
                              ? isDark ? 'border-gray-700 bg-white/5 opacity-60' : 'border-gray-200 bg-gray-50 opacity-60'
                              : isDark ? 'border-purple-500/50 bg-purple-500/10' : 'border-purple-200 bg-purple-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            Stage {stage.stageNumber}
                          </span>
                          <span className={`text-xs px-2 py-0.5 ${
                            isCurrent
                              ? 'bg-juice-orange/20 text-juice-orange'
                              : isPast
                                ? isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'
                                : 'bg-purple-500/20 text-purple-400'
                          }`}>
                            {isCurrent ? 'Current' : isPast ? 'Past' : 'Upcoming'}
                          </span>
                        </div>

                        <div className={`text-xs space-y-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          {stage.startsAtOrAfter > 0 && (
                            <div className="flex justify-between">
                              <span>Starts</span>
                              <span className="font-mono">
                                {new Date(stage.startsAtOrAfter * 1000).toLocaleDateString()}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span>Initial Issuance</span>
                            <span className="font-mono">
                              {formatIssuance(stage.initialIssuance, tokenSymbol, ruleset?.baseCurrency)}
                            </span>
                          </div>
                          {stage.issuanceDecayPercent > 0 && (
                            <div className="flex justify-between">
                              <span>Cut</span>
                              <span className="font-mono">
                                {(stage.issuanceDecayPercent / 1e7).toFixed(2)}%
                                {stage.issuanceDecayFrequency > 0 && ` / ${formatDuration(stage.issuanceDecayFrequency)}`}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span>Cash Out Tax</span>
                            <span className={`font-mono ${
                              isFuture && stage.cashOutTaxRate !== ruleset.cashOutTaxRate
                                ? 'text-amber-400'
                                : ''
                            }`}>
                              {(stage.cashOutTaxRate / 10000).toFixed(2)}
                              {isFuture && stage.cashOutTaxRate !== ruleset.cashOutTaxRate && (
                                <span className="ml-1 text-[10px]">
                                  ({stage.cashOutTaxRate > ruleset.cashOutTaxRate ? '↑' : '↓'})
                                </span>
                              )}
                            </span>
                          </div>
                          {stage.splitPercent > 0 && (
                            <div className="flex justify-between">
                              <span>Reserved Rate</span>
                              <span className="font-mono">{formatPercent(stage.splitPercent)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* Upcoming Ruleset - for non-Revnet projects */}
            {!isRevnet(owner) && upcomingRuleset && (
              <Section id="upcoming" title="Upcoming Cycle">
                <div className={`p-3 border ${isDark ? 'border-purple-500/50 bg-purple-500/10' : 'border-purple-200 bg-purple-50'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      Cycle #{upcomingRuleset.cycleNumber}
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400">
                      Next
                    </span>
                  </div>
                  <div className={`text-xs space-y-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    <div className="flex justify-between">
                      <span>Starts</span>
                      <span className="font-mono">
                        {new Date(upcomingRuleset.start * 1000).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Issuance</span>
                      <span className={`font-mono ${
                        upcomingRuleset.weight !== ruleset.weight ? 'text-amber-400' : ''
                      }`}>
                        {formatIssuance(upcomingRuleset.weight, tokenSymbol, ruleset?.baseCurrency)}
                        {upcomingRuleset.weight !== ruleset.weight && (
                          <span className="ml-1 text-[10px]">
                            (changed)
                          </span>
                        )}
                      </span>
                    </div>
                    {upcomingRuleset.duration !== ruleset.duration && (
                      <div className="flex justify-between">
                        <span>Duration</span>
                        <span className="font-mono text-amber-400">
                          {formatDuration(upcomingRuleset.duration)}
                          <span className="ml-1 text-[10px]">(changed)</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </Section>
            )}

            {/* Permissions & Access */}
            <Section id="permissions" title="Permissions & Access">
              <div className="space-y-3 text-sm">
                {/* Color legend */}
                <div className={`flex items-center gap-4 text-[10px] pb-2 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Safe for holders</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Owner has control</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Informational</span>
                  </div>
                </div>
                {/* Payments */}
                <div>
                  <div className="flex justify-between">
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Payments</span>
                    <span className={`font-mono ${ruleset.pausePay ? 'text-red-400' : 'text-emerald-400'}`}>
                      {ruleset.pausePay ? 'Paused' : 'Open'}
                    </span>
                  </div>
                  <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {ruleset.pausePay
                      ? 'No contributions allowed during this cycle'
                      : 'Anyone can contribute and receive tokens'}
                  </div>
                </div>

                {/* Credit Transfers */}
                <div>
                  <div className="flex justify-between">
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Token Transfers</span>
                    <span className={`font-mono ${ruleset.pauseCreditTransfers ? 'text-red-400' : 'text-emerald-400'}`}>
                      {ruleset.pauseCreditTransfers ? 'Paused' : 'Open'}
                    </span>
                  </div>
                  <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {ruleset.pauseCreditTransfers
                      ? 'Token holders cannot transfer their tokens'
                      : 'Token holders can freely transfer tokens'}
                  </div>
                </div>

                {/* Owner Minting */}
                <div>
                  <div className="flex justify-between">
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Owner Minting</span>
                    <span className={`font-mono ${
                      ruleset.allowOwnerMinting
                        ? isRevnet(owner) ? 'text-emerald-400' : 'text-amber-400'
                        : 'text-emerald-400'
                    }`}>
                      {ruleset.allowOwnerMinting ? 'Allowed' : 'Disabled'}
                    </span>
                  </div>
                  {ruleset.allowOwnerMinting && isRevnet(owner) && (
                    <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Safe for Revnets - only used for pre-configured auto-issuance
                    </div>
                  )}
                </div>

                {/* Owner Must Send Payouts */}
                {ruleset.ownerMustSendPayouts !== undefined && (
                  <div>
                    <div className="flex justify-between">
                      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Payout Distribution</span>
                      <span className={`font-mono ${ruleset.ownerMustSendPayouts ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {ruleset.ownerMustSendPayouts ? 'Owner Only' : 'Anyone'}
                      </span>
                    </div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {ruleset.ownerMustSendPayouts
                        ? 'Only the owner can distribute payouts'
                        : 'Anyone can trigger payout distributions'}
                    </div>
                  </div>
                )}

                {/* Use Total Surplus for Cash Outs */}
                {ruleset.useTotalSurplusForCashOuts !== undefined && (
                  <div>
                    <div className="flex justify-between">
                      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Cash Out Surplus</span>
                      <span className={`font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        {ruleset.useTotalSurplusForCashOuts ? 'Total' : 'Terminal'}
                      </span>
                    </div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {ruleset.useTotalSurplusForCashOuts
                        ? 'Cash outs calculated from total surplus across all terminals'
                        : 'Cash outs calculated from individual terminal surplus'}
                    </div>
                  </div>
                )}

                {/* Data Hook for Pay */}
                {ruleset.useDataHookForPay !== undefined && (
                  <div>
                    <div className="flex justify-between">
                      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Pay Data Hook</span>
                      <span className={`font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        {ruleset.useDataHookForPay ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    {ruleset.useDataHookForPay && (
                      <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {isRevnet(owner)
                          ? 'Used by Revnets for buyback delegate and other automations'
                          : 'Custom logic runs when payments are received'}
                      </div>
                    )}
                  </div>
                )}

                {/* Data Hook for Cash Out */}
                {ruleset.useDataHookForCashOut !== undefined && (
                  <div>
                    <div className="flex justify-between">
                      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Cash Out Data Hook</span>
                      <span className={`font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        {ruleset.useDataHookForCashOut ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    {ruleset.useDataHookForCashOut && (
                      <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {isRevnet(owner)
                          ? 'Used by Revnets for exit fee and other automations'
                          : 'Custom logic runs when tokens are cashed out'}
                      </div>
                    )}
                  </div>
                )}

                {/* Allow Add Price Feed */}
                {ruleset.allowAddPriceFeed !== undefined && (
                  <div>
                    <div className="flex justify-between">
                      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Add Price Feed</span>
                      <span className={`font-mono ${ruleset.allowAddPriceFeed ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {ruleset.allowAddPriceFeed ? 'Allowed' : 'Disabled'}
                      </span>
                    </div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {ruleset.allowAddPriceFeed
                        ? 'Owner can add new price feeds for currency conversion'
                        : 'Price feeds are locked'}
                    </div>
                  </div>
                )}

                {/* Hold Fees */}
                <div>
                  <div className="flex justify-between">
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Hold Fees</span>
                    <span className={`font-mono ${ruleset.holdFees ? 'text-amber-400' : isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {ruleset.holdFees ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {ruleset.holdFees
                      ? 'Protocol fees held in project balance, not paid immediately'
                      : 'Protocol fees paid immediately on distributions'}
                  </div>
                </div>
              </div>
            </Section>

            {/* Owner */}
            <Section id="owner" title="Owner">
              <div className="text-sm space-y-3">
                {/* Owner address with ENS and Revnet badge */}
                <div className="flex items-center gap-2">
                  <a
                    href={`https://etherscan.io/address/${owner}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-juice-orange hover:underline"
                  >
                    {ownerEns || truncateAddress(owner)}
                  </a>
                  {isRevnet(owner) && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-purple-500/20 text-purple-400">
                      Revnet
                    </span>
                  )}
                </div>

                {/* Owner Powers */}
                <div className={`space-y-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  <div className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    Owner Powers
                  </div>

                  {/* Ruleset changes */}
                  <div>
                    <div className="flex justify-between text-xs">
                      <span>Change ruleset</span>
                      <span className={
                        isUnlocked
                          ? isRevnet(owner) ? 'text-emerald-400' : 'text-amber-400'
                          : 'text-emerald-400'
                      }>
                        {isUnlocked
                          ? isRevnet(owner) ? 'Staged' : 'Anytime'
                          : `In ${formatRemainingTime(remainingSeconds)}`}
                      </span>
                    </div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {isUnlocked
                        ? isRevnet(owner)
                          ? 'Future stages are pre-committed and immutable'
                          : 'Owner can modify rules without waiting'
                        : 'Rules locked until current cycle ends'}
                    </div>
                  </div>

                  {/* Owner minting */}
                  <div>
                    <div className="flex justify-between text-xs">
                      <span>Mint tokens</span>
                      <span className={
                        ruleset.allowOwnerMinting
                          ? isRevnet(owner) ? 'text-emerald-400' : 'text-amber-400'
                          : 'text-emerald-400'
                      }>
                        {ruleset.allowOwnerMinting ? 'Allowed' : 'Disabled'}
                      </span>
                    </div>
                    {ruleset.allowOwnerMinting && isRevnet(owner) && (
                      <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        Safe within Revnets - only used for auto-issuance to split recipients
                      </div>
                    )}
                    {ruleset.allowOwnerMinting && !isRevnet(owner) && (
                      <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        Owner can create tokens without payment
                      </div>
                    )}
                    {!ruleset.allowOwnerMinting && (
                      <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        Tokens can only be minted through contributions
                      </div>
                    )}
                  </div>

                  {/* Set terminals */}
                  {ruleset.allowSetTerminals !== undefined && (
                    <div>
                      <div className="flex justify-between text-xs">
                        <span>Set terminals</span>
                        <span className={ruleset.allowSetTerminals ? 'text-amber-400' : 'text-emerald-400'}>
                          {ruleset.allowSetTerminals ? 'Allowed' : 'Disabled'}
                        </span>
                      </div>
                      <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {ruleset.allowSetTerminals
                          ? 'Owner can change which contracts accept payments'
                          : 'Payment terminals are locked'}
                      </div>
                    </div>
                  )}

                  {/* Set controller */}
                  {ruleset.allowSetController !== undefined && (
                    <div>
                      <div className="flex justify-between text-xs">
                        <span>Set controller</span>
                        <span className={ruleset.allowSetController ? 'text-amber-400' : 'text-emerald-400'}>
                          {ruleset.allowSetController ? 'Allowed' : 'Disabled'}
                        </span>
                      </div>
                      <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {ruleset.allowSetController
                          ? 'Owner can change the contract that manages rules'
                          : 'Controller contract is locked'}
                      </div>
                    </div>
                  )}

                  {/* Terminal migration */}
                  {ruleset.allowTerminalMigration !== undefined && (
                    <div>
                      <div className="flex justify-between text-xs">
                        <span>Migrate terminals</span>
                        <span className={ruleset.allowTerminalMigration ? 'text-amber-400' : 'text-emerald-400'}>
                          {ruleset.allowTerminalMigration ? 'Allowed' : 'Disabled'}
                        </span>
                      </div>
                      <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {ruleset.allowTerminalMigration
                          ? 'Owner can move funds between terminals'
                          : 'Funds locked in current terminals'}
                      </div>
                    </div>
                  )}

                  {/* Set custom token */}
                  {ruleset.allowSetCustomToken !== undefined && (
                    <div>
                      <div className="flex justify-between text-xs">
                        <span>Set custom token</span>
                        <span className={ruleset.allowSetCustomToken ? 'text-amber-400' : 'text-emerald-400'}>
                          {ruleset.allowSetCustomToken ? 'Allowed' : 'Disabled'}
                        </span>
                      </div>
                      <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {ruleset.allowSetCustomToken
                          ? 'Owner can change the project token'
                          : 'Project token is locked'}
                      </div>
                    </div>
                  )}

                  {/* Add accounting context */}
                  {ruleset.allowAddAccountingContext !== undefined && (
                    <div>
                      <div className="flex justify-between text-xs">
                        <span>Add accounting context</span>
                        <span className={ruleset.allowAddAccountingContext ? 'text-amber-400' : 'text-emerald-400'}>
                          {ruleset.allowAddAccountingContext ? 'Allowed' : 'Disabled'}
                        </span>
                      </div>
                      <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {ruleset.allowAddAccountingContext
                          ? 'Owner can add new currencies for accounting'
                          : 'Accepted currencies are locked'}
                      </div>
                    </div>
                  )}

                </div>

                {/* Revnet explanation */}
                {isRevnet(owner) && (
                  <div className={`text-xs p-2 ${isDark ? 'bg-purple-500/10 text-purple-300' : 'bg-purple-50 text-purple-700'}`}>
                    This is a Revnet - owned by the REVDeployer contract. Rules are programmatically enforced.
                  </div>
                )}

                {/* Unlocked warning */}
                {isUnlocked && !isRevnet(owner) && (
                  <div className={`text-xs p-2 ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                    Unlocked means the owner can change rules at any time without warning.
                  </div>
                )}

                {/* Revnet Operator Section - inside Owner for Revnets */}
                {isRevnet(owner) && (
                  <div className={`mt-4 pt-4 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                    <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      Operator
                    </div>
                    {operator ? (
                      <div className="space-y-3">
                        {/* Operator address with ENS */}
                        <div className="flex items-center gap-2">
                          <a
                            href={`https://etherscan.io/address/${operator}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-juice-orange hover:underline"
                          >
                            {operatorEns || truncateAddress(operator)}
                          </a>
                          <span className="px-2 py-0.5 text-xs font-medium bg-blue-500/20 text-blue-400">
                            Split Operator
                          </span>
                        </div>

                        {/* Operator Powers */}
                        <div className={`space-y-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          <div className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                            Operator Powers
                          </div>

                          <div>
                            <div className="flex justify-between text-xs">
                              <span>Set reserved {tokenSymbol} splits</span>
                              <span className="text-emerald-400">Allowed</span>
                            </div>
                            <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              Configure who receives reserved {tokenSymbol}
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-xs">
                              <span>Deploy suckers (bridges)</span>
                              <span className="text-emerald-400">Allowed</span>
                            </div>
                            <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              Create cross-chain token bridges
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-xs">
                              <span>Set buyback pool</span>
                              <span className="text-emerald-400">Allowed</span>
                            </div>
                            <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              Configure DEX pool for token buybacks
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-xs">
                              <span>Update project metadata</span>
                              <span className="text-emerald-400">Allowed</span>
                            </div>
                            <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              Change project name, description, and logo
                            </div>
                          </div>
                        </div>

                        {/* Operator explanation */}
                        <div className={`text-xs p-2 ${isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-700'}`}>
                          The operator can configure reserved token splits and deploy cross-chain bridges. They cannot change core tokenomics or access project funds.
                        </div>
                      </div>
                    ) : (
                      <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        No operator set.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Section>

            {/* Fund Access Section - Constraints and Limits */}
            <Section id="fund-access" title="Payouts & Cash outs">
              <div className="space-y-4 text-sm">
                {(() => {
                  // Parse fund access limits from active chain data
                  const activeFundAccessLimits = activeSplits.fundAccessLimits
                  const payoutLimit = activeFundAccessLimits?.payoutLimits?.[0]
                  const surplusAllowance = activeFundAccessLimits?.surplusAllowances?.[0]
                  const isRevnetProject = isRevnet(owner)

                  // Helper to check if a value represents "unlimited" in the protocol
                  // The protocol uses various max values (uint256, uint224, uint128, etc.)
                  // We consider any value > 10^30 as effectively unlimited
                  const isUnlimited = (amount: string | undefined): boolean => {
                    if (!amount) return false
                    try {
                      // If the number has more than 30 digits, it's unlimited
                      return amount.length > 30 || BigInt(amount) > BigInt('1000000000000000000000000000000')
                    } catch {
                      return false
                    }
                  }

                  // Determine payout limit status from actual contract values
                  const payoutLimitIsZero = !payoutLimit || payoutLimit.amount === '0'
                  const payoutLimitIsUnlimited = isUnlimited(payoutLimit?.amount)
                  const hasPayoutLimit = payoutLimit && !payoutLimitIsZero && !payoutLimitIsUnlimited

                  // Determine surplus allowance status from actual contract values
                  const surplusAllowanceIsUnlimited = isUnlimited(surplusAllowance?.amount)
                  const surplusAllowanceIsZero = !surplusAllowance || surplusAllowance.amount === '0'

                  const cashOutsEnabled = ruleset && ruleset.cashOutTaxRate < 10000

                  const formatAmount = (amount: string, currency: number) => {
                    const currencyLabel = currency === 1 ? 'ETH' : currency === 2 ? 'USD' : `Currency ${currency}`
                    return `${(parseFloat(amount) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${currencyLabel}`
                  }

                  return (
                    <>
                      {/* Inline chain selector for omnichain projects with matching rulesets */}
                      {omnichainState.rulesetsMatch && omnichainState.isOmnichain && (
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Chain:</span>
                          <InlineChainSelector
                            chainRulesets={omnichainState.chainRulesets}
                            selectedChainId={splitsChainId}
                            onSelect={setSplitsChainId}
                            isDark={isDark}
                          />
                        </div>
                      )}
                      {/* Chain badge when rulesets differ and chain is selected */}
                      {!omnichainState.rulesetsMatch && omnichainState.selectedChainId && (
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Chain:</span>
                          <ChainBadge chainId={omnichainState.selectedChainId} isDark={isDark} />
                        </div>
                      )}
                      {/* Fund Access Constraints - Always show */}
                      <div className={`space-y-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {/* Payout Limit */}
                        <div>
                          <div className="flex justify-between text-xs">
                            <span>Payout Limit</span>
                            <span className={payoutLimitIsZero ? 'text-emerald-400' : payoutLimitIsUnlimited ? 'text-amber-400' : 'font-mono'}>
                              {payoutLimitIsZero
                                ? 'None'
                                : payoutLimitIsUnlimited
                                  ? 'Unlimited'
                                  : formatAmount(payoutLimit!.amount, payoutLimit!.currency)
                              }
                            </span>
                          </div>
                          <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {payoutLimitIsZero
                              ? 'Owner cannot distribute funds from treasury'
                              : payoutLimitIsUnlimited
                                ? 'Owner can distribute any amount from treasury'
                                : 'Max funds the owner can distribute per cycle'}
                          </div>
                        </div>

                        {/* Surplus Allowance */}
                        <div>
                          <div className="flex justify-between text-xs">
                            <span>Surplus Allowance</span>
                            <span className={surplusAllowanceIsZero ? (isDark ? 'text-gray-500' : 'text-gray-400') : surplusAllowanceIsUnlimited ? 'text-emerald-400' : 'font-mono'}>
                              {surplusAllowanceIsZero
                                ? 'None'
                                : surplusAllowanceIsUnlimited
                                  ? 'Unlimited'
                                  : formatAmount(surplusAllowance!.amount, surplusAllowance!.currency)
                              }
                            </span>
                          </div>
                          <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {surplusAllowanceIsZero
                              ? 'Owner cannot access surplus beyond payout limit'
                              : surplusAllowanceIsUnlimited
                                ? isRevnetProject
                                  ? 'Used by REVDeployer to facilitate loans against treasury'
                                  : 'Owner can access any surplus beyond payout limit'
                                : 'Additional funds owner can access beyond payout limit'}
                          </div>
                        </div>

                        {/* Cash Outs */}
                        <div>
                          <div className="flex justify-between text-xs">
                            <span>Cash Outs</span>
                            <span className={cashOutsEnabled ? 'text-emerald-400' : 'text-amber-400'}>
                              {cashOutsEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            {cashOutsEnabled
                              ? 'Token holders can redeem tokens for treasury funds'
                              : 'Token holders cannot redeem tokens for funds'}
                          </div>
                        </div>
                      </div>

                      {/* Explanation based on project type */}
                      {isRevnetProject ? (
                        <div className={`text-xs p-2 ${isDark ? 'bg-purple-500/10 text-purple-300' : 'bg-purple-50 text-purple-700'}`}>
                          {payoutLimitIsZero ? 'No payouts.' : payoutLimitIsUnlimited ? 'Unlimited payouts.' : `Payout limit: ${formatAmount(payoutLimit!.amount, payoutLimit!.currency)}.`}
                          {' '}
                          {surplusAllowanceIsUnlimited
                            ? 'The unlimited surplus allowance is used by the REVDeployer (project owner) to facilitate loans - token holders can borrow against treasury funds, to be repaid with interest.'
                            : surplusAllowanceIsZero
                              ? 'No surplus allowance.'
                              : `Surplus allowance: ${formatAmount(surplusAllowance!.amount, surplusAllowance!.currency)}.`
                          }
                          {cashOutsEnabled && ' Token holders can also cash out at any time.'}
                        </div>
                      ) : (
                        <div className={`text-xs p-2 ${isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-700'}`}>
                          {payoutLimitIsZero && surplusAllowanceIsZero ? (
                            cashOutsEnabled
                              ? 'All fund access is by token holders cashing out. The owner cannot distribute funds.'
                              : 'Funds in the treasury cannot be accessed by anyone.'
                          ) : payoutLimitIsUnlimited ? (
                            'The owner can distribute unlimited funds from the treasury.'
                          ) : hasPayoutLimit ? (
                            `The owner can distribute up to ${formatAmount(payoutLimit.amount, payoutLimit.currency)} per ruleset.`
                          ) : surplusAllowanceIsUnlimited ? (
                            'The owner can access unlimited surplus funds beyond the payout limit.'
                          ) : !surplusAllowanceIsZero ? (
                            `The owner can access up to ${formatAmount(surplusAllowance!.amount, surplusAllowance!.currency)} in surplus.`
                          ) : null}
                          {cashOutsEnabled && payoutLimitIsZero && ' Token holders can cash out.'}
                        </div>
                      )}

                      {/* Payout Splits - Show when there's a payout limit */}
                      {hasPayoutLimit && (
                        <div>
                          <div className={`text-xs font-medium mb-2 flex items-center gap-2 flex-wrap ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                            <span>Payout Splits</span>
                            {/* When rulesets differ, show chain badge from top-level tabs */}
                            {!omnichainState.rulesetsMatch && omnichainState.selectedChainId && (
                              <ChainBadge chainId={omnichainState.selectedChainId} isDark={isDark} />
                            )}
                            {/* When rulesets match but project is omnichain, show inline chain selector */}
                            {omnichainState.rulesetsMatch && omnichainState.isOmnichain && (
                              <InlineChainSelector
                                chainRulesets={omnichainState.chainRulesets}
                                selectedChainId={splitsChainId}
                                onSelect={setSplitsChainId}
                                isDark={isDark}
                              />
                            )}
                            {/* When unified view with differences, show warning */}
                            {!omnichainState.rulesetsMatch && !omnichainState.selectedChainId && omnichainState.isOmnichain && splitsDifferAcrossChains() && (
                              <span className="text-amber-400 text-[10px]" title="Splits vary across chains">
                                ⚠ varies by chain
                              </span>
                            )}
                          </div>
                          <div className="space-y-2">
                            {(() => {
                              const limitHasValue = hasPayoutLimit
                              const limitAmount = limitHasValue ? parseFloat(payoutLimit!.amount) / 1e18 : 0
                              const currencyLabel = payoutLimit?.currency === 2 ? 'USD' : 'ETH'

                              return activeSplits.payoutSplits.map((split, idx) => {
                                const percent = (split.percent / 1e9) * 100
                                const beneficiaryKey = split.beneficiary.toLowerCase()
                                const displayName = splitEnsNames[beneficiaryKey] || truncateAddress(split.beneficiary)
                                const isProject = split.projectId > 0
                                const splitAmount = limitHasValue ? (limitAmount * percent / 100) : 0

                                return (
                                  <div key={idx} className={`p-2 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        {isProject ? (
                                          <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400">
                                            Project #{split.projectId}
                                          </span>
                                        ) : (
                                          <a
                                            href={`https://etherscan.io/address/${split.beneficiary}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-mono text-xs text-juice-orange hover:underline"
                                          >
                                            {displayName}
                                          </a>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {limitHasValue && splitAmount > 0 && (
                                          <span className={`font-mono text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                            {splitAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {currencyLabel}
                                          </span>
                                        )}
                                        <span className="font-mono text-emerald-400">{percent.toFixed(2)}%</span>
                                      </div>
                                    </div>
                                    {split.lockedUntil > 0 && (
                                      <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                        Locked until {new Date(split.lockedUntil * 1000).toLocaleDateString()}
                                      </div>
                                    )}
                                  </div>
                                )
                              })
                            })()}
                            {/* Show remainder going to project */}
                            {(() => {
                              const totalPercent = activeSplits.payoutSplits.reduce((sum, s) => sum + (s.percent / 1e9) * 100, 0)
                              const remainder = 100 - totalPercent
                              if (remainder > 0.01) {
                                const limitHasValue = hasPayoutLimit
                                const limitAmount = limitHasValue ? parseFloat(payoutLimit!.amount) / 1e18 : 0
                                const currencyLabel = payoutLimit?.currency === 2 ? 'USD' : 'ETH'
                                const remainderAmount = limitHasValue ? (limitAmount * remainder / 100) : 0

                                return (
                                  <div className={`p-2 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                                    <div className="flex items-center justify-between">
                                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        Project treasury
                                      </span>
                                      <div className="flex items-center gap-2">
                                        {limitHasValue && remainderAmount > 0 && (
                                          <span className={`font-mono text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                            {remainderAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {currencyLabel}
                                          </span>
                                        )}
                                        <span className="font-mono text-emerald-400">{remainder.toFixed(2)}%</span>
                                      </div>
                                    </div>
                                  </div>
                                )
                              }
                              return null
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Buttons */}
                      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                        {/* Actions first */}
                        {hasPayoutLimit && (
                          <button
                            onClick={() => {
                              window.dispatchEvent(new CustomEvent('juice:send-message', {
                                detail: { message: `Help me send payouts for project ${projectId} on ${getChainName(parseInt(chainId))}` }
                              }))
                            }}
                            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                              isDark
                                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                                : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            }`}
                          >
                            Distribute payouts
                          </button>
                        )}
                        {canManage && (
                          <button
                            onClick={() => {
                              window.dispatchEvent(new CustomEvent('juice:send-message', {
                                detail: { message: `Help me change the payout splits for project ${projectId} on ${getChainName(parseInt(chainId))}` }
                              }))
                            }}
                            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                              isDark
                                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                                : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                            }`}
                          >
                            Change splits
                          </button>
                        )}
                        {/* Prompts second */}
                        <button
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('juice:send-message', {
                              detail: { message: `Show me the cash out price chart for project ${projectId} on ${getChainName(parseInt(chainId))}` }
                            }))
                          }}
                          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                            isDark
                              ? 'text-teal-400 border border-teal-400/30 hover:bg-teal-500/10 rounded'
                              : 'text-teal-600 border border-teal-300 hover:bg-teal-50 rounded'
                          }`}
                        >
                          View cash out prices
                        </button>
                        <button
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('juice:send-message', {
                              detail: { message: `Help me simulate a cash out for project ${projectId} on ${getChainName(parseInt(chainId))}` }
                            }))
                          }}
                          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                            isDark
                              ? 'text-teal-400 border border-teal-400/30 hover:bg-teal-500/10 rounded'
                              : 'text-teal-600 border border-teal-300 hover:bg-teal-50 rounded'
                          }`}
                        >
                          View cash out simulation
                        </button>
                        <button
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('juice:send-message', {
                              detail: { message: `Check my ${tokenSymbol} token balance for project ${projectId} on ${getChainName(parseInt(chainId))} and show me my cash out scenarios` }
                            }))
                          }}
                          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                            isDark
                              ? 'text-teal-400 border border-teal-400/30 hover:bg-teal-500/10 rounded'
                              : 'text-teal-600 border border-teal-300 hover:bg-teal-50 rounded'
                          }`}
                        >
                          View my balance & cash out
                        </button>
                      </div>
                    </>
                  )
                })()}
              </div>
            </Section>

            {/* Tokens Section - Reserved token splits */}
            <Section id="tokens" title={tokenSymbol !== 'tokens' ? `${tokenSymbol} token distribution` : 'Token credit distribution'}>
              <div className="space-y-4 text-sm">
                {/* Reserved Rate */}
                <div>
                  <div className="flex justify-between">
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{tokenSymbol} Reserved Rate</span>
                    <span className="font-mono">{formatPercent(ruleset?.reservedPercent || 0)}</span>
                  </div>
                  <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {(ruleset?.reservedPercent || 0) > 0
                      ? `Portion of newly minted ${tokenSymbol} set aside for recipients below`
                      : `All minted ${tokenSymbol} go directly to contributors`}
                  </div>
                </div>

                {/* Pending Reserved Tokens */}
                {BigInt(activeSplits.pendingReserved) > 0n && (
                  <div className={`p-3 ${isDark ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-amber-50 border border-amber-200'}`}>
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-medium ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
                          Pending Distribution
                        </span>
                        {/* When rulesets match but project is omnichain, show inline chain selector */}
                        {omnichainState.rulesetsMatch && omnichainState.isOmnichain && (
                          <InlineChainSelector
                            chainRulesets={omnichainState.chainRulesets}
                            selectedChainId={splitsChainId}
                            onSelect={setSplitsChainId}
                            isDark={isDark}
                          />
                        )}
                        {/* When rulesets differ, show chain badge from top-level tabs */}
                        {!omnichainState.rulesetsMatch && omnichainState.selectedChainId && (
                          <ChainBadge chainId={omnichainState.selectedChainId} isDark={isDark} />
                        )}
                      </div>
                      <span className={`font-mono text-amber-400`}>
                        {(parseFloat(activeSplits.pendingReserved) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 2 })} {tokenSymbol}
                      </span>
                    </div>
                    <div className={`text-xs mt-1 ${isDark ? 'text-amber-400/70' : 'text-amber-600'}`}>
                      Reserved {tokenSymbol} waiting to be sent to recipients
                    </div>
                  </div>
                )}

                {/* Reserved Token Splits */}
                {activeSplits.reservedSplits.length > 0 ? (
                  <div>
                    <div className={`text-xs font-medium mb-2 flex items-center gap-2 flex-wrap ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      <span>{tokenSymbol} Recipients</span>
                      {/* When rulesets differ, show chain badge from top-level tabs */}
                      {!omnichainState.rulesetsMatch && omnichainState.selectedChainId && (
                        <ChainBadge chainId={omnichainState.selectedChainId} isDark={isDark} />
                      )}
                      {/* When rulesets match but project is omnichain, show inline chain selector */}
                      {omnichainState.rulesetsMatch && omnichainState.isOmnichain && (
                        <InlineChainSelector
                          chainRulesets={omnichainState.chainRulesets}
                          selectedChainId={splitsChainId}
                          onSelect={setSplitsChainId}
                          isDark={isDark}
                        />
                      )}
                      {/* When unified view with differences, show warning */}
                      {!omnichainState.rulesetsMatch && !omnichainState.selectedChainId && omnichainState.isOmnichain && splitsDifferAcrossChains() && (
                        <span className="text-amber-400 text-[10px]" title="Splits vary across chains">
                          ⚠ varies by chain
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {(() => {
                        const reservedRate = (ruleset?.reservedPercent || 0) / 100 // Convert bps to %

                        return activeSplits.reservedSplits.map((split, idx) => {
                          const splitPercent = (split.percent / 1e9) * 100 // % of reserved
                          const actualPercent = (reservedRate * splitPercent) / 100 // % of total issuance
                          const beneficiaryKey = split.beneficiary.toLowerCase()
                          const displayName = splitEnsNames[beneficiaryKey] || truncateAddress(split.beneficiary)
                          const isProject = split.projectId > 0

                          return (
                            <div key={idx} className={`p-2 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {isProject ? (
                                    <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400">
                                      Project #{split.projectId}
                                    </span>
                                  ) : (
                                    <a
                                      href={`https://etherscan.io/address/${split.beneficiary}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-mono text-xs text-juice-orange hover:underline"
                                    >
                                      {displayName}
                                    </a>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-amber-400">{actualPercent.toFixed(0)}%</span>
                                  <span className={`font-mono text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                    ({splitPercent.toFixed(0)}%)
                                  </span>
                                </div>
                              </div>
                              {split.lockedUntil > 0 && (
                                <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                  Locked until {new Date(split.lockedUntil * 1000).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          )
                        })
                      })()}
                      {/* Show remainder going to project owner */}
                      {(() => {
                        const reservedRate = (ruleset?.reservedPercent || 0) / 100
                        const totalSplitPercent = activeSplits.reservedSplits.reduce((sum, s) => sum + (s.percent / 1e9) * 100, 0)
                        const remainderSplitPercent = 100 - totalSplitPercent
                        const remainderActualPercent = (reservedRate * remainderSplitPercent) / 100
                        if (remainderSplitPercent > 0.01) {
                          return (
                            <div className={`p-2 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                              <div className="flex items-center justify-between">
                                <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                  Project owner
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-amber-400">{remainderActualPercent.toFixed(0)}%</span>
                                  <span className={`font-mono text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                    ({remainderSplitPercent.toFixed(0)}%)
                                  </span>
                                </div>
                              </div>
                            </div>
                          )
                        }
                        return null
                      })()}
                    </div>
                  </div>
                ) : (
                  <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {(ruleset?.reservedPercent || 0) > 0
                      ? `All reserved ${tokenSymbol} go to the project owner.`
                      : `No ${tokenSymbol} are reserved. All newly minted ${tokenSymbol} go to contributors.`
                    }
                  </div>
                )}

                {/* Buttons */}
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  {/* Actions first */}
                  {BigInt(activeSplits.pendingReserved) > 0n && (
                    <button
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('juice:send-message', {
                          detail: { message: `Help me distribute reserved tokens for project ${projectId} on ${getChainName(parseInt(chainId))}` }
                        }))
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        isDark
                          ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                          : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      }`}
                    >
                      Distribute reserved
                    </button>
                  )}
                  {canManage && (
                    <button
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('juice:send-message', {
                          detail: { message: `Help me change the reserved token splits for project ${projectId} on ${getChainName(parseInt(chainId))}` }
                        }))
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        isDark
                          ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                          : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      }`}
                    >
                      Change splits
                    </button>
                  )}
                  {/* Prompts second */}
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('juice:send-message', {
                        detail: { message: `Show me a token holder pie chart for project ${projectId} on ${getChainName(parseInt(chainId))}` }
                      }))
                    }}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      isDark
                        ? 'text-teal-400 border border-teal-400/30 hover:bg-teal-500/10 rounded'
                        : 'text-teal-600 border border-teal-300 hover:bg-teal-50 rounded'
                    }`}
                  >
                    View token holders
                  </button>
                </div>
              </div>
            </Section>

          </>
        )}
      </div>
    </div>
  )
}
