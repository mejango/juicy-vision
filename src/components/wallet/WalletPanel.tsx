import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'
import { createPublicClient, http, formatEther, erc20Abi } from 'viem'
import { useThemeStore, useAuthStore, useSettingsStore } from '../../stores'
import { useManagedWallet, useEnsNameResolved, useJuiceBalance } from '../../hooks'
import { VIEM_CHAINS, USDC_ADDRESSES, RPC_ENDPOINTS, type SupportedChainId } from '../../constants'
import { CHAINS, ALL_CHAIN_IDS } from '../../constants'
import { hasValidWalletSession, signInWithWallet, clearWalletSession } from '../../services/siwe'
import { loadStripe } from '@stripe/stripe-js'
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js'
import { getPasskeyWallet, clearPasskeyWallet, forgetPasskeyWallet, type PasskeyWallet } from '../../services/passkeyWallet'
import { FRUIT_EMOJIS, getEmojiFromAddress } from '../chat/ParticipantAvatars'
import { getSessionId } from '../../services/session'
import { getWalletSession } from '../../services/siwe'
import { AccountLinkingBanner, LinkedAccountsInfo } from './AccountLinkingBanner'

export interface AnchorPosition {
  top: number
  left: number
  width: number
  height: number
}

interface ChainBalance {
  chainId: number
  chainName: string
  eth: string
  usdc: string
}

// Payment context when opened from a pay intent
export interface PaymentContext {
  amount: string // Amount to pay (e.g., "0.01")
  token: 'ETH' | 'USDC'
  chainId: number
  chainName: string
  projectName?: string
  onContinue?: () => void // Called when user is ready to proceed with payment
  onSwitchChain?: (chainId: number, chainName: string) => void // Called when switching to a different chain
}

interface WalletPanelProps {
  isOpen: boolean
  onClose: () => void
  paymentContext?: PaymentContext
  anchorPosition?: AnchorPosition | null
  initialView?: 'select' | 'self_custody'
}

function shortenAddress(address: string, chars = 6): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

// Get device name for display
// Note: Check iPhone/iPad BEFORE Mac because iPhone UA contains "Mac" (e.g., "like Mac OS X")
function getDeviceName(): string {
  if (typeof navigator === 'undefined') return 'This device'
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return 'This iPhone'
  if (/iPad/i.test(ua)) return 'This iPad'
  if (/Mac/i.test(ua)) return 'This Mac'
  if (/Android/i.test(ua)) return 'This device'
  if (/Windows/i.test(ua)) return 'This PC'
  return 'This device'
}

// Connect options - Touch ID or Wallet (matches AuthOptionsModal)
function ConnectOptions({ onWalletClick, onPasskeySuccess }: {
  onWalletClick: () => void
  onPasskeySuccess: () => void
}) {
  const { theme } = useThemeStore()
  const { loginWithPasskey, signupWithPasskey } = useAuthStore()
  const isDark = theme === 'dark'
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLoginSignup, setShowLoginSignup] = useState(false)
  const [showDeviceSelect, setShowDeviceSelect] = useState(false)

  const handleLogin = async (deviceHint: 'this-device' | 'another-device') => {
    setIsAuthenticating(true)
    setError(null)

    try {
      console.log('[WalletPanel] Logging in with existing passkey')
      await loginWithPasskey(undefined, deviceHint)
      onPasskeySuccess()
    } catch (err) {
      console.error('[WalletPanel] Login failed:', err)
      if (err instanceof Error) {
        const msg = err.message.toLowerCase()
        if (msg.includes('cancelled') || msg.includes('abort') || msg.includes('not allowed')) {
          // User cancelled - stay on device select screen
          return
        }
        if (msg.includes('not supported')) {
          setError('Touch ID not supported on this device. Try Wallet instead.')
        } else {
          setError('No passkey found. Try Sign up to create one.')
        }
      }
    } finally {
      setIsAuthenticating(false)
    }
  }

  const handleSignup = async () => {
    setIsAuthenticating(true)
    setError(null)

    try {
      console.log('[WalletPanel] Creating new passkey account')
      // Clear local state before creating new account
      forgetPasskeyWallet()
      localStorage.removeItem('juice-smart-account-address')
      localStorage.removeItem('juicy-identity')

      await signupWithPasskey('this-device')
      onPasskeySuccess()
    } catch (err) {
      console.error('[WalletPanel] Signup failed:', err)
      if (err instanceof Error) {
        const msg = err.message.toLowerCase()
        if (msg.includes('cancelled') || msg.includes('abort') || msg.includes('not allowed')) {
          // User cancelled - stay on login/signup screen
          return
        }
        if (msg.includes('not supported')) {
          setError('Touch ID not supported on this device. Try Wallet instead.')
        } else {
          setError('Could not create account. Try connecting a wallet instead.')
        }
      }
    } finally {
      setIsAuthenticating(false)
    }
  }

  // Step 3: Device selection (only for login)
  if (showDeviceSelect) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => setShowDeviceSelect(false)}
          className={`flex items-center gap-1 text-xs ${
            isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Where is your passkey?
        </p>

        {error && (
          <div className="p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={() => handleLogin('this-device')}
            disabled={isAuthenticating}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
              isAuthenticating
                ? 'border-gray-500 text-gray-500 cursor-wait'
                : isDark
                ? 'border-green-500 text-green-500 hover:bg-green-500/10'
                : 'border-green-600 text-green-600 hover:bg-green-50'
            }`}
          >
            {isAuthenticating ? '...' : getDeviceName()}
          </button>

          <button
            onClick={() => handleLogin('another-device')}
            disabled={isAuthenticating}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
              isAuthenticating
                ? 'border-gray-500 text-gray-500 cursor-wait'
                : isDark
                ? 'border-white/30 text-gray-300 hover:border-white/50 hover:text-white'
                : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
            }`}
          >
            Another device
          </button>
        </div>
      </div>
    )
  }

  // Step 2: Log in or Sign up
  if (showLoginSignup) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => setShowLoginSignup(false)}
          className={`flex items-center gap-1 text-xs ${
            isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        {error && (
          <div className="p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={() => { setError(null); setShowDeviceSelect(true) }}
            disabled={isAuthenticating}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
              isAuthenticating
                ? 'border-gray-500 text-gray-500 cursor-wait'
                : isDark
                ? 'border-green-500 text-green-500 hover:bg-green-500/10'
                : 'border-green-600 text-green-600 hover:bg-green-50'
            }`}
          >
            Log in
          </button>

          <button
            onClick={handleSignup}
            disabled={isAuthenticating}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
              isAuthenticating
                ? 'border-gray-500 text-gray-500 cursor-wait'
                : isDark
                ? 'border-white/30 text-gray-300 hover:border-white/50 hover:text-white'
                : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
            }`}
          >
            {isAuthenticating ? '...' : 'Sign up'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Lets you use your chats from anywhere.
      </p>

      {error && (
        <div className="p-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={() => setShowLoginSignup(true)}
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

        <button
          onClick={onWalletClick}
          className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
            isDark
              ? 'border-white/30 text-gray-300 hover:border-white/50 hover:text-white'
              : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
          }`}
        >
          Wallet
        </button>
      </div>
    </div>
  )
}

// Wallet icons as inline SVGs
const WalletIcons: Record<string, React.ReactNode> = {
  metaMask: (
    <svg className="w-5 h-5" viewBox="0 0 35 33" fill="none">
      <path d="M32.96 1L19.52 11.14L22.04 5.21L32.96 1Z" fill="#E2761B" stroke="#E2761B" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.04 1L15.36 11.24L12.96 5.21L2.04 1Z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M28.16 23.53L24.64 29.01L32.24 31.11L34.44 23.65L28.16 23.53Z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M0.58 23.65L2.76 31.11L10.36 29.01L6.84 23.53L0.58 23.65Z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9.94 14.49L7.82 17.65L15.32 18L15.04 9.94L9.94 14.49Z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M25.06 14.49L19.88 9.84L19.68 18L27.18 17.65L25.06 14.49Z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10.36 29.01L14.86 26.83L10.96 23.71L10.36 29.01Z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M20.14 26.83L24.64 29.01L24.04 23.71L20.14 26.83Z" fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  coinbaseWallet: (
    <svg className="w-5 h-5" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#0052FF"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M16 6C10.48 6 6 10.48 6 16C6 21.52 10.48 26 16 26C21.52 26 26 21.52 26 16C26 10.48 21.52 6 16 6ZM14.12 13.12C13.56 13.12 13.12 13.56 13.12 14.12V17.88C13.12 18.44 13.56 18.88 14.12 18.88H17.88C18.44 18.88 18.88 18.44 18.88 17.88V14.12C18.88 13.56 18.44 13.12 17.88 13.12H14.12Z" fill="white"/>
    </svg>
  ),
  rainbow: (
    <svg className="w-5 h-5" viewBox="0 0 120 120" fill="none">
      <rect width="120" height="120" rx="24" fill="url(#rainbow-gradient)"/>
      <path d="M20 38H26C56.9279 38 82 63.0721 82 94V100H94V94C94 56.5492 63.4508 26 26 26H20V38Z" fill="white"/>
      <path d="M20 60H26C34.8366 60 42 67.1634 42 76V100H54V76C54 60.536 41.464 48 26 48H20V60Z" fill="white"/>
      <path d="M20 82H26V100H20V82Z" fill="white"/>
      <defs><linearGradient id="rainbow-gradient" x1="0" y1="0" x2="120" y2="120"><stop stopColor="#7B3FE4"/><stop offset="0.5" stopColor="#4F87FF"/><stop offset="1" stopColor="#3FC6FF"/></linearGradient></defs>
    </svg>
  ),
  safe: (
    <svg className="w-5 h-5" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#12FF80"/>
      <path d="M16 6L7 10V16C7 21.52 10.84 26.74 16 28C21.16 26.74 25 21.52 25 16V10L16 6ZM16 15.99H23C22.47 20.11 19.72 23.78 16 24.93V16H9V11.3L16 8.19V15.99Z" fill="#121312"/>
    </svg>
  ),
  walletConnect: (
    <svg className="w-5 h-5" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="#3B99FC"/>
      <path d="M10.46 12.12C14.07 8.63 19.93 8.63 23.54 12.12L23.98 12.55C24.16 12.72 24.16 13.01 23.98 13.18L22.54 14.57C22.45 14.66 22.3 14.66 22.21 14.57L21.61 13.99C19.05 11.51 14.95 11.51 12.39 13.99L11.74 14.62C11.65 14.71 11.5 14.71 11.41 14.62L9.97 13.23C9.79 13.06 9.79 12.77 9.97 12.6L10.46 12.12ZM26.58 15.07L27.84 16.29C28.02 16.46 28.02 16.75 27.84 16.92L21.87 22.71C21.69 22.88 21.4 22.88 21.22 22.71L17 18.61C16.96 18.57 16.88 18.57 16.84 18.61L12.62 22.71C12.44 22.88 12.15 22.88 11.97 22.71L6 16.92C5.82 16.75 5.82 16.46 6 16.29L7.26 15.07C7.44 14.9 7.73 14.9 7.91 15.07L12.13 19.17C12.17 19.21 12.25 19.21 12.29 19.17L16.51 15.07C16.69 14.9 16.98 14.9 17.16 15.07L21.38 19.17C21.42 19.21 21.5 19.21 21.54 19.17L25.76 15.07C25.94 14.9 26.23 14.9 26.41 15.07L26.58 15.07Z" fill="white"/>
    </svg>
  ),
  default: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
}

// Get icon for a connector
function getWalletIcon(connectorId: string): React.ReactNode {
  const id = connectorId.toLowerCase()
  if (id.includes('metamask')) return WalletIcons.metaMask
  if (id.includes('coinbase')) return WalletIcons.coinbaseWallet
  if (id.includes('rainbow')) return WalletIcons.rainbow
  if (id.includes('safe')) return WalletIcons.safe
  if (id.includes('walletconnect')) return WalletIcons.walletConnect
  return WalletIcons.default
}

// Get display name for a connector
function getWalletName(connector: { id: string; name: string }): string {
  const id = connector.id.toLowerCase()
  if (id.includes('metamask')) return 'MetaMask'
  if (id.includes('coinbase')) return 'Coinbase'
  if (id.includes('rainbow')) return 'Rainbow'
  if (id.includes('safe')) return 'Safe'
  if (id.includes('walletconnect')) return 'WalletConnect'
  return connector.name
}

// Self-custody wallet connection
function SelfCustodyConnect({ onBack }: { onBack: () => void }) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
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
        className={`flex items-center gap-1 text-xs ${
          isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
        }`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {error && (
        <div className={`p-2 text-xs border ${
          isDark
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
            className={`w-full py-2.5 px-3 border text-sm font-medium transition-all flex items-center gap-3
              disabled:opacity-50 disabled:cursor-not-allowed ${
              isDark
                ? 'border-white/10 text-white hover:border-green-500/50 hover:bg-green-500/10'
                : 'border-gray-200 text-gray-900 hover:border-green-500 hover:bg-green-50'
            }`}
          >
            {getWalletIcon(connector.id)}
            <span>{getWalletName(connector)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// Auth method selector for managed mode
function AuthMethodSelector({ onSelectMethod, onBack }: {
  onSelectMethod: (method: 'passkey' | 'email') => void
  onBack: () => void
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { isPasskeyAvailable, loginWithPasskey, isLoading } = useAuthStore()
  const [error, setError] = useState<string | null>(null)
  const passkeySupported = isPasskeyAvailable()

  const handlePasskeyLogin = async () => {
    setError(null)
    try {
      await loginWithPasskey()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey authentication failed')
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className={`flex items-center gap-1 text-xs ${
          isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
        }`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {error && (
        <div className={`p-2 text-xs border ${
          isDark ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-red-300 bg-red-50 text-red-600'
        }`}>
          {error}
        </div>
      )}

      <div className="space-y-2">
        {/* Passkey option */}
        {passkeySupported && (
          <button
            onClick={handlePasskeyLogin}
            disabled={isLoading}
            className={`w-full p-3 border text-left transition-all disabled:opacity-50 ${
              isDark
                ? 'border-green-500/50 bg-green-500/10 hover:bg-green-500/20'
                : 'border-green-500 bg-green-50 hover:bg-green-100'
            }`}
          >
            <div className="flex items-center gap-3">
              <svg className={`w-5 h-5 ${isDark ? 'text-green-400' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
              </svg>
              <div>
                <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {isLoading ? 'Authenticating...' : 'Passkey'}
                </div>
                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Face ID, Touch ID
                </div>
              </div>
            </div>
          </button>
        )}

        {/* Email option */}
        <button
          onClick={() => onSelectMethod('email')}
          disabled={isLoading}
          className={`w-full p-3 border text-left transition-all disabled:opacity-50 ${
            isDark ? 'border-white/10 hover:border-white/20' : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <div className="flex items-center gap-3">
            <svg className={`w-5 h-5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <div>
              <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Email Code
              </div>
              <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                One-time code
              </div>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}

// Email OTP flow for managed mode
function EmailAuth({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)

  const API_BASE_URL = import.meta.env.VITE_API_URL || ''

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

      const authStore = useAuthStore.getState()
      authStore.setMode('managed')
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
        className={`flex items-center gap-1 text-xs ${
          isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
        }`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {error && (
        <div className={`p-2 text-xs border ${
          isDark ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-red-300 bg-red-50 text-red-600'
        }`}>
          {error}
        </div>
      )}

      {step === 'email' ? (
        <form onSubmit={handleRequestCode} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className={`w-full px-3 py-2 border text-sm transition-colors outline-none ${
              isDark
                ? 'border-white/10 bg-white/5 text-white placeholder-gray-500 focus:border-green-500'
                : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-green-500'
            }`}
          />

          <button
            type="submit"
            disabled={isLoading || !email}
            className="w-full py-2 text-sm font-medium bg-green-500 text-black hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Sending...' : 'Send Code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-3">
          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Code sent to {email}
          </p>

          {devCode && (
            <div className={`p-2 text-xs border ${
              isDark ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400' : 'border-yellow-300 bg-yellow-50 text-yellow-700'
            }`}>
              Dev: <span className="font-mono">{devCode}</span>
            </div>
          )}

          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            required
            maxLength={6}
            className={`w-full px-3 py-2 border font-mono text-lg text-center tracking-[0.3em] transition-colors outline-none ${
              isDark
                ? 'border-white/10 bg-white/5 text-white placeholder-gray-500 focus:border-green-500'
                : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-green-500'
            }`}
          />

          <button
            type="submit"
            disabled={isLoading || code.length !== 6}
            className="w-full py-2 text-sm font-medium bg-green-500 text-black hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Verifying...' : 'Verify'}
          </button>

          <button
            type="button"
            onClick={() => setStep('email')}
            className={`w-full text-xs ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
          >
            Change email
          </button>
        </form>
      )}
    </div>
  )
}

// Insufficient funds info for the modal title
export interface InsufficientFundsInfo {
  amount: string
  token: 'ETH' | 'USDC'
  chainName: string
  hasAlternatives: boolean
}

// Connected wallet view (self-custody) with multi-chain balances
function SelfCustodyWalletView({ onTopUp, onDisconnect, paymentContext, onInsufficientFundsChange, isSignedIn }: {
  onTopUp: () => void
  onDisconnect: () => void
  paymentContext?: PaymentContext
  onInsufficientFundsChange?: (info: InsufficientFundsInfo | null) => void
  isSignedIn: boolean
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address, chainId } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { ensName } = useEnsNameResolved(address)
  const [balances, setBalances] = useState<ChainBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [justSignedIn, setJustSignedIn] = useState(false)
  const [identity, setIdentity] = useState<{ emoji: string; username: string; formatted: string } | null>(null)

  // Fetch identity (Juicy ID)
  useEffect(() => {
    const fetchIdentity = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || ''
        const sessionId = getSessionId()
        const walletSession = getWalletSession()
        const headers: Record<string, string> = {
          'X-Session-ID': sessionId,
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
    fetchIdentity()

    // Listen for identity changes
    const handleIdentityChange = (e: CustomEvent<{ emoji: string; username: string; formatted: string }>) => {
      setIdentity(e.detail)
    }
    window.addEventListener('juice:identity-changed', handleIdentityChange as EventListener)
    return () => window.removeEventListener('juice:identity-changed', handleIdentityChange as EventListener)
  }, [address])

  // Handle SIWE sign-in
  const handleSignIn = async () => {
    if (!address || !chainId) return

    setSigningIn(true)
    setSignInError(null)

    try {
      await signInWithWallet(
        address,
        chainId,
        async (message: string) => {
          const signature = await signMessageAsync({ message })
          return signature
        }
      )
      setJustSignedIn(true)
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setSigningIn(false)
    }
  }

  // Derived signed-in state (includes just-signed-in)
  const effectivelySignedIn = isSignedIn || justSignedIn

  // Fetch balances across all chains
  const fetchAllBalances = useCallback(async () => {
    if (!address) return
    setLoading(true)

    const results: ChainBalance[] = []

    await Promise.all(
      ALL_CHAIN_IDS.map(async (chainId) => {
        const chain = VIEM_CHAINS[chainId as SupportedChainId]
        const chainInfo = CHAINS[chainId]
        if (!chain || !chainInfo) return

        try {
          const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
          const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
          })

          // Fetch ETH balance
          const ethBalance = await publicClient.getBalance({
            address: address as `0x${string}`,
          })

          // Fetch USDC balance
          const usdcAddress = USDC_ADDRESSES[chainId as SupportedChainId]
          let usdcBalance = BigInt(0)
          if (usdcAddress) {
            try {
              usdcBalance = await publicClient.readContract({
                address: usdcAddress,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address as `0x${string}`],
              })
            } catch {
              // USDC might not exist on this chain
            }
          }

          results.push({
            chainId,
            chainName: chainInfo.shortName,
            eth: formatEther(ethBalance),
            usdc: (Number(usdcBalance) / 1e6).toString(),
          })
        } catch (err) {
          console.error(`Failed to fetch balance for chain ${chainId}:`, err)
        }
      })
    )

    // Sort by chainId for consistent ordering
    results.sort((a, b) => a.chainId - b.chainId)
    setBalances(results)
    setLoading(false)
  }, [address])

  useEffect(() => {
    fetchAllBalances()
  }, [fetchAllBalances])

  // Report insufficient funds state to parent for title change
  useEffect(() => {
    if (!onInsufficientFundsChange || loading || !paymentContext) {
      return
    }

    const requiredAmount = parseFloat(paymentContext.amount)
    const targetChainBalance = balances.find(b => b.chainId === paymentContext.chainId)
    const availableOnTarget = paymentContext.token === 'ETH'
      ? parseFloat(targetChainBalance?.eth || '0')
      : parseFloat(targetChainBalance?.usdc || '0')
    const hasSufficientFunds = availableOnTarget >= requiredAmount

    // Find chains with sufficient funds for alternatives (excluding current chain)
    const chainsWithFunds = balances.filter(b => {
      if (b.chainId === paymentContext.chainId) return false
      const available = paymentContext.token === 'ETH'
        ? parseFloat(b.eth || '0')
        : parseFloat(b.usdc || '0')
      return available >= requiredAmount
    })

    if (!hasSufficientFunds) {
      onInsufficientFundsChange({
        amount: paymentContext.amount,
        token: paymentContext.token,
        chainName: paymentContext.chainName,
        hasAlternatives: chainsWithFunds.length > 0,
      })
    } else {
      onInsufficientFundsChange(null)
    }
  }, [balances, loading, paymentContext, onInsufficientFundsChange])

  if (!address) return null

  // Calculate totals
  const totalEth = balances.reduce((sum, b) => sum + parseFloat(b.eth || '0'), 0)
  const totalUsdc = balances.reduce((sum, b) => sum + parseFloat(b.usdc || '0'), 0)

  return (
    <div className="space-y-3">
      {/* Account Linking Banner - shown when user has both wallet and managed account */}
      <AccountLinkingBanner />

      {/* Address row */}
      <div className="flex items-center justify-between">
        <div className={`font-mono text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {ensName || shortenAddress(address)}
        </div>
        <div className="flex items-center gap-1">
          {effectivelySignedIn ? (
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          ) : (
            <div className={`w-1.5 h-1.5 rounded-full border ${isDark ? 'border-gray-500' : 'border-gray-400'}`} />
          )}
          <span className={`text-xs ${effectivelySignedIn
            ? (isDark ? 'text-green-400' : 'text-green-600')
            : (isDark ? 'text-gray-400' : 'text-gray-500')
          }`}>
            {effectivelySignedIn ? 'Signed In' : 'Connected'}
          </span>
        </div>
      </div>

      {/* Juicy ID */}
      {identity && (
        <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          {identity.formatted}
        </div>
      )}

      {/* Sign In Prompt - shown when connected but not signed in */}
      {!effectivelySignedIn && (
        <div className={`p-3 border ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
          {signInError && (
            <div className={`mb-2 p-2 text-xs border ${
              isDark ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-red-300 bg-red-50 text-red-600'
            }`}>
              {signInError}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Sign in to save your chats and access them from any device.
            </p>
            <button
              onClick={handleSignIn}
              disabled={signingIn}
              className="px-2 py-1 text-xs font-medium bg-green-500 text-black hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              {signingIn ? 'Signing...' : 'Sign In'}
            </button>
          </div>
        </div>
      )}

      {/* Balances */}
      <div className={`border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        {/* Header row with totals */}
        <div className={`px-3 py-2 border-b ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
          <div className="flex justify-between text-xs">
            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Total</span>
            <div className="flex gap-4">
              {totalUsdc > 0 && (
                <span className={isDark ? 'text-white' : 'text-gray-900'}>
                  {loading ? '...' : `${totalUsdc.toFixed(2)} USDC`}
                </span>
              )}
              <span className={isDark ? 'text-white' : 'text-gray-900'}>
                {loading ? '...' : `${totalEth.toFixed(4)} ETH`}
              </span>
            </div>
          </div>
        </div>

        {/* Per-chain breakdown */}
        {loading ? (
          <div className={`px-3 py-3 text-xs text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Loading balances...
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {balances.map((b) => {
              const eth = parseFloat(b.eth)
              const usdc = parseFloat(b.usdc)
              if (eth === 0 && usdc === 0) return null
              return (
                <div key={b.chainId} className="px-3 py-2 flex justify-between text-xs">
                  <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{b.chainName}</span>
                  <div className="flex gap-4">
                    {usdc > 0 && (
                      <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                        {usdc.toFixed(2)} USDC
                      </span>
                    )}
                    {eth > 0 && (
                      <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                        {eth.toFixed(4)} ETH
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            {balances.every(b => parseFloat(b.eth) === 0 && parseFloat(b.usdc) === 0) && (
              <div className={`px-3 py-3 text-xs text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                No balances found
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment Context Actions */}
      {paymentContext && (() => {
        const requiredAmount = parseFloat(paymentContext.amount)
        const targetChainBalance = balances.find(b => b.chainId === paymentContext.chainId)
        const availableOnTarget = paymentContext.token === 'ETH'
          ? parseFloat(targetChainBalance?.eth || '0')
          : parseFloat(targetChainBalance?.usdc || '0')
        const hasSufficientFunds = availableOnTarget >= requiredAmount

        // Find chains with sufficient funds for alternatives (excluding current chain)
        const chainsWithFunds = balances.filter(b => {
          if (b.chainId === paymentContext.chainId) return false
          const available = paymentContext.token === 'ETH'
            ? parseFloat(b.eth || '0')
            : parseFloat(b.usdc || '0')
          return available >= requiredAmount
        })

        return (
          <div className="space-y-3">
            {hasSufficientFunds ? (
              <>
                {/* Payment summary - shown when we have funds */}
                <div className={`p-3 border ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
                  <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {paymentContext.projectName ? `Pay ${paymentContext.projectName}` : 'Payment'}
                  </div>
                  <div className={`text-lg font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {paymentContext.amount} {paymentContext.token}
                  </div>
                  <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    on {paymentContext.chainName}
                  </div>
                </div>
                <button
                  onClick={paymentContext.onContinue}
                  className="w-full py-2.5 text-sm font-medium bg-green-500 text-black hover:bg-green-600 transition-colors"
                >
                  Continue to Payment
                </button>
              </>
            ) : (
              <div className="space-y-3">
                {/* Insufficient funds message */}
                <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  You have <span className={isDark ? 'text-white' : 'text-gray-900'}>{availableOnTarget.toFixed(paymentContext.token === 'USDC' ? 2 : 4)} {paymentContext.token}</span> on {paymentContext.chainName}.
                </div>

                {/* Alternative chains - prominent buttons */}
                {chainsWithFunds.length > 0 && (
                  <div className="space-y-2">
                    <div className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      Try on another chain
                    </div>
                    {chainsWithFunds.map(chain => (
                      <button
                        key={chain.chainId}
                        onClick={() => {
                          if (paymentContext.onSwitchChain) {
                            paymentContext.onSwitchChain(chain.chainId, chain.chainName)
                          } else {
                            window.dispatchEvent(new CustomEvent('juice:switch-payment-chain', {
                              detail: { chainId: chain.chainId, chainName: chain.chainName }
                            }))
                          }
                        }}
                        className={`w-full py-2.5 px-3 text-sm font-medium flex items-center justify-between transition-colors ${
                          isDark
                            ? 'bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30'
                            : 'bg-green-50 border border-green-200 text-green-700 hover:bg-green-100'
                        }`}
                      >
                        <span>Pay on {chain.chainName}</span>
                        <span className={isDark ? 'text-green-400/70' : 'text-green-600/70'}>
                          {paymentContext.token === 'ETH'
                            ? `${parseFloat(chain.eth).toFixed(4)} ETH`
                            : `${parseFloat(chain.usdc).toFixed(2)} USDC`
                          }
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Top up option */}
                <div className="pt-1">
                  {chainsWithFunds.length > 0 && (
                    <div className={`text-xs text-center mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      or
                    </div>
                  )}
                  <button
                    onClick={onTopUp}
                    className={`w-full py-2 text-sm font-medium transition-colors ${
                      chainsWithFunds.length > 0
                        ? isDark
                          ? 'border border-white/10 text-gray-400 hover:text-white hover:border-white/20'
                          : 'border border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        : isDark
                          ? 'bg-green-500/20 border border-green-500/50 text-green-400 hover:bg-green-500/30'
                          : 'bg-green-50 border border-green-200 text-green-700 hover:bg-green-100'
                    }`}
                  >
                    Top up your balance
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Standard Actions (when no payment context) */}
      {!paymentContext && (
        <div className="flex justify-end gap-2">
          <button
            onClick={onDisconnect}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
              isDark
                ? 'border-white/30 text-gray-300 hover:border-white/50 hover:text-white'
                : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
            }`}
          >
            Disconnect
          </button>
          <button
            onClick={onTopUp}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
              isDark
                ? 'border-green-500 text-green-500 hover:bg-green-500/10'
                : 'border-green-600 text-green-600 hover:bg-green-50'
            }`}
          >
            Top Up
          </button>
        </div>
      )}
    </div>
  )
}

// Passkey wallet view - similar to self-custody but uses passkey wallet address
function PasskeyWalletView({ wallet, onTopUp, onDisconnect }: {
  wallet: PasskeyWallet
  onTopUp: () => void
  onDisconnect: () => void
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { ensName } = useEnsNameResolved(wallet.address as `0x${string}`)
  const [balances, setBalances] = useState<ChainBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [identity, setIdentity] = useState<{ emoji: string; username: string; formatted: string } | null>(null)

  // Fetch identity (Juicy ID)
  useEffect(() => {
    const fetchIdentity = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || ''
        const sessionId = getSessionId()
        const walletSession = getWalletSession()
        const headers: Record<string, string> = {
          'X-Session-ID': sessionId,
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
    fetchIdentity()

    // Listen for identity changes
    const handleIdentityChange = (e: CustomEvent<{ emoji: string; username: string; formatted: string }>) => {
      setIdentity(e.detail)
    }
    window.addEventListener('juice:identity-changed', handleIdentityChange as EventListener)
    return () => window.removeEventListener('juice:identity-changed', handleIdentityChange as EventListener)
  }, [wallet.address])

  // Fetch balances across all chains
  const fetchAllBalances = useCallback(async () => {
    setLoading(true)
    const results: ChainBalance[] = []

    await Promise.all(
      ALL_CHAIN_IDS.map(async (chainId) => {
        const chain = VIEM_CHAINS[chainId as SupportedChainId]
        const chainInfo = CHAINS[chainId]
        if (!chain || !chainInfo) return

        try {
          const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
          const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
          })

          // Fetch ETH balance
          const ethBalance = await publicClient.getBalance({
            address: wallet.address as `0x${string}`,
          })

          // Fetch USDC balance
          const usdcAddress = USDC_ADDRESSES[chainId as SupportedChainId]
          let usdcBalance = BigInt(0)
          if (usdcAddress) {
            try {
              usdcBalance = await publicClient.readContract({
                address: usdcAddress,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [wallet.address as `0x${string}`],
              })
            } catch {
              // USDC might not exist on this chain
            }
          }

          results.push({
            chainId,
            chainName: chainInfo.shortName,
            eth: formatEther(ethBalance),
            usdc: (Number(usdcBalance) / 1e6).toString(),
          })
        } catch (err) {
          console.error(`Failed to fetch balance for chain ${chainId}:`, err)
        }
      })
    )

    results.sort((a, b) => a.chainId - b.chainId)
    setBalances(results)
    setLoading(false)
  }, [wallet.address])

  useEffect(() => {
    fetchAllBalances()
  }, [fetchAllBalances])

  // Calculate totals
  const totalEth = balances.reduce((sum, b) => sum + parseFloat(b.eth || '0'), 0)
  const totalUsdc = balances.reduce((sum, b) => sum + parseFloat(b.usdc || '0'), 0)

  return (
    <div className="space-y-3">
      {/* Address row */}
      <div className="flex items-center justify-between">
        <div className={`font-mono text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {ensName || shortenAddress(wallet.address)}
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className={`text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}>
            Touch ID
          </span>
        </div>
      </div>

      {/* Juicy ID */}
      {identity && (
        <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          {identity.formatted}
        </div>
      )}

      {/* Balances */}
      <div className={`border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        {/* Header row with totals */}
        <div className={`px-3 py-2 border-b ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
          <div className="flex justify-between text-xs">
            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Total</span>
            <div className="flex gap-4">
              {totalUsdc > 0 && (
                <span className={isDark ? 'text-white' : 'text-gray-900'}>
                  {loading ? '...' : `${totalUsdc.toFixed(2)} USDC`}
                </span>
              )}
              <span className={isDark ? 'text-white' : 'text-gray-900'}>
                {loading ? '...' : `${totalEth.toFixed(4)} ETH`}
              </span>
            </div>
          </div>
        </div>

        {/* Per-chain breakdown */}
        {loading ? (
          <div className={`px-3 py-3 text-xs text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Loading balances...
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {balances.map((b) => {
              const eth = parseFloat(b.eth)
              const usdc = parseFloat(b.usdc)
              if (eth === 0 && usdc === 0) return null
              return (
                <div key={b.chainId} className="px-3 py-2 flex justify-between text-xs">
                  <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{b.chainName}</span>
                  <div className="flex gap-4">
                    {usdc > 0 && (
                      <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                        {usdc.toFixed(2)} USDC
                      </span>
                    )}
                    {eth > 0 && (
                      <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                        {eth.toFixed(4)} ETH
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            {balances.every(b => parseFloat(b.eth) === 0 && parseFloat(b.usdc) === 0) && (
              <div className={`px-3 py-3 text-xs text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                No balances found
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button
          onClick={onDisconnect}
          className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
            isDark
              ? 'border-white/30 text-gray-300 hover:border-white/50 hover:text-white'
              : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
          }`}
        >
          Disconnect
        </button>
        <button
          onClick={onTopUp}
          className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
            isDark
              ? 'border-green-500 text-green-500 hover:bg-green-500/10'
              : 'border-green-600 text-green-600 hover:bg-green-50'
          }`}
        >
          Top Up
        </button>
      </div>
    </div>
  )
}

// Managed account view
function ManagedAccountView({ onDisconnect, onTopUp, onSettings, onSetJuicyId }: { onDisconnect: () => void; onTopUp: () => void; onSettings: () => void; onSetJuicyId: () => void }) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const isDark = theme === 'dark'
  const { user, token, passkeys, loadPasskeys, registerPasskey, deletePasskey, isPasskeyAvailable, isLoading } = useAuthStore()
  const { address, balances, loading } = useManagedWallet()
  const { balance: juiceBalance, loading: juiceLoading } = useJuiceBalance()
  const [copied, setCopied] = useState(false)
  const [showPasskeys, setShowPasskeys] = useState(false)
  const [passkeyError, setPasskeyError] = useState<string | null>(null)
  const [addingPasskey, setAddingPasskey] = useState(false)
  const [newPasskeyName, setNewPasskeyName] = useState('')
  const [identity, setIdentity] = useState<{ emoji: string; username: string; formatted: string } | null>(null)

  // Fetch identity with auth token
  useEffect(() => {
    const fetchIdentity = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || ''
        const sessionId = getSessionId()
        const walletSession = getWalletSession()
        const headers: Record<string, string> = {
          'X-Session-ID': sessionId,
        }
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
        if (walletSession?.token) {
          headers['X-Wallet-Session'] = walletSession.token
        }
        const res = await fetch(`${apiUrl}/identity/me`, { headers })
        if (res.ok) {
          const data = await res.json()
          if (data.success && data.data) {
            setIdentity(data.data)
            // Notify other components (like ChatInput) of the loaded identity
            window.dispatchEvent(new CustomEvent('juice:identity-changed', { detail: data.data }))
          }
        }
      } catch {
        // Ignore identity fetch errors
      }
    }
    fetchIdentity()

    // Listen for identity changes from other components
    const handleIdentityChange = (e: CustomEvent<{ emoji: string; username: string; formatted: string }>) => {
      setIdentity(e.detail)
    }
    window.addEventListener('juice:identity-changed', handleIdentityChange as EventListener)
    return () => window.removeEventListener('juice:identity-changed', handleIdentityChange as EventListener)
  }, [token, address])

  const handleShowPasskeys = async () => {
    setShowPasskeys(true)
    await loadPasskeys()
  }

  // Get default device name suggestion
  const getDefaultDeviceName = (): string => {
    if (typeof navigator === 'undefined') return 'My Device'
    const ua = navigator.userAgent
    if (/Mac/i.test(ua)) return 'My Mac'
    if (/iPhone/i.test(ua)) return 'My iPhone'
    if (/iPad/i.test(ua)) return 'My iPad'
    if (/Android/i.test(ua)) return 'My Android'
    if (/Windows/i.test(ua)) return 'My PC'
    return 'My Device'
  }

  const handleStartAddPasskey = () => {
    setNewPasskeyName(getDefaultDeviceName())
    setAddingPasskey(true)
    setPasskeyError(null)
  }

  const handleConfirmAddPasskey = async () => {
    setPasskeyError(null)
    try {
      await registerPasskey(newPasskeyName.trim() || getDefaultDeviceName())
      setAddingPasskey(false)
      setNewPasskeyName('')
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : 'Failed to add passkey')
    }
  }

  const handleCancelAddPasskey = () => {
    setAddingPasskey(false)
    setNewPasskeyName('')
    setPasskeyError(null)
  }

  const handleDeletePasskey = async (id: string) => {
    if (confirm('Remove this passkey?')) {
      try {
        await deletePasskey(id)
      } catch (err) {
        setPasskeyError(err instanceof Error ? err.message : 'Failed to remove passkey')
      }
    }
  }

  if (!user) return null

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Format device type for display
  const formatDeviceType = (deviceType: string | null | undefined): string => {
    if (!deviceType) return 'Passkey'
    switch (deviceType) {
      case 'platform':
        // Try to detect platform from user agent
        if (typeof navigator !== 'undefined') {
          const ua = navigator.userAgent
          if (/Mac/i.test(ua)) return 'Touch ID (Mac)'
          if (/iPhone|iPad/i.test(ua)) return 'Face ID / Touch ID'
          if (/Android/i.test(ua)) return 'Biometric (Android)'
          if (/Windows/i.test(ua)) return 'Windows Hello'
        }
        return 'This Device'
      case 'cross-platform':
      case 'security_key':
        return 'Security Key'
      default:
        return 'Passkey'
    }
  }

  // Get auth method display
  const getAuthMethod = (): string => {
    if (user.email?.includes('@passkey.local')) {
      if (typeof navigator !== 'undefined') {
        const ua = navigator.userAgent
        if (/Mac/i.test(ua)) return 'Touch ID'
        if (/iPhone|iPad/i.test(ua)) return 'Face ID'
        if (/Android/i.test(ua)) return 'Biometric'
        if (/Windows/i.test(ua)) return 'Windows Hello'
      }
      return 'Passkey'
    }
    return 'Email'
  }

  return (
    <div className="space-y-3">
      {/* Address + Set Juicy ID CTA */}
      <div className="flex items-center justify-between">
        <div>
          {address ? (
            <button
              onClick={copyAddress}
              className={`font-mono text-sm ${isDark ? 'text-white hover:text-green-400' : 'text-gray-900 hover:text-green-600'} transition-colors`}
            >
              {shortenAddress(address, 6)}
            </button>
          ) : (
            <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Loading...</span>
          )}
          {copied && <span className={`ml-2 text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}>Copied!</span>}
        </div>
        <button
          onClick={onSetJuicyId}
          className={`text-xs ${identity ? (isDark ? 'text-white hover:text-green-400' : 'text-gray-900 hover:text-green-600') : (isDark ? 'text-green-400 hover:text-green-300' : 'text-green-600 hover:text-green-700')}`}
        >
          {identity ? identity.formatted : 'Set Juicy ID'}
        </button>
      </div>

      {/* Balances - Juice, USDC (aggregate), ETH (aggregate) */}
      <div className={`border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        {loading ? (
          <div className={`px-3 py-3 text-xs text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Loading...
          </div>
        ) : (
          <div className={`divide-y ${isDark ? 'divide-white/5' : 'divide-gray-100'}`}>
            {/* Pay Credits - fiat payment balance */}
            <div className="px-3 py-2 flex justify-between items-center text-xs">
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{t('wallet.payCredits', 'Pay Credits')}</span>
              <span className={isDark ? 'text-white' : 'text-gray-900'}>
                {juiceLoading ? '...' : (juiceBalance?.balance ?? 0).toLocaleString()}
              </span>
            </div>
            {/* USDC - aggregate across all chains */}
            <div className="px-3 py-2 flex justify-between text-xs">
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>USDC</span>
              <span className={isDark ? 'text-white' : 'text-gray-900'}>
                {balances
                  .filter(b => b.tokenSymbol === 'USDC')
                  .reduce((sum, b) => sum + Number(b.balance) / Math.pow(10, b.decimals), 0)
                  .toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
            {/* ETH - aggregate across all chains */}
            <div className="px-3 py-2 flex justify-between text-xs">
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>ETH</span>
              <span className={isDark ? 'text-white' : 'text-gray-900'}>
                {balances
                  .filter(b => b.tokenSymbol === 'ETH')
                  .reduce((sum, b) => sum + Number(b.balance) / Math.pow(10, b.decimals), 0)
                  .toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom row: Sign Out + Top Up */}
      <div className="flex justify-end items-center gap-3">
        <button
          onClick={onDisconnect}
          className={`text-xs transition-colors ${
            isDark ? 'text-gray-500 hover:text-red-400' : 'text-gray-400 hover:text-red-500'
          }`}
        >
          {t('wallet.signOut', 'Sign Out')}
        </button>
        <button
          onClick={onTopUp}
          className={`px-4 py-1.5 text-xs font-medium transition-colors ${
            isDark
              ? 'bg-green-500 text-black hover:bg-green-400'
              : 'bg-green-500 text-white hover:bg-green-600'
          }`}
        >
          {t('wallet.topUp', 'Top Up')}
        </button>
      </div>
    </div>
  )
}

// Juicy ID view - just the emoji picker and username input
function JuicyIdView({ onBack }: { onBack: () => void }) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { selectedFruit, setSelectedFruit } = useSettingsStore()
  const { token, isAuthenticated } = useAuthStore()
  const isLoggedIn = isAuthenticated()

  // Wallet hooks for SIWE sign-in
  const { address: walletAddress, chainId, isConnected: isWalletConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [signingIn, setSigningIn] = useState(false)

  // Juicy ID state
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
  const [identity, setIdentity] = useState<{ emoji: string; username: string; formatted: string } | null>(() => {
    try {
      const cached = localStorage.getItem('juicy-identity')
      return cached ? JSON.parse(cached) : null
    } catch { return null }
  })

  // Get API headers
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

  // Check availability
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

  // Save identity (with SIWE sign-in if needed)
  const saveIdentity = useCallback(async () => {
    let walletSession = getWalletSession()
    const sessionId = getSessionId()
    const addr = walletSession?.address || walletAddress ||
      `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
    const emoji = selectedFruit || getEmojiFromAddress(addr)

    if (!identityUsername || identityUsername.length < 3) {
      setIdentityError('Username must be at least 3 characters')
      return
    }

    setIdentityLoading(true)
    setIdentityError(null)

    try {
      // If wallet is connected but not signed in (no SIWE session), trigger sign-in first
      if (isWalletConnected && walletAddress && chainId && !hasValidWalletSession()) {
        setSigningIn(true)
        try {
          await signInWithWallet(
            walletAddress,
            chainId,
            async (message: string) => {
              const signature = await signMessageAsync({ message })
              return signature
            }
          )
          // Refresh wallet session after sign-in
          walletSession = getWalletSession()
        } catch (signInErr) {
          setIdentityError('Sign-in cancelled or failed')
          setIdentityLoading(false)
          setSigningIn(false)
          return
        }
        setSigningIn(false)
      }

      // Now save the identity
      const apiUrl = import.meta.env.VITE_API_URL || ''
      const headers = getApiHeaders()
      // Make sure to include the fresh wallet session token
      if (walletSession?.token) {
        headers['X-Wallet-Session'] = walletSession.token
      }
      const res = await fetch(`${apiUrl}/identity/me`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ emoji, username: identityUsername }),
      })
      const data = await res.json()
      if (data.success && data.data) {
        setIdentity(data.data)
        setIdentityError(null)
        try { localStorage.setItem('juicy-identity', JSON.stringify(data.data)) } catch {}
        window.dispatchEvent(new CustomEvent('juice:identity-changed', { detail: data.data }))
        onBack() // Go back after successful save
      } else {
        setIdentityError(data.error || 'Failed to set identity')
      }
    } catch (err) {
      setIdentityError(err instanceof Error ? err.message : 'Failed to set identity')
    } finally {
      setIdentityLoading(false)
      setSigningIn(false)
    }
  }, [selectedFruit, identityUsername, getApiHeaders, onBack, isWalletConnected, walletAddress, chainId, signMessageAsync])

  // Check availability on change
  useEffect(() => {
    const walletSession = getWalletSession()
    const sessionId = getSessionId()
    const addr = walletSession?.address ||
      `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
    const currentEmoji = selectedFruit || getEmojiFromAddress(addr)

    // Don't check if same as current identity
    if (identity && identityUsername === identity.username && currentEmoji === identity.emoji) {
      setIdentityAvailable(true)
      return
    }

    const timer = setTimeout(() => {
      if (identityUsername.length >= 3) {
        checkAvailability(currentEmoji, identityUsername)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [identityUsername, selectedFruit, identity, checkAvailability])

  // Get current emoji and address for display
  const walletSession = getWalletSession()
  const sessionId = getSessionId()
  const currentAddress = walletSession?.address ||
    `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
  const defaultEmoji = getEmojiFromAddress(currentAddress)
  const currentEmoji = identity?.emoji || selectedFruit || defaultEmoji

  return (
    <div className="space-y-3">
      {/* Back button */}
      <button
        onClick={onBack}
        className={`flex items-center gap-1 text-xs ${
          isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
        }`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Live preview */}
      <p className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
        {currentEmoji} {identityUsername || identity?.username || ''}
      </p>

      {/* Emoji picker */}
      <div>
        <p className={`text-[10px] mb-1 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Pick a flavor</p>
        <div className="flex flex-wrap gap-1">
          {FRUIT_EMOJIS.map((fruit) => {
            const isSelected = selectedFruit === fruit || (!selectedFruit && fruit === defaultEmoji)

            return (
              <button
                key={fruit}
                onClick={() => setSelectedFruit(fruit === defaultEmoji ? null : fruit)}
                className={`w-7 h-7 text-base flex items-center justify-center transition-all ${
                  isSelected
                    ? isDark
                      ? 'bg-white/20 ring-2 ring-green-500'
                      : 'bg-gray-200 ring-2 ring-green-500'
                    : isDark
                      ? 'hover:bg-white/10'
                      : 'hover:bg-gray-100'
                }`}
              >
                {fruit}
              </button>
            )
          })}
        </div>
      </div>

      {/* Username input */}
      <div>
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
            onClick={saveIdentity}
            disabled={identityLoading || signingIn || !identityUsername || identityUsername.length < 3 || identityAvailable === false}
            className={`px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
              isDark
                ? 'text-green-500 border border-green-500/30 hover:border-green-500/50'
                : 'text-green-600 border border-green-500/40 hover:border-green-500/60'
            }`}
          >
            {signingIn ? 'Signing...' : identityLoading ? 'Saving...' : identity ? 'Update' : 'Set'}
          </button>
        </div>
        {identityError && (
          <p className="text-[10px] text-red-400 mt-1">{identityError}</p>
        )}
        {/* Show sign-in hint for wallet users without session */}
        {isWalletConnected && !hasValidWalletSession() && !identityError && (
          <p className={`text-[10px] mt-1 ${isDark ? 'text-yellow-500/70' : 'text-yellow-600/70'}`}>
            Will request wallet signature to authenticate
          </p>
        )}
        <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
          3-20 chars, letters/numbers/underscore
        </p>
      </div>
    </div>
  )
}

// Settings view - inline with back button (account settings: auth methods + Juicy ID)
function SettingsView({ onBack }: { onBack: () => void }) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { selectedFruit, setSelectedFruit } = useSettingsStore()
  const {
    user,
    passkeys,
    isAuthenticated,
    logout,
    requestOtp,
    login,
    loginWithPasskey,
    registerPasskey,
    loadPasskeys,
    token,
  } = useAuthStore()
  const isLoggedIn = isAuthenticated()
  const { address: managedAddress } = useManagedWallet()

  // Wallet connection
  const { address: walletAddress, isConnected: isWalletConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()

  // Check for passkey wallet connection
  const passkeyWalletConnected = !!getPasskeyWallet()

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
  const [identity, setIdentity] = useState<{ emoji: string; username: string; formatted: string } | null>(() => {
    try {
      const cached = localStorage.getItem('juicy-identity')
      return cached ? JSON.parse(cached) : null
    } catch { return null }
  })
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
          // Cache for instant display
          try { localStorage.setItem('juicy-identity', JSON.stringify(data.data)) } catch {}
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
    const walletSession = getWalletSession()
    const sessionId = getSessionId()
    const addr = walletSession?.address ||
      `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
    const emoji = overrideEmoji || selectedFruit || getEmojiFromAddress(addr)
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

  // Load passkeys and identity on mount
  useEffect(() => {
    if (isLoggedIn) {
      loadPasskeys()
    }
    loadIdentity()

    // Listen for identity changes from other components
    const handleIdentityChange = (e: CustomEvent<{ emoji: string; username: string; formatted: string }>) => {
      setIdentity(e.detail)
      setIdentityUsername(e.detail.username)
      // Cache for instant display
      try { localStorage.setItem('juicy-identity', JSON.stringify(e.detail)) } catch {}
    }
    window.addEventListener('juice:identity-changed', handleIdentityChange as EventListener)
    return () => window.removeEventListener('juice:identity-changed', handleIdentityChange as EventListener)
  }, [isLoggedIn, loadPasskeys, loadIdentity])

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

    const walletSession = getWalletSession()
    const sessionId = getSessionId()
    const addr = walletSession?.address ||
      `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
    const currentEmoji = selectedFruit || getEmojiFromAddress(addr)

    // Don't check if it's the current identity
    if (identity && identity.emoji === currentEmoji && identity.username.toLowerCase() === identityUsername.toLowerCase()) {
      setIdentityAvailable(true)
      return
    }

    const timer = setTimeout(() => {
      checkAvailability(currentEmoji, identityUsername)
    }, 300)

    return () => clearTimeout(timer)
  }, [identityUsername, selectedFruit, identity, checkAvailability])

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

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className={`flex items-center gap-1 text-xs ${
          isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
        }`}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Signed in state */}
      {isLoggedIn && user && (
        <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {user.email && !user.email.includes('@passkey.local') ? (
            <p>Signed in as <span className={isDark ? 'text-white' : 'text-gray-900'}>{user.email}</span></p>
          ) : (
            <p>Signed in via <span className={isDark ? 'text-white' : 'text-gray-900'}>Touch ID</span> on {passkeys.length || 1} device{passkeys.length !== 1 ? 's' : ''}</p>
          )}
        </div>
      )}

      {/* Auth methods */}
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
              {isLoggedIn && user?.email && !user.email.includes('@passkey.local') ? 'Connected' : 'Add'}
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
                      ? 'border-white/20 bg-transparent text-white placeholder-gray-500 focus:border-green-500'
                      : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400 focus:border-green-500'
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
                    className="flex-1 py-1 text-[10px] text-green-500 disabled:opacity-50"
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
                      ? 'border-white/20 bg-transparent text-white focus:border-green-500'
                      : 'border-gray-200 bg-white text-gray-900 focus:border-green-500'
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
                    className="flex-1 py-1 text-[10px] text-green-500 disabled:opacity-50"
                  >
                    {emailLoading ? '...' : 'Verify'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Passkey / Touch ID - expandable dropdown */}
        <div className={`border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <button
            onClick={() => {
              setShowPasskeysList(!showPasskeysList)
              if (!showPasskeysList && isLoggedIn) {
                loadPasskeys()
              }
            }}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
              isDark ? 'hover:bg-white/5 text-gray-300' : 'hover:bg-gray-50 text-gray-700'
            }`}
          >
            <span>Touch ID</span>
            <div className="flex items-center gap-2">
              {(isLoggedIn && passkeys.length > 0) || passkeyWalletConnected ? (
                <span><span className="text-green-500">{passkeys.length || 1}</span> <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>· Add more</span></span>
              ) : (
                <span className={isDark ? 'text-gray-600' : 'text-gray-400'}>Add</span>
              )}
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
              {passkeys.length > 0 ? (
                <div className="space-y-1 mt-2">
                  {passkeys.map((pk) => {
                    // Format device type for display
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
              ) : passkeyWalletConnected ? (
                <p className={`text-xs mt-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Touch ID connected
                </p>
              ) : null}

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
                      // Suggest device name based on platform
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

        {/* Wallet */}
        {isWalletConnected && walletAddress ? (
          <div className={`flex items-center justify-between px-3 py-2 text-xs ${
            isDark ? 'text-gray-300' : 'text-gray-700'
          }`}>
            <span className="font-mono">{shortenAddress(walletAddress)}</span>
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
              const injected = connectors.find(c => c.id === 'injected' || c.id.includes('metamask'))
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
            const emoji = identity?.emoji || selectedFruit || defaultEmoji
            const name = identityUsername || identity?.username || ''
            return `${emoji} ${name}`
          })()}
        </p>

        {/* Emoji picker row */}
        <p className={`text-[10px] mb-1 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Pick a flavor</p>
        <div className="flex flex-wrap gap-1 mb-3">
          {FRUIT_EMOJIS.map((fruit) => {
            const walletSession = getWalletSession()
            const sessionId = getSessionId()
            const currentAddress = walletSession?.address ||
              `0x${sessionId.replace(/[^a-f0-9]/gi, '').slice(0, 40).padStart(40, '0')}`
            const defaultEmoji = getEmojiFromAddress(currentAddress)
            const isSelected = selectedFruit === fruit || (!selectedFruit && fruit === defaultEmoji)

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
                      ? 'bg-white/20 ring-2 ring-green-500'
                      : 'bg-gray-200 ring-2 ring-green-500'
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
                ? 'text-green-500 border border-green-500/30 hover:border-green-500/50'
                : 'text-green-600 border border-green-500/40 hover:border-green-500/60'
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
                    ? 'text-green-500 border border-green-500/30 hover:border-green-500/50'
                    : 'text-green-600 border border-green-500/40 hover:border-green-500/60'
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
      </div>

      {/* Sign Out */}
      {isLoggedIn && (
        <div className="pt-2">
          <button
            onClick={() => {
              localStorage.removeItem('juicy-identity')
              logout()
              onBack()
            }}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// Buy Pay Credits view - inline with back button
const PRESET_AMOUNTS = [10, 25, 50, 100]
const API_BASE = import.meta.env.VITE_API_URL || ''
const PAY_CREDITS_RATE = 1.05 // Flat rate: $1.05 per Pay Credit

function BuyJuiceView({ onBack, onSuccess }: { onBack: () => void; onSuccess?: () => void }) {
  const { theme } = useThemeStore()
  const { token } = useAuthStore()
  const isDark = theme === 'dark'

  const [step, setStep] = useState<'amount' | 'checkout' | 'success' | 'error'>('amount')
  const [amount, setAmount] = useState<number>(25) // Credits amount
  const [customAmount, setCustomAmount] = useState<string>('')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Fetch Stripe publishable key on mount
  useEffect(() => {
    fetch(`${API_BASE}/juice/stripe-config`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data.publishableKey) {
          setStripePromise(loadStripe(data.data.publishableKey))
        } else {
          setError('Payment system not available')
        }
      })
      .catch(() => {
        setError('Failed to load payment system')
      })
  }, [])


  const handleAmountSelect = (value: number) => {
    setAmount(value)
    setCustomAmount('')
  }

  const handleCustomAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setCustomAmount(value)
    const parsed = parseFloat(value)
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 10000) {
      setAmount(parsed)
    }
  }

  const startCheckout = useCallback(async () => {
    if (!token) {
      setError('Please sign in to purchase Pay Credits')
      return
    }

    if (amount < 1 || amount > 10000) {
      setError('Amount must be between $1 and $10,000')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/juice/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ amount }),
      })

      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to create checkout session')
      }

      setClientSecret(data.data.clientSecret)
      setStep('checkout')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout')
    } finally {
      setLoading(false)
    }
  }, [amount, token])

  const handleCheckoutComplete = useCallback(() => {
    setStep('success')
    onSuccess?.()
  }, [onSuccess])

  return (
    <div className="space-y-3">
      {/* Back button - only show when not in checkout */}
      {step !== 'checkout' && (
        <button
          onClick={onBack}
          className={`flex items-center gap-1 text-xs ${
            isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      )}

      {/* Amount Selection Step */}
      {step === 'amount' && (
        <div className="space-y-3">
          {/* Flat rate display */}
          <div className={`px-3 py-2 border ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
            <div className="flex justify-between items-center">
              <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Rate
              </span>
              <span className={`text-xs font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                $1.05 per Pay Credit
              </span>
            </div>
          </div>

          {/* Preset credit amounts */}
          <div className="grid grid-cols-4 gap-2">
            {PRESET_AMOUNTS.map(preset => (
              <button
                key={preset}
                onClick={() => handleAmountSelect(preset)}
                className={`py-2 px-2 text-xs font-medium transition-all border ${
                  amount === preset && !customAmount
                    ? 'bg-green-500 text-white border-green-500'
                    : isDark
                      ? 'bg-transparent border-green-500/50 text-green-400 hover:border-green-500'
                      : 'bg-transparent border-green-500 text-green-600 hover:border-green-600'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Custom credit amount */}
          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Or enter custom amount
            </label>
            <input
              type="number"
              min={1}
              max={10000}
              step={1}
              value={customAmount}
              onChange={handleCustomAmountChange}
              placeholder="Credits"
              className={`w-full px-3 py-2 text-xs font-mono ${
                isDark
                  ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                  : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
              } border focus:border-juice-orange outline-none`}
            />
            <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              1 - 10,000 credits per purchase
            </p>
          </div>

          {/* Summary */}
          <div className={`px-3 py-2 border ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
            <div className="flex justify-between items-center mb-1">
              <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>You'll receive</span>
              <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {amount.toLocaleString()} Pay Credits
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Total cost</span>
              <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                ${(amount * PAY_CREDITS_RATE).toFixed(2)}
              </span>
            </div>
          </div>

          {error && (
            <div className={`px-3 py-2 text-xs border ${isDark ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={startCheckout}
              disabled={loading || !stripePromise || amount < 1}
              className={`px-4 py-2 text-xs font-bold transition-colors ${
                loading || !stripePromise || amount < 1
                  ? isDark ? 'bg-white/10 text-gray-500 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-green-500 text-white hover:bg-green-600'
              }`}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                </span>
              ) : (
                'Buy'
              )}
            </button>
          </div>
        </div>
      )}

      {/* Checkout Step */}
      {step === 'checkout' && stripePromise && clientSecret && (
        <div className="-mx-4 -mb-4 -mt-2">
          <EmbeddedCheckoutProvider
            stripe={stripePromise}
            options={{
              clientSecret,
              onComplete: handleCheckoutComplete,
            }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      )}

      {/* Success Step */}
      {step === 'success' && (
        <div className="text-center py-4 space-y-3">
          <div className={`w-10 h-10 mx-auto flex items-center justify-center ${isDark ? 'bg-green-500/20' : 'bg-green-100'}`}>
            <svg className={`w-5 h-5 ${isDark ? 'text-green-400' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className={`text-xs font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {amount} Pay Credits purchased
            </p>
            <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Credits available once payment is verified.
            </p>
          </div>
          <button
            onClick={onBack}
            className="w-full py-2 text-xs font-bold bg-green-500 text-white hover:bg-green-600 transition-all"
          >
            Done
          </button>
        </div>
      )}

      {/* Error Step */}
      {step === 'error' && (
        <div className="text-center py-4 space-y-3">
          <div className={`w-10 h-10 mx-auto flex items-center justify-center ${isDark ? 'bg-red-500/20' : 'bg-red-100'}`}>
            <svg className={`w-5 h-5 ${isDark ? 'text-red-400' : 'text-red-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <div>
            <p className={`text-xs font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Payment Failed
            </p>
            <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {error || 'Something went wrong. Please try again.'}
            </p>
          </div>
          <button
            onClick={() => setStep('amount')}
            className="w-full py-2 text-xs font-bold bg-green-500 text-white hover:bg-green-600 transition-all"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  )
}

export default function WalletPanel({ isOpen, onClose, paymentContext, anchorPosition, initialView }: WalletPanelProps) {
  const { mode, logout: authLogout, isAuthenticated } = useAuthStore()
  const { address, isConnected: walletConnected } = useAccount()
  const { t } = useTranslation()

  // Self-custody users are "signed in" if they have a valid SIWE session
  const isSelfCustodySignedIn = hasValidWalletSession()
  const { disconnect } = useDisconnect()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [view, setView] = useState<'select' | 'self_custody' | 'managed' | 'auth_method' | 'email_auth' | 'wallet' | 'passkey' | 'settings' | 'buy_juice' | 'juicy_id'>('select')
  const [insufficientFundsInfo, setInsufficientFundsInfo] = useState<InsufficientFundsInfo | null>(null)
  const [passkeyWallet, setPasskeyWallet] = useState<PasskeyWallet | null>(() => getPasskeyWallet())
  const [previousView, setPreviousView] = useState<typeof view>('select')

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

  // Calculate popover position based on anchor
  const popoverStyle = useMemo(() => {
    if (!anchorPosition) {
      // Fallback to top-right if no anchor
      return { top: 16, right: 16 }
    }

    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
    const gap = 8 // Gap between button and popover
    const margin = 16 // Minimum margin from viewport edges
    // Use wider popover for checkout view (Stripe needs more space)
    const popoverWidth = view === 'buy_juice' ? 420 : 320

    // Check if button is in lower half of viewport
    const isInLowerHalf = anchorPosition.top > viewportHeight / 2

    // Calculate right position (align popover right edge with button right edge)
    let rightPos = viewportWidth - anchorPosition.left - anchorPosition.width

    // Check if popover would go past the left edge
    const leftEdge = viewportWidth - rightPos - popoverWidth
    if (leftEdge < margin) {
      // Clamp so popover stays within viewport with margin
      rightPos = viewportWidth - popoverWidth - margin
    }

    // Also ensure we don't go past the right edge
    rightPos = Math.max(margin, rightPos)

    if (isInLowerHalf) {
      // Show above the button, but ensure it doesn't go off the top
      return {
        bottom: viewportHeight - anchorPosition.top + gap,
        right: rightPos,
        maxHeight: anchorPosition.top - gap - margin,
      }
    } else {
      // Show below the button
      return {
        top: Math.max(margin, anchorPosition.top + anchorPosition.height + gap),
        right: rightPos,
      }
    }
  }, [anchorPosition, view])

  // Clear insufficient funds info when view changes away from wallet
  useEffect(() => {
    if (view !== 'wallet' && view !== 'buy_juice') {
      setInsufficientFundsInfo(null)
    }
  }, [view])

  // Clear insufficient funds info when modal closes
  useEffect(() => {
    if (!isOpen) {
      setInsufficientFundsInfo(null)
    }
  }, [isOpen])

  // Set initial view when modal opens
  useEffect(() => {
    if (isOpen) {
      setView(initialView || 'select')
    }
  }, [isOpen, initialView])

  // Handle opening settings (store previous view to go back)
  const handleOpenSettings = () => {
    setPreviousView(view)
    setView('settings')
  }

  // Determine current state
  // Use isAuthenticated() which internally checks mode === 'managed' && token && user
  // This avoids stale state issues from zustand hydration timing
  // Connected wallet takes priority over managed mode when both are present
  // (user's connected wallet is their primary identity)
  const hasConnectedWallet = walletConnected && !!address
  const isManagedConnected = isAuthenticated()
  const isPasskeyConnected = !!passkeyWallet

  const currentView = (() => {
    if (view === 'settings') return 'settings'
    if (view === 'buy_juice') return 'buy_juice'
    if (view === 'juicy_id') return 'juicy_id'
    if (view === 'auth_method') return 'auth_method'
    if (view === 'email_auth') return 'email_auth'
    // Connected wallet always takes priority - it's the user's primary identity
    if (hasConnectedWallet) return 'wallet'
    if (isManagedConnected) return 'managed'
    if (isPasskeyConnected) return 'passkey'
    return view
  })()

  const handleDisconnect = async () => {
    if (passkeyWallet) {
      // Disconnect passkey wallet - clear wallet and SIWE session but keep credential ID
      // so user can sign back into the same wallet
      clearPasskeyWallet()
      clearWalletSession()
      setPasskeyWallet(null)
    } else if (mode === 'self_custody') {
      disconnect()
    } else {
      await authLogout()
    }
    setView('select')
  }

  const getTitle = () => {
    // Payment context changes titles
    if (paymentContext) {
      switch (currentView) {
        case 'select': return 'Connect to Pay'
        case 'self_custody': return 'Connect Wallet'
        case 'wallet':
        case 'passkey':
          // Show insufficient funds title if applicable
          if (insufficientFundsInfo) {
            return `You don't have ${insufficientFundsInfo.amount} ${insufficientFundsInfo.token} on ${insufficientFundsInfo.chainName}`
          }
          return 'Confirm Payment'
        default: break
      }
    }
    switch (currentView) {
      case 'select': return t('wallet.connect', 'Connect')
      case 'self_custody': return t('wallet.connectWallet', 'Connect Wallet')
      case 'auth_method': return t('wallet.signIn', 'Sign In')
      case 'email_auth': return t('wallet.emailSignIn', 'Email Sign In')
      case 'managed': return t('wallet.account', 'Account')
      case 'wallet': return t('wallet.account', 'Account')
      case 'passkey': return t('wallet.account', 'Account')
      case 'settings': return t('wallet.settings', 'Settings')
      case 'juicy_id': return t('wallet.setJuicyId', 'Set Juicy ID')
      case 'buy_juice': return t('wallet.buyPayCredits', 'Buy Pay Credits')
      default: return t('wallet.connect', 'Connect')
    }
  }

  if (!isOpen) return null

  return createPortal(
    <>
      {/* Backdrop - catches clicks outside popover */}
      <div
        className="fixed inset-0 z-[99] cursor-default"
        onMouseDown={onClose}
      />
      <div className="fixed z-[100]" style={popoverStyle}>
        {/* Popover */}
        <div
          className={`relative p-4 border shadow-xl max-h-[calc(100vh-32px)] overflow-y-auto ${
          currentView === 'buy_juice' ? 'w-[420px]' : 'w-80'
        } ${isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className={`absolute top-3 right-3 p-1 transition-colors ${
            isDark ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Title */}
        <h2 className={`text-sm font-semibold mb-3 pr-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {getTitle()}
        </h2>

        {currentView === 'select' && (
          <ConnectOptions
            onWalletClick={() => setView('self_custody')}
            onPasskeySuccess={() => {
              setPasskeyWallet(getPasskeyWallet())
            }}
          />
        )}

        {currentView === 'self_custody' && (
          <SelfCustodyConnect onBack={() => setView('select')} />
        )}

        {currentView === 'auth_method' && (
          <AuthMethodSelector
            onSelectMethod={(method) => {
              if (method === 'email') {
                setView('email_auth')
              }
              // Passkey login is handled in AuthMethodSelector
            }}
            onBack={() => setView('select')}
          />
        )}

        {currentView === 'email_auth' && (
          <EmailAuth
            onBack={() => setView('auth_method')}
            onSuccess={() => setView('select')}
          />
        )}

        {currentView === 'managed' && !isManagedConnected && (
          <AuthMethodSelector
            onSelectMethod={(method) => {
              if (method === 'email') {
                setView('email_auth')
              }
            }}
            onBack={() => setView('select')}
          />
        )}

        {currentView === 'managed' && isManagedConnected && (
          <ManagedAccountView
            onDisconnect={handleDisconnect}
            onTopUp={() => {
              setPreviousView('managed')
              setView('buy_juice')
            }}
            onSettings={() => setView('settings')}
            onSetJuicyId={() => setView('juicy_id')}
          />
        )}

        {currentView === 'wallet' && hasConnectedWallet && (
          <SelfCustodyWalletView
            onTopUp={() => {
              setPreviousView('wallet')
              setView('buy_juice')
            }}
            onDisconnect={handleDisconnect}
            paymentContext={paymentContext}
            onInsufficientFundsChange={setInsufficientFundsInfo}
            isSignedIn={isSelfCustodySignedIn}
          />
        )}

        {currentView === 'passkey' && passkeyWallet && (
          <PasskeyWalletView
            wallet={passkeyWallet}
            onTopUp={() => {
              setPreviousView('passkey')
              setView('buy_juice')
            }}
            onDisconnect={handleDisconnect}
          />
        )}

        {currentView === 'settings' && (
          <SettingsView onBack={() => setView(previousView)} />
        )}

        {currentView === 'juicy_id' && (
          <JuicyIdView onBack={() => setView('managed')} />
        )}

        {currentView === 'buy_juice' && (
          <BuyJuiceView onBack={() => setView(previousView)} />
        )}

        {/* Settings gear icon - bottom left (only show when connected, not during connection flow) */}
        {currentView !== 'settings' && currentView !== 'buy_juice' && currentView !== 'juicy_id' && currentView !== 'select' && currentView !== 'self_custody' && currentView !== 'auth_method' && currentView !== 'email_auth' && (
          <button
            onClick={handleOpenSettings}
            className={`absolute bottom-3 left-3 p-1.5 transition-colors ${
              isDark ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'
            }`}
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        )}
      </div>
    </div>
    </>,
    document.body
  )
}
