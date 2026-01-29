/**
 * Passkey/WebAuthn Service
 * Handles biometric and hardware key authentication in the browser
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

// ============================================================================
// Types
// ============================================================================

interface RegistrationOptions {
  challenge: string
  rp: { name: string; id: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>
  timeout: number
  attestation: string
  authenticatorSelection: {
    authenticatorAttachment?: string
    residentKey: string
    userVerification: string
  }
}

interface AuthenticationOptions {
  challenge: string
  rpId: string
  timeout: number
  userVerification: string
  allowCredentials?: Array<{ type: 'public-key'; id: string; transports?: string[] }>
  hints?: string[]
}

export type DeviceHint = 'this-device' | 'another-device' | 'any'

interface PasskeyInfo {
  id: string
  displayName: string | null
  deviceType: string | null
  createdAt: string
  lastUsedAt: string | null
}

// ============================================================================
// Helpers
// ============================================================================

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  const data = await response.json()

  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Request failed')
  }

  return data.data as T
}

// ============================================================================
// Feature Detection
// ============================================================================

export function isPasskeySupported(): boolean {
  return !!(
    window.PublicKeyCredential &&
    typeof window.PublicKeyCredential === 'function'
  )
}

export async function isPasskeyAutofillSupported(): Promise<boolean> {
  if (!isPasskeySupported()) return false
  try {
    return await PublicKeyCredential.isConditionalMediationAvailable()
  } catch {
    return false
  }
}

// ============================================================================
// Registration (add passkey to existing account)
// ============================================================================

export async function registerPasskey(
  token: string,
  displayName?: string
): Promise<PasskeyInfo> {
  // 1. Get registration options from server
  const options = await apiRequest<RegistrationOptions>(
    '/passkey/register/options',
    { method: 'GET' },
    token
  )

  // 2. Create credential using WebAuthn API
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: base64UrlToArrayBuffer(options.challenge),
      rp: options.rp,
      user: {
        id: base64UrlToArrayBuffer(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      attestation: options.attestation as AttestationConveyancePreference,
      authenticatorSelection: {
        residentKey: options.authenticatorSelection.residentKey as ResidentKeyRequirement,
        userVerification: options.authenticatorSelection.userVerification as UserVerificationRequirement,
      },
    },
  }) as PublicKeyCredential | null

  if (!credential) {
    throw new Error('Passkey creation was cancelled')
  }

  const response = credential.response as AuthenticatorAttestationResponse

  // 3. Send credential to server for verification
  const result = await apiRequest<PasskeyInfo>(
    '/passkey/register/verify',
    {
      method: 'POST',
      body: JSON.stringify({
        credential: {
          id: credential.id,
          rawId: arrayBufferToBase64Url(credential.rawId),
          response: {
            clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
            attestationObject: arrayBufferToBase64Url(response.attestationObject),
            transports: response.getTransports?.() || [],
          },
          authenticatorAttachment: (credential as any).authenticatorAttachment,
          type: credential.type,
        },
        displayName,
      }),
    },
    token
  )

  return result
}

// ============================================================================
// Authentication (login with passkey)
// ============================================================================

interface LoginResult {
  user: {
    id: string
    email: string
    privacyMode: string
    emailVerified: boolean
    passkeyEnabled: boolean
    isAdmin?: boolean
  }
  token: string
}

export async function loginWithPasskey(email?: string, deviceHint: DeviceHint = 'any'): Promise<LoginResult> {
  // 1. Get authentication options from server
  const options = await apiRequest<AuthenticationOptions>(
    `/passkey/authenticate/options${email ? `?email=${encodeURIComponent(email)}` : ''}`,
    { method: 'GET' }
  )

  // 2. Build WebAuthn options with device hints
  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    challenge: base64UrlToArrayBuffer(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification as UserVerificationRequirement,
    allowCredentials: options.allowCredentials?.map((c) => ({
      type: c.type,
      id: base64UrlToArrayBuffer(c.id),
      // For "this device", prefer internal transport; for "another", prefer hybrid
      transports: deviceHint === 'this-device'
        ? ['internal'] as AuthenticatorTransport[]
        : deviceHint === 'another-device'
        ? ['hybrid', 'usb', 'ble', 'nfc'] as AuthenticatorTransport[]
        : c.transports as AuthenticatorTransport[],
    })),
  }

  // Add hints for modern browsers (Chrome 128+)
  // This tells the browser which UI to show first
  if (deviceHint === 'this-device') {
    (publicKeyOptions as any).hints = ['client-device']
  } else if (deviceHint === 'another-device') {
    (publicKeyOptions as any).hints = ['hybrid']
  }

  // 3. Get credential using WebAuthn API
  const credential = await navigator.credentials.get({
    publicKey: publicKeyOptions,
  }) as PublicKeyCredential | null

  if (!credential) {
    throw new Error('Passkey authentication was cancelled')
  }

  const response = credential.response as AuthenticatorAssertionResponse

  // 3. Send credential to server for verification
  const result = await apiRequest<LoginResult>('/passkey/authenticate/verify', {
    method: 'POST',
    body: JSON.stringify({
      credential: {
        id: credential.id,
        rawId: arrayBufferToBase64Url(credential.rawId),
        response: {
          clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
          authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
          signature: arrayBufferToBase64Url(response.signature),
          userHandle: response.userHandle
            ? arrayBufferToBase64Url(response.userHandle)
            : undefined,
        },
        authenticatorAttachment: (credential as any).authenticatorAttachment,
        type: credential.type,
      },
    }),
  })

  return result
}

// ============================================================================
// Management
// ============================================================================

export async function listPasskeys(token: string): Promise<PasskeyInfo[]> {
  return apiRequest<PasskeyInfo[]>('/passkey/list', { method: 'GET' }, token)
}

export async function deletePasskey(token: string, id: string): Promise<void> {
  await apiRequest(`/passkey/${id}`, { method: 'DELETE' }, token)
}

export async function renamePasskey(
  token: string,
  id: string,
  displayName: string
): Promise<void> {
  await apiRequest(
    `/passkey/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ displayName }),
    },
    token
  )
}

// ============================================================================
// Signup with Passkey (creates new user)
// ============================================================================

interface SignupOptions {
  challenge: string
  rp: { name: string; id: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>
  timeout: number
  attestation: string
  authenticatorSelection: {
    authenticatorAttachment?: string
    residentKey: string
    userVerification: string
  }
  tempUserId: string
}

export async function signupWithPasskey(deviceHint: DeviceHint = 'this-device'): Promise<LoginResult> {
  // 1. Get signup options from server
  const options = await apiRequest<SignupOptions>('/passkey/signup/options', {
    method: 'GET',
  })

  // 2. Create credential using WebAuthn API
  const authenticatorSelection: AuthenticatorSelectionCriteria = {
    residentKey: options.authenticatorSelection.residentKey as ResidentKeyRequirement,
    userVerification: options.authenticatorSelection.userVerification as UserVerificationRequirement,
  }

  // For "this device", force platform authenticator
  if (deviceHint === 'this-device') {
    authenticatorSelection.authenticatorAttachment = 'platform'
  } else if (deviceHint === 'another-device') {
    authenticatorSelection.authenticatorAttachment = 'cross-platform'
  }

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: base64UrlToArrayBuffer(options.challenge),
      rp: options.rp,
      user: {
        id: base64UrlToArrayBuffer(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      attestation: options.attestation as AttestationConveyancePreference,
      authenticatorSelection,
    },
  }) as PublicKeyCredential | null

  if (!credential) {
    throw new Error('Passkey creation was cancelled')
  }

  const response = credential.response as AuthenticatorAttestationResponse

  // 3. Send credential to server for verification and user creation
  const result = await apiRequest<LoginResult>('/passkey/signup/verify', {
    method: 'POST',
    body: JSON.stringify({
      credential: {
        id: credential.id,
        rawId: arrayBufferToBase64Url(credential.rawId),
        response: {
          clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
          attestationObject: arrayBufferToBase64Url(response.attestationObject),
          transports: response.getTransports?.() || [],
        },
        authenticatorAttachment: (credential as any).authenticatorAttachment,
        type: credential.type,
      },
    }),
  })

  return result
}
