/**
 * PayTerm Terminal Application
 *
 * Main application for the Raspberry Pi payment terminal.
 * Screens: Setup → Amount Entry → Waiting (QR/NFC) → Result
 */

import { useState, useEffect, useCallback } from 'react'
import SetupScreen from './screens/Setup'
import AmountScreen from './screens/Amount'
import WaitingScreen from './screens/Waiting'
import ResultScreen from './screens/Result'

// Types
interface Settings {
  apiKey: string | null
  apiUrl: string
  deviceName: string
}

interface PaymentSession {
  id: string
  amountUsd: number
  status: 'pending' | 'paying' | 'completed' | 'failed' | 'expired'
  paymentUrl: string
}

type Screen = 'setup' | 'amount' | 'waiting' | 'result'

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && (window as any).electronAPI?.isElectron

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [session, setSession] = useState<PaymentSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(true)

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [])

  // Load settings from Electron store or localStorage
  const loadSettings = async () => {
    try {
      if (isElectron) {
        const s = await (window as any).electronAPI.getSettings()
        setSettings(s)
        if (s.apiKey) {
          setScreen('amount')
        }
      } else {
        // Browser fallback
        const saved = localStorage.getItem('payterm-settings')
        if (saved) {
          const s = JSON.parse(saved)
          setSettings(s)
          if (s.apiKey) {
            setScreen('amount')
          }
        } else {
          setSettings({
            apiKey: null,
            apiUrl: 'https://api.juicyvision.app',
            deviceName: 'PayTerm Device',
          })
        }
      }
    } catch (err) {
      console.error('Failed to load settings:', err)
      setSettings({
        apiKey: null,
        apiUrl: 'https://api.juicyvision.app',
        deviceName: 'PayTerm Device',
      })
    }
  }

  // Save settings
  const saveSettings = async (newSettings: Partial<Settings>) => {
    const updated = { ...settings, ...newSettings } as Settings
    setSettings(updated)

    try {
      if (isElectron) {
        await (window as any).electronAPI.saveSettings(newSettings)
      } else {
        localStorage.setItem('payterm-settings', JSON.stringify(updated))
      }
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }

  // Create payment session
  const createSession = useCallback(async (amountUsd: number) => {
    if (!settings?.apiKey) {
      setError('API key not configured')
      return
    }

    try {
      const res = await fetch(`${settings.apiUrl}/terminal/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Terminal-Key': settings.apiKey,
        },
        body: JSON.stringify({ amountUsd }),
      })

      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to create session')
      }

      setSession({
        id: data.data.session.id,
        amountUsd: data.data.session.amountUsd,
        status: 'pending',
        paymentUrl: data.data.paymentUrl,
      })
      setScreen('waiting')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    }
  }, [settings])

  // WebSocket for real-time session status updates
  useEffect(() => {
    if (screen !== 'waiting' || !session || !settings) return

    const wsUrl = settings.apiUrl.replace(/^http/, 'ws') + `/terminal/session/${session.id}/ws?role=terminal`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)

        if (message.type === 'session_claimed') {
          // Consumer has opened the payment page
          console.log('Session claimed by consumer')
        } else if (message.type === 'payment_started') {
          setSession(prev => prev ? { ...prev, status: 'paying' } : null)
        } else if (message.type === 'payment_completed') {
          setSession(prev => prev ? { ...prev, status: 'completed' } : null)
          setScreen('result')
        } else if (message.type === 'payment_failed') {
          setSession(prev => prev ? { ...prev, status: 'failed' } : null)
          setScreen('result')
        } else if (message.type === 'session_expired') {
          setSession(prev => prev ? { ...prev, status: 'expired' } : null)
          setScreen('result')
        } else if (message.type === 'session_cancelled') {
          setSession(null)
          setScreen('amount')
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.onerror = () => {
      console.log('WebSocket error, falling back to polling')
    }

    // Ping to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)

    return () => {
      clearInterval(pingInterval)
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    }
  }, [screen, session, settings])

  // Fallback polling for session status (in case WebSocket fails)
  useEffect(() => {
    if (screen !== 'waiting' || !session || !settings) return

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${settings.apiUrl}/terminal/session/${session.id}/status`, {
          headers: { 'X-Terminal-Key': settings.apiKey! },
        })

        const data = await res.json()

        if (data.success) {
          if (data.data.status === 'completed') {
            setSession(prev => prev ? { ...prev, status: 'completed' } : null)
            setScreen('result')
          } else if (data.data.status === 'failed') {
            setSession(prev => prev ? { ...prev, status: 'failed' } : null)
            setScreen('result')
          } else if (data.data.status === 'expired') {
            setSession(prev => prev ? { ...prev, status: 'expired' } : null)
            setScreen('result')
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 5000) // Slower polling as backup

    return () => clearInterval(poll)
  }, [screen, session, settings])

  // Cancel current session
  const cancelSession = useCallback(async () => {
    if (session && settings?.apiKey) {
      try {
        await fetch(`${settings.apiUrl}/terminal/session/${session.id}`, {
          method: 'DELETE',
          headers: { 'X-Terminal-Key': settings.apiKey },
        })
      } catch {
        // Ignore
      }
    }
    setSession(null)
    setScreen('amount')
  }, [session, settings])

  // Reset for new payment
  const resetForNewPayment = () => {
    setSession(null)
    setError(null)
    setScreen('amount')
  }

  // Check online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Render current screen
  return (
    <div className="h-screen w-screen bg-juice-dark flex flex-col overflow-hidden">
      {/* Status bar */}
      <header className="px-4 py-2 flex items-center justify-between border-b border-white/10">
        <span className="text-xs text-gray-500">PayTerm</span>
        <div className="flex items-center gap-2">
          <div className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
          <span className="text-xs text-gray-400">
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {screen === 'setup' && (
          <SetupScreen
            settings={settings}
            onSave={(s) => {
              saveSettings(s)
              if (s.apiKey) setScreen('amount')
            }}
          />
        )}

        {screen === 'amount' && (
          <AmountScreen
            onSubmit={createSession}
            onSettings={() => setScreen('setup')}
            error={error}
            onClearError={() => setError(null)}
          />
        )}

        {screen === 'waiting' && session && (
          <WaitingScreen
            session={session}
            onCancel={cancelSession}
          />
        )}

        {screen === 'result' && session && (
          <ResultScreen
            session={session}
            onNewPayment={resetForNewPayment}
          />
        )}
      </main>
    </div>
  )
}
