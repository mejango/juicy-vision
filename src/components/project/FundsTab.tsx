import { useEffect, useState } from 'react'
import { useThemeStore } from '../../stores'
import { CHAINS } from '../../constants'
import {
  fetchEthPrice,
  fetchProjectSplits,
  type JBSplitData,
  type JBSplitGroupData,
  type Project,
} from '../../services/bendystraw'
import {
  formatAccessRows,
  formatKindAmount,
  loadFundsSnapshot,
  totalBalanceUsd,
  type FundsChainRow,
  type FundsKindSnapshot,
  type FundsSnapshot,
} from '../../services/fundsSnapshot'
import { resolveProjectChains } from '../../utils/projectChains'
import { truncateAddress } from '../../utils/ens'
import { ExplainerMessage } from '../ui/ExplainerMessage'
import { ChainMappingWarning } from '../dynamic/ChainMappingWarning'
import { ProjectSplitRoute } from '../dynamic/ProjectSplitRoute'

interface FundsTabProps {
  project: Project
  isOwner: boolean
  /** Opens the Distribute payouts modal for the kind's home-chain token. */
  onSendPayouts: (kindTokenAddress: string) => void
  /** Opens the Use surplus allowance modal for the kind's home-chain token. */
  onUseAllowance: (kindTokenAddress: string) => void
  /** Jumps to the Rulesets tab (the dashboard wires it). Renders "Current" as a link when set. */
  onViewRulesets?: () => void
}

const SPLIT_PERCENT_DENOMINATOR = 1_000_000_000n

/** Compact USD figure matching the project header (formatUsd). */
function formatUsdTotal(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  if (value > 0 && value < 0.01) return '<$0.01'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function chainName(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`
}

function ChainCell({ chainId, isDark }: { chainId: number; isDark: boolean }) {
  const info = CHAINS[chainId]
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      {info && <span className="w-1.5 h-1.5 flex-shrink-0" style={{ backgroundColor: info.color }} />}
      <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>{chainName(chainId)}</span>
    </span>
  )
}

// Payouts table (home chain): percent | recipient | amount distributable now.
// Splits are keyed by the home accounting token; leftover goes to the owner.
// Cross-currency limits need a live price conversion, so exact recipient
// amounts stay in the transaction modal where the terminal call is simulated.
function PayoutsBox({
  kindSnapshot,
  homeRow,
  splits,
  splitsAvailable,
  owner,
  isDark,
}: {
  kindSnapshot: FundsKindSnapshot
  homeRow: FundsChainRow | undefined
  splits: JBSplitData[]
  splitsAvailable: boolean
  owner: string
  isDark: boolean
}) {
  const muted = isDark ? 'text-gray-400' : 'text-gray-500'
  if (!homeRow || !homeRow.ok) {
    return <div className={`text-xs ${muted}`}>Could not read payouts.</div>
  }
  const direct = homeRow.payouts.find(entry => entry.currency === homeRow.currency) ?? null
  if (!direct) {
    return (
      <div className={`text-xs ${muted}`}>
        {homeRow.payouts.length
          ? 'Recipient amounts require live currency conversion. Open Distribute payouts for an exact simulated quote.'
          : 'No payout limit is configured for this token in the current ruleset.'}
      </div>
    )
  }
  if (!splitsAvailable) {
    return <div className={`text-xs ${muted}`}>Could not read payouts.</div>
  }

  const { kind } = kindSnapshot
  const balance = homeRow.balance ?? 0n
  const distributable = balance < direct.remaining ? balance : direct.remaining
  const rows: Array<{ percent: bigint; recipient: JBSplitData | 'owner'; amount: bigint }> = []
  let splitPercentSum = 0n
  let splitAmountSum = 0n
  for (const split of splits) {
    const percent = BigInt(split.percent)
    const amount = (distributable * percent) / SPLIT_PERCENT_DENOMINATOR
    splitPercentSum += percent
    splitAmountSum += amount
    rows.push({ percent, recipient: split, amount })
  }
  if (splits.length === 0 || splitPercentSum < SPLIT_PERCENT_DENOMINATOR) {
    rows.push({
      percent: SPLIT_PERCENT_DENOMINATOR - splitPercentSum,
      recipient: 'owner',
      amount: distributable - splitAmountSum,
    })
  }

  const headerClass = `text-left text-[10px] font-medium uppercase tracking-wide pb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] text-xs">
        <thead>
          <tr className={`border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <th className={headerClass}>Percent</th>
            <th className={headerClass}>Recipient</th>
            <th className={`${headerClass} text-right`}>Available</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const percent = Number(row.percent) / 1e7
            return (
              <tr key={index} className={`border-b last:border-b-0 ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                <td className={`py-1.5 pr-3 font-mono whitespace-nowrap ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  {percent.toFixed(percent % 1 === 0 ? 0 : 2)}%
                </td>
                <td className="py-1.5 pr-3">
                  {row.recipient === 'owner' ? (
                    <span className={`font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {owner ? `${truncateAddress(owner)} (project owner)` : "Project owner"}
                    </span>
                  ) : row.recipient.projectId > 0 ? (
                    <ProjectSplitRoute
                      projectId={row.recipient.projectId}
                      chainId={homeRow.chainId}
                      beneficiary={row.recipient.beneficiary}
                      kind="payout"
                      preferAddToBalance={row.recipient.preferAddToBalance}
                      hook={row.recipient.hook}
                      isDark={isDark}
                    />
                  ) : (
                    <span className={`font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {truncateAddress(row.recipient.beneficiary || '')}
                      {row.recipient.lockedUntil > Math.floor(Date.now() / 1000) && (
                        <span className="ml-1 text-[10px] text-amber-500">Locked</span>
                      )}
                    </span>
                  )}
                </td>
                <td className={`py-1.5 text-right font-mono whitespace-nowrap ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {formatKindAmount(row.amount, kind.decimals, kind.symbol)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// One accounting-token kind: balance total, per-chain table, payouts + surplus columns.
function FundsKindBlock({
  kindSnapshot,
  homeChainId,
  splits,
  splitsAvailable,
  owner,
  onSendPayouts,
  onUseAllowance,
  onViewRulesets,
  isDark,
}: {
  kindSnapshot: FundsKindSnapshot
  homeChainId: number
  splits: JBSplitData[]
  splitsAvailable: boolean
  owner: string
  onSendPayouts: (kindTokenAddress: string) => void
  onUseAllowance: (kindTokenAddress: string) => void
  onViewRulesets?: () => void
  isDark: boolean
}) {
  const { kind, rows, totals } = kindSnapshot
  const homeRow = rows.find(row => row.chainId === homeChainId)
  const label = `text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`
  const mono = `font-mono ${isDark ? 'text-white' : 'text-gray-900'}`
  const headerClass = `text-left text-[10px] font-medium uppercase tracking-wide pb-1 pr-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`
  const buttonClass = `px-3 py-1.5 text-xs font-medium border transition-colors ${
    isDark
      ? 'text-juice-orange border-juice-orange/50 hover:text-orange-300 hover:border-orange-300'
      : 'text-orange-600 border-orange-500 hover:text-orange-700 hover:border-orange-600'
  }`

  // "Current" reads from the active ruleset — link it to the Rulesets tab when wired.
  const currentWord = onViewRulesets ? (
    <button
      type="button"
      onClick={onViewRulesets}
      className={`underline underline-offset-2 ${isDark ? 'text-juice-orange hover:text-orange-300' : 'text-orange-600 hover:text-orange-700'}`}
    >
      Current
    </button>
  ) : (
    'Current'
  )

  return (
    <div>
      {/* Balance across chains: any failed chain suppresses the total ("—"). */}
      <div className={`${label} mb-1`}>Balance</div>
      <div className={`text-lg font-semibold mb-3 ${mono}`} title={`${kind.name ? `${kind.name} | ` : ''}${kind.homeToken}`}>
        {totals.allChainsOk ? formatKindAmount(totals.balance, kind.decimals, kind.symbol) : '—'}
      </div>

      {/* Per-chain table */}
      <div className="overflow-x-auto mb-4">
        <table className="w-full min-w-[560px] text-xs">
          <thead>
            <tr className={`border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              <th className={headerClass}>Chain</th>
              <th className={headerClass}>Balance</th>
              <th className={headerClass}>Payout limit remaining</th>
              <th className={headerClass}>Surplus</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.chainId} className={`border-b last:border-b-0 ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                <td className="py-1.5 pr-4"><ChainCell chainId={row.chainId} isDark={isDark} /></td>
                <td className={`py-1.5 pr-4 whitespace-nowrap ${mono}`}>
                  {row.ok ? formatKindAmount(row.balance, row.decimals, kind.symbol) : '—'}
                </td>
                <td className={`py-1.5 pr-4 whitespace-nowrap ${mono}`}>
                  {row.ok ? formatAccessRows(row.payouts, row, kind.symbol) : '—'}
                </td>
                <td className={`py-1.5 whitespace-nowrap ${mono}`}>
                  {row.ok ? formatKindAmount(row.surplus, row.decimals, kind.symbol) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payouts + surplus columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className={`${label} mb-1`}>
            {currentWord} payout limit remaining on {chainName(homeChainId)}:
          </div>
          <div className={`text-sm mb-3 ${mono}`}>
            {homeRow?.ok ? formatAccessRows(homeRow.payouts, homeRow, kind.symbol) : '—'}
          </div>
          <div className={`${label} mb-1`}>Payouts</div>
          <PayoutsBox
            kindSnapshot={kindSnapshot}
            homeRow={homeRow}
            splits={splits}
            splitsAvailable={splitsAvailable}
            owner={owner}
            isDark={isDark}
          />
          <button type="button" onClick={() => onSendPayouts(kind.homeToken)} className={`${buttonClass} mt-3`}>
            Distribute payouts
          </button>
          <div className={`${label} mt-2`}>
            Payouts are permissionless: anyone can trigger them, and funds only ever go to the recipients configured above.
          </div>
        </div>
        <div>
          <div className={`${label} mb-1`}>
            {currentWord} surplus allowance remaining on {chainName(homeChainId)}:
          </div>
          <div className={`text-sm mb-3 ${mono}`}>
            {homeRow?.ok ? formatAccessRows(homeRow.allowances, homeRow, kind.symbol) : '—'}
          </div>
          {/* Not pre-disabled for non-owners: operators (not just the owner) can hold the
              USE_ALLOWANCE permission, so the modal's live simulation is the real gate. */}
          <button
            type="button"
            onClick={() => onUseAllowance(kind.homeToken)}
            className={`${buttonClass} mt-3`}
          >
            Use surplus allowance
          </button>
          <div className={`${label} mt-2`}>
            The allowance draws from surplus and takes the 2.5% protocol fee unless the project is feeless.
          </div>
        </div>
      </div>
    </div>
  )
}

export default function FundsTab({ project, onSendPayouts, onUseAllowance, onViewRulesets }: FundsTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<FundsSnapshot | null>(null)
  const [splitGroups, setSplitGroups] = useState<JBSplitGroupData[] | null>(null)
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [activeKindIndex, setActiveKindIndex] = useState(0)
  const [ethPrice, setEthPrice] = useState<number | null>(null)
  const [ethPriceResolved, setEthPriceResolved] = useState(false)

  // ETH/USD spot for the cross-token total (only needed for multi-token projects).
  useEffect(() => {
    let cancelled = false
    fetchEthPrice()
      .then(price => { if (!cancelled) { setEthPrice(price); setEthPriceResolved(true) } })
      .catch(() => { if (!cancelled) setEthPriceResolved(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        setError(null)
        const resolution = await resolveProjectChains(String(project.projectId), project.chainId)
        if (cancelled) return
        setChainMappingAvailable(resolution.mappingAvailable)
        const loaded = await loadFundsSnapshot(
          { projectId: project.projectId, chainId: project.chainId },
          resolution.chains,
        )
        if (cancelled) return
        setSnapshot(loaded)
        setActiveKindIndex(0)

        // Home-chain splits for every kind's Payouts table (groups keyed by token).
        const homeRulesetId = loaded.kinds
          .map(kind => kind.rows.find(row => row.chainId === project.chainId))
          .find(row => row?.ok && row.rulesetId)?.rulesetId
        if (homeRulesetId) {
          try {
            const splitsData = await fetchProjectSplits(
              String(project.projectId),
              project.chainId,
              homeRulesetId.toString(),
            )
            if (!cancelled) setSplitGroups(splitsData.splitGroups ?? [])
          } catch {
            if (!cancelled) setSplitGroups(null)
          }
        } else {
          setSplitGroups(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not read the project's funds.")
          setSnapshot(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [project.projectId, project.chainId])

  const containerClass = `p-4 border ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`

  if (loading) {
    return (
      <div className={`${containerClass} animate-pulse`}>
        <div className={`h-5 w-24 mb-4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        <div className="space-y-3">
          <div className={`h-4 w-40 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className={`h-4 w-full ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className={`h-4 w-2/3 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        </div>
      </div>
    )
  }

  if (error || !snapshot) {
    return (
      <div className={containerClass}>
        <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Could not read the project&rsquo;s funds.{error ? ` ${error}` : ''}
        </div>
      </div>
    )
  }

  const kinds = snapshot.kinds
  if (kinds.length === 0) {
    return (
      <div className={containerClass}>
        <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          No verified accounting contexts are configured for this project.
        </div>
      </div>
    )
  }

  const activeKind = kinds[Math.min(activeKindIndex, kinds.length - 1)]
  const splitsFor = (kindSnapshot: FundsKindSnapshot): JBSplitData[] =>
    splitGroups?.find(group => group.groupId === BigInt(kindSnapshot.kind.homeToken).toString())?.splits ?? []

  return (
    <div className={containerClass}>
      {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}

      <div className="mb-4">
        <ExplainerMessage>
          Each accounting token the project accepts has its own treasury: a balance on every chain, a payout
          limit that caps what can leave for recipients each ruleset cycle, and a surplus that backs cash outs.
        </ExplainerMessage>
      </div>

      {/* Cross-token USD total (multi-token projects) — the same figure as the header card. */}
      {kinds.length > 1 && (() => {
        const needsEthPrice = kinds.some(
          k => k.kind.key === 'native' && k.totals.allChainsOk && (k.totals.balance ?? 0n) > 0n,
        )
        const totalText = needsEthPrice && !ethPriceResolved
          ? '…'
          : formatUsdTotal(totalBalanceUsd(kinds, ethPrice))
        return (
          <div className="mb-4">
            <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Total balance</div>
            <div className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{totalText}</div>
          </div>
        )
      })()}

      {/* One subtab per accounting-token kind (multi-token projects only). */}
      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {kinds.map((kindSnapshot, index) => {
            const active = kindSnapshot === activeKind
            const balanceLabel = kindSnapshot.totals.allChainsOk
              ? formatKindAmount(kindSnapshot.totals.balance, kindSnapshot.kind.decimals, kindSnapshot.kind.symbol)
              : kindSnapshot.kind.symbol
            return (
              <button
                key={kindSnapshot.kind.key}
                type="button"
                onClick={() => setActiveKindIndex(index)}
                title={`${kindSnapshot.kind.name ? `${kindSnapshot.kind.name} | ` : ''}${kindSnapshot.kind.homeToken}`}
                className={`px-3 py-2 text-xs font-medium border ${
                  active
                    ? isDark
                      ? 'border-green-400 text-green-400 bg-green-500/10'
                      : 'border-green-600 text-green-700 bg-green-50'
                    : isDark
                      ? 'border-white/10 text-gray-400 hover:text-gray-300'
                      : 'border-gray-200 text-gray-600 hover:text-gray-700'
                }`}
              >
                {active ? kindSnapshot.kind.symbol : balanceLabel}
              </button>
            )
          })}
        </div>
      )}

      <FundsKindBlock
        kindSnapshot={activeKind}
        homeChainId={project.chainId}
        splits={splitsFor(activeKind)}
        splitsAvailable={splitGroups !== null}
        owner={project.owner}
        onSendPayouts={onSendPayouts}
        onUseAllowance={onUseAllowance}
        onViewRulesets={onViewRulesets}
        isDark={isDark}
      />
    </div>
  )
}
