import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useOmnichainLaunchProject,
  type OmnichainLaunchProjectParams,
} from './useOmnichainLaunchProject'
import type { BundleStatus } from './types'

const WALLET = '0x1234567890123456789012345678901234567890'
const MANAGED = '0xabcdef1234567890abcdef1234567890abcdef12'
const DEPLOYER = '0xb853758a70a6b4216c09f1d071ea2344aba0a34f'
const FEE = 1_000_000_000_000_000n

const mockSignTypedDataAsync = vi.fn()
const mockForwarderNonce = vi.fn()
const mockCreateManagedRelayrBundle = vi.fn()
const mockCreateBalanceBundle = vi.fn()
const mockGetBundleStatus = vi.fn()
const mockBuildLaunch = vi.fn()
const mockBuildLaunch721 = vi.fn()
const mockFetchCreationFee = vi.fn()
const mockGetProjectIdsFromReceipts = vi.fn()
const mockSafetyCall = vi.fn()

let mockManagedWalletState = {
  address: MANAGED,
  isLoading: false,
  isManagedMode: false,
}

vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({ address: WALLET, isConnected: true })),
  useConfig: vi.fn(() => ({
    getClient: vi.fn(() => ({ request: vi.fn() })),
  })),
  useSignTypedData: vi.fn(() => ({ signTypedDataAsync: mockSignTypedDataAsync })),
}))

vi.mock('viem', async (importOriginal) => ({
  ...await importOriginal<typeof import('viem')>(),
  getContract: vi.fn(() => ({ read: { nonces: mockForwarderNonce } })),
  encodeFunctionData: vi.fn(() => '0x1234'),
}))

vi.mock('../useManagedWallet', () => ({
  useManagedWallet: vi.fn(() => mockManagedWalletState),
  createManagedRelayrBundle: (...args: unknown[]) => mockCreateManagedRelayrBundle(...args),
}))

vi.mock('../../services/relayr', () => ({
  createReviewedForwarderBundle: (...args: unknown[]) => mockCreateBalanceBundle(...args),
  getBundleStatus: (...args: unknown[]) => mockGetBundleStatus(...args),
}))

vi.mock('../../services/omnichainDeployer', () => ({
  buildOmnichainLaunchTransactions: (...args: unknown[]) => mockBuildLaunch(...args),
  buildOmnichainLaunch721Transactions: (...args: unknown[]) => mockBuildLaunch721(...args),
  fetchProjectCreationFee: (...args: unknown[]) => mockFetchCreationFee(...args),
}))

vi.mock('../../services/bendystraw', () => ({
  getProjectIdsFromReceipts: (...args: unknown[]) => mockGetProjectIdsFromReceipts(...args),
}))

vi.mock('../../utils/transactionSafety', () => ({
  getSafetyPublicClient: vi.fn(() => ({ call: mockSafetyCall })),
}))

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

vi.mock('./useRelayrStatus', () => ({
  useRelayrStatus: vi.fn(() => ({ data: null, isLoading: false, error: null })),
}))

const defaultParams: OmnichainLaunchProjectParams = {
  chainIds: [1, 10],
  owner: WALLET,
  projectUri: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm',
  rulesetConfigurations: [],
  terminalConfigurations: [],
  memo: 'Launch',
}

function recognizedTransactions(chainIds: number[]) {
  return chainIds.map(chainId => ({
    chainId,
    to: DEPLOYER,
    data: '0x1234',
    value: FEE.toString(),
  }))
}

describe('useOmnichainLaunchProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockBundleState.bundleId = null
    mockBundleState.status = 'idle'
    mockBundleState.chainStates = []
    mockBundleState.error = null
    mockManagedWalletState = {
      address: MANAGED,
      isLoading: false,
      isManagedMode: false,
    }
    mockFetchCreationFee.mockResolvedValue(FEE)
    mockBuildLaunch.mockImplementation(({ chainIds }: { chainIds: number[] }) => (
      recognizedTransactions(chainIds)
    ))
    mockBuildLaunch721.mockImplementation(({ chainIds }: { chainIds: number[] }) => (
      recognizedTransactions(chainIds)
    ))
    mockSafetyCall.mockResolvedValue({ data: '0x' })
    mockForwarderNonce.mockResolvedValue(0n)
    mockSignTypedDataAsync.mockResolvedValue(`0x${'11'.repeat(65)}`)
    mockCreateBalanceBundle.mockResolvedValue({ bundle_uuid: 'wallet-bundle' })
    mockCreateManagedRelayrBundle.mockResolvedValue({ bundleId: 'managed-bundle' })
    mockGetProjectIdsFromReceipts.mockResolvedValue({})
  })

  it('starts idle with no invented project IDs', () => {
    const { result } = renderHook(() => useOmnichainLaunchProject())

    expect(result.current.bundleState.status).toBe('idle')
    expect(result.current.isLaunching).toBe(false)
    expect(result.current.isComplete).toBe(false)
    expect(result.current.createdProjectIds).toEqual({})
  })

  it('preflights every recognized deployer call before wallet signatures', async () => {
    const { result } = renderHook(() => useOmnichainLaunchProject())

    await act(async () => result.current.launch(defaultParams))

    // Each chain is simulated before signing, then the inner call and exact
    // signed forwarder request are simulated again immediately before submit.
    expect(mockSafetyCall).toHaveBeenCalledTimes(6)
    expect(mockSignTypedDataAsync).toHaveBeenCalledTimes(2)
    expect(mockCreateBalanceBundle).toHaveBeenCalledTimes(1)
    expect(mockSetCreating).toHaveBeenCalledTimes(1)
    expect(mockInitializeBundle).toHaveBeenCalledWith(
      'wallet-bundle',
      [1, 10],
      { 1: 0, 10: 0 },
      [],
    )
    expect(mockSetProcessing).toHaveBeenCalledWith('sponsored')
    expect(mockSafetyCall.mock.invocationCallOrder[1]).toBeLessThan(
      mockSignTypedDataAsync.mock.invocationCallOrder[0],
    )
  })

  it('blocks an unknown deployer even when the transaction shape and fee match', async () => {
    mockBuildLaunch.mockReturnValue(defaultParams.chainIds.map(chainId => ({
      chainId,
      to: '0x9999999999999999999999999999999999999999',
      data: '0x1234',
      value: FEE.toString(),
    })))
    const { result } = renderHook(() => useOmnichainLaunchProject())

    await act(async () => result.current.launch(defaultParams))

    expect(mockSetError).toHaveBeenCalledWith(expect.stringContaining('Project deployer not recognized'))
    expect(mockSafetyCall).not.toHaveBeenCalled()
    expect(mockSignTypedDataAsync).not.toHaveBeenCalled()
    expect(mockCreateBalanceBundle).not.toHaveBeenCalled()
  })

  it('blocks a transaction set that omits a reviewed chain', async () => {
    mockBuildLaunch.mockReturnValue(recognizedTransactions([1]))
    const { result } = renderHook(() => useOmnichainLaunchProject())

    await act(async () => result.current.launch(defaultParams))

    expect(mockSetError).toHaveBeenCalledWith('The launch transaction set does not match the reviewed chains')
    expect(mockSignTypedDataAsync).not.toHaveBeenCalled()
  })

  it('blocks a stale creation fee before signing', async () => {
    mockBuildLaunch.mockReturnValue(defaultParams.chainIds.map(chainId => ({
      chainId,
      to: DEPLOYER,
      data: '0x1234',
      value: '0',
    })))
    const { result } = renderHook(() => useOmnichainLaunchProject())

    await act(async () => result.current.launch(defaultParams))

    expect(mockSetError).toHaveBeenCalledWith(expect.stringContaining('Project creation fee changed'))
    expect(mockSignTypedDataAsync).not.toHaveBeenCalled()
  })

  it('uses server signing only when the managed account is the project owner', async () => {
    mockManagedWalletState = {
      address: MANAGED,
      isLoading: false,
      isManagedMode: true,
    }
    const { result } = renderHook(() => useOmnichainLaunchProject({ deploymentKey: 'managed' }))

    await act(async () => result.current.launch({ ...defaultParams, owner: MANAGED }))

    expect(mockCreateManagedRelayrBundle).toHaveBeenCalledWith(
      recognizedTransactions([1, 10]).map(tx => ({
        chainId: tx.chainId,
        target: tx.to,
        data: tx.data,
        value: tx.value,
      })),
      MANAGED,
      undefined,
      'managed',
    )
    expect(mockSignTypedDataAsync).not.toHaveBeenCalled()
    expect(mockCreateBalanceBundle).not.toHaveBeenCalled()
  })

  it('blocks an owner that does not match the active signer', async () => {
    const { result } = renderHook(() => useOmnichainLaunchProject())

    await act(async () => result.current.launch({ ...defaultParams, owner: MANAGED }))

    expect(mockSetError).toHaveBeenCalledWith('Project owner must match the active signing account')
    expect(mockBuildLaunch).not.toHaveBeenCalled()
  })

  it('treats a persisted result as authoritative and prevents a duplicate launch', async () => {
    localStorage.setItem('juicy-vision:deployment-result:duplicate', JSON.stringify({
      bundleId: 'confirmed-bundle',
      projectIds: { 1: 42 },
      txHashes: { 1: '0xabc' },
      timestamp: Date.now(),
    }))
    const { result } = renderHook(() => useOmnichainLaunchProject({ deploymentKey: 'duplicate' }))

    expect(result.current.isComplete).toBe(true)
    expect(result.current.createdProjectIds).toEqual({ 1: 42 })
    await act(async () => result.current.launch({ ...defaultParams, chainIds: [1] }))

    expect(mockSetError).toHaveBeenCalledWith('This project launch is already confirmed')
    expect(mockBuildLaunch).not.toHaveBeenCalled()
  })

  it('exposes only project IDs decoded from confirmed receipts', async () => {
    mockBundleState.bundleId = 'confirmed-bundle'
    mockBundleState.status = 'completed'
    mockBundleState.chainStates = [
      { chainId: 1, status: 'confirmed', txHash: '0xabc' },
    ]
    mockGetProjectIdsFromReceipts.mockResolvedValue({ 1: 77 })
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useOmnichainLaunchProject({
      deploymentKey: 'receipt',
      onSuccess,
    }))

    await waitFor(() => expect(result.current.createdProjectIds).toEqual({ 1: 77 }))
    expect(mockGetProjectIdsFromReceipts).toHaveBeenCalledWith({ 1: '0xabc' })
    expect(onSuccess).toHaveBeenCalledWith('confirmed-bundle', { 1: '0xabc' })
  })

  it('reports a failed bundle through the error callback', async () => {
    mockBundleState.status = 'failed'
    mockBundleState.error = 'Relay failed'
    const onError = vi.fn()

    renderHook(() => useOmnichainLaunchProject({ onError }))

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)))
  })
})
