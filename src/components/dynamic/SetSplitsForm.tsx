import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useSetSplitsFormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchProjectWithRuleset,
  fetchProjectSplits,
  type Project,
  type JBSplitData,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { resolveEnsName } from '../../utils/ens'
import { SetSplitsModal } from '../payment'
import { ProjectLink } from './ProjectLink'
import { ZERO_ADDRESS } from '../../constants'
import { useManagedWallet } from '../../hooks'
import { buildSplit } from '../../utils/splitSafety'
import { resolveProjectChains } from '../../utils/projectChains'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'

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
  payoutGroupId: string | null
  payoutToken: string | null
  configurationComplete: boolean
  error?: string
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
  routeMode: 'wallet' | 'project'
  isLocked: boolean // computed from lockedUntil
  isNew: boolean // true if added in this session
}

// Convert JBSplitData percent (0-1_000_000_000) to display percent (0-100)
function toDisplayPercent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 10_000_000)
  const fraction = String(basisPoints % 10_000_000).padStart(7, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
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
    routeMode: split.projectId > 0 ? 'project' : 'wallet',
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
    routeMode: 'wallet',
    isLocked: false,
    isNew: true,
  }
}

// Calculate total percent for splits
function getTotalPercent(splits: EditableSplit[]): number {
  return splits.reduce((sum, s) => sum + (parseFloat(s.percent) || 0), 0)
}

function splitFingerprint(split: JBSplitData): string {
  return [
    split.percent,
    split.projectId,
    split.beneficiary.toLowerCase(),
    split.preferAddToBalance,
    split.lockedUntil,
    split.hook.toLowerCase(),
  ].join(':')
}

function splitSetsMatch(left: JBSplitData[], right: JBSplitData[]): boolean {
  return left.length === right.length && left.every((split, index) =>
    splitFingerprint(split) === splitFingerprint(right[index])
  )
}

export default function SetSplitsForm({ projectId, chainId = '1', messageId }: SetSplitsFormProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { isConnected } = useAccount()
  const { address: managedAddress, isManagedMode } = useManagedWallet()
  const hasActiveWallet = isManagedMode ? !!managedAddress : isConnected

  // Persistent state
  const { state: persistedState, updateState: updatePersistedState } = useSetSplitsFormState(messageId)
  const isLocked = persistedState?.status && persistedState.status !== 'pending'

  // Project state
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Chain state
  const [chainSplitsData, setChainSplitsData] = useState<ChainSplitsData[]>([])
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const primaryChainId = parseInt(chainId)

  // Editing state
  const [activeTab, setActiveTab] = useState<'payout' | 'reserved'>('payout')
  const [payoutSplits, setPayoutSplits] = useState<EditableSplit[]>([])
  const [reservedSplits, setReservedSplits] = useState<EditableSplit[]>([])
  const [showModal, setShowModal] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ENS resolution
  const [ensNames, setEnsNames] = useState<Record<string, string>>({})
  const [destinationProjects, setDestinationProjects] = useState<Record<string, Project>>({})

  // Derived state
  const selectedChains = chainSplitsData.filter(cd => cd.selected)
  const isOmnichain = chainSplitsData.length > 1
  const primaryData = chainSplitsData.find(cd => cd.chainId === primaryChainId) || chainSplitsData[0]
  const baseCurrency = primaryData?.baseCurrency || 1

  // Calculate changes
  const payoutTotal = getTotalPercent(payoutSplits)
  const reservedTotal = getTotalPercent(reservedSplits)
  const splitIsValid = (split: EditableSplit, kind: 'payout' | 'reserved') => {
    if ((split.routeMode === 'project') !== Boolean(split.projectId)) return false
    try {
      buildSplit(split, 'Split', {
        kind,
        sourceProjectId: primaryData?.projectId ?? projectId,
      })
      return true
    } catch {
      return false
    }
  }
  const payoutValid = payoutTotal <= 100 && payoutSplits.every(split => splitIsValid(split, 'payout'))
  const reservedValid = reservedTotal <= 100 && reservedSplits.every(split => splitIsValid(split, 'reserved'))

  const editableFingerprint = (split: EditableSplit, kind: 'payout' | 'reserved') => {
    try {
      const built = buildSplit(split, 'Split', {
        kind,
        sourceProjectId: primaryData?.projectId ?? projectId,
      })
      return [
        built.percent,
        built.projectId,
        built.beneficiary.toLowerCase(),
        built.preferAddToBalance,
        built.lockedUntil,
        built.hook.toLowerCase(),
      ].join(':')
    } catch {
      return 'invalid'
    }
  }
  const hasChanges = !!primaryData && (
    payoutSplits.map(split => editableFingerprint(split, 'payout')).join('|') !== primaryData.payoutSplits.map(splitFingerprint).join('|') ||
    reservedSplits.map(split => editableFingerprint(split, 'reserved')).join('|') !== primaryData.reservedSplits.map(splitFingerprint).join('|')
  )
  const clearsEffectiveSplits = !!primaryData && (
    (primaryData.payoutSplits.length > 0 && payoutSplits.length === 0) ||
    (primaryData.reservedSplits.length > 0 && reservedSplits.length === 0)
  )
  const chainIsCompatible = useCallback((chainData: ChainSplitsData) => !primaryData || (
    chainData.configurationComplete &&
    splitSetsMatch(chainData.payoutSplits, primaryData.payoutSplits) &&
    splitSetsMatch(chainData.reservedSplits, primaryData.reservedSplits)
  ), [primaryData])

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
        const [projectData, chainResolution] = await Promise.all([
          fetchProject(projectId, primaryChainId),
          resolveProjectChains(projectId, primaryChainId),
        ])
        setProject(projectData)
        setChainMappingAvailable(chainResolution.mappingAvailable)

        // Fetch splits from all chains
        const splitsPromises = chainResolution.chains.map(async (chain): Promise<ChainSplitsData> => {
          try {
            const chainProject = await fetchProjectWithRuleset(String(chain.projectId), chain.chainId)
            const rulesetId = chainProject?.currentRuleset?.id || '0'

            let payoutSplits: JBSplitData[] = []
            let reservedSplits: JBSplitData[] = []
            let payoutGroupId: string | null = null
            let payoutToken: string | null = null
            let configurationComplete = false
            let configurationError: string | undefined

            if (rulesetId !== '0') {
              const splitsData = await fetchProjectSplits(
                String(chain.projectId),
                chain.chainId,
                rulesetId
              )
              payoutSplits = splitsData.payoutSplits
              reservedSplits = splitsData.reservedSplits
              const contexts = splitsData.accountingContexts || []
              if (contexts.length === 1) {
                payoutToken = contexts[0].token
                payoutGroupId = BigInt(contexts[0].token).toString()
                payoutSplits = splitsData.splitGroups?.find(
                  group => group.groupId === payoutGroupId,
                )?.splits ?? []
              }
              configurationComplete = splitsData.configurationComplete === true && !!payoutGroupId
              if (contexts.length !== 1) {
                configurationError = 'Split editing requires one unambiguous live payout token'
              } else if (!payoutGroupId) {
                configurationError = 'The payout token could not be determined unambiguously'
              }
            }

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              rulesetId,
              payoutSplits,
              reservedSplits,
              baseCurrency: chainProject?.currentRuleset?.baseCurrency ?? 1,
              payoutGroupId,
              payoutToken,
              configurationComplete: rulesetId !== '0' && configurationComplete,
              error: rulesetId === '0'
                ? 'Current ruleset unavailable'
                : configurationError,
              selected: chain.chainId === primaryChainId &&
                chain.projectId === parseInt(projectId) &&
                rulesetId !== '0' && configurationComplete,
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
              payoutGroupId: null,
              payoutToken: null,
              configurationComplete: false,
              error: err instanceof Error ? err.message : 'Could not verify the current split configuration',
              selected: false,
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

  useEffect(() => {
    const ids = [...payoutSplits, ...reservedSplits]
      .filter(split => split.routeMode === 'project' && /^\d+$/.test(split.projectId))
      .map(split => split.projectId)
    const missing = [...new Set(ids)].filter(id => !destinationProjects[id])
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(missing.map(async id => [id, await fetchProject(id, primaryChainId)] as const))
      .then(entries => {
        if (!cancelled) setDestinationProjects(current => ({ ...current, ...Object.fromEntries(entries) }))
      })
      .catch(() => {
        // The route remains editable by verified project ID when display metadata is unavailable.
      })
    return () => { cancelled = true }
  }, [payoutSplits, reservedSplits, destinationProjects, primaryChainId])

  // Toggle chain selection
  const toggleChainSelection = useCallback((chainId: number) => {
    if (isLocked) return
    setChainSplitsData(prev =>
      prev.map(cd =>
        cd.chainId === chainId
          ? { ...cd, selected: cd.configurationComplete && chainIsCompatible(cd) ? !cd.selected : false }
          : cd
      )
    )
  }, [isLocked, chainIsCompatible])

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
      setPayoutSplits(prev => prev.filter(s => s.id !== id))
    } else {
      setReservedSplits(prev => prev.filter(s => s.id !== id))
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
  const handleSubmit = useCallback(async () => {
    if (isLocked || selectedChains.length === 0) return
    if (!payoutValid || !reservedValid || clearsEffectiveSplits || !hasChanges) return

    if (!hasActiveWallet) {
      openWalletPanel()
      return
    }

    setSubmitError(null)
    try {
      const fresh = await Promise.all(selectedChains.map(cd =>
        fetchProjectSplits(String(cd.projectId), cd.chainId, cd.rulesetId)
      ))
      fresh.forEach((configuration, index) => {
        const reviewed = selectedChains[index]
        if (
          !splitSetsMatch(configuration.payoutSplits, reviewed.payoutSplits) ||
          !splitSetsMatch(configuration.reservedSplits, reviewed.reservedSplits)
        ) {
          throw new Error(`Splits changed on ${CHAIN_INFO[reviewed.chainId]?.name || `chain ${reviewed.chainId}`}. Reload before editing.`)
        }
      })
      setShowModal(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not verify the current split configuration')
    }
  }, [isLocked, selectedChains, payoutValid, reservedValid, clearsEffectiveSplits, hasChanges, hasActiveWallet])

  // Render split row
  const renderSplitRow = (split: EditableSplit, type: 'payout' | 'reserved') => {
    const ensName = ensNames[split.beneficiary.toLowerCase()]
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

          {/* Destination */}
          <div className="flex-1">
            <div className={`mb-2 inline-flex border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              {(['wallet', 'project'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    handleUpdateSplit(type, split.id, 'routeMode', mode)
                    if (mode === 'wallet') {
                      handleUpdateSplit(type, split.id, 'projectId', '')
                      handleUpdateSplit(type, split.id, 'preferAddToBalance', false)
                    }
                  }}
                  disabled={split.isLocked || isLocked || !primaryData?.configurationComplete}
                  className={`px-2 py-1 text-[10px] font-medium ${
                    split.routeMode === mode
                      ? isDark ? 'bg-white/15 text-white' : 'bg-gray-200 text-gray-900'
                      : isDark ? 'text-gray-400' : 'text-gray-500'
                  }`}
                >
                  {mode === 'wallet' ? 'Wallet' : 'Project'}
                </button>
              ))}
            </div>
            {split.routeMode === 'project' && (
              <>
                <label className={`text-[10px] block mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Destination project ID
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={split.projectId}
                  onChange={(e) => handleUpdateSplit(type, split.id, 'projectId', e.target.value)}
                  disabled={split.isLocked || isLocked || !primaryData?.configurationComplete}
                  placeholder="Project ID"
                  className={`w-full px-2 py-1.5 mb-2 text-sm font-mono outline-none ${
                    isDark
                      ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-600'
                      : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                  }`}
                />
              </>
            )}
            <label className={`text-[10px] block mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {split.routeMode === 'wallet'
                ? 'Wallet address'
                : type === 'reserved'
                  ? 'Fallback beneficiary'
                  : split.preferAddToBalance
                    ? 'Beneficiary (unused)'
                    : 'Destination-token beneficiary'}
            </label>
            <input
              type="text"
              value={split.beneficiary}
              onChange={(e) => handleUpdateSplit(type, split.id, 'beneficiary', e.target.value)}
              disabled={split.isLocked || isLocked || !primaryData?.configurationComplete}
              placeholder={split.routeMode === 'project' && type === 'payout' && split.preferAddToBalance ? 'Optional' : '0x...'}
              className={`w-full px-2 py-1.5 text-sm font-mono outline-none ${
                isDark
                  ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-600'
                  : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
              } ${split.isLocked || isLocked || !primaryData?.configurationComplete ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
            {ensName && (
              <div className={`text-[10px] mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {ensName}
              </div>
            )}
            {split.routeMode === 'project' && split.projectId && (
              <div className={`mt-1 text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                <ProjectLink chainSlug={chainInfo.slug} projectId={split.projectId} className="hover:underline">
                  {destinationProjects[split.projectId]?.name || `Project #${split.projectId}`}
                </ProjectLink>
              </div>
            )}
            {split.routeMode === 'project' && type === 'payout' && (
              <label className={`mt-2 flex items-center gap-2 text-[10px] ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                <input
                  type="checkbox"
                  checked={split.preferAddToBalance}
                  onChange={(e) => handleUpdateSplit(type, split.id, 'preferAddToBalance', e.target.checked)}
                  disabled={split.isLocked || isLocked}
                />
                Add to balance instead of paying the project
              </label>
            )}
            {split.routeMode === 'project' && (
              <div className={`mt-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                {type === 'reserved'
                  ? 'Reserved project recipient. Source tokens must be claimed ERC-20s, and the destination needs a primary terminal accepting that token; credits cannot use this route. Missing or reverting routes send source tokens to the fallback beneficiary.'
                  : split.preferAddToBalance
                    ? 'add to balance · no tokens minted'
                    : 'pay project · destination project tokens go to the beneficiary'}
              </div>
            )}
            {split.routeMode === 'project' &&
              split.beneficiary.toLowerCase() === ZERO_ADDRESS.toLowerCase() &&
              !split.isNew &&
              !split.preferAddToBalance && (
              <div className="mt-1 text-[10px] text-amber-500">
                No beneficiary is stored. The account triggering distribution receives destination tokens.
              </div>
            )}
            {split.hook.toLowerCase() !== ZERO_ADDRESS.toLowerCase() && (
              <div className={`mt-1 text-[10px] font-mono ${isDark ? 'text-cyan-300' : 'text-cyan-700'}`}>
                Recognized split hook · {split.hook.slice(0, 6)}...{split.hook.slice(-4)}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-end gap-2 pb-1">
            {split.isLocked ? (
              <span className={`text-[10px] px-2 py-1 ${isDark ? 'text-amber-400 bg-amber-500/10' : 'text-amber-600 bg-amber-50'}`}>
                Locked until {new Date(split.lockedUntil * 1000).toLocaleDateString()}
              </span>
            ) : !isLocked && primaryData?.configurationComplete && (
              <button
                onClick={() => handleRemoveSplit(type, split.id)}
                className={`px-2 py-1 text-xs ${isDark ? 'text-red-400 hover:text-red-300' : 'text-red-600 hover:text-red-700'}`}
              >
                Remove
              </button>
            )}
          </div>
        </div>

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
              <IpfsImage uri={project?.logoUri} alt={project?.name || 'Project'} className="w-14 h-14 object-cover" fallback={<div className="w-14 h-14 bg-green-500/20" />} />
            ) : (
              <div className="w-14 h-14 bg-green-500/20 flex items-center justify-center">
                <span className="text-2xl">📊</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Configure Splits
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
              Apply to chains:
            </div>
            <div className="flex flex-wrap gap-2">
              {chainSplitsData.map(cd => {
                const chain = CHAIN_INFO[cd.chainId]
                return (
                  <button
                    key={cd.chainId}
                    onClick={() => toggleChainSelection(cd.chainId)}
                    disabled={isLocked || !cd.configurationComplete || !chainIsCompatible(cd)}
                    title={cd.error || (!chainIsCompatible(cd) ? 'Split configuration differs from the selected source chain' : undefined)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                      isLocked || !cd.configurationComplete || !chainIsCompatible(cd)
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
                    {!cd.configurationComplete && <span>Unavailable</span>}
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

              {!isLocked && primaryData?.configurationComplete && (
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

              {!isLocked && primaryData?.configurationComplete && (
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
              {!payoutValid && <div>Every payout split needs a valid positive percent and destination, with a total no greater than 100%.</div>}
              {!reservedValid && <div>Every reserved split needs a valid positive percent and destination, with a total no greater than 100%.</div>}
            </div>
          )}

          {submitError && (
            <div className={`mb-3 p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
              {submitError}
            </div>
          )}

          {clearsEffectiveSplits && (
            <div className={`mb-3 p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
              Removing every effective split is blocked because default splits may remain active on-chain. Use the full configuration site to change default split groups explicitly.
            </div>
          )}

          {chainSplitsData.some(cd => !cd.configurationComplete) && (
            <div className={`mb-3 p-3 text-xs ${isDark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-700'}`}>
              {primaryData?.error || 'Unavailable chains could not be tied to one verified payout-token group and cannot be selected.'}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isLocked || selectedChains.length === 0 || !payoutValid || !reservedValid || clearsEffectiveSplits || !hasChanges}
            className={`w-full py-3 text-sm font-bold transition-colors ${
              isLocked || selectedChains.length === 0 || !payoutValid || !reservedValid || clearsEffectiveSplits || !hasChanges
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
