import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
const mockPublicCall = vi.fn()
const mockGetBalance = vi.fn()
let mockPreviewedTokens = 1000n
let mockUsdcBalance = 1_000_000_000n

vi.mock('viem', async (importOriginal) => ({
  ...await importOriginal<typeof import('viem')>(),
  createPublicClient: vi.fn(() => ({
    readContract: (args: { functionName?: string }) => {
      if (args.functionName === 'previewPayFor') {
        return Promise.resolve([{ id: 1n }, mockPreviewedTokens, 0n, []])
      }
      if (args.functionName === 'balanceOf') return Promise.resolve(mockUsdcBalance)
      if (args.functionName === 'decimals') return Promise.resolve(6)
      return mockReadContract(args)
    },
    getBalance: (args: unknown) => mockGetBalance(args),
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
    call: mockPublicCall,
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

// Mock ethers for NFT metadata ID calculations.
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
vi.mock('../constants', async (importOriginal) => ({
  ...await importOriginal<typeof import('../constants')>(),
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
    address: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
    type: 'multi',
  }),
}))

vi.mock('../utils/projectTrust', () => ({
  assertCurrentProjectPayConfigurationTrusted: vi.fn().mockResolvedValue(undefined),
  requireRecognizedRuntimeHook: vi.fn().mockResolvedValue(undefined),
}))

const mockFetchNFTTiers = vi.fn()
const mockRequireRecognized721HookIdentity = vi.fn()

vi.mock('../services/nft', () => ({
  getProjectDataHook: vi.fn().mockResolvedValue('0x1111111111111111111111111111111111111111'),
  fetchNFTTiers: (...args: unknown[]) => mockFetchNFTTiers(...args),
  requireRecognized721HookIdentity: (...args: unknown[]) => mockRequireRecognized721HookIdentity(...args),
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

const autoApproveReview = (event: Event) => {
  const request = (event as CustomEvent<{ respond: (approved: boolean) => void }>).detail
  request.respond(true)
}

describe('useTransactionExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.addEventListener('juice:payment-review-request', autoApproveReview)
    mockPreviewedTokens = 1000n
    mockUsdcBalance = 1_000_000_000n

    // Setup default mock behaviors
    mockGetWalletClient.mockResolvedValue({
      account: { address: mockAddress },
      getChainId: mockGetChainId.mockResolvedValue(42161),
      sendTransaction: mockSendTransaction.mockResolvedValue('0xtxhash123'),
    })

    mockReadContract.mockResolvedValue(BigInt('1000000000000000000000')) // Large allowance
    mockGetBalance.mockResolvedValue(10_000_000_000_000_000_000n)
    mockWaitForTransactionReceipt.mockResolvedValue({
      blockNumber: 12345n,
      blockHash: '0xblockhash',
      gasUsed: 100000n,
      effectiveGasPrice: 1000000000n,
      status: 'success',
    })
    mockPublicCall.mockResolvedValue({ data: '0x' })
    mockFetchNFTTiers.mockResolvedValue([{
      tierId: 1,
      name: 'Membership',
      price: 100_000_000_000_000_000n,
      currency: 61166,
      pricingDecimals: 18,
      initialSupply: 10,
      remainingSupply: 10,
      reservedRate: 0,
      votingUnits: 0n,
      category: 0,
      allowOwnerMint: false,
      transfersPausable: false,
      discountPercent: 0,
    }])
    mockRequireRecognized721HookIdentity.mockResolvedValue({
      metadataIdTarget: '0x1111111111111111111111111111111111111111',
    })

    mockCreateTransactionRecord.mockResolvedValue({ id: 'backend-tx-123' })
    mockUpdateTransactionRecord.mockResolvedValue({ id: 'backend-tx-123' })

    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({ success: true, data: { spendId: 'spend-123' } }),
    })
  })

  afterEach(() => {
    window.removeEventListener('juice:payment-review-request', autoApproveReview)
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
      renderHook(() => useTransactionExecutor())

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

    it('ignores legacy fee-routing fields and creates only the reviewed project spend', async () => {
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
        expect(mockFetch).toHaveBeenCalledTimes(1)
      })
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
        amount: 25,
        projectId: 456,
        chainId: 42161,
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

    it('does not send when the exact payment review is cancelled', async () => {
      window.removeEventListener('juice:payment-review-request', autoApproveReview)
      const cancelReview = (event: Event) => {
        (event as CustomEvent<{ respond: (approved: boolean) => void }>).detail.respond(false)
      }
      window.addEventListener('juice:payment-review-request', cancelReview)
      renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-cancelled',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            memo: 'No send',
            token: 'ETH',
          },
        }))
      })

      await waitFor(() => expect(mockUpdateTransaction).toHaveBeenCalledWith(
        'tx-cancelled',
        expect.objectContaining({ status: 'cancelled' }),
      ))
      expect(mockSendTransaction).not.toHaveBeenCalled()
      expect(mockCreateTransactionRecord).not.toHaveBeenCalled()
      window.removeEventListener('juice:payment-review-request', cancelReview)
    })

    it('blocks when the live ETH balance read fails', async () => {
      mockGetBalance.mockRejectedValueOnce(new Error('RPC unavailable'))
      renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-balance-failed',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
          },
        }))
      })

      await waitFor(() => expect(mockUpdateTransaction).toHaveBeenCalledWith(
        'tx-balance-failed',
        expect.objectContaining({ status: 'failed', error: 'RPC unavailable' }),
      ))
      expect(mockSendTransaction).not.toHaveBeenCalled()
      expect(mockCreateTransactionRecord).not.toHaveBeenCalled()
    })
  })

  describe('USDC payment', () => {
    it('executes USDC payment without an unnecessary approval', async () => {
      mockReadContract
        .mockResolvedValueOnce(BigInt('1000000000'))
        .mockResolvedValueOnce(BigInt('1000000000'))

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
        expect(mockSendTransaction).toHaveBeenCalled()
      })
      expect(mockSendTransaction).toHaveBeenCalledTimes(1)
    })

    it('requests a direct approval when the terminal allowance is insufficient', async () => {
      mockReadContract
        .mockResolvedValueOnce(BigInt('0'))
        .mockResolvedValueOnce(BigInt('0'))

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

    it('blocks when the live USDC balance is insufficient', async () => {
      mockUsdcBalance = 10_000_000n
      renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-usdc-insufficient',
            projectId: '456',
            chainId: 42161,
            amount: '25',
            token: 'USDC',
          },
        }))
      })

      await waitFor(() => expect(mockUpdateTransaction).toHaveBeenCalledWith(
        'tx-usdc-insufficient',
        expect.objectContaining({ status: 'failed', error: 'Insufficient USDC for this payment' }),
      ))
      expect(mockSendTransaction).not.toHaveBeenCalled()
      expect(mockCreateTransactionRecord).not.toHaveBeenCalled()
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
            hookAddress: '0x1111111111111111111111111111111111111111',
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
            hookAddress: '0x1111111111111111111111111111111111111111',
            preventOverspending: true,
            tierPrice: '100000000000000000', // 0.1 ETH in wei
          }
        }))
      })

      await waitFor(() => {
        expect(mockSendTransaction).toHaveBeenCalled()
      })
    })

    it('allows a verified NFT-only payment with zero fungible issuance', async () => {
      mockPreviewedTokens = 0n
      renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
            memo: '',
            tierIds: [1],
            hookAddress: '0x1111111111111111111111111111111111111111',
          },
        }))
      })

      await waitFor(() => expect(mockSendTransaction).toHaveBeenCalled())
      expect(mockUpdateTransaction).not.toHaveBeenCalledWith(
        'tx-123',
        expect.objectContaining({ error: expect.stringContaining('no project tokens') }),
      )
    })

    it('blocks a zero quote without an NFT selection', async () => {
      mockPreviewedTokens = 0n
      renderHook(() => useTransactionExecutor())

      await act(async () => {
        window.dispatchEvent(new CustomEvent('juice:pay-project', {
          detail: {
            txId: 'tx-123',
            projectId: '456',
            chainId: 42161,
            amount: '0.1',
            token: 'ETH',
            memo: '',
          },
        }))
      })

      await waitFor(() => {
        expect(mockUpdateTransaction).toHaveBeenCalledWith('tx-123', expect.objectContaining({
          status: 'failed',
          error: expect.stringContaining('no project tokens'),
        }))
      })
      expect(mockSendTransaction).not.toHaveBeenCalled()
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
