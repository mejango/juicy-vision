import { useState, useEffect } from 'react'
import { useThemeStore } from '../../stores'
import { fetchEthPrice } from '../../services/bendystraw'
import { getProjectDataHook, fetchResolvedNFTTiers, type ResolvedNFTTier } from '../../services/nft'
import NFTTierCard from './NFTTierCard'

interface NFTGalleryProps {
  projectId: string
  chainId?: string
  columns?: string
  showMintActions?: string
}

export default function NFTGallery({
  projectId,
  chainId = '1',
  columns = '3',
  showMintActions = 'true',
}: NFTGalleryProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [tiers, setTiers] = useState<ResolvedNFTTier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ethPrice, setEthPrice] = useState<number | null>(null)

  const chainIdNum = parseInt(chainId)
  const columnCount = parseInt(columns) || 3
  const showMint = showMintActions === 'true'

  useEffect(() => {
    async function loadTiers() {
      setLoading(true)
      setError(null)

      try {
        // Fetch ETH price for USD conversion
        const price = await fetchEthPrice()
        setEthPrice(price)

        // Get the 721 hook address for this project
        const hookAddress = await getProjectDataHook(projectId, chainIdNum)

        if (!hookAddress) {
          setError('No NFT rewards configured for this project')
          setTiers([])
          return
        }

        // Fetch tiers with resolved metadata
        const tierData = await fetchResolvedNFTTiers(hookAddress, chainIdNum)
        setTiers(tierData)
      } catch (err) {
        console.error('Failed to load NFT tiers:', err)
        setError('Failed to load NFT tiers')
      } finally {
        setLoading(false)
      }
    }

    loadTiers()
  }, [projectId, chainIdNum])

  if (loading) {
    return (
      <div className="w-full">
        <div className={`grid gap-4 ${
          columnCount === 2 ? 'grid-cols-2' :
          columnCount === 3 ? 'grid-cols-2 sm:grid-cols-3' :
          columnCount === 4 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' :
          'grid-cols-2 sm:grid-cols-3'
        }`}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={`animate-pulse border ${
                isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
              }`}
            >
              <div className={`aspect-square ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
              <div className="p-4 space-y-2">
                <div className={`h-5 w-3/4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
                <div className={`h-4 w-1/2 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`p-4 border text-center ${
        isDark ? 'bg-juice-dark-lighter border-gray-600 text-gray-400' : 'bg-white border-gray-300 text-gray-500'
      }`}>
        {error}
      </div>
    )
  }

  if (tiers.length === 0) {
    return (
      <div className={`p-4 border text-center ${
        isDark ? 'bg-juice-dark-lighter border-gray-600 text-gray-400' : 'bg-white border-gray-300 text-gray-500'
      }`}>
        Nothing for sale yet
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          NFT Rewards
        </h3>
        <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {tiers.length} tier{tiers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Grid */}
      <div className={`grid gap-4 ${
        columnCount === 2 ? 'grid-cols-2' :
        columnCount === 3 ? 'grid-cols-2 sm:grid-cols-3' :
        columnCount === 4 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' :
        'grid-cols-2 sm:grid-cols-3'
      }`}>
        {tiers.map((tier) => (
          <NFTTierCard
            key={tier.tierId}
            tier={tier}
            projectId={projectId}
            chainId={chainIdNum}
            showMintAction={showMint}
            ethPrice={ethPrice ?? undefined}
          />
        ))}
      </div>
    </div>
  )
}
