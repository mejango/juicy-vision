import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeFunctionData, erc20Abi, type WalletClient } from 'viem'
import { runGuardedTx, type GuardedWalletContext, type GuardedTxRequest } from './projectTx'
import { useTransactionStore } from '../stores/transactionStore'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as const
const TARGET = '0x2222222222222222222222222222222222222222' as const
const TOKEN = '0x3333333333333333333333333333333333333333' as const
const SPENDER = '0x4444444444444444444444444444444444444444' as const
const DATA = '0x12345678' as const
const CHAIN_ID = 11155111
const APPROVAL_HASH = `0x${'aa'.repeat(32)}` as const
const MAIN_HASH = `0x${'bb'.repeat(32)}` as const

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  simulate: vi.fn(),
  estimateGas: vi.fn(),
  waitForReceipt: vi.fn(),
  executeManaged: vi.fn(),
  proposeSafe: vi.fn(),
  encodeApproval: vi.fn(),
  waitForSafe: vi.fn(),
  readContract: vi.fn(),
  getChainId: vi.fn(),
  sendTransaction: vi.fn(),
  switchChain: vi.fn(),
}))

vi.mock('../utils/transactionReview', () => ({
  requireTransactionReview: mocks.review,
}))

vi.mock('../utils/transactionSafety', () => ({
  estimateTransactionGasWithHeadroom: mocks.estimateGas,
  simulateTransaction: mocks.simulate,
  waitForSuccessfulTransaction: mocks.waitForReceipt,
}))

vi.mock('../hooks/useManagedWallet', () => ({
  executeManagedTransaction: mocks.executeManaged,
}))

vi.mock('./safeApp', () => ({
  proposeSafeTransactions: mocks.proposeSafe,
  encodeApprovalTx: mocks.encodeApproval,
  waitForSafeExecution: mocks.waitForSafe,
}))

vi.mock('viem', async importOriginal => ({
  ...(await importOriginal<typeof import('viem')>()),
  createPublicClient: () => ({ readContract: mocks.readContract }),
  http: vi.fn(),
}))

function walletContext(overrides: Partial<GuardedWalletContext> = {}): GuardedWalletContext {
  const walletClient = {
    account: { address: ACCOUNT, type: 'json-rpc' },
    getChainId: mocks.getChainId,
    sendTransaction: mocks.sendTransaction,
  } as unknown as WalletClient
  return {
    isManagedMode: false,
    activeAddress: ACCOUNT,
    walletClient,
    switchChain: mocks.switchChain,
    ...overrides,
  }
}

function request(overrides: Partial<GuardedTxRequest> = {}): GuardedTxRequest {
  return {
    chainId: CHAIN_ID,
    to: TARGET,
    data: DATA,
    value: 5n,
    review: { title: 'Review exact call', label: 'Set project state' },
    ...overrides,
  }
}

describe('runGuardedTx', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useTransactionStore.setState({ transactions: [] })
    localStorage.clear()
    mocks.review.mockResolvedValue(undefined)
    mocks.simulate.mockResolvedValue(undefined)
    mocks.estimateGas.mockResolvedValue(200_000n)
    mocks.waitForReceipt.mockResolvedValue(undefined)
    mocks.getChainId.mockResolvedValue(CHAIN_ID)
    mocks.switchChain.mockResolvedValue(undefined)
    mocks.sendTransaction.mockResolvedValue(MAIN_HASH)
    mocks.readContract.mockResolvedValue(0n)
  })

  it('refuses a mainnet chain in testnet mode before anything else runs', async () => {
    // The vitest setup runs the app in testnet mode; chain 1 is mainnet.
    await expect(runGuardedTx(walletContext(), request({ chainId: 1 }))).rejects.toThrow(
      /mainnet chain \(1\).*testnet mode/,
    )

    expect(mocks.review).not.toHaveBeenCalled()
    expect(mocks.simulate).not.toHaveBeenCalled()
    expect(mocks.sendTransaction).not.toHaveBeenCalled()
    expect(useTransactionStore.getState().transactions).toEqual([])
  })

  it('fails closed when exact-call review is cancelled and sends nothing', async () => {
    mocks.review.mockRejectedValue(new Error('Transaction review cancelled. Nothing was sent.'))
    const reverify = vi.fn()

    await expect(runGuardedTx(walletContext(), request({ reverify }))).rejects.toThrow('review cancelled')

    expect(mocks.review).toHaveBeenCalledOnce()
    expect(reverify).not.toHaveBeenCalled()
    expect(mocks.switchChain).not.toHaveBeenCalled()
    expect(mocks.simulate).not.toHaveBeenCalled()
    expect(mocks.sendTransaction).not.toHaveBeenCalled()
    expect(useTransactionStore.getState().transactions).toEqual([])
  })

  it('reviews, re-verifies, simulates, and sends the exact direct-wallet payload', async () => {
    const reverify = vi.fn().mockResolvedValue(undefined)
    const onSubmitted = vi.fn()

    await expect(runGuardedTx(walletContext(), request({ reverify, onSubmitted }))).resolves.toBe(MAIN_HASH)

    const review = mocks.review.mock.calls[0][0]
    expect(review.kind).toBe('transaction')
    expect(review.calls).toHaveLength(1)
    expect(review.calls[0]).toMatchObject({
      chainId: CHAIN_ID,
      from: ACCOUNT,
      to: TARGET,
      value: 5n,
      data: DATA,
      label: 'Set project state',
    })
    expect(reverify).toHaveBeenCalledTimes(2)
    expect(mocks.simulate).toHaveBeenCalledWith({
      chainId: CHAIN_ID,
      account: ACCOUNT,
      to: TARGET,
      data: DATA,
      value: 5n,
    })
    expect(mocks.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({
      account: expect.objectContaining({ address: ACCOUNT }),
      to: TARGET,
      data: DATA,
      value: 5n,
      gas: 200_000n,
    }))
    expect(onSubmitted).toHaveBeenCalledWith(MAIN_HASH)

    const [activity] = useTransactionStore.getState().transactions
    expect(activity).toMatchObject({
      account: ACCOUNT,
      hash: MAIN_HASH,
      status: 'confirmed',
      callKey: `${ACCOUNT.toLowerCase()}:${CHAIN_ID}:${TARGET.toLowerCase()}:5:${DATA.toLowerCase()}`,
    })
  })

  it('blocks a duplicate exact payload before simulation or wallet submission', async () => {
    const callKey = `${ACCOUNT.toLowerCase()}:${CHAIN_ID}:${TARGET.toLowerCase()}:5:${DATA.toLowerCase()}`
    useTransactionStore.getState().addTransaction({
      type: 'contractCall',
      chainId: CHAIN_ID,
      account: ACCOUNT,
      callKey,
      status: 'submitted',
    })

    await expect(runGuardedTx(walletContext(), request())).rejects.toThrow('already pending')

    expect(mocks.review).toHaveBeenCalledOnce()
    expect(mocks.simulate).not.toHaveBeenCalled()
    expect(mocks.sendTransaction).not.toHaveBeenCalled()
    expect(useTransactionStore.getState().transactions).toHaveLength(1)
  })

  it('reviews and sends an exact finite approval before the main call', async () => {
    const amount = 123_456n
    const approveData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [SPENDER, amount],
    })
    mocks.readContract.mockResolvedValueOnce(0n).mockResolvedValueOnce(amount)
    mocks.sendTransaction.mockResolvedValueOnce(APPROVAL_HASH).mockResolvedValueOnce(MAIN_HASH)

    await expect(runGuardedTx(walletContext(), request({
      approval: { token: TOKEN, spender: SPENDER, amount },
    }))).resolves.toBe(MAIN_HASH)

    const review = mocks.review.mock.calls[0][0]
    expect(review.calls).toHaveLength(2)
    expect(review.calls[0]).toMatchObject({
      from: ACCOUNT,
      to: TOKEN,
      value: 0n,
      data: approveData,
      functionName: 'approve',
      args: [SPENDER, amount],
    })
    expect(review.calls[1]).toMatchObject({ to: TARGET, value: 5n, data: DATA })
    expect(mocks.sendTransaction).toHaveBeenNthCalledWith(1, expect.objectContaining({
      to: TOKEN,
      data: approveData,
      value: 0n,
    }))
    expect(mocks.sendTransaction).toHaveBeenNthCalledWith(2, expect.objectContaining({
      to: TARGET,
      data: DATA,
      value: 5n,
    }))
    expect(mocks.waitForReceipt).toHaveBeenNthCalledWith(1, CHAIN_ID, APPROVAL_HASH)
    expect(mocks.waitForReceipt).toHaveBeenNthCalledWith(2, CHAIN_ID, MAIN_HASH)
    expect(useTransactionStore.getState().transactions.map(tx => tx.status)).toEqual(['confirmed', 'confirmed'])
  })

  it('persists a submitted hash when confirmation is temporarily unavailable', async () => {
    mocks.waitForReceipt.mockRejectedValue(new Error('RPC unavailable'))

    await expect(runGuardedTx(walletContext(), request())).rejects.toThrow('RPC unavailable')

    const [activity] = useTransactionStore.getState().transactions
    expect(activity).toMatchObject({ hash: MAIN_HASH, status: 'submitted', stage: 'confirming' })
    expect(activity.error).toContain('do not submit it again')
    expect(localStorage.getItem('juice-transactions')).toContain(MAIN_HASH)
  })
})
