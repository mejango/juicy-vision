/**
 * SIWE (Sign-In With Ethereum) Service
 *
 * Handles wallet-based authentication:
 * 1. User signs a message with their wallet
 * 2. Backend verifies the signature and creates a session
 * 3. Session lasts 30 days, allowing saves without re-auth
 */

import { getSessionId } from './session'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
const WALLET_SESSION_KEY = 'juice-wallet-session'

export interface WalletSession {
  address: string
  token: string
  expiresAt: number // Unix timestamp
}

/**
 * Get stored wallet session if valid
 */
export function getWalletSession(): WalletSession | null {
  const stored = localStorage.getItem(WALLET_SESSION_KEY)
  if (!stored) return null

  try {
    const session: WalletSession = JSON.parse(stored)
    // Check if session is still valid (with 1 hour buffer)
    if (session.expiresAt > Date.now() + 3600000) {
      return session
    }
    // Session expired, clear it
    localStorage.removeItem(WALLET_SESSION_KEY)
    return null
  } catch {
    return null
  }
}

/**
 * Store wallet session
 */
function storeWalletSession(session: WalletSession): void {
  localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(session))
}

/**
 * Clear wallet session
 */
export function clearWalletSession(): void {
  localStorage.removeItem(WALLET_SESSION_KEY)
}

/**
 * Check if user has a valid wallet session
 */
export function hasValidWalletSession(): boolean {
  return getWalletSession() !== null
}

/**
 * Get the wallet session token for API requests
 */
export function getWalletSessionToken(): string | null {
  const session = getWalletSession()
  return session?.token ?? null
}

/**
 * Generate SIWE message for signing
 */
export function generateSiweMessage(
  address: string,
  nonce: string,
  chainId: number
): string {
  const domain = window.location.host
  const origin = window.location.origin
  const issuedAt = new Date().toISOString()
  const expirationTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days

  return `${domain} wants you to sign in with your Ethereum account:
${address}

Sign in to Juicy Vision to save your chats and access them from any device.

URI: ${origin}
Version: 1
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt}
Expiration Time: ${expirationTime}`
}

/**
 * Request a nonce from the server
 */
export async function requestNonce(address: string): Promise<string> {
  const sessionId = getSessionId()

  const response = await fetch(`${API_BASE_URL}/auth/siwe/nonce`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({ address }),
  })

  const data = await response.json()
  if (!data.success) {
    throw new Error(data.error || 'Failed to get nonce')
  }

  return data.data.nonce
}

/**
 * Verify signature and create session
 */
export async function verifySiweSignature(
  address: string,
  message: string,
  signature: string
): Promise<WalletSession> {
  const sessionId = getSessionId()

  const response = await fetch(`${API_BASE_URL}/auth/siwe/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    },
    body: JSON.stringify({ address, message, signature }),
  })

  const data = await response.json()
  if (!data.success) {
    throw new Error(data.error || 'Failed to verify signature')
  }

  const session: WalletSession = {
    address,
    token: data.data.token,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  }

  storeWalletSession(session)
  return session
}

/**
 * Full SIWE sign-in flow
 * Returns the wallet session on success
 */
export async function signInWithWallet(
  address: string,
  chainId: number,
  signMessage: (message: string) => Promise<string>
): Promise<WalletSession> {
  // 1. Get nonce from server
  const nonce = await requestNonce(address)

  // 2. Generate SIWE message
  const message = generateSiweMessage(address, nonce, chainId)

  // 3. Request signature from user's wallet
  const signature = await signMessage(message)

  // 4. Verify signature with server
  const session = await verifySiweSignature(address, message, signature)

  return session
}
