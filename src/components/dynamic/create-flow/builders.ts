/**
 * Deploy-config builders for the create-flow port — the state→config mapping
 * from the ported CreateFlowState onto juicy-vision's launch plumbing types.
 *
 * Semantic source of truth: website/src/create-flow.js
 *   - resolveStages / standbyStage / terminalStage (the "Afterwards" choice)
 *   - assembleRuleset (weight/reserved from split-row sums, forced cash-out
 *     tax, split groups + fund access groups for single- and multi-token,
 *     approval hooks per deadline, per-chain overrides)
 *   - buildTerminalConfigs (accepts eth/usdc/custom + router registry)
 *   - buildRevStage (revnet stage encoding)
 *   - build721Config / pinShopItemsMetadata (721 shop tiers)
 * Target shapes: src/services/relayr (JBRulesetConfig, JBTerminalConfig,
 * REVStageConfig) and src/services/omnichainDeployer (JB721TierConfig,
 * JBDeployTiersHookConfig, ChainConfigOverride).
 *
 * Known deviations from the website (forced by juicy-vision's stricter
 * encode-time validation — see the final notes in each site):
 *   - Fund-access limits denominate in the accounting token's own currency
 *     (uint32(uint160(token))) or in USD (2) via JBPrices when the stage
 *     picked USD (18-decimal amounts) — matching the website.
 *   - Ruleset metadata sets useDataHookForCashOut with a zero dataHook when
 *     the shop redeems (the omnichain deployer's 721 wrapper wires the hook
 *     address itself), exactly like the website's launch path.
 */

import { isAddress, parseEther, parseUnits } from 'viem'
import type {
  JBRulesetConfig,
  JBSplitConfig,
  JBSplitGroupConfig,
  JBFundAccessLimitGroupConfig,
  JBCurrencyAmountConfig,
  JBTerminalConfig,
  REVStageConfig,
} from '../../../services/relayr'
import type {
  JB721TierConfig,
  JBDeployTiersHookConfig,
  ChainConfigOverride,
} from '../../../services/omnichainDeployer'
import { pinMetadata } from '../../../services/ipfsPinning'
import { encodeIpfsUri } from '../../../utils/ipfs'
import { JB_CONTRACTS, JB_ROUTER_TERMINAL_REGISTRY, NATIVE_TOKEN, ZERO_ADDRESS } from '../../../constants'
import { CANONICAL_USDC_BY_CHAIN } from '../../../../shared/chains'
import {
  type CreateFlowState,
  type StageState,
  type ItemState,
  type RecipientRow,
  createStage,
} from './state'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPLITS_TOTAL = 1_000_000_000 // JBConstants.SPLITS_TOTAL_PERCENT (1e9 = 100%)
const UINT224_MAX = (1n << 224n) - 1n // unlimited sentinel for payout limits / surplus allowances
const UINT112_MAX = (1n << 112n) - 1n // max ruleset weight
const UINT104_MAX = (1n << 104n) - 1n // max tier price / auto-issuance count

/** uint32 max (~136 years) — the "Forever" duration option. */
export const FOREVER_SECONDS = 4294967295

const TIER_UNLIMITED_SUPPLY = 999999999

/**
 * JBDeadline approval-hook contracts (chain-invariant — same address on every
 * supported chain). Keys match StageState.deadline. 'none'/'custom' resolve
 * elsewhere (zero address / the user-supplied contract).
 */
export const DEADLINE_HOOKS: Record<string, string> = {
  '3hours': '0xd25264015483caa5c34643942d41f94bed5f1e92', // JBDeadline3Hours
  '1day': '0x3a15ac0bcf4f7dd48359a36b3e293254cf26d4ca', // JBDeadline1Day
  '3days': '0xcda708c98fbdd15a7ff7f0c5c50f9371ca52c78f', // JBDeadline3Days
  '7days': '0x540923f7b6166bf9713490719a2210aeebc9fca2', // JBDeadline7Days
}

/**
 * JBP6FeeLPSplitHook (JBUniswapV4LPSplitHook) — the "Fund market" reserved-split
 * target. Same address on every chain it's deployed to; NOT deployed on
 * OP Sepolia (11155420), where lphook rows fall back to a plain wallet split
 * (mirroring the website's missing-getAddress fallthrough).
 */
export const JBP6_FEE_LP_SPLIT_HOOK = '0xae6705c33c8b46f56878a1d4f1ce4d75fcfb6f62'
const LP_SPLIT_HOOK_CHAINS = new Set([1, 10, 8453, 42161, 84532, 421614, 11155111])

// ---------------------------------------------------------------------------
// Small helpers (ports of component-base isAddr/addrOrZero + ENS pickers)
// ---------------------------------------------------------------------------

function isAddr(v: string | undefined | null): v is string {
  return !!v && isAddress(v.trim(), { strict: false })
}

function addrOrZero(v: string | undefined | null): string {
  return isAddr(v) ? (v as string).trim() : ZERO_ADDRESS
}

/** The usable 0x address for a recipient: the resolved ENS address, else the raw value. */
function pickResolved(name: string | undefined, rec?: { resolvedAddress?: string }): string {
  const n = (name || '').trim()
  if (isAddr(n)) return n
  if (rec?.resolvedAddress && isAddr(rec.resolvedAddress)) return rec.resolvedAddress
  return n
}

/** Resolve a string to a 0x address or '' (so garbage encodes as ZERO, never as-is). */
function resolvedStr(str: string | undefined): string {
  const s = (str || '').trim()
  return isAddr(s) ? s : ''
}

/** uint32(uint160(token)) — the token-keyed JBAccountingContext currency id. */
function uint32Currency(token: string): number {
  return Number(BigInt(token) & 0xffffffffn)
}

/** uint256(uint160(token)) as a decimal string — the payout split group id. */
function uint256FromAddress(token: string): string {
  return BigInt(token).toString()
}

/**
 * Parse a user-typed token amount to 18-dec fixed point, clamped to maxV and
 * never negative. Returns 0n on empty/garbage (never throws).
 */
function tokenAmount18(v: string | undefined, maxV: bigint): bigint {
  let n: bigint
  try {
    n = v == null || String(v).trim() === '' ? 0n : parseEther(String(v).trim())
  } catch {
    return 0n
  }
  if (n < 0n) return 0n
  return n > maxV ? maxV : n
}

/** Parse a user-typed amount into the token's fixed-point units. Empty → 0n. */
function priceUnits(v: string | undefined, decimals: number): bigint {
  if (v == null || String(v).trim() === '') return 0n
  const parsed = parseUnits(String(v).trim(), decimals)
  if (parsed < 0n) throw new Error('Amounts cannot be negative.')
  return parsed
}

// ---------------------------------------------------------------------------
// Per-chain override accessors
//
// Key scheme (written by the create-flow UI):
//   addr bucket — 'owner', 'op', 'approval', 'r:<stage>:<idx>' (reserved
//     beneficiary), 'p:<stage>:<idx>' (payout beneficiary), 'pk:<kind>:<idx>'
//     (per-token payout beneficiary), 'ai:<stage>:<idx>' (auto-issuance
//     beneficiary), 'rb:<item>' (tier reserve beneficiary),
//     'is:<item>:<idx>' (item-split beneficiary)
//   num bucket — 'rpid:<stage>:<idx>' / 'ppid:<stage>:<idx>' /
//     'pkpid:<kind>:<idx>' (project-id overrides), 'p:<stage>:<idx>' (payout
//     amount override), 'item:<idx>' ('0' = exclude the item on this chain),
//     'isupply:<idx>' (per-chain supply override)
// ---------------------------------------------------------------------------

function pcGet(state: CreateFlowState, chainId: number, kind: 'addr' | 'num', key: string): string | undefined {
  const v = state.perChain?.[chainId]?.[kind]?.[key]
  return v != null && String(v).trim() !== '' ? String(v).trim() : undefined
}

/** The resolved 0x address for a field on a chain (per-chain override → default). */
function chainAddr(state: CreateFlowState, chainId: number, key: string, defStr: string): string {
  return resolvedStr(pcGet(state, chainId, 'addr', key) ?? defStr)
}

/** Per-chain payout amount for a single-token recipient (override → default). */
function chainPayoutAmount(state: CreateFlowState, chainId: number, stageIdx: number, recipIdx: number): string | undefined {
  return pcGet(state, chainId, 'num', `p:${stageIdx}:${recipIdx}`)
    ?? state.stages[stageIdx]?.payoutRecipients[recipIdx]?.amountEth
}

/** Per-chain project id for a project / custom-hook split (override → default). */
function chainProjectId(state: CreateFlowState, chainId: number, key: string, def: number): number {
  const ov = pcGet(state, chainId, 'num', key)
  return (ov != null ? Number(ov) : 0) || def || 0
}

/** Whether an item is included on a chain (num['item:<idx>'] === '0' excludes it). */
function chainItemIncluded(state: CreateFlowState, chainId: number, itemIdx: number): boolean {
  return pcGet(state, chainId, 'num', `item:${itemIdx}`) !== '0'
}

// ---------------------------------------------------------------------------
// Stage resolution — the "Afterwards" choice (wait / terminal / cycle)
// ---------------------------------------------------------------------------

/** The choice applies whenever the last ruleset has a duration (something comes after it). */
function afterApplies(state: CreateFlowState): boolean {
  const last = state.stages[state.stages.length - 1]
  return !!last && last.durationSeconds > 0
}

/**
 * Standby: zero issuance, no payouts/surplus, payments paused, no expiry;
 * cash outs preserved so holders can exit.
 */
function standbyStage(s1: StageState): StageState {
  const s = createStage()
  s.durationSeconds = 0 // never expires — sits in standby
  s.baseCurrency = s1.baseCurrency
  s.deadline = s1.deadline
  s.tokenMode = 'custom' // explicit zero issuance
  s.weight = '0'
  s.reservedPercent = 0
  s.weightCutPercent = 0
  s.allowOwnerMinting = false
  s.cashOutEnabled = s1.cashOutEnabled // keep exit liquidity
  s.cashOutTaxRate = s1.cashOutTaxRate
  s.payoutMode = 'none' // no payouts, no surplus allowance
  s.pausePay = true // paused payments
  return s
}

/**
 * Terminal: the last ruleset's exact terms continue, but with the max (uint32)
 * duration so it effectively never cycles again.
 */
function terminalStage(s1: StageState): StageState {
  const s = JSON.parse(JSON.stringify(s1)) as StageState
  s.expanded = false
  s.schedule = ''
  s.scheduleOn = false // only ruleset 1 schedules its start
  s.durationCustom = false
  s.customDurVal = ''
  s.customDurUnit = 'days'
  s.durationSeconds = FOREVER_SECONDS // uint32 max — effectively permanent
  return s
}

/** The rulesets actually deployed, applying the "Afterwards" choice. */
function resolveStages(state: CreateFlowState): StageState[] {
  const stages = state.stages
  if (!afterApplies(state)) return stages
  const last = stages[stages.length - 1]
  if (state.afterMode === 'wait') return stages.concat([standbyStage(last)])
  if (state.afterMode === 'terminal') return stages.concat([terminalStage(last)])
  return stages // 'cycle' — the single ruleset auto-repeats
}

/**
 * The edit deadline only matters when a future-ruleset boundary exists: not
 * for a forever-duration last ruleset, and not for a single timed ruleset set
 * to Terminate (which just continues on the same terms).
 */
function deadlineApplies(state: CreateFlowState): boolean {
  const last = state.stages[state.stages.length - 1]
  if (!last) return false
  if (last.durationSeconds === FOREVER_SECONDS) return false
  if (state.stages.length === 1 && afterApplies(state) && state.afterMode === 'terminal') return false
  return true
}

/** Split locks only encode for a fixed-duration ruleset (not Flexible). */
function splitLockAllowed(stage: StageState): boolean {
  return !!stage && (Number(stage.durationSeconds) || 0) > 0
}

// ---------------------------------------------------------------------------
// Accounting token derivations
// ---------------------------------------------------------------------------

function customAccounting(state: CreateFlowState): boolean {
  return (state.accepts || [])[0] === 'custom'
}

function customCurrencyId(state: CreateFlowState): number {
  const a = state.customToken?.address
  return isAddr(a) ? uint32Currency(a) : 0
}

function customAcctDecimals(state: CreateFlowState): number {
  const d = state.customToken?.decimals
  return d != null && !isNaN(Number(d)) ? Number(d) : 18
}

/**
 * The accounting token the project HOLDS — address + token-keyed currency.
 * Payout split group ids, fund-access token, and limit currencies all use
 * THIS token.
 */
function acctTokenFor(state: CreateFlowState, chainId: number): { token: string; decimals: number; currency: number } {
  if (customAccounting(state) && isAddr(state.customToken.address)) {
    return { token: state.customToken.address, decimals: customAcctDecimals(state), currency: customCurrencyId(state) }
  }
  if ((state.accepts[0] || 'eth') === 'usdc') {
    const usdc = CANONICAL_USDC_BY_CHAIN[chainId]
    if (usdc) return { token: usdc, decimals: 6, currency: uint32Currency(usdc) }
  }
  return { token: NATIVE_TOKEN, decimals: 18, currency: uint32Currency(NATIVE_TOKEN) }
}

interface PayoutKind {
  key: string
  decimals: number
  addrForChain: (chainId: number) => string | null
}

/** Token "kind" objects for the create flow's accepted tokens. */
function createPayoutKinds(state: CreateFlowState): PayoutKind[] {
  return (state.accepts || []).map((k) => {
    if (k === 'custom') {
      const ct = state.customToken
      return { key: 'custom', decimals: customAcctDecimals(state), addrForChain: () => ct.address || null }
    }
    return k === 'usdc'
      ? { key: 'usdc', decimals: 6, addrForChain: (cid: number) => CANONICAL_USDC_BY_CHAIN[cid] || null }
      : { key: 'eth', decimals: 18, addrForChain: () => NATIVE_TOKEN }
  })
}

/**
 * Whether payouts/surplus are configured per-token: multi-token only when a
 * CUSTOM project holds more than one accounting token, or a custom ERC-20
 * (token-keyed currency + token decimals, no feed).
 */
function currentPayoutKinds(state: CreateFlowState): PayoutKind[] | null {
  if (state.projectType !== 'revnet' && (state.accepts || []).length > 1) return createPayoutKinds(state)
  if (state.projectType !== 'revnet' && customAccounting(state) && isAddr(state.customToken.address)) {
    return createPayoutKinds(state)
  }
  return null
}

// ---------------------------------------------------------------------------
// Split share arithmetic
// ---------------------------------------------------------------------------

/**
 * Adjust integer split shares so they sum to EXACTLY SPLITS_TOTAL (1e9).
 * Per-row rounding can drift a few atoms; JBSplits reverts if a group EXCEEDS
 * SPLITS_TOTAL. Correct the drift on the largest share. Mutates + returns.
 */
function fillSplits(rawShares: number[]): number[] {
  if (!rawShares.length) return rawShares
  const sum = rawShares.reduce((s, v) => s + v, 0)
  const delta = SPLITS_TOTAL - sum
  if (delta !== 0) {
    let maxI = 0
    for (let i = 1; i < rawShares.length; i++) if (rawShares[i] > rawShares[maxI]) maxI = i
    rawShares[maxI] = Math.max(0, rawShares[maxI] + delta)
  }
  return rawShares
}

/**
 * Convert fixed-point payout amounts into exact 1e9 split shares without
 * passing through JS floats (amounts can exceed MAX_SAFE_INTEGER).
 */
function splitSharesFromAmounts(amounts: bigint[]): number[] {
  if (!amounts.length) return []
  const total = amounts.reduce((sum, amount) => {
    if (amount < 0n) throw new Error('Payout amounts cannot be negative.')
    return sum + amount
  }, 0n)
  if (total === 0n) return amounts.map(() => 0)
  return fillSplits(amounts.map((amount) => Number((amount * BigInt(SPLITS_TOTAL)) / total)))
}

/** The lphook split's pass-through beneficiary (website uses the connected account; we use the resolved owner/operator). */
function lpFallbackBeneficiary(state: CreateFlowState): string {
  const owner = pickResolved(state.details.owner, { resolvedAddress: state.details.ownerResolved })
  if (isAddr(owner)) return owner
  const op = pickResolved(state.revOperator, { resolvedAddress: state.revOperatorResolved })
  return isAddr(op) ? op : ''
}

/** One JBSplitConfig from a recipient row (port of the website's splitState). */
function splitState(
  state: CreateFlowState,
  rec: RecipientRow,
  rawPercent: number,
  beneficiaryOverride: string | undefined,
  chainId: number,
  projectIdOverride: number | undefined,
  allowLock: boolean,
): JBSplitConfig {
  // lockedUntil only encodes when the stage actually allows locks — a stale
  // value from a draft/import must NOT reach the chain.
  const lockTs = allowLock && rec.lockedUntil ? Number(rec.lockedUntil) : 0
  // "Fund market" reserved split → routes to the shared JBP6FeeLPSplitHook. The
  // hook keys off the distributing project; beneficiary is pass-through.
  if (rec.type === 'lphook' && LP_SPLIT_HOOK_CHAINS.has(chainId)) {
    return {
      preferAddToBalance: false,
      percent: rawPercent,
      projectId: 0,
      beneficiary: addrOrZero(lpFallbackBeneficiary(state)),
      lockedUntil: lockTs,
      hook: JBP6_FEE_LP_SPLIT_HOOK,
    }
  }
  const addr = beneficiaryOverride != null ? beneficiaryOverride : pickResolved(rec.address, rec)
  const pid = rec.type === 'project' || rec.type === 'customhook'
    ? (projectIdOverride != null ? projectIdOverride : Number(rec.projectId) || 0)
    : 0
  const hook = rec.type === 'customhook' && isAddr(rec.hookAddress) ? rec.hookAddress! : ZERO_ADDRESS
  return {
    preferAddToBalance: rec.type === 'project' && !!rec.preferAddToBalance,
    percent: rawPercent,
    projectId: pid,
    beneficiary: addrOrZero(addr),
    lockedUntil: lockTs,
    hook,
  }
}

// ---------------------------------------------------------------------------
// Ruleset assembly (port of assembleRuleset + launch-component's
// buildRulesetConfigs conversions, emitting the target JBRulesetConfig)
// ---------------------------------------------------------------------------

function clampPct(v: unknown): number {
  return Math.max(0, Math.min(100, Number(v) || 0))
}

function assembleRuleset(
  state: CreateFlowState,
  stage: StageState,
  userStageIdx: number,
  chainId: number,
  isFirst: boolean,
  deadlineOn: boolean,
  immediateStart: number,
): JBRulesetConfig {
  const lockOk = splitLockAllowed(stage)
  const custom = stage.tokenMode === 'custom'

  // Reserved rate = sum of the split-row percentages (each is a % of issuance).
  const reservedTotalPct = (stage.reservedRecipients || []).reduce((s, x) => s + (Number(x.percent) || 0), 0)

  // Per-chain override accessors, keyed by user-stage + recipient index.
  const payoutBenef = (x: RecipientRow, idx: number) =>
    chainAddr(state, chainId, `p:${userStageIdx}:${idx}`, pickResolved(x.address, x))
  const reservedBenef = (x: RecipientRow, idx: number) =>
    chainAddr(state, chainId, `r:${userStageIdx}:${idx}`, pickResolved(x.address, x))
  const projAt = (x: RecipientRow, key: string) =>
    x.type === 'project' || x.type === 'customhook' ? chainProjectId(state, chainId, key, Number(x.projectId) || 0) : 0
  const payoutPid = (x: RecipientRow, idx: number) => projAt(x, `ppid:${userStageIdx}:${idx}`)
  const reservedPid = (x: RecipientRow, idx: number) => projAt(x, `rpid:${userStageIdx}:${idx}`)

  // Multi-token: payouts per accepted token. There's surplus unless EVERY
  // accepted token pays out everything (all unlimited).
  const pkAll = currentPayoutKinds(state)
  const allKindsUnlimited = pkAll
    ? pkAll.every((k) => (stage.payoutByKind?.[k.key] || { mode: 'none' }).mode === 'unlimited')
    : false
  const noSurplus = pkAll ? allKindsUnlimited : stage.payoutMode === 'unlimited'

  // Item redemptions route cash outs through the 721 hook — only when a store
  // is actually on this chain AND the project opted in.
  const storeRedeem = state.shopEnabled
    && !!state.collection?.useForRedemptions
    && (state.nfts || []).some((_, i) => chainItemIncluded(state, chainId, i))

  // The cash out tax governs whoever can cash out — token holders OR item
  // holders. 100% = cash outs off (also forced when payouts leave no surplus).
  const cashOutPct = (stage.cashOutEnabled || storeRedeem) && !noSurplus ? clampPct(stage.cashOutTaxRate) : 100

  // Approval hook per deadline (chain-invariant JBDeadline contracts; custom
  // supports a per-chain override).
  let approvalHook: string = ZERO_ADDRESS
  if (deadlineOn) {
    if (stage.deadline === 'custom') {
      approvalHook = addrOrZero(
        chainAddr(state, chainId, 'approval', pickResolved(state.approvalAddress, { resolvedAddress: state.approvalResolved })),
      )
    } else {
      approvalHook = DEADLINE_HOOKS[stage.deadline] || ZERO_ADDRESS // 'none' → ZERO
    }
  }

  // --- Splits + fund access ---
  const splitGroups: JBSplitGroupConfig[] = []
  const fundAccessLimitGroups: JBFundAccessLimitGroupConfig[] = []

  const pushSplitGroup = (groupId: string, splits: JBSplitConfig[]) => {
    const kept = splits.filter((s) => s.percent > 0)
    if (kept.length) splitGroups.push({ groupId, splits: kept })
  }

  if (pkAll) {
    // MULTI-TOKEN: one payout split group + one fund-access group per
    // accounting context, each denominated in that token's own
    // currency/decimals (USDC = 6 decimals). Surplus allowance (when on) is
    // unlimited per token.
    const benefK = (x: RecipientRow, kindKey: string, idx: number) =>
      chainAddr(state, chainId, `pk:${kindKey}:${idx}`, pickResolved(x.address, x))
    const pidK = (x: RecipientRow, kindKey: string, idx: number) => projAt(x, `pkpid:${kindKey}:${idx}`)
    pkAll.forEach((kind) => {
      const pk = stage.payoutByKind?.[kind.key] || { mode: 'none' as const, recipients: [] }
      const token = kind.addrForChain(chainId)
      if (!token) return
      const cur = uint32Currency(token)
      const payoutLimits: JBCurrencyAmountConfig[] = []
      const surplusAllowances: JBCurrencyAmountConfig[] = []
      let splits: JBSplitConfig[] = []
      if (pk.mode === 'unlimited') {
        payoutLimits.push({ amount: UINT224_MAX.toString(), currency: cur })
        let pacc = 0
        splits = (pk.recipients || []).map((x, idx) => {
          let raw = Math.round(((Number(x.percent) || 0) / 100) * SPLITS_TOTAL)
          if (pacc + raw > SPLITS_TOTAL) raw = Math.max(0, SPLITS_TOTAL - pacc)
          pacc += raw
          return splitState(state, x, raw, benefK(x, kind.key, idx), chainId, pidK(x, kind.key, idx), lockOk)
        })
      } else if (pk.mode === 'limited') {
        const limitedRows = (pk.recipients || [])
          .map((x, idx) => ({ x, idx, amount: priceUnits(x.amountEth, kind.decimals) }))
          .filter((row) => row.amount > 0n)
        const totalAmt = limitedRows.reduce((s, row) => s + row.amount, 0n)
        if (totalAmt > 0n) payoutLimits.push({ amount: totalAmt.toString(), currency: cur })
        const lshares = splitSharesFromAmounts(limitedRows.map((row) => row.amount))
        splits = limitedRows.map((row, shareIdx) =>
          splitState(state, row.x, lshares[shareIdx], benefK(row.x, kind.key, row.idx), chainId, pidK(row.x, kind.key, row.idx), lockOk),
        )
      }
      if (stage.surplusAllowanceOn && pk.mode !== 'unlimited') {
        surplusAllowances.push({ amount: UINT224_MAX.toString(), currency: cur })
      }
      pushSplitGroup(uint256FromAddress(token), splits)
      if (payoutLimits.length || surplusAllowances.length) {
        fundAccessLimitGroups.push({ terminal: JB_CONTRACTS.JBMultiTerminal, token, payoutLimits, surplusAllowances })
      }
    })
  } else if (
    // Source condition: payoutMode !== 'none' || (surplusAllowanceOn && payoutMode !== 'unlimited').
    // With payoutMode === 'none' the second clause reduces to surplusAllowanceOn.
    stage.payoutMode !== 'none' || stage.surplusAllowanceOn
  ) {
    // SINGLE-TOKEN: one accounting token chosen at Settlement. Amounts are
    // denominated in the accounting token itself (token-keyed currency +
    // token decimals) — see the header note on the ETH/USD-currency deviation.
    const acct = acctTokenFor(state, chainId)
    if (stage.payoutMode !== 'none' && stage.payoutRecipients.length) {
      let payoutSplits: JBSplitConfig[]
      if (stage.payoutMode === 'unlimited') {
        let pacc = 0
        payoutSplits = stage.payoutRecipients.map((x, idx) => {
          let raw = Math.round(((Number(x.percent) || 0) / 100) * SPLITS_TOTAL)
          if (pacc + raw > SPLITS_TOTAL) raw = Math.max(0, SPLITS_TOTAL - pacc)
          pacc += raw
          return splitState(state, x, raw, payoutBenef(x, idx), chainId, payoutPid(x, idx), lockOk)
        })
      } else {
        const limitedRows = stage.payoutRecipients
          .map((x, idx) => ({ x, idx, amount: priceUnits(chainPayoutAmount(state, chainId, userStageIdx, idx), acct.decimals) }))
          .filter((row) => row.amount > 0n)
        const lshares = splitSharesFromAmounts(limitedRows.map((row) => row.amount))
        payoutSplits = limitedRows.map((row, shareIdx) =>
          splitState(state, row.x, lshares[shareIdx], payoutBenef(row.x, row.idx), chainId, payoutPid(row.x, row.idx), lockOk),
        )
      }
      pushSplitGroup(uint256FromAddress(acct.token), payoutSplits)
    }
    // Limits denominate in the accounting token's own currency, or USD (2)
    // via JBPrices when the stage picked USD — USD amounts carry 18 decimals.
    const USD = 2
    const payoutCur = stage.payoutCurrency === USD ? USD : acct.currency
    const payoutDecimals = stage.payoutCurrency === USD ? 18 : acct.decimals
    const payoutLimits: JBCurrencyAmountConfig[] = []
    if (stage.payoutMode === 'unlimited') {
      payoutLimits.push({ amount: UINT224_MAX.toString(), currency: payoutCur })
    } else if (stage.payoutMode === 'limited') {
      const total = stage.payoutRecipients.reduce(
        (s, _x, idx) => s + priceUnits(chainPayoutAmount(state, chainId, userStageIdx, idx), payoutDecimals),
        0n,
      )
      if (total > 0n) payoutLimits.push({ amount: total.toString(), currency: payoutCur })
    }
    const saCur = stage.surplusAllowanceCurrency === USD ? USD : acct.currency
    const saDecimals = stage.surplusAllowanceCurrency === USD ? 18 : acct.decimals
    const surplusAllowances: JBCurrencyAmountConfig[] = []
    if (stage.surplusAllowanceOn && stage.payoutMode !== 'unlimited') {
      if (stage.surplusAllowanceUnlimited) {
        surplusAllowances.push({ amount: UINT224_MAX.toString(), currency: saCur })
      } else {
        const saAmt = priceUnits(stage.surplusAllowanceAmount, saDecimals)
        if (saAmt > 0n) surplusAllowances.push({ amount: saAmt.toString(), currency: saCur })
      }
    }
    if (payoutLimits.length || surplusAllowances.length) {
      fundAccessLimitGroups.push({ terminal: JB_CONTRACTS.JBMultiTerminal, token: acct.token, payoutLimits, surplusAllowances })
    }
  }

  // Reserved-token splits (group 1) — token-agnostic. Rows are % of ISSUANCE;
  // the group encodes each as its share of the RESERVED POOL (row% ÷ total%),
  // remainder-balanced to exactly 1e9.
  if (custom && reservedTotalPct > 0) {
    const rrows = stage.reservedRecipients
      .map((x, origIdx) => ({ x, origIdx }))
      .filter((e) => (Number(e.x.percent) || 0) > 0)
    const rshares = fillSplits(rrows.map((e) => Math.round(((Number(e.x.percent) || 0) / reservedTotalPct) * SPLITS_TOTAL)))
    pushSplitGroup(
      '1',
      rrows.map((e, k) => splitState(state, e.x, rshares[k], reservedBenef(e.x, e.origIdx), chainId, reservedPid(e.x, e.origIdx), lockOk)),
    )
  }

  return {
    // First ruleset: scheduled time if set; else the shared multichain
    // immediateStart (0 on single chain). Later stages queue with 0 so the
    // controller chains them after the previous stage's duration.
    mustStartAtOrAfter: isFirst ? (stage.schedule ? Number(stage.schedule) : immediateStart || 0) : 0,
    duration: Number(stage.durationSeconds) || 0,
    weight: (custom ? tokenAmount18(stage.weight, UINT112_MAX) : 0n).toString(),
    weightCutPercent: custom ? Math.round(clampPct(stage.weightCutPercent) * 10_000_000) : 0,
    approvalHook,
    metadata: {
      reservedPercent: custom ? Math.round(clampPct(reservedTotalPct) * 100) : 0,
      cashOutTaxRate: Math.round(cashOutPct * 100),
      baseCurrency: stage.baseCurrency || 1,
      pausePay: !!stage.pausePay,
      pauseCreditTransfers: !!stage.pauseTransfers,
      allowOwnerMinting: !!stage.allowOwnerMinting,
      allowSetCustomToken: !!stage.allowSetCustomToken,
      allowTerminalMigration: !!stage.allowTerminalMigration,
      allowSetTerminals: !!stage.allowSetTerminals,
      allowSetController: !!stage.allowSetController,
      allowAddAccountingContext: !!stage.allowAddAccountingContext,
      allowAddPriceFeed: !!stage.allowAddPriceFeed,
      ownerMustSendPayouts: !!stage.ownerMustSendPayouts,
      holdFees: !!stage.holdFees,
      scopeCashOutsToLocalBalances: !!stage.useTotalSurplusForCashOuts,
      // Like the website: the flag is set with a zero dataHook — the omnichain
      // deployer's 721 wrapper wires the hook itself at deploy (the encoder
      // permits this on the atomic-721 path).
      useDataHookForPay: false,
      useDataHookForCashOut: storeRedeem,
      dataHook: ZERO_ADDRESS,
      metadata: Number(stage.metadataExtra) || 0,
    },
    splitGroups,
    fundAccessLimitGroups,
  }
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/** All rulesets for launch (standby/afterMode applied), chain-specific. */
export function buildRulesetConfigsForChain(state: CreateFlowState, chainId: number, immediateStart: number): JBRulesetConfig[] {
  // Multichain "start immediately" → pin every chain's first ruleset to the
  // one shared deploy-time start so they all begin at the same moment. Single
  // chain starts at its own deploy block (0).
  const start = state.chainIds.length > 1 ? immediateStart : 0
  const effectiveStages = resolveStages(state)
  const deadlineOn = deadlineApplies(state)
  return effectiveStages.map((s, i) => {
    // The appended standby/terminal stage inherits the last user stage's overrides.
    const userIdx = Math.min(i, state.stages.length - 1)
    return assembleRuleset(state, s, userIdx, chainId, i === 0, deadlineOn, start)
  })
}

/**
 * Terminal configs for a chain honoring accepts (eth/usdc/custom) + the
 * router-terminal (any-token auto-swap) toggle. Currency is always
 * uint32(uint160(token)).
 */
export function buildTerminalConfigsForChain(state: CreateFlowState, chainId: number): JBTerminalConfig[] {
  const accepts = state.accepts || []
  const contexts: JBTerminalConfig['accountingContextsToAccept'] = []
  // Custom ERC-20 accounting token (same address on every chain; its own currency id, no feed).
  if (customAccounting(state) && isAddr(state.customToken.address)) {
    contexts.push({ token: state.customToken.address, decimals: customAcctDecimals(state), currency: customCurrencyId(state) })
  }
  if (accepts.includes('eth')) {
    contexts.push({ token: NATIVE_TOKEN, decimals: 18, currency: uint32Currency(NATIVE_TOKEN) })
  }
  if (accepts.includes('usdc') && CANONICAL_USDC_BY_CHAIN[chainId]) {
    const usdc = CANONICAL_USDC_BY_CHAIN[chainId]
    contexts.push({ token: usdc, decimals: 6, currency: uint32Currency(usdc) })
  }
  if (!contexts.length) contexts.push({ token: NATIVE_TOKEN, decimals: 18, currency: uint32Currency(NATIVE_TOKEN) })
  const configs: JBTerminalConfig[] = [{ terminal: JB_CONTRACTS.JBMultiTerminal, accountingContextsToAccept: contexts }]
  if (state.swapRouter) {
    configs.push({ terminal: JB_ROUTER_TERMINAL_REGISTRY, accountingContextsToAccept: [] })
  }
  return configs
}

/** Original-nft-index per sorted-tier position (categories ascending, stable). */
function tierOrderIndexes(state: CreateFlowState): number[] {
  return state.nfts
    .map((nft, idx) => ({ cat: Number(nft.category) || 0, idx }))
    .sort((a, b) => a.cat - b.cat) // Array.prototype.sort is stable
    .map((e) => e.idx)
}

function clampTierInitialSupply(value: string | undefined, unlimited: boolean): number {
  if (unlimited) return TIER_UNLIMITED_SUPPLY
  const raw = String(value == null ? '' : value).trim()
  if (!/^\d+$/.test(raw)) throw new Error('Item supply must be a whole number.')
  const n = Number(raw)
  if (n <= 0 || n > TIER_UNLIMITED_SUPPLY) throw new Error(`Item supply must be between 1 and ${TIER_UNLIMITED_SUPPLY}.`)
  return n
}

/**
 * Per-chain overrides array for chainIds: per-chain terminal configs (USDC
 * addresses differ per chain) + optional per-chain tier include/supply.
 *
 * `tiers` must be the default tiers built by buildDeployTiersConfigFromState
 * from the SAME state (positions map back to state.nfts via the shared
 * category sort). `immediateStart` is accepted for signature parity — the
 * ChainConfigOverride shape has no ruleset fields, so start alignment rides
 * on buildRulesetConfigsForChain instead.
 */
export function buildChainConfigOverrides(
  state: CreateFlowState,
  chainIds: number[],
  immediateStart: number,
  tiers?: JB721TierConfig[],
): ChainConfigOverride[] {
  void immediateStart
  const order = tiers && tiers.length ? tierOrderIndexes(state) : []
  return chainIds.map((chainId) => {
    const override: ChainConfigOverride = {
      chainId,
      terminalConfigurations: buildTerminalConfigsForChain(state, chainId),
    }
    if (tiers && tiers.length) {
      override.tiers = tiers
        .map((tier, pos) => ({ tier, orig: order[pos] }))
        .filter(({ orig }) => orig == null || chainItemIncluded(state, chainId, orig))
        .map(({ tier, orig }) => {
          if (orig == null) return tier
          const nft = state.nfts[orig]
          const out: JB721TierConfig = { ...tier }
          // Per-chain supply override ('isupply:<idx>'); only meaningful when set.
          const supplyOv = pcGet(state, chainId, 'num', `isupply:${orig}`)
          if (supplyOv != null) out.initialSupply = clampTierInitialSupply(supplyOv, false)
          // Per-chain reserve beneficiary ('rb:<idx>').
          if (nft && tier.reserveFrequency > 0) {
            const rbOv = pcGet(state, chainId, 'addr', `rb:${orig}`)
            if (rbOv != null) {
              const rb = addrOrZero(resolvedStr(rbOv))
              out.reserveBeneficiary = rb
              out.useReserveBeneficiaryAsDefault = rb !== ZERO_ADDRESS
            }
          }
          return out
        })
    }
    return override
  })
}

/** The store's pricing currency (standard JBCurrencyIds — or the custom token's own id). */
function storeCur(state: CreateFlowState): number {
  return customAccounting(state) ? customCurrencyId(state) : state.storePricingCurrency || 1
}

function storeDecimals(state: CreateFlowState): number {
  return customAccounting(state) ? customAcctDecimals(state) : (state.storePricingCurrency || 1) === 2 ? 6 : 18
}

function storeCategoryName(state: CreateFlowState, category: number): string {
  const id = Number(category) || 0
  const found = (state.storeCategories || []).find((entry) => Number(entry.id) === id)
  return (found && String(found.name || '').trim()) || ''
}

/** Discount % (0-100) → protocol units out of 200. */
function tierDiscountPercentFromPct(value: string): number {
  if (value == null || String(value).trim() === '') return 0
  const pct = Number(value)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('Discount must be between 0 and 100%.')
  return Math.round(pct * 2)
}

/** Item revenue splits (splitPercent out of 1e9 + rows renormalized within it). */
function itemSplits(nft: ItemState): { splitPercent: number; splits: NonNullable<JB721TierConfig['splits']> } {
  if (!nft.splitOn) return { splitPercent: 0, splits: [] }
  const rows = nft.splitRecipients
    .map((r, i) => ({ r, i }))
    .filter((e) => Number(e.r.pct) > 0 && (e.r.recip || '').trim())
  const tot = rows.reduce((s, e) => s + Number(e.r.pct), 0)
  if (!tot) return { splitPercent: 0, splits: [] }
  const splits = rows.map((e) => {
    const v = (e.r.recip || '').trim()
    const isProj = /^[0-9]+$/.test(v) && Number(v) > 0
    const benef = resolvedStr((e.r.benef || '').trim())
    return {
      percent: Math.round((Number(e.r.pct) / tot) * SPLITS_TOTAL),
      projectId: isProj ? Number(v) : 0,
      beneficiary: isProj ? (isAddr(benef) ? benef : ZERO_ADDRESS) : addrOrZero(resolvedStr(v)),
      preferAddToBalance: false,
      lockedUntil: 0,
      hook: ZERO_ADDRESS,
    }
  })
  return { splitPercent: Math.round((tot / 100) * SPLITS_TOTAL), splits }
}

/**
 * 721 deploy config from state.nfts + state.collection + storeCategories.
 * Pins each item's metadata JSON (name + already-pinned media) so its tier
 * resolves to {name, image} — async. Returns undefined when the shop is off
 * or empty. The default config includes EVERY item; per-chain include/supply
 * filtering happens in buildChainConfigOverrides.
 */
export async function buildDeployTiersConfigFromState(state: CreateFlowState): Promise<JBDeployTiersHookConfig | undefined> {
  if (!state.shopEnabled || !state.nfts.length) return undefined
  const col = state.collection
  const priceDecimals = storeDecimals(state)

  const entries: { tier: JB721TierConfig; order: number }[] = []
  for (let n = 0; n < state.nfts.length; n++) {
    const nft = state.nfts[n]

    // Pin metadata (skip when a previous submit already pinned this item).
    let encoded = nft.encodedIpfsUri
    if (!encoded) {
      const meta: Record<string, unknown> = { name: nft.name || `Item #${n + 1}` }
      if (nft.description) meta.description = nft.description
      const categoryName = storeCategoryName(state, nft.category)
      if (categoryName) meta.categoryName = categoryName
      if (nft.imageUri) {
        if ((nft.mediaType || '').indexOf('image') === 0) meta.image = nft.imageUri
        else meta.animation_url = nft.imageUri
        meta.mediaType = nft.mediaType
      }
      let metaUri: string
      try {
        metaUri = await pinMetadata(meta, `${nft.name || 'item'}-item`)
      } catch (e) {
        throw new Error(`Could not pin metadata for "${nft.name || `Item #${n + 1}`}": ${e instanceof Error ? e.message : e}`)
      }
      const enc = encodeIpfsUri(metaUri)
      if (!enc) throw new Error(`Could not encode metadata for "${nft.name || `Item #${n + 1}`}"`)
      encoded = enc
    }

    const price = priceUnits(nft.price, priceDecimals)
    if (price > UINT104_MAX) throw new Error('Item price is too large (max uint104).')
    const flags = nft.flags || {}
    const freq = nft.reserveOn ? Number(nft.reserveFrequency) || 0 : 0
    const reserveBenef = freq > 0 ? addrOrZero(resolvedStr(nft.reserveBeneficiary)) : ZERO_ADDRESS
    const votes = nft.votingOn ? Number(nft.votingUnits) || 0 : 0
    const sp = itemSplits(nft)
    const chainSupply = nft.limited ? nft.supply : ''
    const limited = chainSupply !== '' && chainSupply != null

    entries.push({
      order: n,
      tier: {
        price: price.toString(),
        initialSupply: clampTierInitialSupply(chainSupply, !limited),
        votingUnits: votes,
        reserveFrequency: freq,
        reserveBeneficiary: reserveBenef,
        encodedIPFSUri: encoded,
        category: Number(nft.category) || 0,
        discountPercent: nft.discountOn ? tierDiscountPercentFromPct(nft.discountPct) : 0,
        allowOwnerMint: !!flags.allowOwnerMint,
        useReserveBeneficiaryAsDefault: freq > 0 && reserveBenef !== ZERO_ADDRESS,
        transfersPausable: !!flags.transfersPausable,
        useVotingUnits: votes > 0,
        cannotBeRemoved: !!flags.cantBeRemoved,
        cannotIncreaseDiscountPercent: !(flags.ownerCanEditDiscount !== false),
        cannotBuyWithCredits: !(flags.allowCredits !== false),
        splitPercent: sp.splitPercent,
        splits: sp.splits,
      },
    })
  }

  // The store requires ascending categories; stable sort keeps item order
  // within a category (must match tierOrderIndexes exactly).
  entries.sort((a, b) => (a.tier.category - b.tier.category) || (a.order - b.order))

  return {
    name: col.nameTouched ? col.name : state.details.name || '',
    symbol: col.symbolTouched ? col.symbol : state.details.ticker || '',
    baseUri: 'ipfs://',
    tokenUriResolver: ZERO_ADDRESS,
    contractUri: '', // the website passes the project URI; the caller pins it separately here
    tiersConfig: {
      tiers: entries.map((e) => e.tier),
      currency: storeCur(state),
      decimals: priceDecimals,
    },
    flags: {
      noNewTiersWithReserves: !!col.noNewTiersWithReserves,
      noNewTiersWithVotes: !!col.noNewTiersWithVotes,
      noNewTiersWithOwnerMinting: !!col.noNewTiersWithOwnerMinting,
      preventOverspending: !!col.preventOverspending,
      issueTokensForSplits: !!col.issueTokensForSplits,
    },
    useDataHookForCashOut: !!col.useForRedemptions,
  }
}

// ---------------------------------------------------------------------------
// Revnet stages
// ---------------------------------------------------------------------------

export interface REVAutoIssuanceConfig {
  chainId: number
  count: string
  beneficiary: string
}

/**
 * REVStageConfig plus the split/auto-issuance rows REVDeployer.deployFor
 * takes on-chain. NOTE: the current relayr encoder synthesizes a single
 * operator split from splitPercent and drops autoIssuances — these extra
 * fields are carried so the launch plumbing can adopt them without a builder
 * change.
 */
export interface REVStageConfigFull extends REVStageConfig {
  splits: JBSplitConfig[]
  autoIssuances: REVAutoIssuanceConfig[]
}

function revSplitTotalPct(stage: StageState): number {
  return (stage.reservedRecipients || []).reduce((s, x) => s + (Number(x.percent) || 0), 0)
}

/** The previous stage's autocut interval in days (0 if none) — the cycle boundary the next stage snaps to. */
function revPrevCutFreqDays(state: CreateFlowState, idx: number): number {
  const prev = state.stages[idx - 1]
  return prev && prev.issuanceCutOn && Number(prev.cutFreqDays) > 0 ? Math.max(1, Math.round(Number(prev.cutFreqDays))) : 0
}

/** Stage idx's "days after the previous stage", snapped to a positive multiple of the previous cut interval. */
function revStageDaysAfter(state: CreateFlowState, idx: number): number {
  const freq = revPrevCutFreqDays(state, idx)
  let d = Math.max(1, Math.round(Number(state.stages[idx].startDaysAfter) || 30))
  if (freq > 0) d = Math.max(freq, Math.round(d / freq) * freq)
  return d
}

/**
 * Revnet stage configs from the ported StageState[]: weight '' on later
 * stages → initialIssuance '0' (inherit, with cut), cut percent ×1e7 and
 * frequency days×86400, split rows ×1e7 renormalized to the reserved pool,
 * auto-issuances (count 18-dec, per-chain beneficiary override), start times
 * cumulative from baseStart (stage 1 honors a scheduled start).
 *
 * `chainId` scopes per-chain overrides + autoIssuances (defaults to the first
 * selected chain).
 */
export function buildRevnetStageConfigs(state: CreateFlowState, baseStart: number, chainId?: number): REVStageConfigFull[] {
  const cid = chainId ?? state.chainIds[0] ?? 1
  let prevStart = baseStart
  return state.stages.map((stage, idx) => {
    let start: number
    if (idx === 0) {
      start = stage.scheduleOn && stage.schedule ? Number(stage.schedule) : baseStart
    } else {
      // A queued next stage only takes effect on a cycle boundary — snap it
      // to a positive multiple of the previous stage's cut interval.
      start = prevStart + revStageDaysAfter(state, idx) * 86400
    }
    prevStart = start

    const totalPct = revSplitTotalPct(stage) // 0..100 across split rows
    const splitPercent = Math.round(Math.min(100, totalPct) * 100) // → out of MAX_RESERVED_PERCENT (10000)
    let splits: JBSplitConfig[] = []
    if (totalPct > 0) {
      const rows = (stage.reservedRecipients || [])
        .map((x, origIdx) => ({ x, origIdx }))
        .filter((e) => (Number(e.x.percent) || 0) > 0)
      // Each split's share of the reserved bucket is its row% ÷ total%,
      // remainder-balanced to exactly 1e9.
      const shares = fillSplits(rows.map((e) => Math.round(((Number(e.x.percent) || 0) / totalPct) * SPLITS_TOTAL)))
      splits = rows.map((e, k) => {
        const benef = chainAddr(state, cid, `r:${idx}:${e.origIdx}`, pickResolved(e.x.address, e.x))
        const pid = e.x.type === 'project' || e.x.type === 'customhook'
          ? chainProjectId(state, cid, `rpid:${idx}:${e.origIdx}`, Number(e.x.projectId) || 0)
          : 0
        return splitState(state, e.x, shares[k], benef, cid, pid, false) // revnet stages never lock splits
      })
    }

    // initialIssuance: tokens per base unit × 1e18. 0 on later stages = inherit (with cut).
    const issuance = idx === 0 || stage.weight ? tokenAmount18(stage.weight, UINT112_MAX) : 0n
    const cutFreq = stage.issuanceCutOn ? Math.max(0, Math.round((Number(stage.cutFreqDays) || 0) * 86400)) : 0
    const cutPercent = stage.issuanceCutOn ? Math.round(clampPct(stage.weightCutPercent) * 10_000_000) : 0
    const taxRate = Math.round(clampPct(stage.cashOutTaxRate) * 100) // percent → out of 10000

    const autoIssuances = (stage.autoIssuances || [])
      .map((a, aiIdx) => ({
        count: tokenAmount18(a.count, UINT104_MAX),
        addr: chainAddr(state, cid, `ai:${idx}:${aiIdx}`, pickResolved(a.address, a)),
      }))
      .filter((a) => a.count > 0n && isAddr(a.addr))
      .map((a) => ({ chainId: cid, count: a.count.toString(), beneficiary: a.addr }))

    return {
      startsAtOrAfter: start,
      autoIssuances,
      splitPercent,
      splits,
      initialIssuance: issuance.toString(),
      issuanceCutFrequency: cutFreq,
      issuanceCutPercent: cutPercent,
      cashOutTaxRate: taxRate,
      extraMetadata: 0,
    }
  })
}
