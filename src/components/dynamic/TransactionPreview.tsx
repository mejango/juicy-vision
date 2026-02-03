import { useState, useEffect, useMemo, startTransition, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useProjectDraftStore } from '../../stores/projectDraftStore'
import { useManagedWallet } from '../../hooks'
import { useTransactionPreviewState, type TransactionPreviewState } from '../../hooks/useComponentState'
import { getWalletSession } from '../../services/siwe'
import { useOmnichainLaunchProject } from '../../hooks/relayr'
import { resolveEnsName, truncateAddress } from '../../utils/ens'
import { decodeEncodedIPFSUri, encodeIpfsUri } from '../../utils/ipfs'
import { verifyLaunchProjectParams, type TransactionDoubt } from '../../utils/transactionVerification'
import {
  CHAIN_NAMES,
  CHAIN_COLORS,
  getAddressLabel,
  formatParamName,
  formatSimpleValue,
  isComplexValue,
  isEmptyArray,
  getArrayItemLabel,
  getParamTooltip,
  isUsdcAddress,
  isUsdcCurrency,
  getCurrencyLabel,
  USDC_ADDRESSES,
  USDC_CURRENCIES,
} from '../../utils/technicalDetails'
import { CHAINS, EXPLORER_URLS, ALL_CHAIN_IDS } from '../../constants'
import type { JBRulesetConfig, JBTerminalConfig } from '../../services/relayr'
import {
  parseSuckerDeployerConfig,
  shouldConfigureSuckers,
  getAllChainSuckerConfigs,
  SUCKER_DEPLOYER_LABELS,
  CCIP_SUCKER_DEPLOYER_ADDRESSES,
} from '../../utils/suckerConfig'

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
  _isTruncated?: string // Flag set by parser when component was truncated mid-stream
  _isStreaming?: boolean // True if parent message is still actively streaming
  messageId?: string // Message ID for persisting component state server-side
}

const ACTION_ICONS: Record<string, string> = {
  pay: '💰',
  cashOut: '🔄',
  sendPayouts: '📤',
  useAllowance: '💸',
  mintTokens: '🪙',
  burnTokens: '🔥',
  launchProject: '🚀',
  launch721Project: '🚀',
  deployRevnet: '🔄',
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
  launch721Project: 'Launch Project',
  deployRevnet: 'Deploy Revnet',
  queueRuleset: 'Queue Ruleset',
  deployERC20: 'Deploy Token',
}

// Map semantic action names to actual Solidity function names
const ACTION_FUNCTION_NAMES: Record<string, string> = {
  pay: 'pay',
  cashOut: 'cashOutTokensOf',
  sendPayouts: 'sendPayoutsOf',
  useAllowance: 'useAllowanceOf',
  mintTokens: 'mintTokensOf',
  burnTokens: 'burnTokensOf',
  launchProject: 'launchProjectFor',
  launch721Project: 'launch721RulesetsFor',
  deployRevnet: 'deployFor',
  queueRuleset: 'queueRulesetsOf',
  deployERC20: 'deployERC20For',
}

// Replace placeholder strings like USER_WALLET with actual address
// Recursively processes objects and arrays
function replaceWalletPlaceholders<T>(obj: T, walletAddress: string): T {
  if (!walletAddress) return obj
  if (typeof obj === 'string') {
    // Replace common placeholder patterns
    if (obj === 'USER_WALLET' || obj === 'USER_WALLET_ADDRESS') {
      return walletAddress as T
    }
    return obj
  }
  if (Array.isArray(obj)) {
    return obj.map(item => replaceWalletPlaceholders(item, walletAddress)) as T
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceWalletPlaceholders(value, walletAddress)
    }
    return result as T
  }
  return obj
}

// Update mustStartAtOrAfter timestamps to 5 minutes from NOW
// This ensures timestamps are always fresh at execution time, not stale from preview generation
function updateTimestampsForLaunch<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) {
    return obj.map(updateTimestampsForLaunch) as T
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key.toLowerCase() === 'muststartatOrafter'.toLowerCase()) {
        // Always set to 5 minutes from NOW
        result[key] = Math.floor(Date.now() / 1000) + 300
      } else {
        result[key] = updateTimestampsForLaunch(value)
      }
    }
    return result as T
  }
  return obj
}

// Info popover component with click-to-open and X to close
// Uses portal to escape parent overflow:hidden containers
function InfoPopover({
  content,
  isDark,
  className = ''
}: {
  content: string
  isDark: boolean
  className?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({})
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on click outside or scroll
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    const handleScroll = () => setIsOpen(false)
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [isOpen])

  // Calculate position when opening
  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const popoverWidth = 280
      const popoverHeight = 200

      // Check horizontal space - prefer right-aligned (popover to left of button)
      const spaceLeft = rect.left
      const spaceRight = window.innerWidth - rect.right

      // Check vertical space - prefer above
      const spaceAbove = rect.top
      const spaceBelow = window.innerHeight - rect.bottom

      const styles: React.CSSProperties = {
        position: 'fixed',
        zIndex: 9999,
        width: popoverWidth,
      }

      // Vertical position
      if (spaceAbove >= popoverHeight || spaceAbove > spaceBelow) {
        styles.bottom = window.innerHeight - rect.top + 4
      } else {
        styles.top = rect.bottom + 4
      }

      // Horizontal position
      if (spaceLeft >= popoverWidth || spaceLeft > spaceRight) {
        styles.right = window.innerWidth - rect.right
      } else {
        styles.left = rect.left
      }

      setPopoverStyle(styles)
    }
    setIsOpen(!isOpen)
  }

  const popoverContent = isOpen ? (
    <div
      ref={popoverRef}
      className={`p-3 rounded-lg shadow-lg text-xs leading-relaxed ${
        isDark ? 'bg-gray-800 text-gray-300 border border-gray-700' : 'bg-white text-gray-600 border border-gray-200'
      }`}
      style={popoverStyle}
    >
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen(false) }}
        className={`absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded hover:bg-opacity-10 ${
          isDark ? 'text-gray-400 hover:bg-white' : 'text-gray-500 hover:bg-black'
        }`}
      >
        ×
      </button>
      <div className="pr-4 whitespace-pre-line" style={{ overflowWrap: 'break-word' }}>{content}</div>
    </div>
  ) : null

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className={`inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full border transition-colors ${
          isDark
            ? 'border-gray-500 text-gray-400 hover:border-gray-400 hover:text-gray-300'
            : 'border-gray-400 text-gray-500 hover:border-gray-500 hover:text-gray-600'
        }`}
      >
        ?
      </button>
      {popoverContent && createPortal(popoverContent, document.body)}
    </span>
  )
}

// Component to display an address with optional ENS name
function AddressDisplay({ address, chainId, isDark }: { address: string; chainId?: string; isDark: boolean }) {
  const [ensName, setEnsName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showChainAddresses, setShowChainAddresses] = useState(false)

  useEffect(() => {
    // Only resolve ENS for addresses that look like wallet addresses (not known contracts)
    const knownLabel = getAddressLabel(address, chainId)
    if (knownLabel) {
      setEnsName(null)
      return
    }

    let cancelled = false
    setLoading(true)

    resolveEnsName(address).then(name => {
      if (!cancelled) {
        setEnsName(name)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setEnsName(null)
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [address, chainId])

  const label = getAddressLabel(address, chainId)
  const isChainSpecific = isUsdcAddress(address)
  const truncated = truncateAddress(address)

  const handleCopy = () => {
    navigator.clipboard.writeText(address)
  }

  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowChainAddresses(!showChainAddresses)
  }

  return (
    <span className="inline-flex items-center gap-1 flex-wrap relative">
      <span
        className="font-mono cursor-pointer hover:underline inline-flex items-center gap-1"
        onClick={handleCopy}
        title={`Click to copy: ${address}`}
      >
        {/* ENS name if available */}
        {ensName && (
          <span className={isDark ? 'text-juice-orange' : 'text-orange-600'}>
            {ensName}
          </span>
        )}
        {/* Loading indicator */}
        {loading && !label && (
          <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>...</span>
        )}
        {/* Known label (contract name or token) */}
        {label && (
          <span className={isChainSpecific ? (isDark ? 'text-yellow-400' : 'text-yellow-600') : ''}>
            {label}
          </span>
        )}
        {/* Address (full or truncated based on context) */}
        <span className={label || ensName ? (isDark ? 'text-gray-500' : 'text-gray-400') : ''}>
          {label || ensName ? `(${truncated})` : address}
        </span>
      </span>
      {/* Chain-specific badge - clickable to show all addresses */}
      {isChainSpecific && (
        <button
          onClick={handleBadgeClick}
          className={`text-[9px] px-1 py-0.5 rounded cursor-pointer hover:opacity-80 ${
            isDark ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-700'
          }`}
          title="Click to see addresses per chain"
        >
          chain-specific {showChainAddresses ? '▲' : '▼'}
        </button>
      )}
      {/* Expanded chain addresses dropdown */}
      {isChainSpecific && showChainAddresses && (
        <div className={`absolute top-full right-0 mt-1 z-10 p-2 rounded border text-[10px] whitespace-nowrap ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-lg'
        }`}>
          <div className={`font-semibold mb-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            USDC addresses by chain:
          </div>
          {Object.entries(USDC_ADDRESSES)
            .filter(([cid]) => CHAIN_NAMES[cid]) // Only show current environment's chains
            .map(([cid, addr]) => (
            <div key={cid} className="flex gap-2 py-0.5">
              <span className={`font-medium w-24 text-right ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {CHAIN_NAMES[cid]}:
              </span>
              <span
                className="font-mono cursor-pointer hover:underline"
                onClick={() => navigator.clipboard.writeText(addr)}
                title="Click to copy"
              >
                {addr}
              </span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

// Component to display a currency code with chain-specific dropdown for USDC
function CurrencyDisplay({ currency, isDark }: { currency: number; isDark: boolean }) {
  const [showChainCurrencies, setShowChainCurrencies] = useState(false)

  const label = getCurrencyLabel(currency)
  const isChainSpecific = isUsdcCurrency(currency)

  const handleCopy = () => {
    navigator.clipboard.writeText(currency.toString())
  }

  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowChainCurrencies(!showChainCurrencies)
  }

  return (
    <span className="inline-flex items-center gap-1 flex-wrap relative">
      <span
        className="font-mono cursor-pointer hover:underline"
        onClick={handleCopy}
        title="Click to copy"
      >
        {currency}
        {label && (
          <span className={isChainSpecific ? (isDark ? ' text-yellow-400' : ' text-yellow-600') : (isDark ? ' text-gray-400' : ' text-gray-500')}>
            {' '}({label})
          </span>
        )}
      </span>
      {/* Chain-specific badge - clickable to show all currencies */}
      {isChainSpecific && (
        <button
          onClick={handleBadgeClick}
          className={`text-[9px] px-1 py-0.5 rounded cursor-pointer hover:opacity-80 ${
            isDark ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-700'
          }`}
          title="Click to see currency codes per chain"
        >
          chain-specific {showChainCurrencies ? '▲' : '▼'}
        </button>
      )}
      {/* Expanded chain currencies dropdown */}
      {isChainSpecific && showChainCurrencies && (
        <div className={`absolute top-full right-0 mt-1 z-10 p-2 rounded border text-[10px] whitespace-nowrap ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-lg'
        }`}>
          <div className={`font-semibold mb-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            USDC currency codes by chain:
          </div>
          {Object.entries(USDC_CURRENCIES)
            .filter(([cid]) => CHAIN_NAMES[cid]) // Only show current environment's chains
            .map(([cid, curr]) => (
            <div key={cid} className="flex gap-2 py-0.5">
              <span className={`font-medium w-24 text-right ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {CHAIN_NAMES[cid]}:
              </span>
              <span
                className="font-mono cursor-pointer hover:underline"
                onClick={() => navigator.clipboard.writeText(curr.toString())}
                title="Click to copy"
              >
                {curr}
              </span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

// Component to display a sucker deployer address with chain-pair specific dropdown
function SuckerDeployerDisplay({
  address,
  targetChainId,
  allChainIds,
  isDark
}: {
  address: string;
  targetChainId: number;
  allChainIds: number[];
  isDark: boolean
}) {
  const [showChainDeployers, setShowChainDeployers] = useState(false)

  const deployerInfo = SUCKER_DEPLOYER_LABELS[address.toLowerCase()]
  const label = deployerInfo?.label || 'CCIP Deployer'
  const truncated = truncateAddress(address)

  const handleCopy = () => {
    navigator.clipboard.writeText(address)
  }

  const handleBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowChainDeployers(!showChainDeployers)
  }

  // Get all deployer addresses that will be used for this deployment
  const getDeployersByChain = () => {
    const result: { chainId: number; chainName: string; deployers: { remoteChain: string; address: string; label: string }[] }[] = []

    for (const chainId of allChainIds) {
      const remoteChains = allChainIds.filter(c => c !== chainId)
      const deployers: { remoteChain: string; address: string; label: string }[] = []

      for (const remoteChainId of remoteChains) {
        const deployerAddr = CCIP_SUCKER_DEPLOYER_ADDRESSES[chainId]?.[remoteChainId]
        if (deployerAddr) {
          const info = SUCKER_DEPLOYER_LABELS[deployerAddr.toLowerCase()]
          deployers.push({
            remoteChain: CHAIN_NAMES[remoteChainId.toString()] || `Chain ${remoteChainId}`,
            address: deployerAddr,
            label: info?.label || 'CCIP',
          })
        }
      }

      result.push({
        chainId,
        chainName: CHAIN_NAMES[chainId.toString()] || `Chain ${chainId}`,
        deployers,
      })
    }

    return result
  }

  const deployersByChain = getDeployersByChain()

  return (
    <span className="inline-flex items-center gap-1 flex-wrap relative">
      <span
        className="font-mono cursor-pointer hover:underline inline-flex items-center gap-1"
        onClick={handleCopy}
        title={`Click to copy: ${address}`}
      >
        <span className={isDark ? 'text-yellow-400' : 'text-yellow-600'}>
          {label}
        </span>
        <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
          ({truncated})
        </span>
      </span>
      {/* Chain-specific badge - clickable to show all deployers per chain */}
      {allChainIds.length > 1 && (
        <button
          onClick={handleBadgeClick}
          className={`text-[9px] px-1 py-0.5 rounded cursor-pointer hover:opacity-80 ${
            isDark ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-700'
          }`}
          title="Click to see deployers per chain"
        >
          chain-specific {showChainDeployers ? '▲' : '▼'}
        </button>
      )}
      {/* Expanded chain deployers dropdown */}
      {showChainDeployers && (
        <div className={`absolute top-full right-0 mt-1 z-10 p-2 rounded border text-[10px] max-h-80 overflow-auto ${
          isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200 shadow-lg'
        }`} style={{ minWidth: '320px' }}>
          <div className={`font-semibold mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            Sucker deployers by chain:
          </div>
          {deployersByChain.map(({ chainId, chainName, deployers }) => (
            <div key={chainId} className={`mb-2 pb-2 border-b last:border-0 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
              <div className={`font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                On {chainName}:
              </div>
              {deployers.map((d, i) => (
                <div key={i} className="flex gap-2 py-0.5 pl-2">
                  <span className={`font-medium w-20 text-right ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    → {d.remoteChain}:
                  </span>
                  <span
                    className={`font-mono cursor-pointer hover:underline ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}
                    onClick={() => navigator.clipboard.writeText(d.address)}
                    title="Click to copy"
                  >
                    {d.label}
                  </span>
                  <span className={`font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    ({truncateAddress(d.address)})
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  )
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

// Component to display sucker deployment configuration with per-chain deployers
function SuckerConfigSection({
  allChainIds,
  tokenAddresses,
  salt,
  isDark
}: {
  allChainIds: number[];
  tokenAddresses?: Record<number, `0x${string}`>;
  salt: string;
  isDark: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const [selectedChain, setSelectedChain] = useState<number>(allChainIds[0])

  // Generate all chain configs
  const allConfigs = useMemo(() => {
    return getAllChainSuckerConfigs(allChainIds, { tokenAddresses, salt: salt as `0x${string}` })
  }, [allChainIds, tokenAddresses, salt])

  const selectedConfig = allConfigs[selectedChain]
  const deployerCount = selectedConfig?.deployerConfigurations.length || 0

  return (
    <div className="py-0.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 w-full text-left py-0.5 ${isDark ? 'text-gray-300 hover:text-gray-200' : 'text-gray-600 hover:text-gray-700'}`}
      >
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">Sucker Deployment Configuration</span>
        <span className={`ml-auto text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          2 fields
        </span>
      </button>

      {expanded && (
        <div className={`mt-0.5 space-y-1 border-l pl-3 ml-1.5 ${isDark ? 'border-gray-700' : 'border-gray-300'}`}>
          {/* Chain selector - shows that configs vary per chain */}
          <div className={`flex items-center gap-2 py-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            <span className="shrink-0">Deployer Configurations</span>
            <div className="flex items-center gap-1 ml-auto">
              <select
                value={selectedChain}
                onChange={(e) => setSelectedChain(Number(e.target.value))}
                className={`text-xs px-2 py-0.5 rounded border ${
                  isDark
                    ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-300'
                    : 'bg-yellow-50 border-yellow-200 text-yellow-700'
                }`}
              >
                {allChainIds.map(chainId => (
                  <option key={chainId} value={chainId}>
                    {CHAIN_NAMES[chainId.toString()] || `Chain ${chainId}`}
                  </option>
                ))}
              </select>
              <span className={`text-[9px] px-1 py-0.5 rounded ${
                isDark ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-700'
              }`}>
                chain-specific
              </span>
            </div>
          </div>

          {/* Deployer configs for selected chain */}
          <div className={`border-l pl-3 ml-1.5 ${isDark ? 'border-gray-700' : 'border-gray-300'}`}>
            <div className={`text-xs py-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {deployerCount} deployer{deployerCount !== 1 ? 's' : ''} (one per remote chain)
            </div>
            {selectedConfig?.deployerConfigurations.map((dc, idx) => {
              const deployerInfo = SUCKER_DEPLOYER_LABELS[dc.deployer.toLowerCase()]
              const remoteChainId = deployerInfo?.chainPair.find(c => c !== selectedChain)
              const remoteChainName = remoteChainId ? (CHAIN_NAMES[remoteChainId.toString()] || `Chain ${remoteChainId}`) : 'Remote'

              return (
                <div key={idx} className={`py-1 ${idx > 0 ? 'border-t ' + (isDark ? 'border-gray-700' : 'border-gray-200') : ''}`}>
                  <div className={`flex justify-between gap-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    <span>→ {remoteChainName}</span>
                    <span
                      className={`font-mono text-xs cursor-pointer hover:underline ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}
                      onClick={() => navigator.clipboard.writeText(dc.deployer)}
                      title={`Click to copy: ${dc.deployer}`}
                    >
                      {deployerInfo?.label || 'CCIP'} ({truncateAddress(dc.deployer)})
                    </span>
                  </div>
                  {/* Token mapping */}
                  {dc.mappings.map((m, mIdx) => (
                    <div key={mIdx} className={`ml-4 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      <div className="flex justify-between">
                        <span>Local Token</span>
                        <span className="font-mono">{truncateAddress(m.localToken)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Remote Token</span>
                        <span className="font-mono">{truncateAddress(m.remoteToken)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

          {/* Salt */}
          <div className={`flex justify-between gap-4 py-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            <span>Salt</span>
            <span
              className="font-mono text-right break-all cursor-pointer hover:underline"
              onClick={() => navigator.clipboard.writeText(salt)}
              title="Click to copy"
            >
              {truncateAddress(salt)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// Section header with optional edit button
function SectionHeader({ title, isDark, onEdit }: { title: string; isDark: boolean; onEdit?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className={`text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        {title}
      </div>
      {onEdit && (
        <button
          onClick={onEdit}
          className={`text-xs ${isDark ? 'text-juice-orange hover:text-juice-orange/80' : 'text-orange-600 hover:text-orange-500'}`}
        >
          Edit
        </button>
      )}
    </div>
  )
}

// Component to show a preview of project metadata (name, description, website, etc.)
function ProjectMetadataPreview({ metadata, isDark, onEdit }: { metadata: Record<string, unknown>; isDark: boolean; onEdit?: () => void }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState((metadata.name as string) || '')
  const [editDescription, setEditDescription] = useState((metadata.description as string) || '')
  const [editTags, setEditTags] = useState((metadata.tags as string[])?.join(', ') || '')

  const name = metadata.name as string | undefined
  const description = metadata.description as string | undefined
  const tagline = metadata.tagline as string | undefined
  const tags = metadata.tags as string[] | undefined
  const infoUri = metadata.infoUri as string | undefined
  const logoUri = metadata.logoUri as string | undefined

  const handleEdit = () => {
    setIsEditing(true)
  }

  const handleSave = () => {
    const parsedTags = editTags.split(',').map(t => t.trim()).filter(Boolean)
    window.dispatchEvent(new CustomEvent('juice:update-metadata', {
      detail: { name: editName, description: editDescription, tags: parsedTags }
    }))
    setIsEditing(false)
  }

  const handleCancel = () => {
    setEditName((metadata.name as string) || '')
    setEditDescription((metadata.description as string) || '')
    setEditTags((metadata.tags as string[])?.join(', ') || '')
    setIsEditing(false)
  }

  return (
    <div className="space-y-3">
      <SectionHeader title="Project" isDark={isDark} onEdit={isEditing ? undefined : handleEdit} />

      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Project Name
            </label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className={`w-full px-3 py-2 rounded border text-sm ${
                isDark
                  ? 'bg-white/5 border-white/10 text-white focus:border-juice-orange'
                  : 'bg-white border-gray-300 text-gray-900 focus:border-orange-500'
              } focus:outline-none`}
              placeholder="My Project"
            />
          </div>
          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Description
            </label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              className={`w-full px-3 py-2 rounded border text-sm resize-none ${
                isDark
                  ? 'bg-white/5 border-white/10 text-white focus:border-juice-orange'
                  : 'bg-white border-gray-300 text-gray-900 focus:border-orange-500'
              } focus:outline-none`}
              placeholder="Describe your project..."
            />
          </div>
          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              className={`w-full px-3 py-2 rounded border text-sm ${
                isDark
                  ? 'bg-white/5 border-white/10 text-white focus:border-juice-orange'
                  : 'bg-white border-gray-300 text-gray-900 focus:border-orange-500'
              } focus:outline-none`}
              placeholder="defi, dao, nft"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleCancel}
              className={`px-3 py-1.5 text-xs rounded ${
                isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs rounded bg-juice-orange text-black font-medium hover:bg-juice-orange/90"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-3">
            {/* Logo */}
            <div className={`w-14 h-14 rounded-lg flex-shrink-0 flex items-center justify-center overflow-hidden ${
              isDark ? 'bg-white/5' : 'bg-gray-100'
            }`}>
              {logoUri ? (
                <img
                  src={logoUri.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${logoUri.replace('ipfs://', '')}` : logoUri}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <span className="text-2xl">🚀</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`font-semibold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {name || 'Untitled Project'}
              </div>
              {tagline && (
                <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                  {tagline}
                </div>
              )}
            </div>
          </div>
          {description && (
            <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              {description}
            </p>
          )}
          {tags && tags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
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
        </>
      )}
    </div>
  )
}

// Component to show NFT tier preview
interface TierInfo {
  name?: string
  price: number
  currency: number
  decimals: number
  initialSupply: number
  encodedIPFSUri?: string
  resolvedUri?: string // Resolved IPFS URI (ipfs://...)
  media?: string // Direct media URL from user upload
  mediaUri?: string // Alternative field name for media
  imageUri?: string // Alternative field name
  uri?: string // Generic URI field
  image?: string // Direct image field
  ipfsUri?: string // Raw IPFS URI before encoding
  tierUri?: string // Another possible field name
  description?: string
}

function TierPreview({ tier, index, isDark }: { tier: TierInfo; index: number; isDark: boolean }) {
  // Convert price based on decimals
  const priceFormatted = tier.currency === 2
    ? `$${(tier.price / Math.pow(10, tier.decimals || 6)).toLocaleString()}`
    : `${(tier.price / 1e18).toFixed(4)} ETH`

  const supplyText = tier.initialSupply >= 4294967290 ? 'Unlimited' : `${tier.initialSupply.toLocaleString()} available`

  // Get image URL from various possible sources - check all possible field names
  const getImageUrl = (): string | null => {
    // Helper to resolve any IPFS, HTTP, or data URL
    const resolveUrl = (url: string | undefined | null): string | null => {
      if (!url) return null
      // Data URLs (from user uploads) - return as-is
      if (url.startsWith('data:image/') || url.startsWith('data:video/')) {
        return url
      }
      if (url.startsWith('ipfs://')) {
        return `https://ipfs.io/ipfs/${url.replace('ipfs://', '')}`
      }
      if (url.startsWith('http')) {
        return url
      }
      // Might be a raw CID
      if (url.startsWith('Qm') || url.startsWith('baf')) {
        return `https://ipfs.io/ipfs/${url}`
      }
      return null
    }

    // Check all possible field names for the image
    const possibleUrls = [
      tier.media,
      tier.mediaUri,
      tier.imageUri,
      tier.image,
      tier.uri,
      tier.resolvedUri,
      tier.ipfsUri,
      tier.tierUri,
    ]

    for (const url of possibleUrls) {
      const resolved = resolveUrl(url)
      if (resolved) return resolved
    }

    // Try to decode bytes32 encodedIPFSUri (on-chain format)
    if (tier.encodedIPFSUri && tier.encodedIPFSUri !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      const decoded = decodeEncodedIPFSUri(tier.encodedIPFSUri)
      if (decoded) {
        return `https://ipfs.io/ipfs/${decoded.replace('ipfs://', '')}`
      }
    }

    return null
  }
  const imageUrl = getImageUrl()

  return (
    <div className={`flex gap-3 p-3 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
      <div className={`w-16 h-16 rounded flex-shrink-0 flex items-center justify-center overflow-hidden ${
        isDark ? 'bg-white/10' : 'bg-gray-200'
      }`}>
        {imageUrl ? (
          <img src={imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
        ) : (
          <span className="text-2xl">🎁</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {tier.name || `Tier ${index + 1}`}
          </div>
          <div className={`font-semibold ${isDark ? 'text-green-400' : 'text-green-600'}`}>
            {priceFormatted}
          </div>
        </div>
        <div className={`text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
          {supplyText}
        </div>
        {tier.description && (
          <div className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            {tier.description}
          </div>
        )}
      </div>
    </div>
  )
}

// Skeleton tier card for loading state
function TierSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <div className={`flex gap-3 p-3 rounded-lg ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
      <div className={`w-16 h-16 rounded flex-shrink-0 animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className={`h-5 w-24 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className={`h-5 w-12 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        </div>
        <div className={`h-3 w-20 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
      </div>
    </div>
  )
}

function TiersPreview({ tiers, currency, decimals, isDark, onEdit, isLoading }: {
  tiers: TierInfo[];
  currency: number;
  decimals: number;
  isDark: boolean;
  onEdit?: () => void;
  isLoading?: boolean;
}) {
  // Show skeleton state when loading
  if (isLoading) {
    return (
      <div className="space-y-3">
        <SectionHeader title="Reward Tiers" isDark={isDark} />
        <div className="space-y-2">
          <TierSkeleton isDark={isDark} />
        </div>
      </div>
    )
  }

  if (!tiers || tiers.length === 0) return null

  return (
    <div className="space-y-3">
      <SectionHeader title={`Reward Tiers (${tiers.length})`} isDark={isDark} onEdit={onEdit} />
      <div className="space-y-2">
        {tiers.map((tier, i) => (
          <TierPreview key={i} tier={{ ...tier, currency, decimals }} index={i} isDark={isDark} />
        ))}
      </div>
    </div>
  )
}

// Skeleton funding breakdown for loading state
function FundingSkeleton({ isDark }: { isDark: boolean }) {
  return (
    <div className="space-y-3">
      <SectionHeader title="Payout Distribution" isDark={isDark} />
      <div className={`flex justify-between items-center py-2 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className={`h-4 w-24 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        <div className={`h-6 w-16 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <div className={`h-4 w-12 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className={`h-4 w-20 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        </div>
        <div className="flex justify-between items-center">
          <div className={`h-4 w-20 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className={`h-4 w-14 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        </div>
      </div>
      <div className={`text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
        This one can take a minute...
      </div>
    </div>
  )
}

// Component to show funding breakdown
interface SplitInfo {
  percent: number
  projectId: number
  beneficiary: string
}

function FundingBreakdown({
  payoutLimit,
  splits,
  isDark,
  onEdit,
  juicyFeeEnabled,
  onToggleJuicyFee,
  hasEmptyFundAccessLimits
}: {
  payoutLimit?: number;
  splits: SplitInfo[];
  isDark: boolean;
  onEdit?: () => void;
  juicyFeeEnabled: boolean;
  onToggleJuicyFee: (enabled: boolean) => void;
  hasEmptyFundAccessLimits?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false)

  // uint224.max for unlimited payouts
  const UINT224_MAX = '26959946667150639794667015087019630673637144422540572481103610249215'
  const UNLIMITED_THRESHOLD = 1e15 // $1 quadrillion - anything above this is effectively unlimited

  // Check if current value is unlimited (above threshold or uint224.max)
  const isCurrentlyUnlimited = !payoutLimit || payoutLimit >= UNLIMITED_THRESHOLD

  // Initialize edit field as empty for unlimited, otherwise show the dollar amount
  const [editPayoutLimit, setEditPayoutLimit] = useState(
    isCurrentlyUnlimited ? '' : (payoutLimit! / 1000000).toString()
  )

  const formatPercent = (p: number) => `${(p / 10000000).toFixed(1)}%`
  const formatAmount = (limit: number, percent: number) => {
    const amount = (limit / 1000000) * (percent / 1000000000)
    return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
  }

  // Filter out Juicy fee from display (projectId === 1)
  const juicyFee = splits.find(s => s.projectId === 1)
  const displaySplits = splits.filter(s => s.projectId !== 1)

  // Calculate total split percentage and implied owner share
  // When Juicy is disabled, exclude Juicy from calculations
  const activeSplits = juicyFeeEnabled ? splits : displaySplits
  const totalSplitPercent = activeSplits.reduce((sum, s) => sum + s.percent, 0)
  const ownerPercent = 1000000000 - totalSplitPercent // 100% in basis points
  const hasImpliedOwner = ownerPercent > 0 && !activeSplits.some(s => s.projectId === 0 || (s.beneficiary && s.beneficiary !== '0x0000000000000000000000000000000000000000'))

  // Check if payout limit is defined (not unlimited)
  // Unlimited is represented by very large values (type(uint224).max) or 0/undefined
  const hasDefinedLimit = payoutLimit && payoutLimit > 0 && payoutLimit < UNLIMITED_THRESHOLD

  // Calculate effective payout limit - when Juicy is disabled, reduce the limit
  // to the user's original intended amount (floor to remove rounding artifacts)
  const effectivePayoutLimit = useMemo(() => {
    if (!hasDefinedLimit || !juicyFee || juicyFeeEnabled) {
      return payoutLimit
    }
    // Owner's original dollar amount (what they'd get after Juicy's cut)
    const ownerAmount = (payoutLimit! / 1000000) * ((1000000000 - (juicyFee?.percent || 0)) / 1000000000)
    // Floor to get the user's original intended amount (e.g., $5,000.775 → $5,000)
    return Math.floor(ownerAmount) * 1000000
  }, [payoutLimit, juicyFee, juicyFeeEnabled, hasDefinedLimit])

  // Find owner split (projectId 0, regardless of beneficiary)
  const ownerSplit = activeSplits.find(s => s.projectId === 0)

  // When Juicy is disabled, the owner gets 100% of the reduced payout limit
  const effectiveOwnerPercent = !juicyFeeEnabled && juicyFee ? 1000000000 : (ownerSplit?.percent || ownerPercent)

  const handleEdit = () => {
    setIsEditing(true)
  }

  const handleSave = () => {
    // Empty field means unlimited - use uint224.max
    // Otherwise convert dollars to 6 decimal fixed point (USDC decimals)
    const newLimit = editPayoutLimit.trim() === ''
      ? UINT224_MAX  // Unlimited
      : (parseFloat(editPayoutLimit) * 1000000).toString()

    window.dispatchEvent(new CustomEvent('juice:update-funding', {
      detail: { payoutLimit: newLimit }
    }))
    setIsEditing(false)
  }

  const handleCancel = () => {
    // Reset to empty for unlimited, otherwise show the dollar amount
    setEditPayoutLimit(isCurrentlyUnlimited ? '' : (payoutLimit! / 1000000).toString())
    setIsEditing(false)
  }

  return (
    <div className="space-y-3">
      <SectionHeader title="Payout Distribution" isDark={isDark} onEdit={isEditing ? undefined : handleEdit} />

      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Payout Limit (USD)
            </label>
            <input
              type="number"
              value={editPayoutLimit}
              onChange={(e) => setEditPayoutLimit(e.target.value)}
              className={`w-full px-3 py-2 rounded border text-sm ${
                isDark
                  ? 'bg-white/5 border-white/10 text-white placeholder:text-gray-500 focus:border-juice-orange'
                  : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-orange-500'
              } focus:outline-none`}
              placeholder="Leave blank for unlimited"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleCancel}
              className={`px-3 py-1.5 text-xs rounded ${
                isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs rounded bg-juice-orange text-black font-medium hover:bg-juice-orange/90"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Payout limit header - show prominently */}
          <div className={`flex justify-between items-center py-2 ${hasEmptyFundAccessLimits ? '' : `border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}`}>
            <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Payout Limit</span>
            <span className={`font-semibold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {hasEmptyFundAccessLimits
                ? 'None'
                : hasDefinedLimit && effectivePayoutLimit
                  ? `$${(effectivePayoutLimit / 1000000).toLocaleString()}`
                  : 'Unlimited'}
            </span>
          </div>

          {/* Only show splits when there's a payout limit - splits don't matter without one */}
          {!hasEmptyFundAccessLimits && (
          <div className="space-y-2">
            {/* Show implied owner share first (when not explicitly split) */}
            {hasImpliedOwner && (
              <div className="flex justify-between items-center">
                <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>You</span>
                <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {hasDefinedLimit && effectivePayoutLimit ? formatAmount(effectivePayoutLimit, effectiveOwnerPercent) : formatPercent(effectiveOwnerPercent)}
                </span>
              </div>
            )}

            {/* Show explicit owner split if it exists */}
            {ownerSplit && (
              <div className="flex justify-between items-center">
                <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>You</span>
                <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {hasDefinedLimit && effectivePayoutLimit ? formatAmount(effectivePayoutLimit, effectiveOwnerPercent) : formatPercent(effectiveOwnerPercent)}
                </span>
              </div>
            )}

            {/* Show other explicit splits (excluding Juicy fee and owner) */}
            {displaySplits.filter(s =>
              // Exclude owner split by comparing properties (more robust than reference equality)
              !(s.projectId === 0 && ownerSplit && s.percent === ownerSplit.percent && s.beneficiary === ownerSplit.beneficiary)
            ).map((split, i) => (
              <div key={i} className="flex justify-between items-center">
                <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>
                  {split.projectId > 0 ? (
                    <span>Project #{split.projectId}</span>
                  ) : (
                    <span>Recipient</span>
                  )}
                </span>
                <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {hasDefinedLimit && effectivePayoutLimit ? formatAmount(effectivePayoutLimit, split.percent) : formatPercent(split.percent)}
                </span>
              </div>
            ))}

            {/* Show Juicy fee with toggle to opt out */}
            {juicyFee && (
              <div className={`flex justify-between items-center text-sm ${
                juicyFeeEnabled
                  ? (isDark ? 'text-gray-500' : 'text-gray-400')
                  : (isDark ? 'text-gray-600 line-through' : 'text-gray-300 line-through')
              }`}>
                <span className="inline-flex items-center gap-1.5">
                  {/* Toggle checkbox */}
                  <button
                    onClick={() => onToggleJuicyFee(!juicyFeeEnabled)}
                    className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      juicyFeeEnabled
                        ? (isDark
                            ? 'border-gray-600 bg-gray-700 hover:border-gray-500 text-gray-400'
                            : 'border-gray-300 bg-gray-100 hover:border-gray-400 text-gray-500')
                        : (isDark
                            ? 'border-gray-700 bg-transparent hover:border-gray-600'
                            : 'border-gray-200 bg-transparent hover:border-gray-300')
                    }`}
                    title={juicyFeeEnabled ? "Click to leave Juicy" : "Click to join Juicy"}
                  >
                    {juicyFeeEnabled && (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  Join Juicy
                  <InfoPopover
                    content="Help us keep building. JUICY runs like a co-op and is the revenue token that powers this app. When you pay 2.5% into JUICY, you receive JUICY tokens proportional to your payment. As Juicy's balance grows over time, so does the value backing each token."
                    isDark={isDark}
                  />
                </span>
                <span>{hasDefinedLimit ? formatAmount(payoutLimit!, juicyFee.percent) : formatPercent(juicyFee.percent)}</span>
              </div>
            )}
          </div>
          )}
        </>
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
  _isTruncated,
  _isStreaming,
  messageId,
}: TransactionPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const [technicalDetailsReady, setTechnicalDetailsReady] = useState(false)
  const [juicyFeeEnabled, setJuicyFeeEnabled] = useState(true)
  const [showRawJson, setShowRawJson] = useState(false)
  const [issuesAcknowledged, setIssuesAcknowledged] = useState(false)
  const [showDeploymentDetails, setShowDeploymentDetails] = useState(false)
  const [copiedLink, setCopiedLink] = useState<string | null>(null)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  // Server-side persisted state for this component
  const {
    state: persistedState,
    isLoading: persistedStateLoading,
    setState: setPersistedState,
  } = useTransactionPreviewState(messageId)

  // Auth state for managed wallet users - use isManagedMode from hook for consistent state
  const {
    address: managedAddress,
    loading: managedWalletLoading,
    error: managedWalletError,
    isManagedMode
  } = useManagedWallet()

  // External wallet connection (wagmi + SIWE)
  const { address: connectedAddress } = useAccount()
  const siweSession = getWalletSession()
  const externalWalletAddress = connectedAddress || siweSession?.address

  // Effective user address - prefer managed, then external wallet
  const effectiveUserAddress = managedAddress || externalWalletAddress || ''

  // Juicy Identity state - load from localStorage and listen for changes
  const [identity, setIdentity] = useState<{ emoji: string; username: string; formatted: string } | null>(() => {
    try {
      const cached = localStorage.getItem('juicy-identity')
      return cached ? JSON.parse(cached) : null
    } catch { return null }
  })

  useEffect(() => {
    const handleIdentityChange = (e: CustomEvent<{ emoji: string; username: string; formatted: string }>) => {
      setIdentity(e.detail)
    }
    window.addEventListener('juice:identity-changed', handleIdentityChange as EventListener)
    return () => window.removeEventListener('juice:identity-changed', handleIdentityChange as EventListener)
  }, [])

  // Owner ENS name resolution
  const [ownerEns, setOwnerEns] = useState<string | null>(null)

  // Resolve owner ENS when address is available
  useEffect(() => {
    const owner = effectiveUserAddress
    if (!owner || !/^0x[a-fA-F0-9]{40}$/.test(owner)) {
      setOwnerEns(null)
      return
    }
    let cancelled = false
    resolveEnsName(owner).then(name => {
      if (!cancelled && name) {
        setOwnerEns(name)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [effectiveUserAddress])

  // Omnichain launch hook - only used for launchProject action
  const {
    launch,
    bundleState,
    isLaunching,
    isSigning,
    signingChainId,
    isComplete,
    hasError,
    createdProjectIds,
    persistedTxHashes,
    reset: resetLaunch,
  } = useOmnichainLaunchProject({
    deploymentKey: messageId, // Scope localStorage by messageId to prevent state bleeding
    onSuccess: (bundleId, txHashes) => {
      console.log('Projects launched:', bundleId, txHashes)
    },
    onError: (error) => {
      console.error('Launch failed:', error)
    },
  })

  // Track if we've triggered the post-launch follow-up message
  const hasTriggeredFollowUpRef = useRef(false)

  // Trigger AI follow-up message when project launch completes
  useEffect(() => {
    // Only trigger for launch actions
    if (action !== 'launchProject' && action !== 'launch721Project') return

    console.log('[TransactionPreview] Follow-up check:', {
      isComplete,
      createdProjectIds,
      hasTriggeredFollowUp: hasTriggeredFollowUpRef.current,
    })

    // Only trigger once when complete with project IDs
    if (!isComplete || Object.keys(createdProjectIds).length === 0) return
    if (hasTriggeredFollowUpRef.current) return

    hasTriggeredFollowUpRef.current = true

    // Get the primary project (first chain)
    const entries = Object.entries(createdProjectIds).filter(([, pid]) => pid && pid > 0)
    if (entries.length === 0) {
      console.log('[TransactionPreview] No valid project IDs found in entries:', entries)
      return
    }

    const [primaryChainId, primaryProjectId] = entries[0]
    const chainData = CHAINS[Number(primaryChainId)]

    // Small delay to let the success UI render first
    setTimeout(() => {
      console.log('[TransactionPreview] Dispatching post-launch follow-up for project', primaryProjectId, 'on chain', primaryChainId)
      window.dispatchEvent(new CustomEvent('juice:send-message', {
        detail: {
          message: `[SYSTEM: Project #${primaryProjectId} created on ${chainData?.name || 'chain'}. Show project-card for projectId=${primaryProjectId} chainId=${primaryChainId}. After showing the card, invite user to be the first to put $5 into their project, and mention you can show other info about their project like activity, treasury balance, etc.]`,
          bypassSkipAi: true,
        }
      }))
    }, 1000)
  }, [action, isComplete, createdProjectIds])

  // Save completed state to server when transaction finishes
  // This persists the state so all chat participants see the resolved component
  const hasSavedCompletionRef = useRef(false)
  useEffect(() => {
    // Only save for launch actions
    if (action !== 'launchProject' && action !== 'launch721Project') return

    // Only save once when complete with project IDs
    if (!isComplete || Object.keys(createdProjectIds).length === 0) return
    if (hasSavedCompletionRef.current) return
    if (!messageId) return // Can't save without messageId

    hasSavedCompletionRef.current = true

    // Get tx hashes from bundle state
    const txHashes: Record<number, string> = {}
    bundleState.chainStates?.forEach(cs => {
      if (cs.txHash) {
        txHashes[cs.chainId] = cs.txHash
      }
    })

    // Save to server
    setPersistedState({
      status: 'completed',
      projectIds: createdProjectIds,
      txHashes: Object.keys(txHashes).length > 0 ? txHashes : persistedTxHashes || undefined,
      bundleId: bundleState.bundleId || undefined,
      completedAt: new Date().toISOString(),
    })
  }, [action, isComplete, createdProjectIds, bundleState, persistedTxHashes, messageId, setPersistedState])

  // Derived state: use persisted state if available, otherwise use hook state
  const effectiveIsComplete = persistedState?.status === 'completed' || isComplete
  const effectiveProjectIds = (persistedState?.status === 'completed' && persistedState?.projectIds)
    ? persistedState.projectIds
    : createdProjectIds
  const effectiveTxHashes = (persistedState?.status === 'completed' && persistedState?.txHashes)
    ? persistedState.txHashes
    : persistedTxHashes

  // Get draft data collected from forms - use as fallback while transaction JSON streams
  const draftTiers = useProjectDraftStore(state => state.tiers)
  const draftPayoutLimit = useProjectDraftStore(state => state.payoutLimit)
  const draftPayoutCurrency = useProjectDraftStore(state => state.payoutCurrency)

  // Single JSON parse - extract all preview data at once for fast initial render
  const previewData = useMemo(() => {
    if (_isTruncated === 'true') return null
    try {
      // Clean up malformed JSON from AI (e.g., embedded JS expressions)
      let cleanedParams = parameters || '{}'
      const futureTimestamp = Math.floor(Date.now() / 1000 + 300)

      // Pattern 1: Template literal style '${Math.floor(Date.now()/1000) + 300}'
      cleanedParams = cleanedParams.replace(
        /"mustStartAtOrAfter":\s*'\$\{[^}]+\}'/g,
        `"mustStartAtOrAfter": ${futureTimestamp}`
      )
      // Pattern 2: Concatenation style ' + Math.floor(...) + '
      cleanedParams = cleanedParams.replace(
        /"mustStartAtOrAfter":\s*'\s*\+\s*Math\.floor\([^)]+\)\s*\+\s*'/g,
        `"mustStartAtOrAfter": ${futureTimestamp}`
      )
      // Pattern 3: Other concatenation variations
      cleanedParams = cleanedParams.replace(
        /"mustStartAtOrAfter":\s*["']\s*\+[^,}]+\+\s*["']/g,
        `"mustStartAtOrAfter": ${futureTimestamp}`
      )

      const raw = JSON.parse(cleanedParams)

      // Extract project metadata
      const projectMetadata = raw?.projectMetadata as Record<string, unknown> | null

      // Extract tiers info
      let tiersInfo: { tiers: TierInfo[]; currency: number; decimals: number } | null = null
      const tiersConfig = raw?.deployTiersHookConfig?.tiersConfig
      if (tiersConfig?.tiers && Array.isArray(tiersConfig.tiers)) {
        tiersInfo = {
          tiers: tiersConfig.tiers as TierInfo[],
          currency: tiersConfig.currency || 2,
          decimals: tiersConfig.decimals || 6
        }
      }

      // Extract funding info
      let fundingInfo: { splits: SplitInfo[]; payoutLimit?: number; hasEmptyFundAccessLimits?: boolean } | null = null
      const rulesets = raw?.rulesetConfigurations || raw?.launchProjectConfig?.rulesetConfigurations
      if (rulesets && Array.isArray(rulesets) && rulesets.length > 0) {
        const firstRuleset = rulesets[0]
        let splits: SplitInfo[] = []
        let payoutLimit: number | undefined
        let payoutLimitGroupId: string | undefined
        // Track if fundAccessLimitGroups was explicitly set to empty array (means ZERO payouts, not unlimited!)
        let hasEmptyFundAccessLimits = false

        // First, find the payout limit and its currency/groupId
        if (firstRuleset.fundAccessLimitGroups && Array.isArray(firstRuleset.fundAccessLimitGroups)) {
          if (firstRuleset.fundAccessLimitGroups.length === 0) {
            // Empty array means NO payouts allowed (not unlimited!)
            hasEmptyFundAccessLimits = true
          } else {
            for (const group of firstRuleset.fundAccessLimitGroups) {
              if (group.payoutLimits && Array.isArray(group.payoutLimits)) {
                for (const limit of group.payoutLimits) {
                  if (limit.amount) {
                    payoutLimit = typeof limit.amount === 'string' ? parseInt(limit.amount) : limit.amount
                    // The currency field matches the splitGroup's groupId for the same token
                    payoutLimitGroupId = limit.currency?.toString()
                    break
                  }
                }
              }
              if (payoutLimit) break
            }
          }
        }

        // Then extract splits - only from the group matching the payout limit's currency
        if (firstRuleset.splitGroups && Array.isArray(firstRuleset.splitGroups)) {
          for (const group of firstRuleset.splitGroups) {
            // Only include splits from the group that matches the payout limit's currency
            // If no payout limit groupId, include all splits (fallback for edge cases)
            if (payoutLimitGroupId && group.groupId?.toString() !== payoutLimitGroupId) {
              continue
            }
            if (group.splits && Array.isArray(group.splits)) {
              for (const split of group.splits) {
                splits.push({
                  percent: split.percent || 0,
                  projectId: split.projectId || 0,
                  beneficiary: split.beneficiary || ''
                })
              }
            }
            // If we found a matching group, stop looking
            if (payoutLimitGroupId) break
          }
        }

        fundingInfo = { splits, payoutLimit, hasEmptyFundAccessLimits }
      }

      // Check for multi-chain suckers
      const hasMultiChainSuckers = raw?.suckerDeploymentConfiguration?.deployerConfigurations?.length > 0

      return { raw, projectMetadata, tiersInfo, fundingInfo, hasMultiChainSuckers, isValid: true }
    } catch (err) {
      console.error('[TransactionPreview] Failed to parse parameters:', err, parameters?.slice(0, 200))
      return null
    }
  }, [parameters, _isTruncated])

  // "Sticky" content: once we've successfully parsed content, remember it
  // This prevents flashing back to shimmer during state transitions
  const lastValidPreviewData = useRef<typeof previewData>(null)
  if (previewData?.isValid) {
    lastValidPreviewData.current = previewData
  }

  // Use current data if valid, otherwise fall back to last valid data
  const effectivePreviewData = previewData?.isValid ? previewData : lastValidPreviewData.current
  const isParamsValid = effectivePreviewData?.isValid ?? false
  const projectMetadata = effectivePreviewData?.projectMetadata ?? null

  // Helper to generate a random 32-byte hex string for salt
  const generateRandomSalt = (): string => {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  // Stable random salt for preview - generated once per component mount
  const previewSaltRef = useRef<`0x${string}` | null>(null)
  if (!previewSaltRef.current) {
    previewSaltRef.current = generateRandomSalt() as `0x${string}`
  }

  // Helper to transform parameters before display/execution
  // - Updates mustStartAtOrAfter to 5 minutes from now
  // - Randomizes salt values
  // Must be defined before useMemo that uses it
  const updateTimestamps = (obj: unknown): unknown => {
    if (obj === null || obj === undefined) return obj
    if (Array.isArray(obj)) return obj.map(updateTimestamps)
    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (key.toLowerCase() === 'muststartatOrafter'.toLowerCase()) {
          // Always set to 5 minutes from now
          result[key] = Math.floor(Date.now() / 1000) + 300
        } else if (key.toLowerCase() === 'salt') {
          // Always use a random salt for unique deployments
          result[key] = generateRandomSalt()
        } else {
          result[key] = updateTimestamps(value)
        }
      }
      return result
    }
    return obj
  }

  // Helper to encode media URIs into encodedIPFSUri and remove media field
  // This converts the AI's convenience "media" field (ipfs://...) into the contract's
  // expected "encodedIPFSUri" (bytes32 hex) format
  const processMediaUris = (obj: unknown): unknown => {
    if (obj === null || obj === undefined) return obj
    if (Array.isArray(obj)) return obj.map(processMediaUris)
    if (typeof obj === 'object') {
      const record = obj as Record<string, unknown>
      const result: Record<string, unknown> = {}

      for (const [key, value] of Object.entries(record)) {
        // Skip the media field - we'll encode it into encodedIPFSUri
        if (key === 'media') {
          continue
        }
        // If this object has a media field, encode it into encodedIPFSUri
        if (key === 'encodedIPFSUri' && record.media && typeof record.media === 'string') {
          const encoded = encodeIpfsUri(record.media as string)
          result[key] = encoded || value // Use encoded value or fallback to original
        } else {
          result[key] = processMediaUris(value)
        }
      }
      return result
    }
    return obj
  }

  // Deferred full parameter parsing - only computed when technical details are expanded
  // Must be before early return to satisfy React hooks rules
  const parsedParams = useMemo(() => {
    if (!isParamsValid || !technicalDetailsReady) return null
    try {
      const rawParams = JSON.parse(parameters)
      // Apply transformations: timestamps, then media URI encoding
      const withTimestamps = updateTimestamps(rawParams)
      return processMediaUris(withTimestamps) as Record<string, unknown>
    } catch {
      return { raw: parameters }
    }
  }, [parameters, technicalDetailsReady, isParamsValid])

  // When expanded, trigger deferred processing using startTransition
  // Must be before early return to satisfy React hooks rules
  useEffect(() => {
    if (expanded && !technicalDetailsReady) {
      startTransition(() => {
        setTechnicalDetailsReady(true)
      })
    }
  }, [expanded, technicalDetailsReady])

  // Use pre-extracted data from single parse (using effective data for sticky content)
  const hasMultiChainSuckers = effectivePreviewData?.hasMultiChainSuckers ?? false

  // Use draft data as fallback while transaction JSON streams
  // When streamed data arrives, preserve draft tier images (data URLs) since IPFS gateway can be slow
  const tiersInfo = useMemo(() => {
    const streamedTiers = effectivePreviewData?.tiersInfo
    const draftTierImages = new Map(draftTiers.map(t => [t.name.toLowerCase(), t.imageUrl]))

    if (streamedTiers) {
      // Enhance streamed tiers with draft images if available
      return {
        ...streamedTiers,
        tiers: streamedTiers.tiers.map(tier => {
          const draftImage = tier.name ? draftTierImages.get(tier.name.toLowerCase()) : undefined
          // Use draft image if available (data URL loads instantly vs IPFS gateway)
          if (draftImage && !tier.resolvedUri) {
            return { ...tier, resolvedUri: draftImage }
          }
          return tier
        })
      }
    }

    // Fall back to draft tiers if no streamed data
    if (draftTiers.length > 0) {
      return {
        tiers: draftTiers.map(t => ({
          name: t.name,
          price: t.price * (t.currency === 2 ? 1000000 : 1e18),
          currency: t.currency,
          decimals: t.currency === 2 ? 6 : 18,
          initialSupply: 1000000000,
          description: t.description,
          resolvedUri: t.imageUrl,
        })),
        currency: draftTiers[0]?.currency ?? 2,
        decimals: draftTiers[0]?.currency === 2 ? 6 : 18
      }
    }

    return null
  }, [effectivePreviewData?.tiersInfo, draftTiers])

  // Build funding info from streamed data or draft data
  // Prefer draft data if streamed data exists but is empty
  const streamedFundingInfo = effectivePreviewData?.fundingInfo
  const hasStreamedFundingData = streamedFundingInfo && (streamedFundingInfo.payoutLimit || streamedFundingInfo.splits.length > 0 || streamedFundingInfo.hasEmptyFundAccessLimits)
  const draftFundingInfo = draftPayoutLimit ? {
    splits: [
      { percent: 975000000, projectId: 0, beneficiary: '' }, // 97.5% to owner
      { percent: 25000000, projectId: 1, beneficiary: '' },  // 2.5% to Juicy
    ],
    payoutLimit: draftPayoutLimit * (draftPayoutCurrency === 2 ? 1000000 : 1e18),
    hasEmptyFundAccessLimits: false
  } : null
  const fundingInfo = hasStreamedFundingData ? streamedFundingInfo : draftFundingInfo

  // If component is still being streamed (truncated) AND we don't have valid data yet:
  // - If still actively streaming (_isStreaming === true), show shimmer/loading state
  // - If streaming has stopped (_isStreaming === false), show error state
  // This handles 502/timeout errors where the stream dies without completing
  if (_isTruncated === 'true' && !lastValidPreviewData.current) {
    // Streaming stopped but we never got valid data - show error
    if (_isStreaming === false) {
      return (
        <div className={`inline-block border overflow-hidden min-w-[360px] max-w-2xl ${
          isDark
            ? 'bg-juice-dark-lighter border-white/10'
            : 'bg-white border-gray-200'
        }`}>
          <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Response Interrupted
              </span>
            </div>
          </div>
          <div className="px-4 py-3">
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              The response was interrupted before the transaction details could be generated.
              This can happen due to network issues or server timeouts.
              Please try asking again.
            </p>
          </div>
        </div>
      )
    }
    // Still streaming - show shimmer
    return (
      <div className={`inline-block border overflow-hidden min-w-[360px] max-w-2xl ${
        isDark
          ? 'bg-juice-dark-lighter border-white/10'
          : 'bg-white border-gray-200'
      }`}>
        <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className={`h-5 w-40 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          </div>
        </div>
        <div className="px-4 py-3 space-y-2">
          <div className={`h-4 w-full rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className={`h-4 w-3/4 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className={`h-4 w-1/2 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        </div>
        <div className={`px-4 py-3 border-t flex justify-end ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className={`h-9 w-28 rounded animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        </div>
      </div>
    )
  }

  // If parameters are invalid after streaming finished, show error state
  if (!isParamsValid) {
    return (
      <div className={`inline-block border overflow-hidden min-w-[360px] max-w-2xl ${
        isDark
          ? 'bg-juice-dark-lighter border-white/10'
          : 'bg-white border-gray-200'
      }`}>
        <div className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <span className="text-xl">⚠️</span>
            <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Transaction Preview Incomplete
            </span>
          </div>
        </div>
        <div className="px-4 py-3">
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            The response was cut off before the transaction details could be fully generated.
            Please ask me to try again.
          </p>
        </div>
      </div>
    )
  }

  // Parse chain-specific configs for multi-chain deployments
  // Check both the chainConfigs prop AND inside the parameters (AI often puts it there)
  let parsedChainConfigs: ChainOverride[] = []
  try {
    if (chainConfigs) {
      parsedChainConfigs = JSON.parse(chainConfigs)
    } else if (effectivePreviewData?.raw?.chainConfigs && Array.isArray(effectivePreviewData.raw.chainConfigs)) {
      // Fallback: check if chainConfigs is inside the parameters JSON
      parsedChainConfigs = effectivePreviewData.raw.chainConfigs as ChainOverride[]
    }
  } catch {
    // Ignore parsing errors
  }

  const isMultiChain = parsedChainConfigs.length > 0 || hasMultiChainSuckers

  // All supported chains for multi-chain deployments
  const ALL_CHAINS = ['1', '10', '8453', '42161'] // Ethereum, Optimism, Base, Arbitrum

  // Handle undefined/invalid chainId - default to multi-chain if chainConfigs exist
  const validChainId = chainId && chainId !== 'undefined' && CHAIN_NAMES[chainId] ? chainId : null
  const chainName = validChainId ? CHAIN_NAMES[validChainId] : 'Multi-chain'
  const chainColor = validChainId ? CHAIN_COLORS[validChainId] : 'bg-purple-500/20 text-purple-300 border-purple-500/30'
  const actionIcon = ACTION_ICONS[action] || '📝'

  // For launchProject, extract and validate parameters
  const launchValidation = useMemo(() => {
    if (action !== 'launchProject' && action !== 'launch721Project') return null
    if (!effectivePreviewData?.raw) return null

    const raw = effectivePreviewData.raw

    // Check for nested launchProjectConfig structure
    const launchConfig = raw.launchProjectConfig as Record<string, unknown> | undefined

    // Get owner from params or use connected wallet address
    // Check both top-level and nested in launchProjectConfig
    const ownerFromParams = (raw.owner as string | undefined) || (launchConfig?.owner as string | undefined)
    const owner = ownerFromParams || effectiveUserAddress

    // Get project URI (check both top-level and nested)
    const projectUri = (raw.projectUri as string) || (launchConfig?.projectUri as string) || ''

    // Get chain IDs
    // For launch actions, default to ALL chains (omnichain) unless chainConfigs specifies otherwise
    // A single chainId prop is ignored for launch - we always go multi-chain
    let launchChainIds: number[] = []
    if (parsedChainConfigs.length > 0) {
      launchChainIds = parsedChainConfigs.map(c => Number(c.chainId))
    } else {
      // Default to all supported chains for omnichain deployment
      launchChainIds = [...ALL_CHAIN_IDS]
    }

    // Get ruleset configurations (check both top-level and nested in launchProjectConfig)
    // 1. Replace USER_WALLET placeholders with the actual owner address
    // 2. Update mustStartAtOrAfter to 5 minutes from NOW (at launch time, not preview generation time)
    const rawRulesetConfigurations = (raw.rulesetConfigurations as unknown[]) ||
      (launchConfig?.rulesetConfigurations as unknown[]) || []
    const withWalletPlaceholders = replaceWalletPlaceholders(rawRulesetConfigurations, owner)
    // Apply timestamp updates so mustStartAtOrAfter is always fresh at click time
    const rulesetConfigurations = updateTimestampsForLaunch(withWalletPlaceholders)

    // Get terminal configurations (check both top-level and nested in launchProjectConfig)
    const terminalConfigurations = (raw.terminalConfigurations as unknown[]) ||
      (launchConfig?.terminalConfigurations as unknown[]) || []

    // Get memo (check both top-level and nested)
    const memo = (raw.memo as string) || (launchConfig?.memo as string) || 'Project launch via Juicy Vision'

    // Get sucker deployment configuration (for atomic project+sucker deployment via JBOmnichainDeployer)
    // If not provided by AI and deploying to multiple chains, auto-generate it
    let suckerDeploymentConfiguration = raw.suckerDeploymentConfiguration as {
      deployerConfigurations: Array<{
        deployer: string
        mappings: Array<{
          localToken: string
          remoteToken: string
          minGas: number
          minBridgeAmount: string
        }>
      }>
      salt: string
    } | undefined

    // Auto-generate sucker config for multi-chain deployments
    // This mirrors what buildOmnichainLaunchTransactions does at launch time
    // Note: Use a fixed preview salt - actual salt is generated at launch time
    // Also auto-generate if the AI provided an empty config (deployerConfigurations: [])
    const hasEmptyConfig = !suckerDeploymentConfiguration?.deployerConfigurations?.length

    if (hasEmptyConfig && shouldConfigureSuckers(launchChainIds)) {
      // Extract per-chain token addresses from terminal configurations
      // This enables proper ERC20 bridging (e.g., USDC on each chain)
      const tokenAddresses: Record<number, `0x${string}`> = {}
      for (const chainId of launchChainIds) {
        // Check for per-chain override first
        const chainConfig = parsedChainConfigs.find(c => Number(c.chainId) === chainId)
        const chainTerminalConfigs = (chainConfig?.overrides?.terminalConfigurations as JBTerminalConfig[] | undefined) ?? terminalConfigurations

        // Look for the first non-native ERC20 token
        for (const terminal of (chainTerminalConfigs as JBTerminalConfig[])) {
          for (const ctx of terminal.accountingContextsToAccept) {
            const tokenAddr = ctx.token as string
            // Skip native token (0xEEEe...) - we want ERC20 tokens
            if (tokenAddr && tokenAddr.toLowerCase() !== '0x000000000000000000000000000000000000eeee') {
              tokenAddresses[chainId] = tokenAddr as `0x${string}`
              break
            }
          }
          if (tokenAddresses[chainId]) break
        }
      }

      const hasTokenAddresses = Object.keys(tokenAddresses).length > 0
      const firstChainId = launchChainIds[0]
      const generatedConfig = parseSuckerDeployerConfig(firstChainId, launchChainIds, {
        salt: previewSaltRef.current!,
        tokenAddresses: hasTokenAddresses ? tokenAddresses : undefined,
      })

      if (generatedConfig.deployerConfigurations.length > 0) {
        suckerDeploymentConfiguration = {
          deployerConfigurations: generatedConfig.deployerConfigurations.map(dc => ({
            deployer: dc.deployer,
            mappings: dc.mappings.map(m => ({
              localToken: m.localToken,
              remoteToken: m.remoteToken,
              minGas: m.minGas,
              minBridgeAmount: m.minBridgeAmount.toString(),
            })),
          })),
          salt: previewSaltRef.current!, // Must be valid bytes32, not a display string
        }
      }
    }

    // Validate - but skip validation if we're in managed mode and still loading the wallet
    const isWaitingForManagedWallet = isManagedMode && !managedAddress && managedWalletLoading
    // Also handle wallet error state - don't show "Invalid owner" when the real issue is auth
    const hasWalletError = isManagedMode && !managedAddress && !!managedWalletError
    const verification = verifyLaunchProjectParams({
      owner: (isWaitingForManagedWallet || hasWalletError) ? '0x0000000000000000000000000000000000000001' : owner, // Use placeholder to avoid false critical during loading or error
      projectUri,
      chainIds: launchChainIds,
      rulesetConfigurations,
      terminalConfigurations,
      memo,
    })

    // Check if the only issue is missing owner (user not signed in)
    // In this case, we don't need to show scary warnings - just prompt to sign in
    const ownerDoubts = verification.doubts.filter(d =>
      d.field === 'owner' || d.message.toLowerCase().includes('owner')
    )
    const nonOwnerDoubts = verification.doubts.filter(d =>
      d.field !== 'owner' && !d.message.toLowerCase().includes('owner')
    )
    const onlyOwnerIssue = ownerDoubts.length > 0 && nonOwnerDoubts.length === 0 && !owner

    // Filter out owner-related issues while waiting for managed wallet or if there's a wallet error
    let filteredDoubts = (isWaitingForManagedWallet || hasWalletError || onlyOwnerIssue)
      ? nonOwnerDoubts
      : verification.doubts

    // If there's a wallet error, add a specific doubt for it
    if (hasWalletError) {
      filteredDoubts = [
        {
          field: 'owner',
          message: `Authentication error: ${managedWalletError}. Please sign out and sign in again.`,
          severity: 'critical' as const,
        },
        ...filteredDoubts,
      ]
    }

    // Convert parsedChainConfigs to the format expected by buildOmnichainLaunchTransactions
    const chainConfigOverrides = parsedChainConfigs.map(cfg => ({
      chainId: Number(cfg.chainId),
      terminalConfigurations: cfg.overrides?.terminalConfigurations as JBTerminalConfig[] | undefined,
    })).filter(cfg => cfg.terminalConfigurations)

    // Extract per-chain token addresses for sucker config display
    // This shows which ERC20 tokens will be bridged between chains
    const extractedTokenAddresses: Record<number, `0x${string}`> = {}
    for (const cid of launchChainIds) {
      const chainConfig = parsedChainConfigs.find(c => Number(c.chainId) === cid)
      const chainTerminalConfigs = (chainConfig?.overrides?.terminalConfigurations as JBTerminalConfig[] | undefined) ?? (terminalConfigurations as JBTerminalConfig[])

      for (const terminal of chainTerminalConfigs) {
        for (const ctx of terminal.accountingContextsToAccept) {
          const tokenAddr = ctx.token as string
          if (tokenAddr && tokenAddr.toLowerCase() !== '0x000000000000000000000000000000000000eeee') {
            extractedTokenAddresses[cid] = tokenAddr as `0x${string}`
            break
          }
        }
        if (extractedTokenAddresses[cid]) break
      }
    }

    return {
      owner,
      projectUri,
      chainIds: launchChainIds,
      rulesetConfigurations,
      terminalConfigurations,
      memo,
      suckerDeploymentConfiguration,
      chainConfigs: chainConfigOverrides.length > 0 ? chainConfigOverrides : undefined,
      tokenAddresses: Object.keys(extractedTokenAddresses).length > 0 ? extractedTokenAddresses : undefined,
      projectName: (projectMetadata?.name as string) || 'New Project',
      doubts: filteredDoubts,
      hasIssues: filteredDoubts.length > 0,
      hasCritical: filteredDoubts.some(d => d.severity === 'critical'),
      isWaitingForWallet: isWaitingForManagedWallet,
      hasWalletError,
      onlyOwnerIssue, // True when user just needs to sign in
    }
  }, [action, effectivePreviewData?.raw, effectiveUserAddress, isManagedMode, managedAddress, managedWalletLoading, managedWalletError, parsedChainConfigs, validChainId, projectMetadata?.name])

  // Handle launch button click
  const handleLaunchClick = useCallback(async () => {
    if (!launchValidation) return
    if (launchValidation.hasCritical && !issuesAcknowledged) return

    const {
      owner,
      projectUri,
      chainIds,
      rulesetConfigurations,
      terminalConfigurations,
      memo,
      chainConfigs,
    } = launchValidation

    // Note: DON'T pass suckerDeploymentConfiguration here!
    // The preview generates it only for display (first chain only).
    // Let buildOmnichainLaunchTransactions auto-generate per-chain configs.
    await launch({
      chainIds,
      owner,
      projectUri,
      rulesetConfigurations: rulesetConfigurations as JBRulesetConfig[],
      terminalConfigurations: terminalConfigurations as JBTerminalConfig[],
      memo,
      chainConfigs, // Per-chain terminal overrides (different USDC addresses, etc.)
    })
  }, [launchValidation, issuesAcknowledged, launch])

  // Can proceed with launch?
  const canLaunch = launchValidation &&
    !launchValidation.isWaitingForWallet &&
    launchValidation.owner &&
    (!launchValidation.hasCritical || issuesAcknowledged)

  return (
    <div className={`inline-block border overflow-hidden min-w-[360px] max-w-2xl ${
      isDark
        ? 'bg-juice-dark-lighter border-white/10'
        : 'bg-white border-gray-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${
        isDark ? 'border-white/10' : 'border-gray-200'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Review for deployment
          </span>
        </div>
      </div>

      {/* Project metadata preview */}
      {projectMetadata && (
        <div className={`px-4 py-3 ${isDark ? '' : ''}`}>
          <ProjectMetadataPreview
            metadata={projectMetadata}
            isDark={isDark}
            onEdit={() => window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: 'I want to edit the project details' } }))}
          />
        </div>
      )}

      {/* Tiers preview for launch721Project - show skeleton if expected but not loaded */}
      {action === 'launch721Project' && (
        <div className={`px-4 py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <TiersPreview
            tiers={tiersInfo?.tiers || []}
            currency={tiersInfo?.currency || 2}
            decimals={tiersInfo?.decimals || 6}
            isDark={isDark}
            onEdit={() => window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: 'I want to edit the reward tiers' } }))}
            isLoading={!tiersInfo || tiersInfo.tiers.length === 0}
          />
        </div>
      )}

      {/* Funding breakdown - show skeleton if expected but not loaded */}
      {(action === 'launch721Project' || action === 'launchProject') && (
        <div className={`px-4 py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          {fundingInfo && (fundingInfo.payoutLimit || fundingInfo.splits.length > 0 || fundingInfo.hasEmptyFundAccessLimits) ? (
            <FundingBreakdown
              payoutLimit={fundingInfo.payoutLimit}
              splits={fundingInfo.splits}
              isDark={isDark}
              onEdit={() => window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message: 'I want to edit the payout distribution' } }))}
              juicyFeeEnabled={juicyFeeEnabled}
              onToggleJuicyFee={setJuicyFeeEnabled}
              hasEmptyFundAccessLimits={fundingInfo.hasEmptyFundAccessLimits}
            />
          ) : (
            <FundingSkeleton isDark={isDark} />
          )}
        </div>
      )}

      {/* Owner section for launch actions */}
      {(action === 'launchProject' || action === 'launch721Project') && launchValidation && (
        <div className={`px-4 py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <SectionHeader title="Project Owner" isDark={isDark} />
          <div className={`mt-2 p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            {/* Show loading state only while managed wallet is loading */}
            {managedWalletLoading ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-juice-cyan border-t-transparent rounded-full" />
                <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Loading...
                </span>
              </div>
            ) : managedWalletError ? (
              <div className={`text-sm ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                <span className="font-medium">Session expired.</span>{' '}
                <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Please sign out and sign in again to continue.</span>
              </div>
            ) : launchValidation.owner ? (
              <div className="flex items-center gap-2">
                {/* Check if owner is current user (managed wallet or external wallet) */}
                {effectiveUserAddress && launchValidation.owner.toLowerCase() === effectiveUserAddress.toLowerCase() ? (
                  // Owner is current user - show identity, ENS, or "You"
                  <span className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {identity ? identity.formatted : ownerEns || 'You'}
                  </span>
                ) : (
                  // Owner is someone else - show ENS or truncated address
                  <span className={`${ownerEns ? 'text-sm' : 'font-mono text-sm'} ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {ownerEns || `${launchValidation.owner.slice(0, 8)}...${launchValidation.owner.slice(-6)}`}
                  </span>
                )}
              </div>
            ) : (
              <span className={`text-sm ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
                {isManagedMode
                  ? 'Session expired'
                  : 'No owner address - sign in below'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Brief explanation if no rich preview available */}
      {!projectMetadata && !tiersInfo && !fundingInfo && (
        <div className="px-4 py-3">
          <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
            {explanation}
          </p>
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
              <span>Function</span>
              <span className="font-mono">{ACTION_FUNCTION_NAMES[action] || action}</span>
            </div>

            {/* Chain tags */}
            <div className={`flex justify-between items-start ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
              <span>Chains</span>
              <div className="flex gap-1 flex-wrap justify-end">
                {isMultiChain ? (
                  (parsedChainConfigs.length > 0 ? parsedChainConfigs.map(c => c.chainId) : ALL_CHAINS).map((cid) => {
                    const config = parsedChainConfigs.find(c => c.chainId === cid)
                    const name = config?.label || CHAIN_NAMES[cid] || `Chain ${cid}`
                    const color = CHAIN_COLORS[cid] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'
                    return (
                      <span key={cid} className={`px-2 py-0.5 text-xs font-medium border ${color}`}>
                        {name}
                      </span>
                    )
                  })
                ) : validChainId ? (
                  <span className={`px-2 py-0.5 text-xs font-medium border ${chainColor}`}>
                    {chainName}
                  </span>
                ) : (
                  <span className="font-mono">Unknown</span>
                )}
              </div>
            </div>

            {projectId && (
              <div className={`flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                <span>Project</span>
                <span className="font-mono">#{projectId}</span>
              </div>
            )}

            {/* Owner address for launch actions */}
            {(action === 'launchProject' || action === 'launch721Project') && launchValidation?.owner && (
              <div className={`flex justify-between items-center ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                <span>Owner</span>
                <div className="flex items-center gap-2">
                  <span className={ownerEns ? '' : 'font-mono'}>
                    {ownerEns || `${launchValidation.owner.slice(0, 8)}...${launchValidation.owner.slice(-6)}`}
                  </span>
                  {isManagedMode && (
                    <span className={`text-[10px] px-1.5 py-0.5 ${isDark ? 'bg-juice-cyan/20 text-juice-cyan' : 'bg-teal-100 text-teal-700'}`}>
                      Touch ID Wallet
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Toggle between structured and raw JSON view */}
            {parsedParams && (
              <div className={`flex justify-end pt-2 pb-1 border-t mt-2 ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className={`text-xs px-2 py-0.5 rounded ${
                    isDark
                      ? 'text-gray-400 hover:text-gray-300 hover:bg-white/5'
                      : 'text-gray-500 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {showRawJson ? 'Structured View' : 'Raw JSON'}
                </button>
              </div>
            )}

            {parsedParams ? (
              showRawJson ? (
                <pre className={`text-[10px] leading-relaxed overflow-x-auto p-2 rounded max-h-96 overflow-y-auto ${
                  isDark ? 'bg-black/30 text-gray-300' : 'bg-gray-50 text-gray-700'
                }`}>
                  {JSON.stringify(parsedParams, null, 2)}
                </pre>
              ) : (
                <>
                  {/* For launch actions, show owner first (derived from wallet) */}
                  {(action === 'launchProject' || action === 'launch721Project') && launchValidation?.owner && (
                    <ParamRow key="owner" name="owner" value={launchValidation.owner} isDark={isDark} chainId={chainId} />
                  )}
                  {Object.entries(parsedParams)
                    .filter(([key]) => !['chainConfigs', 'projectMetadata', 'suckerDeploymentConfiguration', 'raw', 'launchProjectConfig'].includes(key)) // Hide fields shown separately
                    .map(([key, value]) => (
                    <ParamRow key={key} name={key} value={value} isDark={isDark} chainId={chainId} />
                  ))}
                  {/* For launch actions, show suckerDeploymentConfiguration with chain-specific deployers */}
                  {(action === 'launchProject' || action === 'launch721Project') && launchValidation?.chainIds && launchValidation.chainIds.length > 1 && (
                    <SuckerConfigSection
                      allChainIds={launchValidation.chainIds}
                      tokenAddresses={launchValidation.tokenAddresses}
                      salt={launchValidation.suckerDeploymentConfiguration?.salt || '0x0000000000000000000000000000000000000000000000000000000000000000'}
                      isDark={isDark}
                    />
                  )}
                  {/* For launch actions, show controller last (default value) */}
                  {(action === 'launchProject' || action === 'launch721Project') && (
                    <ParamRow key="controller" name="controller" value="0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1" isDark={isDark} chainId={chainId} />
                  )}
                </>
              )
            ) : (
              <div className={`flex items-center gap-2 py-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Loading parameters...</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Launch progress section - shown when launching */}
      {(action === 'launchProject' || action === 'launch721Project') && (isLaunching || effectiveIsComplete || hasError) && (
        <div className={`px-4 py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          {/* Success state with shareable links */}
          {effectiveIsComplete && Object.keys(effectiveProjectIds).length > 0 && (
            <div className="space-y-4">
              <div className={`-mx-4 px-4 py-3 text-center border-y ${isDark ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'}`}>
                <p className={`font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Project Created!
                </p>
              </div>

              {/* Shareable links - show primary chain's link prominently */}
              <div className="space-y-2">
                {Object.entries(effectiveProjectIds)
                  .filter(([, projectId]) => projectId && projectId > 0)
                  .map(([chainIdStr, projectIdNum], index) => {
                    const chainData = CHAINS[Number(chainIdStr)]
                    const projectUrl = `juicy.vision/${chainData?.slug || 'eth'}:${projectIdNum}`
                    const fullUrl = `https://${projectUrl}`
                    const isCopied = copiedLink === projectUrl

                    return (
                      <button
                        key={chainIdStr}
                        onClick={() => {
                          navigator.clipboard.writeText(fullUrl)
                          setCopiedLink(projectUrl)
                          setTimeout(() => setCopiedLink(null), 2000)
                        }}
                        className={`w-full p-3 flex items-center justify-between transition-colors ${
                          index === 0
                            ? isDark
                              ? 'bg-juice-cyan/20 hover:bg-juice-cyan/30 border border-juice-cyan/30'
                              : 'bg-cyan-50 hover:bg-cyan-100 border border-cyan-200'
                            : isDark
                              ? 'bg-white/5 hover:bg-white/10'
                              : 'bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: chainData?.color || '#888' }}
                          />
                          <span className={`font-mono text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            {projectUrl}
                          </span>
                        </div>
                        <span className={`text-xs font-medium ${
                          isCopied
                            ? 'text-green-500'
                            : isDark ? 'text-gray-400' : 'text-gray-500'
                        }`}>
                          {isCopied ? '✓ Copied!' : 'Copy'}
                        </span>
                      </button>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Error state */}
          {hasError && bundleState.error && (
            <div className={`p-4 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              <div className="text-2xl mb-2">❌</div>
              <p className={`font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                Deployment failed
              </p>
              <p className={`text-sm mt-1 ${isDark ? 'text-red-400/80' : 'text-red-500'}`}>
                {bundleState.error}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Issues section - shown for launch actions with validation issues, but only after data is loaded */}
      {launchValidation && launchValidation.hasIssues && !isLaunching && !effectiveIsComplete && !managedWalletLoading && fundingInfo && (
        <div className={`px-4 py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className={`p-3 border-l-4 ${
            launchValidation.hasCritical
              ? isDark ? 'bg-red-500/10 border-red-500' : 'bg-red-50 border-red-500'
              : isDark ? 'bg-yellow-500/10 border-yellow-500' : 'bg-yellow-50 border-yellow-500'
          }`}>
            <div className={`text-sm font-medium mb-2 ${
              launchValidation.hasCritical
                ? isDark ? 'text-red-400' : 'text-red-700'
                : isDark ? 'text-yellow-400' : 'text-yellow-700'
            }`}>
              {launchValidation.hasCritical ? '! Review Required' : 'Warnings'}
            </div>
            <div className="space-y-1">
              {launchValidation.doubts.map((doubt, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={`text-xs px-1.5 py-0.5 font-medium ${
                    doubt.severity === 'critical'
                      ? isDark ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700'
                      : isDark ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {doubt.severity === 'critical' ? 'Critical' : 'Warning'}
                  </span>
                  <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {doubt.message}
                  </span>
                </div>
              ))}
            </div>
            {launchValidation.hasCritical && (
              <label className={`flex items-center gap-2 mt-3 cursor-pointer ${
                isDark ? 'text-gray-400' : 'text-gray-600'
              }`}>
                <input
                  type="checkbox"
                  checked={issuesAcknowledged}
                  onChange={(e) => setIssuesAcknowledged(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-xs">I understand the risks and want to proceed anyway</span>
              </label>
            )}
          </div>
        </div>
      )}

      {/* Action button - hide entire section when complete with project IDs */}
      {!((action === 'launchProject' || action === 'launch721Project') && effectiveIsComplete && Object.keys(effectiveProjectIds).length > 0) && (
      <div className={`px-4 py-3 border-t flex justify-end ${
        isDark ? 'border-white/10' : 'border-gray-200'
      }`}>
        {(action === 'launchProject' || action === 'launch721Project') ? (
          // Direct launch execution for launch actions
          isLaunching ? (
            <button
              disabled
              className="px-5 py-2 text-sm font-bold border-2 bg-gray-500 text-white border-gray-500 cursor-not-allowed opacity-75"
            >
              <span className="flex items-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Launching...
              </span>
            </button>
          ) : (
            <button
              onClick={launchValidation?.owner ? handleLaunchClick : (e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                window.dispatchEvent(new CustomEvent('juice:open-wallet-panel', {
                  detail: { anchorPosition: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } }
                }))
              }}
              disabled={launchValidation?.owner ? !canLaunch : false}
              className={`px-5 py-2 text-sm font-bold border-2 transition-colors ${
                !launchValidation?.owner
                  ? 'bg-green-500 text-black border-green-500 hover:bg-green-600 hover:border-green-600'
                  : canLaunch
                    ? 'bg-green-500 text-black border-green-500 hover:bg-green-600 hover:border-green-600'
                    : 'bg-gray-500 text-white border-gray-500 cursor-not-allowed opacity-75'
              }`}
            >
              {launchValidation?.owner ? (ACTION_BUTTON_LABELS[action] || action) : 'Sign in'}
            </button>
          )
        ) : (
          // Original dispatch for other actions
          <button
            onClick={() => {
              // Parse parameters on-demand for the action (avoids waiting for deferred parsing)
              let actionParams: Record<string, unknown>
              try {
                const rawParams = JSON.parse(parameters)
                // Apply transformations: timestamps, then media URI encoding
                const withTimestamps = updateTimestamps(rawParams)
                actionParams = processMediaUris(withTimestamps) as Record<string, unknown>

                // If Juicy fee is disabled, remove the Juicy split (projectId === 1)
                if (!juicyFeeEnabled) {
                  const removeJuicySplit = (obj: unknown): unknown => {
                    if (obj === null || obj === undefined) return obj
                    if (Array.isArray(obj)) return obj.map(removeJuicySplit)
                    if (typeof obj === 'object') {
                      const record = obj as Record<string, unknown>
                      // Check if this is a splitGroups array
                      if (record.splitGroups && Array.isArray(record.splitGroups)) {
                        record.splitGroups = (record.splitGroups as Array<{ groupId?: string; splits?: Array<{ projectId?: number }> }>).map(group => ({
                          ...group,
                          splits: group.splits?.filter(split => split.projectId !== 1) || []
                        }))
                      }
                      // Recursively process all values
                      const result: Record<string, unknown> = {}
                      for (const [key, value] of Object.entries(record)) {
                        result[key] = removeJuicySplit(value)
                      }
                      return result
                    }
                    return obj
                  }
                  actionParams = removeJuicySplit(actionParams) as Record<string, unknown>
                }
              } catch {
                actionParams = { raw: parameters }
              }
              window.dispatchEvent(new CustomEvent('juice:execute-action', {
                detail: { action, contract, chainId: validChainId || '1', projectId, parameters: actionParams }
              }))
            }}
            className="px-5 py-2 text-sm font-bold border-2 bg-green-500 text-black border-green-500 hover:bg-green-600 hover:border-green-600 transition-colors"
          >
            {ACTION_BUTTON_LABELS[action] || action}
          </button>
        )}
      </div>
      )}

      {/* Deployment details - shown at bottom when launching/complete/error */}
      {(action === 'launchProject' || action === 'launch721Project') && (isLaunching || effectiveIsComplete || hasError) && (
        <div className={`px-4 py-2 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <button
            onClick={() => setShowDeploymentDetails(!showDeploymentDetails)}
            className={`flex items-center gap-2 text-xs ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
          >
            <span className={`transform transition-transform ${showDeploymentDetails ? 'rotate-90' : ''}`}>›</span>
            {showDeploymentDetails ? 'Hide' : 'Show'} deployment details
          </button>

          {showDeploymentDetails && (
            <div className="mt-2 space-y-1">
              {/* Use launchValidation chainIds if available, otherwise derive from effectiveProjectIds */}
              {(launchValidation?.chainIds ?? Object.keys(effectiveProjectIds).map(Number).filter(id => id > 0)).map((cid) => {
                const chain = CHAINS[cid]
                const chainState = bundleState.chainStates.find(cs => cs.chainId === cid)
                const createdProjectId = effectiveProjectIds[cid]
                // Use persisted tx hash if available (page reload case), otherwise from chainState
                const txHash = effectiveTxHashes?.[cid] ?? chainState?.txHash
                // If we have persisted data but no chainState, show as confirmed
                const isPersistedComplete = !chainState && effectiveTxHashes?.[cid]

                return (
                  <div
                    key={cid}
                    className={`p-2 flex items-center justify-between text-xs ${
                      isDark ? 'bg-white/5' : 'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: chain?.color || '#888' }}
                      />
                      <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>
                        {chain?.shortName || `Chain ${cid}`}
                      </span>
                      {createdProjectId > 0 && (
                        <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>
                          #{createdProjectId}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!chainState && !isPersistedComplete && <span className={isDark ? 'text-gray-600' : 'text-gray-400'}>Waiting</span>}
                      {chainState?.status === 'pending' && <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Pending</span>}
                      {chainState?.status === 'submitted' && (
                        <span className="text-juice-orange">Creating...</span>
                      )}
                      {(chainState?.status === 'confirmed' || isPersistedComplete) && (
                        <div className="flex items-center gap-1">
                          <span className="text-green-500">✓</span>
                          {txHash && EXPLORER_URLS[cid] && (
                            <a
                              href={`${EXPLORER_URLS[cid]}${txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-juice-cyan hover:underline"
                            >
                              tx
                            </a>
                          )}
                        </div>
                      )}
                      {chainState?.status === 'failed' && <span className="text-red-400">Failed</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

    </div>
  )
}

// Component to render a parameter row with support for nested objects
// Uses shared utilities from technicalDetails.ts
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
    const isAddress = typeof value === 'string' && value.startsWith('0x') && value.length === 42
    // Check if this is a currency field with a numeric USDC value
    const isCurrencyField = name.toLowerCase() === 'currency' && typeof value === 'number' && isUsdcCurrency(value)
    // Check for unlimited marker (uint224.max values in fund access limits)
    const isUnlimited = formattedValue.startsWith('UNLIMITED_MARKER:')
    const unlimitedRawValue = isUnlimited ? formattedValue.replace('UNLIMITED_MARKER:', '') : null

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
          <span className="shrink-0">
            {displayName}
          </span>
          {isUnlimited ? (
            <span className={`font-mono text-right flex items-center gap-1 ${isDark ? 'text-green-400' : 'text-green-600'}`}>
              Unlimited
              <InfoPopover
                content={`This is the maximum value (uint224.max) which means unlimited. Raw value: ${unlimitedRawValue}`}
                isDark={isDark}
              />
            </span>
          ) : isIpfsUri ? (
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
          ) : isAddress ? (
            <span className="text-right break-all">
              <AddressDisplay address={value as string} chainId={chainId} isDark={isDark} />
            </span>
          ) : isCurrencyField ? (
            <span className="text-right break-all">
              <CurrencyDisplay currency={value as number} isDark={isDark} />
            </span>
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

  // For single-item arrays with generic labels or no labels, skip the wrapper and show content directly
  // But keep the toggle for important structural arrays like splitGroups and splits
  if (Array.isArray(value) && value.length === 1) {
    const label = getArrayItemLabel(name, 0)
    const nameLower = name.toLowerCase()
    const keepToggle = nameLower.includes('splitgroup') || nameLower === 'splits' || nameLower === 'tiers'
    // Skip the wrapper if label is empty or generic "Item N", unless it's an important structural array
    if (!keepToggle && (label === '' || label.startsWith('Item '))) {
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
    // For arrays that keep toggle but have empty item labels, show header with toggle but render item contents directly
    if (keepToggle && label === '') {
      const innerValue = value[0]
      if (typeof innerValue === 'object' && innerValue !== null) {
        const fields = Object.entries(innerValue as Record<string, unknown>)
        return (
          <div style={{ paddingLeft: indent }}>
            <button
              onClick={() => setExpanded(!expanded)}
              className={`flex items-center gap-1.5 w-full text-left py-0.5 ${isDark ? 'text-gray-300 hover:text-gray-200' : 'text-gray-600 hover:text-gray-700'}`}
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
                {fields.length} fields
              </span>
            </button>
            {expanded && (
              <div className={`mt-0.5 space-y-0 border-l pl-3 ml-1.5 ${isDark ? 'border-gray-700' : 'border-gray-300'}`}>
                {fields.map(([k, v]) => (
                  <ParamRow key={k} name={k} value={v} isDark={isDark} depth={depth + 1} parentName={name} chainId={chainId} />
                ))}
              </div>
            )}
          </div>
        )
      }
    }
  }

  // For multi-item arrays where items should render without labels (like splits)
  if (Array.isArray(value) && value.length > 1) {
    const label = getArrayItemLabel(name, 0)
    if (label === '') {
      // Render items directly without "[0]", "[1]" labels
      return (
        <div style={{ paddingLeft: indent }}>
          <button
            onClick={() => setExpanded(!expanded)}
            className={`flex items-center gap-1.5 w-full text-left py-0.5 ${isDark ? 'text-gray-300 hover:text-gray-200' : 'text-gray-600 hover:text-gray-700'}`}
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
              {value.length} items
            </span>
          </button>
          {expanded && (
            <div className={`mt-0.5 space-y-1 border-l pl-3 ml-1.5 ${isDark ? 'border-gray-700' : 'border-gray-300'}`}>
              {value.map((item, i) => (
                <div key={i} className={`${i > 0 ? 'pt-1 border-t ' + (isDark ? 'border-gray-700/50' : 'border-gray-200') : ''}`}>
                  {typeof item === 'object' && item !== null ? (
                    Object.entries(item as Record<string, unknown>).map(([k, v]) => (
                      <ParamRow key={k} name={k} value={v} isDark={isDark} depth={depth + 1} parentName={name} chainId={chainId} />
                    ))
                  ) : (
                    <span className="font-mono">{String(item)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )
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
