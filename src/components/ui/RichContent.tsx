import { useMemo } from 'react'
import { sanitizeProjectRichText } from '../../utils/projectRichText'

export function RichContent({ html, className = '' }: { html: string; className?: string }) {
  const sanitizedHtml = useMemo(() => sanitizeProjectRichText(html), [html])

  return (
    <div
      className={`project-rich-content ${className}`}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  )
}
