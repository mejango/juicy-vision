import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import {
  createTransactionRecord,
  updateTransactionRecord,
  getTransaction,
  getSessionTransactions,
  getUserTransactions,
  type Transaction,
  type TransactionReceipt,
} from './transactions'

// Mock auth store - use let so we can change it per test
let mockToken: string | null = 'test-jwt-token'
vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      token: mockToken,
    }),
  },
}))

// Mock session service
const mockSessionId = 'test-session-123'
vi.mock('../services/session', () => ({
  getSessionId: vi.fn(() => mockSessionId),
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('transactions API', () => {
  const mockTransaction: Transaction = {
    id: 'tx-123',
    userId: 'user-456',
    sessionId: mockSessionId,
    txHash: '0xtxhash123',
    chainId: 42161,
    fromAddress: '0x1234567890123456789012345678901234567890',
    toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    tokenAddress: null,
    amount: '100000000000000000',
    projectId: '789',
    status: 'pending',
    errorMessage: null,
    createdAt: '2024-01-01T00:00:00Z',
    submittedAt: null,
    confirmedAt: null,
    receipt: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockToken = 'test-jwt-token' // Reset token to default
  })

  describe('createTransactionRecord', () => {
    it('sends POST request with correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: mockTransaction,
        }),
      })

      await createTransactionRecord({
        chainId: 42161,
        fromAddress: '0x1234567890123456789012345678901234567890',
        toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        amount: '100000000000000000',
        projectId: '789',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/transactions'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Session-ID': mockSessionId,
            'Authorization': `Bearer ${mockToken}`,
          }),
        })
      )
    })

    it('includes request body with transaction params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: mockTransaction,
        }),
      })

      const params = {
        chainId: 42161,
        fromAddress: '0x1234567890123456789012345678901234567890',
        toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        amount: '100000000000000000',
        projectId: '789',
        tokenAddress: '0xtoken123',
      }

      await createTransactionRecord(params)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(params),
        })
      )
    })

    it('returns created transaction', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: mockTransaction,
        }),
      })

      const result = await createTransactionRecord({
        chainId: 42161,
        fromAddress: '0x1234567890123456789012345678901234567890',
        toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        amount: '100000000000000000',
      })

      expect(result).toEqual(mockTransaction)
    })

    it('throws error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({
          success: false,
          error: 'Invalid request',
        }),
      })

      await expect(
        createTransactionRecord({
          chainId: 42161,
          fromAddress: '0x1234567890123456789012345678901234567890',
          toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          amount: '100000000000000000',
        })
      ).rejects.toThrow('Invalid request')
    })

    it('throws generic error when no error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({
          success: false,
        }),
      })

      await expect(
        createTransactionRecord({
          chainId: 42161,
          fromAddress: '0x1234567890123456789012345678901234567890',
          toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          amount: '100000000000000000',
        })
      ).rejects.toThrow('Request failed')
    })

    it('works without auth token', async () => {
      // Set token to null for this test
      mockToken = null

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: mockTransaction,
        }),
      })

      await createTransactionRecord({
        chainId: 42161,
        fromAddress: '0x1234567890123456789012345678901234567890',
        toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        amount: '100000000000000000',
      })

      const callArgs = mockFetch.mock.calls[0]
      const headers = (callArgs[1] as RequestInit).headers as Record<string, string>

      // Should still have session ID
      expect(headers['X-Session-ID']).toBe(mockSessionId)
      // Should NOT have Authorization header (or it should be undefined)
      expect(headers['Authorization']).toBeUndefined()
    })
  })

  describe('updateTransactionRecord', () => {
    it('sends PATCH request to correct endpoint', async () => {
      const updatedTransaction = { ...mockTransaction, status: 'submitted' as const }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: updatedTransaction,
        }),
      })

      await updateTransactionRecord('tx-123', {
        status: 'submitted',
        txHash: '0xnewhash',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/transactions/tx-123'),
        expect.objectContaining({
          method: 'PATCH',
        })
      )
    })

    it('updates transaction status', async () => {
      const updatedTransaction = {
        ...mockTransaction,
        status: 'confirmed' as const,
        txHash: '0xconfirmedhash',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: updatedTransaction,
        }),
      })

      const result = await updateTransactionRecord('tx-123', {
        status: 'confirmed',
      })

      expect(result.status).toBe('confirmed')
    })

    it('includes receipt in update', async () => {
      const receipt: TransactionReceipt = {
        blockNumber: 12345,
        blockHash: '0xblockhash',
        gasUsed: '100000',
        effectiveGasPrice: '1000000000',
        status: 'success',
      }

      const updatedTransaction = {
        ...mockTransaction,
        status: 'confirmed' as const,
        receipt,
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: updatedTransaction,
        }),
      })

      await updateTransactionRecord('tx-123', {
        status: 'confirmed',
        receipt,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            status: 'confirmed',
            receipt,
          }),
        })
      )
    })

    it('includes error message in update', async () => {
      const updatedTransaction = {
        ...mockTransaction,
        status: 'failed' as const,
        errorMessage: 'Transaction reverted',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: updatedTransaction,
        }),
      })

      await updateTransactionRecord('tx-123', {
        status: 'failed',
        errorMessage: 'Transaction reverted',
      })

      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse((callArgs[1] as RequestInit).body as string)

      expect(body.errorMessage).toBe('Transaction reverted')
    })

    it('throws error on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({
          success: false,
          error: 'Transaction not found',
        }),
      })

      await expect(
        updateTransactionRecord('invalid-id', { status: 'submitted' })
      ).rejects.toThrow('Transaction not found')
    })
  })

  describe('getTransaction', () => {
    it('fetches transaction by ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: mockTransaction,
        }),
      })

      const result = await getTransaction('tx-123')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/transactions/tx-123'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Session-ID': mockSessionId,
          }),
        })
      )
      expect(result).toEqual(mockTransaction)
    })

    it('throws error when transaction not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({
          success: false,
          error: 'Transaction not found',
        }),
      })

      await expect(getTransaction('invalid-id')).rejects.toThrow('Transaction not found')
    })
  })

  describe('getSessionTransactions', () => {
    it('fetches transactions for session', async () => {
      const transactions = [mockTransaction]
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: transactions,
        }),
      })

      const result = await getSessionTransactions(mockSessionId)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/transactions/session/${mockSessionId}?limit=50`),
        expect.any(Object)
      )
      expect(result).toEqual(transactions)
    })

    it('supports custom limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: [],
        }),
      })

      await getSessionTransactions(mockSessionId, 10)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('?limit=10'),
        expect.any(Object)
      )
    })
  })

  describe('getUserTransactions', () => {
    it('fetches transactions for authenticated user', async () => {
      const transactions = [mockTransaction]
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: transactions,
        }),
      })

      const result = await getUserTransactions()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/transactions?limit=50&offset=0'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Session-ID': mockSessionId,
          }),
        })
      )
      expect(result).toEqual(transactions)
    })

    it('supports pagination', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          data: [],
        }),
      })

      await getUserTransactions(25, 50)

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('?limit=25&offset=50'),
        expect.any(Object)
      )
    })
  })

  describe('error handling', () => {
    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(getTransaction('tx-123')).rejects.toThrow('Network error')
    })

    it('handles JSON parse errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      })

      await expect(getTransaction('tx-123')).rejects.toThrow('Invalid JSON')
    })
  })
})
