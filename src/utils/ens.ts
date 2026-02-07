import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { STORAGE_KEYS, ENS_RPC_ENDPOINT } from '../constants'

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
  transport: http(ENS_RPC_ENDPOINT),
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
    const ensName = await client.getEnsName({
      address: address as `0x${string}`,
    })

    // Update cache
    ensCache[normalizedAddr] = {
      name: ensName,
      timestamp: Date.now(),
      isError: false,
    }
    saveCache(ensCache)

    return ensName
  } catch (err) {
    console.warn('[ENS] Failed to resolve name for', address, err)
    // Cache error result with shorter TTL
    ensCache[normalizedAddr] = {
      name: null,
      timestamp: Date.now(),
      isError: true,
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
