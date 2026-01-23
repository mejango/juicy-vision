import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getWalletSession,
  clearWalletSession,
  hasValidWalletSession,
  getWalletSessionToken,
  generateSiweMessage,
  requestNonce,
  verifySiweSignature,
  type WalletSession,
} from './siwe'
import { storage, STORAGE_KEYS } from './storage'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock session service
vi.mock('./session', () => ({
  getSessionId: vi.fn(() => 'test-session-id'),
}))

describe('siwe service', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    // Reset location for consistent test results
    Object.defineProperty(window, 'location', {
      value: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
      },
      writable: true,
    })
  })

  describe('getWalletSession', () => {
    it('returns null when no session stored', () => {
      expect(getWalletSession()).toBeNull()
    })

    it('returns session when valid and not expired', () => {
      const session: WalletSession = {
        address: '0x1234567890123456789012345678901234567890',
        token: 'valid-token',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000, // Expires in 24 hours
      }
      storage.setJSON(STORAGE_KEYS.WALLET_SESSION, session)

      const result = getWalletSession()
      expect(result).toEqual(session)
    })

    it('returns null and clears session when expired', () => {
      const session: WalletSession = {
        address: '0x1234567890123456789012345678901234567890',
        token: 'expired-token',
        expiresAt: Date.now() - 1000, // Already expired
      }
      storage.setJSON(STORAGE_KEYS.WALLET_SESSION, session)

      const result = getWalletSession()
      expect(result).toBeNull()
      expect(storage.getJSON(STORAGE_KEYS.WALLET_SESSION)).toBeNull()
    })

    it('returns null when session expires within 1 hour buffer', () => {
      const session: WalletSession = {
        address: '0x1234567890123456789012345678901234567890',
        token: 'about-to-expire-token',
        expiresAt: Date.now() + 30 * 60 * 1000, // Expires in 30 mins (within 1hr buffer)
      }
      storage.setJSON(STORAGE_KEYS.WALLET_SESSION, session)

      const result = getWalletSession()
      expect(result).toBeNull()
    })
  })

  describe('clearWalletSession', () => {
    it('removes wallet session from storage', () => {
      const session: WalletSession = {
        address: '0x1234567890123456789012345678901234567890',
        token: 'valid-token',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }
      storage.setJSON(STORAGE_KEYS.WALLET_SESSION, session)
      expect(storage.getJSON(STORAGE_KEYS.WALLET_SESSION)).not.toBeNull()

      clearWalletSession()

      expect(storage.getJSON(STORAGE_KEYS.WALLET_SESSION)).toBeNull()
    })
  })

  describe('hasValidWalletSession', () => {
    it('returns false when no session', () => {
      expect(hasValidWalletSession()).toBe(false)
    })

    it('returns true when valid session exists', () => {
      const session: WalletSession = {
        address: '0x1234567890123456789012345678901234567890',
        token: 'valid-token',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }
      storage.setJSON(STORAGE_KEYS.WALLET_SESSION, session)

      expect(hasValidWalletSession()).toBe(true)
    })

    it('returns false when session expired', () => {
      const session: WalletSession = {
        address: '0x1234567890123456789012345678901234567890',
        token: 'expired-token',
        expiresAt: Date.now() - 1000,
      }
      storage.setJSON(STORAGE_KEYS.WALLET_SESSION, session)

      expect(hasValidWalletSession()).toBe(false)
    })
  })

  describe('getWalletSessionToken', () => {
    it('returns null when no session', () => {
      expect(getWalletSessionToken()).toBeNull()
    })

    it('returns token when valid session exists', () => {
      const session: WalletSession = {
        address: '0x1234567890123456789012345678901234567890',
        token: 'my-secret-token',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }
      storage.setJSON(STORAGE_KEYS.WALLET_SESSION, session)

      expect(getWalletSessionToken()).toBe('my-secret-token')
    })
  })

  describe('generateSiweMessage', () => {
    it('generates valid SIWE message with all required fields', () => {
      const address = '0x1234567890123456789012345678901234567890'
      const nonce = 'abc123xyz'
      const chainId = 1

      const message = generateSiweMessage(address, nonce, chainId)

      // Check required fields
      expect(message).toContain('localhost:3000 wants you to sign in with your Ethereum account')
      expect(message).toContain(address)
      expect(message).toContain('URI: http://localhost:3000')
      expect(message).toContain('Version: 1')
      expect(message).toContain('Chain ID: 1')
      expect(message).toContain(`Nonce: ${nonce}`)
      expect(message).toContain('Issued At:')
      expect(message).toContain('Expiration Time:')
    })

    it('includes correct chain ID', () => {
      const message = generateSiweMessage(
        '0x1234567890123456789012345678901234567890',
        'nonce123',
        137 // Polygon
      )

      expect(message).toContain('Chain ID: 137')
    })
  })

  describe('requestNonce', () => {
    it('requests nonce from API with correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          success: true,
          data: { nonce: 'server-generated-nonce' },
        }),
      })

      const address = '0x1234567890123456789012345678901234567890'
      const nonce = await requestNonce(address)

      expect(nonce).toBe('server-generated-nonce')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/siwe/nonce'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Session-ID': 'test-session-id',
          }),
          body: JSON.stringify({ address }),
        })
      )
    })

    it('throws error when API returns failure', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          success: false,
          error: 'Rate limited',
        }),
      })

      await expect(requestNonce('0x123')).rejects.toThrow('Rate limited')
    })
  })

  describe('verifySiweSignature', () => {
    it('verifies signature and stores session', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          success: true,
          data: { token: 'jwt-token-from-server' },
        }),
      })

      const address = '0x1234567890123456789012345678901234567890'
      const message = 'SIWE message'
      const signature = '0xsignature'

      const session = await verifySiweSignature(address, message, signature)

      expect(session.address).toBe(address)
      expect(session.token).toBe('jwt-token-from-server')
      expect(session.expiresAt).toBeGreaterThan(Date.now())

      // Session should be stored
      const stored = storage.getJSON<WalletSession>(STORAGE_KEYS.WALLET_SESSION)
      expect(stored?.token).toBe('jwt-token-from-server')
    })

    it('sends signature to correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          success: true,
          data: { token: 'token' },
        }),
      })

      await verifySiweSignature('0x123', 'message', '0xsig')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/siwe/verify'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            address: '0x123',
            message: 'message',
            signature: '0xsig',
          }),
        })
      )
    })

    it('throws error when verification fails', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({
          success: false,
          error: 'Invalid signature',
        }),
      })

      await expect(
        verifySiweSignature('0x123', 'message', '0xbadsig')
      ).rejects.toThrow('Invalid signature')
    })
  })
})
