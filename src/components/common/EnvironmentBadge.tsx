import { useState, useEffect } from 'react'
import { IS_TESTNET } from '../../config/environment'

// Build info injected by Vite at build time
declare const __BUILD_HASH__: string
declare const __BUILD_TIME__: string

const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev'
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''

function getRelativeTime(isoTime: string): string {
  if (!isoTime) return ''
  const buildDate = new Date(isoTime)
  const now = new Date()
  const diffMs = now.getTime() - buildDate.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

/**
 * Visual indicator displayed when running in testnet mode.
 * Helps prevent confusion between staging and production environments.
 * Shows git commit hash to verify which build is deployed.
 */
export function EnvironmentBadge() {
  const [relativeTime, setRelativeTime] = useState(() => getRelativeTime(BUILD_TIME))

  // Update relative time every minute
  useEffect(() => {
    if (!BUILD_TIME) return
    const interval = setInterval(() => {
      setRelativeTime(getRelativeTime(BUILD_TIME))
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  if (!IS_TESTNET) return null

  return (
    <div className="fixed top-0 left-1/2 -translate-x-1/2 z-50 px-3 py-1 bg-yellow-500 text-yellow-950 text-xs font-bold rounded-b-md shadow-lg flex items-center gap-2">
      <span>TESTNET</span>
      <span className="opacity-60 font-mono text-[10px]">{BUILD_HASH}</span>
      {relativeTime && <span className="opacity-60 text-[10px]">{relativeTime}</span>}
    </div>
  )
}
