/**
 * "Copy this project" — reconstruct a live project's configuration into a
 * create-flow draft (.jb) the wizard can import and edit.
 *
 * Port of website/src/discover.js buildProjectCreateDraft and its helpers
 * (draftStageFromLive, draftPayoutState, draftRecipientFromSplit,
 * applyDraftDetails, applyDraftFunds, applyDraftAccountingAndTerminals).
 * Transaction-critical values come from contracts; Bendystraw-first project
 * metadata is used only for display fields.
 *
 * The exporter REFUSES (throws) whenever the live configuration contains
 * something the create wizard cannot faithfully reproduce — never silently
 * drop configuration into a lossy draft. Deliberate gaps vs the website
 * exporter, each of which throws or warns instead of guessing:
 *   - onchain shops (721 data hooks) are not reconstructed yet → throws;
 *   - cross-chain configuration equality is not fingerprint-verified → the
 *     draft carries an explicit warning naming the source chain;
 *   - active bridge topology is not re-verified → draft keeps the default
 *     sucker setting and warns.
 */

import { erc20Abi, formatEther, formatUnits, zeroAddress } from 'viem'
import { tokenCurrencyId as sdkTokenCurrencyId } from '@bananapus/nana-sdk-core/v6'
import {
  createStage,
  initState,
  type CreateFlowState,
  type RecipientRow,
  type StageState,
} from '../components/dynamic/create-flow/state'
import { DEADLINE_HOOKS } from '../components/dynamic/create-flow/builders'
import {
  CHAINS,
  JB_CONTRACTS,
  JB_ROUTER_TERMINAL,
  JB_ROUTER_TERMINAL_REGISTRY,
  NATIVE_TOKEN,
  REV_OWNER,
  USDC_ADDRESSES,
  type SupportedChainId,
} from '../constants'
import {
  fetchConnectedChains,
  fetchProjectSplits,
  fetchProjectWithRuleset,
  fetchRevnetOperator,
  type ProjectMetadata,
} from './bendystraw'
import { publicClientFor } from './projectTx'

// ---------------------------------------------------------------------------
// Input model (pure — the fetch wrapper below fills it from live reads)
// ---------------------------------------------------------------------------

export interface DraftRulesetMetadata {
  reservedPercent: number
  cashOutTaxRate: number
  baseCurrency: number
  pausePay: boolean
  pauseCreditTransfers: boolean
  allowOwnerMinting: boolean
  allowSetCustomToken: boolean
  allowTerminalMigration: boolean
  allowSetTerminals: boolean
  allowSetController: boolean
  allowAddAccountingContext: boolean
  allowAddPriceFeed: boolean
  ownerMustSendPayouts: boolean
  holdFees: boolean
  scopeCashOutsToLocalBalances: boolean
  useDataHookForPay: boolean
  useDataHookForCashOut: boolean
  dataHook: string
  metadata: number
}

export interface DraftRuleset {
  id: string
  duration: number
  /** Raw uint112 weight (tokens per unit, 1e18 fixed point) as a string. */
  weight: string
  weightCutPercent: number
  approvalHook: string
  metadata: DraftRulesetMetadata
}

export interface DraftAccountingContext {
  token: string
  decimals: number
  currency: number
  /** ERC-20 symbol — only needed for custom accounting tokens. */
  symbol?: string
}

export interface DraftSplit {
  percent: number
  projectId: number
  beneficiary: string
  preferAddToBalance: boolean
  lockedUntil: number
  hook: string
}

export interface DraftCurrencyAmount {
  amount: string
  currency: number
}

export interface DraftFundsSnapshot {
  reservedSplits: DraftSplit[]
  /** Payout split group per accounting token (lower-cased token address key). */
  payoutSplitsByToken: Record<string, DraftSplit[]>
  fundAccessByToken: Record<string, {
    payoutLimits: DraftCurrencyAmount[]
    surplusAllowances: DraftCurrencyAmount[]
  }>
}

export interface DraftStageSource {
  ruleset: DraftRuleset
  funds: DraftFundsSnapshot
}

export interface DraftProjectInput {
  projectId: number
  /** The chain the live state was read from. */
  chainId: number
  /** Every chain the project exists on (drives draft.chainIds). */
  chainIds: number[]
  isRevnet: boolean
  /** Project owner — for revnets, the revnet operator. */
  owner: string
  metadata: ProjectMetadata
  tokenSymbol?: string
  contexts: DraftAccountingContext[]
  usesRouterTerminalRegistry: boolean
  current: DraftStageSource
  /** Distinct queued upcoming ruleset (custom projects only). */
  upcoming?: DraftStageSource | null
}

export interface ProjectDraftResult {
  state: CreateFlowState
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Shared constants + tiny helpers
// ---------------------------------------------------------------------------

const SPLITS_TOTAL = 1_000_000_000 // JBConstants.SPLITS_TOTAL_PERCENT
const UNLIMITED = (1n << 224n) - 1n // uint224 max — the unlimited sentinel
const USD_CURRENCY = 2
const TESTNET_IDS = [11155111, 11155420, 84532, 421614]

function isZeroish(address: string | undefined | null): boolean {
  return !address || /^0x0{40}$/i.test(address)
}

function sameAddr(a: string | undefined | null, b: string | undefined | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

/** V6 accounting-context currency id: uint32(uint160(token)). */
function tokenCurrencyId(token: string): number {
  return sdkTokenCurrencyId(token as `0x${string}`)
}

/** Limits priced in USD carry 18 decimals; otherwise the token's own. */
function amountDecimals(currency: number, contextDecimals: number): number {
  return currency === USD_CURRENCY ? 18 : contextDecimals
}

type ContextKind = 'eth' | 'usdc' | 'custom'

function contextKind(token: string, chainId: number): ContextKind {
  if (sameAddr(token, NATIVE_TOKEN)) return 'eth'
  const usdc = USDC_ADDRESSES[chainId as SupportedChainId]
  if (usdc && sameAddr(token, usdc)) return 'usdc'
  return 'custom'
}

function chainLabel(chainId: number): string {
  return CHAINS[chainId]?.name || `Chain ${chainId}`
}

/** Map a live approval hook onto the wizard's deadline keys. */
export function deadlineFor(approvalHook: string | undefined): { key: StageState['deadline']; address: string } {
  if (isZeroish(approvalHook)) return { key: 'none', address: '' }
  for (const [key, hook] of Object.entries(DEADLINE_HOOKS)) {
    if (sameAddr(hook, approvalHook)) return { key: key as StageState['deadline'], address: '' }
  }
  return { key: 'custom', address: approvalHook as string }
}

function recipientFromSplit(split: DraftSplit, percent: number, amount: string): RecipientRow {
  if (!Number.isSafeInteger(split.projectId)) throw new Error('A split project ID is too large for the .jb editor.')
  const base = {
    percent: Number(percent || 0),
    amountEth: amount || '',
    lockedUntil: Number(split.lockedUntil || 0),
    preferAddToBalance: !!split.preferAddToBalance,
    projectId: split.projectId,
  }
  if (!isZeroish(split.hook)) {
    return { ...base, type: 'customhook', hookAddress: split.hook, address: split.beneficiary || zeroAddress }
  }
  if (split.projectId > 0) return { ...base, type: 'project', address: split.beneficiary || zeroAddress }
  return { ...base, type: 'wallet', address: split.beneficiary || zeroAddress }
}

// ---------------------------------------------------------------------------
// Stage reconstruction (ports of draftStageFromLive / draftPayoutState)
// ---------------------------------------------------------------------------

function stageFromLive(source: DraftRuleset): { stage: StageState; customApproval: string } {
  const stage = createStage()
  const m = source.metadata
  stage.expanded = true
  stage.durationSeconds = Number(source.duration || 0)
  const weight = BigInt(source.weight || 0)
  stage.tokenMode = weight > 0n ? 'custom' : 'none'
  stage.weight = weight > 0n ? formatEther(weight) : '0'
  stage.weightCutPercent = Number(source.weightCutPercent || 0) / 1e7
  stage.issuanceCutOn = stage.weightCutPercent > 0
  stage.baseCurrency = Number(m.baseCurrency || 1)
  stage.cashOutEnabled = Number(m.cashOutTaxRate || 0) < 10000
  stage.cashOutTaxRate = Number(m.cashOutTaxRate || 0) / 100
  stage.allowOwnerMinting = !!m.allowOwnerMinting
  stage.pauseTransfers = !!m.pauseCreditTransfers
  stage.pausePay = !!m.pausePay
  stage.holdFees = !!m.holdFees
  stage.allowSetTerminals = !!m.allowSetTerminals
  stage.allowSetController = !!m.allowSetController
  stage.allowTerminalMigration = !!m.allowTerminalMigration
  stage.allowSetCustomToken = !!m.allowSetCustomToken
  stage.allowAddAccountingContext = !!m.allowAddAccountingContext
  stage.allowAddPriceFeed = !!m.allowAddPriceFeed
  const deadline = deadlineFor(source.approvalHook)
  stage.deadline = deadline.key
  return { stage, customApproval: deadline.address }
}

interface PayoutState {
  mode: StageState['payoutMode']
  recipients: RecipientRow[]
}

function payoutStateFrom(
  limit: DraftCurrencyAmount | undefined,
  splits: DraftSplit[],
  decimals: number,
  owner: string,
): PayoutState {
  if (!limit || BigInt(limit.amount) === 0n) return { mode: 'none', recipients: [] }
  const total = BigInt(limit.amount)
  if (total >= UNLIMITED) {
    return {
      mode: 'unlimited',
      recipients: splits.map((split) =>
        recipientFromSplit(split, (Number(split.percent || 0) / SPLITS_TOTAL) * 100, '')),
    }
  }
  const recipients: RecipientRow[] = []
  let allocated = 0n
  for (const split of splits) {
    const amount = (total * BigInt(split.percent || 0)) / BigInt(SPLITS_TOTAL)
    allocated += amount
    if (amount > 0n) recipients.push(recipientFromSplit(split, 0, formatUnits(amount, decimals)))
  }
  // A finite payout's unallocated group remainder goes to the owner. Make it explicit
  // so the reconstructed payout limit keeps the same total instead of silently shrinking.
  if (allocated < total) {
    recipients.push({
      type: 'wallet',
      address: owner || zeroAddress,
      projectId: 0,
      percent: 0,
      amountEth: formatUnits(total - allocated, decimals),
      lockedUntil: 0,
      preferAddToBalance: false,
    })
  }
  return { mode: 'limited', recipients }
}

/** Fill one stage's token, reserved-split, payout, and allowance settings from a live snapshot. */
function applyStageFunds(
  state: CreateFlowState,
  input: DraftProjectInput,
  source: DraftStageSource,
  stage: StageState,
): void {
  const { ruleset, funds } = source
  const built = stageFromLive(ruleset)
  Object.assign(stage, built.stage)
  if (built.customApproval) {
    if (state.approvalAddress && !sameAddr(state.approvalAddress, built.customApproval)) {
      throw new Error('Rulesets use different custom approval-hook addresses, which one .jb draft cannot reproduce.')
    }
    state.approvalAddress = built.customApproval
  }

  // Reserved splits are % of ISSUANCE in the wizard: split share × reserved rate.
  // (The wizard derives the reserved percent from the recipients' summed percents.)
  const reservedRate = Number(ruleset.metadata.reservedPercent || 0) / 100
  stage.reservedRecipients = funds.reservedSplits.map((split) =>
    recipientFromSplit(split, (Number(split.percent || 0) / SPLITS_TOTAL) * reservedRate, ''))
  const reservedShare = funds.reservedSplits.reduce((sum, split) => sum + Number(split.percent || 0), 0)
  if (reservedRate > 0 && reservedShare < SPLITS_TOTAL) {
    stage.reservedRecipients.push({
      type: 'wallet',
      address: input.owner || zeroAddress,
      projectId: 0,
      percent: ((SPLITS_TOTAL - reservedShare) / SPLITS_TOTAL) * reservedRate,
      amountEth: '',
      lockedUntil: 0,
      preferAddToBalance: false,
    })
  }

  const fundRows = input.contexts.map((context) => {
    const key = context.token.toLowerCase()
    const access = funds.fundAccessByToken[key] || { payoutLimits: [], surplusAllowances: [] }
    if (access.payoutLimits.length > 1 || access.surplusAllowances.length > 1) {
      throw new Error('A ruleset has multiple fund-access currencies for one token, which the .jb editor cannot reproduce.')
    }
    return {
      context,
      kind: contextKind(context.token, input.chainId),
      limit: access.payoutLimits[0],
      allowance: access.surplusAllowances[0],
      splits: funds.payoutSplitsByToken[key] || [],
    }
  })

  // Flexible (duration 0) rulesets get re-queued on edit, which would drop locks.
  const lockedSomewhere = [funds.reservedSplits, ...fundRows.map((row) => row.splits)]
    .some((rows) => rows.some((split) => Number(split.lockedUntil || 0) > 0))
  if (Number(stage.durationSeconds || 0) <= 0 && lockedSomewhere) {
    throw new Error('A flexible live ruleset contains locked splits, which the .jb editor cannot preserve.')
  }

  const perToken = state.projectType === 'custom' && (state.accepts.length > 1 || state.accepts[0] === 'custom')
  if (perToken) {
    const allowanceModes: boolean[] = []
    for (const row of fundRows) {
      const expectedCurrency = tokenCurrencyId(row.context.token)
      if (row.limit && BigInt(row.limit.amount) > 0n && Number(row.limit.currency) !== expectedCurrency) {
        throw new Error('A per-token payout limit uses a different pricing currency, which the .jb editor cannot reproduce.')
      }
      const payout = payoutStateFrom(row.limit, row.splits, row.context.decimals, input.owner)
      stage.payoutByKind[row.kind] = { mode: payout.mode, recipients: payout.recipients }
      const allowanceAmount = row.allowance ? BigInt(row.allowance.amount) : 0n
      if (allowanceAmount > 0n && allowanceAmount < UNLIMITED) {
        throw new Error('A finite per-token surplus allowance cannot be reproduced by the .jb editor.')
      }
      allowanceModes.push(allowanceAmount >= UNLIMITED)
    }
    if (allowanceModes.some((on) => on !== allowanceModes[0])) {
      throw new Error('Surplus allowance settings differ by accounting token.')
    }
    stage.surplusAllowanceOn = !!allowanceModes[0]
    stage.surplusAllowanceUnlimited = !!allowanceModes[0]
  } else {
    // Fund access is configured against the first accounting context here. Refuse to
    // silently discard live limits/splits on another token the form cannot express.
    const row = fundRows.find((candidate) => candidate.kind === state.accepts[0]) || fundRows[0]
    const unrepresentable = fundRows.filter((candidate) => candidate !== row).some((candidate) =>
      (candidate.limit && BigInt(candidate.limit.amount) > 0n)
      || (candidate.allowance && BigInt(candidate.allowance.amount) > 0n)
      || candidate.splits.length > 0)
    if (unrepresentable) {
      throw new Error('This project has fund access or payout splits on more than one accounting token, which the .jb editor cannot reproduce.')
    }
    const payoutDecimals = row.limit
      ? amountDecimals(Number(row.limit.currency), row.context.decimals)
      : row.context.decimals
    const payout = payoutStateFrom(row.limit, row.splits, payoutDecimals, input.owner)
    stage.payoutMode = payout.mode
    stage.payoutRecipients = payout.recipients
    if (row.limit) stage.payoutCurrency = Number(row.limit.currency)
    if (row.allowance && BigInt(row.allowance.amount) > 0n) {
      stage.surplusAllowanceOn = true
      stage.surplusAllowanceUnlimited = BigInt(row.allowance.amount) >= UNLIMITED
      stage.surplusAllowanceCurrency = Number(row.allowance.currency)
      if (!stage.surplusAllowanceUnlimited) {
        stage.surplusAllowanceAmount = formatUnits(
          BigInt(row.allowance.amount),
          amountDecimals(Number(row.allowance.currency), row.context.decimals),
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Details + accounting (ports of applyDraftDetails / applyDraftAccountingAndTerminals)
// ---------------------------------------------------------------------------

function applyDetails(state: CreateFlowState, input: DraftProjectInput): void {
  const meta = input.metadata || {}
  state.details.name = meta.name || ''
  state.details.ticker = String(meta.symbol || meta.ticker || meta.tokenSymbol || input.tokenSymbol || '').replace(/^\$/, '')
  state.details.tagline = meta.projectTagline || meta.tagline || ''
  state.details.description = meta.description || ''
  state.details.logoUri = meta.logoUri || ''
  state.details.coverImageUri = meta.coverImageUri || ''
  state.details.website = meta.infoUri || meta.domain || ''
  state.details.twitter = meta.twitter || ''
  state.details.discord = meta.discord || ''
  state.details.telegram = meta.telegram || ''
  state.details.whatsapp = meta.whatsapp || ''
  state.details.payDisclosure = meta.payDisclosure || ''
  state.details.tags = Array.isArray(meta.tags) ? meta.tags.slice() : []
}

function applyAccounting(state: CreateFlowState, input: DraftProjectInput): void {
  const kinds = input.contexts.map((context) => contextKind(context.token, input.chainId))
  if (kinds.includes('custom')) {
    if (input.contexts.length !== 1 || kinds[0] !== 'custom') {
      throw new Error('The project mixes a custom accounting token with other contexts, which the .jb editor cannot reproduce.')
    }
    state.accepts = ['custom']
    state.customToken = {
      address: input.contexts[0].token,
      symbol: input.contexts[0].symbol || '',
      name: '',
      decimals: input.contexts[0].decimals,
      status: 'ok',
      error: '',
    }
  } else {
    state.accepts = (['eth', 'usdc'] as const).filter((kind) => kinds.includes(kind))
  }
  if (!state.accepts.length) throw new Error('No supported accounting context was found.')
  state.swapRouter = input.usesRouterTerminalRegistry
}

// ---------------------------------------------------------------------------
// Pure draft builder
// ---------------------------------------------------------------------------

/** Rules the exporter enforces on every ruleset it reconstructs. */
function guardRulesetMetadata(m: DraftRulesetMetadata, warnings: string[]): void {
  if (m.ownerMustSendPayouts) {
    throw new Error('The live ruleset requires owner-sent payouts, a flag the .jb editor cannot reproduce.')
  }
  if (m.scopeCashOutsToLocalBalances) {
    throw new Error('The live ruleset scopes cash outs differently than the .jb editor supports.')
  }
  if (Number(m.metadata || 0) !== 0) {
    warnings.push('The live ruleset contains custom metadata bits which are not editable in the create wizard.')
  }
}

export function buildDraftFromLive(input: DraftProjectInput): ProjectDraftResult {
  const state = initState()
  const warnings: string[] = []

  const chainIds = [...new Set(input.chainIds.map(Number))]
  const testnetCount = chainIds.filter((id) => TESTNET_IDS.includes(id)).length
  if (testnetCount && testnetCount !== chainIds.length) {
    throw new Error('A .jb draft cannot mix mainnet and testnet chains.')
  }
  state.network = testnetCount ? 'testnet' : 'mainnet'
  state.chainIds = chainIds
  state.projectType = input.isRevnet ? 'revnet' : 'custom'

  applyDetails(state, input)
  state.details.owner = input.owner || ''
  state.revOperator = input.owner || ''
  applyAccounting(state, input)

  const currentMeta = input.current.ruleset.metadata
  guardRulesetMetadata(currentMeta, warnings)
  if (input.isRevnet) {
    if (!sameAddr(currentMeta.dataHook, REV_OWNER)) {
      throw new Error('The revnet data hook is not the verified REVOwner, which the .jb editor cannot reproduce.')
    }
  } else if (!isZeroish(currentMeta.dataHook)) {
    throw new Error('The project uses a data hook (for example an onchain shop), which this exporter cannot yet reproduce in a .jb draft.')
  }

  if (input.isRevnet) {
    const stage = createStage()
    applyStageFunds(state, input, input.current, stage)
    stage.cutFreqDays = String(Number(stage.durationSeconds || 0) / 86400)
    stage.issuanceCutOn = Number(stage.durationSeconds || 0) > 0
    stage.autoIssuances = []
    state.stages = [stage]
    state.afterMode = stage.durationSeconds > 0 ? 'cycle' : 'wait'
    state.revBaseCurrency = Number(currentMeta.baseCurrency || 1)
    warnings.push('Revnet auto-issuance beneficiaries and earlier completed stages are not enumerable from the current ruleset, so this .jb starts from the live stage.')
    warnings.push('Any later revnet buyback-pool or registry-routing changes are not part of the .jb create form; review the new revnet’s market setup after deployment.')
  } else {
    const stage = createStage()
    applyStageFunds(state, input, input.current, stage)
    state.stages = [stage]
    state.afterMode = stage.durationSeconds > 0 ? 'cycle' : 'wait'

    if (input.upcoming && input.upcoming.ruleset.id !== input.current.ruleset.id) {
      if (Number(stage.durationSeconds || 0) <= 0) {
        throw new Error('A distinct ruleset is queued after a flexible current ruleset, which the .jb sequencer cannot reproduce safely.')
      }
      const nextMeta = input.upcoming.ruleset.metadata
      guardRulesetMetadata(nextMeta, warnings)
      if (!sameAddr(nextMeta.dataHook || zeroAddress, currentMeta.dataHook || zeroAddress)
        || !!nextMeta.useDataHookForPay !== !!currentMeta.useDataHookForPay
        || !!nextMeta.useDataHookForCashOut !== !!currentMeta.useDataHookForCashOut) {
        throw new Error('The queued ruleset changes data-hook behavior, which the .jb create form cannot reproduce.')
      }
      const nextStage = createStage()
      applyStageFunds(state, input, input.upcoming, nextStage)
      state.stages.push(nextStage)
      state.afterMode = nextStage.durationSeconds > 0 ? 'cycle' : 'wait'
    }
  }

  if (chainIds.length > 1) {
    warnings.push(`This draft was reconstructed from ${chainLabel(input.chainId)}. The project’s configuration on its other chains was not compared, and its exact bridge topology is not re-verified — review both before deploying.`)
  }

  state.step = 0
  state.tos = false
  return { state, warnings }
}

// ---------------------------------------------------------------------------
// Live-state fetch wrapper
// ---------------------------------------------------------------------------

// JBController.currentRulesetOf / upcomingRulesetOf — returns the ruleset plus
// the DECODED metadata struct (no manual bit unpacking needed).
const RULESET_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'cycleNumber', type: 'uint48' },
    { name: 'id', type: 'uint48' },
    { name: 'basedOnId', type: 'uint48' },
    { name: 'start', type: 'uint48' },
    { name: 'duration', type: 'uint32' },
    { name: 'weight', type: 'uint112' },
    { name: 'weightCutPercent', type: 'uint32' },
    { name: 'approvalHook', type: 'address' },
    { name: 'metadata', type: 'uint256' },
  ],
} as const

const METADATA_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'reservedPercent', type: 'uint16' },
    { name: 'cashOutTaxRate', type: 'uint16' },
    { name: 'baseCurrency', type: 'uint32' },
    { name: 'pausePay', type: 'bool' },
    { name: 'pauseCreditTransfers', type: 'bool' },
    { name: 'allowOwnerMinting', type: 'bool' },
    { name: 'allowSetCustomToken', type: 'bool' },
    { name: 'allowTerminalMigration', type: 'bool' },
    { name: 'allowSetTerminals', type: 'bool' },
    { name: 'allowSetController', type: 'bool' },
    { name: 'allowAddAccountingContext', type: 'bool' },
    { name: 'allowAddPriceFeed', type: 'bool' },
    { name: 'ownerMustSendPayouts', type: 'bool' },
    { name: 'holdFees', type: 'bool' },
    { name: 'scopeCashOutsToLocalBalances', type: 'bool' },
    { name: 'useDataHookForPay', type: 'bool' },
    { name: 'useDataHookForCashOut', type: 'bool' },
    { name: 'dataHook', type: 'address' },
    { name: 'metadata', type: 'uint16' },
  ],
} as const

const CONTROLLER_RULESET_ABI = [
  {
    name: 'currentRulesetOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ ...RULESET_TUPLE, name: 'ruleset' }, { ...METADATA_TUPLE, name: 'metadata' }],
  },
  {
    name: 'upcomingRulesetOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ ...RULESET_TUPLE, name: 'ruleset' }, { ...METADATA_TUPLE, name: 'metadata' }],
  },
] as const

const DIRECTORY_TERMINALS_ABI = [{
  name: 'terminalsOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address[]' }],
}] as const

const ROUTER_REGISTRY_TERMINAL_OF_ABI = [{
  name: 'terminalOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const

const REV_OWNER_TIERED_721_HOOK_ABI = [{
  name: 'tiered721HookOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'revnetId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const

type OnchainRuleset = {
  id: number | bigint
  duration: number
  weight: bigint
  weightCutPercent: number
  approvalHook: string
}
type OnchainRulesetMetadata = Omit<DraftRulesetMetadata, 'reservedPercent' | 'cashOutTaxRate' | 'baseCurrency' | 'metadata'> & {
  reservedPercent: number
  cashOutTaxRate: number
  baseCurrency: number
  metadata: number
}

function toDraftRuleset(ruleset: OnchainRuleset, metadata: OnchainRulesetMetadata): DraftRuleset {
  return {
    id: String(ruleset.id),
    duration: Number(ruleset.duration || 0),
    weight: String(ruleset.weight || 0),
    weightCutPercent: Number(ruleset.weightCutPercent || 0),
    approvalHook: ruleset.approvalHook,
    metadata: {
      reservedPercent: Number(metadata.reservedPercent || 0),
      cashOutTaxRate: Number(metadata.cashOutTaxRate || 0),
      baseCurrency: Number(metadata.baseCurrency || 0),
      pausePay: !!metadata.pausePay,
      pauseCreditTransfers: !!metadata.pauseCreditTransfers,
      allowOwnerMinting: !!metadata.allowOwnerMinting,
      allowSetCustomToken: !!metadata.allowSetCustomToken,
      allowTerminalMigration: !!metadata.allowTerminalMigration,
      allowSetTerminals: !!metadata.allowSetTerminals,
      allowSetController: !!metadata.allowSetController,
      allowAddAccountingContext: !!metadata.allowAddAccountingContext,
      allowAddPriceFeed: !!metadata.allowAddPriceFeed,
      ownerMustSendPayouts: !!metadata.ownerMustSendPayouts,
      holdFees: !!metadata.holdFees,
      scopeCashOutsToLocalBalances: !!metadata.scopeCashOutsToLocalBalances,
      useDataHookForPay: !!metadata.useDataHookForPay,
      useDataHookForCashOut: !!metadata.useDataHookForCashOut,
      dataHook: metadata.dataHook,
      metadata: Number(metadata.metadata || 0),
    },
  }
}

/** Read one ruleset's splits + fund access into the pure snapshot shape. */
async function readFundsSnapshot(projectId: string, chainId: number, rulesetId: string): Promise<{
  snapshot: DraftFundsSnapshot
  contexts: DraftAccountingContext[]
}> {
  const splits = await fetchProjectSplits(projectId, chainId, rulesetId)
  const contexts: DraftAccountingContext[] = (splits.accountingContexts || []).map((context) => ({
    token: context.token,
    decimals: context.tokenDecimals,
    currency: context.currency,
  }))
  const payoutSplitsByToken: DraftFundsSnapshot['payoutSplitsByToken'] = {}
  for (const context of contexts) {
    const groupId = BigInt(context.token).toString()
    const group = (splits.splitGroups || []).find((candidate) => candidate.groupId === groupId)
    payoutSplitsByToken[context.token.toLowerCase()] = (group?.splits || []).map((split) => ({
      percent: split.percent,
      projectId: split.projectId,
      beneficiary: split.beneficiary,
      preferAddToBalance: split.preferAddToBalance,
      lockedUntil: split.lockedUntil,
      hook: split.hook,
    }))
  }
  const fundAccessByToken: DraftFundsSnapshot['fundAccessByToken'] = {}
  for (const group of splits.fundAccessLimitGroups || []) {
    fundAccessByToken[group.token.toLowerCase()] = {
      payoutLimits: group.payoutLimits.map((limit) => ({ amount: limit.amount, currency: limit.currency })),
      surplusAllowances: group.surplusAllowances.map((allowance) => ({ amount: allowance.amount, currency: allowance.currency })),
    }
  }
  return {
    snapshot: {
      reservedSplits: splits.reservedSplits,
      payoutSplitsByToken,
      fundAccessByToken,
    },
    contexts,
  }
}

/**
 * Reconstruct the live project into an importable .jb draft.
 * Rejects (throws) any configuration the create wizard cannot faithfully express.
 */
export async function buildProjectCreateDraft(
  projectId: string,
  chainId: number,
  options?: { tokenSymbol?: string },
): Promise<ProjectDraftResult> {
  const pid = BigInt(projectId)
  const client = publicClientFor(chainId)

  const project = await fetchProjectWithRuleset(projectId, chainId, 6)
  if (!project) throw new Error('The project could not be verified on chain.')
  if (!project.controllerRecognized) {
    throw new Error('This project uses a non-standard controller, which the create wizard cannot reproduce.')
  }
  const isRevnetProject = !!project.isRevnet

  // Every chain the project exists on (empty result = single-chain project).
  let chainIds = [chainId]
  try {
    const connected = await fetchConnectedChains(projectId, chainId, 6)
    if (connected.length) chainIds = [...new Set([chainId, ...connected.map((c) => c.chainId)])]
  } catch {
    // Bendystraw unavailable — export as single-chain; the wizard can re-add chains.
  }

  // Live ruleset + decoded metadata straight from the controller.
  let [ruleset, metadata] = await client.readContract({
    address: JB_CONTRACTS.JBController,
    abi: CONTROLLER_RULESET_ABI,
    functionName: 'currentRulesetOf',
    args: [pid],
  })
  if (BigInt(ruleset.id) === 0n) {
    [ruleset, metadata] = await client.readContract({
      address: JB_CONTRACTS.JBController,
      abi: CONTROLLER_RULESET_ABI,
      functionName: 'upcomingRulesetOf',
      args: [pid],
    })
  }
  if (BigInt(ruleset.id) === 0n) throw new Error('No live ruleset could be verified for this project.')

  // Terminal shape: canonical terminal required; the router registry is the only
  // other reproducible terminal, and only with the canonical router target.
  const terminals = await client.readContract({
    address: JB_CONTRACTS.JBDirectory,
    abi: DIRECTORY_TERMINALS_ABI,
    functionName: 'terminalsOf',
    args: [pid],
  })
  const lower = terminals.map((terminal) => terminal.toLowerCase())
  if (!lower.includes(JB_CONTRACTS.JBMultiTerminal.toLowerCase())) {
    throw new Error('The canonical terminal is missing, which the .jb editor cannot reproduce.')
  }
  const allowed = [JB_CONTRACTS.JBMultiTerminal.toLowerCase(), JB_ROUTER_TERMINAL_REGISTRY.toLowerCase()]
  if (lower.some((terminal) => !allowed.includes(terminal))) {
    throw new Error('The project uses a custom terminal, which the .jb editor cannot reproduce.')
  }
  const usesRouterTerminalRegistry = lower.includes(JB_ROUTER_TERMINAL_REGISTRY.toLowerCase())
  if (usesRouterTerminalRegistry) {
    const target = await client.readContract({
      address: JB_ROUTER_TERMINAL_REGISTRY,
      abi: ROUTER_REGISTRY_TERMINAL_OF_ABI,
      functionName: 'terminalOf',
      args: [pid],
    })
    if (!sameAddr(target, JB_ROUTER_TERMINAL)) {
      throw new Error('The project uses a custom router-terminal target, which the .jb editor cannot reproduce.')
    }
  }

  // Onchain shops (721 data hooks) are not reconstructed by this exporter yet.
  if (isRevnetProject) {
    const shopHook = await client.readContract({
      address: REV_OWNER,
      abi: REV_OWNER_TIERED_721_HOOK_ABI,
      functionName: 'tiered721HookOf',
      args: [pid],
    }).catch(() => zeroAddress)
    if (!isZeroish(shopHook)) {
      throw new Error('This project has an onchain shop (721 hook), which this exporter cannot yet reproduce in a .jb draft.')
    }
  }

  const currentFunds = await readFundsSnapshot(projectId, chainId, String(ruleset.id))

  // Custom accounting token needs its symbol for the wizard's token card.
  const contexts = await Promise.all(currentFunds.contexts.map(async (context) => {
    if (contextKind(context.token, chainId) !== 'custom') return context
    const symbol = await client.readContract({
      address: context.token as `0x${string}`,
      abi: erc20Abi,
      functionName: 'symbol',
    }).catch(() => '')
    return { ...context, symbol }
  }))

  // Distinct queued upcoming ruleset → second stage (custom projects only).
  let upcoming: DraftStageSource | null = null
  if (!isRevnetProject) {
    const [nextRuleset, nextMetadata] = await client.readContract({
      address: JB_CONTRACTS.JBController,
      abi: CONTROLLER_RULESET_ABI,
      functionName: 'upcomingRulesetOf',
      args: [pid],
    })
    if (BigInt(nextRuleset.id) !== 0n && String(nextRuleset.id) !== String(ruleset.id)) {
      const nextFunds = await readFundsSnapshot(projectId, chainId, String(nextRuleset.id))
      upcoming = { ruleset: toDraftRuleset(nextRuleset, nextMetadata), funds: nextFunds.snapshot }
    }
  }

  // For revnets the draft's owner/operator is the revnet operator, not REVOwner.
  let owner = project.owner || ''
  if (isRevnetProject) {
    const operator = await fetchRevnetOperator(projectId, chainId).catch(() => null)
    if (operator) owner = operator
  }

  return buildDraftFromLive({
    projectId: Number(projectId),
    chainId,
    chainIds,
    isRevnet: isRevnetProject,
    owner,
    metadata: project.metadata || {},
    tokenSymbol: options?.tokenSymbol,
    contexts,
    usesRouterTerminalRegistry,
    current: { ruleset: toDraftRuleset(ruleset, metadata), funds: currentFunds.snapshot },
    upcoming,
  })
}
