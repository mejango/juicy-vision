import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useDisconnect, useChainId, useSignMessage } from 'wagmi'
import { useThemeStore, useSettingsStore } from '../../stores'
import { useWalletBalances, formatEthBalance, formatUsdcBalance, useEnsNameResolved } from '../../hooks'
import { hasValidWalletSession, getWalletSession, clearWalletSession, signInWithWallet } from '../../services/siwe'
import { getSessionId } from '../../services/session'
import { getEmojiFromAddress, FRUIT_EMOJIS } from './ParticipantAvatars'
import { getPasskeyWallet, forgetPasskeyWallet, type PasskeyWallet } from '../../services/passkeyWallet'
import { useAuthStore } from '../../stores'
import { storage } from '../../services/storage'

export interface JuicyIdentity {
  emoji: string
  username: string
  formatted: string
}

export interface AnchorPosition {
  top: number
  left: number
  width: number
  height: number
}

interface JuicyIdPopoverProps {
  isOpen: boolean
  onClose: () => void
  anchorPosition: AnchorPosition | null
  onWalletClick: () => void
  onPasskeySuccess?: () => void
  onIdentitySet?: (identity: JuicyIdentity) => void
}

export function JuicyIdPopover({
  isOpen,
  onClose,
  anchorPosition,
  onWalletClick,
  onPasskeySuccess,
  onIdentitySet,
}: JuicyIdPopoverProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { selectedFruit, setSelectedFruit } = useSettingsStore()
  const popoverRef = useRef<HTMLDivElement>(null)

  // Check if wallet is already connected (wagmi)
  const { address: connectedAddress, isConnected } = useAccount()
  const chainId = useChainId()
  const { signMessageAsync } = useSignMessage()

  // Check managed passkey auth (Touch ID)
  const { isAuthenticated, user: authUser, token: authToken } = useAuthStore()
  const isManagedAuth = isAuthenticated()

  const isSignedIn = hasValidWalletSession() || isManagedAuth

  // Auth state (for not signed in)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [pendingClaim, setPendingClaim] = useState(false) // Waiting for sign-in to claim name

  // Identity state
  const [username, setUsername] = useState('')
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
  const [checkingAvailability, setCheckingAvailability] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Get current user's address and default emoji
  const currentAddress = useMemo(() => {
    // Priority: managed auth > SIWE session > pseudo-address
    // Managed auth users get address from smart account, not directly from user object
    const walletSession = getWalletSession()
    if (walletSession?.address) return walletSession.address
    const sessionId = getSessionId()
    return `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
  }, [authUser?.id])
  const defaultEmoji = getEmojiFromAddress(currentAddress)
  const currentEmoji = selectedFruit || defaultEmoji

  // Get API headers
  const getApiHeaders = useCallback(() => {
    const sessionId = getSessionId()
    const walletSession = getWalletSession()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    }
    if (walletSession?.token) {
      headers['X-Wallet-Session'] = walletSession.token
    }
    // Include managed auth JWT token (Touch ID sign-in)
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`
    }
    return headers
  }, [authToken])

  // Check availability - works for anyone setting up their name
  useEffect(() => {
    if (!username || username.length < 3) {
      setIsAvailable(null)
      return
    }

    const timer = setTimeout(async () => {
      setCheckingAvailability(true)
      try {
        const apiUrl = import.meta.env.VITE_API_URL || ''
        const params = new URLSearchParams({ emoji: currentEmoji, username })
        const res = await fetch(`${apiUrl}/identity/check?${params}`, {
          headers: getApiHeaders(),
        })
        if (res.ok) {
          const data = await res.json()
          setIsAvailable(data.available)
        }
      } catch (err) {
        console.error('Failed to check availability:', err)
      } finally {
        setCheckingAvailability(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [username, currentEmoji, getApiHeaders])

  // Save identity (called after sign-in is confirmed)
  const saveIdentity = async () => {
    if (!username || username.length < 3) return false

    setIsSaving(true)
    setSaveError(null)
    try {
      const apiUrl = import.meta.env.VITE_API_URL || ''

      // Get fresh auth token from store (not stale closure value)
      const { token: freshAuthToken } = useAuthStore.getState()
      const sessionId = getSessionId()
      const walletSession = getWalletSession()
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Session-ID': sessionId,
      }
      if (walletSession?.token) {
        headers['X-Wallet-Session'] = walletSession.token
      }
      if (freshAuthToken) {
        headers['Authorization'] = `Bearer ${freshAuthToken}`
      }

      // Save identity (emoji + username)
      const res = await fetch(`${apiUrl}/identity/me`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ emoji: currentEmoji, username }),
      })
      const data = await res.json()
      if (data.success && data.data) {
        // Also sync emoji to chat members so avatars update
        await fetch(`${apiUrl}/chat/me/emoji`, {
          method: 'PUT',
          headers, // Use fresh headers (not stale getApiHeaders())
          body: JSON.stringify({ emoji: currentEmoji }),
        }).catch(() => {}) // Ignore errors, identity is the main thing

        // Update local selectedFruit to match
        setSelectedFruit(currentEmoji === defaultEmoji ? null : currentEmoji)

        onIdentitySet?.(data.data)
        // Dispatch event so other components can refresh their identity
        window.dispatchEvent(new CustomEvent('juice:identity-changed', { detail: data.data }))
        onClose()
        return true
      } else {
        setSaveError(data.error || 'Failed to set identity')
        return false
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to set identity')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  // Handle "Set" button click
  const handleSave = async () => {
    if (!username || username.length < 3 || isAvailable === false) return

    if (isSignedIn) {
      // Already signed in - save directly
      await saveIdentity()
    } else {
      // Not signed in (regardless of wallet connection) - show sign-in prompt
      setPendingClaim(true)
    }
  }

  // Passkey auth - uses managed mode (creates user record)
  const { loginWithPasskey, signupWithPasskey } = useAuthStore()

  const handlePasskeyAuth = async () => {
    setIsAuthenticating(true)
    setAuthError(null)
    try {
      await loginWithPasskey()
      onPasskeySuccess?.()
      // If we have a pending claim, save the identity now
      if (pendingClaim && username && username.length >= 3) {
        // Small delay to ensure auth state is updated
        setTimeout(async () => {
          await saveIdentity()
        }, 100)
      } else {
        onClose()
      }
    } catch (err) {
      console.error('Passkey auth failed:', err)
      if (err instanceof Error) {
        const msg = err.message.toLowerCase()
        if (msg.includes('cancelled') || msg.includes('timed out') || msg.includes('not allowed') || msg.includes('abort')) {
          // User cancelled
        } else if (msg.includes('not supported')) {
          setAuthError('Touch ID not supported on this device.')
        } else if (msg.includes('credential not found') || msg.includes('not registered')) {
          // Server doesn't recognize the passkey - browser has stale credential
          // This happens when database is cleared but browser still has old passkey
          // Try to create a new account with a new passkey
          console.log('[JuicyIdPopover] Credential not found, clearing local state and trying signup...')
          forgetPasskeyWallet()
          localStorage.removeItem('juice-smart-account-address')
          localStorage.removeItem('juicy-identity')

          try {
            // Try to create a new account with a fresh passkey
            await signupWithPasskey()
            onPasskeySuccess?.()
            // If we have a pending claim, save the identity now
            if (pendingClaim && username && username.length >= 3) {
              setTimeout(async () => {
                await saveIdentity()
              }, 100)
            } else {
              onClose()
            }
            return // Success - don't show error
          } catch (signupErr) {
            console.error('Passkey signup also failed:', signupErr)
            if (signupErr instanceof Error) {
              const signupMsg = signupErr.message.toLowerCase()
              if (signupMsg.includes('cancelled') || signupMsg.includes('abort')) {
                setAuthError('Sign up cancelled. Try again or use Wallet.')
              } else {
                setAuthError('Could not create account. Try connecting a wallet instead.')
              }
            } else {
              setAuthError('Could not create account. Try connecting a wallet instead.')
            }
          }
        } else {
          setAuthError('Failed. Try another method.')
        }
      }
    } finally {
      setIsAuthenticating(false)
    }
  }

  // Sign in with connected wallet (SIWE) - then auto-save if pending claim
  const handleWalletSignIn = async () => {
    if (!connectedAddress || !chainId) return

    setIsAuthenticating(true)
    setAuthError(null)
    try {
      await signInWithWallet(
        connectedAddress,
        chainId,
        async (message: string) => {
          const signature = await signMessageAsync({ message })
          return signature
        }
      )
      // If we have a pending claim, save the identity now
      if (pendingClaim && username && username.length >= 3) {
        await saveIdentity()
      } else {
        onClose()
      }
    } catch (err) {
      console.error('Wallet sign-in failed:', err)
      setAuthError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setIsAuthenticating(false)
    }
  }

  // Position popover
  const popoverStyle = useMemo(() => {
    if (!anchorPosition) return { top: 16, right: 16 }

    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
    const gap = 8
    const popoverWidth = 280

    const isInLowerHalf = anchorPosition.top > viewportHeight / 2
    let left = anchorPosition.left
    if (left + popoverWidth > viewportWidth - 16) {
      left = viewportWidth - popoverWidth - 16
    }
    left = Math.max(16, left)

    if (isInLowerHalf) {
      return { bottom: viewportHeight - anchorPosition.top + gap, left }
    } else {
      return { top: anchorPosition.top + anchorPosition.height + gap, left }
    }
  }, [anchorPosition])

  // Reset state on close
  useEffect(() => {
    if (!isOpen) {
      setUsername('')
      setIsAvailable(null)
      setAuthError(null)
      setSaveError(null)
      setPendingClaim(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  return createPortal(
    <>
      <div className="fixed inset-0 z-[49]" onMouseDown={onClose} />
      <div className="fixed z-50" style={popoverStyle}>
        <div
          ref={popoverRef}
          className={`relative w-70 p-4 border shadow-xl ${
            isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'
          }`}
          onMouseDown={(e) => e.stopPropagation()}
        >
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

          {!pendingClaim ? (
            // Show name selection form - always show this first
            <>
              {/* Juicy ID header with selected emoji */}
              <p className={`text-[10px] font-medium pr-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Current Juicy ID
              </p>
              <p className="text-xl mb-4">{currentEmoji}</p>

              {/* Pick a flavor section */}
              <p className={`text-[10px] mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Pick a flavor
              </p>
              <div className="flex flex-wrap gap-1 mb-4">
                {FRUIT_EMOJIS.map((fruit) => {
                  const isSelected = selectedFruit === fruit || (!selectedFruit && fruit === defaultEmoji)
                  return (
                    <button
                      key={fruit}
                      onClick={() => setSelectedFruit(fruit === defaultEmoji ? null : fruit)}
                      className={`w-7 h-7 text-base flex items-center justify-center transition-all ${
                        isSelected
                          ? `border ${isDark ? 'border-juice-cyan bg-juice-cyan/10' : 'border-juice-cyan bg-juice-cyan/10'}`
                          : `border border-transparent ${isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'}`
                      }`}
                    >
                      {fruit}
                    </button>
                  )
                })}
              </div>

              {/* Pick a name section */}
              <p className={`text-[10px] mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Pick a name
              </p>
              <div className="flex gap-2 mb-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
                    placeholder="username"
                    className={`w-full px-2 py-1.5 text-xs border ${
                      isDark
                        ? 'bg-white/5 border-white/20 text-white placeholder-gray-500'
                        : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                    }`}
                  />
                  {username.length >= 3 && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs">
                      {checkingAvailability ? (
                        <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>...</span>
                      ) : isAvailable === true ? (
                        <span className="text-green-500">✓</span>
                      ) : isAvailable === false ? (
                        <span className="text-red-400">✗</span>
                      ) : null}
                    </span>
                  )}
                </div>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !username || username.length < 3 || isAvailable === false}
                  className={`px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                    isDark
                      ? 'text-juice-cyan border border-juice-cyan/30 hover:border-juice-cyan/50'
                      : 'text-juice-cyan border border-juice-cyan/40 hover:border-juice-cyan/60'
                  }`}
                >
                  {isSaving ? '...' : 'Set'}
                </button>
              </div>

              {saveError && (
                <p className="text-[10px] text-red-400 mb-1">{saveError}</p>
              )}
              <p className={`text-[10px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                3-20 chars, letters/numbers/underscore
              </p>
            </>
          ) : (
            // Clicked Set without being signed in - show sign-in options
            <>
              <h2 className={`text-sm font-semibold mb-4 pr-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Sign in to get {currentEmoji} {username}
              </h2>

              {authError && (
                <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  {authError}
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
                      ? 'border-green-500 text-green-500 hover:bg-green-500/10'
                      : 'border-green-600 text-green-600 hover:bg-green-50'
                  }`}
                >
                  {isAuthenticating ? '...' : 'Touch ID'}
                </button>
                {isConnected ? (
                  <button
                    onClick={handleWalletSignIn}
                    disabled={isAuthenticating}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      isAuthenticating
                        ? 'bg-gray-500 text-gray-300 cursor-wait'
                        : 'bg-green-500 text-black hover:bg-green-600'
                    }`}
                  >
                    {isAuthenticating ? '...' : 'Sign'}
                  </button>
                ) : (
                  <button
                    onClick={() => { onClose(); onWalletClick() }}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
                      isDark
                        ? 'border-white/30 text-gray-300 hover:border-white/50 hover:text-white'
                        : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
                    }`}
                  >
                    Wallet
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}

// Dispatch event to open wallet panel with anchor position
function openWalletPanel(e: React.MouseEvent<HTMLButtonElement>) {
  const rect = e.currentTarget.getBoundingClientRect()
  window.dispatchEvent(new CustomEvent('juice:open-wallet-panel', {
    detail: { anchorPosition: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } }
  }))
}

interface WalletInfoProps {
  inline?: boolean
}

export default function WalletInfo({ inline }: WalletInfoProps = {}) {
  const { theme } = useThemeStore()
  const { address, isConnected } = useAccount()
  const { ensName } = useEnsNameResolved(address)
  const { disconnect } = useDisconnect()
  const { totalEth, totalUsdc, loading: balancesLoading } = useWalletBalances()
  const [identity, setIdentity] = useState<JuicyIdentity | null>(null)
  const [passkeyWallet, setPasskeyWallet] = useState<PasskeyWallet | null>(() => getPasskeyWallet())
  const [isSessionStale, setIsSessionStale] = useState(false)

  // Auth store for managed passkey users (server-side passkey auth)
  const { user: authUser, token: authToken, isAuthenticated } = useAuthStore()

  // Reset stale connection - clears all auth state
  const resetConnection = useCallback(() => {
    clearWalletSession()
    forgetPasskeyWallet()
    storage.clearAll()
    setPasskeyWallet(null)
    setIdentity(null)
    setIsSessionStale(false)
    // Reload to get fresh state
    window.location.reload()
  }, [])

  // Juicy ID popover state
  const [juicyIdPopoverOpen, setJuicyIdPopoverOpen] = useState(false)
  const [juicyIdAnchorPosition, setJuicyIdAnchorPosition] = useState<AnchorPosition | null>(null)

  // User is "signed in" if they have a valid SIWE session
  const isSignedIn = hasValidWalletSession()

  // Listen for passkey wallet changes
  useEffect(() => {
    const handlePasskeyConnected = (e: CustomEvent<PasskeyWallet>) => {
      setPasskeyWallet(e.detail)
    }
    const handlePasskeyDisconnected = () => {
      setPasskeyWallet(null)
    }
    window.addEventListener('juice:passkey-connected', handlePasskeyConnected as EventListener)
    window.addEventListener('juice:passkey-disconnected', handlePasskeyDisconnected as EventListener)
    return () => {
      window.removeEventListener('juice:passkey-connected', handlePasskeyConnected as EventListener)
      window.removeEventListener('juice:passkey-disconnected', handlePasskeyDisconnected as EventListener)
    }
  }, [])

  // Validate session and fetch Juicy ID
  useEffect(() => {
    const validateAndFetchIdentity = async () => {
      const walletSession = getWalletSession()
      const hasLocalAuth = !!(passkeyWallet || walletSession)

      console.log('[WalletInfo] Validating session:', {
        hasPasskeyWallet: !!passkeyWallet,
        hasWalletSession: !!walletSession,
        walletSessionToken: walletSession?.token?.slice(0, 10) + '...',
      })

      // If no local auth data, nothing to validate
      if (!hasLocalAuth) {
        console.log('[WalletInfo] No local auth, not stale')
        setIsSessionStale(false)
        return
      }

      const apiUrl = import.meta.env.VITE_API_URL || ''
      const sessionId = getSessionId()

      // If we have local auth data (passkey or wallet session), validate with backend
      // Passkey wallets also create SIWE sessions, so we need to validate the token
      if (walletSession?.token) {
        try {
          console.log('[WalletInfo] Validating token with backend...')
          const validateRes = await fetch(`${apiUrl}/auth/siwe/session`, {
            headers: { 'X-Wallet-Session': walletSession.token }
          })

          console.log('[WalletInfo] Validation response:', validateRes.status)
          if (!validateRes.ok) {
            // Session is invalid/expired - stale
            console.log('[WalletInfo] Session invalid, marking stale')
            setIsSessionStale(true)
            return
          }
        } catch (err) {
          // Network error during validation - assume stale
          console.log('[WalletInfo] Validation error:', err)
          setIsSessionStale(true)
          return
        }
      } else if (passkeyWallet) {
        // Have passkey wallet in localStorage but no SIWE session - stale
        // (passkey wallets should always have an accompanying SIWE session)
        console.log('[WalletInfo] Passkey wallet but no SIWE session, marking stale')
        setIsSessionStale(true)
        return
      }

      // Session is valid, now fetch identity
      console.log('[WalletInfo] Session valid, not stale')
      setIsSessionStale(false)
      try {
        const headers: Record<string, string> = {
          'X-Session-ID': sessionId,
        }
        // Include managed auth token (Touch ID)
        const managedAuthToken = useAuthStore.getState().token
        if (managedAuthToken) {
          headers['Authorization'] = `Bearer ${managedAuthToken}`
        }
        if (walletSession?.token) {
          headers['X-Wallet-Session'] = walletSession.token
        }
        const res = await fetch(`${apiUrl}/identity/me`, { headers })

        if (res.ok) {
          const data = await res.json()
          if (data.success && data.data) {
            setIdentity(data.data)
          }
        }
      } catch {
        // Ignore identity fetch errors
      }
    }
    validateAndFetchIdentity()
  }, [address, passkeyWallet, authToken])

  // Listen for identity changes from other components
  useEffect(() => {
    const handleIdentityChange = (e: CustomEvent<JuicyIdentity>) => {
      setIdentity(e.detail)
    }
    window.addEventListener('juice:identity-changed', handleIdentityChange as EventListener)
    return () => window.removeEventListener('juice:identity-changed', handleIdentityChange as EventListener)
  }, [])

  // Get display name: Juicy ID > ENS > null (no emoji fallback)
  const getDisplayIdentity = () => {
    if (identity) return identity.formatted
    if (ensName) return ensName
    return null // Don't show emoji - will show "Set Juicy ID" prompt instead
  }

  const isAccountConnected = isConnected || address || passkeyWallet || isAuthenticated()

  const content = (
    <div className={`flex items-center text-xs ${
      theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
    }`}>
      {isSessionStale ? (
        // Stale session - show reset option
        <button
          onClick={resetConnection}
          className={`flex items-center transition-colors ${
            theme === 'dark'
              ? 'text-red-400/70 hover:text-red-400'
              : 'text-red-500/70 hover:text-red-500'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 mr-1.5 shrink-0" />
          <span>Reset connection</span>
        </button>
      ) : isAccountConnected ? (
        <>
          {/* Status dot and "Connected" */}
          <button
            onClick={openWalletPanel}
            className={`flex items-center transition-colors ${
              theme === 'dark'
                ? 'text-gray-500 hover:text-gray-300'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {isSignedIn || passkeyWallet || isAuthenticated() ? (
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 shrink-0" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full border border-current opacity-50 mr-1.5 shrink-0" />
            )}
            {getDisplayIdentity() ? (
              <>
                <span className="mr-1">Connected as</span>
                <span>{getDisplayIdentity()}</span>
              </>
            ) : (
              <span>Connected</span>
            )}
          </button>
          {/* Set Juicy ID prompt - when connected but no identity */}
          {!identity && (
            <button
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setJuicyIdAnchorPosition({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
                setJuicyIdPopoverOpen(true)
              }}
              className={`ml-1 transition-colors ${
                theme === 'dark'
                  ? 'text-juice-orange/70 hover:text-juice-orange'
                  : 'text-juice-orange/80 hover:text-juice-orange'
              }`}
            >
              · Set your Juicy ID
            </button>
          )}
          {/* Balances */}
          <button
            onClick={openWalletPanel}
            className={`transition-colors ${
              theme === 'dark'
                ? 'text-gray-500 hover:text-gray-300'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {balancesLoading ? (
              <span className="ml-2 opacity-50 hidden sm:inline">Loading...</span>
            ) : (
              <span className="hidden sm:inline">
                <span className="mx-1">·</span>
                {formatUsdcBalance(totalUsdc)} USDC
                <span className="mx-1">·</span>
                {formatEthBalance(totalEth)} ETH
              </span>
            )}
          </button>
        </>
      ) : (
        // Not connected - invite user to connect
        <>
          <button
            onClick={openWalletPanel}
            className={`flex items-center transition-colors ${
              theme === 'dark'
                ? 'text-gray-500 hover:text-gray-300'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full border border-current opacity-50 mr-1.5 shrink-0" />
            <span>Sign in</span>
          </button>
          {/* Set Juicy ID - available even before connecting */}
          {!identity && (
            <button
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                setJuicyIdAnchorPosition({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
                setJuicyIdPopoverOpen(true)
              }}
              className={`ml-1 transition-colors ${
                theme === 'dark'
                  ? 'text-juice-orange/70 hover:text-juice-orange'
                  : 'text-juice-orange/80 hover:text-juice-orange'
              }`}
            >
              · Set your Juicy ID
            </button>
          )}
        </>
      )}
    </div>
  )

  if (inline) {
    return (
      <>
        {content}
        <JuicyIdPopover
          isOpen={juicyIdPopoverOpen}
          onClose={() => setJuicyIdPopoverOpen(false)}
          anchorPosition={juicyIdAnchorPosition}
          onWalletClick={() => {
            window.dispatchEvent(new CustomEvent('juice:open-wallet-panel', {
              detail: { anchorPosition: juicyIdAnchorPosition, skipAuthModal: true }
            }))
          }}
          onIdentitySet={(newIdentity) => setIdentity(newIdentity)}
        />
      </>
    )
  }

  return (
    <div className="mt-2 px-6">
      {content}
      <JuicyIdPopover
        isOpen={juicyIdPopoverOpen}
        onClose={() => setJuicyIdPopoverOpen(false)}
        anchorPosition={juicyIdAnchorPosition}
        onWalletClick={() => {
          window.dispatchEvent(new CustomEvent('juice:open-wallet-panel', {
            detail: { anchorPosition: juicyIdAnchorPosition, skipAuthModal: true }
          }))
        }}
        onIdentitySet={(newIdentity) => setIdentity(newIdentity)}
      />
    </div>
  )
}
