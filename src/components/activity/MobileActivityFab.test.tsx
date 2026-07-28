/**
 * Mobile discovery FAB shared by every full-page host (home/chat, project
 * dashboard, account view): sub-md viewports get a floating toggle that opens
 * the ActivitySidebar surface as a full-screen overlay. Hosts without a
 * mounted ChatContainer rely on the default project-click hand-off: queue the
 * chat message in the store and navigate home.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import MobileActivityFab from './MobileActivityFab'
import { useChatStore, useThemeStore } from '../../stores'

const { navigateMock, isMobileState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  isMobileState: { value: true },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
}))

vi.mock('../../hooks', () => ({
  useIsMobile: () => isMobileState.value,
}))

vi.mock('../chat', () => ({
  ProtocolActivity: ({ onProjectClick }: { onProjectClick?: (q: string) => void }) => (
    <button data-testid="protocol-activity" onClick={() => onProjectClick?.('Tell me about NANA')}>
      activity
    </button>
  ),
  TrendingProjects: () => <div data-testid="trending-projects" />,
  ProjectSearch: () => <div data-testid="project-search" />,
}))

vi.mock('../common/NetworkModeSelect', () => ({
  default: () => <div data-testid="network-mode-select" />,
}))

describe('MobileActivityFab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isMobileState.value = true
    useThemeStore.setState({ theme: 'dark' })
    useChatStore.setState({ queuedNewChatMessage: null })
  })

  it('renders nothing on desktop viewports', () => {
    isMobileState.value = false
    render(<MobileActivityFab />)
    expect(screen.queryByRole('button', { name: /open live activity/i })).not.toBeInTheDocument()
  })

  it('opens and closes the discovery overlay', () => {
    render(<MobileActivityFab />)

    expect(screen.queryByTestId('project-search')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /open live activity/i }))
    expect(screen.getByTestId('project-search')).toBeInTheDocument()
    expect(screen.getByTestId('trending-projects')).toBeInTheDocument()
    expect(screen.getByTestId('network-mode-select')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /close live activity/i }))
    expect(screen.queryByTestId('project-search')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open live activity/i })).toBeInTheDocument()
  })

  it('by default a project click queues a new chat and navigates home (hosts without ChatContainer)', () => {
    render(<MobileActivityFab />)
    fireEvent.click(screen.getByRole('button', { name: /open live activity/i }))
    fireEvent.click(screen.getByTestId('protocol-activity'))

    expect(useChatStore.getState().queuedNewChatMessage).toBe('Tell me about NANA')
    expect(navigateMock).toHaveBeenCalledWith('/')
    // Overlay closes after the click.
    expect(screen.queryByTestId('project-search')).not.toBeInTheDocument()
  })

  it('defers to a host-provided project-click handler instead of navigating', () => {
    const onProjectClick = vi.fn()
    render(<MobileActivityFab onProjectClick={onProjectClick} />)
    fireEvent.click(screen.getByRole('button', { name: /open live activity/i }))
    fireEvent.click(screen.getByTestId('protocol-activity'))

    expect(onProjectClick).toHaveBeenCalledWith('Tell me about NANA')
    expect(navigateMock).not.toHaveBeenCalled()
    expect(useChatStore.getState().queuedNewChatMessage).toBeNull()
  })
})
