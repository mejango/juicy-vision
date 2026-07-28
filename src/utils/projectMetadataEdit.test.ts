import { describe, expect, it } from 'vitest'
import {
  customPropertiesOf,
  editsFromMetadata,
  mergeProjectMetadataEdits,
  mergeWithCustomProperties,
  metadataEquals,
  parseCustomPropertiesJson,
  preservedMetadataKeys,
  type ProjectMetadataEdits,
} from './projectMetadataEdit'

const edits = (overrides: Partial<ProjectMetadataEdits> = {}): ProjectMetadataEdits => ({
  name: 'My Project',
  tagline: '',
  description: '',
  logoUri: '',
  infoUri: '',
  payDisclosure: '',
  tags: [],
  tagsEditable: true,
  ...overrides,
})

describe('mergeProjectMetadataEdits', () => {
  it('preserves unknown keys and nested objects on a name-only edit', () => {
    const current = {
      name: 'Old Name',
      description: 'Keep me',
      leagueID: 42,
      tags: ['football', 'league'],
      stats: { wins: 3, nested: { deep: true } },
      customList: [1, 2, 3],
    }
    const prefilled = editsFromMetadata(current)
    const merged = mergeProjectMetadataEdits(current, { ...prefilled, name: 'New Name' })

    expect(merged.name).toBe('New Name')
    expect(merged.description).toBe('Keep me')
    expect(merged.leagueID).toBe(42)
    expect(merged.tags).toEqual(['football', 'league'])
    expect(merged.stats).toEqual({ wins: 3, nested: { deep: true } })
    expect(merged.customList).toEqual([1, 2, 3])
  })

  it('does not mutate the current metadata object', () => {
    const current = { name: 'A', stats: { wins: 1 } }
    mergeProjectMetadataEdits(current, edits({ name: 'B' }))
    expect(current.name).toBe('A')
  })

  it('sets payDisclosure when provided and removes it when cleared', () => {
    const withNotice = mergeProjectMetadataEdits({}, edits({ payDisclosure: 'You get nothing.' }))
    expect(withNotice.payDisclosure).toBe('You get nothing.')

    const cleared = mergeProjectMetadataEdits(
      { name: 'X', payDisclosure: 'old notice' },
      edits({ name: 'X', payDisclosure: '' }),
    )
    expect('payDisclosure' in cleared).toBe(false)
  })

  it('removes cleared string fields but never deletes non-string values on empty edits', () => {
    const current = {
      name: 'X',
      tagline: 'old tagline',
      description: { rich: 'object description' },
    }
    const merged = mergeProjectMetadataEdits(current, edits({ name: 'X', tagline: '', description: '' }))
    expect('tagline' in merged).toBe(false)
    // Non-string current value + empty edit -> preserved untouched.
    expect(merged.description).toEqual({ rich: 'object description' })
  })

  it('trims string edits', () => {
    const merged = mergeProjectMetadataEdits({}, edits({ name: '  Padded  ' }))
    expect(merged.name).toBe('Padded')
  })

  it('writes tags when edited, clears when emptied, and leaves uneditable tag shapes alone', () => {
    const written = mergeProjectMetadataEdits({}, edits({ tags: ['a', 'b'] }))
    expect(written.tags).toEqual(['a', 'b'])

    const cleared = mergeProjectMetadataEdits({ tags: ['a'] }, edits({ tags: [] }))
    expect('tags' in cleared).toBe(false)

    const weird = { tags: { not: 'an array' } }
    const prefilled = editsFromMetadata(weird)
    expect(prefilled.tagsEditable).toBe(false)
    const merged = mergeProjectMetadataEdits(weird, { ...prefilled, name: 'X' })
    expect(merged.tags).toEqual({ not: 'an array' })
  })
})

describe('editsFromMetadata', () => {
  it('prefills string fields and tags', () => {
    const prefilled = editsFromMetadata({
      name: 'N',
      tagline: 'T',
      description: 'D',
      logoUri: 'ipfs://logo',
      infoUri: 'https://x',
      payDisclosure: 'P',
      tags: ['one', 'two'],
    })
    expect(prefilled).toEqual({
      name: 'N',
      tagline: 'T',
      description: 'D',
      logoUri: 'ipfs://logo',
      infoUri: 'https://x',
      payDisclosure: 'P',
      tags: ['one', 'two'],
      tagsEditable: true,
    })
  })

  it('leaves non-string known fields blank without claiming them', () => {
    const prefilled = editsFromMetadata({ name: 'N', description: { rich: true } })
    expect(prefilled.description).toBe('')
  })
})

describe('preservedMetadataKeys', () => {
  it('lists keys the form does not edit', () => {
    const keys = preservedMetadataKeys({
      name: 'N',
      description: 'D',
      leagueID: 42,
      twitter: '@x',
      stats: { a: 1 },
    })
    expect(keys).toEqual(['leagueID', 'twitter', 'stats'])
  })

  it('lists known keys whose shape the form cannot edit', () => {
    const keys = preservedMetadataKeys({ name: 'N', tags: { not: 'array' }, description: { rich: true } })
    expect(keys).toEqual(['tags', 'description'])
  })

  it('returns an empty list when everything is editable', () => {
    expect(preservedMetadataKeys({ name: 'N', tags: ['a'] })).toEqual([])
  })
})

describe('customPropertiesOf', () => {
  it('returns exactly the unmanaged keys with their values', () => {
    const current = { name: 'N', leagueID: 42, stats: { a: 1 }, tags: ['x'] }
    expect(customPropertiesOf(current)).toEqual({ leagueID: 42, stats: { a: 1 } })
  })

  it('is empty when everything is managed', () => {
    expect(customPropertiesOf({ name: 'N', tags: ['a'] })).toEqual({})
  })
})

describe('mergeWithCustomProperties', () => {
  const current = {
    name: 'Old',
    description: 'D',
    leagueID: 42,
    stats: { wins: 3 },
    tags: ['football'],
  }

  it('round-trips untouched custom properties', () => {
    const prefilled = editsFromMetadata(current)
    const merged = mergeWithCustomProperties(current, { ...prefilled, name: 'New' }, customPropertiesOf(current))
    expect(merged).toEqual({ ...current, name: 'New' })
  })

  it('replaces the unrecognized-key set: removing deletes, adding adds, editing updates', () => {
    const prefilled = editsFromMetadata(current)
    const merged = mergeWithCustomProperties(current, prefilled, { leagueID: 43, newKey: 'hello' })
    expect(merged.leagueID).toBe(43)
    expect(merged.newKey).toBe('hello')
    expect('stats' in merged).toBe(false)
    expect(merged.name).toBe('Old')
    expect(merged.tags).toEqual(['football'])
  })

  it('lets managed form fields win when a custom key collides', () => {
    const prefilled = editsFromMetadata(current)
    const merged = mergeWithCustomProperties(
      current,
      { ...prefilled, name: 'Form Name' },
      { ...customPropertiesOf(current), name: 'JSON Name', tags: ['json-tag'] },
    )
    expect(merged.name).toBe('Form Name')
    expect(merged.tags).toEqual(['football'])
  })

  it('lets the JSON editor own known keys with uneditable shapes', () => {
    const weird = { name: 'N', tags: { not: 'array' } }
    const prefilled = editsFromMetadata(weird)
    expect(prefilled.tagsEditable).toBe(false)
    const merged = mergeWithCustomProperties(weird, prefilled, { tags: { still: 'object' } })
    expect(merged.tags).toEqual({ still: 'object' })
  })
})

describe('parseCustomPropertiesJson', () => {
  it('parses blank as no custom properties', () => {
    expect(parseCustomPropertiesJson('')).toEqual({})
    expect(parseCustomPropertiesJson('   ')).toEqual({})
  })

  it('parses a JSON object', () => {
    expect(parseCustomPropertiesJson('{"leagueID": 42}')).toEqual({ leagueID: 42 })
  })

  it('returns null for invalid JSON and non-objects', () => {
    expect(parseCustomPropertiesJson('{oops')).toBeNull()
    expect(parseCustomPropertiesJson('[1,2]')).toBeNull()
    expect(parseCustomPropertiesJson('"string"')).toBeNull()
    expect(parseCustomPropertiesJson('null')).toBeNull()
  })
})

describe('metadataEquals', () => {
  it('treats key order as irrelevant and nested changes as differences', () => {
    expect(metadataEquals({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true)
    expect(metadataEquals({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } })).toBe(false)
    expect(metadataEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})
