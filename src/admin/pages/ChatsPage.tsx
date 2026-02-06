import { useState } from 'react'
import { useThemeStore } from '../../stores'
import { useAuthStore } from '../../stores/authStore'
import ChatTable from '../components/ChatTable'
import ChatViewer from '../components/ChatViewer'
import { type AdminChat } from '../hooks/useAdminChats'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export default function ChatsPage() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const token = useAuthStore((state) => state.token)

  const [page, setPage] = useState(1)
  const [selectedChat, setSelectedChat] = useState<AdminChat | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!token || isExporting) return

    setIsExporting(true)
    try {
      // Fetch all chats (up to 1000 for export)
      const response = await fetch(`${API_BASE_URL}/admin/chats?page=1&limit=1000`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })

      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to fetch chats for export')
      }

      const chats: AdminChat[] = data.data.chats

      // Convert to CSV
      const headers = ['ID', 'Name', 'Founder Address', 'Members', 'Messages', 'Public', 'Private', 'Created', 'Updated']
      const csvRows = [
        headers.join(','),
        ...chats.map(chat => [
          chat.id,
          `"${(chat.name || 'Untitled').replace(/"/g, '""')}"`,
          chat.founderAddress,
          chat.memberCount,
          chat.messageCount,
          chat.isPublic,
          chat.isPrivate,
          chat.createdAt,
          chat.updatedAt,
        ].join(','))
      ]

      const csvContent = csvRows.join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `chats-export-${new Date().toISOString().split('T')[0]}.csv`
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Chats
        </h1>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            isExporting
              ? 'opacity-50 cursor-not-allowed'
              : isDark
                ? 'bg-zinc-700 text-white hover:bg-zinc-600'
                : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
          }`}
        >
          {isExporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

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
