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

  // Only auto-scroll when a new message is added AND user was near bottom
  useEffect(() => {
    const isNewMessage = messages.length > prevMessageCountRef.current
    prevMessageCountRef.current = messages.length

    // Auto-scroll only if new message added and user was near bottom
    if (isNewMessage && isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  // Auto-scroll when ghost card appears (user sent a message, waiting for response)
  useEffect(() => {
    if (showGhostCard && isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [showGhostCard])

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
          return (
            <MessageBubble
              key={message.id}
              message={message}
              members={members}
              isLastAssistant={message.role === 'assistant' && index === lastAssistantIndex}
              chatId={chatId}
              currentUserMember={currentUserMember}
              onlineMembers={onlineMembers}
              onMemberUpdated={onMemberUpdated}
            />
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
