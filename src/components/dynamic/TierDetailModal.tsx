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

  const isMultiChain = connectedChains && connectedChains.length > 1

  // Fetch multi-chain supply when modal opens (background update, no loading state)
  useEffect(() => {
    if (!isOpen || !isMultiChain || multiChainSupply) return

    // Fetch in background - we already have tier data to show
    fetchMultiChainTierSupply(tier.tierId, connectedChains)
      .then(setMultiChainSupply)
      .catch(console.error)
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
        className={`relative w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto border-4 border-juice-orange ${
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
          {/* Name */}
          <h2 className={`text-2xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {displayName}
          </h2>

          {/* Price */}
          <div className="mb-4">
            <span className={`text-xl font-mono font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {priceEth.toFixed(4)} ETH
            </span>
            {priceUsd && (
              <span className={`text-sm ml-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                ~${priceUsd.toFixed(2)}
              </span>
            )}
          </div>

          {/* Description */}
          {tier.description && (
            <p className={`text-sm mb-6 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              {tier.description}
            </p>
          )}

          {/* Inventory - prominent only when low/sold out */}
          {(soldOut || isLowStock) ? (
            <div className={`mb-6 p-4 ${
              soldOut
                ? 'bg-red-500/10 border border-red-500/30'
                : 'bg-orange-500/10 border border-orange-500/30'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium ${soldOut ? 'text-red-400' : 'text-orange-400'}`}>
                  {soldOut ? 'Sold Out' : 'Running Low!'}
                </span>
                <span className={`font-mono text-lg font-semibold ${soldOut ? 'text-red-400' : 'text-orange-400'}`}>
                  {remainingSupply} / {initialSupply}
                </span>
              </div>
              {/* Progress bar */}
              <div className={`h-2 w-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
                <div
                  className={`h-full ${soldOut ? 'bg-red-500' : 'bg-orange-500'}`}
                  style={{ width: `${supplyPercent}%` }}
                />
              </div>
            </div>
          ) : (
            /* Subtle inventory display when plenty in stock */
            <div className={`mb-6 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Inventory</span>{' '}
              <span className="font-mono">{remainingSupply} / {initialSupply}</span>
            </div>
          )}

          {/* Technical Details dropdown */}
          <div>
            <button
              onClick={() => setShowTechnical(!showTechnical)}
              className={`w-full flex items-center justify-between py-2 transition-colors ${
                isDark ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'
              }`}
            >
              <span className="text-[10px] uppercase tracking-wider">
                Technical Details
              </span>
              <svg
                className={`w-3 h-3 transition-transform ${showTechnical ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showTechnical && (
              <div className={`pt-2 text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {/* Compact key:value layout */}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span><span className={isDark ? 'text-gray-600' : 'text-gray-400'}>Tier</span> #{tier.tierId}</span>
                  <span><span className={isDark ? 'text-gray-600' : 'text-gray-400'}>Category</span> {tier.category}</span>
                  <span><span className={isDark ? 'text-gray-600' : 'text-gray-400'}>Currency</span> {tier.currency === 1 ? 'ETH' : tier.currency === 2 ? 'USD' : tier.currency}</span>
                  {tier.reservedRate > 0 && (
                    <span><span className={isDark ? 'text-gray-600' : 'text-gray-400'}>Reserved</span> 1/{tier.reservedRate}</span>
                  )}
                  {tier.votingUnits > 0n && (
                    <span><span className={isDark ? 'text-gray-600' : 'text-gray-400'}>Votes</span> {tier.votingUnits.toString()}</span>
                  )}
                  {(tier.discountPercent ?? 0) > 0 && (
                    <span><span className={isDark ? 'text-gray-600' : 'text-gray-400'}>Discount</span> {tier.discountPercent}%</span>
                  )}
                </div>

                {/* Per-chain breakdown for multi-chain projects */}
                {isMultiChain && multiChainSupply && multiChainSupply.perChain.length > 1 && (
                  <div className="mt-2 pt-2 border-t border-dashed border-gray-700/30">
                    <span className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                      Inventory by Network
                    </span>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      {multiChainSupply.perChain.map((chain) => (
                        <span key={chain.chainId}>
                          <span className={isDark ? 'text-gray-600' : 'text-gray-400'}>{chain.chainName}</span>{' '}
                          <span className={`font-mono ${chain.remaining === 0 ? 'text-red-400' : ''}`}>
                            {chain.remaining}/{chain.initial}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Flags - compact inline */}
                <div className="mt-2 pt-2 border-t border-dashed border-gray-700/30">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <FlagRow label="Owner Mint" enabled={tier.allowOwnerMint} isDark={isDark} />
                    <FlagRow label="Pausable" enabled={tier.transfersPausable} isDark={isDark} />
                    <FlagRow label="Locked" enabled={tier.cannotBeRemoved ?? false} isDark={isDark} />
                    <FlagRow label="Discount Locked" enabled={tier.cannotIncreaseDiscountPercent ?? false} isDark={isDark} />
                  </div>
                </div>

                {/* IPFS info */}
                {tier.encodedIPFSUri && (
                  <div className="mt-2 pt-2 border-t border-dashed border-gray-700/30">
                    <span className={`text-[10px] uppercase tracking-wider ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>IPFS</span>{' '}
                    <span className={`font-mono text-[10px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                      {tier.encodedIPFSUri}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// Helper component for flag rows - compact inline format
function FlagRow({ label, enabled, isDark }: { label: string; enabled: boolean; isDark: boolean }) {
  return (
    <span>
      <span className={isDark ? 'text-gray-600' : 'text-gray-400'}>{label}</span>{' '}
      <span className={enabled ? (isDark ? 'text-green-500/70' : 'text-green-600') : (isDark ? 'text-gray-700' : 'text-gray-300')}>
        {enabled ? 'on' : 'off'}
      </span>
    </span>
  )
}
