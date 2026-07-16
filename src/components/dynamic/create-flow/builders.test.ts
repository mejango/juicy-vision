/**
 * Unit tests for the create-flow deploy-config builders.
 * Semantics under test mirror website/src/create-flow.js (assembleRuleset,
 * buildTerminalConfigs, buildRevStage, build721Config).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseEther, parseUnits } from 'viem'

// Pinning is network-bound; mock it (and the CID encoder, which requires a
// real base58 CIDv0) so the async 721 builder runs hermetically.
vi.mock('../../../services/ipfsPinning', () => ({
  pinMetadata: vi.fn(async () => 'ipfs://QmMockedCid'),
}))
vi.mock('../../../utils/ipfs', () => ({
  encodeIpfsUri: vi.fn(() => `0x${'11'.repeat(32)}`),
}))

import { pinMetadata } from '../../../services/ipfsPinning'
import { initState, createStage, itemDraft, type CreateFlowState, type RecipientRow } from './state'
import {
  buildRulesetConfigsForChain,
  buildTerminalConfigsForChain,
  buildChainConfigOverrides,
  buildDeployTiersConfigFromState,
  buildRevnetStageConfigs,
  DEADLINE_HOOKS,
  BANNY_LP_SPLIT_HOOK,
  FOREVER_SECONDS,
} from './builders'
import { ALL_CHAIN_IDS, JB_CONTRACTS, JB_ROUTER_TERMINAL_REGISTRY, NATIVE_TOKEN, ZERO_ADDRESS } from '../../../constants'
import { CANONICAL_USDC_BY_CHAIN } from '../../../../shared/chains'

const SPLITS_TOTAL = 1_000_000_000
const UINT224_MAX = ((1n << 224n) - 1n).toString()

const CHAIN_A = ALL_CHAIN_IDS[0] // 1 or 11155111 depending on env — both have USDC + the LP hook
const CHAIN_B = ALL_CHAIN_IDS[1]

const A1 = '0x1111111111111111111111111111111111111111'
const A2 = '0x2222222222222222222222222222222222222222'
const HOOK_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const HOOK_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function wallet(address: string, percent = 0, amountEth?: string): RecipientRow {
  return { type: 'wallet', address, projectId: 0, percent, amountEth }
}

/** Fresh single-chain state (multichain behaviors are opted into per test). */
function singleChainState(): CreateFlowState {
  const s = initState()
  s.chainIds = [CHAIN_A]
  return s
}

const sumPercents = (splits: { percent: number }[]) => splits.reduce((t, s) => t + s.percent, 0)

beforeEach(() => {
  vi.mocked(pinMetadata).mockClear()
})

// ---------------------------------------------------------------------------
// 1. Afterwards choice — standby / terminal / cycle
// ---------------------------------------------------------------------------

describe('afterMode stage resolution', () => {
  function timedState(): CreateFlowState {
    const s = singleChainState()
    s.stages[0].durationSeconds = 86400
    s.stages[0].weight = '100'
    s.stages[0].cashOutEnabled = true
    s.stages[0].cashOutTaxRate = 20
    return s
  }

  it("appends a standby stage for 'wait': weight 0, pausePay, duration 0, cash-outs preserved", () => {
    const s = timedState()
    s.afterMode = 'wait'
    const configs = buildRulesetConfigsForChain(s, CHAIN_A, 0)
    expect(configs).toHaveLength(2)
    expect(configs[0].duration).toBe(86400)
    expect(configs[0].weight).toBe(parseEther('100').toString())

    const standby = configs[1]
    expect(standby.weight).toBe('0')
    expect(standby.duration).toBe(0)
    expect(standby.mustStartAtOrAfter).toBe(0)
    expect(standby.metadata.pausePay).toBe(true)
    expect(standby.metadata.cashOutTaxRate).toBe(2000) // cash-outs preserved so holders can exit
    expect(standby.splitGroups).toEqual([])
    expect(standby.fundAccessLimitGroups).toEqual([]) // no payouts / fund access
  })

  it("appends a forever clone for 'terminal' continuing the same terms", () => {
    const s = timedState()
    s.afterMode = 'terminal'
    const configs = buildRulesetConfigsForChain(s, CHAIN_A, 0)
    expect(configs).toHaveLength(2)
    const term = configs[1]
    expect(term.duration).toBe(FOREVER_SECONDS)
    expect(term.weight).toBe(parseEther('100').toString())
    expect(term.mustStartAtOrAfter).toBe(0)
    expect(term.metadata.pausePay).toBe(false)
    expect(term.metadata.cashOutTaxRate).toBe(2000)
  })

  it("appends nothing for 'cycle' (the ruleset auto-repeats)", () => {
    const s = timedState()
    s.afterMode = 'cycle'
    expect(buildRulesetConfigsForChain(s, CHAIN_A, 0)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 2. Cash-out tax forcing
// ---------------------------------------------------------------------------

describe('cashOutTaxRate', () => {
  it('is forced to 10000 when cash outs are disabled', () => {
    const s = singleChainState()
    s.stages[0].cashOutEnabled = false
    s.stages[0].cashOutTaxRate = 20
    const [cfg] = buildRulesetConfigsForChain(s, CHAIN_A, 0)
    expect(cfg.metadata.cashOutTaxRate).toBe(10000)
  })

  it('is forced to 10000 when unlimited payouts leave no surplus', () => {
    const s = singleChainState()
    s.stages[0].cashOutEnabled = true
    s.stages[0].cashOutTaxRate = 5
    s.stages[0].payoutMode = 'unlimited'
    s.stages[0].payoutRecipients = [wallet(A1, 100)]
    const [cfg] = buildRulesetConfigsForChain(s, CHAIN_A, 0)
    expect(cfg.metadata.cashOutTaxRate).toBe(10000)
  })

  it('encodes the stage percent ×100 when enabled with surplus', () => {
    const s = singleChainState()
    s.stages[0].cashOutEnabled = true
    s.stages[0].cashOutTaxRate = 33
    const [cfg] = buildRulesetConfigsForChain(s, CHAIN_A, 0)
    expect(cfg.metadata.cashOutTaxRate).toBe(3300)
  })
})

// ---------------------------------------------------------------------------
// 3. Limited payouts — wei sums + remainder-balanced percents
// ---------------------------------------------------------------------------

describe('limited payouts', () => {
  it('sums the limit in wei and derives split percents summing to exactly 1e9', () => {
    const s = singleChainState()
    s.stages[0].payoutMode = 'limited'
    s.stages[0].payoutRecipients = [wallet(A1, 0, '1'), wallet(A2, 0, '2'), wallet(A1, 0, '0.5')]
    const [cfg] = buildRulesetConfigsForChain(s, CHAIN_A, 0)

    expect(cfg.fundAccessLimitGroups).toHaveLength(1)
    const fal = cfg.fundAccessLimitGroups[0]
    expect(fal.terminal).toBe(JB_CONTRACTS.JBMultiTerminal)
    expect(fal.token).toBe(NATIVE_TOKEN)
    expect(fal.payoutLimits).toEqual([{ amount: parseEther('3.5').toString(), currency: 61166 }])

    const group = cfg.splitGroups.find((g) => g.groupId === BigInt(NATIVE_TOKEN).toString())
    expect(group).toBeDefined()
    expect(group!.splits).toHaveLength(3)
    expect(sumPercents(group!.splits)).toBe(SPLITS_TOTAL)
    expect(group!.splits.every((sp) => sp.percent > 0)).toBe(true)
    // Relative order preserved: 2 ETH row gets the largest share.
    expect(group!.splits[1].percent).toBeGreaterThan(group!.splits[0].percent)
  })

  it('honors a per-chain amount override (num["p:<stage>:<idx>"])', () => {
    const s = initState()
    s.chainIds = [CHAIN_A, CHAIN_B]
    s.stages[0].payoutMode = 'limited'
    s.stages[0].payoutRecipients = [wallet(A1, 0, '1')]
    s.perChain[CHAIN_B] = { num: { 'p:0:0': '2' } }
    const [onA] = buildRulesetConfigsForChain(s, CHAIN_A, 0)
    const [onB] = buildRulesetConfigsForChain(s, CHAIN_B, 0)
    expect(onA.fundAccessLimitGroups[0].payoutLimits[0].amount).toBe(parseEther('1').toString())
    expect(onB.fundAccessLimitGroups[0].payoutLimits[0].amount).toBe(parseEther('2').toString())
  })

  it('adds an unlimited-sentinel limit for unlimited payouts', () => {
    const s = singleChainState()
    s.stages[0].payoutMode = 'unlimited'
    s.stages[0].payoutRecipients = [wallet(A1, 100)]
    const [cfg] = buildRulesetConfigsForChain(s, CHAIN_A, 0)
    expect(cfg.fundAccessLimitGroups[0].payoutLimits).toEqual([{ amount: UINT224_MAX, currency: 61166 }])
  })
})

// ---------------------------------------------------------------------------
// 4. Terminal configs — accepts + swap router
// ---------------------------------------------------------------------------

describe('buildTerminalConfigsForChain', () => {
  it("builds ETH + per-chain USDC contexts for accepts ['eth','usdc'] and appends the router registry", () => {
    const s = singleChainState()
    s.accepts = ['eth', 'usdc']
    s.swapRouter = true
    const configs = buildTerminalConfigsForChain(s, CHAIN_A)
    expect(configs).toHaveLength(2)

    const usdc = CANONICAL_USDC_BY_CHAIN[CHAIN_A]
    expect(configs[0].terminal).toBe(JB_CONTRACTS.JBMultiTerminal)
    expect(configs[0].accountingContextsToAccept).toEqual([
      { token: NATIVE_TOKEN, decimals: 18, currency: 61166 },
      { token: usdc, decimals: 6, currency: Number(BigInt(usdc) & 0xffffffffn) },
    ])

    expect(configs[1]).toEqual({ terminal: JB_ROUTER_TERMINAL_REGISTRY, accountingContextsToAccept: [] })
  })

  it('omits the router registry when swapRouter is off', () => {
    const s = singleChainState()
    s.swapRouter = false
    const configs = buildTerminalConfigsForChain(s, CHAIN_A)
    expect(configs).toHaveLength(1)
    expect(configs[0].terminal).toBe(JB_CONTRACTS.JBMultiTerminal)
  })

  it('uses a single token-keyed context for a custom accounting token', () => {
    const s = singleChainState()
    s.accepts = ['custom']
    s.customToken = { address: HOOK_A, name: 'T', symbol: 'T', decimals: 8, status: 'ok', error: '' }
    const configs = buildTerminalConfigsForChain(s, CHAIN_A)
    expect(configs[0].accountingContextsToAccept).toEqual([
      { token: HOOK_A, decimals: 8, currency: Number(BigInt(HOOK_A) & 0xffffffffn) },
    ])
  })
})

// ---------------------------------------------------------------------------
// 5. Reserved splits — groupId 1, renormalized percents, LP hook rows
// ---------------------------------------------------------------------------

describe('reserved splits', () => {
  it('sets reservedPercent to the row sum ×100 and renormalizes rows to the reserved pool', () => {
    const s = singleChainState()
    s.stages[0].reservedRecipients = [wallet(A1, 10), wallet(A2, 30)]
    const [cfg] = buildRulesetConfigsForChain(s, CHAIN_A, 0)

    expect(cfg.metadata.reservedPercent).toBe(4000) // 40% of issuance

    const group = cfg.splitGroups.find((g) => g.groupId === '1')
    expect(group).toBeDefined()
    // 10/40 and 30/40 of the pool — issuance-% rows converted to pool-%.
    expect(group!.splits.map((sp) => sp.percent)).toEqual([250_000_000, 750_000_000])
    expect(group!.splits.map((sp) => sp.beneficiary)).toEqual([A1, A2])
    expect(sumPercents(group!.splits)).toBe(SPLITS_TOTAL)
  })

  it("routes 'lphook' (fund market) rows to the BannyLPSplitHook", () => {
    const s = singleChainState()
    s.stages[0].reservedRecipients = [
      { type: 'lphook', address: '', projectId: 0, percent: 5 },
      wallet(A1, 5),
    ]
    const [cfg] = buildRulesetConfigsForChain(s, CHAIN_A, 0)
    const group = cfg.splitGroups.find((g) => g.groupId === '1')!
    expect(group.splits[0].hook).toBe(BANNY_LP_SPLIT_HOOK)
    expect(group.splits[0].projectId).toBe(0)
    expect(group.splits[1].hook).toBe(ZERO_ADDRESS)
  })

  it('applies per-chain reserved beneficiary overrides (addr["r:<stage>:<idx>"])', () => {
    const s = initState()
    s.chainIds = [CHAIN_A, CHAIN_B]
    s.stages[0].reservedRecipients = [wallet(A1, 10)]
    s.perChain[CHAIN_B] = { addr: { 'r:0:0': A2 } }
    const [onA] = buildRulesetConfigsForChain(s, CHAIN_A, 0)
    const [onB] = buildRulesetConfigsForChain(s, CHAIN_B, 0)
    expect(onA.splitGroups.find((g) => g.groupId === '1')!.splits[0].beneficiary).toBe(A1)
    expect(onB.splitGroups.find((g) => g.groupId === '1')!.splits[0].beneficiary).toBe(A2)
  })
})

// ---------------------------------------------------------------------------
// Multi-token payouts (accepts eth + usdc)
// ---------------------------------------------------------------------------

describe('multi-token payouts', () => {
  it('builds one split group + fund-access group per token with token-keyed currency/decimals', () => {
    const s = singleChainState()
    s.accepts = ['eth', 'usdc']
    s.stages[0].payoutByKind = {
      eth: { mode: 'limited', recipients: [wallet(A1, 0, '1')] },
      usdc: { mode: 'limited', recipients: [wallet(A2, 0, '100')] },
    }
    const [cfg] = buildRulesetConfigsForChain(s, CHAIN_A, 0)
    const usdc = CANONICAL_USDC_BY_CHAIN[CHAIN_A]

    expect(cfg.splitGroups.map((g) => g.groupId)).toEqual([
      BigInt(NATIVE_TOKEN).toString(),
      BigInt(usdc).toString(),
    ])

    expect(cfg.fundAccessLimitGroups).toHaveLength(2)
    expect(cfg.fundAccessLimitGroups[0].token).toBe(NATIVE_TOKEN)
    expect(cfg.fundAccessLimitGroups[0].payoutLimits[0]).toEqual({
      amount: parseEther('1').toString(),
      currency: 61166,
    })
    expect(cfg.fundAccessLimitGroups[1].token).toBe(usdc)
    expect(cfg.fundAccessLimitGroups[1].payoutLimits[0]).toEqual({
      amount: parseUnits('100', 6).toString(), // USDC amounts use 6 decimals
      currency: Number(BigInt(usdc) & 0xffffffffn),
    })
  })
})

// ---------------------------------------------------------------------------
// 6. Revnet stages
// ---------------------------------------------------------------------------

describe('buildRevnetStageConfigs', () => {
  it("encodes issuance, cuts, splits, and inherit-weight ('' → initialIssuance '0')", () => {
    const s = initState()
    s.projectType = 'revnet'
    s.chainIds = [CHAIN_A]
    s.stages[0].weight = '10000'
    s.stages[0].issuanceCutOn = true
    s.stages[0].cutFreqDays = '30'
    s.stages[0].weightCutPercent = 5
    s.stages[0].cashOutTaxRate = 10
    s.stages[0].reservedRecipients = [wallet(A1, 20)]
    const later = createStage()
    later.weight = '' // inherit — the REV builder's 0-issuance sentinel
    later.startDaysAfter = '45'
    s.stages.push(later)

    const base = 1_000_000
    const configs = buildRevnetStageConfigs(s, base)
    expect(configs).toHaveLength(2)

    expect(configs[0].startsAtOrAfter).toBe(base)
    expect(configs[0].initialIssuance).toBe(parseEther('10000').toString())
    expect(configs[0].issuanceCutFrequency).toBe(30 * 86400)
    expect(configs[0].issuanceCutPercent).toBe(50_000_000) // 5% × 1e7
    expect(configs[0].cashOutTaxRate).toBe(1000)
    expect(configs[0].splitPercent).toBe(2000) // 20% × 100
    expect(configs[0].splits).toEqual([
      { preferAddToBalance: false, percent: SPLITS_TOTAL, projectId: 0, beneficiary: A1, lockedUntil: 0, hook: ZERO_ADDRESS },
    ])
    expect(configs[0].extraMetadata).toBe(0)

    // Stage 2 inherits issuance and snaps its start to the previous stage's
    // 30-day cut boundary: 45 days → 60 days.
    expect(configs[1].initialIssuance).toBe('0')
    expect(configs[1].startsAtOrAfter).toBe(base + 60 * 86400)
    expect(configs[1].issuanceCutFrequency).toBe(0)
  })

  it('honors a scheduled first-stage start and collects auto-issuances', () => {
    const s = initState()
    s.projectType = 'revnet'
    s.chainIds = [CHAIN_A]
    s.stages[0].scheduleOn = true
    s.stages[0].schedule = '1750000000'
    s.stages[0].autoIssuances = [
      { count: '100', address: A1 },
      { count: '', address: A2 }, // empty count → dropped
    ]
    const [cfg] = buildRevnetStageConfigs(s, 999)
    expect(cfg.startsAtOrAfter).toBe(1750000000)
    expect(cfg.autoIssuances).toEqual([
      { chainId: CHAIN_A, count: parseEther('100').toString(), beneficiary: A1 },
    ])
  })
})

// ---------------------------------------------------------------------------
// 7. Deadlines / approval hooks
// ---------------------------------------------------------------------------

describe('approval hooks', () => {
  it("resolves '3days' to the JBDeadline3Days contract", () => {
    const s = singleChainState()
    s.stages[0].deadline = '3days'
    const [cfg] = buildRulesetConfigsForChain(s, CHAIN_A, 0)
    expect(cfg.approvalHook).toBe('0xcda708c98fbdd15a7ff7f0c5c50f9371ca52c78f')
    expect(cfg.approvalHook).toBe(DEADLINE_HOOKS['3days'])
  })

  it("encodes zero for 'none' and when no deadline applies (forever ruleset)", () => {
    const s = singleChainState()
    s.stages[0].deadline = 'none'
    expect(buildRulesetConfigsForChain(s, CHAIN_A, 0)[0].approvalHook).toBe(ZERO_ADDRESS)

    const s2 = singleChainState()
    s2.stages[0].deadline = '1day'
    s2.stages[0].durationSeconds = FOREVER_SECONDS
    expect(buildRulesetConfigsForChain(s2, CHAIN_A, 0)[0].approvalHook).toBe(ZERO_ADDRESS)
  })

  it('uses the custom approval contract with per-chain override', () => {
    const s = initState()
    s.chainIds = [CHAIN_A, CHAIN_B]
    s.stages[0].deadline = 'custom'
    s.approvalAddress = HOOK_A
    s.perChain[CHAIN_B] = { addr: { approval: HOOK_B } }
    expect(buildRulesetConfigsForChain(s, CHAIN_A, 0)[0].approvalHook).toBe(HOOK_A)
    expect(buildRulesetConfigsForChain(s, CHAIN_B, 0)[0].approvalHook).toBe(HOOK_B)
  })
})

// ---------------------------------------------------------------------------
// Multichain start alignment
// ---------------------------------------------------------------------------

describe('mustStartAtOrAfter', () => {
  it('pins the first ruleset to the shared immediateStart on multichain, 0 on single chain', () => {
    const multi = initState()
    multi.chainIds = [CHAIN_A, CHAIN_B]
    multi.stages[0].durationSeconds = 86400
    multi.stages.push(createStage())
    const configs = buildRulesetConfigsForChain(multi, CHAIN_A, 1234567)
    expect(configs[0].mustStartAtOrAfter).toBe(1234567)
    expect(configs[1].mustStartAtOrAfter).toBe(0) // stages 2..N always 0

    const single = singleChainState()
    expect(buildRulesetConfigsForChain(single, CHAIN_A, 1234567)[0].mustStartAtOrAfter).toBe(0)
  })

  it('prefers an explicit schedule over immediateStart', () => {
    const s = initState()
    s.chainIds = [CHAIN_A, CHAIN_B]
    s.stages[0].scheduleOn = true
    s.stages[0].schedule = '1900000000'
    const [cfg] = buildRulesetConfigsForChain(s, CHAIN_A, 1234567)
    expect(cfg.mustStartAtOrAfter).toBe(1900000000)
  })
})

// ---------------------------------------------------------------------------
// 8. 721 deploy config (async — pinning mocked)
// ---------------------------------------------------------------------------

describe('buildDeployTiersConfigFromState', () => {
  function shopState(): CreateFlowState {
    const s = singleChainState()
    s.shopEnabled = true
    s.details.name = 'My Project'
    s.details.ticker = 'MPT'
    const hat = itemDraft()
    hat.name = 'Hat'
    hat.price = '0.01'
    const cap = itemDraft()
    cap.name = 'Cap'
    cap.price = '2'
    cap.limited = true
    cap.supply = '10'
    s.nfts = [hat, cap]
    return s
  }

  it('returns undefined when the shop is off or empty', async () => {
    const off = singleChainState()
    off.shopEnabled = false
    expect(await buildDeployTiersConfigFromState(off)).toBeUndefined()

    const empty = singleChainState()
    empty.shopEnabled = true
    empty.nfts = []
    expect(await buildDeployTiersConfigFromState(empty)).toBeUndefined()
  })

  it('pins each item and builds tiers with prices in store decimals', async () => {
    const s = shopState()
    s.collection.useForRedemptions = true
    const config = await buildDeployTiersConfigFromState(s)

    expect(config).toBeDefined()
    expect(pinMetadata).toHaveBeenCalledTimes(2)
    expect(config!.name).toBe('My Project') // collection name defaults to the project name
    expect(config!.symbol).toBe('MPT') // symbol defaults to the ticker
    expect(config!.tiersConfig.currency).toBe(1)
    expect(config!.tiersConfig.decimals).toBe(18)
    expect(config!.useDataHookForCashOut).toBe(true)

    const [hat, cap] = config!.tiersConfig.tiers
    expect(hat.price).toBe(parseEther('0.01').toString())
    expect(hat.initialSupply).toBe(999999999) // unlimited sentinel
    expect(hat.encodedIPFSUri).toBe(`0x${'11'.repeat(32)}`)
    expect(cap.price).toBe(parseEther('2').toString())
    expect(cap.initialSupply).toBe(10)
    // itemDraft defaults: allowCredits true / ownerCanEditDiscount true → both "cannot" flags off.
    expect(cap.cannotBuyWithCredits).toBe(false)
    expect(cap.cannotIncreaseDiscountPercent).toBe(false)
  })

  it('reuses an already-encoded item without re-pinning', async () => {
    const s = shopState()
    s.nfts = [s.nfts[0]]
    s.nfts[0].encodedIpfsUri = `0x${'22'.repeat(32)}`
    const config = await buildDeployTiersConfigFromState(s)
    expect(pinMetadata).not.toHaveBeenCalled()
    expect(config!.tiersConfig.tiers[0].encodedIPFSUri).toBe(`0x${'22'.repeat(32)}`)
  })

  it('sorts tiers by category ascending (stable within a category)', async () => {
    const s = shopState()
    s.nfts[0].category = 2 // Hat
    s.nfts[1].category = 1 // Cap
    const config = await buildDeployTiersConfigFromState(s)
    expect(config!.tiersConfig.tiers.map((t) => t.category)).toEqual([1, 2])
    expect(config!.tiersConfig.tiers[0].price).toBe(parseEther('2').toString()) // Cap first
  })
})

// ---------------------------------------------------------------------------
// Per-chain overrides (terminals + tier include/supply)
// ---------------------------------------------------------------------------

describe('buildChainConfigOverrides', () => {
  it('gives every chain its own terminal configs (per-chain USDC address)', () => {
    const s = initState()
    s.chainIds = [CHAIN_A, CHAIN_B]
    s.accepts = ['usdc']
    const overrides = buildChainConfigOverrides(s, s.chainIds, 0)
    expect(overrides.map((o) => o.chainId)).toEqual([CHAIN_A, CHAIN_B])
    const tokenOn = (i: number) => overrides[i].terminalConfigurations![0].accountingContextsToAccept[0].token
    expect(tokenOn(0)).toBe(CANONICAL_USDC_BY_CHAIN[CHAIN_A])
    expect(tokenOn(1)).toBe(CANONICAL_USDC_BY_CHAIN[CHAIN_B])
    expect(overrides[0].tiers).toBeUndefined()
  })

  it('filters excluded items and applies supply overrides per chain', async () => {
    const s = initState()
    s.chainIds = [CHAIN_A, CHAIN_B]
    s.shopEnabled = true
    const item0 = itemDraft()
    item0.name = 'Zero'
    const item1 = itemDraft()
    item1.name = 'One'
    s.nfts = [item0, item1]
    // On CHAIN_B: drop item 1, cap item 0's supply at 5.
    s.perChain[CHAIN_B] = { num: { 'item:1': '0', 'isupply:0': '5' } }

    const config = await buildDeployTiersConfigFromState(s)
    const overrides = buildChainConfigOverrides(s, s.chainIds, 0, config!.tiersConfig.tiers)

    expect(overrides[0].tiers).toHaveLength(2)
    expect(overrides[0].tiers![0].initialSupply).toBe(999999999)

    expect(overrides[1].tiers).toHaveLength(1)
    expect(overrides[1].tiers![0].encodedIPFSUri).toBe(config!.tiersConfig.tiers[0].encodedIPFSUri)
    expect(overrides[1].tiers![0].initialSupply).toBe(5)
  })
})
