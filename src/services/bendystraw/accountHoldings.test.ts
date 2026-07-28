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
  balance: string,
  extra: Partial<TokenHoldingRow> = {}
): TokenHoldingRow => ({ chainId, projectId, version, balance, ...extra })

const nft = (
  chainId: number,
  projectId: number,
  hook: string,
  tokenId: string,
  tierId: number
): NftHoldingRow => ({ chainId, projectId, hook, tokenId, tierId })

const HOOK_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const HOOK_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe('dedupeTokenHoldings', () => {
  it('keeps one row per (chainId, projectId)', () => {
    const rows = [
      token(1, 3, 6, '100'),
      token(1, 3, 6, '100'),
      token(8453, 3, 6, '50'),
    ]
    expect(dedupeTokenHoldings(rows)).toEqual([
      token(1, 3, 6, '100'),
      token(8453, 3, 6, '50'),
    ])
  })

  it('does not collapse the same projectId on different chains', () => {
    const rows = [token(1, 3, 6, '100'), token(10, 3, 6, '200')]
    expect(dedupeTokenHoldings(rows)).toEqual(rows)
  })

  it('preserves the balance-sorted input order', () => {
    const rows = [token(1, 9, 6, '900'), token(1, 3, 6, '100'), token(1, 9, 6, '900')]
    expect(dedupeTokenHoldings(rows).map(r => r.projectId)).toEqual([9, 3])
  })

  it('carries the credit/erc20 split through', () => {
    const rows = [
      token(1, 3, 6, '100', { creditBalance: '40', erc20Balance: '60', suckerGroupId: 'g1' }),
    ]
    expect(dedupeTokenHoldings(rows)).toEqual(rows)
  })
})

describe('dedupeNftHoldings', () => {
  it('keys by (chainId, hook, tokenId) so tokenIds colliding across collections on one chain both survive', () => {
    // JB721 tokenIds are tierId*1e9+serial — every collection on a chain reuses
    // the same tokenId space, so two projects' items share tokenId 1000000001.
    const rows = [
      nft(1, 3, HOOK_A, '1000000001', 1),
      nft(1, 7, HOOK_B, '1000000001', 1),
    ]
    expect(dedupeNftHoldings(rows)).toEqual(rows)
  })

  it('collapses duplicate rows for the same physical token', () => {
    const rows = [
      nft(1, 3, HOOK_A, '1000000001', 1),
      nft(1, 3, HOOK_A, '1000000001', 1),
      nft(1, 3, HOOK_A, '2000000001', 2),
    ]
    expect(dedupeNftHoldings(rows)).toEqual([
      nft(1, 3, HOOK_A, '1000000001', 1),
      nft(1, 3, HOOK_A, '2000000001', 2),
    ])
  })

  it('treats hook casing as one collection', () => {
    const rows = [
      nft(1, 3, HOOK_A, '1000000001', 1),
      nft(1, 3, HOOK_A.toUpperCase().replace('0X', '0x'), '1000000001', 1),
    ]
    expect(dedupeNftHoldings(rows)).toHaveLength(1)
  })

  it('does not collapse the same hook+tokenId on different chains', () => {
    const rows = [nft(1, 3, HOOK_A, '1000000001', 1), nft(10, 7, HOOK_A, '1000000001', 1)]
    expect(dedupeNftHoldings(rows)).toEqual(rows)
  })
})

describe('groupTokenHoldings', () => {
  it('groups rows sharing a suckerGroupId even when per-chain projectIds diverge', () => {
    const groups = groupTokenHoldings([
      token(1, 3, 6, '300', { suckerGroupId: 'g1' }),
      token(8453, 12, 6, '30', { suckerGroupId: 'g1' }),
      token(1, 5, 6, '200', { suckerGroupId: 'g2' }),
    ])
    expect(groups).toEqual([
      {
        suckerGroupId: 'g1',
        projectId: 3,
        chains: [
          { chainId: 1, projectId: 3, balance: '300', creditBalance: undefined, erc20Balance: undefined },
          { chainId: 8453, projectId: 12, balance: '30', creditBalance: undefined, erc20Balance: undefined },
        ],
      },
      {
        suckerGroupId: 'g2',
        projectId: 5,
        chains: [
          { chainId: 1, projectId: 5, balance: '200', creditBalance: undefined, erc20Balance: undefined },
        ],
      },
    ])
  })

  it('does NOT merge same-projectId rows from different chains without a shared suckerGroupId', () => {
    const groups = groupTokenHoldings([
      token(1, 3, 6, '300'),
      token(8453, 3, 6, '30'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].chains).toEqual([
      { chainId: 1, projectId: 3, balance: '300', creditBalance: undefined, erc20Balance: undefined },
    ])
    expect(groups[1].chains).toEqual([
      { chainId: 8453, projectId: 3, balance: '30', creditBalance: undefined, erc20Balance: undefined },
    ])
  })

  it('carries the credit/erc20 split into the chain rows', () => {
    const groups = groupTokenHoldings([
      token(1, 3, 6, '100', { suckerGroupId: 'g1', creditBalance: '40', erc20Balance: '60' }),
    ])
    expect(groups[0].chains[0]).toEqual({
      chainId: 1,
      projectId: 3,
      balance: '100',
      creditBalance: '40',
      erc20Balance: '60',
    })
  })
})

describe('groupNftHoldings', () => {
  it('groups per (chainId, projectId) and tallies tiers, biggest tier first', () => {
    const groups = groupNftHoldings([
      nft(1, 3, HOOK_A, '1000000001', 1),
      nft(1, 3, HOOK_A, '2000000001', 2),
      nft(1, 3, HOOK_A, '2000000002', 2),
      nft(10, 3, HOOK_A, '1000000001', 1),
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
