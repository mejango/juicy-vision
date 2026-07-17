/**
 * Round-trip tests for the "Copy this project" exporter: build a draft from a
 * mock LIVE project, push it through the create-flow's own sanitize + import
 * (mergeDraft) path, and assert the configuration survives intact.
 *
 * mergeDraft/sanitizeState are imported from create-flow/state — the shared
 * website-interchange .jb schema — not reimplemented here.
 */

import { describe, expect, it } from 'vitest'
import {
  buildDraftFromLive,
  deadlineFor,
  type DraftFundsSnapshot,
  type DraftProjectInput,
  type DraftRuleset,
  type DraftRulesetMetadata,
  type DraftSplit,
} from './projectDraftExport'
import { mergeDraft, sanitizeState, type CreateFlowState } from '../components/dynamic/create-flow/state'
import { DEADLINE_HOOKS } from '../components/dynamic/create-flow/builders'

// The vitest setup stubs VITE_TESTNET_MODE=true, so this build's chains are the
// Sepolia testnets — fixtures use testnet chain ids + the Sepolia USDC address
// so drafts survive mergeDraft's chain mapping unchanged.
const CHAIN = 11155111
const CHAIN_SET = [11155111, 11155420, 84532]
const NATIVE = '0x000000000000000000000000000000000000EEEe'
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const OWNER = '0x1111111111111111111111111111111111111111'
const FRIEND = '0x2222222222222222222222222222222222222222'
const HOOK = '0x3333333333333333333333333333333333333333'
const ZERO = '0x0000000000000000000000000000000000000000'
const REV_OWNER = '0x2ba4705ad0332cdfb299b452068438bcba3faaf3'

const SPLITS_TOTAL = 1_000_000_000
const UNLIMITED = ((1n << 224n) - 1n).toString()

function metadataFixture(overrides: Partial<DraftRulesetMetadata> = {}): DraftRulesetMetadata {
  return {
    reservedPercent: 0,
    cashOutTaxRate: 0,
    baseCurrency: 1,
    pausePay: false,
    pauseCreditTransfers: false,
    allowOwnerMinting: false,
    allowSetCustomToken: false,
    allowTerminalMigration: false,
    allowSetTerminals: false,
    allowSetController: false,
    allowAddAccountingContext: false,
    allowAddPriceFeed: false,
    ownerMustSendPayouts: false,
    holdFees: false,
    scopeCashOutsToLocalBalances: false,
    useDataHookForPay: false,
    useDataHookForCashOut: false,
    dataHook: ZERO,
    metadata: 0,
    ...overrides,
  }
}

function rulesetFixture(overrides: Partial<DraftRuleset> = {}, metadata: Partial<DraftRulesetMetadata> = {}): DraftRuleset {
  return {
    id: '1000',
    duration: 7 * 86400,
    weight: (10_000n * 10n ** 18n).toString(), // 10,000 tokens per ETH
    weightCutPercent: 0,
    approvalHook: ZERO,
    metadata: metadataFixture(metadata),
    ...overrides,
  }
}

function split(overrides: Partial<DraftSplit> = {}): DraftSplit {
  return {
    percent: SPLITS_TOTAL,
    projectId: 0,
    beneficiary: FRIEND,
    preferAddToBalance: false,
    lockedUntil: 0,
    hook: ZERO,
    ...overrides,
  }
}

function fundsFixture(overrides: Partial<DraftFundsSnapshot> = {}): DraftFundsSnapshot {
  return {
    reservedSplits: [],
    payoutSplitsByToken: { [NATIVE.toLowerCase()]: [] },
    fundAccessByToken: {},
    ...overrides,
  }
}

function inputFixture(overrides: Partial<DraftProjectInput> = {}): DraftProjectInput {
  return {
    projectId: 42,
    chainId: CHAIN,
    chainIds: [CHAIN],
    isRevnet: false,
    owner: OWNER,
    metadata: {
      name: 'Orange Stand',
      symbol: 'ORNG',
      projectTagline: 'Fresh juice',
      description: 'A juicy project.',
      logoUri: 'ipfs://logo',
      infoUri: 'https://orange.example',
      twitter: 'orangestand',
      tags: ['juice', 'fruit'],
    },
    contexts: [{ token: NATIVE, decimals: 18, currency: Number(BigInt(NATIVE) & 0xffff_ffffn) }],
    usesRouterTerminalRegistry: false,
    current: { ruleset: rulesetFixture(), funds: fundsFixture() },
    upcoming: null,
    ...overrides,
  }
}

/** Export → sanitize → JSON → mergeDraft, exactly like a .jb file round-trip. */
function roundTrip(state: CreateFlowState): CreateFlowState {
  const json = JSON.parse(JSON.stringify(sanitizeState(state)))
  const merged = mergeDraft(json)
  expect(merged).not.toBeNull()
  return merged as CreateFlowState
}

describe('buildDraftFromLive → mergeDraft round trip', () => {
  it('keeps details, chain set, and core ruleset fields', () => {
    const { state, warnings } = buildDraftFromLive(inputFixture({
      chainIds: CHAIN_SET,
      current: {
        ruleset: rulesetFixture({
          duration: 14 * 86400,
          weightCutPercent: 5e7, // 5% of 1e9
          approvalHook: DEADLINE_HOOKS['3days'],
        }, {
          reservedPercent: 5000, // 50% in bp
          cashOutTaxRate: 2500,
          allowOwnerMinting: true,
          holdFees: true,
        }),
        funds: fundsFixture({
          reservedSplits: [split({ percent: SPLITS_TOTAL / 2 })], // half the reserved pool
        }),
      },
    }))

    const merged = roundTrip(state)
    expect(merged.projectType).toBe('custom')
    expect(merged.network).toBe('testnet')
    expect(merged.chainIds).toEqual(CHAIN_SET)
    expect(merged.details.name).toBe('Orange Stand')
    expect(merged.details.ticker).toBe('ORNG')
    expect(merged.details.tagline).toBe('Fresh juice')
    expect(merged.details.owner).toBe(OWNER)
    expect(merged.details.tags).toEqual(['juice', 'fruit'])
    expect(merged.accepts).toEqual(['eth'])
    expect(merged.swapRouter).toBe(false)

    expect(merged.stages).toHaveLength(1)
    const stage = merged.stages[0]
    expect(stage.durationSeconds).toBe(14 * 86400)
    expect(stage.weight).toBe('10000')
    expect(stage.tokenMode).toBe('custom')
    expect(stage.weightCutPercent).toBe(5)
    expect(stage.issuanceCutOn).toBe(true)
    expect(stage.cashOutTaxRate).toBe(25)
    expect(stage.cashOutEnabled).toBe(true)
    expect(stage.allowOwnerMinting).toBe(true)
    expect(stage.holdFees).toBe(true)
    expect(stage.deadline).toBe('3days')

    // 50% reserved rate: split gets half (25% of issuance), owner remainder the other half.
    expect(stage.reservedRecipients).toHaveLength(2)
    expect(stage.reservedRecipients[0]).toMatchObject({ type: 'wallet', address: FRIEND, percent: 25 })
    expect(stage.reservedRecipients[1]).toMatchObject({ type: 'wallet', address: OWNER, percent: 25 })

    // Multi-chain exports disclose that other chains weren't compared.
    expect(warnings.some((w) => w.includes('was not compared'))).toBe(true)
  })

  it('reconstructs a limited payout with an explicit owner remainder', () => {
    const total = 8n * 10n ** 18n // 8 ETH
    const { state } = buildDraftFromLive(inputFixture({
      current: {
        ruleset: rulesetFixture(),
        funds: fundsFixture({
          payoutSplitsByToken: {
            [NATIVE.toLowerCase()]: [
              split({ percent: SPLITS_TOTAL / 4, beneficiary: FRIEND }),
              split({ percent: SPLITS_TOTAL / 4, projectId: 7, beneficiary: OWNER }),
            ],
          },
          fundAccessByToken: {
            [NATIVE.toLowerCase()]: {
              payoutLimits: [{ amount: total.toString(), currency: 1 }],
              surplusAllowances: [],
            },
          },
        }),
      },
    }))

    const stage = roundTrip(state).stages[0]
    expect(stage.payoutMode).toBe('limited')
    expect(stage.payoutCurrency).toBe(1)
    expect(stage.payoutRecipients).toHaveLength(3)
    expect(stage.payoutRecipients[0]).toMatchObject({ type: 'wallet', address: FRIEND, amountEth: '2' })
    expect(stage.payoutRecipients[1]).toMatchObject({ type: 'project', projectId: 7, amountEth: '2' })
    // The unallocated half goes to the owner explicitly so the limit total is preserved.
    expect(stage.payoutRecipients[2]).toMatchObject({ type: 'wallet', address: OWNER, amountEth: '4' })
  })

  it('reconstructs unlimited payouts and surplus allowances', () => {
    const { state } = buildDraftFromLive(inputFixture({
      current: {
        ruleset: rulesetFixture(),
        funds: fundsFixture({
          payoutSplitsByToken: {
            [NATIVE.toLowerCase()]: [split({ percent: SPLITS_TOTAL, hook: HOOK })],
          },
          fundAccessByToken: {
            [NATIVE.toLowerCase()]: {
              payoutLimits: [{ amount: UNLIMITED, currency: 1 }],
              surplusAllowances: [],
            },
          },
        }),
      },
    }))

    const stage = roundTrip(state).stages[0]
    expect(stage.payoutMode).toBe('unlimited')
    expect(stage.payoutRecipients).toHaveLength(1)
    expect(stage.payoutRecipients[0]).toMatchObject({ type: 'customhook', hookAddress: HOOK, percent: 100 })
  })

  it('keeps a finite surplus allowance in single-token mode', () => {
    const { state } = buildDraftFromLive(inputFixture({
      current: {
        ruleset: rulesetFixture(),
        funds: fundsFixture({
          fundAccessByToken: {
            [NATIVE.toLowerCase()]: {
              payoutLimits: [],
              surplusAllowances: [{ amount: (2n * 10n ** 18n).toString(), currency: 1 }],
            },
          },
        }),
      },
    }))

    const stage = roundTrip(state).stages[0]
    expect(stage.payoutMode).toBe('none')
    expect(stage.surplusAllowanceOn).toBe(true)
    expect(stage.surplusAllowanceUnlimited).toBe(false)
    expect(stage.surplusAllowanceAmount).toBe('2')
    expect(stage.surplusAllowanceCurrency).toBe(1)
  })

  it('handles ETH+USDC projects per token kind', () => {
    const usdcCurrency = Number(BigInt(USDC_SEPOLIA) & 0xffff_ffffn)
    const { state } = buildDraftFromLive(inputFixture({
      contexts: [
        { token: NATIVE, decimals: 18, currency: Number(BigInt(NATIVE) & 0xffff_ffffn) },
        { token: USDC_SEPOLIA, decimals: 6, currency: usdcCurrency },
      ],
      usesRouterTerminalRegistry: true,
      current: {
        ruleset: rulesetFixture(),
        funds: fundsFixture({
          payoutSplitsByToken: {
            [NATIVE.toLowerCase()]: [],
            [USDC_SEPOLIA.toLowerCase()]: [split({ percent: SPLITS_TOTAL })],
          },
          fundAccessByToken: {
            [USDC_SEPOLIA.toLowerCase()]: {
              payoutLimits: [{ amount: (500n * 10n ** 6n).toString(), currency: usdcCurrency }],
              surplusAllowances: [{ amount: UNLIMITED, currency: usdcCurrency }],
            },
            [NATIVE.toLowerCase()]: {
              payoutLimits: [],
              surplusAllowances: [{ amount: UNLIMITED, currency: 1 }],
            },
          },
        }),
      },
    }))

    const merged = roundTrip(state)
    expect(merged.accepts).toEqual(['eth', 'usdc'])
    expect(merged.swapRouter).toBe(true)
    const stage = merged.stages[0]
    expect(stage.payoutByKind.usdc.mode).toBe('limited')
    expect(stage.payoutByKind.usdc.recipients[0]).toMatchObject({ amountEth: '500' })
    expect(stage.payoutByKind.eth.mode).toBe('none')
    expect(stage.surplusAllowanceOn).toBe(true)
    expect(stage.surplusAllowanceUnlimited).toBe(true)
  })

  it('reconstructs a custom accounting token project', () => {
    const TOKEN = '0x4444444444444444444444444444444444444444'
    const { state } = buildDraftFromLive(inputFixture({
      contexts: [{ token: TOKEN, decimals: 8, currency: Number(BigInt(TOKEN) & 0xffff_ffffn), symbol: 'WIDGET' }],
      current: {
        ruleset: rulesetFixture(),
        funds: fundsFixture({ payoutSplitsByToken: { [TOKEN.toLowerCase()]: [] } }),
      },
    }))

    const merged = roundTrip(state)
    expect(merged.accepts).toEqual(['custom'])
    expect(merged.customToken).toMatchObject({ address: TOKEN, symbol: 'WIDGET', decimals: 8, status: 'ok' })
  })

  it('adds a queued upcoming ruleset as a second stage', () => {
    const { state } = buildDraftFromLive(inputFixture({
      current: { ruleset: rulesetFixture({ id: '1000', duration: 86400 }), funds: fundsFixture() },
      upcoming: {
        ruleset: rulesetFixture({ id: '2000', duration: 0, weight: '0' }, { cashOutTaxRate: 10000 }),
        funds: fundsFixture(),
      },
    }))

    const merged = roundTrip(state)
    expect(merged.stages).toHaveLength(2)
    expect(merged.stages[1].tokenMode).toBe('none')
    expect(merged.stages[1].cashOutEnabled).toBe(false)
    expect(merged.afterMode).toBe('wait')
  })

  it('builds the revnet variant from the live stage', () => {
    const OPERATOR = '0x5555555555555555555555555555555555555555'
    const { state, warnings } = buildDraftFromLive(inputFixture({
      isRevnet: true,
      owner: OPERATOR,
      current: {
        ruleset: rulesetFixture({ duration: 30 * 86400 }, { dataHook: REV_OWNER, baseCurrency: 1, reservedPercent: 3800 }),
        funds: fundsFixture(),
      },
    }))

    const merged = roundTrip(state)
    expect(merged.projectType).toBe('revnet')
    expect(merged.revOperator).toBe(OPERATOR)
    expect(merged.stages[0].cutFreqDays).toBe('30')
    expect(merged.stages[0].issuanceCutOn).toBe(true)
    expect(merged.revBaseCurrency).toBe(1)
    expect(warnings.some((w) => w.includes('auto-issuance'))).toBe(true)
  })

  it('maps every known deadline hook back to its key', () => {
    for (const [key, hook] of Object.entries(DEADLINE_HOOKS)) {
      expect(deadlineFor(hook).key).toBe(key)
    }
    expect(deadlineFor(ZERO).key).toBe('none')
    expect(deadlineFor(HOOK)).toEqual({ key: 'custom', address: HOOK })
  })

  it('preserves a custom approval hook address through the round trip', () => {
    const { state } = buildDraftFromLive(inputFixture({
      current: { ruleset: rulesetFixture({ approvalHook: HOOK }), funds: fundsFixture() },
    }))
    const merged = roundTrip(state)
    expect(merged.stages[0].deadline).toBe('custom')
    expect(merged.approvalAddress).toBe(HOOK)
  })
})

describe('buildDraftFromLive guards', () => {
  it('refuses owner-must-send-payouts rulesets', () => {
    expect(() => buildDraftFromLive(inputFixture({
      current: { ruleset: rulesetFixture({}, { ownerMustSendPayouts: true }), funds: fundsFixture() },
    }))).toThrow(/owner-sent payouts/)
  })

  it('refuses non-standard cash-out scoping', () => {
    expect(() => buildDraftFromLive(inputFixture({
      current: { ruleset: rulesetFixture({}, { scopeCashOutsToLocalBalances: true }), funds: fundsFixture() },
    }))).toThrow(/scopes cash outs/)
  })

  it('refuses custom data hooks (onchain shops) instead of dropping them', () => {
    expect(() => buildDraftFromLive(inputFixture({
      current: { ruleset: rulesetFixture({}, { dataHook: HOOK, useDataHookForPay: true }), funds: fundsFixture() },
    }))).toThrow(/data hook/)
  })

  it('refuses a revnet whose data hook is not REVOwner', () => {
    expect(() => buildDraftFromLive(inputFixture({
      isRevnet: true,
      current: { ruleset: rulesetFixture({}, { dataHook: HOOK }), funds: fundsFixture() },
    }))).toThrow(/REVOwner/)
  })

  it('refuses locked splits on a flexible (zero-duration) ruleset', () => {
    expect(() => buildDraftFromLive(inputFixture({
      current: {
        ruleset: rulesetFixture({ duration: 0 }),
        funds: fundsFixture({ reservedSplits: [split({ percent: SPLITS_TOTAL, lockedUntil: 2_000_000_000 })] }),
      },
    }))).toThrow(/locked splits/)
  })

  it('refuses multiple fund-access currencies for one token', () => {
    expect(() => buildDraftFromLive(inputFixture({
      current: {
        ruleset: rulesetFixture(),
        funds: fundsFixture({
          fundAccessByToken: {
            [NATIVE.toLowerCase()]: {
              payoutLimits: [{ amount: '1', currency: 1 }, { amount: '2', currency: 2 }],
              surplusAllowances: [],
            },
          },
        }),
      },
    }))).toThrow(/multiple fund-access currencies/)
  })

  it('refuses mixed mainnet + testnet chain sets', () => {
    expect(() => buildDraftFromLive(inputFixture({ chainIds: [1, 11155111] })))
      .toThrow(/mix mainnet and testnet/)
  })

  it('refuses a queued ruleset after a flexible current ruleset', () => {
    expect(() => buildDraftFromLive(inputFixture({
      current: { ruleset: rulesetFixture({ id: '1000', duration: 0 }), funds: fundsFixture() },
      upcoming: { ruleset: rulesetFixture({ id: '2000' }), funds: fundsFixture() },
    }))).toThrow(/flexible current ruleset/)
  })

  it('refuses a queued ruleset that changes data-hook behavior', () => {
    expect(() => buildDraftFromLive(inputFixture({
      current: { ruleset: rulesetFixture({ id: '1000', duration: 86400 }), funds: fundsFixture() },
      upcoming: {
        ruleset: rulesetFixture({ id: '2000' }, { useDataHookForCashOut: true }),
        funds: fundsFixture(),
      },
    }))).toThrow(/data-hook behavior/)
  })

  it('warns (not edits) about custom metadata bits', () => {
    const { warnings } = buildDraftFromLive(inputFixture({
      current: { ruleset: rulesetFixture({}, { metadata: 3 }), funds: fundsFixture() },
    }))
    expect(warnings.some((w) => w.includes('custom metadata bits'))).toBe(true)
  })
})
