import { useState, useEffect, useMemo } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { useSettingsStore, useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import { signInWithPasskey } from '../../services/passkeyWallet'

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
    setClaudeApiKey,
    setPinataJwt,
    setAnkrApiKey,
    setTheGraphApiKey,
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

  // Load passkeys when panel opens
  useEffect(() => {
    if (isOpen && isLoggedIn) {
      loadPasskeys()
    }
  }, [isOpen, isLoggedIn, loadPasskeys])

  // Reset forms when closing
  useEffect(() => {
    if (!isOpen) {
      setShowEmailForm(false)
      setEmailError(null)
      setPasskeyError(null)
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
        await registerPasskey()
      } else {
        await signInWithPasskey()
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

  return (
    <div className="fixed z-50" style={popoverStyle}>
      <div className={`w-80 border shadow-xl rounded-lg ${
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
                  {user.email && <p>Signed in as <span className={isDark ? 'text-white' : 'text-gray-900'}>{user.email}</span></p>}
                  {managedAddress && <p className="font-mono mt-1">{truncateAddress(managedAddress)}</p>}
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
                    <span className={isLoggedIn && user?.email ? 'text-green-500' : isDark ? 'text-gray-600' : 'text-gray-400'}>
                      {isLoggedIn && user?.email ? 'Connected' : 'Add'}
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

                {/* Passkey */}
                <button
                  onClick={handleAddPasskey}
                  disabled={passkeyLoading}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                    isDark ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-50 text-gray-700'
                  } ${passkeyLoading ? 'opacity-50' : ''}`}
                >
                  <span>{passkeyLoading ? 'Setting up...' : 'Touch ID'}</span>
                  <span className={isLoggedIn && passkeys.length > 0 ? 'text-green-500' : isDark ? 'text-gray-600' : 'text-gray-400'}>
                    {isLoggedIn && passkeys.length > 0 ? `${passkeys.length}` : 'Add'}
                  </span>
                </button>
                {passkeyError && <p className="text-[10px] text-red-400 px-3">{passkeyError}</p>}

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

              {/* Sign Out */}
              {isLoggedIn && (
                <div className="pt-2">
                  <button
                    onClick={() => { logout(); onClose() }}
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
  )
}
