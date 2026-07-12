import { describe, expect, it } from 'vitest'
import { zeroAddress } from 'viem'
import { JB_CONTRACTS, NATIVE_TOKEN } from '../constants'
import type { JBRulesetConfig } from '../services/relayr'
import {
  assertPreservedSplitGroups,
  assertRecognizedAccountingContexts,
  assertRulesetConfigurationSafe,
  type VerifiedAccountingContext,
} from './rulesetSafety'

const RECIPIENT = '0x1234567890123456789012345678901234567890'
const contexts: VerifiedAccountingContext[] = [{
  terminal: JB_CONTRACTS.JBMultiTerminal,
  token: NATIVE_TOKEN,
  tokenDecimals: 18,
  currency: 61166,
}]

function config(overrides: Partial<JBRulesetConfig> = {}): JBRulesetConfig {
  return {
    mustStartAtOrAfter: Math.floor(Date.now() / 1000) + 300,
    duration: 0,
    weight: '1000000000000000000',
    weightCutPercent: 0,
    approvalHook: zeroAddress,
    metadata: {
      reservedPercent: 0,
      cashOutTaxRate: 0,
      baseCurrency: 61166,
      pausePay: false,
      pauseCreditTransfers: false,
      allowOwnerMinting: true,
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
      dataHook: zeroAddress,
      metadata: 0,
    },
    splitGroups: [],
    fundAccessLimitGroups: [],
    ...overrides,
  }
}

describe('rulesetSafety', () => {
  it('accepts a recognized token-keyed ruleset', () => {
    expect(() => assertRulesetConfigurationSafe(1, config(), contexts)).not.toThrow()
  })

  it('blocks an accounting context whose currency is not derived from its token', () => {
    expect(() => assertRecognizedAccountingContexts(1, [{ ...contexts[0], currency: 1 }]))
      .toThrow('Accounting context is not recognized')
  })

  it('blocks a ruleset base currency that is not a live accounting currency', () => {
    const unsafe = config({ metadata: { ...config().metadata, baseCurrency: 1 } })
    expect(() => assertRulesetConfigurationSafe(1, unsafe, contexts))
      .toThrow('Base currency is not tied')
  })

  it('blocks fund access currency conversion', () => {
    const unsafe = config({
      fundAccessLimitGroups: [{
        terminal: JB_CONTRACTS.JBMultiTerminal,
        token: NATIVE_TOKEN,
        payoutLimits: [{ amount: '1', currency: 1 }],
        surplusAllowances: [],
      }],
    })
    expect(() => assertRulesetConfigurationSafe(1, unsafe, contexts))
      .toThrow('currency conversion is not supported')
  })

  it('blocks a stale recipient snapshot', () => {
    const proposed = [{
      groupId: BigInt(NATIVE_TOKEN).toString(),
      splits: [{
        percent: 1_000_000_000,
        projectId: 0,
        beneficiary: RECIPIENT,
        preferAddToBalance: false,
        lockedUntil: 0,
        hook: zeroAddress,
      }],
    }]
    const current = [{
      ...proposed[0],
      splits: [{ ...proposed[0].splits[0], percent: 500_000_000 }],
    }]
    expect(() => assertPreservedSplitGroups(proposed, current)).toThrow('latest split recipients')
  })
})
