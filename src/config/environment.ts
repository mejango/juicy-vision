/**
 * Environment configuration for staging vs production builds.
 *
 * This module determines whether the app is running in testnet (staging) mode
 * based on the VITE_TESTNET_MODE build-time variable.
 *
 * IMPORTANT: Environment is locked at build time, not runtime.
 * Use `npm run build:staging` for testnet builds.
 * Use `npm run build` for production builds.
 */

export const IS_TESTNET = import.meta.env.VITE_TESTNET_MODE === 'true'

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
  : 'https://api.bendystraw.xyz/graphql'

/**
 * Relayr App ID for the current environment.
 */
export const RELAYR_APP_ID = import.meta.env.VITE_RELAYR_APP_ID || (IS_TESTNET ? '43a6827c-3407-43c1-89c6-deeb8994696d' : 'juicy-vision')

/**
 * Relayr API Key from environment (required for authenticated API calls).
 */
export const RELAYR_API_KEY = import.meta.env.VITE_RELAYR_API_KEY || ''

/**
 * Environment label for display purposes.
 */
export const ENVIRONMENT_LABEL = IS_TESTNET ? 'Testnet' : 'Mainnet'
