import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NATIVE_TOKEN } from '../constants'

const readFundAccessContexts = vi.fn()
const readContract = vi.fn()
const fetchEthPrice = vi.fn()

vi.mock('./fundAccess', () => ({
  createFundAccessClient: () => ({ readContract }),
  readFundAccessContexts: (...args: unknown[]) => readFundAccessContexts(...args),
  FUND_ACCESS_PRICES_ABI: [],
  PRICE_FIDELITY: 10n ** 18n,
}))
vi.mock('./bendystraw/client', () => ({
  fetchEthPrice: (...args: unknown[]) => fetchEthPrice(...args),
}))

const {
  accountingTokenUsdValueAtPrice,
  rawAccountingBalanceSummary,
  fetchProjectBalanceBreakdown,
} = await import('./projectBalanceBreakdown')

type Ctx = { token: string; balance: bigint; decimals: number; accountingCurrency: bigint; tokenSymbol: string }
const ctx = (over: Partial<Ctx> & { token: string; balance: bigint }): Ctx & { prices: string; projectId: bigint } => ({
  decimals: 18, accountingCurrency: 1n, tokenSymbol: 'TKN', ...over, prices: '0xprices', projectId: 1n,
})

describe('accountingTokenUsdValueAtPrice', () => {
  it('keeps token decimals and the 18-dec price separate (no 6-vs-18 USDC bug)', () => {
    // 2.5 USDC (6-dec) at $0.9995 → 2.49875
    expect(accountingTokenUsdValueAtPrice(2_500_000n, 6, 999_500_000_000_000_000n, 18)).toBeCloseTo(2.49875)
    // 2 tokens (18-dec) at $4.25 → 8.5
    expect(accountingTokenUsdValueAtPrice(2n * 10n ** 18n, 18, 4_250_000_000_000_000_000n, 18)).toBe(8.5)
  })

  it('returns null for a missing price or invalid decimals', () => {
    expect(accountingTokenUsdValueAtPrice(1n, 18, null, 18)).toBeNull()
    expect(accountingTokenUsdValueAtPrice(1n, -1, 10n ** 18n, 18)).toBeNull()
    expect(accountingTokenUsdValueAtPrice(1n, 18, 10n ** 18n, 99)).toBeNull()
  })
})

describe('rawAccountingBalanceSummary', () => {
  const rows = [
    { chainId: 1, token: NATIVE_TOKEN, balance: 10n ** 18n, decimals: 18, currency: 1n, symbol: 'ETH', unitUsd: null },
    { chainId: 10, token: NATIVE_TOKEN, balance: 5n * 10n ** 17n, decimals: 18, currency: 1n, symbol: 'ETH', unitUsd: null },
    { chainId: 1, token: '0xusdc', balance: 2_500_000n, decimals: 6, currency: 2n, symbol: 'USDC', unitUsd: null },
  ]

  it('groups verified raw balances per token across chains', () => {
    expect(rawAccountingBalanceSummary(rows, true)).toBe('1.5 ETH + 2.5 USDC')
  })

  it('is "—" when unreadable or empty', () => {
    expect(rawAccountingBalanceSummary(rows, false)).toBe('—')
    expect(rawAccountingBalanceSummary([], true)).toBe('—')
  })
})

describe('fetchProjectBalanceBreakdown', () => {
  beforeEach(() => {
    readFundAccessContexts.mockReset()
    readContract.mockReset()
    fetchEthPrice.mockReset()
  })

  it('sums USD when every non-zero token is priced (native via the ETH fallback)', async () => {
    readFundAccessContexts.mockResolvedValue([ctx({ token: NATIVE_TOKEN, balance: 10n ** 18n, tokenSymbol: 'ETH', accountingCurrency: 61166n })])
    readContract.mockRejectedValue(new Error('no feed for native currency')) // JBPrices has no 61166→USD feed
    fetchEthPrice.mockResolvedValue(2500)

    const bd = await fetchProjectBalanceBreakdown([{ chainId: 1, projectId: 1 }])
    expect(bd.verified).toBe(true)
    expect(bd.priced).toBe(true)
    expect(bd.totalUsd).toBeCloseTo(2500)
  })

  it('prices a custom token through its JBPrices feed', async () => {
    readFundAccessContexts.mockResolvedValue([ctx({ token: '0xcustom', balance: 10n ** 18n, tokenSymbol: 'KMAC', accountingCurrency: 123n })])
    readContract.mockResolvedValue(3n * 10n ** 18n) // $3 per token

    const bd = await fetchProjectBalanceBreakdown([{ chainId: 1, projectId: 1 }])
    expect(bd.priced).toBe(true)
    expect(bd.totalUsd).toBeCloseTo(3)
  })

  it('falls back to a raw summary — never a guessed total — when a token has no price', async () => {
    readFundAccessContexts.mockResolvedValue([ctx({ token: '0xcustom', balance: 5n * 10n ** 18n, tokenSymbol: 'KMAC', accountingCurrency: 123n })])
    readContract.mockResolvedValue(0n) // no feed, and not native → unpriceable

    const bd = await fetchProjectBalanceBreakdown([{ chainId: 1, projectId: 1 }])
    expect(bd.verified).toBe(true)
    expect(bd.priced).toBe(false)
    expect(bd.rawSummary).toBe('5 KMAC')
  })

  it('marks the whole aggregate unverified when a chain read fails (fail-closed)', async () => {
    readFundAccessContexts.mockRejectedValue(new Error('unrecognized terminal'))

    const bd = await fetchProjectBalanceBreakdown([{ chainId: 1, projectId: 1 }])
    expect(bd.verified).toBe(false)
    expect(bd.priced).toBe(false)
    expect(bd.rawSummary).toBe('—')
  })
})
