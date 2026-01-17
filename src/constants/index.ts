// API Endpoints
export const BENDYSTRAW_ENDPOINT = 'https://bendystraw.xyz/3ZNJpGtazh5fwYoSW59GWDEj/graphql'
export const RELAYR_ENDPOINT = 'https://api.relayr.ba5ed.com'
export const ENS_RPC_ENDPOINT = 'https://eth.llamarpc.com'

// IPFS Gateways
export const IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'
export const IPFS_FALLBACK_GATEWAY = 'https://ipfs.io/ipfs/'

// Pagination
export const ACTIVITY_PAGE_SIZE = 15
export const ACTIVITY_POLL_INTERVAL = 30000 // 30 seconds

// Chain configurations
export const CHAINS: Record<number, { name: string; color: string; explorer: string }> = {
  1: { name: 'ETH', color: '#627EEA', explorer: 'https://etherscan.io' },
  10: { name: 'OP', color: '#FF0420', explorer: 'https://optimistic.etherscan.io' },
  8453: { name: 'BASE', color: '#0052FF', explorer: 'https://basescan.org' },
  42161: { name: 'ARB', color: '#28A0F0', explorer: 'https://arbiscan.io' },
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
