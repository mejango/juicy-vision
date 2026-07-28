import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ViewAsBanner from './ViewAsBanner'
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
}))

describe('ViewAsBanner', () => {
  beforeEach(() => {
    ensState.name = null
    useViewAsStore.setState({ viewAs: null })
  })

  it('renders nothing while view-as mode is off', () => {
    render(<ViewAsBanner />)
    expect(screen.queryByTestId('view-as-banner')).not.toBeInTheDocument()
  })

  it('shows the truncated viewed address while active', () => {
    useViewAsStore.setState({ viewAs: VIEWED })
    render(<ViewAsBanner />)
    expect(screen.getByTestId('view-as-banner')).toHaveTextContent('Viewing as 0x1111...1111')
  })

  it('prefers the resolved ENS name', () => {
    ensState.name = 'jango.eth'
    useViewAsStore.setState({ viewAs: VIEWED })
    render(<ViewAsBanner />)
    expect(screen.getByTestId('view-as-banner')).toHaveTextContent('Viewing as jango.eth')
  })

  it('Exit clears the mode and removes the banner', () => {
    useViewAsStore.setState({ viewAs: VIEWED })
    render(<ViewAsBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }))
    expect(useViewAsStore.getState().viewAs).toBeNull()
    expect(screen.queryByTestId('view-as-banner')).not.toBeInTheDocument()
  })
})
