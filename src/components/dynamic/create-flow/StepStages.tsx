/**
 * Create-flow step: Stages (revnet flavor) — a 1:1 port of the website's
 * renderRevnetStages / revStageCard / revStageEditor / revStageTiming
 * (website/src/create-flow.js). Copy comes verbatim from the source flow.
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { AutoIssuance, CreateFlowState, RecipientRow, StageState } from './state'
import {
  createStage, localTimezoneLabel, lockedCurrencySym, round2, surplusTokenLabel, tickerLabel, tsToLocal,
} from './state'
import { revPrevCutFreqDays, snapDaysAfter } from './builders'
import {
  AddLink, CurrencySelect, EnsAddressInput, Hint, InfoNote, NumberInput, StepHead, TextInput, ToggleRow,
  inputClass, useIsDark,
} from './controls'
import { CashOutTaxCard, PerChainAddrControl, ReservedSplitRow, SplitRowShell } from './pickers'

interface StepProps {
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
}

// ---------------------------------------------------------------------------
// Helpers — mirrors of the website's revnet stage-summary math
// ---------------------------------------------------------------------------

function revSplitTotalPct(stage: StageState): number {
  return (stage.reservedRecipients || []).reduce((s, x) => s + (Number(x.percent) || 0), 0)
}

/** One-line stage summary (also shown per stage on the Deploy review). */
export function revStageSummary(stage: StageState, idx: number, state: CreateFlowState): string {
  const tk = tickerLabel(state)
  const unit = state.revBaseCurrency === 2 ? 'USD' : 'ETH'
  const parts: string[] = []
  if (idx === 0 || stage.weight) parts.push((stage.weight || '0') + ' $' + tk + '/' + unit)
  else parts.push('inherits issuance')
  if (stage.issuanceCutOn && Number(stage.weightCutPercent) > 0) parts.push('−' + round2(stage.weightCutPercent) + '%/' + (stage.cutFreqDays || '30') + 'd')
  const splitTotal = revSplitTotalPct(stage)
  if (splitTotal > 0) parts.push(round2(splitTotal) + '% to splits')
  parts.push(round2(Number(stage.cashOutTaxRate)) + '% cash out tax')
  return parts.join(' | ')
}

// ---------------------------------------------------------------------------
// Section head — the website's .create-rev-h
// ---------------------------------------------------------------------------

function SectionHead({ children }: { children: ReactNode }) {
  const isDark = useIsDark()
  return <div className={`text-sm font-semibold mt-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>{children}</div>
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

export default function StepStages({ state, update }: StepProps) {
  return (
    <div>
      <StepHead desc="Issuance and cash out rules evolve over time automatically in stages. Staged rules can’t be edited once deployed." />
      {state.stages.map((stage, idx) => (
        <StageCard key={idx} state={state} update={update} stage={stage} idx={idx} />
      ))}
      <AddLink
        label="+ Add stage"
        onClick={() => update((s) => {
          const prev = s.stages[s.stages.length - 1]
          const st = createStage()
          st.weight = '' // later stages inherit issuance (with the cut applied) unless set
          if (prev) { st.cashOutTaxRate = prev.cashOutTaxRate; st.cutFreqDays = prev.cutFreqDays }
          s.stages.forEach((x) => { x.expanded = false })
          st.expanded = true
          s.stages.push(st)
        })}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stage card — collapsible header with single-line summary
// ---------------------------------------------------------------------------

function StageCard({ state, update, stage, idx }: StepProps & { stage: StageState; idx: number }) {
  const isDark = useIsDark()
  return (
    <div className={`border mb-3 ${isDark ? 'border-white/10 bg-white/[0.03]' : 'border-gray-200 bg-gray-50/50'}`}>
      <div
        className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none"
        onClick={() => update((s) => { s.stages[idx].expanded = !s.stages[idx].expanded })}
      >
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Stage #{idx + 1}</div>
          <div className={`text-xs mt-0.5 truncate ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {revStageSummary(stage, idx, state)}
          </div>
        </div>
        {idx > 0 && (
          <button
            type="button"
            title="Remove"
            className="text-gray-500 hover:text-red-400 shrink-0"
            onClick={(e) => { e.stopPropagation(); update((s) => { s.stages.splice(idx, 1) }) }}
          >
            ✕
          </button>
        )}
        <span className={`text-xs shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{stage.expanded ? '▾' : '▸'}</span>
      </div>
      {stage.expanded && (
        <div className="px-4 pb-4">
          <StageEditor state={state} update={update} stage={stage} idx={idx} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stage editor — 1. issuance, 2. cash outs, 3. start time
// ---------------------------------------------------------------------------

function StageEditor({ state, update, stage, idx }: StepProps & { stage: StageState; idx: number }) {
  const isDark = useIsDark()
  const tk = tickerLabel(state)
  const acctSym = surplusTokenLabel(state)
  const splitTotal = revSplitTotalPct(stage)
  const aiTotal = (stage.autoIssuances || []).reduce((s, a) => s + (Number(a.count) || 0), 0)

  // Revnets always allow cash outs — the only exit besides loans.
  useEffect(() => {
    if (!stage.cashOutEnabled) update((s) => { if (s.stages[idx]) s.stages[idx].cashOutEnabled = true })
  }, [stage.cashOutEnabled, idx, update])

  const patchStage = (fn: (st: StageState) => void) => update((s) => { if (s.stages[idx]) fn(s.stages[idx]) })

  return (
    <div>
      {/* 1. Issuance */}
      <SectionHead>${tk} issuance</SectionHead>
      <Hint>How many ${tk} to issue when receiving ETH.</Hint>
      <div className="flex items-center gap-2 flex-wrap mt-2 text-sm">
        <NumberInput
          value={stage.weight || ''}
          onChange={(v) => patchStage((st) => { st.weight = v.trim() })}
          placeholder={idx === 0 ? '10000' : 'inherit'}
          min={0} step="any"
          className="w-28"
        />
        <span>${tk} per</span>
        <CurrencySelect
          value={state.revBaseCurrency}
          onChange={(v) => update((s) => { s.revBaseCurrency = v })}
          lockedSymbol={lockedCurrencySym(state)}
        />
        <span className={`text-xs ml-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>add auto cuts?</span>
        <input
          type="checkbox"
          className="accent-teal-500"
          checked={!!stage.issuanceCutOn}
          onChange={(e) => patchStage((st) => { st.issuanceCutOn = e.target.checked; if (!e.target.checked) st.weightCutPercent = 0 })}
        />
      </div>
      {idx > 0 && <InfoNote>Leave blank to inherit the previous stage’s issuance (with any cut applied).</InfoNote>}

      {stage.issuanceCutOn && (
        <div className="flex items-center gap-2 flex-wrap mt-2 text-sm">
          <span>cut</span>
          <NumberInput
            value={String(stage.weightCutPercent || 0)}
            onChange={(v) => patchStage((st) => { st.weightCutPercent = Math.max(0, Math.min(100, Number(v) || 0)) })}
            min={0} max={100} step={0.5}
            className="w-20"
          />
          <span>% every</span>
          <NumberInput
            value={String(stage.cutFreqDays || '30')}
            onChange={(v) => patchStage((st) => { st.cutFreqDays = v.trim() })}
            min={1} step={1}
            className="w-20"
          />
          <span>days</span>
        </div>
      )}

      {/* Splits — inline rows, directly after the issuance fields. */}
      <div className="mt-4">
        {(stage.reservedRecipients || []).map((rec, i) => (
          <ReservedSplitRow
            key={i}
            rec={rec}
            index={i}
            durationSeconds={0}
            onChange={(patch: Partial<RecipientRow>) => patchStage((st) => { Object.assign(st.reservedRecipients[i], patch) })}
            onRemove={() => patchStage((st) => { st.reservedRecipients.splice(i, 1) })}
            state={state}
            update={update}
            perChainKey={`r:${idx}:${i}`}
          />
        ))}
        <AddLink
          label="+ Add split"
          onClick={() => patchStage((st) => { st.reservedRecipients.push({ type: 'wallet', address: '', projectId: 0, percent: 0 }) })}
        />
        {splitTotal > 100 ? (
          <Hint warn>Splits total {round2(splitTotal)}% — over 100%. Reduce a share so they sum to 100% or less.</Hint>
        ) : splitTotal > 0 ? (
          <Hint>Total split limit of {round2(splitTotal)}%, payer always receives {round2(100 - splitTotal)}% of issuance.</Hint>
        ) : (
          <Hint>Without splits, the payer always receives 100% of issuance.</Hint>
        )}
      </div>

      {/* Auto-issuance — inline rows. */}
      <div className="mt-[22px]">
        <Hint>Optionally, auto-issue ${tk} when the stage starts.</Hint>
      </div>
      <div className="mt-2">
        {(stage.autoIssuances || []).map((ai, i) => (
          <AutoIssuanceRow
            key={i}
            ai={ai}
            index={i}
            tk={tk}
            onChange={(patch: Partial<AutoIssuance>) => patchStage((st) => { Object.assign(st.autoIssuances[i], patch) })}
            onRemove={() => patchStage((st) => { st.autoIssuances.splice(i, 1) })}
            state={state}
            update={update}
            perChainKey={`ai:${idx}:${i}`}
          />
        ))}
        <AddLink
          label="+ Add auto issuance"
          onClick={() => patchStage((st) => { st.autoIssuances.push({ count: '', address: '' }) })}
        />
        {aiTotal > 0 && <Hint>Total auto issuance of {round2(aiTotal)} ${tk}.</Hint>}
      </div>

      {/* 2. Cash outs (always on for a revnet — the only exit besides loans) */}
      <SectionHead>${tk} cash outs</SectionHead>
      <Hint>
        The only way to access the {acctSym} used to issue ${tk} is by cashing out or taking a loan.
        A tax makes cashing out and loans more expensive, rewarding ${tk} holders who stick around.
      </Hint>
      <CashOutTaxCard
        taxRate={stage.cashOutTaxRate}
        onChange={(pct) => patchStage((st) => { st.cashOutTaxRate = pct })}
        acctSym={acctSym}
        reclaimVerb={tk}
        bare
      />

      {/* 3. Start time */}
      <SectionHead>Start time</SectionHead>
      <StageTiming state={state} update={update} stage={stage} idx={idx} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Auto-issuance row — "Issue [count $TK] to [0x… or name.eth] ✕"
// ---------------------------------------------------------------------------

function AutoIssuanceRow(props: {
  ai: AutoIssuance
  index: number
  tk: string
  onChange: (patch: Partial<AutoIssuance>) => void
  onRemove: () => void
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
  perChainKey: string
}) {
  const { ai, onChange } = props
  return (
    <div>
      <SplitRowShell lead={props.index === 0 ? 'Issue' : '… and'} onRemove={props.onRemove}>
        <NumberInput
          value={ai.count || ''}
          onChange={(v) => onChange({ count: v.trim() })}
          min={0} step="any"
          className="w-24"
        />
        <span className="text-sm pt-2 shrink-0">${props.tk}</span>
        <span className="text-sm pt-2 shrink-0">to</span>
        <EnsAddressInput
          className="flex-1 min-w-[200px]"
          value={ai.address || ''}
          onChange={(v) => onChange({ address: v.trim() })}
          onResolved={(addr) => onChange({ resolvedAddress: addr || undefined })}
        />
      </SplitRowShell>
      <PerChainAddrControl state={props.state} update={props.update} fieldKey={props.perChainKey} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stage timing — stage 0 starts ~10 min after deploy (or a scheduled future
// time); later stages start a number of days after the previous stage's start.
// (No "duration" — revnets run forever.)
// ---------------------------------------------------------------------------

function StageTiming({ state, update, stage, idx }: StepProps & { stage: StageState; idx: number }) {
  const patchStage = (fn: (st: StageState) => void) => update((s) => { if (s.stages[idx]) fn(s.stages[idx]) })

  if (idx === 0) {
    return (
      <div>
        <Hint>By default, the revnet starts ~10 minutes after deployment.</Hint>
        <ToggleRow
          label="Start the revnet in the future"
          checked={!!stage.scheduleOn}
          onChange={(v) => patchStage((st) => { st.scheduleOn = v; if (!v) st.schedule = '' })}
        />
        {stage.scheduleOn && (
          <>
            <TextInput
              type="datetime-local"
              value={stage.schedule ? tsToLocal(stage.schedule) : ''}
              onChange={(v) => patchStage((st) => {
                if (!v) { st.schedule = ''; return }
                const dt = new Date(v)
                st.schedule = isNaN(dt.getTime()) ? '' : String(Math.floor(dt.getTime() / 1000))
              })}
              className="mt-1.5"
            />
            <Hint>{localTimezoneLabel()}</Hint>
          </>
        )}
      </div>
    )
  }

  // If the previous stage has autocuts, its ruleset cycles every `freq` days, so this stage can only begin
  // on a cycle boundary — constrain the input to a positive multiple of that interval.
  const freq = revPrevCutFreqDays(state, idx)
  return (
    <div>
      <Hint>
        {freq > 0
          ? `How many days after the last stage’s start time should this stage start? Must be a multiple of the previous stage’s ${freq}-day cut interval.`
          : 'How many days after the last stage’s start time should this stage start?'}
      </Hint>
      <div className="flex items-center gap-2 mt-2 text-sm">
        <DaysAfterInput
          freq={freq}
          snapped={snapDaysAfter(stage.startDaysAfter, freq)}
          onRaw={(v) => patchStage((st) => { st.startDaysAfter = v })}
          onSnap={(v) => patchStage((st) => { st.startDaysAfter = v })}
        />
        <span>days</span>
      </div>
    </div>
  )
}

/** Shows the raw value while typing; snaps to a multiple of the cut interval on blur (like the website's change event). */
function DaysAfterInput(props: {
  freq: number
  snapped: number
  onRaw: (v: string) => void
  onSnap: (v: string) => void
}) {
  const isDark = useIsDark()
  const [val, setVal] = useState(String(props.snapped))
  return (
    <input
      type="number"
      min={props.freq > 0 ? props.freq : 1}
      step={props.freq > 0 ? props.freq : 1}
      value={val}
      onChange={(e) => { setVal(e.target.value); props.onRaw(e.target.value.trim()) }}
      onBlur={() => { const d = snapDaysAfter(val, props.freq); setVal(String(d)); props.onSnap(String(d)) }}
      className={`${inputClass(isDark)} w-24`}
    />
  )
}
