import { describe, expect, it, vi } from 'vitest'
import { decodeErrorResult, encodeErrorResult, toFunctionSelector, type Address, type PublicClient } from 'viem'
import { JB_CONTRACTS, NATIVE_TOKEN } from '../constants'
import {
  accountingAmountInConfiguredCurrency,
  formatFundAccessAmount,
  fundAccessErrorMessage,
  FUND_ACCESS_TERMINAL_ABI,
  MAX_UINT224,
  parseFundAccessAmount,
  prepareFundAccessTransaction,
  protectedFundAccessOutput,
  readFundAccessContexts,
  remainingAccessAmount,
} from './fundAccess'

const PROJECT_ID = 7n
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const ACCOUNTING_CURRENCY = 61_166n
const USD = 2n
const USD_PER_ETH = 1_817_530_000_000_000_000_000n

interface MockState {
  balance: bigint
  surplus: bigint
  price: bigint
  payoutLimit: bigint
  payoutUsed: bigint
  allowance: bigint
  allowanceUsed: bigint
  quotedPayout: bigint
  quotedAllowance: bigint
  currency: bigint
}

function mockClient(overrides: Partial<MockState> = {}): { client: PublicClient; state: MockState } {
  const state: MockState = {
    balance: 25_000_000_000_000n,
    surplus: 20_000_000_000_000n,
    price: USD_PER_ETH,
    payoutLimit: 100n * 10n ** 18n,
    payoutUsed: 0n,
    allowance: 100n * 10n ** 18n,
    allowanceUsed: 0n,
    quotedPayout: 25_000_000_000_000n,
    quotedAllowance: 19_500_000_000_000n,
    currency: USD,
    ...overrides,
  }
  const readContract = vi.fn(async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
    switch (functionName) {
      case 'terminalsOf': return [JB_CONTRACTS.JBMultiTerminal]
      case 'controllerOf': return JB_CONTRACTS.JBController
      case 'accountingContextsOf': return [{ token: NATIVE_TOKEN, decimals: 18, currency: Number(ACCOUNTING_CURRENCY) }]
      case 'STORE': return JB_CONTRACTS.JBTerminalStore
      case 'PRICES': return JB_CONTRACTS.JBPrices
      case 'RULESETS': return JB_CONTRACTS.JBRulesets
      case 'FUND_ACCESS_LIMITS': return JB_CONTRACTS.JBFundAccessLimits
      case 'currentOf': return {
        cycleNumber: 4n,
        id: 123n,
        basedOnId: 0n,
        start: 0n,
        duration: 0,
        weight: 0n,
        weightCutPercent: 0,
        approvalHook: '0x0000000000000000000000000000000000000000',
        metadata: 0n,
      }
      case 'balanceOf': return state.balance
      case 'currentSurplusOf': return state.surplus
      case 'payoutLimitsOf': return [{ amount: state.payoutLimit, currency: Number(state.currency) }]
      case 'surplusAllowancesOf': return [{ amount: state.allowance, currency: Number(state.currency) }]
      case 'usedPayoutLimitOf': return state.payoutUsed
      case 'usedSurplusAllowanceOf': return state.allowanceUsed
      case 'pricePerUnitOf': {
        expect(args?.slice(1)).toEqual([state.currency, ACCOUNTING_CURRENCY, 18n])
        return state.price
      }
      default: throw new Error(`Unexpected read ${functionName}`)
    }
  })
  const simulateContract = vi.fn(async ({ functionName }: { functionName: string }) => ({
    result: functionName === 'sendPayoutsOf' ? state.quotedPayout : state.quotedAllowance,
  }))
  return { client: { readContract, simulateContract } as unknown as PublicClient, state }
}

describe('deployed V6 fund access math', () => {
  it('uses the exact deployed transaction selectors', () => {
    const sendPayouts = FUND_ACCESS_TERMINAL_ABI.find(item => item.name === 'sendPayoutsOf')!
    const useAllowance = FUND_ACCESS_TERMINAL_ABI.find(item => item.name === 'useAllowanceOf')!
    expect(toFunctionSelector(sendPayouts)).toBe('0xcfaf5839')
    expect(toFunctionSelector(useAllowance)).toBe('0x748e821c')
    const staleBalance = encodeErrorResult({
      abi: FUND_ACCESS_TERMINAL_ABI,
      errorName: 'JBTerminalStore_InadequateTerminalStoreBalance',
      args: [2n, 1n],
    })
    expect(staleBalance.slice(0, 10)).toBe('0x9fa59b9a')
    expect(decodeErrorResult({ abi: FUND_ACCESS_TERMINAL_ABI, data: staleBalance }).errorName).toBe(
      'JBTerminalStore_InadequateTerminalStoreBalance',
    )
  })

  it('converts 0.000025 ETH at 1,817.53 USD/ETH to exactly 0.04543825 USD', () => {
    const balance = 25_000_000_000_000n
    expect(accountingAmountInConfiguredCurrency(balance, USD_PER_ETH)).toBe(45_438_250_000_000_000n)
    expect(formatFundAccessAmount(45_438_250_000_000_000n, 18)).toBe('0.04543825')
  })

  it('distinguishes exact currency IDs instead of normalizing equivalent-looking IDs', () => {
    expect(accountingAmountInConfiguredCurrency(42n, 10n ** 18n)).toBe(42n)
    expect(ACCOUNTING_CURRENCY).not.toBe(1n)
    expect(BigInt(NATIVE_TOKEN) & 0xffff_ffffn).toBe(ACCOUNTING_CURRENCY)
  })

  it('skips price conversion only for an exactly equal accounting currency ID', async () => {
    const { client } = mockClient({ currency: ACCOUNTING_CURRENCY })
    const [context] = await readFundAccessContexts(client, 1, PROJECT_ID)
    expect(context.payoutLimits[0].pricePerUnit).toBe(10n ** 18n)
    expect(context.payoutLimits[0].available).toBe(context.balance)
    expect(vi.mocked(client.readContract).mock.calls.some(([request]) =>
      request.functionName === 'pricePerUnitOf'
    )).toBe(false)
  })

  it('floors integer conversion at boundaries', () => {
    expect(accountingAmountInConfiguredCurrency(1n, 1_500_000_000_000_000_000n)).toBe(1n)
    expect(accountingAmountInConfiguredCurrency(2n, 1_500_000_000_000_000_000n)).toBe(3n)
    expect(protectedFundAccessOutput(1n, false)).toBe(1n)
    expect(protectedFundAccessOutput(101n, false)).toBe(99n)
    expect(protectedFundAccessOutput(101n, true)).toBe(101n)
  })

  it('saturates depleted limits and allowances at zero', () => {
    expect(remainingAccessAmount(9n, 9n)).toBe(0n)
    expect(remainingAccessAmount(9n, 10n)).toBe(0n)
  })

  it('rejects a depleted payout limit and a withdrawal with no current surplus', async () => {
    const depletedPayout = mockClient({ payoutLimit: 9n, payoutUsed: 9n })
    await expect(prepareFundAccessTransaction({
      client: depletedPayout.client,
      chainId: 1,
      projectId: PROJECT_ID,
      token: NATIVE_TOKEN,
      currency: USD,
      amount: 1n,
      account: ACCOUNT,
      kind: 'payout',
    })).rejects.toThrow('payout limit is depleted')

    const depletedSurplus = mockClient({ surplus: 0n })
    await expect(prepareFundAccessTransaction({
      client: depletedSurplus.client,
      chainId: 1,
      projectId: PROJECT_ID,
      token: NATIVE_TOKEN,
      currency: USD,
      amount: 1n,
      account: ACCOUNT,
      kind: 'allowance',
    })).rejects.toThrow('current surplus or price changed')
  })

  it('preserves uint224 unlimited sentinels as bigint', async () => {
    const { client } = mockClient({ allowance: MAX_UINT224, allowanceUsed: 123n })
    const [context] = await readFundAccessContexts(client, 1, PROJECT_ID)
    expect(context.surplusAllowances[0].configured).toBe(MAX_UINT224)
    expect(context.surplusAllowances[0].unlimited).toBe(true)
    expect(context.surplusAllowances[0].remaining).toBe(MAX_UINT224 - 123n)
  })

  it('reads live ruleset usage, balance, surplus, and cross-currency price', async () => {
    const { client } = mockClient()
    const [context] = await readFundAccessContexts(client, 1, PROJECT_ID)
    expect(context.rulesetId).toBe(123n)
    expect(context.rulesetCycleNumber).toBe(4n)
    expect(context.balance).toBe(25_000_000_000_000n)
    expect(context.currentSurplus).toBe(20_000_000_000_000n)
    expect(context.payoutLimits[0].available).toBe(45_438_250_000_000_000n)
    expect(context.surplusAllowances[0].available).toBe(36_350_600_000_000_000n)
  })

  it('rejects a balance change between form load and submission', async () => {
    const { client, state } = mockClient()
    const [loaded] = await readFundAccessContexts(client, 1, PROJECT_ID)
    expect(loaded.payoutLimits[0].available).toBeGreaterThan(0n)
    state.balance = 0n
    await expect(prepareFundAccessTransaction({
      client,
      chainId: 1,
      projectId: PROJECT_ID,
      token: NATIVE_TOKEN,
      currency: USD,
      amount: 1n,
      account: ACCOUNT,
      kind: 'payout',
    })).rejects.toThrow('balance or price changed')
  })

  it('rejects a price change that newly unfunds the selected amount', async () => {
    const { client, state } = mockClient()
    state.price = 1n
    await expect(prepareFundAccessTransaction({
      client,
      chainId: 1,
      projectId: PROJECT_ID,
      token: NATIVE_TOKEN,
      currency: USD,
      amount: 1n,
      account: ACCOUNT,
      kind: 'payout',
    })).rejects.toThrow('balance or price changed')
  })

  it('simulates a quote and then the exact final call with a nonzero protected minimum', async () => {
    const { client } = mockClient({ quotedPayout: 10_000n })
    const result = await prepareFundAccessTransaction({
      client,
      chainId: 1,
      projectId: PROJECT_ID,
      token: NATIVE_TOKEN,
      currency: USD,
      amount: 1n,
      account: ACCOUNT,
      kind: 'payout',
    })
    expect(result.minimumOutput).toBe(9_900n)
    expect(vi.mocked(client.simulateContract)).toHaveBeenNthCalledWith(1, expect.objectContaining({
      functionName: 'sendPayoutsOf',
      args: [PROJECT_ID, NATIVE_TOKEN, 1n, USD, 0n],
    }))
    expect(vi.mocked(client.simulateContract)).toHaveBeenNthCalledWith(2, expect.objectContaining({
      functionName: 'sendPayoutsOf',
      args: [PROJECT_ID, NATIVE_TOKEN, 1n, USD, 9_900n],
    }))
    expect(result.data.slice(0, 10)).toBe('0xcfaf5839')
  })

  it('decodes raw stale-balance custom error selectors through nested causes', () => {
    expect(fundAccessErrorMessage({ cause: { data: '0x9fa59b9a00000000' } }, 'payout')).toBe(
      'The terminal balance or price changed. Review the updated available amount and try again.',
    )
    expect(fundAccessErrorMessage(new Error('JBTerminalStore_InadequateTerminalStoreBalance'), 'allowance')).toBe(
      'The current surplus or price changed. Review the updated available amount and try again.',
    )
  })

  it('parses and formats large values without floating point', () => {
    const raw = parseFundAccessAmount('12345678901234567890.123456789012345678', 18)
    expect(raw).toBe(12_345_678_901_234_567_890_123_456_789_012_345_678n)
    expect(formatFundAccessAmount(raw!, 18)).toBe('12345678901234567890.12345678')
  })
})
