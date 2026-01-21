import { useRef, useEffect, useCallback } from 'react'
import { Message } from '../../stores'
import MessageBubble from './MessageBubble'

interface MessageListProps {
  messages: Message[]
}

export default function MessageList({ messages }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)
  const prevMessageCountRef = useRef(messages.length)

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
              isLastAssistant={message.role === 'assistant' && index === lastAssistantIndex}
            />
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
