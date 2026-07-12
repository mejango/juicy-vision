import type { ReactNode } from 'react'
import { juiceboxProjectUrl } from '../../utils/projectLink'

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
  const url = juiceboxProjectUrl(chainSlug, projectId) || `/${chainSlug}:${projectId}`
  return (
    <a
      href={url}
      {...(url.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={className}
    >
      {children}
    </a>
  )
}
