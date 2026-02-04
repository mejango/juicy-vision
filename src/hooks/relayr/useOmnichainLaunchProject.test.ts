import { describe, it, expect, beforeEach, vi, Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOmnichainLaunchProject, type OmnichainLaunchProjectParams } from './useOmnichainLaunchProject'
import type { BundleStatus } from './types'

// Mock wagmi hooks
const mockSignTypedDataAsync = vi.fn()

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: '0xWalletUser12345678901234567890123456789',
    isConnected: true,
  })),
  useConfig: vi.fn(() => ({
    getClient: vi.fn(() => ({
      // Minimal public client mock
      request: vi.fn(),
    })),
  })),
  useSignTypedData: vi.fn(() => ({
    signTypedDataAsync: mockSignTypedDataAsync,
  })),
}))

// Mock viem's getContract for ERC-2771 nonce reads
const mockForwarderNonce = vi.fn()

vi.mock('viem', async (importOriginal) => {
  const original = await importOriginal() as object
  return {
    ...original,
    getContract: vi.fn(() => ({
      read: {
        nonces: mockForwarderNonce,
      },
    })),
    encodeFunctionData: vi.fn(() => '0xmockedEncodedData'),
  }
})

// Mock stores - configurable for testing different auth modes
let mockAuthStoreState = {
  mode: 'self_custody' as 'managed' | 'self_custody',
  isAuthenticated: () => true,
}

vi.mock('../../stores', () => ({
  useAuthStore: vi.fn(() => mockAuthStoreState),
}))

// Mock managed wallet hook - configurable for testing
let mockManagedWalletState = {
  address: '0xmanagedaddress123456789012345678901234',
  isLoading: false,
  isManagedMode: false,
}

const mockCreateManagedRelayrBundle = vi.fn()

vi.mock('../useManagedWallet', () => ({
  useManagedWallet: vi.fn(() => mockManagedWalletState),
  createManagedRelayrBundle: (...args: unknown[]) => mockCreateManagedRelayrBundle(...args),
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

    // Reset auth store state
    mockAuthStoreState = {
      mode: 'self_custody',
      isAuthenticated: () => true,
    }

    // Reset managed wallet state - default to non-managed mode
    mockManagedWalletState = {
      address: '0xmanagedaddress123456789012345678901234',
      isLoading: false,
      isManagedMode: false,
    }

    // Default mock for omnichain deployer (multi-chain path)
    mockBuildOmnichainLaunchTransactions.mockReturnValue([
      { chainId: 1, to: '0xomnichain', data: '0x111', value: '0' },
      { chainId: 10, to: '0xomnichain', data: '0x222', value: '0' },
      { chainId: 8453, to: '0xomnichain', data: '0x333', value: '0' },
      { chainId: 42161, to: '0xomnichain', data: '0x444', value: '0' },
    ])

    // Default mock for project ID extraction
    mockGetProjectIdsFromReceipts.mockResolvedValue({})

    // Reset server signing mock
    mockCreateManagedRelayrBundle.mockReset()

    // Reset ERC-2771 signing mocks
    mockForwarderNonce.mockResolvedValue(BigInt(0))
    mockSignTypedDataAsync.mockResolvedValue('0xmockedSignature123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890')
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

    it('creates balance bundle with ERC-2771 wrapped transactions in self-custody mode', async () => {
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

      // In self-custody mode, transactions are wrapped via TrustedForwarder (ERC-2771)
      // The target becomes the forwarder address, and data is the encoded execute() call
      expect(mockCreateBalanceBundle).toHaveBeenCalledWith({
        app_id: expect.any(String),
        transactions: [
          { chain: 1, target: '0xc29d6995ab3b0df4650ad643adeac55e7acbb566', data: expect.any(String), value: '0' },
          { chain: 10, target: '0xc29d6995ab3b0df4650ad643adeac55e7acbb566', data: expect.any(String), value: '0' },
        ],
        perform_simulation: true,
        virtual_nonce_mode: 'Disabled',
      })

      // Verify signing was called for each chain
      expect(mockSignTypedDataAsync).toHaveBeenCalledTimes(2)
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

    it('does not report isComplete from stale localStorage when launch was not called in session', () => {
      // Simulate stale localStorage from a previous deployment with the same key
      // This bug caused the chat to auto-continue with "Your project now exists!" before
      // the user clicked the Launch Project button
      const staleResult = {
        bundleId: 'old-bundle-from-previous-deployment',
        projectIds: { 11155111: 213 },
        txHashes: { 11155111: '0xoldtxhash' },
        timestamp: Date.now() - 1000,
      }
      localStorage.setItem('juicy-vision:deployment-result:test-stale-key', JSON.stringify(staleResult))

      // Render the hook fresh with the same deploymentKey - should NOT report complete
      const { result } = renderHook(() => useOmnichainLaunchProject({ deploymentKey: 'test-stale-key' }))

      // isComplete should be false because launch() was never called in this session
      expect(result.current.isComplete).toBe(false)
      // Bundle state should be idle
      expect(result.current.bundleState.status).toBe('idle')

      // Cleanup
      localStorage.removeItem('juicy-vision:deployment-result:test-stale-key')
    })

    it('reports isComplete from localStorage when launch was called in current session', async () => {
      // This tests that legitimate persisted results ARE used after launch() is called
      mockCreateBalanceBundle.mockResolvedValue({ bundle_uuid: 'new-bundle-123' })

      const { result } = renderHook(() => useOmnichainLaunchProject({ deploymentKey: 'test-launched-key' }))

      // Call launch - this sets hasLaunchedInSessionRef.current = true
      await act(async () => {
        await result.current.launch(defaultParams)
      })

      // Now if bundle status becomes idle but persistedResult exists, isComplete should be true
      // (simulating page refresh scenario where bundle completed)
      mockBundleState.status = 'completed'

      const { result: result2 } = renderHook(() => useOmnichainLaunchProject({ deploymentKey: 'test-launched-key' }))

      // After bundle completes, isComplete should be true
      expect(result2.current.isComplete).toBe(true)

      // Cleanup
      localStorage.removeItem('juicy-vision:deployment-result:test-launched-key')
      localStorage.removeItem('juicy-vision:deployment-in-progress:test-launched-key')
    })
  })

  describe('managed mode (server signing)', () => {
    beforeEach(() => {
      // Set up managed mode
      mockManagedWalletState = {
        address: '0xSmartAccount123456789012345678901234567',
        isLoading: false,
        isManagedMode: true,
      }

      // Mock successful server signing
      mockCreateManagedRelayrBundle.mockResolvedValue({
        bundleId: 'server-signed-bundle-123',
      })
    })

    it('uses server signing when in managed mode', async () => {
      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch({
          ...defaultParams,
          owner: '0xSmartAccount123456789012345678901234567',
        })
      })

      // Should call server signing endpoint with smart account address for routing
      expect(mockCreateManagedRelayrBundle).toHaveBeenCalledWith(
        expect.any(Array),
        '0xSmartAccount123456789012345678901234567',
        '0xSmartAccount123456789012345678901234567' // Smart account address for routing
      )
      expect(mockCreateBalanceBundle).not.toHaveBeenCalled()
    })

    it('uses managed address as owner when owner param is empty', async () => {
      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch({
          ...defaultParams,
          owner: '', // Empty - should use managed address
        })
      })

      // Should use managed address as both owner and smart account for routing
      expect(mockCreateManagedRelayrBundle).toHaveBeenCalledWith(
        expect.any(Array),
        '0xSmartAccount123456789012345678901234567',
        '0xSmartAccount123456789012345678901234567' // Smart account address for routing
      )
    })

    it('passes correct transaction format to server', async () => {
      mockBuildOmnichainLaunchTransactions.mockReturnValue([
        { chainId: 1, to: '0xDeployer1', data: '0xabc', value: '100' },
        { chainId: 10, to: '0xDeployer2', data: '0xdef', value: '0' },
      ])

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch({
          ...defaultParams,
          chainIds: [1, 10],
        })
      })

      expect(mockCreateManagedRelayrBundle).toHaveBeenCalledWith(
        [
          { chainId: 1, target: '0xDeployer1', data: '0xabc', value: '100' },
          { chainId: 10, target: '0xDeployer2', data: '0xdef', value: '0' },
        ],
        expect.any(String),
        '0xSmartAccount123456789012345678901234567' // Smart account address for routing
      )
    })

    it('handles server signing errors gracefully', async () => {
      const onError = vi.fn()
      mockCreateManagedRelayrBundle.mockRejectedValue(new Error('Server signing failed'))

      const { result } = renderHook(() => useOmnichainLaunchProject({ onError }))

      await act(async () => {
        await result.current.launch(defaultParams)
      })

      expect(mockSetError).toHaveBeenCalledWith('Server signing failed')
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })
  })

  describe('forceSelfCustody parameter', () => {
    beforeEach(() => {
      // Set up managed mode (normally would use server signing)
      mockManagedWalletState = {
        address: '0xSmartAccount123456789012345678901234567',
        isLoading: false,
        isManagedMode: true,
      }

      mockCreateManagedRelayrBundle.mockResolvedValue({
        bundleId: 'server-bundle',
      })

      mockCreateBalanceBundle.mockResolvedValue({
        bundle_uuid: 'client-bundle',
      })
    })

    it('uses server signing by default in managed mode', async () => {
      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch({
          ...defaultParams,
          forceSelfCustody: false, // Explicit false (or omitted)
        })
      })

      expect(mockCreateManagedRelayrBundle).toHaveBeenCalled()
      expect(mockCreateBalanceBundle).not.toHaveBeenCalled()
    })

    it('forces client-side signing when forceSelfCustody is true', async () => {
      // Note: This test verifies the branch is taken, but the actual ERC-2771 signing
      // requires wagmi hooks which are complex to mock. We verify it attempts client signing.
      const { result } = renderHook(() => useOmnichainLaunchProject())

      // The hook will try to do client-side signing, which requires wallet connection
      // Since wagmi is not mocked to provide signing, this will fail at the signing step
      // But we can verify it didn't use server signing
      await act(async () => {
        try {
          await result.current.launch({
            ...defaultParams,
            forceSelfCustody: true,
          })
        } catch {
          // Expected - wagmi signing not mocked
        }
      })

      // Should NOT have called server signing
      expect(mockCreateManagedRelayrBundle).not.toHaveBeenCalled()
    })

    it('uses specified owner address even with forceSelfCustody', async () => {
      const walletAddress = '0xWalletAddress12345678901234567890123456'

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        try {
          await result.current.launch({
            ...defaultParams,
            owner: walletAddress,
            forceSelfCustody: true,
          })
        } catch {
          // Expected - wagmi signing not mocked
        }
      })

      // Should NOT fall back to managed address
      expect(mockCreateManagedRelayrBundle).not.toHaveBeenCalled()
    })
  })

  describe('owner address resolution', () => {
    it('uses explicit owner when provided', async () => {
      mockCreateBalanceBundle.mockResolvedValue({ bundle_uuid: 'test-123' })

      const explicitOwner = '0xExplicitOwner123456789012345678901234'
      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch({
          ...defaultParams,
          owner: explicitOwner,
        })
      })

      // Verify the explicit owner was passed to transaction builder
      expect(mockBuildOmnichainLaunchTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: explicitOwner,
        })
      )
    })

    it('uses managed address when owner is empty in managed mode', async () => {
      mockManagedWalletState = {
        address: '0xManagedFallback1234567890123456789012',
        isLoading: false,
        isManagedMode: true,
      }
      mockCreateManagedRelayrBundle.mockResolvedValue({ bundleId: 'test-123' })

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch({
          ...defaultParams,
          owner: '',
        })
      })

      // Should use managed address as both owner and smart account for routing
      expect(mockCreateManagedRelayrBundle).toHaveBeenCalledWith(
        expect.any(Array),
        '0xManagedFallback1234567890123456789012',
        '0xManagedFallback1234567890123456789012' // Smart account address for routing
      )
    })

    it('sets error when no owner and not in managed mode', async () => {
      // Not in managed mode, no address available
      mockManagedWalletState = {
        address: undefined as unknown as string,
        isLoading: false,
        isManagedMode: false,
      }

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch({
          ...defaultParams,
          owner: '',
        })
      })

      expect(mockSetError).toHaveBeenCalledWith('No owner address specified')
    })
  })

  describe('ERC-2771 transaction structure', () => {
    it('wraps omnichain transactions through TrustedForwarder in self-custody mode', async () => {
      mockCreateBalanceBundle.mockResolvedValue({ bundle_uuid: 'test-123' })

      // Multi-chain returns direct transactions (not wrapped in txData)
      mockBuildOmnichainLaunchTransactions.mockReturnValue([
        { chainId: 1, to: '0xOmnichainDeployer', data: '0xlaunchData1', value: '0' },
        { chainId: 10, to: '0xOmnichainDeployer', data: '0xlaunchData2', value: '0' },
      ])

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch({
          ...defaultParams,
          chainIds: [1, 10],
        })
      })

      // In self-custody mode, transactions are wrapped via ERC-2771 TrustedForwarder
      // The forwarder address is the same on all chains
      const TRUSTED_FORWARDER = '0xc29d6995ab3b0df4650ad643adeac55e7acbb566'

      expect(mockCreateBalanceBundle).toHaveBeenCalledWith({
        app_id: expect.any(String),
        transactions: [
          { chain: 1, target: TRUSTED_FORWARDER, data: expect.any(String), value: '0' },
          { chain: 10, target: TRUSTED_FORWARDER, data: expect.any(String), value: '0' },
        ],
        perform_simulation: true,
        virtual_nonce_mode: 'Disabled',
      })

      // Each transaction requires a wallet signature
      expect(mockSignTypedDataAsync).toHaveBeenCalledTimes(2)
    })

    it('passes suckerDeploymentConfiguration to omnichain builder', async () => {
      mockCreateBalanceBundle.mockResolvedValue({ bundle_uuid: 'test-123' })

      const suckerConfig = {
        salt: '0x1234',
        deployerConfigurations: [],
      }

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch({
          ...defaultParams,
          suckerDeploymentConfiguration: suckerConfig,
        })
      })

      expect(mockBuildOmnichainLaunchTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          suckerDeploymentConfiguration: suckerConfig,
        })
      )
    })

    it('passes chainConfigs overrides to omnichain builder', async () => {
      mockCreateBalanceBundle.mockResolvedValue({ bundle_uuid: 'test-123' })

      const chainConfigs = [
        { chainId: 1, terminalConfigurations: [] },
        { chainId: 10, terminalConfigurations: [] },
      ]

      const { result } = renderHook(() => useOmnichainLaunchProject())

      await act(async () => {
        await result.current.launch({
          ...defaultParams,
          chainConfigs,
        })
      })

      expect(mockBuildOmnichainLaunchTransactions).toHaveBeenCalledWith(
        expect.objectContaining({
          chainConfigs,
        })
      )
    })
  })

  describe('signing state tracking', () => {
    it('exposes isSigning and signingChainId in return value', () => {
      const { result } = renderHook(() => useOmnichainLaunchProject())

      expect(result.current.isSigning).toBe(false)
      expect(result.current.signingChainId).toBeNull()
    })
  })
})
