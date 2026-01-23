import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { createInvite, type ChatInvite, type CreateInviteParams } from '../../services/chat'

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
  // Whether the current user has permission to invite at all
  canInvite?: boolean
  // Current user's permissions - affects what they can grant
  canGrantAdmin?: boolean
  canGrantInvitePermission?: boolean
  canGrantAiPermission?: boolean
  canGrantPauseAiPermission?: boolean
  // Position of the anchor button (for smart positioning)
  anchorPosition?: AnchorPosition | null
}

export default function InviteModal({
  isOpen,
  onClose,
  chatId,
  chatName,
  canInvite = true,
  canGrantAdmin = false,
  canGrantInvitePermission = true,
  canGrantAiPermission = true,
  canGrantPauseAiPermission = false,
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
  const [canInvokeAi, setCanInvokeAi] = useState(true)
  const [canPauseAi, setCanPauseAi] = useState(false)
  const [canGrantPauseAi, setCanGrantPauseAi] = useState(false)

  // Reset state when popover opens
  useEffect(() => {
    if (isOpen) {
      setInvite(null)
      setError(null)
      setCopied(false)
      setCanSendMessages(true)
      setCanInviteOthers(false)
      setCanPassOnRoles(false)
      setCanInvokeAi(true)
      setCanPauseAi(false)
      setCanGrantPauseAi(false)
    }
  }, [isOpen])

  // Auto-generate invite link when popover opens or settings change
  // Only generate if user has permission to invite
  useEffect(() => {
    if (!isOpen || !chatId || !canInvite) return

    const generateInvite = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const params: CreateInviteParams = {
          canSendMessages,
          canInviteOthers,
          canPassOnRoles,
          canInvokeAi,
          canPauseAi,
          canGrantPauseAi,
        }
        const newInvite = await createInvite(chatId, params)
        setInvite(newInvite)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create invite')
      } finally {
        setIsLoading(false)
      }
    }

    generateInvite()
  }, [isOpen, chatId, canInvite, canSendMessages, canInviteOthers, canPassOnRoles, canInvokeAi, canPauseAi, canGrantPauseAi])

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

  return createPortal(
    <>
      {/* Backdrop - catches clicks outside popover */}
      <div
        className="fixed inset-0 z-[49]"
        onClick={onClose}
      />
      <div className="fixed z-50" style={popoverStyle}>
        {/* Popover */}
        <div className={`w-80 p-4 border shadow-xl ${
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

        {/* No permission view */}
        {!canInvite ? (
          <>
            <h3 className={`text-sm font-semibold mb-2 pr-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {t('invite.noPermission', 'Can\'t Invite')}
            </h3>
            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('invite.noPermissionDescription', 'You don\'t have permission to invite people to this chat. Ask an admin to grant you invite permissions.')}
            </p>
          </>
        ) : (
          <>
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

        {/* Permission Settings */}
        <div className="space-y-2 mb-3">
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

          {/* Can use AI */}
          {canGrantAiPermission && (
            <button
              onClick={() => setCanInvokeAi(!canInvokeAi)}
              className="flex items-center gap-2 w-full text-left group"
            >
              <div className={`w-4 h-4 border-2 flex items-center justify-center transition-colors rounded-sm ${
                canInvokeAi
                  ? 'border-green-500 bg-green-500'
                  : isDark
                  ? 'border-white/30 group-hover:border-white/50'
                  : 'border-gray-300 group-hover:border-gray-400'
              }`}>
                {canInvokeAi && (
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('invite.canUseAi', 'Can use AI')}
              </span>
            </button>
          )}

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

          {/* Can pause AI */}
          {canGrantPauseAiPermission && (
            <button
              onClick={() => setCanPauseAi(!canPauseAi)}
              className="flex items-center gap-2 w-full text-left group"
            >
              <div className={`w-4 h-4 border-2 flex items-center justify-center transition-colors rounded-sm ${
                canPauseAi
                  ? 'border-green-500 bg-green-500'
                  : isDark
                  ? 'border-white/30 group-hover:border-white/50'
                  : 'border-gray-300 group-hover:border-gray-400'
              }`}>
                {canPauseAi && (
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('invite.canPauseAi', 'Can pause AI')}
              </span>
            </button>
          )}

          {/* Can invite others who can pause AI */}
          {canGrantPauseAiPermission && (
            <button
              onClick={() => setCanGrantPauseAi(!canGrantPauseAi)}
              className="flex items-center gap-2 w-full text-left group"
            >
              <div className={`w-4 h-4 border-2 flex items-center justify-center transition-colors rounded-sm ${
                canGrantPauseAi
                  ? 'border-green-500 bg-green-500'
                  : isDark
                  ? 'border-white/30 group-hover:border-white/50'
                  : 'border-gray-300 group-hover:border-gray-400'
              }`}>
                {canGrantPauseAi && (
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {t('invite.canGrantPauseAi', 'Can invite others who can pause AI')}
              </span>
            </button>
          )}
        </div>

        {/* Invite Link Display */}
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={isLoading ? '' : (invite?.inviteUrl || '')}
            placeholder={isLoading ? t('invite.generating', 'Generating...') : ''}
            className={`flex-1 px-2 py-1.5 border text-xs font-mono ${
              isDark
                ? 'bg-white/5 border-white/10 text-gray-300 placeholder:text-gray-500'
                : 'bg-gray-50 border-gray-200 text-gray-700 placeholder:text-gray-400'
            } ${isLoading ? 'animate-pulse' : ''}`}
          />
          <button
            onClick={handleCopy}
            disabled={isLoading || !invite?.inviteUrl}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              isLoading || !invite?.inviteUrl
                ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                : copied
                ? 'bg-green-600 text-black'
                : 'bg-green-500 text-black hover:bg-green-600'
            }`}
          >
            {copied ? '✓' : t('invite.copy', 'Copy')}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
    </>,
    document.body
  )
}
