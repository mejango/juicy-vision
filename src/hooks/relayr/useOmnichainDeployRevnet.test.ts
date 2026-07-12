import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOmnichainDeployRevnet, type OmnichainDeployRevnetParams } from './useOmnichainDeployRevnet'
import type { BundleStatus } from './types'

const MANAGED_ACCOUNT = '0xabcdef1234567890abcdef1234567890abcdef12'
const REV_DEPLOYER_ADDRESS = '0xb552eb94284f94b833837d4b2cbb237128415d4e'

function validTransactions(chainIds: number[]) {
  return chainIds.map(chainId => ({
    txData: {
      chainId,
      to: REV_DEPLOYER_ADDRESS,
      data: '0x123',
      value: '0',
    },
  }))
}

// Mock stores
vi.mock('../../stores', () => ({
  useAuthStore: vi.fn(() => ({
    mode: 'managed',
    isAuthenticated: () => true,
  })),
}))

vi.mock('../../services/omnichainDeployer', () => ({
  fetchProjectCreationFee: vi.fn().mockResolvedValue(0n),
}))

// Mock managed wallet hook
const mockCreateManagedRelayrBundle = vi.fn()

vi.mock('../useManagedWallet', () => ({
  useManagedWallet: vi.fn(() => ({
    address: MANAGED_ACCOUNT,
    isLoading: false,
  })),
  createManagedRelayrBundle: (...args: unknown[]) => mockCreateManagedRelayrBundle(...args),
}))

vi.mock('../../utils/transactionSafety', () => ({
  getSafetyPublicClient: vi.fn(() => ({
    call: vi.fn().mockResolvedValue({ data: '0x' }),
  })),
}))

vi.mock('../../services/bendystraw', () => ({
  getProjectIdsFromReceipts: vi.fn().mockResolvedValue({}),
}))

// Mock relayr services
const mockBuildOmnichainDeployRevnetTransactions = vi.fn()

vi.mock('../../services/relayr', () => ({
  buildOmnichainDeployRevnetTransactions: (...args: unknown[]) => mockBuildOmnichainDeployRevnetTransactions(...args),
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

describe('useOmnichainDeployRevnet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // Reset mock state
    mockBundleState.bundleId = null
    mockBundleState.status = 'idle'
    mockBundleState.chainStates = []
    mockBundleState.error = null

    // Default mock for managed bundle creation
    mockCreateManagedRelayrBundle.mockResolvedValue({
      bundleId: 'test-bundle-id',
    })
  })

  const defaultParams: OmnichainDeployRevnetParams = {
    chainIds: [1, 10, 8453, 42161],
    stageConfigurations: [{
      startsAtOrAfter: Math.floor(Date.now() / 1000) + 300,
      splitPercent: 2000, // 20%
      initialIssuance: '1000000000000000000000000',
      issuanceCutFrequency: 604800, // 7 days
      issuanceCutPercent: 50000000, // 5%
      cashOutTaxRate: 1000, // 10%
      extraMetadata: 0,
    }],
    splitOperator: MANAGED_ACCOUNT,
    name: 'Test Revnet',
    ticker: 'TEST',
    tagline: 'A test revenue network',
    projectUri: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm',
  }

  describe('initial state', () => {
    it('returns correct initial state', () => {
      const { result } = renderHook(() => useOmnichainDeployRevnet())

      expect(result.current.bundleState.status).toBe('idle')
      expect(result.current.isDeploying).toBe(false)
      expect(result.current.isComplete).toBe(false)
      expect(result.current.hasError).toBe(false)
      expect(result.current.createdProjectIds).toEqual({})
      expect(result.current.predictedTokenAddress).toBeNull()
    })
  })

  describe('deploy function', () => {
    it('calls setCreating when deploy is called', async () => {
      mockBuildOmnichainDeployRevnetTransactions.mockResolvedValue({
        transactions: validTransactions(defaultParams.chainIds),
        predictedProjectIds: { 1: 100 },
        predictedTokenAddress: '0xtoken123',
      })

      mockCreateManagedRelayrBundle.mockResolvedValue({
        bundleId: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      await act(async () => {
        await result.current.deploy(defaultParams)
      })

      expect(mockSetCreating).toHaveBeenCalled()
    })

    it('builds transactions with correct parameters including salt', async () => {
      mockBuildOmnichainDeployRevnetTransactions.mockResolvedValue({
        transactions: validTransactions(defaultParams.chainIds),
        predictedProjectIds: { 1: 100, 10: 101, 8453: 102, 42161: 103 },
        predictedTokenAddress: '0xtoken123',
      })

      mockCreateManagedRelayrBundle.mockResolvedValue({
        bundleId: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      await act(async () => {
        await result.current.deploy(defaultParams)
      })

      expect(mockBuildOmnichainDeployRevnetTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          chainIds: defaultParams.chainIds,
          stageConfigurations: defaultParams.stageConfigurations,
          splitOperator: defaultParams.splitOperator,
          description: expect.objectContaining({
            name: defaultParams.name,
            ticker: defaultParams.ticker,
            tagline: defaultParams.tagline,
            uri: defaultParams.projectUri,
            salt: expect.any(String), // Deterministic salt
          }),
        })
      )
    })

    it('creates managed bundle with smart account routing', async () => {
      const mockTxs = validTransactions(defaultParams.chainIds)

      mockBuildOmnichainDeployRevnetTransactions.mockResolvedValue({
        transactions: mockTxs,
        predictedProjectIds: { 1: 100, 10: 101 },
        predictedTokenAddress: '0xtoken123',
      })

      mockCreateManagedRelayrBundle.mockResolvedValue({
        bundleId: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      await act(async () => {
        await result.current.deploy(defaultParams)
      })

      // Should call createManagedRelayrBundle with transactions, owner, and smart account address
      expect(mockCreateManagedRelayrBundle).toHaveBeenCalledWith(
        defaultParams.chainIds.map(chainId => ({
          chainId,
          target: REV_DEPLOYER_ADDRESS,
          data: '0x123',
          value: '0',
        })),
        defaultParams.splitOperator,
        MANAGED_ACCOUNT,
        undefined,
      )
    })

    it('initializes bundle and sets processing', async () => {
      mockBuildOmnichainDeployRevnetTransactions.mockResolvedValue({
        transactions: validTransactions(defaultParams.chainIds),
        predictedProjectIds: { 1: 100, 10: 101, 8453: 102, 42161: 103 },
        predictedTokenAddress: '0xtoken123',
      })

      mockCreateManagedRelayrBundle.mockResolvedValue({
        bundleId: 'test-revnet-bundle',
      })

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      await act(async () => {
        await result.current.deploy(defaultParams)
      })

      expect(mockInitializeBundle).toHaveBeenCalledWith(
        'test-revnet-bundle',
        defaultParams.chainIds,
        { 1: 100, 10: 101, 8453: 102, 42161: 103 },
        []
      )

      expect(mockSetProcessing).toHaveBeenCalledWith('sponsored')
    })

    it('sets error when no split operator specified', async () => {
      const { result } = renderHook(() => useOmnichainDeployRevnet())

      await act(async () => {
        await result.current.deploy({
          ...defaultParams,
          splitOperator: '',
        })
      })

      expect(mockSetError).toHaveBeenCalledWith('Revnet operator must be the active managed account')
    })

    it('sets error on build failure', async () => {
      mockBuildOmnichainDeployRevnetTransactions.mockRejectedValue(new Error('Revnet build failed'))

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      await act(async () => {
        await result.current.deploy(defaultParams)
      })

      expect(mockSetError).toHaveBeenCalledWith('Revnet build failed')
    })

    it('sets error on bundle creation failure', async () => {
      mockBuildOmnichainDeployRevnetTransactions.mockResolvedValue({
        transactions: validTransactions(defaultParams.chainIds),
        predictedProjectIds: { 1: 100 },
        predictedTokenAddress: '0xtoken123',
      })

      mockCreateManagedRelayrBundle.mockRejectedValue(new Error('Bundle creation failed'))

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      await act(async () => {
        await result.current.deploy(defaultParams)
      })

      expect(mockSetError).toHaveBeenCalledWith('Bundle creation failed')
    })
  })

  describe('stage configurations', () => {
    it('handles multiple stage configurations', async () => {
      const multiStageParams = {
        ...defaultParams,
        stageConfigurations: [
          {
            startsAtOrAfter: Math.floor(Date.now() / 1000) + 300,
            splitPercent: 2000,
            initialIssuance: '1000000000000000000000000',
            issuanceCutFrequency: 604800,
            issuanceCutPercent: 50000000,
            cashOutTaxRate: 1000,
            extraMetadata: 0,
          },
          {
            startsAtOrAfter: Math.floor(Date.now() / 1000) + 2592000, // 30 days later
            splitPercent: 1000, // 10%
            initialIssuance: '500000000000000000000000',
            issuanceCutFrequency: 604800,
            issuanceCutPercent: 30000000, // 3%
            cashOutTaxRate: 500, // 5%
            extraMetadata: 0,
          },
        ],
      }

      mockBuildOmnichainDeployRevnetTransactions.mockResolvedValue({
        transactions: validTransactions(defaultParams.chainIds),
        predictedProjectIds: { 1: 100 },
        predictedTokenAddress: '0xtoken123',
      })

      mockCreateManagedRelayrBundle.mockResolvedValue({
        bundleId: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      await act(async () => {
        await result.current.deploy(multiStageParams)
      })

      expect(mockBuildOmnichainDeployRevnetTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          stageConfigurations: expect.arrayContaining([
            expect.objectContaining({ splitPercent: 2000 }),
            expect.objectContaining({ splitPercent: 1000 }),
          ]),
        })
      )
    })
  })

  describe('sucker deployment configuration', () => {
    it('passes sucker configuration when provided', async () => {
      const paramsWithSuckers = {
        ...defaultParams,
        suckerDeploymentConfiguration: {
          deployerConfigurations: [
            {
              deployer: '0xsuckerdeployer',
              mappings: [{
                localToken: '0x000000000000000000000000000000000000EEEe',
                remoteToken: '0x000000000000000000000000000000000000EEEe',
                minGas: 200000,
                minBridgeAmount: '1000000000000000',
              }],
            },
          ],
          salt: '0x123',
        },
      }

      mockBuildOmnichainDeployRevnetTransactions.mockResolvedValue({
        transactions: validTransactions(defaultParams.chainIds),
        predictedProjectIds: { 1: 100 },
        predictedTokenAddress: '0xtoken123',
      })

      mockCreateManagedRelayrBundle.mockResolvedValue({
        bundleId: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      await act(async () => {
        await result.current.deploy(paramsWithSuckers)
      })

      expect(mockBuildOmnichainDeployRevnetTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          suckerDeploymentConfiguration: paramsWithSuckers.suckerDeploymentConfiguration,
        })
      )
    })
  })

  describe('callbacks', () => {
    it('calls onError when build fails', async () => {
      const onError = vi.fn()
      mockBuildOmnichainDeployRevnetTransactions.mockRejectedValue(new Error('Build failed'))

      const { result } = renderHook(() => useOmnichainDeployRevnet({ onError }))

      await act(async () => {
        await result.current.deploy(defaultParams)
      })

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('reset function', () => {
    it('resets bundle state and predicted values', async () => {
      const { result } = renderHook(() => useOmnichainDeployRevnet())

      act(() => {
        result.current.reset()
      })

      expect(mockReset).toHaveBeenCalled()
      expect(result.current.createdProjectIds).toEqual({})
      expect(result.current.predictedTokenAddress).toBeNull()
    })
  })

  describe('derived state', () => {
    it('returns isDeploying true when creating', () => {
      mockBundleState.status = 'creating'

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      expect(result.current.isDeploying).toBe(true)
    })

    it('returns isDeploying true when processing', () => {
      mockBundleState.status = 'processing'

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      expect(result.current.isDeploying).toBe(true)
    })

    it('returns isComplete true when completed', () => {
      mockBundleState.status = 'completed'

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      expect(result.current.isComplete).toBe(true)
    })

    it('returns hasError true when failed', () => {
      mockBundleState.status = 'failed'

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      expect(result.current.hasError).toBe(true)
    })

    it('returns hasError true when partial', () => {
      mockBundleState.status = 'partial'

      const { result } = renderHook(() => useOmnichainDeployRevnet())

      expect(result.current.hasError).toBe(true)
    })
  })
})
