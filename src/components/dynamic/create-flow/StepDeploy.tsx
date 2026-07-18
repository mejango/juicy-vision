/**
 * Create-flow Step: Deploy — a 1:1 port of the website's renderDeploy
 * (website/src/create-flow.js) for layout/contents/copy, EXCEPT deploy
 * execution: the parent supplies onLaunch and hands off to juicy-vision's
 * existing launch modals (no transactions, status lines, or Relayr quote UI
 * here). The audit prompt is ported from website/src/prompts.js.
 */

import { useState } from 'react'
import { isAddress } from 'viem'
import { truncateAddress } from '../../../utils/ens'
import {
  badStageIndex,
  chainName,
  exportDraftFile,
  shopMediaUploadIssue,
  surplusTokenLabel,
  type CreateFlowState,
  type RecipientRow,
  type StageState,
} from './state'
import { InfoNote, PinkNote, StepHead, WarnNote, useIsDark } from './controls'

// ---------------------------------------------------------------------------
// Pure helpers (ported from the website source)
// ---------------------------------------------------------------------------

function isAddr(v: string | null | undefined): boolean {
  return !!v && isAddress(v.trim(), { strict: false })
}

/**
 * The usable 0x address for a field: the ENS-resolved address when the UI has
 * one, else the raw value (a 0x address or unresolved name). The juicy-vision
 * inputs re-resolve on every change, so the resolved field tracks the raw one
 * (the website additionally pins resolvedFor to the typed name).
 */
function pickResolved(raw: string | null | undefined, resolved?: string | null): string {
  if (resolved && isAddr(resolved)) return resolved
  return (raw || '').trim()
}

function shortAddr(a: string): string {
  return a && a.length > 10 ? truncateAddress(a) : (a || '—')
}

function round2(n: number | string): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function tickerLabel(state: CreateFlowState): string {
  return state.details.ticker || 'TOKEN'
}

// uint32 max (~136 years) — the "Forever" option's max duration
const FOREVER_SECONDS = 4294967295

const DURATION_PRESETS: { label: string; seconds: number }[] = [
  { label: '1 day', seconds: 86400 }, { label: '3 days', seconds: 259200 },
  { label: '7 days', seconds: 604800 }, { label: '14 days', seconds: 1209600 },
  { label: '28 days', seconds: 2419200 }, { label: '30 days', seconds: 2592000 },
  { label: '90 days', seconds: 7776000 }, { label: '365 days', seconds: 31536000 },
]

function secondsLabel(s: number): string {
  const p = DURATION_PRESETS.find((x) => x.seconds === s)
  if (p) return p.label
  const U: [string, number][] = [['year', 31536000], ['week', 604800], ['day', 86400], ['hour', 3600]]
  for (const [unit, secs] of U) {
    if (s % secs === 0) { const n = s / secs; return `${n} ${unit}${n === 1 ? '' : 's'}` }
  }
  return `${s}s`
}

/**
 * Human label for a fund-access currency. 1=ETH, 2=USD; any other id in the
 * create flow is the accounting token's own currency (custom ERC-20).
 */
function fundAccessCurrencyLabel(currency: number, state: CreateFlowState): string {
  const cur = Number(currency || 1)
  if (cur === 1) return 'ETH'
  if (cur === 2) return 'USD'
  if (state.accepts.includes('custom')) return state.customToken.symbol || 'TOKEN'
  if (state.accepts[0] === 'usdc') return 'USDC'
  return `currency ${cur}`
}

function recipLabel(rec: RecipientRow): string {
  if (rec.type === 'project' && rec.projectId) return `project #${rec.projectId}`
  if (rec.address) return shortAddr(rec.address)
  return 'owner'
}

// The "Afterwards" choice only applies when the last ruleset has a duration —
// otherwise there's nothing "after" (a forever ruleset never ends; multiple rulesets chain themselves).
function afterApplies(state: CreateFlowState): boolean {
  const last = state.stages[state.stages.length - 1]
  return !!last && last.durationSeconds > 0
}

// Single source of truth for whether payouts are configured per-token: multi-token
// only when a CUSTOM project holds more than one accounting token (or a custom ERC-20).
interface PayoutKind { key: string; symbol: string }
function currentPayoutKinds(state: CreateFlowState): PayoutKind[] | null {
  if (state.projectType === 'revnet') return null
  const kindOf = (k: string): PayoutKind => k === 'custom'
    ? { key: 'custom', symbol: state.customToken.symbol || 'TOKEN' }
    : k === 'usdc'
      ? { key: 'usdc', symbol: 'USDC' }
      : { key: 'eth', symbol: 'ETH' }
  if ((state.accepts || []).length > 1) return state.accepts.map(kindOf)
  // A custom ERC-20 routes through the per-token path too (token-keyed currency + token decimals, no feed).
  if (state.accepts[0] === 'custom' && isAddr(state.customToken.address)) return [kindOf('custom')]
  return null
}

// ---------------------------------------------------------------------------
// Deploy gates (ported from the website's renderDeploy helpers)
// ---------------------------------------------------------------------------

export function needTickerGate(state: CreateFlowState): boolean {
  return state.projectType === 'revnet' && !/^[A-Za-z0-9]{1,11}$/.test(state.details.ticker)
}

/** Custom project with no valid owner anywhere (field or connected/managed fallback). */
export function needOwnerGate(state: CreateFlowState, fallbackOwner: string): boolean {
  if (state.projectType === 'revnet') return false
  const ownerRaw = pickResolved(state.details.owner, state.details.ownerResolved)
  return !isAddr(ownerRaw) && !isAddr(fallbackOwner)
}

/** Revnet with no valid operator anywhere (field or connected/managed fallback). */
export function needOperatorGate(state: CreateFlowState, fallbackOwner: string): boolean {
  if (state.projectType !== 'revnet') return false
  const opRaw = pickResolved(state.revOperator, state.revOperatorResolved)
  return !isAddr(opRaw) && !isAddr(fallbackOwner)
}

/** Custom accounting token not resolved (verified on every selected chain) yet. */
export function needCustomTokenGate(state: CreateFlowState): boolean {
  return state.accepts.includes('custom') && state.customToken.status !== 'ok'
}

// First stage whose reserved-token or percent-mode payout splits sum over 100% (silently clamped at build).
export function splitTotalIssue(state: CreateFlowState): string | null {
  const stages = state.stages || []
  const over = (recips: RecipientRow[] | undefined) =>
    (recips || []).reduce((s, r) => s + (Number(r.percent) || 0), 0)
  for (let si = 0; si < stages.length; si++) {
    const st = stages[si]
    const pre = stages.length > 1 ? `stage ${si + 1} ` : ''
    const rTot = over(st.reservedRecipients)
    if (rTot > 100.0001) return `${pre}reserved-token splits total ${round2(rTot)}%, over 100%.`
    const kinds = currentPayoutKinds(state)
    if (kinds && st.payoutByKind) {
      for (const kind of kinds) {
        const pk = st.payoutByKind[kind.key]
        if (pk && pk.mode === 'unlimited' && over(pk.recipients) > 100.0001) {
          return `${pre}${kind.symbol} payout splits total ${round2(over(pk.recipients))}%, over 100%.`
        }
      }
    } else if (st.payoutMode === 'unlimited' && over(st.payoutRecipients) > 100.0001) {
      return `${pre}payout splits total ${round2(over(st.payoutRecipients))}%, over 100%.`
    }
  }
  return null
}

// Walk every split / payout / auto-issuance recipient with a non-zero value; return a one-line description
// of the first that has no valid destination (so funds/tokens would be sent to 0x0), or null if all are fine.
export function recipientIssue(state: CreateFlowState): string | null {
  const stages = state.stages || []
  const badSplit = (recips: RecipientRow[] | undefined, kindLabel: string, isPayout: boolean): string | null => {
    for (const r of recips || []) {
      if (!((Number(r.percent) || 0) > 0 || (Number(r.amountEth) || 0) > 0)) continue // empty row — ignore
      if (r.type === 'project') {
        if (!(Number(r.projectId) > 0)) return `a ${kindLabel} to a project is missing its project ID.`
        // A pay-to-project split mints the destination project's tokens. Leaving beneficiary empty hands those
        // tokens to whichever account eventually triggers distribution. Add-to-balance intentionally mints none.
        if ((!isPayout || !r.preferAddToBalance) && !isAddr(pickResolved(r.address, r.resolvedAddress))) {
          return `a ${kindLabel} to a project is missing the address that receives destination/fallback tokens.`
        }
      } else if (r.type === 'lphook') { /* fund-market hook needs no address */ }
      else if (r.type === 'customhook') {
        if (!isAddr(r.hookAddress)) return `a ${kindLabel} uses a custom hook with no valid hook address.`
      } else if (!isAddr(pickResolved(r.address, r.resolvedAddress))) {
        return `a ${kindLabel} has no valid recipient address.`
      }
    }
    return null
  }
  for (let si = 0; si < stages.length; si++) {
    const st = stages[si]
    const pre = stages.length > 1 ? `on stage ${si + 1}, ` : ''
    const kinds = currentPayoutKinds(state)
    const checks: (string | null)[] = [badSplit(st.reservedRecipients, 'reserved-token split', false)]
    if (kinds && st.payoutByKind) {
      kinds.forEach((k) => {
        const pk = st.payoutByKind[k.key]
        checks.push(pk ? badSplit(pk.recipients, 'payout split', true) : null)
      })
    } else {
      checks.push(badSplit(st.payoutRecipients, 'payout split', true))
    }
    for (const c of checks) if (c) return pre + c
    for (const ai of st.autoIssuances || []) {
      if ((Number(ai.count) || 0) > 0 && !isAddr(pickResolved(ai.address, ai.resolvedAddress))) {
        return `${pre}an auto-issuance has no valid recipient address.`
      }
    }
  }
  return null
}

// Per-chain overrides are keyed by canonical chain id (1/10/42161/8453) so they survive a mainnet↔testnet switch.
const CANON_OF: Record<number, number> = { 11155111: 1, 11155420: 10, 421614: 42161, 84532: 8453 }
function canonChainId(id: number): number {
  return CANON_OF[id] ?? id
}

// The resolved 0x address for the approval hook on a chain (per-chain override → default).
function chainApprovalAddr(state: CreateFlowState, chainId: number, def: string): string {
  const ov = state.perChain[canonChainId(chainId)]?.addr?.['approval']
  const v = ov != null && ov !== '' ? ov : def
  return isAddr(v) ? v.trim() : ''
}

// When the approval condition is "Custom address", every selected chain must resolve to a real contract.
// A blank / mistyped / unresolved-ENS value would silently encode approvalHook = address(0) — no review
// window for owner edits — with nothing else to catch it, so it's a hard deploy gate.
export function approvalIssue(state: CreateFlowState): string | null {
  if (!(state.stages || []).some((s) => s.deadline === 'custom')) return null
  const def = pickResolved(state.approvalAddress, state.approvalResolved)
  const bad = (state.chainIds || []).filter((cid) => !isAddr(chainApprovalAddr(state, cid, def)))
  if (!bad.length) return null
  return `The custom ruleset approval condition needs a valid contract address on ${bad.map(chainName).join(', ')}.`
}

// ---------------------------------------------------------------------------
// Stage summaries (ported from the website's revStageSummary / stageSummaryParts)
// ---------------------------------------------------------------------------

function revSplitTotalPct(stage: StageState): number {
  return (stage.reservedRecipients || []).reduce((s, x) => s + (Number(x.percent) || 0), 0)
}

export function revStageSummary(stage: StageState, idx: number, state: CreateFlowState): string {
  const tk = tickerLabel(state)
  const unit = state.revBaseCurrency === 2 ? 'USD' : 'ETH'
  const parts: string[] = []
  if (idx === 0 || stage.weight) parts.push(`${stage.weight || '0'} $${tk}/${unit}`)
  else parts.push('inherits issuance')
  if (stage.issuanceCutOn && Number(stage.weightCutPercent) > 0) {
    parts.push(`−${round2(stage.weightCutPercent)}%/${stage.cutFreqDays || '30'}d`)
  }
  const splitTotal = revSplitTotalPct(stage)
  if (splitTotal > 0) parts.push(`${round2(splitTotal)}% to splits`)
  parts.push(`${round2(Number(stage.cashOutTaxRate))}% cash out tax`)
  return parts.join(' | ')
}

function stageSummaryRaw(stage: StageState, idx: number, state: CreateFlowState): string[] {
  const parts: string[] = []
  parts.push(idx === 0
    ? (stage.scheduleOn && stage.schedule ? 'Starts at a set time' : 'Starts at launch')
    : `Starts after Ruleset #${idx}`)
  parts.push(!stage.durationSeconds
    ? 'lasts until changed by owner'
    : (stage.durationSeconds === FOREVER_SECONDS ? 'lasts forever' : `lasts ${secondsLabel(stage.durationSeconds)}`))

  // Issuance — weight, reserved split, issuance cut.
  if (stage.tokenMode === 'custom') {
    parts.push(`issues ${stage.weight || '0'} tokens / ${fundAccessCurrencyLabel(stage.baseCurrency, state)}`)
    const reservedPct = (stage.reservedRecipients || []).reduce((s, x) => s + (Number(x.percent) || 0), 0)
    if (reservedPct > 0) {
      let rLine = `${round2(reservedPct)}% reserved`
      const rNamed = (stage.reservedRecipients || []).filter((x) => Number(x.percent) > 0)
      if (rNamed.length) rLine += ` (${rNamed.map((x) => `${round2(Number(x.percent))}% → ${recipLabel(x)}`).join(', ')})`
      parts.push(rLine)
    }
    if (stage.issuanceCutOn && Number(stage.weightCutPercent) > 0) {
      parts.push(`issuance cuts ${round2(Number(stage.weightCutPercent))}% each cycle`)
    }
  } else parts.push('no issuance')

  // Cash outs.
  if (stage.cashOutEnabled && stage.payoutMode !== 'unlimited') {
    parts.push(`cash outs on, ${round2(Number(stage.cashOutTaxRate))}% tax`)
  }

  // Payouts — list each recipient's share.
  if (stage.payoutMode === 'unlimited') {
    const uRecips = (stage.payoutRecipients || []).filter((r) => Number(r.percent) > 0)
    if (!uRecips.length) {
      // No splits → everything goes to the owner; say so directly instead of "all funds" + "remainder → owner".
      parts.push('pays out all funds to owner')
    } else {
      parts.push('pays out all funds')
      uRecips.forEach((r) => parts.push(`${round2(Number(r.percent))}% → ${recipLabel(r)}`))
      parts.push('remainder → owner')
    }
  } else if (stage.payoutMode === 'limited') {
    const pc = fundAccessCurrencyLabel(stage.payoutCurrency, state)
    const named = (stage.payoutRecipients || []).filter((r) => Number(r.amountEth) > 0)
    if (named.length) named.forEach((r) => parts.push(`pays ${r.amountEth} ${pc} → ${recipLabel(r)}`))
    else parts.push('payouts set, no recipients yet')
  }

  // Surplus allowance.
  if (stage.surplusAllowanceOn && stage.payoutMode !== 'unlimited') {
    if (stage.surplusAllowanceUnlimited) parts.push('owner can withdraw all surplus')
    else if (Number(stage.surplusAllowanceAmount) > 0) {
      parts.push(`owner can withdraw ${stage.surplusAllowanceAmount} ${fundAccessCurrencyLabel(stage.surplusAllowanceCurrency, state)} of surplus`)
    } else parts.push('surplus allowance on')
  }

  // Noteworthy flags.
  if (stage.allowOwnerMinting) parts.push('owner can mint tokens')
  if (stage.pauseTransfers) parts.push('token credit transfers paused')
  if (stage.pausePay) parts.push('payments paused')
  if (stage.holdFees) parts.push('fees held')
  if (stage.allowTerminalMigration) parts.push('terminal migration allowed')

  return parts
}

// Capitalized bullet strings for a stage (no leading "• ").
export function stageSummaryParts(stage: StageState, idx: number, state: CreateFlowState): string[] {
  return stageSummaryRaw(stage, idx, state).map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
}

// ---------------------------------------------------------------------------
// Audit prompt (ported verbatim from website/src/prompts.js getAuditPrompt)
// ---------------------------------------------------------------------------

export function getAuditPrompt(): string {
  return [
    'You are a world-class security engineer auditing the Juicebox V6 protocol — an open-source, permissionless programmable money system deployed on Ethereum and L2s (Optimism, Arbitrum, Base, and possibly more). Your goal is to prove me wrong: once we have deployed projects (revnets) 1-7 alongside the ecosystem in deploy-all-v6 Deploy.s.sol, and other juicebox projects begin being created (revnets and omnichain deployed), and they all start receiving payments and being used in their full capacity, you cannot find a way to brick any of them, steal their funds, or corrupt project owner and token holder invariants on your own, you cannot find a way to have made project operations more efficient for any and all network participants that we should have considered before deployment, and you cannot find ways to have made documentation more clear, efficient, and friendly for both AIs and humans looking to get things done with the protocol. Find as many ways as you can to prove me wrong, don’t stop at just your first find — the wellbeing and safety of the protocol that we will be deploying depends on you. Start from first principles, using the other audit files in the repos as reference but not as a priority guide. Use a new .md file as a scratchpad as needed and for results.',
    '',
    'Start by cloning the full ecosystem repo and following its top-level audit engine:',
    '',
    '```bash',
    'git clone --recursive https://github.com/Bananapus/version-6',
    '```',
    '',
    'Then read `AUDIT_INSTRUCTIONS.md` at the root of that repo — it is the audit engine that walks through depth, subsystem, and adversarial-persona selection, decomposes the work into components, and tells you where to submit findings. The context below is a fast primer; the repo and its `AUDIT_INSTRUCTIONS.md` are the source of truth.',
    '',
    '## Protocol Architecture',
    '',
    'The protocol is built from ~47 contracts across 17 repositories under github.com/Bananapus.',
    '',
    'Core contracts:',
    '- JBMultiTerminal: Holds funds. Executes pay, payout, cash out, surplus allowance, and fee-processing flows. Multi-token. 2.5% fee with 28-day hold.',
    '- JBTerminalStore: Accounting engine. Records balances, computes surplus, bonding curve reclaim math.',
    '- JBController: Project lifecycle orchestrator. Ruleset queuing, token mint/burn, reserved token distribution.',
    '- JBRulesets: Economic parameter storage. Linked-list with weight decay, approval hooks, bit-packed metadata.',
    '- JBTokens: Dual token system (internal credits + ERC-20). Credits burned first.',
    '- JBPermissions: 256-bit packed operator permissions. ROOT grants all. Wildcard projectId=0.',
    '- JBPrices: Price feed registry. Immutable feeds, inverse auto-calculation.',
    '- JBSplits: Payout and reserved token split distribution.',
    '- JBFundAccessLimits: Per-cycle payout limits and surplus allowances.',
    '- JBDirectory: Routes projects to terminals and controllers.',
    '',
    '## Key Flows',
    '',
    '1. Payment: accept funds → STORE.recordPaymentFrom (weight calc, data hook) → mint tokens → fulfill pay hooks',
    '2. Cash out: STORE.recordCashOutFor (bonding curve, data hook) → burn tokens → transfer reclaim → fulfill hooks → take fees',
    '3. Payouts: STORE.recordPayoutFor → distribute to splits → leftover to owner → take fees',
    '4. Reserved tokens: accumulated in pendingReservedTokenBalanceOf → sendReservedTokensToSplitsOf mints and distributes',
    '',
    '## Critical Invariants',
    '',
    '1. Terminal solvency: internal balances + held-fee obligations must reconcile with actual token balances',
    '2. No over-withdrawal: payouts and allowance usage must never exceed configured per-cycle limits',
    '3. Cash out correctness: surplus, total supply, tax rate, fee treatment, and hook overrides must produce correct reclaim',
    '4. Ruleset integrity: active ruleset and fallback/cycling behavior must match exact timing and approval-hook semantics',
    '5. Token accounting: credits, ERC-20 supply, reserved balance, and burn/mint paths must stay coherent',
    '6. Privilege containment: permissions, wildcards, controller migration, and terminal routing must not allow unauthorized control',
    '7. Held-fee correctness: deferred fees must not be forgiven, duplicated, or charged to the wrong place',
    '8. Preview coherence: previewPayFor and previewCashOutFrom must not drift from actual execution',
    '',
    '## Omnichain Resilience',
    '',
    'The protocol deploys across Ethereum, Optimism, Arbitrum, Base, and possibly more. Each chain has unique properties:',
    '- Native token varies: ETH on Ethereum/L2s, CELO on Celo. Some chains may have no native token. The protocol uses NATIVE_TOKEN (0x...EEEe) as a sentinel and WRAPPED_NATIVE_TOKEN (WETH9-compatible) for wrapping.',
    '- Token addresses differ per chain: USDC, USDT, DAI, etc. have different contract addresses on each chain. The protocol must not assume a token address is portable.',
    '- Decimals vary: USDC has 6 decimals, ETH has 18. The protocol uses JBFixedPointNumber for decimal adjustment and JBPrices for cross-currency conversion.',
    '- Cross-chain bridging: JBSucker contracts use merkle trees (outbox/inbox) to bridge tokens between chains. Token mappings are immutable once the outbox tree has entries.',
    '- Sequencer risk on L2s: JBChainlinkV3SequencerPriceFeed checks L2 sequencer status and enforces a grace period after restart.',
    '- Amount caps: Cross-chain amounts use uint128 for SVM/Solana compatibility.',
    '',
    '## Omnitoken Resilience',
    '',
    'The protocol is multi-token by design. Each terminal can hold multiple token types simultaneously:',
    '- Accounting contexts track token address, decimals, and currency per terminal. Duplicate prevention is enforced.',
    '- Currency (uint32) is derived from token address: uint32(uint160(tokenAddress)). This is distinct from baseCurrency (1=ETH, 2=USD) used in ruleset metadata.',
    '- groupId (uint256) and currency (uint32) represent the same token but with different bit widths — mixing them up causes silent bugs.',
    '- Surplus aggregation converts across all terminals and tokens via JBPrices to a target currency. If a price feed reverts, operations using that currency pair also revert (DoS, not fund loss).',
    '- Fee-free intra-terminal payouts track per token. Payout limits and surplus allowances are scoped per terminal/token/currency.',
    '- Empty fundAccessLimitGroups means zero payouts (NOT unlimited). Use uint224.max for unlimited.',
    '- ERC-20 fee-on-transfer, rebasing, and non-standard decimals are potential edge cases at system boundaries.',
    '',
    '## Attack Surfaces',
    '',
    '- pay, cashOutTokensOf, sendPayoutsOf, and useAllowanceOf entry points',
    '- preview paths when downstream repos treat them as execution truth',
    '- held-fee lifecycle and _processFee',
    '- surplus aggregation across terminals and token types',
    '- controller and terminal migration',
    '- setPermissionsFor and wildcard semantics',
    '- hook reentrancy: pay hooks, cash out hooks, split hooks',
    '- cross-chain token mapping and bridge message integrity',
    '- native token handling on chains where the native token is not ETH',
    '',
    '## Key Constants',
    '',
    '- FEE = 25 / 1000 = 2.5% (1000 is the fee denominator, not an achievable fee value)',
    '- MAX_RESERVED_PERCENT = 10,000 (basis points)',
    '- MAX_CASH_OUT_TAX_RATE = 10,000',
    '- SPLITS_TOTAL_PERCENT = 1,000,000,000',
    '- NATIVE_TOKEN = 0x000000000000000000000000000000000000EEEe',
    '- Fee holding: 28 days (2,419,200 seconds)',
    '',
    '## Known Issues (accepted risks)',
    '',
    '- cashOut(0) with totalSupply==0 returns entire surplus',
    '- Pending reserved tokens inflate totalSupply, reducing cashout value',
    '- Bonding curve subadditivity violation from mulDiv rounding (<0.01%)',
    '',
    '## Source Repositories',
    '',
    '- Core: github.com/Bananapus/nana-core-v6',
    '- 721 Hook: github.com/Bananapus/nana-721-hook-v6',
    '- Buyback Hook: github.com/Bananapus/nana-buyback-hook-v6',
    '- Suckers (cross-chain): github.com/Bananapus/nana-suckers-v6',
    '- Revnet: github.com/rev-net/revnet-core-v6',
    '- Router Terminal: github.com/Bananapus/nana-router-terminal-v6',
    '',
    '## How to Contribute',
    '',
    'Review any contract function for:',
    '- Logic errors that break invariants listed above',
    '- Reentrancy paths through hooks',
    '- Integer overflow/underflow or precision loss in accounting',
    '- Permission bypasses',
    '- State inconsistencies between preview and execution',
    '',
    'Report findings with: affected function, severity, description, and proof of concept.',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Review summary
// ---------------------------------------------------------------------------

function ReviewRow({ k, v }: { k: string; v: string }) {
  const isDark = useIsDark()
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 border-b last:border-b-0 ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
      <span className={`text-xs shrink-0 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{k}</span>
      <span className={`text-sm text-right ${isDark ? 'text-white' : 'text-gray-900'}`}>{v}</span>
    </div>
  )
}

function ReviewBullets({ k, items }: { k: string; items: string[] }) {
  const isDark = useIsDark()
  return (
    <div className={`py-1.5 border-b last:border-b-0 ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{k}</span>
      <div className="mt-1">
        {items.map((it, i) => (
          <div key={i} className={`text-sm pl-4 -indent-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>• {it}</div>
        ))}
      </div>
    </div>
  )
}

function ReviewSummary({ state }: { state: CreateFlowState }) {
  const isDark = useIsDark()
  const box = `border px-3 py-1.5 mb-2 ${isDark ? 'border-white/10 bg-white/[0.03]' : 'border-gray-200 bg-gray-50/50'}`
  if (state.projectType === 'revnet') {
    const opRaw = pickResolved(state.revOperator, state.revOperatorResolved)
    return (
      <div className={box}>
        <ReviewRow k="Flavor" v="Revnet" />
        <ReviewRow k="Name" v={state.details.name || '—'} />
        <ReviewRow k="Token" v={`$${tickerLabel(state)}`} />
        <ReviewRow k="Accounting token" v={surplusTokenLabel(state)} />
        <ReviewRow k="Operator" v={/^0x/.test(opRaw) ? shortAddr(opRaw) : 'Project owner'} />
        <ReviewRow k="Stages" v={String(state.stages.length)} />
        {state.stages.map((s, i) => (
          <ReviewRow key={i} k={`Stage #${i + 1}`} v={revStageSummary(s, i, state)} />
        ))}
        <ReviewRow k="Chains" v={state.chainIds.map(chainName).join(', ')} />
      </div>
    )
  }
  return (
    <div className={box}>
      <ReviewRow k="Name" v={state.details.name || '—'} />
      <ReviewRow k="Accounting token" v={surplusTokenLabel(state) + (state.swapRouter ? ' (+ any via router)' : '')} />
      <ReviewRow
        k="Launch"
        v={state.stages[0] && state.stages[0].schedule
          ? new Date(Number(state.stages[0].schedule) * 1000).toLocaleString()
          : 'Immediately'}
      />
      <ReviewRow k="Rulesets" v={String(state.stages.length)} />
      {state.stages.map((s, i) => (
        <ReviewBullets key={i} k={`Ruleset #${i + 1}`} items={stageSummaryParts(s, i, state)} />
      ))}
      {afterApplies(state) && (
        <ReviewRow
          k="Afterwards"
          v={{ wait: 'idle (standby)', terminal: 'continue on the same terms forever', cycle: 'repeat the cycle forever' }[state.afterMode] || state.afterMode}
        />
      )}
      <ReviewRow k="Shop" v={state.shopEnabled && state.nfts.length ? `${state.nfts.length} item(s)` : 'None'} />
      <ReviewRow k="Chains" v={state.chainIds.map(chainName).join(', ')} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StepDeployProps {
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
  /** connected/managed owner fallback when state.details.owner is blank */
  fallbackOwner: string
  launching: boolean
  buildingLabel: string | null
  preparationError: string | null
  onLaunch: () => void
}

export default function StepDeploy({
  state, update, fallbackOwner, launching, buildingLabel, preparationError, onLaunch,
}: StepDeployProps) {
  const isDark = useIsDark()
  const isRev = state.projectType === 'revnet'
  const [auditCopied, setAuditCopied] = useState(false)

  // Deploy gates — every reason the launch button can be disabled.
  const bad = badStageIndex(state) // revnets have no per-stage durations to validate (always -1)
  const needTicker = needTickerGate(state)
  const needOwner = needOwnerGate(state, fallbackOwner)
  const needOperator = needOperatorGate(state, fallbackOwner)
  const needCustomToken = needCustomTokenGate(state) // custom accounting token not resolved yet
  const recipBad = recipientIssue(state) // a split/payout/auto-issuance with a value but no valid recipient
  const totalBad = splitTotalIssue(state) // a stage whose reserved/payout percentages sum over 100%
  const approvalBad = approvalIssue(state) // custom approval condition with no valid hook address on some chain
  const mediaBad = shopMediaUploadIssue(state) // a shop item whose media is still pinning or failed to pin

  const disabled = launching || !!buildingLabel || !state.tos || !state.chainIds.length
    || !state.details.name || needTicker || needOwner || needOperator || needCustomToken
    || !!recipBad || !!totalBad || !!approvalBad || !!mediaBad || bad !== -1

  const launchLabel = launching
    ? (isRev ? 'Deploying…' : 'Launching…')
    : buildingLabel
      ? buildingLabel
      : (isRev ? 'Deploy revnet' : 'Launch project')

  const copyAuditPrompt = (e: React.MouseEvent) => {
    // preventDefault stops the surrounding label from toggling the checkbox when the link is clicked.
    e.preventDefault()
    e.stopPropagation()
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(getAuditPrompt()).then(() => {
        setAuditCopied(true)
        setTimeout(() => setAuditCopied(false), 2000)
      }).catch(() => {})
    }
  }

  return (
    <div>
      <StepHead desc={isRev ? 'Review, then deploy your revnet.' : 'Review your project, then launch.'} />

      <ReviewSummary state={state} />

      {/* The exact transaction for each chain is shown in a confirmation screen right before you sign it. */}
      {state.chainIds.length > 1 ? (
        <>
          <PinkNote>
            {`Your wallet will switch networks and prompt for a signature once per chain (${state.chainIds.length} chains) — each request is bound to its own chain, so the wallet must be on that network to sign it. After signing all ${state.chainIds.length}, you pay gas once and Relayr deploys to every chain.`}
          </PinkNote>
          <InfoNote>Each chain’s exact transaction is shown for review before you sign it.</InfoNote>
        </>
      ) : (
        <InfoNote>The exact transaction data is shown for review before you sign it.</InfoNote>
      )}

      {/* ToS */}
      <label className={`flex items-start gap-2 my-4 text-sm cursor-pointer ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
        <input
          type="checkbox"
          checked={state.tos}
          onChange={(e) => { const v = e.target.checked; update((s) => { s.tos = v }) }}
          className="mt-0.5 accent-teal-500"
        />
        <span>
          {' I understand this is a public protocol that can’t be changed and accept the risks of deploying. '}
          <a
            href="#"
            onClick={copyAuditPrompt}
            className="underline decoration-dotted underline-offset-2 text-teal-400 hover:text-teal-300"
          >
            {auditCopied ? '[copied to clipboard]' : '[copy system audit prompt]'}
          </a>
        </span>
      </label>

      {/* Pre-deploy export: a small right-aligned action above the full-width Launch button. */}
      <div className="flex justify-end mb-2.5">
        <button
          type="button"
          title="Save this exact editable project draft before deploying"
          disabled={launching}
          onClick={() => exportDraftFile(state)}
          className={`px-2 py-1 text-xs border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isDark
              ? 'border-white/15 text-gray-400 hover:text-white'
              : 'border-gray-300 text-gray-500 hover:text-gray-900'
          }`}
        >
          Export your configuration
        </button>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onLaunch}
        className="w-full py-3 text-sm font-semibold bg-teal-500 text-white hover:bg-teal-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {launchLabel}
      </button>

      {/* Spell out every reason the launch button is disabled, so the user knows exactly what to fix. */}
      {!state.details.name && <InfoNote>{`Add a project name on the Details step to ${isRev ? 'deploy.' : 'launch.'}`}</InfoNote>}
      {needTicker && <InfoNote>Add a token symbol on the Details step to deploy your revnet.</InfoNote>}
      {needOwner && <InfoNote>Set a project owner on the Flavor step to launch.</InfoNote>}
      {needOperator && <InfoNote>Set an operator on the Flavor step to deploy your revnet.</InfoNote>}
      {needCustomToken && (
        <WarnNote>Your custom accounting token isn’t verified on every selected chain yet — fix it on the Flavor step (same address, symbol, and decimals on each chain).</WarnNote>
      )}
      {recipBad && (
        <WarnNote>{`${capitalize(recipBad)} Fix or remove it before deploying — otherwise those funds/tokens go to the zero address.`}</WarnNote>
      )}
      {totalBad && (
        <WarnNote>{`${capitalize(totalBad)} Reduce a share on the ${isRev ? 'Stages' : 'Rulesets'} step (anything not allocated already goes to the project owner).`}</WarnNote>
      )}
      {approvalBad && (
        <WarnNote>{`${approvalBad} Without it the approval condition silently becomes “none” (no review window for edits).`}</WarnNote>
      )}
      {mediaBad && <WarnNote>{`${mediaBad} A store item deployed while its media is unresolved becomes a permanent name-only tier.`}</WarnNote>}
      {!state.chainIds.length && <WarnNote>Select at least one chain on the Flavor step before deploying.</WarnNote>}
      {bad !== -1 && (
        <WarnNote>{`Stage ${bad + 1} has no duration but isn’t the last stage. Give it a duration on the Stages step so Stage ${bad + 2} starts when its cycle ends.`}</WarnNote>
      )}
      {!state.tos && <InfoNote>{`Check the box above to confirm you accept the risks before ${isRev ? 'deploying.' : 'launching.'}`}</InfoNote>}

      {preparationError && <div className="text-xs mt-2 text-red-400">{preparationError}</div>}
    </div>
  )
}
