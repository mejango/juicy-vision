/**
 * Create-flow state model — a 1:1 mirror of website/src/create-flow.js
 * (initState / createStage / itemDraft / sanitizeState / draft persistence).
 * The .jb draft schema is shared verbatim with the website so drafts made in
 * either app import into the other.
 */

import { ALL_CHAIN_IDS, CHAINS } from '../../../constants'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectType = 'custom' | 'revnet'
export type AcceptKind = 'eth' | 'usdc' | 'custom'
export type SuckerType = 'native' | 'ccip' | 'both'
export type AfterMode = 'wait' | 'terminal' | 'cycle'
export type PayoutMode = 'none' | 'limited' | 'unlimited'
export type TokenMode = 'custom' | 'none'
export type DeadlineKey = 'none' | '3hours' | '1day' | '3days' | '7days' | 'custom'

export interface RecipientRow {
  type: 'wallet' | 'project' | 'lphook' | 'customhook'
  address: string
  resolvedAddress?: string
  projectId: number
  percent: number
  amountEth?: string
  preferAddToBalance?: boolean
  hookAddress?: string
  lockedUntil?: number
}

export interface AutoIssuance {
  count: string
  address: string
  resolvedAddress?: string
}

export interface StageState {
  expanded: boolean
  durationSeconds: number
  durationCustom: boolean
  customDurVal: string
  customDurUnit: 'hours' | 'days' | 'weeks' | 'years'
  schedule: string
  scheduleOn: boolean
  baseCurrency: number
  payoutCurrency: number
  tokenMode: TokenMode
  weight: string
  reservedPercent: number
  weightCutPercent: number
  issuanceCutOn: boolean
  cashOutEnabled: boolean
  cashOutTaxRate: number
  allowOwnerMinting: boolean
  pauseTransfers: boolean
  useTotalSurplusForCashOuts: boolean
  ownerMustSendPayouts: boolean
  metadataExtra: number
  reservedRecipients: RecipientRow[]
  tokenAdvancedOpen: boolean
  // revnet-only stage fields (ignored by the custom flow)
  cutFreqDays: string
  autoIssuances: AutoIssuance[]
  startDaysAfter: string
  // payouts
  payoutMode: PayoutMode
  payoutRecipients: RecipientRow[]
  payoutByKind: Record<string, { mode: PayoutMode; recipients: RecipientRow[] }>
  // surplus allowance
  surplusAllowanceOn: boolean
  surplusAllowanceUnlimited: boolean
  surplusAllowanceAmount: string
  surplusAllowanceCurrency: number
  // deadline + rules
  deadline: DeadlineKey
  pausePay: boolean
  holdFees: boolean
  allowSetTerminals: boolean
  allowSetController: boolean
  allowTerminalMigration: boolean
  allowSetCustomToken: boolean
  allowAddAccountingContext: boolean
  allowAddPriceFeed: boolean
  otherOpen: boolean
  // editor section collapses
  tokenOpen: boolean
  payoutsOpen: boolean
  deadlineOpen: boolean
}

export interface ItemSplitRecipient {
  pct: number | string
  recip: string
  benef: string
}

export interface ItemState {
  expanded: boolean
  advOpen: boolean
  name: string
  description: string
  imageUri: string
  mediaType: string
  metaUri: string
  encodedIpfsUri: string
  price: string
  limited: boolean
  supply: string
  splitOn: boolean
  splitRecipients: ItemSplitRecipient[]
  discountOn: boolean
  discountPct: string
  category: number
  reserveOn: boolean
  reserveFrequency: string
  reserveBeneficiary: string
  votingOn: boolean
  votingUnits: string
  flags: {
    allowOwnerMint: boolean
    transfersPausable: boolean
    cantBeRemoved: boolean
    allowCredits: boolean
    ownerCanEditDiscount: boolean
  }
}

export interface CustomTokenState {
  address: string
  name: string
  symbol: string
  decimals: number | null
  status: 'idle' | 'loading' | 'ok' | 'error'
  error: string
}

export interface DetailsState {
  name: string
  ticker: string
  tagline: string
  description: string
  logoUri: string
  logoUploading: boolean
  website: string
  twitter: string
  discord: string
  telegram: string
  instagram: string
  whatsapp: string
  tags: string[]
  coverImageUri: string
  payDisclosure: string
  owner: string
  ownerResolved?: string
  immutable: boolean
  linksOpen: boolean
  ownerOpen: boolean
  tagsOpen: boolean
  customOpen: boolean
}

export interface CollectionState {
  name: string
  symbol: string
  nameTouched: boolean
  symbolTouched: boolean
  extrasOpen: boolean
  preventOverspending: boolean
  noNewTiersWithReserves: boolean
  noNewTiersWithVotes: boolean
  noNewTiersWithOwnerMinting: boolean
  issueTokensForSplits: boolean
  useForRedemptions: boolean
  // revnet-only operator 721 permissions (default on — REVDeployer grants all four)
  opCanAdjustTiers: boolean
  opCanUpdateMetadata: boolean
  opCanMint: boolean
  opCanIncreaseDiscount: boolean
}

export interface CreateFlowState {
  step: number
  projectType: ProjectType
  details: DetailsState
  revOperator: string
  revOperatorResolved?: string
  revBaseCurrency: number
  accepts: AcceptKind[]
  customToken: CustomTokenState
  swapRouter: boolean
  approvalAddress: string
  approvalResolved?: string
  stages: StageState[]
  afterMode: AfterMode
  shopEnabled: boolean
  storePricingCurrency: number
  network: 'mainnet' | 'testnet'
  suckerType: SuckerType
  nfts: ItemState[]
  perChain: Record<number, { addr?: Record<string, string>; num?: Record<string, string> }>
  storeCategories: { id: number; name: string }[]
  collection: CollectionState
  chainIds: number[]
  tos: boolean
  deploying: boolean
  statusLines: string[]
  done: boolean
  quoteChoice: null
}

// ---------------------------------------------------------------------------
// Factories — field-for-field mirrors of the website's
// ---------------------------------------------------------------------------

export function createStage(): StageState {
  return {
    expanded: false,
    durationSeconds: 0,
    durationCustom: false, customDurVal: '', customDurUnit: 'days',
    schedule: '', scheduleOn: false,
    baseCurrency: 1,
    payoutCurrency: 1,
    tokenMode: 'custom', weight: '10000', reservedPercent: 0, weightCutPercent: 0, issuanceCutOn: false,
    cashOutEnabled: false, cashOutTaxRate: 0, allowOwnerMinting: false, pauseTransfers: false,
    useTotalSurplusForCashOuts: false, ownerMustSendPayouts: false, metadataExtra: 0,
    reservedRecipients: [], tokenAdvancedOpen: false,
    cutFreqDays: '30', autoIssuances: [], startDaysAfter: '30',
    payoutMode: 'none', payoutRecipients: [], payoutByKind: {},
    surplusAllowanceOn: false, surplusAllowanceUnlimited: false, surplusAllowanceAmount: '', surplusAllowanceCurrency: 1,
    deadline: '1day', pausePay: false, holdFees: false,
    allowSetTerminals: false, allowSetController: false, allowTerminalMigration: false,
    allowSetCustomToken: false, allowAddAccountingContext: false, allowAddPriceFeed: false, otherOpen: false,
    tokenOpen: true, payoutsOpen: false, deadlineOpen: false,
  }
}

export function itemDraft(): ItemState {
  return {
    expanded: true, advOpen: false,
    name: '', description: '',
    imageUri: '', mediaType: '', metaUri: '', encodedIpfsUri: '',
    price: '', limited: false, supply: '',
    splitOn: false, splitRecipients: [],
    discountOn: false, discountPct: '',
    category: 0,
    reserveOn: false, reserveFrequency: '', reserveBeneficiary: '',
    votingOn: false, votingUnits: '',
    flags: { allowOwnerMint: false, transfersPausable: false, cantBeRemoved: false, allowCredits: true, ownerCanEditDiscount: true },
  }
}

export function initState(): CreateFlowState {
  return {
    step: 0,
    projectType: 'custom',
    details: {
      name: '', ticker: '', tagline: '', description: '', logoUri: '', logoUploading: false,
      website: '', twitter: '', discord: '', telegram: '', instagram: '', whatsapp: '', tags: [],
      coverImageUri: '', payDisclosure: '', owner: '', immutable: false,
      linksOpen: false, ownerOpen: false, tagsOpen: false, customOpen: false,
    },
    revOperator: '',
    revBaseCurrency: 1,
    accepts: ['eth'],
    customToken: { address: '', name: '', symbol: '', decimals: null, status: 'idle', error: '' },
    swapRouter: true,
    approvalAddress: '',
    stages: [createStage()],
    afterMode: 'wait',
    shopEnabled: false,
    storePricingCurrency: 1,
    // juicy-vision resolves chains from its build env rather than a runtime
    // toggle; the field survives for .jb interchange with the website.
    network: 'mainnet',
    suckerType: 'both',
    nfts: [],
    perChain: {},
    storeCategories: [],
    collection: {
      name: '', symbol: '', nameTouched: false, symbolTouched: false, extrasOpen: false,
      preventOverspending: false, noNewTiersWithReserves: false, noNewTiersWithVotes: false,
      noNewTiersWithOwnerMinting: false, issueTokensForSplits: false, useForRedemptions: false,
      opCanAdjustTiers: true, opCanUpdateMetadata: true, opCanMint: true, opCanIncreaseDiscount: true,
    },
    chainIds: [...ALL_CHAIN_IDS],
    tos: false,
    deploying: false, statusLines: [], done: false, quoteChoice: null,
  }
}

// ---------------------------------------------------------------------------
// Draft persistence + .jb interchange (same JSON shape as the website)
// ---------------------------------------------------------------------------

const DRAFT_KEY = 'jb-create-draft'

/** JSON-safe snapshot: drop transient (_-prefixed) keys and deploy flags. */
export function sanitizeState(state: CreateFlowState): CreateFlowState {
  const c: Record<string, unknown> = {}
  const src = state as unknown as Record<string, unknown>
  Object.keys(state).forEach((k) => {
    if (k.charAt(0) === '_' || typeof src[k] === 'function') return
    c[k] = src[k]
  })
  const clone = JSON.parse(JSON.stringify(c)) as CreateFlowState
  clone.deploying = false
  clone.statusLines = []
  clone.done = false
  clone.quoteChoice = null
  if (clone.details) clone.details.logoUploading = false
  return clone
}

/** Whitelist-merge an imported object over defaults (unknown keys dropped). */
function mergeKnownFields<T extends object>(defaults: T, obj: unknown): T {
  const out = JSON.parse(JSON.stringify(defaults)) as T
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out
  const src = obj as Record<string, unknown>
  Object.keys(defaults).forEach((k) => {
    if (src[k] !== undefined) (out as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(src[k]))
  })
  return out
}

export function mergeDraft(obj: unknown): CreateFlowState | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const src = obj as Record<string, unknown>
  const defaults = initState()
  const s = mergeKnownFields(defaults, obj)
  s.projectType = src.projectType === 'revnet' ? 'revnet' : 'custom'
  s.network = src.network === 'testnet' ? 'testnet' : 'mainnet'
  s.details = mergeKnownFields(defaults.details, src.details)
  s.details.tags = Array.isArray(s.details.tags) ? s.details.tags.slice(0, 50).map(String) : []
  s.collection = mergeKnownFields(defaults.collection, src.collection)
  s.customToken = mergeKnownFields(defaults.customToken, src.customToken)
  if (s.customToken.status === 'loading') s.customToken.status = 'idle'
  s.stages = (Array.isArray(src.stages) && src.stages.length > 0 ? (src.stages as unknown[]) : [null])
    .map((st) => mergeKnownFields(createStage(), st))
  s.nfts = (Array.isArray(src.nfts) ? (src.nfts as unknown[]) : []).map((n) => mergeKnownFields(itemDraft(), n))
  // Map imported chain ids into ids this build knows; drop the rest, min 1.
  s.chainIds = (Array.isArray(src.chainIds) ? (src.chainIds as unknown[]).map(Number) : [])
    .map(mapImportedChainId)
    .filter((id): id is number => id !== null)
  s.chainIds = [...new Set(s.chainIds)]
  if (s.chainIds.length === 0) s.chainIds = [...ALL_CHAIN_IDS]
  s.deploying = false
  s.statusLines = []
  s.done = false
  s.quoteChoice = null
  return s
}

/** Canonical↔testnet pairs, mirroring the website's CHAIN_PAIRS. */
const CHAIN_PAIRS: { canon: number; testnet: number }[] = [
  { canon: 1, testnet: 11155111 },
  { canon: 10, testnet: 11155420 },
  { canon: 42161, testnet: 421614 },
  { canon: 8453, testnet: 84532 },
]

/** Map a chain id from a .jb draft (either network) onto this build's chains. */
function mapImportedChainId(id: number): number | null {
  if ((ALL_CHAIN_IDS as readonly number[]).includes(id)) return id
  const pair = CHAIN_PAIRS.find((p) => p.canon === id || p.testnet === id)
  if (!pair) return null
  const other = pair.canon === id ? pair.testnet : pair.canon
  return (ALL_CHAIN_IDS as readonly number[]).includes(other) ? other : null
}

function looksLikeCreateDraft(value: unknown): boolean {
  const v = value as Record<string, unknown> | null
  return !!(v && typeof v === 'object' && !Array.isArray(v)
    && (v.projectType === 'custom' || v.projectType === 'revnet')
    && v.details && typeof v.details === 'object'
    && Array.isArray(v.stages) && Array.isArray(v.chainIds))
}

/** Accept the JSON contents of a .jb file (directly or in a fenced block). */
export function parseCreateDraftJson(input: unknown): CreateFlowState {
  const candidates: unknown[] = []
  if (input && typeof input === 'object') candidates.push(input)
  else {
    const text = String(input || '').trim()
    if (!text) throw new Error('Paste .jb JSON first.')
    if (text.length > 2_000_000) throw new Error('The .jb JSON is too large.')
    try { candidates.push(JSON.parse(text)) } catch { /* try fenced blocks */ }
    const blocks = /```(?:json)?\s*([\s\S]*?)```/gi
    let match: RegExpExecArray | null
    while ((match = blocks.exec(text))) {
      try { candidates.push(JSON.parse(match[1])) } catch { /* skip */ }
    }
  }
  for (const candidate of candidates) {
    if (!looksLikeCreateDraft(candidate)) continue
    const merged = mergeDraft(candidate)
    if (merged) return merged
  }
  throw new Error('This JSON isn’t a project draft (.jb) — export one from the create flow.')
}

export function saveDraft(state: CreateFlowState): void {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(sanitizeState(state))) } catch { /* quota */ }
}

export function loadDraft(): CreateFlowState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    return raw ? mergeDraft(JSON.parse(raw)) : null
  } catch { return null }
}

export function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* noop */ }
}

export function exportDraftFile(state: CreateFlowState): void {
  const nm = (state.details?.name || 'project')
    .replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'project'
  const blob = new Blob([JSON.stringify(sanitizeState(state), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nm}.jb`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------------------------------------------------------------------------
// Shared derivations (used by steps + builders)
// ---------------------------------------------------------------------------

export function stepsFor(state: CreateFlowState): string[] {
  if (state.projectType === 'revnet') return ['Flavor', 'Basics', 'Stages', 'Shop', 'Deploy']
  return ['Flavor', 'Basics', 'Rulesets', 'Shop', 'Deploy']
}

/** First non-final stage with zero duration (would be clobbered instantly), or -1. */
export function badStageIndex(state: CreateFlowState): number {
  if (state.projectType === 'revnet') return -1
  for (let i = 0; i < state.stages.length - 1; i++) {
    if (!state.stages[i].durationSeconds) return i
  }
  return -1
}

/** Human label for the accounting token(s): "ETH", "USDC", "ETH and USDC", or the custom symbol. */
export function surplusTokenLabel(state: CreateFlowState): string {
  if (state.accepts.includes('custom')) return state.customToken.symbol || 'the accounting token'
  const parts = []
  if (state.accepts.includes('eth')) parts.push('ETH')
  if (state.accepts.includes('usdc')) parts.push('USDC')
  return parts.join(' and ') || 'ETH'
}

export function chainName(id: number): string {
  return CHAINS[id]?.name || `Chain ${id}`
}
