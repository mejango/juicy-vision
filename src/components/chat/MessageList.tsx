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
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
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
    const container = containerRef.current
    if (!container) return true
    const threshold = 150
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    return distanceFromBottom < threshold
  }, [])

  // Track scroll position
  const handleScroll = useCallback(() => {
    isNearBottomRef.current = checkIfNearBottom()
  }, [checkIfNearBottom])

  // Scroll to position an element at a percentage from the top of the viewport
  const scrollToPosition = useCallback((element: HTMLElement, percentFromTop: number) => {
    const container = containerRef.current
    if (!container || !element) return

    const elementRect = element.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    // Calculate where the element should be (at percentFromTop of container height)
    const targetPosition = containerRect.height * percentFromTop

    // Calculate current element position relative to container
    const elementTopInContainer = elementRect.top - containerRect.top + container.scrollTop

    // Calculate scroll position to place element at target percentage
    const scrollTo = elementTopInContainer - targetPosition

    container.scrollTo({
      top: Math.max(0, scrollTo),
      behavior: 'smooth'
    })
  }, [])

  // Track the last message for scroll targeting
  const lastUserMessageRef = useRef<HTMLDivElement>(null)

  // Only auto-scroll when a new message is added AND user was near bottom
  useEffect(() => {
    const isNewMessage = messages.length > prevMessageCountRef.current
    const lastMessage = messages[messages.length - 1]
    prevMessageCountRef.current = messages.length

    // Auto-scroll only if new message added and user was near bottom
    if (isNewMessage && isNearBottomRef.current) {
      // If user just sent a message, position it at 38% from top (room for AI response)
      if (lastMessage?.role === 'user' && lastUserMessageRef.current) {
        // Small delay to ensure DOM is updated
        setTimeout(() => {
          if (lastUserMessageRef.current) {
            scrollToPosition(lastUserMessageRef.current, 0.38)
          }
        }, 50)
      } else {
        // Assistant message - scroll to bottom as before
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }
  }, [messages.length, messages, scrollToPosition])

  // Auto-scroll when ghost card appears (user sent a message, waiting for response)
  // Position user's message at 38% from top to leave room for AI response
  useEffect(() => {
    if (showGhostCard && isNearBottomRef.current && lastUserMessageRef.current) {
      scrollToPosition(lastUserMessageRef.current, 0.38)
    }
  }, [showGhostCard, scrollToPosition])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="p-4"
    >
      <div className="max-w-5xl mx-auto">
        {messages.map((message, index) => {
          // Find last assistant message index
          const lastAssistantIndex = messages.reduce((acc, m, i) =>
            m.role === 'assistant' ? i : acc, -1
          )
          // Find last user message index
          const lastUserIndex = messages.reduce((acc, m, i) =>
            m.role === 'user' ? i : acc, -1
          )
          const isLastUserMessage = message.role === 'user' && index === lastUserIndex

          return (
            <div
              key={message.id}
              ref={isLastUserMessage ? lastUserMessageRef : undefined}
            >
              <MessageBubble
                message={message}
                members={members}
                isLastAssistant={message.role === 'assistant' && index === lastAssistantIndex}
                chatId={chatId}
                currentUserMember={currentUserMember}
                onlineMembers={onlineMembers}
                onMemberUpdated={onMemberUpdated}
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
        {/* Nudge button - shows when AI gave an empty response */}
        {showNudgeButton && !showGhostCard && (
          <div className="flex justify-start mb-4">
            <div className={`px-4 py-3 flex items-center gap-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <span className="text-sm">Something stopped.</span>
              <button
                onClick={onNudge}
                className={`px-3 py-1.5 text-sm border transition-colors ${
                  isDark
                    ? 'border-juice-orange/50 text-juice-orange hover:border-juice-orange hover:bg-juice-orange/10'
                    : 'border-juice-orange/60 text-juice-orange hover:border-juice-orange hover:bg-orange-50'
                }`}
              >
                Nudge the AI
              </button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
