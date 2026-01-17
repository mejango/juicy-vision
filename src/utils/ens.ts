import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { STORAGE_KEYS, ENS_RPC_ENDPOINT } from '../constants'

// Cache structure with expiry
interface EnsCacheEntry {
  name: string | null
  timestamp: number
}

interface EnsCache {
  [address: string]: EnsCacheEntry
}

// Cache TTL: 24 hours
const CACHE_TTL = 24 * 60 * 60 * 1000

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
  transport: http(ENS_RPC_ENDPOINT),
})

export async function resolveEnsName(address: string): Promise<string | null> {
  if (!address) return null

  const normalized = address.toLowerCase()

  // Check cache first
  const cached = ensCache[normalized]
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.name
  }

  try {
    const ensName = await client.getEnsName({
      address: address as `0x${string}`,
    })

    // Update cache
    ensCache[normalized] = {
      name: ensName,
      timestamp: Date.now(),
    }
    saveCache(ensCache)

    return ensName
  } catch {
    // Cache null result to avoid repeated failed lookups
    ensCache[normalized] = {
      name: null,
      timestamp: Date.now(),
    }
    saveCache(ensCache)
    return null
  }
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
