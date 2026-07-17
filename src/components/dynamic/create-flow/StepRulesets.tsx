/**
 * Create-flow Step 2 (custom flavor): Rulesets — a 1:1 port of the website's
 * renderStages / renderStageCard / renderStageEditor and their sections
 * (website/src/create-flow.js). Copy comes verbatim from the source flow.
 */

import type { ReactNode } from 'react'
import { isAddress } from 'viem'
import { truncateAddress } from '../../../utils/ens'
import type { AfterMode, CreateFlowState, DeadlineKey, PayoutMode, RecipientRow, StageState } from './state'
import { createStage, surplusTokenLabel } from './state'
import {
  AddLink, Collapse, CurrencySelect, EnsAddressInput, FieldBlock, Hint, IdleToggle, InfoNote,
  NumberInput, Select, StepHead, TextInput, ToggleRow, WarnNote, useIsDark,
} from './controls'
import { CashOutTaxCard, PayoutRow, PerChainAddrControl, ReservedSplitRow } from './pickers'

// ---------------------------------------------------------------------------
// Data — mirrors of the website's DURATION_PRESETS / FOREVER_SECONDS /
// deadline-options.js (data-only leaf module there).
// ---------------------------------------------------------------------------

export const DURATION_PRESETS: { label: string; seconds: number }[] = [
  { label: '1 day', seconds: 86400 }, { label: '3 days', seconds: 259200 },
  { label: '7 days', seconds: 604800 }, { label: '14 days', seconds: 1209600 },
  { label: '28 days', seconds: 2419200 }, { label: '30 days', seconds: 2592000 },
  { label: '90 days', seconds: 7776000 }, { label: '365 days', seconds: 31536000 },
]

/** uint32 max (~136 years) — the "Forever" option's max duration. */
export const FOREVER_SECONDS = 4294967295

const DURATION_UNIT_SECONDS: Record<StageState['customDurUnit'], number> = {
  hours: 3600, days: 86400, weeks: 604800, years: 31536000,
}

export const DEADLINE_OPTIONS: { key: DeadlineKey; label: string }[] = [
  { key: '3hours', label: '3-hour deadline' },
  { key: '1day', label: '1-day deadline' },
  { key: '3days', label: '3-day deadline' },
  { key: '7days', label: '7-day deadline' },
  { key: 'none', label: 'No deadline' },
]

// ---------------------------------------------------------------------------
// Small helpers — 1:1 ports of the website's utility functions
// ---------------------------------------------------------------------------

/** The website's dz(on, off) toggle-subtext pair. */
function dz(on: string, off: string): { on: string; off: string } {
  return { on: 'On: ' + on, off: 'Off: ' + off }
}

function secondsLabel(s: number): string {
  const p = DURATION_PRESETS.find((x) => x.seconds === s)
  if (p) return p.label
  const U: [string, number][] = [['year', 31536000], ['week', 604800], ['day', 86400], ['hour', 3600]]
  for (const [name, span] of U) {
    if (s % span === 0) { const n = s / span; return `${n} ${name}${n === 1 ? '' : 's'}` }
  }
  return s + 's'
}

function recomputeCustomDuration(stage: StageState): void {
  const v = parseFloat(stage.customDurVal)
  stage.durationSeconds = v > 0 ? Math.round(v * (DURATION_UNIT_SECONDS[stage.customDurUnit] || 86400)) : 0
}

function tsToLocal(ts: string | number): string {
  const d = new Date(Number(ts) * 1000)
  if (isNaN(d.getTime())) return ''
  const p = (x: number) => (x < 10 ? '0' + x : '' + x)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** e.g. "America/New_York" — the browser's local zone, for the scheduled-launch helper text. */
function localTimezoneLabel(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time' } catch { return 'local time' }
}

function round2(n: number): number { return Math.round((Number(n) || 0) * 100) / 100 }

// --- Accounting-token derivations (customAccounting / lockedCurrencySym etc.) ---

function customAccounting(state: CreateFlowState): boolean { return state.accepts[0] === 'custom' }

function customAcctSym(state: CreateFlowState): string | null {
  return customAccounting(state) ? (state.customToken.symbol || 'TOKEN') : null
}

function customCurrencyId(state: CreateFlowState): number {
  const a = state.customToken.address
  return isAddress(a, { strict: false }) ? Number(BigInt(a) % (1n << 32n)) : 0
}

/** True when the base currency is forced to USD (USDC accepted, no custom token). */
function usdcAccounting(state: CreateFlowState): boolean {
  return !customAccounting(state) && state.accepts.includes('usdc')
}

function lockedCurrencySym(state: CreateFlowState): string | null {
  return customAcctSym(state) || (usdcAccounting(state) ? 'USD' : null)
}

function fundAccessCurrencyLabel(currency: number, state: CreateFlowState): string {
  const cur = Number(currency || 1)
  if (cur === 1) return 'ETH'
  if (cur === 2) return 'USD'
  if (customAccounting(state) && cur === customCurrencyId(state)) return customAcctSym(state) || 'TOKEN'
  return 'currency ' + cur
}

// --- Multi-token payout kinds (custom-both / custom ERC-20) ---

interface PayoutKind { key: string; symbol: string }

function createPayoutKinds(state: CreateFlowState): PayoutKind[] {
  return state.accepts.map((k) => {
    if (k === 'custom') return { key: 'custom', symbol: state.customToken.symbol || 'TOKEN' }
    return k === 'usdc' ? { key: 'usdc', symbol: 'USDC' } : { key: 'eth', symbol: 'ETH' }
  })
}

/**
 * Single source of truth for whether payouts/surplus are configured per-token — multi-token
 * only when a CUSTOM project holds more than one accounting token, or a custom ERC-20
 * (token-keyed currency + token decimals, no feed).
 */
function currentPayoutKinds(state: CreateFlowState): PayoutKind[] | null {
  if (state.projectType !== 'revnet' && state.accepts.length > 1) return createPayoutKinds(state)
  if (state.projectType !== 'revnet' && customAccounting(state) && isAddress(state.customToken.address, { strict: false })) {
    return createPayoutKinds(state)
  }
  return null
}

/** Read a per-kind payout bucket without mutating state (render-safe). */
function pkOf(stage: StageState, key: string): { mode: PayoutMode; recipients: RecipientRow[] } {
  return stage.payoutByKind?.[key] || { mode: 'none', recipients: [] }
}

/** Ensure the per-kind bucket exists (mutation-safe: only inside update callbacks). */
function pkEnsure(stage: StageState, key: string): { mode: PayoutMode; recipients: RecipientRow[] } {
  if (!stage.payoutByKind) stage.payoutByKind = {}
  if (!stage.payoutByKind[key]) stage.payoutByKind[key] = { mode: 'none', recipients: [] }
  return stage.payoutByKind[key]
}

function freshPayoutRecipient(): RecipientRow {
  return { type: 'wallet', address: '', projectId: 0, percent: 0, amountEth: '' }
}

// Token cash out (rulesets) and item cash out (the 721 store) are MUTUALLY EXCLUSIVE onchain:
// with the 721 hook as the cash out data hook, any project-token cash out reverts. So enabling
// one idles the other in the UI.
function itemCashOutOn(state: CreateFlowState): boolean {
  return !!(state.shopEnabled && state.collection && state.collection.useForRedemptions)
}

// The "Afterwards" choice only applies when the last ruleset has a duration — otherwise there's
// nothing "after" (a forever/flexible last ruleset never hands off on a schedule).
function afterApplies(state: CreateFlowState): boolean {
  const last = state.stages[state.stages.length - 1]
  return !!last && last.durationSeconds > 0
}

// The edit deadline governs how far ahead owner edits to a FUTURE ruleset must be queued. It's only
// meaningful when such a boundary exists: not for a forever-duration last ruleset, and not for a single
// timed ruleset set to Terminate (which just continues on the same terms).
function deadlineApplies(state: CreateFlowState): boolean {
  const last = state.stages[state.stages.length - 1]
  if (!last) return false
  if (last.durationSeconds === FOREVER_SECONDS) return false
  if (state.stages.length === 1 && afterApplies(state) && state.afterMode === 'terminal') return false
  return true
}

// ---------------------------------------------------------------------------
// Stage summary bullets — ports of recipLabel / stageSummaryRaw / stageSummaryParts
// ---------------------------------------------------------------------------

function recipLabel(rec: RecipientRow): string {
  if (rec.type === 'project' && rec.projectId) return 'project #' + rec.projectId
  if (rec.address) return rec.address.length > 10 ? truncateAddress(rec.address) : rec.address
  return 'owner'
}

function stageSummaryRaw(stage: StageState, idx: number, state: CreateFlowState): string[] {
  const parts: string[] = []
  parts.push(idx === 0 ? ((stage.scheduleOn && stage.schedule) ? 'Starts at a set time' : 'Starts at launch') : 'Starts after Ruleset #' + idx)
  parts.push(!stage.durationSeconds ? 'lasts until changed by owner'
    : (stage.durationSeconds === FOREVER_SECONDS ? 'lasts forever' : 'lasts ' + secondsLabel(stage.durationSeconds)))

  // Issuance — weight, reserved split, issuance cut.
  if (stage.tokenMode === 'custom') {
    parts.push('issues ' + (stage.weight || '0') + ' tokens / ' + fundAccessCurrencyLabel(stage.baseCurrency, state))
    const reservedPct = (stage.reservedRecipients || []).reduce((s, x) => s + (Number(x.percent) || 0), 0)
    if (reservedPct > 0) {
      let rLine = round2(reservedPct) + '% reserved'
      const rNamed = (stage.reservedRecipients || []).filter((x) => Number(x.percent) > 0)
      if (rNamed.length) rLine += ' (' + rNamed.map((x) => round2(Number(x.percent)) + '% → ' + recipLabel(x)).join(', ') + ')'
      parts.push(rLine)
    }
    if (stage.issuanceCutOn && Number(stage.weightCutPercent) > 0) parts.push('issuance cuts ' + round2(Number(stage.weightCutPercent)) + '% each cycle')
  } else parts.push('no issuance')

  // Cash outs.
  if (stage.cashOutEnabled && stage.payoutMode !== 'unlimited') parts.push('cash outs on, ' + round2(Number(stage.cashOutTaxRate)) + '% tax')

  // Payouts — list each recipient's share.
  if (stage.payoutMode === 'unlimited') {
    const uRecips = (stage.payoutRecipients || []).filter((r) => Number(r.percent) > 0)
    if (!uRecips.length) {
      // No splits → everything goes to the owner; say so directly instead of "all funds" + "remainder → owner".
      parts.push('pays out all funds to owner')
    } else {
      parts.push('pays out all funds')
      uRecips.forEach((r) => { parts.push(round2(Number(r.percent)) + '% → ' + recipLabel(r)) })
      parts.push('remainder → owner')
    }
  } else if (stage.payoutMode === 'limited') {
    const pc = fundAccessCurrencyLabel(stage.payoutCurrency, state)
    const named = (stage.payoutRecipients || []).filter((r) => Number(r.amountEth) > 0)
    if (named.length) named.forEach((r) => { parts.push('pays ' + r.amountEth + ' ' + pc + ' → ' + recipLabel(r)) })
    else parts.push('payouts set, no recipients yet')
  }

  // Surplus allowance.
  if (stage.surplusAllowanceOn && stage.payoutMode !== 'unlimited') {
    if (stage.surplusAllowanceUnlimited) parts.push('owner can withdraw all surplus')
    else if (Number(stage.surplusAllowanceAmount) > 0) parts.push('owner can withdraw ' + stage.surplusAllowanceAmount + ' ' + fundAccessCurrencyLabel(stage.surplusAllowanceCurrency, state) + ' of surplus')
    else parts.push('surplus allowance on')
  }

  // Noteworthy flags.
  if (stage.allowOwnerMinting) parts.push('owner can mint tokens')
  if (stage.pauseTransfers) parts.push('token credit transfers paused')
  if (stage.pausePay) parts.push('payments paused')
  if (stage.holdFees) parts.push('fees held')
  if (stage.allowTerminalMigration) parts.push('terminal migration allowed')
  // Edit deadline is shown in its own section below the cards — not a ruleset bullet.

  return parts
}

/** Capitalized bullet strings for a stage (no leading "• "). */
export function stageSummaryParts(stage: StageState, idx: number, state: CreateFlowState): string[] {
  return stageSummaryRaw(stage, idx, state).map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

interface StepProps { state: CreateFlowState; update: (fn: (s: CreateFlowState) => void) => void }
interface StageSectionProps extends StepProps { stage: StageState; idx: number }

/** The website's .create-subcard — a full-width bordered container under a toggle. */
function SubCard({ children }: { children: ReactNode }) {
  const isDark = useIsDark()
  return (
    <div className={`border-l-2 border-r-2 my-3.5 px-5 py-3.5 ${
      isDark ? 'border-orange-400/40 bg-juice-dark-lighter' : 'border-orange-300 bg-orange-50'
    }`}>
      {children}
    </div>
  )
}

/** Mutate one stage inside an update() callback, guarding index drift. */
function stageUpdater(update: StepProps['update'], idx: number) {
  return (fn: (st: StageState, s: CreateFlowState) => void) =>
    update((s) => { const st = s.stages[idx]; if (st) fn(st, s) })
}

// ---------------------------------------------------------------------------
// stageTiming — Duration, launch scheduling, Accept payments, zero-duration warning
// ---------------------------------------------------------------------------

function StageTiming({ stage, idx, state, update }: StageSectionProps) {
  const up = stageUpdater(update, idx)
  const isLast = idx === state.stages.length - 1

  const durationOptions: [string, string][] = [
    ['0', 'Flexible'],
    ...DURATION_PRESETS.map((p): [string, string] => [String(p.seconds), p.label]),
    [String(FOREVER_SECONDS), 'Forever'],
    ['custom', 'Custom…'],
  ]

  return (
    <div>
      <FieldBlock label="Duration">
        <Select
          value={stage.durationCustom ? 'custom' : String(stage.durationSeconds)}
          onChange={(v) => up((st) => {
            if (v === 'custom') { st.durationCustom = true; recomputeCustomDuration(st) }
            else { st.durationCustom = false; st.durationSeconds = Number(v) }
          })}
          options={durationOptions}
        />
        {stage.durationCustom && (
          <div className="flex items-center gap-2 mt-2">
            <NumberInput
              value={stage.customDurVal}
              onChange={(v) => up((st) => { st.customDurVal = v.trim(); recomputeCustomDuration(st) })}
              min={1} step={1} placeholder="1"
              className="w-24"
            />
            <Select
              value={stage.customDurUnit}
              onChange={(v) => up((st) => { st.customDurUnit = v as StageState['customDurUnit']; recomputeCustomDuration(st) })}
              options={[['hours', 'hours'], ['days', 'days'], ['weeks', 'weeks'], ['years', 'years']]}
            />
          </div>
        )}
      </FieldBlock>

      {idx === 0 ? (
        <>
          <ToggleRow
            label="Launch right away"
            checked={!stage.scheduleOn}
            onChange={(v) => up((st) => {
              st.scheduleOn = !v
              if (v) st.schedule = '' // launching now clears any scheduled time
            })}
          />
          {stage.scheduleOn && (
            <FieldBlock>
              <Hint>Your project will start at this date.</Hint>
              <TextInput
                type="datetime-local"
                value={stage.schedule ? tsToLocal(stage.schedule) : ''}
                onChange={(v) => up((st) => {
                  if (!v) { st.schedule = ''; return }
                  const dt = new Date(v)
                  st.schedule = isNaN(dt.getTime()) ? '' : String(Math.floor(dt.getTime() / 1000))
                })}
                className="mt-1"
              />
              <Hint>{localTimezoneLabel()}</Hint>
            </FieldBlock>
          )}
        </>
      ) : (
        <InfoNote>Stage {idx + 1} begins automatically when Stage {idx} ends.</InfoNote>
      )}

      {/* Accept payments — first thing after timing. Pausing payments idles token issuance (see tokenSection). */}
      <ToggleRow
        label="Accept payments"
        {...dz('The project can receive payments.', 'The project can’t receive payments.')}
        checked={!stage.pausePay}
        onChange={(v) => up((st) => { st.pausePay = !v })}
      />

      {/* A non-final stage with no duration would never advance — the next stage would start at the same
          instant and immediately clobber it. Require a duration on every non-final stage. */}
      {!isLast && !stage.durationSeconds && (
        <WarnNote>
          This stage isn’t the last, so it needs a duration. With “no expiry”, the next stage would start at
          the same moment and override this one. Set a duration so Stage {idx + 2} begins when this stage’s
          cycle ends.
        </WarnNote>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// tokenSection — issuance, reserved splits, owner minting, credit transfers
// ---------------------------------------------------------------------------

function TokenSection({ stage, idx, state, update }: StageSectionProps) {
  const up = stageUpdater(update, idx)

  const tot = Math.round(stage.reservedRecipients.reduce((s, x) => s + (Number(x.percent) || 0), 0) * 100) / 100
  const payer = Math.round((100 - tot) * 100) / 100

  const transferCopy = stage.tokenMode === 'custom'
    ? 'Internal project credits can be transferred until they are claimed as ERC-20 tokens.'
    : 'This stage issues no credits. Existing credits from earlier stages can still be transferred.'

  return (
    <div>
      {/* Paused payments → no one can pay → no issuance possible; show the issuance toggle idle. */}
      {stage.pausePay ? (
        <IdleToggle label="Issue tokens when paid" sub="No tokens are issued while payments are paused." />
      ) : (
        <ToggleRow
          label="Issue tokens when paid"
          {...dz('Payers receive newly minted project tokens.', 'No tokens are issued when the project is paid.')}
          checked={stage.tokenMode === 'custom'}
          onChange={(v) => up((st) => { st.tokenMode = v ? 'custom' : 'none' })}
        />
      )}

      {stage.tokenMode === 'custom' && !stage.pausePay && (
        <SubCard>
          {/* Issues [x] tokens per [ETH/USD] */}
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <span>Issues</span>
            <TextInput
              value={stage.weight}
              onChange={(v) => up((st) => { st.weight = v.trim() })}
              placeholder="0"
              className="w-24"
            />
            <span>tokens</span>
            {/* Keep "per" attached to the currency selector so they wrap together as "per [ETH]". */}
            <span className="flex items-center gap-1.5">
              per
              <CurrencySelect
                value={stage.baseCurrency}
                onChange={(v) => up((st) => { st.baseCurrency = v })}
                lockedSymbol={lockedCurrencySym(state)}
              />
            </span>
          </div>

          {/* Reserved splits — each "Split [%] to [recipient]" reserves that share of issuance; the payer
              gets the rest. The percentages sum to the project's reserved rate (shown in the summary below). */}
          <div className="mt-3">
            {stage.reservedRecipients.map((rec, i) => (
              <ReservedSplitRow
                key={i}
                rec={rec}
                index={i}
                durationSeconds={stage.durationSeconds}
                onChange={(patch) => up((st) => { const r = st.reservedRecipients[i]; if (r) Object.assign(r, patch) })}
                onRemove={() => up((st) => { st.reservedRecipients.splice(i, 1) })}
                state={state}
                update={update}
                perChainKey={`r:${idx}:${i}`}
              />
            ))}
            <AddLink
              label="+ Add split"
              onClick={() => up((st) => { st.reservedRecipients.push({ type: 'wallet', address: '', projectId: 0, percent: 0 }) })}
            />
            <Hint warn={tot > 100}>
              {tot > 0
                ? `Total splits of ${tot}%, payer receives ${payer}% of issuance.`
                : 'Payer receives 100% of issuance.'}
            </Hint>
          </div>
        </SubCard>
      )}

      {/* Token options apply whether or not THIS stage issues tokens (tokens can exist from prior stages
          or owner mints) — always shown. */}
      <ToggleRow
        label="Give owner privileged access to tokens"
        {...dz('The project owner can mint any amount of project tokens without paying.', 'The project owner can’t mint tokens without paying.')}
        checked={stage.allowOwnerMinting}
        onChange={(v) => up((st) => { st.allowOwnerMinting = v })}
      />
      <ToggleRow
        label="Pause internal credit transfers"
        {...dz('Existing internal credits can’t be transferred. Claimed ERC-20 tokens remain transferable.', transferCopy)}
        checked={stage.pauseTransfers}
        onChange={(v) => up((st) => { st.pauseTransfers = v })}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// cashOutSection — token-holder cash out access + tax card
// ---------------------------------------------------------------------------

function CashOutBlock({ stage, idx, state, update }: StageSectionProps) {
  const up = stageUpdater(update, idx)
  const label = surplusTokenLabel(state)

  // Item cash out (Shop) overrides token cash out — they can't both be on. Idle the token toggle, but keep
  // the tax card: the same ruleset cashOutTaxRate governs item redemption (JB721Hook forwards it).
  if (itemCashOutOn(state) && !stage.cashOutEnabled) {
    return (
      <div>
        <IdleToggle
          label="Give tokens cash out access to surplus funds"
          sub="Items cash out for surplus instead (enabled in the Shop) — tokens and items can’t both be cashed out."
        />
        <CashOutTaxCard
          taxRate={stage.cashOutTaxRate}
          onChange={(pct) => up((st) => { st.cashOutTaxRate = pct })}
          acctSym={label}
        />
        <InfoNote>This cash out tax applies to item redemptions.</InfoNote>
      </div>
    )
  }

  return (
    <div>
      <ToggleRow
        label="Give tokens cash out access to surplus funds"
        {...dz(`Token holders can cash out their tokens for a share of the project’s surplus ${label}.`, 'Token holders can’t cash out their tokens.')}
        checked={stage.cashOutEnabled}
        onChange={(v) => up((st) => { st.cashOutEnabled = v })}
      />
      {stage.cashOutEnabled && (
        <CashOutTaxCard
          taxRate={stage.cashOutTaxRate}
          onChange={(pct) => up((st) => { st.cashOutTaxRate = pct })}
          acctSym={label}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// payoutsSection — single-token path, multi-token per-kind path, surplus access
// ---------------------------------------------------------------------------

/** A "Payout <SYM> funds" block for one accounting context (multi-token path). */
function PayoutKindBlock({ stage, idx, kind, state, update }: StageSectionProps & { kind: PayoutKind }) {
  const pk = pkOf(stage, kind.key)
  const upPk = (fn: (pk: { mode: PayoutMode; recipients: RecipientRow[] }) => void) =>
    update((s) => { const st = s.stages[idx]; if (st) fn(pkEnsure(st, kind.key)) })

  const mode: 'percent' | 'amount' = pk.mode === 'unlimited' ? 'percent' : 'amount'

  return (
    <div>
      <ToggleRow
        label={`Payout ${kind.symbol} funds`}
        {...dz(`Routing some of the project’s ${kind.symbol} to other accounts or projects.`, `All ${kind.symbol} stays in the project for cash outs / later cycles.`)}
        checked={pk.mode !== 'none'}
        onChange={(v) => upPk((p) => { p.mode = v ? 'unlimited' : 'none' })}
      />
      {pk.mode !== 'none' && (
        <SubCard>
          <ToggleRow
            label={`Payout all received ${kind.symbol}`}
            {...dz('Paying out everything received; recipients get a percentage and the rest goes to the owner.', 'Paying out fixed amounts; anything else stays in the project.')}
            checked={pk.mode === 'unlimited'}
            onChange={(v) => upPk((p) => {
              p.mode = v ? 'unlimited' : 'limited'
              if (!v && !p.recipients.length) p.recipients.push(freshPayoutRecipient())
            })}
          />
          {pk.recipients.map((rec, i) => (
            <PayoutRow
              key={i}
              rec={rec}
              index={i}
              mode={mode}
              durationSeconds={stage.durationSeconds}
              payoutCurrency={stage.payoutCurrency}
              staticSuffix={kind.symbol}
              onChange={(patch) => upPk((p) => { const r = p.recipients[i]; if (r) Object.assign(r, patch) })}
              onRemove={mode === 'amount' && pk.recipients.length <= 1
                ? null
                : () => upPk((p) => { p.recipients.splice(i, 1) })}
              state={state}
              update={update}
              perChainKey={`pk:${kind.key}:${i}`}
            />
          ))}
          <AddLink label="+ Add payout" onClick={() => upPk((p) => { p.recipients.push(freshPayoutRecipient()) })} />
          {pk.mode === 'unlimited' && (
            <Hint>Any {kind.symbol} not allocated above goes to the project owner.</Hint>
          )}
        </SubCard>
      )}
    </div>
  )
}

function PayoutsSection({ stage, idx, state, update }: StageSectionProps) {
  const up = stageUpdater(update, idx)

  // Multi-accounting-context (custom-both / custom ERC-20): one "Payout <SYM> funds" block per token;
  // surplus is cumulative.
  const kinds = currentPayoutKinds(state)
  if (kinds) {
    const allUnlimited = kinds.every((k) => pkOf(stage, k.key).mode === 'unlimited')
    return (
      <div>
        {kinds.map((kind) => (
          <PayoutKindBlock key={kind.key} stage={stage} idx={idx} kind={kind} state={state} update={update} />
        ))}
        {allUnlimited ? (
          <>
            <IdleToggle label="Give owner access to surplus funds" sub="All funds are allocated to unlimited payouts, no surplus available." />
            <IdleToggle label="Give tokens cash out access to surplus funds" sub="All funds are allocated to unlimited payouts, no surplus to cash out." />
          </>
        ) : (
          <>
            {/* Surplus is the project's TOTAL across all accepted tokens (cash out reclaim prices against the
                cumulative surplus). Owner access is unlimited-across-tokens here to avoid per-token cap ambiguity. */}
            <ToggleRow
              label="Give owner access to surplus funds"
              {...dz('The owner can withdraw the project’s surplus (funds beyond payouts) — an unlimited allowance per accepted token (ETH, USDC, …), each in its own currency.', 'The owner can’t withdraw from the project’s surplus.')}
              checked={stage.surplusAllowanceOn}
              onChange={(v) => up((st) => { st.surplusAllowanceOn = v; st.surplusAllowanceUnlimited = true })}
            />
            <CashOutBlock stage={stage} idx={idx} state={state} update={update} />
          </>
        )}
      </div>
    )
  }

  // Single-token path.
  const mode: 'percent' | 'amount' = stage.payoutMode === 'unlimited' ? 'percent' : 'amount'
  return (
    <div>
      <ToggleRow
        label="Payout funds"
        {...dz('Routing some of the project’s funds to other accounts or projects.', 'All funds stay in the project for cash outs / later stages.')}
        checked={stage.payoutMode !== 'none'}
        onChange={(v) => up((st) => { st.payoutMode = v ? 'unlimited' : 'none' })}
      />

      {stage.payoutMode !== 'none' && (
        <SubCard>
          <ToggleRow
            label="Payout all received funds"
            {...dz('Paying out everything received; recipients get a percentage and the rest goes to the owner.', 'Paying out fixed amounts; anything else stays in the project.')}
            checked={stage.payoutMode === 'unlimited'}
            onChange={(v) => up((st) => {
              st.payoutMode = v ? 'unlimited' : 'limited'
              // A specific (limited) payout needs at least one entry to fill in.
              if (!v && !st.payoutRecipients.length) st.payoutRecipients.push(freshPayoutRecipient())
            })}
          />
          {stage.payoutRecipients.map((rec, i) => (
            <PayoutRow
              key={i}
              rec={rec}
              index={i}
              mode={mode}
              durationSeconds={stage.durationSeconds}
              payoutCurrency={stage.payoutCurrency}
              lockedSymbol={lockedCurrencySym(state)}
              onPayoutCurrencyChange={(v) => up((st) => { st.payoutCurrency = v })}
              onChange={(patch) => up((st) => { const r = st.payoutRecipients[i]; if (r) Object.assign(r, patch) })}
              onRemove={mode === 'amount' && stage.payoutRecipients.length <= 1
                ? null
                : () => up((st) => { st.payoutRecipients.splice(i, 1) })}
              state={state}
              update={update}
              perChainKey={`p:${idx}:${i}`}
            />
          ))}
          <AddLink label="+ Add payout" onClick={() => up((st) => { st.payoutRecipients.push(freshPayoutRecipient()) })} />
          {/* Make the default-to-owner behavior explicit (unlimited only). */}
          {stage.payoutMode === 'unlimited' && (
            <Hint>Any payouts not allocated above go to the project owner.</Hint>
          )}
        </SubCard>
      )}

      {/* Surplus access — owner (allowance) and token holders (cash outs) both draw from surplus (funds
          beyond payouts). When paying out everything there's no surplus, so both are shown idle/disabled. */}
      {stage.payoutMode === 'unlimited' ? (
        <>
          <IdleToggle label="Give owner access to surplus funds" sub="All funds are allocated to unlimited payouts, no surplus available." />
          <IdleToggle label="Give tokens cash out access to surplus funds" sub="All funds are allocated to unlimited payouts, no surplus to cash out." />
        </>
      ) : (
        <>
          <ToggleRow
            label="Give owner access to surplus funds"
            {...dz('The owner can withdraw from the project’s surplus (funds beyond payouts).', 'The owner can’t withdraw from the project’s surplus.')}
            checked={stage.surplusAllowanceOn}
            onChange={(v) => up((st) => { st.surplusAllowanceOn = v })}
          />
          {stage.surplusAllowanceOn && (
            <SubCard>
              <ToggleRow
                label="Unlimited"
                {...dz('No cap — the owner can withdraw the entire surplus.', 'Capped at the amount set below.')}
                checked={stage.surplusAllowanceUnlimited}
                onChange={(v) => up((st) => { st.surplusAllowanceUnlimited = v })}
              />
              {!stage.surplusAllowanceUnlimited && (
                <div className="flex items-center gap-2 text-sm">
                  <TextInput
                    value={stage.surplusAllowanceAmount}
                    onChange={(v) => up((st) => { st.surplusAllowanceAmount = v.trim() })}
                    placeholder="0.0"
                    className="w-24"
                  />
                  <CurrencySelect
                    value={stage.surplusAllowanceCurrency}
                    onChange={(v) => up((st) => { st.surplusAllowanceCurrency = v })}
                    lockedSymbol={lockedCurrencySym(state)}
                  />
                  <span>allowed.</span>
                </div>
              )}
            </SubCard>
          )}
          {/* Token-holder cash outs live right after the owner's surplus allowance (both draw from surplus). */}
          <CashOutBlock stage={stage} idx={idx} state={state} update={update} />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// otherRulesSection — Hold fees + the Superpowers warning zone
// ---------------------------------------------------------------------------

function OtherRulesSection({ stage, idx, update }: Omit<StageSectionProps, 'state'>) {
  const up = stageUpdater(update, idx)
  return (
    <div>
      <ToggleRow
        label="Hold fees"
        {...dz('Fees are held in the project instead of processed automatically, and refunded to the project’s balance if the funds are returned. Useful for managing whole token holder refunds. After 28 days without seeing the withdrawn funds, held fees are automatically processed.', 'Fees are processed automatically.')}
        checked={stage.holdFees}
        onChange={(v) => up((st) => { st.holdFees = v })}
      />

      {/* Owner-power toggles — each grants the owner mid-flight control that supporters must trust. Grouped
          in a warning zone so the abuse-vector risk is unmistakable. */}
      <div className="border border-pink-400/50 bg-pink-500/10 px-4 pt-3 pb-3.5 my-3.5">
        <div className="text-xs font-bold uppercase tracking-wide text-pink-400 mb-1">Superpowers</div>
        <ToggleRow
          label="Allow setting payment terminals"
          {...dz('The owner can add/remove payment terminals at any time. This lets the project upgrade, but also lets the owner reroute where funds flow at will.', 'Payment terminals are fixed for this ruleset.')}
          checked={stage.allowSetTerminals}
          onChange={(v) => up((st) => { st.allowSetTerminals = v })}
        />
        <ToggleRow
          label="Allow setting controller"
          {...dz('The owner can change the project’s controller at any time. This lets the project upgrade, but can also be used by the owner to change all the rules at will.', 'The controller is fixed for this ruleset.')}
          checked={stage.allowSetController}
          onChange={(v) => up((st) => { st.allowSetController = v })}
        />
        <ToggleRow
          label="Allow terminal migration"
          {...dz('The owner can migrate the project’s terminals to a new version. This lets the project upgrade, but can also be used by the owner to move all funds to a terminal of their choosing.', 'Terminal migration is disabled.')}
          checked={stage.allowTerminalMigration}
          onChange={(v) => up((st) => { st.allowTerminalMigration = v })}
        />
        <ToggleRow
          label="Allow setting a custom token"
          {...dz('The owner can replace the project’s token with a custom ERC-20 of their choosing.', 'The project token can’t be swapped for a custom one.')}
          checked={stage.allowSetCustomToken}
          onChange={(v) => up((st) => { st.allowSetCustomToken = v })}
        />
        <ToggleRow
          label="Allow adding accounting tokens"
          {...dz('The owner can add new accounting tokens the project holds at any time.', 'The set of accounting tokens is fixed for this ruleset.')}
          checked={stage.allowAddAccountingContext}
          onChange={(v) => up((st) => { st.allowAddAccountingContext = v })}
        />
        <ToggleRow
          label="Allow adding price feeds"
          {...dz('The owner can add price feeds the project uses to convert currencies.', 'Price feeds can’t be added during this ruleset.')}
          checked={stage.allowAddPriceFeed}
          onChange={(v) => up((st) => { st.allowAddPriceFeed = v })}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stage card — collapsible header (title + bullet summary + remove + caret) → editor
// ---------------------------------------------------------------------------

function StageCard({ stage, idx, state, update }: StageSectionProps) {
  const isDark = useIsDark()
  const up = stageUpdater(update, idx)

  return (
    <div className={`border-2 mb-3 ${isDark ? 'border-orange-400/40 bg-white/[0.02]' : 'border-orange-300 bg-white'}`}>
      <div
        className="flex items-center gap-2.5 px-3.5 py-3 cursor-pointer"
        onClick={() => up((st) => { st.expanded = !st.expanded })}
      >
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Ruleset #{idx + 1}
          </div>
          <div className={`text-xs leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {stageSummaryParts(stage, idx, state).map((p, i) => (
              // Hanging indent so a wrapped line aligns under the text (after the "• "), not under the bullet.
              <div key={i} className="pl-3 -indent-3">• {p}</div>
            ))}
          </div>
        </div>
        {idx > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); update((s) => { s.stages.splice(idx, 1) }) }}
            className="text-gray-500 hover:text-red-400 shrink-0"
          >
            ✕
          </button>
        )}
        <span className={`text-xs shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {stage.expanded ? '▾' : '▸'}
        </span>
      </div>

      {stage.expanded && (
        <div className="px-3.5 pb-4">
          <StageTiming stage={stage} idx={idx} state={state} update={update} />
          <TokenSection stage={stage} idx={idx} state={state} update={update} />
          {/* Schedule payouts + Surplus allowance — top-level, no disclosure */}
          <PayoutsSection stage={stage} idx={idx} state={state} update={update} />
          <Collapse
            label="Other rules"
            optional
            open={stage.otherOpen}
            onToggle={() => up((st) => { st.otherOpen = !st.otherOpen })}
          >
            <OtherRulesSection stage={stage} idx={idx} update={update} />
          </Collapse>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step component — cards, Afterwards row, approval condition
// ---------------------------------------------------------------------------

const AFTER_NOTES: Record<AfterMode, string> = {
  wait: 'The project idles safely — no issuance, payments paused, cash outs preserved — until you change it.',
  terminal: 'Ruleset #1’s terms continue on forever, without cycling again.',
  cycle: 'Ruleset #1 repeats its cycle over and over until you change it. Changes will only be able to be made once a cycled ruleset ends.',
}

/** Append an editable ruleset carrying sensible fields over from the previous one. */
function addRuleset(s: CreateFlowState): void {
  const prev = s.stages[s.stages.length - 1]
  const st = createStage()
  if (prev) { st.tokenMode = prev.tokenMode; st.deadline = prev.deadline; st.baseCurrency = prev.baseCurrency; st.payoutCurrency = prev.payoutCurrency } // sensible carry-over
  s.stages.forEach((x) => { x.expanded = false })
  st.expanded = true
  s.stages.push(st)
}

function approvalPerChainHasAny(state: CreateFlowState): boolean {
  return Object.values(state.perChain || {}).some((c) => !!c.addr?.['approval'])
}

export default function StepRulesets({ state, update }: StepProps) {
  const cyStage = state.stages[0]
  const cur: DeadlineKey = (state.stages[0] && state.stages[0].deadline) || '3days'

  return (
    <div>
      <StepHead desc="Set the sequential rulesets your project follows over time." />

      {state.stages.map((stage, idx) => (
        <StageCard key={idx} stage={stage} idx={idx} state={state} update={update} />
      ))}

      {afterApplies(state) && cyStage && (
        <>
          {/* One timed ruleset → choose what happens after its cycle ends. */}
          <div className="flex items-center gap-2 text-sm mt-3">
            <span>Afterwards, </span>
            <Select
              value={state.afterMode}
              onChange={(v) => update((s) => {
                if (v === 'custom') { addRuleset(s); s.afterMode = 'wait' } // adds an editable Ruleset #2
                else s.afterMode = v as AfterMode
              })}
              options={[['wait', 'Wait'], ['terminal', 'Terminate'], ['cycle', 'Cycle'], ['custom', 'Custom']]}
            />
          </div>
          <InfoNote>{AFTER_NOTES[state.afterMode] || ''}</InfoNote>

          {/* Issuance cut only makes sense for a cycling ruleset — opt-in here, applied to the cycling stage. */}
          {state.afterMode === 'cycle' && (
            <>
              <ToggleRow
                label="Issuance cuts per cycle"
                {...dz('The issuance rate drops by a set amount at the end of each cycle.', 'The issuance rate stays the same each cycle.')}
                checked={!!cyStage.issuanceCutOn}
                onChange={(v) => update((s) => {
                  const st = s.stages[0]
                  if (!st) return
                  st.issuanceCutOn = v
                  if (!v) st.weightCutPercent = 0
                })}
              />
              {cyStage.issuanceCutOn && (
                <div className="flex items-center gap-2 text-sm">
                  <NumberInput
                    value={cyStage.weightCutPercent || 0}
                    onChange={(v) => update((s) => {
                      const st = s.stages[0]
                      if (st) st.weightCutPercent = Math.max(0, Math.min(100, Number(v) || 0))
                    })}
                    min={0} max={100} step={0.5}
                    className="w-20"
                  />
                  <span>% every {secondsLabel(cyStage.durationSeconds)}</span>
                </div>
              )}
            </>
          )}
        </>
      )}
      {/* A flexible (no-duration) last ruleset is terminal — owner-managed, nothing scheduled after it. */}

      {/* Ruleset approval condition — project-wide, at the bottom of the tab. The approval hook decides
          whether a queued edit can take effect; presets are time deadlines, "Custom address" points at any
          approval-hook contract (per-chain). Only shown when a future ruleset edit can actually happen. */}
      {deadlineApplies(state) && (
        <div className="mt-6">
          <FieldBlock label="Ruleset approval condition">
            <InfoNote>The condition a queued edit must satisfy before it takes effect, giving token holders time to review changes.</InfoNote>
            <div className="flex items-start gap-2 flex-wrap mt-2">
              <Select
                value={cur}
                onChange={(v) => update((s) => { s.stages.forEach((st) => { st.deadline = v as DeadlineKey }) })}
                options={[
                  ...DEADLINE_OPTIONS.map((o): [string, string] => [o.key, o.label]),
                  ['custom', 'Custom address'],
                ]}
              />
              {/* Inline address — only when custom and not in per-chain mode (per-chain rows render full-width below). */}
              {cur === 'custom' && !approvalPerChainHasAny(state) && (
                <EnsAddressInput
                  className="flex-1 min-w-[220px]"
                  value={state.approvalAddress || ''}
                  onChange={(v) => update((s) => { s.approvalAddress = v.trim() })}
                  onResolved={(addr) => {
                    const next = addr || undefined
                    if (state.approvalResolved !== next) update((s) => { s.approvalResolved = next })
                  }}
                />
              )}
            </div>
            {cur === 'custom' && (
              <>
                <PerChainAddrControl state={state} update={update} fieldKey="approval" />
                <InfoNote>A JBRulesetApprovalHook contract that approves or rejects queued edits. Must be deployed on every selected chain.</InfoNote>
              </>
            )}
            {cur === 'none' && (
              <WarnNote>No condition lets the owner make last-second edits before a ruleset takes effect, which supporters may see as risky.</WarnNote>
            )}
          </FieldBlock>
        </div>
      )}
    </div>
  )
}
