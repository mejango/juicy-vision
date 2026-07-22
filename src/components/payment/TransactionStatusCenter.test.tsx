import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TransactionStatusCenter from './TransactionStatusCenter'
import { useTransactionStore } from '../../stores/transactionStore'

const ACCOUNT = '0x1111111111111111111111111111111111111111' as const
const HASH = `0x${'aa'.repeat(32)}` as const
const SAFE_HASH = `0x${'bb'.repeat(32)}` as const

const mocks = vi.hoisted(() => ({
  receipt: vi.fn(),
  safeHash: vi.fn(),
  bundle: vi.fn(),
  managedBundle: vi.fn(),
}))

vi.mock('viem', async importOriginal => ({
  ...(await importOriginal<typeof import('viem')>()),
  createPublicClient: () => ({ getTransactionReceipt: mocks.receipt }),
  http: vi.fn(),
}))

vi.mock('../../services/safeApp', () => ({
  txHashForSafeTx: mocks.safeHash,
}))

vi.mock('../../services/relayr', () => ({
  getBundleStatus: mocks.bundle,
  transformBundleResponse: (value: unknown) => value,
}))

vi.mock('../../hooks/useManagedWallet', () => ({
  getManagedBundleStatus: mocks.managedBundle,
  useIsManagedMode: () => false,
}))

vi.mock('../../hooks/useSafeApp', () => ({
  useSafeApp: () => ({ safeInfo: null, isSafeApp: false, detecting: false }),
}))

describe('TransactionStatusCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTransactionStore.setState({ transactions: [] })
    localStorage.clear()
    mocks.receipt.mockRejectedValue(new Error('not mined'))
  })

  it('automatically exposes persisted direct and Safe work without conflating proposal and mined hashes', async () => {
    useTransactionStore.getState().addTransaction({
      type: 'contractCall',
      chainId: 1,
      account: ACCOUNT,
      label: 'Submitted action',
      hash: HASH,
      status: 'submitted',
    })
    useTransactionStore.getState().addTransaction({
      type: 'contractCall',
      chainId: 1,
      account: ACCOUNT,
      label: 'Safe action',
      safeTxHash: SAFE_HASH,
      status: 'safe-proposed',
    })

    render(<TransactionStatusCenter />)

    await waitFor(() => expect(screen.getByRole('button', { name: /Transactions · 2 active/ })).toHaveAttribute('aria-expanded', 'true'))
    expect(screen.getByText('Submitted')).toBeVisible()
    expect(screen.getByText('Awaiting Safe execution')).toBeVisible()
    expect(screen.getByText(/Safe proposal/)).toHaveAttribute('href', expect.stringContaining(ACCOUNT))
    expect(screen.getByRole('link', { name: /0xaaaaaaaa/ })).toHaveAttribute('href', expect.stringContaining(HASH))
    expect(mocks.safeHash).not.toHaveBeenCalled()
  })
})
