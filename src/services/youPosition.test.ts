import { describe, expect, it } from 'vitest'
import type { Address, PublicClient } from 'viem'
import { NATIVE_TOKEN, USDC_ADDRESSES } from '../constants'
import { calculateCashOutValue } from './bendystraw'
import {
  describeAccountingToken,
  hasRevLoans,
  isCashOutLocked,
  loadYouPosition,
  monetaryTotalIfComplete,
  totalIfComplete,
  type YouPositionRow,
} from './youPosition'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const CONTROLLER = '0x2222222222222222222222222222222222222222' as Address
const NATIVE_CURRENCY = 61166 // uint32(uint160(0x…EEEe)) — the native accounting-context id
const CHAIN = 1

interface MockState {
  balance: bigint | Error
  credit: bigint | Error
  supply: bigint | Error
  surplus: bigint
  taxRate: number
  delay: bigint | Error
  borrowableNow: bigint | Error
  contexts: Array<{ token: Address; decimals: number; currency: number }> | Error
}

interface RecordedCall {
  functionName: string
  args: readonly unknown[]
}

function defaults(): MockState {
  return {
    balance: 100n * 10n ** 18n,
    credit: 40n * 10n ** 18n,
    supply: 1_000n * 10n ** 18n,
    surplus: 50n * 10n ** 18n,
    taxRate: 3000,
    delay: 0n,
    borrowableNow: 3n * 10n ** 18n,
    contexts: [{ token: NATIVE_TOKEN, decimals: 18, currency: NATIVE_CURRENCY }],
  }
}

function resolve<T>(value: T | Error): T {
  if (value instanceof Error) throw value
  return value
}

function mockClient(state: MockState, calls: RecordedCall[] = []): PublicClient {
  return {
    readContract: async ({ functionName, args }: { functionName: string; args: readonly unknown[] }) => {
      calls.push({ functionName, args })
      switch (functionName) {
        case 'totalBalanceOf':
          return resolve(state.balance)
        case 'creditBalanceOf':
          return resolve(state.credit)
        case 'controllerOf':
          return CONTROLLER
        case 'totalTokenSupplyWithReservedTokensOf':
          return resolve(state.supply)
        case 'accountingContextsOf':
          return resolve(state.contexts)
        case 'currentReclaimableSurplusOf': {
          // Same shape as the contract: value for `cashOutCount` tokens out of
          // the live supply against the live surplus, tax curve applied.
          const cashOutCount = args[1] as bigint
          return calculateCashOutValue(state.surplus, resolve(state.supply), cashOutCount, state.taxRate)
        }
        case 'cashOutDelayOf':
          return resolve(state.delay)
        case 'borrowableAmountFrom':
          return [resolve(state.borrowableNow), resolve(state.borrowableNow)] as const
        default:
          throw new Error(`Unexpected read: ${functionName}`)
      }
    },
  } as unknown as PublicClient
}

function row(overrides: Partial<YouPositionRow>): YouPositionRow {
  return {
    chainId: CHAIN,
    balance: 1n,
    creditBalance: 0n,
    erc20Balance: 1n,
    cashOutValue: 1n,
    maxLoan: 1n,
    lockedUntil: null,
    accountingToken: { token: NATIVE_TOKEN, symbol: 'ETH', decimals: 18, currency: NATIVE_CURRENCY },
    ...overrides,
  }
}

describe('cash-out value math shape (calculateCashOutValue parity)', () => {
  const surplus = 50n * 10n ** 18n
  const supply = 1_000n * 10n ** 18n

  it('returns 0 for the sentinel/guard cases', () => {
    expect(calculateCashOutValue(0n, supply, 1n, 0)).toBe(0n)
    expect(calculateCashOutValue(surplus, 0n, 1n, 0)).toBe(0n)
    expect(calculateCashOutValue(surplus, supply, 0n, 0)).toBe(0n)
    expect(calculateCashOutValue(surplus, supply, 1n, -1)).toBe(0n)
    expect(calculateCashOutValue(surplus, supply, 1n, 10_000)).toBe(0n)
  })

  it('cashing out the full supply reclaims the full surplus', () => {
    expect(calculateCashOutValue(surplus, supply, supply, 3000)).toBe(surplus)
    expect(calculateCashOutValue(surplus, supply, supply + 1n, 3000)).toBe(surplus)
  })

  it('zero tax is exactly proportional', () => {
    const count = 100n * 10n ** 18n
    expect(calculateCashOutValue(surplus, supply, count, 0)).toBe((surplus * count) / supply)
  })

  it('a non-zero tax discounts below proportional along the bonding curve', () => {
    const count = 100n * 10n ** 18n
    const proportional = (surplus * count) / supply
    const taxed = calculateCashOutValue(surplus, supply, count, 3000)
    // base * (10000 - rate + rate*count/supply) / 10000
    expect(taxed).toBe((proportional * (10_000n - 3000n + (3000n * count) / supply)) / 10_000n)
    expect(taxed).toBeLessThan(proportional)
    expect(taxed).toBeGreaterThan(0n)
  })

  it('is monotonically non-decreasing in the cash-out count', () => {
    let previous = 0n
    for (const count of [1n, 10n, 100n, 500n, 1000n].map(n => n * 10n ** 18n)) {
      const value = calculateCashOutValue(surplus, supply, count, 2500)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe('isCashOutLocked (delay-lock logic)', () => {
  const now = 1_800_000_000

  it('no delay / unreadable delay is unlocked', () => {
    expect(isCashOutLocked(null, now)).toBe(false)
    expect(isCashOutLocked(undefined, now)).toBe(false)
    expect(isCashOutLocked(0n, now)).toBe(false)
  })

  it('a past unlock time is unlocked, a future one is locked', () => {
    expect(isCashOutLocked(BigInt(now - 1), now)).toBe(false)
    expect(isCashOutLocked(BigInt(now), now)).toBe(false)
    expect(isCashOutLocked(BigInt(now + 1), now)).toBe(true)
  })
})

describe('loadYouPosition', () => {
  const project = { isRevnet: true }
  // The project's id on CHAIN (#7); the loader must read each chain with its own id.
  const CHAINS_HOME = [{ chainId: CHAIN, projectId: 7 }]

  it('assembles a full row for a healthy revnet chain', async () => {
    const state = defaults()
    state.delay = 2_000_000_000n
    const calls: RecordedCall[] = []
    const [result] = await loadYouPosition(project, CHAINS_HOME, ACCOUNT, { clientFor: () => mockClient(state, calls) })

    expect(result.chainId).toBe(CHAIN)
    expect(result.balance).toBe(state.balance)
    expect(result.creditBalance).toBe(state.credit)
    expect(result.erc20Balance).toBe((state.balance as bigint) - (state.credit as bigint))
    expect(result.cashOutValue).toBe(
      calculateCashOutValue(state.surplus, state.supply as bigint, state.balance as bigint, state.taxRate),
    )
    expect(result.maxLoan).toBe(state.borrowableNow)
    expect(result.lockedUntil).toBe(2_000_000_000n)
    expect(result.accountingToken).toEqual({
      token: NATIVE_TOKEN,
      symbol: 'ETH',
      decimals: 18,
      currency: NATIVE_CURRENCY,
    })

    // The store read must be denominated in the accounting context, with the
    // wallet's balance as the cash-out count.
    const reclaim = calls.find(call => call.functionName === 'currentReclaimableSurplusOf')
    expect(reclaim?.args).toEqual([7n, state.balance, [], [NATIVE_TOKEN], 18n, BigInt(NATIVE_CURRENCY)])
  })

  it('renders a failed chain as nulls, never fake zeros', async () => {
    const [unreachable] = await loadYouPosition(project, CHAINS_HOME, ACCOUNT, {
      clientFor: () => {
        throw new Error('no rpc')
      },
    })
    expect(unreachable).toEqual({
      chainId: CHAIN,
      balance: null,
      creditBalance: null,
      erc20Balance: null,
      cashOutValue: null,
      maxLoan: null,
      lockedUntil: null,
      accountingToken: null,
    })

    const failing = {
      readContract: async () => {
        throw new Error('read failed')
      },
    } as unknown as PublicClient
    const [broken] = await loadYouPosition(project, CHAINS_HOME, ACCOUNT, { clientFor: () => failing })
    expect(broken.balance).toBeNull()
    expect(broken.creditBalance).toBeNull()
    expect(broken.cashOutValue).toBeNull()
    expect(broken.maxLoan).toBeNull()
    expect(broken.lockedUntil).toBeNull()
  })

  it('a partially failing chain nulls only the affected fields', async () => {
    const state = defaults()
    state.credit = new Error('credit read failed')
    const [result] = await loadYouPosition(project, CHAINS_HOME, ACCOUNT, { clientFor: () => mockClient(state) })
    expect(result.balance).toBe(state.balance)
    expect(result.creditBalance).toBeNull()
    expect(result.erc20Balance).toBeNull() // the split is unknown, not zero
    expect(result.cashOutValue).not.toBeNull()
  })

  it('a zero balance yields hard zeros without querying the store or REVLoans', async () => {
    const state = defaults()
    state.balance = 0n
    state.credit = 0n
    const calls: RecordedCall[] = []
    const [result] = await loadYouPosition(project, CHAINS_HOME, ACCOUNT, { clientFor: () => mockClient(state, calls) })
    expect(result.cashOutValue).toBe(0n)
    expect(result.maxLoan).toBe(0n)
    expect(calls.some(call => call.functionName === 'currentReclaimableSurplusOf')).toBe(false)
    expect(calls.some(call => call.functionName === 'borrowableAmountFrom')).toBe(false)
  })

  it('skips the cash-out read when the supply guard fails (balance > supply)', async () => {
    const state = defaults()
    state.supply = 1n
    const [result] = await loadYouPosition(project, CHAINS_HOME, ACCOUNT, { clientFor: () => mockClient(state) })
    expect(result.cashOutValue).toBeNull()
  })

  it('treats credits exceeding the balance as an unknown split', async () => {
    const state = defaults()
    state.credit = (state.balance as bigint) + 1n
    const [result] = await loadYouPosition(project, CHAINS_HOME, ACCOUNT, { clientFor: () => mockClient(state) })
    expect(result.erc20Balance).toBeNull()
  })

  it('skips loans and the cash-out delay for non-revnet projects', async () => {
    const state = defaults()
    const calls: RecordedCall[] = []
    const [result] = await loadYouPosition({ isRevnet: false }, CHAINS_HOME, ACCOUNT, {
      clientFor: () => mockClient(state, calls),
    })
    expect(result.maxLoan).toBeNull()
    expect(result.lockedUntil).toBeNull()
    expect(calls.some(call => call.functionName === 'borrowableAmountFrom')).toBe(false)
    expect(calls.some(call => call.functionName === 'cashOutDelayOf')).toBe(false)
  })

  it('reports one row per requested chain, in order', async () => {
    const state = defaults()
    const rows = await loadYouPosition(
      project,
      [{ chainId: 1, projectId: 7 }, { chainId: 8453, projectId: 7 }],
      ACCOUNT,
      { clientFor: () => mockClient(state) },
    )
    expect(rows.map(r => r.chainId)).toEqual([1, 8453])
  })

  it('reads each chain with ITS OWN project id — never the home id off-home', async () => {
    const state = defaults()
    const callsByChain = new Map<number, RecordedCall[]>()
    // Divergent per-chain ids: #7 on chain 1, #42 on chain 8453.
    await loadYouPosition(
      project,
      [{ chainId: 1, projectId: 7 }, { chainId: 8453, projectId: 42 }],
      ACCOUNT,
      {
        clientFor: (chainId: number) => {
          const calls: RecordedCall[] = []
          callsByChain.set(chainId, calls)
          return mockClient(state, calls)
        },
      },
    )
    // Chain 8453 must be read with 42n, never the home id 7n.
    const balOn = (chainId: number) =>
      callsByChain.get(chainId)!.find(call => call.functionName === 'totalBalanceOf')!.args[1]
    expect(balOn(1)).toBe(7n)
    expect(balOn(8453)).toBe(42n)
    // The cash-out store read on 8453 must also carry 42n, not 7n.
    const reclaim8453 = callsByChain.get(8453)!.find(call => call.functionName === 'currentReclaimableSurplusOf')
    expect(reclaim8453?.args[0]).toBe(42n)
  })
})

describe('accounting-token + totals helpers', () => {
  it('recognizes native and canonical USDC accounting contexts by address', () => {
    expect(describeAccountingToken(CHAIN, { token: NATIVE_TOKEN, decimals: 18, currency: NATIVE_CURRENCY }).symbol).toBe('ETH')
    const [usdcChainId, usdcAddress] = Object.entries(USDC_ADDRESSES)[0] as [string, Address]
    const usdc = describeAccountingToken(Number(usdcChainId), { token: usdcAddress, decimals: 6, currency: 123 })
    expect(usdc.symbol).toBe('USDC')
    expect(usdc.decimals).toBe(6)
    const other = describeAccountingToken(CHAIN, {
      token: '0x3333333333333333333333333333333333333333',
      decimals: 18,
      currency: 456,
    })
    expect(other.symbol).toBe('TOKEN')
  })

  it('knows which chains have REVLoans deployed', () => {
    expect(hasRevLoans(1)).toBe(true)
    expect(hasRevLoans(999_999)).toBe(false)
  })

  it('totalIfComplete only sums when every row produced the field', () => {
    expect(totalIfComplete([row({ balance: 2n }), row({ balance: 3n })], 'balance')).toBe(5n)
    expect(totalIfComplete([row({ balance: 2n }), row({ balance: null })], 'balance')).toBeNull()
    expect(totalIfComplete([], 'balance')).toBeNull()
  })

  it('monetaryTotalIfComplete requires complete values AND one accounting unit', () => {
    const usdcToken = { token: '0x4444444444444444444444444444444444444444' as Address, symbol: 'USDC', decimals: 6, currency: 2 }
    expect(monetaryTotalIfComplete([row({ cashOutValue: 2n }), row({ cashOutValue: 3n })], 'cashOutValue')).toBe(5n)
    expect(monetaryTotalIfComplete([row({}), row({ cashOutValue: null })], 'cashOutValue')).toBeNull()
    expect(
      monetaryTotalIfComplete([row({}), row({ accountingToken: usdcToken })], 'cashOutValue'),
    ).toBeNull()
    expect(monetaryTotalIfComplete([row({ accountingToken: null })], 'cashOutValue')).toBeNull()
    // Same unit across different canonical addresses (per-chain USDC) still totals.
    const usdcOtherAddr = { ...usdcToken, token: '0x5555555555555555555555555555555555555555' as Address }
    expect(
      monetaryTotalIfComplete(
        [row({ accountingToken: usdcToken, cashOutValue: 1n }), row({ accountingToken: usdcOtherAddr, cashOutValue: 2n })],
        'cashOutValue',
      ),
    ).toBe(3n)
  })
})
