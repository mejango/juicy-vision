/**
 * useNfc Hook
 *
 * Handles NFC scanning for payment URLs.
 */

import { useState, useEffect, useCallback } from 'react'
import { Platform, Alert } from 'react-native'
import NfcManager, { NfcTech, Ndef, NfcEvents } from 'react-native-nfc-manager'

interface UseNfcResult {
  isSupported: boolean | null
  isScanning: boolean
  startScan: () => Promise<string | null>
  stopScan: () => Promise<void>
}

export function useNfc(): UseNfcResult {
  const [isSupported, setIsSupported] = useState<boolean | null>(null)
  const [isScanning, setIsScanning] = useState(false)

  // Check NFC support on mount
  useEffect(() => {
    const checkSupport = async () => {
      try {
        const supported = await NfcManager.isSupported()
        setIsSupported(supported)

        if (supported) {
          await NfcManager.start()
        }
      } catch {
        setIsSupported(false)
      }
    }

    checkSupport()

    return () => {
      NfcManager.cancelTechnologyRequest().catch(() => {})
    }
  }, [])

  // Parse NDEF message to extract URL
  const parseNdefMessage = useCallback((tag: any): string | null => {
    if (!tag?.ndefMessage?.length) return null

    for (const record of tag.ndefMessage) {
      try {
        // URI record type
        if (record.tnf === 1 && record.type?.[0] === 0x55) {
          const payload = record.payload
          if (payload?.length > 1) {
            // First byte is URI prefix code
            const prefixCode = payload[0]
            const prefixes: Record<number, string> = {
              0x00: '',
              0x01: 'http://www.',
              0x02: 'https://www.',
              0x03: 'http://',
              0x04: 'https://',
            }
            const prefix = prefixes[prefixCode] || ''
            const uri = prefix + String.fromCharCode(...payload.slice(1))
            return uri
          }
        }

        // Text record - might contain URL
        if (record.tnf === 1 && record.type?.[0] === 0x54) {
          const decoded = Ndef.text.decodePayload(new Uint8Array(record.payload))
          if (decoded.includes('pay.juicyvision.app') || decoded.includes('payterm://')) {
            return decoded
          }
        }
      } catch {
        continue
      }
    }

    return null
  }, [])

  // Extract session ID from URL
  const extractSessionId = useCallback((url: string): string | null => {
    const match = url.match(/\/s\/([a-f0-9-]+)/i)
    return match ? match[1] : null
  }, [])

  // Start NFC scan
  const startScan = useCallback(async (): Promise<string | null> => {
    if (!isSupported) {
      Alert.alert('NFC Not Supported', 'This device does not support NFC.')
      return null
    }

    try {
      setIsScanning(true)

      // On iOS, we need to request the technology
      // On Android, we can listen for tags in the background
      await NfcManager.requestTechnology(NfcTech.Ndef)

      const tag = await NfcManager.getTag()
      const url = parseNdefMessage(tag)

      if (url) {
        const sessionId = extractSessionId(url)
        return sessionId
      }

      return null
    } catch (err: any) {
      // User cancelled or timeout
      if (err.message !== 'cancelled') {
        console.log('NFC scan error:', err)
      }
      return null
    } finally {
      setIsScanning(false)
      await NfcManager.cancelTechnologyRequest().catch(() => {})
    }
  }, [isSupported, parseNdefMessage, extractSessionId])

  // Stop NFC scan
  const stopScan = useCallback(async () => {
    setIsScanning(false)
    await NfcManager.cancelTechnologyRequest().catch(() => {})
  }, [])

  return {
    isSupported,
    isScanning,
    startScan,
    stopScan,
  }
}

/**
 * Listen for NFC tags in foreground (Android)
 */
export function useNfcForeground(onSessionId: (sessionId: string) => void) {
  useEffect(() => {
    if (Platform.OS !== 'android') return

    const handleDiscoveredTag = (tag: any) => {
      if (!tag?.ndefMessage?.length) return

      for (const record of tag.ndefMessage) {
        try {
          if (record.tnf === 1 && record.type?.[0] === 0x55) {
            const payload = record.payload
            if (payload?.length > 1) {
              const prefixCode = payload[0]
              const prefixes: Record<number, string> = {
                0x04: 'https://',
              }
              const prefix = prefixes[prefixCode] || ''
              const uri = prefix + String.fromCharCode(...payload.slice(1))

              const match = uri.match(/\/s\/([a-f0-9-]+)/i)
              if (match) {
                onSessionId(match[1])
                return
              }
            }
          }
        } catch {}
      }
    }

    NfcManager.setEventListener(NfcEvents.DiscoverTag, handleDiscoveredTag)
    NfcManager.registerTagEvent().catch(() => {})

    return () => {
      NfcManager.unregisterTagEvent().catch(() => {})
      NfcManager.setEventListener(NfcEvents.DiscoverTag, null)
    }
  }, [onSessionId])
}
