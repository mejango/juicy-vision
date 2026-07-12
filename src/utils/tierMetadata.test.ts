import { describe, expect, it } from 'vitest'
import { buildTierCategoryPlan, buildTierMetadata, isSafeTierMediaUri } from './tierMetadata'

describe('tier category metadata', () => {
  it('persists stable project category names and keeps uncategorized tiers at zero', () => {
    expect(buildTierCategoryPlan([
      { id: 'a', categoryName: 'Access' },
      { id: 'b', categoryName: 'Merch' },
      { id: 'c', categoryName: 'Access' },
      { id: 'd', categoryName: ' ' },
    ])).toEqual({
      categoryByTierId: { a: 1, b: 2, c: 1, d: 0 },
      storeCategories: { '1': 'Access', '2': 'Merch' },
    })
  })
})

describe('tier metadata payload', () => {
  it('persists descriptions, animation URLs, media types, and category names', () => {
    expect(buildTierMetadata({
      name: ' Listening room ',
      description: ' An hour-long mix ',
      image: ' https://example.com/poster.png ',
      animationUrl: ' https://example.com/audio.mp3 ',
      mediaType: ' audio/mpeg ',
      categoryName: ' Experiences ',
    })).toEqual({
      name: 'Listening room',
      description: 'An hour-long mix',
      image: 'https://example.com/poster.png',
      animation_url: 'https://example.com/audio.mp3',
      mediaType: 'audio/mpeg',
      categoryName: 'Experiences',
    })
  })

  it('omits blank optional fields and rejects a blank name', () => {
    expect(buildTierMetadata({ name: 'Item', description: ' ' })).toEqual({
      name: 'Item',
      description: undefined,
      image: undefined,
      animation_url: undefined,
      mediaType: undefined,
      categoryName: undefined,
    })
    expect(() => buildTierMetadata({ name: ' ' })).toThrow('Tier name is required')
  })

  it('blocks unsafe media references and malformed media types', () => {
    expect(isSafeTierMediaUri('ipfs://Qmb7EZvTHUeVTDi6YmwDFQvKEfCR4UGciUka24coJcNJzS')).toBe(true)
    expect(isSafeTierMediaUri('https://example.com/item.mp4')).toBe(true)
    expect(isSafeTierMediaUri('javascript:alert(1)')).toBe(false)
    expect(() => buildTierMetadata({ name: 'Bad', animationUrl: 'javascript:alert(1)' })).toThrow(/Animation/)
    expect(() => buildTierMetadata({ name: 'Bad', mediaType: 'video' })).toThrow(/MIME/)
  })
})
