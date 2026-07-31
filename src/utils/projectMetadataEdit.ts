/**
 * Merge helpers for editing project metadata without destroying keys the form
 * doesn't know about. The editor always spreads the CURRENT on-chain JSON first
 * and only overwrites the fields the user actually edited, so custom keys (for
 * example `leagueID`) and nested objects survive a name-only edit.
 */

/** String fields the metadata editor can set or clear. */
const EDITABLE_STRING_KEYS = [
  'name',
  'tagline',
  'description',
  'logoUri',
  'infoUri',
  'payDisclosure',
] as const

type EditableStringKey = (typeof EDITABLE_STRING_KEYS)[number]

/** Known metadata fields this editor preserves but does not expose as custom properties. */
const RETAINED_METADATA_KEYS = ['version'] as const

export interface ProjectMetadataEdits {
  name: string
  tagline: string
  description: string
  logoUri: string
  infoUri: string
  payDisclosure: string
  tags: string[]
  /** False when the current `tags` value isn't a string array — the form then leaves it untouched. */
  tagsEditable: boolean
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

/** Prefill form fields from the current metadata JSON. Non-string values stay blank (and preserved). */
export function editsFromMetadata(current: Record<string, unknown>): ProjectMetadataEdits {
  const stringField = (key: EditableStringKey): string => {
    const value = current[key]
    return typeof value === 'string' ? value : ''
  }
  const tagsEditable = current.tags === undefined || isStringArray(current.tags)
  return {
    name: stringField('name'),
    tagline: stringField('tagline'),
    description: stringField('description'),
    logoUri: stringField('logoUri'),
    infoUri: stringField('infoUri'),
    payDisclosure: stringField('payDisclosure'),
    tags: isStringArray(current.tags) ? [...current.tags] : [],
    tagsEditable,
  }
}

/**
 * Build the metadata object to pin: current JSON spread first, edited fields
 * overwritten. An emptied field clears its key, but only when the current value
 * is a string (or absent) — the form never deletes a value shape it can't edit.
 */
export function mergeProjectMetadataEdits(
  current: Record<string, unknown>,
  edits: ProjectMetadataEdits,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current }

  for (const key of EDITABLE_STRING_KEYS) {
    const trimmed = edits[key].trim()
    if (trimmed) {
      merged[key] = trimmed
    } else if (typeof current[key] === 'string' || current[key] === undefined || current[key] === null) {
      delete merged[key]
    }
  }

  if (edits.tagsEditable) {
    const tags = edits.tags.map(tag => tag.trim()).filter(Boolean)
    if (tags.length > 0) merged.tags = tags
    else delete merged.tags
  }

  return merged
}

/** Keys in the current JSON the form doesn't edit (unknown keys + uneditable shapes), kept as-is. */
export function preservedMetadataKeys(current: Record<string, unknown>): string[] {
  return Object.keys(current).filter(key => {
    if ((RETAINED_METADATA_KEYS as readonly string[]).includes(key)) return false
    const value = current[key]
    if (key === 'tags') return !isStringArray(value)
    if ((EDITABLE_STRING_KEYS as readonly string[]).includes(key)) return typeof value !== 'string'
    return true
  })
}

/** The current values of every key the form doesn't manage — the Advanced JSON editor's prefill. */
export function customPropertiesOf(current: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(preservedMetadataKeys(current).map(key => [key, current[key]]))
}

/** True when the form's own inputs own this key (so it wins over the Advanced JSON on collision). */
function isManagedKey(key: string, edits: ProjectMetadataEdits): boolean {
  if ((RETAINED_METADATA_KEYS as readonly string[]).includes(key)) return true
  if ((EDITABLE_STRING_KEYS as readonly string[]).includes(key)) return true
  return key === 'tags' && edits.tagsEditable
}

/**
 * Full merge for the editor: managed fields behave like
 * {@link mergeProjectMetadataEdits}, while `custom` REPLACES the entire
 * unrecognized-key set (removing a key there deletes it, adding one adds it).
 * Managed form fields always win when a custom key collides with one of them.
 */
export function mergeWithCustomProperties(
  current: Record<string, unknown>,
  edits: ProjectMetadataEdits,
  custom: Record<string, unknown>,
): Record<string, unknown> {
  const unrecognized = new Set(preservedMetadataKeys(current))
  const managedBase: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(current)) {
    if (!unrecognized.has(key)) managedBase[key] = value
  }

  const merged = mergeProjectMetadataEdits(managedBase, edits)
  for (const [key, value] of Object.entries(custom)) {
    if (isManagedKey(key, edits)) continue
    merged[key] = value
  }
  return merged
}

/**
 * Parse the Advanced JSON textarea. Blank means "no custom properties".
 * Returns null when the text isn't a JSON object — callers must block saving.
 */
export function parseCustomPropertiesJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return {}
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((out, key) => {
        out[key] = normalize((value as Record<string, unknown>)[key])
        return out
      }, {})
  }
  return value
}

/** Deep equality with key order ignored — used to detect whether an edit changes anything. */
export function metadataEquals(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}
