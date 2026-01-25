import { useState } from 'react'
import { useThemeStore } from '../../stores'

interface ChainOverride {
  chainId: string
  label?: string
  overrides: Record<string, unknown>
}

interface TransactionPreviewProps {
  action: string
  contract: string
  chainId: string
  projectId?: string
  parameters: string // JSON string of parameters
  explanation: string
  chainConfigs?: string // JSON string of ChainOverride[] for multi-chain deployments
}

const CHAIN_NAMES: Record<string, string> = {
  '1': 'Ethereum',
  '10': 'Optimism',
  '8453': 'Base',
  '42161': 'Arbitrum',
}

const CHAIN_COLORS: Record<string, string> = {
  '1': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  '10': 'bg-red-500/20 text-red-300 border-red-500/30',
  '8453': 'bg-blue-400/20 text-blue-200 border-blue-400/30',
  '42161': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
}

const ACTION_ICONS: Record<string, string> = {
  pay: '💰',
  cashOut: '🔄',
  sendPayouts: '📤',
  useAllowance: '💸',
  mintTokens: '🪙',
  burnTokens: '🔥',
  launchProject: '🚀',
  queueRuleset: '📋',
  deployERC20: '🎟️',
}

const ACTION_BUTTON_LABELS: Record<string, string> = {
  pay: 'Pay',
  cashOut: 'Cash Out',
  sendPayouts: 'Send Payouts',
  useAllowance: 'Use Allowance',
  mintTokens: 'Mint Tokens',
  burnTokens: 'Burn Tokens',
  launchProject: 'Launch Project',
  queueRuleset: 'Queue Ruleset',
  deployERC20: 'Deploy Token',
}

// Known JB ecosystem addresses (same on all chains)
const JB_ADDRESSES: Record<string, string> = {
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
  // Suckers
  '0x696c7e794fe2a7c2e3b7da4ae91733345fc1bf68': 'JBSuckerRegistry',
  // Native token (JBConstants.NATIVE_TOKEN)
  '0x000000000000000000000000000000000000eeee': 'NATIVE_TOKEN (ETH)',
  // Zero address
  '0x0000000000000000000000000000000000000000': 'None',
}

// Chain-aware token addresses (different per chain)
const CHAIN_TOKENS: Record<string, Record<string, string>> = {
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
}

// Get human-readable name for a known address (chain-aware for tokens)
function getAddressLabel(address: string, chainId?: string): string | null {
  const lower = address.toLowerCase()

  // Check chain-specific tokens first
  if (chainId && CHAIN_TOKENS[chainId]?.[lower]) {
    return CHAIN_TOKENS[chainId][lower]
  }

  // Fall back to global addresses
  return JB_ADDRESSES[lower] || null
}

// Deep merge two objects, with source overriding target
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>)
    } else {
      result[key] = source[key]
    }
  }
  return result
}

// Component to show a preview of project metadata (name, description, website, etc.)
function ProjectMetadataPreview({ metadata, isDark }: { metadata: Record<string, unknown>; isDark: boolean }) {
  const name = metadata.name as string | undefined
  const description = metadata.description as string | undefined
  const tagline = metadata.tagline as string | undefined
  const tags = metadata.tags as string[] | undefined
  const infoUri = metadata.infoUri as string | undefined
  const logoUri = metadata.logoUri as string | undefined

  return (
    <div className="space-y-2">
      <div className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Project Preview
      </div>
      <div className="flex gap-3">
        {/* Logo placeholder */}
        {logoUri && (
          <div className={`w-12 h-12 rounded-lg flex-shrink-0 flex items-center justify-center ${
            isDark ? 'bg-white/5' : 'bg-gray-100'
          }`}>
            <span className="text-2xl">🖼️</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          {name && (
            <div className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {name}
            </div>
          )}
          {tagline && (
            <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              {tagline}
            </div>
          )}
        </div>
      </div>
      {description && (
        <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          {description}
        </p>
      )}
      {tags && tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {tags.map((tag, i) => (
            <span
              key={i}
              className={`px-2 py-0.5 text-xs rounded-full ${
                isDark ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      {infoUri && (
        <a
          href={infoUri}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1 text-sm ${
            isDark ? 'text-juice-orange hover:text-juice-orange/80' : 'text-orange-600 hover:text-orange-500'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          {infoUri.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </a>
      )}
    </div>
  )
}

export default function TransactionPreview({
  action,
  contract,
  chainId,
  projectId,
  parameters,
  explanation,
  chainConfigs,
}: TransactionPreviewProps) {
  const [expanded, setExpanded] = useState(true)
  const [selectedChainTab, setSelectedChainTab] = useState<string | null>(null)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  let parsedParams: Record<string, unknown> = {}
  try {
    parsedParams = JSON.parse(parameters)
  } catch {
    parsedParams = { raw: parameters }
  }

  // Parse chain-specific configs for multi-chain deployments
  let parsedChainConfigs: ChainOverride[] = []
  try {
    if (chainConfigs) {
      parsedChainConfigs = JSON.parse(chainConfigs)
    }
  } catch {
    // Ignore parsing errors
  }

  const isMultiChain = parsedChainConfigs.length > 0
  const activeChainId = selectedChainTab || (isMultiChain ? parsedChainConfigs[0]?.chainId : chainId)

  // Merge base params with chain-specific overrides for display
  const getParamsForChain = (cid: string): Record<string, unknown> => {
    const chainOverride = parsedChainConfigs.find(c => c.chainId === cid)
    if (!chainOverride) return parsedParams as Record<string, unknown>
    return deepMerge(parsedParams as Record<string, unknown>, chainOverride.overrides)
  }

  const displayParams = isMultiChain ? getParamsForChain(activeChainId) : parsedParams

  const chainName = CHAIN_NAMES[activeChainId] || `Chain ${activeChainId}`
  const chainColor = CHAIN_COLORS[activeChainId] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'
  const actionIcon = ACTION_ICONS[action] || '📝'

  return (
    <div className={`inline-block border overflow-hidden ${
      isDark
        ? 'bg-juice-dark-lighter border-white/10'
        : 'bg-white border-gray-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${
        isDark ? 'border-white/10' : 'border-gray-200'
      }`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">{actionIcon}</span>
            <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Summary
            </span>
          </div>
          {!isMultiChain && (
            <span className={`px-2 py-0.5 text-xs font-medium border ${chainColor}`}>
              {chainName}
            </span>
          )}
        </div>
        {/* Chain tabs for multi-chain deployments */}
        {isMultiChain && (
          <div className="flex gap-1 mt-3 flex-wrap">
            {parsedChainConfigs.map((config) => {
              const cid = config.chainId
              const name = config.label || CHAIN_NAMES[cid] || `Chain ${cid}`
              const color = CHAIN_COLORS[cid] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'
              const isActive = cid === activeChainId
              return (
                <button
                  key={cid}
                  onClick={() => setSelectedChainTab(cid)}
                  className={`px-2 py-0.5 text-xs font-medium border transition-all ${
                    isActive
                      ? color
                      : isDark
                        ? 'bg-transparent text-gray-500 border-gray-700 hover:border-gray-600'
                        : 'bg-transparent text-gray-400 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Explanation */}
      <div className="px-4 py-3">
        <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
          {explanation}
        </p>
      </div>

      {/* Project metadata preview */}
      {displayParams.projectMetadata && typeof displayParams.projectMetadata === 'object' && (
        <div className={`px-4 py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <ProjectMetadataPreview metadata={displayParams.projectMetadata as Record<string, unknown>} isDark={isDark} />
        </div>
      )}

      {/* Expandable details for advanced users */}
      <div className={`px-4 py-2 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-2 text-xs ${
            isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'
          }`}
        >
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {expanded ? 'Hide' : 'Show'} technical details
        </button>

        {expanded && (
          <div className="mt-3 space-y-1.5 text-xs">
            <div className={`flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
              <span>Contract</span>
              <span className="font-mono">{contract}</span>
            </div>

            <div className={`flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
              <span>Action</span>
              <span className="font-mono">{action}</span>
            </div>

            {projectId && (
              <div className={`flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                <span>Project</span>
                <span className="font-mono">#{projectId}</span>
              </div>
            )}

            {Object.entries(displayParams).map(([key, value]) => (
              <ParamRow key={key} name={key} value={value} isDark={isDark} chainId={activeChainId} />
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

// Helper to format parameter names
function formatParamName(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim()
}

// Helper to format simple parameter values with context-aware descriptions
function formatSimpleValue(value: unknown, key?: string, chainId?: string): string {
  if (value === null || value === undefined) return 'null'

  const keyLower = (key || '').toLowerCase().replace(/\s+/g, '')
  const numValue = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+$/.test(value) ? parseInt(value) : null)

  // Context-aware formatting based on parameter name
  if (keyLower.includes('basecurrency') && numValue !== null) {
    return numValue === 1 ? '1 (ETH)' : numValue === 2 ? '2 (USD)' : String(value)
  }

  // Currency field (JBAccountingContext uses uint32 currency codes)
  // Currency = uint32(uint160(tokenAddress)) - lowest 32 bits of the token address
  if (keyLower === 'currency' && numValue !== null) {
    // Known currency codes: uint32(uint160(tokenAddress))
    const currencyLabels: Record<number, string> = {
      // NATIVE_TOKEN (JBConstants.NATIVE_TOKEN): 0x000000000000000000000000000000000000EEEe -> u32 = 61166
      61166: 'ETH',
      // USDC addresses vary by chain - these are the Ethereum mainnet USDC code
      // Other chains: Optimism=3530704773, Base=3169378579, Arbitrum=1156540465
      909516616: 'USDC',
    }
    const label = currencyLabels[numValue]
    return label ? `${numValue} (${label})` : String(numValue)
  }

  // Weight has 18 decimals - convert to human readable
  if (keyLower.includes('weight') && !keyLower.includes('cut')) {
    // Handle both string (large numbers) and number values
    let rawWeight: number
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      // Large string number - divide by 10^18
      rawWeight = parseFloat(value) / 1e18
    } else if (numValue !== null) {
      // If it's already a reasonable number, use it directly
      // But if it's huge (> 1 trillion), assume it has 18 decimals
      rawWeight = numValue > 1e12 ? numValue / 1e18 : numValue
    } else {
      return String(value)
    }

    // Format nicely
    if (rawWeight >= 1e9) return `${(rawWeight / 1e9).toFixed(1)}B tokens/USD`
    if (rawWeight >= 1e6) return `${(rawWeight / 1e6).toFixed(1)}M tokens/USD`
    if (rawWeight >= 1e3) return `${(rawWeight / 1e3).toFixed(1)}K tokens/USD`
    return `${rawWeight.toLocaleString()} tokens/USD`
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

  if ((keyLower.includes('pausepay') || keyLower.includes('allowownerminting')) && typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value !== 'string') return String(value)

  // Handle addresses - show label if known JB address, always show full address
  if (value.startsWith('0x') && value.length === 42) {
    const label = getAddressLabel(value, chainId)
    return label ? `${label} (${value})` : value
  }

  // Handle IPFS URIs - show full URI
  if (value.startsWith('ipfs://')) {
    return value
  }

  // Handle large numbers (likely wei) - show both formats
  if (/^\d{18,}$/.test(value)) {
    const eth = parseFloat(value) / 1e18
    return `${eth.toFixed(4)} ETH (${value})`
  }

  // Show full value, no truncation
  return value
}

// Check if value is a complex object that needs expansion
function isComplexValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return false
}

// Check if value is an empty array
function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0
}

// Get a human-readable label for array items based on parent context
function getArrayItemLabel(parentName: string, index: number): string {
  const lower = parentName.toLowerCase()
  if (lower.includes('ruleset')) return `Ruleset ${index + 1}`
  if (lower.includes('terminal')) return `Terminal ${index + 1}`
  if (lower.includes('split')) return `Split ${index + 1}`
  if (lower.includes('sucker')) return `Sucker ${index + 1}`
  if (lower.includes('chain')) return `Chain ${index + 1}`
  if (lower.includes('hook')) return `Hook ${index + 1}`
  return `Item ${index + 1}`
}

// Get tooltip text for known parameters
function getParamTooltip(name: string): string | undefined {
  const tooltips: Record<string, string> = {
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
  }
  const key = name.replace(/\s+/g, '').toLowerCase()
  for (const [k, v] of Object.entries(tooltips)) {
    if (key.includes(k.toLowerCase())) return v
  }
  return undefined
}

// Component to render a parameter row with support for nested objects
function ParamRow({ name, value, isDark, depth = 0, parentName = '', chainId = '' }: {
  name: string;
  value: unknown;
  isDark: boolean;
  depth?: number;
  parentName?: string;
  chainId?: string;
}) {
  const [expanded, setExpanded] = useState(depth < 2) // Auto-expand first 2 levels
  const isComplex = isComplexValue(value)
  const indent = depth * 16
  const tooltip = getParamTooltip(name)
  const rawValue = JSON.stringify(value, null, 2)

  // Format display name - use human readable labels for array indices
  const displayName = name.startsWith('[')
    ? getArrayItemLabel(parentName, parseInt(name.slice(1, -1)))
    : formatParamName(name)

  // Handle empty arrays
  if (isEmptyArray(value)) {
    return (
      <div
        className={`flex justify-between gap-4 py-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
        style={{ paddingLeft: indent }}
      >
        <span>{displayName}</span>
        <span className={`font-mono italic ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>empty</span>
      </div>
    )
  }

  if (!isComplex) {
    const formattedValue = formatSimpleValue(value, name, chainId)
    const isIpfsUri = typeof value === 'string' && value.startsWith('ipfs://')

    const handleCopy = () => {
      if (typeof value === 'string') {
        navigator.clipboard.writeText(value)
      }
    }

    // Convert IPFS URI to gateway URL for linking
    const getIpfsGatewayUrl = (ipfsUri: string) => {
      const cid = ipfsUri.replace('ipfs://', '')
      return `https://ipfs.io/ipfs/${cid}`
    }

    return (
      <div
        className={`py-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
        style={{ paddingLeft: indent }}
        title={tooltip ? `${tooltip}\n\nRaw: ${rawValue}` : undefined}
      >
        <div className="flex justify-between gap-4">
          <span className={`shrink-0 ${tooltip ? 'underline decoration-dotted cursor-help' : ''}`}>
            {displayName}
          </span>
          {isIpfsUri ? (
            <a
              href={getIpfsGatewayUrl(value as string)}
              target="_blank"
              rel="noopener noreferrer"
              className={`font-mono text-right break-all underline ${
                isDark ? 'text-juice-orange hover:text-juice-orange/80' : 'text-orange-600 hover:text-orange-500'
              }`}
              title="Open in new tab"
            >
              {formattedValue}
            </a>
          ) : (
            <span
              className="font-mono text-right break-all cursor-pointer hover:underline"
              onClick={handleCopy}
              title="Click to copy"
            >
              {formattedValue}
            </span>
          )}
        </div>
      </div>
    )
  }

  // For single-item arrays with generic "Item 1" labels, skip the header and show content directly
  if (Array.isArray(value) && value.length === 1) {
    const label = getArrayItemLabel(name, 0)
    // Skip the "Item 1" wrapper if it's a generic label
    if (label.startsWith('Item ')) {
      const innerValue = value[0]
      if (typeof innerValue === 'object' && innerValue !== null) {
        return (
          <div style={{ paddingLeft: indent }}>
            <span className={`font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{displayName}</span>
            <div className={`mt-0.5 space-y-0 border-l pl-3 ml-1.5 ${isDark ? 'border-gray-700' : 'border-gray-300'}`}>
              {Object.entries(innerValue as Record<string, unknown>).map(([k, v]) => (
                <ParamRow key={k} name={k} value={v} isDark={isDark} depth={depth + 1} parentName={name} chainId={chainId} />
              ))}
            </div>
          </div>
        )
      }
    }
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [`[${i}]`, v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>)

  return (
    <div style={{ paddingLeft: indent }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 w-full text-left py-0.5 ${isDark ? 'text-gray-300 hover:text-gray-200' : 'text-gray-600 hover:text-gray-700'}`}
        title={`Click to ${expanded ? 'collapse' : 'expand'}\n\nRaw: ${rawValue.slice(0, 500)}${rawValue.length > 500 ? '...' : ''}`}
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">{displayName}</span>
        <span className={`ml-auto text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {Array.isArray(value) ? `${value.length} item${value.length !== 1 ? 's' : ''}` : `${Object.keys(value as object).length} fields`}
        </span>
      </button>
      {expanded && (
        <div className={`mt-0.5 space-y-0 border-l pl-3 ml-1.5 ${isDark ? 'border-gray-700' : 'border-gray-300'}`}>
          {entries.map(([k, v]) => (
            <ParamRow key={k} name={k} value={v} isDark={isDark} depth={depth + 1} parentName={name} chainId={chainId} />
          ))}
        </div>
      )}
    </div>
  )
}
