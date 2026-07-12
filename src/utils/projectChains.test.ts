import { describe, expect, it, vi } from 'vitest'
import { resolveProjectChains } from './projectChains'

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
