import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { createInvite, type ChatInvite, type CreateInviteParams } from '../../services/multiChat'

export interface AnchorPosition {
  top: number
  left: number
  width: number
  height: number
}

interface InvitePopoverProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  chatName: string
  // Current user's permissions - affects what they can grant
  canGrantAdmin?: boolean
  canGrantInvitePermission?: boolean
  // Position of the anchor button (for smart positioning)
  anchorPosition?: AnchorPosition | null
}

export default function InviteModal({
  isOpen,
  onClose,
  chatId,
  chatName,
  canGrantAdmin = false,
  canGrantInvitePermission = true,
  anchorPosition,
}: InvitePopoverProps) {
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

  // Reset state when popover opens
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

  // Calculate popover position based on anchor
  const popoverStyle = useMemo(() => {
    if (!anchorPosition) {
      // Fallback to top-right if no anchor
      return { top: 16, right: 16 }
    }

    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
    const popoverHeight = 400 // Approximate max height
    const gap = 8 // Gap between button and popover

    // Check if button is in lower half of viewport
    const isInLowerHalf = anchorPosition.top > viewportHeight / 2

    if (isInLowerHalf) {
      // Show above the button
      return {
        bottom: viewportHeight - anchorPosition.top + gap,
        right: Math.max(16, typeof window !== 'undefined' ? window.innerWidth - anchorPosition.left - anchorPosition.width : 16),
      }
    } else {
      // Show below the button
      return {
        top: anchorPosition.top + anchorPosition.height + gap,
        right: Math.max(16, typeof window !== 'undefined' ? window.innerWidth - anchorPosition.left - anchorPosition.width : 16),
      }
    }
  }, [anchorPosition])

  if (!isOpen) return null

  return (
    <div className="fixed z-50" style={popoverStyle}>
      {/* Popover */}
      <div className={`w-80 p-4 border shadow-xl rounded-lg ${
        isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'
      }`}>
        {/* Close button */}
        <button
          onClick={onClose}
          className={`absolute top-3 right-3 p-1 transition-colors ${
            isDark ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h3 className={`text-sm font-semibold mb-1 pr-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {t('invite.header', 'Invite someone to this chat')}
        </h3>

        <p className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {t('invite.subtitle', 'Choose which permissions they\'ll have')}
        </p>

        {error && (
          <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded">
            {error}
          </div>
        )}

        {!invite ? (
          <>
            {/* Permission Settings */}
            <div className="space-y-2 mb-4">
              {/* Can send messages */}
              <button
                onClick={() => setCanSendMessages(!canSendMessages)}
                className="flex items-center gap-2 w-full text-left group"
              >
                <div className={`w-4 h-4 border-2 flex items-center justify-center transition-colors rounded-sm ${
                  canSendMessages
                    ? 'border-green-500 bg-green-500'
                    : isDark
                    ? 'border-white/30 group-hover:border-white/50'
                    : 'border-gray-300 group-hover:border-gray-400'
                }`}>
                  {canSendMessages && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  {t('invite.canSendMessages', 'Can send messages')}
                </span>
              </button>

              {/* Can invite others */}
              {canGrantInvitePermission && (
                <button
                  onClick={() => setCanInviteOthers(!canInviteOthers)}
                  className="flex items-center gap-2 w-full text-left group"
                >
                  <div className={`w-4 h-4 border-2 flex items-center justify-center transition-colors rounded-sm ${
                    canInviteOthers
                      ? 'border-green-500 bg-green-500'
                      : isDark
                      ? 'border-white/30 group-hover:border-white/50'
                      : 'border-gray-300 group-hover:border-gray-400'
                  }`}>
                    {canInviteOthers && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t('invite.canInviteOthers', 'Can invite others')}
                  </span>
                </button>
              )}

              {/* Can give out roles */}
              {canGrantAdmin && (
                <button
                  onClick={() => setCanPassOnRoles(!canPassOnRoles)}
                  className="flex items-center gap-2 w-full text-left group"
                >
                  <div className={`w-4 h-4 border-2 flex items-center justify-center transition-colors rounded-sm ${
                    canPassOnRoles
                      ? 'border-green-500 bg-green-500'
                      : isDark
                      ? 'border-white/30 group-hover:border-white/50'
                      : 'border-gray-300 group-hover:border-gray-400'
                  }`}>
                    {canPassOnRoles && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {t('invite.canPassOnRoles', 'Can invite others who can invite')}
                  </span>
                </button>
              )}
            </div>

            {/* Create button */}
            <div className="flex justify-end">
              <button
                onClick={handleCreateInvite}
                disabled={isLoading}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
                  isLoading
                    ? 'border-gray-500 text-gray-500 cursor-not-allowed'
                    : isDark
                    ? 'border-green-500 text-green-500 hover:bg-green-500/10'
                    : 'border-green-600 text-green-600 hover:bg-green-50'
                }`}
              >
                {isLoading
                  ? t('invite.creating', 'Creating...')
                  : t('invite.getLink', 'Get invite link')}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Invite Link Display */}
            <div className="space-y-2 mb-3">
              <label className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('invite.yourLink', 'Your invite link')}
              </label>

              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={invite.inviteUrl || ''}
                  className={`flex-1 px-2 py-1.5 border text-xs font-mono ${
                    isDark
                      ? 'bg-white/5 border-white/10 text-gray-300'
                      : 'bg-gray-50 border-gray-200 text-gray-700'
                  }`}
                />
                <button
                  onClick={handleCopy}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    copied
                      ? 'bg-green-600 text-black'
                      : 'bg-green-500 text-black hover:bg-green-600'
                  }`}
                >
                  {copied ? '✓' : t('invite.copy', 'Copy')}
                </button>
              </div>

              {/* Permission summary */}
              <div className={`p-2 text-xs ${isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                <p className="font-medium mb-1">
                  {t('invite.grantedPermissions', 'Link grants:')}
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                  {invite.canSendMessages && (
                    <li>{t('invite.canSendMessagesLabel', 'Can send messages')}</li>
                  )}
                  {invite.canInviteOthers && (
                    <li>{t('invite.canInviteOthersLabel', 'Can invite others')}</li>
                  )}
                  {invite.canPassOnRoles && (
                    <li>{t('invite.canPassOnRolesLabel', 'Can invite others who can invite')}</li>
                  )}
                </ul>
              </div>
            </div>

            {/* Create another */}
            <button
              onClick={() => setInvite(null)}
              className={`w-full py-1.5 text-xs font-medium transition-colors border ${
                isDark
                  ? 'border-white/20 text-gray-400 hover:text-white hover:border-white/40'
                  : 'border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300'
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
