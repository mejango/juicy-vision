/**
 * Mobile discovery surface: below md there is no desktop sidebar, so the
 * mobile layout must expose its own entry point to the search / trending /
 * activity surface (the existing ActivitySidebar content as an overlay).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppContent } from './App'
import { useChatStore, useThemeStore } from './stores'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  Trans: ({ children }: { children: React.ReactNode }) => children,
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('./config/wagmi', () => ({
  wagmiConfig: {},
}))

vi.mock('./hooks', () => ({
  useIsMobile: () => true,
  useTransactionExecutor: vi.fn(),
  useManagedWallet: () => ({ address: null, isManagedMode: false }),
  useSafeApp: vi.fn(),
  useEnsNameResolved: () => ({ ensName: null }),
}))

vi.mock('./services/session', () => ({
  getSessionPseudoAddress: vi.fn(async () => null),
  getCachedPseudoAddress: () => null,
}))

vi.mock('./services/siwe', () => ({
  getWalletSession: () => null,
}))

vi.mock('./components/chat', () => ({
  ChatContainer: () => <div data-testid="chat-container" />,
  ProtocolActivity: () => <div data-testid="protocol-activity" />,
  TrendingProjects: () => <div data-testid="trending-projects" />,
  MascotPanel: () => null,
  ProjectSearch: () => <div data-testid="project-search" />,
}))

vi.mock('./components/chat/ParticipantAvatars', () => ({
  default: () => null,
}))

vi.mock('./components/settings', () => ({
  SettingsPanel: () => null,
}))

vi.mock('./components/payment', () => ({
  PaymentReviewModal: () => null,
}))

vi.mock('./components/payment/TransactionReviewModal', () => ({
  default: () => null,
}))

vi.mock('./components/payment/TransactionStatusCenter', () => ({
  default: () => null,
}))

vi.mock('./components/common/NetworkModeSelect', () => ({
  default: () => <div data-testid="network-mode-select" />,
}))

vi.mock('./components/common/EnvironmentBadge', () => ({
  EnvironmentBadge: () => null,
}))

vi.mock('./components/debug/QueryErrorPanel', () => ({
  QueryErrorPanel: () => null,
}))

function renderMobileApp() {
  return render(
    <MemoryRouter>
      <AppContent />
    </MemoryRouter>,
  )
}

describe('AppContent mobile discovery surface', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: 'dark' })
    useChatStore.setState({ activeChatId: null, pendingNewChat: false })
  })

  it('renders a visible toggle that opens the activity/search overlay', () => {
    renderMobileApp()

    // Chat renders, but no discovery surface until toggled
    expect(screen.getByTestId('chat-container')).toBeInTheDocument()
    expect(screen.queryByTestId('project-search')).not.toBeInTheDocument()
    expect(screen.queryByTestId('trending-projects')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /open live activity/i }))

    // The existing sidebar content mounts: search + trending + activity + network switch
    expect(screen.getByTestId('project-search')).toBeInTheDocument()
    expect(screen.getByTestId('trending-projects')).toBeInTheDocument()
    expect(screen.getByTestId('protocol-activity')).toBeInTheDocument()
    expect(screen.getByTestId('network-mode-select')).toBeInTheDocument()
  })

  it('closes the overlay from its close affordance', () => {
    renderMobileApp()

    fireEvent.click(screen.getByRole('button', { name: /open live activity/i }))
    expect(screen.getByTestId('project-search')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /close live activity/i }))

    expect(screen.queryByTestId('project-search')).not.toBeInTheDocument()
    // The toggle is available again
    expect(screen.getByRole('button', { name: /open live activity/i })).toBeInTheDocument()
  })
})
