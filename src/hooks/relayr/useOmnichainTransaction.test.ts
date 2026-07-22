import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'

const { call, getProjectController, getSafetyPublicClient } = vi.hoisted(() => {
  const call = vi.fn()
  return {
    call,
    getProjectController: vi.fn(),
    getSafetyPublicClient: vi.fn(() => ({ call })),
  }
})

vi.mock('../../utils/paymentTerminal', () => ({ getProjectController }))
vi.mock('../../utils/transactionSafety', () => ({ getSafetyPublicClient }))

import {
  preflightControllerTransactions,
  submitManagedControllerBundle,
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
