import { useState, useEffect, useMemo } from 'react'
import { useThemeStore } from '../../stores'
import { fetchProjectNFTTiers, getProjectDataHook, type ResolvedNFTTier } from '../../services/nft'
import { fetchEthPrice } from '../../services/bendystraw'
import NFTTierCard from './NFTTierCard'

interface ShopTabProps {
  projectId: string
  chainId: string
  isOwner?: boolean
}

export default function ShopTab({ projectId, chainId, isOwner }: ShopTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [tiers, setTiers] = useState<ResolvedNFTTier[]>([])
  const [loading, setLoading] = useState(true)
  const [ethPrice, setEthPrice] = useState<number | undefined>()
  const [selectedCategory, setSelectedCategory] = useState<number | 'all'>('all')
  const [hookAddress, setHookAddress] = useState<`0x${string}` | null>(null)

  const chainIdNum = parseInt(chainId)

  // Fetch tiers, ETH price, and hook address
  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [tiersData, price, hook] = await Promise.all([
          fetchProjectNFTTiers(projectId, chainIdNum),
          fetchEthPrice(),
          getProjectDataHook(projectId, chainIdNum),
        ])
        setTiers(tiersData)
        setEthPrice(price)
        setHookAddress(hook)
      } catch (error) {
        console.error('Failed to load NFT tiers:', error)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainIdNum])

  // Extract unique categories
  const categories = useMemo(() => {
    const cats = new Set<number>()
    tiers.forEach(tier => {
      if (tier.category > 0) {
        cats.add(tier.category)
      }
    })
    return Array.from(cats).sort((a, b) => a - b)
  }, [tiers])

  // Group tiers by category
  const tiersByCategory = useMemo(() => {
    const grouped: Record<number, ResolvedNFTTier[]> = {}
    tiers.forEach(tier => {
      const cat = tier.category || 0
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(tier)
    })
    return grouped
  }, [tiers])

  // Filtered tiers based on selection
  const filteredTiers = useMemo(() => {
    if (selectedCategory === 'all') {
      return tiers
    }
    return tiers.filter(tier => tier.category === selectedCategory)
  }, [tiers, selectedCategory])

  // Category names (could be extended with metadata)
  const getCategoryName = (cat: number) => {
    if (cat === 0) return 'Uncategorized'
    return `Category ${cat}`
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {/* Filter skeleton */}
        <div className="flex gap-2">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className={`h-8 w-20 animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}
            />
          ))}
        </div>
        {/* Grid skeleton */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div
              key={i}
              className={`aspect-square animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}
            />
          ))}
        </div>
      </div>
    )
  }

  if (tiers.length === 0) {
    return (
      <div className={`text-center py-12 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        <div className="text-4xl mb-4">🎨</div>
        <p className="text-lg font-medium mb-2">No NFT tiers available</p>
        <p className="text-sm">This project doesn't have any NFT tiers configured yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Category filter chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              selectedCategory === 'all'
                ? 'bg-juice-orange text-black'
                : isDark
                  ? 'bg-white/10 text-gray-300 hover:bg-white/20'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                selectedCategory === cat
                  ? 'bg-juice-orange text-black'
                  : isDark
                    ? 'bg-white/10 text-gray-300 hover:bg-white/20'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {getCategoryName(cat)}
            </button>
          ))}
        </div>
      )}

      {/* Tiers display */}
      {selectedCategory === 'all' && categories.length > 0 ? (
        // Grouped by category when showing all
        <div className="space-y-8">
          {/* Uncategorized first (if any) */}
          {tiersByCategory[0] && tiersByCategory[0].length > 0 && (
            <div>
              <h3 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {getCategoryName(0)}
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {tiersByCategory[0].map(tier => (
                  <NFTTierCard
                    key={tier.tierId}
                    tier={tier}
                    projectId={projectId}
                    chainId={chainIdNum}
                    ethPrice={ethPrice}
                    isOwner={isOwner}
                    hookAddress={hookAddress}
                  />
                ))}
              </div>
            </div>
          )}
          {/* Then each category in order */}
          {categories.map(cat => (
            tiersByCategory[cat] && tiersByCategory[cat].length > 0 && (
              <div key={cat}>
                <h3 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {getCategoryName(cat)}
                </h3>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {tiersByCategory[cat].map(tier => (
                    <NFTTierCard
                      key={tier.tierId}
                      tier={tier}
                      projectId={projectId}
                      chainId={chainIdNum}
                      ethPrice={ethPrice}
                      isOwner={isOwner}
                      hookAddress={hookAddress}
                    />
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      ) : (
        // Simple grid when filtered or no categories
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTiers.map(tier => (
            <NFTTierCard
              key={tier.tierId}
              tier={tier}
              projectId={projectId}
              chainId={chainIdNum}
              ethPrice={ethPrice}
              isOwner={isOwner}
              hookAddress={hookAddress}
            />
          ))}
        </div>
      )}
    </div>
  )
}
