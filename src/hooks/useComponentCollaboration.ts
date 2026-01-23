/**
 * Hook for real-time collaboration on components like OptionsPicker
 *
 * Handles:
 * - Sending selection/typing/hover events to other chat participants
 * - Receiving and tracking remote user interactions
 * - Debouncing typing events
 * - Cleanup on unmount
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  onWsMessage,
  sendComponentInteraction,
  type WsMessage,
  type ComponentInteractionData,
} from '../services/chat'
import { getEmojiFromAddress } from '../components/chat/ParticipantAvatars'

export interface RemoteSelection {
  address: string
  emoji: string
  value: string
}

export interface RemoteTyping {
  address: string
  emoji: string
  text: string
}

export interface RemoteHover {
  address: string
  emoji: string
}

interface CollaborationState {
  // Map of groupId -> array of remote selections
  remoteSelections: Map<string, RemoteSelection[]>
  // Array of users currently typing in memo field
  remoteTyping: RemoteTyping[]
  // Map of groupId -> array of users hovering
  remoteHovers: Map<string, RemoteHover[]>
}

interface UseComponentCollaborationOptions {
  chatId?: string
  messageId?: string
  enabled?: boolean
}

const TYPING_TIMEOUT = 2000 // How long to show typing indicator after last keystroke

export function useComponentCollaboration({
  chatId,
  messageId,
  enabled = true,
}: UseComponentCollaborationOptions) {
  const [state, setState] = useState<CollaborationState>({
    remoteSelections: new Map(),
    remoteTyping: [],
    remoteHovers: new Map(),
  })

  // Track typing timeouts per user
  const typingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // Debounce timer for sending our own typing events
  const typingDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for incoming component interactions
  useEffect(() => {
    if (!chatId || !messageId || !enabled) return

    const unsubscribe = onWsMessage((msg: WsMessage) => {
      if (
        msg.type !== 'component_interaction' ||
        msg.chatId !== chatId ||
        !msg.sender
      ) {
        return
      }

      const data = msg.data as ComponentInteractionData
      if (data.messageId !== messageId) return

      const senderAddress = msg.sender
      const emoji = getEmojiFromAddress(senderAddress)

      setState((prev) => {
        const newState = { ...prev }

        switch (data.action) {
          case 'select': {
            // Update remote selection for this group
            const selections = new Map(prev.remoteSelections)
            const groupSelections = [...(selections.get(data.groupId) || [])]

            // Remove existing selection from this user in this group
            const existingIdx = groupSelections.findIndex(
              (s) => s.address === senderAddress
            )
            if (existingIdx !== -1) {
              groupSelections.splice(existingIdx, 1)
            }

            // Add new selection if value provided
            if (data.value) {
              groupSelections.push({
                address: senderAddress,
                emoji,
                value: data.value,
              })
            }

            selections.set(data.groupId, groupSelections)
            newState.remoteSelections = selections
            break
          }

          case 'typing': {
            // Update typing indicator
            const existingIdx = prev.remoteTyping.findIndex(
              (t) => t.address === senderAddress
            )
            const newTyping = [...prev.remoteTyping]

            if (data.value) {
              // User is typing
              if (existingIdx !== -1) {
                newTyping[existingIdx] = { address: senderAddress, emoji, text: data.value }
              } else {
                newTyping.push({ address: senderAddress, emoji, text: data.value })
              }

              // Clear existing timeout for this user
              const existingTimeout = typingTimeouts.current.get(senderAddress)
              if (existingTimeout) {
                clearTimeout(existingTimeout)
              }

              // Set timeout to remove typing indicator
              const timeout = setTimeout(() => {
                setState((s) => ({
                  ...s,
                  remoteTyping: s.remoteTyping.filter(
                    (t) => t.address !== senderAddress
                  ),
                }))
                typingTimeouts.current.delete(senderAddress)
              }, TYPING_TIMEOUT)
              typingTimeouts.current.set(senderAddress, timeout)
            } else if (existingIdx !== -1) {
              // User stopped typing
              newTyping.splice(existingIdx, 1)
              const existingTimeout = typingTimeouts.current.get(senderAddress)
              if (existingTimeout) {
                clearTimeout(existingTimeout)
                typingTimeouts.current.delete(senderAddress)
              }
            }

            newState.remoteTyping = newTyping
            break
          }

          case 'hover': {
            // Add hover indicator
            const hovers = new Map(prev.remoteHovers)
            const groupHovers = [...(hovers.get(data.groupId) || [])]

            if (!groupHovers.some((h) => h.address === senderAddress)) {
              groupHovers.push({ address: senderAddress, emoji })
            }

            hovers.set(data.groupId, groupHovers)
            newState.remoteHovers = hovers
            break
          }

          case 'hover_end': {
            // Remove hover indicator
            const hovers = new Map(prev.remoteHovers)
            const groupHovers = (hovers.get(data.groupId) || []).filter(
              (h) => h.address !== senderAddress
            )

            if (groupHovers.length > 0) {
              hovers.set(data.groupId, groupHovers)
            } else {
              hovers.delete(data.groupId)
            }

            newState.remoteHovers = hovers
            break
          }
        }

        return newState
      })
    })

    return () => {
      unsubscribe()
      // Clear all typing timeouts
      typingTimeouts.current.forEach((timeout) => clearTimeout(timeout))
      typingTimeouts.current.clear()
    }
  }, [chatId, messageId, enabled])

  // Send selection event
  const sendSelection = useCallback(
    (groupId: string, value: string | null) => {
      if (!chatId || !messageId || !enabled) return

      sendComponentInteraction({
        messageId,
        groupId,
        action: 'select',
        value: value || undefined,
      })
    },
    [chatId, messageId, enabled]
  )

  // Send typing event (debounced)
  const sendTyping = useCallback(
    (text: string) => {
      if (!chatId || !messageId || !enabled) return

      // Clear existing debounce
      if (typingDebounce.current) {
        clearTimeout(typingDebounce.current)
      }

      // Send immediately for first keystroke, then debounce subsequent
      sendComponentInteraction({
        messageId,
        groupId: '_memo', // Special group ID for memo field
        action: 'typing',
        value: text || undefined,
      })

      // Auto-clear after timeout if no more typing
      typingDebounce.current = setTimeout(() => {
        sendComponentInteraction({
          messageId,
          groupId: '_memo',
          action: 'typing',
          value: undefined,
        })
      }, TYPING_TIMEOUT)
    },
    [chatId, messageId, enabled]
  )

  // Send hover event
  const sendHover = useCallback(
    (groupId: string, isHovering: boolean) => {
      if (!chatId || !messageId || !enabled) return

      sendComponentInteraction({
        messageId,
        groupId,
        action: isHovering ? 'hover' : 'hover_end',
      })
    },
    [chatId, messageId, enabled]
  )

  // Cleanup on unmount - send hover_end for any active hovers
  useEffect(() => {
    return () => {
      if (typingDebounce.current) {
        clearTimeout(typingDebounce.current)
      }
    }
  }, [])

  return {
    remoteSelections: state.remoteSelections,
    remoteTyping: state.remoteTyping,
    remoteHovers: state.remoteHovers,
    sendSelection,
    sendTyping,
    sendHover,
  }
}
