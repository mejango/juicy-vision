/**
 * LocalShareModal - Share local chats without authentication
 *
 * For unauthenticated users who want to share their chat:
 * 1. Generates a shareable code
 * 2. Stores the chat data in localStorage with that code
 * 3. Creates a shareable URL that can be opened on the same device
 *
 * For cross-device sharing, users are prompted to sign in.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore, useChatStore } from '../../stores'
// Message type imported from stores if needed

interface LocalShareModalProps {
  isOpen: boolean
  onClose: () => void
  conversationId: string
  conversationTitle: string
}

interface ShareableChat {
  id: string
  title: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  createdAt: string
  sharedBy: string | null // wallet address if connected
}

// Generate a short, shareable code
function generateShareCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// Store shared chat in localStorage
function storeSharedChat(code: string, chat: ShareableChat): void {
  const stored = localStorage.getItem('juice-shared-chats')
  const sharedChats: Record<string, ShareableChat> = stored ? JSON.parse(stored) : {}
  sharedChats[code] = chat
  localStorage.setItem('juice-shared-chats', JSON.stringify(sharedChats))
}

// Get shared chat from localStorage
export function getSharedChat(code: string): ShareableChat | null {
  const stored = localStorage.getItem('juice-shared-chats')
  if (!stored) return null
  const sharedChats: Record<string, ShareableChat> = JSON.parse(stored)
  return sharedChats[code] || null
}

export default function LocalShareModal({
  isOpen,
  onClose,
  conversationId,
  conversationTitle,
}: LocalShareModalProps) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const { conversations } = useChatStore()

  const [shareCode, setShareCode] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)

  // Generate share code when modal opens
  useEffect(() => {
    if (isOpen && !shareCode) {
      const conversation = conversations.find(c => c.id === conversationId)
      if (!conversation) return

      const code = generateShareCode()

      // Store the chat data
      const shareableChat: ShareableChat = {
        id: conversationId,
        title: conversationTitle || conversation.title,
        messages: conversation.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        createdAt: new Date().toISOString(),
        sharedBy: null, // Could add wallet address here
      }

      storeSharedChat(code, shareableChat)

      // Generate URL
      const url = `${window.location.origin}${window.location.pathname}#/shared/${code}`

      setShareCode(code)
      setShareUrl(url)
    }
  }, [isOpen, shareCode, conversationId, conversationTitle, conversations])

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      setShareCode(null)
      setShareUrl(null)
      setCopied(false)
      setShowAuthPrompt(false)
    }
  }, [isOpen])

  const handleCopy = async () => {
    if (!shareUrl) return

    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const textarea = document.createElement('textarea')
      textarea.value = shareUrl
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={`relative w-full max-w-md rounded-xl border shadow-2xl ${
          theme === 'dark'
            ? 'bg-juice-dark border-white/20'
            : 'bg-white border-gray-200'
        }`}
      >
        {/* Header */}
        <div
          className={`px-6 py-4 border-b ${
            theme === 'dark' ? 'border-white/10' : 'border-gray-100'
          }`}
        >
          <h2
            className={`text-lg font-semibold ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}
          >
            {t('share.title', 'Share Chat')}
          </h2>
          <p
            className={`text-sm mt-1 ${
              theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
            }`}
          >
            {t('share.subtitle', 'Share this conversation with others')}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {!showAuthPrompt ? (
            <>
              {/* Share URL */}
              <div className="space-y-2">
                <label
                  className={`text-sm font-medium ${
                    theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                  }`}
                >
                  {t('share.yourLink', 'Share link')}
                </label>

                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl || 'Generating...'}
                    className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-mono ${
                      theme === 'dark'
                        ? 'bg-white/5 border-white/20 text-gray-300'
                        : 'bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  />
                  <button
                    onClick={handleCopy}
                    disabled={!shareUrl}
                    className={`px-4 py-2.5 rounded-lg font-medium transition-colors ${
                      copied
                        ? 'bg-green-500 text-white'
                        : 'bg-juice-orange text-white hover:bg-juice-orange/90'
                    } ${!shareUrl ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {copied ? t('share.copied', 'Copied!') : t('share.copy', 'Copy')}
                  </button>
                </div>
              </div>

              {/* Local sharing note */}
              <div
                className={`p-3 rounded-lg text-sm ${
                  theme === 'dark' ? 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-200' : 'bg-yellow-50 border border-yellow-200 text-yellow-800'
                }`}
              >
                <p className="font-medium mb-1">
                  {t('share.localNote', 'Local sharing')}
                </p>
                <p className={theme === 'dark' ? 'text-yellow-200/80' : 'text-yellow-700'}>
                  {t('share.localDescription', 'This link works on this device. For cross-device sharing, sign in to sync your chats.')}
                </p>
              </div>

              {/* Sign in prompt */}
              <button
                onClick={() => setShowAuthPrompt(true)}
                className={`w-full py-2.5 rounded-lg font-medium transition-colors ${
                  theme === 'dark'
                    ? 'bg-white/10 text-white hover:bg-white/20'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {t('share.signInForMore', 'Sign in for cross-device sharing')}
              </button>
            </>
          ) : (
            <>
              {/* Auth prompt */}
              <div
                className={`p-4 rounded-lg text-center ${
                  theme === 'dark' ? 'bg-white/5' : 'bg-gray-50'
                }`}
              >
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-juice-orange/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-juice-orange" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className={`font-semibold mb-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {t('share.authRequired', 'Sign in to share across devices')}
                </h3>
                <p className={`text-sm mb-4 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  {t('share.authDescription', 'Create an account to share chats with anyone, anywhere. Your local link still works on this device!')}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAuthPrompt(false)}
                    className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
                      theme === 'dark'
                        ? 'bg-white/10 text-white hover:bg-white/20'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {t('share.useLocalLink', 'Use local link')}
                  </button>
                  <button
                    onClick={() => {
                      // Dispatch event to open settings/auth
                      window.dispatchEvent(new CustomEvent('juice:open-settings'))
                      onClose()
                    }}
                    className="flex-1 py-2.5 rounded-lg font-medium bg-juice-orange text-white hover:bg-juice-orange/90 transition-colors"
                  >
                    {t('share.signIn', 'Sign in')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className={`px-6 py-4 border-t flex justify-end ${
            theme === 'dark' ? 'border-white/10' : 'border-gray-100'
          }`}
        >
          <button
            onClick={onClose}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              theme === 'dark'
                ? 'text-gray-400 hover:text-white hover:bg-white/10'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            {t('share.close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}
