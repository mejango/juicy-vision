/**
 * Activity rows: the project name is a REAL link to the project page while the
 * row itself keeps the ask-the-chat behavior (the link stops propagation).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { chainMarks } from '../../test/test-utils'
import { MemoryRouter } from 'react-router-dom'
import ActivityItem from './ActivityItem'
import type { ActivityEvent } from '../../services/bendystraw/client'

vi.mock('../../utils/ens', () => ({
  resolveEnsName: vi.fn(async () => null),
  truncateAddress: (address: string) => address.slice(0, 8),
}))

const EVENT = {
  id: 'evt-1',
  chainId: 1,
  timestamp: Math.floor(Date.now() / 1000) - 60,
  project: { projectId: 3, name: 'JuiceboxDAO' },
  payEvent: {
    amount: '1000000000000000000',
    beneficiary: '0x1111111111111111111111111111111111111111',
    txHash: '0xabc',
  },
} as unknown as ActivityEvent

describe('ActivityItem project link', () => {
  it('links the project name to the project page and keeps the row chat click', () => {
    const onProjectClick = vi.fn()
    render(
      <MemoryRouter>
        <ActivityItem event={EVENT} onProjectClick={onProjectClick} />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: /JuiceboxDAO/ })
    expect(link).toHaveAttribute('href', '/eth:3')

    // Clicking the link must NOT trigger the row's chat behavior.
    fireEvent.click(link)
    expect(onProjectClick).not.toHaveBeenCalled()

    // Clicking elsewhere in the row still queues the chat prompt.
    fireEvent.click(screen.getByText(/JuiceboxDAO/).closest('div')!.parentElement!)
    expect(onProjectClick).toHaveBeenCalledOnce()
  })

  it('shows the chain mark inside the tinted chain badge', () => {
    const payEvent = {
      ...EVENT,
      type: 'pay',
      amount: '1000000000000000000',
      txHash: '0xabc',
      from: '0x1111111111111111111111111111111111111111',
    } as unknown as ActivityEvent

    render(
      <MemoryRouter>
        <ActivityItem event={payEvent} />
      </MemoryRouter>,
    )

    const badge = screen.getByText('ETH')
    expect(badge).toHaveAttribute('style', expect.stringContaining('background-color'))
    expect(chainMarks(badge)).toHaveLength(1)
  })
})
