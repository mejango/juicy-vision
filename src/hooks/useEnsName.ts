import { useState, useEffect } from 'react'
import { createPublicClient, http, namehash, getAddress } from 'viem'
import { mainnet } from 'viem/chains'

// Use LlamaRPC which is reliable for ENS
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http('https://eth.llamarpc.com'),
})

// Classic ENS reverse registrar - more reliable than universal resolver
const REVERSE_REGISTRAR = '0x084b1c3C81545d370f3634392De611CaaBFf8148' as const
const reverseResolverAbi = [
  {
    inputs: [{ name: 'addr', type: 'address' }],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// Cache ENS names to avoid repeated lookups
const ensCache = new Map<string, string | null>()

/**
 * Reliably resolve ENS name for an address using the classic reverse resolver
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

    const normalizedAddress = address.toLowerCase()

    // Check cache first
    if (ensCache.has(normalizedAddress)) {
      setEnsName(ensCache.get(normalizedAddress) || null)
      return
    }

    let cancelled = false
    setLoading(true)

    async function resolve() {
      try {
        // Try using viem's built-in getEnsName first
        const name = await mainnetClient.getEnsName({
          address: getAddress(address!),
        })

        if (!cancelled) {
          ensCache.set(normalizedAddress, name)
          setEnsName(name)
        }
      } catch (err) {
        // Fallback to classic reverse resolver
        try {
          const name = await mainnetClient.readContract({
            address: REVERSE_REGISTRAR,
            abi: reverseResolverAbi,
            functionName: 'name',
            args: [getAddress(address!)],
          })

          if (!cancelled && name) {
            ensCache.set(normalizedAddress, name)
            setEnsName(name)
          } else if (!cancelled) {
            ensCache.set(normalizedAddress, null)
            setEnsName(null)
          }
        } catch (fallbackErr) {
          console.error('ENS resolution failed:', fallbackErr)
          if (!cancelled) {
            ensCache.set(normalizedAddress, null)
            setEnsName(null)
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    resolve()

    return () => {
      cancelled = true
    }
  }, [address])

  return { ensName, loading }
}
