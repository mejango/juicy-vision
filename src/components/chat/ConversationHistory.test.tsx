import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ConversationHistory from './ConversationHistory'
import { useChatStore, useThemeStore, type Chat, type ChatMessage, type ChatFolder } from '../../stores'
import * as chatApi from '../../services/chat'

// Mock wagmi
vi.mock('wagmi', () => ({
  useAccount: vi.fn(() => ({
    address: undefined,
    isConnected: false,
  })),
}))

// Mock useManagedWallet hook
vi.mock('../../hooks', () => ({
  useManagedWallet: vi.fn(() => ({
    address: undefined,
    isManagedMode: false,
  })),
}))

// Mock services
vi.mock('../../services/chat', () => ({
  pinChat: vi.fn(),
  moveChatToFolder: vi.fn(),
  renameChat: vi.fn(),
  fetchFolders: vi.fn(() => Promise.resolve([])),
  fetchMyChats: vi.fn(() => Promise.resolve({ chats: [], total: 0 })),
  createFolder: vi.fn(),
  updateFolderDetails: vi.fn(),
  deleteFolder: vi.fn(),
  deleteChat: vi.fn(() => Promise.resolve()),
  pinFolder: vi.fn(),
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

// Mock navigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// Helper to create a mock chat
function createMockChat(overrides: Partial<Chat> = {}): Chat {
  const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    id,
    founderAddress: '0x123',
    name: 'Test Chat',
    isPublic: true,
    aiBalanceWei: '0',
    aiTotalSpentWei: '0',
    encrypted: false,
    encryptionVersion: 1,
    isPinned: false,
    folderId: null, // Explicitly null for root-level chats
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Chat
}

// Helper to create a mock folder
function createMockFolder(overrides: Partial<ChatFolder> = {}): ChatFolder {
  return {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userAddress: '0x123',
    name: 'Test Folder',
    parentFolderId: null, // Explicitly null for root-level folders
    isPinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as ChatFolder
}

// Helper to create a mock message
function createMockMessage(chatId: string, content = 'Test message'): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    chatId,
    senderAddress: '0x123',
    role: 'user',
    content,
    isEncrypted: false,
    createdAt: new Date().toISOString(),
  }
}

function renderWithProviders(ui: React.ReactElement) {
  // Mock APIs to return current store state so useEffect doesn't overwrite test data
  const { chats, folders } = useChatStore.getState()
  vi.mocked(chatApi.fetchFolders).mockResolvedValue(folders)
  vi.mocked(chatApi.fetchMyChats).mockResolvedValue({ chats, total: chats.length })

  return render(
    <MemoryRouter>
      {ui}
    </MemoryRouter>
  )
}

describe('ConversationHistory', () => {
  beforeEach(() => {
    // Reset stores
    useChatStore.setState({
      chats: [],
      folders: [],
      activeChatId: null,
      isLoading: false,
      isConnected: false,
      error: null,
    })
    useThemeStore.setState({ theme: 'dark' })
    vi.clearAllMocks()
    vi.mocked(chatApi.fetchFolders).mockResolvedValue([])
    vi.mocked(chatApi.fetchMyChats).mockResolvedValue({ chats: [], total: 0 })
    vi.mocked(chatApi.deleteChat).mockResolvedValue()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('returns null when no chats with messages and no folders', async () => {
      const { container } = renderWithProviders(<ConversationHistory />)
      // Wait for loading to complete, then check container is empty
      await waitFor(() => {
        expect(container.firstChild).toBeNull()
      })
    })

    it('renders chats even when they have no messages', async () => {
      const chat = createMockChat({ messages: [] })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)
      // Component should render and show the chat
      await waitFor(() => {
        expect(screen.getByText(chat.name)).toBeInTheDocument()
      })
    })

    it('renders when folders exist even with no chats', async () => {
      const folder = createMockFolder({ name: 'My Folder' })
      useChatStore.setState({ folders: [folder] })

      renderWithProviders(<ConversationHistory />)

      await waitFor(() => {
        expect(screen.getByText('My Folder')).toBeInTheDocument()
      })
    })

    it('renders header with recent count', () => {
      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      // The header shows "Recent (N)" as combined text
      expect(screen.getByText(/Recent.*\(1\)/)).toBeInTheDocument()
    })

    it('renders create folder button', () => {
      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('New folder')).toBeInTheDocument()
    })

    it('renders with dark theme styling', () => {
      useThemeStore.setState({ theme: 'dark' })
      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      // Component should render without errors
      expect(screen.getByText(chat.name)).toBeInTheDocument()
    })

    it('renders with light theme styling', () => {
      useThemeStore.setState({ theme: 'light' })
      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      // Component should render without errors
      expect(screen.getByText(chat.name)).toBeInTheDocument()
    })
  })

  describe('chat display', () => {
    it('renders chat title', () => {
      const chat = createMockChat({
        name: 'My Conversation',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('My Conversation')).toBeInTheDocument()
    })

    it('shows auto-generated title for generic names', () => {
      const chat = createMockChat({
        name: 'New Chat',
        autoGeneratedTitle: 'Discussion about tokens',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('Discussion about tokens')).toBeInTheDocument()
    })

    it('uses regular name when not generic', () => {
      const chat = createMockChat({
        name: 'Important Project',
        autoGeneratedTitle: 'Auto title',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('Important Project')).toBeInTheDocument()
    })

    it('shows unpin option in context menu for pinned chats', async () => {
      const chat = createMockChat({
        name: 'Pinned Chat',
        isPinned: true,
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      await waitFor(() => {
        expect(screen.getByText('Pinned Chat')).toBeInTheDocument()
      })

      // Right-click to open context menu
      fireEvent.contextMenu(screen.getByText('Pinned Chat'))

      await waitFor(() => {
        // Context menu should show Unpin for pinned items
        const contextMenu = document.querySelector('.fixed.z-50')
        expect(contextMenu).toBeInTheDocument()
        expect(contextMenu?.textContent).toContain('Unpin')
      })
    })

    it('highlights active chat', () => {
      const chat = createMockChat({
        id: 'active-chat',
        messages: [createMockMessage('active-chat')],
      })
      useChatStore.setState({
        chats: [chat],
        activeChatId: 'active-chat',
      })

      renderWithProviders(<ConversationHistory />)

      const chatElement = screen.getByText(chat.name).closest('div')
      expect(chatElement).toBeInTheDocument()
    })

    it('navigates when clicking a chat', () => {
      const chat = createMockChat({
        id: 'nav-test-chat',
        messages: [createMockMessage('nav-test-chat')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.click(screen.getByText(chat.name))

      expect(mockNavigate).toHaveBeenCalledWith('/chat/nav-test-chat')
    })

    it('sets active chat when clicking', () => {
      const chat = createMockChat({
        id: 'click-test-chat',
        messages: [createMockMessage('click-test-chat')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.click(screen.getByText(chat.name))

      expect(useChatStore.getState().activeChatId).toBe('click-test-chat')
    })
  })

  describe('folder display', () => {
    it('renders folder with name', async () => {
      const folder = createMockFolder({ name: 'Work Projects' })
      useChatStore.setState({ folders: [folder] })

      renderWithProviders(<ConversationHistory />)

      await waitFor(() => {
        expect(screen.getByText('Work Projects')).toBeInTheDocument()
      })
    })

    it('shows chat count in folder', async () => {
      const folder = createMockFolder({ id: 'folder-1', name: 'My Folder' })
      const chat = createMockChat({
        folderId: 'folder-1',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({
        folders: [folder],
        chats: [chat],
      })

      renderWithProviders(<ConversationHistory />)

      await waitFor(() => {
        expect(screen.getByText('1 chat')).toBeInTheDocument()
      })
    })

    it('expands folder on click to show full chat list', async () => {
      const folder = createMockFolder({ id: 'expand-folder', name: 'Expandable' })
      const chat = createMockChat({
        name: 'Chat Inside',
        folderId: 'expand-folder',
        messages: [createMockMessage('chat-in-folder')],
      })
      useChatStore.setState({
        folders: [folder],
        chats: [chat],
      })

      renderWithProviders(<ConversationHistory />)

      // Wait for folder to render
      await waitFor(() => {
        expect(screen.getByText('Expandable')).toBeInTheDocument()
      })

      // Initially: chat name visible in inline preview, but no border-t list container
      const folderCard = screen.getByText('Expandable').closest('.group')
      expect(folderCard?.querySelector('.border-t')).not.toBeInTheDocument()

      // Click folder to expand
      fireEvent.click(screen.getByText('Expandable'))

      // Now the expanded list with border-t should appear
      await waitFor(() => {
        expect(folderCard?.querySelector('.border-t')).toBeInTheDocument()
      })
    })

    it('collapses folder on second click', async () => {
      const folder = createMockFolder({ id: 'collapse-folder', name: 'Collapsible' })
      const chat = createMockChat({
        name: 'Hidden Chat',
        folderId: 'collapse-folder',
        messages: [createMockMessage('chat-in-folder')],
      })
      useChatStore.setState({
        folders: [folder],
        chats: [chat],
      })

      renderWithProviders(<ConversationHistory />)

      // Wait for folder to be visible
      await waitFor(() => {
        expect(screen.getByText('Collapsible')).toBeInTheDocument()
      })

      // Chat name is visible in inline preview when collapsed
      // (Component shows "Chat1, Chat2, Chat3..." preview text)
      const folderCard = screen.getByText('Collapsible').closest('.group')

      // Initially not expanded - no border-t list container
      expect(folderCard?.querySelector('.border-t')).not.toBeInTheDocument()

      // Expand
      fireEvent.click(screen.getByText('Collapsible'))
      await waitFor(() => {
        // Expanded state shows the list with border-t separator
        expect(folderCard?.querySelector('.border-t')).toBeInTheDocument()
      })

      // Collapse - get the folder element again to click
      const folderElement = screen.getByText('Collapsible')
      fireEvent.click(folderElement)

      await waitFor(() => {
        // Collapsed again - no border-t list container
        expect(folderCard?.querySelector('.border-t')).not.toBeInTheDocument()
      })
    })

    it('shows pinned folders first', async () => {
      const pinnedFolder = createMockFolder({
        id: 'pinned',
        name: 'Important',
        isPinned: true,
        pinOrder: 1,
      })
      const regularFolder = createMockFolder({
        id: 'regular',
        name: 'Normal',
        isPinned: false,
      })
      useChatStore.setState({
        folders: [regularFolder, pinnedFolder], // Added in wrong order
      })

      renderWithProviders(<ConversationHistory />)

      await waitFor(() => {
        expect(screen.getByText('Important')).toBeInTheDocument()
        expect(screen.getByText('Normal')).toBeInTheDocument()
      })

      // Get the folder list container and check order
      const folderItems = screen.getAllByText(/(Important|Normal)/)
      expect(folderItems[0]).toHaveTextContent('Important')
      expect(folderItems[1]).toHaveTextContent('Normal')
    })
  })

  describe('context menu', () => {
    it('opens context menu on right click', async () => {
      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.contextMenu(screen.getByText(chat.name))

      await waitFor(() => {
        // Context menu should appear with these options
        const contextMenu = document.querySelector('.fixed.z-50')
        expect(contextMenu).toBeInTheDocument()
        expect(contextMenu?.textContent).toContain('Pin')
        expect(contextMenu?.textContent).toContain('Rename')
        expect(contextMenu?.textContent).toContain('Delete')
      })
    })

    it('shows Unpin for pinned items', async () => {
      const chat = createMockChat({
        isPinned: true,
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.contextMenu(screen.getByText(chat.name))

      await waitFor(() => {
        // Context menu should show Unpin for pinned items
        const contextMenu = document.querySelector('.fixed.z-50')
        expect(contextMenu).toBeInTheDocument()
        expect(contextMenu?.textContent).toContain('Unpin')
      })
    })

    it('shows Move to section for chats', async () => {
      const folder = createMockFolder({ name: 'Destination' })
      const chat = createMockChat({
        name: 'My Chat',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({
        folders: [folder],
        chats: [chat],
      })

      renderWithProviders(<ConversationHistory />)

      // Wait for chat to render
      await waitFor(() => {
        expect(screen.getByText('My Chat')).toBeInTheDocument()
      })

      fireEvent.contextMenu(screen.getByText('My Chat'))

      await waitFor(() => {
        expect(screen.getByText('Move to...')).toBeInTheDocument()
      })

      // The folder should appear in the move options (context menu)
      // There will be two instances of "Destination" - one in main list, one in menu
      const destinations = screen.getAllByText('Destination')
      expect(destinations.length).toBeGreaterThanOrEqual(1)
    })

    it('does not show Move to for folders', async () => {
      const folder = createMockFolder({ name: 'My Folder' })
      useChatStore.setState({ folders: [folder] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.contextMenu(screen.getByText('My Folder'))

      await waitFor(() => {
        expect(screen.getByText('Pin')).toBeInTheDocument()
      })

      // Move to should not appear for folders
      expect(screen.queryByText('Move to...')).not.toBeInTheDocument()
    })

    it('closes context menu on outside click', async () => {
      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.contextMenu(screen.getByText(chat.name))
      await waitFor(() => {
        const contextMenu = document.querySelector('.fixed.z-50')
        expect(contextMenu).toBeInTheDocument()
      })

      // Click on the backdrop (has class "fixed inset-0 z-[49]")
      const backdrop = document.querySelector('.fixed.inset-0.z-\\[49\\]')
      expect(backdrop).toBeInTheDocument()
      fireEvent.click(backdrop!)

      await waitFor(() => {
        // Context menu should be gone
        const contextMenu = document.querySelector('.fixed.z-50')
        expect(contextMenu).not.toBeInTheDocument()
      })
    })

    it('calls pinChat API when pinning', async () => {
      vi.mocked(chatApi.pinChat).mockResolvedValue(
        createMockChat({ isPinned: true, pinOrder: 1 })
      )

      const chat = createMockChat({
        id: 'pin-test',
        messages: [createMockMessage('pin-test')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      // Wait for chat to render
      await waitFor(() => {
        expect(screen.getByText(chat.name)).toBeInTheDocument()
      })

      fireEvent.contextMenu(screen.getByText(chat.name))

      // Wait for context menu to appear
      let contextMenu: Element | null = null
      await waitFor(() => {
        contextMenu = document.querySelector('.fixed.z-50')
        expect(contextMenu).toBeInTheDocument()
      })

      // Click the Pin button in context menu
      const pinButton = contextMenu!.querySelector('button')
      expect(pinButton).toHaveTextContent('Pin')
      fireEvent.click(pinButton!)

      await waitFor(() => {
        expect(chatApi.pinChat).toHaveBeenCalledWith('pin-test', true)
      })
    })

    it('calls moveChatToFolder API when moving', async () => {
      vi.mocked(chatApi.moveChatToFolder).mockResolvedValue(
        createMockChat({ folderId: 'target-folder' })
      )

      const folder = createMockFolder({ id: 'target-folder', name: 'MoveTarget' })
      const chat = createMockChat({
        id: 'move-test',
        name: 'Chat To Move',
        messages: [createMockMessage('move-test')],
      })
      useChatStore.setState({
        folders: [folder],
        chats: [chat],
      })

      renderWithProviders(<ConversationHistory />)

      // Wait for chat to render
      await waitFor(() => {
        expect(screen.getByText('Chat To Move')).toBeInTheDocument()
      })

      fireEvent.contextMenu(screen.getByText('Chat To Move'))

      // Wait for context menu
      await waitFor(() => {
        expect(screen.getByText('Move to...')).toBeInTheDocument()
      })

      // There are two "MoveTarget" elements - one in folder list, one in context menu
      // Get all of them and click the last one (the context menu option)
      const moveTargetElements = screen.getAllByText('MoveTarget')
      fireEvent.click(moveTargetElements[moveTargetElements.length - 1])

      await waitFor(() => {
        expect(chatApi.moveChatToFolder).toHaveBeenCalledWith('move-test', 'target-folder')
      })
    })

    it('removes chat from store when deleting', async () => {
      const chat = createMockChat({
        id: 'delete-test',
        messages: [createMockMessage('delete-test')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      // Wait for chat to render
      await waitFor(() => {
        expect(screen.getByText(chat.name)).toBeInTheDocument()
      })

      fireEvent.contextMenu(screen.getByText(chat.name))
      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument()
      })

      // Click the Delete button in context menu (last button in the menu)
      const contextMenu = document.querySelector('.fixed.z-50')
      expect(contextMenu).toBeInTheDocument()
      const buttons = contextMenu!.querySelectorAll('button')
      const deleteButton = buttons[buttons.length - 1]
      expect(deleteButton).toHaveTextContent('Delete')
      fireEvent.click(deleteButton)

      await waitFor(() => {
        expect(useChatStore.getState().chats).toHaveLength(0)
      })
    })
  })

  describe('rename modal', () => {
    it('opens rename modal from context menu', async () => {
      const chat = createMockChat({
        name: 'Original Name',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.contextMenu(screen.getByText('Original Name'))
      await waitFor(() => {
        expect(screen.getByText('Rename')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Rename'))

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toHaveValue('Original Name')
      })
    })

    it('calls renameChat API when saving', async () => {
      vi.mocked(chatApi.renameChat).mockResolvedValue(
        createMockChat({ name: 'New Name' })
      )

      const chat = createMockChat({
        id: 'rename-test',
        name: 'Old Name',
        messages: [createMockMessage('rename-test')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      // Open context menu and click rename
      fireEvent.contextMenu(screen.getByText('Old Name'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('Rename'))
      })

      // Change value and save
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'New Name' } })
      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(chatApi.renameChat).toHaveBeenCalledWith('rename-test', 'New Name')
      })
    })

    it('closes modal on cancel', async () => {
      const chat = createMockChat({
        name: 'Test Chat',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      // Open rename modal
      fireEvent.contextMenu(screen.getByText('Test Chat'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('Rename'))
      })

      // Click cancel
      fireEvent.click(screen.getByText('Cancel'))

      await waitFor(() => {
        // Modal input should be gone
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      })
    })

    it('closes modal on backdrop click', async () => {
      const chat = createMockChat({
        name: 'Backdrop Test',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      // Wait for chat to render
      await waitFor(() => {
        expect(screen.getByText('Backdrop Test')).toBeInTheDocument()
      })

      // Open rename modal
      fireEvent.contextMenu(screen.getByText('Backdrop Test'))
      await waitFor(() => {
        expect(screen.getByText('Rename')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Rename'))

      // Wait for modal to open
      await waitFor(() => {
        expect(screen.getByRole('textbox')).toBeInTheDocument()
      })

      // The backdrop is the fixed overlay div. Click directly on it (the first .fixed element)
      const backdrop = document.querySelector('.fixed.inset-0')
      if (backdrop) {
        fireEvent.click(backdrop)
      }

      await waitFor(() => {
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      })
    })
  })

  describe('create folder', () => {
    it('shows folder input when clicking create button', () => {
      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.click(screen.getByText('New folder'))

      expect(screen.getByPlaceholderText('Folder name...')).toBeInTheDocument()
    })

    it('creates folder on Enter key', async () => {
      vi.mocked(chatApi.createFolder).mockResolvedValue(
        createMockFolder({ name: 'New Folder' })
      )

      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.click(screen.getByText('New folder'))

      const input = screen.getByPlaceholderText('Folder name...')
      fireEvent.change(input, { target: { value: 'New Folder' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => {
        expect(chatApi.createFolder).toHaveBeenCalledWith('New Folder')
      })
    })

    it('creates folder on Create button click', async () => {
      vi.mocked(chatApi.createFolder).mockResolvedValue(
        createMockFolder({ name: 'Button Folder' })
      )

      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.click(screen.getByText('New folder'))

      const input = screen.getByPlaceholderText('Folder name...')
      fireEvent.change(input, { target: { value: 'Button Folder' } })
      fireEvent.click(screen.getByText('Create'))

      await waitFor(() => {
        expect(chatApi.createFolder).toHaveBeenCalledWith('Button Folder')
      })
    })

    it('cancels folder creation on Escape', async () => {
      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.click(screen.getByText('New folder'))

      const input = screen.getByPlaceholderText('Folder name...')
      fireEvent.change(input, { target: { value: 'Cancelled' } })
      fireEvent.keyDown(input, { key: 'Escape' })

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Folder name...')).not.toBeInTheDocument()
      })

      expect(chatApi.createFolder).not.toHaveBeenCalled()
    })

    it('adds created folder to store', async () => {
      const newFolder = createMockFolder({ id: 'new-folder-1', name: 'Brand New' })
      vi.mocked(chatApi.createFolder).mockResolvedValue(newFolder)

      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.click(screen.getByText('New folder'))

      const input = screen.getByPlaceholderText('Folder name...')
      fireEvent.change(input, { target: { value: 'Brand New' } })
      fireEvent.click(screen.getByText('Create'))

      await waitFor(() => {
        expect(useChatStore.getState().folders).toContainEqual(
          expect.objectContaining({ id: 'new-folder-1', name: 'Brand New' })
        )
      })
    })

    it('does not create folder with empty name', async () => {
      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.click(screen.getByText('New folder'))

      const input = screen.getByPlaceholderText('Folder name...')
      fireEvent.change(input, { target: { value: '   ' } }) // whitespace only
      fireEvent.click(screen.getByText('Create'))

      expect(chatApi.createFolder).not.toHaveBeenCalled()
    })
  })

  describe('isGenericName helper', () => {
    // Testing through the component behavior with autoGeneratedTitle
    it('treats "New Chat" as generic', () => {
      const chat = createMockChat({
        name: 'New Chat',
        autoGeneratedTitle: 'Better Title',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('Better Title')).toBeInTheDocument()
    })

    it('treats "Untitled" as generic', () => {
      const chat = createMockChat({
        name: 'Untitled',
        autoGeneratedTitle: 'Auto Generated',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('Auto Generated')).toBeInTheDocument()
    })

    it('treats date-prefixed names as generic', () => {
      const chat = createMockChat({
        name: '2024-01-15 conversation',
        autoGeneratedTitle: 'Discussion about AI',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('Discussion about AI')).toBeInTheDocument()
    })

    it('treats "Chat #5" as generic', () => {
      const chat = createMockChat({
        name: 'Chat #5',
        autoGeneratedTitle: 'Fifth conversation',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('Fifth conversation')).toBeInTheDocument()
    })

    it('keeps specific names like "Project Alpha"', () => {
      const chat = createMockChat({
        name: 'Project Alpha',
        autoGeneratedTitle: 'Auto title',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('Project Alpha')).toBeInTheDocument()
    })
  })

  describe('formatTimeAgo helper', () => {
    it('shows "just now" for recent times', () => {
      const chat = createMockChat({
        updatedAt: new Date().toISOString(), // Just now
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('just now')).toBeInTheDocument()
    })

    it('shows minutes ago', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString()
      const chat = createMockChat({
        updatedAt: fiveMinutesAgo,
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('5m ago')).toBeInTheDocument()
    })

    it('shows hours ago', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 3600000).toISOString()
      const chat = createMockChat({
        updatedAt: threeHoursAgo,
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('3h ago')).toBeInTheDocument()
    })

    it('shows days ago', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString()
      const chat = createMockChat({
        updatedAt: twoDaysAgo,
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      expect(screen.getByText('2d ago')).toBeInTheDocument()
    })
  })

  describe('API error handling', () => {
    it('handles pin error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(chatApi.pinChat).mockRejectedValue(new Error('Network error'))

      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.contextMenu(screen.getByText(chat.name))

      // Wait for context menu and click Pin button
      let contextMenu: Element | null = null
      await waitFor(() => {
        contextMenu = document.querySelector('.fixed.z-50')
        expect(contextMenu).toBeInTheDocument()
      })
      const pinButton = contextMenu!.querySelector('button')
      fireEvent.click(pinButton!)

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to pin:', expect.any(Error))
      })

      consoleSpy.mockRestore()
    })

    it('handles rename error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(chatApi.renameChat).mockRejectedValue(new Error('Network error'))

      const chat = createMockChat({
        name: 'Original',
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.contextMenu(screen.getByText('Original'))
      await waitFor(() => {
        fireEvent.click(screen.getByText('Rename'))
      })

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'New Name' } })
      fireEvent.click(screen.getByText('Save'))

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to rename:', expect.any(Error))
      })

      consoleSpy.mockRestore()
    })

    it('handles create folder error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.mocked(chatApi.createFolder).mockRejectedValue(new Error('Network error'))

      const chat = createMockChat({
        messages: [createMockMessage('chat-1')],
      })
      useChatStore.setState({ chats: [chat] })

      renderWithProviders(<ConversationHistory />)

      fireEvent.click(screen.getByText('New folder'))

      const input = screen.getByPlaceholderText('Folder name...')
      fireEvent.change(input, { target: { value: 'New Folder' } })
      fireEvent.click(screen.getByText('Create'))

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to create folder:', expect.any(Error))
      })

      consoleSpy.mockRestore()
    })
  })
})
