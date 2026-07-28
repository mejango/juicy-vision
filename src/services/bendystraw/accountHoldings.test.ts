import { describe, expect, it } from 'vitest'
import {
  dedupeTokenHoldings,
  dedupeNftHoldings,
  groupTokenHoldings,
  groupNftHoldings,
  type NftHoldingRow,
  type TokenHoldingRow,
} from './accountHoldings'

const token = (
  chainId: number,
  projectId: number,
  version: number,
  balance: string
): TokenHoldingRow => ({ chainId, projectId, version, balance })

const nft = (
  chainId: number,
  projectId: number,
  tokenId: string,
  tierId: number
): NftHoldingRow => ({ chainId, projectId, tokenId, tierId })

describe('dedupeTokenHoldings', () => {
  it('keeps the highest-version row per (chainId, projectId)', () => {
    const rows = [
      token(1, 3, 5, '100'),
      token(1, 3, 6, '100'),
      token(8453, 3, 6, '50'),
    ]
    expect(dedupeTokenHoldings(rows)).toEqual([
      token(1, 3, 6, '100'),
      token(8453, 3, 6, '50'),
    ])
  })

  it('keeps the higher version regardless of arrival order', () => {
    expect(dedupeTokenHoldings([token(1, 3, 6, '100'), token(1, 3, 5, '100')])).toEqual([
      token(1, 3, 6, '100'),
    ])
  })

  it('does not collapse the same projectId on different chains', () => {
    const rows = [token(1, 3, 6, '100'), token(10, 3, 6, '200')]
    expect(dedupeTokenHoldings(rows)).toEqual(rows)
  })

  it('preserves the balance-sorted input order', () => {
    const rows = [token(1, 9, 6, '900'), token(1, 3, 5, '100'), token(1, 9, 5, '900')]
    expect(dedupeTokenHoldings(rows).map(r => r.projectId)).toEqual([9, 3])
  })
})

describe('dedupeNftHoldings', () => {
  it('keeps the first row per (chainId, tokenId)', () => {
    const rows = [
      nft(1, 3, '1000000001', 1),
      nft(1, 3, '1000000001', 1),
      nft(1, 3, '2000000001', 2),
    ]
    expect(dedupeNftHoldings(rows)).toEqual([
      nft(1, 3, '1000000001', 1),
      nft(1, 3, '2000000001', 2),
    ])
  })

  it('does not collapse the same tokenId on different chains', () => {
    const rows = [nft(1, 3, '1000000001', 1), nft(10, 7, '1000000001', 1)]
    expect(dedupeNftHoldings(rows)).toEqual(rows)
  })
})

describe('groupTokenHoldings', () => {
  it('collapses per-chain rows to one row per project with per-chain balances', () => {
    const groups = groupTokenHoldings([
      token(1, 3, 6, '300'),
      token(8453, 3, 6, '30'),
      token(1, 5, 6, '200'),
    ])
    expect(groups).toEqual([
      { projectId: 3, chains: [{ chainId: 1, balance: '300' }, { chainId: 8453, balance: '30' }] },
      { projectId: 5, chains: [{ chainId: 1, balance: '200' }] },
    ])
  })
})

describe('groupNftHoldings', () => {
  it('groups per (chainId, projectId) and tallies tiers, biggest tier first', () => {
    const groups = groupNftHoldings([
      nft(1, 3, '1000000001', 1),
      nft(1, 3, '2000000001', 2),
      nft(1, 3, '2000000002', 2),
      nft(10, 3, '1000000001', 1),
    ])
    expect(groups).toEqual([
      {
        chainId: 1,
        projectId: 3,
        tiers: [
          { tierId: 2, count: 2 },
          { tierId: 1, count: 1 },
        ],
      },
      { chainId: 10, projectId: 3, tiers: [{ tierId: 1, count: 1 }] },
    ])
  })
})
