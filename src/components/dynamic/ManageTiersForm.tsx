import { useState, useEffect, useCallback, useMemo } from 'react'
import { formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { useThemeStore, useSettingsStore } from '../../stores'
import { useManageTiersFormState } from '../../hooks/useComponentState'
import { useManagedWallet } from '../../hooks'
import {
  fetchProject,
  type Project,
} from '../../services/bendystraw'
import {
  getProjectDataHook,
  fetchNFTTiersWithPermissions,
  fetchHookFlags,
  fetchNFTPricingContext,
  getEffectiveTierPrice,
  type NFTTierWithPermissions,
  type JB721HookFlags,
} from '../../services/nft'
import { isUsdcCurrency } from '../../utils/technicalDetails'
import { MAINNET_CHAINS } from '../../constants'
import type {
  JB721DiscountPercentConfig,
  JB721TierConfigInput,
} from '../../services/tiersHook'
import { resolveIpfsUri } from '../../utils/ipfs'
import TierPermissionsAlert from './TierPermissionsAlert'
import TierEditor, { type TierMetadata } from './TierEditor'
import { ManageTiersModal } from '../payment'
import { ProjectLink } from './ProjectLink'
import { resolveProjectChains } from '../../utils/projectChains'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'

interface ManageTiersFormProps {
  projectId: string
  chainId?: string
  messageId?: string // For persisting state to server (visible to all chat users)
}

// Chain info for display
const CHAIN_INFO = MAINNET_CHAINS

// Pending changes state
interface PendingChanges {
  tiersToAdd: Array<{ config: JB721TierConfigInput; metadata: TierMetadata }>
  tierIdsToRemove: number[]
  discountPercents: JB721DiscountPercentConfig[]
}

// Per-chain hook data
interface ChainHookData {
  chainId: number
  projectId: number
  hookAddress: `0x${string}` | null
  flags: JB721HookFlags | null
  pricing: { currency: number; decimals: number } | null
  tiers: NFTTierWithPermissions[]
  error?: string
  selected: boolean
}

export default function ManageTiersForm({ projectId, chainId = '1', messageId }: ManageTiersFormProps) {
  const { theme } = useThemeStore()
  const { pinataJwt } = useSettingsStore()
  const isDark = theme === 'dark'
  const { isConnected } = useAccount()
  const { address: managedAddress, isManagedMode } = useManagedWallet()
  const hasActiveWallet = isManagedMode ? !!managedAddress : isConnected

  // Persistent state for transaction status
  const { state: persistedState, updateState: updatePersistedState } = useManageTiersFormState(messageId)

  // Check if form is locked (already submitted)
  const isLocked = persistedState?.status && persistedState.status !== 'pending'

  // Project state
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Chain & hook state
  const [chainHookData, setChainHookData] = useState<ChainHookData[]>([])
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)

  // Editing state
  const [showEditor, setShowEditor] = useState(false)
  // Pending changes
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({
    tiersToAdd: [],
    tierIdsToRemove: [],
    discountPercents: [],
  })
  const [discountDrafts, setDiscountDrafts] = useState<Record<number, string>>({})
  const [discountErrors, setDiscountErrors] = useState<Record<number, string>>({})

  // Modal state
  const [showModal, setShowModal] = useState(false)

  // Derived state
  const primaryChainId = parseInt(chainId)
  const selectedChains = chainHookData.filter(cd => cd.selected)
  const isOmnichain = chainHookData.length > 1
  const primaryHookData = chainHookData.find(cd => cd.chainId === primaryChainId) || chainHookData[0]
  const hookFlags = primaryHookData?.flags
  const pricing = primaryHookData?.pricing
  const currentTiers = useMemo(() => primaryHookData?.tiers || [], [primaryHookData?.tiers])
  const pricingMismatch = selectedChains.some(chainData =>
    !chainData.pricing ||
    !pricing ||
    chainData.pricing.currency !== pricing.currency ||
    chainData.pricing.decimals !== pricing.decimals
  )
  const pricingRecognized = !!pricing && (
    pricing.currency === 1 || pricing.currency === 2 || isUsdcCurrency(pricing.currency)
  )

  // Check if there are any pending changes
  const hasPendingChanges =
    pendingChanges.tiersToAdd.length > 0 ||
    pendingChanges.tierIdsToRemove.length > 0 ||
    pendingChanges.discountPercents.length > 0

  // Dispatch event to open wallet panel
  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  // Callbacks for transaction completion (for persistence)
  const handleConfirmed = useCallback((txHash: string) => {
    updatePersistedState({
      status: 'completed',
      txHash,
      confirmedAt: new Date().toISOString(),
    })
  }, [updatePersistedState])

  const handleError = useCallback((errorMsg: string) => {
    updatePersistedState({
      status: 'failed',
      error: errorMsg,
    })
  }, [updatePersistedState])

  // Load project and hook data
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      try {
        // Fetch project data
        const [projectData, chainResolution] = await Promise.all([
          fetchProject(projectId, primaryChainId),
          resolveProjectChains(projectId, primaryChainId),
        ])
        setProject(projectData)
        setChainMappingAvailable(chainResolution.mappingAvailable)

        // Fetch hook data from all chains in parallel
        const hookDataPromises = chainResolution.chains.map(async (chain): Promise<ChainHookData> => {
          try {
            const hookAddress = await getProjectDataHook(String(chain.projectId), chain.chainId)

            if (!hookAddress) {
              return {
                chainId: chain.chainId,
                projectId: chain.projectId,
                hookAddress: null,
                flags: null,
                pricing: null,
                tiers: [],
                error: 'No recognized NFT hook configured',
                selected: false,
              }
            }

            const [flags, tiers, pricingContext] = await Promise.all([
              fetchHookFlags(hookAddress, chain.chainId),
              fetchNFTTiersWithPermissions(hookAddress, chain.chainId),
              fetchNFTPricingContext(hookAddress, chain.chainId),
            ])

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              hookAddress,
              flags,
              pricing: pricingContext,
              tiers,
              selected: chain.chainId === primaryChainId && chain.projectId === parseInt(projectId),
            }
          } catch (err) {
            console.error(`Failed to fetch hook data for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              hookAddress: null,
              flags: null,
              pricing: null,
              tiers: [],
              error: err instanceof Error ? err.message : 'Could not verify NFT hook',
              selected: false,
            }
          }
        })

        const allHookData = await Promise.all(hookDataPromises)
        setChainHookData(allHookData)

        // Check if any chain has a hook
        const hasHook = allHookData.some(cd => cd.hookAddress)
        if (!hasHook) {
          setError(allHookData.find(cd => cd.error)?.error || 'No NFT collection configured for this project')
        }
      } catch (err) {
        console.error('Failed to load project:', err)
        setError('Failed to load project data')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [projectId, primaryChainId])

  // Toggle chain selection
  const toggleChainSelection = useCallback((chainId: number) => {
    setChainHookData(prev =>
      prev.map(cd =>
        cd.chainId === chainId ? { ...cd, selected: !cd.selected } : cd
      )
    )
  }, [])

  const incompatibleRemoval = selectedChains.find(chainData =>
    pendingChanges.tierIdsToRemove.some(tierId => {
      const tier = chainData.tiers.find(candidate => candidate.tierId === tierId)
      return !tier || tier.permissions.cannotBeRemoved
    })
  )

  const incompatibleDiscount = selectedChains.find(chainData =>
    pendingChanges.discountPercents.some(update => {
      const tier = chainData.tiers.find(candidate => candidate.tierId === update.tierId)
      return !tier || (
        tier.permissions.cannotIncreaseDiscountPercent &&
        update.discountPercent > (tier.discountPercent ?? 0)
      )
    })
  )

  // Add new tier
  const handleAddTier = useCallback((config: JB721TierConfigInput, metadata: TierMetadata) => {
    setPendingChanges(prev => ({
      ...prev,
      tiersToAdd: [...prev.tiersToAdd, { config, metadata }],
    }))
    setShowEditor(false)
  }, [])

  // Remove tier
  const handleRemoveTier = useCallback((tierId: number) => {
    // Check if tier can be removed
    const tier = currentTiers.find(t => t.tierId === tierId)
    if (tier?.permissions.cannotBeRemoved) {
      return
    }

    // Check if it's already pending removal
    if (pendingChanges.tierIdsToRemove.includes(tierId)) {
      // Undo removal
      setPendingChanges(prev => ({
        ...prev,
        tierIdsToRemove: prev.tierIdsToRemove.filter(id => id !== tierId),
      }))
    } else {
      // Mark for removal
      setPendingChanges(prev => ({
        ...prev,
        tierIdsToRemove: [...prev.tierIdsToRemove, tierId],
        discountPercents: prev.discountPercents.filter(update => update.tierId !== tierId),
      }))
    }
  }, [currentTiers, pendingChanges.tierIdsToRemove])

  const handleStageDiscount = useCallback((tier: NFTTierWithPermissions) => {
    const rawValue = discountDrafts[tier.tierId] ?? String((tier.discountPercent ?? 0) / 2)
    const humanPercent = Number(rawValue)
    const discountPercent = humanPercent * 2
    if (
      !Number.isFinite(humanPercent) ||
      humanPercent < 0 ||
      humanPercent > 100 ||
      !Number.isInteger(discountPercent)
    ) {
      setDiscountErrors(prev => ({
        ...prev,
        [tier.tierId]: 'Use a discount from 0% to 100% in 0.5% steps.',
      }))
      return
    }
    if (
      tier.permissions.cannotIncreaseDiscountPercent &&
      discountPercent > (tier.discountPercent ?? 0)
    ) {
      setDiscountErrors(prev => ({
        ...prev,
        [tier.tierId]: 'This tier has permanently locked discount increases.',
      }))
      return
    }

    setDiscountErrors(prev => {
      const next = { ...prev }
      delete next[tier.tierId]
      return next
    })
    setPendingChanges(prev => ({
      ...prev,
      discountPercents: discountPercent === (tier.discountPercent ?? 0)
        ? prev.discountPercents.filter(update => update.tierId !== tier.tierId)
        : [
            ...prev.discountPercents.filter(update => update.tierId !== tier.tierId),
            { tierId: tier.tierId, discountPercent },
          ],
    }))
  }, [discountDrafts])

  // Undo pending add
  const handleUndoAdd = useCallback((index: number) => {
    setPendingChanges(prev => ({
      ...prev,
      tiersToAdd: prev.tiersToAdd.filter((_, i) => i !== index),
    }))
  }, [])

  // Handle submit
  const handleSubmit = useCallback(() => {
    if (
      !hasPendingChanges ||
      isLocked ||
      incompatibleRemoval ||
      incompatibleDiscount ||
      pricingMismatch ||
      !pricingRecognized
    ) return

    if (!hasActiveWallet) {
      openWalletPanel()
      return
    }

    setShowModal(true)
  }, [
    hasPendingChanges,
    hasActiveWallet,
    isLocked,
    incompatibleRemoval,
    incompatibleDiscount,
    pricingMismatch,
    pricingRecognized,
  ])

  // Reset after successful transaction
  const handleTransactionComplete = useCallback((txHash?: string) => {
    setPendingChanges({
      tiersToAdd: [],
      tierIdsToRemove: [],
      discountPercents: [],
    })
    setDiscountDrafts({})
    setDiscountErrors({})
    setShowModal(false)
    // Update persisted state
    if (txHash) {
      handleConfirmed(txHash)
    }
  }, [handleConfirmed])

  // Loading state
  if (loading) {
    return (
      <div className="w-full">
        <div className={`max-w-2xl border p-4 animate-pulse ${
          isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
        }`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-14 h-14 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className="flex-1">
              <div className={`h-5 w-40 mb-2 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
              <div className={`h-4 w-24 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            </div>
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className={`h-20 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Error state (no hook)
  if (error) {
    return (
      <div className={`max-w-2xl border p-6 text-center ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        <div className="text-3xl mb-3">!</div>
        <p className={`mb-4 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{error}</p>
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
          To add NFT rewards, configure a 721 hook when setting up your project&apos;s ruleset.
        </p>
      </div>
    )
  }

  const logoUrl = project?.logoUri ? resolveIpfsUri(project.logoUri) : null
  const chainInfo = CHAIN_INFO[primaryChainId] || CHAIN_INFO[1]

  return (
    <div className="w-full">
      <div className={`max-w-2xl border ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}
        {/* Header */}
        <div className="p-4 border-b border-gray-600/50">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <IpfsImage uri={project?.logoUri} alt={project?.name || 'Project'} className="w-14 h-14 object-cover" fallback={<div className="w-14 h-14 bg-purple-500/20" />} />
            ) : (
              <div className="w-14 h-14 bg-purple-500/20 flex items-center justify-center">
                <span className="text-2xl">NFT</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Manage NFT Tiers
              </h3>
              <ProjectLink chainSlug={chainInfo.slug} projectId={projectId} className={`text-xs hover:underline ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}>
                {project?.name || `Project #${projectId}`}
              </ProjectLink>
            </div>
          </div>
        </div>

        {/* Chain Selection for omnichain */}
        {isOmnichain && (
          <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-600/50' : 'border-gray-200'}`}>
            <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Apply changes to:
            </div>
            <div className="flex flex-wrap gap-2">
              {chainHookData.map(cd => {
                const chain = CHAIN_INFO[cd.chainId]
                const hasHook = !!cd.hookAddress
                return (
                  <button
                    key={cd.chainId}
                    onClick={() => hasHook && toggleChainSelection(cd.chainId)}
                    disabled={!hasHook}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                      !hasHook
                        ? 'bg-gray-500/20 text-gray-500 cursor-not-allowed'
                        : cd.selected
                          ? isDark
                            ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                            : 'bg-purple-100 text-purple-700 border border-purple-300'
                          : isDark
                            ? 'bg-white/5 text-gray-400 border border-white/10'
                            : 'bg-gray-100 text-gray-500 border border-gray-200'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: hasHook ? chain?.color || '#888' : '#666' }}
                    />
                    {chain?.shortName || cd.chainId}
                    {hasHook && cd.selected && <span className="opacity-70">ok</span>}
                    {!hasHook && <span className="text-[10px]">(no hook)</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Permission Alerts */}
        {hookFlags && (
          <div className="px-4 py-3">
            <TierPermissionsAlert flags={hookFlags} compact />
          </div>
        )}

        {/* Tier List */}
        <div className="px-4 pb-4">
          {/* Current Tiers */}
          <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Current Tiers ({currentTiers.length})
          </div>

          <div className="space-y-2 mb-4">
            {currentTiers.map((tier) => {
              const isPendingRemoval = pendingChanges.tierIdsToRemove.includes(tier.tierId)
              const pendingDiscount = pendingChanges.discountPercents.find(
                update => update.tierId === tier.tierId
              )
              const imageUrl = resolveIpfsUri(tier.imageUri)

              return (
                <div
                  key={tier.tierId}
                  className={`flex items-center gap-3 p-3 border transition-opacity ${
                    isPendingRemoval ? 'opacity-50' : ''
                  } ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}
                >
                  {/* Image */}
                  {imageUrl ? (
                    <IpfsImage uri={tier.imageUri} fallbackSrc={imageUrl} alt={tier.name} className="w-12 h-12 object-cover" fallback={<div className={`w-12 h-12 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />} />
                  ) : (
                    <div className={`w-12 h-12 flex items-center justify-center ${
                      isDark ? 'bg-white/10' : 'bg-gray-200'
                    }`}>
                      <span className={`text-lg ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        #{tier.tierId}
                      </span>
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {tier.name}
                      {tier.permissions.cannotBeRemoved && (
                        <span className={`ml-2 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          (locked)
                        </span>
                      )}
                    </div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {formatUnits(getEffectiveTierPrice(tier), tier.pricingDecimals)} {tier.currency === 2 || isUsdcCurrency(tier.currency) ? 'USD' : 'ETH'} · {tier.remainingSupply}/{tier.initialSupply} left
                    </div>
                    <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Current discount: {((tier.discountPercent ?? 0) / 2).toLocaleString()}%
                      {tier.permissions.cannotIncreaseDiscountPercent && ' · increases locked'}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1">
                      <label className="sr-only" htmlFor={`tier-discount-${tier.tierId}`}>
                        Discount for tier {tier.tierId}
                      </label>
                      <input
                        id={`tier-discount-${tier.tierId}`}
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        disabled={isPendingRemoval || isLocked}
                        value={discountDrafts[tier.tierId] ?? String(
                          (pendingDiscount?.discountPercent ?? tier.discountPercent ?? 0) / 2
                        )}
                        onChange={(event) => setDiscountDrafts(prev => ({
                          ...prev,
                          [tier.tierId]: event.target.value,
                        }))}
                        className={`w-16 border px-2 py-1 text-right text-xs ${
                          isDark
                            ? 'border-white/20 bg-black/20 text-white'
                            : 'border-gray-300 bg-white text-gray-900'
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      />
                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>%</span>
                      <button
                        type="button"
                        onClick={() => handleStageDiscount(tier)}
                        disabled={isPendingRemoval || isLocked}
                        className={`px-2 py-1 text-xs font-medium ${
                          pendingDiscount
                            ? isDark ? 'text-green-400' : 'text-green-700'
                            : isDark ? 'text-juice-cyan' : 'text-cyan-700'
                        } disabled:cursor-not-allowed disabled:text-gray-500`}
                      >
                        {pendingDiscount ? 'Staged' : 'Set'}
                      </button>
                    </div>
                    {isPendingRemoval ? (
                      <button
                        onClick={() => handleRemoveTier(tier.tierId)}
                        className={`px-3 py-1 text-xs font-medium ${
                          isDark
                            ? 'text-amber-400 hover:text-amber-300'
                            : 'text-amber-600 hover:text-amber-700'
                        }`}
                      >
                        Undo
                      </button>
                    ) : (
                      <button
                        onClick={() => handleRemoveTier(tier.tierId)}
                        disabled={tier.permissions.cannotBeRemoved}
                        className={`px-3 py-1 text-xs font-medium transition-colors ${
                          tier.permissions.cannotBeRemoved
                            ? 'text-gray-500 cursor-not-allowed'
                            : isDark
                              ? 'text-red-400 hover:text-red-300'
                              : 'text-red-600 hover:text-red-700'
                        }`}
                      >
                        Remove
                      </button>
                    )}
                    {discountErrors[tier.tierId] && (
                      <span className="max-w-44 text-right text-[10px] text-red-400">
                        {discountErrors[tier.tierId]}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            {currentTiers.length === 0 && (
              <div className={`p-4 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                No tiers configured yet
              </div>
            )}
          </div>

          {/* Pending Additions */}
          {pendingChanges.tiersToAdd.length > 0 && (
            <>
              <div className={`text-xs font-medium mb-2 ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                Pending Additions ({pendingChanges.tiersToAdd.length})
              </div>

              <div className="space-y-2 mb-4">
                {pendingChanges.tiersToAdd.map(({ metadata, config }, index) => (
                  <div
                    key={index}
                    className={`flex items-center gap-3 p-3 border ${
                      isDark ? 'bg-green-500/10 border-green-500/30' : 'bg-green-50 border-green-200'
                    }`}
                  >
                    <div className={`w-12 h-12 flex items-center justify-center ${
                      isDark ? 'bg-green-500/20' : 'bg-green-100'
                    }`}>
                      <span className={`text-lg ${isDark ? 'text-green-400' : 'text-green-600'}`}>+</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-medium text-sm truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {metadata.name}
                      </div>
                      <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        {formatUnits(BigInt(config.price), pricing?.decimals ?? 18)} {pricing && (pricing.currency === 2 || isUsdcCurrency(pricing.currency)) ? 'USD' : 'ETH'} · {config.initialSupply} supply
                      </div>
                    </div>
                    <button
                      onClick={() => handleUndoAdd(index)}
                      className={`px-3 py-1 text-xs font-medium ${
                        isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Pending Removals Summary */}
          {pendingChanges.tierIdsToRemove.length > 0 && (
            <div className={`mb-4 p-3 text-sm ${
              isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'
            }`}>
              {pendingChanges.tierIdsToRemove.length} tier{pendingChanges.tierIdsToRemove.length !== 1 ? 's' : ''} will be removed
            </div>
          )}

          {pendingChanges.discountPercents.length > 0 && (
            <div className={`mb-4 p-3 text-sm ${
              isDark ? 'bg-cyan-500/10 text-cyan-300' : 'bg-cyan-50 text-cyan-700'
            }`}>
              {pendingChanges.discountPercents.length} discount change{
                pendingChanges.discountPercents.length === 1 ? '' : 's'
              } staged
            </div>
          )}

          {/* Tier Editor */}
          {showEditor && hookFlags && (
            <div className="mb-4">
              <TierEditor
                hookFlags={hookFlags}
                currencyLabel={pricing && (pricing.currency === 2 || isUsdcCurrency(pricing.currency)) ? 'USD' : 'ETH'}
                pricingDecimals={pricing?.decimals ?? 18}
                onSave={handleAddTier}
                onCancel={() => {
                  setShowEditor(false)
                }}
                pinataJwt={pinataJwt}
              />
            </div>
          )}

          {/* Add Tier Button */}
          {!pricingRecognized && (
            <p className={`mb-3 text-xs ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
              Tier pricing currency not recognized. Changes are unavailable.
            </p>
          )}
          {pricingMismatch && (
            <p className={`mb-3 text-xs ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
              Selected chains use different tier pricing. Update one chain at a time.
            </p>
          )}
          {!showEditor && !isLocked && pricingRecognized && !pricingMismatch && (
            <button
              onClick={() => setShowEditor(true)}
              className={`w-full py-3 text-sm font-medium border-2 border-dashed transition-colors ${
                isDark
                  ? 'border-white/20 text-gray-400 hover:border-white/40 hover:text-white'
                  : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700'
              }`}
            >
              + Add New Tier
            </button>
          )}
        </div>

        {/* Submit Section */}
        {(hasPendingChanges || isLocked) && (
          <div className={`p-4 border-t ${isDark ? 'border-gray-600/50' : 'border-gray-200'}`}>
            {/* Transaction Status Indicator */}
            {isLocked && (
              <div className={`mb-3 p-3 text-sm ${
                persistedState?.status === 'completed'
                  ? isDark ? 'bg-green-500/10' : 'bg-green-50'
                  : persistedState?.status === 'failed'
                    ? isDark ? 'bg-red-500/10' : 'bg-red-50'
                    : isDark ? 'bg-juice-orange/10' : 'bg-orange-50'
              }`}>
                <div className={`flex items-center gap-2 ${
                  persistedState?.status === 'completed'
                    ? isDark ? 'text-green-400' : 'text-green-600'
                    : persistedState?.status === 'failed'
                      ? isDark ? 'text-red-400' : 'text-red-600'
                      : isDark ? 'text-juice-orange' : 'text-orange-600'
                }`}>
                  {persistedState?.status === 'completed' ? (
                    <>
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Items updated successfully!</span>
                    </>
                  ) : persistedState?.status === 'failed' ? (
                    <>
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span>Transaction failed</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Transaction pending...</span>
                    </>
                  )}
                </div>
                {persistedState?.txHash && (
                  <a
                    href={`https://${CHAIN_INFO[primaryChainId]?.slug === 'eth' ? '' : CHAIN_INFO[primaryChainId]?.slug + '.'}etherscan.io/tx/${persistedState.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs mt-1 ml-6 underline block ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
                  >
                    View on explorer
                  </a>
                )}
                {persistedState?.error && (
                  <p className={`text-xs mt-1 ml-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {persistedState.error}
                  </p>
                )}
              </div>
            )}

            {!isLocked && (
              <>
                {incompatibleRemoval && (
                  <div className={`mb-3 p-3 text-xs ${isDark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-700'}`}>
                    A selected chain does not have every removable tier in the same unlocked state.
                  </div>
                )}
                {incompatibleDiscount && (
                  <div className={`mb-3 p-3 text-xs ${isDark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-700'}`}>
                    A selected chain is missing a tier or has permanently locked this discount increase.
                  </div>
                )}
                <div className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {pendingChanges.tiersToAdd.length > 0 && (
                    <span className="text-green-500">+{pendingChanges.tiersToAdd.length} add </span>
                  )}
                  {pendingChanges.tierIdsToRemove.length > 0 && (
                    <span className="text-red-500">-{pendingChanges.tierIdsToRemove.length} remove</span>
                  )}
                  {pendingChanges.discountPercents.length > 0 && (
                    <span className="ml-2 text-cyan-500">
                      {pendingChanges.discountPercents.length} discount
                    </span>
                  )}
                  {selectedChains.length > 1 && (
                    <span className="ml-2">on {selectedChains.length} chains</span>
                  )}
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={selectedChains.length === 0 || isLocked || !!incompatibleRemoval || !!incompatibleDiscount || pricingMismatch || !pricingRecognized}
                  className={`w-full py-3 text-sm font-bold transition-colors ${
                    selectedChains.length === 0 || isLocked || incompatibleRemoval || incompatibleDiscount || pricingMismatch || !pricingRecognized
                      ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                      : 'bg-juice-orange hover:bg-juice-orange/90 text-black'
                  }`}
                >
                  Review & Submit Changes
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Transaction Modal */}
      {showModal && primaryHookData?.hookAddress && (
        <ManageTiersModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          projectName={project?.name}
          chainHookData={selectedChains}
        pendingChanges={pendingChanges}
        pricingCurrency={pricing?.currency ?? 0}
        pricingDecimals={pricing?.decimals ?? 0}
          onComplete={handleTransactionComplete}
          onError={handleError}
        />
      )}
    </div>
  )
}
