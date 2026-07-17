import { useEffect, useMemo, useState } from 'react'
import { useThemeStore } from '../../stores'
import { fetchRevnetStages, type ConnectedChain, type RevnetStage } from '../../services/bendystraw'
import {
  WEIGHT_CUT_SCALE,
  activeStageIndexAt,
  fetchStageAutoIssuanceTotals,
  formatCountdown,
  formatCutPercent,
  formatIssuanceRate,
  formatTokenCount18,
  issuanceAtTime,
  nextCutAt,
  percentFromBasisPoints,
  type StageTerms,
} from '../../services/revnetStages'
import { resolveBaseCurrency } from '../../utils/currency'
import { ExplainerMessage } from '../ui/ExplainerMessage'

// Terms tab (revnets only) — 1:1 port of website/src/discover.js
// renderStagesSection (:13033): the "Token issuance" card (renderIssuance
// :13354 — current rate + cut/reserved subtexts) and the per-stage terms
// table (renderTermsTable :13051 — Stage | Period | Issuance | Split limit |
// Auto issuance | Cash out tax), with per-stage auto-issuance totals summed
// across chains + beneficiaries loaded async (loadStageAutoIssuanceTotals
// :13145). Read-only — no transactions on this tab.

interface TermsTabProps {
  projectId: number
  chainId: number
  connectedChains: ConnectedChain[]
  /** Project token symbol; falls back to "tokens". */
  tokenSymbol?: string | null
  /** Ruleset base currency (1 = ETH, 2 = USD) — the unit issuance is quoted per. */
  baseCurrency?: number
}

function stageTerms(stage: RevnetStage): StageTerms {
  return {
    start: stage.startsAtOrAfter,
    duration: stage.issuanceDecayFrequency,
    weight: stage.initialIssuance,
    weightCutPercent: stage.issuanceDecayPercent,
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function TermsTab({
  projectId,
  chainId,
  connectedChains,
  tokenSymbol,
  baseCurrency,
}: TermsTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [stages, setStages] = useState<RevnetStage[] | null>(null)
  const [stagesLoading, setStagesLoading] = useState(true)
  const [stagesError, setStagesError] = useState<string | null>(null)

  // Per-stage auto-issuance totals: null = loading, {} after a failed load
  // (cells fall back to "—" instead of fabricated totals).
  const [autoTotals, setAutoTotals] = useState<Record<number, bigint> | null>(null)

  const chains = useMemo<ConnectedChain[]>(() => (
    connectedChains.length > 0 ? connectedChains : [{ chainId, projectId }]
  ), [connectedChains, chainId, projectId])

  useEffect(() => {
    let cancelled = false
    async function loadStages() {
      setStagesLoading(true)
      setStages(null)
      setStagesError(null)
      try {
        const result = await fetchRevnetStages(String(projectId), chainId)
        if (cancelled) return
        setStages(result ? result.stages : [])
      } catch (error) {
        if (!cancelled) {
          setStagesError(error instanceof Error ? error.message : 'Could not read stages.')
        }
      } finally {
        if (!cancelled) setStagesLoading(false)
      }
    }
    loadStages()
    return () => { cancelled = true }
  }, [projectId, chainId])

  useEffect(() => {
    if (!stages || stages.length === 0) return
    let cancelled = false
    setAutoTotals(null)
    fetchStageAutoIssuanceTotals(chains)
      .then(totals => { if (!cancelled) setAutoTotals(totals) })
      .catch(() => { if (!cancelled) setAutoTotals({}) })
    return () => { cancelled = true }
  }, [stages, chains])

  const sym = tokenSymbol || 'tokens'
  const unit = resolveBaseCurrency(baseCurrency)
  const now = Math.floor(Date.now() / 1000)

  const cardClass = `p-4 border ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`
  const cardTitleClass = `text-xs font-semibold uppercase tracking-wider mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`
  const subTextClass = `text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`

  const explainer = (
    <ExplainerMessage>
      This is an autonomous revnet — its terms are locked in stages that were fixed at launch
      and can never be changed by anyone. Each stage sets the issuance rate (and how it cuts
      over time), the split limit, any automatic issuance, and the cash out tax.
    </ExplainerMessage>
  )

  if (stagesLoading) {
    return (
      <div className="space-y-6">
        {explainer}
        <div className={`${cardClass} animate-pulse`}>
          <div className={`h-5 w-24 mb-4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className="space-y-2">
            <div className={`h-4 w-48 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className={`h-4 w-64 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className={`h-4 w-40 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          </div>
        </div>
      </div>
    )
  }

  if (stagesError || !stages || stages.length === 0) {
    return (
      <div className="space-y-6">
        {explainer}
        <div className={cardClass}>
          <div className={cardTitleClass}>Terms</div>
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {stagesError ? 'Could not read stages.' : 'No stages found onchain.'}
          </p>
          {stagesError && (
            <p className={`mt-2 break-words text-xs ${isDark ? 'text-red-300' : 'text-red-700'}`}>
              {stagesError}
            </p>
          )}
        </div>
      </div>
    )
  }

  // fetchRevnetStages returns start-ascending stages.
  const terms = stages.map(stageTerms)
  const activeIndex = activeStageIndexAt(terms, now)
  const activeStage = stages[activeIndex]
  const activeTerms = terms[activeIndex]
  const currentRate = issuanceAtTime(terms, now)
  const cutTime = nextCutAt(activeTerms, now)
  const nextRate = currentRate * (WEIGHT_CUT_SCALE - activeTerms.weightCutPercent) / WEIGHT_CUT_SCALE

  return (
    <div className="space-y-6">
      {explainer}

      {/* Token issuance card (website renderIssuance :13354) */}
      <div className={cardClass}>
        <div className={cardTitleClass}>Token issuance</div>
        <div className={`text-2xl font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {currentRate > 0 ? `${formatIssuanceRate(currentRate)} ${sym} / ${unit}` : 'No issuance'}
        </div>
        {currentRate > 0 && cutTime !== null && (
          <div className={`mt-1 ${subTextClass}`}>
            Cuts to {formatIssuanceRate(nextRate)} {sym} / {unit} in{' '}
            {cutTime > now ? formatCountdown(cutTime - now) : 'the next cycle'}
          </div>
        )}
        {currentRate > 0 && cutTime === null && (
          <div className={`mt-1 ${subTextClass}`}>Fixed issuance — no scheduled cut.</div>
        )}
        <div className={`mt-1 ${subTextClass}`}>
          {percentFromBasisPoints(activeStage.splitPercent)} of issuance and buybacks to splits
        </div>
      </div>

      {/* Per-stage terms table (website renderTermsTable :13051) */}
      <div className={cardClass}>
        <div className={cardTitleClass}>Terms</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={`text-left text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <th className="py-2 pr-4 font-medium">Stage</th>
                <th className="py-2 pr-4 font-medium">Period</th>
                <th className="py-2 pr-4 font-medium">Issuance ({sym}/{unit})</th>
                <th className="py-2 pr-4 font-medium">Split limit</th>
                <th className="py-2 pr-4 font-medium">Auto issuance ({sym})</th>
                <th className="py-2 font-medium">Cash out tax</th>
              </tr>
            </thead>
            <tbody className={isDark ? 'text-gray-200' : 'text-gray-700'}>
              {stages.map((stage, i) => {
                const isCurrent = i === activeIndex
                const nextStart = i + 1 < stages.length ? stages[i + 1].startsAtOrAfter : null
                const initialRate = Number(stage.initialIssuance) / 1e18
                const total = autoTotals?.[i]
                return (
                  <tr
                    key={stage.stageNumber}
                    className={`border-t ${isDark ? 'border-white/10' : 'border-gray-200'} ${
                      isCurrent ? (isDark ? 'bg-juice-orange/10' : 'bg-orange-50') : ''
                    }`}
                  >
                    <td className="py-2 pr-4 align-top">
                      <span className="font-medium">{i + 1}</span>
                      {isCurrent && (
                        <div className="text-xs text-juice-orange">active</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 align-top whitespace-nowrap">
                      <div>
                        {formatDate(stage.startsAtOrAfter)} – {nextStart ? formatDate(nextStart) : 'forever'}
                      </div>
                      {nextStart && (
                        <div className={subTextClass}>
                          {Math.round((nextStart - stage.startsAtOrAfter) / 86400)} days
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4 align-top">
                      <div>{initialRate === 0 ? '0' : formatIssuanceRate(initialRate)}</div>
                      {stage.issuanceDecayPercent > 0 && stage.issuanceDecayFrequency > 0 && (
                        <div className={`${subTextClass} whitespace-nowrap`}>
                          cut {formatCutPercent(stage.issuanceDecayPercent)} every{' '}
                          {Math.round(stage.issuanceDecayFrequency / 86400)} days
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-4 align-top">
                      {percentFromBasisPoints(stage.splitPercent)}
                    </td>
                    <td className="py-2 pr-4 align-top">
                      {autoTotals === null ? (
                        <span className={subTextClass}>…</span>
                      ) : total && total > 0n ? (
                        formatTokenCount18(total)
                      ) : (
                        <span className={subTextClass}>—</span>
                      )}
                    </td>
                    <td className="py-2 align-top">
                      {percentFromBasisPoints(stage.cashOutTaxRate)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
