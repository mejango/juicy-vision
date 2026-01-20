// Chain and contract constants
export * from './chains'

// API Endpoints (public - configure custom endpoints in settings)
export const BENDYSTRAW_ENDPOINT = 'https://api.bendystraw.xyz/graphql'
export const RELAYR_ENDPOINT = 'https://api.relayr.ba5ed.com'
export const ENS_RPC_ENDPOINT = 'https://eth.llamarpc.com'

// IPFS Gateways
export const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'
export const IPFS_FALLBACK_GATEWAY = 'https://ipfs.io/ipfs/'

// Pagination
export const ACTIVITY_PAGE_SIZE = 15
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
} as const

// Theme colors (for reference, actual values in tailwind.config.js)
export const THEME_COLORS = {
  juiceOrange: '#F5A623',
  juiceCyan: '#00D4FF',
  juiceDark: '#1a1a1a',
  juiceDarkLighter: '#2a2a2a',
} as const
