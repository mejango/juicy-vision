import { CHAINS, MAINNET_CHAINS, TESTNET_CHAINS } from '../constants'
import { IS_TESTNET } from '../config/environment'

// juicebox.money does not yet host V6 project pages. Flip this once it does;
// every ProjectLink will then use the canonical external URL.
const JUICEBOX_MONEY_V6_LIVE = false

export function juiceboxProjectUrl(
  chainSlug: string,
  projectId: string | number,
): string | null {
  if (!JUICEBOX_MONEY_V6_LIVE) return null
  return `https://juicebox.money/v6/${chainSlug}:${projectId}`
}

// ---------------------------------------------------------------------------
// In-app project routing — single source of truth shared by the router
// (App.tsx) and every link emitter.
// ---------------------------------------------------------------------------

/** Project route format: /{chainSlug}:{projectId} (e.g. /op:83, /opsep:123). */
export const PROJECT_SLUG_REGEX = /^([a-z]+):(\d+)$/i

/** CHAINS slugs can carry dashes (op-sep); route slugs are dash-free (opsep). */
export function routeChainSlug(chainSlug: string): string {
  return chainSlug.replace(/-/g, '').toLowerCase()
}

function slugToIdMap(table: Record<number, { slug: string }>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(table).map(([id, chain]) => [routeChainSlug(chain.slug), Number(id)]),
  )
}

// Route slug → chain id. Mainnet slugs always resolve — even in testnet mode —
// while testnet slugs are only routable in testnet mode. Derived from the
// chain tables so a newly added chain can never emit a slug the router
// rejects (guarded by projectLink.test.ts).
export const CHAIN_SLUG_TO_ID: Record<string, number> = {
  ...slugToIdMap(MAINNET_CHAINS),
  ...(IS_TESTNET ? slugToIdMap(TESTNET_CHAINS) : {}),
}

/** Router-accepted in-app path for a project page, or null for unknown chains. */
export function projectPathFor(chainId: number, projectId: string | number): string | null {
  const slug =
    CHAINS[chainId]?.slug || MAINNET_CHAINS[chainId]?.slug || TESTNET_CHAINS[chainId]?.slug
  return slug ? `/${routeChainSlug(slug)}:${projectId}` : null
}
