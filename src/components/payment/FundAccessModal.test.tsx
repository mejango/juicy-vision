import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FUND_ACCESS_TERMINAL_ABI,
  type FundAccessAmountSnapshot,
  type FundAccessContextSnapshot,
  type PreparedFundAccessTransaction,
} from '../../services/fundAccess'
import { parseTxLinkUrl } from '../../utils/txlink'
import FundAccessModal from './FundAccessModal'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  fetchSplits: vi.fn(),
  sendTransaction: vi.fn(),
  getChainId: vi.fn(),
  switchChain: vi.fn(),
  simulate: vi.fn(),
  waitForReceipt: vi.fn(),
  addTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  assertCurrentAccount: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x1234567890123456789012345678901234567890' }),
  useWalletClient: () => ({
    data: {
      account: { address: '0x1234567890123456789012345678901234567890' },
      getChainId: mocks.getChainId,
      sendTransaction: mocks.sendTransaction,
    },
  }),
  useSwitchChain: () => ({ switchChainAsync: mocks.switchChain }),
}))

vi.mock('../../stores', () => {
  const useTransactionStore = Object.assign(
    () => ({
      addTransaction: mocks.addTransaction,
      updateTransaction: mocks.updateTransaction,
    }),
    {
      getState: () => ({
        transactions: [],
        addTransaction: mocks.addTransaction,
        updateTransaction: mocks.updateTransaction,
      }),
    },
  )
  return {
    useThemeStore: () => ({ theme: 'dark' }),
    useTransactionStore,
    useAuthStore: () => ({ mode: 'self_custody', isAuthenticated: () => false }),
  }
})

vi.mock('../../hooks', () => ({
  executeManagedTransaction: vi.fn(),
  useManagedWallet: () => ({ address: null }),
  useWalletBalances: () => ({
    perChain: [{ chainId: 11155111, eth: 1n }],
    loading: false,
    available: true,
  }),
  formatEthBalance: (value: bigint) => value.toString(),
}))

vi.mock('../../hooks/useManagedWallet', () => ({
  useManagedWallet: () => ({ address: null, isManagedMode: false }),
  executeManagedTransaction: vi.fn(),
}))

vi.mock('../../hooks/useSafeApp', () => ({
  useSafeApp: () => ({ isSafeApp: false, safeInfo: null, detecting: false }),
}))

vi.mock('../../hooks/useReviewedTransactionAccount', () => ({
  useReviewedTransactionAccount: () => ({ assertCurrentAccount: mocks.assertCurrentAccount }),
}))

vi.mock('../../services/fundAccess', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/fundAccess')>(),
  createFundAccessClient: () => ({}),
  prepareFundAccessTransaction: mocks.prepare,
}))

vi.mock('../../services/bendystraw', () => ({
  fetchProjectSplits: mocks.fetchSplits,
}))

vi.mock('../../utils/transactionSafety', () => ({
  estimateTransactionGasWithHeadroom: vi.fn().mockResolvedValue(200_000n),
  simulateTransaction: mocks.simulate,
  waitForSuccessfulTransaction: mocks.waitForReceipt,
}))

const TOKEN = '0x000000000000000000000000000000000000eeee' as const
const TERMINAL = '0x130f5dd2bd8805443cf41755253d778a75a67f53' as const

const access: FundAccessAmountSnapshot = {
  configured: 2n * 10n ** 18n,
  used: 0n,
  remaining: 2n * 10n ** 18n,
  currency: 61_166n,
  pricePerUnit: 10n ** 18n,
  sourceInCurrency: 2n * 10n ** 18n,
  available: 2n * 10n ** 18n,
  unlimited: false,
}

const context: FundAccessContextSnapshot = {
  projectId: 1n,
  terminal: TERMINAL,
  store: '0x7497ae014a60561925b51c0a3b4ade7460b9927c',
  prices: '0xad45e4627f068d1e6b21e5301870d807543a8401',
  rulesets: '0x26f2228a4e8b0079ed1c2a3d22f12ff7f83cdfba',
  fundAccessLimits: '0xc93360158f187fc8fc8f1062a1b31d06f185dbab',
  token: TOKEN,
  tokenSymbol: 'ETH',
  decimals: 18,
  accountingCurrency: 61_166n,
  rulesetId: 7n,
  rulesetCycleNumber: 3n,
  balance: 2n * 10n ** 18n,
  currentSurplus: 1n * 10n ** 18n,
  payoutLimits: [access],
  surplusAllowances: [access],
}

function prepared(data: `0x${string}` = '0x1234'): PreparedFundAccessTransaction {
  return {
    target: TERMINAL,
    data,
    quotedAmount: 1n * 10n ** 18n,
    minimumOutput: 1n * 10n ** 18n,
    context,
    access,
    review: {
      abi: FUND_ACCESS_TERMINAL_ABI,
      functionName: 'sendPayoutsOf',
      args: [1n, TOKEN, 1n * 10n ** 18n, 61_166n, 1n * 10n ** 18n],
    },
  }
}

function renderPayout(overrides: Partial<ComponentProps<typeof FundAccessModal>> = {}) {
  const props: ComponentProps<typeof FundAccessModal> = {
    kind: 'payout',
    isOpen: true,
    onClose: vi.fn(),
    projectId: '1',
    projectName: 'Test Project',
    chainId: 11155111,
    amount: '1',
    context,
    access,
    splits: [],
    ...overrides,
  }
  render(<FundAccessModal {...props} />)
  return props
}

describe('FundAccessModal live transaction guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.prepare.mockResolvedValue(prepared())
    mocks.fetchSplits.mockResolvedValue({ configurationComplete: true, splitGroups: [] })
    mocks.getChainId.mockResolvedValue(11155111)
    mocks.switchChain.mockResolvedValue(undefined)
    mocks.sendTransaction.mockResolvedValue('0xbeef')
    mocks.waitForReceipt.mockResolvedValue(undefined)
    mocks.addTransaction.mockReturnValue('tx-1')
  })

  afterEach(() => vi.restoreAllMocks())

  it('re-reads after review and chain verification, then closes only after a confirmed receipt', async () => {
    let confirmReceipt: (() => void) | undefined
    mocks.waitForReceipt.mockImplementation(() => new Promise<void>(resolve => { confirmReceipt = resolve }))
    const onClose = vi.fn()
    const onConfirmed = vi.fn()
    const onSubmitted = vi.fn()
    renderPayout({ onClose, onConfirmed, onSubmitted })

    await userEvent.click(screen.getByRole('button', { name: 'Distribute' }))
    await waitFor(() => expect(mocks.sendTransaction).toHaveBeenCalledTimes(1))
    expect(mocks.prepare).toHaveBeenCalledTimes(3)
    expect(mocks.waitForReceipt).toHaveBeenCalledWith(11155111, '0xbeef')
    expect(onSubmitted).toHaveBeenCalledWith('0xbeef')
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()

    confirmReceipt?.()
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith('0xbeef'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mocks.updateTransaction).toHaveBeenCalledWith('tx-1', expect.objectContaining({ status: 'confirmed' }))
  })

  it('rejects when the live balance or price changes after the wallet chain switch', async () => {
    mocks.prepare
      .mockResolvedValueOnce(prepared('0x1234'))
      .mockResolvedValueOnce(prepared('0xabcd'))
    const onRefresh = vi.fn()
    renderPayout({ onRefresh })

    await userEvent.click(screen.getByRole('button', { name: 'Distribute' }))

    expect(await screen.findByText('The live balance, price, or quote changed. Review the updated amount and try again.')).toBeInTheDocument()
    expect(mocks.sendTransaction).not.toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('rejects when the terminal accounting currency changes after review', async () => {
    mocks.prepare.mockResolvedValue({
      ...prepared(),
      context: { ...context, accountingCurrency: 2n },
    })
    renderPayout()

    await userEvent.click(screen.getByRole('button', { name: 'Distribute' }))

    expect(await screen.findByText('The terminal accounting context changed. Close this review and load the latest configuration.')).toBeInTheDocument()
    expect(mocks.sendTransaction).not.toHaveBeenCalled()
  })

  it('copies a txlink URL reproducing the exact prepared transaction', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPayout()

    await userEvent.click(screen.getByRole('button', { name: 'Copy tx' }))
    await screen.findByRole('button', { name: 'Copied tx link' })

    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(mocks.sendTransaction).not.toHaveBeenCalled()
    expect(parseTxLinkUrl(writeText.mock.calls[0][0] as string)).toEqual({
      chainId: 11155111,
      to: TERMINAL,
      data: '0x1234',
      value: 0n,
    })
  })

  it('decodes the raw inadequate-store-balance selector into a stale-state message', async () => {
    mocks.prepare.mockRejectedValue({ data: '0x9fa59b9a' })
    renderPayout()

    await userEvent.click(screen.getByRole('button', { name: 'Distribute' }))

    expect(await screen.findByText('The terminal balance or price changed. Review the updated available amount and try again.')).toBeInTheDocument()
    expect(mocks.sendTransaction).not.toHaveBeenCalled()
  })
})
