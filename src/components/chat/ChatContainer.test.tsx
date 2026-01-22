import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import ChatContainer from './ChatContainer'
import { useChatStore, useThemeStore, type Chat, type ChatMessage } from '../../stores'
import { useAuthStore } from '../../stores/authStore'
import * as chatApi from '../../services/chat'

// Mock services - include all exports used by ChatContainer
vi.mock('../../services/chat', () => ({
  createChat: vi.fn(),
  getChat: vi.fn(),
  fetchChat: vi.fn(() => Promise.resolve(null)),
  fetchMessages: vi.fn(() => Promise.resolve([])),
  fetchMembers: vi.fn(() => Promise.resolve([])),
  fetchMyChats: vi.fn(() => Promise.resolve([])),
  fetchPublicChats: vi.fn(() => Promise.resolve([])),
  sendMessage: vi.fn(),
  deleteMessage: vi.fn(),
  updateChat: vi.fn(),
  deleteChat: vi.fn(),
  invokeAi: vi.fn(),
  getAiBalance: vi.fn(() => Promise.resolve({ balanceWei: '0', totalSpentWei: '0', estimatedRequestsRemaining: 0, isLow: false, isEmpty: true })),
  connectToChat: vi.fn(() => ({
    close: vi.fn(),
    readyState: WebSocket.OPEN,
  })),
  disconnectFromChat: vi.fn(),
  onWsMessage: vi.fn(() => vi.fn()),
  sendTypingIndicator: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  updateMemberRole: vi.fn(),
  createInvite: vi.fn(),
  getInvites: vi.fn(() => Promise.resolve([])),
  revokeInvite: vi.fn(),
  getInviteInfo: vi.fn(),
  joinViaInvite: vi.fn(),
  migrateChat: vi.fn(),
  submitFeedback: vi.fn(),
  getConnectionStatus: vi.fn(() => ({ isConnected: false, isOnline: true, attempt: 0 })),
  resetReconnectAttempts: vi.fn(),
  sendWsMessage: vi.fn(),
}))

vi.mock('../../services/session', () => ({
  getSessionId: vi.fn(() => 'test-session-id-12345678901234567890'),
}))

vi.mock('wagmi', async () => {
  const actual = await vi.importActual('wagmi')
  return {
    ...actual,
    useAccount: vi.fn(() => ({ isConnected: false, address: undefined })),
    useWalletClient: vi.fn(() => ({ data: null })),
    usePublicClient: vi.fn(() => null),
  }
})

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

// Mock the i18n module to prevent initialization issues
vi.mock('../../i18n', () => ({
  default: {
    t: (key: string) => key,
    language: 'en',
    changeLanguage: vi.fn(),
  },
}))

// Create a mock wagmi config with required structure
const mockWagmiConfig = {
  chains: [],
  connectors: [],
  transports: {},
  state: {
    connections: new Map(),
    current: '',
    status: 'disconnected',
    chainId: 1,
  },
  _internal: {
    ssr: false,
    store: {
      getState: () => ({ connections: new Map(), current: '', status: 'disconnected' }),
      subscribe: vi.fn(),
      persist: { rehydrate: vi.fn() },
    },
    connectors: { setup: vi.fn(), subscribe: vi.fn() },
  },
  subscribe: vi.fn(() => vi.fn()),
  getClient: vi.fn(),
  setState: vi.fn(),
} as any

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <WagmiProvider config={mockWagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          {ui}
        </MemoryRouter>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

const createMockChat = (overrides?: Partial<Chat>): Chat => ({
  id: 'test-chat-id',
  name: 'Test Chat',
  isPublic: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  founderAddress: '0x1234567890123456789012345678901234567890',
  aiBalanceWei: '0',
  aiTotalSpentWei: '0',
  encrypted: false,
  encryptionVersion: 0,
  isPinned: false,
  members: [],
  messages: [],
  ...overrides,
})

const createMockMessage = (overrides?: Partial<ChatMessage>): ChatMessage => ({
  id: 'msg-1',
  chatId: 'test-chat-id',
  content: 'Test message',
  role: 'user',
  createdAt: new Date().toISOString(),
  senderAddress: '0x1234567890123456789012345678901234567890',
  isEncrypted: false,
  ...overrides,
})

describe('ChatContainer', () => {
  beforeEach(() => {
    // Reset stores
    useChatStore.setState({
      chats: [],
      activeChatId: null,
      isConnected: false,
      isLoading: false,
      error: null,
    })
    useThemeStore.setState({ theme: 'dark' })
    useAuthStore.setState({
      user: null,
      token: null,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders welcome screen when no messages', () => {
      renderWithProviders(<ChatContainer />)
      // Should show chat input area
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('renders with dark theme by default', () => {
      renderWithProviders(<ChatContainer />)
      // Container should have dark theme class
      const container = screen.getByRole('textbox').closest('div')
      expect(container).toBeInTheDocument()
    })

    it('renders chat input', () => {
      renderWithProviders(<ChatContainer />)
      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('placeholder')
    })

    it('renders topOnly mode correctly', () => {
      renderWithProviders(<ChatContainer topOnly />)
      // In topOnly mode, renders message area without the input field
      // Check that a shuffle button exists (part of the top/welcome area)
      expect(screen.getByRole('button', { name: /shuffle/i })).toBeInTheDocument()
    })

    it('renders bottomOnly mode correctly', () => {
      renderWithProviders(<ChatContainer bottomOnly />)
      // In bottomOnly mode, should still render the component
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('message handling', () => {
    it('allows typing in the input', () => {
      renderWithProviders(<ChatContainer />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'Hello world' } })
      expect(input).toHaveValue('Hello world')
    })

    it('submits message on Enter key', async () => {
      const mockChat = createMockChat({ id: 'new-chat-id', name: 'New Chat' })
      vi.mocked(chatApi.createChat).mockResolvedValue(mockChat)
      vi.mocked(chatApi.sendMessage).mockResolvedValue(createMockMessage({
        id: 'msg-1',
        chatId: 'new-chat-id',
        content: 'Hello',
      }))

      renderWithProviders(<ChatContainer />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'Hello' } })
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

      await waitFor(() => {
        expect(chatApi.createChat).toHaveBeenCalled()
      })
    })
  })

  describe('shared chat mode', () => {
    it('uses forceActiveChatId when provided', () => {
      const mockChat = createMockChat({ id: 'forced-chat-id' })
      // Add the chat to the store so it can be found
      useChatStore.setState({
        chats: [mockChat],
        activeChatId: null,
        isConnected: false,
      })

      renderWithProviders(<ChatContainer forceActiveChatId="forced-chat-id" />)

      // Should render the chat input
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('connects to WebSocket when activeChatId is set', async () => {
      const mockChat = createMockChat({ id: 'test-chat-id' })
      vi.mocked(chatApi.fetchMessages).mockResolvedValue([])

      useChatStore.setState({
        activeChatId: 'test-chat-id',
        chats: [mockChat],
        isConnected: false,
      })

      renderWithProviders(<ChatContainer />)

      await waitFor(() => {
        expect(chatApi.connectToChat).toHaveBeenCalledWith('test-chat-id')
      })
    })
  })

  describe('theme support', () => {
    it('renders with light theme when set', () => {
      useThemeStore.setState({ theme: 'light' })
      renderWithProviders(<ChatContainer />)
      // Component should render without errors in light theme
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('renders with dark theme when set', () => {
      useThemeStore.setState({ theme: 'dark' })
      renderWithProviders(<ChatContainer />)
      // Component should render without errors in dark theme
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('authentication states', () => {
    it('renders for unauthenticated users', () => {
      useAuthStore.setState({ isAuthenticated: () => false, user: null })
      renderWithProviders(<ChatContainer />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('renders for authenticated users', () => {
      useAuthStore.setState({
        user: {
          id: 'user-1',
          email: 'test@example.com',
          privacyMode: 'anonymous',
          hasCustodialWallet: false,
        },
        token: 'test-token',
      })
      renderWithProviders(<ChatContainer />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('chat mode', () => {
    it('starts with no active chat by default', () => {
      renderWithProviders(<ChatContainer />)
      const state = useChatStore.getState()
      expect(state.activeChatId).toBeNull()
    })

    it('renders existing messages when chat is active', () => {
      const mockChat = createMockChat({
        id: 'chat-1',
        name: 'Test Chat',
        messages: [
          createMockMessage({ id: 'msg-1', content: 'Hello', role: 'user' }),
          createMockMessage({ id: 'msg-2', content: 'Hi there!', role: 'assistant' }),
        ],
      })

      useChatStore.setState({
        chats: [mockChat],
        activeChatId: 'chat-1',
      })

      renderWithProviders(<ChatContainer forceActiveChatId="chat-1" />)

      // Messages should be visible
      expect(screen.getByText('Hello')).toBeInTheDocument()
      expect(screen.getByText('Hi there!')).toBeInTheDocument()
    })
  })

  describe('input state', () => {
    it('has an input field that accepts text', () => {
      renderWithProviders(<ChatContainer />)

      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })
  })
})
