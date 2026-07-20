/**
 * Shared Stripe Embedded Checkout logic for buying Pay Credits.
 *
 * Consolidates the state machine, stripe-config fetch, and checkout-session
 * creation previously duplicated between BuyJuiceModal and WalletPanel's
 * BuyJuiceView. Presentation stays with the call sites.
 */

import { useState, useEffect, useCallback } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { useAuthStore } from '../../stores'

const API_BASE = import.meta.env.VITE_API_URL || ''

// Flat rate: $1.05 per Pay Credit
export const PAY_CREDITS_RATE = 1.05

// Preset credit amounts for quick selection
export const PRESET_AMOUNTS = [10, 25, 50, 100]

export type PurchaseStep = 'amount' | 'checkout' | 'success'

interface UseStripeCheckoutOptions {
  /** Gate the stripe-config fetch (e.g. on modal open). Defaults to true. */
  enabled?: boolean
  /** Called when the embedded checkout completes. */
  onSuccess?: () => void
}

export function useStripeCheckout({ enabled = true, onSuccess }: UseStripeCheckoutOptions = {}) {
  const { token } = useAuthStore()

  const [step, setStep] = useState<PurchaseStep>('amount')
  const [amount, setAmount] = useState<number>(25) // Credits amount
  const [customAmount, setCustomAmount] = useState<string>('')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Fetch Stripe publishable key on mount (re-runs when enabled flips true)
  useEffect(() => {
    if (!enabled) return

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
  }, [enabled])

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

  // Reset to the initial amount-selection state (e.g. when a modal reopens)
  const reset = useCallback(() => {
    setStep('amount')
    setAmount(25)
    setCustomAmount('')
    setClientSecret(null)
    setError(null)
  }, [])

  return {
    step,
    setStep,
    amount,
    customAmount,
    clientSecret,
    stripePromise,
    error,
    loading,
    handleAmountSelect,
    handleCustomAmountChange,
    startCheckout,
    handleCheckoutComplete,
    reset,
  }
}
