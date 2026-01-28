import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { useSettingsStore, useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
// Note: signInWithPasskey removed - use authStore.loginWithPasskey() instead for managed mode
import { FRUIT_EMOJIS, getEmojiFromAddress } from '../chat/ParticipantAvatars'
import { getSessionId } from '../../services/session'
import { getWalletSession } from '../../services/siwe'

interface JuicyIdentity {
  id: string
  address: string
  emoji: string
  username: string
  formatted: string
  createdAt: string
  updatedAt: string
}

export interface AnchorPosition {
  top: number
  left: number
  width: number
  height: number
}

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
  anchorPosition?: AnchorPosition | null
}

export default function SettingsPanel({ isOpen, onClose, anchorPosition }: SettingsPanelProps) {
  const {
    claudeApiKey,
    pinataJwt,
    ankrApiKey,
    theGraphApiKey,
    selectedFruit,
    setClaudeApiKey,
    setPinataJwt,
    setAnkrApiKey,
    setTheGraphApiKey,
    setSelectedFruit,
    clearSettings,
  } = useSettingsStore()

  const [localClaudeKey, setLocalClaudeKey] = useState(claudeApiKey)
  const [localPinataJwt, setLocalPinataJwt] = useState(pinataJwt)
  const [localAnkrKey, setLocalAnkrKey] = useState(ankrApiKey)
  const [localTheGraphKey, setLocalTheGraphKey] = useState(theGraphApiKey)
  const [activeTab, setActiveTab] = useState<'account' | 'api'>('account')
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const {
    user,
    token,
    passkeys,
    isAuthenticated,
    logout,
    requestOtp,
    login,
    loginWithPasskey,
    registerPasskey,
    loadPasskeys,
  } = useAuthStore()
  const { address: managedAddress } = useManagedWallet()
  const isLoggedIn = isAuthenticated()

  // Wallet connection
  const { address: walletAddress, isConnected: isWalletConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()

  // Email add flow state
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [emailStep, setEmailStep] = useState<'email' | 'code'>('email')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)

  // Passkey state
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [passkeyError, setPasskeyError] = useState<string | null>(null)
  const [showPasskeysList, setShowPasskeysList] = useState(false)
  const [addingPasskey, setAddingPasskey] = useState(false)
  const [newPasskeyName, setNewPasskeyName] = useState('')

  // Juicy ID state - initialize from localStorage cache for instant display
  const [identity, setIdentity] = useState<JuicyIdentity | null>(() => {
    try {
      const cached = localStorage.getItem('juicy-identity')
      return cached ? JSON.parse(cached) : null
    } catch { return null }
  })
  const [identityUsername, setIdentityUsername] = useState(() => {
    try {
      const cached = localStorage.getItem('juicy-identity')
      return cached ? JSON.parse(cached).username : ''
    } catch { return '' }
  })
  const [identityLoading, setIdentityLoading] = useState(false)
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [identityAvailable, setIdentityAvailable] = useState<boolean | null>(null)
  const [checkingAvailability, setCheckingAvailability] = useState(false)
  const [pendingIdentity, setPendingIdentity] = useState<{ emoji: string; username: string } | null>(null)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)

  // Get API headers for identity requests
  const getApiHeaders = useCallback(() => {
    const sessionId = getSessionId()
    const walletSession = getWalletSession()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionId,
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    if (walletSession?.token) {
      headers['X-Wallet-Session'] = walletSession.token
    }
    return headers
  }, [token])

  // Load current identity
  const loadIdentity = useCallback(async () => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${apiUrl}/identity/me`, {
        headers: getApiHeaders(),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.data) {
          setIdentity(data.data)
          setIdentityUsername(data.data.username)
          // Cache for instant display next time
          try { localStorage.setItem('juicy-identity', JSON.stringify(data.data)) } catch {}
          // Notify other components (like ChatInput) of the loaded identity
          window.dispatchEvent(new CustomEvent('juice:identity-changed', { detail: data.data }))
        }
      }
    } catch (err) {
      console.error('Failed to load identity:', err)
    }
  }, [getApiHeaders])

  // Check identity availability
  const checkAvailability = useCallback(async (emoji: string, username: string) => {
    if (!username || username.length < 3) {
      setIdentityAvailable(null)
      return
    }
    setCheckingAvailability(true)
    try {
      const apiUrl = import.meta.env.VITE_API_URL || ''
      const params = new URLSearchParams({ emoji, username })
      const res = await fetch(`${apiUrl}/identity/check?${params}`, {
        headers: getApiHeaders(),
      })
      if (res.ok) {
        const data = await res.json()
        setIdentityAvailable(data.data?.available ?? null)
      }
    } catch (err) {
      console.error('Failed to check availability:', err)
    } finally {
      setCheckingAvailability(false)
    }
  }, [getApiHeaders])

  // Save identity (will prompt sign-in if not authenticated)
  const saveIdentity = useCallback(async (overrideEmoji?: string, overrideUsername?: string) => {
    const emoji = overrideEmoji || selectedFruit || (() => {
      const walletSession = getWalletSession()
      const sessionId = getSessionId()
      const addr = walletSession?.address ||
        `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
      return getEmojiFromAddress(addr)
    })()
    const username = overrideUsername || identityUsername

    if (!username || username.length < 3) {
      setIdentityError('Username must be at least 3 characters')
      return
    }

    // If not logged in, save pending identity and show sign-in prompt
    if (!isLoggedIn) {
      setPendingIdentity({ emoji, username })
      setShowSignInPrompt(true)
      return
    }

    setIdentityLoading(true)
    setIdentityError(null)

    try {
      const apiUrl = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${apiUrl}/identity/me`, {
        method: 'PUT',
        headers: getApiHeaders(),
        body: JSON.stringify({ emoji, username }),
      })
      const data = await res.json()
      if (data.success && data.data) {
        setIdentity(data.data)
        setIdentityError(null)
        setPendingIdentity(null)
        // Cache for instant display
        try { localStorage.setItem('juicy-identity', JSON.stringify(data.data)) } catch {}
        // Notify other components of identity change
        window.dispatchEvent(new CustomEvent('juice:identity-changed', { detail: data.data }))
      } else {
        setIdentityError(data.error || 'Failed to set identity')
      }
    } catch (err) {
      setIdentityError(err instanceof Error ? err.message : 'Failed to set identity')
    } finally {
      setIdentityLoading(false)
    }
  }, [selectedFruit, identityUsername, getApiHeaders, isLoggedIn])

  // Load passkeys when panel opens
  useEffect(() => {
    if (isOpen && isLoggedIn) {
      loadPasskeys()
    }
  }, [isOpen, isLoggedIn, loadPasskeys])

  // Listen for identity changes from other components (pre-populates before panel opens)
  useEffect(() => {
    const handleIdentityChange = (e: CustomEvent<JuicyIdentity>) => {
      setIdentity(e.detail)
      setIdentityUsername(e.detail.username)
      // Cache for instant display next time
      try { localStorage.setItem('juicy-identity', JSON.stringify(e.detail)) } catch {}
    }
    window.addEventListener('juice:identity-changed', handleIdentityChange as EventListener)
    return () => window.removeEventListener('juice:identity-changed', handleIdentityChange as EventListener)
  }, [])

  // Load identity when panel opens (in case no other component loaded it yet)
  useEffect(() => {
    if (isOpen && !identity) {
      loadIdentity()
    }
  }, [isOpen, identity, loadIdentity])

  // Auto-save pending identity after sign-in
  useEffect(() => {
    if (isLoggedIn && pendingIdentity) {
      setShowSignInPrompt(false)
      // Small delay to ensure token is set
      const timer = setTimeout(() => {
        saveIdentity(pendingIdentity.emoji, pendingIdentity.username)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isLoggedIn, pendingIdentity, saveIdentity])

  // Check availability when username or selected fruit changes
  useEffect(() => {
    if (!identityUsername || identityUsername.length < 3) {
      setIdentityAvailable(null)
      return
    }

    // Don't check if it's the current identity
    const currentEmoji = selectedFruit || (() => {
      const walletSession = getWalletSession()
      const sessionId = getSessionId()
      const addr = walletSession?.address ||
        `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
      return getEmojiFromAddress(addr)
    })()

    if (identity && identity.emoji === currentEmoji && identity.username.toLowerCase() === identityUsername.toLowerCase()) {
      setIdentityAvailable(true)
      return
    }

    const timer = setTimeout(() => {
      checkAvailability(currentEmoji, identityUsername)
    }, 300)

    return () => clearTimeout(timer)
  }, [identityUsername, selectedFruit, identity, checkAvailability])

  // Reset forms when closing
  useEffect(() => {
    if (!isOpen) {
      setShowEmailForm(false)
      setEmailError(null)
      setPasskeyError(null)
      setIdentityError(null)
    }
  }, [isOpen])

  const handleSave = () => {
    setClaudeApiKey(localClaudeKey)
    setPinataJwt(localPinataJwt)
    setAnkrApiKey(localAnkrKey)
    setTheGraphApiKey(localTheGraphKey)
    onClose()
  }

  const handleClear = () => {
    setLocalClaudeKey('')
    setLocalPinataJwt('')
    setLocalAnkrKey('')
    setLocalTheGraphKey('')
    clearSettings()
  }

  // Email OTP handlers
  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailLoading(true)
    setEmailError(null)

    try {
      const result = await requestOtp(emailInput)
      if (result.code) {
        setDevCode(result.code)
      }
      setEmailStep('code')
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setEmailLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailLoading(true)
    setEmailError(null)

    try {
      await login(emailInput, codeInput)
      setShowEmailForm(false)
      setEmailInput('')
      setCodeInput('')
      setEmailStep('email')
      setDevCode(null)
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setEmailLoading(false)
    }
  }

  // Passkey handler
  const handleAddPasskey = async () => {
    setPasskeyLoading(true)
    setPasskeyError(null)

    try {
      if (isLoggedIn && token) {
        // Already logged in - register additional passkey
        await registerPasskey()
      } else {
        // Not logged in - authenticate with passkey (creates managed user)
        await loginWithPasskey()
      }
    } catch (err) {
      console.error('Passkey error:', err)
      if (err instanceof Error) {
        const msg = err.message.toLowerCase()
        if (!msg.includes('cancelled') && !msg.includes('abort')) {
          setPasskeyError(err.message)
        }
      }
    } finally {
      setPasskeyLoading(false)
    }
  }

  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  // Calculate popover position based on anchor
  const popoverStyle = useMemo(() => {
    if (!anchorPosition) {
      return { top: 16, right: 16 }
    }

    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
    const gap = 8

    const isInLowerHalf = anchorPosition.top > viewportHeight / 2

    if (isInLowerHalf) {
      return {
        bottom: viewportHeight - anchorPosition.top + gap,
        right: Math.max(16, typeof window !== 'undefined' ? window.innerWidth - anchorPosition.left - anchorPosition.width : 16),
      }
    } else {
      return {
        top: anchorPosition.top + anchorPosition.height + gap,
        right: Math.max(16, typeof window !== 'undefined' ? window.innerWidth - anchorPosition.left - anchorPosition.width : 16),
      }
    }
  }, [anchorPosition])

  if (!isOpen) return null

  const hasCustomKeys = localClaudeKey || localPinataJwt || localAnkrKey || localTheGraphKey

  return createPortal(
    <>
      {/* Backdrop - catches clicks outside popover */}
      <div
        className="fixed inset-0 z-[109]"
        onClick={onClose}
      />
      <div className="fixed z-[110]" style={popoverStyle}>
        <div className={`w-80 border shadow-xl ${
          isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'
        }`}>
        {/* Header with close button */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${
          isDark ? 'border-white/10' : 'border-gray-100'
        }`}>
          <h2 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Settings
          </h2>
          <button
            onClick={onClose}
            className={`p-1 transition-colors ${
              isDark ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className={`flex border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <button
            onClick={() => setActiveTab('account')}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === 'account'
                ? isDark ? 'text-white border-b-2 border-white' : 'text-gray-900 border-b-2 border-gray-900'
                : isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            Account
          </button>
          <button
            onClick={() => setActiveTab('api')}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === 'api'
                ? isDark ? 'text-white border-b-2 border-white' : 'text-gray-900 border-b-2 border-gray-900'
                : isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            API Keys
          </button>
        </div>

        {/* Content */}
        <div className="p-4 max-h-80 overflow-y-auto">
          {activeTab === 'account' ? (
            <div className="space-y-3">
              {/* Signed in state */}
              {isLoggedIn && user ? (
                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {user.email && !user.email.includes('@passkey.local') ? (
                    <p>Signed in as <span className={isDark ? 'text-white' : 'text-gray-900'}>{user.email}</span></p>
                  ) : (
                    <p>Signed in via <span className={isDark ? 'text-white' : 'text-gray-900'}>Touch ID</span> on {passkeys.length || 1} device{passkeys.length !== 1 ? 's' : ''}</p>
                  )}
                </div>
              ) : (
                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Sign in to sync chats across devices.
                </p>
              )}

              {/* Auth methods - simplified, no icons */}
              <div className="space-y-1">
                {/* Email */}
                {!showEmailForm ? (
                  <button
                    onClick={() => setShowEmailForm(true)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                      isDark ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <span>Email</span>
                    {/* Don't count auto-generated passkey emails as "connected" */}
                    <span className={isLoggedIn && user?.email && !user.email.includes('@passkey.local') ? 'text-green-500' : isDark ? 'text-gray-600' : 'text-gray-400'}>
                      {isLoggedIn && user?.email && !user.email.includes('@passkey.local') ? 'Connected' : 'Connect'}
                    </span>
                  </button>
                ) : (
                  <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                    {emailStep === 'email' ? (
                      <form onSubmit={handleRequestCode} className="space-y-2">
                        <input
                          type="email"
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          placeholder="you@example.com"
                          required
                          autoFocus
                          className={`w-full px-2 py-1.5 text-xs border outline-none ${
                            isDark
                              ? 'border-white/20 bg-transparent text-white placeholder-gray-500 focus:border-juice-cyan'
                              : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-juice-cyan'
                          }`}
                        />
                        {emailError && <p className="text-[10px] text-red-400">{emailError}</p>}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setShowEmailForm(false); setEmailError(null) }}
                            className={`flex-1 py-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={emailLoading || !emailInput}
                            className="flex-1 py-1 text-[10px] text-juice-cyan disabled:opacity-50"
                          >
                            {emailLoading ? '...' : 'Send Code'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <form onSubmit={handleVerifyCode} className="space-y-2">
                        <p className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          Code sent to {emailInput}
                        </p>
                        {devCode && (
                          <p className="text-[10px] text-yellow-500 font-mono">Dev: {devCode}</p>
                        )}
                        <input
                          type="text"
                          value={codeInput}
                          onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="000000"
                          required
                          autoFocus
                          maxLength={6}
                          className={`w-full px-2 py-1.5 text-xs font-mono text-center border outline-none ${
                            isDark
                              ? 'border-white/20 bg-transparent text-white focus:border-juice-cyan'
                              : 'border-gray-200 bg-white text-gray-900 focus:border-juice-cyan'
                          }`}
                        />
                        {emailError && <p className="text-[10px] text-red-400">{emailError}</p>}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setEmailStep('email'); setCodeInput(''); setEmailError(null) }}
                            className={`flex-1 py-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                          >
                            Back
                          </button>
                          <button
                            type="submit"
                            disabled={emailLoading || codeInput.length !== 6}
                            className="flex-1 py-1 text-[10px] text-juice-cyan disabled:opacity-50"
                          >
                            {emailLoading ? '...' : 'Verify'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {/* Passkey / Touch ID */}
                {isLoggedIn ? (
                  /* Logged in: expandable dropdown */
                  <div className={`border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                    <button
                      onClick={() => {
                        setShowPasskeysList(!showPasskeysList)
                        if (!showPasskeysList) {
                          loadPasskeys()
                        }
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                        isDark ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <span>Touch ID</span>
                      <div className="flex items-center gap-2">
                        <span><span className="text-green-500">{passkeys.length}</span> <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>· Add more</span></span>
                        <svg className={`w-3 h-3 transition-transform ${showPasskeysList ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </button>

                    {showPasskeysList && (
                    <div className={`px-3 pb-3 space-y-2 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                      {passkeyError && (
                        <p className="text-[10px] text-red-400 mt-2">{passkeyError}</p>
                      )}

                      {/* List of passkeys */}
                      {passkeys.length > 0 && (
                        <div className="space-y-1 mt-2">
                          {passkeys.map((pk) => {
                            const formatDevice = (deviceType: string | null | undefined): string => {
                              if (!deviceType) return 'Passkey'
                              switch (deviceType) {
                                case 'platform':
                                  if (typeof navigator !== 'undefined') {
                                    const ua = navigator.userAgent
                                    if (/Mac/i.test(ua)) return 'Mac'
                                    if (/iPhone/i.test(ua)) return 'iPhone'
                                    if (/iPad/i.test(ua)) return 'iPad'
                                    if (/Android/i.test(ua)) return 'Android'
                                    if (/Windows/i.test(ua)) return 'Windows'
                                  }
                                  return 'This Device'
                                case 'cross-platform':
                                case 'security_key':
                                  return 'Security Key'
                                default:
                                  return 'Passkey'
                              }
                            }

                            return (
                              <div key={pk.id} className="flex items-center justify-between text-xs py-1">
                                <div className="flex flex-col">
                                  <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>
                                    {pk.displayName || formatDevice(pk.deviceType)}
                                  </span>
                                  <span className={`text-[9px] font-mono ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                                    {/* Derive passkey-user-xxx from user email if it's a passkey.local email */}
                                    {user?.email?.match(/^passkey-([a-f0-9]+)@passkey\.local$/)?.[1]
                                      ? `passkey-user-${user.email.match(/^passkey-([a-f0-9]+)@passkey\.local$/)?.[1]}`
                                      : pk.id}
                                  </span>
                                </div>
                                <button
                                  onClick={async () => {
                                    if (confirm('Remove this passkey?')) {
                                      try {
                                        const { deletePasskey } = useAuthStore.getState()
                                        await deletePasskey(pk.id)
                                      } catch (err) {
                                        setPasskeyError(err instanceof Error ? err.message : 'Failed to remove')
                                      }
                                    }
                                  }}
                                  className={`p-1 transition-colors ${isDark ? 'text-gray-600 hover:text-red-400' : 'text-gray-400 hover:text-red-500'}`}
                                  title="Remove"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Add passkey */}
                      {addingPasskey ? (
                        <div className="mt-2 space-y-2">
                          <input
                            type="text"
                            value={newPasskeyName}
                            onChange={(e) => setNewPasskeyName(e.target.value)}
                            placeholder="Name this device (e.g. My Mac)"
                            autoFocus
                            className={`w-full px-2 py-1.5 text-xs border ${
                              isDark
                                ? 'bg-white/5 border-white/20 text-white placeholder-gray-500'
                                : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                            }`}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                setPasskeyLoading(true)
                                setPasskeyError(null)
                                registerPasskey(newPasskeyName.trim() || 'My Device')
                                  .then(() => {
                                    setAddingPasskey(false)
                                    setNewPasskeyName('')
                                  })
                                  .catch((err) => setPasskeyError(err instanceof Error ? err.message : 'Failed'))
                                  .finally(() => setPasskeyLoading(false))
                              }
                              if (e.key === 'Escape') {
                                setAddingPasskey(false)
                                setNewPasskeyName('')
                              }
                            }}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => { setAddingPasskey(false); setNewPasskeyName('') }}
                              className={`flex-1 py-1.5 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => {
                                setPasskeyLoading(true)
                                setPasskeyError(null)
                                registerPasskey(newPasskeyName.trim() || 'My Device')
                                  .then(() => {
                                    setAddingPasskey(false)
                                    setNewPasskeyName('')
                                  })
                                  .catch((err) => setPasskeyError(err instanceof Error ? err.message : 'Failed'))
                                  .finally(() => setPasskeyLoading(false))
                              }}
                              disabled={passkeyLoading}
                              className="flex-1 py-1.5 text-xs text-green-500 disabled:opacity-50"
                            >
                              {passkeyLoading ? '...' : 'Add'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-end mt-2">
                          <button
                            onClick={() => {
                              let defaultName = 'My Device'
                              if (typeof navigator !== 'undefined') {
                                const ua = navigator.userAgent
                                if (/Mac/i.test(ua)) defaultName = 'My Mac'
                                else if (/iPhone/i.test(ua)) defaultName = 'My iPhone'
                                else if (/iPad/i.test(ua)) defaultName = 'My iPad'
                                else if (/Android/i.test(ua)) defaultName = 'My Android'
                                else if (/Windows/i.test(ua)) defaultName = 'My PC'
                              }
                              setNewPasskeyName(defaultName)
                              setAddingPasskey(true)
                            }}
                            disabled={passkeyLoading}
                            className={`px-2 py-1 text-xs transition-colors disabled:opacity-50 border ${
                              isDark
                                ? 'text-green-400 border-green-500/30 hover:border-green-500/50'
                                : 'text-green-600 border-green-500/40 hover:border-green-500/60'
                            }`}
                          >
                            Add more
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                ) : (
                  /* Not logged in: simple connect button */
                  <button
                    onClick={handleAddPasskey}
                    disabled={passkeyLoading}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                      isDark ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <span>Touch ID</span>
                    <span className={isDark ? 'text-gray-600' : 'text-gray-400'}>
                      {passkeyLoading ? '...' : 'Connect'}
                    </span>
                  </button>
                )}

                {/* Wallet */}
                {isWalletConnected && walletAddress ? (
                  <div className={`flex items-center justify-between px-3 py-2 text-xs ${
                    isDark ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                    <span className="font-mono">{truncateAddress(walletAddress)}</span>
                    <button
                      onClick={() => disconnect()}
                      className="text-red-400 hover:text-red-300"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      const injected = connectors.find(c => c.id === 'injected')
                      if (injected) connect({ connector: injected })
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                      isDark ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <span>Wallet</span>
                    <span className={isDark ? 'text-gray-600' : 'text-gray-400'}>Connect</span>
                  </button>
                )}
              </div>

              {/* Juicy ID */}
              <div className={`pt-3 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                <p className={`text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Juicy ID
                </p>

                {/* Live preview of composite ID */}
                <p className={`text-sm mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {(() => {
                    const walletSession = getWalletSession()
                    const sessionId = getSessionId()
                    const currentAddress = walletSession?.address ||
                      `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
                    const defaultEmoji = getEmojiFromAddress(currentAddress)
                    // Use identity emoji first (saved on server), then local selection, then default
                    const emoji = identity?.emoji || selectedFruit || defaultEmoji
                    const name = identityUsername || identity?.username || ''
                    return `${emoji} ${name}`
                  })()}
                </p>

                {/* Emoji picker row */}
                <p className={`text-[10px] mb-1 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Pick a flavor</p>
                <div className="flex flex-wrap gap-1 mb-3">
                  {FRUIT_EMOJIS.map((fruit) => {
                    // Get default emoji based on current user's address
                    const walletSession = getWalletSession()
                    const sessionId = getSessionId()
                    const currentAddress = walletSession?.address ||
                      `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
                    const defaultEmoji = getEmojiFromAddress(currentAddress)
                    // Use identity emoji (saved on server) as source of truth, then local selection, then default
                    const currentEmoji = identity?.emoji || selectedFruit || defaultEmoji
                    const isSelected = fruit === currentEmoji

                    const handleEmojiClick = async () => {
                      const newEmoji = fruit === defaultEmoji ? null : fruit
                      setSelectedFruit(newEmoji)

                      // Sync to server so others see the change
                      try {
                        const apiUrl = import.meta.env.VITE_API_URL || ''
                        const walletSessionToken = walletSession?.token
                        const headers: Record<string, string> = {
                          'Content-Type': 'application/json',
                          'X-Session-ID': sessionId,
                        }
                        if (walletSessionToken) {
                          headers['X-Wallet-Session'] = walletSessionToken
                        }
                        await fetch(`${apiUrl}/chat/me/emoji`, {
                          method: 'PATCH',
                          headers,
                          body: JSON.stringify({ customEmoji: newEmoji }),
                        })
                      } catch (err) {
                        console.error('Failed to sync emoji:', err)
                      }
                    }

                    return (
                      <button
                        key={fruit}
                        onClick={handleEmojiClick}
                        className={`w-7 h-7 text-base flex items-center justify-center transition-all ${
                          isSelected
                            ? isDark
                              ? 'bg-white/20 ring-2 ring-juice-cyan'
                              : 'bg-gray-200 ring-2 ring-juice-cyan'
                            : isDark
                              ? 'hover:bg-white/10'
                              : 'hover:bg-gray-100'
                        }`}
                        title={fruit === defaultEmoji ? 'Default (based on your address)' : undefined}
                      >
                        {fruit}
                      </button>
                    )
                  })}
                </div>

                {/* Username input */}
                <p className={`text-[10px] mb-1 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Pick a name</p>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={identityUsername}
                      onChange={(e) => {
                        const val = e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20)
                        setIdentityUsername(val)
                        setIdentityError(null)
                      }}
                      placeholder="username"
                      className={`w-full px-2 py-1.5 text-xs border outline-none pr-6 ${
                        isDark
                          ? 'border-white/10 bg-transparent text-white placeholder-gray-600 focus:border-white/30'
                          : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-gray-300'
                      }`}
                    />
                    {/* Availability indicator */}
                    {identityUsername.length >= 3 && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs">
                        {checkingAvailability ? (
                          <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>...</span>
                        ) : identityAvailable === true ? (
                          <span className="text-green-500">&#10003;</span>
                        ) : identityAvailable === false ? (
                          <span className="text-red-400">&#10007;</span>
                        ) : null}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => saveIdentity()}
                    disabled={identityLoading || !identityUsername || identityUsername.length < 3 || identityAvailable === false}
                    className={`px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                      isDark
                        ? 'text-juice-cyan border border-juice-cyan/30 hover:border-juice-cyan/50'
                        : 'text-juice-cyan border border-juice-cyan/40 hover:border-juice-cyan/60'
                    }`}
                  >
                    {identityLoading ? '...' : identity ? 'Update' : 'Set'}
                  </button>
                </div>
                {identityError && (
                  <p className="text-[10px] text-red-400 mt-1">{identityError}</p>
                )}
                {/* Sign-in prompt when trying to save without auth */}
                {showSignInPrompt && (
                  <div className={`mt-2 p-2 text-xs rounded ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                    <p className={`mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      Sign in to claim your Juicy ID
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          try {
                            await loginWithPasskey()
                          } catch (err) {
                            setIdentityError(err instanceof Error ? err.message : 'Sign in failed')
                          }
                        }}
                        className={`flex-1 px-2 py-1.5 text-xs transition-colors ${
                          isDark
                            ? 'text-juice-cyan border border-juice-cyan/30 hover:border-juice-cyan/50'
                            : 'text-juice-cyan border border-juice-cyan/40 hover:border-juice-cyan/60'
                        }`}
                      >
                        Sign in with Touch ID
                      </button>
                      <button
                        onClick={() => {
                          setShowSignInPrompt(false)
                          setPendingIdentity(null)
                        }}
                        className={`px-2 py-1.5 text-xs transition-colors ${
                          isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'
                        }`}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                  3-20 chars, letters/numbers/underscore
                </p>

                {/* Address - subtle, small, full */}
                <p className={`text-[10px] font-mono mt-3 pt-2 border-t break-all ${isDark ? 'text-gray-600 border-white/5' : 'text-gray-400 border-gray-100'}`}>
                  {(() => {
                    // Priority: managed smart account > wallet session > session-based pseudo-address
                    if (managedAddress) return managedAddress
                    const walletSession = getWalletSession()
                    if (walletSession?.address) return walletSession.address
                    const sessionId = getSessionId()
                    return `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
                  })()}
                </p>
              </div>

              {/* Sign Out */}
              {isLoggedIn && (
                <div className="pt-2">
                  <button
                    onClick={() => {
                      localStorage.removeItem('juicy-identity')
                      logout()
                      onClose()
                    }}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Explanation */}
              <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Juicy Vision works out of the box. Add your own keys to use your own quotas.
              </p>

              {/* Claude API Key */}
              <div>
                <label className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Claude API Key
                </label>
                <input
                  type="password"
                  value={localClaudeKey}
                  onChange={(e) => setLocalClaudeKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className={`w-full mt-1 px-2 py-1.5 text-xs border outline-none ${
                    isDark
                      ? 'border-white/10 bg-transparent text-white placeholder-gray-600 focus:border-white/30'
                      : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-gray-300'
                  }`}
                />
              </div>

              {/* Pinata JWT */}
              <div>
                <label className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Pinata JWT
                </label>
                <input
                  type="password"
                  value={localPinataJwt}
                  onChange={(e) => setLocalPinataJwt(e.target.value)}
                  placeholder="For IPFS pinning"
                  className={`w-full mt-1 px-2 py-1.5 text-xs border outline-none ${
                    isDark
                      ? 'border-white/10 bg-transparent text-white placeholder-gray-600 focus:border-white/30'
                      : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-gray-300'
                  }`}
                />
              </div>

              {/* Ankr API Key */}
              <div>
                <label className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Ankr API Key
                </label>
                <input
                  type="password"
                  value={localAnkrKey}
                  onChange={(e) => setLocalAnkrKey(e.target.value)}
                  placeholder="For RPC requests"
                  className={`w-full mt-1 px-2 py-1.5 text-xs border outline-none ${
                    isDark
                      ? 'border-white/10 bg-transparent text-white placeholder-gray-600 focus:border-white/30'
                      : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-gray-300'
                  }`}
                />
              </div>

              {/* The Graph API Key */}
              <div>
                <label className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  The Graph API Key
                </label>
                <input
                  type="password"
                  value={localTheGraphKey}
                  onChange={(e) => setLocalTheGraphKey(e.target.value)}
                  placeholder="For price history"
                  className={`w-full mt-1 px-2 py-1.5 text-xs border outline-none ${
                    isDark
                      ? 'border-white/10 bg-transparent text-white placeholder-gray-600 focus:border-white/30'
                      : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-gray-300'
                  }`}
                />
              </div>

              {/* Actions */}
              <div className="flex justify-between pt-2">
                {hasCustomKeys && (
                  <button
                    onClick={handleClear}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Clear all
                  </button>
                )}
                <div className="flex-1" />
                <button
                  onClick={handleSave}
                  className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
                    isDark
                      ? 'border-white/30 text-gray-300 hover:border-white/50 hover:text-white'
                      : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
                  }`}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </>,
    document.body
  )
}
