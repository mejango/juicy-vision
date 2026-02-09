/**
 * Payment Screen
 *
 * Shows payment details and handles Juice or Apple Pay payments.
 * Navigated to from NFC tap or deep link.
 */

import React, { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native'
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { RootStackParamList } from '../../App'
import { useAuthStore } from '../stores/authStore'
import { api, PaymentSession } from '../services/api'
import { isPlatformPayAvailable, payWithPlatformPay } from '../services/stripe'

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Payment'>
type RouteType = RouteProp<RootStackParamList, 'Payment'>

export default function PaymentScreen() {
  const navigation = useNavigation<NavigationProp>()
  const route = useRoute<RouteType>()
  const { sessionId } = route.params

  const { isAuthenticated, token } = useAuthStore()

  const [session, setSession] = useState<PaymentSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [juiceBalance, setJuiceBalance] = useState<number | null>(null)
  const [platformPayAvailable, setPlatformPayAvailable] = useState(false)

  // Load session details
  useEffect(() => {
    const loadSession = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await api.getSession(sessionId)
        setSession(data)

        if (data.status !== 'pending') {
          setError(`Session is ${data.status}`)
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load payment')
      } finally {
        setLoading(false)
      }
    }

    loadSession()
  }, [sessionId])

  // Load Juice balance if authenticated
  useEffect(() => {
    if (isAuthenticated() && token) {
      api.setToken(token)
      api.getJuiceBalance().then((data) => {
        setJuiceBalance(data.balance)
      }).catch(() => {})
    }
  }, [isAuthenticated, token])

  // Check platform pay availability
  useEffect(() => {
    isPlatformPayAvailable().then(setPlatformPayAvailable).catch(() => {})
  }, [])

  // WebSocket for real-time session status updates
  useEffect(() => {
    if (!session || !['pending', 'paying'].includes(session.status)) return

    const wsUrl = `wss://api.juicyvision.app/terminal/session/${sessionId}/ws?role=consumer`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)

        if (message.type === 'payment_completed') {
          navigation.replace('Success', {
            amountUsd: session.amountUsd,
            projectName: session.merchantName,
          })
        } else if (message.type === 'payment_failed') {
          setError(message.data?.error || 'Payment failed')
        } else if (message.type === 'session_expired') {
          setError('This payment session has expired')
        } else if (message.type === 'session_cancelled') {
          setError('This payment was cancelled')
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.onerror = () => {
      console.log('WebSocket error, falling back to polling')
    }

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    }
  }, [session, sessionId, navigation])

  // Fallback polling for session status (in case WebSocket fails)
  useEffect(() => {
    if (!session || session.status !== 'pending') return

    const interval = setInterval(async () => {
      try {
        const status = await api.getSessionStatus(sessionId)
        if (status.status !== 'pending') {
          setSession((prev) => prev ? { ...prev, status: status.status as any } : null)

          if (status.status === 'completed') {
            navigation.replace('Success', {
              amountUsd: session.amountUsd,
              projectName: session.merchantName,
            })
          }
        }
      } catch {}
    }, 5000) // Slower polling as backup

    return () => clearInterval(interval)
  }, [session, sessionId, navigation])

  // Pay with Juice Credits
  const handlePayWithJuice = useCallback(async () => {
    if (!session) return

    if (!isAuthenticated()) {
      Alert.alert(
        'Sign In Required',
        'Please sign in to pay with Juice Credits',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign In', onPress: () => navigation.navigate('Settings') },
        ]
      )
      return
    }

    if (juiceBalance !== null && juiceBalance < session.amountUsd) {
      Alert.alert(
        'Insufficient Balance',
        `You need $${session.amountUsd.toFixed(2)} but only have $${juiceBalance.toFixed(2)} Juice.`,
        [{ text: 'OK' }]
      )
      return
    }

    try {
      setPaying(true)
      const result = await api.payWithJuice(sessionId)

      if (result.status === 'completed') {
        navigation.replace('Success', {
          amountUsd: session.amountUsd,
          projectName: session.merchantName,
        })
      }
    } catch (err: any) {
      Alert.alert('Payment Failed', err.message || 'Something went wrong')
    } finally {
      setPaying(false)
    }
  }, [session, sessionId, isAuthenticated, juiceBalance, navigation])

  // Handle Apple Pay / Google Pay
  const handlePlatformPay = useCallback(async () => {
    if (!session) return

    if (!platformPayAvailable) {
      Alert.alert(
        'Not Available',
        Platform.OS === 'ios'
          ? 'Apple Pay is not set up on this device.'
          : 'Google Pay is not set up on this device.',
        [{ text: 'OK' }]
      )
      return
    }

    try {
      setPaying(true)
      const result = await payWithPlatformPay({
        sessionId,
        amountUsd: session.amountUsd,
        merchantName: session.merchantName,
      })

      if (result.success) {
        navigation.replace('Success', {
          amountUsd: session.amountUsd,
          projectName: session.merchantName,
        })
      } else {
        Alert.alert('Payment Failed', result.error || 'Something went wrong')
      }
    } catch (err: any) {
      Alert.alert('Payment Failed', err.message || 'Something went wrong')
    } finally {
      setPaying(false)
    }
  }, [session, sessionId, platformPayAvailable, navigation])

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Loading payment...</Text>
      </View>
    )
  }

  if (error || !session) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>{error || 'Payment not found'}</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const canPayWithJuice = isAuthenticated() && juiceBalance !== null && juiceBalance >= session.amountUsd

  return (
    <View style={styles.container}>
      {/* Merchant Info */}
      <View style={styles.merchantCard}>
        <Text style={styles.merchantName}>{session.merchantName}</Text>
        <Text style={styles.amount}>${session.amountUsd.toFixed(2)}</Text>
        <Text style={styles.tokenInfo}>
          You'll receive project tokens
        </Text>
      </View>

      {/* Payment Methods */}
      <View style={styles.paymentMethods}>
        {/* Juice Credits */}
        <TouchableOpacity
          style={[
            styles.payButton,
            styles.juiceButton,
            (!canPayWithJuice || paying) && styles.payButtonDisabled,
          ]}
          onPress={handlePayWithJuice}
          disabled={paying}
        >
          {paying ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.payButtonText}>
                Pay with Juice
              </Text>
              {juiceBalance !== null && (
                <Text style={styles.balanceText}>
                  Balance: ${juiceBalance.toFixed(2)}
                </Text>
              )}
            </>
          )}
        </TouchableOpacity>

        {/* Apple Pay / Google Pay */}
        {platformPayAvailable && (
          <TouchableOpacity
            style={[styles.payButton, styles.applePayButton, paying && styles.payButtonDisabled]}
            onPress={handlePlatformPay}
            disabled={paying}
          >
            <Text style={styles.applePayText}>
              {Platform.OS === 'ios' ? ' Pay' : 'Google Pay'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Not signed in message */}
        {!isAuthenticated() && (
          <TouchableOpacity
            style={styles.signInPrompt}
            onPress={() => navigation.navigate('Settings')}
          >
            <Text style={styles.signInPromptText}>
              Sign in to pay with Juice Credits
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Session expiry */}
      <View style={styles.footer}>
        <Text style={styles.expiryText}>
          Session expires at {new Date(session.expiresAt).toLocaleTimeString()}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#888',
    fontSize: 16,
    marginTop: 16,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: '#333',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  merchantCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    marginBottom: 32,
  },
  merchantName: {
    color: '#888',
    fontSize: 16,
    marginBottom: 8,
  },
  amount: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '700',
    marginBottom: 8,
  },
  tokenInfo: {
    color: '#22c55e',
    fontSize: 14,
  },
  paymentMethods: {
    width: '100%',
    gap: 16,
  },
  payButton: {
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  payButtonDisabled: {
    opacity: 0.5,
  },
  juiceButton: {
    backgroundColor: '#22c55e',
  },
  payButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  balanceText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: 4,
  },
  applePayButton: {
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#333',
  },
  applePayText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  signInPrompt: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  signInPromptText: {
    color: '#3b82f6',
    fontSize: 14,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
  },
  expiryText: {
    color: '#666',
    fontSize: 12,
  },
})
