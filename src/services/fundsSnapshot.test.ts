import { describe, expect, it, vi } from 'vitest'
import type { Address, PublicClient } from 'viem'
import { NATIVE_TOKEN } from '../constants'
import {
  UNLIMITED_ACCESS_THRESHOLD,
  accessAmountLabel,
  formatAccessRows,
  formatKindAmount,
  isUnlimitedAccessAmount,
  kindTotals,
  loadFundsSnapshot,
  type FundsChainRow,
} from './fundsSnapshot'

const NATIVE_CURRENCY = 61_166
const CUSTOM_TOKEN = '0x1234000000000000000000000000000000005678' as Address
const CUSTOM_CURRENCY = Number(BigInt(CUSTOM_TOKEN) & 0xffffffffn)

interface ChainState {
  contexts?: Array<{ token: Address; decimals: number; currency: number }>
  rulesetId?: number
  cycleNumber?: number
  balance?: bigint
  surplus?: bigint
  payoutLimits?: Array<{ amount: bigint; currency: number }>
  surplusAllowances?: Array<{ amount: bigint; currency: number }>
  usedPayout?: bigint
  usedAllowance?: bigint
  /** Function names whose reads should fail on this chain. */
  fail?: string[]
}

interface RecordedCall {
  functionName: string
  args: unknown[]
}

function mockClient(state: ChainState = {}): { client: PublicClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const client = {
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      calls.push({ functionName, args: [...(args ?? [])] })
      if (state.fail?.includes(functionName)) throw new Error(`${functionName} read failed`)
      switch (functionName) {
        case 'accountingContextsOf':
          return state.contexts ?? [{ token: NATIVE_TOKEN, decimals: 18, currency: NATIVE_CURRENCY }]
        case 'currentRulesetOf':
          return [{ id: state.rulesetId ?? 7, cycleNumber: state.cycleNumber ?? 3 }, {}]
        case 'balanceOf':
          return state.balance ?? 0n
        case 'currentSurplusOf':
          return state.surplus ?? 0n
        case 'payoutLimitsOf':
          return state.payoutLimits ?? []
        case 'surplusAllowancesOf':
          return state.surplusAllowances ?? []
        case 'usedPayoutLimitOf':
          return state.usedPayout ?? 0n
        case 'usedSurplusAllowanceOf':
          return state.usedAllowance ?? 0n
        default:
          throw new Error(`Unexpected read: ${functionName}`)
      }
    }),
  } as unknown as PublicClient
  return { client, calls }
}

function depsFor(clients: Record<number, PublicClient>) {
  return {
    getClient: (chainId: number) => {
      const client = clients[chainId]
      if (!client) throw new Error(`No mock client for chain ${chainId}`)
      return client
    },
  }
}

const displayRow = { currency: NATIVE_CURRENCY, decimals: 18 } satisfies Pick<FundsChainRow, 'currency' | 'decimals'>

describe('unlimited sentinel (>= 2^200)', () => {
  it('flags the sentinel and everything above it', () => {
    expect(isUnlimitedAccessAmount(UNLIMITED_ACCESS_THRESHOLD)).toBe(true)
    expect(isUnlimitedAccessAmount((1n << 224n) - 1n)).toBe(true)
    expect(isUnlimitedAccessAmount(UNLIMITED_ACCESS_THRESHOLD - 1n)).toBe(false)
  })

  it('labels sentinel amounts as Unlimited in the right unit', () => {
    expect(accessAmountLabel(1n << 200n, NATIVE_CURRENCY, displayRow, 'ETH')).toBe('Unlimited ETH')
    expect(accessAmountLabel(1n << 200n, 2, displayRow, 'ETH')).toBe('Unlimited USD')
    expect(accessAmountLabel((1n << 200n) - 1n, NATIVE_CURRENCY, displayRow, 'ETH')).not.toContain('Unlimited')
  })

  it('marks a chain whose configured payout limit is unlimited and suppresses the numeric total', async () => {
    const unlimited = mockClient({
      balance: 10n ** 18n,
      surplus: 5n * 10n ** 17n,
      payoutLimits: [{ amount: (1n << 224n) - 1n, currency: NATIVE_CURRENCY }],
    })
    const snapshot = await loadFundsSnapshot({ projectId: 3, chainId: 1 }, [1], depsFor({ 1: unlimited.client }))
    const [kind] = snapshot.kinds
    expect(kind.rows[0].usedPayoutUnlimited).toBe(true)
    expect(kind.totals.allChainsOk).toBe(true)
    expect(kind.totals.remainingPayoutUnlimited).toBe(true)
    expect(kind.totals.remainingPayout).toBeNull()
    expect(kind.totals.balance).toBe(10n ** 18n)
  })
})

describe('partial-failure total suppression', () => {
  it('never sums partial data: one failed chain nulls every total', async () => {
    const okChain = mockClient({
      balance: 2n * 10n ** 18n,
      surplus: 10n ** 18n,
      payoutLimits: [{ amount: 10n ** 18n, currency: NATIVE_CURRENCY }],
      usedPayout: 4n * 10n ** 17n,
    })
    const failedChain = mockClient({ balance: 9n * 10n ** 18n, fail: ['balanceOf'] })
    const snapshot = await loadFundsSnapshot(
      { projectId: 3, chainId: 1 },
      [1, { chainId: 8453, projectId: 12 }],
      depsFor({ 1: okChain.client, 8453: failedChain.client }),
    )

    const [kind] = snapshot.kinds
    expect(kind.rows).toHaveLength(2)

    const ok = kind.rows.find(row => row.chainId === 1)!
    expect(ok.ok).toBe(true)
    expect(ok.balance).toBe(2n * 10n ** 18n)
    expect(ok.remainingPayout).toBe(6n * 10n ** 17n)
    expect(ok.projectId).toBe(3)

    const failed = kind.rows.find(row => row.chainId === 8453)!
    expect(failed.ok).toBe(false)
    expect(failed.balance).toBeNull()
    expect(failed.surplus).toBeNull()
    expect(failed.remainingPayout).toBeNull()
    expect(failed.projectId).toBe(12)

    expect(kind.totals.allChainsOk).toBe(false)
    expect(kind.totals.balance).toBeNull()
    expect(kind.totals.surplus).toBeNull()
    expect(kind.totals.remainingPayout).toBeNull()
  })

  it('sums totals when every chain read succeeded', async () => {
    const a = mockClient({ balance: 3n * 10n ** 18n, surplus: 10n ** 18n })
    const b = mockClient({ balance: 1n * 10n ** 18n, surplus: 2n * 10n ** 18n })
    const snapshot = await loadFundsSnapshot(
      { projectId: 3, chainId: 1 },
      [1, { chainId: 8453, projectId: 3 }],
      depsFor({ 1: a.client, 8453: b.client }),
    )
    const [kind] = snapshot.kinds
    expect(kind.totals.allChainsOk).toBe(true)
    expect(kind.totals.balance).toBe(4n * 10n ** 18n)
    expect(kind.totals.surplus).toBe(3n * 10n ** 18n)
    expect(kind.totals.remainingPayout).toBe(0n)
  })

  it('kindTotals treats an empty row set as not-ok', () => {
    const totals = kindTotals([])
    expect(totals.allChainsOk).toBe(false)
    expect(totals.balance).toBeNull()
  })
})

describe('6-decimal USDC-style formatting', () => {
  const usdcRow = { currency: CUSTOM_CURRENCY, decimals: 6 } satisfies Pick<FundsChainRow, 'currency' | 'decimals'>

  it('formats raw 6-decimal amounts without assuming 18 decimals', () => {
    expect(formatKindAmount(1_500_000n, 6, 'USDC')).toBe('1.5 USDC')
    expect(formatKindAmount(1_234_567_890n, 6, 'USDC')).toBe('1,234.56789 USDC')
    expect(formatKindAmount(0n, 6, 'USDC')).toBe('0 USDC')
    expect(formatKindAmount(null, 6, 'USDC')).toBe('—')
  })

  it('formats configured access rows in the token decimals, joined per currency', () => {
    expect(formatAccessRows([], usdcRow, 'USDC')).toBe('0 USDC')
    expect(
      formatAccessRows(
        [
          { currency: CUSTOM_CURRENCY, configured: 5_000_000n, used: 0n, remaining: 5_000_000n, unlimited: false },
          { currency: 2, configured: 1n << 200n, used: 0n, remaining: 1n << 200n, unlimited: true },
        ],
        usdcRow,
        'USDC',
      ),
    ).toBe('5 USDC + Unlimited USD')
  })

  it('reads a 6-decimal accounting context end to end with the context decimals', async () => {
    const usdcChain = mockClient({
      contexts: [{ token: CUSTOM_TOKEN, decimals: 6, currency: CUSTOM_CURRENCY }],
      balance: 1_500_000n,
      surplus: 750_000n,
      payoutLimits: [{ amount: 1_000_000n, currency: CUSTOM_CURRENCY }],
      usedPayout: 250_000n,
      surplusAllowances: [{ amount: 500_000n, currency: CUSTOM_CURRENCY }],
      usedAllowance: 100_000n,
    })
    const snapshot = await loadFundsSnapshot({ projectId: 9, chainId: 1 }, [1], depsFor({ 1: usdcChain.client }))
    const [kind] = snapshot.kinds
    expect(kind.kind.decimals).toBe(6)
    const [row] = kind.rows
    expect(row.decimals).toBe(6)
    expect(row.currency).toBe(CUSTOM_CURRENCY)
    expect(row.balance).toBe(1_500_000n)
    expect(row.remainingPayout).toBe(750_000n)
    expect(row.usedAllowance).toBe(100_000n)
    expect(formatKindAmount(row.balance, row.decimals, 'USDC')).toBe('1.5 USDC')

    // The surplus read must be denominated in the context's 6 decimals, never 18.
    const surplusCall = usdcChain.calls.find(call => call.functionName === 'currentSurplusOf')!
    expect(surplusCall.args[3]).toBe(6n)
    expect(surplusCall.args[4]).toBe(BigInt(CUSTOM_CURRENCY))

    // Payout usage is keyed by ruleset CYCLE; allowance usage by ruleset ID.
    const usedPayoutCall = usdcChain.calls.find(call => call.functionName === 'usedPayoutLimitOf')!
    expect(usedPayoutCall.args[3]).toBe(3n)
    const usedAllowanceCall = usdcChain.calls.find(call => call.functionName === 'usedSurplusAllowanceOf')!
    expect(usedAllowanceCall.args[3]).toBe(7n)
  })
})
