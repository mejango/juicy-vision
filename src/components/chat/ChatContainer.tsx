import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useChatStore, useSettingsStore, useThemeStore, LANGUAGES, type Message, type Attachment, type ChatMessage, type ChatMember } from '../../stores'
import { useAuthStore } from '../../stores/authStore'
// Title generation now happens on backend
import * as chatApi from '../../services/chat'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import WelcomeScreen from './WelcomeScreen'
import WelcomeGreeting from './WelcomeGreeting'
import ConversationHistory from './ConversationHistory'
import WalletInfo from './WalletInfo'
import { SettingsPanel, PrivacySelector } from '../settings'
import { stripComponents } from '../../utils/messageParser'
import InviteModal from './InviteModal'
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
  // Local streaming state (no longer in store)
  const [isStreaming, setIsStreaming] = useState(false)

  const { language, setLanguage } = useSettingsStore()
  const { theme, toggleTheme } = useThemeStore()
  const { isAuthenticated, user } = useAuthStore()
  const { isConnected: isWalletConnected } = useAccount()
  const { t } = useTranslation()
  const navigate = useNavigate()

  // Chat state
  const {
    activeChatId: storeActiveChatId,
    addChat,
    addMessage: addChatMessage,
    setMessages: setChatMessages,
    setMembers,
    setConnected,
    clearUnread,
  } = useChatStore()

  // Use forceActiveChatId (from URL) over store value to prevent race conditions
  // The store is updated in a useEffect which runs AFTER render, so the prop is more reliable
  const activeChatId = forceActiveChatId || storeActiveChatId

  // Get chat using the resolved activeChatId, not store's getActiveChat
  const activeChat = activeChatId
    ? useChatStore.getState().chats.find(c => c.id === activeChatId)
    : undefined
  const chatMessages = activeChat?.messages || []
  const members = activeChat?.members || []
  const isChatMode = !!activeChatId

  // Check if current user can write to this chat
  const sessionId = getSessionId()
  const currentAddress = getCurrentUserAddress()
  const currentUserMember = members.find(m =>
    m.userId === user?.id ||
    m.address === currentAddress ||
    (m.address && sessionId && m.address.toLowerCase().includes(sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40)))
  )
  const canWrite = isChatMode ? !!currentUserMember : true // Anyone can write to local chats

  const [error, setError] = useState<string | null>(null)
  const [isPromptStuck, setIsPromptStuck] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsAnchorPosition, setSettingsAnchorPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null)
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const [langMenuPosition, setLangMenuPosition] = useState<{ top: number; right: number } | null>(null)
  const langButtonRef = useRef<HTMLButtonElement | null>(null)
  const [showActionBar, setShowActionBar] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showAuthOptionsModal, setShowAuthOptionsModal] = useState(false)
  const [authModalContext, setAuthModalContext] = useState<'save' | 'connect'>('save')
  const [showWalletPanel, setShowWalletPanel] = useState(false)
  const [inviteChatId, setInviteChatId] = useState<string | null>(null)
  const [inviteChatName, setInviteChatName] = useState('')
  const [isCreatingInvite, setIsCreatingInvite] = useState(false)
  // Anchor positions for popovers
  const [inviteAnchorPosition, setInviteAnchorPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [saveAnchorPosition, setSaveAnchorPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [walletPanelAnchorPosition, setWalletPanelAnchorPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [passkeyWallet, setPasskeyWallet] = useState<PasskeyWallet | null>(() => getPasskeyWallet())
  const [showBetaPopover, setShowBetaPopover] = useState(false)
  const [betaPopoverPosition, setBetaPopoverPosition] = useState<'above' | 'below'>('above')
  const [betaAnchorPosition, setBetaAnchorPosition] = useState<{ top: number; bottom: number; right: number } | null>(null)
  const betaButtonRef = useRef<HTMLButtonElement | null>(null)

  // Close all popovers - call before opening a new one
  const closeAllPopovers = useCallback(() => {
    setShowInviteModal(false)
    setShowSaveModal(false)
    setShowAuthOptionsModal(false)
    setShowWalletPanel(false)
    setShowBetaPopover(false)
    setSettingsOpen(false)
  }, [])

  const abortControllerRef = useRef<AbortController | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const stickyPromptRef = useRef<HTMLDivElement | null>(null)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const lastScrollTop = useRef(0)

  // Convert chat messages to display format with sender info
  const displayMessages: Message[] = useMemo(() => {
    return chatMessages.map(msg => {
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
  }, [chatMessages, members, currentAddress])

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
    const currentChatId = forceActiveChatId || useChatStore.getState().activeChatId

    // Check write permissions for existing shared chats
    if (currentChatId && !canWrite) {
      setError('You do not have permission to send messages in this chat')
      return
    }

    setError(null)
    setIsStreaming(true)

    try {
      let chatId = currentChatId
      const isNewChat = !chatId

      // Create a new shared chat if we don't have one
      if (!chatId) {
        const newChat = await chatApi.createChat({
          name: 'New Chat',
          isPublic: false,
        })
        chatId = newChat.id

        // Add to shared chat store and set as active
        addChat(newChat)
        useChatStore.getState().setActiveChat(chatId)

        // Add optimistic user message BEFORE navigation to prevent flickering
        // This ensures the chat view shows the message immediately
        const optimisticMessage: ChatMessage = {
          id: `optimistic-${Date.now()}`,
          chatId,
          senderAddress: currentAddress,
          role: 'user',
          content,
          isEncrypted: false,
          createdAt: new Date().toISOString(),
        }
        addChatMessage(chatId, optimisticMessage)

        // Navigate to the chat URL
        navigate(`/chat/${chatId}`, { replace: true })
      }

      // Send the user's message through the shared chat API
      // This will broadcast via WebSocket to all connected clients
      // For new chats, the real message will replace the optimistic one
      await chatApi.sendMessage(chatId, content)

      // Invoke AI to respond - backend handles Claude API call and broadcasts response
      try {
        await chatApi.invokeAi(chatId, content)
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
  }, [forceActiveChatId, canWrite, navigate, addChat, addChatMessage, currentAddress])

  const handleSuggestionClick = (text: string) => {
    handleSend(text)
  }

  const handleExport = () => {
    if (messages.length === 0) return
    const title = activeChat?.name || 'Chat'
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
    setInviteChatName(activeChat?.name || 'Chat')
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

  // Load shared chat data and connect WebSocket when activeChatId changes
  useEffect(() => {
    if (!activeChatId) return

    let isMounted = true
    let cleanup: (() => void) | undefined

    async function loadSharedChat() {
      setError(null)

      try {
        // Fetch chat info if not already in store
        // Use direct store lookup with resolved activeChatId (not getActiveChat which uses store's activeChatId)
        const existingChat = useChatStore.getState().chats.find(c => c.id === activeChatId)
        if (!existingChat) {
          const chatInfo = await chatApi.fetchChat(activeChatId!)
          if (!isMounted) return
          addChat(chatInfo)
        }

        // Load messages
        const msgs = await chatApi.fetchMessages(activeChatId!)
        if (!isMounted) return
        setChatMessages(activeChatId!, msgs)

        // Load members
        const mbrs = await chatApi.fetchMembers(activeChatId!)
        if (!isMounted) return
        setMembers(activeChatId!, mbrs)

        // Clear unread count
        clearUnread(activeChatId!)
      } catch (err) {
        if (!isMounted) return
        console.error('Failed to load shared chat:', err)
        setError(err instanceof Error ? err.message : 'Failed to load chat')
        return
      }

      if (!isMounted) return

      // Connect WebSocket for real-time updates
      chatApi.connectToChat(activeChatId!)
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
          const chat = useChatStore.getState().chats.find(c => c.id === chatId)
          const existingMsg = chat?.messages?.find(m => m.id === messageId)

          if (existingMsg) {
            useChatStore.getState().updateMessage(chatId, messageId, { content, isStreaming: true })
          } else {
            // Create placeholder message for streaming
            const assistantAddress = '0x0000000000000000000000000000000000000000'
            addChatMessage(chatId, {
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
      cleanup = chatApi.onWsMessage((msg) => {
        if (!isMounted) return
        if (msg.chatId !== activeChatId) return

        const targetChatId = msg.chatId // Use the message's chatId, not the closure

        switch (msg.type) {
          case 'message':
            addChatMessage(targetChatId, msg.data as ChatMessage)
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
              useChatStore.getState().updateMessage(targetChatId, messageId, { isStreaming: false })
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
            const joinedMember = msg.data as ChatMember
            useChatStore.getState().addMember(targetChatId, joinedMember)
            break
          case 'member_left':
            const leftData = msg.data as { address: string }
            useChatStore.getState().removeMember(targetChatId, leftData.address)
            break
          case 'chat_update': {
            // Handle chat metadata updates (e.g., auto-generated title)
            const updates = msg.data as { autoGeneratedTitle?: string; name?: string }
            useChatStore.getState().updateChat(targetChatId, updates)
            break
          }
        }
      })
    }

    loadSharedChat()

    return () => {
      isMounted = false
      cleanup?.()
      chatApi.disconnectFromChat()
      setConnected(false)
    }
  }, [activeChatId, setChatMessages, setMembers, addChatMessage, setConnected, clearUnread, addChat])

  // Listen for wallet panel open events - show wallet panel if connected, auth options if not
  useEffect(() => {
    const handleOpenWalletPanel = (event: CustomEvent<{ anchorPosition?: { top: number; left: number; width: number; height: number } }>) => {
      // Toggle behavior: if wallet panel is already open, close it
      if (showWalletPanel) {
        setShowWalletPanel(false)
        return
      }

      closeAllPopovers()
      if (event.detail?.anchorPosition) {
        setWalletPanelAnchorPosition(event.detail.anchorPosition)
      }
      if (isWalletConnected) {
        // Already connected - show wallet panel directly for top-up/balance
        setShowWalletPanel(true)
      } else {
        // Not connected - show auth options to connect first
        setAuthModalContext('connect')
        setShowAuthOptionsModal(true)
      }
    }
    window.addEventListener('juice:open-wallet-panel', handleOpenWalletPanel as EventListener)
    return () => {
      window.removeEventListener('juice:open-wallet-panel', handleOpenWalletPanel as EventListener)
    }
  }, [isWalletConnected, closeAllPopovers, showWalletPanel])

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
      closeAllPopovers()
      setSettingsOpen(true)
    }
    window.addEventListener('juice:open-settings', handleOpenSettings)
    return () => window.removeEventListener('juice:open-settings', handleOpenSettings)
  }, [closeAllPopovers])

  // Listen for action bar events from Header
  useEffect(() => {
    const onInvite = (e: Event) => {
      closeAllPopovers()
      const customEvent = e as CustomEvent<{ anchorPosition?: { top: number; left: number; width: number; height: number } }>
      setInviteAnchorPosition(customEvent.detail?.anchorPosition || null)
      handleInvite()
    }
    const onExport = () => handleExport()
    const onSave = (e: Event) => {
      closeAllPopovers()
      const customEvent = e as CustomEvent<{ anchorPosition?: { top: number; left: number; width: number; height: number } }>
      setSaveAnchorPosition(customEvent.detail?.anchorPosition || null)
      setShowSaveModal(true)
    }

    window.addEventListener('juice:action-invite', onInvite)
    window.addEventListener('juice:action-export', onExport)
    window.addEventListener('juice:action-save', onSave)
    return () => {
      window.removeEventListener('juice:action-invite', onInvite)
      window.removeEventListener('juice:action-export', onExport)
      window.removeEventListener('juice:action-save', onSave)
    }
  }, [handleInvite, handleExport, closeAllPopovers])

  // Listen for auth modal open events (from ChatInput connect button)
  useEffect(() => {
    const handleOpenAuthModal = () => {
      closeAllPopovers()
      setShowAuthOptionsModal(true)
    }
    window.addEventListener('juice:open-auth-modal', handleOpenAuthModal)
    return () => window.removeEventListener('juice:open-auth-modal', handleOpenAuthModal)
  }, [closeAllPopovers])

  // Detect when sticky prompt actually hits top of container
  useEffect(() => {
    const dock = dockRef.current
    const stickyPrompt = stickyPromptRef.current
    if (!dock || !stickyPrompt) return

    const handleScroll = () => {
      // Check if the sticky element has actually reached the top of the container
      const dockRect = dock.getBoundingClientRect()
      const promptRect = stickyPrompt.getBoundingClientRect()
      // Element is stuck when its top equals the container's top
      setIsPromptStuck(promptRect.top <= dockRect.top)
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

  // Update Beta popover position on scroll
  useEffect(() => {
    if (!showBetaPopover || !betaButtonRef.current) return

    const updatePosition = () => {
      const button = betaButtonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      const isInBottomHalf = rect.top > window.innerHeight / 2
      setBetaPopoverPosition(isInBottomHalf ? 'above' : 'below')
      setBetaAnchorPosition({
        top: rect.bottom + 8,
        bottom: window.innerHeight - rect.top + 8,
        right: window.innerWidth - rect.right
      })
    }

    // Update on any scroll event (capture phase to catch all scrolls)
    window.addEventListener('scroll', updatePosition, true)
    return () => window.removeEventListener('scroll', updatePosition, true)
  }, [showBetaPopover])

  // Update language menu position on scroll
  useEffect(() => {
    if (!langMenuOpen || !langButtonRef.current) return

    const updatePosition = () => {
      const button = langButtonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      setLangMenuPosition({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right
      })
    }

    // Update on any scroll event (capture phase to catch all scrolls)
    window.addEventListener('scroll', updatePosition, true)
    return () => window.removeEventListener('scroll', updatePosition, true)
  }, [langMenuOpen])

  // Update settings panel position on scroll
  useEffect(() => {
    if (!settingsOpen || !settingsButtonRef.current) return

    const updatePosition = () => {
      const button = settingsButtonRef.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      setSettingsAnchorPosition({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    }

    // Update on any scroll event (capture phase to catch all scrolls)
    window.addEventListener('scroll', updatePosition, true)
    return () => window.removeEventListener('scroll', updatePosition, true)
  }, [settingsOpen])

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
            {/* Welcome screen (recommendations) - fills full area, extends behind dock */}
            {(topOnly || (!topOnly && !bottomOnly)) && (
              <div className="absolute inset-0 overflow-hidden">
                <WelcomeScreen onSuggestionClick={handleSuggestionClick} />
              </div>
            )}

            {/* Prompt dock - only show if bottomOnly or neither specified */}
            {(bottomOnly || (!topOnly && !bottomOnly)) && (
              <div
                ref={dockRef}
                className={`${bottomOnly ? 'max-h-full overflow-y-auto' : 'absolute bottom-0 left-0 right-0 z-30 h-[38vh] border-t-4 border-juice-orange backdrop-blur-md overflow-y-auto ' + (theme === 'dark' ? 'bg-juice-dark/75' : 'bg-white/75')}`}
              >
                {/* Greeting */}
                <div className="h-[6vh] flex flex-col justify-end">
                  <WelcomeGreeting />
                </div>

                {/* Controls at top right of prompt area - scrolls away naturally */}
                <div className="flex justify-end px-6">
                    <div className="flex items-center gap-1">
                      {/* Language selector */}
                      <div className="relative">
                        <button
                          ref={langButtonRef}
                          onClick={(e) => {
                            if (!langMenuOpen) {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setLangMenuPosition({
                                top: rect.bottom + 4,
                                right: window.innerWidth - rect.right
                              })
                            }
                            setLangMenuOpen(!langMenuOpen)
                          }}
                          className={`px-2 py-1 transition-colors text-xs ${
                            theme === 'dark'
                              ? 'text-gray-400 hover:text-white'
                              : 'text-gray-500 hover:text-gray-900'
                          }`}
                          title="Change language"
                        >
                          {LANGUAGES.find(l => l.code === language)?.native || 'English'}
                        </button>
                        {langMenuOpen && langMenuPosition && createPortal(
                          <>
                            {/* Backdrop - catches clicks outside menu */}
                            <div
                              className="fixed inset-0 z-[99]"
                              onClick={() => setLangMenuOpen(false)}
                            />
                            <div className={`fixed py-1 shadow-lg border z-[100] ${
                              theme === 'dark'
                                ? 'bg-juice-dark border-white/20'
                                : 'bg-white border-gray-200'
                            }`}
                            style={{ top: langMenuPosition.top, right: langMenuPosition.right }}
                            >
                              {LANGUAGES.map(lang => (
                                <button
                                  key={lang.code}
                                  onClick={() => {
                                    setLanguage(lang.code)
                                    setLangMenuOpen(false)
                                  }}
                                  className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 whitespace-nowrap ${
                                    language === lang.code
                                      ? theme === 'dark' ? 'bg-white/10' : 'bg-gray-100'
                                      : ''
                                  } ${
                                    theme === 'dark'
                                      ? 'hover:bg-white/10 text-gray-300'
                                      : 'hover:bg-gray-100 text-gray-700'
                                  }`}
                                >
                                  <span>{lang.native}</span>
                                </button>
                              ))}
                            </div>
                          </>,
                          document.body
                        )}
                      </div>
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
                        ref={settingsButtonRef}
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          closeAllPopovers()
                          setSettingsAnchorPosition({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
                          setSettingsOpen(true)
                        }}
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
                  </div>

                {/* Sticky prompt area - only ChatInput stays pinned */}
                <div
                  ref={stickyPromptRef}
                  className={`sticky top-0 z-10 ${
                    isPromptStuck
                      ? theme === 'dark' ? 'bg-juice-dark/95 backdrop-blur-sm' : 'bg-white/95 backdrop-blur-sm'
                      : ''
                  }`}
                >
                  <ChatInput
                    onSend={handleSend}
                    disabled={isStreaming}
                    hideBorder={true}
                    hideWalletInfo={true}
                    compact={true}
                    placeholder={placeholder}
                  />
                </div>

                {/* Subtext and Beta tag row - scrolls away naturally */}
                <div className="flex items-center justify-between px-6">
                    {/* Subtext hint */}
                    <div className="flex gap-3">
                      <div className="w-[48px] shrink-0" />
                      <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                        {t('dock.askAbout', 'or ask about ecosystem projects and tools')}
                      </div>
                    </div>
                    {/* Beta tag - popover rendered at component root */}
                    <button
                      ref={betaButtonRef}
                      onClick={(e) => {
                        if (!showBetaPopover) {
                          closeAllPopovers()
                          const rect = e.currentTarget.getBoundingClientRect()
                          const isInBottomHalf = rect.top > window.innerHeight / 2
                          setBetaPopoverPosition(isInBottomHalf ? 'above' : 'below')
                          setBetaAnchorPosition({
                            top: rect.bottom + 8,
                            bottom: window.innerHeight - rect.top + 8,
                            right: window.innerWidth - rect.right
                          })
                        }
                        setShowBetaPopover(!showBetaPopover)
                      }}
                      className="px-2 py-0.5 text-xs font-semibold bg-transparent border border-yellow-400 text-yellow-400 hover:border-yellow-300 hover:text-yellow-300 transition-colors"
                    >
                      Beta
                    </button>
                  </div>
                {/* Wallet info - scrolls away naturally */}
                <div>
                  <WalletInfo />
                </div>

                {/* Conversation history */}
                <div className="pt-6 pb-8">
                  <ConversationHistory />
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Messages scrollable area - only show if topOnly or neither specified */}
            {/* Messages scroll under header (pt-[14.44vh]) and dock with padding at bottom */}
            {(topOnly || (!topOnly && !bottomOnly)) && (
              <div ref={messagesScrollRef} className="overflow-y-auto flex-1 relative pt-[14.44vh]">
                <MessageList messages={messages} isWaitingForResponse={isStreaming} />
                {/* Bottom padding so content can scroll under the dock */}
                <div className="h-[14.44vh]" />
              </div>
            )}

            {/* Input dock - fixed at bottom with translucency, grows upward */}
            {/* Min height: 38% of 38% of screen height = 14.44vh */}
            {(bottomOnly || (!topOnly && !bottomOnly)) && (
              <div
                className={`${bottomOnly ? 'h-full' : 'absolute bottom-0 left-0 right-0'} backdrop-blur-sm flex flex-col justify-end transition-all duration-75 ${
                  theme === 'dark' ? 'bg-juice-dark/80' : 'bg-white/80'
                }`}
              >
                {/* Theme & Settings row - above prompt, matches home page layout */}
                <div className={`flex justify-end px-6 items-center gap-1 transition-opacity duration-75 ${
                  showActionBar ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}>
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
                    ref={settingsButtonRef}
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      closeAllPopovers()
                      setSettingsAnchorPosition({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
                      setSettingsOpen(true)
                    }}
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

                {isChatMode && !canWrite ? (
                  // Read-only mode for viewers without write permissions
                  <div className={`px-6 py-4 text-center ${
                    theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    <p className="text-sm">{t('activeChat.readOnly', 'You are viewing this chat in read-only mode')}</p>
                  </div>
                ) : (
                  <ChatInput
                    onSend={handleSend}
                    disabled={isStreaming || (isChatMode && !canWrite)}
                    hideBorder={true}
                    hideWalletInfo={false}
                    compact={true}
                    placeholder={isChatMode ? t('activeChat.typeMessage', 'Type a message...') : placeholder}
                    showDockButtons={!isChatMode}
                    onSettingsClick={() => setSettingsOpen(true)}
                    walletInfoRightContent={
                      <button
                        ref={betaButtonRef}
                        onClick={(e) => {
                          if (!showBetaPopover) {
                            closeAllPopovers()
                            const rect = e.currentTarget.getBoundingClientRect()
                            const isInBottomHalf = rect.top > window.innerHeight / 2
                            setBetaPopoverPosition(isInBottomHalf ? 'above' : 'below')
                            setBetaAnchorPosition({
                              top: rect.bottom + 8,
                              bottom: window.innerHeight - rect.top + 8,
                              right: window.innerWidth - rect.right
                            })
                          }
                          setShowBetaPopover(!showBetaPopover)
                        }}
                        className="px-2 py-0.5 text-xs font-semibold bg-transparent border border-yellow-400 text-yellow-400 hover:border-yellow-300 hover:text-yellow-300 transition-colors"
                      >
                        Beta
                      </button>
                    }
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
      {/* All modals only render in bottomOnly or full mode to avoid duplicates */}
      {/* when topOnly and bottomOnly are both rendered in WelcomeLayout */}
      {!topOnly && (
        <>
          <SettingsPanel isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} anchorPosition={settingsAnchorPosition} />

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
              anchorPosition={inviteAnchorPosition}
            />
          )}

          {/* Local Share Modal removed - all chats are now server-synced */}

          {/* Save Modal - for wallet-connected users */}
          <SaveModal
            isOpen={showSaveModal}
            onClose={() => setShowSaveModal(false)}
            anchorPosition={saveAnchorPosition}
          />

          {/* Auth Options Modal - for users not connected with wallet */}
          <AuthOptionsModal
            isOpen={showAuthOptionsModal}
            onClose={() => setShowAuthOptionsModal(false)}
            onWalletClick={() => setShowWalletPanel(true)}
            onPasskeySuccess={handlePasskeySuccess}
            title={authModalContext === 'connect' ? t('auth.connectTitle', 'Connect') : undefined}
            description={authModalContext === 'connect' ? t('auth.connectDescription', 'Choose how to connect your account.') : undefined}
          />

          {/* Wallet Panel - for external wallet connection */}
          <WalletPanel
            isOpen={showWalletPanel}
            onClose={() => setShowWalletPanel(false)}
            anchorPosition={walletPanelAnchorPosition}
          />
        </>
      )}

      {/* Beta Popover - portaled to document.body to escape backdrop-filter containing block */}
      {!topOnly && showBetaPopover && betaAnchorPosition && createPortal(
        <>
          {/* Backdrop - catches clicks outside popover */}
          <div
            className="fixed inset-0 z-[99]"
            onClick={() => setShowBetaPopover(false)}
          />
          <div
            className={`fixed w-72 p-4 border shadow-xl z-[100] ${
              theme === 'dark'
                ? 'bg-juice-dark border-white/20'
                : 'bg-white border-gray-200'
            }`}
            style={betaPopoverPosition === 'above'
              ? { bottom: betaAnchorPosition.bottom, right: betaAnchorPosition.right }
              : { top: betaAnchorPosition.top, right: betaAnchorPosition.right }
            }
          >
          <button
            onClick={() => setShowBetaPopover(false)}
            className={`absolute top-2 right-2 p-1 transition-colors ${
              theme === 'dark' ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <h3 className={`text-sm font-semibold mb-2 pr-6 ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>
            {t('beta.title', "What's to come")}
          </h3>
          <p className={`text-xs leading-relaxed mb-2 ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`}>
            {t('beta.whatWeAreBuildingStart', "Fund anything by anyone. A Juicy AI interface for open internet money that anyone can program, powered by ")}
            <a
              href="https://juicebox.money"
              target="_blank"
              rel="noopener noreferrer"
              className={theme === 'dark' ? 'text-juice-cyan hover:underline' : 'text-teal-600 hover:underline'}
            >
              Juicebox
            </a>
            {t('beta.whatWeAreBuildingEnd', '.')}
          </p>
          <p className={`text-xs leading-relaxed mb-2 ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`}>
            {t('beta.whyBeta', "We're still working out the kinks. Expect bugs.")}
          </p>
          <p className={`text-xs leading-relaxed mb-3 ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`}>
            {t('beta.whenNotBeta', "We'll drop the beta tag when it just works.")}
          </p>
          <div className="flex justify-end">
            <button
              onClick={() => {
                setShowBetaPopover(false)
                window.dispatchEvent(new CustomEvent('juice:send-message', {
                  detail: { message: 'I want to pay project ID 1 (NANA)' }
                }))
              }}
              className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
                theme === 'dark'
                  ? 'border-juice-cyan text-juice-cyan hover:bg-juice-cyan/10'
                  : 'border-teal-600 text-teal-600 hover:bg-teal-50'
              }`}
            >
              {t('beta.payUs', 'Pay us')}
            </button>
          </div>
        </div>
        </>,
        document.body
      )}
    </div>
  )
}
