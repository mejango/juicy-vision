/**
 * Chat actions hook
 *
 * Handles:
 * - Export chat to markdown
 * - Invite users to chat
 * - Passkey wallet integration
 */

import { useCallback, useEffect, useState } from 'react'
import { type Message } from '../../../stores'
import { stripComponents } from '../../../utils/messageParser'
import { type PasskeyWallet, getPasskeyWallet } from '../../../services/passkeyWallet'

interface UseChatActionsOptions {
  /** Current messages in the chat */
  messages: Message[]
  /** Active chat ID */
  activeChatId: string | null
  /** Active chat name */
  activeChatName?: string
  /** Callback when an error occurs */
  onError?: (message: string) => void
}

interface UseChatActionsResult {
  /** Export chat to markdown file */
  handleExport: () => void
  /** Open invite modal for current chat */
  handleInvite: () => void
  /** Handle successful passkey authentication */
  handlePasskeySuccess: (wallet: PasskeyWallet) => void
  /** Current passkey wallet (if any) */
  passkeyWallet: PasskeyWallet | null
  /** Invite modal state */
  inviteState: {
    chatId: string | null
    chatName: string
  }
  /** Set invite modal state */
  setInviteState: (state: { chatId: string | null; chatName: string }) => void
}

/**
 * Convert messages to markdown format
 */
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

/**
 * Trigger download of markdown file
 */
function downloadMarkdown(content: string, filename: string): void {
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

export function useChatActions({
  messages,
  activeChatId,
  activeChatName,
  onError,
}: UseChatActionsOptions): UseChatActionsResult {
  const [passkeyWallet, setPasskeyWallet] = useState<PasskeyWallet | null>(() => getPasskeyWallet())
  const [inviteState, setInviteState] = useState<{ chatId: string | null; chatName: string }>({
    chatId: null,
    chatName: '',
  })

  // Export chat to markdown
  const handleExport = useCallback(() => {
    if (messages.length === 0) return
    const title = activeChatName || 'Chat'
    const md = exportToMarkdown(messages, title)
    const filename = `${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`
    downloadMarkdown(md, filename)
  }, [messages, activeChatName])

  // Share chat - open invite modal
  const handleInvite = useCallback(() => {
    if (!activeChatId) {
      onError?.('Start a conversation first to share it')
      return
    }

    setInviteState({
      chatId: activeChatId,
      chatName: activeChatName || 'Chat',
    })
  }, [activeChatId, activeChatName, onError])

  // Handle successful passkey wallet creation/authentication
  const handlePasskeySuccess = useCallback((wallet: PasskeyWallet) => {
    setPasskeyWallet(wallet)
  }, [])

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

  return {
    handleExport,
    handleInvite,
    handlePasskeySuccess,
    passkeyWallet,
    inviteState,
    setInviteState,
  }
}
