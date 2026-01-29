import { useState } from 'react'
import { useThemeStore } from '../../stores'
import ChatTable from '../components/ChatTable'
import ChatViewer from '../components/ChatViewer'
import { type AdminChat } from '../hooks/useAdminChats'

export default function ChatsPage() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [page, setPage] = useState(1)
  const [selectedChat, setSelectedChat] = useState<AdminChat | null>(null)

  return (
    <div className="p-6">
      <h1 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
        Chats
      </h1>

      {/* Chat table */}
      <div className={`border overflow-hidden ${
        isDark ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'
      }`}>
        <ChatTable
          page={page}
          onPageChange={setPage}
          onSelectChat={setSelectedChat}
        />
      </div>

      {/* Chat viewer slide-over */}
      {selectedChat && (
        <ChatViewer
          chat={selectedChat}
          onClose={() => setSelectedChat(null)}
        />
      )}
    </div>
  )
}
