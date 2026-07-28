import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Address } from 'viem'

const {
  call,
  getProjectController,
  getSafetyPublicClient,
  hookMocks,
} = vi.hoisted(() => {
  const call = vi.fn()
  return {
    call,
    getProjectController: vi.fn(),
    getSafetyPublicClient: vi.fn(() => ({ call })),
    hookMocks: {
      authState: { mode: 'self_custody', isAuthenticated: () => false },
      managedAddress: null as string | null,
      guardedActiveAddress: null as string | null,
      runGuardedTx: vi.fn(),
      setError: vi.fn(),
      setCreating: vi.fn(),
      setDirectCompleted: vi.fn(),
      buildQueue: vi.fn(),
      createManagedRelayrBundle: vi.fn(),
    },
  }
})

vi.mock('../../utils/paymentTerminal', () => ({ getProjectController }))
vi.mock('../../utils/transactionSafety', () => ({ getSafetyPublicClient }))
vi.mock('../../stores', () => ({
  useAuthStore: () => hookMocks.authState,
}))
vi.mock('../useManagedWallet', () => ({
  useManagedWallet: () => ({ address: hookMocks.managedAddress }),
  createManagedRelayrBundle: (...args: unknown[]) =>
    hookMocks.createManagedRelayrBundle(...args),
}))
vi.mock('../useGuardedTx', () => ({
  useGuardedTx: () => ({
    run: hookMocks.runGuardedTx,
    activeAddress: hookMocks.guardedActiveAddress,
    isManagedMode: false,
    isSafeMode: false,
  }),
}))
vi.mock('./useRelayrBundle', () => ({
  useRelayrBundle: () => ({
    bundleState: {
      bundleId: null,
      status: 'idle',
      chainStates: [],
      paymentOptions: [],
      selectedPaymentChain: null,
      paymentTxHash: null,
      error: null,
    },
    reset: vi.fn(),
    updateFromStatus: vi.fn(),
    _setError: hookMocks.setError,
    _setCreating: hookMocks.setCreating,
    _setDirectCompleted: hookMocks.setDirectCompleted,
    _initializeBundle: vi.fn(),
    _setProcessing: vi.fn(),
    _setExpired: vi.fn(),
  }),
}))
vi.mock('./useRelayrStatus', () => ({
  useRelayrStatus: () => ({ data: null }),
}))
vi.mock('../../services/relayr', () => ({
  buildOmnichainQueueRulesetTransactions: (...args: unknown[]) =>
    hookMocks.buildQueue(...args),
  buildOmnichainDistributeTransactions: vi.fn(),
  buildOmnichainDeployERC20Transactions: vi.fn(),
}))
vi.mock('../../utils/projectTrust', () => ({
  resolveRulesetQueueRoute: vi.fn(async () => ({
    target: '0x2222222222222222222222222222222222222222',
  })),
}))

import {
  preflightControllerTransactions,
  submitManagedControllerBundle,
  useOmnichainTransaction,
} from './useOmnichainTransaction'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const CONTROLLER = '0x2222222222222222222222222222222222222222' as Address

describe('preflightControllerTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProjectController.mockResolvedValue(CONTROLLER)
    call.mockResolvedValue({ data: '0x' })
  })

  it('derives the live controller and simulates every reviewed call', async () => {
    await preflightControllerTransactions({
      transactions: [{ chainId: 1, target: CONTROLLER, data: '0x12345678', value: '0' }],
      chainIds: [1],
      projectIds: { 1: 7 },
      account: ACCOUNT,
    })

    expect(getProjectController).toHaveBeenCalledWith(expect.anything(), 7n)
    expect(call).toHaveBeenCalledWith({
      account: ACCOUNT,
      to: CONTROLLER,
      data: '0x12345678',
      value: 0n,
    })
  })

  it('blocks when the built target is not the live project controller', async () => {
    await expect(preflightControllerTransactions({
      transactions: [{
        chainId: 1,
        target: '0x3333333333333333333333333333333333333333',
        data: '0x12345678',
        value: '0',
      }],
      chainIds: [1],
      projectIds: { 1: 7 },
      account: ACCOUNT,
    })).rejects.toThrow('project transaction route changed')
    expect(call).not.toHaveBeenCalled()
  })

  it('propagates unknown-controller rejection without simulating it', async () => {
    getProjectController.mockRejectedValueOnce(new Error('Controller not recognized: 0xdead'))

    await expect(preflightControllerTransactions({
      transactions: [{ chainId: 1, target: CONTROLLER, data: '0x12345678', value: '0' }],
      chainIds: [1],
      projectIds: { 1: 7 },
      account: ACCOUNT,
    })).rejects.toThrow('Controller not recognized')
    expect(call).not.toHaveBeenCalled()
  })

  it('blocks missing, duplicate, or extra destination calls', async () => {
    await expect(preflightControllerTransactions({
      transactions: [{ chainId: 1, target: CONTROLLER, data: '0x12345678', value: '0' }],
      chainIds: [1, 10],
      projectIds: { 1: 7, 10: 8 },
      account: ACCOUNT,
    })).rejects.toThrow('does not match the reviewed chains')
    expect(getProjectController).not.toHaveBeenCalled()
  })
})

describe('managed controller Relayr submission', () => {
  it('submits the exact preflighted destination set through the managed account', async () => {
    const submit = vi.fn().mockResolvedValue({ bundleId: 'controller-bundle' })
    const transactions = [{ chainId: 1, target: CONTROLLER, data: '0x12345678', value: '7' }]
    await expect(submitManagedControllerBundle(transactions, ACCOUNT, ACCOUNT, submit))
      .resolves.toEqual({ bundleId: 'controller-bundle' })
    expect(submit).toHaveBeenCalledWith(transactions, ACCOUNT, ACCOUNT)
  })
})

describe('useOmnichainTransaction custody gating', () => {
  const TX_HASH = `0x${'cd'.repeat(32)}` as const

  beforeEach(() => {
    vi.clearAllMocks()
    hookMocks.authState = { mode: 'self_custody', isAuthenticated: () => false }
    hookMocks.managedAddress = null
    hookMocks.guardedActiveAddress = ACCOUNT
    getProjectController.mockResolvedValue(CONTROLLER)
    call.mockResolvedValue({ data: '0x' })
    hookMocks.buildQueue.mockResolvedValue({
      transactions: [
        {
          txData: { chainId: 1, to: CONTROLLER, data: '0xabcdef01', value: '0' },
        },
      ],
      synchronizedStartTime: undefined,
    })
    hookMocks.runGuardedTx.mockResolvedValue(TX_HASH)
  })

  it('sends a single-chain operation directly from a self-custody wallet', async () => {
    const { result } = renderHook(() => useOmnichainTransaction())

    await act(async () => {
      await result.current.execute({
        chainIds: [1],
        projectIds: { 1: 7 },
        rulesetConfig: { rulesetConfigurations: [], memo: 'queue' },
      })
    })

    expect(hookMocks.setError).not.toHaveBeenCalled()
    expect(hookMocks.runGuardedTx).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 1, to: CONTROLLER, data: '0xabcdef01' }),
    )
    expect(hookMocks.setDirectCompleted).toHaveBeenCalledWith(1, 7, TX_HASH)
    expect(hookMocks.createManagedRelayrBundle).not.toHaveBeenCalled()
  })

  it('still refuses multichain execution for self-custody wallets', async () => {
    const { result } = renderHook(() => useOmnichainTransaction())

    await act(async () => {
      await result.current.execute({
        chainIds: [1, 10],
        projectIds: { 1: 7, 10: 8 },
        rulesetConfig: { rulesetConfigurations: [], memo: 'queue' },
      })
    })

    expect(hookMocks.setError).toHaveBeenCalledWith(
      expect.stringContaining('managed account'),
    )
    expect(hookMocks.buildQueue).not.toHaveBeenCalled()
    expect(hookMocks.runGuardedTx).not.toHaveBeenCalled()
  })

  it('refuses when nothing is connected at all', async () => {
    hookMocks.guardedActiveAddress = null
    const { result } = renderHook(() => useOmnichainTransaction())

    await act(async () => {
      await result.current.execute({
        chainIds: [1],
        projectIds: { 1: 7 },
        rulesetConfig: { rulesetConfigurations: [], memo: 'queue' },
      })
    })

    expect(hookMocks.setError).toHaveBeenCalledWith('Connect a wallet first')
    expect(hookMocks.runGuardedTx).not.toHaveBeenCalled()
  })
})
