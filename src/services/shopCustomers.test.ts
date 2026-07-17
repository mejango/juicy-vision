import { describe, it, expect } from 'vitest'
import {
  buildTierCashOutMetadata,
  itemLabelFrom,
  tallyItems,
  rankCustomers,
  type MintRow,
} from './shopCustomers'

function mint(partial: Partial<MintRow>): MintRow {
  return {
    tierId: 1,
    beneficiary: '0x0000000000000000000000000000000000000001',
    timestamp: 0,
    txHash: '0xtx',
    tokenId: '1',
    chainId: 1,
    ...partial,
  }
}

describe('buildTierCashOutMetadata', () => {
  // Locked vector: idTarget + tokenIds → the exact envelope previewCashOutFrom
  // accepts on-chain. id = bytes4(idTarget[:4] XOR keccak256("cashOut")[:4]),
  // data = abi.encode(uint256[] tokenIds). If this changes, the 721 hook never
  // sees the token ids and the redemption reverts.
  const IDTARGET = '0x1234567890123456789012345678901234567890' as `0x${string}`
  const TOKEN_IDS = [1n, 2n, 1000000001n]
  const EXPECTED =
    '0x' +
    '0000000000000000000000000000000000000000000000000000000000000000' + // reserved word
    '9485198c' + // id = bytes4(idTarget ^ keccak256("cashOut"))
    '02' + // offset to the data table
    '000000000000000000000000000000000000000000000000000000' + // 27-byte pad
    // abi.encode(uint256[] [1, 2, 1000000001]): offset, length, then the ids
    '0000000000000000000000000000000000000000000000000000000000000020' +
    '0000000000000000000000000000000000000000000000000000000000000003' +
    '0000000000000000000000000000000000000000000000000000000000000001' +
    '0000000000000000000000000000000000000000000000000000000000000002' +
    '000000000000000000000000000000000000000000000000000000003b9aca01'

  it('produces the exact locked envelope for a fixed idTarget + token ids', () => {
    expect(buildTierCashOutMetadata(IDTARGET, TOKEN_IDS)).toBe(EXPECTED)
  })

  it('accepts token ids as strings or numbers identically to bigints', () => {
    expect(buildTierCashOutMetadata(IDTARGET, ['1', '2', '1000000001'])).toBe(EXPECTED)
    expect(buildTierCashOutMetadata(IDTARGET, [1, 2, 1000000001])).toBe(EXPECTED)
  })

  it('derives the id from the idTarget prefix (different target → different id)', () => {
    const other = buildTierCashOutMetadata('0x0000000000000000000000000000000000000000', [1n])
    // keccak256("cashOut")[:4] XOR 0x00000000 = keccak256 prefix unchanged.
    expect(other.slice(66, 74)).toBe('86b14ff4')
  })

  it('is case-insensitive on the idTarget', () => {
    expect(buildTierCashOutMetadata(IDTARGET.toUpperCase().replace('0X', '0x') as `0x${string}`, TOKEN_IDS)).toBe(EXPECTED)
  })
})

describe('itemLabelFrom', () => {
  it('returns the resolved name when present', () => {
    expect(itemLabelFrom({ 5: 'Gold Pass' }, 5)).toBe('Gold Pass')
  })
  it('falls back to Item #<id> when unknown or names missing', () => {
    expect(itemLabelFrom({ 5: 'Gold Pass' }, 6)).toBe('Item #6')
    expect(itemLabelFrom(null, 7)).toBe('Item #7')
    expect(itemLabelFrom({}, '9')).toBe('Item #9')
  })
})

describe('tallyItems', () => {
  it('groups by tier and sorts most-owned first', () => {
    const rows = [
      mint({ tierId: 1 }),
      mint({ tierId: 2 }),
      mint({ tierId: 1 }),
      mint({ tierId: 1 }),
      mint({ tierId: 2 }),
    ]
    const names = { 1: 'Sticker', 2: 'Poster' }
    expect(tallyItems(rows, names)).toEqual([
      { tierId: 1, count: 3, label: 'Sticker' },
      { tierId: 2, count: 2, label: 'Poster' },
    ])
  })
  it('labels unknown tiers with the fallback', () => {
    expect(tallyItems([mint({ tierId: 42 })], {})).toEqual([
      { tierId: 42, count: 1, label: 'Item #42' },
    ])
  })
  it('returns an empty tally for no rows', () => {
    expect(tallyItems([], {})).toEqual([])
  })
})

describe('rankCustomers', () => {
  it('ranks distinct customers by item count desc and preserves their rows', () => {
    const a = '0xAAaAaAaAaAaAaAaAaAaAaAaAAaAAaAaAAAaaAaaa'
    const b = '0xBbBbBBbBBBBBBBbbBBbbbBBBbbbbBBbBBbBbBBBB'
    const rows = [
      mint({ beneficiary: a, tierId: 1 }),
      mint({ beneficiary: b, tierId: 1 }),
      mint({ beneficiary: a, tierId: 2 }),
      mint({ beneficiary: a, tierId: 2 }),
    ]
    const ranked = rankCustomers(rows)
    expect(ranked.map(r => r.address)).toEqual([a, b])
    expect(ranked[0].mints).toHaveLength(3)
    expect(ranked[1].mints).toHaveLength(1)
  })

  it('collapses case-different addresses into one customer', () => {
    const rows = [
      mint({ beneficiary: '0xAbc0000000000000000000000000000000000000' }),
      mint({ beneficiary: '0xabc0000000000000000000000000000000000000' }),
    ]
    const ranked = rankCustomers(rows)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].mints).toHaveLength(2)
  })

  it('skips rows with no beneficiary', () => {
    expect(rankCustomers([mint({ beneficiary: '' })])).toEqual([])
  })
})
