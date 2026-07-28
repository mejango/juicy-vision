import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SAFE_TX_SERVICE_PREFIX,
  safeServiceChainIds,
  getSafesByOwner,
  dedupeByChainAndProject,
} from './safeTxService'

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
