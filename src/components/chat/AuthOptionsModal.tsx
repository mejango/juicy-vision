import { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useThemeStore, useAuthStore } from '../../stores'
import { forgetPasskeyWallet } from '../../services/passkeyWallet'
import type { DeviceHint } from '../../services/passkey'

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
  onPasskeySuccess?: () => void
  title?: string
  description?: string
  anchorPosition?: AnchorPosition | null
}

// Get device name for display
function getDeviceName(): string {
  if (typeof navigator === 'undefined') return 'This device'
  const ua = navigator.userAgent
  if (/Mac/i.test(ua)) return 'This Mac'
  if (/iPhone/i.test(ua)) return 'This iPhone'
  if (/iPad/i.test(ua)) return 'This iPad'
  if (/Android/i.test(ua)) return 'This device'
  if (/Windows/i.test(ua)) return 'This PC'
  return 'This device'
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
  const { loginWithPasskey, signupWithPasskey } = useAuthStore()
  const isDark = theme === 'dark'

  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeviceSelect, setShowDeviceSelect] = useState(false)

  // Reset state when modal closes
  const handleClose = () => {
    setError(null)
    setShowDeviceSelect(false)
    onClose()
  }

  // Calculate popover position based on anchor
  const popoverStyle = useMemo(() => {
    if (!anchorPosition) {
      // Fallback to top-right if no anchor
      return { top: 16, right: 16 }
    }

    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
    const gap = 8 // Gap between button and popover
    const popoverWidth = 320 // w-80 = 20rem = 320px

    // Check if button is in lower half of viewport
    const isInLowerHalf = anchorPosition.top > viewportHeight / 2

    // Horizontal position: align left edge of popover with left edge of button
    // but ensure it doesn't overflow the viewport
    let left = anchorPosition.left
    if (left + popoverWidth > viewportWidth - 16) {
      // Would overflow right edge, align to right edge instead
      left = viewportWidth - popoverWidth - 16
    }
    left = Math.max(16, left)

    if (isInLowerHalf) {
      // Show above the button
      return {
        bottom: viewportHeight - anchorPosition.top + gap,
        left,
      }
    } else {
      // Show below the button
      return {
        top: anchorPosition.top + anchorPosition.height + gap,
        left,
      }
    }
  }, [anchorPosition])

  if (!isOpen) return null

  const handlePasskeyAuth = async (deviceHint: DeviceHint) => {
    setIsAuthenticating(true)
    setError(null)

    try {
      // Use managed passkey auth - creates user record and sets mode to 'managed'
      await loginWithPasskey(undefined, deviceHint)
      onPasskeySuccess?.()
      handleClose()
    } catch (err) {
      console.error('Passkey auth failed:', err)
      if (err instanceof Error) {
        const msg = err.message.toLowerCase()
        if (msg.includes('cancelled') || msg.includes('timed out') || msg.includes('not allowed') || msg.includes('abort')) {
          // User cancelled, no error needed
          setShowDeviceSelect(false)
        } else if (msg.includes('not supported')) {
          setError('Touch ID not supported on this device. Try Wallet instead.')
        } else if (msg.includes('credential not found') || msg.includes('not registered')) {
          // Server doesn't recognize the passkey - browser has stale credential
          // This happens when database is cleared but browser still has old passkey
          // Try to create a new account with a new passkey
          console.log('[AuthOptionsModal] Credential not found, clearing local state and trying signup...')
          forgetPasskeyWallet()
          localStorage.removeItem('juice-smart-account-address')
          localStorage.removeItem('juicy-identity')

          try {
            // Try to create a new account with a fresh passkey
            await signupWithPasskey(deviceHint)
            onPasskeySuccess?.()
            handleClose()
            return // Success - don't show error
          } catch (signupErr) {
            console.error('Passkey signup also failed:', signupErr)
            // If signup also fails, show error
            if (signupErr instanceof Error) {
              const signupMsg = signupErr.message.toLowerCase()
              if (signupMsg.includes('cancelled') || signupMsg.includes('abort')) {
                setError('Sign up cancelled. Try again or use Wallet.')
                setShowDeviceSelect(false)
              } else {
                setError('Could not create account. Try connecting a wallet instead.')
              }
            } else {
              setError('Could not create account. Try connecting a wallet instead.')
            }
          }
        } else {
          setError('Failed to sign in. Try another method.')
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

  // Device selection view
  if (showDeviceSelect) {
    return createPortal(
      <>
        <div className="fixed inset-0 z-[49]" onMouseDown={handleClose} />
        <div className="fixed z-50" style={popoverStyle}>
          <div
            className={`relative w-80 p-4 border shadow-xl ${
              isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'
            }`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => { e.stopPropagation(); handleClose() }}
              className={`absolute top-3 right-3 p-1 transition-colors ${
                isDark ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <button
              onClick={() => setShowDeviceSelect(false)}
              className={`flex items-center gap-1 text-xs mb-3 ${
                isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>

            <p className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Where is your passkey?
            </p>

            {error && (
              <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => handlePasskeyAuth('this-device')}
                disabled={isAuthenticating}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
                  isAuthenticating
                    ? 'border-gray-500 text-gray-500 cursor-wait'
                    : isDark
                    ? 'border-green-500 text-green-500 hover:bg-green-500/10'
                    : 'border-green-600 text-green-600 hover:bg-green-50'
                }`}
              >
                {isAuthenticating ? '...' : getDeviceName()}
              </button>

              <button
                onClick={() => handlePasskeyAuth('another-device')}
                disabled={isAuthenticating}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
                  isDark
                    ? 'border-white/30 text-gray-300 hover:border-white/50 hover:text-white'
                    : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
                }`}
              >
                Another device
              </button>
            </div>
          </div>
        </div>
      </>,
      document.body
    )
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
            onClick={() => setShowDeviceSelect(true)}
            disabled={isAuthenticating}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
              isAuthenticating
                ? 'border-gray-500 text-gray-500 cursor-wait'
                : isDark
                ? 'border-green-500 text-green-500 hover:bg-green-500/10'
                : 'border-green-600 text-green-600 hover:bg-green-50'
            }`}
          >
            {isAuthenticating ? '...' : t('auth.touchId', 'Touch ID')}
          </button>

          <button
            onClick={handleWalletClick}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
              isDark
                ? 'border-white/30 text-gray-300 hover:border-white/50 hover:text-white'
                : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
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
