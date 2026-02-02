import { useState, useEffect, useCallback } from 'react'
import { formatEther } from 'viem'
import { useAccount } from 'wagmi'
import { useThemeStore, useSettingsStore } from '../../stores'
import {
  fetchProject,
  fetchConnectedChains,
  type Project,
  type ConnectedChain,
} from '../../services/bendystraw'
import {
  getProjectDataHook,
  fetchNFTTiersWithPermissions,
  fetchHookFlags,
  type NFTTierWithPermissions,
  type JB721HookFlags,
} from '../../services/nft'
import type { JB721TierConfigInput } from '../../services/tiersHook'
import { resolveIpfsUri } from '../../utils/ipfs'
import TierPermissionsAlert from './TierPermissionsAlert'
import TierEditor, { type TierMetadata } from './TierEditor'
import { ManageTiersModal } from '../payment'

interface ManageTiersFormProps {
  projectId: string
  chainId?: string
}

// Chain info for display
const CHAIN_INFO: Record<number, { name: string; shortName: string; slug: string; color: string }> = {
  1: { name: 'Ethereum', shortName: 'ETH', slug: 'eth', color: '#627EEA' },
  10: { name: 'Optimism', shortName: 'OP', slug: 'op', color: '#FF0420' },
  8453: { name: 'Base', shortName: 'BASE', slug: 'base', color: '#0052FF' },
  42161: { name: 'Arbitrum', shortName: 'ARB', slug: 'arb', color: '#28A0F0' },
}

// Pending changes state
interface PendingChanges {
  tiersToAdd: Array<{ config: JB721TierConfigInput; metadata: TierMetadata }>
  tierIdsToRemove: number[]
  metadataUpdates: Array<{ tierId: number; uri: string; metadata: TierMetadata }>
  discountUpdates: Array<{ tierId: number; discountPercent: number }>
}

// Per-chain hook data
interface ChainHookData {
  chainId: number
  projectId: number
  hookAddress: `0x${string}` | null
  flags: JB721HookFlags | null
  tiers: NFTTierWithPermissions[]
  selected: boolean
}

export default function ManageTiersForm({ projectId, chainId = '1' }: ManageTiersFormProps) {
  const { theme } = useThemeStore()
  const { pinataJwt } = useSettingsStore()
  const isDark = theme === 'dark'
  const { isConnected } = useAccount()

  // Project state
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Chain & hook state
  const [chainHookData, setChainHookData] = useState<ChainHookData[]>([])

  // Editing state
  const [showEditor, setShowEditor] = useState(false)
  const [editingTier, setEditingTier] = useState<NFTTierWithPermissions | null>(null)

  // Pending changes
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({
    tiersToAdd: [],
    tierIdsToRemove: [],
    metadataUpdates: [],
    discountUpdates: [],
  })

  // Modal state
  const [showModal, setShowModal] = useState(false)

  // Derived state
  const primaryChainId = parseInt(chainId)
  const selectedChains = chainHookData.filter(cd => cd.selected)
  const isOmnichain = chainHookData.length > 1
  const primaryHookData = chainHookData.find(cd => cd.chainId === primaryChainId) || chainHookData[0]
  const hookFlags = primaryHookData?.flags
  const currentTiers = primaryHookData?.tiers || []

  // Check if there are any pending changes
  const hasPendingChanges =
    pendingChanges.tiersToAdd.length > 0 ||
    pendingChanges.tierIdsToRemove.length > 0 ||
    pendingChanges.metadataUpdates.length > 0 ||
    pendingChanges.discountUpdates.length > 0

  // Dispatch event to open wallet panel
  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  // Load project and hook data
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      try {
        // Fetch project data
        const [projectData, connectedChains] = await Promise.all([
          fetchProject(projectId, primaryChainId),
          fetchConnectedChains(projectId, primaryChainId),
        ])
        setProject(projectData)

        // Determine chains to fetch
        const chainsToFetch: ConnectedChain[] = connectedChains.length > 0
          ? connectedChains
          : [{ chainId: primaryChainId, projectId: parseInt(projectId) }]

        // Fetch hook data from all chains in parallel
        const hookDataPromises = chainsToFetch.map(async (chain): Promise<ChainHookData> => {
          try {
            const hookAddress = await getProjectDataHook(String(chain.projectId), chain.chainId)

            if (!hookAddress) {
              return {
                chainId: chain.chainId,
                projectId: chain.projectId,
                hookAddress: null,
                flags: null,
                tiers: [],
                selected: true,
              }
            }

            const [flags, tiers] = await Promise.all([
              fetchHookFlags(hookAddress, chain.chainId),
              fetchNFTTiersWithPermissions(hookAddress, chain.chainId),
            ])

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              hookAddress,
              flags,
              tiers,
              selected: true,
            }
          } catch (err) {
            console.error(`Failed to fetch hook data for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              hookAddress: null,
              flags: null,
              tiers: [],
              selected: true,
            }
          }
        })

        const allHookData = await Promise.all(hookDataPromises)
        setChainHookData(allHookData)

        // Check if any chain has a hook
        const hasHook = allHookData.some(cd => cd.hookAddress)
        if (!hasHook) {
          setError('No NFT collection configured for this project')
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
      }))
    }
  }, [currentTiers, pendingChanges.tierIdsToRemove])

  // Undo pending add
  const handleUndoAdd = useCallback((index: number) => {
    setPendingChanges(prev => ({
      ...prev,
      tiersToAdd: prev.tiersToAdd.filter((_, i) => i !== index),
    }))
  }, [])

  // Handle submit
  const handleSubmit = useCallback(() => {
    if (!hasPendingChanges) return

    if (!isConnected) {
      openWalletPanel()
      return
    }

    setShowModal(true)
  }, [hasPendingChanges, isConnected])

  // Reset after successful transaction
  const handleTransactionComplete = useCallback(() => {
    setPendingChanges({
      tiersToAdd: [],
      tierIdsToRemove: [],
      metadataUpdates: [],
      discountUpdates: [],
    })
    setShowModal(false)
    // Could trigger a refresh here
  }, [])

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
  const projectUrl = `https://juicebox.money/v5/${chainInfo.slug}:${projectId}`

  return (
    <div className="w-full">
      <div className={`max-w-2xl border ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className="p-4 border-b border-gray-600/50">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt={project?.name || 'Project'} className="w-14 h-14 object-cover" />
            ) : (
              <div className="w-14 h-14 bg-purple-500/20 flex items-center justify-center">
                <span className="text-2xl">NFT</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Manage NFT Tiers
              </h3>
              <a
                href={projectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-xs hover:underline ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
              >
                {project?.name || `Project #${projectId}`}
              </a>
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
                    <img src={imageUrl} alt={tier.name} className="w-12 h-12 object-cover" />
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
                      {formatEther(tier.price)} ETH · {tier.remainingSupply}/{tier.initialSupply} left
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
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
                        {formatEther(BigInt(config.price))} ETH · {config.initialSupply} supply
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

          {/* Tier Editor */}
          {showEditor && hookFlags && (
            <div className="mb-4">
              <TierEditor
                existingTier={editingTier ? {
                  tierId: editingTier.tierId,
                  name: editingTier.name,
                  description: editingTier.description,
                  imageUri: editingTier.imageUri,
                  price: editingTier.price.toString(),
                  initialSupply: editingTier.initialSupply,
                  votingUnits: Number(editingTier.votingUnits),
                  reserveFrequency: editingTier.reservedRate,
                  category: editingTier.category,
                  allowOwnerMint: editingTier.allowOwnerMint,
                  transfersPausable: editingTier.transfersPausable,
                  permissions: editingTier.permissions,
                } : undefined}
                hookFlags={hookFlags}
                onSave={handleAddTier}
                onCancel={() => {
                  setShowEditor(false)
                  setEditingTier(null)
                }}
                pinataJwt={pinataJwt}
              />
            </div>
          )}

          {/* Add Tier Button */}
          {!showEditor && (
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
        {hasPendingChanges && (
          <div className={`p-4 border-t ${isDark ? 'border-gray-600/50' : 'border-gray-200'}`}>
            <div className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {pendingChanges.tiersToAdd.length > 0 && (
                <span className="text-green-500">+{pendingChanges.tiersToAdd.length} add </span>
              )}
              {pendingChanges.tierIdsToRemove.length > 0 && (
                <span className="text-red-500">-{pendingChanges.tierIdsToRemove.length} remove</span>
              )}
              {selectedChains.length > 1 && (
                <span className="ml-2">on {selectedChains.length} chains</span>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={selectedChains.length === 0}
              className={`w-full py-3 text-sm font-bold transition-colors ${
                selectedChains.length === 0
                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                  : 'bg-juice-orange hover:bg-juice-orange/90 text-black'
              }`}
            >
              Review & Submit Changes
            </button>
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
          onComplete={handleTransactionComplete}
        />
      )}
    </div>
  )
}
