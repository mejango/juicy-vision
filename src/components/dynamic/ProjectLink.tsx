import type { ReactNode } from 'react'

// juicebox.money does not yet host V6 project pages. Flip to true once it does,
// and every ProjectLink below becomes a live link with no other change.
export const JUICEBOX_MONEY_V6_LIVE = false

export function juiceboxProjectUrl(
  chainSlug: string,
  projectId: string | number
): string | null {
  if (!JUICEBOX_MONEY_V6_LIVE) return null
  return `https://juicebox.money/v6/${chainSlug}:${projectId}`
}

/**
 * Renders a project name that links to juicebox.money when V6 pages are live,
 * and falls back to plain (non-clickable) text until then — so the name always
 * shows but users never hit a 404.
 */
export function ProjectLink({
  chainSlug,
  projectId,
  className,
  children,
}: {
  chainSlug: string
  projectId: string | number
  className?: string
  children: ReactNode
}) {
  const url = juiceboxProjectUrl(chainSlug, projectId)
  if (!url) {
    // Drop hover affordances so the static text doesn't look clickable.
    const staticClass = className?.replace(/\bhover:\S+/g, '').replace(/\s+/g, ' ').trim()
    return <span className={staticClass}>{children}</span>
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  )
}
