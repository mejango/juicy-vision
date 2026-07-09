import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useThemeStore } from '../../stores'
import { fetchProjectNFTTiers, getProjectDataHook, hasTokenUriResolver, type ResolvedNFTTier } from '../../services/nft'
import { fetchEthPrice } from '../../services/bendystraw'
import { rulesetKeys, getShopStaleTime } from '../../hooks/useRulesetCache'
import { CHAINS, MAINNET_CHAINS } from '../../constants'
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

  // 721 tiers and their remaining supply are strictly per-chain, so the shop
  // shows one chain's inventory at a time. Build the list of chains this project
  // lives on, defaulting to just the primary chain when there are no peers.
  const availableChains = connectedChains && connectedChains.length > 0
    ? connectedChains
    : [{ chainId: chainIdNum, projectId: parseInt(projectId) }]

  // Which chain's inventory the user is viewing (defaults to the primary chain).
  const [selectedChainId, setSelectedChainId] = useState<number>(chainIdNum)
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false)

  // Resolve the selected chain's entry — the projectId can differ per chain.
  const selectedChain = availableChains.find(c => c.chainId === selectedChainId) ?? availableChains[0]
  const selectedChainIdNum = selectedChain.chainId
  const selectedProjectId = String(selectedChain.projectId)
  const selectedChainInfo = CHAINS[selectedChainIdNum] || MAINNET_CHAINS[selectedChainIdNum]

  // Fetch tiers with React Query (30 minute stale time). The query key includes
  // the selected chain + project so inventory caches per chain.
  const { data: shopData, isLoading: loading, isFetching, refetch } = useQuery({
    queryKey: rulesetKeys.shop(selectedChainIdNum, parseInt(selectedProjectId)),
    queryFn: async () => {
      const [tiersData, price, hook] = await Promise.all([
        fetchProjectNFTTiers(selectedProjectId, selectedChainIdNum),
        fetchEthPrice(),
        getProjectDataHook(selectedProjectId, selectedChainIdNum),
      ])
      // Check if hook has tokenUriResolver (if hook exists)
      const hasResolver = hook ? await hasTokenUriResolver(hook, selectedChainIdNum) : false
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
    const message = `Help me add a new NFT tier to project ${selectedProjectId} on chain ${selectedChainIdNum}. I want to sell something new.`
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message, newChat: true }
    }))
  }, [selectedProjectId, selectedChainIdNum])

  // Handle tier metadata edit - trigger chat flow
  const handleEditMetadata = useCallback((tierId: number) => {
    const tier = tiers.find(t => t.tierId === tierId)
    const tierName = tier?.name || `Tier ${tierId}`
    const message = `Help me update the metadata for NFT tier "${tierName}" (ID: ${tierId}) in project ${selectedProjectId} on chain ${selectedChainIdNum}. I want to change its name, description, or image.`
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message, newChat: true }
    }))
  }, [selectedProjectId, selectedChainIdNum, tiers])

  // Handle tier discount change - trigger chat flow
  const handleSetDiscount = useCallback((tierId: number, currentDiscount: number) => {
    const tier = tiers.find(t => t.tierId === tierId)
    const tierName = tier?.name || `Tier ${tierId}`
    const discountText = currentDiscount > 0 ? ` (currently ${currentDiscount}% off)` : ''
    const message = `Help me set a discount for NFT tier "${tierName}" (ID: ${tierId})${discountText} in project ${selectedProjectId} on chain ${selectedChainIdNum}.`
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message, newChat: true }
    }))
  }, [selectedProjectId, selectedChainIdNum, tiers])

  // Handle tier removal - trigger chat flow
  const handleRemoveTier = useCallback((tierId: number) => {
    const tier = tiers.find(t => t.tierId === tierId)
    const tierName = tier?.name || `Tier ${tierId}`
    const message = `Help me remove NFT tier "${tierName}" (ID: ${tierId}) from project ${selectedProjectId} on chain ${selectedChainIdNum}. I want to delete this tier from the shop.`
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message, newChat: true }
    }))
  }, [selectedProjectId, selectedChainIdNum, tiers])

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

  // Per-chain inventory selector. 721 tiers/supply are strictly per-chain, so
  // this switches which chain's shop is shown (never an aggregate). Rendered in
  // every state (loading/empty/populated) so the user can always switch chains.
  const chainSelector = availableChains.length > 1 ? (
    <div className="flex items-center gap-2 mb-4">
      <div className="relative">
        <button
          onClick={() => setChainDropdownOpen(!chainDropdownOpen)}
          className={`px-2 py-0.5 text-xs font-medium flex items-center gap-1 ${
            isDark ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {selectedChainInfo?.shortName ?? `Chain ${selectedChainIdNum}`}
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {chainDropdownOpen && (
          <div className={`absolute left-0 mt-1 py-1 min-w-[120px] border z-10 ${
            isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
          }`}>
            {availableChains.map(chain => {
              const info = CHAINS[chain.chainId] || MAINNET_CHAINS[chain.chainId]
              if (!info) return null
              return (
                <button
                  key={chain.chainId}
                  onClick={() => {
                    setSelectedChainId(chain.chainId)
                    setChainDropdownOpen(false)
                  }}
                  className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 ${
                    selectedChainId === chain.chainId
                      ? isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900'
                      : isDark ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: info.color }} />
                  {info.name}
                </button>
              )
            })}
          </div>
        )}
      </div>
      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Showing {selectedChainInfo?.name ?? `chain ${selectedChainIdNum}`} inventory
      </span>
    </div>
  ) : null

  if (loading) {
    return (
      <div className="space-y-4">
        {chainSelector}
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
      <div>
        {chainSelector}
        <div className={`text-center py-12 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          <p className="text-lg font-medium">Nothing for sale yet</p>
        </div>
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

      {/* Per-chain inventory selector */}
      {chainSelector}

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
                      projectId={selectedProjectId}
                      chainId={selectedChainIdNum}
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
                        projectId={selectedProjectId}
                        chainId={selectedChainIdNum}
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
                projectId={selectedProjectId}
                chainId={selectedChainIdNum}
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
