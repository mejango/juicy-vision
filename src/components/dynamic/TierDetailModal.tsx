import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { formatEther } from 'viem'
import { useThemeStore } from '../../stores'
import type { ResolvedNFTTier } from '../../services/nft'
import { fetchMultiChainTierSupply, type MultiChainTierSupply } from '../../services/nft/multichain'

interface TierDetailModalProps {
  isOpen: boolean
  onClose: () => void
  tier: ResolvedNFTTier
  imageUrl: string | null
  ethPrice?: number
  /** Product name from on-chain metadata (if tier.name is placeholder) */
  productName?: string
  /** Connected chains for multi-chain supply */
  connectedChains?: Array<{ chainId: number; projectId: number }>
}

export default function TierDetailModal({
  isOpen,
  onClose,
  tier,
  imageUrl,
  ethPrice,
  productName,
  connectedChains,
}: TierDetailModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [showTechnical, setShowTechnical] = useState(false)
  const [multiChainSupply, setMultiChainSupply] = useState<MultiChainTierSupply | null>(null)
  const [loadingSupply, setLoadingSupply] = useState(false)

  const isMultiChain = connectedChains && connectedChains.length > 1

  // Fetch multi-chain supply when modal opens
  useEffect(() => {
    if (!isOpen || !isMultiChain || multiChainSupply) return

    setLoadingSupply(true)
    fetchMultiChainTierSupply(tier.tierId, connectedChains)
      .then(setMultiChainSupply)
      .catch(console.error)
      .finally(() => setLoadingSupply(false))
  }, [isOpen, isMultiChain, tier.tierId, connectedChains, multiChainSupply])

  // Reset multi-chain data when modal closes
  useEffect(() => {
    if (!isOpen) {
      setMultiChainSupply(null)
    }
  }, [isOpen])

  // Escape key to close
  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [isOpen, handleEscape])

  if (!isOpen) return null

  const priceEth = parseFloat(formatEther(tier.price))
  const priceUsd = ethPrice ? priceEth * ethPrice : null
  const displayName = /^Tier \d+$/.test(tier.name) ? (productName || tier.name) : tier.name
  const isSvgImage = imageUrl?.startsWith('data:image/svg') || imageUrl?.endsWith('.svg')

  // Use multi-chain totals if available, otherwise fall back to single chain
  const remainingSupply = multiChainSupply?.totalRemaining ?? tier.remainingSupply
  const initialSupply = multiChainSupply?.totalInitial ?? tier.initialSupply
  const soldOut = remainingSupply === 0
  const isLowStock = remainingSupply > 0 && remainingSupply <= 10

  // Calculate supply percentage for visual indicator
  const supplyPercent = initialSupply > 0
    ? (remainingSupply / initialSupply) * 100
    : 0

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className={`absolute inset-0 ${isDark ? 'bg-black/90' : 'bg-black/80'}`} />

      {/* Content */}
      <div
        className={`relative w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto ${
          isDark ? 'bg-juice-dark' : 'bg-white'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 z-10 p-2 transition-colors ${
            isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Image - full width */}
        <div className={`aspect-square max-h-[50vh] w-full overflow-hidden ${isSvgImage ? 'bg-white' : isDark ? 'bg-black' : 'bg-gray-100'}`}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={displayName}
              className={`w-full h-full ${isSvgImage ? 'object-contain' : 'object-contain'}`}
            />
          ) : (
            <div className={`w-full h-full flex items-center justify-center ${
              isDark ? 'bg-white/5' : 'bg-gray-100'
            }`}>
              <span className={`text-6xl font-bold ${isDark ? 'text-gray-600' : 'text-gray-300'}`}>
                #{tier.tierId}
              </span>
            </div>
          )}
        </div>

        {/* Info section */}
        <div className="p-6">
          {/* Name and price */}
          <div className="flex items-start justify-between gap-4 mb-4">
            <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {displayName}
            </h2>
            <div className="text-right shrink-0">
              <div className={`text-xl font-mono font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {priceEth.toFixed(4)} ETH
              </div>
              {priceUsd && (
                <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  ~${priceUsd.toFixed(2)}
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          {tier.description && (
            <p className={`text-sm mb-6 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {tier.description}
            </p>
          )}

          {/* Supply indicator - prominent when low */}
          <div className={`mb-6 p-4 ${
            soldOut
              ? 'bg-red-500/10 border border-red-500/30'
              : isLowStock
                ? 'bg-orange-500/10 border border-orange-500/30'
                : isDark ? 'bg-white/5 border border-white/10' : 'bg-gray-50 border border-gray-200'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm font-medium ${
                soldOut
                  ? 'text-red-400'
                  : isLowStock
                    ? 'text-orange-400'
                    : isDark ? 'text-gray-300' : 'text-gray-600'
              }`}>
                {soldOut ? 'Sold Out' : isLowStock ? 'Running Low!' : 'Remaining Supply'}
                {isMultiChain && <span className="opacity-60 ml-1">(all chains)</span>}
              </span>
              <span className={`font-mono text-lg font-semibold ${
                soldOut
                  ? 'text-red-400'
                  : isLowStock
                    ? 'text-orange-400'
                    : isDark ? 'text-white' : 'text-gray-900'
              }`}>
                {loadingSupply ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  </span>
                ) : (
                  `${remainingSupply} / ${initialSupply}`
                )}
              </span>
            </div>
            {/* Progress bar */}
            <div className={`h-2 w-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
              <div
                className={`h-full transition-all ${
                  soldOut
                    ? 'bg-red-500'
                    : isLowStock
                      ? 'bg-orange-500'
                      : 'bg-green-500'
                }`}
                style={{ width: `${supplyPercent}%` }}
              />
            </div>

            {/* Per-chain breakdown for multi-chain projects */}
            {isMultiChain && multiChainSupply && multiChainSupply.perChain.length > 1 && (
              <div className={`mt-3 pt-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                <div className={`text-xs uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  By Network
                </div>
                <div className="space-y-1">
                  {multiChainSupply.perChain.map((chain) => (
                    <div key={chain.chainId} className="flex justify-between text-sm">
                      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                        {chain.chainName}
                      </span>
                      <span className={`font-mono ${
                        chain.remaining === 0
                          ? 'text-red-400'
                          : isDark ? 'text-gray-200' : 'text-gray-700'
                      }`}>
                        {chain.remaining} / {chain.initial}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Technical Details dropdown */}
          <div className={`border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <button
              onClick={() => setShowTechnical(!showTechnical)}
              className={`w-full flex items-center justify-between p-4 transition-colors ${
                isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'
              }`}
            >
              <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                Technical Details
              </span>
              <svg
                className={`w-5 h-5 transition-transform ${showTechnical ? 'rotate-180' : ''} ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showTechnical && (
              <div className={`p-4 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {/* Basic info */}
                  <DetailRow label="Tier ID" value={`#${tier.tierId}`} isDark={isDark} />
                  <DetailRow label="Category" value={tier.category === 0 ? 'None' : `${tier.category}`} isDark={isDark} />
                  <DetailRow
                    label="Currency"
                    value={tier.currency === 1 ? 'ETH' : tier.currency === 2 ? 'USD' : `Unknown (${tier.currency})`}
                    isDark={isDark}
                  />
                  <DetailRow
                    label="Reserved Rate"
                    value={tier.reservedRate > 0 ? `${(tier.reservedRate / 100).toFixed(2)}%` : 'None'}
                    isDark={isDark}
                  />
                  <DetailRow
                    label="Voting Units"
                    value={tier.votingUnits > 0n ? tier.votingUnits.toString() : 'None'}
                    isDark={isDark}
                  />

                  {/* Flags section */}
                  <div className="col-span-2 mt-4 pt-4 border-t border-dashed border-gray-600">
                    <div className={`text-xs uppercase tracking-wide mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Tier Flags
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <FlagRow
                        label="Owner Can Mint"
                        enabled={tier.allowOwnerMint}
                        isDark={isDark}
                      />
                      <FlagRow
                        label="Transfers Pausable"
                        enabled={tier.transfersPausable}
                        isDark={isDark}
                      />
                    </div>
                  </div>

                  {/* IPFS info */}
                  {tier.encodedIPFSUri && (
                    <div className="col-span-2 mt-4 pt-4 border-t border-dashed border-gray-600">
                      <div className={`text-xs uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        Metadata
                      </div>
                      <div className={`font-mono text-xs break-all ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {tier.encodedIPFSUri}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Helper component for detail rows
function DetailRow({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>{label}</span>
      <span className={`font-mono ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>{value}</span>
    </div>
  )
}

// Helper component for flag rows
function FlagRow({ label, enabled, isDark }: { label: string; enabled: boolean; isDark: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-green-500' : isDark ? 'bg-gray-600' : 'bg-gray-300'}`} />
      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{label}</span>
    </div>
  )
}
