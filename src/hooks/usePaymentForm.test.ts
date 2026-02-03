import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePaymentForm, type UsePaymentFormOptions } from './usePaymentForm'
import type { IssuanceRate } from '../services/bendystraw'

// Mock stores
vi.mock('../stores', () => ({
  useTransactionStore: vi.fn(() => ({
    addTransaction: vi.fn(() => 'tx-123'),
  })),
}))

// Mock wagmi
const mockAddress = '0x1234567890123456789012345678901234567890'
let mockIsConnected = true

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: mockAddress,
    isConnected: mockIsConnected,
  })),
}))

// Mock viem
vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({
    getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')), // 1 ETH
    readContract: vi.fn().mockResolvedValue(BigInt('1000000000')), // 1000 USDC (6 decimals)
  })),
  http: vi.fn(),
  formatEther: vi.fn((wei: bigint) => (Number(wei) / 1e18).toString()),
  erc20Abi: [],
}))

// Mock constants
vi.mock('../constants', () => ({
  VIEM_CHAINS: {
    1: { id: 1, name: 'Ethereum' },
    10: { id: 10, name: 'Optimism' },
    42161: { id: 42161, name: 'Arbitrum' },
    8453: { id: 8453, name: 'Base' },
  },
  USDC_ADDRESSES: {
    1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  RPC_ENDPOINTS: {
    1: ['https://eth.example.com'],
    10: ['https://optimism.example.com'],
    42161: ['https://arbitrum.example.com'],
    8453: ['https://base.example.com'],
  },
}))

// Mock bendystraw
const mockFetchIssuanceRate = vi.fn()
vi.mock('../services/bendystraw', () => ({
  fetchIssuanceRate: (...args: unknown[]) => mockFetchIssuanceRate(...args),
}))

describe('usePaymentForm', () => {
  const defaultOptions: UsePaymentFormOptions = {
    projectId: '123',
    chainId: '42161',
    ethPrice: 2000,
    issuanceRate: {
      tokensPerEth: 1000000,
      issuanceRate: '1000000000000000000000000',
      reservedRate: 0,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsConnected = true
    mockFetchIssuanceRate.mockResolvedValue({
      tokensPerEth: 500000,
      issuanceRate: '500000000000000000000000',
      reservedRate: 0,
    })
  })

  describe('initial state', () => {
    it('returns correct initial values', () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      expect(result.current.amount).toBe('25')
      expect(result.current.memo).toBe('')
      expect(result.current.selectedToken).toBe('USDC')
      expect(result.current.paying).toBe(false)
      expect(result.current.payUs).toBe(true)
    })

    it('calculates fee correctly with default 2.5%', () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      // Default amount is 25, so fee should be 25 * 0.025 = 0.625
      expect(result.current.feeAmount).toBe(0.625)
      expect(result.current.totalAmount).toBe(25.625)
    })

    it('returns zero fee when payUs is false', async () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      act(() => {
        result.current.setPayUs(false)
      })

      expect(result.current.feeAmount).toBe(0)
      expect(result.current.totalAmount).toBe(25)
    })
  })

  describe('amount changes', () => {
    it('updates amount and recalculates fee', () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      act(() => {
        result.current.setAmount('100')
      })

      expect(result.current.amount).toBe('100')
      expect(result.current.feeAmount).toBe(2.5) // 100 * 0.025
      expect(result.current.totalAmount).toBe(102.5)
    })

    it('handles empty amount', () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      act(() => {
        result.current.setAmount('')
      })

      expect(result.current.feeAmount).toBe(0)
      expect(result.current.totalAmount).toBe(0)
    })

    it('handles invalid amount', () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      act(() => {
        result.current.setAmount('invalid')
      })

      expect(result.current.feeAmount).toBe(0)
      expect(result.current.totalAmount).toBe(0)
    })
  })

  describe('token selection', () => {
    it('switches between ETH and USDC', () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      expect(result.current.selectedToken).toBe('USDC')

      act(() => {
        result.current.setSelectedToken('ETH')
      })

      expect(result.current.selectedToken).toBe('ETH')
    })
  })

  describe('expected tokens calculation', () => {
    it('calculates expected tokens for ETH payment', () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      act(() => {
        result.current.setSelectedToken('ETH')
        result.current.setAmount('1')
      })

      // 1 ETH * 1,000,000 tokens per ETH = 1,000,000 tokens
      expect(result.current.expectedTokens).toBe(1000000)
    })

    it('calculates expected tokens for USDC payment', () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      act(() => {
        result.current.setAmount('2000') // $2000 USDC = 1 ETH at $2000/ETH
      })

      // $2000 / $2000 per ETH = 1 ETH equivalent
      // 1 ETH * 1,000,000 tokens = 1,000,000 tokens
      expect(result.current.expectedTokens).toBe(1000000)
    })

    it('returns null for zero amount', () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      act(() => {
        result.current.setAmount('0')
      })

      expect(result.current.expectedTokens).toBeNull()
    })

    it('returns null when no issuance rate', () => {
      const { result } = renderHook(() => usePaymentForm({
        ...defaultOptions,
        issuanceRate: null,
      }))

      expect(result.current.expectedTokens).toBeNull()
    })
  })

  describe('estimated JUICY tokens', () => {
    it('calculates JUICY tokens from fee', async () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      // Wait for JUICY issuance rate to be fetched
      await waitFor(() => {
        // Fee is $0.625 at default amount of $25
        // $0.625 / $2000 per ETH = 0.0003125 ETH equivalent
        // 0.0003125 * 500,000 tokens/ETH = 156.25 tokens
        expect(result.current.estimatedJuicyTokens).toBeCloseTo(156.25, 1)
      })
    })

    it('returns 0 when payUs is false', async () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      act(() => {
        result.current.setPayUs(false)
      })

      await waitFor(() => {
        expect(result.current.estimatedJuicyTokens).toBe(0)
      })
    })
  })

  describe('balance checks', () => {
    it('has balanceLoading false when no fetch in progress', async () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      // After initial render settles, loading should be false (no auto-fetch)
      await waitFor(() => {
        expect(result.current.balanceLoading).toBe(false)
      })
    })

    it('checks sufficient USDC balance', async () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      await waitFor(() => {
        expect(result.current.balanceCheck.sufficient).toBe(true)
      })
    })

    it('reports insufficient when USDC balance is too low', async () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      // Fetch balances (mock returns 1000 USDC which is sufficient for $25)
      await act(async () => {
        await result.current.fetchWalletBalances()
      })

      // Change amount to exceed mocked balance (1000 USDC)
      act(() => {
        result.current.setAmount('2000')
      })

      // Now balance should be insufficient
      await waitFor(() => {
        expect(result.current.balanceCheck.sufficient).toBe(false)
        expect(result.current.balanceCheck.reason).toBe('insufficient_usdc')
      })
    })
  })

  describe('memo handling', () => {
    it('updates memo', () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      act(() => {
        result.current.setMemo('Test payment memo')
      })

      expect(result.current.memo).toBe('Test payment memo')
    })
  })

  describe('wallet connection', () => {
    it('reflects connected state', () => {
      mockIsConnected = true
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      expect(result.current.isConnected).toBe(true)
    })

    it('reflects disconnected state', () => {
      mockIsConnected = false
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      expect(result.current.isConnected).toBe(false)
    })
  })

  describe('handlePay', () => {
    it('dispatches payment event with correct details', async () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      // First fetch balances to populate state (handlePay checks balanceCheck)
      await act(async () => {
        await result.current.fetchWalletBalances()
      })

      // Wait for balance check to be sufficient
      await waitFor(() => {
        expect(result.current.balanceCheck.sufficient).toBe(true)
      })

      // Now call handlePay
      await act(async () => {
        await result.current.handlePay()
      })

      // Check that the pay event was dispatched
      const payEvent = dispatchEventSpy.mock.calls.find(
        call => (call[0] as CustomEvent).type === 'juice:pay-project'
      )

      expect(payEvent).toBeDefined()
      if (payEvent) {
        const event = payEvent[0] as CustomEvent
        expect(event.detail).toMatchObject({
          projectId: '123',
          chainId: 42161,
          amount: '25',
          token: 'USDC',
          payUs: true,
        })
      }

      dispatchEventSpy.mockRestore()
    })

    it('opens wallet panel when not connected', async () => {
      mockIsConnected = false
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      await act(async () => {
        await result.current.handlePay()
      })

      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'juice:open-wallet-panel',
        })
      )

      dispatchEventSpy.mockRestore()
    })

    it('does not pay when amount is zero', async () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      act(() => {
        result.current.setAmount('0')
      })

      await act(async () => {
        await result.current.handlePay()
      })

      // Should not dispatch pay event
      const payEvent = dispatchEventSpy.mock.calls.find(
        call => (call[0] as CustomEvent).type === 'juice:pay-project'
      )
      expect(payEvent).toBeUndefined()

      dispatchEventSpy.mockRestore()
    })

    it('resets form after successful pay', async () => {
      const { result } = renderHook(() => usePaymentForm(defaultOptions))

      // First fetch balances so payment can proceed
      await act(async () => {
        await result.current.fetchWalletBalances()
      })

      await waitFor(() => {
        expect(result.current.balanceCheck.sufficient).toBe(true)
      })

      act(() => {
        result.current.setAmount('50')
        result.current.setMemo('Test memo')
      })

      expect(result.current.amount).toBe('50')
      expect(result.current.memo).toBe('Test memo')

      await act(async () => {
        await result.current.handlePay()
      })

      // Form should be reset to empty values after successful payment
      expect(result.current.amount).toBe('')
      expect(result.current.memo).toBe('')
    })
  })
})
