/**
 * Ruleset cache query keys + shop stale time.
 * ShopTab caches tier data under these keys; useProjectDataInvalidation
 * invalidates the matching ['rulesets', chainId, projectId] prefix.
 */

const SHOP_STALE_TIME = 30 * 60 * 1000 // 30 minutes (tier data is stable)

export const rulesetKeys = {
  all: ['rulesets'] as const,
  current: (chainId: number, projectId: number) =>
    ['rulesets', chainId, projectId, 'current'] as const,
  queued: (chainId: number, projectId: number) =>
    ['rulesets', chainId, projectId, 'queued'] as const,
  history: (chainId: number, projectId: number) =>
    ['rulesets', chainId, projectId, 'history'] as const,
  splits: (chainId: number, projectId: number, rulesetId: string) =>
    ['rulesets', chainId, projectId, 'splits', rulesetId] as const,
  cycle: (chainId: number, projectId: number) =>
    ['rulesets', chainId, projectId, 'cycle'] as const,
  shop: (chainId: number, projectId: number) =>
    ['shop', chainId, projectId] as const,
}

/**
 * Get the stale time for shop data
 */
export function getShopStaleTime() {
  return SHOP_STALE_TIME
}
