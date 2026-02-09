/**
 * PayTerm Payment Page
 *
 * Minimal, Apple Pay-like interface for terminal payments.
 * Consumer taps NFC or scans QR → Opens this page → Pays with Juice/Apple Pay/Wallet
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js'
import { useAccount, useConnect, useWalletClient, useSwitchChain } from 'wagmi'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import Button from '../../components/ui/Button'
import { getChainById } from '@shared/chains'
import { IS_TESTNET } from '../../config/environment'

const API_BASE = import.meta.env.VITE_API_URL || ''

// Payment session types
interface PaymentSession {
  id: string
  deviceId: string
  amountUsd: number
  token: string | null
  tokenSymbol: string
  status: 'pending' | 'paying' | 'completed' | 'failed' | 'expired' | 'cancelled'
  merchantId: string
  merchantName: string
  projectId: number
  chainId: number
  expiresAt: string
  createdAt: string
}

type PaymentStep = 'loading' | 'ready' | 'auth' | 'checkout' | 'paying' | 'success' | 'error'

export default function PaymentPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { theme } = useThemeStore()
  const { token, isAuthenticated, login, user } = useAuthStore()
  const { address: smartAccountAddress, isManagedMode } = useManagedWallet()
  const isDark = theme === 'dark'

  // Wallet connection
  const { address: walletAddress, isConnected } = useAccount()
  const { connect, connectors, isPending: isConnecting } = useConnect()
  const { data: walletClient } = useWalletClient()
  const { switchChain } = useSwitchChain()

  // State for wallet connector selection
  const [showWalletOptions, setShowWalletOptions] = useState(false)

  // State
  const [step, setStep] = useState<PaymentStep>('loading')
  const [session, setSession] = useState<PaymentSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Stripe state
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)

  // Auth state for email login
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)

  // Fetch session details
  useEffect(() => {
    if (!sessionId) {
      setError('Invalid payment link')
      setStep('error')
      return
    }

    fetch(`${API_BASE}/terminal/session/${sessionId}`)
      .then(res => res.json())
      .then(data => {
        if (!data.success) {
          throw new Error(data.error || 'Session not found')
        }

        const sess = data.data.session as PaymentSession

        // Check session status
        if (sess.status === 'completed') {
          setSession(sess)
          setStep('success')
          return
        }

        if (sess.status === 'expired') {
          setError('This payment session has expired')
          setStep('error')
          return
        }

        if (sess.status === 'cancelled') {
          setError('This payment was cancelled')
          setStep('error')
          return
        }

        if (sess.status === 'failed') {
          setError('This payment failed')
          setStep('error')
          return
        }

        // Check expiry
        if (new Date(sess.expiresAt) < new Date()) {
          setError('This payment session has expired')
          setStep('error')
          return
        }

        setSession(sess)
        setStep('ready')
      })
      .catch(err => {
        setError(err.message || 'Failed to load payment')
        setStep('error')
      })
  }, [sessionId])

  // Fetch Stripe config
  useEffect(() => {
    fetch(`${API_BASE}/juice/stripe-config`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data.publishableKey) {
          setStripePromise(loadStripe(data.data.publishableKey))
        }
      })
      .catch(() => {
        // Stripe not required - wallet payments still work
      })
  }, [])

  // WebSocket for real-time session status updates
  useEffect(() => {
    if (!sessionId || step === 'loading' || step === 'success' || step === 'error') return

    const wsUrl = `${API_BASE.replace(/^http/, 'ws')}/terminal/session/${sessionId}/ws?role=consumer`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)

        if (message.type === 'payment_completed') {
          setSession(prev => prev ? { ...prev, status: 'completed' } : null)
          setStep('success')
        } else if (message.type === 'payment_failed') {
          setError(message.data?.error || 'Payment failed')
          setStep('error')
        } else if (message.type === 'session_expired') {
          setError('This payment session has expired')
          setStep('error')
        } else if (message.type === 'session_cancelled') {
          setError('This payment was cancelled')
          setStep('error')
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.onerror = () => {
      // Fall back to polling if WebSocket fails
      console.log('WebSocket error, falling back to polling')
    }

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    }
  }, [sessionId, step])

  // Fallback polling for session status (in case WebSocket fails)
  useEffect(() => {
    if (step !== 'paying' || !sessionId) return

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/terminal/session/${sessionId}/status`)
        const data = await res.json()

        if (data.success) {
          if (data.data.status === 'completed') {
            setSession(prev => prev ? { ...prev, status: 'completed' } : null)
            setStep('success')
          } else if (data.data.status === 'failed') {
            setError('Payment failed')
            setStep('error')
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 5000) // Slower polling as backup

    return () => clearInterval(poll)
  }, [step, sessionId])

  // Request OTP code
  const handleRequestCode = async () => {
    if (!email) return

    setAuthLoading(true)
    try {
      const res = await fetch(`${API_BASE}/auth/request-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to send code')
      }

      setCodeSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setAuthLoading(false)
    }
  }

  // Verify OTP and login
  const handleVerifyCode = async () => {
    if (!email || !code) return

    setAuthLoading(true)
    try {
      await login(email, code)
      setStep('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code')
    } finally {
      setAuthLoading(false)
    }
  }

  // Pay with Juice Credits
  const handlePayWithJuice = useCallback(async () => {
    if (!session || !token) {
      setStep('auth')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/terminal/session/${session.id}/pay/juice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      })

      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || 'Payment failed')
      }

      setStep('paying')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setLoading(false)
    }
  }, [session, token])

  // Pay with Apple Pay / Stripe
  const handlePayWithApplePay = useCallback(async () => {
    if (!session || !token || !stripePromise) {
      if (!isAuthenticated()) {
        setStep('auth')
        return
      }
      setError('Payment system not available')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Create a Stripe checkout session for this payment
      const res = await fetch(`${API_BASE}/juice/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount: session.amountUsd,
          // Metadata to link to terminal session
          metadata: {
            terminalSessionId: session.id,
            projectId: session.projectId,
            chainId: session.chainId,
          },
        }),
      })

      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to start payment')
      }

      setClientSecret(data.data.clientSecret)
      setStep('checkout')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start payment')
    } finally {
      setLoading(false)
    }
  }, [session, token, stripePromise, isAuthenticated])

  // Pay with connected wallet
  const handlePayWithWallet = useCallback(async () => {
    if (!session) return

    if (!isConnected || !walletAddress) {
      setShowWalletOptions(true)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Switch to correct chain if needed
      if (walletClient?.chain?.id !== session.chainId) {
        await switchChain({ chainId: session.chainId })
      }

      // Get payment parameters
      const paramsRes = await fetch(`${API_BASE}/terminal/session/${session.id}/pay/wallet`)
      const paramsData = await paramsRes.json()

      if (!paramsData.success) {
        throw new Error(paramsData.error || 'Failed to get payment params')
      }

      const { terminalAddress, projectId, amountUsd, tokenAddress } = paramsData.data

      // Mark payment as started
      await fetch(`${API_BASE}/terminal/session/${session.id}/pay/wallet/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payerAddress: walletAddress }),
      })

      setStep('paying')

      // Calculate payment amount (convert USD to token amount)
      // For ETH, we'd need a price oracle. For now, use a simple estimate
      // This is simplified - in production, use proper price feeds
      const isNativeToken = tokenAddress === '0x000000000000000000000000000000000000EEEe'
      const ethPrice = 2500 // Simplified - should use oracle
      const paymentAmount = isNativeToken
        ? BigInt(Math.floor((amountUsd / ethPrice) * 1e18))
        : BigInt(Math.floor(amountUsd * 1e6)) // USDC has 6 decimals

      // Build the pay transaction
      // JBMultiTerminal.pay(projectId, token, amount, beneficiary, minReturnedTokens, memo, metadata)
      const txHash = await walletClient!.writeContract({
        address: terminalAddress as `0x${string}`,
        abi: [
          {
            name: 'pay',
            type: 'function',
            stateMutability: 'payable',
            inputs: [
              { name: 'projectId', type: 'uint256' },
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint256' },
              { name: 'beneficiary', type: 'address' },
              { name: 'minReturnedTokens', type: 'uint256' },
              { name: 'memo', type: 'string' },
              { name: 'metadata', type: 'bytes' },
            ],
            outputs: [{ name: 'beneficiaryTokenCount', type: 'uint256' }],
          },
        ],
        functionName: 'pay',
        args: [
          BigInt(projectId),
          tokenAddress as `0x${string}`,
          paymentAmount,
          walletAddress, // beneficiary
          BigInt(0), // minReturnedTokens
          'PayTerm payment',
          '0x', // empty metadata
        ],
        value: isNativeToken ? paymentAmount : BigInt(0),
      })

      // Confirm payment with backend
      await fetch(`${API_BASE}/terminal/session/${session.id}/pay/wallet/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      })

      setSession(prev => prev ? { ...prev, status: 'completed' } : null)
      setStep('success')
    } catch (err) {
      // Mark payment as failed
      await fetch(`${API_BASE}/terminal/session/${session.id}/pay/wallet/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errorMessage: err instanceof Error ? err.message : 'Unknown error' }),
      }).catch(() => {})

      setError(err instanceof Error ? err.message : 'Wallet payment failed')
      setStep('ready')
    } finally {
      setLoading(false)
    }
  }, [session, isConnected, walletAddress, walletClient, switchChain])

  // Handle wallet connector selection
  const handleConnectWallet = (connector: typeof connectors[number]) => {
    connect({ connector })
    setShowWalletOptions(false)
  }

  // Handle Stripe checkout completion
  const handleCheckoutComplete = useCallback(() => {
    // Stripe payment complete - now trigger the Juice spend
    handlePayWithJuice()
  }, [handlePayWithJuice])

  // Countdown timer
  const [timeLeft, setTimeLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!session) return

    const updateTime = () => {
      const expires = new Date(session.expiresAt).getTime()
      const now = Date.now()
      const remaining = Math.max(0, Math.floor((expires - now) / 1000))
      setTimeLeft(remaining)

      if (remaining === 0) {
        setError('This payment session has expired')
        setStep('error')
      }
    }

    updateTime()
    const interval = setInterval(updateTime, 1000)
    return () => clearInterval(interval)
  }, [session])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Render loading state
  if (step === 'loading') {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-juice-cyan border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Loading payment...</p>
        </div>
      </div>
    )
  }

  // Render error state
  if (step === 'error') {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className={`w-full max-w-sm text-center p-6 border ${isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'}`}>
          <div className={`w-16 h-16 mx-auto mb-4 flex items-center justify-center ${isDark ? 'bg-red-500/20' : 'bg-red-100'}`}>
            <svg className={`w-8 h-8 ${isDark ? 'text-red-400' : 'text-red-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Payment Error</h1>
          <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{error}</p>
          <Button variant="secondary" onClick={() => window.close()} className="w-full">
            Close
          </Button>
        </div>
      </div>
    )
  }

  // Render success state
  if (step === 'success' && session) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className={`w-full max-w-sm text-center p-6 border ${isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'}`}>
          <div className={`w-16 h-16 mx-auto mb-4 flex items-center justify-center bg-green-500`}>
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Payment Complete</h1>
          <p className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            ${session.amountUsd.toFixed(2)}
          </p>
          <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Paid to {session.merchantName}
          </p>
          <Button variant="primary" onClick={() => window.close()} className="w-full">
            Done
          </Button>
        </div>
      </div>
    )
  }

  // Render auth step
  if (step === 'auth') {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className={`w-full max-w-sm p-6 border ${isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'}`}>
          <h1 className={`text-lg font-semibold mb-4 text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Sign in to Pay
          </h1>

          {!codeSent ? (
            <div className="space-y-4">
              <div>
                <label className={`block text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={`w-full px-3 py-2 text-sm border ${
                    isDark
                      ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                      : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                  } focus:border-juice-cyan outline-none`}
                />
              </div>
              <Button
                variant="primary"
                onClick={handleRequestCode}
                loading={authLoading}
                disabled={!email}
                className="w-full"
              >
                Continue
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className={`text-sm text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Enter the code sent to {email}
              </p>
              <div>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className={`w-full px-3 py-2 text-center text-2xl font-mono tracking-widest border ${
                    isDark
                      ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                      : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                  } focus:border-juice-cyan outline-none`}
                />
              </div>
              <Button
                variant="primary"
                onClick={handleVerifyCode}
                loading={authLoading}
                disabled={code.length !== 6}
                className="w-full"
              >
                Verify
              </Button>
              <button
                onClick={() => { setCodeSent(false); setCode('') }}
                className={`w-full text-sm ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Use different email
              </button>
            </div>
          )}

          {error && (
            <div className={`mt-4 px-3 py-2 text-xs border ${isDark ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
              {error}
            </div>
          )}

          <div className={`mt-6 pt-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
            <button
              onClick={() => setStep('ready')}
              className={`w-full text-sm ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Render checkout step (Stripe)
  if (step === 'checkout' && stripePromise && clientSecret) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className={`w-full max-w-sm border ${isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'}`}>
          <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
            <h1 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Complete Payment
            </h1>
          </div>
          <div className="p-4">
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
        </div>
      </div>
    )
  }

  // Render paying state (processing)
  if (step === 'paying') {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className={`w-full max-w-sm text-center p-6 border ${isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'}`}>
          <div className="w-12 h-12 border-3 border-juice-cyan border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h1 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Processing Payment
          </h1>
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Please wait while we complete your payment...
          </p>
        </div>
      </div>
    )
  }

  // Render main payment UI
  return (
    <div className={`min-h-screen flex flex-col ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
      {/* Header */}
      <header className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="max-w-sm mx-auto flex items-center justify-between">
          <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            PayTerm
          </span>
          {timeLeft !== null && (
            <span className={`text-xs font-mono ${timeLeft < 60 ? 'text-red-400' : isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {formatTime(timeLeft)}
            </span>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-4">
        {session && (
          <div className={`w-full max-w-sm border ${isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'}`}>
            {/* Payment amount */}
            <div className="p-6 text-center">
              <p className={`text-sm mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Pay {session.merchantName}
              </p>
              <p className={`text-4xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                ${session.amountUsd.toFixed(2)}
              </p>
              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {getChainById(session.chainId, IS_TESTNET)?.name || 'Unknown'} &middot; Project #{session.projectId}
              </p>
            </div>

            {/* Payment options */}
            <div className={`p-4 space-y-3 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
              {/* Apple Pay / Google Pay button */}
              {stripePromise && (
                <Button
                  variant="primary"
                  onClick={handlePayWithApplePay}
                  loading={loading}
                  className="w-full py-3 bg-black hover:bg-gray-900 text-white"
                >
                  <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                  </svg>
                  Apple Pay
                </Button>
              )}

              {/* Pay with Juice Credits */}
              {isAuthenticated() && (
                <Button
                  variant="secondary"
                  onClick={handlePayWithJuice}
                  loading={loading}
                  className="w-full py-3"
                >
                  Pay with Credits
                </Button>
              )}

              {/* Sign in to pay */}
              {!isAuthenticated() && (
                <Button
                  variant="secondary"
                  onClick={() => setStep('auth')}
                  className="w-full py-3"
                >
                  Sign in to Pay
                </Button>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className={`flex-1 h-px ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
                <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>or</span>
                <div className={`flex-1 h-px ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
              </div>

              {/* Connect wallet */}
              {!showWalletOptions ? (
                <Button
                  variant="ghost"
                  onClick={handlePayWithWallet}
                  className="w-full py-3"
                >
                  {isConnected ? `Pay with ${walletAddress?.slice(0, 6)}...${walletAddress?.slice(-4)}` : 'Connect Wallet'}
                </Button>
              ) : (
                <div className="space-y-2">
                  {connectors.map((connector) => (
                    <Button
                      key={connector.uid}
                      variant="ghost"
                      onClick={() => handleConnectWallet(connector)}
                      loading={isConnecting}
                      className="w-full py-2 text-sm"
                    >
                      {connector.name}
                    </Button>
                  ))}
                  <button
                    onClick={() => setShowWalletOptions(false)}
                    className={`w-full text-xs py-2 ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Error message */}
            {error && (
              <div className={`mx-4 mb-4 px-3 py-2 text-xs border ${isDark ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
                {error}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className={`px-4 py-3 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        <p className="text-xs">
          Powered by <a href="https://juicebox.money" className="hover:underline">Juicebox</a>
        </p>
      </footer>
    </div>
  )
}
