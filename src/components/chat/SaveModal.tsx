import { useState, useEffect } from 'react'
import { useAccount, useSignMessage, useEnsName } from 'wagmi'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { signInWithWallet, hasValidWalletSession, getWalletSession } from '../../services/siwe'

interface SaveModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export default function SaveModal({ isOpen, onClose, onSaved }: SaveModalProps) {
  const { t } = useTranslation()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address, isConnected, chainId } = useAccount()
  const { data: ensName } = useEnsName({ address })
  const { signMessageAsync } = useSignMessage()

  const [isSigning, setIsSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Check if already has valid session
  const alreadySaved = hasValidWalletSession()
  const existingSession = getWalletSession()

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null)
      setSuccess(false)
      setIsSigning(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const displayName = ensName || (address ? truncateAddress(address) : '')

  const handleSign = async () => {
    if (!address || !chainId) return

    setIsSigning(true)
    setError(null)

    try {
      await signInWithWallet(
        address,
        chainId,
        async (message: string) => {
          const signature = await signMessageAsync({ message })
          return signature
        }
      )

      setSuccess(true)
      onSaved?.()

      // Close after brief success message
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (err) {
      console.error('SIWE sign-in failed:', err)
      if (err instanceof Error) {
        if (err.message.includes('rejected') || err.message.includes('denied')) {
          setError('Signature request was cancelled')
        } else {
          setError(err.message)
        }
      } else {
        setError('Failed to sign in')
      }
    } finally {
      setIsSigning(false)
    }
  }

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

        {/* Already saved state */}
        {alreadySaved && existingSession ? (
          <>
            <div className="flex items-center justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className={`text-lg font-semibold text-center mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {t('save.alreadySaved', 'Already Saved')}
            </h2>
            <p className={`text-sm text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('save.linkedTo', 'This session is linked to')} <span className="font-mono font-medium">{truncateAddress(existingSession.address)}</span>
            </p>
            <button
              onClick={onClose}
              className={`w-full mt-6 py-2.5 text-sm font-medium transition-colors ${
                isDark
                  ? 'bg-white/10 hover:bg-white/20 text-white'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
              }`}
            >
              {t('common.close', 'Close')}
            </button>
          </>
        ) : success ? (
          /* Success state */
          <>
            <div className="flex items-center justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className={`text-lg font-semibold text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {t('save.success', 'Saved!')}
            </h2>
            <p className={`text-sm text-center mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('save.successMessage', 'Your chats are now linked to your wallet.')}
            </p>
          </>
        ) : (
          /* Sign prompt */
          <>
            <h2 className={`text-lg font-semibold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {t('save.title', 'Save Chat')}
            </h2>

            <p className={`text-sm mb-6 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {t('save.description', 'Save this chat to')}{' '}
              <span className={`font-mono font-medium ${isDark ? 'text-juice-cyan' : 'text-teal-600'}`}>
                {displayName}
              </span>
              {t('save.descriptionSuffix', "'s account with a quick signature.")}
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleSign}
              disabled={isSigning || !isConnected}
              className={`w-full py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                isSigning || !isConnected
                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                  : 'bg-juice-orange hover:bg-juice-orange/90 text-juice-dark'
              }`}
            >
              {isSigning ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t('save.signing', 'Waiting for signature...')}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  {t('save.signButton', 'Sign to Save')}
                </>
              )}
            </button>

            <p className={`text-xs text-center mt-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {t('save.sessionInfo', 'Session lasts 30 days. No gas fees.')}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
