import { useState, useEffect } from 'react'
import { formatEther } from 'viem'
import { useAccount } from 'wagmi'
import { useThemeStore, useTransactionStore } from '../../stores'
import { resolveIpfsUri, inlineSvgImages } from '../../utils/ipfs'
import { resolveTierUri, type ResolvedNFTTier } from '../../services/nft'
import GenerateImageButton from '../ui/GenerateImageButton'
import SupplyBadge from '../ui/SupplyBadge'
import TierDetailModal from './TierDetailModal'

interface NFTTierCardProps {
  tier: ResolvedNFTTier
  projectId: string
  chainId: number
  compact?: boolean
  showMintAction?: boolean
  ethPrice?: number
  /** If true, shows an edit button for tier management */
  isOwner?: boolean
  /** Called when edit button is clicked */
  onEdit?: (tierId: number) => void
  /** If true, shows a generate image button on empty placeholders (owner only) */
  showGenerateImage?: boolean
  /** Called when an image is generated for this tier */
  onImageGenerated?: (tierId: number, ipfsUri: string, httpUrl: string) => void
  /** Optional project context for image generation prompts */
  projectContext?: string
  /** Hook address for resolving on-chain SVGs */
  hookAddress?: `0x${string}` | null
  /** If true, Buy button adds to checkout instead of minting directly */
  addToCheckoutMode?: boolean
  /** Called when on-chain metadata is loaded (productName, categoryName) */
  onMetadataLoaded?: (tierId: number, metadata: { productName?: string; categoryName?: string }) => void
  /** Connected chains for multi-chain supply display */
  connectedChains?: Array<{ chainId: number; projectId: number }>
  /** Current checkout quantity for this tier (when in addToCheckoutMode) */
  checkoutQuantity?: number
}

// Dispatch event to open wallet panel
function openWalletPanel() {
  window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
}

export default function NFTTierCard({
  tier,
  projectId,
  chainId,
  compact = false,
  showMintAction = true,
  ethPrice,
  isOwner = false,
  onEdit,
  showGenerateImage = false,
  onImageGenerated,
  projectContext,
  hookAddress,
  addToCheckoutMode = false,
  onMetadataLoaded,
  connectedChains,
  checkoutQuantity = 0,
}: NFTTierCardProps) {
  const { theme } = useThemeStore()
  const { addTransaction } = useTransactionStore()
  const { isConnected } = useAccount()
  const isDark = theme === 'dark'

  const [minting, setMinting] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [onChainImage, setOnChainImage] = useState<string | null>(null)
  const [onChainProductName, setOnChainProductName] = useState<string | null>(null)
  const [onChainCategoryName, setOnChainCategoryName] = useState<string | null>(null)
  const [loadingOnChainImage, setLoadingOnChainImage] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)

  // Resolve IPFS URI first
  const ipfsImageUrl = resolveIpfsUri(tier.imageUri)

  // Lazy load on-chain SVG if no IPFS image
  useEffect(() => {
    if (ipfsImageUrl || onChainImage || loadingOnChainImage) return

    // Try on-chain resolver if no IPFS image is available
    // This handles both: (1) no encodedIPFSUri, (2) failed to resolve IPFS
    if (hookAddress) {
      setLoadingOnChainImage(true)
      resolveTierUri(hookAddress, tier.tierId, chainId)
        .then(async (dataUri) => {
          if (dataUri) {
            // Parse the data URI to extract the image
            try {
              // dataUri is data:application/json;base64,{...}
              const base64Data = dataUri.split(',')[1]
              const jsonStr = atob(base64Data)
              const metadata = JSON.parse(jsonStr)
              // Extract productName and categoryName from on-chain metadata
              // productName is the simple label like "Hay Field", "Work Station"
              // categoryName is the category label like "Background"
              if (metadata.productName) {
                setOnChainProductName(metadata.productName)
              }
              if (metadata.categoryName) {
                setOnChainCategoryName(metadata.categoryName)
              }
              // Report metadata to parent
              if (onMetadataLoaded && (metadata.productName || metadata.categoryName)) {
                onMetadataLoaded(tier.tierId, {
                  productName: metadata.productName,
                  categoryName: metadata.categoryName,
                })
              }
              if (metadata.image) {
                let processedImage = metadata.image

                // If it's an SVG data URI, inline any external images
                // Browsers don't load external <image> elements in SVG data URIs
                if (metadata.image.startsWith('data:image/svg+xml')) {
                  processedImage = await inlineSvgImages(metadata.image)
                }

                setOnChainImage(processedImage)
              }
            } catch (e) {
              console.error(`[NFT] Tier ${tier.tierId} parse error:`, e)
            }
          }
        })
        .catch((e) => {
          console.error(`[NFT] Tier ${tier.tierId} resolve error:`, e)
        })
        .finally(() => {
          setLoadingOnChainImage(false)
        })
    }
  }, [tier.tierId, chainId, hookAddress, ipfsImageUrl, onChainImage, loadingOnChainImage, onMetadataLoaded])

  // Reset error when image URL changes
  useEffect(() => {
    setImageError(false)
  }, [ipfsImageUrl, onChainImage])

  // Use IPFS image, or on-chain image, or nothing (unless error)
  const imageUrl = imageError ? null : (ipfsImageUrl || onChainImage)
  // Check if image is an SVG (data URI or .svg extension)
  const isSvgImage = imageUrl?.startsWith('data:image/svg') || imageUrl?.endsWith('.svg')
  const priceEth = parseFloat(formatEther(tier.price))
  const priceUsd = ethPrice ? priceEth * ethPrice : null
  const soldOut = tier.remainingSupply === 0

  const handleAddToCheckout = () => {
    // Use the resolved name: prefer onChainProductName if tier.name is a placeholder
    const displayName = /^Tier \d+$/.test(tier.name) ? (onChainProductName || tier.name) : tier.name
    window.dispatchEvent(new CustomEvent('juice:add-to-checkout', {
      detail: {
        tierId: tier.tierId,
        price: tier.price.toString(),
        name: displayName,
      }
    }))
  }

  const handleAdjustCheckoutQuantity = (delta: number) => {
    const displayName = /^Tier \d+$/.test(tier.name) ? (onChainProductName || tier.name) : tier.name
    window.dispatchEvent(new CustomEvent('juice:adjust-checkout-quantity', {
      detail: {
        tierId: tier.tierId,
        delta,
        name: displayName,
      }
    }))
  }

  const handleMint = async () => {
    // In add-to-checkout mode, dispatch event instead of minting directly
    if (addToCheckoutMode) {
      handleAddToCheckout()
      return
    }

    if (!isConnected) {
      openWalletPanel()
      return
    }

    setMinting(true)
    try {
      const txId = addTransaction({
        type: 'mint-nft',
        projectId,
        chainId,
        tierId: tier.tierId,
        quantity,
        status: 'pending',
      })

      window.dispatchEvent(new CustomEvent('juice:mint-nft', {
        detail: {
          txId,
          projectId,
          chainId,
          tierId: tier.tierId,
          quantity,
          price: tier.price.toString(),
        }
      }))
    } finally {
      setMinting(false)
    }
  }

  if (compact) {
    return (
      <div className={`flex items-center gap-3 p-3 border ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Thumbnail */}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={tier.name}
            className={`w-12 h-12 ${isSvgImage ? 'object-contain bg-white' : 'object-cover'}`}
          />
        ) : (
          <div className={`w-12 h-12 flex items-center justify-center ${
            isDark ? 'bg-white/10' : 'bg-gray-100'
          }`}>
            <span className={`text-lg ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              #{tier.tierId}
            </span>
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h4 className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {tier.name}
          </h4>
          <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {tier.remainingSupply} / {tier.initialSupply} available
          </div>
        </div>

        {/* Price & Action */}
        <div className="text-right">
          <div className={`font-mono text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {priceEth.toFixed(4)} ETH
          </div>
          {priceUsd && (
            <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              ~${priceUsd.toFixed(2)}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`border overflow-hidden transition-all ${
      isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
    } ${soldOut ? 'opacity-60' : 'hover:border-juice-orange hover:border-4 hover:-m-[3px]'}`}>
      {/* Image - clickable to open detail modal */}
      <div
        className={`aspect-square relative overflow-hidden cursor-pointer ${isSvgImage ? 'bg-white' : ''}`}
        onClick={() => setShowDetailModal(true)}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={tier.name}
            className={`w-full h-full ${isSvgImage ? 'object-contain' : 'object-cover'}`}
            onError={(e) => {
              console.error(`[NFT] Tier ${tier.tierId} image load error`)
              setImageError(true)
            }}
          />
        ) : (
          <div className={`w-full h-full flex items-center justify-center relative group ${
            isDark ? 'bg-white/5' : 'bg-gray-100'
          }`}>
            <span className={`text-4xl font-bold ${isDark ? 'text-gray-600' : 'text-gray-300'}`}>
              #{tier.tierId}
            </span>
            {/* AI image generation overlay (owner only) */}
            {showGenerateImage && onImageGenerated && (
              <div
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <GenerateImageButton
                  context={{
                    name: tier.name,
                    description: tier.description || undefined,
                    projectTheme: projectContext,
                  }}
                  onGenerated={(ipfsUri, httpUrl) => onImageGenerated(tier.tierId, ipfsUri, httpUrl)}
                  variant="overlay"
                  size="md"
                />
              </div>
            )}
          </div>
        )}

        {/* Supply badge */}
        <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
          <SupplyBadge
            tierId={tier.tierId}
            currentRemaining={tier.remainingSupply}
            connectedChains={connectedChains}
            isDark={isDark}
          />
        </div>

        {/* Edit button (owner only) */}
        {isOwner && onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(tier.tierId) }}
            className={`absolute bottom-2 right-2 p-2 transition-colors ${
              isDark
                ? 'bg-black/70 text-white hover:bg-black/90'
                : 'bg-white/90 text-gray-700 hover:bg-white'
            }`}
            title="Edit tier"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className={`font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {/* Use tier.name (from IPFS) unless it's a placeholder, then fall back to on-chain productName */}
          {/^Tier \d+$/.test(tier.name) ? (onChainProductName || tier.name) : tier.name}
        </h3>

        {tier.description && (
          <p className={`text-sm mb-3 line-clamp-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {tier.description}
          </p>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-2 mb-3">
          <span className={`text-xl font-mono font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {priceEth.toFixed(4)} ETH
          </span>
          {priceUsd && (
            <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              (~${priceUsd.toFixed(2)})
            </span>
          )}
        </div>

        {/* Stats - only show supply if low stock and NOT multi-chain (badge handles multi-chain with breakdown) */}
        {tier.remainingSupply <= 10 && !(connectedChains && connectedChains.length > 1) && (
          <div className={`text-xs mb-3 ${tier.remainingSupply === 0 ? 'text-red-400' : 'text-orange-400'}`}>
            <span className="font-medium">{tier.remainingSupply === 0 ? 'Sold out' : `${tier.remainingSupply} left`}</span>
          </div>
        )}

        {/* Mint action */}
        {showMintAction && (
          <div className="flex justify-end items-center">
            {!soldOut ? (
              <div className="flex items-center">
                {/* In checkout mode, use checkoutQuantity; otherwise use local quantity */}
                {(() => {
                  const displayQty = addToCheckoutMode ? checkoutQuantity : quantity
                  const canDecrement = addToCheckoutMode ? displayQty > 0 : displayQty > 1
                  const canIncrement = displayQty < tier.remainingSupply
                  return (
                    <>
                      <button
                        onClick={() => addToCheckoutMode ? handleAdjustCheckoutQuantity(-1) : setQuantity(q => Math.max(1, q - 1))}
                        disabled={!canDecrement}
                        className={`w-7 h-7 flex items-center justify-center text-sm font-medium transition-colors border-y border-l ${
                          !canDecrement
                            ? isDark ? 'border-white/10 text-gray-600 cursor-not-allowed' : 'border-gray-200 text-gray-300 cursor-not-allowed'
                            : isDark ? 'border-white/10 text-white hover:bg-white/10' : 'border-gray-200 text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        −
                      </button>
                      <div className={`w-8 h-7 flex items-center justify-center text-xs font-medium border-y ${
                        isDark ? 'border-white/10 text-white' : 'border-gray-200 text-gray-900'
                      }`}>
                        {displayQty}
                      </div>
                      <button
                        onClick={() => addToCheckoutMode ? handleAdjustCheckoutQuantity(1) : handleMint()}
                        disabled={minting || !canIncrement}
                        className={`w-7 h-7 flex items-center justify-center text-sm font-medium transition-colors border border-green-500 ${
                          minting || !canIncrement
                            ? 'text-gray-500 cursor-not-allowed opacity-50'
                            : 'text-green-500 hover:bg-green-500/10'
                        }`}
                      >
                        +
                      </button>
                    </>
                  )
                })()}
              </div>
            ) : (
              <span className={`text-xs font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Sold Out
              </span>
            )}
          </div>
        )}
      </div>

      {/* Detail modal */}
      <TierDetailModal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        tier={tier}
        imageUrl={imageUrl}
        ethPrice={ethPrice}
        productName={onChainProductName || undefined}
        connectedChains={connectedChains}
      />
    </div>
  )
}
