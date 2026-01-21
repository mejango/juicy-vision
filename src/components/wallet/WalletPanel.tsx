import { useState, useEffect, useCallback } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { createPublicClient, http, formatEther, erc20Abi } from 'viem'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet, useEnsNameResolved } from '../../hooks'
import { Modal } from '../ui'
import { VIEM_CHAINS, USDC_ADDRESSES, RPC_ENDPOINTS, type SupportedChainId } from '../../constants'
import { CHAINS, ALL_CHAIN_IDS } from '../../constants'

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
}

interface WalletPanelProps {
  isOpen: boolean
  onClose: () => void
  paymentContext?: PaymentContext
}

function shortenAddress(address: string, chars = 6): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`
}

// Mode selector - self-custody vs managed
function ModeSelector({ onSelectMode }: {
  onSelectMode: (mode: 'self_custody' | 'managed') => void
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  return (
    <div className="space-y-2">
      {/* Self-custody - Browser wallet */}
      <button
        onClick={() => onSelectMode('self_custody')}
        className={`w-full p-3 border text-left transition-all ${
          isDark
            ? 'border-green-500/50 bg-green-500/10 hover:bg-green-500/20'
            : 'border-green-500 bg-green-50 hover:bg-green-100'
        }`}
      >
        <div className="flex items-center gap-3">
          <svg className={`w-5 h-5 ${isDark ? 'text-green-400' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <div>
            <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Connect Wallet
            </div>
            <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              MetaMask, Rainbow, etc.
            </div>
          </div>
        </div>
      </button>

      {/* Managed - Email */}
      <button
        onClick={() => onSelectMode('managed')}
        className={`w-full p-3 border text-left transition-all ${
          isDark
            ? 'border-white/10 hover:border-white/20'
            : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <div className="flex items-center gap-3">
          <svg className={`w-5 h-5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <div>
            <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Email
            </div>
            <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Managed wallet
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
            className={`w-full py-2 px-3 border text-sm font-medium transition-all
              disabled:opacity-50 disabled:cursor-not-allowed ${
              isDark
                ? 'border-white/10 text-white hover:border-green-500/50 hover:bg-green-500/10'
                : 'border-gray-200 text-gray-900 hover:border-green-500 hover:bg-green-50'
            }`}
          >
            {connector.name}
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

// Connected wallet view (self-custody) with multi-chain balances
function SelfCustodyWalletView({ onTopUp, onDisconnect, paymentContext }: {
  onTopUp: () => void
  onDisconnect: () => void
  paymentContext?: PaymentContext
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address } = useAccount()
  const { ensName } = useEnsNameResolved(address)
  const [balances, setBalances] = useState<ChainBalance[]>([])
  const [loading, setLoading] = useState(true)

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

  if (!address) return null

  // Calculate totals
  const totalEth = balances.reduce((sum, b) => sum + parseFloat(b.eth || '0'), 0)
  const totalUsdc = balances.reduce((sum, b) => sum + parseFloat(b.usdc || '0'), 0)

  return (
    <div className="space-y-3">
      {/* Address row */}
      <div className="flex items-center justify-between">
        <div className={`font-mono text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {ensName || shortenAddress(address)}
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className={`text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}>
            Connected
          </span>
        </div>
      </div>

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

        // Find chains with sufficient funds for alternatives
        const chainsWithFunds = balances.filter(b => {
          const available = paymentContext.token === 'ETH'
            ? parseFloat(b.eth || '0')
            : parseFloat(b.usdc || '0')
          return available >= requiredAmount
        })

        return (
          <div className="space-y-3">
            {/* Payment summary */}
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

            {hasSufficientFunds ? (
              <button
                onClick={paymentContext.onContinue}
                className="w-full py-2.5 text-sm font-medium bg-green-500 text-black hover:bg-green-600 transition-colors"
              >
                Continue to Payment
              </button>
            ) : (
              <div className="space-y-2">
                <div className={`p-2 text-xs ${isDark ? 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400' : 'bg-yellow-50 border border-yellow-200 text-yellow-700'}`}>
                  Insufficient funds on {paymentContext.chainName}. You have {availableOnTarget.toFixed(4)} {paymentContext.token}.
                </div>

                {chainsWithFunds.length > 0 && (
                  <div className="space-y-1">
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Pay from another chain:
                    </div>
                    {chainsWithFunds.map(chain => (
                      <button
                        key={chain.chainId}
                        onClick={() => {
                          // TODO: Update payment context to use this chain
                          window.dispatchEvent(new CustomEvent('juice:switch-payment-chain', {
                            detail: { chainId: chain.chainId, chainName: chain.chainName }
                          }))
                        }}
                        className={`w-full py-2 px-3 text-sm border flex items-center justify-between transition-colors ${
                          isDark
                            ? 'border-white/10 hover:border-green-500/50 hover:bg-green-500/10'
                            : 'border-gray-200 hover:border-green-500 hover:bg-green-50'
                        }`}
                      >
                        <span>{chain.chainName}</span>
                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                          {paymentContext.token === 'ETH'
                            ? `${parseFloat(chain.eth).toFixed(4)} ETH`
                            : `${parseFloat(chain.usdc).toFixed(2)} USDC`
                          }
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <button
                  onClick={onTopUp}
                  className={`w-full py-2 text-sm font-medium transition-colors ${
                    isDark
                      ? 'border border-white/20 text-white hover:border-white/40'
                      : 'border border-gray-200 text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Top Up {paymentContext.chainName}
                </button>
              </div>
            )}
          </div>
        )
      })()}

      {/* Standard Actions (when no payment context) */}
      {!paymentContext && (
        <div className="flex gap-2">
          <button
            onClick={onTopUp}
            className="flex-1 py-2 text-sm font-medium bg-green-500 text-black hover:bg-green-600 transition-colors"
          >
            Top Up
          </button>
          <button
            onClick={onDisconnect}
            className={`px-3 py-2 border transition-colors ${
              isDark
                ? 'border-white/20 text-gray-400 hover:text-white hover:border-white/40'
                : 'border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

// Managed account view
function ManagedAccountView({ onDisconnect }: { onDisconnect: () => void }) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { user, passkeys, loadPasskeys, registerPasskey, deletePasskey, isPasskeyAvailable, isLoading } = useAuthStore()
  const { address, balances, loading } = useManagedWallet()
  const [copied, setCopied] = useState(false)
  const [showPasskeys, setShowPasskeys] = useState(false)
  const [passkeyError, setPasskeyError] = useState<string | null>(null)

  const handleShowPasskeys = async () => {
    setShowPasskeys(true)
    await loadPasskeys()
  }

  const handleAddPasskey = async () => {
    setPasskeyError(null)
    try {
      await registerPasskey()
    } catch (err) {
      setPasskeyError(err instanceof Error ? err.message : 'Failed to add passkey')
    }
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

  return (
    <div className="space-y-3">
      {/* Account row */}
      <div className="flex items-center justify-between">
        <div className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {user.email}
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
          <span className={`text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}>
            Active
          </span>
        </div>
      </div>

      {/* Address */}
      {address && (
        <div className="flex items-center justify-between">
          <div className={`font-mono text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {shortenAddress(address, 8)}
          </div>
          <button
            onClick={copyAddress}
            className={`text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {/* Balances */}
      <div className={`border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        {loading ? (
          <div className={`px-3 py-3 text-xs text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Loading...
          </div>
        ) : balances.length > 0 ? (
          <div className="divide-y divide-white/5">
            {balances.map((balance, i) => {
              const formatted = Number(balance.balance) / Math.pow(10, balance.decimals)
              return (
                <div key={i} className="px-3 py-2 flex justify-between text-xs">
                  <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{balance.tokenSymbol}</span>
                  <span className={isDark ? 'text-white' : 'text-gray-900'}>
                    {formatted.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className={`px-3 py-3 text-xs text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            No balances
          </div>
        )}
      </div>

      {/* Passkey Management - collapsed by default */}
      {isPasskeyAvailable() && (
        <div className={`border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <button
            onClick={showPasskeys ? () => setShowPasskeys(false) : handleShowPasskeys}
            className={`w-full px-3 py-2 flex items-center justify-between text-xs ${
              isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <span>Passkeys</span>
            <svg className={`w-3 h-3 transition-transform ${showPasskeys ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showPasskeys && (
            <div className={`px-3 pb-3 space-y-2 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
              {passkeyError && (
                <div className={`p-2 text-xs border mt-2 ${
                  isDark ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-red-300 bg-red-50 text-red-600'
                }`}>
                  {passkeyError}
                </div>
              )}

              {passkeys.length > 0 && (
                <div className="space-y-1 mt-2">
                  {passkeys.map((pk) => (
                    <div key={pk.id} className="flex items-center justify-between text-xs py-1">
                      <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                        {pk.displayName || pk.deviceType || 'Passkey'}
                      </span>
                      <button
                        onClick={() => handleDeletePasskey(pk.id)}
                        className={`text-xs ${isDark ? 'text-red-400' : 'text-red-500'}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleAddPasskey}
                disabled={isLoading}
                className={`w-full py-1.5 text-xs font-medium mt-2 transition-colors disabled:opacity-50 ${
                  isDark
                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/50'
                    : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                }`}
              >
                {isLoading ? 'Adding...' : 'Add Passkey'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Sign out */}
      <button
        onClick={onDisconnect}
        className={`w-full py-2 text-sm border transition-colors ${
          isDark
            ? 'border-white/20 text-gray-400 hover:text-white hover:border-white/40'
            : 'border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300'
        }`}
      >
        Sign Out
      </button>
    </div>
  )
}

// Top up view
function TopUpView({ onBack, address }: { onBack: () => void; address?: string }) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const onrampLinks = [
    {
      name: 'Coinbase',
      url: address
        ? `https://pay.coinbase.com/buy/select-asset?addresses={"${address}":["ethereum","base","optimism","arbitrum"]}&presetFiatAmount=50`
        : 'https://pay.coinbase.com',
    },
    {
      name: 'MoonPay',
      url: address
        ? `https://www.moonpay.com/buy?defaultCurrencyCode=eth&walletAddress=${address}`
        : 'https://www.moonpay.com',
    },
    {
      name: 'Transak',
      url: address
        ? `https://global.transak.com/?cryptoCurrencyCode=ETH&walletAddress=${address}`
        : 'https://global.transak.com',
    },
  ]

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

      <div className="space-y-2">
        {onrampLinks.map((link) => (
          <a
            key={link.name}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`w-full py-2 px-3 border flex items-center justify-between text-sm transition-all block ${
              isDark
                ? 'border-white/10 text-white hover:border-green-500/50 hover:bg-green-500/10'
                : 'border-gray-200 text-gray-900 hover:border-green-500 hover:bg-green-50'
            }`}
          >
            <span>{link.name}</span>
            <svg className="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ))}
      </div>

      {address && (
        <div className={`text-xs text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {shortenAddress(address, 8)}
        </div>
      )}
    </div>
  )
}

export default function WalletPanel({ isOpen, onClose, paymentContext }: WalletPanelProps) {
  const { mode, logout: authLogout, isAuthenticated } = useAuthStore()
  const { address, isConnected: walletConnected } = useAccount()
  const { disconnect } = useDisconnect()

  const [view, setView] = useState<'select' | 'self_custody' | 'managed' | 'auth_method' | 'email_auth' | 'wallet' | 'topup'>('select')

  // Determine current state
  const isSelfCustodyConnected = mode === 'self_custody' && walletConnected
  const isManagedConnected = mode === 'managed' && isAuthenticated()

  const currentView = (() => {
    if (view === 'topup') return 'topup'
    if (view === 'auth_method') return 'auth_method'
    if (view === 'email_auth') return 'email_auth'
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
    // Payment context changes titles
    if (paymentContext) {
      switch (currentView) {
        case 'select': return 'Connect to Pay'
        case 'self_custody': return 'Connect Wallet'
        case 'wallet': return 'Confirm Payment'
        case 'topup': return 'Add Funds'
        default: break
      }
    }
    switch (currentView) {
      case 'select': return 'Connect'
      case 'self_custody': return 'Connect Wallet'
      case 'auth_method': return 'Sign In'
      case 'email_auth': return 'Email Sign In'
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
          onSelectMode={(selectedMode) => {
            if (selectedMode === 'managed') {
              setView('auth_method')
            } else {
              setView(selectedMode)
            }
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
        <ManagedAccountView onDisconnect={handleDisconnect} />
      )}

      {currentView === 'wallet' && isSelfCustodyConnected && (
        <SelfCustodyWalletView
          onTopUp={() => setView('topup')}
          onDisconnect={handleDisconnect}
          paymentContext={paymentContext}
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
