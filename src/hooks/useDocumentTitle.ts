import { useEffect } from 'react'

const DEFAULT_TITLE = 'Juicy Vision'

/**
 * Per-route document titles: "<title> | Juicy Vision" while the calling route
 * host is mounted, restored to the bare app title on unmount (the chat/home
 * default). Pass null/undefined while the name is still loading.
 */
export function useDocumentTitle(title?: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} | ${DEFAULT_TITLE}` : DEFAULT_TITLE
    return () => {
      document.title = DEFAULT_TITLE
    }
  }, [title])
}
