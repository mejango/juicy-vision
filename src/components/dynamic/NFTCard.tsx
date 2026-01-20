import { useState, useEffect } from 'react'
import { useThemeStore } from '../../stores'
import { fetchEthPrice } from '../../services/bendystraw'
import { getProjectDataHook, fetchNFTTier, fetchTierMetadata, type ResolvedNFTTier } from '../../services/nft'
import NFTTierCard from './NFTTierCard'

interface NFTCardProps {
  projectId: string
  tierId: string
  chainId?: string
}

export default function NFTCard({
  projectId,
  tierId,
  chainId = '1',
}: NFTCardProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [tier, setTier] = useState<ResolvedNFTTier | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ethPrice, setEthPrice] = useState<number | null>(null)

  const chainIdNum = parseInt(chainId)
  const tierIdNum = parseInt(tierId)

  useEffect(() => {
    async function loadTier() {
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
          return
        }

        // Fetch the specific tier
        const tierData = await fetchNFTTier(hookAddress, tierIdNum, chainIdNum)

        if (!tierData) {
          setError(`Tier ${tierId} not found`)
          return
        }

        // Fetch metadata if available
        let metadata = null
        if (tierData.encodedIPFSUri) {
          metadata = await fetchTierMetadata(tierData.encodedIPFSUri)
        }

        setTier({
          ...tierData,
          name: metadata?.name || tierData.name,
          description: metadata?.description,
          imageUri: metadata?.image || metadata?.imageUri,
          metadata: metadata || undefined,
        })
      } catch (err) {
        console.error('Failed to load NFT tier:', err)
        setError('Failed to load NFT tier')
      } finally {
        setLoading(false)
      }
    }

    loadTier()
  }, [projectId, tierId, chainIdNum, tierIdNum])

  if (loading) {
    return (
      <div className="w-full max-w-sm">
        <div className={`animate-pulse border ${
          isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
        }`}>
          <div className={`aspect-square ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
          <div className="p-4 space-y-2">
            <div className={`h-5 w-3/4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className={`h-4 w-1/2 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className={`h-10 w-full mt-4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          </div>
        </div>
      </div>
    )
  }

  if (error || !tier) {
    return (
      <div className={`max-w-sm p-4 border text-center ${
        isDark ? 'bg-juice-dark-lighter border-gray-600 text-gray-400' : 'bg-white border-gray-300 text-gray-500'
      }`}>
        {error || 'Tier not found'}
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <NFTTierCard
        tier={tier}
        projectId={projectId}
        chainId={chainIdNum}
        showMintAction={true}
        ethPrice={ethPrice ?? undefined}
      />
    </div>
  )
}
