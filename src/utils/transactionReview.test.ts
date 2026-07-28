import { afterEach, describe, expect, it } from 'vitest'
import { encodeFunctionData, type Abi } from 'viem'
import { useViewAsStore } from '../stores/viewAsStore'
import {
  registerTransactionReviewHandler,
  requestTransactionReview,
  requireContractTransactionReview,
  requireTransactionReview,
  transactionReviewJson,
  type TransactionReview,
} from './transactionReview'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as const
const TARGET = '0x2222222222222222222222222222222222222222' as const
const DATA = '0x12345678' as const

const SET_VALUE_ABI = [{
  type: 'function',
  name: 'setValue',
  stateMutability: 'nonpayable',
  inputs: [{ name: 'value', type: 'uint256' }],
  outputs: [],
}] as const

const SET_CONFIG_ABI = [{
  type: 'function',
  name: 'setConfig',
  stateMutability: 'nonpayable',
  inputs: [{
    name: 'config',
    type: 'tuple',
    components: [{ name: 'amount', type: 'uint256' }],
  }],
  outputs: [],
}] as const

let unregister: (() => void) | undefined

function handle(handler: Parameters<typeof registerTransactionReviewHandler>[0]) {
  unregister?.()
  unregister = registerTransactionReviewHandler(handler)
}

afterEach(() => {
  unregister?.()
  unregister = undefined
  useViewAsStore.setState({ viewAs: null })
})

describe('transaction review boundary', () => {
  it('rejects an empty transaction before any approval can be requested', async () => {
    handle(async () => true)
    await expect(requestTransactionReview({ calls: [] })).rejects.toThrow(/no transaction to review/i)
  })

  it('requires explicit approval and preserves the exact reviewed payload', async () => {
    const args: unknown[] = [7n]
    let observed: TransactionReview | undefined
    handle(async review => {
      observed = review
      return false
    })

    await expect(requestTransactionReview({
      title: 'Exact call',
      calls: [{
        chainId: 8453,
        from: ACCOUNT,
        to: TARGET,
        data: DATA,
        value: 42n,
        args,
      }],
    })).resolves.toBe(false)

    args[0] = 99n
    expect(observed).toMatchObject({
      title: 'Exact call',
      calls: [{
        chainId: 8453,
        from: ACCOUNT,
        to: TARGET,
        data: DATA,
        value: 42n,
        args: [7n],
      }],
    })
    expect(observed?.calls[0].args).not.toBe(args)
  })

  it('refuses every reviewed write while view-as mode is active, before the handler runs', async () => {
    let handlerRan = false
    handle(async () => {
      handlerRan = true
      return true
    })
    useViewAsStore.setState({ viewAs: ACCOUNT })

    await expect(requestTransactionReview({
      calls: [{ chainId: 1, from: ACCOUNT, to: TARGET, data: DATA }],
    })).rejects.toThrow("You're viewing the site as another account — exit View as to transact.")
    expect(handlerRan).toBe(false)
  })

  it('fails closed when the reviewer cancels', async () => {
    handle(async () => false)
    await expect(requireTransactionReview({
      calls: [{ chainId: 1, from: ACCOUNT, to: TARGET, data: DATA }],
    })).rejects.toThrow('Transaction review cancelled. Nothing was sent.')
  })

  it('constructs and serializes the exact contract call approved by the user', async () => {
    let observed: TransactionReview | undefined
    handle(async review => {
      observed = review
      return true
    })

    await requireContractTransactionReview({
      chainId: 10,
      account: ACCOUNT,
      address: TARGET,
      abi: SET_VALUE_ABI,
      functionName: 'setValue',
      args: [123n],
      value: 5n,
    })

    const data = encodeFunctionData({
      abi: SET_VALUE_ABI,
      functionName: 'setValue',
      args: [123n],
    })
    expect(observed?.calls[0]).toMatchObject({
      chainId: 10,
      from: ACCOUNT,
      to: TARGET,
      data,
      value: 5n,
      functionName: 'setValue',
      args: [123n],
    })
    expect(JSON.parse(transactionReviewJson(observed!))).toEqual({
      chainId: 10,
      from: ACCOUNT,
      to: TARGET,
      value: '0x5',
      data,
    })
  })

  it('detects nested argument mutation during review', async () => {
    const config = { amount: 1n }
    handle(async review => {
      const reviewedConfig = review.calls[0].args?.[0] as { amount: bigint }
      reviewedConfig.amount = 2n
      return true
    })

    await expect(requireContractTransactionReview({
      chainId: 1,
      account: ACCOUNT,
      address: TARGET,
      abi: SET_CONFIG_ABI as Abi,
      functionName: 'setConfig',
      args: [config],
    })).rejects.toThrow(/data changed after review/i)
  })
})
