import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SAFE_TX_SERVICE_PREFIX,
  safeServiceChainIds,
  getSafesByOwner,
  dedupeByChainAndProject,
  safeExecutionArgs,
  safeTransactionHash,
  usableSafeConfirmations,
  listPendingSafeTransactions,
  type SafeQueuedTransaction,
} from './safeTxService'
import { type Address, type Hex, zeroAddress } from 'viem'

const OWNER = '0x1234567890123456789012345678901234567890'
const OWNER_CHECKSUMMED = '0x1234567890123456789012345678901234567890'

describe('SAFE_TX_SERVICE_PREFIX', () => {
  it('covers exactly the supported mainnet chains with their gateway prefixes', () => {
    expect(SAFE_TX_SERVICE_PREFIX).toEqual({
      1: 'eth',
      10: 'oeth',
      8453: 'base',
      42161: 'arb1',
    })
    expect(safeServiceChainIds().sort((a, b) => a - b)).toEqual([1, 10, 8453, 42161])
  })
})

describe('getSafesByOwner', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('skips chains without a hosted service without touching the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await getSafesByOwner(OWNER, 11155111)).toEqual([])
    expect(await getSafesByOwner(OWNER, 999)).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns [] for a malformed address without touching the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(await getSafesByOwner('not-an-address', 1)).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('queries the unified gateway with the chain prefix and returns the safes list', async () => {
    const safes = ['0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ safes }) }))
    vi.stubGlobal('fetch', fetchSpy)

    expect(await getSafesByOwner(OWNER, 8453)).toEqual(safes)
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.safe.global/tx-service/base/api/v1/owners/${OWNER_CHECKSUMMED}/safes/`
    )
  })

  it('degrades to [] on service errors and non-ok responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    expect(await getSafesByOwner(OWNER, 1)).toEqual([])

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))
    expect(await getSafesByOwner(OWNER, 1)).toEqual([])

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ safes: 'nope' }) })))
    expect(await getSafesByOwner(OWNER, 1)).toEqual([])
  })
})

describe('dedupeByChainAndProject', () => {
  it('keeps the first occurrence of each (chainId, projectId) pair', () => {
    const rows = [
      { chainId: 1, projectId: 3, label: 'direct' },
      { chainId: 8453, projectId: 3, label: 'direct-base' },
      { chainId: 1, projectId: 3, label: 'via-safe' },
      { chainId: 1, projectId: 4, label: 'via-safe' },
    ]
    expect(dedupeByChainAndProject(rows)).toEqual([
      { chainId: 1, projectId: 3, label: 'direct' },
      { chainId: 8453, projectId: 3, label: 'direct-base' },
      { chainId: 1, projectId: 4, label: 'via-safe' },
    ])
  })

  it('does not conflate the same projectId across chains', () => {
    const rows = [
      { chainId: 1, projectId: 7 },
      { chainId: 10, projectId: 7 },
    ]
    expect(dedupeByChainAndProject(rows)).toHaveLength(2)
  })
})

describe('Safe queue payloads', () => {
  const SAFE = '0x2222222222222222222222222222222222222222' as Address
  const lowOwner = '0x1111111111111111111111111111111111111111' as Address
  const highOwner = '0x9999999999999999999999999999999999999999' as Address
  const staleOwner = '0x7777777777777777777777777777777777777777' as Address
  const lowSignature = `0x${'11'.repeat(65)}` as Hex
  const highSignature = `0x${'99'.repeat(65)}` as Hex
  const tx = {
    to: '0x3333333333333333333333333333333333333333',
    value: '17',
    data: '0x1234',
    operation: 0,
    safeTxGas: '100',
    baseGas: '20',
    gasPrice: '2',
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: 8,
    confirmations: [
      { owner: highOwner, signature: highSignature },
      { owner: lowOwner, signature: lowSignature },
      { owner: highOwner, signature: highSignature },
      { owner: staleOwner, signature: `0x${'77'.repeat(65)}` as Hex },
      { owner: lowOwner, signature: '0x1234' as Hex },
    ],
  } satisfies SafeQueuedTransaction

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sorts signatures by owner and binds every queued field into execution args', () => {
    expect(
      usableSafeConfirmations(tx, [lowOwner, highOwner]).map(({ owner }) => owner),
    ).toEqual([lowOwner, highOwner])
    expect(safeExecutionArgs(tx, [lowOwner, highOwner])).toEqual([
      tx.to,
      17n,
      '0x1234',
      0,
      100n,
      20n,
      2n,
      zeroAddress,
      zeroAddress,
      `0x${lowSignature.slice(2)}${highSignature.slice(2)}`,
    ])
  })

  it('produces a deterministic EIP-712 hash which changes with the nonce', () => {
    const hash = safeTransactionHash(1, SAFE, tx)
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(safeTransactionHash(1, SAFE, tx)).toBe(hash)
    expect(safeTransactionHash(1, SAFE, { ...tx, nonce: 9 })).not.toBe(hash)
  })

  it('loads every pending page and keeps only current-or-later nonces', async () => {
    const second = { ...tx, nonce: 9 }
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          next: '/tx-service/eth/api/v1/page-2',
          results: [{ ...tx, nonce: 7 }, tx],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ next: null, results: [second] }),
      })
    vi.stubGlobal('fetch', fetchSpy)

    expect(await listPendingSafeTransactions(1, SAFE, 8)).toEqual([tx, second])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('never presents an unsupported queue service as an empty queue', async () => {
    await expect(listPendingSafeTransactions(11155111, SAFE, 0)).rejects.toThrow(
      'unavailable on this chain',
    )
  })
})
