import { useState } from 'react'
import {
  useWallet,
  useLogout,
  useVerifyOAuth,
  useLoginExternalWallet,
  useVerifyExternalWallet,
  useWaitForWalletCreation,
  useClient,
} from '@getpara/react-sdk'
import { useThemeStore } from '../../stores'
import { useWalletBalances, formatEthBalance, formatUsdcBalance } from '../../hooks'
import { Modal } from '../ui'

interface WalletPanelProps {
  isOpen: boolean
  onClose: () => void
}

function shortenAddress(address: string, chars = 6): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

// Auth method selector
function AuthOptions({ onOAuth, onExternalWallet, isPending }: {
  onOAuth: (method: 'GOOGLE' | 'APPLE') => void
  onExternalWallet: () => void
  isPending: boolean
}) {
  const { theme } = useThemeStore()

  return (
    <div className="space-y-3">
      <p className={`text-sm text-center mb-4 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
        Connect to manage your funds and execute transactions
      </p>

      {/* OAuth Options */}
      <button
        onClick={() => onOAuth('GOOGLE')}
        disabled={isPending}
        className={`w-full p-3 border-2 flex items-center justify-center gap-3 font-medium transition-all
          disabled:opacity-50 disabled:cursor-not-allowed
          ${theme === 'dark'
            ? 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30'
            : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50 hover:border-gray-300'
          }`}
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>

      <button
        onClick={() => onOAuth('APPLE')}
        disabled={isPending}
        className={`w-full p-3 border-2 flex items-center justify-center gap-3 font-medium transition-all
          disabled:opacity-50 disabled:cursor-not-allowed
          ${theme === 'dark'
            ? 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30'
            : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50 hover:border-gray-300'
          }`}
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
        </svg>
        Continue with Apple
      </button>

      <div className={`flex items-center gap-3 my-4 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
        <div className={`flex-1 border-t ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`} />
        <span className="text-xs">or</span>
        <div className={`flex-1 border-t ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`} />
      </div>

      {/* External Wallet */}
      <button
        onClick={onExternalWallet}
        disabled={isPending}
        className={`w-full p-3 border-2 flex items-center justify-center gap-3 font-medium transition-all
          disabled:opacity-50 disabled:cursor-not-allowed
          ${theme === 'dark'
            ? 'border-juice-cyan/50 bg-juice-cyan/10 text-juice-cyan hover:bg-juice-cyan/20'
            : 'border-teal-500 bg-teal-50 text-teal-700 hover:bg-teal-100'
          }`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        Connect Wallet
      </button>
    </div>
  )
}

// Connected wallet view
function WalletView({ onTopUp, onDisconnect }: {
  onTopUp: () => void
  onDisconnect: () => void
}) {
  const { theme } = useThemeStore()
  const { data: wallet } = useWallet()
  const { totalEth, totalUsdc, loading: balancesLoading } = useWalletBalances()

  if (!wallet?.address) return null

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
            Account
          </span>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className={`text-xs ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>
              Connected
            </span>
          </div>
        </div>
        <div className={`font-mono text-lg ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
          {wallet.ensName || shortenAddress(wallet.address)}
        </div>
        {wallet.ensName && (
          <div className={`font-mono text-sm mt-1 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
            {shortenAddress(wallet.address)}
          </div>
        )}
      </div>

      {/* Balances */}
      <div className={`p-4 border-2 ${
        theme === 'dark' ? 'border-white/20 bg-white/5' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className={`text-xs uppercase tracking-wide mb-3 ${
          theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
        }`}>
          Total Balance
        </div>
        {balancesLoading ? (
          <div className={`animate-pulse h-8 rounded ${
            theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'
          }`} />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={`flex items-center gap-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                <span className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-xs">Ξ</span>
                ETH
              </span>
              <span className={`font-mono font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                {formatEthBalance(totalEth)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className={`flex items-center gap-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                <span className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-xs">$</span>
                USDC
              </span>
              <span className={`font-mono font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                {formatUsdcBalance(totalUsdc)}
              </span>
            </div>
          </div>
        )}
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

// Top up / onramp view
function TopUpView({ onBack }: { onBack: () => void }) {
  const { theme } = useThemeStore()
  const { data: wallet } = useWallet()

  // For now, link to popular onramps with the user's address
  const onrampLinks = [
    {
      name: 'Coinbase',
      url: `https://pay.coinbase.com/buy/select-asset?addresses={"${wallet?.address}":["ethereum","base","optimism","arbitrum"]}&presetFiatAmount=50`,
      icon: '🔵',
    },
    {
      name: 'MoonPay',
      url: `https://www.moonpay.com/buy?defaultCurrencyCode=eth&walletAddress=${wallet?.address}`,
      icon: '🌙',
    },
    {
      name: 'Transak',
      url: `https://global.transak.com/?cryptoCurrencyCode=ETH&walletAddress=${wallet?.address}`,
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

      <div className={`text-xs text-center ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
        Your address: {wallet?.address ? shortenAddress(wallet.address, 8) : '...'}
      </div>
    </div>
  )
}

export default function WalletPanel({ isOpen, onClose }: WalletPanelProps) {
  const { theme } = useThemeStore()
  const { data: wallet } = useWallet()
  const { logout } = useLogout()
  const { verifyOAuthAsync, isPending: oauthPending } = useVerifyOAuth()
  const { loginExternalWalletAsync, isPending: externalPending } = useLoginExternalWallet()
  const { verifyExternalWalletAsync } = useVerifyExternalWallet()
  const { waitForWalletCreationAsync } = useWaitForWalletCreation()
  const paraClient = useClient()

  const [view, setView] = useState<'auth' | 'wallet' | 'topup'>('auth')
  const [error, setError] = useState<string | null>(null)

  const isConnected = !!wallet?.address
  const currentView = isConnected ? (view === 'topup' ? 'topup' : 'wallet') : 'auth'
  const isPending = oauthPending || externalPending

  const handleOAuth = async (method: 'GOOGLE' | 'APPLE') => {
    setError(null)
    try {
      const result = await verifyOAuthAsync({ method })

      // Check if we need to wait for wallet creation
      if (result && 'needsWallet' in result && result.needsWallet) {
        await waitForWalletCreationAsync({})
      }
    } catch (err) {
      console.error('OAuth error:', err)
      setError(err instanceof Error ? err.message : 'Authentication failed')
    }
  }

  const handleExternalWallet = async () => {
    setError(null)
    try {
      // This will trigger the browser's wallet selection
      // For now, we'll use the modal's external wallet flow as a fallback
      // In a more complete implementation, we'd directly integrate with wagmi/viem
      if (paraClient) {
        // Try to get injected provider (MetaMask, etc.)
        const ethereum = (window as { ethereum?: { request: (args: { method: string }) => Promise<string[]> } }).ethereum
        if (ethereum) {
          const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
          if (accounts && accounts.length > 0) {
            const result = await loginExternalWalletAsync({
              externalWallet: {
                address: accounts[0],
                type: 'EVM',
              },
            })

            if (result && 'needsVerify' in result && result.needsVerify) {
              // Need to sign a message to verify
              await verifyExternalWalletAsync({})
            }
          }
        } else {
          setError('No wallet detected. Please install MetaMask or another browser wallet.')
        }
      }
    } catch (err) {
      console.error('External wallet error:', err)
      setError(err instanceof Error ? err.message : 'Wallet connection failed')
    }
  }

  const handleDisconnect = async () => {
    await logout()
    setView('auth')
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={currentView === 'auth' ? 'Connect Account' : currentView === 'topup' ? 'Add Funds' : 'Account'}
      size="sm"
    >
      {error && (
        <div className={`mb-4 p-3 text-sm border-2 ${
          theme === 'dark'
            ? 'border-red-500/50 bg-red-500/10 text-red-400'
            : 'border-red-300 bg-red-50 text-red-600'
        }`}>
          {error}
        </div>
      )}

      {currentView === 'auth' && (
        <AuthOptions
          onOAuth={handleOAuth}
          onExternalWallet={handleExternalWallet}
          isPending={isPending}
        />
      )}

      {currentView === 'wallet' && (
        <WalletView
          onTopUp={() => setView('topup')}
          onDisconnect={handleDisconnect}
        />
      )}

      {currentView === 'topup' && (
        <TopUpView onBack={() => setView('wallet')} />
      )}
    </Modal>
  )
}
