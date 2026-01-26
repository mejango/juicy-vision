import { useState, useEffect } from 'react'
import { resolveEnsName, truncateAddress } from '../../utils/ens'
import {
  formatParamName,
  formatSimpleValue,
  getAddressLabel,
  getParamTooltip,
  isComplexValue,
  isEmptyArray,
  getArrayItemLabel,
  isUsdcAddress,
  USDC_ADDRESSES,
  CHAIN_NAMES,
  CHAIN_COLORS,
} from '../../utils/technicalDetails'

export interface TechnicalDetailsProps {
  /** Contract identifier name e.g. "JB_MULTI_TERMINAL" */
  contract: string
  /** Contract address e.g. "0x52869db..." */
  contractAddress: string
  /** Function name e.g. "pay" */
  functionName: string
  /** Chain ID */
  chainId: number
  /** Chain name override */
  chainName?: string
  /** Project ID if applicable */
  projectId?: string | number
  /** Transaction parameters */
  parameters: Record<string, unknown>
  /** Dark mode flag */
  isDark: boolean
  /** Default expanded state */
  defaultExpanded?: boolean
  /** All chains for multi-chain display */
  allChains?: Array<{ chainId: number; chainName: string; projectId?: number }>
}

// Component to display an address with optional ENS name
function AddressDisplay({ address, chainId, isDark }: { address: string; chainId?: string | number; isDark: boolean }) {
  const [ensName, setEnsName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showChainAddresses, setShowChainAddresses] = useState(false)

  useEffect(() => {
    const chainStr = chainId?.toString()
    const knownLabel = getAddressLabel(address, chainStr)
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

  const chainStr = chainId?.toString()
  const label = getAddressLabel(address, chainStr)
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
          chain-specific {showChainAddresses ? '\u25B2' : '\u25BC'}
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
          {Object.entries(USDC_ADDRESSES).map(([cid, addr]) => (
            <div key={cid} className="flex gap-2 py-0.5">
              <span className={`font-medium w-16 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
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
    const isAddress = typeof value === 'string' && value.startsWith('0x') && value.length === 42

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
          ) : isAddress ? (
            <span className="text-right break-all">
              <AddressDisplay address={value as string} chainId={chainId} isDark={isDark} />
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

  // For single-item arrays with generic labels or no labels, skip the wrapper
  if (Array.isArray(value) && value.length === 1) {
    const label = getArrayItemLabel(name, 0)
    const nameLower = name.toLowerCase()
    const keepToggle = nameLower.includes('splitgroup') || nameLower === 'splits' || nameLower === 'tiers'
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

  // For multi-item arrays where items should render without labels
  if (Array.isArray(value) && value.length > 1) {
    const label = getArrayItemLabel(name, 0)
    if (label === '') {
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

export default function TechnicalDetails({
  contract,
  contractAddress,
  functionName,
  chainId,
  chainName,
  projectId,
  parameters,
  isDark,
  defaultExpanded = false,
  allChains,
}: TechnicalDetailsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const chainIdStr = chainId.toString()
  const displayChainName = chainName || CHAIN_NAMES[chainIdStr] || `Chain ${chainId}`
  const chainColor = CHAIN_COLORS[chainIdStr] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'

  return (
    <div className={`border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 text-xs w-full px-4 py-2 ${
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
        <div className="px-4 pb-3 space-y-1.5 text-xs">
          {/* Contract */}
          <div className={`flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
            <span>Contract</span>
            <span className="font-mono text-right">
              <AddressDisplay address={contractAddress} chainId={chainId} isDark={isDark} />
            </span>
          </div>

          {/* Function */}
          <div className={`flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
            <span>Function</span>
            <span className="font-mono">{functionName}</span>
          </div>

          {/* Chain(s) */}
          <div className={`flex justify-between items-start ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
            <span>Chain{allChains && allChains.length > 1 ? 's' : ''}</span>
            <div className="flex gap-1 flex-wrap justify-end">
              {allChains && allChains.length > 1 ? (
                allChains.map((c) => {
                  const color = CHAIN_COLORS[c.chainId.toString()] || 'bg-gray-500/20 text-gray-300 border-gray-500/30'
                  return (
                    <span key={c.chainId} className={`px-2 py-0.5 text-xs font-medium border ${color}`}>
                      {c.chainName}
                    </span>
                  )
                })
              ) : (
                <span className={`px-2 py-0.5 text-xs font-medium border ${chainColor}`}>
                  {displayChainName}
                </span>
              )}
            </div>
          </div>

          {/* Project ID */}
          {projectId && (
            <div className={`flex justify-between ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
              <span>Project</span>
              <span className="font-mono">#{projectId}</span>
            </div>
          )}

          {/* Parameters */}
          <div className={`pt-2 mt-2 border-t ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className={`font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Parameters
            </div>
            {Object.entries(parameters).map(([key, value]) => (
              <ParamRow key={key} name={key} value={value} isDark={isDark} chainId={chainIdStr} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
