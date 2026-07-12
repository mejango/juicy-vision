import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PaymentReviewModal from './PaymentReviewModal'
import { requestPaymentReview, type PaymentReview } from '../../utils/paymentReview'

vi.mock('../../stores', () => ({
  useThemeStore: () => ({ theme: 'light' }),
}))

vi.mock('../shared/TechnicalDetails', () => ({
  default: ({ contractAddress, functionName }: { contractAddress: string; functionName: string }) => (
    <div data-testid="technical-details">{contractAddress} · {functionName}</div>
  ),
}))

const review: PaymentReview = {
  txId: 'tx-1',
  account: '0x1234567890123456789012345678901234567890',
  chainId: 1,
  chainName: 'Ethereum',
  projectId: '7',
  terminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
  route: 'direct terminal payment',
  tokenSymbol: 'USDC',
  tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  amount: '12.5',
  amountRaw: '12500000',
  valueRaw: '0',
  beneficiary: '0x1234567890123456789012345678901234567890',
  memo: 'membership',
  rulesetId: '9',
  expectedProjectTokens: '0',
  minimumProjectTokens: '0',
  metadata: '0x1234',
  callData: '0xabcd',
  approval: {
    token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    spender: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
    amount: '12500000',
    callData: '0x5678',
  },
  nfts: [{ tierId: 3, name: 'Backstage Pass', quantity: 2 }],
}

describe('PaymentReviewModal', () => {
  it('shows the frozen route, approval, NFT quantities, and exact terminal call before continuing', async () => {
    render(<PaymentReviewModal />)
    let result!: Promise<boolean>
    await act(async () => {
      result = requestPaymentReview(review)
    })

    expect(screen.getByRole('dialog', { name: 'Review payment' })).toBeInTheDocument()
    expect(screen.getByText('12.5 USDC')).toBeInTheDocument()
    expect(screen.getByText('direct terminal payment')).toBeInTheDocument()
    expect(screen.getByText('Backstage Pass')).toBeInTheDocument()
    expect(screen.getByText('×2')).toBeInTheDocument()
    expect(screen.getByText(/approve\(0x130f5d/)).toBeInTheDocument()
    expect(screen.getByTestId('technical-details')).toHaveTextContent(`${review.terminal} · pay`)

    fireEvent.click(screen.getByRole('button', { name: 'Continue to wallet' }))
    await expect(result).resolves.toBe(true)
  })

  it('cancels without approving the request', async () => {
    render(<PaymentReviewModal />)
    let result!: Promise<boolean>
    await act(async () => {
      result = requestPaymentReview(review)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(result).resolves.toBe(false)
  })
})
