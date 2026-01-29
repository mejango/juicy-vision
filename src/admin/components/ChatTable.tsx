import { useThemeStore } from '../../stores'
import { useAdminChats, type AdminChat } from '../hooks/useAdminChats'

interface ChatTableProps {
  page: number
  onPageChange: (page: number) => void
  onSelectChat: (chat: AdminChat) => void
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortenAddress(address: string): string {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export default function ChatTable({ page, onPageChange, onSelectChat }: ChatTableProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const { data, isLoading, error } = useAdminChats(page)

  if (isLoading) {
    return (
      <div className={`p-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        Loading chats...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-400">
        {error instanceof Error ? error.message : 'Failed to load chats'}
      </div>
    )
  }

  if (!data || data.chats.length === 0) {
    return (
      <div className={`p-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        No chats found
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className={`text-left text-xs uppercase tracking-wide ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              <th className="px-4 py-3 font-medium">Chat</th>
              <th className="px-4 py-3 font-medium">Founder</th>
              <th className="px-4 py-3 font-medium text-center">Members</th>
              <th className="px-4 py-3 font-medium text-center">Messages</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className={`divide-y ${isDark ? 'divide-zinc-800' : 'divide-gray-100'}`}>
            {data.chats.map((chat) => (
              <tr
                key={chat.id}
                onClick={() => onSelectChat(chat)}
                className={`cursor-pointer transition-colors ${
                  isDark
                    ? 'hover:bg-white/5'
                    : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className={`font-medium truncate max-w-[200px] ${
                      isDark ? 'text-white' : 'text-gray-900'
                    }`}>
                      {chat.name || 'Untitled'}
                    </span>
                    <span className={`text-xs font-mono ${
                      isDark ? 'text-gray-500' : 'text-gray-400'
                    }`}>
                      {chat.id.slice(0, 8)}
                    </span>
                  </div>
                </td>
                <td className={`px-4 py-3 font-mono text-sm ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  {shortenAddress(chat.founderAddress)}
                </td>
                <td className={`px-4 py-3 text-center ${
                  isDark ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {chat.memberCount}
                </td>
                <td className={`px-4 py-3 text-center ${
                  isDark ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {chat.messageCount}
                </td>
                <td className={`px-4 py-3 text-sm ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  {formatDate(chat.createdAt)}
                </td>
                <td className={`px-4 py-3 text-sm ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  {formatDate(chat.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data.pagination.totalPages > 1 && (
        <div className={`px-4 py-3 flex items-center justify-between border-t ${
          isDark ? 'border-zinc-800' : 'border-gray-100'
        }`}>
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Page {data.pagination.page} of {data.pagination.totalPages}
            {' '}({data.pagination.total} total)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                page <= 1
                  ? isDark ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 cursor-not-allowed'
                  : isDark
                    ? 'text-gray-300 hover:bg-white/10'
                    : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Previous
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= data.pagination.totalPages}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                page >= data.pagination.totalPages
                  ? isDark ? 'text-gray-600 cursor-not-allowed' : 'text-gray-300 cursor-not-allowed'
                  : isDark
                    ? 'text-gray-300 hover:bg-white/10'
                    : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
