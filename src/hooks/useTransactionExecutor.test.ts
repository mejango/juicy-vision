import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTransactionExecutor } from './useTransactionExecutor'

// Mock stores
const mockUpdateTransaction = vi.fn()
const mockAuthToken = 'test-auth-token'

vi.mock('../stores', () => ({
  useTransactionStore: vi.fn(() => ({
    updateTransaction: mockUpdateTransaction,
  })),
  useAuthStore: vi.fn(() => ({
    token: mockAuthToken,
  })),
}))

// Mock wagmi
const mockAddress = '0x1234567890123456789012345678901234567890'
const mockSwitchChainAsync = vi.fn()
const mockGetWalletClient = vi.fn()
const mockGetChainId = vi.fn()
const mockSendTransaction = vi.fn()
const mockSignTypedData = vi.fn()

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: mockAddress,
    isConnected: true,
  })),
  useSwitchChain: vi.fn(() => ({
    switchChainAsync: mockSwitchChainAsync,
  })),
}))

vi.mock('wagmi/actions', () => ({
  getWalletClient: (...args: unknown[]) => mockGetWalletClient(...args),
}))

// Mock viem
const mockReadContract = vi.fn()
const mockWaitForTransactionReceipt = vi.fn()

vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({
    readContract: mockReadContract,
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
  })),
  http: vi.fn(),
  parseEther: vi.fn((value: string) => BigInt(Math.floor(parseFloat(value) * 1e18))),
  parseUnits: vi.fn((value: string, decimals: number) => BigInt(Math.floor(parseFloat(value) * Math.pow(10, decimals)))),
  encodeFunctionData: vi.fn(() => '0x1234567890abcdef'),
  encodeAbiParameters: vi.fn(() => '0xabcdef1234567890'),
  keccak256: vi.fn(() => '0x' + '0'.repeat(64)),
  toBytes: vi.fn(() => new Uint8Array(32)),
  concat: vi.fn((...args: unknown[]) => '0x' + args.join('').replace(/0x/g, '')),
  erc20Abi: [],
  mainnet: { id: 1 },
  optimism: { id: 10 },
  base: { id: 8453 },
  arbitrum: { id: 42161 },
}))

// Mock ethers for Permit2 calculations
vi.mock('ethers', () => ({
  ethers: {
    utils: {
      keccak256: vi.fn(() => '0x' + '0'.repeat(64)),
      toUtf8Bytes: vi.fn(() => new Uint8Array(32)),
    },
    BigNumber: {
      from: vi.fn((value: string) => ({
        xor: vi.fn(() => ({
          toHexString: vi.fn(() => '0x' + '12345678'.repeat(5)),
        })),
      })),
    },
  },
}))

// Mock wagmi config
vi.mock('../config/wagmi', () => ({
  wagmiConfig: {},
}))

// Mock constants
vi.mock('../constants', () => ({
  USDC_ADDRESSES: {
    1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`,
    10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' as `0x${string}`,
    42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as `0x${string}`,
    8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`,
  },
}))

// Mock utils
vi.mock('../utils', () => ({
  getPaymentTerminal: vi.fn().mockResolvedValue({
    address: '0x2db6d704058e552defe415753465df8df0361846',
    type: 'multi',
  }),
}))

// Mock API
const mockCreateTransactionRecord = vi.fn()
const mockUpdateTransactionRecord = vi.fn()

vi.mock('../api/transactions', () => ({
  createTransactionRecord: (...args: unknown[]) => mockCreateTransactionRecord(...args),
  updateTransactionRecord: (...args: unknown[]) => mockUpdateTransactionRecord(...args),
}))

// Mock global fetch for Juice API
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('useTransactionExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup default mock behaviors
    mockGetWalletClient.mockResolvedValue({
      account: { address: mockAddress },
      getChainId: mockGetChainId.mockResolvedValue(42161),
      sendTransaction: mockSendTransaction.mockResolvedValue('0xtxhash123'),
      signTypedData: mockSignTypedData.mockResolvedValue('0xsignature123'),
    })

    mockReadContract.mockResolvedValue(BigInt('1000000000000000000000')) // Large allowance
    mockWaitForTransactionReceipt.mockResolvedValue({
      blockNumber: 12345n,
      blockHash: '0xblockhash',
      gasUsed: 100000n,
      effectiveGasPrice: 1000000000n,
      status: 'success',
    })

    mockCreateTransactionRecord.mockResolvedValue({ id: 'backend-tx-123' })
    mockUpdateTransactionRecord.mockResolvedValue({ id: 'backend-tx-123' })

    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: { spendId: 'spend-123' } }),
    })
  })

  describe('initial state', () => {
    it('returns connected state', () => {
      const { result } = renderHook(() => useTransactionExecutor())

      expect(result.current.isConnected).toBe(true)
      expect(result.current.address).toBe(mockAddress)
    })
  })

  describe('PAY_CREDITS payment', () => {
    it('handles PAY_CREDITS payment via API', async () => {
      const { result } = renderHook(() => useTransactionExecutor())

      // Dispatch pay event
      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '25',
            memo: 'Test payment',
            token: 'PAY_CREDITS',
            payUs: true,
            feeAmount: '0.625',
            juicyProjectId: 1,
            totalAmount: '25.625',
          }
        }))
      })

      // Wait for async operations
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/juice/spend'),
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Authorization': `Bearer ${mockAuthToken}`,
            }),
          })
        )
      })

      expect(mockUpdateTransaction).toHaveBeenCalledWith('tx-123', expect.objectContaining({
        status: 'queued',
      }))
    })

    it('creates fee spend when payUs is enabled', async () => {
      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '25',
            memo: 'Test payment',
            token: 'PAY_CREDITS',
            payUs: true,
            feeAmount: '0.625',
            juicyProjectId: 1,
            totalAmount: '25.625',
          }
        }))
      })

      await waitFor(() => {
        // Should be called twice: once for main payment, once for fee
        expect(mockFetch).toHaveBeenCalledTimes(2)
      })
    })

    it('handles missing auth token', async () => {
      vi.mocked(await import('../stores')).useAuthStore.mockReturnValue({
        token: null,
      } as any)

      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '25',
            token: 'PAY_CREDITS',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '25',
          }
        }))
      })

      await waitFor(() => {
        expect(mockUpdateTransaction).toHaveBeenCalledWith('tx-123', expect.objectContaining({
          status: 'failed',
          error: 'Not authenticated',
        }))
      })
    })
  })

  describe('ETH payment', () => {
    it('executes ETH payment with correct parameters', async () => {
      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            memo: 'ETH payment',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
          }
        }))
      })

      await waitFor(() => {
        expect(mockSendTransaction).toHaveBeenCalled()
      })

      expect(mockUpdateTransaction).toHaveBeenCalledWith('tx-123', expect.objectContaining({
        hash: '0xtxhash123',
        status: 'submitted',
        stage: 'confirming',
      }))
    })

    it('switches chain if necessary', async () => {
      mockGetChainId.mockResolvedValueOnce(1) // Start on mainnet

      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161, // Want to pay on Arbitrum
            amount: '0.1',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
          }
        }))
      })

      await waitFor(() => {
        expect(mockSwitchChainAsync).toHaveBeenCalledWith({ chainId: 42161 })
      })
    })
  })

  describe('USDC payment', () => {
    it('executes USDC payment with Permit2 metadata', async () => {
      // Mock sufficient Permit2 allowance
      mockReadContract
        .mockResolvedValueOnce(BigInt('1000000000')) // USDC to Permit2 allowance
        .mockResolvedValueOnce([BigInt('1000000000'), 0, 0]) // Permit2 allowance result

      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '25',
            memo: 'USDC payment',
            token: 'USDC',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '25',
          }
        }))
      })

      await waitFor(() => {
        expect(mockSignTypedData).toHaveBeenCalled()
        expect(mockSendTransaction).toHaveBeenCalled()
      })
    })

    it('falls back to direct approve when Permit2 not available', async () => {
      // Mock no Permit2 allowance
      mockReadContract
        .mockResolvedValueOnce(BigInt('0')) // No USDC to Permit2 allowance
        .mockResolvedValueOnce(BigInt('0')) // No direct allowance

      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '25',
            token: 'USDC',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '25',
          }
        }))
      })

      await waitFor(() => {
        expect(mockUpdateTransaction).toHaveBeenCalledWith('tx-123', expect.objectContaining({
          stage: 'approving',
        }))
      })
    })
  })

  describe('NFT tier minting', () => {
    it('includes NFT metadata when tier is selected', async () => {
      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
            tierId: 1,
            hookAddress: '0xhookaddress12345678901234567890123456',
          }
        }))
      })

      await waitFor(() => {
        expect(mockSendTransaction).toHaveBeenCalled()
      })
    })

    it('uses exact tier price when preventOverspending is enabled', async () => {
      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
            tierId: 1,
            hookAddress: '0xhookaddress12345678901234567890123456',
            preventOverspending: true,
            tierPrice: '100000000000000000', // 0.1 ETH in wei
          }
        }))
      })

      await waitFor(() => {
        expect(mockSendTransaction).toHaveBeenCalled()
      })
    })
  })

  describe('error handling', () => {
    it('handles user rejection', async () => {
      mockSendTransaction.mockRejectedValue(new Error('User rejected the request'))

      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
          }
        }))
      })

      await waitFor(() => {
        expect(mockUpdateTransaction).toHaveBeenCalledWith('tx-123', expect.objectContaining({
          status: 'cancelled',
          error: 'Transaction cancelled',
        }))
      })
    })

    it('handles transaction failure', async () => {
      mockSendTransaction.mockRejectedValue(new Error('Insufficient funds'))

      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
          }
        }))
      })

      await waitFor(() => {
        expect(mockUpdateTransaction).toHaveBeenCalledWith('tx-123', expect.objectContaining({
          status: 'failed',
        }))
      })
    })

    it('handles wallet not connected', async () => {
      mockGetWalletClient.mockResolvedValue(null)

      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
          }
        }))
      })

      await waitFor(() => {
        expect(mockUpdateTransaction).toHaveBeenCalledWith('tx-123', expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('Wallet'),
        }))
      })
    })

    it('handles unsupported chain', async () => {
      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 999999, // Unsupported chain
            amount: '0.1',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
          }
        }))
      })

      await waitFor(() => {
        expect(mockUpdateTransaction).toHaveBeenCalledWith('tx-123', expect.objectContaining({
          status: 'failed',
          error: 'Unsupported chain',
        }))
      })
    })

    it('handles reverted transaction', async () => {
      mockWaitForTransactionReceipt.mockResolvedValue({
        blockNumber: 12345n,
        blockHash: '0xblockhash',
        gasUsed: 100000n,
        effectiveGasPrice: 1000000000n,
        status: 'reverted',
      })

      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
          }
        }))
      })

      await waitFor(() => {
        expect(mockUpdateTransaction).toHaveBeenCalledWith('tx-123', expect.objectContaining({
          status: 'failed',
          error: 'Transaction reverted',
        }))
      })
    })
  })

  describe('backend transaction tracking', () => {
    it('creates backend transaction record', async () => {
      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
          }
        }))
      })

      await waitFor(() => {
        expect(mockCreateTransactionRecord).toHaveBeenCalledWith(expect.objectContaining({
          chainId: 42161,
          fromAddress: mockAddress,
          amount: '0.1',
          projectId: '456',
        }))
      })
    })

    it('updates backend with transaction hash', async () => {
      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
          }
        }))
      })

      await waitFor(() => {
        expect(mockUpdateTransactionRecord).toHaveBeenCalledWith(
          'backend-tx-123',
          expect.objectContaining({
            status: 'submitted',
            txHash: '0xtxhash123',
          })
        )
      })
    })

    it('continues even if backend save fails', async () => {
      mockCreateTransactionRecord.mockRejectedValue(new Error('Backend error'))

      const { result } = renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
            payUs: false,
            feeAmount: '0',
            juicyProjectId: 1,
            totalAmount: '0.1',
          }
        }))
      })

      // Transaction should still complete despite backend failure
      await waitFor(() => {
        expect(mockSendTransaction).toHaveBeenCalled()
      })
    })
  })
})
