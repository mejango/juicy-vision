import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useSignMessage } from 'wagmi'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { signInWithWallet, hasValidWalletSession, getWalletSession } from '../../services/siwe'
import { useEnsNameResolved } from '../../hooks/useEnsName'

export interface AnchorPosition {
  top: number
  left: number
  width: number
  height: number
}

interface SaveModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
  anchorPosition?: AnchorPosition | null
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export default function SaveModal({ isOpen, onClose, onSaved, anchorPosition }: SaveModalProps) {
  const { t } = useTranslation()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address, isConnected, chainId } = useAccount()
  const { ensName } = useEnsNameResolved(address)
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

        {/* Already saved state */}
        {alreadySaved && existingSession ? (
          <>
            <div className="flex items-center justify-center mb-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className={`text-sm font-semibold text-center mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {t('save.alreadySaved', 'Already Saved')}
            </h2>
            <p className={`text-xs text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('save.linkedTo', 'This session is linked to')} <span className="font-mono font-medium">{truncateAddress(existingSession.address)}</span>
            </p>
            <div className="flex justify-end mt-4">
              <button
                onClick={onClose}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
                  isDark
                    ? 'border-white/30 text-gray-300 hover:border-white/50 hover:text-white'
                    : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
                }`}
              >
                {t('common.close', 'Close')}
              </button>
            </div>
          </>
        ) : success ? (
          /* Success state */
          <>
            <div className="flex items-center justify-center mb-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className={`text-sm font-semibold text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {t('save.success', 'Saved!')}
            </h2>
            <p className={`text-xs text-center mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {t('save.successMessage', 'Your chats are now linked to your wallet.')}
            </p>
          </>
        ) : (
          /* Sign prompt */
          <>
            <h2 className={`text-sm font-semibold mb-2 pr-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {t('save.title', 'Save Chat')}
            </h2>

            <p className={`text-xs mb-4 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {t('save.description', 'Save this chat to')}{' '}
              <span className={`font-mono font-medium ${isDark ? 'text-juice-cyan' : 'text-teal-600'}`}>
                {displayName}
              </span>
              {t('save.descriptionSuffix', "'s account with a quick signature.")}
            </p>

            {error && (
              <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded">
                {error}
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleSign}
                disabled={isSigning || !isConnected}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border flex items-center gap-2 ${
                  isSigning || !isConnected
                    ? 'border-gray-500 text-gray-500 cursor-not-allowed'
                    : isDark
                    ? 'border-green-500 text-green-500 hover:bg-green-500/10'
                    : 'border-green-600 text-green-600 hover:bg-green-50'
                }`}
              >
                {isSigning && (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                {isSigning ? t('save.signing', 'Signing...') : t('save.signButton', 'Sign to Save')}
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
