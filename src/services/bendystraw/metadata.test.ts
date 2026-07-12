import { describe, expect, it, vi } from 'vitest'
import { resolveProjectMetadataForDisplay } from './client'

describe('project metadata display precedence', () => {
  it('uses Bendystraw metadata without consulting the controller fallback', async () => {
    const loadOnchainMetadataUri = vi.fn().mockResolvedValue('ipfs://onchain')
    const fetchMetadata = vi.fn()
    await expect(resolveProjectMetadataForDisplay({
      indexedMetadata: JSON.stringify({ name: 'Indexed name', logoUri: 'ipfs://logo' }),
      indexedMetadataUri: 'ipfs://indexed',
      loadOnchainMetadataUri,
      fetchMetadata,
    })).resolves.toMatchObject({
      metadata: { name: 'Indexed name' },
      metadataUri: 'ipfs://indexed',
      source: 'bendystraw',
    })
    expect(loadOnchainMetadataUri).not.toHaveBeenCalled()
    expect(fetchMetadata).not.toHaveBeenCalled()
  })

  it('loads Bendystraw metadataUri before the onchain fallback', async () => {
    const loadOnchainMetadataUri = vi.fn().mockResolvedValue('ipfs://onchain')
    const fetchMetadata = vi.fn(async uri => uri === 'ipfs://indexed'
      ? { name: 'Indexed URI name' }
      : { name: 'Onchain name' })
    await expect(resolveProjectMetadataForDisplay({
      indexedMetadata: null,
      indexedMetadataUri: 'ipfs://indexed',
      loadOnchainMetadataUri,
      fetchMetadata,
    })).resolves.toMatchObject({
      metadata: { name: 'Indexed URI name' },
      source: 'bendystraw',
    })
    expect(loadOnchainMetadataUri).not.toHaveBeenCalled()
  })

  it('fills parsed Bendystraw JSON from its denormalized metadata fields', async () => {
    await expect(resolveProjectMetadataForDisplay({
      indexedMetadata: { name: 'Parsed name', storeCategories: { 1: 'Entries' } },
      indexedFields: {
        name: 'Search name',
        description: 'Indexed description',
        projectTagline: 'Indexed tagline',
        logoUri: 'ipfs://logo',
      },
      indexedMetadataUri: 'ipfs://indexed',
    })).resolves.toMatchObject({
      metadata: {
        name: 'Parsed name',
        description: 'Indexed description',
        projectTagline: 'Indexed tagline',
        logoUri: 'ipfs://logo',
        storeCategories: { 1: 'Entries' },
      },
      source: 'bendystraw',
    })
  })

  it('does not let an empty indexed object suppress the onchain URI fallback', async () => {
    const loadOnchainMetadataUri = vi.fn().mockResolvedValue('ipfs://onchain')
    const fetchMetadata = vi.fn(async uri => uri === 'ipfs://onchain'
      ? { name: 'Live fallback' }
      : null)
    await expect(resolveProjectMetadataForDisplay({
      indexedMetadata: {},
      loadOnchainMetadataUri,
      fetchMetadata,
    })).resolves.toEqual({
      metadata: { name: 'Live fallback' },
      metadataUri: 'ipfs://onchain',
      source: 'onchain',
    })
    expect(loadOnchainMetadataUri).toHaveBeenCalledOnce()
  })

  it('keeps indexed fields primary while filling their gaps from the controller URI', async () => {
    const fetchMetadata = vi.fn(async () => ({
      name: 'Controller name',
      description: 'Controller description',
      infoUri: 'https://controller.example',
    }))
    await expect(resolveProjectMetadataForDisplay({
      indexedMetadata: null,
      indexedFields: { name: 'Indexed name', logoUri: 'ipfs://indexed-logo' },
      loadOnchainMetadataUri: vi.fn().mockResolvedValue('ipfs://onchain'),
      fetchMetadata,
    })).resolves.toMatchObject({
      metadata: {
        name: 'Indexed name',
        description: 'Controller description',
        logoUri: 'ipfs://indexed-logo',
        infoUri: 'https://controller.example',
      },
      source: 'bendystraw',
    })
  })

  it('uses the current controller URI only when indexed metadata is unavailable', async () => {
    const loadOnchainMetadataUri = vi.fn().mockResolvedValue('ipfs://onchain')
    const fetchMetadata = vi.fn(async uri => uri === 'ipfs://onchain' ? { name: 'Live fallback' } : null)
    await expect(resolveProjectMetadataForDisplay({
      indexedMetadata: '{bad json',
      indexedMetadataUri: 'ipfs://missing',
      loadOnchainMetadataUri,
      fetchMetadata,
    })).resolves.toEqual({
      metadata: { name: 'Live fallback' },
      metadataUri: 'ipfs://onchain',
      source: 'onchain',
    })
    expect(fetchMetadata).toHaveBeenNthCalledWith(1, 'ipfs://missing')
    expect(fetchMetadata).toHaveBeenNthCalledWith(2, 'ipfs://onchain')
  })

  it('drops malformed known fields from user-controlled metadata', async () => {
    await expect(resolveProjectMetadataForDisplay({
      indexedMetadata: {
        name: { unsafe: true },
        description: 123,
        tags: ['valid', 4, null],
        storeCategories: { 1: 'Tickets', 2: { unsafe: true } },
      },
    })).resolves.toMatchObject({
      metadata: {
        tags: ['valid'],
        storeCategories: { 1: 'Tickets' },
      },
      source: 'bendystraw',
    })
    const result = await resolveProjectMetadataForDisplay({
      indexedMetadata: { name: { unsafe: true }, description: 123 },
    })
    expect(result.metadata?.name).toBeUndefined()
    expect(result.metadata?.description).toBeUndefined()
  })
})
