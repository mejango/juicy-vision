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
  // Map of groupId -> array of users currently typing in that field
  remoteTyping: Map<string, RemoteTyping[]>
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
    remoteTyping: new Map(),
    remoteHovers: new Map(),
  })

  // Track typing timeouts per user+groupId
  const typingTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

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
            // Update typing indicator for this groupId
            const typingMap = new Map(prev.remoteTyping)
            const groupTyping = [...(typingMap.get(data.groupId) || [])]
            const timeoutKey = `${senderAddress}:${data.groupId}`

            const existingIdx = groupTyping.findIndex(
              (t) => t.address === senderAddress
            )

            if (data.value) {
              // User is typing
              if (existingIdx !== -1) {
                groupTyping[existingIdx] = { address: senderAddress, emoji, text: data.value }
              } else {
                groupTyping.push({ address: senderAddress, emoji, text: data.value })
              }

              // Clear existing timeout for this user+group
              const existingTimeout = typingTimeouts.current.get(timeoutKey)
              if (existingTimeout) {
                clearTimeout(existingTimeout)
              }

              // Set timeout to remove typing indicator
              const timeout = setTimeout(() => {
                setState((s) => {
                  const newMap = new Map(s.remoteTyping)
                  const filtered = (newMap.get(data.groupId) || []).filter(
                    (t) => t.address !== senderAddress
                  )
                  if (filtered.length > 0) {
                    newMap.set(data.groupId, filtered)
                  } else {
                    newMap.delete(data.groupId)
                  }
                  return { ...s, remoteTyping: newMap }
                })
                typingTimeouts.current.delete(timeoutKey)
              }, TYPING_TIMEOUT)
              typingTimeouts.current.set(timeoutKey, timeout)

              typingMap.set(data.groupId, groupTyping)
            } else if (existingIdx !== -1) {
              // User stopped typing
              groupTyping.splice(existingIdx, 1)
              const existingTimeout = typingTimeouts.current.get(timeoutKey)
              if (existingTimeout) {
                clearTimeout(existingTimeout)
                typingTimeouts.current.delete(timeoutKey)
              }
              if (groupTyping.length > 0) {
                typingMap.set(data.groupId, groupTyping)
              } else {
                typingMap.delete(data.groupId)
              }
            }

            newState.remoteTyping = typingMap
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

  // Track debounce timers per groupId
  const typingDebounceMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Send typing event (debounced per groupId)
  const sendTyping = useCallback(
    (text: string, groupId: string = '_memo') => {
      if (!chatId || !messageId || !enabled) return

      // Clear existing debounce for this groupId
      const existingDebounce = typingDebounceMap.current.get(groupId)
      if (existingDebounce) {
        clearTimeout(existingDebounce)
      }

      // Send immediately for first keystroke, then debounce subsequent
      sendComponentInteraction({
        messageId,
        groupId,
        action: 'typing',
        value: text || undefined,
      })

      // Auto-clear after timeout if no more typing
      const timeout = setTimeout(() => {
        sendComponentInteraction({
          messageId,
          groupId,
          action: 'typing',
          value: undefined,
        })
        typingDebounceMap.current.delete(groupId)
      }, TYPING_TIMEOUT)
      typingDebounceMap.current.set(groupId, timeout)
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

  // Cleanup on unmount - clear all debounce timers
  useEffect(() => {
    return () => {
      typingDebounceMap.current.forEach((timeout) => clearTimeout(timeout))
      typingDebounceMap.current.clear()
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
