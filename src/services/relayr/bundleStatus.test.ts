import { describe, it, expect } from 'vitest'
import { transformBundleResponse, type RawBundleResponse } from './client'

// A Relayr call is terminally confirmed under BOTH 'Success' and 'Completed'. Before this fix, 'Completed'
// fell through to 'pending', so a bundle whose chains reported 'Completed' never reached 'completed' and the
// omnichain modal (launch / revnet / deploy / setUri / splits / distribute / queueRuleset) spun forever.
function rawTx(chain: number, state: string, hash?: string): RawBundleResponse['transactions'][number] {
  return {
    request: { chain, target: '0x0000000000000000000000000000000000000001' },
    // `data` only exists on the non-terminal-invalid variants; hash lives under it.
    status: { state, ...(hash ? { data: { hash } } : { data: {} }) } as RawBundleResponse['transactions'][number]['status'],
    tx_uuid: `uuid-${chain}`,
  }
}

function rawBundle(txs: RawBundleResponse['transactions']): RawBundleResponse {
  return { bundle_uuid: 'b1', created_at: '', payment: null, payment_received: true, transactions: txs }
}

describe('Relayr bundle status — Completed vs Success', () => {
  it('treats a Completed record as confirmed and finishes the bundle', () => {
    const result = transformBundleResponse(rawBundle([
      rawTx(1, 'Completed', '0xaaa'),
      rawTx(10, 'Success', '0xbbb'),
    ]))
    expect(result.transactions.map(t => t.status)).toEqual(['confirmed', 'confirmed'])
    expect(result.transactions.map(t => t.tx_hash)).toEqual(['0xaaa', '0xbbb'])
    expect(result.status).toBe('completed')
  })

  it('does not stall a bundle that is still partly Completed', () => {
    const result = transformBundleResponse(rawBundle([
      rawTx(1, 'Completed', '0xaaa'),
      rawTx(10, 'Pending'),
    ]))
    expect(result.transactions.map(t => t.status)).toEqual(['confirmed', 'pending'])
    expect(result.status).toBe('processing')
  })
})
