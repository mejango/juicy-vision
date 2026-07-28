/**
 * Unit tests for the pure sucker-bridge helpers: merkle leaf-proof / branch-
 * root construction (fixed vectors derived from the website's algorithm at
 * website/src/discover.js :19941-:19970), the fee-escalation ladder, queued-
 * movement classification, and gossip staleness math.
 */

import { describe, expect, it, vi } from 'vitest'
import { keccak256, zeroAddress, type Hex, type PublicClient } from 'viem'
import {
  BYTES32_ZERO,
  CCIP_TRANSPORT_LADDER,
  NATIVE_SYNC_LADDER,
  accountingContextKey,
  assertCcipTransport,
  classifyMovementStatus,
  escalateValue,
  fetchCompositionRows,
  gossipSnapshotStaleness,
  quotePrepareMin,
  relativeDrift,
  snapshotAge,
  stalenessFromPct,
  suckerBranchRoot,
  suckerHashPair,
  suckerLeafProof,
  suckerZeroHashes,
  unpackSuckerTimestamp,
} from './suckerBridge'

// Deterministic leaves: keccak256 of 0x01 … 0x05 (same generator used to
// derive the pinned vectors below from the website's implementation).
const LEAVES: Hex[] = [
  '0x5fe7f977e71dba2ea1a68e21057beebb9be2ac30c6410aa38d4f3fbe41dcffd2',
  '0xf2ee15ea639b73fa3db9b34a245bdfa015c260c598b211bf05a1ecc4b3e3b4f2',
  '0x69c322e3248a5dfc29d73c5b0553b0185a35cd5bb6386747517ef7e53b15e287',
  '0xf343681465b9efe82c933c3e8748c70cb8aa06539c361de20f72eac04e766393',
  '0xdbb8d0f4c497851a5043c6363657698cb1387682cac2f786c731f8936109d795',
]

// Roots computed by the website's suckerLeafProof + suckerBranchRoot for the
// first `count` leaves — pinned so any drift from the ported algorithm fails.
const EXPECTED_ROOTS: Record<number, Hex> = {
  1: '0x72386aacefe2e6817d40eb1136c21c0d2dee0c641e150dce1c6aa8cfb7426635',
  2: '0xa4b82827a5b0628832c675ceed1498459188bda440bd094e75f236bda4f24478',
  3: '0xb98f04c3f907d54091ebdc4672c4f699f02971e123334f68a6d3d1cb3eca0831',
  5: '0x44b54e9715ad5f57d221f2f5ac1f1f8a82ef0e1892fa2ad3a026d1ceef240379',
}

describe('sucker merkle tree', () => {
  it('leaf generator matches the vector derivation', () => {
    LEAVES.forEach((leaf, i) => {
      expect(keccak256(`0x0${i + 1}` as Hex)).toBe(leaf)
    })
  })

  it('empty-tree zero hashes end at the known MerkleLib root', () => {
    const z = suckerZeroHashes()
    expect(z).toHaveLength(33)
    expect(z[0]).toBe(BYTES32_ZERO)
    expect(z[32]).toBe('0x27ae5ba08d7291c96c8cbddcc148bf48a6d68c7974b94356f53754ef6171d757')
  })

  it('hash pair is keccak256(abi.encode(a, b)) — order-sensitive', () => {
    const a = LEAVES[0]
    const b = LEAVES[1]
    expect(suckerHashPair(a, b)).not.toBe(suckerHashPair(b, a))
    expect(suckerHashPair(a, b)).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it.each([1, 2, 3, 5])('proof for every leaf of a %i-leaf tree recomputes the pinned root', count => {
    const set = LEAVES.slice(0, count)
    for (let index = 0; index < count; index++) {
      const proof = suckerLeafProof(set, index)
      expect(proof).toHaveLength(32)
      expect(suckerBranchRoot(set[index], proof, index)).toBe(EXPECTED_ROOTS[count])
    }
  })

  it('pinned proof elements for index 1 of the 3-leaf tree', () => {
    // First three siblings from the website's algorithm: the index-0 leaf,
    // then hash(leaf2‖Z0), then Z1.
    const proof = suckerLeafProof(LEAVES.slice(0, 3), 1)
    expect(proof[0]).toBe(LEAVES[0])
    expect(proof[1]).toBe('0x010797b82e45e4b84e8413de4896aa9b68ba219d144196fa697fcf784b1b43e6')
    expect(proof[2]).toBe('0xb4c11951957c6f8f642c4af61cd6b24640fec6dc7fc607ee8206a99e92410d30')
  })

  it('a tampered leaf fails root verification', () => {
    const set = LEAVES.slice(0, 3)
    const proof = suckerLeafProof(set, 1)
    expect(suckerBranchRoot(LEAVES[4], proof, 1)).not.toBe(EXPECTED_ROOTS[3])
  })

  it('a proof for the wrong index fails root verification', () => {
    const set = LEAVES.slice(0, 3)
    const proof = suckerLeafProof(set, 1)
    expect(suckerBranchRoot(set[1], proof, 2)).not.toBe(EXPECTED_ROOTS[3])
  })

  it('rejects an out-of-range index instead of fabricating a proof', () => {
    expect(() => suckerLeafProof(LEAVES.slice(0, 3), 3)).toThrow(/outside/)
    expect(() => suckerLeafProof(LEAVES.slice(0, 3), -1)).toThrow(/outside/)
  })

  it('proofs against a PREFIX of the tree match the delivered-root regime', () => {
    // The destination inbox holds the root as of deliveredCount leaves; a
    // claimable proof must be built from exactly that prefix.
    const delivered = LEAVES.slice(0, 2)
    const proof = suckerLeafProof(delivered, 0)
    expect(suckerBranchRoot(delivered[0], proof, 0)).toBe(EXPECTED_ROOTS[2])
    expect(suckerBranchRoot(delivered[0], proof, 0)).not.toBe(EXPECTED_ROOTS[5])
  })
})

describe('escalateValue', () => {
  it('returns the first value whose simulation succeeds', async () => {
    const simulate = vi.fn(async (value: bigint) => {
      if (value < 20n) throw new Error('insufficient fee')
      return 'ok'
    })
    await expect(escalateValue([1n, 5n, 20n, 50n], simulate)).resolves.toBe(20n)
    // Stops at the first success — never simulates (or charges for) larger tiers.
    expect(simulate).toHaveBeenCalledTimes(3)
    expect(simulate.mock.calls.map(call => call[0])).toEqual([1n, 5n, 20n])
  })

  it('returns null when every tier fails', async () => {
    const simulate = vi.fn(async () => {
      throw new Error('always reverts')
    })
    await expect(escalateValue([1n, 2n, 3n], simulate)).resolves.toBeNull()
    expect(simulate).toHaveBeenCalledTimes(3)
  })

  it('returns null for an empty ladder', async () => {
    await expect(escalateValue([], vi.fn())).resolves.toBeNull()
  })

  it('a zero tier can win only when the simulator accepts it (native lanes)', async () => {
    const simulate = vi.fn(async () => 'ok')
    await expect(escalateValue(NATIVE_SYNC_LADDER, simulate)).resolves.toBe(0n)
  })

  it('the CCIP ladder never contains zero', () => {
    expect(CCIP_TRANSPORT_LADDER.every(tier => tier > 0n)).toBe(true)
    // Ascending — the first success is the cheapest sufficient budget.
    for (let i = 1; i < CCIP_TRANSPORT_LADDER.length; i++) {
      expect(CCIP_TRANSPORT_LADDER[i] > CCIP_TRANSPORT_LADDER[i - 1]).toBe(true)
    }
  })
})

describe('assertCcipTransport', () => {
  it('throws on zero value over CCIP', () => {
    expect(() => assertCcipTransport('CCIP', 0n)).toThrow(/refusing to send zero/)
  })

  it('throws when value only covers the base fee over CCIP (zero transport)', () => {
    expect(() => assertCcipTransport('CCIP', 100n, 100n)).toThrow(/refusing to send zero/)
  })

  it('accepts positive transport over CCIP', () => {
    expect(() => assertCcipTransport('CCIP', 101n, 100n)).not.toThrow()
  })

  it('accepts zero over native bridges', () => {
    expect(() => assertCcipTransport('native', 0n)).not.toThrow()
  })

  it('rejects unknown infra outright', () => {
    expect(() => assertCcipTransport('unknown', 10n ** 18n)).toThrow(/could not be verified/)
  })
})

describe('classifyMovementStatus', () => {
  it('executed → claimed', () => {
    expect(classifyMovementStatus({ executed: true, index: 0, deliveredCount: 5, sentCount: 5 })).toEqual({
      status: 'claimed',
      canExecute: false,
    })
  })

  it('delivered but unexecuted → claimable', () => {
    expect(classifyMovementStatus({ executed: false, index: 2, deliveredCount: 3, sentCount: 3 })).toEqual({
      status: 'claimable',
      canExecute: false,
    })
  })

  it('sent but not delivered → pending, not executable (already in flight)', () => {
    expect(classifyMovementStatus({ executed: false, index: 2, deliveredCount: 1, sentCount: 3 })).toEqual({
      status: 'pending',
      canExecute: false,
    })
  })

  it('queued but never sent → pending and executable', () => {
    expect(classifyMovementStatus({ executed: false, index: 3, deliveredCount: 1, sentCount: 3 })).toEqual({
      status: 'pending',
      canExecute: true,
    })
  })
})

describe('gossip staleness', () => {
  const eth = (balance: bigint) => ({
    token: '0x000000000000000000000000000000000000EEEe' as const,
    balance,
    decimals: 18,
    symbol: 'ETH',
  })

  it('relativeDrift is symmetric and scaled to the larger value', () => {
    expect(relativeDrift(0n, 0n)).toBe(0)
    expect(relativeDrift(100n, 100n)).toBe(0)
    expect(relativeDrift(95n, 100n)).toBeCloseTo(0.05, 6)
    expect(relativeDrift(100n, 95n)).toBeCloseTo(0.05, 6)
    expect(relativeDrift(0n, 100n)).toBe(1)
  })

  it('stalenessFromPct thresholds: 0 → synced, ≤5% → slight, >5% → danger', () => {
    expect(stalenessFromPct(0).level).toBe('synced')
    expect(stalenessFromPct(0.03)).toMatchObject({ level: 'slight', label: '3% stale' })
    expect(stalenessFromPct(0.05).level).toBe('slight')
    expect(stalenessFromPct(0.0501).level).toBe('danger')
  })

  it('matching snapshot reads In sync', () => {
    const staleness = gossipSnapshotStaleness(
      { supply: 1000n, balances: [eth(500n)] },
      { gossipSupply: 1000n, gossipTokens: [eth(500n)], gossipVerified: true },
    )
    expect(staleness.level).toBe('synced')
  })

  it('worst drift across supply and balances wins', () => {
    const staleness = gossipSnapshotStaleness(
      { supply: 1000n, balances: [eth(500n)] },
      { gossipSupply: 990n, gossipTokens: [eth(250n)], gossipVerified: true },
    )
    expect(staleness.level).toBe('danger')
    expect(staleness.pct).toBeCloseTo(0.5, 4)
  })

  it('unreadable live values report Unverified, never fake drift', () => {
    expect(gossipSnapshotStaleness({ supply: 1000n, balances: [] }, undefined).level).toBe('unknown')
    expect(
      gossipSnapshotStaleness(
        { supply: 1000n, balances: [] },
        { gossipSupply: null, gossipTokens: [], gossipVerified: true },
      ).level,
    ).toBe('unknown')
    expect(
      gossipSnapshotStaleness(
        { supply: 1000n, balances: [] },
        { gossipSupply: 1000n, gossipTokens: [], gossipVerified: false },
      ).level,
    ).toBe('unknown')
  })

  it('custom-token contexts with mismatched addresses report Unverified (unverified sucker mapping)', () => {
    const snapshotToken = { token: '0x1111111111111111111111111111111111111111' as const, balance: 5n, decimals: 18, symbol: 'TOKEN' }
    const liveToken = { token: '0x2222222222222222222222222222222222222222' as const, balance: 5n, decimals: 18, symbol: 'TOKEN' }
    const staleness = gossipSnapshotStaleness(
      { supply: 100n, balances: [snapshotToken] },
      { gossipSupply: 100n, gossipTokens: [liveToken], gossipVerified: true },
    )
    expect(staleness.level).toBe('unknown')
  })

  it('canonical USDC normalizes across differing per-chain addresses', () => {
    const usdcA = { token: '0x3333333333333333333333333333333333333333' as const, balance: 7n, decimals: 6, symbol: 'USDC' }
    const usdcB = { token: '0x4444444444444444444444444444444444444444' as const, balance: 7n, decimals: 6, symbol: 'USDC' }
    const staleness = gossipSnapshotStaleness(
      { supply: 100n, balances: [usdcA] },
      { gossipSupply: 100n, gossipTokens: [usdcB], gossipVerified: true },
    )
    expect(staleness.level).toBe('synced')
  })

  it('accountingContextKey: native/USDC canonicalize, customs key by address', () => {
    expect(accountingContextKey('0x000000000000000000000000000000000000EEEe', 'ETH', 18)).toBe('native@18')
    expect(accountingContextKey('0x3333333333333333333333333333333333333333', 'USDC', 6)).toBe('usdc@6')
    expect(accountingContextKey('0xAbCd111111111111111111111111111111111111', 'TOKEN', 18)).toBe(
      '0xabcd111111111111111111111111111111111111@18',
    )
  })
})

describe('timestamps', () => {
  it('unpacks packed (ts<<128|seq) sucker timestamps', () => {
    const ts = 1_752_600_000n
    expect(unpackSuckerTimestamp((ts << 128n) | 42n)).toBe(1_752_600_000)
    expect(unpackSuckerTimestamp(0n)).toBe(0)
  })

  it('snapshotAge labels', () => {
    const now = 1_000_000
    expect(snapshotAge(0, now)).toBe('never')
    expect(snapshotAge(now - 30, now)).toBe('just now')
    expect(snapshotAge(now - 300, now)).toBe('5m ago')
    expect(snapshotAge(now - 7200, now)).toBe('2h ago')
    expect(snapshotAge(now - 172800, now)).toBe('2d ago')
  })
})

describe('quotePrepareMin', () => {
  const SUCKER = '0x5555555555555555555555555555555555555555' as const
  const TERM_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

  interface RecordedRead {
    functionName: string
    args: readonly unknown[]
  }

  // Mirrors the deployed contracts: JBFeelessAddresses only exposes the
  // 3-arg isFeelessFor(addr, projectId, caller) — a 1-arg call is an unknown
  // selector and reverts, exactly like on-chain.
  function quoteClient(log: RecordedRead[]): PublicClient {
    return {
      readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        log.push({ functionName, args: args ?? [] })
        if (functionName === 'previewCashOutFrom') return [{}, 1_000n, 1n, []]
        if (functionName === 'isFeelessFor') {
          if ((args ?? []).length !== 3) throw new Error('execution reverted (unknown selector)')
          return false
        }
        if (functionName === 'feeFreeSurplusOf') return 0n
        throw new Error(`unhandled read ${functionName}`)
      },
    } as unknown as PublicClient
  }

  it('reads the deployed 3-arg isFeelessFor with the sucker as beneficiary AND caller', async () => {
    const log: RecordedRead[] = []
    await quotePrepareMin(
      { projectId: 7, chainId: 1, sucker: SUCKER, amount: 100n, termToken: TERM_TOKEN },
      { clientFor: () => quoteClient(log) },
    )
    const feeless = log.find(entry => entry.functionName === 'isFeelessFor')
    expect(feeless?.args).toEqual([SUCKER, 7n, SUCKER])
  })

  it('produces a quote (gross, fee-adjusted net, 99% floor) instead of rejecting', async () => {
    const quote = await quotePrepareMin(
      { projectId: 7, chainId: 1, sucker: SUCKER, amount: 100n, termToken: TERM_TOKEN },
      { clientFor: () => quoteClient([]) },
    )
    // Non-zero tax → the 2.5% protocol fee applies to the whole reclaim.
    expect(quote.gross).toBe(1_000n)
    expect(quote.net).toBe(975n)
    expect(quote.minReclaimed).toBe(965n)
  })
})

describe('fetchCompositionRows per-chain project id', () => {
  interface RecordedRead {
    chainId: number
    functionName: string
    args: readonly unknown[]
  }

  // A client that records every read and short-circuits: controllerOf returns
  // the zero address so the row read stops before the per-context balance reads,
  // and everything else rejects (the callers all tolerate per-chain failures).
  function recordingClient(chainId: number, log: RecordedRead[]): PublicClient {
    return {
      readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        log.push({ chainId, functionName, args: args ?? [] })
        if (functionName === 'controllerOf') return zeroAddress
        if (functionName === 'terminalsOf') return []
        throw new Error(`unhandled read ${functionName}`)
      },
    } as unknown as PublicClient
  }

  it('reads each chain with ITS OWN project id — never the home id off-home', async () => {
    const log: RecordedRead[] = []
    // Divergent per-chain ids: #7 on chain 1 (home), #42 on chain 8453.
    await fetchCompositionRows(
      [{ chainId: 1, projectId: 7 }, { chainId: 8453, projectId: 42 }],
      { clientFor: (chainId: number) => recordingClient(chainId, log) },
    )

    const controllerArg = (chainId: number) =>
      log.find(entry => entry.chainId === chainId && entry.functionName === 'controllerOf')?.args[0]
    expect(controllerArg(1)).toBe(7n)
    expect(controllerArg(8453)).toBe(42n)
    // The off-home chain must NEVER be read with the home id.
    expect(log.some(entry => entry.chainId === 8453 && entry.args[0] === 7n)).toBe(false)
    expect(log.some(entry => entry.chainId === 1 && entry.args[0] === 42n)).toBe(false)
  })
})
