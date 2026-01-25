// Chain and contract constants
export * from './chains'

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

// =============================================================================
// Pagination Defaults
// =============================================================================
export const PAGINATION = {
  /** Default chat history page size */
  CHATS_PAGE_SIZE: 20,
  /** Default messages page size */
  MESSAGES_PAGE_SIZE: 50,
  /** Default project search results limit */
  PROJECTS_PAGE_SIZE: 20,
  /** Top projects display limit */
  TOP_PROJECTS_LIMIT: 10,
  /** Activity feed default page size */
  ACTIVITY_PAGE_SIZE: 15,
} as const

// =============================================================================
// API Endpoints (public - configure custom endpoints in settings)
// =============================================================================
export const BENDYSTRAW_ENDPOINT = 'https://api.bendystraw.xyz/graphql'
export const RELAYR_ENDPOINT = 'https://api.relayr.ba5ed.com'
export const ENS_RPC_ENDPOINT = 'https://rpc.ankr.com/eth'

// IPFS Gateways
export const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'
export const IPFS_FALLBACK_GATEWAY = 'https://ipfs.io/ipfs/'

// Legacy pagination exports (use PAGINATION object above)
// Kept for backwards compatibility
export const ACTIVITY_PAGE_SIZE = PAGINATION.ACTIVITY_PAGE_SIZE
export const ACTIVITY_POLL_INTERVAL = 30000 // 30 seconds

// Comprehensive chain configurations - use this instead of defining CHAIN_INFO in components
export const CHAINS: Record<number, {
  name: string        // Full name: "Ethereum", "Optimism"
  shortName: string   // Short display: "ETH", "OP"
  slug: string        // URL slug: "eth", "op"
  color: string       // Brand color
  explorer: string    // Block explorer base URL
  explorerTx: string  // Transaction URL prefix
}> = {
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

// All supported chain IDs as array (useful for iteration)
export const ALL_CHAIN_IDS = [1, 10, 8453, 42161] as const
export type SupportedChainIdType = typeof ALL_CHAIN_IDS[number]

// Explorer transaction URLs (convenience export derived from CHAINS)
export const EXPLORER_URLS: Record<number, string> = {
  1: CHAINS[1].explorerTx,
  10: CHAINS[10].explorerTx,
  8453: CHAINS[8453].explorerTx,
  42161: CHAINS[42161].explorerTx,
}

// Currency configurations
export const CURRENCIES = {
  ETH: { symbol: 'ETH', name: 'Ether', decimals: 18, baseCurrency: 1 },
  USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 6, baseCurrency: 2 },
} as const

// Native token address used by JB protocol
export const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

// Unlimited value threshold for fund access limits
export const UNLIMITED_THRESHOLD = BigInt('1000000000000000000000000000000')

// Check if a value represents "unlimited"
export function isUnlimitedValue(value: bigint): boolean {
  return value > UNLIMITED_THRESHOLD
}

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

// Theme colors (for reference, actual values in tailwind.config.js)
export const THEME_COLORS = {
  juiceOrange: '#F5A623',
  juiceCyan: '#00D4FF',
  juiceDark: '#1a1a1a',
  juiceDarkLighter: '#2a2a2a',
} as const
