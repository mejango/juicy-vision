import { describe, expect, it, vi } from 'vitest'
import { makeProjectIdResolver, resolveProjectChains } from './projectChains'

describe('resolveProjectChains', () => {
  it('uses a verified sucker-group mapping', async () => {
    await expect(resolveProjectChains('9', 84532, vi.fn().mockResolvedValue([
      { chainId: 84532, projectId: 9 },
      { chainId: 11155111, projectId: 12 },
    ]))).resolves.toEqual({
      chains: [
        { chainId: 84532, projectId: 9 },
        { chainId: 11155111, projectId: 12 },
      ],
      mappingAvailable: true,
    })
  })

  it('uses only the supplied project when Bendystraw is unavailable', async () => {
    await expect(resolveProjectChains(
      '9',
      84532,
      vi.fn().mockRejectedValue(new Error('index unavailable')),
    )).resolves.toEqual({
      chains: [{ chainId: 84532, projectId: 9 }],
      mappingAvailable: false,
      error: 'index unavailable',
    })
  })

  it('treats a verified empty group as a current-chain-only project', async () => {
    await expect(resolveProjectChains('9', 84532, vi.fn().mockResolvedValue([]))).resolves.toEqual({
      chains: [{ chainId: 84532, projectId: 9 }],
      mappingAvailable: true,
    })
  })
})

describe('makeProjectIdResolver', () => {
  it('resolves each chain to ITS OWN project id (divergent per-chain ids)', () => {
    const pidFor = makeProjectIdResolver(
      [{ chainId: 1, projectId: 7 }, { chainId: 8453, projectId: 42 }],
      { chainId: 1, projectId: 7 },
    )
    expect(pidFor(1)).toBe(7n)
    expect(pidFor(8453)).toBe(42n)
  })

  it('returns null for a chain absent from the map — NEVER the home id', () => {
    const pidFor = makeProjectIdResolver(
      [{ chainId: 1, projectId: 7 }],
      { chainId: 1, projectId: 7 },
    )
    // Chain 10 is not in the group → not this project on that chain, never home id 7.
    expect(pidFor(10)).toBeNull()
  })

  it('falls back to the home entry only when no map is supplied (single home chain)', () => {
    const pidFor = makeProjectIdResolver(undefined, { chainId: 1, projectId: 7 })
    expect(pidFor(1)).toBe(7n)
    // A non-home chain still resolves to null, never the home id.
    expect(pidFor(8453)).toBeNull()
  })
})
