import { useState, useEffect } from 'react'
import { useThemeStore } from '../../stores'
import {
  fetchProjectWithRuleset,
  fetchProjectTokenSymbol,
  isRevnet,
  fetchRevnetOperator,
  fetchRevnetStages,
  fetchQueuedRulesets,
  fetchRulesetHistory,
  fetchProjectSplits,
  type ProjectRuleset,
  type RevnetStage,
  type RulesetHistoryEntry,
  type JBSplitData,
  type FundAccessLimits,
} from '../../services/bendystraw'
import { resolveEnsName, truncateAddress } from '../../utils/ens'

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

// Format issuance weight to tokens per ETH
function formatIssuance(weight: string, tokenSymbol: string) {
  try {
    const num = parseFloat(weight) / 1e18
    // Show more precision for nuanced numbers
    if (num >= 1e9) return `${(num / 1e9).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}B ${tokenSymbol}/ETH`
    if (num >= 1e6) return `${(num / 1e6).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}M ${tokenSymbol}/ETH`
    if (num >= 1e3) return `${(num / 1e3).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}K ${tokenSymbol}/ETH`
    if (num >= 1) return `${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${tokenSymbol}/ETH`
    return `${num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} ${tokenSymbol}/ETH`
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
  const [expandedSection, setExpandedSection] = useState<string | null>('current')
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

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        // Fetch project data (V5 only)
        const [project, symbol] = await Promise.all([
          fetchProjectWithRuleset(projectId, parseInt(chainId)),
          fetchProjectTokenSymbol(projectId, parseInt(chainId))
        ])

        if (!project) {
          setError('Project not found')
          return
        }

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

        // Fetch Revnet-specific data if this is a Revnet
        if (isRevnet(project.owner)) {
          // Fetch operator
          const op = await fetchRevnetOperator(projectId, parseInt(chainId))
          setOperator(op)
          if (op) {
            const opEns = await resolveEnsName(op)
            setOperatorEns(opEns)
          }

          // Fetch Revnet stages (past, current, future)
          const stagesData = await fetchRevnetStages(projectId, parseInt(chainId))
          if (stagesData) {
            setRevnetStages(stagesData.stages)
            setCurrentStageNum(stagesData.currentStage)
          }
        }

        // Fetch upcoming/queued rulesets (for all projects)
        const queued = await fetchQueuedRulesets(projectId, parseInt(chainId))
        if (queued.upcoming) {
          setUpcomingRuleset(queued.upcoming)
        }

        // Fetch ruleset history if we have a current ruleset ID
        if (project.currentRuleset?.id) {
          const history = await fetchRulesetHistory(
            projectId,
            parseInt(chainId),
            project.currentRuleset.id,
            20 // Get up to 20 historical rulesets
          )
          setRulesetHistory(history)

          // Fetch splits for the current ruleset
          const splitsData = await fetchProjectSplits(
            projectId,
            parseInt(chainId),
            project.currentRuleset.id
          )
          setPayoutSplits(splitsData.payoutSplits)
          setReservedSplits(splitsData.reservedSplits)
          if (splitsData.fundAccessLimits) {
            setFundAccessLimits(splitsData.fundAccessLimits)
          }

          // Resolve ENS names for split beneficiaries
          const allBeneficiaries = [
            ...splitsData.payoutSplits.map(s => s.beneficiary),
            ...splitsData.reservedSplits.map(s => s.beneficiary),
          ].filter(b => b && b !== '0x0000000000000000000000000000000000000000')
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
                    <div className="flex items-center justify-between mb-2">
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

                      return (
                        <div className="flex items-center justify-center gap-1 mt-2">
                          {hasMoreBefore && (
                            <span className={`text-xs mr-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>...</span>
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
                            <span className={`text-xs ml-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>...</span>
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
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Cycle Duration</span>
                        <span className="font-mono">{formatDuration(displayRuleset?.duration || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Issuance</span>
                        <span className="font-mono">{formatIssuance(displayRuleset?.weight || '0', tokenSymbol)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Cut</span>
                        <span className="font-mono">{formatDecay(displayRuleset?.decayPercent || '0', displayRuleset?.duration || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Reserved Rate</span>
                        <span className="font-mono">{formatPercent(displayRuleset?.reservedPercent || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Cash Out Tax Rate</span>
                        <span className="font-mono">{((displayRuleset?.cashOutTaxRate || 0) / 10000).toFixed(2)}</span>
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
                                  {formatIssuance(displayRuleset?.weight || '0', tokenSymbol)} → {formatIssuance(ruleset.weight, tokenSymbol)}
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
                              {formatIssuance(stage.initialIssuance, tokenSymbol)}
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
                        {formatIssuance(upcomingRuleset.weight, tokenSymbol)}
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

            {/* Permissions */}
            <Section id="permissions" title="Permissions">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Payments</span>
                  <span className={`font-mono ${ruleset.pausePay ? 'text-red-400' : 'text-emerald-400'}`}>
                    {ruleset.pausePay ? 'Paused' : 'Open'}
                  </span>
                </div>
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

                  {/* Owner minting */}
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

                  {/* Set terminals */}
                  {ruleset.allowSetTerminals !== undefined && (
                    <div className="flex justify-between text-xs">
                      <span>Set terminals</span>
                      <span className={ruleset.allowSetTerminals ? 'text-amber-400' : 'text-emerald-400'}>
                        {ruleset.allowSetTerminals ? 'Allowed' : 'Disabled'}
                      </span>
                    </div>
                  )}

                  {/* Set controller */}
                  {ruleset.allowSetController !== undefined && (
                    <div className="flex justify-between text-xs">
                      <span>Set controller</span>
                      <span className={ruleset.allowSetController ? 'text-amber-400' : 'text-emerald-400'}>
                        {ruleset.allowSetController ? 'Allowed' : 'Disabled'}
                      </span>
                    </div>
                  )}

                  {/* Terminal migration */}
                  {ruleset.allowTerminalMigration !== undefined && (
                    <div className="flex justify-between text-xs">
                      <span>Migrate terminals</span>
                      <span className={ruleset.allowTerminalMigration ? 'text-amber-400' : 'text-emerald-400'}>
                        {ruleset.allowTerminalMigration ? 'Allowed' : 'Disabled'}
                      </span>
                    </div>
                  )}

                  {/* Hold fees */}
                  {ruleset.holdFees !== undefined && (
                    <div className="flex justify-between text-xs">
                      <span>Hold fees</span>
                      <span className={ruleset.holdFees ? 'text-amber-400' : isDark ? 'text-gray-500' : 'text-gray-400'}>
                        {ruleset.holdFees ? 'Enabled' : 'Disabled'}
                      </span>
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
              </div>
            </Section>

            {/* Operator Section - only for Revnets */}
            {isRevnet(owner) && (
              <Section id="operator" title="Operator">
                <div className="text-sm space-y-3">
                  {operator ? (
                    <>
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

                        <div className="flex justify-between text-xs">
                          <span>Set payout splits</span>
                          <span className="text-emerald-400">Allowed</span>
                        </div>

                        <div className="flex justify-between text-xs">
                          <span>Set reserved token splits</span>
                          <span className="text-emerald-400">Allowed</span>
                        </div>

                        <div className="flex justify-between text-xs">
                          <span>Deploy suckers (bridges)</span>
                          <span className="text-emerald-400">Allowed</span>
                        </div>
                      </div>

                      {/* Operator explanation */}
                      <div className={`text-xs p-2 ${isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-700'}`}>
                        The operator can configure payout and reserved token splits within the reserved rate set at deployment. They cannot change core tokenomics.
                      </div>
                    </>
                  ) : (
                    <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      No operator set. This Revnet has no split operator configured.
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Fund Access Section - Splits and Limits */}
            {(payoutSplits.length > 0 || reservedSplits.length > 0 || fundAccessLimits) && (
              <Section id="fund-access" title="Fund Access">
                <div className="space-y-4 text-sm">
                  {/* Payout Limits */}
                  {fundAccessLimits && fundAccessLimits.payoutLimits.length > 0 && (
                    <div>
                      <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        Payout Limits
                      </div>
                      <div className="space-y-1">
                        {fundAccessLimits.payoutLimits.map((limit, idx) => (
                          <div key={idx} className="flex justify-between">
                            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                              {limit.currency === 1 ? 'ETH' : limit.currency === 2 ? 'USD' : `Currency ${limit.currency}`}
                            </span>
                            <span className="font-mono">
                              {limit.amount === '115792089237316195423570985008687907853269984665640564039457584007913129639935'
                                ? 'Unlimited'
                                : `${(parseFloat(limit.amount) / (limit.currency === 2 ? 1e6 : 1e18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${limit.currency === 1 ? 'ETH' : 'USD'}`
                              }
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Payout Splits */}
                  {payoutSplits.length > 0 && (
                    <div>
                      <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        Payout Splits
                      </div>
                      <div className="space-y-2">
                        {payoutSplits.map((split, idx) => {
                          const percent = (split.percent / 1e9) * 100
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
                                <span className="font-mono text-emerald-400">{percent.toFixed(2)}%</span>
                              </div>
                              {split.lockedUntil > 0 && (
                                <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                  Locked until {new Date(split.lockedUntil * 1000).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        {/* Show remainder going to project */}
                        {(() => {
                          const totalPercent = payoutSplits.reduce((sum, s) => sum + (s.percent / 1e9) * 100, 0)
                          const remainder = 100 - totalPercent
                          if (remainder > 0.01) {
                            return (
                              <div className={`p-2 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                                <div className="flex items-center justify-between">
                                  <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Project treasury
                                  </span>
                                  <span className="font-mono text-emerald-400">{remainder.toFixed(2)}%</span>
                                </div>
                              </div>
                            )
                          }
                          return null
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Reserved Token Splits */}
                  {reservedSplits.length > 0 && (
                    <div>
                      <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        Reserved Token Splits
                      </div>
                      <div className="space-y-2">
                        {reservedSplits.map((split, idx) => {
                          const percent = (split.percent / 1e9) * 100
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
                                <span className="font-mono text-amber-400">{percent.toFixed(2)}%</span>
                              </div>
                              {split.lockedUntil > 0 && (
                                <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                  Locked until {new Date(split.lockedUntil * 1000).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          )
                        })}
                        {/* Show remainder going to project owner */}
                        {(() => {
                          const totalPercent = reservedSplits.reduce((sum, s) => sum + (s.percent / 1e9) * 100, 0)
                          const remainder = 100 - totalPercent
                          if (remainder > 0.01) {
                            return (
                              <div className={`p-2 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                                <div className="flex items-center justify-between">
                                  <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                    Project owner
                                  </span>
                                  <span className="font-mono text-amber-400">{remainder.toFixed(2)}%</span>
                                </div>
                              </div>
                            )
                          }
                          return null
                        })()}
                      </div>
                    </div>
                  )}

                  {/* Surplus Allowances */}
                  {fundAccessLimits && fundAccessLimits.surplusAllowances.length > 0 && (
                    <div>
                      <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        Surplus Allowances
                      </div>
                      <div className="space-y-1">
                        {fundAccessLimits.surplusAllowances.map((allowance, idx) => (
                          <div key={idx} className="flex justify-between">
                            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                              {allowance.currency === 1 ? 'ETH' : allowance.currency === 2 ? 'USD' : `Currency ${allowance.currency}`}
                            </span>
                            <span className="font-mono">
                              {allowance.amount === '115792089237316195423570985008687907853269984665640564039457584007913129639935'
                                ? 'Unlimited'
                                : `${(parseFloat(allowance.amount) / (allowance.currency === 2 ? 1e6 : 1e18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${allowance.currency === 1 ? 'ETH' : 'USD'}`
                              }
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* No splits configured message */}
                  {payoutSplits.length === 0 && reservedSplits.length === 0 && (
                    <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      No splits configured. All payouts go to the project treasury and reserved tokens go to the project owner.
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* Help Section */}
            <Section id="help" title="What Does This Mean?">
              <div className="space-y-3 text-xs leading-relaxed">
                <p>
                  <strong>Issuance:</strong> How many tokens you get per ETH contributed.
                </p>
                <p>
                  <strong>Cut:</strong> Each cycle, the issuance rate decreases by this %. Early contributors get more tokens.
                </p>
                <p>
                  <strong>Reserved Rate:</strong> % of newly minted tokens that go to the project instead of the contributor.
                </p>
                <p>
                  <strong>Cash Out Tax:</strong> % taken when cashing out tokens.
                </p>
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}
