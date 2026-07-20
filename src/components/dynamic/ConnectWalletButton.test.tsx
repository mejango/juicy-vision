import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConnectWalletButton from './ConnectWalletButton'

const { mockUseAccount, mockUseWalletBalances, mockUseManagedWallet } = vi.hoisted(() => ({
  mockUseAccount: vi.fn(),
  mockUseWalletBalances: vi.fn(),
  mockUseManagedWallet: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: mockUseAccount,
}))

vi.mock('../../hooks', () => ({
  useWalletBalances: mockUseWalletBalances,
  useManagedWallet: mockUseManagedWallet,
}))

const MANAGED_ADDRESS = '0x1111111111111111111111111111111111111111'

function balances(overrides: Partial<ReturnType<typeof baseBalances>> = {}) {
  return { ...baseBalances(), ...overrides }
}

function baseBalances() {
  return {
    totalEth: 0n,
    totalUsdc: 0n,
    perChain: [],
    loading: false,
    available: true,
  }
}

describe('ConnectWalletButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAccount.mockReturnValue({ isConnected: false, address: undefined })
    mockUseManagedWallet.mockReturnValue({ address: null, isManagedMode: false })
    mockUseWalletBalances.mockReturnValue(balances({ available: false }))
  })

  it('shows connect state when disconnected and not managed', () => {
    render(<ConnectWalletButton />)
    expect(screen.getByText('Connect Account')).toBeInTheDocument()
  })

  it('never shows "Connect Account" for an authenticated managed account', () => {
    mockUseManagedWallet.mockReturnValue({ address: MANAGED_ADDRESS, isManagedMode: true })
    mockUseWalletBalances.mockReturnValue(balances({ totalUsdc: 5_000_000n }))

    render(<ConnectWalletButton />)

    expect(screen.queryByText('Connect Account')).not.toBeInTheDocument()
    expect(screen.getByText('$5')).toBeInTheDocument()
  })

  it('fetches balances for the managed address when there is no wagmi connection', () => {
    mockUseManagedWallet.mockReturnValue({ address: MANAGED_ADDRESS, isManagedMode: true })
    mockUseWalletBalances.mockReturnValue(balances())

    render(<ConnectWalletButton />)

    expect(mockUseWalletBalances).toHaveBeenCalledWith(MANAGED_ADDRESS)
  })

  it('shows "Account" while the managed address is still resolving', () => {
    mockUseManagedWallet.mockReturnValue({ address: null, isManagedMode: true })
    mockUseWalletBalances.mockReturnValue(balances({ available: false }))

    render(<ConnectWalletButton />)

    expect(screen.queryByText('Connect Account')).not.toBeInTheDocument()
    expect(screen.getByText('Account')).toBeInTheDocument()
  })

  it('shows fund prompt for a managed account with no balances', () => {
    mockUseManagedWallet.mockReturnValue({ address: MANAGED_ADDRESS, isManagedMode: true })
    mockUseWalletBalances.mockReturnValue(balances())

    render(<ConnectWalletButton />)

    expect(screen.getByText('Fund your account')).toBeInTheDocument()
  })

  it('prefers the wagmi connection over managed mode for balance lookups', () => {
    mockUseAccount.mockReturnValue({ isConnected: true, address: '0x2222222222222222222222222222222222222222' })
    mockUseManagedWallet.mockReturnValue({ address: MANAGED_ADDRESS, isManagedMode: true })
    mockUseWalletBalances.mockReturnValue(balances({ totalEth: 1_000_000_000_000_000_000n }))

    render(<ConnectWalletButton />)

    expect(mockUseWalletBalances).toHaveBeenCalledWith(undefined)
    expect(screen.getByText('1.0000 ETH')).toBeInTheDocument()
  })
})
