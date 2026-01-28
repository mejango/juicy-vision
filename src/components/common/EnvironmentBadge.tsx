import { IS_TESTNET } from '../../config/environment'

/**
 * Visual indicator displayed when running in testnet mode.
 * Helps prevent confusion between staging and production environments.
 */
export function EnvironmentBadge() {
  if (!IS_TESTNET) return null

  return (
    <div className="fixed top-0 left-1/2 -translate-x-1/2 z-50 px-3 py-1 bg-yellow-500 text-yellow-950 text-xs font-bold rounded-b-md shadow-lg">
      TESTNET
    </div>
  )
}
