import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chain, WalletClient } from 'viem'
import { useTransactionStore } from '../stores'
import { submitTrackedTokenApproval } from './trackedTokenApproval'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as const
const TOKEN = '0x2222222222222222222222222222222222222222' as const
const SPENDER = '0x3333333333333333333333333333333333333333' as const
const DATA = '0x095ea7b3' as const
const HASH = `0x${'ab'.repeat(32)}` as const
const CHAIN = { id: 1, name: 'Ethereum', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://example.invalid'] } } } as Chain

describe('submitTrackedTokenApproval', () => {
  beforeEach(() => useTransactionStore.setState({ transactions: [] }))

  it('persists the exact approval before send and confirms only after a successful receipt', async () => {
    const sendTransaction = vi.fn().mockResolvedValue(HASH)
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: 'success' })
    await expect(submitTrackedTokenApproval({
      chainId: 1,
      chain: CHAIN,
      account: ACCOUNT,
      token: TOKEN,
      spender: SPENDER,
      amount: 5n,
      data: DATA,
      walletClient: { sendTransaction } as unknown as WalletClient,
      publicClient: { waitForTransactionReceipt },
    })).resolves.toBe(HASH)

    expect(sendTransaction).toHaveBeenCalledWith({
      to: TOKEN,
      data: DATA,
      value: 0n,
      chain: CHAIN,
      account: ACCOUNT,
    })
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: HASH })
    expect(useTransactionStore.getState().transactions[0]).toMatchObject({
      hash: HASH,
      status: 'confirmed',
      account: ACCOUNT,
      callKey: `${ACCOUNT.toLowerCase()}:1:${TOKEN.toLowerCase()}:0:${DATA}`,
    })
  })

  it('blocks an identical pending approval before the wallet is called', async () => {
    useTransactionStore.getState().addTransaction({
      type: 'contractCall',
      chainId: 1,
      account: ACCOUNT,
      callKey: `${ACCOUNT.toLowerCase()}:1:${TOKEN.toLowerCase()}:0:${DATA}`,
      status: 'submitted',
    })
    const sendTransaction = vi.fn()
    await expect(submitTrackedTokenApproval({
      chainId: 1,
      chain: CHAIN,
      account: ACCOUNT,
      token: TOKEN,
      spender: SPENDER,
      amount: 5n,
      data: DATA,
      walletClient: { sendTransaction } as unknown as WalletClient,
      publicClient: { waitForTransactionReceipt: vi.fn() },
    })).rejects.toThrow('already pending')
    expect(sendTransaction).not.toHaveBeenCalled()
  })
})
