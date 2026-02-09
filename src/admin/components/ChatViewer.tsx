import { useState, useEffect, useRef } from 'react'
import { useThemeStore } from '../../stores'
import { useAuthStore } from '../../stores/authStore'
import { useAdminChatDetail, type AdminChat, type ChatMessage, type ChatMember } from '../hooks/useAdminChats'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

interface ChatViewerProps {
  chat: AdminChat
  onClose: () => void
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortenAddress(address: string | null): string {
  if (!address) return 'System'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function MessageBubble({ message, isDark }: { message: ChatMessage; isDark: boolean }) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isSystem = message.role === 'system'

  return (
    <div className={`py-2 ${isAssistant ? 'pl-0' : isUser ? 'pl-8' : ''}`}>
      {/* Sender info */}
      <div className={`text-xs mb-1 flex items-center gap-2 ${
        isDark ? 'text-gray-500' : 'text-gray-400'
      }`}>
        <span className="font-mono">
          {isAssistant ? (message.aiModel || 'AI') : shortenAddress(message.senderAddress)}
        </span>
        <span>{formatTimestamp(message.createdAt)}</span>
      </div>

      {/* Message content */}
      <div className={`px-3 py-2 text-sm whitespace-pre-wrap break-words ${
        isAssistant
          ? isDark
            ? 'bg-zinc-800 text-gray-200 border-l-2 border-juice-cyan'
            : 'bg-gray-100 text-gray-800 border-l-2 border-teal-500'
          : isSystem
            ? isDark
              ? 'bg-amber-900/20 text-amber-300 border-l-2 border-amber-500'
              : 'bg-amber-50 text-amber-800 border-l-2 border-amber-500'
            : isDark
              ? 'bg-zinc-900 text-gray-300'
              : 'bg-white border border-gray-200 text-gray-700'
      }`}>
        {message.content}
      </div>
    </div>
  )
}

async function fetchAllMessages(token: string, chatId: string): Promise<{ messages: ChatMessage[], members: ChatMember[] }> {
  const allMessages: ChatMessage[] = []
  let members: ChatMember[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const response = await fetch(`${API_BASE_URL}/admin/chats/${chatId}?page=${page}&limit=200`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await response.json()
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch messages')
    }

    allMessages.push(...data.data.messages)
    if (page === 1) {
      members = data.data.members
    }

    hasMore = page < data.data.pagination.totalPages
    page++
  }

  return { messages: allMessages, members }
}

export default function ChatViewer({ chat, onClose }: ChatViewerProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const token = useAuthStore((state) => state.token)
  const [messagePage, setMessagePage] = useState(1)
  const [isExporting, setIsExporting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, error } = useAdminChatDetail(chat.id, messagePage)

  const handleExport = async () => {
    if (!token || isExporting) return

    setIsExporting(true)
    try {
      const { messages, members } = await fetchAllMessages(token, chat.id)

      const exportData = {
        chat: {
          id: chat.id,
          name: chat.name,
          founderAddress: chat.founderAddress,
          isPublic: chat.isPublic,
          isPrivate: chat.isPrivate,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          messageCount: chat.messageCount,
          memberCount: chat.memberCount,
        },
        members,
        messages: messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
        exportedAt: new Date().toISOString(),
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const safeName = (chat.name || 'chat').replace(/[^a-z0-9]/gi, '-').toLowerCase()
      link.download = `${safeName}-${chat.id.slice(0, 8)}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
      alert(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setIsExporting(false)
    }
  }

  // Scroll to bottom on first load
  useEffect(() => {
    if (data && messagePage === 1) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [data, messagePage])

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className={`fixed right-0 top-0 bottom-0 w-full max-w-2xl z-50 flex flex-col shadow-xl ${
        isDark ? 'bg-zinc-900' : 'bg-white'
      }`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${
          isDark ? 'border-zinc-700' : 'border-gray-200'
        }`}>
          <div>
            <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {chat.name || 'Untitled Chat'}
            </h2>
            <p className={`text-xs font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {chat.id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={isExporting}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                isExporting
                  ? 'opacity-50 cursor-not-allowed'
                  : isDark
                    ? 'bg-zinc-700 text-white hover:bg-zinc-600'
                    : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
              }`}
            >
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                isDark
                  ? 'text-gray-400 hover:text-white hover:bg-white/10'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Chat metadata */}
        <div className={`px-4 py-2 border-b text-xs grid grid-cols-3 gap-4 ${
          isDark ? 'bg-zinc-800/50 border-zinc-700 text-gray-400' : 'bg-gray-50 border-gray-200 text-gray-500'
        }`}>
          <div>
            <span className="block font-medium">Founder</span>
            <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {shortenAddress(data?.chat?.founderAddress || chat.founderAddress)}
            </span>
          </div>
          <div>
            <span className="block font-medium">Members</span>
            <span className={isDark ? 'text-white' : 'text-gray-900'}>
              {data?.members?.length || chat.memberCount}
            </span>
          </div>
          <div>
            <span className="block font-medium">Messages</span>
            <span className={isDark ? 'text-white' : 'text-gray-900'}>
              {data?.pagination?.total || chat.messageCount}
            </span>
          </div>
        </div>

        {/* Members list */}
        {data?.members && data.members.length > 0 && (
          <div className={`px-4 py-2 border-b ${
            isDark ? 'border-zinc-700' : 'border-gray-200'
          }`}>
            <div className="flex flex-wrap gap-2">
              {data.members.map((member) => (
                <span
                  key={member.address}
                  className={`text-xs px-2 py-1 rounded font-mono ${
                    isDark ? 'bg-zinc-800 text-gray-300' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {member.displayName || shortenAddress(member.address)}
                  {member.role !== 'member' && (
                    <span className={`ml-1 ${
                      member.role === 'founder' ? 'text-juice-orange' : 'text-juice-cyan'
                    }`}>
                      ({member.role})
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {isLoading ? (
            <div className={`text-center py-8 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Loading messages...
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-400">
              {error instanceof Error ? error.message : 'Failed to load messages'}
            </div>
          ) : !data?.messages?.length ? (
            <div className={`text-center py-8 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              No messages yet
            </div>
          ) : (
            <>
              {/* Load more button */}
              {data.pagination.page < data.pagination.totalPages && (
                <button
                  onClick={() => setMessagePage(p => p + 1)}
                  className={`w-full py-2 text-sm rounded mb-4 ${
                    isDark
                      ? 'text-gray-400 hover:bg-white/10'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  Load older messages...
                </button>
              )}

              {/* Messages */}
              {data.messages.map((message) => (
                <MessageBubble key={message.id} message={message} isDark={isDark} />
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Footer with pagination info */}
        {data?.pagination && data.pagination.total > 0 && (
          <div className={`px-4 py-2 text-xs border-t ${
            isDark ? 'border-zinc-700 text-gray-500' : 'border-gray-200 text-gray-400'
          }`}>
            Showing {data.messages.length} of {data.pagination.total} messages
          </div>
        )}
      </div>
    </>
  )
}
