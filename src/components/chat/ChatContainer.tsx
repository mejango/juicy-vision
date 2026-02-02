import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useChatStore, useSettingsStore, useThemeStore, LANGUAGES, type Message, type Attachment, type ChatMessage, type ChatMember } from '../../stores'
import { useAuthStore } from '../../stores/authStore'
import * as chatApi from '../../services/chat'
import { useChatScroll, usePopoverPositioning, useChatActions } from './hooks'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import WelcomeScreen from './WelcomeScreen'
import WelcomeGreeting from './WelcomeGreeting'
import ConversationHistory from './ConversationHistory'
import ChatHistorySidebar from './ChatHistorySidebar'
import { useIsMobile } from '../../hooks'
import WalletInfo, { type JuicyIdentity } from './WalletInfo'
import { SettingsPanel, PrivacySelector } from '../settings'
import InviteModal from './InviteModal'
import SaveModal from './SaveModal'
import AuthOptionsModal from './AuthOptionsModal'
// Migration no longer needed - all chats are on server
import { useAccount } from 'wagmi'
import { type PasskeyWallet, getPasskeyWallet } from '../../services/passkeyWallet'
import WalletPanel from '../wallet/WalletPanel'
import { getSessionId, getCachedPseudoAddress, getSessionPseudoAddress, getCurrentUserAddress } from '../../services/session'
import { getWalletSession } from '../../services/siwe'
import { getEmojiFromAddress } from './ParticipantAvatars'

// getCurrentUserAddress is imported from session.ts - see that file for the
// priority logic: SIWE wallet > Smart account (managed mode) > Pseudo-address


interface ChatContainerProps {
  topOnly?: boolean
  bottomOnly?: boolean
  forceActiveChatId?: string // Use this over store value to prevent race conditions
}

export default function ChatContainer({ topOnly, bottomOnly, forceActiveChatId }: ChatContainerProps = {}) {
  // Local streaming state (no longer in store)
  const [isStreaming, setIsStreaming] = useState(false)
  // Track if we're waiting for AI response (between invokeAi call and first streaming token)
  // Uses store state so it persists across navigation (e.g., when creating new chats)
  const waitingForAiChatId = useChatStore(state => state.waitingForAiChatId)
  const setWaitingForAiChatId = useChatStore(state => state.setWaitingForAiChatId)

  const { language, setLanguage, privateMode, setPrivateMode } = useSettingsStore()
  const { theme, toggleTheme } = useThemeStore()
  const { isAuthenticated, user } = useAuthStore()
  const { isConnected: isWalletConnected } = useAccount()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()

  // Chat state
  const {
    activeChatId: storeActiveChatId,
    addChat,
    addMessage: addChatMessage,
    setMessages: setChatMessages,
    setMembers,
    setOnlineMembers,
    updatePresence,
    setConnected,
    clearUnread,
    updateMember,
    updateChat,
    removeChat,
    setActiveChat,
    setPendingNewChat,
    pendingNewChat,
    pendingMessage,
  } = useChatStore()

  // Use forceActiveChatId (from URL) over store value to prevent race conditions
  // The store is updated in a useEffect which runs AFTER render, so the prop is more reliable
  const activeChatId = forceActiveChatId || storeActiveChatId

  // Compute isWaitingForAi from store state
  const isWaitingForAi = waitingForAiChatId === activeChatId && !!activeChatId

  // Get chat using the resolved activeChatId, not store's getActiveChat
  // Filter out null entries that can occur during state cleanup
  const activeChat = activeChatId
    ? useChatStore.getState().chats.find(c => c && c.id === activeChatId)
    : undefined
  const chatMessages = activeChat?.messages || []
  const members = activeChat?.members || []
  const onlineMembers = activeChat?.onlineMembers || []
  const isChatMode = !!activeChatId

  // Check if current user can write to this chat
  const sessionId = getSessionId()
  const currentAddress = getCurrentUserAddress()
  const currentUserMember = members.find(m =>
    m.userId === user?.id ||
    m.address?.toLowerCase() === currentAddress?.toLowerCase() ||
    (m.address && sessionId && m.address.toLowerCase().includes(sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40)))
  )
  const canWrite = isChatMode ? !!currentUserMember : true // Anyone can write to local chats
  const canInvite = !isChatMode || // Anyone can invite in local mode
    currentUserMember?.role === 'founder' ||
    currentUserMember?.role === 'admin' ||
    currentUserMember?.canInvite === true

  // AI toggle state
  const [isTogglingAi, setIsTogglingAi] = useState(false)
  // Personal override: don't invoke AI on my messages (can't override admin OFF)
  const [personalAiSkip, setPersonalAiSkip] = useState(false)

  // AI toggle - global chat-level setting from server
  const chatAiEnabled = activeChat?.aiEnabled ?? true
  // User can toggle AI if they have canPauseAi permission
  const canPauseAi = !isChatMode || // Always enabled in local mode
    currentUserMember?.role === 'founder' ||
    currentUserMember?.canPauseAi === true

  // Effective AI state: global toggle AND personal preference
  // If global is OFF, AI is OFF regardless of personal preference
  // If global is ON, user can choose to skip AI on their messages
  const effectiveAiEnabled = chatAiEnabled && !personalAiSkip

  // Handle toggling the global AI state
  const handleToggleAi = useCallback(async () => {
    if (!activeChatId || !canPauseAi || isTogglingAi) return

    setIsTogglingAi(true)
    try {
      const newEnabled = !chatAiEnabled
      const updatedChat = await chatApi.toggleAiEnabled(activeChatId, newEnabled)
      updateChat(activeChatId, { aiEnabled: updatedChat.aiEnabled })
      // Auto-collapse if AI is enabled again and personal skip is off
      if (newEnabled && !personalAiSkip) {
        setAiControlsExpanded(false)
      }
    } catch (error) {
      console.error('Failed to toggle AI:', error)
    } finally {
      setIsTogglingAi(false)
    }
  }, [activeChatId, canPauseAi, isTogglingAi, chatAiEnabled, personalAiSkip, updateChat])

  // Handle member permission updates from popover
  const handleMemberUpdated = useCallback((updatedMember: ChatMember) => {
    if (activeChatId) {
      updateMember(activeChatId, updatedMember.address, updatedMember)
    }
  }, [activeChatId, updateMember])

  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsAnchorPosition, setSettingsAnchorPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null)
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const [langMenuPosition, setLangMenuPosition] = useState<{ top: number; right: number } | null>(null)
  const langButtonRef = useRef<HTMLButtonElement | null>(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [showAuthOptionsModal, setShowAuthOptionsModal] = useState(false)
  const [authModalContext, setAuthModalContext] = useState<'save' | 'connect'>('save')
  const [showWalletPanel, setShowWalletPanel] = useState(false)
  const [walletPanelInitialView, setWalletPanelInitialView] = useState<'select' | 'self_custody'>('select')
  const [inviteChatId, setInviteChatId] = useState<string | null>(null)
  const [inviteChatName, setInviteChatName] = useState('')
  const [isCreatingInvite, setIsCreatingInvite] = useState(false)
  // Anchor positions for popovers
  const [inviteAnchorPosition, setInviteAnchorPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [saveAnchorPosition, setSaveAnchorPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [walletPanelAnchorPosition, setWalletPanelAnchorPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [authModalAnchorPosition, setAuthModalAnchorPosition] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [passkeyWallet, setPasskeyWallet] = useState<PasskeyWallet | null>(() => getPasskeyWallet())
  // Current user's Juicy ID (for displaying their name instead of "You")
  // Initialize from localStorage cache to prevent flicker on remount
  const [currentUserIdentity, setCurrentUserIdentity] = useState<JuicyIdentity | null>(() => {
    try {
      const cached = localStorage.getItem('juicy-identity')
      return cached ? JSON.parse(cached) : null
    } catch { return null }
  })
  const [showBetaPopover, setShowBetaPopover] = useState(false)
  const [dockScrollEnabled, setDockScrollEnabled] = useState(false)
  const [betaPopoverPosition, setBetaPopoverPosition] = useState<'above' | 'below'>('above')
  const [betaAnchorPosition, setBetaAnchorPosition] = useState<{ top: number; bottom: number; right: number } | null>(null)
  const betaButtonRef = useRef<HTMLButtonElement | null>(null)
  const [isReporting, setIsReporting] = useState(false)
  const [reportSuccess, setReportSuccess] = useState(false)
  const [showAiPausedPopover, setShowAiPausedPopover] = useState(false)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [showHistorySidebar, setShowHistorySidebar] = useState(false)
  const [showOptionsMenu, setShowOptionsMenu] = useState(false)
  // AI controls expanded state - shows "Skip for all" and "Skip for you" toggles
  const [aiControlsExpanded, setAiControlsExpanded] = useState(false)
  // Track when AI gives empty response - show "Continue" button
  const [showContinueButton, setShowContinueButton] = useState(false)
  // Page-level drag state for file drop zone
  const [isPageDragging, setIsPageDragging] = useState(false)
  const dragCounterRef = useRef(0)

  // Page-level drag handlers for file attachments
  const handlePageDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer?.types?.includes('Files')) {
      setIsPageDragging(true)
    }
  }, [])

  const handlePageDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsPageDragging(false)
    }
  }, [])

  const handlePageDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handlePageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsPageDragging(false)
    dragCounterRef.current = 0

    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      // Dispatch event to ChatInput with the dropped files
      window.dispatchEvent(new CustomEvent('juice:files-dropped', {
        detail: { files: Array.from(files) }
      }))
    }
  }, [])

  // Close all popovers - call before opening a new one
  const closeAllPopovers = useCallback(() => {
    setShowInviteModal(false)
    setShowSaveModal(false)
    setShowAuthOptionsModal(false)
    setShowAiPausedPopover(false)
    setShowOverflowMenu(false)
    setShowOptionsMenu(false)
    setShowWalletPanel(false)
    setShowBetaPopover(false)
    setSettingsOpen(false)
  }, [])

  // Handle reporting a chat
  const handleReport = useCallback(async () => {
    const chatId = forceActiveChatId || useChatStore.getState().activeChatId
    if (!chatId || isReporting) return

    setIsReporting(true)
    try {
      await chatApi.reportChat(chatId)
      setReportSuccess(true)
      // Reset success state after 3 seconds
      setTimeout(() => setReportSuccess(false), 3000)
    } catch (error) {
      console.error('Failed to report chat:', error)
    } finally {
      setIsReporting(false)
    }
  }, [forceActiveChatId, isReporting])

  const abortControllerRef = useRef<AbortController | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const stickyPromptRef = useRef<HTMLDivElement | null>(null)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)

  // Scroll behavior hooks
  const { isPromptStuck, showActionBar } = useChatScroll({
    dockRef,
    stickyPromptRef,
    messagesScrollRef,
    hasMessages: chatMessages.length > 0 || pendingNewChat,
  })

  // Popover positioning on scroll
  usePopoverPositioning({
    settingsOpen,
    settingsButtonRef,
    setSettingsAnchorPosition,
    langMenuOpen,
    langButtonRef,
    setLangMenuPosition,
    showBetaPopover,
    betaButtonRef,
    setBetaPopoverPosition,
    setBetaAnchorPosition,
  })

  // Convert chat messages to display format with sender info
  const displayMessages: Message[] = useMemo(() => {
    const messages = chatMessages.map(msg => {
      const sender = members.find(m => m.address === msg.senderAddress)
      const isCurrentUser = msg.senderAddress === currentAddress

      // Determine sender display name:
      // - Juicy ID username for current user if they have one
      // - Show "Add your Juicy ID" prompt if current user has no Juicy ID
      // - ENS/display name if member has one
      // - Custom emoji or default fruit emoji for anonymous users
      let senderName: string | undefined
      let needsJuicyId = false
      if (isCurrentUser) {
        if (currentUserIdentity?.username) {
          senderName = currentUserIdentity.username
        } else {
          // No Juicy ID - show prompt to add one
          needsJuicyId = true
          senderName = undefined
        }
      } else if (sender?.displayName) {
        senderName = sender.displayName
      } else {
        // No display name - just show emoji indicator alone, no name text
        senderName = undefined
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
        attachments: msg.attachments,
        needsJuicyId: msg.role === 'user' && isCurrentUser ? needsJuicyId : undefined,
      } as Message
    })

    // Show pending message while creating new chat (instant feedback)
    if (pendingNewChat && pendingMessage && messages.length === 0) {
      messages.push({
        id: 'pending-message',
        role: 'user',
        content: pendingMessage,
        senderName: currentUserIdentity?.username,
        senderAddress: currentAddress,
        createdAt: new Date().toISOString(),
      } as Message)
    }

    return messages
  }, [chatMessages, members, currentAddress, currentUserIdentity, pendingNewChat, pendingMessage])

  // Use display messages for everything
  const messages = displayMessages

  // Check if any message is currently streaming
  const hasStreamingMessage = messages.some(m => m.isStreaming)

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

  const handleSend = useCallback(async (content: string, attachments?: Attachment[], bypassSkipAi?: boolean) => {
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
    setShowContinueButton(false) // Clear nudge button when user sends a new message

    const isNewChat = !currentChatId

    // For new chats: set pending state immediately to keep UI in chat mode
    // This prevents flickering between welcome and chat views during API call
    if (isNewChat) {
      setPendingNewChat(true, content)
    }

    try {
      let chatId = currentChatId

      // Create a new shared chat if we don't have one
      if (!chatId) {
        const newChat = await chatApi.createChat({
          name: 'New Chat',
          isPublic: false,
          isPrivate: privateMode, // Pass user's privacy preference
        })
        chatId = newChat.id

        addChat(newChat)
        useChatStore.getState().setActiveChat(chatId)

        // Navigate to the chat URL (keep pending state until message is added)
        navigate(`/chat/${chatId}`, { replace: true })
      }

      // Add optimistic user message for existing chats with attachments
      if (attachments && attachments.length > 0) {
        const optimisticMessage: ChatMessage = {
          id: `optimistic-${Date.now()}`,
          chatId,
          senderAddress: currentAddress || '0x0000000000000000000000000000000000000000',
          role: 'user',
          content,
          isEncrypted: false,
          createdAt: new Date().toISOString(),
          attachments: attachments,
        }
        addChatMessage(chatId, optimisticMessage)
      }

      // Send the user's message through the shared chat API
      // This will broadcast via WebSocket to all connected clients
      const attachmentData = attachments?.map(a => ({
        type: a.type,
        name: a.name,
        mimeType: a.mimeType,
        data: a.data,
      }))
      const savedMessage = await chatApi.sendMessage(chatId, content, undefined, attachmentData)

      // Always add the saved message to ensure sender sees it
      // This handles cases where WebSocket is reconnecting or temporarily disconnected
      // The store will dedupe if WebSocket also delivers it
      addChatMessage(chatId, savedMessage)

      // Clear pending state now that the real message is in the chat
      if (isNewChat) {
        setPendingNewChat(false)
      }

      // Invoke AI to respond - backend handles Claude API call and broadcasts response
      // Only invoke if AI is enabled for this chat (global toggle AND personal preference)
      // bypassSkipAi allows form submissions to always invoke AI even if user has "Skip AI" on
      const shouldInvokeAi = bypassSkipAi ? chatAiEnabled : effectiveAiEnabled
      if (shouldInvokeAi) {
        // Set waiting state NOW (after navigation for new chats, so state doesn't reset)
        // Uses store state so it persists across navigation
        setWaitingForAiChatId(chatId)
        try {
          await chatApi.invokeAi(chatId, content, attachmentData)
        } catch (aiErr) {
          console.error('Failed to invoke AI:', aiErr)
          setWaitingForAiChatId(null)
          // Don't set error - the user message was sent successfully
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      setError(err instanceof Error ? err.message : 'Failed to send message')
      setWaitingForAiChatId(null)
      // Clear pending state on error
      if (isNewChat) {
        setPendingNewChat(false)
      }
    } finally {
      setIsStreaming(false)
    }
  }, [forceActiveChatId, canWrite, navigate, addChat, addChatMessage, currentAddress, effectiveAiEnabled, chatAiEnabled, setPendingNewChat, privateMode])

  const handleSuggestionClick = (text: string) => {
    handleSend(text)
  }

  // Handle "Nudge" button when AI gives empty response - sends "nudge" as a user message
  const handleContinue = useCallback(async () => {
    setShowContinueButton(false)
    // Send "nudge" as a visible user message - AI understands this means to continue
    await handleSend('nudge')
  }, [handleSend])

  const handleExport = () => {
    if (messages.length === 0) return
    const title = activeChat?.name || 'Chat'

    // Convert messages to markdown
    const date = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    let md = `# ${title}\n\n`
    md += `*Exported on ${date}*\n\n---\n\n`
    for (const msg of messages) {
      const role = msg.role === 'user' ? '**You**' : '**Juicy**'
      md += `${role}:\n\n${msg.content}\n\n---\n\n`
    }

    // Trigger download
    const filename = `${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
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
  const handlePasskeySuccess = async () => {
    // Refresh passkey wallet state
    setPasskeyWallet(getPasskeyWallet())

    // Get the current chat ID at the time of sign-in
    const currentChatId = forceActiveChatId || useChatStore.getState().activeChatId

    // Fetch the Smart Account address for merge session
    const token = useAuthStore.getState().token
    if (!token) {
      console.log('[ChatContainer] No auth token after passkey success, skipping merge')
      return
    }

    let smartAccountAddress: string | null = null
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || ''
      const response = await fetch(`${API_BASE_URL}/wallet/address`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (response.ok && data.success) {
        smartAccountAddress = data.data.address
      }
    } catch (err) {
      console.error('[ChatContainer] Failed to fetch smart account address:', err)
    }

    if (!smartAccountAddress) {
      console.log('[ChatContainer] No smart account address, skipping merge')
      return
    }

    // Merge anonymous session chats to the connected account
    try {
      const result = await chatApi.mergeSession(smartAccountAddress)
      console.log('[ChatContainer] Session merge result:', result)

      // Refresh chat list to show merged chats
      if (result.mergedChatIds.length > 0) {
        const { chats } = await chatApi.fetchMyChats()
        // Update store with fresh chats from server
        chats.forEach(chat => {
          const existing = useChatStore.getState().chats.find(c => c.id === chat.id)
          if (!existing) {
            addChat(chat)
          }
        })
      }

      // Reconnect WebSocket with new credentials if we're in a chat
      if (currentChatId) {
        console.log('[ChatContainer] Reconnecting WebSocket after passkey auth')
        chatApi.disconnectFromChat()
        setTimeout(() => {
          chatApi.connectToChat(currentChatId)
        }, 100)
        // Refresh members and messages to reflect merged identity
        setTimeout(async () => {
          try {
            const mbrs = await chatApi.fetchMembers(currentChatId)
            setMembers(currentChatId, mbrs)
            // Also refresh messages since sender addresses were updated
            const msgs = await chatApi.fetchMessages(currentChatId)
            setChatMessages(currentChatId, msgs)
          } catch (err) {
            console.error('[ChatContainer] Failed to refresh data after passkey auth:', err)
          }
        }, 300)
      }
    } catch (err) {
      console.error('[ChatContainer] Failed to merge session:', err)
      // Don't show error to user - passkey wallet was created successfully
      // The merge failing isn't critical
    }
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

  // Listen for managed auth success (Touch ID login) to merge session
  useEffect(() => {
    const handleManagedAuthSuccess = () => {
      // Trigger session merge after managed passkey auth
      handlePasskeySuccess()
    }
    window.addEventListener('juice:managed-auth-success', handleManagedAuthSuccess)
    return () => {
      window.removeEventListener('juice:managed-auth-success', handleManagedAuthSuccess)
    }
  }, [])

  // Close auth modal when user becomes authenticated
  // This handles cases where the modal doesn't close properly after signup/login
  const isAuth = isAuthenticated()
  useEffect(() => {
    if (isAuth && showAuthOptionsModal) {
      setShowAuthOptionsModal(false)
    }
  }, [isAuth, showAuthOptionsModal])

  // Fetch current user's Juicy ID
  useEffect(() => {
    const fetchIdentity = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || ''
        const walletSession = getWalletSession()
        const authToken = useAuthStore.getState().token
        const headers: Record<string, string> = {
          'X-Session-ID': sessionId,
        }
        // Include managed auth token (Touch ID)
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`
        }
        if (walletSession?.token) {
          headers['X-Wallet-Session'] = walletSession.token
        }
        const res = await fetch(`${apiUrl}/identity/me`, { headers })
        if (res.ok) {
          const data = await res.json()
          if (data.success && data.data) {
            setCurrentUserIdentity(data.data)
            // Cache for instant display on remount
            try { localStorage.setItem('juicy-identity', JSON.stringify(data.data)) } catch {}
          }
        }
      } catch {
        // Ignore errors
      }
    }
    fetchIdentity()
  }, [sessionId, passkeyWallet?.address])

  // Listen for identity changes from other components
  useEffect(() => {
    const handleIdentityChange = (e: CustomEvent<JuicyIdentity>) => {
      setCurrentUserIdentity(e.detail)
    }
    window.addEventListener('juice:identity-changed', handleIdentityChange as EventListener)
    return () => window.removeEventListener('juice:identity-changed', handleIdentityChange as EventListener)
  }, [])

  // Listen for SIWE wallet sign-in events and merge sessions
  useEffect(() => {
    const handleSiweSignIn = async (event: CustomEvent<{ address: string }>) => {
      const { address } = event.detail
      if (!address) return

      // Get the current chat ID at the time of sign-in
      const currentChatId = forceActiveChatId || useChatStore.getState().activeChatId

      try {
        const result = await chatApi.mergeSession(address)
        console.log('[ChatContainer] SIWE session merge result:', result)

        // Refresh chat list to show merged chats
        if (result.mergedChatIds.length > 0) {
          const { chats } = await chatApi.fetchMyChats()
          chats.forEach(chat => {
            const existing = useChatStore.getState().chats.find(c => c.id === chat.id)
            if (!existing) {
              addChat(chat)
            }
          })
        }

        // Reconnect WebSocket with new SIWE credentials if we're in a chat
        if (currentChatId) {
          console.log('[ChatContainer] Reconnecting WebSocket with SIWE credentials')
          chatApi.disconnectFromChat()
          // Small delay to ensure disconnect completes
          setTimeout(() => {
            chatApi.connectToChat(currentChatId)
          }, 100)
          // Refresh members and messages to reflect merged identity
          setTimeout(async () => {
            try {
              const mbrs = await chatApi.fetchMembers(currentChatId)
              setMembers(currentChatId, mbrs)
              // Also refresh messages since sender addresses were updated
              const msgs = await chatApi.fetchMessages(currentChatId)
              setChatMessages(currentChatId, msgs)
            } catch (err) {
              console.error('[ChatContainer] Failed to refresh data after SIWE auth:', err)
            }
          }, 300)
        }
      } catch (err) {
        console.error('[ChatContainer] Failed to merge SIWE session:', err)
      }
    }

    window.addEventListener('juice:siwe-signed-in', handleSiweSignIn as unknown as EventListener)
    return () => {
      window.removeEventListener('juice:siwe-signed-in', handleSiweSignIn as unknown as EventListener)
    }
  }, [addChat, forceActiveChatId, setMembers, setChatMessages])

  // Listen for dock scroll enable/disable events
  useEffect(() => {
    const handleDockScrollChange = (e: CustomEvent<{ enabled: boolean }>) => {
      setDockScrollEnabled(e.detail.enabled)
    }
    window.addEventListener('juice:dock-scroll', handleDockScrollChange as EventListener)
    return () => window.removeEventListener('juice:dock-scroll', handleDockScrollChange as EventListener)
  }, [])

  // Mobile scroll detection - enable compact mode when scrolled
  useEffect(() => {
    const dock = dockRef.current
    if (!dock) return

    let lastScrollTop = 0
    const handleScroll = () => {
      const scrollTop = dock.scrollTop
      const scrollingDown = scrollTop > lastScrollTop
      const atTop = scrollTop <= 10

      // Enable compact mode when scrolling down, disable when at top
      if (scrollingDown && scrollTop > 50 && !dockScrollEnabled) {
        setDockScrollEnabled(true)
      } else if (atTop && dockScrollEnabled) {
        setDockScrollEnabled(false)
      }

      lastScrollTop = scrollTop
    }

    dock.addEventListener('scroll', handleScroll, { passive: true })
    return () => dock.removeEventListener('scroll', handleScroll)
  }, [dockScrollEnabled])

  // Listen for empty AI responses - show "Nudge" button when Claude stops without output
  useEffect(() => {
    const handleEmptyResponse = (e: CustomEvent<{ chatId: string; messageId: string }>) => {
      const currentChatId = forceActiveChatId || useChatStore.getState().activeChatId
      if (e.detail.chatId === currentChatId) {
        setShowContinueButton(true)
        setWaitingForAiChatId(null)
      }
    }
    const handleStreamingStarted = (e: CustomEvent<{ chatId: string; messageId: string }>) => {
      const currentChatId = forceActiveChatId || useChatStore.getState().activeChatId
      if (e.detail.chatId === currentChatId) {
        setShowContinueButton(false) // Clear nudge button when AI starts responding
        // Note: isWaitingForAi is cleared in WebSocket handler when streaming message is created
      }
    }
    window.addEventListener('chat:ai-empty-response', handleEmptyResponse as EventListener)
    window.addEventListener('chat:ai-streaming-started', handleStreamingStarted as EventListener)
    return () => {
      window.removeEventListener('chat:ai-empty-response', handleEmptyResponse as EventListener)
      window.removeEventListener('chat:ai-streaming-started', handleStreamingStarted as EventListener)
    }
  }, [forceActiveChatId])

  // Timeout fallback: if waiting for AI for 30+ seconds with no response, show Continue button
  useEffect(() => {
    if (!isWaitingForAi) return
    const timeout = setTimeout(() => {
      setWaitingForAiChatId(null)
      setShowContinueButton(true)
    }, 30000) // 30 seconds
    return () => clearTimeout(timeout)
  }, [isWaitingForAi, setWaitingForAiChatId])

  // When waiting for AI, scroll to bottom so the expanded padding pushes content up
  // This creates visible space for the AI response
  // Only scroll if user is in the bottom half AND there's enough content to scroll
  useEffect(() => {
    if (!isWaitingForAi) return
    const container = messagesScrollRef.current
    if (!container) return

    // Skip if content is already near the top (new chat with first message)
    // Only scroll if there's meaningful scroll distance (more than 100px from current position)
    const currentScrollBottom = container.scrollTop + container.clientHeight
    const scrollDistance = container.scrollHeight - currentScrollBottom
    if (scrollDistance < 100) return

    // Check if user is in bottom half of scroll area
    const scrollPosition = container.scrollTop + container.clientHeight
    const totalHeight = container.scrollHeight
    const isInBottomHalf = scrollPosition > totalHeight / 2

    if (!isInBottomHalf) return

    // Small delay to let the padding increase take effect
    setTimeout(() => {
      // Don't scroll all the way to bottom - leave ~15% of viewport showing previous content
      const offset = container.clientHeight * 0.15
      const targetScroll = container.scrollHeight - container.clientHeight - offset
      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
      })
    }, 50)
  }, [isWaitingForAi])

  // Load shared chat data and connect WebSocket when activeChatId changes
  useEffect(() => {
    if (!activeChatId) return

    let isMounted = true
    let cleanup: (() => void) | undefined

    async function loadSharedChat() {
      setError(null)

      try {
        // Fetch chat info - always fetch to get current online members
        // Use direct store lookup with resolved activeChatId (not getActiveChat which uses store's activeChatId)
        const chatInfo = await chatApi.fetchChat(activeChatId!)
        if (!isMounted) return
        const existingChat = useChatStore.getState().chats.find(c => c.id === activeChatId)
        if (!existingChat) {
          addChat(chatInfo)
        }
        // Always update online members from the fresh fetch
        if (chatInfo.onlineMembers) {
          setOnlineMembers(activeChatId!, chatInfo.onlineMembers)
        }

        // If fetchChat returned members, set them immediately
        // This ensures fresh member data even if chat was in localStorage
        if (chatInfo.members && chatInfo.members.length > 0) {
          setMembers(activeChatId!, chatInfo.members)
        }

        // Load messages
        const msgs = await chatApi.fetchMessages(activeChatId!)
        if (!isMounted) return
        setChatMessages(activeChatId!, msgs)

        // Load members from dedicated endpoint as backup
        const mbrs = await chatApi.fetchMembers(activeChatId!)
        if (!isMounted) return
        setMembers(activeChatId!, mbrs)

        // Clear unread count
        clearUnread(activeChatId!)
      } catch (err) {
        if (!isMounted) return
        console.error('Failed to load shared chat:', err)
        const errorMessage = err instanceof Error ? err.message : 'Failed to load chat'

        // If chat doesn't exist (404), remove stale reference and redirect
        if (errorMessage === 'Chat not found') {
          removeChat(activeChatId!)
          setActiveChat(null)
          navigate('/', { replace: true })
          return
        }

        setError(errorMessage)
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

              // Check if there's a pending auto-generation request
              const pendingFieldId = (window as unknown as { __pendingGenerationFieldId?: string }).__pendingGenerationFieldId
              if (pendingFieldId) {
                // Get the final content and dispatch it to the OptionsPicker
                let finalContent = streamingMessages.get(messageId)?.content || ''
                // Strip any component tags - we just want the plain text (supports both formats)
                finalContent = finalContent.replace(/<(?:juice-)?component[^>]*\/>/g, '').trim()
                // Also strip any preamble like "Here's a description:"
                finalContent = finalContent.replace(/^(Here'?s?|The|A|An|Your)\s+(a\s+)?(brief\s+)?(compelling\s+)?(project\s+)?description:?\s*/i, '').trim()
                window.dispatchEvent(new CustomEvent('juice:generated-content', {
                  detail: { fieldId: pendingFieldId, content: finalContent }
                }))
                delete (window as unknown as { __pendingGenerationFieldId?: string }).__pendingGenerationFieldId
              }

              streamingMessages.delete(messageId)
              // Mark message as no longer streaming
              useChatStore.getState().updateMessage(targetChatId, messageId, { isStreaming: false })
              // Clear waiting state when streaming is done
              useChatStore.getState().setWaitingForAiChatId(null)
            } else {
              // Accumulate tokens in buffer - store chatId with content to avoid closure issues
              const existing = streamingMessages.get(messageId)
              const currentContent = existing?.content || ''
              const newContent = currentContent + token
              streamingMessages.set(messageId, { content: newContent, chatId: targetChatId })
              pendingUpdates.set(messageId, { content: newContent, chatId: targetChatId })

              // On FIRST token, create the message immediately for instant feedback
              // Then use batching for subsequent tokens
              if (!existing) {
                flushUpdates() // Create message immediately
                useChatStore.getState().setWaitingForAiChatId(null) // Clear thinking indicator once message exists
              } else {
                scheduleUpdate() // Batch subsequent tokens
              }
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
          case 'presence': {
            const presenceData = msg.data as { address: string; status: 'online' | 'offline' }
            useChatStore.getState().updatePresence(targetChatId, presenceData.address, presenceData.status === 'online')
            break
          }
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
    const handleOpenWalletPanel = (event: CustomEvent<{ anchorPosition?: { top: number; left: number; width: number; height: number }; skipAuthModal?: boolean }>) => {
      // Toggle behavior: if wallet panel is already open, close it
      if (showWalletPanel) {
        setShowWalletPanel(false)
        return
      }

      closeAllPopovers()
      if (event.detail?.anchorPosition) {
        setWalletPanelAnchorPosition(event.detail.anchorPosition)
        setAuthModalAnchorPosition(event.detail.anchorPosition)
      }
      // Check for wagmi wallet OR passkey wallet OR managed auth (auth store)
      const currentPasskeyWallet = getPasskeyWallet()
      const isManagedAuth = isAuthenticated()
      if (isWalletConnected || currentPasskeyWallet || isManagedAuth) {
        // Already connected - show wallet panel directly for top-up/balance
        setShowWalletPanel(true)
      } else if (event.detail?.skipAuthModal) {
        // User already chose "Wallet" (e.g., from JuicyIdPopover) - skip to wallet selector
        setWalletPanelInitialView('self_custody')
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
  }, [isWalletConnected, isAuthenticated, closeAllPopovers, showWalletPanel])

  // Listen for identity changes to refresh member data
  useEffect(() => {
    const handleIdentityChange = async () => {
      if (!activeChatId) return
      try {
        const mbrs = await chatApi.fetchMembers(activeChatId)
        setMembers(activeChatId, mbrs)
      } catch (err) {
        console.error('Failed to refresh members after identity change:', err)
      }
    }
    window.addEventListener('juice:identity-changed', handleIdentityChange)
    return () => window.removeEventListener('juice:identity-changed', handleIdentityChange)
  }, [activeChatId, setMembers])

  // Listen for messages from dynamic components (e.g., recommendation chips)
  // Only listen if we're the instance with the input (bottomOnly or neither specified)
  // This prevents duplicate message handling when split into topOnly/bottomOnly
  useEffect(() => {
    // Skip if we're topOnly (no input to handle messages)
    if (topOnly) return

    const handleComponentMessage = (event: CustomEvent<{ message: string; newChat?: boolean; fileAttachments?: Record<string, string>; bypassSkipAi?: boolean }>) => {
      console.log('[ChatContainer] Received juice:send-message event', event.detail)
      if (event.detail?.message) {
        // Convert file attachments (data URLs) to Attachment objects
        let attachments: Attachment[] | undefined
        if (event.detail.fileAttachments) {
          attachments = Object.entries(event.detail.fileAttachments).map(([fieldId, dataUrl]) => {
            // Extract mime type and base64 data from data URL (format: data:image/png;base64,XXXX)
            const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
            if (matches) {
              const [, mimeType, base64Data] = matches
              return {
                id: `file-${fieldId}-${Date.now()}`,
                type: mimeType.startsWith('image/') ? 'image' as const : 'document' as const,
                name: `${fieldId}.${mimeType.split('/')[1] || 'bin'}`,
                mimeType,
                data: base64Data,
              }
            }
            return null
          }).filter((a): a is Attachment => a !== null)
        }

        const bypassSkipAi = event.detail.bypassSkipAi ?? false

        if (event.detail.newChat) {
          // Clear active chat and send message immediately
          // handleSend now handles optimistic UI for instant feedback
          useChatStore.getState().setActiveChat(null)
          handleSend(event.detail.message, attachments, bypassSkipAi)
        } else {
          handleSend(event.detail.message, attachments, bypassSkipAi)
        }
      }
    }

    window.addEventListener('juice:send-message', handleComponentMessage as EventListener)

    // Handle auto-generation requests from OptionsPicker
    const handleGenerationRequest = async (event: CustomEvent<{ fieldId: string; prompt: string; context: string }>) => {
      if (!topOnly) return // Only handle in the main chat
      const { fieldId, context } = event.detail
      // Send a message asking the AI to generate content
      // The AI should respond with just the generated text
      const message = `Generate a brief, compelling project description (2-3 sentences) based on what we've discussed: ${context}. Respond with ONLY the description text, no preamble or explanation.`
      handleSend(message)

      // Store the fieldId so we can capture the response
      ;(window as unknown as { __pendingGenerationFieldId?: string }).__pendingGenerationFieldId = fieldId

      // Add a timeout to prevent infinite spinning if generation fails
      setTimeout(() => {
        const stillPending = (window as unknown as { __pendingGenerationFieldId?: string }).__pendingGenerationFieldId
        if (stillPending === fieldId) {
          // Generation didn't complete - clear the pending state
          delete (window as unknown as { __pendingGenerationFieldId?: string }).__pendingGenerationFieldId
          window.dispatchEvent(new CustomEvent('juice:generated-content', {
            detail: { fieldId, content: '' } // Empty content signals failure, component will stop spinning
          }))
        }
      }, 30000) // 30 second timeout
    }
    window.addEventListener('juice:request-generation', handleGenerationRequest as unknown as EventListener)

    return () => {
      window.removeEventListener('juice:send-message', handleComponentMessage as EventListener)
      window.removeEventListener('juice:request-generation', handleGenerationRequest as unknown as EventListener)
    }
  }, [handleSend, topOnly, navigate])

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
    const handleOpenAuthModal = (event: CustomEvent<{ anchorPosition?: { top: number; left: number; width: number; height: number } }>) => {
      closeAllPopovers()
      if (event.detail?.anchorPosition) {
        setAuthModalAnchorPosition(event.detail.anchorPosition)
      }
      setShowAuthOptionsModal(true)
    }
    window.addEventListener('juice:open-auth-modal', handleOpenAuthModal as EventListener)
    return () => window.removeEventListener('juice:open-auth-modal', handleOpenAuthModal as EventListener)
  }, [closeAllPopovers])

  return (
    <div
      className="flex h-full overflow-hidden relative"
      onDragEnter={handlePageDragEnter}
      onDragLeave={handlePageDragLeave}
      onDragOver={handlePageDragOver}
      onDrop={handlePageDrop}
    >
      {/* Page-level drop overlay - only show when ChatInput is present (not in topOnly mode) */}
      {isPageDragging && !topOnly && (
        <div className={`absolute inset-0 z-50 flex items-center justify-center pointer-events-none ${
          theme === 'dark' ? 'bg-juice-dark/90' : 'bg-white/90'
        }`}>
          <div className={`flex flex-col items-center gap-3 p-8 border-2 border-dashed ${
            theme === 'dark' ? 'border-juice-cyan text-juice-cyan' : 'border-juice-cyan text-juice-cyan'
          }`}>
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span className="text-lg font-medium">Drop files here to attach</span>
            <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
              Images, PDFs, and documents supported
            </span>
          </div>
        </div>
      )}
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

        {messages.length === 0 && !isWaitingForAi && !pendingNewChat ? (
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
                data-dock="true"
                className={`${bottomOnly ? 'max-h-full dock-overflow hide-scrollbar' : `absolute bottom-0 left-0 right-0 z-30 ${isMobile ? 'max-h-[45vh]' : 'max-h-[38vh]'} border-t-4 border-juice-orange backdrop-blur-md overflow-y-auto hide-scrollbar ` + (theme === 'dark' ? 'bg-juice-dark/75' : 'bg-white/75')}`}
              >
                {/* Greeting - hidden when dock is pinned (compact mode) */}
                <div className={`flex flex-col justify-end overflow-hidden ${dockScrollEnabled ? 'h-0 opacity-0' : `${isMobile ? 'h-[8vh]' : 'h-[6vh]'} opacity-100`}`}>
                  <WelcomeGreeting />
                </div>

                {/* Controls above prompt area - hidden when dock is pinned (compact mode) */}
                <div className={`flex justify-between items-center px-6 overflow-hidden ${dockScrollEnabled ? 'max-h-0 opacity-0 py-0' : `max-h-20 opacity-100 ${isMobile ? 'mt-1' : ''}`}`}>
                    {/* Left side: mobile-only sidebar and attachment icons */}
                    <div className={`flex items-center gap-1 ${isMobile ? '' : 'invisible'}`}>
                      {/* History sidebar toggle */}
                      <button
                        onClick={() => setShowHistorySidebar(true)}
                        className={`p-1.5 transition-colors ${
                          theme === 'dark'
                            ? 'text-gray-400 hover:text-white'
                            : 'text-gray-500 hover:text-gray-900'
                        }`}
                        title={t('chat.chatHistory', 'Chat history')}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                        </svg>
                      </button>
                      {/* Attachments button */}
                      <button
                        onClick={() => window.dispatchEvent(new CustomEvent('juice:trigger-file-upload'))}
                        className={`p-1.5 transition-colors ${
                          theme === 'dark'
                            ? 'text-gray-400 hover:text-white'
                            : 'text-gray-500 hover:text-gray-900'
                        }`}
                        title="Attach file"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      </button>
                    </div>
                    {/* Right side: language, theme, settings */}
                    <div className="flex items-center gap-2">
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
                  className={`sticky top-0 left-0 right-0 z-10 w-full transition-colors duration-150 ${
                    dockScrollEnabled
                      ? theme === 'dark' ? 'bg-juice-dark/50 backdrop-blur-sm' : 'bg-white/50 backdrop-blur-sm'
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
                    chatId={activeChatId || undefined}
                  />

                  {/* Subtext - tight below prompt, hidden when dock is pinned */}
                  <div className={`flex items-center justify-between px-6 overflow-hidden ${dockScrollEnabled ? 'max-h-0 opacity-0' : 'max-h-10 opacity-100 -mt-2 mb-3'}`}>
                    <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                      {t('dock.askAbout', 'Let\'s make it real.')}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Beta button */}
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
                      {/* Three-dot options menu */}
                      <div className="relative">
                        <button
                          onClick={() => setShowOptionsMenu(!showOptionsMenu)}
                          className={`p-1 transition-colors ${
                            theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
                          }`}
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>
                        {showOptionsMenu && (
                          <>
                            <div className="fixed inset-0 z-[98]" onClick={() => setShowOptionsMenu(false)} />
                            <div className={`absolute right-0 bottom-full mb-2 py-1 min-w-[160px] border shadow-lg z-[99] ${
                              theme === 'dark' ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'
                            }`}>
                              {/* Privacy toggle */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setPrivateMode(!privateMode)
                                  setShowOptionsMenu(false)
                                }}
                                className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition-colors ${
                                  theme === 'dark' ? 'hover:bg-white/5' : 'hover:bg-gray-50'
                                }`}
                              >
                                <span className={privateMode ? 'text-juice-orange' : theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}>
                                  {privateMode ? t('chat.incognitoOn', 'Incognito on') : t('chat.incognitoOff', 'Incognito off')}
                                </span>
                                {privateMode && (
                                  <svg className="w-3 h-3 text-juice-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                              {/* Report */}
                              <button
                                onClick={() => {
                                  handleReport()
                                  setShowOptionsMenu(false)
                                }}
                                disabled={isReporting}
                                className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                                  reportSuccess
                                    ? 'text-green-500'
                                    : isReporting
                                      ? theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                                      : theme === 'dark'
                                        ? 'text-gray-300 hover:bg-white/5 hover:text-red-400'
                                        : 'text-gray-700 hover:bg-gray-50 hover:text-red-500'
                                }`}
                              >
                                {reportSuccess ? t('chat.reported', 'Reported') : isReporting ? '...' : t('chat.report', 'Report')}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Material upload hints - desktop/tablet only, hidden when dock is pinned */}
                  {!isMobile && (
                    <div className={`flex gap-2 px-6 overflow-hidden ${dockScrollEnabled ? 'max-h-0 opacity-0' : 'max-h-12 opacity-100 mb-2'}`}>
                      {[
                        { key: 'visionDoc', label: t('materials.visionDoc', 'Drop your vision doc') },
                        { key: 'masterPlan', label: t('materials.masterPlan', 'Show your master plan') },
                        { key: 'screenshot', label: t('materials.screenshot', 'Paste a screenshot') },
                      ].map((item) => (
                        <button
                          key={item.key}
                          onClick={() => window.dispatchEvent(new CustomEvent('juice:trigger-file-upload'))}
                          className={`py-1.5 px-2.5 text-xs border border-dashed transition-colors cursor-pointer ${
                            theme === 'dark'
                              ? 'border-white/15 text-gray-500 hover:border-white/25 hover:text-gray-400'
                              : 'border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}

                </div>

                {/* Wallet info - hidden when dock is pinned (compact mode) */}
                <div className={`overflow-hidden ${dockScrollEnabled ? 'max-h-0 opacity-0' : `max-h-16 opacity-100 ${isMobile ? 'pb-6' : ''}`}`}>
                  <WalletInfo />
                </div>

                {/* Conversation history - desktop/tablet only */}
                {!isMobile && (
                  <div className="pt-6 pb-8">
                    <ConversationHistory />
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Messages scrollable area - only show if topOnly or neither specified */}
            {/* Messages scroll under header (pt-[14.44vh]) and dock with padding at bottom */}
            {(topOnly || (!topOnly && !bottomOnly)) && (
              <div ref={messagesScrollRef} className="overflow-y-auto flex-1 relative pt-[14.44vh]">
                <MessageList
                  messages={messages}
                  members={members}
                  isWaitingForResponse={isWaitingForAi || pendingNewChat}
                  chatId={activeChatId || undefined}
                  currentUserMember={currentUserMember}
                  onlineMembers={onlineMembers}
                  onMemberUpdated={handleMemberUpdated}
                  showNudgeButton={showContinueButton}
                  onNudge={handleContinue}
                  scrollContainerRef={messagesScrollRef}
                />
                {/* Bottom padding - larger when waiting for AI or streaming to create space for response */}
                <div className={(isWaitingForAi || pendingNewChat || hasStreamingMessage) ? "h-[70vh]" : "h-[14.44vh]"} />
              </div>
            )}

            {/* Input dock - fixed at bottom with translucency, grows upward */}
            {/* Min height: 38% of 38% of screen height = 14.44vh */}
            {(bottomOnly || (!topOnly && !bottomOnly)) && (
              <div
                className={`${bottomOnly ? 'h-full' : 'absolute bottom-0 left-0 right-0'} flex flex-col justify-end transition-all duration-75`}
              >
                {/* Attachments & Theme/Settings row - above prompt */}
                <div className={`flex justify-between px-6 items-center transition-opacity duration-75 ${
                  showActionBar ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}>
                  {/* Left side buttons */}
                  <div className="flex items-center gap-1">
                    {/* History sidebar toggle */}
                    <button
                      onClick={() => setShowHistorySidebar(true)}
                      className={`p-1.5 transition-colors ${
                        theme === 'dark'
                          ? 'text-gray-400 hover:text-white'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                      title={t('chat.chatHistory', 'Chat history')}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                      </svg>
                    </button>
                    {/* Attachments button */}
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('juice:trigger-file-upload'))}
                      className={`p-1.5 transition-colors ${
                        theme === 'dark'
                          ? 'text-gray-400 hover:text-white'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                      title="Attach file"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                    </button>
                  </div>
                  {/* Right side buttons */}
                  <div className="flex items-center gap-1">
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

                {/* Input area with background */}
                <div className={`backdrop-blur-sm ${
                  theme === 'dark' ? 'bg-juice-dark/80' : 'bg-white/80'
                }`}>
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
                      placeholder={isChatMode ? t('activeChat.typeMessage', 'Type any message...') : placeholder}
                      showDockButtons={!isChatMode}
                      onSettingsClick={() => setSettingsOpen(true)}
                      chatId={activeChatId || undefined}
                      onConnectedAsClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        closeAllPopovers()
                        setWalletPanelAnchorPosition({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
                        setShowWalletPanel(true)
                      }}
                      walletInfoRightContent={
                        <div className="flex items-center gap-3">
                          {/* Three-dot overflow menu for small screens */}
                          <div className="relative sm:hidden">
                            <button
                              onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                              className={`p-1.5 transition-colors ${
                                theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
                              }`}
                              title="More options"
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <circle cx="12" cy="5" r="2" />
                                <circle cx="12" cy="12" r="2" />
                                <circle cx="12" cy="19" r="2" />
                              </svg>
                            </button>
                            {showOverflowMenu && (
                              <>
                                <div className="fixed inset-0 z-[98]" onClick={() => setShowOverflowMenu(false)} />
                                <div className={`absolute right-0 bottom-full mb-2 py-1 min-w-[140px] border shadow-lg z-[99] ${
                                  theme === 'dark' ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'
                                }`}>
                                  {/* Chat history */}
                                  <button
                                    onClick={() => {
                                      setShowHistorySidebar(true)
                                      setShowOverflowMenu(false)
                                    }}
                                    className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${
                                      theme === 'dark' ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-gray-50'
                                    }`}
                                  >
                                    {t('chat.chatHistory', 'Chat history')}
                                  </button>
                                  {canPauseAi && (
                                    <button
                                      onClick={() => {
                                        setAiControlsExpanded(true)
                                        setPersonalAiSkip(true)
                                        setShowOverflowMenu(false)
                                      }}
                                      className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${
                                        theme === 'dark' ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-gray-50'
                                      }`}
                                    >
                                      {t('chat.pauseAi', 'Pause AI')}
                                    </button>
                                  )}
                                  {!canPauseAi && chatAiEnabled && (
                                    <button
                                      onClick={() => {
                                        setPersonalAiSkip(!personalAiSkip)
                                        setShowOverflowMenu(false)
                                      }}
                                      className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${
                                        personalAiSkip ? 'text-orange-400' : theme === 'dark' ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-gray-50'
                                      }`}
                                    >
                                      {personalAiSkip ? t('chat.skipping', 'Skipping AI') : t('chat.skipAi', 'Skip AI')}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      handleReport()
                                      setShowOverflowMenu(false)
                                    }}
                                    disabled={isReporting}
                                    className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${
                                      reportSuccess
                                        ? 'text-green-500'
                                        : isReporting
                                          ? 'text-gray-500 cursor-wait'
                                          : theme === 'dark' ? 'text-gray-300 hover:bg-white/5 hover:text-red-400' : 'text-gray-600 hover:bg-gray-50 hover:text-red-400'
                                    }`}
                                  >
                                    {reportSuccess ? t('chat.reported', 'Reported') : isReporting ? '...' : t('chat.report', 'Report')}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                          {/* Collapsible AI controls - only for users with canPauseAi permission - hidden on small screens */}
                          {activeChatId && canPauseAi && (
                            (!chatAiEnabled || personalAiSkip || aiControlsExpanded) ? (
                              /* Expanded: Show both toggles */
                              <div className="hidden sm:flex items-center gap-2">
                                {/* Skip for all toggle */}
                                <button
                                  onClick={handleToggleAi}
                                  disabled={isTogglingAi}
                                  className={`px-2 py-0.5 text-xs transition-colors border flex items-center gap-1.5 ${
                                    isTogglingAi ? 'opacity-50 cursor-wait' : ''
                                  } ${!chatAiEnabled
                                    ? 'border-orange-400/50 text-orange-400'
                                    : 'border-gray-600 text-gray-500'
                                  }`}
                                  title={!chatAiEnabled ? t('chat.skipAllOnTooltip', 'AI is paused for everyone') : t('chat.skipAllOffTooltip', 'Click to pause AI for everyone')}
                                >
                                  <span className={`w-3 h-3 rounded-sm border ${!chatAiEnabled ? 'bg-orange-400 border-orange-400' : 'border-current'}`}>
                                    {!chatAiEnabled && <span className="block w-full h-full text-[8px] text-white flex items-center justify-center">✓</span>}
                                  </span>
                                  {t('chat.skipForAll', 'Skip for all')}
                                </button>
                                {/* Skip for you toggle */}
                                <button
                                  onClick={() => {
                                    const newSkip = !personalAiSkip
                                    setPersonalAiSkip(newSkip)
                                    // Auto-collapse if both are now off
                                    if (!newSkip && chatAiEnabled) {
                                      setAiControlsExpanded(false)
                                    }
                                  }}
                                  className={`px-2 py-0.5 text-xs transition-colors border flex items-center gap-1.5 ${
                                    personalAiSkip
                                      ? 'border-orange-400/50 text-orange-400'
                                      : 'border-gray-600 text-gray-500'
                                  }`}
                                  title={personalAiSkip ? t('chat.skipYouOnTooltip', 'Your messages won\'t invoke AI') : t('chat.skipYouOffTooltip', 'Click to skip AI for your messages')}
                                >
                                  <span className={`w-3 h-3 rounded-sm border ${personalAiSkip ? 'bg-orange-400 border-orange-400' : 'border-current'}`}>
                                    {personalAiSkip && <span className="block w-full h-full text-[8px] text-white flex items-center justify-center">✓</span>}
                                  </span>
                                  {t('chat.skipForYou', 'Skip for you')}
                                </button>
                              </div>
                            ) : (
                              /* Collapsed: Show just Pause AI button */
                              <button
                                onClick={() => {
                                  setAiControlsExpanded(true)
                                  setPersonalAiSkip(true) // Default "Skip for you" to ON when expanding
                                }}
                                className="hidden sm:block px-2 py-0.5 text-xs transition-colors border border-gray-600 text-gray-500 hover:border-orange-400/50 hover:text-orange-400"
                                title={t('chat.pauseAiTooltip', 'Click to see AI skip options')}
                              >
                                {t('chat.pauseAi', 'Pause AI')}
                              </button>
                            )
                          )}
                          {/* For non-admins: just show Skip AI button when AI is on, or AI paused indicator */}
                          {activeChatId && !canPauseAi && (
                            chatAiEnabled ? (
                              <button
                                onClick={() => setPersonalAiSkip(!personalAiSkip)}
                                className={`hidden sm:block px-2 py-0.5 text-xs transition-colors border ${
                                  personalAiSkip
                                    ? 'border-orange-400/50 text-orange-400'
                                    : 'border-gray-600 text-gray-500'
                                }`}
                                title={personalAiSkip ? t('chat.personalSkipOnTooltip', 'Your messages won\'t invoke AI') : t('chat.personalSkipOffTooltip', 'Your messages will invoke AI')}
                              >
                                {personalAiSkip ? t('chat.skipping', 'Skipping') : t('chat.skipAi', 'Skip AI')}
                              </button>
                            ) : (
                              <button
                                onClick={() => setShowAiPausedPopover(!showAiPausedPopover)}
                                className="hidden sm:block px-2 py-0.5 text-xs transition-colors border border-gray-600 text-gray-500"
                              >
                                {t('chat.aiPaused', 'AI paused')}
                              </button>
                            )
                          )}
                          {activeChatId && (
                            <button
                              onClick={handleReport}
                              disabled={isReporting}
                              className={`hidden sm:block px-2 py-0.5 text-xs font-medium bg-transparent border transition-colors ${
                                reportSuccess
                                  ? 'border-green-500 text-green-500'
                                  : isReporting
                                    ? 'border-gray-500 text-gray-500 cursor-wait'
                                    : 'border-gray-500 text-gray-500 hover:border-red-400 hover:text-red-400'
                              }`}
                            >
                              {reportSuccess ? t('chat.reported', 'Reported') : isReporting ? '...' : t('chat.report', 'Report')}
                            </button>
                          )}
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
                      }
                    />
                  )}
                </div>
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
              canInvite={canInvite}
              canGrantAdmin={currentUserMember?.role === 'founder' || currentUserMember?.role === 'admin'}
              canGrantInvitePermission={canInvite}
              canGrantAiPermission={currentUserMember?.role === 'founder' || currentUserMember?.role === 'admin' || currentUserMember?.canInvokeAi !== false}
              canGrantPauseAiPermission={currentUserMember?.role === 'founder' || currentUserMember?.role === 'admin' || currentUserMember?.canPauseAi === true}
              anchorPosition={inviteAnchorPosition}
            />
          )}

          {/* Local Share Modal removed - all chats are now server-synced */}

          {/* Save Modal - for wallet-connected users */}
          <SaveModal
            isOpen={showSaveModal}
            onClose={() => setShowSaveModal(false)}
            onWalletClick={() => {
              setWalletPanelInitialView('self_custody')
              setShowWalletPanel(true)
            }}
            onPasskeySuccess={handlePasskeySuccess}
            anchorPosition={saveAnchorPosition}
          />

          {/* Auth Options Modal - for users not connected with wallet */}
          <AuthOptionsModal
            isOpen={showAuthOptionsModal}
            onClose={() => setShowAuthOptionsModal(false)}
            onWalletClick={() => {
              setWalletPanelInitialView('self_custody')
              setShowWalletPanel(true)
            }}
            onPasskeySuccess={handlePasskeySuccess}
            title={authModalContext === 'connect' ? t('auth.connectTitle', 'Connect') : undefined}
            description={authModalContext === 'connect' ? t('auth.connectDescription', 'Choose how to connect your account.') : undefined}
            anchorPosition={authModalAnchorPosition}
          />

          {/* Wallet Panel - for external wallet connection */}
          <WalletPanel
            isOpen={showWalletPanel}
            onClose={() => {
              setShowWalletPanel(false)
              setWalletPanelInitialView('select')
            }}
            anchorPosition={walletPanelAnchorPosition}
            initialView={walletPanelInitialView}
          />
        </>
      )}

      {/* Wallet Panel - also render in topOnly mode so Settings can trigger it */}
      {topOnly && (
        <>
          <AuthOptionsModal
            isOpen={showAuthOptionsModal}
            onClose={() => setShowAuthOptionsModal(false)}
            onWalletClick={() => {
              setWalletPanelInitialView('self_custody')
              setShowWalletPanel(true)
            }}
            onPasskeySuccess={handlePasskeySuccess}
            title={authModalContext === 'connect' ? t('auth.connectTitle', 'Connect') : undefined}
            description={authModalContext === 'connect' ? t('auth.connectDescription', 'Choose how to connect your account.') : undefined}
            anchorPosition={authModalAnchorPosition}
          />
          <WalletPanel
            isOpen={showWalletPanel}
            onClose={() => {
              setShowWalletPanel(false)
              setWalletPanelInitialView('select')
            }}
            anchorPosition={walletPanelAnchorPosition}
            initialView={walletPanelInitialView}
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
            {t('beta.tagline', "The juiciest way to fund and grow your project.")}
          </p>
          <p className={`text-xs leading-relaxed mb-2 ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`}>
            {t('beta.whatWeAreBuilding', "Use it to run your fundraise, operate your business, manage your campaign, sell to customers, work with your community, and build out your dreams.")}
          </p>
          <p className={`text-xs leading-relaxed mb-2 ${
            theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
          }`}>
            {t('beta.promptAway', "Just prompt away, in private or together.")}
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
                  detail: { message: 'I want to pay project ID 1 (NANA)', newChat: true }
                }))
              }}
              className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
                theme === 'dark'
                  ? 'border-juice-cyan text-juice-cyan hover:bg-juice-cyan/10'
                  : 'border-teal-600 text-teal-600 hover:bg-teal-50'
              }`}
            >
              {t('beta.joinUs', 'Join us so we can go faster')}
            </button>
          </div>
        </div>
        </>,
        document.body
      )}

      {/* AI Paused Popover - shown when user clicks "AI paused" button */}
      {showAiPausedPopover && createPortal(
        <>
          <div
            className="fixed inset-0 z-[99]"
            onClick={() => setShowAiPausedPopover(false)}
          />
          <div
            className={`fixed right-4 bottom-16 w-64 p-3 border shadow-xl z-[100] ${
              theme === 'dark'
                ? 'bg-juice-dark border-white/20'
                : 'bg-white border-gray-200'
            }`}
          >
            <p className={`text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
              {t('chat.aiPausedExplanation', 'AI has been paused by an admin for this chat. Your messages will not receive AI responses until an admin turns it back on.')}
            </p>
          </div>
        </>,
        document.body
      )}

      {/* Chat History Sidebar - slide-out panel for recent chats */}
      <ChatHistorySidebar
        isOpen={showHistorySidebar}
        onClose={() => setShowHistorySidebar(false)}
        currentChatId={activeChatId || undefined}
      />
    </div>
  )
}
