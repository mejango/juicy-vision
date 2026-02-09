/**
 * Stripe Service
 *
 * Handles Apple Pay / Google Pay through Stripe.
 */

import { Alert, Platform } from 'react-native'
import {
  initStripe,
  isPlatformPaySupported,
  confirmPlatformPayPayment,
  PlatformPayButton,
  PlatformPay,
} from '@stripe/stripe-react-native'

import { api } from './api'

let stripeInitialized = false

/**
 * Initialize Stripe SDK
 */
export async function initializeStripe(): Promise<boolean> {
  if (stripeInitialized) return true

  try {
    const { publishableKey } = await api.getStripeConfig()

    await initStripe({
      publishableKey,
      merchantIdentifier: 'merchant.app.juicyvision.payterm',
      urlScheme: 'payterm',
    })

    stripeInitialized = true
    return true
  } catch (err) {
    console.error('Failed to initialize Stripe:', err)
    return false
  }
}

/**
 * Check if Apple Pay / Google Pay is available
 */
export async function isPlatformPayAvailable(): Promise<boolean> {
  try {
    await initializeStripe()
    return await isPlatformPaySupported()
  } catch {
    return false
  }
}

/**
 * Pay with Apple Pay / Google Pay
 */
export async function payWithPlatformPay(params: {
  sessionId: string
  amountUsd: number
  merchantName: string
}): Promise<{ success: boolean; error?: string }> {
  const { sessionId, amountUsd, merchantName } = params

  try {
    await initializeStripe()

    // Create payment intent on backend
    const { clientSecret } = await api.createJuicePurchase(amountUsd)

    // Confirm with platform pay
    const { error } = await confirmPlatformPayPayment(clientSecret, {
      applePay: {
        cartItems: [
          {
            label: merchantName,
            amount: amountUsd.toFixed(2),
            paymentType: PlatformPay.PaymentType.Immediate,
          },
        ],
        merchantCountryCode: 'US',
        currencyCode: 'USD',
      },
      googlePay: {
        merchantName,
        merchantCountryCode: 'US',
        currencyCode: 'USD',
        testEnv: __DEV__,
      },
    })

    if (error) {
      return { success: false, error: error.message }
    }

    // Now pay with the Juice credits we just purchased
    await api.payWithJuice(sessionId)

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Payment failed' }
  }
}

export { PlatformPayButton }
