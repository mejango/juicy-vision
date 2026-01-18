import { useChatStore } from '../../stores'
import { useThemeStore } from '../../stores'

function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ConversationHistory() {
  const { theme } = useThemeStore()
  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    deleteConversation,
    clearAllConversations,
  } = useChatStore()

  // Only show conversations that have messages
  const nonEmptyConversations = conversations.filter(c => c.messages.length > 0)

  if (nonEmptyConversations.length === 0) return null

  const handleSelectConversation = (id: string) => {
    setActiveConversation(id)
  }

  const handleDeleteConversation = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    deleteConversation(id)
  }

  const handleClearAll = () => {
    if (confirm('Clear all conversation history?')) {
      clearAllConversations()
    }
  }

  return (
    <div className="flex gap-3 px-6 mt-20">
      {/* Spacer to align with textarea */}
      <div className="w-[48px] shrink-0" />

      <div className="flex-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs font-medium ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`}>
            Recent
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClearAll}
              className={`text-xs transition-colors ${
                theme === 'dark'
                  ? 'text-gray-600 hover:text-red-400'
                  : 'text-gray-300 hover:text-red-500'
              }`}
            >
              Clear all
            </button>
          </div>
        </div>

        {/* Conversation list */}
        <div className="space-y-1 pb-4">
          {nonEmptyConversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => handleSelectConversation(conv.id)}
              className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                conv.id === activeConversationId
                  ? theme === 'dark'
                    ? 'bg-white/10 text-white'
                    : 'bg-gray-200 text-gray-900'
                  : theme === 'dark'
                    ? 'hover:bg-white/5 text-gray-400'
                    : 'hover:bg-gray-100 text-gray-500'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className={`text-sm truncate ${
                  conv.id === activeConversationId
                    ? ''
                    : theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                }`}>
                  {conv.title}
                </div>
                <div className={`text-xs ${
                  theme === 'dark' ? 'text-gray-600' : 'text-gray-400'
                }`}>
                  {formatTimeAgo(conv.updatedAt)}
                </div>
              </div>
              <button
                onClick={(e) => handleDeleteConversation(e, conv.id)}
                className={`ml-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                  theme === 'dark'
                    ? 'hover:bg-white/10 text-gray-500 hover:text-red-400'
                    : 'hover:bg-gray-200 text-gray-400 hover:text-red-500'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
