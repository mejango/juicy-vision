import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { useMultiChatStore } from '../../stores/multiChatStore'
import * as multiChatApi from '../../services/multiChat'

function formatTimeAgo(timestamp: string): string {
  const now = Date.now()
  const time = new Date(timestamp).getTime()
  const diff = now - time
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

interface ChatListProps {
  onCreateChat: () => void
}

export default function ChatList({ onCreateChat }: ChatListProps) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const {
    chats,
    activeChatId,
    isLoading,
    setChats,
    setActiveChat,
    setLoading,
    setError,
  } = useMultiChatStore()

  // Fetch chats on mount
  useEffect(() => {
    async function loadChats() {
      setLoading(true)
      try {
        const data = await multiChatApi.fetchMyChats()
        setChats(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chats')
      } finally {
        setLoading(false)
      }
    }
    loadChats()
  }, [setChats, setLoading, setError])

  const handleSelectChat = (chatId: string) => {
    setActiveChat(chatId)
  }

  return (
    <div
      className={`w-64 h-full flex flex-col border-r ${
        theme === 'dark'
          ? 'bg-juice-dark border-white/10'
          : 'bg-white border-gray-200'
      }`}
    >
      {/* Header */}
      <div
        className={`p-4 border-b ${
          theme === 'dark' ? 'border-white/10' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center justify-between">
          <h2
            className={`text-sm font-semibold ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}
          >
            {t('multiChat.chats', 'Chats')}
          </h2>
          <button
            onClick={onCreateChat}
            className={`p-1.5 rounded-lg transition-colors ${
              theme === 'dark'
                ? 'hover:bg-white/10 text-gray-400 hover:text-white'
                : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'
            }`}
            title={t('multiChat.newChat', 'New Chat')}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center">
            <div
              className={`text-sm ${
                theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              {t('ui.loading', 'Loading...')}
            </div>
          </div>
        ) : chats.length === 0 ? (
          <div className="p-4 text-center">
            <div
              className={`text-sm ${
                theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              {t('multiChat.noChats', 'No chats yet')}
            </div>
            <button
              onClick={onCreateChat}
              className="mt-2 text-sm text-juice-orange hover:underline"
            >
              {t('multiChat.createFirst', 'Create your first chat')}
            </button>
          </div>
        ) : (
          <div className="py-2">
            {chats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => handleSelectChat(chat.id)}
                className={`w-full px-4 py-3 text-left transition-colors ${
                  chat.id === activeChatId
                    ? theme === 'dark'
                      ? 'bg-white/10'
                      : 'bg-gray-100'
                    : theme === 'dark'
                    ? 'hover:bg-white/5'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Chat icon */}
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                      theme === 'dark' ? 'bg-white/10' : 'bg-gray-100'
                    }`}
                  >
                    {chat.encrypted ? (
                      <svg
                        className="w-5 h-5 text-juice-orange"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                        />
                      </svg>
                    ) : (
                      <span
                        className={`text-sm font-medium ${
                          theme === 'dark' ? 'text-gray-300' : 'text-gray-600'
                        }`}
                      >
                        {chat.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* Chat info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-medium truncate ${
                          chat.id === activeChatId
                            ? theme === 'dark'
                              ? 'text-white'
                              : 'text-gray-900'
                            : theme === 'dark'
                            ? 'text-gray-200'
                            : 'text-gray-700'
                        }`}
                      >
                        {chat.name}
                      </span>
                      {chat.unreadCount && chat.unreadCount > 0 && (
                        <span className="px-1.5 py-0.5 text-xs font-medium bg-juice-orange text-white rounded-full">
                          {chat.unreadCount}
                        </span>
                      )}
                    </div>
                    <div
                      className={`text-xs truncate ${
                        theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                      }`}
                    >
                      {chat.description || formatTimeAgo(chat.updatedAt)}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer with public chats link */}
      <div
        className={`p-3 border-t ${
          theme === 'dark' ? 'border-white/10' : 'border-gray-200'
        }`}
      >
        <button
          className={`w-full py-2 text-xs text-center transition-colors ${
            theme === 'dark'
              ? 'text-gray-500 hover:text-gray-300'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          {t('multiChat.browsePublic', 'Browse public chats')}
        </button>
      </div>
    </div>
  )
}
