import type { Address, Hex } from 'viem'

export const PAYMENT_REVIEW_EVENT = 'juice:payment-review-request'

export interface PaymentReview {
  txId: string
  account: Address
  chainId: number
  chainName: string
  projectId: string
  terminal: Address
  route: 'direct terminal payment' | 'routed payment'
  tokenSymbol: 'ETH' | 'USDC'
  tokenAddress: Address
  amount: string
  amountRaw: string
  valueRaw: string
  beneficiary: Address
  memo: string
  rulesetId: string
  expectedProjectTokens: string
  minimumProjectTokens: string
  metadata: Hex
  callData: Hex
  approval: {
    token: Address
    spender: Address
    amount: string
    callData: Hex
  } | null
  nfts: Array<{ tierId: number; name: string; quantity: number }>
}

export interface PaymentReviewRequest {
  review: PaymentReview
  respond: (approved: boolean) => void
}

export function requestPaymentReview(review: PaymentReview): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const timeout = window.setTimeout(() => respond(false), 5 * 60 * 1000)
    const respond = (approved: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      resolve(approved)
    }
    window.dispatchEvent(new CustomEvent<PaymentReviewRequest>(PAYMENT_REVIEW_EVENT, {
      detail: { review, respond },
    }))
  })
}
