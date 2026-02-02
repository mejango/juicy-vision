import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOmnichainLaunchProject, type OmnichainLaunchProjectParams } from './useOmnichainLaunchProject'
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
const mockBuildOmnichainLaunchProjectTransactions = vi.fn()
const mockCreateBalanceBundle = vi.fn()
const mockGetBundleStatus = vi.fn()

vi.mock('../../services/relayr', () => ({
  buildOmnichainLaunchProjectTransactions: (...args: unknown[]) => mockBuildOmnichainLaunchProjectTransactions(...args),
  createBalanceBundle: (...args: unknown[]) => mockCreateBalanceBundle(...args),
  getBundleStatus: (...args: unknown[]) => mockGetBundleStatus(...args),
}))

// Mock omnichainDeployer service (used for multi-chain deployments)
const mockBuildOmnichainLaunchTransactions = vi.fn()

vi.mock('../../services/omnichainDeployer', () => ({
  buildOmnichainLaunchTransactions: (...args: unknown[]) => mockBuildOmnichainLaunchTransactions(...args),
}))

// Mock bendystraw service (for project ID extraction from receipts)
const mockGetProjectIdsFromReceipts = vi.fn()

vi.mock('../../services/bendystraw', () => ({
  getProjectIdsFromReceipts: (...args: unknown[]) => mockGetProjectIdsFromReceipts(...args),
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

describe('useOmnichainLaunchProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock state
    mockBundleState.bundleId = null
    mockBundleState.status = 'idle'
    mockBundleState.chainStates = []
    mockBundleState.error = null

    // Default mock for omnichain deployer (multi-chain path)
    mockBuildOmnichainLaunchTransactions.mockReturnValue([
      { chainId: 1, to: '0xomnichain', data: '0x111', value: '0' },
      { chainId: 10, to: '0xomnichain', data: '0x222', value: '0' },
      { chainId: 8453, to: '0xomnichain', data: '0x333', value: '0' },
      { chainId: 42161, to: '0xomnichain', data: '0x444', value: '0' },
    ])

    // Default mock for project ID extraction
    mockGetProjectIdsFromReceipts.mockResolvedValue({})
  })

  const defaultParams: OmnichainLaunchProjectParams = {
    chainIds: [1, 10, 8453, 42161],
    owner: '0x1234567890123456789012345678901234567890',
    projectUri: 'QmXyz123',
    rulesetConfigurations: [{
      mustStartAtOrAfter: 0,
      duration: 0,
      weight: '1000000000000000000000000',
      weightCutPercent: 0,
      approvalHook: '0x0000000000000000000000000000000000000000',
      metadata: {
        reservedPercent: 0,
        cashOutTaxRate: 0,
        baseCurrency: 1,
        pausePay: false,
        pauseCreditTransfers: false,
        allowOwnerMinting: true,
        allowSetCustomToken: false,
        allowTerminalMigration: false,
        allowSetTerminals: true,
        allowSetController: true,
        allowAddAccountingContext: true,
        allowAddPriceFeed: true,
        ownerMustSendPayouts: false,
        holdFees: false,
        useTotalSurplusForCashOuts: false,
        useDataHookForPay: false,
        useDataHookForCashOut: false,
        dataHook: '0x0000000000000000000000000000000000000000',
        metadata: 0,
      },
      splitGroups: [],
      fundAccessLimitGroups: [],
    }],
    terminalConfigurations: [{
      terminal: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c',
      accountingContextsToAccept: [{
        token: '0x000000000000000000000000000000000000EEEe',
        decimals: 18,
        currency: 1,
      }],
    }],
    memo: 'Test project launch',
  }

  describe('initial state', () => {
    it('returns correct initial state', () => {
      const { result } = renderHook(() => useOmnichainLaunchProject())

      expect(result.current.bundleState.status).toBe('idle')
      expect(result.current.isLaunching).toBe(false)
      expect(result.current.isComplete).toBe(false)
      expect(result.current.hasError).toBe(false)
      expect(result.current.createdProjectIds).toEqual({})
    })
  })

  describe('launch function', () => {
    it('calls setCreating when launch is called', async () => {
      // Multi-chain uses buildOmnichainLaunchTransactions (already mocked in beforeEach)
      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch(defaultParams)
      })

      expect(mockSetCreating).toHaveBeenCalled()
    })

    it('builds transactions with correct parameters for multi-chain deployment', async () => {
      // Multi-chain deployments use buildOmnichainLaunchTransactions from omnichainDeployer
      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-id',
      })

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch(defaultParams)
      })

      // For multi-chain (>1 chain), uses omnichain deployer
      expect(mockBuildOmnichainLaunchTransactions).toHaveBeenCalledWith({
        chainIds: defaultParams.chainIds,
        owner: defaultParams.owner,
        projectUri: defaultParams.projectUri,
        rulesetConfigurations: defaultParams.rulesetConfigurations,
        terminalConfigurations: defaultParams.terminalConfigurations,
        memo: defaultParams.memo,
        suckerDeploymentConfiguration: undefined,
        chainConfigs: undefined,
      })
      // Should NOT call the API-based builder for multi-chain
      expect(mockBuildOmnichainLaunchProjectTransactions).not.toHaveBeenCalled()
    })

    it('builds transactions with API for single-chain deployment', async () => {
      // Single-chain deployments use API endpoint
      mockBuildOmnichainLaunchProjectTransactions.mockResolvedValue({
        transactions: [
          { txData: { chainId: 1, to: '0xcontroller', data: '0x123', value: '0' } },
        ],
        predictedProjectIds: { 1: 100 },
      })

      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-id',
      })

      const singleChainParams = {
        ...defaultParams,
        chainIds: [1], // Single chain - uses API path
      }

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch(singleChainParams)
      })

      expect(mockBuildOmnichainLaunchProjectTransactions).toHaveBeenCalledWith({
        chainIds: [1],
        owner: singleChainParams.owner,
        projectUri: singleChainParams.projectUri,
        rulesetConfigurations: singleChainParams.rulesetConfigurations,
        terminalConfigurations: singleChainParams.terminalConfigurations,
        memo: singleChainParams.memo,
      })
      // Should NOT call the omnichain deployer for single-chain
      expect(mockBuildOmnichainLaunchTransactions).not.toHaveBeenCalled()
    })

    it('creates balance bundle with correct parameters', async () => {
      // Multi-chain uses buildOmnichainLaunchTransactions which returns array directly
      mockBuildOmnichainLaunchTransactions.mockReturnValue([
        { chainId: 1, to: '0xomnichain1', data: '0x111', value: '0' },
        { chainId: 10, to: '0xomnichain10', data: '0x222', value: '0' },
      ])

      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-id',
      })

      const twoChainParams = {
        ...defaultParams,
        chainIds: [1, 10],
      }

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch(twoChainParams)
      })

      expect(mockCreateBalanceBundle).toHaveBeenCalledWith({
        app_id: expect.any(String),
        transactions: [
          { chain: 1, target: '0xomnichain1', data: '0x111', value: '0' },
          { chain: 10, target: '0xomnichain10', data: '0x222', value: '0' },
        ],
        perform_simulation: true,
        virtual_nonce_mode: 'Disabled',
      })
    })

    it('initializes bundle and sets processing for multi-chain', async () => {
      // Multi-chain deployments set predictedIds to 0 (extracted from receipts after completion)
      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-123',
      })

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch(defaultParams)
      })

      // Multi-chain sets all predicted IDs to 0 initially
      expect(mockInitializeBundle).toHaveBeenCalledWith(
        'test-bundle-123',
        defaultParams.chainIds,
        { 1: 0, 10: 0, 8453: 0, 42161: 0 },
        []
      )

      expect(mockSetProcessing).toHaveBeenCalledWith('sponsored')
    })

    it('initializes bundle with predicted IDs for single-chain', async () => {
      // Single-chain deployments get predicted IDs from API
      mockBuildOmnichainLaunchProjectTransactions.mockResolvedValue({
        transactions: [
          { txData: { chainId: 1, to: '0xcontroller', data: '0x123', value: '0' } },
        ],
        predictedProjectIds: { 1: 100 },
      })

      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'test-bundle-single',
      })

      const singleChainParams = {
        ...defaultParams,
        chainIds: [1],
      }

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch(singleChainParams)
      })

      // Single-chain uses predicted IDs from API
      expect(mockInitializeBundle).toHaveBeenCalledWith(
        'test-bundle-single',
        [1],
        { 1: 100 },
        []
      )
    })

    it('sets error when no owner specified', async () => {
      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch({
          ...defaultParams,
          owner: '',
        })
      })

      expect(mockSetError).toHaveBeenCalledWith('No owner address specified')
    })

    it('sets error on build failure for multi-chain', async () => {
      // Multi-chain uses buildOmnichainLaunchTransactions which throws synchronously
      mockBuildOmnichainLaunchTransactions.mockImplementation(() => {
        throw new Error('Build failed')
      })

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch(defaultParams)
      })

      expect(mockSetError).toHaveBeenCalledWith('Build failed')
    })

    it('sets error on build failure for single-chain', async () => {
      // Single-chain uses API which rejects asynchronously
      mockBuildOmnichainLaunchProjectTransactions.mockRejectedValue(new Error('API build failed'))

      const singleChainParams = {
        ...defaultParams,
        chainIds: [1],
      }

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch(singleChainParams)
      })

      expect(mockSetError).toHaveBeenCalledWith('API build failed')
    })

    it('sets error on bundle creation failure', async () => {
      // Multi-chain path - buildOmnichainLaunchTransactions succeeds but createBalanceBundle fails
      mockCreateBalanceBundle.mockRejectedValue(new Error('Bundle creation failed'))

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch(defaultParams)
      })

      expect(mockSetError).toHaveBeenCalledWith('Bundle creation failed')
    })
  })

  describe('callbacks', () => {
    it('calls onError when build fails', async () => {
      const onError = vi.fn()
      // Multi-chain uses buildOmnichainLaunchTransactions which throws synchronously
      mockBuildOmnichainLaunchTransactions.mockImplementation(() => {
        throw new Error('Build failed')
      })

      const { result } = renderHook(() => useOmnichainLaunchProject({ onError }))

      await act(async () => {
        await result.current.launch(defaultParams)
      })

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('reset function', () => {
    it('resets bundle state', async () => {
      const { result } = renderHook(() => useOmnichainLaunchProject())

      act(() => {
        result.current.reset()
      })

      expect(mockReset).toHaveBeenCalled()
    })
  })

  describe('derived state', () => {
    it('returns isLaunching true when creating', () => {
      mockBundleState.status = 'creating'

      const { result } = renderHook(() => useOmnichainLaunchProject())

      expect(result.current.isLaunching).toBe(true)
    })

    it('returns isLaunching true when processing', () => {
      mockBundleState.status = 'processing'

      const { result } = renderHook(() => useOmnichainLaunchProject())

      expect(result.current.isLaunching).toBe(true)
    })

    it('returns isComplete true when completed', () => {
      mockBundleState.status = 'completed'

      const { result } = renderHook(() => useOmnichainLaunchProject())

      expect(result.current.isComplete).toBe(true)
    })

    it('returns hasError true when failed', () => {
      mockBundleState.status = 'failed'

      const { result } = renderHook(() => useOmnichainLaunchProject())

      expect(result.current.hasError).toBe(true)
    })

    it('returns hasError true when partial', () => {
      mockBundleState.status = 'partial'

      const { result } = renderHook(() => useOmnichainLaunchProject())

      expect(result.current.hasError).toBe(true)
    })
  })
})
