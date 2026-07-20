// Shared utilities for technical details display in transaction modals
import { IS_TESTNET, CHAIN_IDS } from '../config/environment'
import {
  CANONICAL_USDC_BY_CHAIN,
  CONTRACTS,
  MAINNET_CHAINS as SHARED_MAINNET_CHAINS,
  TESTNET_CHAINS as SHARED_TESTNET_CHAINS,
} from '../../shared/chains'

// Chain name mapping (environment-aware)
export const CHAIN_NAMES: Record<string, string> = IS_TESTNET
  ? {
      [String(CHAIN_IDS.ethereum)]: 'SEP',
      [String(CHAIN_IDS.optimism)]: 'OPSEP',
      [String(CHAIN_IDS.base)]: 'BASESEP',
      [String(CHAIN_IDS.arbitrum)]: 'ARBSEP',
    }
  : {
      [String(CHAIN_IDS.ethereum)]: 'Ethereum',
      [String(CHAIN_IDS.optimism)]: 'Optimism',
      [String(CHAIN_IDS.base)]: 'Base',
      [String(CHAIN_IDS.arbitrum)]: 'Arbitrum',
    }

export const CHAIN_COLORS: Record<string, string> = {
  [String(CHAIN_IDS.ethereum)]: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  [String(CHAIN_IDS.optimism)]: 'bg-red-500/20 text-red-300 border-red-500/30',
  [String(CHAIN_IDS.base)]: 'bg-blue-400/20 text-blue-200 border-blue-400/30',
  [String(CHAIN_IDS.arbitrum)]: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
}

// Known JB ecosystem addresses (Juicebox V6 - same address on all chains),
// derived from the shared canonical contract table plus labels for entries
// the shared table doesn't carry (sucker deployers, native token, zero).
const JB_ADDRESSES: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(CONTRACTS).map(([name, address]) => [address.toLowerCase(), name]),
  ),
  // Native-bridge sucker deployers
  '0x298a775c030adcedb641a89d9047ec9972674e1a': 'JBOptimismSuckerDeployer',
  '0x54140331902de5c3445eb0c26e15099a5a9d59e6': 'JBBaseSuckerDeployer',
  '0xa12ebfca3d4e0810e4ed174e4c08277c26917acb': 'JBArbitrumSuckerDeployer',
  // CCIP Sucker Deployers (per chain pair; same address on both sides)
  '0x41d28bedd5b0fbf65424b48c0e1de92d5c882fc7': 'CCIPSuckerDeployer (ETH↔OP)',
  '0x36a2e30029d87c46f77f71b7b6b97fec8a760660': 'CCIPSuckerDeployer (ETH↔ARB)',
  '0x3955fec11fe15f0be4dfa2b0153feef55d55e1ee': 'CCIPSuckerDeployer (ETH↔BASE)',
  '0x1d58d56fbdb753de44737be926c33b79cf009afa': 'CCIPSuckerDeployer (OP↔ARB)',
  '0x8f6f0a70939997310309d7ab66b1b199faafe7f0': 'CCIPSuckerDeployer (OP↔BASE)',
  '0x2845f919af9ed7d8dab188d42114bd590340a242': 'CCIPSuckerDeployer (ARB↔BASE)',
  // Native token (JBConstants.NATIVE_TOKEN)
  '0x000000000000000000000000000000000000eeee': 'NATIVE_TOKEN (ETH)',
  // Zero address
  '0x0000000000000000000000000000000000000000': 'None',
}

// All USDC addresses by chain (mainnet + testnet) for chain-specific display.
// Lowercased for direct comparison and display.
export const USDC_ADDRESSES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_USDC_BY_CHAIN).map(([chainId, address]) => [
    chainId,
    address.toLowerCase(),
  ]),
)

// Check if an address is USDC (varies by chain)
export function isUsdcAddress(address: string): boolean {
  const lower = address.toLowerCase()
  return Object.values(USDC_ADDRESSES).some(addr => addr.toLowerCase() === lower)
}

// USDC currency codes by chain: uint32(uint160(token)), derived from the shared
// canonical per-chain USDC config — never from an AI response.
export const USDC_CURRENCIES: Record<string, number> = Object.fromEntries(
  [...Object.values(SHARED_MAINNET_CHAINS), ...Object.values(SHARED_TESTNET_CHAINS)].map(
    chain => [String(chain.id), chain.usdc.currency],
  ),
)

// Check if a currency code is USDC (varies by chain)
export function isUsdcCurrency(currency: number): boolean {
  return Object.values(USDC_CURRENCIES).includes(currency)
}

// Get the label for a currency code
export function getCurrencyLabel(currency: number): string | null {
  if (currency === 1 || currency === 61166) return 'ETH'
  if (currency === 2) return 'USD'
  if (isUsdcCurrency(currency)) return 'USDC'
  return null
}

// Get human-readable name for a known address (chain-aware for tokens)
export function getAddressLabel(address: string, chainId?: string | number): string | null {
  const lower = address.toLowerCase()
  const chainStr = chainId?.toString()

  // Check chain-specific tokens first
  if (chainStr && USDC_ADDRESSES[chainStr] === lower) {
    return 'USDC'
  }

  // Fall back to global addresses
  return JB_ADDRESSES[lower] || null
}

// Format parameter names for display
export function formatParamName(key: string): string {
  return key
    // Add space between acronym and next word (e.g., "IPFSUri" -> "IPFS Uri")
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // Add space between lowercase and uppercase (e.g., "encodedIPFS" -> "encoded IPFS")
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, str => str.toUpperCase())
    .trim()
}

// Helper to format simple parameter values with context-aware descriptions
export function formatSimpleValue(value: unknown, key?: string, chainId?: string | number): string {
  if (value === null || value === undefined) return 'null'

  const keyLower = (key || '').toLowerCase().replace(/\s+/g, '')
  const numValue = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+$/.test(value) ? parseInt(value) : null)

  // Context-aware formatting based on parameter name
  if (keyLower.includes('basecurrency') && numValue !== null) {
    return numValue === 1 ? '1 (ETH)' : numValue === 2 ? '2 (USD)' : String(value)
  }

  // Currency field (JBAccountingContext uses uint32 currency codes)
  // Currency codes are derived from token addresses.
  if (keyLower === 'currency' && numValue !== null) {
    // ETH native token currency is constant
    if (numValue === 61166) {
      return `${numValue} (ETH)`
    }
    if (isUsdcCurrency(numValue)) {
      return `${numValue} (USDC, chain-specific)`
    }
    return String(numValue)
  }

  // Weight has 18 decimals - convert to human readable
  if (keyLower.includes('weight') && !keyLower.includes('cut')) {
    let rawWeight: number
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      rawWeight = parseFloat(value) / 1e18
    } else if (numValue !== null) {
      rawWeight = numValue > 1e12 ? numValue / 1e18 : numValue
    } else {
      return String(value)
    }

    if (rawWeight >= 1e9) return `${(rawWeight / 1e9).toFixed(1)}B tokens/USD`
    if (rawWeight >= 1e6) return `${(rawWeight / 1e6).toFixed(1)}M tokens/USD`
    if (rawWeight >= 1e3) return `${(rawWeight / 1e3).toFixed(1)}K tokens/USD`
    return `${rawWeight.toLocaleString()} tokens/USD`
  }

  // Unix timestamps
  if ((keyLower.includes('startat') || keyLower.includes('lockeduntil')) && numValue !== null && numValue > 1000000000) {
    const date = new Date(numValue * 1000)
    const now = new Date()
    const diffMs = date.getTime() - now.getTime()
    const diffMins = Math.round(diffMs / 60000)

    const dateStr = date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })

    if (numValue === 0) return '0 (immediately)'
    if (diffMins > 0 && diffMins < 60) return `${dateStr} (in ~${diffMins} min)`
    if (diffMins > 0 && diffMins < 1440) return `${dateStr} (in ~${Math.round(diffMins / 60)} hours)`
    if (diffMins < 0) return `${dateStr} (past)`
    return dateStr
  }

  if (keyLower.includes('duration') && numValue !== null) {
    if (numValue === 0) return '0 (ongoing)'
    const days = Math.floor(numValue / 86400)
    const hours = Math.floor((numValue % 86400) / 3600)
    if (days > 0) return `${days}d ${hours}h`
    return `${hours}h`
  }

  if (keyLower.includes('reservedpercent') && numValue !== null) {
    const pct = (numValue / 100).toFixed(0)
    return `${pct}%${numValue === 0 ? ' (all to contributors)' : ''}`
  }

  if (keyLower.includes('cashouttaxrate') && numValue !== null) {
    const pct = (numValue / 100).toFixed(0)
    if (numValue === 0) return '0% (proportional baseline)'
    if (numValue === 10000) return '100% (disabled)'
    return `${pct}%`
  }

  if (keyLower.includes('weightcutpercent') && numValue !== null) {
    const pct = (numValue / 10000000).toFixed(1)
    return numValue === 0 ? '0% (no cut)' : `${pct}%/cycle`
  }

  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value !== 'string') return String(value)

  // Handle addresses - show label if known JB address
  if (value.startsWith('0x') && value.length === 42) {
    const label = getAddressLabel(value, chainId)
    return label ? `${label} (${value})` : value
  }

  // Handle IPFS URIs
  if (value.startsWith('ipfs://')) {
    return value
  }

  // Handle groupId
  if (keyLower.includes('groupid')) {
    const groupIdLabels: Record<string, string> = {
      '918640019851866092946544831648579639063834485832': 'USDC payouts',
    }
    const label = groupIdLabels[value]
    return label || value
  }

  // Handle large numbers (likely wei)
  if (/^\d{18,}$/.test(value) && !keyLower.includes('groupid')) {
    // Check for uint224.max - this represents "unlimited" in JB fund access limits
    // uint224.max = 26959946667150639794667015087019630673637144422540572481103610249215
    const UINT224_MAX = '26959946667150639794667015087019630673637144422540572481103610249215'
    if (value === UINT224_MAX) {
      return `UNLIMITED_MARKER:${value}` // Special marker for UI to render with tooltip
    }
    const eth = parseFloat(value) / 1e18
    return `${eth.toFixed(4)} ETH (${value})`
  }

  return value
}

// Check if value is a complex object that needs expansion
export function isComplexValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return false
}

// Check if value is an empty array
export function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0
}

// Get a human-readable label for array items based on parent context
export function getArrayItemLabel(parentName: string, index: number): string {
  const lower = parentName.toLowerCase()
  if (lower.includes('ruleset')) return `Ruleset ${index + 1}`
  if (lower.includes('terminal')) return `Terminal ${index + 1}`
  if (lower === 'splits') return '' // Skip wrapper, show contents directly
  if (lower.includes('splitgroup')) return '' // Skip wrapper, show contents directly
  if (lower.includes('sucker')) return `Sucker ${index + 1}`
  if (lower.includes('chain')) return `Chain ${index + 1}`
  if (lower.includes('hook')) return `Hook ${index + 1}`
  if (lower.includes('mapping')) return `Mapping ${index + 1}`
  if (lower.includes('tier')) return '' // Skip wrapper, show contents directly
  if (lower.includes('deployer')) return `Deployer ${index + 1}`
  if (lower.includes('limit')) return '' // Skip wrapper, show contents directly
  if (lower.includes('allowance')) return '' // Skip wrapper, show contents directly
  return `Item ${index + 1}`
}

// Get tooltip text for known parameters
export function getParamTooltip(name: string): string | undefined {
  const tooltips: Record<string, string> = {
    groupId: 'Identifies which token\'s payouts this split group applies to. Derived from uint256(uint160(tokenAddress)).',
    weight: 'Tokens minted per unit of base currency (e.g., 1000000 = 1M tokens per dollar)',
    weightCutPercent: 'How much issuance decreases each cycle (0 = no cut, 1000000000 = 100% cut)',
    reservedPercent: 'Percentage of minted tokens reserved (0-10000, where 10000 = 100%)',
    cashOutTaxRate: 'Cash-out curve rate (0 = proportional baseline, 10000 = disabled)',
    baseCurrency: '1 = ETH, 2 = USD - determines how token issuance is calculated',
    duration: 'Ruleset duration in seconds (0 = no automatic cycling)',
    pausePay: 'If true, payments are disabled',
    allowOwnerMinting: 'If true, owner can mint tokens directly',
    terminal: 'Contract address that handles payments and cash outs',
    tokensToIssue: 'ERC-20 token addresses this terminal can accept',
    hook: 'Optional hook contract for custom behavior',
    projectUri: 'IPFS link to project metadata (name, description, logo)',
    memo: 'On-chain message attached to this transaction',
    projectId: 'The unique identifier for the Juicebox project',
    beneficiary: 'Address that receives tokens or funds',
    minReturnedTokens: 'Minimum tokens expected to receive (slippage protection)',
    amount: 'The amount being transferred or used',
    token: 'The token address (ETH native token or ERC-20)',
    metadata: 'Additional encoded data for hooks or extensions',
  }
  const key = name.replace(/\s+/g, '').toLowerCase()
  for (const [k, v] of Object.entries(tooltips)) {
    if (key.includes(k.toLowerCase())) return v
  }
  return undefined
}

