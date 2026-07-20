import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Shared post-confirmation refresh for forms that mutate project treasury
 * state outside the transaction executor: invalidates the ruleset queries,
 * notifies listeners (FundsSection) via `juice:project-data-invalidated`, and
 * bumps a revision that the form's load effects depend on.
 */
export function useProjectDataInvalidation(chainId: number | undefined, projectId: number | undefined) {
  const queryClient = useQueryClient()
  const [refreshRevision, setRefreshRevision] = useState(0)

  const bumpRefresh = useCallback(() => {
    setRefreshRevision(revision => revision + 1)
  }, [])

  const invalidateProjectData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['rulesets', chainId, projectId] })
    window.dispatchEvent(new CustomEvent('juice:project-data-invalidated', {
      detail: { chainId, projectId },
    }))
    setRefreshRevision(revision => revision + 1)
  }, [chainId, projectId, queryClient])

  return { refreshRevision, bumpRefresh, invalidateProjectData }
}
