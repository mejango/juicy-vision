import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useThemeStore } from '../../stores'
import { fetchProjectNFTTiers, getProjectDataHook, hasTokenUriResolver, type ResolvedNFTTier } from '../../services/nft'
import { fetchEthPrice } from '../../services/bendystraw'
import { rulesetKeys, getShopStaleTime } from '../../hooks/useRulesetCache'
import NFTTierCard from './NFTTierCard'

// Metadata extracted from on-chain resolver
interface TierMetadata {
  productName?: string
  categoryName?: string
}

interface ShopTabProps {
  projectId: string
  chainId: string
  isOwner?: boolean
  connectedChains?: Array<{ chainId: number; projectId: number }>
}

export default function ShopTab({ projectId, chainId, isOwner, connectedChains }: ShopTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const queryClient = useQueryClient()

  const [selectedCategory, setSelectedCategory] = useState<number | 'all'>('all')
  // Cache for on-chain metadata (productName, categoryName) by tierId
  const [tierMetadata, setTierMetadata] = useState<Record<number, TierMetadata>>({})
  // Category names extracted from on-chain metadata (category number -> name)
  const [categoryNames, setCategoryNames] = useState<Record<number, string>>({})
  // Checkout quantities from ProjectCard (synced via event)
  const [checkoutQuantities, setCheckoutQuantities] = useState<Record<number, number>>({})

  const chainIdNum = parseInt(chainId)

  // Fetch tiers with React Query (30 minute stale time)
  const { data: shopData, isLoading: loading, isFetching, refetch } = useQuery({
    queryKey: rulesetKeys.shop(chainIdNum, parseInt(projectId)),
    queryFn: async () => {
      const [tiersData, price, hook] = await Promise.all([
        fetchProjectNFTTiers(projectId, chainIdNum),
        fetchEthPrice(),
        getProjectDataHook(projectId, chainIdNum),
      ])
      // Check if hook has tokenUriResolver (if hook exists)
      const hasResolver = hook ? await hasTokenUriResolver(hook, chainIdNum) : false
      return { tiers: tiersData, ethPrice: price, hookAddress: hook, hasTokenUriResolver: hasResolver }
    },
    staleTime: getShopStaleTime(),
  })

  const tiers = shopData?.tiers ?? []
  const ethPrice = shopData?.ethPrice
  const hookAddress = shopData?.hookAddress ?? null
  const hookHasTokenUriResolver = shopData?.hasTokenUriResolver ?? false

  // Handle refresh button click
  const handleRefresh = useCallback(() => {
    refetch()
  }, [refetch])

  // Handle "Sell something" button click - trigger chat flow
  const handleSellSomething = useCallback(() => {
    const message = `Help me add a new NFT tier to project ${projectId} on chain ${chainId}. I want to sell something new.`
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message, newChat: true }
    }))
  }, [projectId, chainId])

  // Handle tier metadata edit - trigger chat flow
  const handleEditMetadata = useCallback((tierId: number) => {
    const tier = tiers.find(t => t.tierId === tierId)
    const tierName = tier?.name || `Tier ${tierId}`
    const message = `Help me update the metadata for NFT tier "${tierName}" (ID: ${tierId}) in project ${projectId} on chain ${chainId}. I want to change its name, description, or image.`
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message, newChat: true }
    }))
  }, [projectId, chainId, tiers])

  // Handle tier discount change - trigger chat flow
  const handleSetDiscount = useCallback((tierId: number, currentDiscount: number) => {
    const tier = tiers.find(t => t.tierId === tierId)
    const tierName = tier?.name || `Tier ${tierId}`
    const discountText = currentDiscount > 0 ? ` (currently ${currentDiscount}% off)` : ''
    const message = `Help me set a discount for NFT tier "${tierName}" (ID: ${tierId})${discountText} in project ${projectId} on chain ${chainId}.`
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message, newChat: true }
    }))
  }, [projectId, chainId, tiers])

  // Handle tier removal - trigger chat flow
  const handleRemoveTier = useCallback((tierId: number) => {
    const tier = tiers.find(t => t.tierId === tierId)
    const tierName = tier?.name || `Tier ${tierId}`
    const message = `Help me remove NFT tier "${tierName}" (ID: ${tierId}) from project ${projectId} on chain ${chainId}. I want to delete this tier from the shop.`
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message, newChat: true }
    }))
  }, [projectId, chainId, tiers])

  // Listen for checkout quantity updates from ProjectCard
  useEffect(() => {
    const handleCheckoutQuantities = (e: CustomEvent<{ quantities: Record<number, number> }>) => {
      setCheckoutQuantities(e.detail.quantities)
    }

    window.addEventListener('juice:checkout-quantities', handleCheckoutQuantities as EventListener)
    return () => window.removeEventListener('juice:checkout-quantities', handleCheckoutQuantities as EventListener)
  }, [])

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

  // Handle metadata loaded from NFTTierCard (extracts category names)
  const handleTierMetadataLoaded = useCallback((tierId: number, metadata: TierMetadata) => {
    setTierMetadata(prev => ({
      ...prev,
      [tierId]: metadata,
    }))
    // Extract category name from any tier that has it (including category 0)
    if (metadata.categoryName) {
      const tier = tiers.find(t => t.tierId === tierId)
      if (tier !== undefined) {
        const cat = tier.category ?? 0
        setCategoryNames(prev => ({
          ...prev,
          [cat]: metadata.categoryName!,
        }))
      }
    }
  }, [tiers])

  // Get category display name (from on-chain metadata or fallback)
  const getCategoryName = useCallback((cat: number) => {
    return categoryNames[cat] || `Category ${cat}`
  }, [categoryNames])

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
        <p className="text-lg font-medium mb-2">No NFT tiers available</p>
        <p className="text-sm">This project doesn't have any NFT tiers configured yet.</p>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Top right controls */}
      <div className="absolute -top-1 right-0 flex items-center gap-2">
        {/* Sell something button - owners only */}
        {isOwner && (
          <button
            onClick={handleSellSomething}
            className="px-2 py-1 text-[10px] font-medium bg-green-500/20 text-green-500 hover:bg-green-500/30 transition-colors rounded"
          >
            + Sell something
          </button>
        )}
        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className={`p-1.5 rounded transition-all ${
            isFetching ? 'opacity-50' : 'opacity-30 hover:opacity-100'
          } ${isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
          title="Refresh shop data"
        >
          <svg
            className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Category filter chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors border ${
              selectedCategory === 'all'
                ? 'border-juice-orange text-juice-orange'
                : isDark
                  ? 'border-white/10 text-gray-300 hover:border-juice-orange'
                  : 'border-gray-200 text-gray-600 hover:border-juice-orange'
            }`}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors border ${
                selectedCategory === cat
                  ? 'border-juice-orange text-juice-orange'
                  : isDark
                    ? 'border-white/10 text-gray-300 hover:border-juice-orange'
                    : 'border-gray-200 text-gray-600 hover:border-juice-orange'
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
                  <div key={tier.tierId} id={`shop-tier-${tier.tierId}`}>
                    <NFTTierCard
                      tier={tier}
                      projectId={projectId}
                      chainId={chainIdNum}
                      ethPrice={ethPrice}
                      isOwner={isOwner}
                      hookAddress={hookAddress}
                      addToCheckoutMode
                      onMetadataLoaded={handleTierMetadataLoaded}
                      connectedChains={connectedChains}
                      checkoutQuantity={checkoutQuantities[tier.tierId] || 0}
                      hasTokenUriResolver={hookHasTokenUriResolver}
                      onEditMetadata={isOwner ? handleEditMetadata : undefined}
                      onSetDiscount={isOwner ? handleSetDiscount : undefined}
                      onRemoveTier={isOwner ? handleRemoveTier : undefined}
                    />
                  </div>
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
                    <div key={tier.tierId} id={`shop-tier-${tier.tierId}`}>
                      <NFTTierCard
                        tier={tier}
                        projectId={projectId}
                        chainId={chainIdNum}
                        ethPrice={ethPrice}
                        isOwner={isOwner}
                        hookAddress={hookAddress}
                        addToCheckoutMode
                        onMetadataLoaded={handleTierMetadataLoaded}
                        connectedChains={connectedChains}
                        checkoutQuantity={checkoutQuantities[tier.tierId] || 0}
                        hasTokenUriResolver={hookHasTokenUriResolver}
                        onEditMetadata={isOwner ? handleEditMetadata : undefined}
                        onSetDiscount={isOwner ? handleSetDiscount : undefined}
                        onRemoveTier={isOwner ? handleRemoveTier : undefined}
                      />
                    </div>
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
            <div key={tier.tierId} id={`shop-tier-${tier.tierId}`}>
              <NFTTierCard
                tier={tier}
                projectId={projectId}
                chainId={chainIdNum}
                ethPrice={ethPrice}
                isOwner={isOwner}
                hookAddress={hookAddress}
                addToCheckoutMode
                onMetadataLoaded={handleTierMetadataLoaded}
                connectedChains={connectedChains}
                checkoutQuantity={checkoutQuantities[tier.tierId] || 0}
                hasTokenUriResolver={hookHasTokenUriResolver}
                onEditMetadata={isOwner ? handleEditMetadata : undefined}
                onSetDiscount={isOwner ? handleSetDiscount : undefined}
                onRemoveTier={isOwner ? handleRemoveTier : undefined}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
