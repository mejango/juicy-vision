/**
 * Unit tests for the reserved-splits data layer's pure core: 1e9 percent
 * math, burn-sentinel detection, pending-per-chain assembly with per-chain
 * failure tolerance, and auto-issuance allocation identity/dedupe.
 */

import { describe, expect, it } from 'vitest'
import {
  assemblePendingRows,
  autoIssueKey,
  BURN_SENTINEL,
  dedupeStoredAllocations,
  fetchPendingReservedPerChain,
  formatIssuancePercent,
  formatOfLimitPercent,
  groupSharePercent,
  isBurnBeneficiary,
  issuancePercent,
  pendingShareOf,
  SPLIT_PERCENT_DENOMINATOR,
} from './reservedSplits'

describe('split percent math (1e9 denominator)', () => {
  it('uses the 1e9 split denominator', () => {
    expect(SPLIT_PERCENT_DENOMINATOR).toBe(1_000_000_000)
  })

  it('converts a split percent to its share of the reserved group', () => {
    expect(groupSharePercent(1_000_000_000)).toBe(100)
    expect(groupSharePercent(500_000_000)).toBe(50)
    expect(groupSharePercent(0)).toBe(0)
  })

  it('scales the group share by the reserved rate for the %-of-issuance figure', () => {
    // 50% of a 10% reserved rate (1000 basis points) = 5% of issuance.
    expect(issuancePercent(500_000_000, 1000)).toBe(5)
    // 100% of a 38% reserved rate = 38% of issuance.
    expect(issuancePercent(1_000_000_000, 3800)).toBe(38)
    // 25% of a 21% reserved rate = 5.25% of issuance.
    expect(issuancePercent(250_000_000, 2100)).toBeCloseTo(5.25, 10)
  })

  it('formats whole percents without decimals and fractional ones with two', () => {
    expect(formatIssuancePercent(500_000_000, 1000)).toBe('5%')
    expect(formatIssuancePercent(250_000_000, 2100)).toBe('5.25%')
    expect(formatIssuancePercent(0, 1000)).toBe('0%')
  })

  it('formats the of-limit share rounded to whole percents', () => {
    expect(formatOfLimitPercent(500_000_000)).toBe('50% of limit')
    expect(formatOfLimitPercent(333_333_333)).toBe('33% of limit')
  })

  it('computes a pending share with bigint precision (floor division)', () => {
    expect(pendingShareOf(1_000_000_000_000_000_000n, 500_000_000)).toBe(500_000_000_000_000_000n)
    // 1/3 split of 100 wei floors to 33.
    expect(pendingShareOf(100n, 333_333_333)).toBe(33n)
    expect(pendingShareOf(0n, 1_000_000_000)).toBe(0n)
  })
})

describe('burn sentinel detection', () => {
  it('recognizes the 0xdead beneficiary case-insensitively', () => {
    expect(isBurnBeneficiary(BURN_SENTINEL)).toBe(true)
    expect(isBurnBeneficiary(BURN_SENTINEL.toLowerCase())).toBe(true)
    expect(isBurnBeneficiary(BURN_SENTINEL.toUpperCase().replace('0X', '0x'))).toBe(true)
  })

  it('does not flag other addresses (including the zero address)', () => {
    expect(isBurnBeneficiary('0x0000000000000000000000000000000000000000')).toBe(false)
    expect(isBurnBeneficiary('0x1111111111111111111111111111111111111111')).toBe(false)
    expect(isBurnBeneficiary(null)).toBe(false)
    expect(isBurnBeneficiary(undefined)).toBe(false)
    expect(isBurnBeneficiary('')).toBe(false)
  })
})

describe('pending-per-chain assembly', () => {
  it('zips fulfilled reads onto their chain ids', () => {
    const rows = assemblePendingRows(
      [1, 10],
      [
        { status: 'fulfilled', value: 5n },
        { status: 'fulfilled', value: 0n },
      ],
    )
    expect(rows).toEqual([
      { chainId: 1, pending: 5n },
      { chainId: 10, pending: 0n },
    ])
  })

  it('maps a rejected chain to null pending — never a fake zero', () => {
    const rows = assemblePendingRows(
      [1, 10, 8453],
      [
        { status: 'fulfilled', value: 7n },
        { status: 'rejected', reason: new Error('rpc down') },
        { status: 'fulfilled', value: 0n },
      ],
    )
    expect(rows).toEqual([
      { chainId: 1, pending: 7n },
      { chainId: 10, pending: null },
      { chainId: 8453, pending: 0n },
    ])
  })

  it('fetchPendingReservedPerChain tolerates one chain failing without dropping the others', async () => {
    const rows = await fetchPendingReservedPerChain(
      [{ chainId: 1, projectId: 42 }, { chainId: 10, projectId: 7 }, { chainId: 8453, projectId: 9 }],
      {
        readPending: async (_projectId, chainId) => {
          if (chainId === 10) throw new Error('rpc down')
          return BigInt(chainId)
        },
      },
    )
    expect(rows).toEqual([
      { chainId: 1, pending: 1n },
      { chainId: 10, pending: null },
      { chainId: 8453, pending: 8453n },
    ])
  })

  it('fetchPendingReservedPerChain reads each chain with ITS OWN project id', async () => {
    const seen: Array<[string, number]> = []
    await fetchPendingReservedPerChain(
      [{ chainId: 1, projectId: 42 }, { chainId: 10, projectId: 7 }],
      {
        readPending: async (projectId, chainId) => {
          seen.push([projectId, chainId])
          return 0n
        },
      },
    )
    // Per-chain ids differ — chain 10 must NOT be read with the home id 42.
    expect(seen).toEqual([['42', 1], ['7', 10]])
  })
})

describe('auto-issuance allocation identity', () => {
  const base = { chainId: 1, stageId: '12345', beneficiary: '0xAbC0000000000000000000000000000000000001', count: 100n }

  it('keys by chain, stage, lowercased beneficiary, and count', () => {
    expect(autoIssueKey(base)).toBe('1:12345:0xabc0000000000000000000000000000000000001:100')
    expect(autoIssueKey({ ...base, beneficiary: base.beneficiary.toLowerCase() })).toBe(autoIssueKey(base))
    expect(autoIssueKey({ ...base, count: 101n })).not.toBe(autoIssueKey(base))
    expect(autoIssueKey({ ...base, chainId: 10 })).not.toBe(autoIssueKey(base))
  })

  it('dedupes re-indexed copies keeping the newest, and drops empty rows', () => {
    const rows = dedupeStoredAllocations([
      { ...base, storedTimestamp: 100 },
      { ...base, storedTimestamp: 200 },
      { ...base, count: 0n, storedTimestamp: 300 },
      { ...base, beneficiary: '', storedTimestamp: 400 },
      { ...base, stageId: '99', storedTimestamp: 50 },
    ])
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.stageId === '12345')?.storedTimestamp).toBe(200)
    expect(rows.find(row => row.stageId === '99')?.storedTimestamp).toBe(50)
  })
})
