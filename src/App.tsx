import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route, useParams, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { mainnet, optimism, base, arbitrum } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'
import { useTranslation } from 'react-i18next'
import { ChatContainer, ProtocolActivity, MascotPanel } from './components/chat'
import JoinChatPage from './components/JoinChatPage'
import SharedLocalChatPage from './components/SharedLocalChatPage'
import { SettingsPanel } from './components/settings'
import { useChatStore, useThemeStore } from './stores'
import { useMultiChatStore } from './stores/multiChatStore'
import { useTransactionExecutor } from './hooks'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
    },
  },
})

function Header({ showActions = false }: { showActions?: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { conversations, activeConversationId, createConversation, setActiveConversation, deleteConversation } = useChatStore()
  const { setActiveChat } = useMultiChatStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isCompact, setIsCompact] = useState(false)
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const navigate = useNavigate()

  // Shrink header on scroll down, restore on scroll up
  useEffect(() => {
    const handleScrollDirection = (e: CustomEvent<{ isScrollingDown: boolean; scrollTop: number }>) => {
      const { isScrollingDown, scrollTop } = e.detail
      // Shrink when scrolling down and not at top
      setIsCompact(isScrollingDown && scrollTop > 50)
    }

    window.addEventListener('juice:scroll-direction', handleScrollDirection as EventListener)
    return () => window.removeEventListener('juice:scroll-direction', handleScrollDirection as EventListener)
  }, [])

  const handleNewChat = () => {
    createConversation()
    setSidebarOpen(false)
  }

  // Dispatch events for chat actions
  const handleInvite = () => window.dispatchEvent(new CustomEvent('juice:action-invite'))
  const handleExport = () => window.dispatchEvent(new CustomEvent('juice:action-export'))
  const handleSave = () => window.dispatchEvent(new CustomEvent('juice:action-save'))

  // 14.44vh normal, 38% of that (~5.49vh) when compact
  const headerHeight = isCompact ? 'h-[5.49vh]' : 'h-[14.44vh]'
  const logoSize = isCompact ? 'h-[36px]' : 'h-[96px]'
  const logoPosition = isCompact ? 'top-[6px] left-[12px]' : 'top-[16px] left-[28px]'

  return (
    <>
      <header className={`sticky top-0 z-40 backdrop-blur-sm transition-all duration-150 ease-out overflow-hidden ${headerHeight} ${
        theme === 'dark'
          ? 'bg-juice-dark/80'
          : 'bg-white/80'
      }`}>
        {/* Logo - fixed position from top-left, navigates home */}
        <button
          onClick={() => {
            setActiveConversation(null)
            setActiveChat(null)
            navigate('/')
          }}
          className={`absolute ${logoPosition} hover:opacity-80 transition-all duration-150 ease-out`}
        >
          <img
            src={theme === 'dark' ? '/head-dark.png' : '/head-light.png'}
            alt="Juicy Vision"
            className={`${logoSize} transition-all duration-150 ease-out`}
          />
        </button>

        {/* Action buttons - aligned with message content (max-w-5xl mx-auto matches MessageList) */}
        {showActions && (
          <div className={`absolute bottom-2 left-0 right-0 p-4 transition-opacity duration-150 ${
            isCompact ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}>
            <div className="max-w-5xl mx-auto flex justify-end gap-2">
              {/* Invite to chat */}
              <button
                onClick={handleInvite}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                  theme === 'dark'
                    ? 'text-gray-400 hover:text-white'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                {t('chat.conspire', 'Conspire')}
              </button>
              {/* Export */}
              <button
                onClick={handleExport}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                  theme === 'dark'
                    ? 'text-gray-400 hover:text-white'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {t('chat.export', 'Export')}
              </button>
              {/* Save - no right padding so text aligns with message content */}
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 pl-3 pr-0 py-1.5 text-xs font-medium transition-colors text-green-500 hover:text-green-400"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                {t('chat.save', 'Save')}
              </button>
            </div>
          </div>
        )}

        {/* Mobile menu button */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`lg:hidden absolute top-4 right-4 p-2 ${
            theme === 'dark'
              ? 'text-gray-400 hover:text-white hover:bg-white/10'
              : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className={`absolute left-0 top-0 bottom-0 w-72 border-r p-4 ${
            theme === 'dark'
              ? 'bg-juice-dark border-white/10'
              : 'bg-white border-gray-200'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Conversations</h2>
              <button
                onClick={() => setSidebarOpen(false)}
                className={`p-2 ${theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <button
              onClick={handleNewChat}
              className="w-full mb-4 px-4 py-2 bg-juice-cyan text-juice-dark font-medium hover:bg-juice-cyan/90 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Chat
            </button>

            <div className="space-y-1 overflow-y-auto max-h-[calc(100vh-150px)]">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    conv.id === activeConversationId
                      ? 'bg-juice-orange/20 ' + (theme === 'dark' ? 'text-white' : 'text-gray-900')
                      : theme === 'dark'
                        ? 'text-gray-400 hover:bg-white/10 hover:text-white'
                        : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                  }`}
                  onClick={() => {
                    setActiveConversation(conv.id)
                    setSidebarOpen(false)
                  }}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <span className="truncate flex-1 text-sm">{conv.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteConversation(conv.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-300"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}

function MainContent({ topOnly, bottomOnly, forceActiveChatId }: { topOnly?: boolean; bottomOnly?: boolean; forceActiveChatId?: string }) {
  return (
    <div className="flex flex-col h-full">
      <ChatContainer topOnly={topOnly} bottomOnly={bottomOnly} forceActiveChatId={forceActiveChatId} />
    </div>
  )
}

// Component to handle home route - clears active chats for fresh start
function HomeRouteHandler() {
  const { setActiveChat } = useMultiChatStore()
  const { setActiveConversation } = useChatStore()

  useEffect(() => {
    // Clear any active chats when landing on home for fresh start
    setActiveChat(null)
    setActiveConversation(null)
  }, [setActiveChat, setActiveConversation])

  return <AppContent />
}

// UUID regex for validating multi-chat IDs
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Component to show when a local chat isn't found
function ChatNotFound() {
  const navigate = useNavigate()
  const { theme } = useThemeStore()
  const { t } = useTranslation()

  return (
    <div className={`min-h-screen flex items-center justify-center ${
      theme === 'dark' ? 'bg-juice-dark text-white' : 'bg-white text-gray-900'
    }`}>
      <div className="text-center max-w-md px-4">
        <h1 className="text-xl font-semibold mb-2">{t('chat.notFound', 'Chat not found')}</h1>
        <p className={`text-sm mb-6 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
          {t('chat.notFoundDesc', 'This chat may be stored locally on another device, or it no longer exists.')}
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-2 bg-juice-orange text-juice-dark font-medium hover:bg-juice-orange/90 transition-colors"
        >
          {t('chat.goHome', 'Start a new chat')}
        </button>
      </div>
    </div>
  )
}

// Component to handle /chat/:chatId routes - sets activeChatId and renders AppContent
function ChatRouteHandler() {
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()
  const { setActiveChat, activeChatId } = useMultiChatStore()
  const { setActiveConversation, conversations, activeConversationId } = useChatStore()
  const [notFound, setNotFound] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (chatId) {
      // Check if it's a local conversation first
      const isLocalChat = conversations.some(c => c.id === chatId)
      if (isLocalChat) {
        setActiveConversation(chatId)
        setActiveChat(null) // Clear any multi-chat
        setNotFound(false)
        setReady(true)
      } else if (UUID_REGEX.test(chatId)) {
        // It's a UUID, assume it's a multi-chat
        setActiveChat(chatId)
        setNotFound(false)
        setReady(true)
      } else {
        // Invalid chat ID (not local, not UUID) - show not found
        setNotFound(true)
        setReady(true)
      }
    } else {
      navigate('/')
    }
  }, [chatId, setActiveChat, setActiveConversation, conversations, navigate])

  if (notFound) {
    return <ChatNotFound />
  }

  // Wait until the active chat/conversation is set before rendering
  const isReady = ready && (
    (UUID_REGEX.test(chatId || '') && activeChatId === chatId) ||
    (conversations.some(c => c.id === chatId) && activeConversationId === chatId)
  )

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-juice-dark">
        <div className="w-8 h-8 border-2 border-juice-orange border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Render the main app content - pass chatId directly to ensure it's used
  // Use key to force re-mount when chatId changes
  return <AppContent key={chatId} forceActiveChatId={UUID_REGEX.test(chatId || '') ? chatId : undefined} />
}

// Wagmi configuration for self-custody wallet connection
const wagmiConfig = createConfig({
  chains: [mainnet, optimism, base, arbitrum],
  connectors: [
    injected(),
    walletConnect({
      projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'juicy-vision',
      metadata: {
        name: 'Juicy Vision',
        description: 'AI-powered Juicebox interface',
        url: window.location.origin,
        icons: [`${window.location.origin}/head-dark.png`],
      },
    }),
  ],
  transports: {
    [mainnet.id]: http('https://rpc.ankr.com/eth'),
    [optimism.id]: http('https://rpc.ankr.com/optimism'),
    [base.id]: http('https://rpc.ankr.com/base'),
    [arbitrum.id]: http('https://rpc.ankr.com/arbitrum'),
  },
})

function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}

function ActivitySidebar({ onProjectClick }: { onProjectClick: (query: string) => void }) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()

  const handleAddNote = () => {
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message: 'Write a juicy note with a ~0 payment onto NANA' }
    }))
  }

  return (
    <div className={`w-full flex flex-col h-full ${
      theme === 'dark'
        ? 'bg-juice-dark'
        : 'bg-white'
    }`}>
      {/* Header */}
      <div className={`px-3 py-2 border-b flex items-center justify-between ${
        theme === 'dark' ? 'border-white/10' : 'border-gray-200'
      }`}>
        <h2 className={`text-sm font-semibold whitespace-nowrap ${
          theme === 'dark' ? 'text-white' : 'text-gray-900'
        }`}>
          {t('ui.liveActivity', 'Live juicy activity')}
        </h2>
        <button
          onClick={handleAddNote}
          className={`p-1 rounded transition-colors ${
            theme === 'dark'
              ? 'text-gray-400 hover:text-juice-cyan'
              : 'text-gray-500 hover:text-teal-600'
          }`}
          title={t('ui.addNote', 'Add a juicy note')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Activity list */}
      <div className="flex-1 overflow-y-auto px-4 hide-scrollbar">
        <ProtocolActivity onProjectClick={onProjectClick} />
      </div>
    </div>
  )
}

// Component that activates transaction execution listener
function TransactionExecutor() {
  useTransactionExecutor()
  return null
}

function AppContent({ forceActiveChatId }: { forceActiveChatId?: string }) {
  const { theme } = useThemeStore()
  const { getActiveConversation } = useChatStore()
  const { activeChatId: storeActiveChatId } = useMultiChatStore()
  const conversation = getActiveConversation()

  // Use forced value if provided, otherwise read from store
  const activeChatId = forceActiveChatId || storeActiveChatId

  // Show chat mode if there are AI messages OR if there's an active multi-chat
  const hasMessages = (conversation && conversation.messages.length > 0) || !!activeChatId

  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])

  // Handle project clicks from activity feed
  const handleActivityProjectClick = (query: string) => {
    // Dispatch a custom event that ChatContainer can listen to
    window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: query } }))
  }

  return (
    <div className={`h-screen overflow-hidden border-4 border-juice-orange flex ${theme === 'dark' ? 'bg-juice-dark' : 'bg-white'}`}>
      {/* Transaction executor - listens for pay events */}
      <TransactionExecutor />
      {/* Main content area (everything except activity) */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {hasMessages ? (
          <>
            {/* Header overlays content with translucency */}
            <div className="absolute top-0 left-0 right-0 z-40">
              <Header showActions />
            </div>
            {/* Chat mode: full-width messages + input at bottom, starts from top */}
            <div className="flex-1 overflow-hidden">
              <Routes>
                <Route path="/" element={<MainContent forceActiveChatId={forceActiveChatId} />} />
                <Route path="*" element={<MainContent forceActiveChatId={forceActiveChatId} />} />
              </Routes>
            </div>
          </>
        ) : (
          <>
            {/* Welcome mode: recommendations as full background, overlays on top */}
            {/* Full-screen recommendations background layer */}
            <div className="absolute inset-0 z-0">
              <Routes>
                <Route path="/" element={<MainContent topOnly forceActiveChatId={forceActiveChatId} />} />
                <Route path="*" element={<MainContent topOnly forceActiveChatId={forceActiveChatId} />} />
              </Routes>
            </div>

            {/* Overlay layout */}
            <div className="relative z-10 flex flex-col h-full pointer-events-none">
              {/* Top section: 62% height */}
              <div className="h-[62%] flex">
                {/* Spacer for recs area - no overlay here, recs show through */}
                <div className="flex-1" />
                {/* Mascot: translucent overlay */}
                <div className="w-[27.53%] border-l-4 border-juice-orange pointer-events-auto">
                  <MascotPanel onSuggestionClick={(text) => window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: text } }))} />
                </div>
              </div>
              {/* Prompt dock: 38% height, translucent overlay */}
              <div className="h-[38%] border-t-4 border-juice-orange pointer-events-auto">
                <Routes>
                  <Route path="/" element={<MainContent bottomOnly forceActiveChatId={forceActiveChatId} />} />
                  <Route path="*" element={<MainContent bottomOnly forceActiveChatId={forceActiveChatId} />} />
                </Routes>
              </div>
            </div>
          </>
        )}
      </div>
      {/* Activity sidebar: full height, far right */}
      <div className="w-[calc(38%*0.38)] border-l-4 border-juice-orange">
        <ActivitySidebar onProjectClick={handleActivityProjectClick} />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProviders>
      <HashRouter>
        <Routes>
          <Route path="/join/:code" element={<JoinChatPage />} />
          <Route path="/chat/:chatId" element={<ChatRouteHandler />} />
          <Route path="/shared/:code" element={<SharedLocalChatPage />} />
          <Route path="/" element={<HomeRouteHandler />} />
          <Route path="*" element={<HomeRouteHandler />} />
        </Routes>
      </HashRouter>
    </AppProviders>
  )
}
