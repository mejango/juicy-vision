import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FundAccessAmountSnapshot, FundAccessContextSnapshot } from '../../services/fundAccess'
import { MAX_UINT224, PRICE_FIDELITY } from '../../services/fundAccess'
import SendPayoutsForm from './SendPayoutsForm'
import UseSurplusAllowanceForm from './UseSurplusAllowanceForm'

const mocks = vi.hoisted(() => ({
  readContexts: vi.fn(),
  fetchProject: vi.fn(),
  fetchProjectSplits: vi.fn(),
  resolveProjectChains: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({
    address: '0x1234567890123456789012345678901234567890',
    isConnected: true,
  }),
}))

vi.mock('../../hooks', () => ({
  useManagedWallet: () => ({ address: null, isManagedMode: false }),
}))

vi.mock('../../services/fundAccess', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/fundAccess')>(),
  createFundAccessClient: () => ({}),
  readFundAccessContexts: mocks.readContexts,
}))

vi.mock('../../services/bendystraw', () => ({
  fetchProject: mocks.fetchProject,
  fetchProjectSplits: mocks.fetchProjectSplits,
}))

vi.mock('../../utils/projectChains', () => ({
  resolveProjectChains: mocks.resolveProjectChains,
}))

vi.mock('../../utils/ens', () => ({
  resolveEnsName: vi.fn().mockResolvedValue(null),
  truncateAddress: (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`,
}))

vi.mock('../payment', () => ({
  SendPayoutsModal: ({ isOpen, onConfirmed }: { isOpen: boolean; onConfirmed: (hash: string) => void }) => isOpen
    ? <button data-testid="payout-modal" onClick={() => onConfirmed('0xabc')}>Confirm payout</button>
    : null,
  UseSurplusAllowanceModal: ({ isOpen, onConfirmed }: { isOpen: boolean; onConfirmed: (hash: string) => void }) => isOpen
    ? <button data-testid="allowance-modal" onClick={() => onConfirmed('0xdef')}>Confirm allowance</button>
    : null,
}))

const TOKEN = '0x000000000000000000000000000000000000eeee' as const
const TERMINAL = '0x130f5dd2bd8805443cf41755253d778a75a67f53' as const

function snapshot(overrides: Partial<FundAccessAmountSnapshot> = {}): FundAccessAmountSnapshot {
  return {
    configured: 10n * 10n ** 18n,
    used: 0n,
    remaining: 10n * 10n ** 18n,
    currency: 2n,
    pricePerUnit: 1_817_530_000_000_000_000_000n,
    sourceInCurrency: 45_438_250_000_000_000n,
    available: 45_438_250_000_000_000n,
    unlimited: false,
    ...overrides,
  }
}

function context(overrides: Partial<FundAccessContextSnapshot> = {}): FundAccessContextSnapshot {
  return {
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
    balance: 25_000_000_000_000n,
    currentSurplus: 20_000_000_000_000n,
    payoutLimits: [snapshot()],
    surplusAllowances: [],
    ...overrides,
  }
}

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { queryClient, ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>) }
}

describe('live fund access forms', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.fetchProject.mockResolvedValue({ id: '1', name: 'Test Project', logoUri: '' })
    mocks.fetchProjectSplits.mockResolvedValue({ configurationComplete: true, splitGroups: [] })
    mocks.resolveProjectChains.mockResolvedValue({
      mappingAvailable: true,
      chains: [{ chainId: 1, projectId: 1 }],
    })
    mocks.readContexts.mockResolvedValue([context()])
  })

  afterEach(() => vi.restoreAllMocks())

  it('caps payout Max at the live balance converted into the exact USD limit currency', async () => {
    const user = userEvent.setup()
    renderWithQuery(<SendPayoutsForm projectId="1" />)

    expect(await screen.findByText('Test Project')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Payout currency' })).not.toBeInTheDocument()
    expect(screen.getByText('10 USD')).toBeInTheDocument()
    expect(screen.getByText('0.000025 ETH')).toBeInTheDocument()
    expect(screen.getByText('0.04543825 USD')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Max' }))
    expect(screen.getByRole('textbox', { name: 'Payout amount' })).toHaveValue('0.04543825')
  })

  it('shows a currency selector only when multiple exact configured IDs exist', async () => {
    mocks.readContexts.mockResolvedValue([context({
      payoutLimits: [
        snapshot(),
        snapshot({
          configured: 1n,
          remaining: 1n,
          currency: 61_166n,
          pricePerUnit: PRICE_FIDELITY,
          sourceInCurrency: 25_000_000_000_000n,
          available: 1n,
        }),
      ],
    })])

    renderWithQuery(<SendPayoutsForm projectId="1" />)
    const selector = await screen.findByRole('combobox', { name: 'Payout currency' })
    expect(selector).toHaveValue('2')
    expect(screen.getByRole('option', { name: 'USD (2)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'ETH (61166)' })).toBeInTheDocument()
  })

  it('clears successful payout state, closes the review, invalidates, and reloads live data', async () => {
    const user = userEvent.setup()
    const invalidated = vi.fn()
    window.addEventListener('juice:project-data-invalidated', invalidated)
    renderWithQuery(<SendPayoutsForm projectId="1" />)

    await screen.findByText('Test Project')
    await user.click(screen.getByRole('button', { name: 'Max' }))
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(await screen.findByTestId('payout-modal'))

    await waitFor(() => expect(screen.queryByTestId('payout-modal')).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Payout amount' })).toHaveValue('')
    expect(await screen.findByText('Payouts confirmed. Live balances have been refreshed.')).toBeInTheDocument()
    await waitFor(() => expect(mocks.readContexts).toHaveBeenCalledTimes(2))
    expect(invalidated).toHaveBeenCalledTimes(1)
    window.removeEventListener('juice:project-data-invalidated', invalidated)
  })

  it('renders an unlimited allowance safely and resets after confirmation', async () => {
    const user = userEvent.setup()
    const unlimited = snapshot({
      configured: MAX_UINT224,
      remaining: MAX_UINT224,
      currency: 61_166n,
      pricePerUnit: PRICE_FIDELITY,
      sourceInCurrency: 20_000_000_000_000n,
      available: 20_000_000_000_000n,
      unlimited: true,
    })
    mocks.readContexts.mockResolvedValue([context({ payoutLimits: [], surplusAllowances: [unlimited] })])
    renderWithQuery(<UseSurplusAllowanceForm projectId="1" />)

    expect(await screen.findByText('Unlimited ETH')).toBeInTheDocument()
    expect(screen.queryByText(MAX_UINT224.toString())).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Allowance currency' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Max' }))
    expect(screen.getByRole('textbox', { name: 'Surplus allowance amount' })).toHaveValue('0.00002')
    await user.click(screen.getByRole('button', { name: 'Review' }))
    fireEvent.click(await screen.findByTestId('allowance-modal'))

    await waitFor(() => expect(screen.queryByTestId('allowance-modal')).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: 'Surplus allowance amount' })).toHaveValue('')
    expect(await screen.findByText('Withdrawal confirmed. Live surplus has been refreshed.')).toBeInTheDocument()
    await waitFor(() => expect(mocks.readContexts).toHaveBeenCalledTimes(2))
  })
})
