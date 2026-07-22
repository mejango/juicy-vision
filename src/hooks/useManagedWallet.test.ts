import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../stores'

const mocks = vi.hoisted(() => ({ review: vi.fn() }))
vi.mock('../utils/transactionReview', () => ({
  requireTransactionReview: mocks.review,
}))

import { createManagedRelayrBundle } from './useManagedWallet'

const ACCOUNT = '0x1111111111111111111111111111111111111111'
const TARGET = '0x2222222222222222222222222222222222222222'

function authenticate(token = 'managed-token') {
  useAuthStore.setState({
    mode: 'managed',
    token,
    user: {
      id: 'user-1',
      email: 'user@example.com',
      privacyMode: 'private',
      hasCustodialWallet: true,
      passkeyEnabled: true,
      isAdmin: false,
    },
  })
}

describe('createManagedRelayrBundle', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.review.mockReset()
    mocks.review.mockResolvedValue(undefined)
    authenticate()
  })

  it('reviews exact calls before posting the bound managed operation', async () => {
    const order: string[] = []
    mocks.review.mockImplementation(async () => { order.push('review') })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      order.push('submit')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer managed-token' })
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ owner: ACCOUNT, smartAccountAddress: ACCOUNT })
      expect(body.transactions).toEqual([
        { chainId: 1, target: TARGET, data: '0x12345678', value: '7' },
      ])
      expect(body.operationKey).toMatch(/^0x[0-9a-f]{64}$/)
      return new Response(JSON.stringify({ success: true, data: { bundleId: 'bundle-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    await expect(createManagedRelayrBundle(
      [{ chainId: 1, target: TARGET, data: '0x12345678', value: '7' }],
      ACCOUNT,
      ACCOUNT,
      'reviewed-operation-1',
    )).resolves.toEqual({ bundleId: 'bundle-1' })

    expect(order).toEqual(['review', 'submit'])
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'authorization',
      calls: [expect.objectContaining({ from: ACCOUNT, to: TARGET, value: 7n })],
    }))
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('fails closed when review is cancelled or the session changes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    mocks.review.mockRejectedValueOnce(new Error('Transaction review cancelled'))
    await expect(createManagedRelayrBundle(
      [{ chainId: 1, target: TARGET, data: '0x1234', value: '0' }],
      ACCOUNT,
      ACCOUNT,
    )).rejects.toThrow('review cancelled')
    expect(fetchMock).not.toHaveBeenCalled()

    mocks.review.mockImplementationOnce(async () => authenticate('replacement-token'))
    await expect(createManagedRelayrBundle(
      [{ chainId: 1, target: TARGET, data: '0x1234', value: '0' }],
      ACCOUNT,
      ACCOUNT,
    )).rejects.toThrow('session changed')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
