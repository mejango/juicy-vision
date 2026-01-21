import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useChatStore, useSettingsStore, useThemeStore, LANGUAGES, type Message, type Attachment } from '../../stores'
import { useAuthStore } from '../../stores/authStore'
import { useMultiChatStore, type MultiChatMessage, type MultiChatMember } from '../../stores/multiChatStore'
// Title generation now happens on backend
import * as multiChatApi from '../../services/multiChat'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import WelcomeScreen from './WelcomeScreen'
import WelcomeGreeting from './WelcomeGreeting'
import ConversationHistory from './ConversationHistory'
import WalletInfo from './WalletInfo'
import { SettingsPanel, PrivacySelector } from '../settings'
import { stripComponents } from '../../utils/messageParser'
import InviteModal from '../multiChat/InviteModal'
import LocalShareModal from './LocalShareModal'
import SaveModal from './SaveModal'
import AuthOptionsModal from './AuthOptionsModal'
// Migration no longer needed - all chats are on server
import { useAccount } from 'wagmi'
import { type PasskeyWallet, getPasskeyWallet } from '../../services/passkeyWallet'
import WalletPanel from '../wallet/WalletPanel'
import { getSessionId } from '../../services/session'

// Helper to get current user's pseudo-address (matches backend logic)
function getCurrentUserAddress(): string {
  const sessionId = getSessionId()
  return `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
}

// Convert messages to markdown format
function exportToMarkdown(messages: Message[], title: string): string {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  let md = `# ${title}\n\n`
  md += `*Exported on ${date}*\n\n---\n\n`

  for (const msg of messages) {
    const role = msg.role === 'user' ? '**You**' : '**Juicy**'
    // Strip juice-component tags for cleaner output
    const content = stripComponents(msg.content)
    md += `${role}:\n\n${content}\n\n---\n\n`
  }

  return md
}

// Trigger download of markdown file
function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

interface ChatContainerProps {
  topOnly?: boolean
  bottomOnly?: boolean
  forceActiveChatId?: string // Use this over store value to prevent race conditions
}

export default function ChatContainer({ topOnly, bottomOnly, forceActiveChatId }: ChatContainerProps = {}) {
  const {
    activeConversationId,
    getActiveConversation,
    isStreaming,
    setIsStreaming,
  } = useChatStore()

  const { language, setLanguage } = useSettingsStore()
  const { theme, toggleTheme } = useThemeStore()
  const { isAuthenticated, user } = useAuthStore()
  const { isConnected: isWalletConnected } = useAccount()
  const { t } = useTranslation()
  const navigate = useNavigate()

  // Multi-chat state
  const {
    activeChatId: storeActiveChatId,
    addChat,
    addMessage: addMultiChatMessage,
    setMessages: setMultiChatMessages,
    setMembers,
    setConnected,
    clearUnread,
  } = useMultiChatStore()

  // Use forceActiveChatId (from URL) over store value to prevent race conditions
  // The store is updated in a useEffect which runs AFTER render, so the prop is more reliable
  const activeChatId = forceActiveChatId || storeActiveChatId

  // Get chat using the resolved activeChatId, not store's getActiveChat
  const multiChat = activeChatId
    ? useMultiChatStore.getState().chats.find(c => c.id === activeChatId)
    : undefined
  const multiChatMessages = multiChat?.messages || []
  const members = multiChat?.members || []
  const isMultiChatMode = !!activeChatId

  // Check if current user can write to this chat
  const sessionId = getSessionId()
  const currentAddress = getCurrentUserAddress()
  const currentUserMember = members.find(m =>
    m.userId === user?.id ||
    m.address === currentAddress ||
    (m.address && sessionId && m.address.toLowerCase().includes(sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40)))
  )
  const canWrite = isMultiChatMode ? !!currentUserMember : true // Anyone can write to local chats

  const [error, setError] = useState<string | null>(null)
  const [isPromptStuck, setIsPromptStuck] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const [showActionBar, setShowActionBar] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showLocalShareModal, setShowLocalShareModal] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showAuthOptionsModal, setShowAuthOptionsModal] = useState(false)
  const [showWalletPanel, setShowWalletPanel] = useState(false)
  const [inviteChatId, setInviteChatId] = useState<string | null>(null)
  const [inviteChatName, setInviteChatName] = useState('')
  const [isCreatingInvite, setIsCreatingInvite] = useState(false)
  const [passkeyWallet, setPasskeyWallet] = useState<PasskeyWallet | null>(() => getPasskeyWallet())
  const abortControllerRef = useRef<AbortController | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const lastScrollTop = useRef(0)

  const conversation = getActiveConversation()
  const localMessages = conversation?.messages || []

  // Convert multi-chat messages to display format with sender info
  const displayMessages: Message[] = useMemo(() => {
    if (isMultiChatMode && multiChatMessages.length > 0) {
      return multiChatMessages.map(msg => {
        const sender = members.find(m => m.address === msg.senderAddress)
        const isCurrentUser = msg.senderAddress === currentAddress

        // Determine sender display name:
        // - "You" for the current user (regardless of connection status)
        // - Display name if member has one
        // - "Anonymous" for other users without names
        let senderName: string
        if (isCurrentUser) {
          senderName = 'You'
        } else if (sender?.displayName) {
          senderName = sender.displayName
        } else {
          senderName = 'Anonymous'
        }

        return {
          id: msg.id,
          role: msg.role,
          content: msg.content,
          // Add sender info for user messages to distinguish participants
          senderName: msg.role === 'user' ? senderName : undefined,
          senderAddress: msg.role === 'user' ? msg.senderAddress : undefined,
          createdAt: msg.createdAt,
          isStreaming: msg.isStreaming,
        } as Message
      })
    }
    return localMessages
  }, [isMultiChatMode, multiChatMessages, localMessages, members, currentAddress])

  // Use display messages for everything
  const messages = displayMessages

  // Count assistant messages to trigger placeholder change only on new bot responses
  const assistantMessageCount = messages.filter(m => m.role === 'assistant').length

  // Contextual placeholder - "juicy vision" for homepage, conversational nudges for active chat
  // Only changes when a new assistant message arrives, not on every render
  const placeholder = useMemo(() => {
    if (messages.length === 0) {
      return t('placeholders.juicyVision', "What's your juicy vision?")
    }
    // Pick from contextual placeholders that nudge forward
    const contextualKeys = [
      'contextualPlaceholders.yourCall',
      'contextualPlaceholders.whatNext',
      'contextualPlaceholders.anythingElse',
      'contextualPlaceholders.goOn',
      'contextualPlaceholders.keepGoing',
      'contextualPlaceholders.whatElse',
      'contextualPlaceholders.continue',
      'contextualPlaceholders.tellMeMore',
      'contextualPlaceholders.and',
    ]
    const key = contextualKeys[Math.floor(Math.random() * contextualKeys.length)]
    return t(key, 'Continue...')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantMessageCount, t])

  const handleSend = useCallback(async (content: string, attachments?: Attachment[]) => {
    // IMPORTANT: Read chatId at execution time, not from closure
    // The forceActiveChatId prop is the most reliable source (comes from URL)
    // Fall back to store only if prop is not available
    const currentChatId = forceActiveChatId || useMultiChatStore.getState().activeChatId

    // Check write permissions for existing multi-chats
    if (currentChatId && !canWrite) {
      setError('You do not have permission to send messages in this chat')
      return
    }

    setError(null)
    setIsStreaming(true)

    try {
      let chatId = currentChatId
      const isNewChat = !chatId

      // Create a new multi-chat if we don't have one
      if (!chatId) {
        const newChat = await multiChatApi.createChat({
          name: 'New Chat',
          isPublic: false,
        })
        chatId = newChat.id

        // Add to multi-chat store and set as active
        addChat(newChat)
        useMultiChatStore.getState().setActiveChat(chatId)

        // Add optimistic user message BEFORE navigation to prevent flickering
        // This ensures the chat view shows the message immediately
        const optimisticMessage: MultiChatMessage = {
          id: `optimistic-${Date.now()}`,
          chatId,
          senderAddress: currentAddress,
          role: 'user',
          content,
          isEncrypted: false,
          createdAt: new Date().toISOString(),
        }
        addMultiChatMessage(chatId, optimisticMessage)

        // Navigate to the chat URL
        navigate(`/chat/${chatId}`, { replace: true })
      }

      // Send the user's message through the multi-chat API
      // This will broadcast via WebSocket to all connected clients
      // For new chats, the real message will replace the optimistic one
      await multiChatApi.sendMessage(chatId, content)

      // Invoke AI to respond - backend handles Claude API call and broadcasts response
      try {
        await multiChatApi.invokeAi(chatId, content)
      } catch (aiErr) {
        console.error('Failed to invoke AI:', aiErr)
        // Don't set error - the user message was sent successfully
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setIsStreaming(false)
    }
  }, [forceActiveChatId, canWrite, navigate, addChat, addMultiChatMessage, currentAddress])

  const handleSuggestionClick = (text: string) => {
    handleSend(text)
  }

  const handleExport = () => {
    if (messages.length === 0) return
    // Use multi-chat name or local conversation title
    const title = multiChat?.name || conversation?.title || 'Chat'
    const md = exportToMarkdown(messages, title)
    const filename = `${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`
    downloadMarkdown(md, filename)
  }

  // Share chat - all chats are now on server, just open invite modal
  const handleInvite = () => {
    if (!activeChatId) {
      setError('Start a conversation first to share it')
      return
    }

    setInviteChatId(activeChatId)
    setInviteChatName(multiChat?.name || 'Chat')
    setShowInviteModal(true)
  }

  // Handle successful passkey wallet creation/authentication
  const handlePasskeySuccess = (wallet: PasskeyWallet) => {
    setPasskeyWallet(wallet)
    // Could trigger additional actions here like saving the current chat
  }

  // Listen for passkey wallet connect/disconnect events
  useEffect(() => {
    const handlePasskeyChange = () => {
      setPasskeyWallet(getPasskeyWallet())
    }
    window.addEventListener('juice:passkey-connected', handlePasskeyChange)
    window.addEventListener('juice:passkey-disconnected', handlePasskeyChange)
    return () => {
      window.removeEventListener('juice:passkey-connected', handlePasskeyChange)
      window.removeEventListener('juice:passkey-disconnected', handlePasskeyChange)
    }
  }, [])

  // Load multi-chat data and connect WebSocket when activeChatId changes
  useEffect(() => {
    if (!activeChatId) return

    let isMounted = true
    let cleanup: (() => void) | undefined

    async function loadMultiChat() {
      setError(null)

      try {
        // Fetch chat info if not already in store
        // Use direct store lookup with resolved activeChatId (not getActiveChat which uses store's activeChatId)
        const existingChat = useMultiChatStore.getState().chats.find(c => c.id === activeChatId)
        if (!existingChat) {
          const chatInfo = await multiChatApi.fetchChat(activeChatId!)
          if (!isMounted) return
          addChat(chatInfo)
        }

        // Load messages
        const msgs = await multiChatApi.fetchMessages(activeChatId!)
        if (!isMounted) return
        setMultiChatMessages(activeChatId!, msgs)

        // Load members
        const mbrs = await multiChatApi.fetchMembers(activeChatId!)
        if (!isMounted) return
        setMembers(activeChatId!, mbrs)

        // Clear unread count
        clearUnread(activeChatId!)
      } catch (err) {
        if (!isMounted) return
        console.error('Failed to load multi-chat:', err)
        setError(err instanceof Error ? err.message : 'Failed to load chat')
        return
      }

      if (!isMounted) return

      // Connect WebSocket for real-time updates
      multiChatApi.connectToChat(activeChatId!)
      setConnected(true)

      // Track streaming messages with buffered content
      // Store both content and chatId to avoid closure issues with async updates
      const streamingMessages = new Map<string, { content: string; chatId: string }>()
      const pendingUpdates = new Map<string, { content: string; chatId: string }>()
      let updateScheduled = false

      // Batch DOM updates for smooth streaming - flush every 50ms
      const flushUpdates = () => {
        if (pendingUpdates.size === 0) return
        pendingUpdates.forEach(({ content, chatId }, messageId) => {
          const chat = useMultiChatStore.getState().chats.find(c => c.id === chatId)
          const existingMsg = chat?.messages?.find(m => m.id === messageId)

          if (existingMsg) {
            useMultiChatStore.getState().updateMessage(chatId, messageId, { content, isStreaming: true })
          } else {
            // Create placeholder message for streaming
            const assistantAddress = '0x0000000000000000000000000000000000000000'
            addMultiChatMessage(chatId, {
              id: messageId,
              chatId: chatId,
              senderAddress: assistantAddress,
              role: 'assistant',
              content: content,
              isEncrypted: false,
              createdAt: new Date().toISOString(),
              isStreaming: true,
            })
          }
        })
        pendingUpdates.clear()
        updateScheduled = false
      }

      const scheduleUpdate = () => {
        if (!updateScheduled) {
          updateScheduled = true
          setTimeout(flushUpdates, 50) // Batch updates every 50ms for smoother rendering
        }
      }

      // Handle WebSocket messages
      // IMPORTANT: Use msg.chatId from the message itself, not the closure-captured activeChatId
      // This prevents race conditions when navigating between chats
      cleanup = multiChatApi.onWsMessage((msg) => {
        if (!isMounted) return
        if (msg.chatId !== activeChatId) return

        const targetChatId = msg.chatId // Use the message's chatId, not the closure

        switch (msg.type) {
          case 'message':
            addMultiChatMessage(targetChatId, msg.data as MultiChatMessage)
            break
          case 'ai_response': {
            // Handle streaming AI response tokens with buffering
            const { messageId, token, isDone } = msg.data as { messageId: string; token: string; isDone: boolean }

            if (isDone) {
              // Streaming complete - flush final content and remove from tracking
              if (pendingUpdates.has(messageId)) {
                flushUpdates()
              }
              streamingMessages.delete(messageId)
              // Mark message as no longer streaming
              useMultiChatStore.getState().updateMessage(targetChatId, messageId, { isStreaming: false })
            } else {
              // Accumulate tokens in buffer - store chatId with content to avoid closure issues
              const existing = streamingMessages.get(messageId)
              const currentContent = existing?.content || ''
              const newContent = currentContent + token
              streamingMessages.set(messageId, { content: newContent, chatId: targetChatId })
              pendingUpdates.set(messageId, { content: newContent, chatId: targetChatId })
              scheduleUpdate()
            }
            break
          }
          case 'member_joined':
            const joinedMember = msg.data as MultiChatMember
            useMultiChatStore.getState().addMember(targetChatId, joinedMember)
            break
          case 'member_left':
            const leftData = msg.data as { address: string }
            useMultiChatStore.getState().removeMember(targetChatId, leftData.address)
            break
        }
      })
    }

    loadMultiChat()

    return () => {
      isMounted = false
      cleanup?.()
      multiChatApi.disconnectFromChat()
      setConnected(false)
    }
  }, [activeChatId, setMultiChatMessages, setMembers, addMultiChatMessage, setConnected, clearUnread, addChat])

  // Listen for wallet panel open events
  useEffect(() => {
    const handleOpenWalletPanel = () => {
      setShowWalletPanel(true)
    }
    window.addEventListener('juice:open-wallet-panel', handleOpenWalletPanel)
    return () => {
      window.removeEventListener('juice:open-wallet-panel', handleOpenWalletPanel)
    }
  }, [])

  // Listen for messages from dynamic components (e.g., recommendation chips)
  // Only listen if we're the instance with the input (bottomOnly or neither specified)
  // This prevents duplicate message handling when split into topOnly/bottomOnly
  useEffect(() => {
    // Skip if we're topOnly (no input to handle messages)
    if (topOnly) return

    const handleComponentMessage = (event: CustomEvent<{ message: string }>) => {
      if (event.detail?.message) {
        handleSend(event.detail.message)
      }
    }

    window.addEventListener('juice:send-message', handleComponentMessage as EventListener)
    return () => {
      window.removeEventListener('juice:send-message', handleComponentMessage as EventListener)
    }
  }, [handleSend, topOnly])

  // Listen for settings open events (from LocalShareModal sign in button)
  useEffect(() => {
    const handleOpenSettings = () => {
      setSettingsOpen(true)
    }
    window.addEventListener('juice:open-settings', handleOpenSettings)
    return () => window.removeEventListener('juice:open-settings', handleOpenSettings)
  }, [])

  // Listen for action bar events from Header
  useEffect(() => {
    const onInvite = () => handleInvite()
    const onExport = () => handleExport()
    const onSave = () => setShowSaveModal(true)

    window.addEventListener('juice:action-invite', onInvite)
    window.addEventListener('juice:action-export', onExport)
    window.addEventListener('juice:action-save', onSave)
    return () => {
      window.removeEventListener('juice:action-invite', onInvite)
      window.removeEventListener('juice:action-export', onExport)
      window.removeEventListener('juice:action-save', onSave)
    }
  }, [handleInvite, handleExport])

  // Listen for auth modal open events (from ChatInput connect button)
  useEffect(() => {
    const handleOpenAuthModal = () => {
      setShowAuthOptionsModal(true)
    }
    window.addEventListener('juice:open-auth-modal', handleOpenAuthModal)
    return () => window.removeEventListener('juice:open-auth-modal', handleOpenAuthModal)
  }, [])

  // Detect when dock is scrolled to show background on sticky prompt
  useEffect(() => {
    const dock = dockRef.current
    if (!dock) return

    const handleScroll = () => {
      // Show background when scrolled more than a few pixels
      setIsPromptStuck(dock.scrollTop > 10)
    }

    dock.addEventListener('scroll', handleScroll)
    return () => dock.removeEventListener('scroll', handleScroll)
  }, [messages.length])

  // Show/hide action bar based on scroll direction
  // Also dispatch event for header to shrink/expand
  useEffect(() => {
    const container = messagesScrollRef.current
    if (!container) return

    const handleScroll = () => {
      const currentScrollTop = container.scrollTop
      const isScrollingDown = currentScrollTop > lastScrollTop.current

      // Use same threshold as header (50px) - both compact/hide together
      const shouldCompact = isScrollingDown && currentScrollTop > 50
      setShowActionBar(!shouldCompact)
      lastScrollTop.current = currentScrollTop

      // Dispatch event for header to shrink when scrolling down, expand when scrolling up
      window.dispatchEvent(new CustomEvent('juice:scroll-direction', {
        detail: { isScrollingDown, scrollTop: currentScrollTop }
      }))
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [messages.length])

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* Main content area - chips, mascot, messages, input */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Error banner */}
        {error && (
          <div className="bg-red-500/20 border-b border-red-500/50 px-4 py-2 text-red-300 text-sm shrink-0 flex justify-between items-center">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {messages.length === 0 ? (
          <>
            {/* Welcome screen (recommendations) - only show if topOnly or neither specified */}
            {(topOnly || (!topOnly && !bottomOnly)) && (
              <div className="flex-1 overflow-hidden">
                <WelcomeScreen onSuggestionClick={handleSuggestionClick} />
              </div>
            )}

            {/* Prompt dock - only show if bottomOnly or neither specified */}
            {(bottomOnly || (!topOnly && !bottomOnly)) && (
              <div
                ref={dockRef}
                className={`${bottomOnly ? 'h-full' : 'absolute bottom-0 left-0 right-0 z-30 h-[38%] border-t-4 border-juice-orange'} overflow-y-auto backdrop-blur-md relative ${
                  theme === 'dark' ? 'bg-juice-dark/75' : 'bg-white/75'
                }`}
              >
                {/* Beta tag - top left, aligned with attachment button */}
                <div className="absolute top-3 left-6 z-50">
                  <span className="px-2 py-0.5 text-xs font-semibold bg-juice-orange text-juice-dark">
                    Beta
                  </span>
                </div>

                {/* Theme, Settings & Language controls - top right */}
                <div className="absolute top-3 right-4 flex items-center gap-1 z-50">
                  {/* Language selector */}
                  <div className="relative">
                    <button
                      onClick={() => setLangMenuOpen(!langMenuOpen)}
                      className={`px-2 py-1 text-xs transition-colors ${
                        theme === 'dark'
                          ? 'text-gray-400 hover:text-white'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      {LANGUAGES.find(l => l.code === language)?.native || 'English'}
                    </button>
                    {langMenuOpen && (
                      <div
                        className={`absolute top-full right-0 mt-1 py-1 border shadow-lg ${
                          theme === 'dark'
                            ? 'bg-juice-dark border-white/20'
                            : 'bg-white border-gray-200'
                        }`}
                        onMouseLeave={() => setLangMenuOpen(false)}
                      >
                        {LANGUAGES.map(lang => (
                          <button
                            key={lang.code}
                            onClick={() => {
                              setLanguage(lang.code)
                              setLangMenuOpen(false)
                            }}
                            className={`w-full px-4 py-2 text-sm text-left whitespace-nowrap transition-colors ${
                              language === lang.code
                                ? theme === 'dark'
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-green-50 text-green-700'
                                : theme === 'dark'
                                  ? 'text-white/80 hover:bg-white/10'
                                  : 'text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            {lang.native}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Privacy mode */}
                  <PrivacySelector />
                  {/* Theme toggle */}
                  <button
                    onClick={toggleTheme}
                    className={`p-1.5 transition-colors ${
                      theme === 'dark'
                        ? 'text-gray-400 hover:text-white'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  >
                    {theme === 'dark' ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                    )}
                  </button>
                  {/* Settings */}
                  <button
                    onClick={() => setSettingsOpen(true)}
                    className={`p-1.5 transition-colors ${
                      theme === 'dark'
                        ? 'text-gray-400 hover:text-white'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    title="Settings"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>

                {/* Spacer to position prompt at 38% from top (golden ratio) - includes greeting */}
                {/* Subtracts 1rem for ChatInput's py-4 top padding */}
                <div className="h-[calc(38%-1rem)] flex flex-col justify-end">
                  <WelcomeGreeting />
                </div>
                {/* Prompt bar sticks at top when scrolled - background only when stuck */}
                <div className={`sticky top-0 z-10 pt-4 transition-colors ${
                  isPromptStuck
                    ? theme === 'dark' ? 'bg-juice-dark/95 backdrop-blur-sm' : 'bg-white/95 backdrop-blur-sm'
                    : ''
                }`}>
                  <ChatInput
                    onSend={handleSend}
                    disabled={isStreaming}
                    hideBorder={true}
                    hideWalletInfo={true}
                    compact={true}
                    placeholder={placeholder}
                  />
                </div>
                {/* Subtext hint - scrolls with content */}
                <div className="flex gap-3 px-6 pb-4">
                  <div className="w-[48px] shrink-0" />
                  <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    {t('dock.askAbout', 'or ask about any juicebox ecosystem project')}
                  </div>
                </div>
                {/* Wallet info and conversation history scroll */}
                <WalletInfo />
                <ConversationHistory />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Messages scrollable area - only show if topOnly or neither specified */}
            {/* Messages scroll under header (pt-[14.44vh]) and dock with padding at bottom */}
            {(topOnly || (!topOnly && !bottomOnly)) && (
              <div ref={messagesScrollRef} className="overflow-y-auto flex-1 relative pt-[14.44vh]">
                <MessageList messages={messages} />
                {/* Bottom padding so content can scroll under the dock */}
                <div className="h-[14.44vh]" />
              </div>
            )}

            {/* Input dock - fixed at bottom with translucency, grows upward */}
            {/* Min height: 38% of 38% of screen height = 14.44vh */}
            {(bottomOnly || (!topOnly && !bottomOnly)) && (
              <div
                className={`${bottomOnly ? 'h-full' : 'absolute bottom-0 left-0 right-0 min-h-[14.44vh]'} backdrop-blur-sm flex flex-col justify-end ${
                  theme === 'dark' ? 'bg-juice-dark/80' : 'bg-white/80'
                }`}
              >
                {/* Theme & Settings controls - above input with margin, matching homepage style */}
                <div className="flex justify-end items-center gap-1 px-6 pb-3">
                  {/* Theme toggle */}
                  <button
                    onClick={toggleTheme}
                    className={`p-1.5 transition-colors ${
                      theme === 'dark'
                        ? 'text-gray-400 hover:text-white'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  >
                    {theme === 'dark' ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                    )}
                  </button>
                  {/* Settings */}
                  <button
                    onClick={() => setSettingsOpen(true)}
                    className={`p-1.5 transition-colors ${
                      theme === 'dark'
                        ? 'text-gray-400 hover:text-white'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                    title="Settings"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>

                {isMultiChatMode && !canWrite ? (
                  // Read-only mode for viewers without write permissions
                  <div className={`px-6 py-4 text-center ${
                    theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    <p className="text-sm">{t('multiChat.readOnly', 'You are viewing this chat in read-only mode')}</p>
                  </div>
                ) : (
                  <ChatInput
                    onSend={handleSend}
                    disabled={isStreaming || (isMultiChatMode && !canWrite)}
                    hideBorder={true}
                    hideWalletInfo={false}
                    compact={true}
                    placeholder={isMultiChatMode ? t('multiChat.typeMessage', 'Type a message...') : placeholder}
                    showDockButtons={!isMultiChatMode}
                    onSettingsClick={() => setSettingsOpen(true)}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
      <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Invite Modal - for authenticated users with server-side chats */}
      {inviteChatId && (
        <InviteModal
          isOpen={showInviteModal}
          onClose={() => {
            setShowInviteModal(false)
            setInviteChatId(null)
          }}
          chatId={inviteChatId}
          chatName={inviteChatName}
          canGrantAdmin={true}
          canGrantInvitePermission={true}
        />
      )}

      {/* Local Share Modal - for unauthenticated users */}
      {activeConversationId && (
        <LocalShareModal
          isOpen={showLocalShareModal}
          onClose={() => setShowLocalShareModal(false)}
          conversationId={activeConversationId}
          conversationTitle={conversation?.title || 'Chat'}
        />
      )}

      {/* Save Modal - for wallet-connected users */}
      <SaveModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
      />

      {/* Auth Options Modal - for users not connected with wallet */}
      <AuthOptionsModal
        isOpen={showAuthOptionsModal}
        onClose={() => setShowAuthOptionsModal(false)}
        onWalletClick={() => setShowWalletPanel(true)}
        onPasskeySuccess={handlePasskeySuccess}
      />

      {/* Wallet Panel - for external wallet connection */}
      <WalletPanel
        isOpen={showWalletPanel}
        onClose={() => setShowWalletPanel(false)}
      />
    </div>
  )
}
