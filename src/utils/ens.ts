import { createPublicClient, http, getAddress } from 'viem'
import { mainnet } from 'viem/chains'
import { STORAGE_KEYS } from '../constants'

// Use PublicNode's free RPC - no auth required, CORS-friendly, same as useEnsName hook
const ENS_RPC = 'https://ethereum-rpc.publicnode.com'

// Classic ENS reverse registrar - fallback if getEnsName fails
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

// Cache structure with expiry
interface EnsCacheEntry {
  name: string | null
  timestamp: number
  isError?: boolean // Track if this was an error result
}

interface EnsCache {
  [address: string]: EnsCacheEntry
}

// Cache TTL: 24 hours for successful lookups, 5 minutes for errors
const CACHE_TTL = 24 * 60 * 60 * 1000
const ERROR_CACHE_TTL = 5 * 60 * 1000

// Load cache from localStorage
function loadCache(): EnsCache {
  try {
    const cached = localStorage.getItem(STORAGE_KEYS.ENS_CACHE)
    if (cached) {
      return JSON.parse(cached)
    }
  } catch {
    // Ignore parse errors
  }
  return {}
}

// Save cache to localStorage
function saveCache(cache: EnsCache): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ENS_CACHE, JSON.stringify(cache))
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

// In-memory cache backed by localStorage
let ensCache: EnsCache = loadCache()

const client = createPublicClient({
  chain: mainnet,
  transport: http(ENS_RPC),
})

export async function resolveEnsName(address: string): Promise<string | null> {
  if (!address) return null

  const normalizedAddr = address.toLowerCase()

  // Check cache first
  const cached = ensCache[normalizedAddr]
  if (cached) {
    const ttl = cached.isError ? ERROR_CACHE_TTL : CACHE_TTL
    if (Date.now() - cached.timestamp < ttl) {
      return cached.name
    }
  }

  try {
    // Try viem's built-in getEnsName first
    const ensName = await client.getEnsName({
      address: getAddress(address),
    })

    // Update cache
    ensCache[normalizedAddr] = {
      name: ensName,
      timestamp: Date.now(),
      isError: false,
    }
    saveCache(ensCache)

    return ensName
  } catch {
    // Fallback to classic reverse resolver contract
    try {
      const name = await client.readContract({
        address: REVERSE_REGISTRAR,
        abi: reverseResolverAbi,
        functionName: 'name',
        args: [getAddress(address)],
      })

      if (name) {
        ensCache[normalizedAddr] = {
          name,
          timestamp: Date.now(),
          isError: false,
        }
        saveCache(ensCache)
        return name
      }
    } catch {
      // Both methods failed
    }

    // Cache error result with shorter TTL (silently - ENS failures are common)
    ensCache[normalizedAddr] = {
      name: null,
      timestamp: Date.now(),
      isError: true,
    }
    saveCache(ensCache)
    return null
  }
}

// Batch resolve ENS names with rate limiting to avoid RPC throttling
export async function resolveEnsNames(addresses: string[]): Promise<(string | null)[]> {
  const results: (string | null)[] = []

  for (const address of addresses) {
    const name = await resolveEnsName(address)
    results.push(name)
    // Small delay between requests to avoid rate limiting
    if (results.length < addresses.length) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  return results
}

// Truncate address for display
export function truncateAddress(address: string): string {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// Clear ENS cache (useful for debugging)
export function clearEnsCache(): void {
  ensCache = {}
  localStorage.removeItem(STORAGE_KEYS.ENS_CACHE)
}
