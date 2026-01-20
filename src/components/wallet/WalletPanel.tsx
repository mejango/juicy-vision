import { useState } from 'react'
import { useAccount, useConnect, useDisconnect, useBalance, useEnsName } from 'wagmi'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import { Modal } from '../ui'

interface WalletPanelProps {
  isOpen: boolean
  onClose: () => void
}

function shortenAddress(address: string, chars = 6): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

// Mode selector - self-custody vs managed
function ModeSelector({ onSelectMode }: {
  onSelectMode: (mode: 'self_custody' | 'managed') => void
}) {
  const { theme } = useThemeStore()

  return (
    <div className="space-y-3">
      <p className={`text-sm text-center mb-4 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
        How would you like to connect?
      </p>

      {/* Self-custody - Browser wallet */}
      <button
        onClick={() => onSelectMode('self_custody')}
        className={`w-full p-4 border-2 text-left transition-all
          ${theme === 'dark'
            ? 'border-juice-cyan/50 bg-juice-cyan/10 hover:bg-juice-cyan/20 hover:border-juice-cyan'
            : 'border-teal-500 bg-teal-50 hover:bg-teal-100'
          }`}
      >
        <div className="flex items-center gap-3">
          <svg className={`w-6 h-6 ${theme === 'dark' ? 'text-juice-cyan' : 'text-teal-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <div>
            <div className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              Connect Wallet
            </div>
            <div className={`text-xs mt-0.5 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
              Use MetaMask, Rainbow, or other wallet
            </div>
          </div>
        </div>
      </button>

      {/* Managed - Email */}
      <button
        onClick={() => onSelectMode('managed')}
        className={`w-full p-4 border-2 text-left transition-all
          ${theme === 'dark'
            ? 'border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30'
            : 'border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300'
          }`}
      >
        <div className="flex items-center gap-3">
          <svg className={`w-6 h-6 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <div>
            <div className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              Continue with Email
            </div>
            <div className={`text-xs mt-0.5 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
              We'll manage a wallet for you
            </div>
          </div>
        </div>
      </button>
    </div>
  )
}

// Self-custody wallet connection
function SelfCustodyConnect({ onBack }: { onBack: () => void }) {
  const { theme } = useThemeStore()
  const { setMode } = useAuthStore()
  const { connect, connectors, isPending, error } = useConnect()

  const handleConnect = (connector: typeof connectors[number]) => {
    setMode('self_custody')
    connect({ connector })
  }

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className={`flex items-center gap-2 text-sm ${
          theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
        Connect your wallet to manage funds directly
      </p>

      {error && (
        <div className={`p-3 text-sm border-2 ${
          theme === 'dark'
            ? 'border-red-500/50 bg-red-500/10 text-red-400'
            : 'border-red-300 bg-red-50 text-red-600'
        }`}>
          {error.message}
        </div>
      )}

      <div className="space-y-2">
        {connectors.map((connector) => (
          <button
            key={connector.id}
            onClick={() => handleConnect(connector)}
            disabled={isPending}
            className={`w-full p-3 border-2 flex items-center justify-center gap-3 font-medium transition-all
              disabled:opacity-50 disabled:cursor-not-allowed
              ${theme === 'dark'
                ? 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30'
                : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50 hover:border-gray-300'
              }`}
          >
            {connector.name}
          </button>
        ))}
      </div>
    </div>
  )
}

// Email OTP flow for managed mode
function EmailAuth({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const { theme } = useThemeStore()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)

  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`${API_BASE_URL}/auth/request-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to send code')
      }

      // In dev mode, the code is returned directly
      if (data.data.code) {
        setDevCode(data.data.code)
      }

      setStep('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`${API_BASE_URL}/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Invalid code')
      }

      // Store auth data
      const authStore = useAuthStore.getState()
      authStore.setMode('managed')
      // The authStore will handle storing the token and user
      // For now, we trigger login through the store
      await authStore.login(email, code)

      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className={`flex items-center gap-2 text-sm ${
          theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {error && (
        <div className={`p-3 text-sm border-2 ${
          theme === 'dark'
            ? 'border-red-500/50 bg-red-500/10 text-red-400'
            : 'border-red-300 bg-red-50 text-red-600'
        }`}>
          {error}
        </div>
      )}

      {step === 'email' ? (
        <form onSubmit={handleRequestCode} className="space-y-4">
          <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            Enter your email to receive a one-time code
          </p>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className={`w-full p-3 border-2 font-mono transition-colors outline-none
              ${theme === 'dark'
                ? 'border-white/20 bg-white/5 text-white placeholder-gray-500 focus:border-juice-orange'
                : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-juice-orange'
              }`}
          />

          <button
            type="submit"
            disabled={isLoading || !email}
            className="w-full p-3 bg-juice-orange text-black font-medium hover:bg-juice-orange/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Sending...' : 'Send Code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-4">
          <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
            Enter the 6-digit code sent to <strong>{email}</strong>
          </p>

          {devCode && (
            <div className={`p-3 text-sm border-2 ${
              theme === 'dark'
                ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400'
                : 'border-yellow-300 bg-yellow-50 text-yellow-700'
            }`}>
              Dev mode: Your code is <strong className="font-mono">{devCode}</strong>
            </div>
          )}

          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            required
            maxLength={6}
            className={`w-full p-3 border-2 font-mono text-2xl text-center tracking-[0.5em] transition-colors outline-none
              ${theme === 'dark'
                ? 'border-white/20 bg-white/5 text-white placeholder-gray-500 focus:border-juice-orange'
                : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-juice-orange'
              }`}
          />

          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="w-full p-3 bg-juice-orange text-black font-medium hover:bg-juice-orange/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Verifying...' : 'Verify Code'}
          </button>

          <button
            type="button"
            onClick={() => setStep('email')}
            className={`w-full text-sm ${theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  )
}

// Connected wallet view (self-custody)
function SelfCustodyWalletView({ onTopUp, onDisconnect }: {
  onTopUp: () => void
  onDisconnect: () => void
}) {
  const { theme } = useThemeStore()
  const { address } = useAccount()
  const { data: ensName } = useEnsName({ address })
  const { data: ethBalance } = useBalance({ address })

  if (!address) return null

  return (
    <div className="space-y-4">
      {/* Address display */}
      <div className={`p-4 border-2 ${
        theme === 'dark' ? 'border-white/20 bg-white/5' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs uppercase tracking-wide ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`}>
            Wallet
          </span>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className={`text-xs ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
              Connected
            </span>
          </div>
        </div>
        <div className={`font-mono text-lg ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
          {ensName || shortenAddress(address)}
        </div>
        {ensName && (
          <div className={`font-mono text-sm mt-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
            {shortenAddress(address)}
          </div>
        )}
      </div>

      {/* Balance */}
      <div className={`p-4 border-2 ${
        theme === 'dark' ? 'border-white/20 bg-white/5' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className={`text-xs uppercase tracking-wide mb-3 ${
          theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
        }`}>
          Balance
        </div>
        <div className="flex items-center justify-between">
          <span className={`flex items-center gap-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
            <span className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-xs">Ξ</span>
            ETH
          </span>
          <span className={`font-mono font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            {ethBalance ? parseFloat(ethBalance.formatted).toFixed(4) : '0.0000'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onTopUp}
          className="flex-1 p-3 bg-juice-cyan text-black font-medium hover:bg-juice-cyan/90 transition-colors"
        >
          Top Up
        </button>
        <button
          onClick={onDisconnect}
          className={`p-3 border-2 font-medium transition-colors ${
            theme === 'dark'
              ? 'border-red-500/50 text-red-400 hover:bg-red-500/10'
              : 'border-red-300 text-red-600 hover:bg-red-50'
          }`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// Managed account view
function ManagedAccountView({ onDisconnect }: { onDisconnect: () => void }) {
  const { theme } = useThemeStore()
  const { user } = useAuthStore()
  const { address, balances, loading } = useManagedWallet()
  const [copied, setCopied] = useState(false)

  if (!user) return null

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="space-y-4">
      {/* Account display */}
      <div className={`p-4 border-2 ${
        theme === 'dark' ? 'border-white/20 bg-white/5' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs uppercase tracking-wide ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`}>
            Managed Account
          </span>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className={`text-xs ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
              Active
            </span>
          </div>
        </div>
        <div className={`text-lg ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
          {user.email}
        </div>
      </div>

      {/* Wallet address */}
      {address && (
        <div className={`p-4 border-2 ${
          theme === 'dark' ? 'border-white/20 bg-white/5' : 'border-gray-200 bg-gray-50'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs uppercase tracking-wide ${
              theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
            }`}>
              Wallet Address
            </span>
            <button
              onClick={copyAddress}
              className={`text-xs px-2 py-1 transition-colors ${
                theme === 'dark'
                  ? 'text-juice-cyan hover:bg-white/10'
                  : 'text-cyan-600 hover:bg-gray-100'
              }`}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className={`font-mono text-sm break-all ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            {shortenAddress(address, 10)}
          </div>
        </div>
      )}

      {/* Balance display */}
      {loading ? (
        <div className={`p-4 border-2 ${
          theme === 'dark' ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'
        }`}>
          <div className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
            Loading balances...
          </div>
        </div>
      ) : balances.length > 0 ? (
        <div className={`p-4 border-2 ${
          theme === 'dark' ? 'border-white/20 bg-white/5' : 'border-gray-200 bg-gray-50'
        }`}>
          <div className={`text-xs uppercase tracking-wide mb-3 ${
            theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
          }`}>
            Token Balances
          </div>
          <div className="space-y-2">
            {balances.map((balance, i) => {
              const formatted = Number(balance.balance) / Math.pow(10, balance.decimals)
              return (
                <div key={i} className="flex items-center justify-between">
                  <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
                    {balance.tokenSymbol}
                  </span>
                  <span className={`font-mono ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                    {formatted.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : address ? (
        <div className={`p-4 border-2 ${
          theme === 'dark' ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'
        }`}>
          <div className={`text-sm text-center ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
            No token balances yet
          </div>
        </div>
      ) : null}

      {/* Info about custodial wallet */}
      <div className={`p-4 border-2 ${
        theme === 'dark' ? 'border-juice-orange/30 bg-juice-orange/10' : 'border-orange-200 bg-orange-50'
      }`}>
        <div className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
          Your project tokens are held in a secure custodial wallet. You can transfer them to your own wallet anytime with a 30-day security hold.
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onDisconnect}
          className={`flex-1 p-3 border-2 font-medium transition-colors ${
            theme === 'dark'
              ? 'border-red-500/50 text-red-400 hover:bg-red-500/10'
              : 'border-red-300 text-red-600 hover:bg-red-50'
          }`}
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}

// Top up view
function TopUpView({ onBack, address }: { onBack: () => void; address?: string }) {
  const { theme } = useThemeStore()

  const onrampLinks = [
    {
      name: 'Coinbase',
      url: address
        ? `https://pay.coinbase.com/buy/select-asset?addresses={"${address}":["ethereum","base","optimism","arbitrum"]}&presetFiatAmount=50`
        : 'https://pay.coinbase.com',
      icon: '🔵',
    },
    {
      name: 'MoonPay',
      url: address
        ? `https://www.moonpay.com/buy?defaultCurrencyCode=eth&walletAddress=${address}`
        : 'https://www.moonpay.com',
      icon: '🌙',
    },
    {
      name: 'Transak',
      url: address
        ? `https://global.transak.com/?cryptoCurrencyCode=ETH&walletAddress=${address}`
        : 'https://global.transak.com',
      icon: '🔄',
    },
  ]

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className={`flex items-center gap-2 text-sm ${
          theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
        Add funds to your wallet using a card or bank transfer
      </div>

      <div className="space-y-2">
        {onrampLinks.map((link) => (
          <a
            key={link.name}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`w-full p-4 border-2 flex items-center gap-3 font-medium transition-all block
              ${theme === 'dark'
                ? 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30'
                : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50 hover:border-gray-300'
              }`}
          >
            <span className="text-xl">{link.icon}</span>
            <span className="flex-1">{link.name}</span>
            <svg className="w-5 h-5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ))}
      </div>

      {address && (
        <div className={`text-xs text-center ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
          Your address: {shortenAddress(address, 8)}
        </div>
      )}
    </div>
  )
}

export default function WalletPanel({ isOpen, onClose }: WalletPanelProps) {
  const { mode, logout: authLogout, isAuthenticated } = useAuthStore()
  const { address, isConnected: walletConnected } = useAccount()
  const { disconnect } = useDisconnect()

  const [view, setView] = useState<'select' | 'self_custody' | 'managed' | 'wallet' | 'topup'>('select')

  // Determine current state
  const isSelfCustodyConnected = mode === 'self_custody' && walletConnected
  const isManagedConnected = mode === 'managed' && isAuthenticated()

  const currentView = (() => {
    if (view === 'topup') return 'topup'
    if (isSelfCustodyConnected) return 'wallet'
    if (isManagedConnected) return 'managed'
    return view
  })()

  const handleDisconnect = async () => {
    if (mode === 'self_custody') {
      disconnect()
    } else {
      await authLogout()
    }
    setView('select')
  }

  const getTitle = () => {
    switch (currentView) {
      case 'select': return 'Connect'
      case 'self_custody': return 'Connect Wallet'
      case 'managed': return 'Account'
      case 'wallet': return 'Wallet'
      case 'topup': return 'Add Funds'
      default: return 'Connect'
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={getTitle()} size="sm">
      {currentView === 'select' && (
        <ModeSelector
          onSelectMode={(selectedMode) => setView(selectedMode)}
        />
      )}

      {currentView === 'self_custody' && (
        <SelfCustodyConnect onBack={() => setView('select')} />
      )}

      {currentView === 'managed' && !isManagedConnected && (
        <EmailAuth
          onBack={() => setView('select')}
          onSuccess={() => setView('select')}
        />
      )}

      {currentView === 'managed' && isManagedConnected && (
        <ManagedAccountView onDisconnect={handleDisconnect} />
      )}

      {currentView === 'wallet' && isSelfCustodyConnected && (
        <SelfCustodyWalletView
          onTopUp={() => setView('topup')}
          onDisconnect={handleDisconnect}
        />
      )}

      {currentView === 'topup' && (
        <TopUpView
          onBack={() => setView(isSelfCustodyConnected ? 'wallet' : 'select')}
          address={address}
        />
      )}
    </Modal>
  )
}
