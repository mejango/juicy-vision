import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TransactionHistory from './TransactionHistory'
import { chainMarks } from '../../test/test-utils'

const getSessionTransactions = vi.fn()
const getUserTransactions = vi.fn()
let authToken: string | null = null

vi.mock('../../api/transactions', () => ({
  getSessionTransactions: (...args: unknown[]) => getSessionTransactions(...args),
  getUserTransactions: (...args: unknown[]) => getUserTransactions(...args),
}))

vi.mock('../../services/session', () => ({
  getSessionId: () => 'ses_test123_abcdef123456',
}))

vi.mock('../../stores', () => ({
  useThemeStore: () => ({ theme: 'dark' }),
  useAuthStore: (selector: (state: { token: string | null }) => unknown) => selector({ token: authToken }),
  useTransactionStore: (selector: (state: { transactions: unknown[] }) => unknown) => selector({
    transactions: [{
      id: 'local-1',
      type: 'pay',
      chainId: 1,
      projectId: '7',
      amount: '0.1',
      status: 'confirmed',
      hash: `0x${'1'.repeat(64)}`,
      createdAt: 2_000,
    }],
  }),
}))

describe('TransactionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authToken = null
    getSessionTransactions.mockResolvedValue([])
    getUserTransactions.mockResolvedValue([])
  })

  it('loads only the current anonymous session history', async () => {
    render(<TransactionHistory />)

    await waitFor(() => expect(getSessionTransactions).toHaveBeenCalledWith(
      'ses_test123_abcdef123456',
      50,
    ))
    expect(getUserTransactions).not.toHaveBeenCalled()
    expect(screen.getByText('pay · Project #7')).toBeInTheDocument()
  })

  it('shows the chain brand mark beside the chain name on each row', async () => {
    render(<TransactionHistory />)

    await waitFor(() => {
      expect(chainMarks().length).toBeGreaterThan(0)
    })
  })

  it('uses authenticated user history and deduplicates an onchain hash', async () => {
    authToken = 'token'
    getUserTransactions.mockResolvedValue([{
      id: 'remote-1',
      userId: 'user-1',
      sessionId: null,
      txHash: `0x${'1'.repeat(64)}`,
      chainId: 1,
      fromAddress: `0x${'2'.repeat(40)}`,
      toAddress: `0x${'3'.repeat(40)}`,
      tokenAddress: null,
      amount: '0.1',
      projectId: '7',
      status: 'confirmed',
      errorMessage: null,
      createdAt: new Date(1_000).toISOString(),
      submittedAt: null,
      confirmedAt: null,
      receipt: null,
    }])

    render(<TransactionHistory />)

    await waitFor(() => expect(getUserTransactions).toHaveBeenCalledWith(50, 0))
    expect(getSessionTransactions).not.toHaveBeenCalled()
    expect(screen.getAllByText('pay · Project #7')).toHaveLength(1)
  })
})
