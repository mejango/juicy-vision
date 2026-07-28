import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOmnichainSetUri, type OmnichainSetUriParams } from './useOmnichainSetUri'
import type { BundleStatus } from './types'
import { CHAIN_IDS } from '../../config/environment'

// The hook validates chains against the environment's supported set (Sepolia
// ids under the test setup's VITE_TESTNET_MODE).
const CHAIN_A = CHAIN_IDS.ethereum
const CHAIN_B = CHAIN_IDS.optimism

const WALLET = '0x1234567890123456789012345678901234567890'
const MANAGED = '0xabcdef1234567890abcdef1234567890abcdef12'
const CONTROLLER = '0x2222222222222222222222222222222222222222'

const mockSignTypedDataAsync = vi.fn()
const mockSwitchChainAsync = vi.fn()
const mockForwarderNonce = vi.fn()
const mockEstimateGas = vi.fn()
const mockCreateManagedRelayrBundle = vi.fn()
const mockCreateBalanceBundle = vi.fn()
const mockBuildSetUriTransactions = vi.fn()
const mockGetProjectController = vi.fn()
const mockSafetyCall = vi.fn()
const mockDiscoveryCall = vi.fn()
const mockRunGuardedTx = vi.fn()

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
  useSwitchChain: vi.fn(() => ({ switchChainAsync: mockSwitchChainAsync })),
}))

vi.mock('viem', async (importOriginal) => ({
  ...await importOriginal<typeof import('viem')>(),
  getContract: vi.fn(() => ({ read: { nonces: mockForwarderNonce } })),
  encodeFunctionData: vi.fn(() => '0x1234'),
  // Deferred dereference: utils/ens.ts calls createPublicClient at import
  // time, before this file's consts initialize.
  createPublicClient: vi.fn(() => ({ call: (...args: unknown[]) => mockDiscoveryCall(...args) })),
}))

vi.mock('../useManagedWallet', () => ({
  useManagedWallet: vi.fn(() => mockManagedWalletState),
  createManagedRelayrBundle: (...args: unknown[]) => mockCreateManagedRelayrBundle(...args),
}))

vi.mock('../useGuardedTx', () => ({
  useGuardedTx: vi.fn(() => ({
    activeAddress: mockManagedWalletState.isManagedMode ? MANAGED : WALLET,
    isManagedMode: mockManagedWalletState.isManagedMode,
    isSafeMode: false,
    run: mockRunGuardedTx,
  })),
}))

vi.mock('../../services/relayr', () => ({
  createReviewedForwarderBundle: (...args: unknown[]) => mockCreateBalanceBundle(...args),
}))

vi.mock('../../services/omnichainDeployer', () => ({
  buildOmnichainSetUriTransactions: (...args: unknown[]) => mockBuildSetUriTransactions(...args),
  encodeSetUriOf: vi.fn(() => '0xencoded'),
}))

vi.mock('../../utils/paymentTerminal', () => ({
  getProjectController: (...args: unknown[]) => mockGetProjectController(...args),
}))

vi.mock('../../utils/transactionSafety', () => ({
  getSafetyPublicClient: vi.fn(() => ({ call: mockSafetyCall, estimateGas: mockEstimateGas })),
}))

vi.mock('../../utils/ipfs', () => ({
  isIpfsUri: vi.fn(() => true),
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
const mockSetDirectCompleted = vi.fn()

vi.mock('./useRelayrBundle', () => ({
  useRelayrBundle: vi.fn(() => ({
    bundleState: mockBundleState,
    reset: mockReset,
    updateFromStatus: mockUpdateFromStatus,
    _initializeBundle: mockInitializeBundle,
    _setCreating: mockSetCreating,
    _setProcessing: mockSetProcessing,
    _setDirectCompleted: mockSetDirectCompleted,
    _setError: mockSetError,
  })),
}))

vi.mock('./useRelayrStatus', () => ({
  useRelayrStatus: vi.fn(() => ({ data: null, isLoading: false, error: null })),
}))

const defaultParams: OmnichainSetUriParams = {
  chainProjectMappings: [
    { chainId: CHAIN_A, projectId: 5 },
    { chainId: CHAIN_B, projectId: 9 },
  ],
  uri: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm',
}

describe('useOmnichainSetUri self-custody signing', () => {
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
    mockGetProjectController.mockResolvedValue(CONTROLLER)
    mockDiscoveryCall.mockResolvedValue({ data: '0x' })
    mockSafetyCall.mockResolvedValue({ data: '0x' })
    mockEstimateGas.mockResolvedValue(400_000n)
    mockSwitchChainAsync.mockResolvedValue(undefined)
    mockForwarderNonce.mockResolvedValue(0n)
    mockSignTypedDataAsync.mockResolvedValue(`0x${'11'.repeat(65)}`)
    mockCreateBalanceBundle.mockResolvedValue({ bundle_uuid: 'wallet-bundle' })
    mockRunGuardedTx.mockResolvedValue('0xabc')
    mockBuildSetUriTransactions.mockImplementation(
      ({ chainProjectMappings }: { chainProjectMappings: Array<{ chainId: number }> }) =>
        chainProjectMappings.map(({ chainId }) => ({
          chainId,
          to: CONTROLLER,
          data: '0xdead',
          value: '0',
        })),
    )
  })

  it('switches the wallet to each chain before signing its ForwardRequest', async () => {
    const { result } = renderHook(() => useOmnichainSetUri())

    await act(async () => result.current.setUri(defaultParams))

    expect(mockSetError).not.toHaveBeenCalled()
    // Wallets reject EIP-712 typed data whose domain chainId differs from the
    // active chain — the wallet must be switched before EVERY per-chain signature.
    expect(mockSwitchChainAsync).toHaveBeenCalledTimes(2)
    expect(mockSwitchChainAsync).toHaveBeenNthCalledWith(1, { chainId: CHAIN_A })
    expect(mockSwitchChainAsync).toHaveBeenNthCalledWith(2, { chainId: CHAIN_B })
    expect(mockSignTypedDataAsync).toHaveBeenCalledTimes(2)
    expect(mockSwitchChainAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mockSignTypedDataAsync.mock.invocationCallOrder[0],
    )
    expect(mockSwitchChainAsync.mock.invocationCallOrder[1]).toBeLessThan(
      mockSignTypedDataAsync.mock.invocationCallOrder[1],
    )
    expect(mockSignTypedDataAsync.mock.calls[0][0].domain.chainId).toBe(CHAIN_A)
    expect(mockSignTypedDataAsync.mock.calls[1][0].domain.chainId).toBe(CHAIN_B)
    expect(mockCreateBalanceBundle).toHaveBeenCalledTimes(1)
  })

  it('signs a per-chain gas limit of at least 1.5x the estimated inner call', async () => {
    const { result } = renderHook(() => useOmnichainSetUri())

    await act(async () => result.current.setUri(defaultParams))

    // gas is signature-bound: the relayer cannot raise it after the fact.
    expect(mockEstimateGas).toHaveBeenCalledTimes(2)
    expect(mockSignTypedDataAsync).toHaveBeenCalledTimes(2)
    for (const call of mockSignTypedDataAsync.mock.calls) {
      expect(call[0].message.gas).toBeGreaterThanOrEqual((400_000n * 3n) / 2n)
    }
  })

  it('falls back to a high signed gas limit when estimation fails', async () => {
    mockEstimateGas.mockRejectedValue(new Error('estimation unavailable'))
    const { result } = renderHook(() => useOmnichainSetUri())

    await act(async () => result.current.setUri(defaultParams))

    expect(mockSignTypedDataAsync).toHaveBeenCalledTimes(2)
    for (const call of mockSignTypedDataAsync.mock.calls) {
      expect(call[0].message.gas).toBeGreaterThanOrEqual(2_000_000n)
    }
  })
})
