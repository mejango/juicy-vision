import { IS_TESTNET } from '../../config/environment'

// Build info injected by Vite at build time
declare const __BUILD_HASH__: string
declare const __BUILD_TIME__: string

const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev'

/**
 * Visual indicator displayed when running in testnet mode.
 * Helps prevent confusion between staging and production environments.
 * Shows git commit hash to verify which build is deployed.
 */
export function EnvironmentBadge() {
  if (!IS_TESTNET) return null

  return (
    <div className="fixed top-0 left-1/2 -translate-x-1/2 z-50 px-3 py-1 bg-yellow-500 text-yellow-950 text-xs font-bold rounded-b-md shadow-lg flex items-center gap-2">
      <span>TESTNET</span>
      <span className="opacity-60 font-mono text-[10px]">{BUILD_HASH}</span>
    </div>
  )
}
