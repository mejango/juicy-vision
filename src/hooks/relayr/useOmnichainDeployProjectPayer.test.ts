import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'

const { call, getSafetyPublicClient } = vi.hoisted(() => {
  const call = vi.fn()
  return {
    call,
    getSafetyPublicClient: vi.fn(() => ({ call })),
  }
})

vi.mock('../../utils/transactionSafety', () => ({ getSafetyPublicClient }))

import { preflightProjectPayerTransactions } from './useOmnichainDeployProjectPayer'
import { JB_PROJECT_PAYER_DEPLOYER } from '../../services/projectPayers'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const DEPLOYER = JB_PROJECT_PAYER_DEPLOYER

describe('preflightProjectPayerTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    call.mockResolvedValue({ data: '0x' })
  })

  it('simulates every payer deploy against the canonical deployer', async () => {
    await preflightProjectPayerTransactions({
      transactions: [
        { chainId: 1, to: DEPLOYER, data: '0x12345678' },
        { chainId: 10, to: DEPLOYER, data: '0x9abcdef0' },
      ],
      chainIds: [1, 10],
      account: ACCOUNT,
    })

    expect(getSafetyPublicClient).toHaveBeenCalledWith(1)
    expect(getSafetyPublicClient).toHaveBeenCalledWith(10)
    expect(call).toHaveBeenCalledWith({ account: ACCOUNT, to: DEPLOYER, data: '0x12345678', value: 0n })
    expect(call).toHaveBeenCalledWith({ account: ACCOUNT, to: DEPLOYER, data: '0x9abcdef0', value: 0n })
  })

  it('blocks when a call targets something other than the chain deployer', async () => {
    await expect(preflightProjectPayerTransactions({
      transactions: [{ chainId: 1, to: '0x3333333333333333333333333333333333333333', data: '0x12345678' }],
      chainIds: [1],
      account: ACCOUNT,
    })).rejects.toThrow('payer deployer route changed')
    expect(call).not.toHaveBeenCalled()
  })

  it('blocks a chain that has no deployer', async () => {
    await expect(preflightProjectPayerTransactions({
      transactions: [{ chainId: 999, to: DEPLOYER, data: '0x12345678' }],
      chainIds: [999],
      account: ACCOUNT,
    })).rejects.toThrow('not deployed on chain 999')
    expect(call).not.toHaveBeenCalled()
  })

  it('blocks missing, duplicate, or extra destination calls', async () => {
    await expect(preflightProjectPayerTransactions({
      transactions: [{ chainId: 1, to: DEPLOYER, data: '0x12345678' }],
      chainIds: [1, 10],
      account: ACCOUNT,
    })).rejects.toThrow('does not match the reviewed chains')
    expect(getSafetyPublicClient).not.toHaveBeenCalled()
  })
})
