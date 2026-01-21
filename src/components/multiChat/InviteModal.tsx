import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { createInvite, type ChatInvite, type CreateInviteParams } from '../../services/multiChat'

interface InviteModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  chatName: string
  // Current user's permissions - affects what they can grant
  canGrantAdmin?: boolean
  canGrantInvitePermission?: boolean
}

export default function InviteModal({
  isOpen,
  onClose,
  chatId,
  chatName,
  canGrantAdmin = false,
  canGrantInvitePermission = true,
}: InviteModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { t } = useTranslation()

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<ChatInvite | null>(null)
  const [copied, setCopied] = useState(false)

  // Invite settings
  const [canSendMessages, setCanSendMessages] = useState(true)
  const [canInviteOthers, setCanInviteOthers] = useState(false)
  const [canPassOnRoles, setCanPassOnRoles] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setInvite(null)
      setError(null)
      setCopied(false)
      setCanSendMessages(true)
      setCanInviteOthers(false)
      setCanPassOnRoles(false)
    }
  }, [isOpen])

  const handleCreateInvite = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const params: CreateInviteParams = {
        canSendMessages,
        canInviteOthers,
        canPassOnRoles,
      }
      const newInvite = await createInvite(chatId, params)
      setInvite(newInvite)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invite')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!invite?.inviteUrl) return

    try {
      await navigator.clipboard.writeText(invite.inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for browsers that don't support clipboard API
      const textarea = document.createElement('textarea')
      textarea.value = invite.inviteUrl
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
      <div className={`relative w-full max-w-sm p-6 ${
        isDark ? 'bg-juice-dark border border-white/10' : 'bg-white border border-gray-200'
      }`}>
        {/* Close button */}
        <button
          onClick={onClose}
          className={`absolute top-3 right-3 p-1 transition-colors ${
            isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {t('invite.header', 'Invite someone to this chat')}
        </h2>

        <p className={`text-sm mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {t('invite.subtitle', 'Choose which permissions they\'ll have')}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        {!invite ? (
          <>
            {/* Permission Settings */}
            <div className="space-y-3 mb-6">
              {/* Can send messages */}
              <button
                onClick={() => setCanSendMessages(!canSendMessages)}
                className="flex items-center gap-3 w-full text-left group"
              >
                <div className={`w-5 h-5 border-2 flex items-center justify-center transition-colors ${
                  canSendMessages
                    ? 'border-green-500'
                    : isDark
                    ? 'border-white/30 group-hover:border-white/50'
                    : 'border-gray-300 group-hover:border-gray-400'
                }`}>
                  {canSendMessages && (
                    <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('invite.canSendMessages', 'Can send messages')}
                </span>
              </button>

              {/* Can invite others */}
              {canGrantInvitePermission && (
                <button
                  onClick={() => setCanInviteOthers(!canInviteOthers)}
                  className="flex items-center gap-3 w-full text-left group"
                >
                  <div className={`w-5 h-5 border-2 flex items-center justify-center transition-colors ${
                    canInviteOthers
                      ? 'border-green-500'
                      : isDark
                      ? 'border-white/30 group-hover:border-white/50'
                      : 'border-gray-300 group-hover:border-gray-400'
                  }`}>
                    {canInviteOthers && (
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t('invite.canInviteOthers', 'Can invite others')}
                  </span>
                </button>
              )}

              {/* Can give out roles */}
              {canGrantAdmin && (
                <button
                  onClick={() => setCanPassOnRoles(!canPassOnRoles)}
                  className="flex items-center gap-3 w-full text-left group"
                >
                  <div className={`w-5 h-5 border-2 flex items-center justify-center transition-colors ${
                    canPassOnRoles
                      ? 'border-green-500'
                      : isDark
                      ? 'border-white/30 group-hover:border-white/50'
                      : 'border-gray-300 group-hover:border-gray-400'
                  }`}>
                    {canPassOnRoles && (
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t('invite.canPassOnRoles', 'Can give out roles')}
                  </span>
                </button>
              )}
            </div>

            {/* Create button - right aligned */}
            <div className="flex justify-end">
              <button
                onClick={handleCreateInvite}
                disabled={isLoading}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  isLoading
                    ? 'bg-gray-400 cursor-not-allowed text-white'
                    : 'text-green-500 hover:text-green-400 border border-green-500/30 hover:border-green-500/50'
                }`}
              >
                {isLoading
                  ? t('invite.creating', 'Creating...')
                  : t('invite.getLink', 'Get link')}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Invite Link Display */}
            <div className="space-y-3 mb-4">
              <label className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('invite.yourLink', 'Your invite link')}
              </label>

              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={invite.inviteUrl || ''}
                  className={`flex-1 px-3 py-2 border text-sm font-mono ${
                    isDark
                      ? 'bg-white/5 border-white/10 text-gray-300'
                      : 'bg-gray-50 border-gray-200 text-gray-700'
                  }`}
                />
                <button
                  onClick={handleCopy}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    copied
                      ? 'bg-green-500 text-white'
                      : 'text-green-500 hover:text-green-400 border border-green-500/30 hover:border-green-500/50'
                  }`}
                >
                  {copied ? t('invite.copied', 'Copied!') : t('invite.copy', 'Copy')}
                </button>
              </div>

              {/* Permission summary */}
              <div className={`p-3 text-sm ${isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                <p className="font-medium mb-1">
                  {t('invite.grantedPermissions', 'Link grants:')}
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  {invite.canSendMessages && (
                    <li>{t('invite.canSendMessagesLabel', 'Can send messages')}</li>
                  )}
                  {invite.canInviteOthers && (
                    <li>{t('invite.canInviteOthersLabel', 'Can invite others')}</li>
                  )}
                  {invite.canPassOnRoles && (
                    <li>{t('invite.canPassOnRolesLabel', 'Can give out roles')}</li>
                  )}
                </ul>
              </div>
            </div>

            {/* Create another */}
            <button
              onClick={() => setInvite(null)}
              className={`w-full py-2 text-sm font-medium transition-colors ${
                isDark
                  ? 'text-gray-400 hover:text-white'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t('invite.createAnother', 'Create another link')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
