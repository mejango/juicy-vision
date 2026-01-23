/**
 * Passkey Wallet Service
 *
 * Creates embedded Ethereum wallets from WebAuthn passkeys using the PRF extension.
 * This enables passwordless, keyless wallet creation with just Touch ID / Face ID.
 *
 * How it works:
 * 1. User creates a passkey with Touch ID/Face ID
 * 2. PRF extension derives a deterministic 32-byte secret from the passkey
 * 3. We use that secret as the seed for a secp256k1 private key
 * 4. The resulting wallet address is the user's identity
 *
 * References:
 * - https://ithaca.xyz/updates/porto (Porto passkey wallets)
 * - https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/
 * - https://www.corbado.com/blog/passkeys-prf-webauthn
 */

import { privateKeyToAccount } from 'viem/accounts'
import { signInWithWallet } from './siwe'

const PASSKEY_WALLET_KEY = 'juice-passkey-wallet'

// Salt for PRF - should be consistent to derive the same key
const PRF_SALT = new TextEncoder().encode('juicy-vision-wallet-v1')

export interface PasskeyWallet {
  address: string
  createdAt: number
}

/**
 * Check if WebAuthn PRF extension is supported
 */
export async function isPrfSupported(): Promise<boolean> {
  if (!window.PublicKeyCredential) return false

  try {
    // Check for PRF support via getClientCapabilities (newer API)
    if ('getClientCapabilities' in PublicKeyCredential) {
      const capabilities = await (PublicKeyCredential as any).getClientCapabilities()
      return capabilities?.prf === true
    }

    // Fallback: assume supported if PublicKeyCredential exists
    // We'll catch errors at runtime if not actually supported
    return true
  } catch {
    return false
  }
}

/**
 * Convert ArrayBuffer to hex string
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert base64url to ArrayBuffer
 */
function base64UrlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * Create SIWE session with the backend using the derived private key
 */
async function createSiweSession(privateKey: `0x${string}`): Promise<void> {
  const account = privateKeyToAccount(privateKey)

  try {
    // Sign message using the derived private key
    await signInWithWallet(
      account.address,
      1, // mainnet chainId
      async (message: string) => {
        return account.signMessage({ message })
      }
    )
  } catch (error) {
    // Log but don't fail - wallet is still usable locally
    console.warn('Failed to create SIWE session for passkey wallet:', error)
  }
}

/**
 * Derive a private key from PRF output using HKDF
 */
async function derivePrivateKey(prfOutput: ArrayBuffer): Promise<`0x${string}`> {
  // Use Web Crypto HKDF to derive a proper key
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    prfOutput,
    'HKDF',
    false,
    ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: PRF_SALT,
      info: new TextEncoder().encode('ethereum-private-key'),
    },
    keyMaterial,
    256 // 32 bytes for secp256k1 private key
  )

  return `0x${bufferToHex(derivedBits)}` as `0x${string}`
}

/**
 * Create a new passkey wallet using Touch ID / Face ID
 * Returns the wallet address
 */
export async function createPasskeyWallet(): Promise<PasskeyWallet> {
  // Generate a random user ID for this credential
  const userId = crypto.getRandomValues(new Uint8Array(16))

  // Create credential with PRF extension
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: {
        name: 'Juicy Vision',
        id: window.location.hostname,
      },
      user: {
        id: userId,
        name: `wallet-${Date.now()}`,
        displayName: 'Juicy Vision Wallet',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256 (P-256)
        { type: 'public-key', alg: -257 }, // RS256
      ],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // Use Touch ID / Face ID
        residentKey: 'required',
        userVerification: 'required',
      },
      extensions: {
        // Request PRF extension
        prf: {
          eval: {
            first: PRF_SALT,
          },
        },
      } as any,
    },
  }) as PublicKeyCredential | null

  if (!credential) {
    throw new Error('Passkey creation was cancelled')
  }

  // Check for PRF output in the response
  const extensionResults = (credential as any).getClientExtensionResults?.()
  const prfResult = extensionResults?.prf?.results?.first

  if (!prfResult) {
    // PRF not supported during creation, need to authenticate to get PRF output
    // Some platforms only provide PRF during authentication, not creation
    const wallet = await authenticatePasskeyWallet(credential.id)
    return wallet
  }

  // Derive private key from PRF output
  const privateKey = await derivePrivateKey(prfResult)
  const account = privateKeyToAccount(privateKey)

  const wallet: PasskeyWallet = {
    address: account.address,
    createdAt: Date.now(),
  }

  // Store credential ID for future authentications
  storePasskeyCredential(credential.id)
  storePasskeyWallet(wallet)

  // Create SIWE session with backend
  await createSiweSession(privateKey)

  return wallet
}

/**
 * Authenticate with existing passkey and derive wallet
 */
export async function authenticatePasskeyWallet(credentialId?: string): Promise<PasskeyWallet> {
  const allowCredentials = credentialId ? [{
    type: 'public-key' as const,
    id: base64UrlToBuffer(credentialId),
  }] : undefined

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: window.location.hostname,
      timeout: 60000,
      userVerification: 'required',
      allowCredentials,
      extensions: {
        prf: {
          eval: {
            first: PRF_SALT,
          },
        },
      } as any,
    },
  }) as PublicKeyCredential | null

  if (!credential) {
    throw new Error('Passkey authentication was cancelled')
  }

  // Get PRF output
  const extensionResults = (credential as any).getClientExtensionResults?.()
  const prfResult = extensionResults?.prf?.results?.first

  if (!prfResult) {
    throw new Error('PRF extension not supported on this device. Try using Email or Wallet instead.')
  }

  // Derive private key from PRF output
  const privateKey = await derivePrivateKey(prfResult)
  const account = privateKeyToAccount(privateKey)

  const wallet: PasskeyWallet = {
    address: account.address,
    createdAt: Date.now(),
  }

  // Store for future use
  storePasskeyCredential(credential.id)
  storePasskeyWallet(wallet)

  // Create SIWE session with backend
  await createSiweSession(privateKey)

  return wallet
}

/**
 * Get stored passkey wallet
 */
export function getPasskeyWallet(): PasskeyWallet | null {
  const stored = localStorage.getItem(PASSKEY_WALLET_KEY)
  if (!stored) return null

  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}

/**
 * Store passkey wallet
 */
function storePasskeyWallet(wallet: PasskeyWallet): void {
  localStorage.setItem(PASSKEY_WALLET_KEY, JSON.stringify(wallet))
  // Notify listeners that passkey wallet was connected
  window.dispatchEvent(new CustomEvent('juice:passkey-connected', { detail: wallet }))
}

/**
 * Store credential ID for future authentications
 */
function storePasskeyCredential(credentialId: string): void {
  localStorage.setItem('juice-passkey-credential', credentialId)
}

/**
 * Get stored credential ID
 */
export function getStoredCredentialId(): string | null {
  return localStorage.getItem('juice-passkey-credential')
}

/**
 * Clear passkey wallet session (logout but keep credential for re-login)
 */
export function clearPasskeyWallet(): void {
  localStorage.removeItem(PASSKEY_WALLET_KEY)
  // Keep credential ID so user can sign back into the same wallet
  window.dispatchEvent(new CustomEvent('juice:passkey-disconnected'))
}

/**
 * Fully forget passkey wallet (clears credential - next sign in creates new account)
 */
export function forgetPasskeyWallet(): void {
  localStorage.removeItem(PASSKEY_WALLET_KEY)
  localStorage.removeItem('juice-passkey-credential')
  window.dispatchEvent(new CustomEvent('juice:passkey-disconnected'))
}

/**
 * Check if user has a passkey wallet
 */
export function hasPasskeyWallet(): boolean {
  return getPasskeyWallet() !== null
}

/**
 * Sign in with passkey - either create new or authenticate existing
 */
export async function signInWithPasskey(): Promise<PasskeyWallet> {
  const existingCredential = getStoredCredentialId()

  if (existingCredential) {
    // Try to authenticate with existing passkey
    try {
      return await authenticatePasskeyWallet(existingCredential)
    } catch {
      // Credential might be deleted, clear it and create new
      localStorage.removeItem('juice-passkey-credential')
    }
  }

  // No stored credential - create a new passkey wallet
  // (Skip discoverable credentials attempt as it shows confusing QR code dialog)
  return await createPasskeyWallet()
}
