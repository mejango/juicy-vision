import { useState, useEffect } from 'react'
import { resolveEnsName } from '../utils/ens'

/**
 * Resolve the ENS name for an address (cached in utils/ens).
 */
export function useEnsNameResolved(address: string | undefined): {
  ensName: string | null
  loading: boolean
} {
  const [ensName, setEnsName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!address) {
      setEnsName(null)
      return
    }

    let cancelled = false
    setLoading(true)

    resolveEnsName(address)
      .then(name => {
        if (!cancelled) setEnsName(name)
      })
      .catch(() => {
        if (!cancelled) setEnsName(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [address])

  return { ensName, loading }
}
