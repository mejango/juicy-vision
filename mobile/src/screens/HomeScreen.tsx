/**
 * Home Screen
 *
 * Main screen showing NFC tap instructions and user status.
 * Handles NFC reading to detect payment sessions.
 */

import React, { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Platform,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager'

import { RootStackParamList } from '../../App'
import { useAuthStore } from '../stores/authStore'
import { api } from '../services/api'

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>

export default function HomeScreen() {
  const navigation = useNavigation<NavigationProp>()
  const { user, isAuthenticated, isLoading } = useAuthStore()
  const [nfcSupported, setNfcSupported] = useState<boolean | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [juiceBalance, setJuiceBalance] = useState<number | null>(null)

  // Pulse animation for NFC icon
  const pulseAnim = React.useRef(new Animated.Value(1)).current

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    )
    pulse.start()
    return () => pulse.stop()
  }, [pulseAnim])

  // Check NFC support
  useEffect(() => {
    const checkNfc = async () => {
      const supported = await NfcManager.isSupported()
      setNfcSupported(supported)
    }
    checkNfc()
  }, [])

  // Load Juice balance when authenticated
  useEffect(() => {
    if (isAuthenticated()) {
      api.setToken(useAuthStore.getState().token)
      api.getJuiceBalance().then((data) => {
        setJuiceBalance(data.balance)
      }).catch(() => {})
    }
  }, [isAuthenticated])

  // Start NFC scanning
  const startNfcScan = useCallback(async () => {
    if (!nfcSupported) return

    try {
      setIsScanning(true)
      await NfcManager.requestTechnology(NfcTech.Ndef)

      const tag = await NfcManager.getTag()
      if (tag?.ndefMessage) {
        const record = tag.ndefMessage[0]
        if (record) {
          const payload = Ndef.text.decodePayload(new Uint8Array(record.payload))
          // Check if it's a PayTerm URL
          const sessionMatch = payload.match(/\/s\/([a-f0-9-]+)/i)
          if (sessionMatch) {
            navigation.navigate('Payment', { sessionId: sessionMatch[1] })
          }
        }
      }
    } catch (err) {
      console.log('NFC scan error:', err)
    } finally {
      setIsScanning(false)
      NfcManager.cancelTechnologyRequest().catch(() => {})
    }
  }, [nfcSupported, navigation])

  // Auto-start NFC scanning on Android
  useEffect(() => {
    if (Platform.OS === 'android' && nfcSupported) {
      startNfcScan()
    }
  }, [nfcSupported, startNfcScan])

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>PayTerm</Text>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* User Status */}
      {isAuthenticated() && user ? (
        <View style={styles.userCard}>
          <Text style={styles.userEmail}>{user.email}</Text>
          {juiceBalance !== null && (
            <Text style={styles.juiceBalance}>
              ${juiceBalance.toFixed(2)} Juice
            </Text>
          )}
        </View>
      ) : (
        <TouchableOpacity
          style={styles.loginButton}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={styles.loginButtonText}>Sign in to pay with Juice</Text>
        </TouchableOpacity>
      )}

      {/* NFC Tap Area */}
      <View style={styles.nfcArea}>
        <Animated.View
          style={[
            styles.nfcIconContainer,
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          <Text style={styles.nfcIcon}>📱</Text>
        </Animated.View>

        <Text style={styles.tapInstruction}>
          {nfcSupported === false
            ? 'NFC not supported on this device'
            : isScanning
            ? 'Ready to scan...'
            : 'Tap your phone on a PayTerm'}
        </Text>

        <Text style={styles.tapSubtext}>
          Hold your phone near the terminal to pay
        </Text>

        {Platform.OS === 'ios' && nfcSupported && !isScanning && (
          <TouchableOpacity
            style={styles.scanButton}
            onPress={startNfcScan}
          >
            <Text style={styles.scanButtonText}>Scan NFC Tag</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Alternative */}
      <View style={styles.alternative}>
        <Text style={styles.alternativeText}>
          Or scan the QR code on the terminal
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    paddingTop: 60,
  },
  loadingText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  logo: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
  },
  settingsButton: {
    padding: 8,
  },
  settingsIcon: {
    fontSize: 24,
  },
  userCard: {
    backgroundColor: '#2a2a2a',
    marginHorizontal: 24,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  userEmail: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  juiceBalance: {
    color: '#22c55e',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 8,
  },
  loginButton: {
    backgroundColor: '#3b82f6',
    marginHorizontal: 24,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  nfcArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  nfcIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  nfcIcon: {
    fontSize: 48,
  },
  tapInstruction: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  tapSubtext: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  scanButton: {
    backgroundColor: '#3b82f6',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 24,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  alternative: {
    paddingBottom: 40,
    alignItems: 'center',
  },
  alternativeText: {
    color: '#666',
    fontSize: 14,
  },
})
