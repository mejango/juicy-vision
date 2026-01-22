import { useState, useEffect, useMemo } from 'react'
import { formatEther } from 'viem'
import { useThemeStore } from '../../stores'
import { fetchEthPrice, fetchProject, type Project } from '../../services/bendystraw'
import { getProjectDataHook, fetchResolvedNFTTiers, type ResolvedNFTTier } from '../../services/nft'
import { resolveIpfsUri } from '../../utils/ipfs'
import NFTTierCard from './NFTTierCard'

interface StorefrontProps {
  projectId: string
  chainId?: string
  sortBy?: string // 'price' | 'supply' | 'tierId'
  filterCategory?: string // category number or 'all'
  showSoldOut?: string // 'true' | 'false'
}

type SortOption = 'price-asc' | 'price-desc' | 'supply' | 'tierId'

export default function Storefront({
  projectId,
  chainId = '1',
  sortBy = 'tierId',
  filterCategory = 'all',
  showSoldOut = 'true',
}: StorefrontProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [tiers, setTiers] = useState<ResolvedNFTTier[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ethPrice, setEthPrice] = useState<number | null>(null)

  // Filter state
  const [sort, setSort] = useState<SortOption>(sortBy as SortOption || 'tierId')
  const [selectedCategory, setSelectedCategory] = useState<string>(filterCategory)
  const [includeSoldOut, setIncludeSoldOut] = useState(showSoldOut === 'true')
  const [priceRange] = useState<[number, number] | null>(null)

  const chainIdNum = parseInt(chainId)

  // Get unique categories from tiers
  const categories = useMemo(() => {
    const cats = new Set(tiers.map(t => t.category))
    return Array.from(cats).sort((a, b) => a - b)
  }, [tiers])

  // Filter and sort tiers
  const filteredTiers = useMemo(() => {
    let result = [...tiers]

    // Filter by category
    if (selectedCategory !== 'all') {
      result = result.filter(t => t.category === parseInt(selectedCategory))
    }

    // Filter sold out
    if (!includeSoldOut) {
      result = result.filter(t => t.remainingSupply > 0)
    }

    // Filter by price range
    if (priceRange) {
      result = result.filter(t => {
        const price = parseFloat(formatEther(t.price))
        return price >= priceRange[0] && price <= priceRange[1]
      })
    }

    // Sort
    switch (sort) {
      case 'price-asc':
        result.sort((a, b) => Number(a.price - b.price))
        break
      case 'price-desc':
        result.sort((a, b) => Number(b.price - a.price))
        break
      case 'supply':
        result.sort((a, b) => b.remainingSupply - a.remainingSupply)
        break
      case 'tierId':
      default:
        result.sort((a, b) => a.tierId - b.tierId)
        break
    }

    return result
  }, [tiers, selectedCategory, includeSoldOut, priceRange, sort])

  useEffect(() => {
    // Skip fetch if no projectId provided
    if (!projectId) {
      setLoading(false)
      setError(null)
      return
    }

    async function loadStorefront() {
      setLoading(true)
      setError(null)

      try {
        // Fetch project info and ETH price
        const [projectData, price] = await Promise.all([
          fetchProject(projectId, chainIdNum),
          fetchEthPrice(),
        ])

        setProject(projectData)
        setEthPrice(price)

        // Get the 721 hook address
        const hookAddress = await getProjectDataHook(projectId, chainIdNum)

        if (!hookAddress) {
          setError('No NFT rewards configured for this project')
          setTiers([])
          return
        }

        // Fetch all tiers
        const tierData = await fetchResolvedNFTTiers(hookAddress, chainIdNum)
        setTiers(tierData)
      } catch (err) {
        console.error('Failed to load storefront:', err)
        setError('Failed to load storefront')
      } finally {
        setLoading(false)
      }
    }

    loadStorefront()
  }, [projectId, chainIdNum])

  const logoUrl = project ? resolveIpfsUri(project.logoUri) : null

  // Handle missing projectId - must be after all hooks
  if (!projectId) {
    return (
      <div className={`max-w-4xl p-4 border text-center ${
        isDark ? 'bg-juice-dark-lighter border-gray-600 text-gray-400' : 'bg-white border-gray-300 text-gray-500'
      }`}>
        No project specified. Ask me to show a storefront for a specific project.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="w-full max-w-4xl">
        {/* Header skeleton */}
        <div className={`p-4 border mb-4 ${
          isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className="space-y-2">
              <div className={`h-5 w-32 animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
              <div className={`h-4 w-24 animate-pulse ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            </div>
          </div>
        </div>

        {/* Grid skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`animate-pulse border ${
                isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
              }`}
            >
              <div className={`aspect-square ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
              <div className="p-4 space-y-2">
                <div className={`h-4 w-3/4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
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
      <div className={`max-w-4xl p-4 border text-center ${
        isDark ? 'bg-juice-dark-lighter border-gray-600 text-gray-400' : 'bg-white border-gray-300 text-gray-500'
      }`}>
        {error}
      </div>
    )
  }

  return (
    <div className="w-full max-w-4xl">
      {/* Header */}
      <div className={`p-4 border mb-4 ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        <div className="flex items-center gap-3 mb-3">
          {logoUrl ? (
            <img src={logoUrl} alt={project?.name} className="w-12 h-12 object-cover" />
          ) : (
            <div className={`w-12 h-12 flex items-center justify-center ${
              isDark ? 'bg-white/10' : 'bg-gray-100'
            }`}>
              <span className="text-juice-orange font-bold text-lg">
                {project?.name?.charAt(0).toUpperCase() || '?'}
              </span>
            </div>
          )}
          <div>
            <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {project?.name || 'Storefront'}
            </h2>
            <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {tiers.length} item{tiers.length !== 1 ? 's' : ''} available
            </span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className={`px-3 py-1.5 text-sm border ${
              isDark
                ? 'bg-juice-dark border-white/10 text-white'
                : 'bg-white border-gray-200 text-gray-900'
            }`}
          >
            <option value="tierId">Default</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="supply">Most Available</option>
          </select>

          {/* Category filter */}
          {categories.length > 1 && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className={`px-3 py-1.5 text-sm border ${
                isDark
                  ? 'bg-juice-dark border-white/10 text-white'
                  : 'bg-white border-gray-200 text-gray-900'
              }`}
            >
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>Category {cat}</option>
              ))}
            </select>
          )}

          {/* Show sold out toggle */}
          <label className={`flex items-center gap-2 text-sm ${
            isDark ? 'text-gray-300' : 'text-gray-600'
          }`}>
            <input
              type="checkbox"
              checked={includeSoldOut}
              onChange={(e) => setIncludeSoldOut(e.target.checked)}
              className="w-4 h-4"
            />
            Show sold out
          </label>
        </div>
      </div>

      {/* Results count */}
      {filteredTiers.length !== tiers.length && (
        <div className={`text-sm mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Showing {filteredTiers.length} of {tiers.length} items
        </div>
      )}

      {/* Grid */}
      {filteredTiers.length === 0 ? (
        <div className={`p-8 border text-center ${
          isDark ? 'bg-juice-dark-lighter border-gray-600 text-gray-400' : 'bg-white border-gray-300 text-gray-500'
        }`}>
          No items match your filters
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTiers.map((tier) => (
            <NFTTierCard
              key={tier.tierId}
              tier={tier}
              projectId={projectId}
              chainId={chainIdNum}
              showMintAction={true}
              ethPrice={ethPrice ?? undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
