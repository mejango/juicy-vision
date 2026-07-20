// Chain and contract constants
export * from './chains'

import { IS_TESTNET, SUPPORTED_CHAIN_IDS } from '../config/environment'

// =============================================================================
// WebSocket Configuration
// =============================================================================
export const WS_CONFIG = {
  /** Initial delay before first reconnection attempt (ms) */
  INITIAL_RETRY_DELAY: 1000,
  /** Maximum delay between reconnection attempts (ms) */
  MAX_RETRY_DELAY: 30000,
  /** Maximum number of reconnection attempts before giving up */
  MAX_RETRY_ATTEMPTS: 10,
  /** Maximum jitter to add to retry delay (ms) */
  RETRY_JITTER: 1000,
  /** HTTP polling interval when WebSocket is unavailable (ms) */
  POLLING_INTERVAL: 5000,
  /** Number of consecutive successful polls before attempting WS reconnect */
  POLLING_RECONNECT_THRESHOLD: 3,
} as const

// =============================================================================
// UI Timing Constants
// =============================================================================
export const UI_TIMING = {
  /** Duration to show "copied" feedback (ms) */
  COPY_FEEDBACK_DURATION: 2000,
  /** Duration to show payment success notification (ms) */
  PAYMENT_NOTIFICATION_DURATION: 5000,
  /** Delay before clearing dock active state (ms) */
  DOCK_CLEAR_DELAY: 300,
  /** Batch update interval for debouncing (ms) */
  BATCH_UPDATE_INTERVAL: 50,
} as const

// =============================================================================
// Scroll Thresholds
// =============================================================================
export const SCROLL_THRESHOLDS = {
  /** Distance from bottom to trigger auto-scroll (px) */
  AUTO_SCROLL: 150,
  /** Minimum scroll position to show "scroll to bottom" button (px) */
  SHOW_SCROLL_BUTTON: 50,
  /** Snap threshold for scroll animations (px) */
  SNAP_THRESHOLD: 5,
} as const

// IPFS Gateways
export const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'

// Activity feed pagination
export const ACTIVITY_PAGE_SIZE = 15
export const ACTIVITY_POLL_INTERVAL = 30000 // 30 seconds

// Chain config type
type ChainConfig = {
  name: string        // Full name: "Ethereum", "Optimism"
  shortName: string   // Short display: "ETH", "OP"
  slug: string        // URL slug: "eth", "op"
  color: string       // Brand color
  explorer: string    // Block explorer base URL
  explorerTx: string  // Transaction URL prefix
}

// Mainnet chain configurations - ALWAYS available, even in staging
// Used for displaying activity feed (which always shows mainnet data)
export const MAINNET_CHAINS: Record<number, ChainConfig> = {
  1: {
    name: 'Ethereum',
    shortName: 'ETH',
    slug: 'eth',
    color: '#627EEA',
    explorer: 'https://etherscan.io',
    explorerTx: 'https://etherscan.io/tx/',
  },
  10: {
    name: 'Optimism',
    shortName: 'OP',
    slug: 'op',
    color: '#FF0420',
    explorer: 'https://optimistic.etherscan.io',
    explorerTx: 'https://optimistic.etherscan.io/tx/',
  },
  8453: {
    name: 'Base',
    shortName: 'BASE',
    slug: 'base',
    color: '#0052FF',
    explorer: 'https://basescan.org',
    explorerTx: 'https://basescan.org/tx/',
  },
  42161: {
    name: 'Arbitrum',
    shortName: 'ARB',
    slug: 'arb',
    color: '#28A0F0',
    explorer: 'https://arbiscan.io',
    explorerTx: 'https://arbiscan.io/tx/',
  },
}

// Testnet chain configurations
const TESTNET_CHAINS: Record<number, ChainConfig> = {
  11155111: {
    name: 'Sepolia',
    shortName: 'SEP',
    slug: 'sep',
    color: '#627EEA',
    explorer: 'https://sepolia.etherscan.io',
    explorerTx: 'https://sepolia.etherscan.io/tx/',
  },
  11155420: {
    name: 'OP Sepolia',
    shortName: 'OP-SEP',
    slug: 'op-sep',
    color: '#FF0420',
    explorer: 'https://sepolia-optimism.etherscan.io',
    explorerTx: 'https://sepolia-optimism.etherscan.io/tx/',
  },
  84532: {
    name: 'Base Sepolia',
    shortName: 'BASE-SEP',
    slug: 'base-sep',
    color: '#0052FF',
    explorer: 'https://sepolia.basescan.org',
    explorerTx: 'https://sepolia.basescan.org/tx/',
  },
  421614: {
    name: 'Arb Sepolia',
    shortName: 'ARB-SEP',
    slug: 'arb-sep',
    color: '#28A0F0',
    explorer: 'https://sepolia.arbiscan.io',
    explorerTx: 'https://sepolia.arbiscan.io/tx/',
  },
}

// Comprehensive chain configurations - environment aware (testnet/mainnet)
// Use MAINNET_CHAINS directly when you need mainnet info regardless of environment
export const CHAINS: Record<number, ChainConfig> = IS_TESTNET ? TESTNET_CHAINS : MAINNET_CHAINS

// All supported chain IDs as array (environment-aware)
export const ALL_CHAIN_IDS = SUPPORTED_CHAIN_IDS

// Explorer transaction URLs (derived from environment-aware CHAINS)
export const EXPLORER_URLS: Record<number, string> = Object.fromEntries(
  ALL_CHAIN_IDS.map(chainId => [chainId, CHAINS[chainId].explorerTx])
)

// Native token address used by JB protocol
export const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

// Maximum uint224 value as a decimal string (used as the "unlimited" fund access amount)
export const UINT224_MAX = '26959946667150639794667015087019630673637144422540572481103610249215'

// LocalStorage keys
export const STORAGE_KEYS = {
  ENS_CACHE: 'juice-ens-cache',
  SETTINGS: 'juice-settings',
  CHAT: 'juice-chat',
  THEME: 'juice-theme',
  SESSION_ID: 'juice-session-id',
  WALLET_SESSION: 'juice-wallet-session',
  PASSKEY_WALLET: 'juice-passkey-wallet',
  PASSKEY_CREDENTIAL: 'juice-passkey-credential',
} as const

export type StorageKey = typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS]
