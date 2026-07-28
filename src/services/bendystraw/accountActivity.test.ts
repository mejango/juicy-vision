/**
 * Account-activity beneficiary merge: the top-level activityEvents filter has
 * no beneficiary field, so beneficiary-bearing event roots are queried
 * separately and merged with the from-branch — deduped by sub-event id,
 * newest first.
 */

import { describe, it, expect } from 'vitest'
import { mergeAccountActivityEvents } from './accountActivity'

const PROJECT = { projectId: 7, name: 'P', handle: 'p', decimals: 18, currency: 1 }

function fromRow(over: Record<string, unknown> = {}) {
  return {
    id: 'activity-1',
    chainId: 1,
    timestamp: 100,
    from: '0xme',
    txHash: '0xtx1',
    project: PROJECT,
    payEvent: { id: 'pay-1', amount: '1', amountUsd: '1', from: '0xme', txHash: '0xtx1' },
    ...over,
  }
}

describe('mergeAccountActivityEvents', () => {
  it('dedupes beneficiary rows already present in the from-branch by sub-event id', () => {
    const merged = mergeAccountActivityEvents({
      activityEvents: { items: [fromRow()] },
      beneficiaryPayEvents: {
        items: [{
          id: 'pay-1', // same underlying event — the account paid itself
          chainId: 1,
          timestamp: 100,
          txHash: '0xtx1',
          from: '0xme',
          beneficiary: '0xme',
          amount: '1',
          amountUsd: '1',
          project: PROJECT,
        }],
      },
    })
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('activity-1')
  })

  it('appends beneficiary-only rows as activity rows carrying the sub-event payload', () => {
    const merged = mergeAccountActivityEvents({
      activityEvents: { items: [fromRow()] },
      beneficiaryPayEvents: {
        items: [{
          id: 'pay-2',
          chainId: 10,
          timestamp: 200,
          txHash: '0xtx2',
          from: '0xother',
          beneficiary: '0xme',
          amount: '5',
          amountUsd: '5',
          project: PROJECT,
        }],
      },
      beneficiaryMintTokensEvents: {
        items: [{
          id: 'mint-1',
          chainId: 1,
          timestamp: 50,
          txHash: '0xtx3',
          from: '0xowner',
          beneficiary: '0xme',
          tokenCount: '9',
          project: PROJECT,
        }],
      },
    })
    expect(merged.map(r => r.id)).toEqual(['pay-2', 'activity-1', 'mint-1']) // newest first
    const pay = merged[0] as Record<string, unknown>
    expect((pay.payEvent as Record<string, unknown>).amount).toBe('5')
    expect(pay.chainId).toBe(10)
    expect(pay.project).toEqual(PROJECT)
    const mint = merged[2] as Record<string, unknown>
    expect((mint.mintTokensEvent as Record<string, unknown>).tokenCount).toBe('9')
  })

  it('maps manual-mint and auto-issue roots onto the mint sub-event shape', () => {
    const merged = mergeAccountActivityEvents({
      activityEvents: { items: [] },
      beneficiaryManualMintTokensEvents: {
        items: [{
          id: 'manual-1', chainId: 1, timestamp: 10, txHash: '0xa', from: '0xop',
          beneficiary: '0xme', tokenCount: '3', project: PROJECT,
        }],
      },
      beneficiaryAutoIssueEvents: {
        items: [{
          id: 'auto-1', chainId: 1, timestamp: 20, txHash: '0xb', from: '0xdeployer',
          beneficiary: '0xme', tokenCount: '4', project: PROJECT,
        }],
      },
    })
    expect(merged.map(r => r.id)).toEqual(['auto-1', 'manual-1'])
    expect((merged[0] as Record<string, unknown>).mintTokensEvent).toMatchObject({ tokenCount: '4' })
    expect((merged[1] as Record<string, unknown>).mintTokensEvent).toMatchObject({ tokenCount: '3' })
  })

  it('dedupes across the beneficiary sub-event kinds independently', () => {
    // Same id string under DIFFERENT kinds must not collide.
    const merged = mergeAccountActivityEvents({
      activityEvents: { items: [] },
      beneficiaryPayEvents: {
        items: [{ id: 'x', chainId: 1, timestamp: 2, txHash: '0x1', from: '0xa', beneficiary: '0xme', amount: '1', project: PROJECT }],
      },
      beneficiaryCashOutEvents: {
        items: [{ id: 'x', chainId: 1, timestamp: 1, txHash: '0x2', from: '0xa', beneficiary: '0xme', reclaimAmount: '1', project: PROJECT }],
      },
    })
    expect(merged).toHaveLength(2)
  })

  it('tolerates missing roots (partial responses)', () => {
    const merged = mergeAccountActivityEvents({ activityEvents: { items: [fromRow()] } })
    expect(merged).toHaveLength(1)
  })
})
