/**
 * AccountLinkingBanner Component
 *
 * Shows when a user has both a connected wallet and passkey/managed account
 * with different addresses. Prompts them to link accounts for shared identity.
 */

import { useState } from 'react'
import { useAccountLinking } from '../../hooks'
import { useThemeStore } from '../../stores'

function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

interface AccountLinkingBannerProps {
  onLinkComplete?: () => void
}

export function AccountLinkingBanner({ onLinkComplete }: AccountLinkingBannerProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [showDetails, setShowDetails] = useState(false)
  const [linking, setLinking] = useState(false)

  const {
    hasMultipleAuthMethods,
    connectedWalletAddress,
    managedAccountAddress,
    isLinked,
    canLink,
    linkReason,
    loading,
    error,
    linkAccounts,
  } = useAccountLinking()

  // Don't show if not applicable
  if (!hasMultipleAuthMethods || isLinked || !canLink) {
    return null
  }

  const handleLink = async () => {
    setLinking(true)
    try {
      const success = await linkAccounts()
      if (success) {
        onLinkComplete?.()
      }
    } finally {
      setLinking(false)
    }
  }

  return (
    <div
      className={`p-3 mb-3 border ${
        isDark
          ? 'border-juice-orange/30 bg-juice-orange/5'
          : 'border-juice-orange/40 bg-juice-orange/5'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className={`text-xs font-medium ${isDark ? 'text-juice-orange' : 'text-juice-orange'}`}>
            Link your accounts?
          </p>
          <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            You're signed in with Touch ID and have a wallet connected. Link them to share your
            Juicy ID across both.
          </p>
        </div>
        <button
          onClick={handleLink}
          disabled={linking || loading}
          className={`shrink-0 px-3 py-1.5 text-xs font-medium transition-colors ${
            linking || loading
              ? 'bg-gray-500 text-gray-300 cursor-wait'
              : 'bg-juice-orange text-black hover:bg-juice-orange/90'
          }`}
        >
          {linking ? 'Linking...' : 'Link'}
        </button>
      </div>

      {/* Toggle details */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className={`mt-2 text-[10px] ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
      >
        {showDetails ? 'Hide details' : 'Show details'}
      </button>

      {/* Details section */}
      {showDetails && (
        <div className={`mt-2 pt-2 border-t text-[10px] ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Touch ID Account:</span>
              <span className={`font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                {managedAccountAddress ? shortenAddress(managedAccountAddress) : '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Connected Wallet:</span>
              <span className={`font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                {connectedWalletAddress ? shortenAddress(connectedWalletAddress) : '-'}
              </span>
            </div>
          </div>
          <p className={`mt-2 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
            Your Touch ID account will be the primary. Your connected wallet will inherit its Juicy ID.
          </p>
        </div>
      )}

      {/* Error display */}
      {error && (
        <p className="mt-2 text-[10px] text-red-400">{error}</p>
      )}

      {/* Reason why can't link (if applicable) */}
      {linkReason && !canLink && (
        <p className={`mt-2 text-[10px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
          {linkReason}
        </p>
      )}
    </div>
  )
}

/**
 * Compact version for showing linked status
 */
export function LinkedAccountsInfo() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const { isLinked, primaryAddress, linkedAddresses, unlinkAccount } = useAccountLinking()
  const [unlinking, setUnlinking] = useState<string | null>(null)

  if (!isLinked || linkedAddresses.length === 0) {
    return null
  }

  const handleUnlink = async (address: string) => {
    setUnlinking(address)
    try {
      await unlinkAccount(address)
    } finally {
      setUnlinking(null)
    }
  }

  return (
    <div className={`text-[10px] mt-2 pt-2 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
      <p className={`font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Linked Accounts ({linkedAddresses.length})
      </p>
      <div className="mt-1 space-y-1">
        {linkedAddresses.map((link) => (
          <div key={link.id} className="flex items-center justify-between">
            <span className={`font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {shortenAddress(link.linkedAddress)}
            </span>
            <button
              onClick={() => handleUnlink(link.linkedAddress)}
              disabled={unlinking === link.linkedAddress}
              className={`text-[10px] ${
                unlinking === link.linkedAddress
                  ? 'text-gray-500 cursor-wait'
                  : 'text-red-400 hover:text-red-300'
              }`}
            >
              {unlinking === link.linkedAddress ? '...' : 'Unlink'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
