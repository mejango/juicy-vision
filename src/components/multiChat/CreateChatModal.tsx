import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore, useChatStore } from '../../stores'
import * as multiChatApi from '../../services/multiChat'

interface CreateChatModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function CreateChatModal({
  isOpen,
  onClose,
}: CreateChatModalProps) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const { addChat, setActiveChat } = useChatStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [isEncrypted, setIsEncrypted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setIsSubmitting(true)
    setError(null)

    try {
      const chat = await multiChatApi.createChat({
        name: name.trim(),
        description: description.trim() || undefined,
        isPublic,
        encrypted: isEncrypted,
      })
      addChat(chat)
      setActiveChat(chat.id)
      onClose()
      // Reset form
      setName('')
      setDescription('')
      setIsPublic(true)
      setIsEncrypted(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create chat')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!isSubmitting) {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className={`relative w-full max-w-md mx-4 rounded-2xl shadow-xl ${
          theme === 'dark' ? 'bg-[#1a1a1a]' : 'bg-white'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            theme === 'dark' ? 'border-white/10' : 'border-gray-200'
          }`}
        >
          <h2
            className={`text-lg font-semibold ${
              theme === 'dark' ? 'text-white' : 'text-gray-900'
            }`}
          >
            {t('multiChat.createChat', 'Create Chat')}
          </h2>
          <button
            onClick={handleClose}
            className={`p-2 rounded-lg transition-colors ${
              theme === 'dark'
                ? 'hover:bg-white/10 text-gray-400'
                : 'hover:bg-gray-100 text-gray-500'
            }`}
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Error */}
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 text-red-500 text-sm">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label
              className={`block text-sm font-medium mb-1.5 ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              {t('multiChat.chatName', 'Chat Name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('multiChat.chatNamePlaceholder', 'My Project Chat')}
              className={`w-full px-4 py-2.5 rounded-lg border transition-colors ${
                theme === 'dark'
                  ? 'bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-juice-orange'
                  : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-juice-orange'
              } focus:outline-none focus:ring-1 focus:ring-juice-orange`}
              required
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label
              className={`block text-sm font-medium mb-1.5 ${
                theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
              }`}
            >
              {t('multiChat.description', 'Description')}{' '}
              <span className="text-gray-500 font-normal">
                ({t('ui.optional', 'optional')})
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t(
                'multiChat.descriptionPlaceholder',
                'What is this chat about?'
              )}
              rows={2}
              className={`w-full px-4 py-2.5 rounded-lg border transition-colors resize-none ${
                theme === 'dark'
                  ? 'bg-white/5 border-white/10 text-white placeholder-gray-500 focus:border-juice-orange'
                  : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-juice-orange'
              } focus:outline-none focus:ring-1 focus:ring-juice-orange`}
            />
          </div>

          {/* Options */}
          <div className="space-y-3 pt-2">
            {/* Public toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-juice-orange focus:ring-juice-orange"
              />
              <div>
                <div
                  className={`text-sm font-medium ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}
                >
                  {t('multiChat.publicChat', 'Public chat')}
                </div>
                <div
                  className={`text-xs ${
                    theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                  }`}
                >
                  {t(
                    'multiChat.publicDescription',
                    'Anyone can discover and join this chat'
                  )}
                </div>
              </div>
            </label>

            {/* Encrypted toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isEncrypted}
                onChange={(e) => setIsEncrypted(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-juice-orange focus:ring-juice-orange"
              />
              <div>
                <div
                  className={`text-sm font-medium ${
                    theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}
                >
                  {t('multiChat.encrypted', 'End-to-end encrypted')}
                </div>
                <div
                  className={`text-xs ${
                    theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                  }`}
                >
                  {t(
                    'multiChat.encryptedDescription',
                    'Messages are encrypted and only visible to members'
                  )}
                </div>
              </div>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className={`flex-1 py-2.5 px-4 rounded-lg font-medium transition-colors ${
                theme === 'dark'
                  ? 'bg-white/10 text-white hover:bg-white/20'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              } disabled:opacity-50`}
            >
              {t('ui.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="flex-1 py-2.5 px-4 rounded-lg font-medium bg-juice-orange text-white hover:bg-juice-orange/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? t('ui.creating', 'Creating...')
                : t('ui.create', 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
