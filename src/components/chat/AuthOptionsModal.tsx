import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { signInWithPasskey, type PasskeyWallet } from '../../services/passkeyWallet'

interface AuthOptionsModalProps {
  isOpen: boolean
  onClose: () => void
  onWalletClick: () => void
  onPasskeySuccess?: (wallet: PasskeyWallet) => void
}

export default function AuthOptionsModal({
  isOpen,
  onClose,
  onWalletClick,
  onPasskeySuccess,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className={`relative w-full max-w-sm p-6 ${
        isDark ? 'bg-juice-dark border border-white/10' : 'bg-white border border-gray-200'
      }`}>
        {/* Close button */}
        <button
          onClick={handleClose}
          className={`absolute top-3 right-3 p-1 transition-colors ${
            isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {t('auth.saveTitle', 'Save Your Chat')}
        </h2>

        <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {t('auth.saveDescription', 'Lets you use your chats from anywhere.')}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handlePasskeyAuth}
            disabled={isAuthenticating}
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              isDark
                ? 'bg-white/5 hover:bg-white/10 border border-white/10 text-white'
                : 'bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-900'
            } ${isAuthenticating ? 'opacity-50 cursor-wait' : ''}`}
          >
            {isAuthenticating ? '...' : t('auth.touchId', 'Touch ID')}
          </button>

          <button
            onClick={handleWalletClick}
            className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
              isDark
                ? 'bg-white/5 hover:bg-white/10 border border-white/10 text-white'
                : 'bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-900'
            }`}
          >
            {t('auth.wallet', 'Wallet')}
          </button>
        </div>
      </div>
    </div>
  )
}
