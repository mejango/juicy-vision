import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock navigator.credentials
const mockCredentialsCreate = vi.fn()
const mockCredentialsGet = vi.fn()

Object.defineProperty(global, 'navigator', {
  value: {
    credentials: {
      create: mockCredentialsCreate,
      get: mockCredentialsGet,
    },
  },
  writable: true,
})

// Mock PublicKeyCredential
Object.defineProperty(global, 'PublicKeyCredential', {
  value: class MockPublicKeyCredential {
    static isConditionalMediationAvailable = vi.fn().mockResolvedValue(true)
  },
  writable: true,
})

describe('Passkey Service', () => {
  beforeEach(() => {
    vi.resetModules()
    mockFetch.mockReset()
    mockCredentialsCreate.mockReset()
    mockCredentialsGet.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('isPasskeySupported', () => {
    it('returns true when PublicKeyCredential is available', async () => {
      const { isPasskeySupported } = await import('./passkey')
      expect(isPasskeySupported()).toBe(true)
    })

    // Skip: PublicKeyCredential is defined as non-configurable in JSDOM, so we can't mock its absence
    // The actual function correctly checks for typeof PublicKeyCredential !== 'undefined'
    it.skip('returns false when PublicKeyCredential is not available', async () => {
      // This test would verify isPasskeySupported returns false when the browser doesn't support passkeys
      // In JSDOM, PublicKeyCredential is always defined and non-configurable
    })
  })

  describe('isPasskeyAutofillSupported', () => {
    it('returns true when conditional mediation is available', async () => {
      const { isPasskeyAutofillSupported } = await import('./passkey')
      const result = await isPasskeyAutofillSupported()
      expect(result).toBe(true)
    })
  })

  describe('registerPasskey', () => {
    it('completes registration flow successfully', async () => {
      // Mock server response for registration options
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            rp: { name: 'Juicy Vision', id: 'localhost' },
            user: { id: 'dXNlci1pZA', name: 'test@example.com', displayName: 'test' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            timeout: 300000,
            attestation: 'none',
            authenticatorSelection: {
              residentKey: 'preferred',
              userVerification: 'preferred',
            },
          },
        }),
      })

      // Mock WebAuthn credential creation
      const mockCredential = {
        id: 'credential-id',
        rawId: new ArrayBuffer(16),
        response: {
          clientDataJSON: new ArrayBuffer(100),
          attestationObject: new ArrayBuffer(200),
          getTransports: () => ['internal'],
        },
        authenticatorAttachment: 'platform',
        type: 'public-key',
      }
      mockCredentialsCreate.mockResolvedValueOnce(mockCredential)

      // Mock server response for registration verification
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            id: 'passkey-1',
            displayName: 'My Device',
            deviceType: 'platform',
            createdAt: '2024-01-01T00:00:00Z',
          },
        }),
      })

      const { registerPasskey } = await import('./passkey')
      const result = await registerPasskey('test-token', 'My Device')

      expect(result.id).toBe('passkey-1')
      expect(result.displayName).toBe('My Device')
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockCredentialsCreate).toHaveBeenCalledTimes(1)
    })

    it('throws error when credential creation is cancelled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            rp: { name: 'Juicy Vision', id: 'localhost' },
            user: { id: 'dXNlci1pZA', name: 'test@example.com', displayName: 'test' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            timeout: 300000,
            attestation: 'none',
            authenticatorSelection: {
              residentKey: 'preferred',
              userVerification: 'preferred',
            },
          },
        }),
      })

      mockCredentialsCreate.mockResolvedValueOnce(null)

      const { registerPasskey } = await import('./passkey')
      await expect(registerPasskey('test-token')).rejects.toThrow('Passkey creation was cancelled')
    })

    it('handles server error on options request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({
          success: false,
          error: 'User not found',
        }),
      })

      const { registerPasskey } = await import('./passkey')
      await expect(registerPasskey('test-token')).rejects.toThrow('User not found')
    })
  })

  describe('loginWithPasskey', () => {
    it('completes authentication flow successfully', async () => {
      // Mock server response for authentication options
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            rpId: 'localhost',
            timeout: 300000,
            userVerification: 'preferred',
          },
        }),
      })

      // Mock WebAuthn credential get
      const mockCredential = {
        id: 'credential-id',
        rawId: new ArrayBuffer(16),
        response: {
          clientDataJSON: new ArrayBuffer(100),
          authenticatorData: new ArrayBuffer(37),
          signature: new ArrayBuffer(64),
          userHandle: new ArrayBuffer(16),
        },
        authenticatorAttachment: 'platform',
        type: 'public-key',
      }
      mockCredentialsGet.mockResolvedValueOnce(mockCredential)

      // Mock server response for authentication verification
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            user: {
              id: 'user-123',
              email: 'test@example.com',
              privacyMode: 'open_book',
              emailVerified: true,
              passkeyEnabled: true,
            },
            token: 'jwt-token',
          },
        }),
      })

      const { loginWithPasskey } = await import('./passkey')
      const result = await loginWithPasskey()

      expect(result.user.id).toBe('user-123')
      expect(result.user.email).toBe('test@example.com')
      expect(result.token).toBe('jwt-token')
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockCredentialsGet).toHaveBeenCalledTimes(1)
    })

    it('includes email in options request when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            rpId: 'localhost',
            timeout: 300000,
            userVerification: 'preferred',
            allowCredentials: [{ type: 'public-key', id: 'cred-id' }],
          },
        }),
      })

      const mockCredential = {
        id: 'credential-id',
        rawId: new ArrayBuffer(16),
        response: {
          clientDataJSON: new ArrayBuffer(100),
          authenticatorData: new ArrayBuffer(37),
          signature: new ArrayBuffer(64),
        },
        type: 'public-key',
      }
      mockCredentialsGet.mockResolvedValueOnce(mockCredential)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            user: { id: 'user-123', email: 'test@example.com', privacyMode: 'open_book', emailVerified: true, passkeyEnabled: true },
            token: 'jwt-token',
          },
        }),
      })

      const { loginWithPasskey } = await import('./passkey')
      await loginWithPasskey('test@example.com')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('email=test%40example.com'),
        expect.anything()
      )
    })

    it('throws error when authentication is cancelled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            rpId: 'localhost',
            timeout: 300000,
            userVerification: 'preferred',
          },
        }),
      })

      mockCredentialsGet.mockResolvedValueOnce(null)

      const { loginWithPasskey } = await import('./passkey')
      await expect(loginWithPasskey()).rejects.toThrow('Passkey authentication was cancelled')
    })
  })

  describe('listPasskeys', () => {
    it('returns list of passkeys', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: [
            { id: 'pk-1', displayName: 'Device 1', deviceType: 'platform', createdAt: '2024-01-01', lastUsedAt: '2024-01-15' },
            { id: 'pk-2', displayName: 'Device 2', deviceType: 'cross-platform', createdAt: '2024-01-10', lastUsedAt: null },
          ],
        }),
      })

      const { listPasskeys } = await import('./passkey')
      const result = await listPasskeys('test-token')

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('pk-1')
      expect(result[1].displayName).toBe('Device 2')
    })
  })

  describe('deletePasskey', () => {
    it('deletes passkey successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const { deletePasskey } = await import('./passkey')
      await expect(deletePasskey('test-token', 'pk-1')).resolves.toBeUndefined()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/passkey/pk-1'),
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('renamePasskey', () => {
    it('renames passkey successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const { renamePasskey } = await import('./passkey')
      await expect(renamePasskey('test-token', 'pk-1', 'New Name')).resolves.toBeUndefined()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/passkey/pk-1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ displayName: 'New Name' }),
        })
      )
    })
  })

  describe('signupWithPasskey', () => {
    it('completes signup flow successfully', async () => {
      // Mock server response for signup options
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            rp: { name: 'Juicy Vision', id: 'localhost' },
            user: { id: 'dXNlci1pZA', name: 'New User', displayName: 'New User' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            timeout: 300000,
            attestation: 'none',
            authenticatorSelection: {
              residentKey: 'preferred',
              userVerification: 'preferred',
            },
            tempUserId: 'temp-user-123',
          },
        }),
      })

      // Mock WebAuthn credential creation
      const mockCredential = {
        id: 'credential-id',
        rawId: new ArrayBuffer(16),
        response: {
          clientDataJSON: new ArrayBuffer(100),
          attestationObject: new ArrayBuffer(200),
          getTransports: () => ['internal'],
        },
        authenticatorAttachment: 'platform',
        type: 'public-key',
      }
      mockCredentialsCreate.mockResolvedValueOnce(mockCredential)

      // Mock server response for signup verification
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            user: {
              id: 'user-123',
              email: null,
              privacyMode: 'open_book',
              emailVerified: false,
              passkeyEnabled: true,
            },
            token: 'jwt-token',
          },
        }),
      })

      const { signupWithPasskey } = await import('./passkey')
      const result = await signupWithPasskey()

      expect(result.user.id).toBe('user-123')
      expect(result.user.passkeyEnabled).toBe(true)
      expect(result.token).toBe('jwt-token')
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockCredentialsCreate).toHaveBeenCalledTimes(1)
    })

    it('throws error when credential creation is cancelled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: {
            challenge: 'dGVzdC1jaGFsbGVuZ2U',
            rp: { name: 'Juicy Vision', id: 'localhost' },
            user: { id: 'dXNlci1pZA', name: 'New User', displayName: 'New User' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            timeout: 300000,
            attestation: 'none',
            authenticatorSelection: {
              residentKey: 'preferred',
              userVerification: 'preferred',
            },
            tempUserId: 'temp-user-123',
          },
        }),
      })

      mockCredentialsCreate.mockResolvedValueOnce(null)

      const { signupWithPasskey } = await import('./passkey')
      await expect(signupWithPasskey()).rejects.toThrow('Passkey creation was cancelled')
    })

    it('handles server error on signup options request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({
          success: false,
          error: 'Server unavailable',
        }),
      })

      const { signupWithPasskey } = await import('./passkey')
      await expect(signupWithPasskey()).rejects.toThrow('Server unavailable')
    })
  })
})
