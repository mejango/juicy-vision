/**
 * Unit tests for the reserved-splits data layer's pure core: 1e9 percent
 * math, burn-sentinel detection, pending-per-chain assembly with per-chain
 * failure tolerance, and auto-issuance allocation identity/dedupe.
 */

import { describe, expect, it } from 'vitest'
import {
  assemblePendingRows,
  assertStageRulesetUnchanged,
  autoIssueKey,
  BURN_SENTINEL,
  dedupeStoredAllocations,
  fetchPendingReservedPerChain,
  fetchStageReservedSplits,
  fetchStageRulesetsPerChain,
  formatIssuancePercent,
  formatOfLimitPercent,
  groupSharePercent,
  isBurnBeneficiary,
  issuancePercent,
  pendingShareOf,
  SPLIT_PERCENT_DENOMINATOR,
} from './reservedSplits'
import type { SimpleRuleset } from './bendystraw'
import type { ReservedSplit } from './reservedSplits'

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

describe('per-chain stage ruleset resolution', () => {
  const ruleset = (id: string, start: number): SimpleRuleset => ({
    id,
    cycleNumber: 1,
    start,
    duration: 0,
    weight: '0',
    weightCutPercent: 0,
    reservedPercent: 0,
    cashOutTaxRate: 0,
  })

  // The same stage has a DIFFERENT ruleset id on every chain; stages are
  // start-ascending, so the browsed stage index is what aligns them.
  const stagesByChain: Record<number, SimpleRuleset[]> = {
    1: [ruleset('11', 100), ruleset('12', 200), ruleset('13', 300)],
    10: [ruleset('21', 100), ruleset('22', 200), ruleset('23', 300)],
  }

  const readStages = async (projectId: string, chainId: number) => {
    if (projectId !== (chainId === 1 ? '5' : '9')) throw new Error(`wrong project id ${projectId} on ${chainId}`)
    return stagesByChain[chainId]
  }

  const chainProjects = [
    { chainId: 1, projectId: 5 },
    { chainId: 10, projectId: 9 },
  ]

  it('resolves each chain’s own ruleset for the browsed stage index', async () => {
    const rows = await fetchStageRulesetsPerChain(chainProjects, 2, { readStages })
    expect(rows.map(row => [row.chainId, row.ruleset?.id])).toEqual([
      [1, '13'],
      [10, '23'],
    ])
  })

  it('yields a null ruleset for a chain that has no such stage, or whose read failed', async () => {
    const rows = await fetchStageRulesetsPerChain(chainProjects, 2, {
      readStages: async (_projectId, chainId) => (chainId === 10 ? [] : stagesByChain[1]),
    })
    expect(rows[0].ruleset?.id).toBe('13')
    expect(rows[1].ruleset).toBeNull()

    const failed = await fetchStageRulesetsPerChain(chainProjects, 0, {
      readStages: async (_projectId, chainId) => {
        if (chainId === 10) throw new Error('rpc down')
        return stagesByChain[1]
      },
    })
    expect(failed[0].ruleset?.id).toBe('11')
    expect(failed[1].ruleset).toBeNull()
  })

  it('reads one chain’s splits at the ruleset id belonging to THAT chain', async () => {
    const seen: Array<[string, number, string]> = []
    const split: ReservedSplit = {
      percent: 1_000_000_000,
      projectId: 0,
      beneficiary: '0x0000000000000000000000000000000000000001',
      preferAddToBalance: false,
      lockedUntil: 0,
      hook: '0x0000000000000000000000000000000000000000',
    }
    const readSplits = async (projectId: number | string, chainId: number, rulesetId: string) => {
      seen.push([String(projectId), chainId, rulesetId])
      return [split]
    }

    const home = await fetchStageReservedSplits({ chainId: 1, projectId: 5 }, 1, { readStages, readSplits })
    const peer = await fetchStageReservedSplits({ chainId: 10, projectId: 9 }, 1, { readStages, readSplits })

    expect(seen).toEqual([
      ['5', 1, '12'],
      ['9', 10, '22'],
    ])
    expect(home).toEqual({ chainId: 1, projectId: 5, rulesetId: '12', splits: [split] })
    expect(peer.rulesetId).toBe('22')
  })

  it('reports an unreadable chain as null splits rather than throwing or faking an empty group', async () => {
    const row = await fetchStageReservedSplits({ chainId: 10, projectId: 9 }, 0, {
      readStages,
      readSplits: async () => {
        throw new Error('rpc down')
      },
    })
    expect(row).toEqual({ chainId: 10, projectId: 9, rulesetId: '21', splits: null })
  })

  it('passes the pre-send stage guard while the browsed stage still maps to the reviewed ruleset', async () => {
    await expect(
      assertStageRulesetUnchanged({
        chainProject: { chainId: 10, projectId: 9 },
        stageIndex: 1,
        expectedRulesetId: '22',
        deps: { readStages },
      }),
    ).resolves.toBeUndefined()
  })

  it('fails the pre-send stage guard when the stage moved, vanished, or is unreadable', async () => {
    const guard = (deps: Parameters<typeof assertStageRulesetUnchanged>[0]['deps']) =>
      assertStageRulesetUnchanged({
        chainProject: { chainId: 10, projectId: 9 },
        stageIndex: 1,
        expectedRulesetId: '22',
        deps,
      })

    // A re-queued schedule shifted the stage onto a different ruleset id.
    await expect(guard({ readStages: async () => [ruleset('21', 100), ruleset('99', 200)] })).rejects.toThrow(
      /stages changed/i,
    )
    // The stage no longer exists.
    await expect(guard({ readStages: async () => [ruleset('21', 100)] })).rejects.toThrow(/stages changed/i)
    // Fail closed rather than sending blind when the schedule can't be read.
    await expect(
      guard({
        readStages: async () => {
          throw new Error('rpc down')
        },
      }),
    ).rejects.toThrow(/stages changed/i)
  })

  it('reports a chain with no such stage as null splits and no ruleset id', async () => {
    const row = await fetchStageReservedSplits({ chainId: 10, projectId: 9 }, 7, {
      readStages,
      readSplits: async () => [],
    })
    expect(row).toEqual({ chainId: 10, projectId: 9, rulesetId: null, splits: null })
  })
})
