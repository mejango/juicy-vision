/**
 * Session Service
 *
 * Manages anonymous session IDs for users who aren't signed in.
 * Sessions can be upgraded to authenticated accounts later.
 *
 * Features:
 * - Generates a persistent session ID on first visit
 * - Session ID is sent with API requests for anonymous users
 * - When user signs in, session gets affiliated with their account
 * - All chats/invites created under a session belong to that session
 */

import { storage, STORAGE_KEYS } from './storage'

// Cache for the pseudo-address (fetched from backend)
let cachedPseudoAddress: string | null = null
let fetchPromise: Promise<string> | null = null

/**
 * Get or create a session ID
 * This ID persists across page reloads but is unique per browser/device
 */
export function getSessionId(): string {
  let sessionId = storage.getString(STORAGE_KEYS.SESSION_ID)

  if (!sessionId) {
    // Generate a new session ID
    sessionId = generateSessionId()
    console.log('[session] Generated NEW session ID:', sessionId)
    storage.setString(STORAGE_KEYS.SESSION_ID, sessionId)
    // Clear cached pseudo-address when session changes
    cachedPseudoAddress = null
    fetchPromise = null
  }

  return sessionId
}

/**
 * Generate a unique session ID
 * Format: ses_<timestamp>_<random>
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36)
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return `ses_${timestamp}_${random}`
}

/**
 * Clear the session (used on logout if needed)
 */
export function clearSession(): void {
  storage.remove(STORAGE_KEYS.SESSION_ID)
}

/**
 * Check if a session exists
 */
export function hasSession(): boolean {
  return storage.has(STORAGE_KEYS.SESSION_ID)
}

/**
 * Get the session header for API requests
 * This can be used alongside or instead of auth token
 */
export function getSessionHeader(): Record<string, string> {
  return {
    'X-Session-ID': getSessionId(),
  }
}

/**
 * Get the pseudo-address for the current session.
 * This address is computed by the backend using HMAC-SHA256 and is cached locally.
 * Use this instead of trying to compute the address on the frontend.
 */
export async function getSessionPseudoAddress(): Promise<string> {
  // Return cached value if available
  if (cachedPseudoAddress) {
    return cachedPseudoAddress
  }

  // If already fetching, wait for it
  if (fetchPromise) {
    return fetchPromise
  }

  // Fetch from backend
  const sessionId = getSessionId()
  const apiUrl = import.meta.env.VITE_API_URL || ''

  fetchPromise = fetch(`${apiUrl}/auth/session-address`, {
    headers: {
      'X-Session-ID': sessionId,
    },
  })
    .then(res => res.json())
    .then(data => {
      if (data.success && data.data?.address) {
        cachedPseudoAddress = data.data.address
        return data.data.address
      }
      throw new Error('Failed to get session address')
    })
    .catch(err => {
      console.error('[session] Failed to fetch pseudo-address:', err)
      fetchPromise = null
      // Fallback to a deterministic local computation (won't match backend, but better than nothing)
      return `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
    })

  return fetchPromise
}

/**
 * Get the cached pseudo-address synchronously.
 * Returns null if not yet fetched. Use getSessionPseudoAddress() for async access.
 */
export function getCachedPseudoAddress(): string | null {
  return cachedPseudoAddress
}

/**
 * Clear the cached pseudo-address (e.g., when session changes)
 */
export function clearPseudoAddressCache(): void {
  cachedPseudoAddress = null
  fetchPromise = null
}

/**
 * Get the current user's address with correct priority for identity matching.
 *
 * IMPORTANT: This function exists because users can have multiple addresses:
 * 1. SIWE wallet address (self-custody users who signed in with wallet)
 * 2. Smart account address (managed mode / Touch ID users)
 * 3. Session pseudo-address (anonymous users)
 *
 * When checking if the current user matches a member address, use this function
 * and compare case-insensitively: addr.toLowerCase() === getCurrentUserAddress().toLowerCase()
 *
 * For components that need reactive updates, use the useManagedWallet hook instead.
 */
export function getCurrentUserAddress(): string | null {
  // Read wallet session directly to avoid circular dependency with siwe.ts
  // (siwe.ts imports getSessionId from this file)
  const walletSession = storage.getJSON<{ address: string; expiresAt: number }>(STORAGE_KEYS.WALLET_SESSION)

  // Priority 1: SIWE wallet session (self-custody) - check expiration with 1hr buffer
  if (walletSession?.address && walletSession.expiresAt > Date.now() + 3600000) {
    return walletSession.address.toLowerCase()
  }

  // Priority 2: Smart account (managed mode / Touch ID)
  const smartAccount = localStorage.getItem('juice-smart-account-address')
  if (smartAccount) {
    return smartAccount.toLowerCase()
  }

  // Priority 3: Session pseudo-address (anonymous)
  if (cachedPseudoAddress) {
    return cachedPseudoAddress.toLowerCase()
  }

  return null
}

// Pre-fetch pseudo-address on module load to populate cache early
// This runs as soon as the module is imported, before React renders
if (typeof window !== 'undefined') {
  getSessionPseudoAddress().catch(() => {
    // Silently handle errors - components will use fallback
  })
}
