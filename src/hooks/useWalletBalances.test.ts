import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWalletBalances } from './useWalletBalances'

const { getBalance, readContract } = vi.hoisted(() => ({
  getBalance: vi.fn(),
  readContract: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1234567890123456789012345678901234567890' }),
}))

vi.mock('viem', async importOriginal => {
  const original = await importOriginal<typeof import('viem')>()
  return {
    ...original,
    createPublicClient: () => ({ getBalance, readContract }),
    http: vi.fn(),
  }
})

describe('useWalletBalances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getBalance.mockResolvedValue(1n)
    readContract.mockResolvedValue(2n)
  })

  it('marks balances available only after every configured read succeeds', async () => {
    const { result } = renderHook(() => useWalletBalances())

    await waitFor(() => expect(result.current.available).toBe(true))
    expect(result.current.loading).toBe(false)
    expect(result.current.totalEth).toBeGreaterThan(0n)
    expect(result.current.totalUsdc).toBeGreaterThan(0n)
  })

  it('does not represent a failed token read as a verified zero balance', async () => {
    readContract.mockRejectedValue(new Error('RPC unavailable'))
    const { result } = renderHook(() => useWalletBalances())

    await waitFor(() => expect(readContract).toHaveBeenCalled())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.available).toBe(false)
    expect(result.current.perChain).toEqual([])
  })
})
