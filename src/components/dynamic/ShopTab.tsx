import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatUnits } from 'viem'
import { useThemeStore } from '../../stores'
import { fetchProjectNFTTiers, getProjectDataHook, hasTokenUriResolver, fetchShopPayCredits, type ResolvedNFTTier } from '../../services/nft'
import { fetchEthPrice, fetchProject } from '../../services/bendystraw'
import { rulesetKeys, getShopStaleTime } from '../../hooks/useRulesetCache'
import { useGuardedTx } from '../../hooks/useGuardedTx'
import { isUsdcCurrency } from '../../utils/technicalDetails'
import { truncateAddress } from '../../utils'
import { CHAINS, MAINNET_CHAINS } from '../../constants'
import NFTTierCard from './NFTTierCard'
import ChainLogo from '../ui/ChainLogo'
import { CustomersSubtab } from '../project/shop/CustomersSubtab'

type ShopSubtab = 'inventory' | 'customers'

// The shop subtab isn't part of the dashboard's owners-subtab hash scheme
// (parseProjectHash only knows owners subtabs), so read/write the `#shop/…`
// suffix locally. Only 'customers' gets a suffix; Inventory is the bare `#shop`.
function readShopSubtabFromHash(): ShopSubtab {
  const [rawTab, rawSub] = window.location.hash.replace(/^#/, '').split('/')
  if (rawTab?.toLowerCase() === 'shop' && rawSub?.toLowerCase() === 'customers') return 'customers'
  return 'inventory'
}

// Metadata extracted from on-chain resolver
interface TierMetadata {
  productName?: string
  categoryName?: string
}

interface ShopTabProps {
  projectId: string
  chainId: string
  isOwner?: boolean
  /** Revnets are token-based — item redemption is a custom-project feature only. */
  isRevnet?: boolean
  connectedChains?: Array<{ chainId: number; projectId: number }>
  /** Which subtab to open on (defaults to the URL hash, else Inventory). */
  initialSubtab?: ShopSubtab
  onManageTiers?: () => void
}

export default function ShopTab({ projectId, chainId, isOwner, isRevnet, connectedChains, initialSubtab, onManageTiers }: ShopTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress } = useGuardedTx()

  // [Inventory | Customers] subtabs. Inventory is the existing shop; Customers
  // shows who's bought + the item-redemption flow. The active subtab is mirrored
  // into the `#shop/customers` hash so it survives reloads and deep links.
  const [subtab, setSubtab] = useState<ShopSubtab>(() => initialSubtab ?? readShopSubtabFromHash())
  const selectSubtab = useCallback((next: ShopSubtab) => {
    setSubtab(next)
    const base = '#shop'
    window.history.replaceState(null, '', next === 'customers' ? `${base}/customers` : base)
  }, [])
  // Category filter is a multi-select set (null = All), mirroring website's shop
  // (discover.js): the chip row only appears with >1 category and each chip toggles.
  const [selectedCategories, setSelectedCategories] = useState<Set<number> | null>(null)
  // Category names extracted from on-chain metadata (category number -> name)
  const [categoryNames, setCategoryNames] = useState<Record<number, string>>({})
  // Checkout quantities from ProjectCard (synced via event)
  const [checkoutQuantities, setCheckoutQuantities] = useState<Record<number, number>>({})

  const chainIdNum = parseInt(chainId)

  // 721 tiers and their remaining supply are strictly per-chain, so the shop
  // shows one chain's inventory at a time. Build the list of chains this project
  // lives on, defaulting to just the primary chain when there are no peers.
  const availableChains = useMemo(
    () => connectedChains && connectedChains.length > 0
      ? connectedChains
      : [{ chainId: chainIdNum, projectId: parseInt(projectId) }],
    [chainIdNum, connectedChains, projectId],
  )

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
  const { data: shopData, error: shopError, isLoading: loading, isFetching, refetch } = useQuery({
    queryKey: rulesetKeys.shop(selectedChainIdNum, parseInt(selectedProjectId)),
    queryFn: async () => {
      const [tiersData, price, hook, project] = await Promise.all([
        fetchProjectNFTTiers(selectedProjectId, selectedChainIdNum),
        fetchEthPrice(),
        getProjectDataHook(selectedProjectId, selectedChainIdNum),
        fetchProject(selectedProjectId, selectedChainIdNum),
      ])
      // Check if hook has tokenUriResolver (if hook exists)
      const hasResolver = hook ? await hasTokenUriResolver(hook, selectedChainIdNum) : false
      return {
        tiers: tiersData,
        ethPrice: price,
        hookAddress: hook,
        hasTokenUriResolver: hasResolver,
        storedCategoryNames: project.metadata?.storeCategories || project.metadata?.['721Categories'] || {},
      }
    },
    staleTime: getShopStaleTime(),
  })

  const tiers = useMemo(() => shopData?.tiers ?? [], [shopData?.tiers])
  const ethPrice = shopData?.ethPrice
  const hookAddress = shopData?.hookAddress ?? null
  const hookHasTokenUriResolver = shopData?.hasTokenUriResolver ?? false
  const storedCategoryNames = useMemo(
    () => shopData?.storedCategoryNames ?? {},
    [shopData?.storedCategoryNames],
  )

  // The connected wallet's 721 shop credit on this collection's hook — overpayment
  // held in the hook's pricing currency, applied automatically at checkout. Keyed
  // per (chain, hook, account) so it refreshes when the wallet or chain changes.
  const { data: payCredit } = useQuery({
    queryKey: ['shopPayCredit', selectedChainIdNum, hookAddress, activeAddress],
    queryFn: () => fetchShopPayCredits(hookAddress!, activeAddress!, selectedChainIdNum),
    enabled: Boolean(hookAddress && activeAddress),
    staleTime: 30_000,
  })

  // Format the credit in the collection's pricing currency (USD-based → "$x.xx",
  // ETH-based → "x.xxxx ETH"), mirroring the tier price display. Any tier carries
  // the shared pricing context; only shown when a positive credit exists.
  const creditDisplay = useMemo(() => {
    const pricingTier = tiers[0]
    if (!payCredit || payCredit <= 0n || !pricingTier) return null
    const isUsdBased = pricingTier.currency === 2 || isUsdcCurrency(pricingTier.currency)
    const value = parseFloat(formatUnits(payCredit, pricingTier.pricingDecimals))
    return isUsdBased ? `$${value.toFixed(2)}` : `${value.toFixed(4)} ETH`
  }, [payCredit, tiers])

  // The 721 collection (hook) address + its explorer link, for the shop footer.
  const collectionExplorerUrl = useMemo(() => {
    if (!hookAddress) return null
    const base = CHAINS[selectedChainIdNum]?.explorer || MAINNET_CHAINS[selectedChainIdNum]?.explorer
    return base ? `${base}/address/${hookAddress}` : null
  }, [hookAddress, selectedChainIdNum])

  // Handle refresh button click
  const handleRefresh = useCallback(() => {
    refetch()
  }, [refetch])

  // Listen for checkout quantity updates from ProjectCard
  useEffect(() => {
    const handleCheckoutQuantities = (e: CustomEvent<{ quantities: Record<number, number> }>) => {
      setCheckoutQuantities(e.detail.quantities)
    }

    window.addEventListener('juice:checkout-quantities', handleCheckoutQuantities as EventListener)
    return () => window.removeEventListener('juice:checkout-quantities', handleCheckoutQuantities as EventListener)
  }, [])

  // Extract unique categories — including category 0 (labeled "General"), matching
  // the website. Sorted ascending.
  const categories = useMemo(() => {
    const cats = new Set<number>()
    tiers.forEach(tier => cats.add(tier.category || 0))
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

  // Categories currently shown (null selection = All).
  const visibleCategories = useMemo(
    () => categories.filter(cat => !selectedCategories || selectedCategories.has(cat)),
    [categories, selectedCategories],
  )

  // Toggle a category in the multi-select set; deselecting the last returns to All.
  const toggleCategory = useCallback((cat: number) => {
    setSelectedCategories(prev => {
      const next = new Set(prev ?? [])
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next.size ? next : null
    })
  }, [])

  // Handle metadata loaded from NFTTierCard (extracts category names)
  const handleTierMetadataLoaded = useCallback((tierId: number, metadata: TierMetadata) => {
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

  // Get category display name (on-chain metadata → stored → fallback). Category 0
  // is "General" when unnamed, matching the website.
  const getCategoryName = useCallback((cat: number) => {
    const stored = storedCategoryNames[String(cat)]
    if (categoryNames[cat]) return categoryNames[cat]
    if (typeof stored === 'string' && stored.trim()) return stored
    return cat === 0 ? 'General' : `Category ${cat}`
  }, [categoryNames, storedCategoryNames])

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
          <ChainLogo chainId={selectedChainIdNum} size={14} />
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
                  <ChainLogo chainId={chain.chainId} size={14} />
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

  // The existing shop body — inventory cards, filters, chain switcher. Rendered
  // unchanged; only wrapped so the Customers subtab can sit beside it.
  const renderInventory = () => {
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

  if (shopError) {
    const message = shopError instanceof Error ? shopError.message : 'Shop contract configuration could not be verified'
    return (
      <div>
        {chainSelector}
        <div className={`border p-4 text-sm ${
          isDark
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
            : 'border-amber-300 bg-amber-50 text-amber-800'
        }`}>
          {message}. Shop actions are unavailable.
        </div>
      </div>
    )
  }

  // The 721 collection (hook) address + explorer link. Shown once a hook resolves
  // (both the empty and populated shop states), matching website's shop footer.
  const collectionFooter = hookAddress ? (
    <div className={`mt-6 pt-3 border-t text-xs ${isDark ? 'border-white/10 text-gray-500' : 'border-gray-200 text-gray-400'}`}>
      Address:{' '}
      {collectionExplorerUrl ? (
        <a
          href={collectionExplorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-juice-cyan hover:underline font-mono"
        >
          {truncateAddress(hookAddress)}
        </a>
      ) : (
        <span className="font-mono">{truncateAddress(hookAddress)}</span>
      )}
    </div>
  ) : null

  // Compact renderer for one tier card — used by both the grouped and flat layouts.
  const renderTierCard = (tier: ResolvedNFTTier) => (
    <div key={tier.tierId} id={`shop-tier-${tier.tierId}`}>
      <NFTTierCard
        tier={tier}
        projectId={selectedProjectId}
        chainId={selectedChainIdNum}
        ethPrice={ethPrice ?? undefined}
        isOwner={isOwner}
        hookAddress={hookAddress}
        addToCheckoutMode
        onMetadataLoaded={handleTierMetadataLoaded}
        connectedChains={connectedChains}
        checkoutQuantity={checkoutQuantities[tier.tierId] || 0}
        hasTokenUriResolver={hookHasTokenUriResolver}
      />
    </div>
  )

  if (tiers.length === 0) {
    return (
      <div>
        {chainSelector}
        <div className={`text-center py-12 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          <p className="text-lg font-medium">{hookAddress ? 'No items being sold yet' : 'No NFT store available.'}</p>
          {isOwner && onManageTiers && (
            <button
              onClick={onManageTiers}
              className="mt-4 px-3 py-2 text-sm font-medium bg-green-500 text-black hover:bg-green-600 transition-colors"
            >
              Manage tiers
            </button>
          )}
        </div>
        {collectionFooter}
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Top right controls */}
      <div className="absolute -top-1 right-0 flex items-center gap-2">
        {isOwner && onManageTiers && (
          <button
            onClick={onManageTiers}
            className="px-2 py-1 text-[10px] font-medium bg-green-500/20 text-green-500 hover:bg-green-500/30 transition-colors rounded"
          >
            Manage tiers
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

      {/* Your shop credit — 721 pay credits held by this collection's hook, applied
          automatically at checkout (mirrors website's shop-credits row). */}
      {creditDisplay && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-4 text-sm"
          title="Overpayment becomes shop credit and is applied automatically to eligible items at checkout."
        >
          <span className={isDark ? 'text-gray-400' : 'text-gray-600'}>Your shop credit</span>
          <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{creditDisplay}</span>
          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Applied automatically at checkout</span>
        </div>
      )}

      {/* Category filter chips — only with more than one category (incl. General).
          Multi-select: "All" (no selection) or any subset of categories. */}
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setSelectedCategories(null)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors border ${
              !selectedCategories
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
              onClick={() => toggleCategory(cat)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors border ${
                selectedCategories?.has(cat)
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

      {/* Tiers display — grouped under category headings when there's more than one
          category (respecting the selection), otherwise a flat grid. */}
      {categories.length > 1 ? (
        <div className="space-y-8">
          {visibleCategories.map(cat => (
            tiersByCategory[cat] && tiersByCategory[cat].length > 0 ? (
              <div key={cat}>
                <h3 className={`text-sm font-semibold mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {getCategoryName(cat)}
                </h3>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {tiersByCategory[cat].map(renderTierCard)}
                </div>
              </div>
            ) : null
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {tiers.map(renderTierCard)}
        </div>
      )}

      {collectionFooter}
    </div>
  )
  }

  return (
    <div className="space-y-4">
      {/* [Inventory | Customers] subtabs */}
      <div className={`flex gap-1 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        {(['inventory', 'customers'] as const).map(id => (
          <button
            key={id}
            onClick={() => selectSubtab(id)}
            className={`px-3 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              subtab === id
                ? 'border-juice-orange text-juice-orange'
                : isDark
                  ? 'border-transparent text-gray-400 hover:text-gray-200'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {id}
          </button>
        ))}
      </div>
      {subtab === 'inventory' ? (
        renderInventory()
      ) : (
        <CustomersSubtab projectId={projectId} chainId={chainIdNum} chains={availableChains} isRevnet={isRevnet} />
      )}
    </div>
  )
}
