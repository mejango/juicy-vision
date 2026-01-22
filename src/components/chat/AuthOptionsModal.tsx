import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { signInWithPasskey, type PasskeyWallet } from '../../services/passkeyWallet'

export interface AnchorPosition {
  top: number
  left: number
  width: number
  height: number
}

interface AuthOptionsModalProps {
  isOpen: boolean
  onClose: () => void
  onWalletClick: () => void
  onPasskeySuccess?: (wallet: PasskeyWallet) => void
  title?: string
  description?: string
  anchorPosition?: AnchorPosition | null
}

export default function AuthOptionsModal({
  isOpen,
  onClose,
  onWalletClick,
  onPasskeySuccess,
  title,
  description,
  anchorPosition,
}: AuthOptionsModalProps) {
  const { t } = useTranslation()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state when modal closes
  const handleClose = () => {
    setError(null)
    onClose()
  }

  // Calculate popover position based on anchor
  const popoverStyle = useMemo(() => {
    if (!anchorPosition) {
      // Fallback to top-right if no anchor
      return { top: 16, right: 16 }
    }

    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
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

  const handlePasskeyAuth = async () => {
    setIsAuthenticating(true)
    setError(null)

    try {
      const wallet = await signInWithPasskey()
      onPasskeySuccess?.(wallet)
      handleClose()
    } catch (err) {
      console.error('Passkey auth failed:', err)
      if (err instanceof Error) {
        const msg = err.message.toLowerCase()
        if (msg.includes('cancelled') || msg.includes('timed out') || msg.includes('not allowed') || msg.includes('abort')) {
          // User cancelled, no error needed
        } else if (msg.includes('prf') || msg.includes('not supported')) {
          setError('Touch ID wallets not supported on this device. Try Wallet instead.')
        } else {
          setError('Failed to create wallet. Try another method.')
        }
      }
    } finally {
      setIsAuthenticating(false)
    }
  }

  const handleWalletClick = () => {
    handleClose()
    onWalletClick()
  }

  return createPortal(
    <>
      {/* Backdrop - catches clicks outside popover */}
      <div
        className="fixed inset-0 z-[49]"
        onMouseDown={handleClose}
      />
      <div className="fixed z-50" style={popoverStyle}>
        {/* Popover */}
        <div
          className={`relative w-80 p-4 border shadow-xl ${
            isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'
          }`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleClose()
            }}
            className={`absolute top-3 right-3 p-1 transition-colors ${
              isDark ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

        <h2 className={`text-sm font-semibold mb-1 pr-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {title || t('auth.saveTitle', 'Save Your Chat')}
        </h2>

        <p className={`text-xs mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {description || t('auth.saveDescription', 'Lets you use your chats from anywhere.')}
        </p>

        {error && (
          <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={handlePasskeyAuth}
            disabled={isAuthenticating}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
              isAuthenticating
                ? 'border-gray-500 text-gray-500 cursor-wait'
                : isDark
                ? 'border-white/30 text-gray-300 hover:border-white/50 hover:text-white'
                : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
            }`}
          >
            {isAuthenticating ? '...' : t('auth.touchId', 'Touch ID')}
          </button>

          <button
            onClick={handleWalletClick}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
              isDark
                ? 'border-green-500 text-green-500 hover:bg-green-500/10'
                : 'border-green-600 text-green-600 hover:bg-green-50'
            }`}
          >
            {t('auth.wallet', 'Wallet')}
          </button>
        </div>
      </div>
    </div>
    </>,
    document.body
  )
}
