import { CHAIN_SLUG_TO_ID, PROJECT_SLUG_REGEX } from './projectLink'

export interface ProjectNavigationHint {
  chainId: number
  projectId: number
  name: string
  logoUri?: string | null
  tagline?: string | null
}

const MAX_HINTS = 24
const hints = new Map<string, ProjectNavigationHint>()

function key(chainId: number, projectId: number): string {
  return `${chainId}:${projectId}`
}

function normalize(hint: ProjectNavigationHint): ProjectNavigationHint | null {
  const name = hint.name.trim().slice(0, 200)
  if (!name || !Number.isSafeInteger(hint.chainId) || !Number.isSafeInteger(hint.projectId)) {
    return null
  }
  return {
    chainId: hint.chainId,
    projectId: hint.projectId,
    name,
    logoUri: hint.logoUri?.trim().slice(0, 2_048) || null,
    tagline: hint.tagline?.trim().slice(0, 500) || null,
  }
}

/** Seed identity already visible at the navigation source. */
export function rememberProjectNavigation(hint: ProjectNavigationHint): void {
  const normalized = normalize(hint)
  if (!normalized) return
  const hintKey = key(normalized.chainId, normalized.projectId)
  hints.delete(hintKey)
  hints.set(hintKey, normalized)
  if (hints.size > MAX_HINTS) {
    const oldest = hints.keys().next().value
    if (typeof oldest === 'string') hints.delete(oldest)
  }
}

export function getProjectNavigationHint(
  chainId: number,
  projectId: number,
): ProjectNavigationHint | null {
  return hints.get(key(chainId, projectId)) ?? null
}

export function getProjectNavigationHintForPath(
  pathname: string,
): ProjectNavigationHint | null {
  const slug = pathname.replace(/^\/+|\/+$/g, '')
  const match = slug.match(PROJECT_SLUG_REGEX)
  const chainId = match?.[1] ? CHAIN_SLUG_TO_ID[match[1].toLowerCase()] : undefined
  const projectId = match?.[2] ? Number(match[2]) : Number.NaN
  return chainId && Number.isSafeInteger(projectId)
    ? getProjectNavigationHint(chainId, projectId)
    : null
}

export function clearProjectNavigationHints(): void {
  hints.clear()
}
