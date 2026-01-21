import { useState, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { Button, Input, Modal } from '../ui'
import { useSettingsStore, useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import { signInWithPasskey } from '../../services/passkeyWallet'

interface SettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

// Collapsible section component
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const { theme } = useThemeStore()

  return (
    <div className={`border ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
          theme === 'dark'
            ? 'hover:bg-white/5'
            : 'hover:bg-gray-50'
        }`}
      >
        <span className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
          {title}
        </span>
        <svg
          className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''} ${
            theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className={`px-4 pb-4 ${theme === 'dark' ? 'border-t border-white/10' : 'border-t border-gray-200'}`}>
          {children}
        </div>
      )}
    </div>
  )
}

export default function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const {
    claudeApiKey,
    pinataJwt,
    ankrApiKey,
    theGraphApiKey,
    bendystrawEndpoint,
    relayrEndpoint,
    setClaudeApiKey,
    setPinataJwt,
    setAnkrApiKey,
    setTheGraphApiKey,
    setBendystrawEndpoint,
    setRelayrEndpoint,
    clearSettings,
  } = useSettingsStore()

  const [localClaudeKey, setLocalClaudeKey] = useState(claudeApiKey)
  const [localPinataJwt, setLocalPinataJwt] = useState(pinataJwt)
  const [localAnkrKey, setLocalAnkrKey] = useState(ankrApiKey)
  const [localTheGraphKey, setLocalTheGraphKey] = useState(theGraphApiKey)
  const [localBendystraw, setLocalBendystraw] = useState(bendystrawEndpoint)
  const [localRelayr, setLocalRelayr] = useState(relayrEndpoint)
  const [showKeys, setShowKeys] = useState(false)
  const { theme } = useThemeStore()
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

  const handleSave = () => {
    setClaudeApiKey(localClaudeKey)
    setPinataJwt(localPinataJwt)
    setAnkrApiKey(localAnkrKey)
    setTheGraphApiKey(localTheGraphKey)
    setBendystrawEndpoint(localBendystraw)
    setRelayrEndpoint(localRelayr)
    onClose()
  }

  const handleClear = () => {
    if (confirm('Clear all settings? This cannot be undone.')) {
      clearSettings()
      setLocalClaudeKey('')
      setLocalPinataJwt('')
      setLocalAnkrKey('')
      setLocalTheGraphKey('')
    }
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
        // Add passkey to existing account
        await registerPasskey()
      } else {
        // Create new account with passkey
        const wallet = await signInWithPasskey()
        // The signInWithPasskey handles the auth store update
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

  // Truncate address helper
  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="md">
      <div className="space-y-4">
        {/* User Settings Section */}
        <CollapsibleSection title="User Settings" defaultOpen={isLoggedIn}>
          <div className="pt-4 space-y-4">
            {/* Account Info */}
            {isLoggedIn && user ? (
              <div className={`p-3 ${theme === 'dark' ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className={`text-xs font-medium ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
                    Signed In
                  </span>
                </div>
                {user.email && (
                  <div className="mb-2">
                    <span className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Email</span>
                    <p className={`text-sm ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{user.email}</p>
                  </div>
                )}
                {managedAddress && (
                  <div>
                    <span className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Custodial Wallet</span>
                    <p className={`text-sm font-mono ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                      {truncateAddress(managedAddress)}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                Sign in to sync your chats across devices.
              </p>
            )}

            {/* Authentication Methods */}
            <div>
              <h4 className={`text-xs font-medium mb-3 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                {isLoggedIn ? 'Authentication Methods' : 'Sign In With'}
              </h4>

              <div className="space-y-2">
                {/* Email */}
                {!showEmailForm ? (
                  <button
                    onClick={() => setShowEmailForm(true)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                      theme === 'dark'
                        ? 'bg-white/5 hover:bg-white/10 text-white'
                        : 'bg-gray-50 hover:bg-gray-100 text-gray-900'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span>Email</span>
                    </div>
                    {isLoggedIn && user?.email ? (
                      <span className="text-green-400 text-xs">Connected</span>
                    ) : (
                      <span className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Add</span>
                    )}
                  </button>
                ) : (
                  <div className={`p-3 ${theme === 'dark' ? 'bg-white/5' : 'bg-gray-50'}`}>
                    {emailStep === 'email' ? (
                      <form onSubmit={handleRequestCode} className="space-y-3">
                        <input
                          type="email"
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          placeholder="you@example.com"
                          required
                          autoFocus
                          className={`w-full px-3 py-2 text-sm border transition-colors outline-none ${
                            theme === 'dark'
                              ? 'border-white/20 bg-transparent text-white placeholder-gray-500 focus:border-juice-cyan'
                              : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-juice-cyan'
                          }`}
                        />
                        {emailError && (
                          <p className="text-xs text-red-400">{emailError}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setShowEmailForm(false)
                              setEmailError(null)
                            }}
                            className={`flex-1 py-2 text-xs transition-colors ${
                              theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                            }`}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={emailLoading || !emailInput}
                            className="flex-1 py-2 text-xs text-juice-cyan hover:text-juice-cyan/80 disabled:opacity-50"
                          >
                            {emailLoading ? 'Sending...' : 'Send Code'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <form onSubmit={handleVerifyCode} className="space-y-3">
                        <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                          Enter the code sent to <strong>{emailInput}</strong>
                        </p>
                        {devCode && (
                          <div className="p-2 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs">
                            Dev: <strong className="font-mono">{devCode}</strong>
                          </div>
                        )}
                        <input
                          type="text"
                          value={codeInput}
                          onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="000000"
                          required
                          autoFocus
                          maxLength={6}
                          className={`w-full px-3 py-2 text-sm font-mono text-center tracking-widest border transition-colors outline-none ${
                            theme === 'dark'
                              ? 'border-white/20 bg-transparent text-white placeholder-gray-500 focus:border-juice-cyan'
                              : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-juice-cyan'
                          }`}
                        />
                        {emailError && (
                          <p className="text-xs text-red-400">{emailError}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEmailStep('email')
                              setCodeInput('')
                              setEmailError(null)
                            }}
                            className={`flex-1 py-2 text-xs transition-colors ${
                              theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                            }`}
                          >
                            Back
                          </button>
                          <button
                            type="submit"
                            disabled={emailLoading || codeInput.length !== 6}
                            className="flex-1 py-2 text-xs text-juice-cyan hover:text-juice-cyan/80 disabled:opacity-50"
                          >
                            {emailLoading ? 'Verifying...' : 'Verify'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {/* Passkey / Touch ID */}
                <button
                  onClick={handleAddPasskey}
                  disabled={passkeyLoading}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                    theme === 'dark'
                      ? 'bg-white/5 hover:bg-white/10 text-white'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-900'
                  } ${passkeyLoading ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                    </svg>
                    <span>{passkeyLoading ? 'Setting up...' : 'Touch ID / Passkey'}</span>
                  </div>
                  {isLoggedIn && passkeys.length > 0 ? (
                    <span className="text-green-400 text-xs">{passkeys.length} registered</span>
                  ) : (
                    <span className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Add</span>
                  )}
                </button>
                {passkeyError && (
                  <p className="text-xs text-red-400 px-3">{passkeyError}</p>
                )}

                {/* Wallet */}
                {isWalletConnected && walletAddress ? (
                  <div className={`flex items-center justify-between px-3 py-2 text-sm ${
                    theme === 'dark' ? 'bg-white/5 text-white' : 'bg-gray-50 text-gray-900'
                  }`}>
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                      <span className="font-mono text-xs">{truncateAddress(walletAddress)}</span>
                    </div>
                    <button
                      onClick={() => disconnect()}
                      className="text-xs text-red-400 hover:text-red-300"
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
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                      theme === 'dark'
                        ? 'bg-white/5 hover:bg-white/10 text-white'
                        : 'bg-gray-50 hover:bg-gray-100 text-gray-900'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                      <span>Wallet</span>
                    </div>
                    <span className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Connect</span>
                  </button>
                )}
              </div>
            </div>

            {/* Sign Out */}
            {isLoggedIn && (
              <button
                onClick={() => {
                  logout()
                  onClose()
                }}
                className={`w-full py-2 text-sm font-medium border transition-colors ${
                  theme === 'dark'
                    ? 'border-red-500/50 text-red-400 hover:bg-red-500/10'
                    : 'border-red-200 text-red-600 hover:bg-red-50'
                }`}
              >
                Sign Out
              </button>
            )}
          </div>
        </CollapsibleSection>

        {/* App Settings Section */}
        <CollapsibleSection title="App Settings" defaultOpen={false}>
          <div className="pt-4 space-y-4">
            {/* Claude API Key */}
            <div>
              <Input
                label="Claude API Key"
                type={showKeys ? 'text' : 'password'}
                value={localClaudeKey}
                onChange={(e) => setLocalClaudeKey(e.target.value)}
                placeholder="sk-ant-..."
                rightElement={
                  <button
                    type="button"
                    onClick={() => setShowKeys(!showKeys)}
                    className="text-gray-400 hover:text-white"
                  >
                    {showKeys ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                }
              />
              <p className="mt-1 text-xs text-gray-500">
                Get your API key from{' '}
                <a
                  href="https://console.anthropic.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-juice-cyan hover:underline"
                >
                  console.anthropic.com
                </a>
              </p>
            </div>

            {/* Pinata JWT */}
            <div>
              <Input
                label="Pinata JWT (optional)"
                type={showKeys ? 'text' : 'password'}
                value={localPinataJwt}
                onChange={(e) => setLocalPinataJwt(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIs..."
              />
              <p className="mt-1 text-xs text-gray-500">
                For pinning project metadata to IPFS.{' '}
                <a
                  href="https://app.pinata.cloud/developers/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-juice-cyan hover:underline"
                >
                  Get JWT from Pinata
                </a>
              </p>
            </div>

            {/* Ankr API Key */}
            <div>
              <Input
                label="Ankr API Key (optional)"
                type={showKeys ? 'text' : 'password'}
                value={localAnkrKey}
                onChange={(e) => setLocalAnkrKey(e.target.value)}
                placeholder="abc123..."
              />
              <p className="mt-1 text-xs text-gray-500">
                For RPC requests.{' '}
                <a
                  href="https://www.ankr.com/rpc/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-juice-cyan hover:underline"
                >
                  Get API key from Ankr
                </a>
              </p>
            </div>

            {/* The Graph API Key */}
            <div>
              <Input
                label="The Graph API Key"
                type={showKeys ? 'text' : 'password'}
                value={localTheGraphKey}
                onChange={(e) => setLocalTheGraphKey(e.target.value)}
                placeholder="02c70b717f22ba9a341a29655139ebd9"
              />
              <p className="mt-1 text-xs text-gray-500">
                For Uniswap pool price history. Default key provided.{' '}
                <a
                  href="https://thegraph.com/studio/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-juice-cyan hover:underline"
                >
                  Get your own from The Graph
                </a>
              </p>
            </div>

            {/* Divider */}
            <div className={`border-t pt-4 ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
              <h3 className={`text-sm font-medium mb-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Advanced</h3>
            </div>

            {/* Bendystraw Endpoint */}
            <Input
              label="Bendystraw GraphQL Endpoint"
              value={localBendystraw}
              onChange={(e) => setLocalBendystraw(e.target.value)}
              placeholder="https://api.bendystraw.xyz/graphql"
            />

            {/* Relayr Endpoint */}
            <Input
              label="Relayr API Endpoint"
              value={localRelayr}
              onChange={(e) => setLocalRelayr(e.target.value)}
              placeholder="https://api.relayr.ba5ed.com"
            />
          </div>
        </CollapsibleSection>

        {/* Actions */}
        <div className={`flex gap-3 pt-4 border-t ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
          <Button onClick={handleClear} variant="ghost" className="text-red-400">
            Clear All
          </Button>
          <div className="flex-1" />
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button onClick={handleSave} variant="outline">
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
