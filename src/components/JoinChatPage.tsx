import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../stores'
import { useAuthStore } from '../stores/authStore'
import { getSessionId } from '../services/session'
import { getWalletSession } from '../services/siwe'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export default function JoinChatPage() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { theme } = useThemeStore()
  const { token } = useAuthStore()

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Auto-join on load
  useEffect(() => {
    async function autoJoin() {
      if (!code) return

      try {
        const sessionId = getSessionId()
        console.log('[JoinChatPage] Joining with sessionId:', sessionId)

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId,
        }

        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }

        // Include wallet session if user has signed in with wallet (SIWE)
        const walletSession = getWalletSession()
        if (walletSession?.token) {
          headers['X-Wallet-Session'] = walletSession.token
        }

        console.log('[JoinChatPage] POST to:', `${API_BASE_URL}/chat/invite/${code}/join`)
        const response = await fetch(`${API_BASE_URL}/chat/invite/${code}/join`, {
          method: 'POST',
          headers,
        })
        console.log('[JoinChatPage] Response status:', response.status)

        const data = await response.json()
        console.log('[JoinChatPage] Response data:', data)

        if (!data.success) {
          setError(data.error || 'Invalid invite link')
          setIsLoading(false)
          return
        }

        // Navigate directly to the chat URL
        console.log('[JoinChatPage] Navigating to:', `/chat/${data.data.chatId}`)
        console.log('[JoinChatPage] Session ID after join:', getSessionId())
        navigate(`/chat/${data.data.chatId}`)
      } catch (err) {
        setError('Failed to join chat')
        setIsLoading(false)
      }
    }

    autoJoin()
  }, [code, token, navigate])

  if (isLoading) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center ${
          theme === 'dark' ? 'bg-juice-dark text-white' : 'bg-white text-gray-900'
        }`}
      >
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-juice-orange border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className={theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}>
            Joining chat...
          </p>
        </div>
      </div>
    )
  }

  // Error state
  return (
    <div
      className={`min-h-screen flex items-center justify-center ${
        theme === 'dark' ? 'bg-juice-dark text-white' : 'bg-white text-gray-900'
      }`}
    >
      <div className="text-center max-w-md px-4">
        <h1 className="text-xl font-semibold mb-6">{t('join.invalidInvite', 'Invalid Invite')}</h1>
        <button
          onClick={() => navigate('/')}
          className={`px-6 py-2 text-sm transition-colors ${
            theme === 'dark'
              ? 'text-gray-400 hover:text-white border border-white/20 hover:border-white/40'
              : 'text-gray-500 hover:text-gray-900 border border-gray-300 hover:border-gray-400'
          }`}
        >
          {t('join.goHome', 'Go Home')}
        </button>
      </div>
    </div>
  )
}
