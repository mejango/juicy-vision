import { useState, useEffect, useCallback, useMemo } from 'react'
import { defaultChainId } from '../../config/environment'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useSetSplitsFormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchProjectWithRuleset,
  fetchProjectSplits,
  isRevnetProject,
  type Project,
  type JBSplitData,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { resolveEnsName } from '../../utils/ens'
import { SetSplitsModal } from '../payment'
import { ProjectLink } from './ProjectLink'
import { ZERO_ADDRESS, MAINNET_CHAINS } from '../../constants'
import { useManagedWallet } from '../../hooks'
import { buildSplit } from '../../utils/splitSafety'
import { JBP6_FEE_LP_SPLIT_HOOK } from './create-flow/builders'
import { resolveProjectChains } from '../../utils/projectChains'
import ChainLogo from '../ui/ChainLogo'
import { fetchStageRulesetsPerChain } from '../../services/reservedSplits'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'

interface SetSplitsFormProps {
  projectId: string
  chainId?: string
  messageId?: string // For persisting state to server (visible to all chat users)
  /**
   * Start-order index of the stage being edited. Splits live per (project, ruleset, group)
   * and the same stage is a different ruleset id on every chain, so the browsed stage is
   * resolved to each chain's own ruleset. Omitted = the current ruleset on each chain.
   */
  stageIndex?: number
}

// Chain info for display
const CHAIN_INFO = MAINNET_CHAINS

// Per-chain splits data
interface ChainSplitsData {
  chainId: number
  projectId: number
  rulesetId: string
  payoutSplits: JBSplitData[]
  reservedSplits: JBSplitData[]
  baseCurrency: number
  rulesetDuration: number // 0 = flexible ruleset; >0 = fixed-duration (locks are meaningful)
  owner: string // project owner — the fund-market hook's pass-through beneficiary fallback
  payoutGroupId: string | null
  payoutToken: string | null
  configurationComplete: boolean
  // JBSplits.splitsOf falls back to the FALLBACK_RULESET_ID (0) group whenever the active
  // ruleset's group is empty, so clearing a group only takes effect if the fallback is empty too.
  fallbackPayoutNonEmpty: boolean
  fallbackReservedNonEmpty: boolean
  error?: string
  selected: boolean
}

// Recipient type mirrors the create flow: a wallet Address, a Project route, or a split Hook.
type RecipientType = 'address' | 'project' | 'hook'
// A Hook split is either the shared "Fund market" LP hook (reserved groups only) or a custom hook.
type HookMode = 'fundmarket' | 'custom'

// Editable split for the form
interface EditableSplit {
  id: string // unique key for React
  percent: string // user input as string (0-100)
  recipientType: RecipientType
  beneficiary: string // Address recipient, Project token beneficiary, or Hook "and beneficiary"
  projectId: string // Project route id, or a custom Hook's "with project" id
  preferAddToBalance: boolean
  lockedUntil: number
  hook: string // stored/derived hook address (encode value)
  hookMode: HookMode
  hookAddress: string // custom-hook contract input (kept separate so Fund market ↔ Custom survives a switch)
  isLocked: boolean // computed from lockedUntil — an actively locked row is frozen
  isNew: boolean // true if added in this session
}

const isLpHookAddr = (hook: string): boolean =>
  !!hook && hook.toLowerCase() === JBP6_FEE_LP_SPLIT_HOOK.toLowerCase()

// Convert JBSplitData percent (0-1_000_000_000) to display percent (0-100)
function toDisplayPercent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 10_000_000)
  const fraction = String(basisPoints % 10_000_000).padStart(7, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

// Convert JBSplitData to EditableSplit. The recipient type is derived from the stored fields: a non-zero
// hook is a Hook split (Fund market only when it's the CURRENT LP hook — any other hook, including a
// superseded LP-hook address, stays "Custom" so the exact stored address round-trips byte-identical).
function toEditableSplit(split: JBSplitData, index: number): EditableSplit {
  const now = Math.floor(Date.now() / 1000)
  const hasHook = !!split.hook && split.hook.toLowerCase() !== ZERO_ADDRESS.toLowerCase()
  const isFundMarket = hasHook && isLpHookAddr(split.hook)
  const recipientType: RecipientType = hasHook ? 'hook' : split.projectId > 0 ? 'project' : 'address'
  return {
    id: `existing-${index}`,
    percent: toDisplayPercent(split.percent),
    recipientType,
    beneficiary: split.beneficiary,
    projectId: split.projectId > 0 ? String(split.projectId) : '',
    preferAddToBalance: split.preferAddToBalance,
    lockedUntil: split.lockedUntil,
    hook: split.hook,
    hookMode: isFundMarket ? 'fundmarket' : 'custom',
    hookAddress: hasHook && !isFundMarket ? split.hook : '',
    isLocked: split.lockedUntil > now,
    isNew: false,
  }
}

// Create empty split for adding
function createEmptySplit(allowFundMarket: boolean): EditableSplit {
  return {
    id: `new-${Date.now()}-${Math.random()}`,
    percent: '',
    recipientType: 'address',
    beneficiary: '',
    projectId: '',
    preferAddToBalance: false,
    lockedUntil: 0,
    hook: ZERO_ADDRESS,
    hookMode: allowFundMarket ? 'fundmarket' : 'custom',
    hookAddress: '',
    isLocked: false,
    isNew: true,
  }
}

// Collapse a rich editable row into the flat encode shape buildSplit/relayr consume. Each recipient type
// projects onto the contract's (projectId, beneficiary, preferAddToBalance, hook) tuple:
//   Address — plain wallet: hook 0, no project.
//   Project — pay (mints its tokens, beneficiary receives them) or add-to-balance (mints none, no beneficiary).
//   Hook    — Fund market routes to the shared LP hook with an owner/account pass-through beneficiary;
//             Custom uses the entered hook, an optional "with project", and an optional "and beneficiary".
function toSubmittableSplit(
  split: EditableSplit,
  kind: 'payout' | 'reserved',
  ownerFallback: string,
): EditableSplit {
  if (split.recipientType === 'hook') {
    if (split.hookMode === 'fundmarket') {
      return {
        ...split,
        hook: JBP6_FEE_LP_SPLIT_HOOK,
        projectId: '',
        beneficiary: (split.beneficiary || '').trim() || ownerFallback,
        preferAddToBalance: false,
      }
    }
    return { ...split, hook: (split.hookAddress || '').trim(), preferAddToBalance: false }
  }
  if (split.recipientType === 'project') {
    const addToBalance = kind === 'payout' && split.preferAddToBalance
    return {
      ...split,
      hook: ZERO_ADDRESS,
      projectId: split.projectId,
      beneficiary: addToBalance ? '' : split.beneficiary,
      preferAddToBalance: addToBalance,
    }
  }
  // address
  return { ...split, hook: ZERO_ADDRESS, projectId: '', preferAddToBalance: false }
}

// Calculate total percent for splits
function getTotalPercent(splits: EditableSplit[]): number {
  return splits.reduce((sum, s) => sum + (parseFloat(s.percent) || 0), 0)
}

function splitFingerprint(split: Omit<JBSplitData, 'projectId'> & { projectId: number | bigint }): string {
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

export default function SetSplitsForm({ projectId, chainId = defaultChainId(), messageId, stageIndex }: SetSplitsFormProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { isConnected, address: connectedAddress } = useAccount()
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

  // The fund-market hook's pass-through beneficiary: the acting wallet, else the project owner.
  const ownerFallback = (isManagedMode ? managedAddress : connectedAddress) || primaryData?.owner || ''
  // Fixed-duration rulesets are the only ones where a split lock has meaning (a flexible ruleset's owner
  // could re-queue splits at will), matching the create flow's lockAllowed gate.
  const lockAllowed = (primaryData?.rulesetDuration ?? 0) > 0

  // Flat, encode-ready splits handed to the review modal + relayr path (which read .hook/.beneficiary/etc.
  // directly). Normalizing here keeps SetSplitsModal and useOmnichainSetSplits recipient-type-agnostic.
  const submittablePayoutSplits = useMemo(
    () => payoutSplits.map(s => toSubmittableSplit(s, 'payout', ownerFallback)),
    [payoutSplits, ownerFallback],
  )
  const submittableReservedSplits = useMemo(
    () => reservedSplits.map(s => toSubmittableSplit(s, 'reserved', ownerFallback)),
    [reservedSplits, ownerFallback],
  )

  // Calculate changes
  const payoutTotal = getTotalPercent(payoutSplits)
  const reservedTotal = getTotalPercent(reservedSplits)
  const sourceProjectId = primaryData?.projectId ?? projectId
  const builtSplits = useMemo(() => {
    const build = (split: EditableSplit, kind: 'payout' | 'reserved') => {
      try {
        return buildSplit(toSubmittableSplit(split, kind, ownerFallback), 'Split', { kind, sourceProjectId })
      } catch {
        return null
      }
    }
    return {
      payout: payoutSplits.map(split => build(split, 'payout')),
      reserved: reservedSplits.map(split => build(split, 'reserved')),
    }
  }, [payoutSplits, reservedSplits, sourceProjectId, ownerFallback])

  const payoutValid = payoutTotal <= 100 && builtSplits.payout.every(built => built !== null)
  const reservedValid = reservedTotal <= 100 && builtSplits.reserved.every(built => built !== null)

  const editableFingerprint = (built: (typeof builtSplits.payout)[number]) =>
    built ? splitFingerprint(built) : 'invalid'
  const hasChanges = !!primaryData && (
    builtSplits.payout.map(editableFingerprint).join('|') !== primaryData.payoutSplits.map(splitFingerprint).join('|') ||
    builtSplits.reserved.map(editableFingerprint).join('|') !== primaryData.reservedSplits.map(splitFingerprint).join('|')
  )
  // Emptying a group is a legitimate edit — JBSplits accepts an empty group and the whole share
  // then accrues to the project owner. It's only blocked when the fallback (ruleset 0) group is
  // non-empty, because splitsOf would then serve those default splits instead of nothing.
  const clearsToFallbackPayout = !!primaryData &&
    primaryData.payoutSplits.length > 0 && payoutSplits.length === 0 && primaryData.fallbackPayoutNonEmpty
  const clearsToFallbackReserved = !!primaryData &&
    primaryData.reservedSplits.length > 0 && reservedSplits.length === 0 && primaryData.fallbackReservedNonEmpty
  const clearsEffectiveSplits = clearsToFallbackPayout || clearsToFallbackReserved
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

        // An edit aimed at a browsed stage must write THAT stage's ruleset on each chain —
        // the same stage carries a different ruleset id per chain, and the current ruleset
        // is only the right target when no stage was browsed.
        const stageRulesets = stageIndex == null
          ? null
          : await fetchStageRulesetsPerChain(
              chainResolution.chains.map(chain => ({ chainId: chain.chainId, projectId: chain.projectId })),
              stageIndex,
            )

        // Fetch splits from all chains
        const splitsPromises = chainResolution.chains.map(async (chain): Promise<ChainSplitsData> => {
          try {
            const chainProject = await fetchProjectWithRuleset(String(chain.projectId), chain.chainId)
            const stageRuleset = stageRulesets?.find(row => row.chainId === chain.chainId)?.ruleset ?? null
            const rulesetId = stageRulesets
              ? (stageRuleset?.id ?? '0')
              : (chainProject?.currentRuleset?.id || '0')

            let payoutSplits: JBSplitData[] = []
            let reservedSplits: JBSplitData[] = []
            let payoutGroupId: string | null = null
            let payoutToken: string | null = null
            let configurationComplete = false
            let configurationError: string | undefined
            let fallbackPayoutNonEmpty = false
            let fallbackReservedNonEmpty = false

            if (rulesetId !== '0') {
              const [splitsData, fallbackSplitsData] = await Promise.all([
                fetchProjectSplits(String(chain.projectId), chain.chainId, rulesetId),
                // The fallback (ruleset 0) groups decide whether clearing a group is effective.
                fetchProjectSplits(String(chain.projectId), chain.chainId, '0'),
              ])
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
              fallbackReservedNonEmpty = fallbackSplitsData.reservedSplits.length > 0
              fallbackPayoutNonEmpty = payoutGroupId
                ? (fallbackSplitsData.splitGroups?.find(group => group.groupId === payoutGroupId)?.splits.length ?? 0) > 0
                : false
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
              // Locks are scoped to the ruleset being edited, so read the duration of THAT ruleset.
              rulesetDuration: stageRulesets
                ? (stageRuleset?.duration ?? 0)
                : (chainProject?.currentRuleset?.duration ?? 0),
              owner: chainProject?.owner ?? '',
              payoutGroupId,
              payoutToken,
              configurationComplete: rulesetId !== '0' && configurationComplete,
              fallbackPayoutNonEmpty,
              fallbackReservedNonEmpty,
              error: rulesetId === '0'
                ? (stageRulesets
                  ? `Stage ${(stageIndex ?? 0) + 1} has no ruleset on this chain`
                  : 'Current ruleset unavailable')
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
              rulesetDuration: 0,
              owner: '',
              payoutGroupId: null,
              payoutToken: null,
              configurationComplete: false,
              // Fail closed: an unverified chain can't prove clearing a group is effective.
              fallbackPayoutNonEmpty: true,
              fallbackReservedNonEmpty: true,
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
  }, [projectId, primaryChainId, stageIndex])

  useEffect(() => {
    const ids = [...payoutSplits, ...reservedSplits]
      .filter(split => split.recipientType === 'project' && /^\d+$/.test(split.projectId))
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

  // Add a new split. Only reserved-token groups may fund the market (the shared LP hook pools reserved
  // tokens), so a new reserved hook row defaults to Fund market; payout hook rows are Custom-only.
  const handleAddSplit = useCallback((type: 'payout' | 'reserved') => {
    if (isLocked) return
    const newSplit = createEmptySplit(type === 'reserved')
    if (type === 'payout') {
      setPayoutSplits(prev => [...prev, newSplit])
    } else {
      setReservedSplits(prev => [...prev, newSplit])
    }
  }, [isLocked])

  // Remove a split. An actively locked row is never removable — JBSplits._setSplitsOf requires
  // every currently-locked split to be resubmitted, so dropping one would revert the transaction.
  const handleRemoveSplit = useCallback((type: 'payout' | 'reserved', id: string) => {
    if (isLocked) return
    const removeFn = (prev: EditableSplit[]) => prev.filter(s => s.id !== id || s.isLocked)
    if (type === 'payout') setPayoutSplits(removeFn)
    else setReservedSplits(removeFn)
  }, [isLocked])

  // Merge a partial patch into one split (skips actively-locked rows, which must resubmit byte-identical).
  const handlePatchSplit = useCallback((
    type: 'payout' | 'reserved',
    id: string,
    patch: Partial<EditableSplit>,
  ) => {
    if (isLocked) return
    const updateFn = (prev: EditableSplit[]) =>
      prev.map(s => s.id === id && !s.isLocked ? { ...s, ...patch } : s)
    if (type === 'payout') setPayoutSplits(updateFn)
    else setReservedSplits(updateFn)
  }, [isLocked])

  // Update a single split field.
  const handleUpdateSplit = useCallback((
    type: 'payout' | 'reserved',
    id: string,
    field: keyof EditableSplit,
    value: string | boolean | number
  ) => {
    handlePatchSplit(type, id, { [field]: value } as Partial<EditableSplit>)
  }, [handlePatchSplit])

  // Switch a row's recipient type. Clears the other types' identity fields so a wallet address left in the
  // input can't silently become a hook/project id (or vice-versa) — the create flow does the same on switch.
  const handleChangeRecipientType = useCallback((
    type: 'payout' | 'reserved',
    id: string,
    recipientType: RecipientType,
  ) => {
    if (isLocked) return
    const updateFn = (prev: EditableSplit[]) => {
      // Only reserved rows can Fund market, and only if no other row already claims it (a second would
      // double-pool the reserved tokens); otherwise a new hook row starts as Custom.
      const marketTaken = prev.some(s => s.id !== id && s.recipientType === 'hook' && s.hookMode === 'fundmarket')
      const hookMode: HookMode = recipientType === 'hook' && type === 'reserved' && !marketTaken ? 'fundmarket' : 'custom'
      return prev.map(s => s.id === id && !s.isLocked
        ? { ...s, recipientType, beneficiary: '', projectId: '', hookAddress: '', hook: ZERO_ADDRESS, preferAddToBalance: false, hookMode }
        : s)
    }
    if (type === 'payout') setPayoutSplits(updateFn)
    else setReservedSplits(updateFn)
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

  // Render split row — a percent input, a recipient-type column (Address | Project | Hook), and actions.
  const renderSplitRow = (split: EditableSplit, type: 'payout' | 'reserved') => {
    const ensName = ensNames[split.beneficiary.toLowerCase()]
    const rowFrozen = split.isLocked || isLocked || !primaryData?.configurationComplete
    const labelCls = `text-[10px] block mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`
    const fieldCls = `w-full px-2 py-1.5 text-sm outline-none ${
      isDark
        ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-600'
        : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
    } ${rowFrozen ? 'opacity-50 cursor-not-allowed' : ''}`
    const isReserved = type === 'reserved'
    // "Fund market" pools reserved tokens through the shared LP hook — reserved groups only, and never on
    // more than one row (a second would double-pool). Disable the option elsewhere once a row claims it.
    const groupSplits = isReserved ? reservedSplits : payoutSplits
    const otherFundsMarket = groupSplits.some(
      s => s.id !== split.id && s.recipientType === 'hook' && s.hookMode === 'fundmarket',
    )
    const fundMarketOffered = isReserved
    const fundMarketSelectable = fundMarketOffered && !otherFundsMarket

    const TEN_YEARS = 10 * 365 * 24 * 60 * 60
    const projectBeneficiaryLabel = isReserved
      ? 'Fallback beneficiary'
      : split.preferAddToBalance ? 'Beneficiary (unused)' : 'Destination-token beneficiary'

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
            <label className={labelCls}>Percent</label>
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

          {/* Recipient column */}
          <div className="flex-1">
            {/* Type dropdown + inline project id (Project) */}
            <div className="flex items-center gap-2 mb-2">
              <select
                value={split.recipientType}
                onChange={(e) => handleChangeRecipientType(type, split.id, e.target.value as RecipientType)}
                disabled={rowFrozen}
                className={`px-2 py-1.5 text-sm outline-none ${
                  isDark ? 'bg-juice-dark border border-white/10 text-white' : 'bg-white border border-gray-200 text-gray-900'
                } ${rowFrozen ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <option value="address">Address</option>
                <option value="project">Project</option>
                <option value="hook">Hook</option>
              </select>
              {split.recipientType === 'project' && (
                <input
                  type="text"
                  inputMode="numeric"
                  value={split.projectId}
                  onChange={(e) => handleUpdateSplit(type, split.id, 'projectId', e.target.value)}
                  disabled={rowFrozen}
                  placeholder="Project ID"
                  className={`w-28 px-2 py-1.5 text-sm font-mono outline-none ${
                    isDark ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-600' : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                  } ${rowFrozen ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              )}
            </div>

            {/* ADDRESS */}
            {split.recipientType === 'address' && (
              <>
                <label className={labelCls}>Wallet address</label>
                <input
                  type="text"
                  value={split.beneficiary}
                  onChange={(e) => handleUpdateSplit(type, split.id, 'beneficiary', e.target.value)}
                  disabled={rowFrozen}
                  placeholder="0x..."
                  className={`${fieldCls} font-mono`}
                />
                {ensName && (
                  <div className={`text-[10px] mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{ensName}</div>
                )}
              </>
            )}

            {/* PROJECT */}
            {split.recipientType === 'project' && (
              <>
                {split.projectId && (
                  <div className={`mb-2 text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    <ProjectLink chainSlug={chainInfo.slug} projectId={split.projectId} className="hover:underline">
                      {destinationProjects[split.projectId]?.name || `Project #${split.projectId}`}
                    </ProjectLink>
                  </div>
                )}
                {type === 'payout' && (
                  <label className={`mb-2 flex items-center gap-2 text-[10px] ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    <input
                      type="checkbox"
                      checked={split.preferAddToBalance}
                      onChange={(e) => handleUpdateSplit(type, split.id, 'preferAddToBalance', e.target.checked)}
                      disabled={split.isLocked || isLocked}
                    />
                    Add to balance instead of paying the project
                  </label>
                )}
                <label className={labelCls}>{projectBeneficiaryLabel}</label>
                <input
                  type="text"
                  value={split.beneficiary}
                  onChange={(e) => handleUpdateSplit(type, split.id, 'beneficiary', e.target.value)}
                  disabled={rowFrozen}
                  placeholder={type === 'payout' && split.preferAddToBalance ? 'Optional' : '0x...'}
                  className={`${fieldCls} font-mono`}
                />
                {ensName && (
                  <div className={`text-[10px] mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{ensName}</div>
                )}
                <div className={`mt-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                  {isReserved
                    ? 'Reserved project recipient. Source tokens must be claimed ERC-20s, and the destination needs a primary terminal accepting that token; credits cannot use this route. Missing or reverting routes send source tokens to the fallback beneficiary.'
                    : split.preferAddToBalance
                      ? 'add to balance · no tokens minted'
                      : 'pay project · destination project tokens go to the beneficiary'}
                </div>
                {split.beneficiary.toLowerCase() === ZERO_ADDRESS.toLowerCase() &&
                  !split.isNew &&
                  !split.preferAddToBalance && (
                  <div className="mt-1 text-[10px] text-amber-500">
                    No beneficiary is stored. The account triggering distribution receives destination tokens.
                  </div>
                )}
              </>
            )}

            {/* HOOK */}
            {split.recipientType === 'hook' && (
              <>
                {fundMarketOffered && (
                  <select
                    value={split.hookMode}
                    onChange={(e) => {
                      const mode = e.target.value as HookMode
                      if (mode === 'fundmarket' && !fundMarketSelectable) return
                      handleUpdateSplit(type, split.id, 'hookMode', mode)
                    }}
                    disabled={rowFrozen}
                    className={`mb-2 px-2 py-1.5 text-sm outline-none ${
                      isDark ? 'bg-juice-dark border border-white/10 text-white' : 'bg-white border border-gray-200 text-gray-900'
                    } ${rowFrozen ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <option value="fundmarket" disabled={!fundMarketSelectable}>Fund market</option>
                    <option value="custom">Custom</option>
                  </select>
                )}
                {split.hookMode === 'fundmarket' && fundMarketOffered ? (
                  <div className={`text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Pools split tokens into a Uniswap V4 buyback position. Trading fees route back to your project.
                    <div className={`mt-1 font-mono ${isDark ? 'text-cyan-300' : 'text-cyan-700'}`}>
                      {JBP6_FEE_LP_SPLIT_HOOK.slice(0, 6)}...{JBP6_FEE_LP_SPLIT_HOOK.slice(-4)}
                    </div>
                  </div>
                ) : (
                  <>
                    <label className={labelCls}>Split hook address</label>
                    <input
                      type="text"
                      value={split.hookAddress}
                      onChange={(e) => handleUpdateSplit(type, split.id, 'hookAddress', e.target.value)}
                      disabled={rowFrozen}
                      placeholder="0x... (split hook address)"
                      className={`${fieldCls} font-mono mb-2`}
                    />
                    <label className={labelCls}>with project (optional)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={split.projectId}
                      onChange={(e) => handleUpdateSplit(type, split.id, 'projectId', e.target.value)}
                      disabled={rowFrozen}
                      placeholder="Project ID"
                      className={`${fieldCls} font-mono mb-2`}
                    />
                    <label className={labelCls}>and beneficiary (optional)</label>
                    <input
                      type="text"
                      value={split.beneficiary}
                      onChange={(e) => handleUpdateSplit(type, split.id, 'beneficiary', e.target.value)}
                      disabled={rowFrozen}
                      placeholder="0x..."
                      className={`${fieldCls} font-mono`}
                    />
                    {ensName && (
                      <div className={`text-[10px] mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{ensName}</div>
                    )}
                  </>
                )}
              </>
            )}

            {/* Split lock (fixed-duration rulesets only) */}
            {lockAllowed && !split.isLocked && (
              <div className="mt-2">
                <label className={`flex items-center gap-2 text-[10px] ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  <input
                    type="checkbox"
                    checked={!!split.lockedUntil}
                    disabled={isLocked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const until = Math.floor(Date.now() / 1000) + Math.min(primaryData?.rulesetDuration || 0, TEN_YEARS)
                        handleUpdateSplit(type, split.id, 'lockedUntil', until)
                      } else {
                        handleUpdateSplit(type, split.id, 'lockedUntil', 0)
                      }
                    }}
                  />
                  Locked
                </label>
                {!!split.lockedUntil && (
                  <>
                    <input
                      type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      value={new Date(split.lockedUntil * 1000).toISOString().slice(0, 10)}
                      onChange={(e) => {
                        const ts = Math.floor(Date.parse(`${e.target.value}T00:00:00Z`) / 1000)
                        if (Number.isFinite(ts)) handleUpdateSplit(type, split.id, 'lockedUntil', Math.max(0, ts))
                      }}
                      disabled={isLocked}
                      className={`mt-1 px-2 py-1 text-xs outline-none ${
                        isDark ? 'bg-juice-dark border border-white/10 text-white' : 'bg-white border border-gray-200 text-gray-900'
                      }`}
                    />
                    <div className={`mt-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Locked until this date — the split can’t be edited or removed for the rest of this ruleset.
                    </div>
                  </>
                )}
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
                aria-label="Remove split"
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
              {stageIndex != null && (
                <div
                  data-testid="splits-target-stage"
                  className={`text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'}`}
                >
                  Editing stage {stageIndex + 1}
                  {primaryData?.rulesetId && primaryData.rulesetId !== '0'
                    ? ` · ruleset #${primaryData.rulesetId} on ${chainInfo.shortName || chainInfo.name}`
                    : ''}
                </div>
              )}
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
                    <ChainLogo chainId={cd.chainId} size={12} />
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

              {/* The recurring operator confusion: this tab routes reserved tokens, it does not
                  decide how many are reserved. That rate lives in the ruleset. */}
              <div
                data-testid="reserved-percent-explainer"
                className={`mb-3 p-3 text-xs ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}
              >
                <p>
                  This decides who receives reserved tokens, not how many tokens are reserved. The
                  reserved rate lives in the ruleset — removing every split here sends the whole
                  reserved share to the project owner, it does not stop tokens being reserved.
                </p>
                {isRevnetProject(project) ? (
                  <p className="mt-2">
                    This is a revnet, so its reserved rate is fixed per stage by the configuration set at
                    deployment. It can't be changed by queueing a ruleset — only a stage change alters it.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('juice:send-message', {
                      detail: { message: `Queue a ruleset for project ${projectId} that sets the reserved rate to 0%` },
                    }))}
                    className="mt-2 underline font-medium"
                  >
                    Set the reserved rate to 0% instead
                  </button>
                )}
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
                        href={`${chain?.explorerTx || 'https://etherscan.io/tx/'}${hash}`}
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
            <div
              data-testid="splits-fallback-warning"
              className={`mb-3 p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}
            >
              Emptying the {clearsToFallbackReserved ? 'reserved-token' : 'payout'} group is blocked here because this
              project has default splits stored under the fallback ruleset, which would take over as soon as this
              group is empty. Use the full configuration site to change default split groups explicitly.
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
          payoutSplits={submittablePayoutSplits}
          reservedSplits={submittableReservedSplits}
          baseCurrency={baseCurrency}
          stageIndex={stageIndex}
          onConfirmed={handleConfirmed}
          onError={handleError}
        />
      )}
    </div>
  )
}
