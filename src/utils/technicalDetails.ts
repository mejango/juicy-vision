// Shared utilities for technical details display in transaction modals
import { IS_TESTNET, CHAIN_IDS } from '../config/environment'

// Chain name mapping (environment-aware)
export const CHAIN_NAMES: Record<string, string> = IS_TESTNET
  ? {
      [String(CHAIN_IDS.ethereum)]: 'Sepolia',
      [String(CHAIN_IDS.optimism)]: 'OP Sepolia',
      [String(CHAIN_IDS.base)]: 'Base Sepolia',
      [String(CHAIN_IDS.arbitrum)]: 'Arb Sepolia',
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

// Known JB ecosystem addresses (same on all chains)
export const JB_ADDRESSES: Record<string, string> = {
  // Shared contracts (V5 and V5.1)
  '0x885f707efa18d2cb12f05a3a8eba6b4b26c8c1d4': 'JBProjects',
  '0x4d0edd347fb1fa21589c1e109b3474924be87636': 'JBTokens',
  '0x0061e516886a0540f63157f112c0588ee0651dcf': 'JBDirectory',
  '0x7160a322fea44945a6ef9adfd65c322258df3c5e': 'JBSplits',
  '0x3a46b21720c8b70184b0434a2293b2fdcc497ce7': 'JBFundAccessLimits',
  '0xba948dab74e875b19cf0e2ca7a4546c0c2defc40': 'JBPermissions',
  '0x6e92e3b5ce1e7a4344c6d27c0c54efd00df92fb6': 'JBPrices',
  '0xf76f7124f73abc7c30b2f76121afd4c52be19442': 'JBFeelessAddresses',
  // V5.1 contracts
  '0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1': 'JBController5_1',
  '0x52869db3d61dde1e391967f2ce5039ad0ecd371c': 'JBMultiTerminal5_1',
  '0xd4257005ca8d27bbe11f356453b0e4692414b056': 'JBRulesets5_1',
  '0x82239c5a21f0e09573942caa41c580fa36e27071': 'JBTerminalStore5_1',
  '0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71': 'JBOmnichainDeployer5_1',
  // V5 contracts (Revnets)
  '0x27da30646502e2f642be5281322ae8c394f7668a': 'JBController',
  '0x2db6d704058e552defe415753465df8df0361846': 'JBMultiTerminal',
  '0x6292281d69c3593fcf6ea074e5797341476ab428': 'JBRulesets',
  '0x2ca27bde7e7d33e353b44c27acfcf6c78dde251d': 'REVDeployer',
  // Hooks and extensions
  '0xfe9c4f3e5c27ffd8ee523c6ca388aaa95692c25d': 'JBBuybackHook',
  '0x0c02e48e55f4451a499e48a53595de55c40f3574': 'JBSwapTerminal',
  // Swap terminal registries (CREATE2 - same on all chains)
  '0x1ce40d201cdec791de05810d17aaf501be167422': 'JBSwapTerminalUSDCRegistry',
  '0x60b4f5595ee509c4c22921c7b7999f1616e6a4f6': 'JBSwapTerminalRegistry',
  // Suckers
  '0x696c7e794fe2a7c2e3b7da4ae91733345fc1bf68': 'JBSuckerRegistry',
  // CCIP Sucker Deployers (cross-chain)
  '0x34b40205b249e5733cf93d86b7c9783b015dd3e7': 'CCIPSuckerDeployer',
  '0xde901ebafc70d545f9d43034308c136ce8c94a5c': 'CCIPSuckerDeployer_1',
  '0x9d4858cc9d3552507eeabce722787afef64c615e': 'CCIPSuckerDeployer_2',
  '0x39132ea75b9eae5cbff7ba1997c804302a7ff413': 'CCIPSuckerDeployer_1',
  '0xb825f2f6995966eb6dd772a8707d4a547028ac26': 'CCIPSuckerDeployer_2',
  '0x3d7fb0aa325ad5d2349274f9ef33d4424135d963': 'CCIPSuckerDeployer_2',
  // Native token (JBConstants.NATIVE_TOKEN)
  '0x000000000000000000000000000000000000eeee': 'NATIVE_TOKEN (ETH)',
  // Zero address
  '0x0000000000000000000000000000000000000000': 'None',
  // JBController for single-chain deploy
  '0x8c32bba37a7c42b3a1fa25e2eaf4d6539c481a16': 'JBController',
}

// Chain-aware token addresses (different per chain)
export const CHAIN_TOKENS: Record<string, Record<string, string>> = {
  // Ethereum mainnet
  '1': {
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  },
  // Optimism
  '10': {
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 'USDC',
  },
  // Base
  '8453': {
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
  },
  // Arbitrum
  '42161': {
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
  },
  // Sepolia testnet
  '11155111': {
    '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238': 'USDC',
  },
  // OP Sepolia testnet
  '11155420': {
    '0x5fd84259d66cd46123540766be93dfe6d43130d7': 'USDC',
  },
  // Base Sepolia testnet
  '84532': {
    '0x036cbd53842c5426634e7929541ec2318f3dcf7e': 'USDC',
  },
  // Arb Sepolia testnet
  '421614': {
    '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d': 'USDC',
  },
}

// All USDC addresses by chain for chain-specific display
export const USDC_ADDRESSES: Record<string, string> = {
  // Mainnet
  '1': '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  '10': '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
  '8453': '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  '42161': '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  // Testnet
  '11155111': '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
  '11155420': '0x5fd84259d66cd46123540766be93dfe6d43130d7',
  '84532': '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
  '421614': '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d',
}

// Check if an address is USDC (varies by chain)
export function isUsdcAddress(address: string): boolean {
  const lower = address.toLowerCase()
  return Object.values(USDC_ADDRESSES).some(addr => addr.toLowerCase() === lower)
}

// Get human-readable name for a known address (chain-aware for tokens)
export function getAddressLabel(address: string, chainId?: string | number): string | null {
  const lower = address.toLowerCase()
  const chainStr = chainId?.toString()

  // Check chain-specific tokens first
  if (chainStr && CHAIN_TOKENS[chainStr]?.[lower]) {
    return CHAIN_TOKENS[chainStr][lower]
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
  // Currency codes are derived from token addresses but we hardcode known values
  if (keyLower === 'currency' && numValue !== null) {
    // ETH native token currency is constant
    if (numValue === 61166) {
      return `${numValue} (ETH)`
    }
    // Known USDC currency codes by chain (varies per chain!)
    const usdcCurrencies = [
      909516616,   // Ethereum mainnet / Sepolia
      3530704773,  // OP Sepolia
      3169378579,  // Base Sepolia
      1156540465,  // Arb Sepolia
      // Add mainnet values if different
    ]
    if (usdcCurrencies.includes(numValue)) {
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
    if (numValue === 0) return '0% (full refunds)'
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
    cashOutTaxRate: 'Bonding curve tax on cash outs (0 = full refund, 10000 = disabled)',
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

// Contract names for display
export const CONTRACT_NAMES: Record<string, string> = {
  JB_MULTI_TERMINAL: 'JBMultiTerminal',
  JB_CONTROLLER: 'JBController',
  JB_PROJECTS: 'JBProjects',
  JB_TOKENS: 'JBTokens',
  JB_SPLITS: 'JBSplits',
  REV_DEPLOYER: 'REVDeployer',
}

// Function signatures for common operations
export const FUNCTION_SIGNATURES: Record<string, string> = {
  pay: 'pay(uint256 projectId, address token, uint256 amount, address beneficiary, uint256 minReturnedTokens, string memo, bytes metadata)',
  cashOutTokensOf: 'cashOutTokensOf(address holder, uint256 projectId, uint256 cashOutCount, address tokenToReclaim, uint256 minTokensReclaimed, address beneficiary, bytes metadata)',
  useAllowanceOf: 'useAllowanceOf(uint256 projectId, address token, uint256 amount, uint256 currency, uint256 minTokensPaidOut, address beneficiary, address feeBeneficiary, string memo)',
  deployERC20For: 'deployERC20For(uint256 projectId, string name, string symbol, bytes32 salt)',
  sendPayoutsOf: 'sendPayoutsOf(uint256 projectId, address token, uint256 amount, uint256 currency, uint256 minTokensPaidOut)',
  queueRulesetsOf: 'queueRulesetsOf(uint256 projectId, JBRulesetConfig[] rulesetConfigurations, string memo)',
  launchProjectFor: 'launchProjectFor(address owner, JBProjectMetadata projectMetadata, JBRulesetConfig[] rulesetConfigurations, JBTerminalConfig[] terminalConfigurations, string memo)',
}
