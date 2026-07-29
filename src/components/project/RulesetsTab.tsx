import { useEffect, useMemo, useState } from 'react'
import { useThemeStore } from '../../stores'
import { ExplainerMessage } from '../ui/ExplainerMessage'
import ChainLogo from '../ui/ChainLogo'
import { resolveBaseCurrency } from '../../utils/currency'
import { resolveProjectChains } from '../../utils/projectChains'
import type { ConnectedChain } from '../../services/bendystraw'
import {
  formatCountdown,
  formatDuration,
  formatDateTime,
  loadChainRulesetSignature,
  loadRulesetCarousel,
  projectCycle,
  relativeFromNow,
  ruleChanges,
  rulesetRows,
  truncAddr,
  formatFundsAccessLimits,
  SPLITS_TOTAL_PERCENT,
  ZERO_ADDRESS,
  type CarouselCycle,
  type CycleSplit,
  type RulesetCarouselData,
  type RulesetRow,
} from '../../services/rulesetCarousel'

// Project-page "Rulesets" tab — a 1:1 port of the website's Rulesets carousel
// card (website/src/discover.js renderRulesetsFundsSection): one card whose
// title doubles as a cycle stepper (offset 0 = current, 1 = upcoming, ±N =
// projected), two-column rule detail with per-cycle splits and fund access,
// diff highlighting against the chronologically previous cycle, an upcoming-
// rule-changes banner, and a cross-chain sync check.

/**
 * Which split group an "Edit" CTA targets. Reserved-token splits are a single
 * token-agnostic group; payout splits are per accounting-token (the group id is
 * that token's address). The dashboard maps this onto the SetSplits modal.
 */
export type EditSplitsTarget =
  | { group: 'reserved' }
  | { group: 'payout'; token: string; symbol: string }

export interface RulesetsTabProps {
  projectId: string
  chainId: string
  /** Revnets never get the queue button — their rules are locked. */
  isRevnet?: boolean
  /** Opens the queue-ruleset flow (the dashboard wires the modal). */
  onQueueRuleset?: () => void
  /**
   * Opens the edit-splits flow for a split group (the dashboard wires the
   * SetSplits modal). Shown only on the current cycle: reserved splits for any
   * project, payout splits for non-revnets (a revnet's payouts are locked, but
   * its operator can still edit reserved recipients).
   */
  onEditSplits?: (target: EditSplitsTarget) => void
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  8453: 'Base',
  42161: 'Arbitrum',
  11155111: 'Sepolia',
  11155420: 'OP Sepolia',
  84532: 'Base Sepolia',
  421614: 'Arb Sepolia',
}

type SyncState = 'checking' | 'synced' | 'differs' | null

function formatSplitPercent(percent: number): string {
  const value = (percent / SPLITS_TOTAL_PERCENT) * 100
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}%`
}

export default function RulesetsTab({ projectId, chainId, isRevnet = false, onQueueRuleset, onEditSplits }: RulesetsTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<RulesetCarouselData | null>(null)
  // 0 = current; 1 = upcoming; ±N = further cycles (real when known, else projected).
  const [offset, setOffset] = useState(0)
  const [chains, setChains] = useState<ConnectedChain[]>([])
  const [syncState, setSyncState] = useState<SyncState>(null)
  // The chain being viewed, with its own project id (ids can differ per chain).
  const [selected, setSelected] = useState<{ chainId: number; projectId: number }>({
    chainId: parseInt(chainId),
    projectId: Number(projectId),
  })

  // Connected chains + cross-chain sync check: compare each chain's current
  // ruleset signature (rules/flags only — timing is expected to differ).
  useEffect(() => {
    let cancelled = false
    setChains([])
    setSyncState(null)
    setSelected({ chainId: parseInt(chainId), projectId: Number(projectId) })
    resolveProjectChains(projectId, parseInt(chainId))
      .then(async resolution => {
        if (cancelled) return
        setChains(resolution.chains)
        if (resolution.chains.length <= 1) return
        setSyncState('checking')
        const signatures = await Promise.all(resolution.chains.map(chain =>
          loadChainRulesetSignature(chain.projectId, chain.chainId),
        ))
        if (cancelled) return
        const synced = signatures.every(signature => signature !== null && signature === signatures[0])
        setSyncState(synced ? 'synced' : 'differs')
      })
      .catch(() => {
        if (!cancelled) setSyncState(null)
      })
    return () => { cancelled = true }
  }, [projectId, chainId])

  // Carousel data for the selected chain.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setOffset(0)
    loadRulesetCarousel(selected.projectId, selected.chainId)
      .then(loaded => {
        if (!cancelled) setData(loaded)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load rulesets.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [selected])

  const current = data && data.currentIndex >= 0 ? data.cycles[data.currentIndex] : null

  // A cycle at an offset from the current one: the latest real cycle at or
  // before the target cycle number, projected the rest of the way (rules and
  // splits unchanged, weight decayed at cycle boundaries).
  const viewAt = useMemo(() => {
    if (!data || !current) return null
    const bases = data.cycles
    return (atOffset: number): CarouselCycle => {
      const target = current.rules.cycleNumber + atOffset
      let base = bases[0]
      for (const candidate of bases) {
        if (candidate.rules.cycleNumber <= target) base = candidate
      }
      return projectCycle(base, target - base.rules.cycleNumber)
    }
  }, [data, current])

  const view = viewAt ? viewAt(offset) : null
  const previous = viewAt && view && view.rules.cycleNumber > 1 ? viewAt(offset - 1) : null

  const upcoming = data?.cycles.find(cycle => cycle.relation === 'upcoming') ?? null
  const upcomingChanges = useMemo(() => {
    if (!current || !upcoming) return []
    return ruleChanges(
      current,
      upcoming,
      resolveBaseCurrency(current.metadata.baseCurrency),
      resolveBaseCurrency(upcoming.metadata.baseCurrency),
    )
  }, [current, upcoming])

  // -- render helpers --------------------------------------------------------

  const keyClass = `text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`
  const valClass = `text-sm text-right ${isDark ? 'text-gray-200' : 'text-gray-800'}`
  const sectionClass = `mt-4 mb-1.5 text-[10px] font-semibold uppercase tracking-wider ${
    isDark ? 'text-gray-500' : 'text-gray-400'
  }`

  const KvRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className={keyClass}>{label}</span>
      <span className={valClass}>{value}</span>
    </div>
  )

  // Changed row: red before-value, green new value (website rfDiffRow).
  const DiffRow = ({ label, from, to }: { label: string; from: string; to: string }) => (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className={keyClass}>{label}</span>
      <span className="flex flex-col items-end text-sm">
        <span className={isDark ? 'text-red-400' : 'text-red-600'}>− {from}</span>
        <span className={isDark ? 'text-emerald-400' : 'text-emerald-600'}>+ {to}</span>
      </span>
    </div>
  )

  // New-value-only row, green-highlighted (website rfNewRow) — for rows where
  // a before/after isn't meaningful (start time changes every cycle).
  const NewRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-start justify-between gap-4 py-1">
      <span className={keyClass}>{label}</span>
      <span className={`text-sm text-right ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>{value}</span>
    </div>
  )

  const RuleRow = ({ row, before }: { row: RulesetRow; before?: RulesetRow }) => {
    if (row.label === 'Start time') {
      return offset !== 0 ? <NewRow label={row.label} value={row.value} /> : <KvRow label={row.label} value={row.value} />
    }
    if (offset !== 0 && before && before.value !== row.value) {
      return <DiffRow label={row.label} from={before.value} to={row.value} />
    }
    return <KvRow label={row.label} value={row.value} />
  }

  // Subtle "Edit" CTA under a splits section (operator-gated inside the modal).
  const EditSplitsCta = ({ onClick }: { onClick: () => void }) => (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={onClick}
        className={`text-xs underline underline-offset-2 ${
          isDark ? 'text-juice-orange hover:text-orange-300' : 'text-orange-600 hover:text-orange-700'
        }`}
      >
        Edit
      </button>
    </div>
  )

  const SplitsList = ({ splits }: { splits: CycleSplit[] }) => {
    let total = 0
    const rows = splits.map((split, i) => {
      const percent = (split.percent / SPLITS_TOTAL_PERCENT) * 100
      total += percent
      const recipient = split.projectId > 0
        ? `Project #${split.projectId}`
        : split.hook && split.hook !== ZERO_ADDRESS
          ? `Hook ${truncAddr(split.hook)}`
          : truncAddr(split.beneficiary)
      return <KvRow key={`${split.beneficiary}-${i}`} label={recipient} value={formatSplitPercent(split.percent)} />
    })
    const leftover = 100 - total
    return (
      <div>
        {rows}
        {(splits.length === 0 || leftover > 0.0001) && (
          <KvRow
            label="Project owner"
            value={`${Number((splits.length ? leftover : 100).toFixed(2))}%`}
          />
        )}
      </div>
    )
  }

  // -- top-level states ------------------------------------------------------

  const cardClass = `border ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`

  const explainer = (
    <ExplainerMessage>
      {isRevnet
        ? 'Here’s how this revnet’s rules change over time. Every cycle was locked in when the revnet launched — no one can edit them.'
        : 'Here’s how this project’s rules change over time. Step through cycles to see the current rules, what’s queued next, and how issuance decays into the future.'}
    </ExplainerMessage>
  )

  if (loading) {
    return (
      <div className="w-full space-y-3">
        {explainer}
        <div className={`${cardClass} px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Loading rulesets...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full space-y-3">
        {explainer}
        <div className={`${cardClass} px-4 py-8 text-center text-red-400`}>{error}</div>
      </div>
    )
  }

  if (!data || !current || !view) {
    return (
      <div className="w-full space-y-3">
        {explainer}
        <div className={`${cardClass} px-4 py-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          No active ruleset found onchain.
        </div>
      </div>
    )
  }

  // -- derived view state ----------------------------------------------------

  const now = Math.floor(Date.now() / 1000)
  const baseUnit = resolveBaseCurrency(view.metadata.baseCurrency)
  const rows = rulesetRows(view, baseUnit, now)
  const previousRows = previous
    ? rulesetRows(previous, resolveBaseCurrency(previous.metadata.baseCurrency), now)
    : null

  const cycleContext = view.relation === 'current'
    ? 'Current'
    : view.relation === 'upcoming'
      ? 'Upcoming'
      : view.relation === 'past'
        ? 'Past'
        : offset > 0
          ? `Projected (+${offset})`
          : `Projected (${offset})`

  const statusText = view.rules.approvalHook !== ZERO_ADDRESS ? 'Approval hook' : 'Unlocked'
  // The current cycle always reads "Remaining" (a live countdown, or "—" when
  // it doesn't auto-cycle); other cycles read "Duration".
  const remainingLabel = offset === 0 ? 'Remaining' : 'Duration'
  let remainingText = '—'
  if (offset === 0 && view.rules.duration > 0) {
    const end = view.rules.start + view.rules.duration
    remainingText = end > now ? formatCountdown(end - now) : 'Ended'
  } else if (view.rules.duration > 0) {
    remainingText = formatDuration(view.rules.duration)
  }

  // Can't step earlier than cycle #1.
  const prevDisabled = view.rules.cycleNumber <= 1
  // No real next cycle when the viewed ruleset doesn't auto-cycle (duration 0)
  // and nothing later is queued — don't step into a phantom cycle.
  const target = current.rules.cycleNumber + offset
  const hasLaterReal = data.cycles.some(cycle => cycle.rules.cycleNumber > target)
  const nextDisabled = view.rules.duration === 0 && !hasLaterReal

  const arrowClass = (disabled: boolean) => `px-2 py-1 text-lg leading-none border ${
    disabled
      ? isDark ? 'border-white/5 text-gray-700 cursor-not-allowed' : 'border-gray-100 text-gray-300 cursor-not-allowed'
      : isDark
        ? 'border-white/10 text-gray-300 hover:bg-white/10'
        : 'border-gray-200 text-gray-600 hover:bg-gray-100'
  }`

  const upcomingStart = upcoming ? upcoming.rules.start : 0
  const ruleChangeTime = upcomingStart > now
    ? `Rules change in ${relativeFromNow(upcomingStart - now)} (${formatDateTime(upcomingStart)})`
    : 'Rules change when the queued cycle starts'

  const showUpcomingNotice = offset === 0 && upcoming !== null && upcomingChanges.length > 0

  const chainControl = chains.length > 1 && (
    syncState === 'synced' ? (
      <span className={`text-xs ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
        Synced across all chains
      </span>
    ) : syncState === 'differs' ? (
      <span className="inline-flex items-center gap-2">
        <ChainLogo chainId={selected.chainId} size={16} />
        <select
          value={selected.chainId}
          onChange={event => {
            const chain = chains.find(candidate => candidate.chainId === Number(event.target.value))
            if (chain) setSelected({ chainId: chain.chainId, projectId: chain.projectId })
          }}
          className={`select-caret pl-2 pr-6 py-1 text-xs border ${
            isDark ? 'bg-juice-dark border-white/10 text-white' : 'bg-white border-gray-200 text-gray-900'
          }`}
        >
          {chains.map(chain => (
            <option key={chain.chainId} value={chain.chainId}>
              {CHAIN_NAMES[chain.chainId] || `Chain ${chain.chainId}`}
            </option>
          ))}
        </select>
      </span>
    ) : syncState === 'checking' ? (
      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Checking chains…</span>
    ) : null
  )

  return (
    <div className="w-full space-y-3">
      {explainer}

      <div className={cardClass}>
        {/* Head row: title + chain control on the left, queue entry on the right. */}
        <div className={`px-4 py-3 flex items-center justify-between gap-3 border-b ${
          isDark ? 'border-white/10' : 'border-gray-100'
        }`}>
          <div className="flex items-center gap-3">
            <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Rulesets</span>
            {chainControl}
          </div>
          {isRevnet ? (
            <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Rules are locked — this revnet’s cycles can’t be queued or edited.
            </span>
          ) : onQueueRuleset ? (
            <div className="text-right">
              <button
                onClick={onQueueRuleset}
                className={`px-3 py-1.5 text-xs font-medium border ${
                  isDark
                    ? 'border-white/10 text-white hover:bg-white/10'
                    : 'border-gray-200 text-gray-900 hover:bg-gray-100'
                }`}
              >
                Queue ruleset
              </button>
              <div className={`mt-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Queued rules take effect when the current cycle ends.
              </div>
            </div>
          ) : null}
        </div>

        {/* Title bar doubling as the cycle carousel: ← Cycle #N Current →. */}
        <div className="px-4 pt-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { if (!prevDisabled) setOffset(offset - 1) }}
              disabled={prevDisabled}
              title="Earlier cycle"
              className={arrowClass(prevDisabled)}
            >
              ←
            </button>
            <span className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Cycle #{view.rules.cycleNumber}
            </span>
            <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{cycleContext}</span>
            <button
              onClick={() => { if (!nextDisabled) setOffset(offset + 1) }}
              disabled={nextDisabled}
              title="Later cycle"
              className={arrowClass(nextDisabled)}
            >
              →
            </button>
          </div>
          <div className={`mt-1 flex flex-wrap items-center gap-y-1 text-xs ${
            isDark ? 'text-gray-500' : 'text-gray-400'
          }`}>
            <span>{statusText}</span>
            <span className="mx-2 opacity-50">|</span>
            <span>{remainingLabel}: {remainingText}</span>
            {view.relation !== 'projected' && view.rules.id > 0 && (
              <>
                <span className="mx-2 opacity-50">|</span>
                <span>ID: {view.rules.id}</span>
              </>
            )}
          </div>
        </div>

        {/* Upcoming rule changes banner (current cycle only). */}
        {showUpcomingNotice && (
          <div className={`mx-4 mt-4 border p-3 ${
            isDark ? 'border-amber-500/30 bg-amber-500/10' : 'border-amber-300 bg-amber-50'
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className={`text-sm font-semibold ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>
                  Upcoming rule changes
                </div>
                <div className={`text-xs ${isDark ? 'text-amber-300/70' : 'text-amber-700'}`}>{ruleChangeTime}</div>
              </div>
              <button
                onClick={() => setOffset(1)}
                className={`px-3 py-1.5 text-xs font-medium border ${
                  isDark
                    ? 'border-amber-500/30 text-amber-300 hover:bg-amber-500/10'
                    : 'border-amber-300 text-amber-800 hover:bg-amber-100'
                }`}
              >
                View upcoming
              </button>
            </div>
            <div className="mt-2">
              {upcomingChanges.map(change => (
                <DiffRow
                  key={`${change.section}|${change.label}`}
                  label={`${change.section} | ${change.label}`}
                  from={change.from}
                  to={change.to}
                />
              ))}
            </div>
          </div>
        )}

        {/* Two-column rule detail. LEFT: CYCLE | OTHER RULES | per-token FUNDS
            ACCESS + PAYOUT SPLITS. RIGHT: TOKEN | RESERVED TOKEN SPLITS | EXTENSION. */}
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-x-8">
          <div>
            {(['CYCLE', 'OTHER RULES'] as const).map(section => (
              <div key={section}>
                <div className={sectionClass}>{section}</div>
                {rows.map((row, i) => row.section === section && (
                  <RuleRow key={row.label} row={row} before={previousRows?.[i]} />
                ))}
              </div>
            ))}
            {view.fundsAccess.map(context => (
              <div key={context.token}>
                <div className={sectionClass}>{context.symbol} FUNDS ACCESS</div>
                <KvRow label="Payout limit per cycle" value={formatFundsAccessLimits(context.payoutLimits, context)} />
                <KvRow label="Surplus allowance" value={formatFundsAccessLimits(context.surplusAllowances, context)} />
                <div className={sectionClass}>{context.symbol} PAYOUT SPLITS</div>
                <SplitsList splits={context.payoutSplits} />
                {offset === 0 && onEditSplits && !isRevnet && (
                  <EditSplitsCta onClick={() => onEditSplits({ group: 'payout', token: context.token, symbol: context.symbol })} />
                )}
              </div>
            ))}
          </div>
          <div>
            <div className={sectionClass}>TOKEN</div>
            {rows.map((row, i) => row.section === 'TOKEN' && (
              <RuleRow key={row.label} row={row} before={previousRows?.[i]} />
            ))}
            <div className={sectionClass}>RESERVED TOKEN SPLITS</div>
            <SplitsList splits={view.reservedSplits} />
            {offset === 0 && onEditSplits && (
              <EditSplitsCta onClick={() => onEditSplits({ group: 'reserved' })} />
            )}
            <div className={sectionClass}>EXTENSION</div>
            {rows.map((row, i) => row.section === 'EXTENSION' && (
              <RuleRow key={row.label} row={row} before={previousRows?.[i]} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
