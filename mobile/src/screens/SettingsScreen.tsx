/**
 * Settings Screen
 *
 * User authentication and app settings.
 */

import React, { useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'

import { useAuthStore } from '../stores/authStore'
import { api } from '../services/api'

export default function SettingsScreen() {
  const navigation = useNavigation()
  const { user, isAuthenticated, login, logout } = useAuthStore()

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [loading, setLoading] = useState(false)

  // Request email code
  const handleRequestCode = useCallback(async () => {
    if (!email.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address')
      return
    }

    try {
      setLoading(true)
      await api.requestCode(email)
      setStep('code')
      Alert.alert('Code Sent', `We sent a verification code to ${email}`)
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send code')
    } finally {
      setLoading(false)
    }
  }, [email])

  // Verify code and login
  const handleVerifyCode = useCallback(async () => {
    if (code.length < 6) {
      Alert.alert('Invalid Code', 'Please enter the 6-digit code')
      return
    }

    try {
      setLoading(true)
      await login(email, code)
      api.setToken(useAuthStore.getState().token)
      Alert.alert('Success', 'You are now signed in')
      setEmail('')
      setCode('')
      setStep('email')
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Invalid code')
    } finally {
      setLoading(false)
    }
  }, [email, code, login])

  // Logout
  const handleLogout = useCallback(() => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: () => {
            logout()
            api.setToken(null)
          },
        },
      ]
    )
  }, [logout])

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* User Section */}
        {isAuthenticated() && user ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account</Text>
            <View style={styles.card}>
              <Text style={styles.userEmail}>{user.email}</Text>
              <TouchableOpacity
                style={styles.logoutButton}
                onPress={handleLogout}
              >
                <Text style={styles.logoutButtonText}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sign In</Text>
            <View style={styles.card}>
              {step === 'email' ? (
                <>
                  <Text style={styles.inputLabel}>Email</Text>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor="#666"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!loading}
                  />
                  <TouchableOpacity
                    style={[styles.button, loading && styles.buttonDisabled]}
                    onPress={handleRequestCode}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>Send Code</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.inputLabel}>
                    Verification Code
                  </Text>
                  <Text style={styles.helperText}>
                    Sent to {email}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={code}
                    onChangeText={setCode}
                    placeholder="000000"
                    placeholderTextColor="#666"
                    keyboardType="number-pad"
                    maxLength={6}
                    editable={!loading}
                  />
                  <TouchableOpacity
                    style={[styles.button, loading && styles.buttonDisabled]}
                    onPress={handleVerifyCode}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.buttonText}>Verify</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.backLink}
                    onPress={() => {
                      setStep('email')
                      setCode('')
                    }}
                    disabled={loading}
                  >
                    <Text style={styles.backLinkText}>Use different email</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <View style={styles.card}>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Version</Text>
              <Text style={styles.aboutValue}>1.0.0</Text>
            </View>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Built with</Text>
              <Text style={styles.aboutValue}>Juicebox</Text>
            </View>
          </View>
        </View>

        {/* Juice Credits Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What are Juice Credits?</Text>
          <View style={styles.card}>
            <Text style={styles.infoText}>
              Juice Credits let you pay instantly at any PayTerm. Buy credits with
              Apple Pay or Google Pay, then tap to pay anywhere. Your credits are
              converted to project tokens when you pay.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 48,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
  },
  userEmail: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '500',
    marginBottom: 16,
  },
  logoutButton: {
    backgroundColor: '#ef4444',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  inputLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  helperText: {
    color: '#888',
    fontSize: 14,
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#3b82f6',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  backLinkText: {
    color: '#3b82f6',
    fontSize: 14,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  aboutLabel: {
    color: '#888',
    fontSize: 16,
  },
  aboutValue: {
    color: '#fff',
    fontSize: 16,
  },
  infoText: {
    color: '#aaa',
    fontSize: 14,
    lineHeight: 22,
  },
})
