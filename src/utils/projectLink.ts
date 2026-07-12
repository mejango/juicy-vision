// juicebox.money does not yet host V6 project pages. Flip this once it does;
// every ProjectLink will then use the canonical external URL.
export const JUICEBOX_MONEY_V6_LIVE = false

export function juiceboxProjectUrl(
  chainSlug: string,
  projectId: string | number,
): string | null {
  if (!JUICEBOX_MONEY_V6_LIVE) return null
  return `https://juicebox.money/v6/${chainSlug}:${projectId}`
}
