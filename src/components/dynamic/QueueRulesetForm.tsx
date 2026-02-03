import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { formatEther, formatUnits, parseUnits, parseEther } from 'viem'
import { useThemeStore } from '../../stores'
import { useQueueRulesetFormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchProjectWithRuleset,
  fetchProjectSplits,
  fetchConnectedChains,
  type Project,
  type ProjectRuleset,
  type ConnectedChain,
  type JBSplitData,
  type FundAccessLimits,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { calculateSynchronizedStartTime, type JBRulesetConfig, type JBRulesetMetadataConfig } from '../../services/relayr'
import { QueueRulesetModal } from '../payment'
import { ZERO_ADDRESS, USDC_ADDRESSES, type SupportedChainId, JB_CONTRACTS } from '../../constants'

interface QueueRulesetFormProps {
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

const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

// Per-chain ruleset data
interface ChainRulesetData {
  chainId: number
  projectId: number
  ruleset: ProjectRuleset | null
  payoutSplits: JBSplitData[]
  reservedSplits: JBSplitData[]
  fundAccessLimits: FundAccessLimits | null
  selected: boolean  // Whether to queue on this chain
}

// Form state for ruleset configuration
interface RulesetFormState {
  // Cycle settings
  duration: string  // In days for user-friendly input
  weight: string    // Issuance rate
  weightCutPercent: string  // Decay percent per cycle

  // Token settings
  reservedPercent: string   // 0-100
  cashOutTaxRate: string    // 0-100 (exit tax)

  // Permissions
  pausePay: boolean
  allowOwnerMinting: boolean
  ownerMustSendPayouts: boolean

  // Fund access
  payoutLimitType: 'none' | 'limited' | 'unlimited'
  payoutLimit: string  // In ETH
  surplusAllowanceType: 'none' | 'limited' | 'unlimited'
  surplusAllowance: string  // In ETH

  // Memo
  memo: string
}

// Convert form state to JBRulesetConfig
function formStateToRulesetConfig(
  state: RulesetFormState,
  mustStartAtOrAfter: number,
  existingConfig?: ProjectRuleset,
  chainId: number = 1
): JBRulesetConfig {
  // Convert duration from days to seconds (0 means ongoing)
  const durationDays = parseFloat(state.duration) || 0
  const durationSeconds = durationDays > 0 ? Math.floor(durationDays * 24 * 60 * 60) : 0

  // Convert weight (tokens per ETH) - uses 18 decimals
  const weightBigInt = parseEther(state.weight || '1000000')

  // Convert percent values (0-100 input to 0-10000 contract format)
  const reservedPercent = Math.floor((parseFloat(state.reservedPercent) || 0) * 100)
  const cashOutTaxRate = Math.floor((parseFloat(state.cashOutTaxRate) || 0) * 100)
  const weightCutPercent = Math.floor((parseFloat(state.weightCutPercent) || 0) * 10000000) // 0-1000000000

  const metadata: JBRulesetMetadataConfig = {
    reservedPercent,
    cashOutTaxRate,
    baseCurrency: existingConfig?.baseCurrency || 1, // Preserve existing or default to ETH
    pausePay: state.pausePay,
    pauseCreditTransfers: false,
    allowOwnerMinting: state.allowOwnerMinting,
    allowSetCustomToken: true,
    allowTerminalMigration: true,
    allowSetTerminals: true,
    allowSetController: true,
    allowAddAccountingContext: true,
    allowAddPriceFeed: true,
    ownerMustSendPayouts: state.ownerMustSendPayouts,
    holdFees: false,
    useTotalSurplusForCashOuts: false,
    useDataHookForPay: false,
    useDataHookForCashOut: false,
    dataHook: ZERO_ADDRESS,
    metadata: 0,
  }

  // Build fund access limit groups
  const fundAccessLimitGroups = []

  // Only add if there's a payout limit or surplus allowance
  if (state.payoutLimitType !== 'none' || state.surplusAllowanceType !== 'none') {
    const payoutLimits = []
    const surplusAllowances = []

    // Use existing project's baseCurrency for fund access limits
    const currency = existingConfig?.baseCurrency || 1
    // Decimals: 6 for USDC (baseCurrency 2), 18 for ETH (baseCurrency 1)
    const decimals = currency === 2 ? 6 : 18
    // Token address: USDC for baseCurrency 2, NATIVE_TOKEN for baseCurrency 1
    const token = currency === 2
      ? USDC_ADDRESSES[chainId as SupportedChainId]
      : NATIVE_TOKEN

    if (state.payoutLimitType === 'limited') {
      payoutLimits.push({
        amount: parseUnits(state.payoutLimit || '0', decimals).toString(),
        currency,
      })
    } else if (state.payoutLimitType === 'unlimited') {
      // Max uint224 for unlimited
      payoutLimits.push({
        amount: '26959946667150639794667015087019630673637144422540572481103610249215',
        currency,
      })
    }

    if (state.surplusAllowanceType === 'limited') {
      surplusAllowances.push({
        amount: parseUnits(state.surplusAllowance || '0', decimals).toString(),
        currency,
      })
    } else if (state.surplusAllowanceType === 'unlimited') {
      surplusAllowances.push({
        amount: '26959946667150639794667015087019630673637144422540572481103610249215',
        currency,
      })
    }

    if (payoutLimits.length > 0 || surplusAllowances.length > 0) {
      fundAccessLimitGroups.push({
        terminal: JB_CONTRACTS.JBMultiTerminal,
        token,
        payoutLimits,
        surplusAllowances,
      })
    }
  }

  return {
    mustStartAtOrAfter,
    duration: durationSeconds,
    weight: weightBigInt.toString(),
    weightCutPercent,
    approvalHook: existingConfig?.approvalHook || ZERO_ADDRESS,
    metadata,
    splitGroups: [], // Splits are preserved from current config by default
    fundAccessLimitGroups,
  }
}

export default function QueueRulesetForm({ projectId, chainId = '1', messageId }: QueueRulesetFormProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const { isConnected } = useAccount()

  // Persistent state for transaction status
  const { state: persistedState, updateState: updatePersistedState } = useQueueRulesetFormState(messageId)

  // Check if form is locked (already submitted)
  const isLocked = persistedState?.status && persistedState.status !== 'pending'

  // Dispatch event to open wallet panel
  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  // Omnichain state
  const [chainRulesetData, setChainRulesetData] = useState<ChainRulesetData[]>([])

  // Form state
  const [formState, setFormState] = useState<RulesetFormState>({
    duration: '0',
    weight: '1000000',
    weightCutPercent: '0',
    reservedPercent: '0',
    cashOutTaxRate: '0',
    pausePay: false,
    allowOwnerMinting: true,
    ownerMustSendPayouts: false,
    payoutLimitType: 'none',
    payoutLimit: '0',
    surplusAllowanceType: 'none',
    surplusAllowance: '0',
    memo: '',
  })

  // Get selected chains
  const selectedChains = chainRulesetData.filter(cd => cd.selected)
  const isOmnichain = chainRulesetData.length > 1

  // Get currency label from first ruleset
  const baseCurrency = chainRulesetData[0]?.ruleset?.baseCurrency || 1
  const currencyLabel = baseCurrency === 2 ? 'USDC' : 'ETH'

  // Calculate synchronized start time
  const synchronizedStartTime = calculateSynchronizedStartTime()
  const startDate = new Date(synchronizedStartTime * 1000)

  // Fetch project data and current rulesets for all chains
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const primaryChainId = parseInt(chainId)

        // Fetch project and connected chains
        const [projectData, connectedChains] = await Promise.all([
          fetchProject(projectId, primaryChainId),
          fetchConnectedChains(projectId, primaryChainId),
        ])
        setProject(projectData)

        // Determine chains to fetch
        const chainsToFetch: ConnectedChain[] = connectedChains.length > 0
          ? connectedChains
          : [{ chainId: primaryChainId, projectId: parseInt(projectId) }]

        // Fetch ruleset data from all chains in parallel
        const rulesetDataPromises = chainsToFetch.map(async (chain): Promise<ChainRulesetData> => {
          try {
            const chainProject = await fetchProjectWithRuleset(String(chain.projectId), chain.chainId)

            let payoutSplits: JBSplitData[] = []
            let reservedSplits: JBSplitData[] = []
            let fundAccessLimits: FundAccessLimits | null = null

            if (chainProject?.currentRuleset?.id) {
              const splitsData = await fetchProjectSplits(
                String(chain.projectId),
                chain.chainId,
                chainProject.currentRuleset.id
              )
              payoutSplits = splitsData.payoutSplits
              reservedSplits = splitsData.reservedSplits
              fundAccessLimits = splitsData.fundAccessLimits || null
            }

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              ruleset: chainProject?.currentRuleset || null,
              payoutSplits,
              reservedSplits,
              fundAccessLimits,
              selected: true, // Select all chains by default
            }
          } catch (err) {
            console.error(`Failed to fetch ruleset data for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              ruleset: null,
              payoutSplits: [],
              reservedSplits: [],
              fundAccessLimits: null,
              selected: true,
            }
          }
        })

        const allRulesetData = await Promise.all(rulesetDataPromises)
        setChainRulesetData(allRulesetData)

        // Initialize form state from first chain's ruleset
        const firstRuleset = allRulesetData.find(cd => cd.ruleset)?.ruleset
        if (firstRuleset) {
          const durationDays = firstRuleset.duration > 0
            ? (firstRuleset.duration / (24 * 60 * 60)).toString()
            : '0'

          setFormState(prev => ({
            ...prev,
            duration: durationDays,
            weight: formatEther(BigInt(firstRuleset.weight)).replace(/\.?0+$/, ''),
            weightCutPercent: ((firstRuleset.weightCutPercent || 0) / 10000000).toString(),
            reservedPercent: (firstRuleset.reservedPercent / 100).toString(),
            cashOutTaxRate: (firstRuleset.cashOutTaxRate / 100).toString(),
            pausePay: firstRuleset.pausePay,
            allowOwnerMinting: firstRuleset.allowOwnerMinting,
          }))
        }

        // Initialize fund access limits from first chain
        const firstLimits = allRulesetData.find(cd => cd.fundAccessLimits)?.fundAccessLimits
        if (firstLimits) {
          // Get first payout limit and surplus allowance from arrays
          const payoutLimitAmount = firstLimits.payoutLimits[0]?.amount
          const surplusAllowanceAmount = firstLimits.surplusAllowances[0]?.amount

          const payoutLimit = payoutLimitAmount ? BigInt(payoutLimitAmount) : 0n
          const surplusAllowance = surplusAllowanceAmount ? BigInt(surplusAllowanceAmount) : 0n

          // Use correct decimals based on project's baseCurrency (6 for USDC, 18 for ETH)
          const limitDecimals = firstRuleset?.baseCurrency === 2 ? 6 : 18
          const unlimitedThreshold = BigInt('1000000000000000000000000000000')

          setFormState(prev => ({
            ...prev,
            payoutLimitType: payoutLimit === 0n ? 'none' : payoutLimit > unlimitedThreshold ? 'unlimited' : 'limited',
            payoutLimit: payoutLimit > 0n && payoutLimit < unlimitedThreshold ? formatUnits(payoutLimit, limitDecimals) : '0',
            surplusAllowanceType: surplusAllowance === 0n ? 'none' : surplusAllowance > unlimitedThreshold ? 'unlimited' : 'limited',
            surplusAllowance: surplusAllowance > 0n && surplusAllowance < unlimitedThreshold ? formatUnits(surplusAllowance, limitDecimals) : '0',
          }))
        }

      } catch (err) {
        console.error('Failed to load project:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainId])

  const toggleChainSelection = (chainId: number) => {
    if (isLocked) return
    setChainRulesetData(prev =>
      prev.map(cd =>
        cd.chainId === chainId
          ? { ...cd, selected: !cd.selected }
          : cd
      )
    )
  }

  // Callbacks for transaction completion (for persistence)
  const handleConfirmed = useCallback((txHashes: Record<number, string>, bundleId?: string) => {
    updatePersistedState({
      status: 'completed',
      txHashes,
      bundleId,
      confirmedAt: new Date().toISOString(),
    })
  }, [updatePersistedState])

  const handleError = useCallback((error: string) => {
    updatePersistedState({
      status: 'failed',
      error,
    })
  }, [updatePersistedState])

  const handleQueue = () => {
    if (selectedChains.length === 0 || isLocked) return

    if (!isConnected) {
      openWalletPanel()
      return
    }

    // Persist in_progress state
    updatePersistedState({
      status: 'in_progress',
      duration: formState.duration,
      weight: formState.weight,
      decayPercent: formState.weightCutPercent,
      reservedPercent: formState.reservedPercent,
      cashOutTaxRate: formState.cashOutTaxRate,
      selectedChains: selectedChains.map(c => c.chainId),
      submittedAt: new Date().toISOString(),
    })

    setShowModal(true)
  }

  const updateFormState = (key: keyof RulesetFormState, value: string | boolean) => {
    setFormState(prev => ({ ...prev, [key]: value }))
  }

  // Build ruleset config for modal
  const rulesetConfig = formStateToRulesetConfig(
    formState,
    synchronizedStartTime,
    chainRulesetData[0]?.ruleset || undefined,
    parseInt(chainId)
  )

  if (loading) {
    return (
      <div className="w-full">
        <div className={`max-w-lg border p-4 animate-pulse ${
          isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
        }`}>
          <div className="h-6 bg-white/10 w-3/4 mb-3" />
          <div className="h-4 bg-white/10 w-1/2" />
        </div>
      </div>
    )
  }

  const logoUrl = project?.logoUri ? resolveIpfsUri(project.logoUri) : null
  const chainInfo = CHAIN_INFO[parseInt(chainId)] || CHAIN_INFO[1]
  const projectUrl = `https://juicebox.money/v5/${chainInfo.slug}:${projectId}`

  return (
    <div className="w-full">
      <div className={`max-w-lg border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          {logoUrl ? (
            <img src={logoUrl} alt={project?.name || 'Project'} className="w-14 h-14 object-cover" />
          ) : (
            <div className="w-14 h-14 bg-purple-500/20 flex items-center justify-center">
              <span className="text-2xl">⚙️</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Queue New Ruleset
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

        {/* Chain Selection for omnichain */}
        {isOmnichain && (
          <div className={`p-3 mb-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Queue on chains:
            </div>
            <div className="flex flex-wrap gap-2">
              {chainRulesetData.map(cd => {
                const chain = CHAIN_INFO[cd.chainId]
                return (
                  <button
                    key={cd.chainId}
                    onClick={() => toggleChainSelection(cd.chainId)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                      cd.selected
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
                All selected chains will use synchronized start time
              </div>
            )}
          </div>
        )}

        {/* Synchronized Start Time Notice */}
        {selectedChains.length > 0 && (
          <div className={`p-3 mb-4 ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
            <div className={`text-xs font-medium ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>
              Synchronized Start Time
            </div>
            <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {startDate.toLocaleString()}
            </div>
            <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              5 minute buffer ensures all chains finalize before activation
            </div>
          </div>
        )}

        {/* Cycle Settings */}
        <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            Cycle Settings
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Duration */}
            <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Cycle Duration (days)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={formState.duration}
                onChange={(e) => updateFormState('duration', e.target.value)}
                placeholder="0 = ongoing"
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
              <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                0 = no cycles
              </span>
            </div>

            {/* Weight (Issuance) */}
            <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Issuance Rate
              </label>
              <input
                type="number"
                min="0"
                value={formState.weight}
                onChange={(e) => updateFormState('weight', e.target.value)}
                placeholder="1000000"
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
              <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Tokens per {currencyLabel}
              </span>
            </div>
          </div>

          {/* Weight Cut (Decay) */}
          <div className="mt-3">
            <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Issuance Decay (% per cycle)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={formState.weightCutPercent}
              onChange={(e) => updateFormState('weightCutPercent', e.target.value)}
              placeholder="0"
              className={`w-full px-3 py-2 text-sm outline-none ${
                isDark
                  ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                  : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
              }`}
            />
          </div>
        </div>

        {/* Token Settings */}
        <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            Token Settings
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Reserved Rate */}
            <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Reserved Rate (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formState.reservedPercent}
                onChange={(e) => updateFormState('reservedPercent', e.target.value)}
                placeholder="0"
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
            </div>

            {/* Cash Out Tax */}
            <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Exit Tax (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={formState.cashOutTaxRate}
                onChange={(e) => updateFormState('cashOutTaxRate', e.target.value)}
                placeholder="0"
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
              <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                0 = full refund
              </span>
            </div>
          </div>
        </div>

        {/* Fund Access */}
        <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            Fund Access
          </div>

          {/* Payout Limit */}
          <div className="mb-3">
            <label className={`block text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Payout Limit
            </label>
            <div className="flex gap-2 mb-2">
              {(['none', 'limited', 'unlimited'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => updateFormState('payoutLimitType', type)}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                    formState.payoutLimitType === type
                      ? isDark
                        ? 'bg-purple-500/30 text-purple-300'
                        : 'bg-purple-100 text-purple-700'
                      : isDark
                        ? 'bg-white/5 text-gray-400'
                        : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {type === 'none' ? 'None' : type === 'limited' ? 'Limited' : 'Unlimited'}
                </button>
              ))}
            </div>
            {formState.payoutLimitType === 'limited' && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formState.payoutLimit}
                  onChange={(e) => updateFormState('payoutLimit', e.target.value)}
                  placeholder="0"
                  className={`flex-1 px-3 py-2 text-sm outline-none ${
                    isDark
                      ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                      : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                  }`}
                />
                <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{currencyLabel}</span>
              </div>
            )}
          </div>

          {/* Surplus Allowance */}
          <div>
            <label className={`block text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Surplus Allowance
            </label>
            <div className="flex gap-2 mb-2">
              {(['none', 'limited', 'unlimited'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => updateFormState('surplusAllowanceType', type)}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                    formState.surplusAllowanceType === type
                      ? isDark
                        ? 'bg-purple-500/30 text-purple-300'
                        : 'bg-purple-100 text-purple-700'
                      : isDark
                        ? 'bg-white/5 text-gray-400'
                        : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {type === 'none' ? 'None' : type === 'limited' ? 'Limited' : 'Unlimited'}
                </button>
              ))}
            </div>
            {formState.surplusAllowanceType === 'limited' && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formState.surplusAllowance}
                  onChange={(e) => updateFormState('surplusAllowance', e.target.value)}
                  placeholder="0"
                  className={`flex-1 px-3 py-2 text-sm outline-none ${
                    isDark
                      ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                      : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                  }`}
                />
                <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{currencyLabel}</span>
              </div>
            )}
          </div>
        </div>

        {/* Advanced Settings Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className={`w-full py-2 text-xs font-medium mb-3 transition-colors ${
            isDark
              ? 'text-gray-400 hover:text-white'
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          {showAdvanced ? '▼ Hide' : '▶ Show'} Advanced Settings
        </button>

        {/* Advanced Settings */}
        {showAdvanced && (
          <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Permissions
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formState.pausePay}
                  onChange={(e) => updateFormState('pausePay', e.target.checked)}
                  className="w-4 h-4"
                />
                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  Pause payments
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formState.allowOwnerMinting}
                  onChange={(e) => updateFormState('allowOwnerMinting', e.target.checked)}
                  className="w-4 h-4"
                />
                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  Allow owner minting
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formState.ownerMustSendPayouts}
                  onChange={(e) => updateFormState('ownerMustSendPayouts', e.target.checked)}
                  className="w-4 h-4"
                />
                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  Only owner can send payouts
                </span>
              </label>
            </div>
          </div>
        )}

        {/* Memo */}
        <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <label className={`block text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Memo (optional)
          </label>
          <input
            type="text"
            value={formState.memo}
            onChange={(e) => updateFormState('memo', e.target.value)}
            placeholder="Describe the changes..."
            className={`w-full px-3 py-2 text-sm outline-none ${
              isDark
                ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
            }`}
          />
        </div>

        {/* Transaction Status Indicator */}
        {isLocked && (
          <div className={`mb-3 p-3 text-sm ${
            persistedState?.status === 'completed'
              ? isDark ? 'bg-green-500/10' : 'bg-green-50'
              : persistedState?.status === 'failed'
                ? isDark ? 'bg-red-500/10' : 'bg-red-50'
                : isDark ? 'bg-purple-500/10' : 'bg-purple-50'
          }`}>
            <div className={`flex items-center gap-2 ${
              persistedState?.status === 'completed'
                ? isDark ? 'text-green-400' : 'text-green-600'
                : persistedState?.status === 'failed'
                  ? isDark ? 'text-red-400' : 'text-red-600'
                  : isDark ? 'text-purple-400' : 'text-purple-600'
            }`}>
              {persistedState?.status === 'completed' ? (
                <>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Ruleset queued successfully!</span>
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

        {/* Queue Button */}
        <button
          onClick={handleQueue}
          disabled={selectedChains.length === 0 || isLocked}
          className={`w-full py-3 text-sm font-bold transition-colors ${
            selectedChains.length === 0 || isLocked
              ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
              : 'bg-purple-500 hover:bg-purple-500/90 text-white'
          }`}
        >
          {persistedState?.status === 'completed'
            ? 'Queued'
            : persistedState?.status === 'in_progress'
              ? 'Pending...'
              : `Queue Ruleset${selectedChains.length > 1 ? ` on ${selectedChains.length} Chains` : ''}`}
        </button>

        {/* Info */}
        <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {isOmnichain
            ? 'Queued rulesets will be synchronized across all selected chains with a 5 minute start buffer.'
            : 'The new ruleset will take effect after the current cycle ends, or immediately if there are no cycles.'}
        </p>
      </div>

      {/* Modal */}
      <QueueRulesetModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        projectName={project?.name}
        chainRulesetData={selectedChains}
        rulesetConfig={rulesetConfig}
        synchronizedStartTime={synchronizedStartTime}
        memo={formState.memo}
        onConfirmed={handleConfirmed}
        onError={handleError}
      />
    </div>
  )
}
