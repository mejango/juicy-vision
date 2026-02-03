import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { isAddress } from 'viem'
import { useThemeStore } from '../../stores'
import { useSetSplitsFormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchProjectWithRuleset,
  fetchProjectSplits,
  fetchConnectedChains,
  type Project,
  type JBSplitData,
  type ConnectedChain,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { resolveEnsName } from '../../utils/ens'
import { SetSplitsModal } from '../payment'
import { ZERO_ADDRESS } from '../../constants'

interface SetSplitsFormProps {
  projectId: string
  chainId?: string
  messageId?: string // For persisting state to server (visible to all chat users)
}

// Chain info for display
const CHAIN_INFO: Record<number, { name: string; shortName: string; slug: string; color: string }> = {
  1: { name: 'Ethereum', shortName: 'ETH', slug: 'eth', color: '#627EEA' },
  10: { name: 'Optimism', shortName: 'OP', slug: 'op', color: '#FF0420' },
  8453: { name: 'Base', shortName: 'BASE', slug: 'base', color: '#0052FF' },
  42161: { name: 'Arbitrum', shortName: 'ARB', slug: 'arb', color: '#28A0F0' },
}

// Per-chain splits data
interface ChainSplitsData {
  chainId: number
  projectId: number
  rulesetId: string
  payoutSplits: JBSplitData[]
  reservedSplits: JBSplitData[]
  baseCurrency: number
  selected: boolean
}

// Editable split for the form
interface EditableSplit {
  id: string // unique key for React
  percent: string // user input as string (0-100)
  beneficiary: string
  projectId: string
  preferAddToBalance: boolean
  lockedUntil: number
  hook: string
  isLocked: boolean // computed from lockedUntil
  isNew: boolean // true if added in this session
}

// Convert JBSplitData percent (0-1_000_000_000) to display percent (0-100)
function toDisplayPercent(basisPoints: number): string {
  return ((basisPoints / 1_000_000_000) * 100).toFixed(2).replace(/\.?0+$/, '')
}

// Convert JBSplitData to EditableSplit
function toEditableSplit(split: JBSplitData, index: number): EditableSplit {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: `existing-${index}`,
    percent: toDisplayPercent(split.percent),
    beneficiary: split.beneficiary,
    projectId: split.projectId > 0 ? String(split.projectId) : '',
    preferAddToBalance: split.preferAddToBalance,
    lockedUntil: split.lockedUntil,
    hook: split.hook,
    isLocked: split.lockedUntil > now,
    isNew: false,
  }
}

// Create empty split for adding
function createEmptySplit(): EditableSplit {
  return {
    id: `new-${Date.now()}-${Math.random()}`,
    percent: '',
    beneficiary: '',
    projectId: '',
    preferAddToBalance: false,
    lockedUntil: 0,
    hook: ZERO_ADDRESS,
    isLocked: false,
    isNew: true,
  }
}

// Calculate total percent for splits
function getTotalPercent(splits: EditableSplit[]): number {
  return splits.reduce((sum, s) => sum + (parseFloat(s.percent) || 0), 0)
}

export default function SetSplitsForm({ projectId, chainId = '1', messageId }: SetSplitsFormProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { isConnected } = useAccount()

  // Persistent state
  const { state: persistedState, updateState: updatePersistedState } = useSetSplitsFormState(messageId)
  const isLocked = persistedState?.status && persistedState.status !== 'pending'

  // Project state
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Chain state
  const [chainSplitsData, setChainSplitsData] = useState<ChainSplitsData[]>([])
  const primaryChainId = parseInt(chainId)

  // Editing state
  const [activeTab, setActiveTab] = useState<'payout' | 'reserved'>('payout')
  const [payoutSplits, setPayoutSplits] = useState<EditableSplit[]>([])
  const [reservedSplits, setReservedSplits] = useState<EditableSplit[]>([])
  const [showModal, setShowModal] = useState(false)

  // ENS resolution
  const [ensNames, setEnsNames] = useState<Record<string, string>>({})

  // Derived state
  const selectedChains = chainSplitsData.filter(cd => cd.selected)
  const isOmnichain = chainSplitsData.length > 1
  const primaryData = chainSplitsData.find(cd => cd.chainId === primaryChainId) || chainSplitsData[0]
  const baseCurrency = primaryData?.baseCurrency || 1
  const currencyLabel = baseCurrency === 2 ? 'USDC' : 'ETH'

  // Calculate changes
  const payoutTotal = getTotalPercent(payoutSplits)
  const reservedTotal = getTotalPercent(reservedSplits)
  const payoutValid = payoutTotal <= 100
  const reservedValid = reservedTotal <= 100

  const hasChanges = payoutSplits.some(s => s.isNew) ||
    reservedSplits.some(s => s.isNew) ||
    payoutSplits.length !== (primaryData?.payoutSplits.length || 0) ||
    reservedSplits.length !== (primaryData?.reservedSplits.length || 0)

  // Dispatch event to open wallet panel
  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  // Load project and splits data
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [projectData, connectedChains] = await Promise.all([
          fetchProject(projectId, primaryChainId),
          fetchConnectedChains(projectId, primaryChainId),
        ])
        setProject(projectData)

        // Determine chains to fetch
        const chainsToFetch: ConnectedChain[] = connectedChains.length > 0
          ? connectedChains
          : [{ chainId: primaryChainId, projectId: parseInt(projectId) }]

        // Fetch splits from all chains
        const splitsPromises = chainsToFetch.map(async (chain): Promise<ChainSplitsData> => {
          try {
            const chainProject = await fetchProjectWithRuleset(String(chain.projectId), chain.chainId)
            const rulesetId = chainProject?.currentRuleset?.id || '0'

            let payoutSplits: JBSplitData[] = []
            let reservedSplits: JBSplitData[] = []

            if (rulesetId !== '0') {
              const splitsData = await fetchProjectSplits(
                String(chain.projectId),
                chain.chainId,
                rulesetId
              )
              payoutSplits = splitsData.payoutSplits
              reservedSplits = splitsData.reservedSplits
            }

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              rulesetId,
              payoutSplits,
              reservedSplits,
              baseCurrency: chainProject?.currentRuleset?.baseCurrency || 1,
              selected: true,
            }
          } catch (err) {
            console.error(`Failed to fetch splits for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              rulesetId: '0',
              payoutSplits: [],
              reservedSplits: [],
              baseCurrency: 1,
              selected: true,
            }
          }
        })

        const allSplitsData = await Promise.all(splitsPromises)
        setChainSplitsData(allSplitsData)

        // Initialize editable splits from primary chain
        const primary = allSplitsData.find(cd => cd.chainId === primaryChainId) || allSplitsData[0]
        if (primary) {
          setPayoutSplits(primary.payoutSplits.map(toEditableSplit))
          setReservedSplits(primary.reservedSplits.map(toEditableSplit))

          // Resolve ENS names for all beneficiaries
          const allBeneficiaries = [
            ...primary.payoutSplits.map(s => s.beneficiary),
            ...primary.reservedSplits.map(s => s.beneficiary),
          ]
          const uniqueBeneficiaries = [...new Set(allBeneficiaries)].filter(
            addr => addr && addr !== ZERO_ADDRESS
          )

          const ensResolutions: Record<string, string> = {}
          await Promise.all(
            uniqueBeneficiaries.map(async (addr) => {
              const name = await resolveEnsName(addr)
              if (name) ensResolutions[addr.toLowerCase()] = name
            })
          )
          setEnsNames(ensResolutions)
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
    if (isLocked) return
    setChainSplitsData(prev =>
      prev.map(cd =>
        cd.chainId === chainId ? { ...cd, selected: !cd.selected } : cd
      )
    )
  }, [isLocked])

  // Add a new split
  const handleAddSplit = useCallback((type: 'payout' | 'reserved') => {
    if (isLocked) return
    const newSplit = createEmptySplit()
    if (type === 'payout') {
      setPayoutSplits(prev => [...prev, newSplit])
    } else {
      setReservedSplits(prev => [...prev, newSplit])
    }
  }, [isLocked])

  // Remove a split
  const handleRemoveSplit = useCallback((type: 'payout' | 'reserved', id: string) => {
    if (isLocked) return
    if (type === 'payout') {
      setPayoutSplits(prev => prev.filter(s => s.id !== id && !s.isLocked))
    } else {
      setReservedSplits(prev => prev.filter(s => s.id !== id && !s.isLocked))
    }
  }, [isLocked])

  // Update a split field
  const handleUpdateSplit = useCallback((
    type: 'payout' | 'reserved',
    id: string,
    field: keyof EditableSplit,
    value: string | boolean
  ) => {
    if (isLocked) return
    const updateFn = (prev: EditableSplit[]) =>
      prev.map(s => s.id === id && !s.isLocked ? { ...s, [field]: value } : s)

    if (type === 'payout') {
      setPayoutSplits(updateFn)
    } else {
      setReservedSplits(updateFn)
    }
  }, [isLocked])

  // Callbacks for transaction completion
  const handleConfirmed = useCallback((txHashes: Record<number, string>, bundleId?: string) => {
    updatePersistedState({
      status: 'completed',
      txHashes,
      bundleId,
      confirmedAt: new Date().toISOString(),
    })
  }, [updatePersistedState])

  const handleError = useCallback((errorMsg: string) => {
    updatePersistedState({
      status: 'failed',
      error: errorMsg,
    })
  }, [updatePersistedState])

  // Submit handler
  const handleSubmit = useCallback(() => {
    if (isLocked || selectedChains.length === 0) return
    if (!payoutValid || !reservedValid) return

    if (!isConnected) {
      openWalletPanel()
      return
    }

    // Persist in_progress state
    updatePersistedState({
      status: 'in_progress',
      splitType: 'both',
      payoutSplitsCount: payoutSplits.length,
      reservedSplitsCount: reservedSplits.length,
      selectedChains: selectedChains.map(c => c.chainId),
      submittedAt: new Date().toISOString(),
    })

    setShowModal(true)
  }, [isLocked, selectedChains, payoutValid, reservedValid, isConnected, payoutSplits.length, reservedSplits.length, updatePersistedState])

  // Render split row
  const renderSplitRow = (split: EditableSplit, type: 'payout' | 'reserved') => {
    const ensName = ensNames[split.beneficiary.toLowerCase()]
    const isValidAddress = split.beneficiary && isAddress(split.beneficiary)

    return (
      <div
        key={split.id}
        className={`p-3 border transition-opacity ${
          split.isLocked ? 'opacity-60' : ''
        } ${isDark ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}
      >
        <div className="flex items-start gap-3">
          {/* Percent */}
          <div className="w-20">
            <label className={`text-[10px] block mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Percent
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={split.percent}
                onChange={(e) => handleUpdateSplit(type, split.id, 'percent', e.target.value)}
                disabled={split.isLocked || isLocked}
                className={`w-full px-2 py-1.5 text-sm outline-none ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white'
                    : 'bg-white border border-gray-200 text-gray-900'
                } ${split.isLocked || isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
              <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                %
              </span>
            </div>
          </div>

          {/* Beneficiary */}
          <div className="flex-1">
            <label className={`text-[10px] block mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {split.projectId ? 'Project ID' : 'Address'}
            </label>
            <input
              type="text"
              value={split.projectId || split.beneficiary}
              onChange={(e) => {
                const val = e.target.value
                if (/^\d+$/.test(val)) {
                  handleUpdateSplit(type, split.id, 'projectId', val)
                  handleUpdateSplit(type, split.id, 'beneficiary', '')
                } else {
                  handleUpdateSplit(type, split.id, 'beneficiary', val)
                  handleUpdateSplit(type, split.id, 'projectId', '')
                }
              }}
              disabled={split.isLocked || isLocked}
              placeholder="0x... or project ID"
              className={`w-full px-2 py-1.5 text-sm font-mono outline-none ${
                isDark
                  ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-600'
                  : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
              } ${split.isLocked || isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
            {ensName && (
              <div className={`text-[10px] mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {ensName}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-end gap-2 pb-1">
            {split.isLocked ? (
              <span className={`text-[10px] px-2 py-1 ${isDark ? 'text-amber-400 bg-amber-500/10' : 'text-amber-600 bg-amber-50'}`}>
                Locked until {new Date(split.lockedUntil * 1000).toLocaleDateString()}
              </span>
            ) : !isLocked && (
              <button
                onClick={() => handleRemoveSplit(type, split.id)}
                className={`px-2 py-1 text-xs ${isDark ? 'text-red-400 hover:text-red-300' : 'text-red-600 hover:text-red-700'}`}
              >
                Remove
              </button>
            )}
          </div>
        </div>

        {/* Advanced options toggle (for new splits) */}
        {split.isNew && !isLocked && (
          <div className="mt-2 pt-2 border-t border-dashed border-white/10">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={split.preferAddToBalance}
                onChange={(e) => handleUpdateSplit(type, split.id, 'preferAddToBalance', e.target.checked)}
                className="w-3 h-3"
              />
              <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {type === 'payout' ? 'Add to project balance instead of sending' : 'Prefer add to balance'}
              </span>
            </label>
          </div>
        )}
      </div>
    )
  }

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
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={`max-w-2xl border p-6 text-center ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>{error}</p>
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
              <div className="w-14 h-14 bg-green-500/20 flex items-center justify-center">
                <span className="text-2xl">📊</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Configure Splits
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
              Apply to chains:
            </div>
            <div className="flex flex-wrap gap-2">
              {chainSplitsData.map(cd => {
                const chain = CHAIN_INFO[cd.chainId]
                return (
                  <button
                    key={cd.chainId}
                    onClick={() => toggleChainSelection(cd.chainId)}
                    disabled={isLocked}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                      isLocked
                        ? 'opacity-50 cursor-not-allowed'
                        : cd.selected
                          ? isDark
                            ? 'bg-green-500/30 text-green-300 border border-green-500/50'
                            : 'bg-green-100 text-green-700 border border-green-300'
                          : isDark
                            ? 'bg-white/5 text-gray-400 border border-white/10'
                            : 'bg-gray-100 text-gray-500 border border-gray-200'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: chain?.color || '#888' }}
                    />
                    {chain?.shortName || cd.chainId}
                    {cd.selected && <span>✓</span>}
                  </button>
                )
              })}
            </div>
            {selectedChains.length > 1 && (
              <div className={`mt-2 text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                Changes will be applied to all selected chains
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className={`flex border-b ${isDark ? 'border-gray-600/50' : 'border-gray-200'}`}>
          <button
            onClick={() => setActiveTab('payout')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'payout'
                ? isDark
                  ? 'text-green-400 border-b-2 border-green-400'
                  : 'text-green-600 border-b-2 border-green-600'
                : isDark
                  ? 'text-gray-400 hover:text-white'
                  : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Payout Splits ({payoutSplits.length})
          </button>
          <button
            onClick={() => setActiveTab('reserved')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'reserved'
                ? isDark
                  ? 'text-amber-400 border-b-2 border-amber-400'
                  : 'text-amber-600 border-b-2 border-amber-600'
                : isDark
                  ? 'text-gray-400 hover:text-white'
                  : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Reserved Splits ({reservedSplits.length})
          </button>
        </div>

        {/* Split List */}
        <div className="p-4">
          {activeTab === 'payout' ? (
            <>
              <div className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Payout splits determine how funds are distributed when payouts are sent.
                Total: <span className={payoutValid ? 'text-green-400' : 'text-red-400'}>{payoutTotal.toFixed(2)}%</span>
                {payoutTotal < 100 && ` (${(100 - payoutTotal).toFixed(2)}% to project owner)`}
              </div>

              <div className="space-y-2 mb-4">
                {payoutSplits.map(split => renderSplitRow(split, 'payout'))}
                {payoutSplits.length === 0 && (
                  <div className={`p-4 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    No payout splits configured. All payouts go to project owner.
                  </div>
                )}
              </div>

              {!isLocked && (
                <button
                  onClick={() => handleAddSplit('payout')}
                  className={`w-full py-2 text-sm font-medium border-2 border-dashed transition-colors ${
                    isDark
                      ? 'border-white/20 text-gray-400 hover:border-green-500/50 hover:text-green-400'
                      : 'border-gray-300 text-gray-500 hover:border-green-500 hover:text-green-600'
                  }`}
                >
                  + Add Payout Split
                </button>
              )}
            </>
          ) : (
            <>
              <div className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Reserved splits determine how reserved tokens are distributed.
                Total: <span className={reservedValid ? 'text-amber-400' : 'text-red-400'}>{reservedTotal.toFixed(2)}%</span>
                {reservedTotal < 100 && ` (${(100 - reservedTotal).toFixed(2)}% to project owner)`}
              </div>

              <div className="space-y-2 mb-4">
                {reservedSplits.map(split => renderSplitRow(split, 'reserved'))}
                {reservedSplits.length === 0 && (
                  <div className={`p-4 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    No reserved splits configured. All reserved tokens go to project owner.
                  </div>
                )}
              </div>

              {!isLocked && (
                <button
                  onClick={() => handleAddSplit('reserved')}
                  className={`w-full py-2 text-sm font-medium border-2 border-dashed transition-colors ${
                    isDark
                      ? 'border-white/20 text-gray-400 hover:border-amber-500/50 hover:text-amber-400'
                      : 'border-gray-300 text-gray-500 hover:border-amber-500 hover:text-amber-600'
                  }`}
                >
                  + Add Reserved Split
                </button>
              )}
            </>
          )}
        </div>

        {/* Submit Section */}
        <div className={`p-4 border-t ${isDark ? 'border-gray-600/50' : 'border-gray-200'}`}>
          {/* Transaction Status Indicator */}
          {isLocked && (
            <div className={`mb-3 p-3 text-sm ${
              persistedState?.status === 'completed'
                ? isDark ? 'bg-green-500/10' : 'bg-green-50'
                : persistedState?.status === 'failed'
                  ? isDark ? 'bg-red-500/10' : 'bg-red-50'
                  : isDark ? 'bg-green-500/10' : 'bg-green-50'
            }`}>
              <div className={`flex items-center gap-2 ${
                persistedState?.status === 'completed'
                  ? isDark ? 'text-green-400' : 'text-green-600'
                  : persistedState?.status === 'failed'
                    ? isDark ? 'text-red-400' : 'text-red-600'
                    : isDark ? 'text-green-400' : 'text-green-600'
              }`}>
                {persistedState?.status === 'completed' ? (
                  <>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Splits updated successfully!</span>
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
              {persistedState?.txHashes && Object.keys(persistedState.txHashes).length > 0 && (
                <div className="mt-2 space-y-1">
                  {Object.entries(persistedState.txHashes).map(([cid, hash]) => {
                    const chain = CHAIN_INFO[parseInt(cid)]
                    return (
                      <a
                        key={cid}
                        href={`https://${chain?.slug === 'eth' ? '' : chain?.slug + '.'}etherscan.io/tx/${hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-xs ml-6 underline block ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
                      >
                        {chain?.name || `Chain ${cid}`}: View on explorer
                      </a>
                    )
                  })}
                </div>
              )}
              {persistedState?.error && (
                <p className={`text-xs mt-1 ml-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {persistedState.error}
                </p>
              )}
            </div>
          )}

          {/* Validation warnings */}
          {(!payoutValid || !reservedValid) && (
            <div className={`mb-3 p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
              {!payoutValid && <div>Payout splits exceed 100%</div>}
              {!reservedValid && <div>Reserved splits exceed 100%</div>}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isLocked || selectedChains.length === 0 || !payoutValid || !reservedValid}
            className={`w-full py-3 text-sm font-bold transition-colors ${
              isLocked || selectedChains.length === 0 || !payoutValid || !reservedValid
                ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-500/90 text-black'
            }`}
          >
            {persistedState?.status === 'completed'
              ? 'Updated'
              : persistedState?.status === 'in_progress'
                ? 'Pending...'
                : `Update Splits${selectedChains.length > 1 ? ` on ${selectedChains.length} Chains` : ''}`}
          </button>

          <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {isOmnichain
              ? 'Splits will be updated on all selected chains. Locked splits cannot be modified.'
              : 'Update how payouts and reserved tokens are distributed. Locked splits cannot be modified.'}
          </p>
        </div>
      </div>

      {/* Modal */}
      {showModal && primaryData && (
        <SetSplitsModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          projectName={project?.name}
          chainSplitsData={selectedChains}
          payoutSplits={payoutSplits}
          reservedSplits={reservedSplits}
          baseCurrency={baseCurrency}
          onConfirmed={handleConfirmed}
          onError={handleError}
        />
      )}
    </div>
  )
}
