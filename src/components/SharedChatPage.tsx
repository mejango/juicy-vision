import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useThemeStore } from '../stores'
import { useMultiChatStore } from '../stores/multiChatStore'
import MultiChatContainer from './multiChat/MultiChatContainer'

export default function SharedChatPage() {
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()
  const { theme } = useThemeStore()
  const { setActiveChat } = useMultiChatStore()

  // Set active chat
  useEffect(() => {
    if (!chatId) {
      navigate('/')
      return
    }

    // Set this as the active chat - MultiChatContainer will handle fetching
    setActiveChat(chatId)
  }, [chatId, setActiveChat, navigate])

  return (
    <div className={`h-screen flex flex-col ${theme === 'dark' ? 'bg-juice-dark' : 'bg-white'}`}>
      {/* Minimal back button */}
      <button
        onClick={() => navigate('/')}
        className={`absolute top-4 left-4 z-10 p-2 rounded-full transition-colors ${
          theme === 'dark'
            ? 'text-gray-500 hover:text-white hover:bg-white/10'
            : 'text-gray-400 hover:text-gray-900 hover:bg-black/5'
        }`}
        title="Back to Juicy Vision"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
      </button>

      {/* Chat container */}
      <div className="flex-1 overflow-hidden">
        <MultiChatContainer />
      </div>
    </div>
  )
}
