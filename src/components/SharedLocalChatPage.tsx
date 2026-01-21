/**
 * SharedLocalChatPage - View locally shared chats
 *
 * Displays chats that were shared via LocalShareModal.
 * These chats are stored in localStorage and can be viewed/forked.
 */
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useThemeStore, useChatStore } from '../stores'
import { getSharedChat } from './chat/LocalShareModal'

interface SharedMessage {
  role: 'user' | 'assistant'
  content: string
}

export default function SharedLocalChatPage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const { createConversation, addMessage } = useChatStore()

  const [title, setTitle] = useState<string>('')
  const [messages, setMessages] = useState<SharedMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!code) {
      setError('Invalid share code')
      setLoading(false)
      return
    }

    const chat = getSharedChat(code)
    if (!chat) {
      setError('Chat not found. The share link may have expired or be from a different device.')
      setLoading(false)
      return
    }

    setTitle(chat.title)
    setMessages(chat.messages)
    setLoading(false)
  }, [code])

  const handleFork = () => {
    // Create a new conversation with the shared messages
    const convId = createConversation()

    // Add each message to the new conversation
    messages.forEach((msg) => {
      addMessage(convId, { role: msg.role, content: msg.content })
    })

    // Navigate to the main app
    navigate('/')
  }

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        theme === 'dark' ? 'bg-juice-dark text-white' : 'bg-white text-gray-900'
      }`}>
        <div className="animate-pulse">{t('shared.loading', 'Loading...')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 ${
        theme === 'dark' ? 'bg-juice-dark' : 'bg-gray-50'
      }`}>
        <div className={`max-w-md w-full p-6 rounded-xl border ${
          theme === 'dark' ? 'bg-juice-dark/80 border-white/20' : 'bg-white border-gray-200'
        }`}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className={`text-xl font-semibold text-center mb-2 ${
            theme === 'dark' ? 'text-white' : 'text-gray-900'
          }`}>
            {t('shared.notFound', 'Chat Not Found')}
          </h2>
          <p className={`text-center mb-6 ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {error}
          </p>
          <button
            onClick={() => navigate('/')}
            className="w-full py-3 rounded-lg font-medium bg-juice-orange text-white hover:bg-juice-orange/90 transition-colors"
          >
            {t('shared.goHome', 'Go to Home')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen flex flex-col ${
      theme === 'dark' ? 'bg-juice-dark' : 'bg-gray-50'
    }`}>
      {/* Header */}
      <header className={`sticky top-0 z-10 px-4 py-3 border-b backdrop-blur-sm ${
        theme === 'dark' ? 'bg-juice-dark/90 border-white/10' : 'bg-white/90 border-gray-200'
      }`}>
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className={`font-semibold ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}>
              {title}
            </h1>
            <p className={`text-sm ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
            }`}>
              {t('shared.sharedChat', 'Shared conversation')}
            </p>
          </div>
          <button
            onClick={handleFork}
            className="px-4 py-2 rounded-lg font-medium bg-juice-orange text-white hover:bg-juice-orange/90 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {t('shared.fork', 'Fork & Continue')}
          </button>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto py-6 px-4">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`mb-4 ${
                msg.role === 'user' ? 'flex justify-end' : ''
              }`}
            >
              <div
                className={`max-w-[85%] p-4 rounded-xl ${
                  msg.role === 'user'
                    ? 'bg-juice-orange text-white'
                    : theme === 'dark'
                    ? 'bg-white/10 text-gray-200'
                    : 'bg-white text-gray-800 border border-gray-200'
                }`}
              >
                <div className="text-xs font-medium mb-1 opacity-70">
                  {msg.role === 'user' ? t('shared.you', 'You') : t('shared.assistant', 'Juicy')}
                </div>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className={`sticky bottom-0 p-4 border-t backdrop-blur-sm ${
        theme === 'dark' ? 'bg-juice-dark/90 border-white/10' : 'bg-white/90 border-gray-200'
      }`}>
        <div className="max-w-3xl mx-auto text-center">
          <p className={`text-sm mb-3 ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {t('shared.forkPrompt', 'Want to continue this conversation?')}
          </p>
          <button
            onClick={handleFork}
            className="px-6 py-3 rounded-lg font-medium bg-juice-orange text-white hover:bg-juice-orange/90 transition-colors"
          >
            {t('shared.forkAndContinue', 'Fork & Continue')}
          </button>
        </div>
      </footer>
    </div>
  )
}
