import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import TransactionReviewModal from './TransactionReviewModal'
import { requestTransactionReview, type TransactionReview } from '../../utils/transactionReview'
import { chainMarks } from '../../test/test-utils'

const FROM = '0x1111111111111111111111111111111111111111' as const
const TARGET = '0x2222222222222222222222222222222222222222' as const

function review(title: string, confirmLabel: string): TransactionReview {
  return {
    title,
    confirmLabel,
    calls: [{
      chainId: 1,
      from: FROM,
      to: TARGET,
      value: 123n,
      data: '0x12345678',
      label: `${title} payload`,
    }],
  }
}

describe('TransactionReviewModal', () => {
  it('requires explicit approval, serializes the exact payload, and resets consent for queued reviews', async () => {
    const user = userEvent.setup()
    render(<TransactionReviewModal />)
    let first!: Promise<boolean>
    let second!: Promise<boolean>

    await act(async () => {
      first = requestTransactionReview(review('First review', 'Approve first'))
      second = requestTransactionReview(review('Second review', 'Approve second'))
      await Promise.resolve()
    })

    expect(await screen.findByRole('heading', { name: 'First review' })).toBeVisible()
    const firstApprove = screen.getByRole('button', { name: 'Approve first' })
    expect(firstApprove).toBeDisabled()
    expect(screen.getAllByText(FROM).length).toBeGreaterThan(0)
    expect(screen.getAllByText(TARGET).length).toBeGreaterThan(0)
    expect(screen.getByText(/"value": "0x7b"/)).toBeInTheDocument()
    expect(screen.getByText(/"data": "0x12345678"/)).toBeInTheDocument()
    // The chain the call lands on carries its brand mark beside the name.
    expect(chainMarks().length).toBeGreaterThan(0)

    await user.click(screen.getByRole('checkbox', { name: /I reviewed the chain/ }))
    expect(firstApprove).toBeEnabled()
    await user.click(firstApprove)
    await expect(first).resolves.toBe(true)

    expect(await screen.findByRole('heading', { name: 'Second review' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Approve second' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }))
    await expect(second).resolves.toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('rejects both the active and queued review if the safety surface unmounts', async () => {
    const { unmount } = render(<TransactionReviewModal />)
    let active!: Promise<boolean>
    let queued!: Promise<boolean>

    await act(async () => {
      active = requestTransactionReview(review('Active review', 'Approve'))
      queued = requestTransactionReview(review('Queued review', 'Approve'))
      await Promise.resolve()
    })
    expect(await screen.findByRole('heading', { name: 'Active review' })).toBeVisible()

    unmount()

    await expect(active).resolves.toBe(false)
    await expect(queued).resolves.toBe(false)
    expect(document.body.style.overflow).toBe('')
  })
})
