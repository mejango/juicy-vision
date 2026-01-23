/**
 * WebSocket connection hook for chat
 *
 * Handles:
 * - Loading chat data (messages, members)
 * - WebSocket connection lifecycle
 * - Real-time message handling
 * - Streaming AI response buffering
 */

import { useEffect, useRef } from 'react'
import { useChatStore, type ChatMessage, type ChatMember } from '../../../stores'
import * as chatApi from '../../../services/chat'

interface UseChatWebSocketOptions {
  chatId: string | null
  onError?: (error: Error) => void
}

export function useChatWebSocket({ chatId, onError }: UseChatWebSocketOptions) {
  const {
    addChat,
    addMessage: addChatMessage,
    setMessages: setChatMessages,
    setMembers,
    setConnected,
    clearUnread,
  } = useChatStore()

  const mountedRef = useRef(true)

  useEffect(() => {
    if (!chatId) return

    // Capture chatId as non-null for use in async function
    const currentChatId = chatId

    mountedRef.current = true
    let cleanup: (() => void) | undefined

    async function loadAndConnect() {
      try {
        // Fetch chat info if not already in store
        const existingChat = useChatStore.getState().chats.find(c => c.id === currentChatId)
        if (!existingChat) {
          const chatInfo = await chatApi.fetchChat(currentChatId)
          if (!mountedRef.current) return
          addChat(chatInfo)
        }

        // Load messages
        const msgs = await chatApi.fetchMessages(currentChatId)
        if (!mountedRef.current) return
        setChatMessages(currentChatId, msgs)

        // Load members
        const mbrs = await chatApi.fetchMembers(currentChatId)
        if (!mountedRef.current) return
        setMembers(currentChatId, mbrs)

        // Clear unread count
        clearUnread(currentChatId)
      } catch (err) {
        if (!mountedRef.current) return
        console.error('Failed to load shared chat:', err)
        onError?.(err instanceof Error ? err : new Error('Failed to load chat'))
        return
      }

      if (!mountedRef.current) return

      // Connect WebSocket for real-time updates
      chatApi.connectToChat(currentChatId)
      setConnected(true)

      // Track streaming messages with buffered content
      const streamingMessages = new Map<string, { content: string; chatId: string }>()
      const pendingUpdates = new Map<string, { content: string; chatId: string }>()
      let updateScheduled = false

      // Batch DOM updates for smooth streaming - flush every 50ms
      const flushUpdates = () => {
        if (pendingUpdates.size === 0) return
        pendingUpdates.forEach(({ content, chatId: msgChatId }, messageId) => {
          const chat = useChatStore.getState().chats.find(c => c.id === msgChatId)
          const existingMsg = chat?.messages?.find(m => m.id === messageId)

          if (existingMsg) {
            useChatStore.getState().updateMessage(msgChatId, messageId, { content, isStreaming: true })
          } else {
            const assistantAddress = '0x0000000000000000000000000000000000000000'
            addChatMessage(msgChatId, {
              id: messageId,
              chatId: msgChatId,
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
          setTimeout(flushUpdates, 50)
        }
      }

      // Handle WebSocket messages
      cleanup = chatApi.onWsMessage((msg) => {
        if (!mountedRef.current) return
        if (msg.chatId !== currentChatId) return

        const targetChatId = msg.chatId

        switch (msg.type) {
          case 'connection_status': {
            const { status, isPolling } = msg.data as {
              status: 'connected' | 'disconnected' | 'reconnecting' | 'offline' | 'failed' | 'polling'
              isPolling?: boolean
            }
            // Update connection state - connected when WS is connected or we're polling
            const isConnected = status === 'connected' || status === 'polling'
            setConnected(isConnected)
            // Dispatch event for UI components that may want to show status
            window.dispatchEvent(new CustomEvent('chat:connection-status', {
              detail: { status, isPolling }
            }))
            break
          }
          case 'message':
            addChatMessage(targetChatId, msg.data as ChatMessage)
            break
          case 'ai_response': {
            const { messageId, token, isDone } = msg.data as { messageId: string; token: string; isDone: boolean }

            if (isDone) {
              if (pendingUpdates.has(messageId)) {
                flushUpdates()
              }
              streamingMessages.delete(messageId)
              useChatStore.getState().updateMessage(targetChatId, messageId, { isStreaming: false })
            } else {
              const existing = streamingMessages.get(messageId)
              const currentContent = existing?.content || ''
              const newContent = currentContent + token
              streamingMessages.set(messageId, { content: newContent, chatId: targetChatId })
              pendingUpdates.set(messageId, { content: newContent, chatId: targetChatId })
              scheduleUpdate()
            }
            break
          }
          case 'member_joined': {
            const joinedMember = msg.data as ChatMember
            useChatStore.getState().addMember(targetChatId, joinedMember)
            break
          }
          case 'member_left': {
            const leftData = msg.data as { address: string }
            useChatStore.getState().removeMember(targetChatId, leftData.address)
            break
          }
          case 'chat_update': {
            const updates = msg.data as { autoGeneratedTitle?: string; name?: string }
            useChatStore.getState().updateChat(targetChatId, updates)
            break
          }
          case 'member_update': {
            const { address, customEmoji, displayName } = msg.data as { address: string; customEmoji?: string | null; displayName?: string | null }
            // Convert null to undefined for TypeScript compatibility
            useChatStore.getState().updateMember(targetChatId, address, {
              customEmoji: customEmoji ?? undefined,
              displayName: displayName ?? undefined,
            })
            break
          }
        }
      })
    }

    loadAndConnect()

    return () => {
      mountedRef.current = false
      cleanup?.()
      chatApi.disconnectFromChat()
      setConnected(false)
    }
  }, [chatId, setChatMessages, setMembers, addChatMessage, setConnected, clearUnread, addChat, onError])
}
