/**
 * Detects whether juicy.vision is running as a Safe App (inside the
 * app.safe.global iframe) and, if so, exposes the connected Safe.
 *
 * A Safe App is already authorized simply by being opened inside Safe{Wallet},
 * so there's no manual connect step — detection on mount IS the connection.
 * The result is mirrored into a module-level singleton (setActiveSafeInfo) so
 * the plain, non-React guarded-tx runner and its shared UI can read the same
 * Safe context without prop drilling. Runs once, app-wide.
 */

import { useEffect, useState } from 'react'
import { detectSafeApp, setActiveSafeInfo, inIframe, type SafeInfo } from '../services/safeApp'

export interface UseSafeApp {
  /** True once a parent Safe has been detected. */
  isSafeApp: boolean
  /** The connected Safe (address + chain + owners), or null. */
  safeInfo: SafeInfo | null
  /** True until the initial detection settles (only meaningful when framed). */
  detecting: boolean
}

// Module-level so every useSafeApp() consumer shares one detection, and a
// component re-mount doesn't re-probe (the answer can't change mid-session).
let cached: SafeInfo | null = null
let probed = false

export function useSafeApp(): UseSafeApp {
  const [safeInfo, setSafeInfo] = useState<SafeInfo | null>(cached)
  const [detecting, setDetecting] = useState<boolean>(() => !probed && inIframe())

  useEffect(() => {
    if (probed) {
      setSafeInfo(cached)
      setDetecting(false)
      return
    }
    let cancelled = false
    detectSafeApp()
      .then(info => {
        probed = true
        cached = info
        setActiveSafeInfo(info)
        if (!cancelled) {
          setSafeInfo(info)
          setDetecting(false)
        }
      })
      .catch(() => {
        probed = true
        cached = null
        setActiveSafeInfo(null)
        if (!cancelled) {
          setSafeInfo(null)
          setDetecting(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { isSafeApp: safeInfo != null, safeInfo, detecting }
}
