import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ViewAsWalletState from './ViewAsWalletState'
import ViewAsMenuAction from './ViewAsMenuAction'
import { useViewAsStore } from '../../stores/viewAsStore'

const VIEWED = '0x1111111111111111111111111111111111111111'

const { ensState } = vi.hoisted(() => ({
  ensState: { name: null as string | null },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback || _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('../../stores', () => ({
  useThemeStore: () => ({ theme: 'dark' }),
}))

vi.mock('../../hooks/useEnsName', () => ({
  useEnsNameResolved: () => ({ ensName: ensState.name, loading: false }),
}))

vi.mock('../../utils/ens', () => ({
  truncateAddress: (address: string) =>
    address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '',
  resolveEnsToAddress: vi.fn(),
}))

describe('ViewAsWalletState', () => {
  beforeEach(() => {
    ensState.name = null
    useViewAsStore.setState({ viewAs: null })
  })

  it('renders nothing while view-as mode is off', () => {
    render(<ViewAsWalletState hasConnectedWallet />)
    expect(screen.queryByTestId('view-as-wallet-state')).not.toBeInTheDocument()
  })

  it('shows the truncated viewed address while active', () => {
    useViewAsStore.setState({ viewAs: VIEWED })
    render(<ViewAsWalletState hasConnectedWallet />)
    expect(screen.getByTestId('view-as-wallet-state')).toHaveTextContent('Viewing as 0x1111...1111')
  })

  it('prefers the resolved ENS name', () => {
    ensState.name = 'jango.eth'
    useViewAsStore.setState({ viewAs: VIEWED })
    render(<ViewAsWalletState hasConnectedWallet />)
    expect(screen.getByTestId('view-as-wallet-state')).toHaveTextContent('Viewing as jango.eth')
  })

  it('returns to the connected wallet through the viewed-identity menu', () => {
    useViewAsStore.setState({ viewAs: VIEWED })
    render(<ViewAsWalletState hasConnectedWallet />)
    fireEvent.click(screen.getByRole('button', { name: /Viewing as/ }))
    const items = screen.getAllByRole('menuitem')
    expect(items[items.length - 1]).toHaveAccessibleName('View as another account…')
    fireEvent.click(screen.getByRole('menuitem', { name: 'View as connected wallet' }))
    expect(useViewAsStore.getState().viewAs).toBeNull()
    expect(screen.queryByTestId('view-as-wallet-state')).not.toBeInTheDocument()
  })

  it('offers Exit View as when there is no connected wallet', () => {
    useViewAsStore.setState({ viewAs: VIEWED })
    render(<ViewAsWalletState hasConnectedWallet={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Viewing as/ }))
    expect(screen.getByRole('menuitem', { name: 'Exit View as' })).toBeInTheDocument()
  })
})

describe('ViewAsMenuAction', () => {
  beforeEach(() => {
    useViewAsStore.setState({ viewAs: null })
  })

  it('activates view-as from a final wallet-menu action', () => {
    render(<ViewAsMenuAction />)

    fireEvent.click(screen.getByRole('button', { name: 'View as…' }))
    fireEvent.change(screen.getByPlaceholderText('Address or ENS…'), {
      target: { value: VIEWED },
    })
    fireEvent.click(screen.getByRole('button', { name: 'View' }))

    expect(useViewAsStore.getState().viewAs).toBe(VIEWED)
  })
})
