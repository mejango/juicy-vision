import { useRef, useEffect, useCallback } from 'react'
import { Message, useThemeStore } from '../../stores'
import type { ChatMember } from '../../stores/chatStore'
import MessageBubble from './MessageBubble'
import ThinkingIndicator from './ThinkingIndicator'

interface MessageListProps {
  messages: Message[]
  members?: ChatMember[]
  isWaitingForResponse?: boolean
  chatId?: string
  currentUserMember?: ChatMember
  onlineMembers?: string[]
  onMemberUpdated?: (member: ChatMember) => void
  showNudgeButton?: boolean
  onNudge?: () => void
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>
}

export default function MessageList({
  messages,
  members,
  isWaitingForResponse,
  chatId,
  currentUserMember,
  onlineMembers,
  onMemberUpdated,
  showNudgeButton,
  onNudge,
  scrollContainerRef,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const prevMessageCountRef = useRef(messages.length)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  // Show ghost card when waiting for response and no message is currently streaming
  const hasStreamingMessage = messages.some(m => m.isStreaming)
  const showGhostCard = isWaitingForResponse && !hasStreamingMessage

  // Check if user is near the bottom (within 150px)
  const checkIfNearBottom = useCallback(() => {
    const container = scrollContainerRef?.current
    if (!container) return true
    const threshold = 150
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    return distanceFromBottom < threshold
  }, [scrollContainerRef])

  // Update near-bottom state when scroll container scrolls
  useEffect(() => {
    const container = scrollContainerRef?.current
    if (!container) return

    const handleScroll = () => {
      isNearBottomRef.current = checkIfNearBottom()
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [scrollContainerRef, checkIfNearBottom])

  // Scroll to bottom on initial chat load
  const initialScrollDoneRef = useRef<string | null>(null)
  useEffect(() => {
    // Only scroll once per chat - when messages first load
    if (messages.length > 0 && initialScrollDoneRef.current !== chatId) {
      initialScrollDoneRef.current = chatId ?? null
      // Use instant scroll on initial load (no animation)
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    }
    // Reset when chat changes so we scroll again for new chat
    if (chatId && initialScrollDoneRef.current && initialScrollDoneRef.current !== chatId) {
      initialScrollDoneRef.current = null
    }
  }, [chatId, messages.length])


  // Auto-scroll when a new assistant message is added (if user was near bottom)
  useEffect(() => {
    const isNewMessage = messages.length > prevMessageCountRef.current
    const lastMessage = messages[messages.length - 1]
    prevMessageCountRef.current = messages.length

    if (!isNewMessage) return

    // Only auto-scroll for assistant messages when user was near bottom
    // User message scrolling is handled by ChatContainer via padding expansion
    if (lastMessage?.role === 'assistant' && isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, messages])

  return (
    <div className="p-4">
      <div className="max-w-5xl mx-auto">
        {messages.map((message, index) => {
          // Find last assistant message index
          const lastAssistantIndex = messages.reduce((acc, m, i) =>
            m.role === 'assistant' ? i : acc, -1
          )

          // Check if this assistant message has been "responded to"
          // (i.e., there's a user message after it, meaning any interactive components were submitted)
          const nextMessage = messages[index + 1]
          const hasUserResponse = message.role === 'assistant' && nextMessage?.role === 'user'

          return (
            <div
              key={message.id}
              data-message-role={message.role}
            >
              <MessageBubble
                message={message}
                members={members}
                isLastAssistant={message.role === 'assistant' && index === lastAssistantIndex}
                chatId={chatId}
                currentUserMember={currentUserMember}
                onlineMembers={onlineMembers}
                onMemberUpdated={onMemberUpdated}
                userResponse={hasUserResponse ? nextMessage.content : undefined}
              />
            </div>
          )
        })}
        {/* Ghost card - shows while waiting for first streaming token */}
        {showGhostCard && (
          <div className="flex justify-start mb-4">
            <div className={`w-full bg-transparent px-4 py-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              <ThinkingIndicator />
            </div>
          </div>
        )}
        {/* Nudge button - shows when AI response is empty or truncated */}
        {showNudgeButton && !showGhostCard && (
          <div className="flex justify-start mb-4">
            <div className={`px-4 py-3 flex items-center gap-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <span className="text-sm">Response incomplete?</span>
              <button
                onClick={onNudge}
                className={`px-3 py-1.5 text-sm border transition-colors ${
                  isDark
                    ? 'border-juice-orange/50 text-juice-orange hover:border-juice-orange hover:bg-juice-orange/10'
                    : 'border-juice-orange/60 text-juice-orange hover:border-juice-orange hover:bg-orange-50'
                }`}
              >
                Nudge AI
              </button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
