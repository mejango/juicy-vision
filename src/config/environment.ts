/**
 * Network-mode configuration. Every deployment serves BOTH mainnets and
 * testnets: the user's choice lives in localStorage ('jb-network', shared
 * with the website's Discover toggle semantics) and is read ONCE at module
 * init — switching modes writes the key and reloads, so every downstream
 * constant stays a plain const for the lifetime of the page.
 *
 * VITE_TESTNET_MODE only sets the DEFAULT when the user hasn't chosen yet
 * (keeps staging defaulting to testnets until toggled).
 */

const NETWORK_STORAGE_KEY = 'jb-network'

/**
 * Runtime marker installed by the maintained Playwright fixture before any
 * application module executes. Production builds do not set it. Keeping this
 * runtime-scoped lets CI exercise the exact deployable bundle while replacing
 * only third-party startup integrations with deterministic local adapters.
 */
export const IS_LOCAL_ONLY_BROWSER_TEST =
  typeof window !== 'undefined' &&
  (window as typeof window & { __JUICY_LOCAL_ONLY_TEST__?: boolean })
    .__JUICY_LOCAL_ONLY_TEST__ === true

function resolveTestnetMode(): boolean {
  try {
    const stored = localStorage.getItem(NETWORK_STORAGE_KEY)
    if (stored === 'testnet') return true
    if (stored === 'mainnet') return false
  } catch { /* SSR/tests fall through to the env default */ }
  return import.meta.env.VITE_TESTNET_MODE === 'true'
}

export const IS_TESTNET = resolveTestnetMode()

/** Persist the chosen mode and reload so all module-init constants re-resolve. */
export function setNetworkMode(mode: 'mainnet' | 'testnet'): void {
  try { localStorage.setItem(NETWORK_STORAGE_KEY, mode) } catch { /* ignore */ }
  window.location.reload()
}

/**
 * Chain IDs for supported networks.
 * Mainnet chain IDs map to their Sepolia testnet equivalents when IS_TESTNET is true.
 */
export const CHAIN_IDS = IS_TESTNET
  ? {
      ethereum: 11155111,  // Sepolia
      optimism: 11155420,  // Optimism Sepolia
      base: 84532,         // Base Sepolia
      arbitrum: 421614,    // Arbitrum Sepolia
    }
  : {
      ethereum: 1,
      optimism: 10,
      base: 8453,
      arbitrum: 42161,
    }

/**
 * Array of all supported chain IDs for the current environment.
 */
export const SUPPORTED_CHAIN_IDS = Object.values(CHAIN_IDS)

/**
 * Default Relayr endpoint based on environment.
 * Staging uses the Relayr staging API.
 */
export const DEFAULT_RELAYR_ENDPOINT = IS_TESTNET
  ? 'https://relayr-api-staging.up.railway.app'
  : 'https://api.relayr.ba5ed.com'

/**
 * Default Bendystraw endpoint based on environment.
 * Staging uses the testnet Bendystraw API.
 */
export const DEFAULT_BENDYSTRAW_ENDPOINT = IS_TESTNET
  ? 'https://testnet.bendystraw.xyz/graphql'
  : 'https://bendystraw.xyz/graphql'

/**
 * Relayr App ID for the current environment.
 */
export const RELAYR_APP_ID = import.meta.env.VITE_RELAYR_APP_ID || (IS_TESTNET ? '43a6827c-3407-43c1-89c6-deeb8994696d' : 'juicy-vision')
