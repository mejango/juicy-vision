import { useState, useEffect } from 'react'
import { formatEther } from 'viem'
import { useAccount } from 'wagmi'
import { useThemeStore, useTransactionStore } from '../../stores'
import { resolveIpfsUri } from '../../utils/ipfs'
import { resolveTierUri, type ResolvedNFTTier } from '../../services/nft'
import GenerateImageButton from '../ui/GenerateImageButton'

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
}: NFTTierCardProps) {
  const { theme } = useThemeStore()
  const { addTransaction } = useTransactionStore()
  const { isConnected } = useAccount()
  const isDark = theme === 'dark'

  const [minting, setMinting] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [onChainImage, setOnChainImage] = useState<string | null>(null)
  const [loadingOnChainImage, setLoadingOnChainImage] = useState(false)

  // Resolve IPFS URI first
  const ipfsImageUrl = resolveIpfsUri(tier.imageUri)

  // Lazy load on-chain SVG if no IPFS image
  useEffect(() => {
    if (ipfsImageUrl || onChainImage || loadingOnChainImage) return

    // Check if this tier might have an on-chain SVG (no IPFS URI)
    if (!tier.encodedIPFSUri && !tier.imageUri && hookAddress) {
      setLoadingOnChainImage(true)
      resolveTierUri(hookAddress, tier.tierId, chainId)
        .then((dataUri) => {
          if (dataUri) {
            // Parse the data URI to extract the image
            try {
              // dataUri is data:application/json;base64,{...}
              const base64Data = dataUri.split(',')[1]
              const jsonStr = atob(base64Data)
              const metadata = JSON.parse(jsonStr)
              if (metadata.image) {
                setOnChainImage(metadata.image)
              }
            } catch {
              // Failed to parse, ignore
            }
          }
        })
        .catch(() => {
          // Failed to resolve, ignore
        })
        .finally(() => {
          setLoadingOnChainImage(false)
        })
    }
  }, [tier.tierId, tier.encodedIPFSUri, tier.imageUri, chainId, hookAddress, ipfsImageUrl, onChainImage, loadingOnChainImage])

  // Use IPFS image, or on-chain image, or nothing
  const imageUrl = ipfsImageUrl || onChainImage
  const priceEth = parseFloat(formatEther(tier.price))
  const priceUsd = ethPrice ? priceEth * ethPrice : null
  const soldOut = tier.remainingSupply === 0

  const handleMint = async () => {
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
            className="w-12 h-12 object-cover"
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
    <div className={`border overflow-hidden ${
      isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
    } ${soldOut ? 'opacity-60' : ''}`}>
      {/* Image */}
      <div className="aspect-square relative overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={tier.name}
            className="w-full h-full object-cover"
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
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
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
        <div className={`absolute top-2 right-2 px-2 py-0.5 text-xs font-medium ${
          soldOut
            ? 'bg-red-500/90 text-white'
            : isDark ? 'bg-black/70 text-white' : 'bg-white/90 text-gray-900'
        }`}>
          {soldOut ? 'Sold Out' : `${tier.remainingSupply} left`}
        </div>

        {/* Category badge */}
        {tier.category > 0 && (
          <div className={`absolute top-2 left-2 px-2 py-0.5 text-xs font-medium ${
            isDark ? 'bg-juice-orange/90 text-black' : 'bg-juice-orange text-white'
          }`}>
            Category {tier.category}
          </div>
        )}

        {/* Edit button (owner only) */}
        {isOwner && onEdit && (
          <button
            onClick={() => onEdit(tier.tierId)}
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
          {tier.name}
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

        {/* Stats */}
        <div className={`flex gap-4 text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          <div>
            <span className="font-medium">Supply:</span> {tier.initialSupply}
          </div>
          {tier.votingUnits > 0n && (
            <div>
              <span className="font-medium">Votes:</span> {tier.votingUnits.toString()}
            </div>
          )}
        </div>

        {/* Mint action */}
        {showMintAction && (
          <div className="flex gap-2">
            {!soldOut && tier.initialSupply > 1 && (
              <select
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className={`px-2 py-2 text-sm border ${
                  isDark
                    ? 'bg-juice-dark border-white/10 text-white'
                    : 'bg-white border-gray-200 text-gray-900'
                }`}
              >
                {Array.from({ length: Math.min(tier.remainingSupply, 10) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}
            <button
              onClick={handleMint}
              disabled={minting || soldOut}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                minting || soldOut
                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                  : 'bg-green-500 hover:bg-green-600 text-black'
              }`}
            >
              {minting ? 'Minting...' : soldOut ? 'Sold Out' : 'Mint'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
