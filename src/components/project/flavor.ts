/**
 * Project-page tab model — 1:1 with website/src/discover.js (:5361-5402).
 *
 * Tab sets depend on the project flavor:
 *   revnet: Overview | Terms | Owners | Shop | Extras | Operator
 *   custom: Overview | Rulesets | Funds | Tokens | Shop | Extras | Owner
 * Activity becomes the FIRST tab on mobile (the left activity column collapses).
 * Shop shows optimistically and is dropped when the project has no 721 hook
 * (revnets always keep it — the operator can add items).
 *
 * Owners/Tokens subtabs (website :13921-13983):
 *   revnet: Accounts | Market | Settlement | Splits | Auto Issuance | Loans
 *   custom: Accounts | Market | Settlement | Reserved
 * Market is filtered out until the project's ERC-20 is deployed.
 */

export type ProjectTabId =
  | 'activity'
  | 'overview'
  | 'terms'
  | 'rulesets'
  | 'funds'
  | 'owners'
  | 'tokens'
  | 'shop'
  | 'extras'
  | 'backoffice'

export type OwnersSubtabId =
  | 'accounts'
  | 'market'
  | 'settlement'
  | 'splits'
  | 'reserved'
  | 'autoissuance'
  | 'loans'

export interface ProjectTab {
  id: ProjectTabId
  label: string
}

export interface TabModelOptions {
  isRevnet: boolean
  /** Mobile collapses the left column, so Activity leads the tab row. */
  isMobile: boolean
  /** False once the 721-hook probe resolved empty (revnets always keep Shop). */
  hasShop: boolean
  /** Market subtab needs a deployed ERC-20. */
  hasErc20: boolean
}

export function projectTabsFor(opts: TabModelOptions): ProjectTab[] {
  const tabs: ProjectTab[] = []
  if (opts.isMobile) tabs.push({ id: 'activity', label: 'Activity' })
  tabs.push({ id: 'overview', label: 'Overview' })
  if (opts.isRevnet) {
    tabs.push({ id: 'terms', label: 'Terms' })
    tabs.push({ id: 'owners', label: 'Owners' })
  } else {
    tabs.push({ id: 'rulesets', label: 'Rulesets' })
    tabs.push({ id: 'funds', label: 'Funds' })
    tabs.push({ id: 'tokens', label: 'Tokens' })
  }
  if (opts.hasShop || opts.isRevnet) tabs.push({ id: 'shop', label: 'Shop' })
  tabs.push({ id: 'extras', label: 'Extras' })
  tabs.push({ id: 'backoffice', label: opts.isRevnet ? 'Operator' : 'Owner' })
  return tabs
}

export function ownersSubtabsFor(opts: TabModelOptions): { id: OwnersSubtabId; label: string }[] {
  const subtabs: { id: OwnersSubtabId; label: string }[] = [{ id: 'accounts', label: 'Accounts' }]
  if (opts.hasErc20) subtabs.push({ id: 'market', label: 'Market' })
  subtabs.push({ id: 'settlement', label: 'Settlement' })
  if (opts.isRevnet) {
    subtabs.push({ id: 'splits', label: 'Splits' })
    subtabs.push({ id: 'autoissuance', label: 'Auto Issuance' })
    subtabs.push({ id: 'loans', label: 'Loans' })
  } else {
    subtabs.push({ id: 'reserved', label: 'Reserved' })
  }
  return subtabs
}

// --- URL hash routing: #<tab> or #<tab>/<subtab> (extends the existing #shop scheme) ---

const TAB_SLUGS: Record<string, ProjectTabId> = {
  activity: 'activity',
  overview: 'overview',
  terms: 'terms',
  rulesets: 'rulesets',
  funds: 'funds',
  owners: 'owners',
  tokens: 'tokens',
  shop: 'shop',
  extras: 'extras',
  owner: 'backoffice',
  operator: 'backoffice',
  // Legacy juicy hashes keep working:
  about: 'overview',
}

export function parseProjectHash(hash: string): { tab: ProjectTabId | null; subtab: OwnersSubtabId | null } {
  const [rawTab, rawSub] = hash.replace(/^#/, '').split('/')
  const tab = TAB_SLUGS[rawTab?.toLowerCase() ?? ''] ?? null
  const subs: OwnersSubtabId[] = ['accounts', 'market', 'settlement', 'splits', 'reserved', 'autoissuance', 'loans']
  const subtab = subs.includes(rawSub?.toLowerCase() as OwnersSubtabId) ? (rawSub.toLowerCase() as OwnersSubtabId) : null
  return { tab, subtab }
}

export function projectHashFor(tab: ProjectTabId, isRevnet: boolean, subtab?: OwnersSubtabId | null): string {
  const slug = tab === 'backoffice' ? (isRevnet ? 'operator' : 'owner') : tab
  return subtab ? `#${slug}/${subtab}` : `#${slug}`
}
