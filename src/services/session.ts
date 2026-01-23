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

/**
 * Get or create a session ID
 * This ID persists across page reloads but is unique per browser/device
 */
export function getSessionId(): string {
  let sessionId = storage.getString(STORAGE_KEYS.SESSION_ID)

  if (!sessionId) {
    // Generate a new session ID
    sessionId = generateSessionId()
    storage.setString(STORAGE_KEYS.SESSION_ID, sessionId)
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
