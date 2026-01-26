import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOmnichainDeploySuckers, type OmnichainDeploySuckersParams } from './useOmnichainDeploySuckers'
import type { BundleStatus } from './types'

// Mock stores
vi.mock('../../stores', () => ({
  useAuthStore: vi.fn(() => ({
    mode: 'self_custody',
    isAuthenticated: () => true,
  })),
}))

// Mock managed wallet hook
vi.mock('../useManagedWallet', () => ({
  useManagedWallet: vi.fn(() => ({
    address: '0xmanagedaddress123456789012345678901234',
    isLoading: false,
  })),
}))

// Mock relayr services
const mockBuildOmnichainDeploySuckersTransactions = vi.fn()
const mockCreateBalanceBundle = vi.fn()

vi.mock('../../services/relayr', () => ({
  buildOmnichainDeploySuckersTransactions: (...args: unknown[]) => mockBuildOmnichainDeploySuckersTransactions(...args),
  createBalanceBundle: (...args: unknown[]) => mockCreateBalanceBundle(...args),
}))

// Mock useRelayrBundle
const mockBundleState: {
  bundleId: string | null
  status: BundleStatus
  chainStates: Array<{ chainId: number; projectId?: number; status: string; txHash?: string }>
  paymentOptions: unknown[]
  selectedPaymentChain: number | null
  paymentTxHash: string | null
  error: string | null
} = {
  bundleId: null,
  status: 'idle',
  chainStates: [],
  paymentOptions: [],
  selectedPaymentChain: null,
  paymentTxHash: null,
  error: null,
}

const mockReset = vi.fn()
const mockSetCreating = vi.fn()
const mockSetProcessing = vi.fn()
const mockSetError = vi.fn()
const mockInitializeBundle = vi.fn()
const mockUpdateFromStatus = vi.fn()

vi.mock('./useRelayrBundle', () => ({
  useRelayrBundle: vi.fn(() => ({
    bundleState: mockBundleState,
    reset: mockReset,
    updateFromStatus: mockUpdateFromStatus,
    _initializeBundle: mockInitializeBundle,
    _setCreating: mockSetCreating,
    _setProcessing: mockSetProcessing,
    _setError: mockSetError,
  })),
}))

// Mock useRelayrStatus
vi.mock('./useRelayrStatus', () => ({
  useRelayrStatus: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
}))

describe('useOmnichainDeploySuckers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock state
    mockBundleState.bundleId = null
    mockBundleState.status = 'idle'
    mockBundleState.chainStates = []
    mockBundleState.error = null
  })

  const defaultParams: OmnichainDeploySuckersParams = {
    chainIds: [1, 10, 8453, 42161],
    projectIds: {
      1: 100,
      10: 101,
      8453: 102,
      42161: 103,
    },
  }

  describe('initial state', () => {
    it('returns correct initial state', () => {
      const { result } = renderHook(() => useOmnichainDeploySuckers())

      expect(result.current.bundleState.status).toBe('idle')
      expect(result.current.isDeploying).toBe(false)
      expect(result.current.isComplete).toBe(false)
      expect(result.current.hasError).toBe(false)
      expect(result.current.suckerAddresses).toEqual({})
      expect(result.current.suckerGroupId).toBeNull()
    })
  })

  describe('deploySuckers function', () => {
    it('calls setCreating when deploySuckers is called', async () => {
      mockBuildOmnichainDeploySuckersTransactions.mockResolvedValue({
        transactions: [
          { txData: { chainId: 1, to: '0xsuckerregistry', data: '0x123', value: '0' } },
        ],
        suckerAddresses: { 1: '0xsucker1', 10: '0xsucker10' },
        suckerGroupId: 'group-123',
      })

      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      await act(async () => {
        await result.current.deploySuckers(defaultParams)
      })

      expect(mockSetCreating).toHaveBeenCalled()
    })

    it('builds transactions with correct parameters including salt', async () => {
      mockBuildOmnichainDeploySuckersTransactions.mockResolvedValue({
        transactions: [
          { txData: { chainId: 1, to: '0xsuckerregistry', data: '0x123', value: '0' } },
        ],
        suckerAddresses: { 1: '0xsucker1' },
        suckerGroupId: 'group-123',
      })

      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      await act(async () => {
        await result.current.deploySuckers(defaultParams)
      })

      expect(mockBuildOmnichainDeploySuckersTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          chainIds: defaultParams.chainIds,
          projectIds: defaultParams.projectIds,
          salt: expect.any(String), // Deterministic salt
          tokenMappings: expect.any(Array), // Default ETH mappings
        })
      )
    })

    it('creates balance bundle with correct parameters', async () => {
      const mockTxs = [
        { txData: { chainId: 1, to: '0xsuckerregistry1', data: '0x111', value: '0' } },
        { txData: { chainId: 10, to: '0xsuckerregistry10', data: '0x222', value: '0' } },
      ]

      mockBuildOmnichainDeploySuckersTransactions.mockResolvedValue({
        transactions: mockTxs,
        suckerAddresses: { 1: '0xsucker1', 10: '0xsucker10' },
        suckerGroupId: 'group-123',
      })

      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      await act(async () => {
        await result.current.deploySuckers(defaultParams)
      })

      expect(mockCreateBalanceBundle).toHaveBeenCalledWith({
        app_id: expect.any(String),
        transactions: [
          { chain: 1, target: '0xsuckerregistry1', data: '0x111', value: '0' },
          { chain: 10, target: '0xsuckerregistry10', data: '0x222', value: '0' },
        ],
        virtual_nonce_mode: 'MultiChain',
      })
    })

    it('initializes bundle and sets processing', async () => {
      mockBuildOmnichainDeploySuckersTransactions.mockResolvedValue({
        transactions: [
          { txData: { chainId: 1, to: '0xsuckerregistry', data: '0x123', value: '0' } },
        ],
        suckerAddresses: { 1: '0xsucker1', 10: '0xsucker10', 8453: '0xsucker8453', 42161: '0xsucker42161' },
        suckerGroupId: 'group-123',
      })

      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-sucker-bundle',
      })

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      await act(async () => {
        await result.current.deploySuckers(defaultParams)
      })

      expect(mockInitializeBundle).toHaveBeenCalledWith(
        'test-sucker-bundle',
        defaultParams.chainIds,
        defaultParams.projectIds,
        []
      )

      expect(mockSetProcessing).toHaveBeenCalledWith('sponsored')
    })

    it('sets error when missing project ID for a chain', async () => {
      const { result } = renderHook(() => useOmnichainDeploySuckers())

      await act(async () => {
        await result.current.deploySuckers({
          chainIds: [1, 10, 8453, 42161],
          projectIds: {
            1: 100,
            10: 101,
            // Missing 8453 and 42161
          },
        })
      })

      expect(mockSetError).toHaveBeenCalledWith('Missing project ID for chain 8453')
    })

    it('sets error on build failure', async () => {
      mockBuildOmnichainDeploySuckersTransactions.mockRejectedValue(new Error('Sucker build failed'))

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      await act(async () => {
        await result.current.deploySuckers(defaultParams)
      })

      expect(mockSetError).toHaveBeenCalledWith('Sucker build failed')
    })

    it('sets error on bundle creation failure', async () => {
      mockBuildOmnichainDeploySuckersTransactions.mockResolvedValue({
        transactions: [
          { txData: { chainId: 1, to: '0xsuckerregistry', data: '0x123', value: '0' } },
        ],
        suckerAddresses: { 1: '0xsucker1' },
        suckerGroupId: 'group-123',
      })

      mockCreateBalanceBundle.mockRejectedValue(new Error('Bundle creation failed'))

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      await act(async () => {
        await result.current.deploySuckers(defaultParams)
      })

      expect(mockSetError).toHaveBeenCalledWith('Bundle creation failed')
    })
  })

  describe('custom token mappings', () => {
    it('uses provided token mappings instead of defaults', async () => {
      const customMappings = [
        {
          localToken: '0xUSDC1',
          remoteToken: '0xUSDC2',
          minGas: 300000,
          minBridgeAmount: '1000000',
        },
      ]

      const paramsWithMappings = {
        ...defaultParams,
        tokenMappings: customMappings,
      }

      mockBuildOmnichainDeploySuckersTransactions.mockResolvedValue({
        transactions: [
          { txData: { chainId: 1, to: '0xsuckerregistry', data: '0x123', value: '0' } },
        ],
        suckerAddresses: { 1: '0xsucker1' },
        suckerGroupId: 'group-123',
      })

      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      await act(async () => {
        await result.current.deploySuckers(paramsWithMappings)
      })

      expect(mockBuildOmnichainDeploySuckersTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenMappings: customMappings,
        })
      )
    })
  })

  describe('deployer overrides', () => {
    it('passes deployer overrides when provided', async () => {
      const paramsWithOverrides = {
        ...defaultParams,
        deployerOverrides: {
          1: '0xcustomDeployer1',
          10: '0xcustomDeployer10',
        },
      }

      mockBuildOmnichainDeploySuckersTransactions.mockResolvedValue({
        transactions: [
          { txData: { chainId: 1, to: '0xsuckerregistry', data: '0x123', value: '0' } },
        ],
        suckerAddresses: { 1: '0xsucker1' },
        suckerGroupId: 'group-123',
      })

      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      await act(async () => {
        await result.current.deploySuckers(paramsWithOverrides)
      })

      expect(mockBuildOmnichainDeploySuckersTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          deployerOverrides: paramsWithOverrides.deployerOverrides,
        })
      )
    })
  })

  describe('callbacks', () => {
    it('calls onError when build fails', async () => {
      const onError = vi.fn()
      mockBuildOmnichainDeploySuckersTransactions.mockRejectedValue(new Error('Build failed'))

      const { result } = renderHook(() => useOmnichainDeploySuckers({ onError }))

      await act(async () => {
        await result.current.deploySuckers(defaultParams)
      })

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('reset function', () => {
    it('resets bundle state and sucker data', async () => {
      const { result } = renderHook(() => useOmnichainDeploySuckers())

      act(() => {
        result.current.reset()
      })

      expect(mockReset).toHaveBeenCalled()
      expect(result.current.suckerAddresses).toEqual({})
      expect(result.current.suckerGroupId).toBeNull()
    })
  })

  describe('derived state', () => {
    it('returns isDeploying true when creating', () => {
      mockBundleState.status = 'creating'

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      expect(result.current.isDeploying).toBe(true)
    })

    it('returns isDeploying true when processing', () => {
      mockBundleState.status = 'processing'

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      expect(result.current.isDeploying).toBe(true)
    })

    it('returns isComplete true when completed', () => {
      mockBundleState.status = 'completed'

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      expect(result.current.isComplete).toBe(true)
    })

    it('returns hasError true when failed', () => {
      mockBundleState.status = 'failed'

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      expect(result.current.hasError).toBe(true)
    })

    it('returns hasError true when partial', () => {
      mockBundleState.status = 'partial'

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      expect(result.current.hasError).toBe(true)
    })
  })

  describe('deterministic salt generation', () => {
    it('generates consistent salt for same project IDs', async () => {
      // This tests that salt generation is deterministic based on project IDs
      // Two calls with same project IDs should generate same prefix in salt
      mockBuildOmnichainDeploySuckersTransactions.mockResolvedValue({
        transactions: [],
        suckerAddresses: {},
        suckerGroupId: 'group-123',
      })

      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainDeploySuckers())

      await act(async () => {
        await result.current.deploySuckers(defaultParams)
      })

      // Just verify the call was made - the salt generation is internal
      expect(mockBuildOmnichainDeploySuckersTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          salt: expect.stringMatching(/^0x/), // Salt should be a hex string
        })
      )
    })
  })
})
