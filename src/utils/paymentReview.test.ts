import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PAYMENT_REVIEW_EVENT,
  requestPaymentReview,
  type PaymentReview,
  type PaymentReviewRequest,
} from './paymentReview'
import { useViewAsStore } from '../stores/viewAsStore'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as const

function buildReview(): PaymentReview {
  return {
    txId: 'tx-1',
    account: ACCOUNT,
    chainId: 1,
    chainName: 'Ethereum',
    projectId: '3',
    terminal: ACCOUNT,
    route: 'direct terminal payment',
    tokenSymbol: 'ETH',
    tokenAddress: ACCOUNT,
    amount: '1',
    amountRaw: '1000000000000000000',
    valueRaw: '1000000000000000000',
    beneficiary: ACCOUNT,
    memo: '',
    rulesetId: '1',
    expectedProjectTokens: '0',
    minimumProjectTokens: '0',
    metadata: '0x',
    callData: '0x',
    approval: null,
    nfts: [],
  }
}

afterEach(() => {
  useViewAsStore.setState({ viewAs: null })
})

describe('payment review boundary', () => {
  it('dispatches the review event and resolves with the responder verdict', async () => {
    const listener = (event: Event) => {
      const { respond } = (event as CustomEvent<PaymentReviewRequest>).detail
      respond(true)
    }
    window.addEventListener(PAYMENT_REVIEW_EVENT, listener)
    try {
      await expect(requestPaymentReview(buildReview())).resolves.toBe(true)
    } finally {
      window.removeEventListener(PAYMENT_REVIEW_EVENT, listener)
    }
  })

  it('refuses payments while view-as mode is active, before any review event fires', async () => {
    const listener = vi.fn()
    window.addEventListener(PAYMENT_REVIEW_EVENT, listener)
    try {
      useViewAsStore.setState({ viewAs: ACCOUNT })
      await expect(requestPaymentReview(buildReview())).rejects.toThrow(
        "You're viewing the site as another account — exit View as to transact."
      )
      expect(listener).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(PAYMENT_REVIEW_EVENT, listener)
    }
  })
})
