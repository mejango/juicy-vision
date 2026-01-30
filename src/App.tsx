import { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, useParams, useNavigate } from 'react-router-dom'
import { shouldShowAdminDashboard } from './utils/subdomain'

// Lazy load admin app
const AdminApp = lazy(() => import('./admin/AdminApp'))
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { useTranslation } from 'react-i18next'
import { wagmiConfig } from './config/wagmi'
import { EnvironmentBadge } from './components/common/EnvironmentBadge'
import { ChatContainer, ProtocolActivity, MascotPanel } from './components/chat'
import ParticipantAvatars from './components/chat/ParticipantAvatars'
import JoinChatPage from './components/JoinChatPage'
import { SettingsPanel } from './components/settings'
import ErrorBoundary from './components/ui/ErrorBoundary'
import { useChatStore, useThemeStore, type ChatMember } from './stores'
import { useTransactionExecutor, useManagedWallet, useIsMobile } from './hooks'
import ActionExecutor from './components/ActionExecutor'
import { getSessionId, getSessionPseudoAddress, getCachedPseudoAddress } from './services/session'
import { getWalletSession } from './services/siwe'
import { useEnsNameResolved } from './hooks'

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
  const { chats, setActiveChat, activeChatId, updateMember } = useChatStore()
  const activeChat = chats.find(c => c.id === activeChatId)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isCompact, setIsCompact] = useState(false)
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const navigate = useNavigate()

  // Get current user info for participant display
  // Priority order (must match backend):
  // 1. SIWE session address (self-custody wallet)
  // 2. Smart account address (managed mode / Touch ID)
  // 3. Session pseudo-address (anonymous)
  const walletSession = getWalletSession()
  const { address: smartAccountAddress, isManagedMode } = useManagedWallet()

  // Pseudo-address must be fetched from backend (uses HMAC-SHA256 with server secret)
  const [sessionPseudoAddress, setSessionPseudoAddress] = useState<string | null>(getCachedPseudoAddress())

  useEffect(() => {
    // Fetch the pseudo-address from backend if not cached
    if (!sessionPseudoAddress) {
      getSessionPseudoAddress().then(setSessionPseudoAddress)
    }
  }, [sessionPseudoAddress])

  // Use the correct address based on auth type
  const currentAddress = walletSession?.address || (isManagedMode ? smartAccountAddress : null) || sessionPseudoAddress
  const { ensName } = useEnsNameResolved(walletSession?.address)

  // Build participants list: always ensure current user is shown
  const participants: ChatMember[] = useMemo(() => {
    const serverMembers = activeChat?.members || []

    // Check if current user is already in the list
    // Check all possible addresses: SIWE, smart account, and pseudo-address
    const currentUserInList = serverMembers.some(m => {
      const memberAddr = m.address?.toLowerCase()
      return (currentAddress && memberAddr === currentAddress.toLowerCase()) ||
             (smartAccountAddress && memberAddr === smartAccountAddress.toLowerCase()) ||
             (sessionPseudoAddress && memberAddr === sessionPseudoAddress.toLowerCase())
    })

    // If current user is not in server members, add them
    if (!currentUserInList && currentAddress) {
      return [...serverMembers, {
        address: currentAddress,
        role: 'member' as const,
        displayName: ensName || undefined,
        joinedAt: new Date().toISOString(),
      }]
    }

    // Current user is in the list, use server members (or fallback if empty)
    if (serverMembers.length > 0) return serverMembers
    if (!currentAddress) return []
    return [{
      address: currentAddress,
      role: 'member' as const,
      displayName: ensName || undefined,
      joinedAt: new Date().toISOString(),
    }]
  }, [activeChat?.members, currentAddress, smartAccountAddress, sessionPseudoAddress, ensName])

  // Find current user's member record for permission checking
  const currentUserMember = useMemo(() => {
    return participants.find(m => {
      const memberAddr = m.address?.toLowerCase()
      return (currentAddress && memberAddr === currentAddress.toLowerCase()) ||
             (smartAccountAddress && memberAddr === smartAccountAddress.toLowerCase()) ||
             (sessionPseudoAddress && memberAddr === sessionPseudoAddress.toLowerCase())
    })
  }, [participants, currentAddress, smartAccountAddress, sessionPseudoAddress])

  // Handle member permission updates
  const handleMemberUpdated = useCallback((updatedMember: ChatMember) => {
    if (activeChatId) {
      updateMember(activeChatId, updatedMember.address, updatedMember)
    }
  }, [activeChatId, updateMember])

  // Check if current user can invite others
  const canInvite = !activeChatId || // New chat, anyone can invite
    currentUserMember?.role === 'founder' ||
    currentUserMember?.role === 'admin' ||
    currentUserMember?.canInvite === true

  // Online members: always include current user (they're viewing the chat!)
  // Also include session pseudo-address if user is signed in, since their participant
  // entry might use pseudo-address (from before they signed in)
  const onlineMembers = useMemo(() => {
    const serverOnline = activeChat?.onlineMembers || []
    const result = [...serverOnline]

    // Add current address if not present
    if (currentAddress && !result.some(a => a?.toLowerCase() === currentAddress.toLowerCase())) {
      result.push(currentAddress)
    }

    // If signed in, also add pseudo-address so participant shows as online
    // (their member entry might still use the pseudo-address)
    if (walletSession && sessionPseudoAddress && !result.some(a => a?.toLowerCase() === sessionPseudoAddress.toLowerCase())) {
      result.push(sessionPseudoAddress)
    }

    return result
  }, [activeChat?.onlineMembers, currentAddress, walletSession, sessionPseudoAddress])

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
            <div className="max-w-5xl mx-auto flex justify-end items-center gap-2">
              {/* Participants */}
              {participants.length > 1 && (
                <ParticipantAvatars
                  members={participants}
                  onlineMembers={onlineMembers}
                  maxVisible={6}
                  size="sm"
                  className="mr-1"
                  chatId={activeChatId || undefined}
                  currentUserMember={currentUserMember}
                  onMemberUpdated={handleMemberUpdated}
                />
              )}
              {/* Invite to chat */}
              <button
                onClick={handleInvite}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                  canInvite
                    ? theme === 'dark'
                      ? 'text-gray-400 hover:text-white'
                      : 'text-gray-500 hover:text-gray-900'
                    : theme === 'dark'
                      ? 'text-gray-600 cursor-default'
                      : 'text-gray-400 cursor-default'
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

// Project slug regex: chainSlug:projectId (e.g., eth:3, base:123)
const PROJECT_SLUG_REGEX = /^([a-z]+):(\d+)$/i

// Import chain IDs from environment config for URL routing
import { CHAIN_IDS, IS_TESTNET } from './config/environment'

// Map chain slugs to chain IDs (uses environment-aware chain IDs)
const CHAIN_SLUG_TO_ID: Record<string, number> = {
  eth: CHAIN_IDS.ethereum,
  op: CHAIN_IDS.optimism,
  base: CHAIN_IDS.base,
  arb: CHAIN_IDS.arbitrum,
}

// Map chain IDs to display names (includes both mainnet and testnet names)
const CHAIN_ID_TO_NAME: Record<number, string> = IS_TESTNET
  ? {
      [CHAIN_IDS.ethereum]: 'Sepolia',
      [CHAIN_IDS.optimism]: 'Optimism Sepolia',
      [CHAIN_IDS.base]: 'Base Sepolia',
      [CHAIN_IDS.arbitrum]: 'Arbitrum Sepolia',
    }
  : {
      [CHAIN_IDS.ethereum]: 'Ethereum',
      [CHAIN_IDS.optimism]: 'Optimism',
      [CHAIN_IDS.base]: 'Base',
      [CHAIN_IDS.arbitrum]: 'Arbitrum',
    }

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

// Component to handle project deep links like /eth:3 or /base:123
function ProjectRouteHandler() {
  const { projectSlug } = useParams<{ projectSlug: string }>()
  const navigate = useNavigate()
  const { setActiveChat } = useChatStore()
  const [dispatched, setDispatched] = useState(false)

  useEffect(() => {
    if (!projectSlug || dispatched) return

    const match = projectSlug.match(PROJECT_SLUG_REGEX)
    if (!match) {
      // Not a valid project slug, go home
      navigate('/')
      return
    }

    const [, chainSlug, projectId] = match
    const chainId = CHAIN_SLUG_TO_ID[chainSlug.toLowerCase()]

    if (!chainId) {
      // Unknown chain, go home
      navigate('/')
      return
    }

    const chainName = CHAIN_ID_TO_NAME[chainId]

    // Clear any active chat to start fresh
    setActiveChat(null)

    // Navigate to home first, then dispatch the message
    navigate('/')

    // Small delay to ensure navigation completes before dispatching
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('juice:send-message', {
        detail: {
          message: `Tell me about project #${projectId} on ${chainName}. What's the project's current state, treasury balance, and recent activity?`,
          newChat: true
        }
      }))
    }, 100)

    setDispatched(true)
  }, [projectSlug, navigate, setActiveChat, dispatched])

  // Show loading while redirecting
  return (
    <div className="min-h-screen flex items-center justify-center bg-juice-dark">
      <div className="w-8 h-8 border-2 border-juice-orange border-t-transparent rounded-full animate-spin" />
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

// Welcome layout with simplified dock pinning
// Scroll down (pull up) pins dock to top with animation, scroll up returns to original position
// Disabled on mobile for a cleaner experience
function WelcomeLayout({ forceActiveChatId, theme }: { forceActiveChatId?: string; theme: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const dockContentRef = useRef<HTMLDivElement>(null)
  const mascotRef = useRef<HTMLDivElement>(null)
  const isPinnedRef = useRef(false)
  const waitingForNewGestureRef = useRef(false)
  const gestureEndTimerRef = useRef<number | null>(null)
  const isMobile = useIsMobile()

  // Check if there's conversation history to scroll through
  const { chats } = useChatStore()
  const hasContentRef = useRef(false)

  // Keep ref in sync - dock should only expand if there are chats to show
  useEffect(() => {
    hasContentRef.current = chats.length > 0
  }, [chats.length])

  // Dock scroll effect - disabled on mobile
  useEffect(() => {
    // Skip dock scroll on mobile
    if (isMobile) return

    const container = containerRef.current
    const dockContent = dockContentRef.current
    if (!container || !dockContent) return

    const pinnedHeight = '62vh'
    const unpinnedHeight = '38vh'
    const gestureEndDelay = 200 // ms after last wheel event to consider gesture ended

    // Find the actual scrollable element inside (ChatContainer's dock div)
    const getScrollable = () => dockContent.querySelector('[data-dock="true"]') as HTMLElement | null

    // Called when gesture ends (timer) or user starts new interaction (click/touch)
    const enableScroll = () => {
      // Only unlock if we were waiting for a new gesture after pinning
      if (waitingForNewGestureRef.current) {
        waitingForNewGestureRef.current = false
        window.__dockScrollLocked = false
      }
    }

    const handleWheel = (e: WheelEvent) => {
      const scrollable = getScrollable()
      const scrollingDown = e.deltaY > 0
      const scrollingUp = e.deltaY < 0
      const contentAtTop = !scrollable || scrollable.scrollTop <= 1

      // Reset gesture end timer on each wheel event
      if (waitingForNewGestureRef.current) {
        if (gestureEndTimerRef.current) clearTimeout(gestureEndTimerRef.current)
        gestureEndTimerRef.current = window.setTimeout(enableScroll, gestureEndDelay)
      }

      // Scroll down while unpinned → pin, lock scroll until gesture ends
      // Only allow pinning if there's content (conversation history) to show
      if (scrollingDown && !isPinnedRef.current && hasContentRef.current) {
        isPinnedRef.current = true
        waitingForNewGestureRef.current = true
        window.__dockScrollLocked = true
        container.style.setProperty('--dock-height', pinnedHeight)
        container.dataset.dockPinned = 'true'
        // Notify ChatContainer that dock is pinned (for compact mode)
        window.dispatchEvent(new CustomEvent('juice:dock-scroll', { detail: { enabled: true } }))
        // Start gesture end timer
        gestureEndTimerRef.current = window.setTimeout(enableScroll, gestureEndDelay)
        return
      }

      // Scroll up while at top and pinned → unpin and lock scroll briefly
      if (scrollingUp && contentAtTop && isPinnedRef.current) {
        isPinnedRef.current = false
        waitingForNewGestureRef.current = false
        if (gestureEndTimerRef.current) clearTimeout(gestureEndTimerRef.current)
        window.__dockScrollLocked = true
        container.style.setProperty('--dock-height', unpinnedHeight)
        delete container.dataset.dockPinned
        // Notify ChatContainer that dock is unpinned (for full mode)
        window.dispatchEvent(new CustomEvent('juice:dock-scroll', { detail: { enabled: false } }))
        // Unlock after animation completes
        gestureEndTimerRef.current = window.setTimeout(() => {
          window.__dockScrollLocked = false
        }, 200)
        return
      }
    }

    dockContent.addEventListener('wheel', handleWheel, { passive: true })
    dockContent.addEventListener('mousedown', enableScroll)
    dockContent.addEventListener('touchstart', enableScroll)
    return () => {
      dockContent.removeEventListener('wheel', handleWheel)
      dockContent.removeEventListener('mousedown', enableScroll)
      dockContent.removeEventListener('touchstart', enableScroll)
      if (gestureEndTimerRef.current) clearTimeout(gestureEndTimerRef.current)
      window.__dockScrollLocked = false
    }
  }, [isMobile])

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden border-t-4 border-juice-orange"
      style={{ '--dock-height': '38vh' } as React.CSSProperties}
    >
      {/* Recommendations - fills full area, extends behind mascot and dock */}
      <div className="absolute top-0 left-0 right-0 bottom-0 overflow-hidden">
        <Routes>
          <Route path="/" element={<MainContent topOnly forceActiveChatId={forceActiveChatId} />} />
          <Route path="*" element={<MainContent topOnly forceActiveChatId={forceActiveChatId} />} />
        </Routes>
      </div>

      {/* Mascot panel - overlays recommendations with translucent background */}
      <div
        ref={mascotRef}
        className="hidden lg:flex lg:flex-col absolute right-0 w-[27.53%] z-20 border-l-4 border-juice-orange transition-[bottom] duration-150 ease-out"
        style={{ height: '62vh', bottom: 'var(--dock-height)' }}
      >
        <div className="flex-1 overflow-hidden">
          <MascotPanel
            onSuggestionClick={(text) => window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: text, newChat: true } }))}
          />
        </div>
      </div>

      {/* Bottom dock: scroll anywhere inside to slide up/down - translucent to show recommendations behind */}
      <div
        ref={dockRef}
        className={`absolute inset-x-0 bottom-0 z-30 flex flex-col backdrop-blur-md transition-[top] duration-150 ease-out border-t-4 border-juice-orange ${
          theme === 'dark' ? 'bg-juice-dark/75' : 'bg-white/75'
        }`}
        style={{ top: 'calc(100% - var(--dock-height))', bottom: 0 }}
      >
        {/* Dock content */}
        <div ref={dockContentRef} className="flex-1 overflow-hidden">
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
  const { activeChatId: storeActiveChatId, getActiveChat, pendingNewChat, pendingMessage } = useChatStore()
  const isMobile = useIsMobile()
  const [showMobileActivity, setShowMobileActivity] = useState(false)

  // Use forced value if provided, otherwise read from store
  const activeChatId = forceActiveChatId || storeActiveChatId
  const activeChat = getActiveChat()

  // Show chat mode if there's an active chat with messages OR if we're creating a new chat
  // pendingNewChat prevents flickering during the API call to create a new chat
  const hasMessages = pendingNewChat || (activeChat && activeChat.messages && activeChat.messages.length > 0)

  useEffect(() => {
    document.documentElement.className = theme
  }, [theme])


  // Handle project clicks from activity feed
  const handleActivityProjectClick = (query: string) => {
    // If there's an active chat with messages, start a new chat
    // Otherwise, send to the current (empty) chat context
    const newChat = hasMessages
    window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: query, newChat } }))
    if (isMobile) setShowMobileActivity(false) // Close activity on mobile after click
  }

  // Mobile layout: chat-first, activity toggleable
  if (isMobile) {
    return (
      <div className={`h-screen overflow-hidden flex flex-col ${theme === 'dark' ? 'bg-juice-dark' : 'bg-white'}`}>
        <TransactionExecutor />
        <ActionExecutor />
        {/* Mobile header - only show when in chat mode (has messages) */}
        {hasMessages && (
          <div className="flex-shrink-0">
            <Header showActions />
          </div>
        )}
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
        {/* Mobile activity toggle removed - no activity panel on mobile */}
      </div>
    )
  }

  // Desktop layout: golden ratio with sidebar
  // Border structure: left + bottom on outer, top borders scroll with content for "hole" effect
  return (
    <div className={`h-screen overflow-hidden flex ${theme === 'dark' ? 'bg-juice-dark' : 'bg-white'}`}>
      {/* Transaction executor - listens for pay events */}
      <TransactionExecutor />
      {/* Action executor - listens for execute-action events (launch, queue, etc.) */}
      <ActionExecutor />

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
      {/* Uses border-4 so corners connect properly, min-width ensures readability */}
      <div className="hidden md:block w-[calc(38%*0.38)] min-w-[200px] h-full border-4 border-juice-orange">
        <ActivitySidebar onProjectClick={handleActivityProjectClick} />
      </div>
    </div>
  )
}

// Main chat app component (with hooks)
function MainApp() {
  // Pre-fetch pseudo-address from backend on mount (populates cache for all components)
  useEffect(() => {
    getSessionPseudoAddress()
  }, [])

  // Handle legacy hash URLs (e.g., /#/eth:3 -> /eth:3)
  useEffect(() => {
    const hash = window.location.hash
    if (hash.startsWith('#/')) {
      const path = hash.slice(1) // Remove the '#', keep the '/'
      window.history.replaceState(null, '', path)
      window.location.reload()
    }
  }, [])

  return (
    <ErrorBoundary>
      <EnvironmentBadge />
      <AppProviders>
        <BrowserRouter>
          <Routes>
            <Route path="/join/:code" element={<JoinChatPage />} />
            <Route path="/chat/:chatId" element={<ChatRouteHandler />} />
            <Route path="/:projectSlug" element={<ProjectRouteHandler />} />
            <Route path="/" element={<HomeRouteHandler />} />
            <Route path="*" element={<HomeRouteHandler />} />
          </Routes>
        </BrowserRouter>
      </AppProviders>
    </ErrorBoundary>
  )
}

export default function App() {
  // Check for admin subdomain first (dash.juicy.vision or ?admin=true)
  // This check happens before any hooks so it's safe
  if (shouldShowAdminDashboard()) {
    return (
      <ErrorBoundary>
        <Suspense fallback={
          <div className="min-h-screen flex items-center justify-center bg-zinc-950">
            <div className="w-8 h-8 border-2 border-juice-orange border-t-transparent rounded-full animate-spin" />
          </div>
        }>
          <AdminApp />
        </Suspense>
      </ErrorBoundary>
    )
  }

  return <MainApp />
}
