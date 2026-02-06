/**
 * Buy Pay Credits Modal - Stripe Checkout Integration
 *
 * Uses Stripe's Embedded Checkout (recommended approach) to let users
 * purchase Pay Credits with fiat currency.
 *
 * Flat rate: $1.01 per Pay Credit
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { loadStripe } from '@stripe/stripe-js'
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from '@stripe/react-stripe-js'
import { useTranslation } from 'react-i18next'
import { useThemeStore, useAuthStore } from '../../stores'

const API_BASE = import.meta.env.VITE_API_URL || ''
const PAY_CREDITS_RATE = 1.05 // Flat rate: $1.05 per Pay Credit

interface BuyJuiceModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  anchorRef?: React.RefObject<HTMLElement | null>
}

type PurchaseStep = 'amount' | 'checkout' | 'success' | 'error'

// Preset credit amounts for quick selection
const PRESET_AMOUNTS = [10, 25, 50, 100]

export default function BuyJuiceModal({ isOpen, onClose, onSuccess, anchorRef }: BuyJuiceModalProps) {
  const { theme } = useThemeStore()
  const { token } = useAuthStore()
  const { t } = useTranslation()
  const isDark = theme === 'dark'

  const [step, setStep] = useState<PurchaseStep>('amount')
  const [amount, setAmount] = useState<number>(25) // Credits amount
  const [customAmount, setCustomAmount] = useState<string>('')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // Calculate position relative to anchor element
  useEffect(() => {
    if (!isOpen || !anchorRef?.current) {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = anchorRef.current
      if (!anchor) return

      const rect = anchor.getBoundingClientRect()
      const modalWidth = 384 // max-w-sm = 24rem = 384px
      const modalHeight = 500 // approximate modal height
      const padding = 8

      // Position below the anchor, aligned to left edge
      let top = rect.bottom + padding
      let left = rect.left

      // Adjust if modal would go off the right edge
      if (left + modalWidth > window.innerWidth - padding) {
        left = window.innerWidth - modalWidth - padding
      }

      // Adjust if modal would go off the bottom edge
      if (top + modalHeight > window.innerHeight - padding) {
        // Position above the anchor instead
        top = rect.top - modalHeight - padding
        if (top < padding) {
          top = padding
        }
      }

      // Ensure left doesn't go negative
      if (left < padding) {
        left = padding
      }

      setPosition({ top, left })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [isOpen, anchorRef])

  // Fetch Stripe publishable key on mount
  useEffect(() => {
    if (!isOpen) return

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
  }, [isOpen])

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('amount')
      setAmount(25)
      setCustomAmount('')
      setClientSecret(null)
      setError(null)
    }
  }, [isOpen])

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

  if (!isOpen) return null

  // Use anchored positioning if position is available, otherwise center
  const useAnchoredPosition = position !== null

  const modalContent = (
    <div className={`fixed z-50 ${useAnchoredPosition ? '' : 'inset-0 flex items-center justify-center p-4'}`}>
      {/* Backdrop - transparent like other popovers */}
      <div
        className={useAnchoredPosition ? 'fixed inset-0' : 'absolute inset-0'}
        onClick={step !== 'checkout' ? onClose : undefined}
      />

      {/* Modal - matches app popover style */}
      <div
        ref={modalRef}
        style={useAnchoredPosition ? { position: 'fixed', top: position.top, left: position.left } : undefined}
        className={`relative w-full max-w-sm border shadow-xl ${
          isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'
        }`}
      >
        {/* Header */}
        <div className={`px-4 py-3 border-b flex items-center justify-between ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <h2 className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {step === 'amount' && t('wallet.buyPayCredits', 'Buy Pay Credits')}
            {step === 'checkout' && t('wallet.completePayment', 'Complete Payment')}
            {step === 'success' && t('wallet.purchaseComplete', 'Purchase Complete')}
            {step === 'error' && t('wallet.purchaseFailed', 'Purchase Failed')}
          </h2>
          <button
            onClick={onClose}
            className={`p-1 transition-colors ${
              isDark ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Amount Selection Step */}
          {step === 'amount' && (
            <div className="space-y-4">
              {/* Flat rate display */}
              <div className={`px-3 py-2 border ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
                <div className="flex justify-between items-center">
                  <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {t('wallet.rate', 'Rate')}
                  </span>
                  <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    $1.01 {t('wallet.perPayCredit', 'per Pay Credit')}
                  </span>
                </div>
              </div>

              {/* Preset credit amounts */}
              <div className="grid grid-cols-4 gap-2">
                {PRESET_AMOUNTS.map(preset => (
                  <button
                    key={preset}
                    onClick={() => handleAmountSelect(preset)}
                    className={`py-2 px-2 text-sm font-medium transition-all border ${
                      amount === preset && !customAmount
                        ? 'bg-green-500 text-black border-green-500'
                        : isDark
                          ? 'bg-transparent border-white/10 text-gray-300 hover:border-white/30'
                          : 'bg-transparent border-gray-200 text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              {/* Custom credit amount */}
              <div>
                <label className={`block text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('wallet.orEnterCustomAmount', 'Or enter custom amount')}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    step={1}
                    value={customAmount}
                    onChange={handleCustomAmountChange}
                    placeholder={t('wallet.credits', 'Credits')}
                    className={`w-full px-3 py-2 text-sm font-mono ${
                      isDark
                        ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                        : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                    } border focus:border-juice-orange outline-none`}
                  />
                </div>
                <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {t('wallet.creditsPerPurchase', '1 - 10,000 credits per purchase')}
                </p>
              </div>

              {/* Summary */}
              <div className={`px-3 py-2 border ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('wallet.youllReceive', "You'll receive")}</span>
                  <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {amount.toLocaleString()} {t('wallet.payCredits', 'Pay Credits')}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{t('wallet.totalCost', 'Total cost')}</span>
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
                  className={`px-4 py-2 text-sm font-medium transition-all ${
                    loading || !stripePromise || amount < 1
                      ? isDark ? 'bg-white/10 text-gray-500 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-green-500 text-black hover:bg-green-600'
                  }`}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      {t('wallet.loading', 'Loading...')}
                    </span>
                  ) : (
                    `${t('wallet.buy', 'Buy')} ${amount.toLocaleString()} ${t('wallet.credits', 'Credits')} - $${(amount * PAY_CREDITS_RATE).toFixed(2)}`
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Checkout Step */}
          {step === 'checkout' && stripePromise && clientSecret && (
            <div className="min-h-[350px]">
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
            <div className="text-center py-6 space-y-3">
              <div className={`w-12 h-12 mx-auto flex items-center justify-center ${isDark ? 'bg-green-500/20' : 'bg-green-100'}`}>
                <svg className={`w-6 h-6 ${isDark ? 'text-green-400' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {amount} {t('wallet.payCredits', 'Pay Credits')} {t('wallet.purchased', 'purchased')}
                </h3>
                <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('wallet.creditsAvailableAfterVerification', 'Credits available once payment is verified.')}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-2 text-sm font-bold bg-juice-orange text-black hover:bg-juice-orange/90 transition-all"
              >
                {t('wallet.done', 'Done')}
              </button>
            </div>
          )}

          {/* Error Step */}
          {step === 'error' && (
            <div className="text-center py-6 space-y-3">
              <div className={`w-12 h-12 mx-auto flex items-center justify-center ${isDark ? 'bg-red-500/20' : 'bg-red-100'}`}>
                <svg className={`w-6 h-6 ${isDark ? 'text-red-400' : 'text-red-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <h3 className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {t('wallet.paymentFailed', 'Payment Failed')}
                </h3>
                <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {error || t('wallet.paymentFailedDescription', 'Something went wrong. Please try again.')}
                </p>
              </div>
              <button
                onClick={() => setStep('amount')}
                className="w-full py-2 text-sm font-bold bg-juice-orange text-black hover:bg-juice-orange/90 transition-all"
              >
                {t('wallet.tryAgain', 'Try Again')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
