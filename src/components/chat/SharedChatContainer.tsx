import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore, useChatStore } from '../../stores'
import { useAuthStore } from '../../stores/authStore'
import * as chatApi from '../../services/chat'
import { getSessionId } from '../../services/session'
import { getEmojiFromAddress } from './ParticipantAvatars'

// Helper to get the current user's pseudo-address (matches backend logic)
function getCurrentUserAddress(): string {
  const sessionId = getSessionId()
  return `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
}

interface TypingUser {
  address: string
  displayName?: string
}

interface SystemEvent {
  id: string
  eventType: string
  actorId?: string
  actorAddress?: string
  targetId?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export default function SharedChatContainer() {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const {
    activeChatId,
    getActiveChat,
    addChat,
    addMessage,
    setMessages,
    setMembers,
    setConnected,
    clearUnread,
  } = useChatStore()

  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  void showInviteModal // Used for invite modal visibility
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([])
  void systemEvents // Used for system event tracking
  void setSystemEvents // Used for system event updates
  const [loadError, setLoadError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const chat = getActiveChat()
  const messages = chat?.messages || []
  const members = chat?.members || []

  // Find current user's membership to check permissions
  const currentUserMember = members.find(m => m.userId === user?.id)
  const canInvite = currentUserMember?.role === 'founder' ||
                    currentUserMember?.role === 'admin' ||
                    currentUserMember?.canInvite === true

  // Load messages and connect WebSocket when chat changes
  useEffect(() => {
    if (!activeChatId) return

    let cleanup: (() => void) | undefined

    async function loadChat() {
      setIsLoadingMessages(true)
      setLoadError(null)

      try {
        // Fetch chat info first if not in store
        const existingChat = getActiveChat()
        if (!existingChat) {
          const chatInfo = await chatApi.fetchChat(activeChatId!)
          addChat(chatInfo)
        }

        // Load messages
        const msgs = await chatApi.fetchMessages(activeChatId!)
        setMessages(activeChatId!, msgs)

        // Load members
        const mbrs = await chatApi.fetchMembers(activeChatId!)
        setMembers(activeChatId!, mbrs)

        // Clear unread count
        clearUnread(activeChatId!)
      } catch (err) {
        console.error('Failed to load chat:', err)
        setLoadError(err instanceof Error ? err.message : 'Failed to load chat')
        setIsLoadingMessages(false)
        return // Don't connect WebSocket if loading failed
      }

      setIsLoadingMessages(false)

      // Connect WebSocket
      chatApi.connectToChat(activeChatId!)
      setConnected(true)

      // Handle WebSocket messages
      cleanup = chatApi.onWsMessage((msg) => {
        if (msg.chatId !== activeChatId) return

        switch (msg.type) {
          case 'message':
            addMessage(activeChatId!, msg.data as chatApi.WsMessage['data'] & { id: string; chatId: string; senderAddress: string; role: 'user' | 'assistant' | 'system'; content: string; isEncrypted: boolean; createdAt: string })
            break
          case 'typing':
            const typingData = msg.data as { address: string; displayName?: string; isTyping: boolean }
            if (typingData.isTyping) {
              setTypingUsers((prev) => {
                if (prev.some((u) => u.address === typingData.address)) return prev
                return [...prev, { address: typingData.address, displayName: typingData.displayName }]
              })
            } else {
              setTypingUsers((prev) => prev.filter((u) => u.address !== typingData.address))
            }
            break
          case 'member_joined':
            const joinedMember = msg.data as { address: string; role: 'founder' | 'admin' | 'member'; joinedAt: string }
            useChatStore.getState().addMember(activeChatId!, {
              address: joinedMember.address,
              role: joinedMember.role,
              joinedAt: joinedMember.joinedAt,
            })
            break
          case 'member_left':
            const leftData = msg.data as { address: string }
            useChatStore.getState().removeMember(activeChatId!, leftData.address)
            break
          // system_event type is reserved for future use
          // case 'system_event':
          //   break
        }
      })
    }

    loadChat()

    return () => {
      cleanup?.()
      chatApi.disconnectFromChat()
      setConnected(false)
    }
  }, [activeChatId, setMessages, setMembers, addMessage, setConnected, clearUnread])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Send typing indicator with debounce
  const handleTyping = useCallback(() => {
    if (!activeChatId) return

    chatApi.sendTypingIndicator(activeChatId, true)

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }

    typingTimeoutRef.current = setTimeout(() => {
      chatApi.sendTypingIndicator(activeChatId, false)
    }, 2000)
  }, [activeChatId])

  const handleSend = async () => {
    if (!inputValue.trim() || !activeChatId || isSending) return

    const content = inputValue.trim()
    setInputValue('')
    setIsSending(true)

    // Stop typing indicator
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
    }
    chatApi.sendTypingIndicator(activeChatId, false)

    try {
      // Send the user's message
      await chatApi.sendMessage(activeChatId, content)

      // Invoke AI to respond
      try {
        await chatApi.invokeAi(activeChatId, content)
      } catch (aiErr) {
        console.error('Failed to invoke AI:', aiErr)
        // Don't restore input - user message was sent successfully
      }
    } catch (err) {
      console.error('Failed to send message:', err)
      // Restore input on error
      setInputValue(content)
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // No chat selected
  if (!activeChatId) {
    return (
      <div
        className={`flex-1 flex items-center justify-center ${
          theme === 'dark' ? 'bg-juice-dark text-gray-400' : 'bg-gray-50 text-gray-500'
        }`}
      >
        <div className="text-center">
          <svg
            className="w-16 h-16 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p>{t('chat.selectChat', 'Select a chat to start messaging')}</p>
        </div>
      </div>
    )
  }

  // Chat loading error
  if (loadError) {
    return (
      <div
        className={`flex-1 flex items-center justify-center ${
          theme === 'dark' ? 'bg-juice-dark text-gray-400' : 'bg-gray-50 text-gray-500'
        }`}
      >
        <div className="text-center max-w-md px-4">
          <p className={`text-lg mb-4 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            {t('chat.loadError', 'Unable to load chat')}
          </p>
          <p className="text-sm mb-6">{loadError}</p>
          <button
            onClick={() => window.location.href = '/'}
            className={`px-4 py-2 text-sm transition-colors ${
              theme === 'dark'
                ? 'text-gray-400 hover:text-white border border-white/20 hover:border-white/40'
                : 'text-gray-500 hover:text-gray-900 border border-gray-300 hover:border-gray-400'
            }`}
          >
            {t('ui.goHome', 'Go Home')}
          </button>
        </div>
      </div>
    )
  }

  // Chat loading
  if (!chat) {
    return (
      <div
        className={`flex-1 flex items-center justify-center ${
          theme === 'dark' ? 'bg-juice-dark text-gray-400' : 'bg-gray-50 text-gray-500'
        }`}
      >
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-juice-orange border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p>{t('chat.loading', 'Loading chat...')}</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex-1 flex flex-col ${
        theme === 'dark' ? 'bg-juice-dark' : 'bg-white'
      }`}
    >
      {/* Header */}
      <div
        className={`px-6 py-4 border-b flex items-center justify-between ${
          theme === 'dark' ? 'border-white/10' : 'border-gray-200'
        }`}
      >
        <div>
          <h2
            className={`text-lg font-semibold ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}
          >
            {chat.name}
          </h2>
          <p
            className={`text-sm ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
            }`}
          >
            {members.length} {t('chat.members', 'members')}
            {chat.encrypted && (
              <span className="ml-2 text-juice-orange">
                <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Invite button - only show if user has permission */}
          {canInvite && (
            <button
              onClick={() => setShowInviteModal(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                theme === 'dark'
                  ? 'text-gray-300 hover:text-white hover:bg-white/10'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              {t('chat.invite', 'Invite')}
            </button>
          )}

          {/* Members avatars */}
          <div className="flex -space-x-2">
          {members.slice(0, 5).map((member) => {
            const displayText = member.displayName || member.address || '?'
            return (
              <div
                key={member.address}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 ${
                  theme === 'dark'
                    ? 'bg-white/10 border-juice-dark text-gray-300'
                    : 'bg-gray-100 border-white text-gray-600'
                }`}
                title={displayText}
              >
                {displayText.charAt(0).toUpperCase()}
              </div>
            )
          })}
          {members.length > 5 && (
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 ${
                theme === 'dark'
                  ? 'bg-juice-orange/20 border-juice-dark text-juice-orange'
                  : 'bg-juice-orange/10 border-white text-juice-orange'
              }`}
            >
              +{members.length - 5}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoadingMessages ? (
          <div className="flex justify-center py-8">
            <div
              className={`text-sm ${
                theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              {t('ui.loading', 'Loading...')}
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex justify-center py-8">
            <div
              className={`text-sm ${
                theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              {t('chat.noMessages', 'No messages yet. Start the conversation.')}
            </div>
          </div>
        ) : (
          messages.map((message) => {
            // Assistant messages are always from the bot (left-aligned)
            // User messages are right-aligned only if from the current viewer
            const isAssistant = message.role === 'assistant'
            const currentAddress = getCurrentUserAddress()
            const isOwnMessage = !isAssistant && message.senderAddress === currentAddress
            const sender = members.find((m) => m.address === message.senderAddress)

            return (
              <div
                key={message.id}
                className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[70%] ${
                    isOwnMessage ? 'order-2' : 'order-1'
                  }`}
                >
                  {/* Sender name for others' messages */}
                  {!isOwnMessage && (
                    <p
                      className={`text-xs mb-1 ${
                        theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                      }`}
                    >
                      {isAssistant
                        ? 'Juicy AI'
                        : sender?.displayName ||
                          (sender?.customEmoji || getEmojiFromAddress(message.senderAddress))}
                    </p>
                  )}

                  {/* Message bubble */}
                  <div
                    className={`px-4 py-2 rounded-2xl ${
                      isOwnMessage
                        ? 'bg-juice-orange text-white rounded-br-md'
                        : theme === 'dark'
                        ? 'bg-white/10 text-white rounded-bl-md'
                        : 'bg-gray-100 text-gray-900 rounded-bl-md'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>

                  {/* Timestamp */}
                  <p
                    className={`text-xs mt-1 ${
                      isOwnMessage ? 'text-right' : ''
                    } ${theme === 'dark' ? 'text-gray-600' : 'text-gray-400'}`}
                  >
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            )
          })
        )}

        {/* Typing indicator */}
        {typingUsers.length > 0 && (
          <div className="flex justify-start">
            <div
              className={`px-4 py-2 rounded-2xl rounded-bl-md ${
                theme === 'dark' ? 'bg-white/10' : 'bg-gray-100'
              }`}
            >
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className={`px-4 py-3 border-t ${
          theme === 'dark' ? 'border-white/10' : 'border-gray-200'
        }`}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value)
              handleTyping()
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.typeMessage', 'Type a message...')}
            rows={1}
            className={`flex-1 px-4 py-2.5 rounded-xl border resize-none transition-colors ${
              theme === 'dark'
                ? 'bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-juice-orange'
                : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-juice-orange'
            } focus:outline-none focus:ring-1 focus:ring-juice-orange`}
            style={{ maxHeight: '120px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = 'auto'
              target.style.height = Math.min(target.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending}
            className={`p-2.5 rounded-xl transition-colors ${
              inputValue.trim() && !isSending
                ? 'bg-juice-orange text-white hover:bg-juice-orange/90'
                : theme === 'dark'
                ? 'bg-white/10 text-gray-500'
                : 'bg-gray-100 text-gray-400'
            } disabled:cursor-not-allowed`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
