import { useState, useEffect, useRef, useCallback } from 'react'
import { HashRouter, Routes, Route, useParams, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { useTranslation } from 'react-i18next'
import { wagmiConfig } from './config/wagmi'
import { ChatContainer, ProtocolActivity, MascotPanel } from './components/chat'
import JoinChatPage from './components/JoinChatPage'
import { SettingsPanel } from './components/settings'
import ErrorBoundary from './components/ui/ErrorBoundary'
import { useChatStore, useThemeStore } from './stores'
import { useTransactionExecutor } from './hooks'

// Hook for detecting mobile viewport
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return isMobile
}

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
  const { chats, setActiveChat } = useChatStore()
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
    setActiveChat(null)
    navigate('/')
    setSidebarOpen(false)
  }

  // Dispatch events for chat actions with button position for popover placement
  const handleInvite = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    window.dispatchEvent(new CustomEvent('juice:action-invite', {
      detail: { anchorPosition: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } }
    }))
  }
  const handleExport = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    window.dispatchEvent(new CustomEvent('juice:action-export', {
      detail: { anchorPosition: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } }
    }))
  }
  const handleSave = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    window.dispatchEvent(new CustomEvent('juice:action-save', {
      detail: { anchorPosition: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } }
    }))
  }

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
            setActiveChat(null)
            navigate('/')
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute ${logoPosition} hover:opacity-80 transition-all duration-150 ease-out touch-manipulation cursor-pointer z-50`}
        >
          <img
            src={theme === 'dark' ? '/head-dark.png' : '/head-light.png'}
            alt="Juicy Vision"
            className={`${logoSize} transition-all duration-150 ease-out pointer-events-none`}
            draggable={false}
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
              <h2 className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Chats</h2>
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
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className={`group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    theme === 'dark'
                      ? 'text-gray-400 hover:bg-white/10 hover:text-white'
                      : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                  }`}
                  onClick={() => {
                    setActiveChat(chat.id)
                    navigate(`/chat/${chat.id}`)
                    setSidebarOpen(false)
                  }}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <span className="truncate flex-1 text-sm">{chat.name}</span>
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
  const { setActiveChat } = useChatStore()

  useEffect(() => {
    // Clear any active chats when landing on home for fresh start
    setActiveChat(null)
  }, [setActiveChat])

  return <AppContent />
}

// UUID regex for validating chat IDs
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Component to show when a chat isn't found
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
          {t('chat.notFoundDesc', 'This chat may have been deleted or the link is invalid.')}
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
  const { setActiveChat, activeChatId } = useChatStore()
  const [notFound, setNotFound] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (chatId) {
      if (UUID_REGEX.test(chatId)) {
        // Valid UUID, set as active chat
        setActiveChat(chatId)
        setNotFound(false)
        setReady(true)
      } else {
        // Invalid chat ID - show not found
        setNotFound(true)
        setReady(true)
      }
    } else {
      navigate('/')
    }
  }, [chatId, setActiveChat, navigate])

  if (notFound) {
    return <ChatNotFound />
  }

  // Wait until the active chat is set before rendering
  const isReady = ready && activeChatId === chatId

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-juice-dark">
        <div className="w-8 h-8 border-2 border-juice-orange border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Render the main app content - pass chatId directly to ensure it's used
  // Use key to force re-mount when chatId changes
  return <AppContent key={chatId} forceActiveChatId={chatId} />
}

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

// Welcome layout with gesture-based dock sliding
// Drag handle at top of dock allows pulling up to reveal more content
function WelcomeLayout({ forceActiveChatId, theme }: { forceActiveChatId?: string; theme: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)

  useEffect(() => {
    const container = containerRef.current
    const dock = dockRef.current
    if (!container || !dock) return

    // Maximum offset is the full height of the recs section (62vh)
    const maxOffset = window.innerHeight * 0.62

    const updateOffset = (delta: number): boolean => {
      // Returns true if offset was changed, false if at limit
      const currentOffset = offsetRef.current
      const newOffset = Math.max(0, Math.min(maxOffset, currentOffset + delta))

      if (newOffset === currentOffset) {
        return false // At limit, couldn't change
      }

      offsetRef.current = newOffset
      // Set CSS variable on container - both dock and mascot use this
      container.style.setProperty('--dock-height', `calc(38vh + ${newOffset}px)`)
      return true
    }

    const handleWheel = (e: WheelEvent) => {
      const scrollingDown = e.deltaY > 0
      const scrollingUp = e.deltaY < 0
      const atMaxHeight = offsetRef.current >= maxOffset
      const atMinHeight = offsetRef.current <= 0

      // Find the scrollable content inside the dock - need to find the nested one in ChatContainer
      // The outer .overflow-auto is a wrapper, the actual scroll happens on .overflow-y-auto inside
      const outerWrapper = dock.querySelector('.overflow-auto')
      const scrollableContent = (outerWrapper?.querySelector('.overflow-y-auto') || outerWrapper) as HTMLElement
      const contentScrollTop = scrollableContent?.scrollTop || 0
      const contentScrollMax = scrollableContent
        ? scrollableContent.scrollHeight - scrollableContent.clientHeight
        : 0
      const contentAtTop = contentScrollTop <= 1 // Allow 1px tolerance
      const contentAtBottom = contentScrollTop >= contentScrollMax - 1

      // WINDING UP: If scrolling down to grow dock
      if (scrollingDown) {
        // If dock can still grow, grow it
        if (!atMaxHeight) {
          const changed = updateOffset(e.deltaY)
          if (changed) e.preventDefault()
          return
        }
        // Dock at max - let content scroll down
        return
      }

      // UNWINDING: If scrolling up to shrink dock
      if (scrollingUp) {
        // If content is scrolled down, let it scroll back up first
        if (!contentAtTop) {
          return // Let content scroll up
        }
        // Content at top - now shrink dock
        if (!atMinHeight) {
          const changed = updateOffset(e.deltaY)
          if (changed) e.preventDefault()
          return
        }
      }
    }

    dock.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      dock.removeEventListener('wheel', handleWheel)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden"
      style={{ '--dock-height': '38vh' } as React.CSSProperties}
    >
      {/* Recommendations - fills full area, extends behind mascot and dock */}
      <div className="absolute top-0 left-0 right-0 bottom-0 overflow-hidden border-t-4 border-juice-orange">
        <Routes>
          <Route path="/" element={<MainContent topOnly forceActiveChatId={forceActiveChatId} />} />
          <Route path="*" element={<MainContent topOnly forceActiveChatId={forceActiveChatId} />} />
        </Routes>
      </div>

      {/* Mascot panel - overlays recommendations with translucent background */}
      {/* Height is slightly less than 62vh to ensure top border stays visible within container */}
      <div
        className="hidden lg:flex lg:flex-col absolute right-0 w-[27.53%] z-20 border-t-4 border-l-4 border-juice-orange"
        style={{ height: 'calc(62vh - 4px)', bottom: 'var(--dock-height)' }}
      >
        <div className="flex-1 overflow-hidden">
          <MascotPanel
            onSuggestionClick={(text) => window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: text } }))}
          />
        </div>
      </div>

      {/* Bottom dock: scroll anywhere inside to slide up/down - translucent to show recommendations behind */}
      {/* Position from top with max(0px) ensures border stays visible when dock reaches full height */}
      <div
        ref={dockRef}
        className={`absolute inset-x-0 bottom-0 z-30 flex flex-col backdrop-blur-md ${
          theme === 'dark' ? 'bg-juice-dark/75' : 'bg-white/75'
        }`}
        style={{ top: 'max(0px, calc(100% - var(--dock-height)))', bottom: 0 }}
      >
        {/* Top border - sticky at top of dock */}
        <div className="h-[4px] bg-juice-orange shrink-0" />
        {/* Dock content */}
        <div className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<MainContent bottomOnly forceActiveChatId={forceActiveChatId} />} />
            <Route path="*" element={<MainContent bottomOnly forceActiveChatId={forceActiveChatId} />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}


function AppContent({ forceActiveChatId }: { forceActiveChatId?: string }) {
  const { theme } = useThemeStore()
  const { activeChatId: storeActiveChatId, getActiveChat } = useChatStore()
  const isMobile = useIsMobile()
  const [showMobileActivity, setShowMobileActivity] = useState(false)

  // Use forced value if provided, otherwise read from store
  const activeChatId = forceActiveChatId || storeActiveChatId
  const activeChat = getActiveChat()

  // Show chat mode if there's an active chat with messages
  const hasMessages = activeChat && activeChat.messages && activeChat.messages.length > 0

  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])


  // Handle project clicks from activity feed
  const handleActivityProjectClick = (query: string) => {
    // Dispatch a custom event that ChatContainer can listen to
    window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: query } }))
    if (isMobile) setShowMobileActivity(false) // Close activity on mobile after click
  }

  // Mobile layout: chat-first, activity toggleable
  if (isMobile) {
    return (
      <div className={`h-screen overflow-hidden flex flex-col ${theme === 'dark' ? 'bg-juice-dark' : 'bg-white'}`}>
        <TransactionExecutor />
        {/* Mobile header with activity toggle */}
        <div className="flex-shrink-0">
          <Header showActions={!!hasMessages} />
        </div>
        {/* Main content */}
        <div className="flex-1 overflow-hidden relative">
          {showMobileActivity ? (
            <div className="h-full">
              <div className="flex items-center justify-between px-4 py-2 border-b border-juice-orange">
                <span className={`text-sm font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  Live Activity
                </span>
                <button
                  onClick={() => setShowMobileActivity(false)}
                  className={`p-2 rounded-lg ${theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <ActivitySidebar onProjectClick={handleActivityProjectClick} />
            </div>
          ) : (
            <MainContent forceActiveChatId={forceActiveChatId} />
          )}
        </div>
        {/* Mobile activity toggle FAB */}
        {!showMobileActivity && (
          <button
            onClick={() => setShowMobileActivity(true)}
            className="fixed bottom-24 right-4 z-50 w-12 h-12 rounded-full bg-juice-orange text-juice-dark shadow-lg flex items-center justify-center"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </button>
        )}
      </div>
    )
  }

  // Desktop layout: golden ratio with sidebar
  // Border structure: left + bottom on outer, top borders scroll with content for "hole" effect
  return (
    <div className={`h-screen overflow-hidden flex ${theme === 'dark' ? 'bg-juice-dark' : 'bg-white'}`}>
      {/* Transaction executor - listens for pay events */}
      <TransactionExecutor />

      {/* Left border - always visible (4px to match border-4) */}
      <div className="w-[4px] bg-juice-orange shrink-0" />

      {/* Main content area (everything except activity) */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {hasMessages ? (
          <>
            {/* Top border for chat mode (4px to match border-4) */}
            <div className="h-[4px] bg-juice-orange shrink-0" />
            {/* Header overlays content with translucency */}
            <div className="absolute top-[4px] left-0 right-0 z-40">
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
          <WelcomeLayout forceActiveChatId={forceActiveChatId} theme={theme} />
        )}
        {/* Bottom border (4px to match border-4) */}
        <div className="h-[4px] bg-juice-orange shrink-0" />
      </div>
      {/* Activity sidebar: full height, far right - hidden on tablet */}
      {/* Uses border-4 so corners connect properly */}
      <div className="hidden md:block w-[calc(38%*0.38)] h-full border-4 border-juice-orange">
        <ActivitySidebar onProjectClick={handleActivityProjectClick} />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <HashRouter>
          <Routes>
            <Route path="/join/:code" element={<JoinChatPage />} />
            <Route path="/chat/:chatId" element={<ChatRouteHandler />} />
            <Route path="/" element={<HomeRouteHandler />} />
            <Route path="*" element={<HomeRouteHandler />} />
          </Routes>
        </HashRouter>
      </AppProviders>
    </ErrorBoundary>
  )
}
