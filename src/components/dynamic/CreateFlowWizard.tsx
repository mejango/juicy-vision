import { useState, useCallback, useMemo } from 'react'
import { useAccount } from 'wagmi'
import { isAddress, parseEther } from 'viem'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import {
  calculateSynchronizedStartTime,
  type JBRulesetConfig,
  type JBTerminalConfig,
  type REVStageConfig,
} from '../../services/relayr'
import type { JBDeployTiersHookConfig, JB721TierConfig } from '../../services/omnichainDeployer'
import { encodeIpfsUri } from '../../utils/ipfs'
import { pinMetadata } from '../../services/ipfsPinning'
import { buildRevnetStageConfigurations, revnetStageError } from '../../utils/revnetStages'
import { buildTierCategoryPlan, buildTierMetadata } from '../../utils/tierMetadata'
import { LaunchProjectModal, DeployRevnetModal } from '../payment'
import {
  ALL_CHAIN_IDS,
  CHAINS,
  JB_CONTRACTS,
  JB_ROUTER_TERMINAL_REGISTRY,
  NATIVE_TOKEN,
  ZERO_ADDRESS,
} from '../../constants'

// ============================================================================
// Types
// ============================================================================

interface CreateFlowWizardProps {
  // mapProps forwards all-string props, so chainIds may arrive as "1,10,8453,42161"
  defaultChainIds?: number[] | string
}

/** Normalize the defaultChainIds prop (number[] or comma-separated string) to a valid chain-id list. */
const DEFAULT_CHAIN_ID = ALL_CHAIN_IDS.find(id => CHAINS[id]?.name.includes('Base')) ?? ALL_CHAIN_IDS[0]

function normalizeChainIds(input: number[] | string | undefined): number[] {
  if (Array.isArray(input) && input.length > 0) {
    const filtered = input.filter(id => (ALL_CHAIN_IDS as readonly number[]).includes(id))
    return filtered.length > 0 ? filtered : [DEFAULT_CHAIN_ID]
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    const parsed = input
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(id => Number.isFinite(id) && (ALL_CHAIN_IDS as readonly number[]).includes(id))
    if (parsed.length > 0) return parsed
  }
  return [DEFAULT_CHAIN_ID]
}

type Flavor = 'custom' | 'revnet'
type StepId = 'basics' | 'ruleset' | 'stages' | 'shop' | 'deploy'

// Custom flavor: Basics → Ruleset → Shop → Deploy (Shop deploys 721 tiers atomically).
const CUSTOM_STEPS: { id: StepId; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'ruleset', label: 'Ruleset' },
  { id: 'shop', label: 'Shop' },
  { id: 'deploy', label: 'Deploy' },
]

// Revnet flavor: Basics → Stages → Shop → Deploy. Shop deploys 721 tiers via the
// 6-arg REVDeployer.deployFor overload atomically with the revnet.
const REVNET_STEPS: { id: StepId; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'stages', label: 'Stages' },
  { id: 'shop', label: 'Shop' },
  { id: 'deploy', label: 'Deploy' },
]

// UINT224_MAX — unlimited sentinel for payout limits / surplus allowances (matches CreateProjectForm)
const UINT224_MAX = '26959946667150639794667015087019630673637144422540572481103610249215'

// Splits total (protocol scale, 1e9 = 100%)
const SPLITS_TOTAL = 1_000_000_000

// cashOutTaxRate sentinel: 10000 (=100%) turns cash-outs off entirely
type CashOutPreset = 'none' | 'light' | 'medium' | 'heavy' | 'custom'
const CASH_OUT_PRESET_VALUES: Record<Exclude<CashOutPreset, 'custom'>, number> = {
  none: 0,
  light: 10,
  medium: 50,
  heavy: 80,
}

// Cycle duration presets (days). 0 = flexible (no fixed cycles).
const DURATION_PRESETS: { label: string; days: number }[] = [
  { label: 'Flexible', days: 0 },
  { label: '1 Day', days: 1 },
  { label: '7 Days', days: 7 },
  { label: '14 Days', days: 14 },
  { label: '28 Days', days: 28 },
]

interface SplitRow {
  id: string
  beneficiary: string
  value: string // reserved: percent of reserved pool (0-100); payout: ETH amount
}

interface TierRow {
  id: string
  name: string
  description: string
  imageUrl: string
  animationUrl: string
  mediaType: string
  price: string // in accounting currency (ETH)
  unlimited: boolean
  supply: string
  categoryName: string
}

// Revnet stage — mirrors CreateRevnetForm's StageFormState exactly.
interface StageFormState {
  id: string
  startsAtOrAfter: string // Relative days from previous stage (or absolute for first)
  splitPercent: string    // 0-100 (to operator)
  initialIssuance: string // Tokens per ETH
  decayFrequency: string  // Days between decay
  decayPercent: string    // 0-100 decay per frequency
  cashOutTaxRate: string  // 0-100
}

const DEFAULT_STAGE: Omit<StageFormState, 'id'> = {
  startsAtOrAfter: '0',
  splitPercent: '20',
  initialIssuance: '1000000',
  decayFrequency: '7',
  decayPercent: '5',
  cashOutTaxRate: '10',
}

interface WizardFormState {
  // Basics
  name: string
  symbol: string
  tagline: string
  description: string
  logoUrl: string

  // Ruleset
  weight: string
  reservedPercent: string
  reservedSplits: SplitRow[]

  cashOutPreset: CashOutPreset
  cashOutCustom: string

  durationDays: number

  payoutType: 'none' | 'limited' | 'unlimited'
  payoutSplits: SplitRow[]

  surplusAllowanceType: 'none' | 'limited' | 'unlimited'
  surplusAllowance: string

  // Advanced permissions
  pausePay: boolean
  allowOwnerMinting: boolean
  ownerMustSendPayouts: boolean
  holdFees: boolean
  pauseCreditTransfers: boolean

  // Shop
  shopEnabled: boolean
  tiers: TierRow[]

  // Memo
  memo: string
}

const DEFAULT_FORM_STATE: WizardFormState = {
  name: '',
  symbol: '',
  tagline: '',
  description: '',
  logoUrl: '',
  weight: '1000000',
  reservedPercent: '0',
  reservedSplits: [],
  cashOutPreset: 'none',
  cashOutCustom: '0',
  durationDays: 0,
  payoutType: 'none',
  payoutSplits: [],
  surplusAllowanceType: 'none',
  surplusAllowance: '0',
  pausePay: false,
  allowOwnerMinting: true,
  ownerMustSendPayouts: false,
  holdFees: false,
  pauseCreditTransfers: false,
  shopEnabled: false,
  tiers: [],
  memo: '',
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function isValidAddress(v: string): boolean {
  return isAddress(v.trim(), { strict: false })
}

// ============================================================================
// Config building — mirrors CreateProjectForm.formStateToRulesetConfig exactly
// (weight parseEther, percent*100 for reserved/cashOut, UINT224_MAX sentinel,
//  currency 1 = ETH, native token accounting context) and extends it with
//  reserved-token + payout split groups.
// ============================================================================

function resolveCashOutPercent(state: WizardFormState): number {
  if (state.cashOutPreset === 'custom') {
    const v = parseFloat(state.cashOutCustom) || 0
    return Math.min(Math.max(v, 0), 90)
  }
  return CASH_OUT_PRESET_VALUES[state.cashOutPreset]
}

/**
 * Build the reserved-token split group (groupId "1").
 * Each row's `value` is a percent (0-100) of the reserved pool → scaled to 1e9.
 * Remainder (if rows sum < 100%) implicitly goes to the project owner.
 */
function buildReservedSplitGroup(state: WizardFormState) {
  const rows = state.reservedSplits.filter(r => isValidAddress(r.beneficiary) && parseFloat(r.value) > 0)
  if (rows.length === 0) return null
  return {
    groupId: '1',
    splits: rows.map(r => ({
      percent: Math.floor((parseFloat(r.value) || 0) * 10_000_000), // pct * 1e7 (out of 1e9)
      projectId: 0,
      beneficiary: r.beneficiary.trim(),
      preferAddToBalance: false,
      lockedUntil: 0,
      hook: ZERO_ADDRESS,
    })),
  }
}

/**
 * Build the payout split group (groupId = uint256(accounting token)).
 * Rows carry ETH amounts; percents are derived amount/total, remainder-balanced
 * so the group sums to exactly 1e9 (no overflow revert).
 */
function buildPayoutSplitGroup(state: WizardFormState) {
  if (state.payoutType !== 'limited') return null
  const rows = state.payoutSplits.filter(r => isValidAddress(r.beneficiary) && parseFloat(r.value) > 0)
  if (rows.length === 0) return null

  const amounts = rows.map(r => parseFloat(r.value) || 0)
  const total = amounts.reduce((a, b) => a + b, 0)
  if (total <= 0) return null

  let assigned = 0
  const splits = rows.map((r, i) => {
    const isLast = i === rows.length - 1
    const percent = isLast
      ? SPLITS_TOTAL - assigned
      : Math.floor((amounts[i] / total) * SPLITS_TOTAL)
    assigned += percent
    return {
      percent,
      projectId: 0,
      beneficiary: r.beneficiary.trim(),
      preferAddToBalance: false,
      lockedUntil: 0,
      hook: ZERO_ADDRESS,
    }
  })

  return {
    groupId: BigInt(NATIVE_TOKEN).toString(),
    splits,
  }
}

function buildRulesetConfig(state: WizardFormState, mustStartAtOrAfter: number): JBRulesetConfig {
  // Weight (tokens per ETH) — 18 decimals
  const weightBigInt = parseEther(state.weight || '1000000')

  // Duration days → seconds
  const durationSeconds = state.durationDays > 0 ? Math.floor(state.durationDays * 24 * 60 * 60) : 0

  // Percent values (out of 10000)
  const reservedPercent = Math.floor((parseFloat(state.reservedPercent) || 0) * 100)
  const cashOutTaxRate = Math.floor(resolveCashOutPercent(state) * 100)

  // Split groups
  const splitGroups: JBRulesetConfig['splitGroups'] = []
  const reservedGroup = buildReservedSplitGroup(state)
  if (reservedGroup) splitGroups.push(reservedGroup)
  const payoutGroup = buildPayoutSplitGroup(state)
  if (payoutGroup) splitGroups.push(payoutGroup)

  // Fund access limit groups (payout limit + surplus allowance)
  const fundAccessLimitGroups: JBRulesetConfig['fundAccessLimitGroups'] = []
  const payoutLimits: { amount: string; currency: number }[] = []
  const surplusAllowances: { amount: string; currency: number }[] = []

  if (state.payoutType === 'limited') {
    const total = state.payoutSplits
      .filter(r => parseFloat(r.value) > 0)
      .reduce((a, r) => a + (parseFloat(r.value) || 0), 0)
    if (total > 0) {
      payoutLimits.push({ amount: parseEther(String(total)).toString(), currency: 61166 })
    }
  } else if (state.payoutType === 'unlimited') {
    payoutLimits.push({ amount: UINT224_MAX, currency: 61166 })
  }

  if (state.surplusAllowanceType === 'limited') {
    surplusAllowances.push({ amount: parseEther(state.surplusAllowance || '0').toString(), currency: 61166 })
  } else if (state.surplusAllowanceType === 'unlimited') {
    surplusAllowances.push({ amount: UINT224_MAX, currency: 61166 })
  }

  if (payoutLimits.length > 0 || surplusAllowances.length > 0) {
    fundAccessLimitGroups.push({
      terminal: JB_CONTRACTS.JBMultiTerminal,
      token: NATIVE_TOKEN,
      payoutLimits,
      surplusAllowances,
    })
  }

  return {
    mustStartAtOrAfter,
    duration: durationSeconds,
    weight: weightBigInt.toString(),
    weightCutPercent: 0,
    approvalHook: ZERO_ADDRESS, // No JBDeadline addresses in constants — omit approval hook
    metadata: {
      reservedPercent,
      cashOutTaxRate,
      baseCurrency: 1, // ETH
      pausePay: state.pausePay,
      pauseCreditTransfers: state.pauseCreditTransfers,
      allowOwnerMinting: state.allowOwnerMinting,
      allowSetCustomToken: true,
      allowTerminalMigration: true,
      allowSetTerminals: true,
      allowSetController: true,
      allowAddAccountingContext: true,
      allowAddPriceFeed: true,
      ownerMustSendPayouts: state.ownerMustSendPayouts,
      holdFees: state.holdFees,
      scopeCashOutsToLocalBalances: false,
      useDataHookForPay: false,
      useDataHookForCashOut: false,
      dataHook: ZERO_ADDRESS,
      metadata: 0,
    },
    splitGroups,
    fundAccessLimitGroups,
  }
}

/**
 * Build a single JB721TierConfig from a wizard TierRow (V6 flat-flags shape).
 * Metadata is pinned before encoding. A tier is never deployed with silently
 * missing metadata.
 */
async function buildTierConfig(tier: TierRow, category: number): Promise<JB721TierConfig> {
  const price = parseEther(tier.price || '0').toString()
  const initialSupply = tier.unlimited ? 999999999 : Math.max(parseInt(tier.supply) || 0, 0)

  const metadataUri = await pinMetadata(
    buildTierMetadata({
      name: tier.name,
      description: tier.description,
      image: tier.imageUrl,
      animationUrl: tier.animationUrl,
      mediaType: tier.mediaType,
      categoryName: tier.categoryName,
    }),
    `tier-metadata-${tier.name}`,
  )
  const encodedIPFSUri = encodeIpfsUri(metadataUri)
  if (!encodedIPFSUri) throw new Error(`Could not encode metadata for ${tier.name}`)

  return {
    price,
    initialSupply,
    votingUnits: 0,
    reserveFrequency: 0,
    reserveBeneficiary: ZERO_ADDRESS,
    encodedIPFSUri,
    category,
    discountPercent: 0,
    allowOwnerMint: false,
    useReserveBeneficiaryAsDefault: false,
    transfersPausable: false,
    useVotingUnits: false,
    cannotBeRemoved: false,
    cannotIncreaseDiscountPercent: false,
    cannotBuyWithCredits: false,
    splitPercent: 0,
    splits: [],
  }
}

/**
 * Build the full JBDeployTiersHookConfig from the wizard shop state.
 * Returns undefined when there are no tiers (base project deploys unchanged).
 */
async function buildDeployTiersHookConfig(
  tiers: TierRow[],
  projectName: string,
  symbol: string,
  contractUri: string,
): Promise<JBDeployTiersHookConfig | undefined> {
  if (tiers.length === 0) return undefined

  const categoryPlan = buildTierCategoryPlan(tiers)
  const tierConfigs = await Promise.all(tiers.map(t =>
    buildTierConfig(t, categoryPlan.categoryByTierId[t.id] ?? 0)
  ))
  // The store requires ascending categories; stable sort preserves item order within a category.
  tierConfigs.sort((a, b) => a.category - b.category)

  return {
    name: projectName || 'Collection',
    symbol: symbol || projectName.slice(0, 11) || 'NFT',
    baseUri: 'ipfs://',
    tokenUriResolver: ZERO_ADDRESS,
    contractUri,
    tiersConfig: {
      tiers: tierConfigs,
      currency: 1, // ETH
      decimals: 18,
    },
    flags: {
      noNewTiersWithReserves: false,
      noNewTiersWithVotes: false,
      noNewTiersWithOwnerMinting: false,
      preventOverspending: false,
      issueTokensForSplits: false,
    },
    useDataHookForCashOut: false,
  }
}

function buildTerminalConfigurations(): JBTerminalConfig[] {
  return [
    {
      terminal: JB_CONTRACTS.JBMultiTerminal,
      accountingContextsToAccept: [{
        token: NATIVE_TOKEN,
        decimals: 18,
        currency: 61166,
      }],
    },
    {
      terminal: JB_ROUTER_TERMINAL_REGISTRY,
      accountingContextsToAccept: [],
    },
  ]
}

// ============================================================================
// Component
// ============================================================================

export default function CreateFlowWizard({ defaultChainIds }: CreateFlowWizardProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  const { address, isConnected } = useAccount()
  const { address: managedAddress } = useManagedWallet()

  const [flavor, setFlavor] = useState<Flavor>('custom')
  const [step, setStep] = useState<StepId>('basics')
  const [formState, setFormState] = useState<WizardFormState>(DEFAULT_FORM_STATE)
  const [selectedChains, setSelectedChains] = useState<number[]>(() => normalizeChainIds(defaultChainIds))
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [preparedProjectUri, setPreparedProjectUri] = useState('')
  const [preparationError, setPreparationError] = useState<string | null>(null)

  // Revnet-flavor state
  const [stages, setStages] = useState<StageFormState[]>(() => [{ ...DEFAULT_STAGE, id: genId('stage') }])
  const [autoDeploySuckers, setAutoDeploySuckers] = useState(true)

  // Built 721 tiers config (async — pins metadata before opening the launch modal)
  const [deployTiersConfig, setDeployTiersConfig] = useState<JBDeployTiersHookConfig | undefined>()
  const [buildingTiers, setBuildingTiers] = useState(false)

  const ownerAddress = (isManagedMode ? managedAddress : address) || ''
  const operatorAddress = isManagedMode ? managedAddress || '' : ''

  const synchronizedStartTime = calculateSynchronizedStartTime()
  const startDate = new Date(synchronizedStartTime * 1000)

  const STEPS = flavor === 'revnet' ? REVNET_STEPS : CUSTOM_STEPS
  const stepIndex = Math.max(0, STEPS.findIndex(s => s.id === step))

  // --- state updaters ---
  const update = useCallback(<K extends keyof WizardFormState>(key: K, value: WizardFormState[K]) => {
    setFormState(prev => ({ ...prev, [key]: value }))
  }, [])

  const toggleChain = useCallback((chainId: number) => {
    setSelectedChains(prev =>
      prev.includes(chainId) ? prev.filter(id => id !== chainId) : [...prev, chainId]
    )
  }, [])

  // Reserved splits
  const addReservedSplit = () =>
    setFormState(prev => ({ ...prev, reservedSplits: [...prev.reservedSplits, { id: genId('rs'), beneficiary: '', value: '' }] }))
  const removeReservedSplit = (id: string) =>
    setFormState(prev => ({ ...prev, reservedSplits: prev.reservedSplits.filter(r => r.id !== id) }))
  const updateReservedSplit = (id: string, key: 'beneficiary' | 'value', value: string) =>
    setFormState(prev => ({ ...prev, reservedSplits: prev.reservedSplits.map(r => r.id === id ? { ...r, [key]: value } : r) }))

  // Payout splits
  const addPayoutSplit = () =>
    setFormState(prev => ({ ...prev, payoutSplits: [...prev.payoutSplits, { id: genId('po'), beneficiary: '', value: '' }] }))
  const removePayoutSplit = (id: string) =>
    setFormState(prev => ({ ...prev, payoutSplits: prev.payoutSplits.filter(r => r.id !== id) }))
  const updatePayoutSplit = (id: string, key: 'beneficiary' | 'value', value: string) =>
    setFormState(prev => ({ ...prev, payoutSplits: prev.payoutSplits.map(r => r.id === id ? { ...r, [key]: value } : r) }))

  // Tiers
  const addTier = () =>
    setFormState(prev => ({
      ...prev,
      tiers: [...prev.tiers, {
        id: genId('tier'),
        name: '',
        description: '',
        imageUrl: '',
        animationUrl: '',
        mediaType: '',
        price: '',
        unlimited: true,
        supply: '',
        categoryName: '',
      }],
    }))
  const removeTier = (id: string) =>
    setFormState(prev => ({ ...prev, tiers: prev.tiers.filter(t => t.id !== id) }))
  const updateTier = (id: string, patch: Partial<TierRow>) =>
    setFormState(prev => ({ ...prev, tiers: prev.tiers.map(t => t.id === id ? { ...t, ...patch } : t) }))

  // Revnet stages
  const addStage = () =>
    setStages(prev => [...prev, { ...DEFAULT_STAGE, id: genId('stage'), startsAtOrAfter: '30' }])
  const removeStage = (id: string) =>
    setStages(prev => (prev.length <= 1 ? prev : prev.filter(s => s.id !== id)))
  const updateStage = (id: string, key: keyof StageFormState, value: string) =>
    setStages(prev => prev.map(s => s.id === id ? { ...s, [key]: value } : s))

  // Switch flavor — reset to the first step so the (flavor-dependent) stepper stays valid.
  const switchFlavor = useCallback((next: Flavor) => {
    setFlavor(next)
    setStep('basics')
  }, [])

  // --- validation ---
  const reservedSum = useMemo(
    () => formState.reservedSplits.reduce((a, r) => a + (parseFloat(r.value) || 0), 0),
    [formState.reservedSplits]
  )
  const reservedSplitsValid = reservedSum <= 100 &&
    formState.reservedSplits.every(r => (!r.beneficiary && !r.value) || isValidAddress(r.beneficiary))

  const payoutSplitsValid = formState.payoutType !== 'limited' ||
    (formState.payoutSplits.some(r => isValidAddress(r.beneficiary) && parseFloat(r.value) > 0) &&
      formState.payoutSplits.every(r => (!r.beneficiary && !r.value) || (isValidAddress(r.beneficiary) && parseFloat(r.value) > 0)))
  const tiersValid = !formState.shopEnabled || (
    formState.tiers.length > 0 && formState.tiers.every(tier => {
      try {
        buildTierMetadata({
          name: tier.name,
          description: tier.description,
          image: tier.imageUrl,
          animationUrl: tier.animationUrl,
          mediaType: tier.mediaType,
          categoryName: tier.categoryName,
        })
      } catch {
        return false
      }
      return tier.categoryName.trim().length <= 80 &&
        Number.isFinite(Number(tier.price)) && Number(tier.price) >= 0 &&
        (tier.unlimited || (Number.isInteger(Number(tier.supply)) && Number(tier.supply) > 0))
    })
  )
  const hasLimitedTier = formState.shopEnabled && formState.tiers.some(tier => !tier.unlimited)
  const limitedTierOnMultipleChains = hasLimitedTier && selectedChains.length > 1

  const stageError = stages.map(revnetStageError).find(Boolean) || null
  const basicsValid = flavor === 'revnet'
    ? formState.name.trim().length > 0 && /^[A-Za-z0-9]{1,11}$/.test(formState.symbol) && selectedChains.length > 0
    : formState.name.trim().length > 0 && selectedChains.length > 0

  const isValid = flavor === 'revnet'
    ? basicsValid && stages.length > 0 && !stageError && tiersValid && !limitedTierOnMultipleChains &&
      (!isManagedMode || isValidAddress(operatorAddress))
    : basicsValid && reservedSplitsValid && payoutSplitsValid && tiersValid && !limitedTierOnMultipleChains &&
      (!isManagedMode || isValidAddress(ownerAddress))

  // --- build configs ---
  const rulesetConfig = useMemo(
    () => buildRulesetConfig(formState, synchronizedStartTime),
    [formState, synchronizedStartTime]
  )
  const terminalConfigurations = useMemo(() => buildTerminalConfigurations(), [])

  const projectMetadata = useMemo(
    () => {
      const { storeCategories } = buildTierCategoryPlan(formState.shopEnabled ? formState.tiers : [])
      return {
        name: formState.name,
        description: formState.description,
        tagline: formState.tagline,
        logoUri: formState.logoUrl,
        ...(Object.keys(storeCategories).length > 0 ? { storeCategories } : {}),
      }
    },
    [formState.name, formState.description, formState.tagline, formState.logoUrl, formState.shopEnabled, formState.tiers]
  )

  // REVDeployer requires each stage start to be strictly later than the last.
  const stageConfigurations = useMemo<REVStageConfig[]>(
    () => stageError ? [] : buildRevnetStageConfigurations(stages, synchronizedStartTime),
    [stages, synchronizedStartTime, stageError]
  )

  const activeTierCount = formState.shopEnabled ? formState.tiers.length : 0

  const handleDeploy = useCallback(async () => {
    if (!isValid) return
    if (flavor === 'revnet' && !isManagedMode) {
      window.dispatchEvent(new CustomEvent('juice:open-auth-modal'))
      return
    }
    if (flavor === 'revnet' && !isValidAddress(operatorAddress)) return
    if (flavor === 'custom' && !isConnected && !isManagedMode) {
      window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
      return
    }

    setBuildingTiers(true)
    setPreparationError(null)
    try {
      const projectUri = await pinMetadata(projectMetadata, `project-${formState.name}`)
      let tiersConfig: JBDeployTiersHookConfig | undefined
      if (activeTierCount > 0) {
        const cfg = await buildDeployTiersHookConfig(
          formState.tiers,
          formState.name,
          formState.symbol,
          projectUri,
        )
        if (!cfg) throw new Error('Shop configuration is incomplete')
        tiersConfig = cfg
      }
      setPreparedProjectUri(projectUri)
      setDeployTiersConfig(tiersConfig)
      setShowModal(true)
    } catch (err) {
      console.error('Failed to prepare project metadata:', err)
      setPreparedProjectUri('')
      setDeployTiersConfig(undefined)
      setPreparationError(err instanceof Error ? err.message : 'Could not prepare project metadata')
    } finally {
      setBuildingTiers(false)
    }
  }, [isValid, flavor, isConnected, isManagedMode, operatorAddress, activeTierCount, formState.tiers, formState.name, formState.symbol, projectMetadata])

  // --- shared class helpers ---
  const cardClass = `p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`
  const labelClass = `block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`
  const inputClass = `w-full px-3 py-2 text-sm outline-none ${
    isDark
      ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
      : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
  }`
  const smallInputClass = `w-full px-2 py-1.5 text-xs outline-none ${
    isDark
      ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
      : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
  }`

  const segButton = (active: boolean) =>
    `flex-1 py-1.5 text-xs font-medium transition-colors ${
      active
        ? isDark ? 'bg-juice-orange/30 text-juice-orange' : 'bg-orange-100 text-orange-700'
        : isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-100 text-gray-500'
    }`

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="w-full">
      <div className={`max-w-lg border p-4 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-14 h-14 flex items-center justify-center text-2xl ${
            flavor === 'revnet'
              ? isDark ? 'bg-purple-500/20' : 'bg-purple-100'
              : isDark ? 'bg-juice-orange/20' : 'bg-orange-100'
          }`}>
            {flavor === 'revnet' ? '🌀' : '+'}
          </div>
          <div>
            <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {flavor === 'revnet' ? 'Deploy a Revnet' : 'Create a Project'}
            </h3>
            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              V6 · {selectedChains.length} chain{selectedChains.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Flavor toggle */}
        <div className="flex gap-1 mb-4">
          {([['custom', 'Custom'], ['revnet', 'Revnet']] as const).map(([f, label]) => {
            const active = flavor === f
            return (
              <button
                key={f}
                onClick={() => switchFlavor(f)}
                className={`flex-1 py-1.5 text-xs font-semibold transition-colors border ${
                  active
                    ? f === 'revnet'
                      ? isDark ? 'bg-purple-500/30 text-purple-300 border-purple-500/50' : 'bg-purple-100 text-purple-700 border-purple-300'
                      : isDark ? 'bg-juice-orange/30 text-juice-orange border-juice-orange/50' : 'bg-orange-100 text-orange-700 border-orange-300'
                    : isDark ? 'bg-white/5 text-gray-400 border-white/10' : 'bg-gray-100 text-gray-500 border-gray-200'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 mb-4">
          {STEPS.map((s, i) => {
            const isActive = s.id === step
            const isDone = i < stepIndex
            // Allow jumping back to prior steps, or forward once basics is valid
            const canJump = i <= stepIndex || basicsValid
            return (
              <button
                key={s.id}
                onClick={() => canJump && setStep(s.id)}
                disabled={!canJump}
                className={`flex-1 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-juice-orange text-juice-orange'
                    : isDone
                      ? isDark ? 'border-juice-orange/40 text-gray-300' : 'border-orange-300 text-gray-600'
                      : isDark ? 'border-white/10 text-gray-500' : 'border-gray-200 text-gray-400'
                } ${canJump ? 'cursor-pointer' : 'cursor-not-allowed'}`}
              >
                {i + 1}. {s.label}
              </button>
            )
          })}
        </div>

        {/* ================= STEP: BASICS ================= */}
        {step === 'basics' && (
          <>
            <div className={cardClass}>
              <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Project Info</div>
              <div className="space-y-3">
                <div>
                  <label className={labelClass}>Project Name *</label>
                  <input type="text" value={formState.name} onChange={e => update('name', e.target.value)} placeholder="My Project" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Token Ticker{flavor === 'revnet' ? ' *' : ''}</label>
                  <input
                    type="text"
                    value={formState.symbol}
                    onChange={e => update('symbol', e.target.value.toUpperCase().slice(0, 11))}
                    placeholder="TOKEN"
                    className={`${inputClass} font-mono uppercase`}
                  />
                  <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {flavor === 'revnet' ? 'Names the revnet ERC-20 · up to 11 characters' : 'Up to 11 characters'}
                  </span>
                </div>
                <div>
                  <label className={labelClass}>Tagline</label>
                  <input type="text" value={formState.tagline} onChange={e => update('tagline', e.target.value)} placeholder="One line about your project" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Description</label>
                  <textarea value={formState.description} onChange={e => update('description', e.target.value)} placeholder="What is this project about?" rows={2} className={`${inputClass} resize-none`} />
                </div>
                <div>
                  <label className={labelClass}>Logo URL (optional)</label>
                  <input type="text" value={formState.logoUrl} onChange={e => update('logoUrl', e.target.value)} placeholder="https://... or ipfs://..." className={inputClass} />
                </div>
              </div>
            </div>

            {/* Chain selection */}
            <div className={cardClass}>
              <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Deploy on chains:</div>
              <div className="flex flex-wrap gap-2">
                {ALL_CHAIN_IDS.map(chainId => {
                  const chain = CHAINS[chainId]
                  const isSelected = selectedChains.includes(chainId)
                  return (
                    <button
                      key={chainId}
                      onClick={() => toggleChain(chainId)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                        isSelected
                          ? isDark ? 'bg-juice-orange/30 text-juice-orange border border-juice-orange/50' : 'bg-orange-100 text-orange-700 border border-orange-300'
                          : isDark ? 'bg-white/5 text-gray-400 border border-white/10' : 'bg-gray-100 text-gray-500 border border-gray-200'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: chain?.color || '#888' }} />
                      {chain?.shortName || chainId}
                    </button>
                  )
                })}
              </div>
              <p className={`mt-2 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Same configuration deploys on every selected chain. Suckers auto-link them for cross-chain token bridging.
              </p>
            </div>

            {/* Revnet-only: operator + suckers */}
            {flavor === 'revnet' && (
              <div className={cardClass}>
                <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Revnet Settings</div>
                <div className="space-y-3">
                  <div>
                    <div className={labelClass}>Revnet operator</div>
                    <div className={`${inputClass} font-mono`}>
                      {operatorAddress || 'Assigned when you sign in'}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoDeploySuckers}
                      onChange={e => setAutoDeploySuckers(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      Auto-deploy suckers for cross-chain token bridging
                    </span>
                  </label>
                </div>
              </div>
            )}
          </>
        )}

        {/* ================= STEP: STAGES (revnet) ================= */}
        {step === 'stages' && (
          <>
            <div className={cardClass}>
              <div className="flex items-center justify-between mb-3">
                <div className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Stages ({stages.length})</div>
                <button onClick={addStage} className={`text-xs px-2 py-1 ${isDark ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'}`}>+ Add Stage</button>
              </div>

              <div className="space-y-4">
                {stages.map((stage, index) => (
                  <div key={stage.id} className={`p-3 border ${isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Stage {index + 1}</span>
                      {stages.length > 1 && (
                        <button onClick={() => removeStage(stage.id)} className={`text-xs px-2 py-0.5 ${isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'}`}>Remove</button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{index === 0 ? 'Delay (days)' : 'Days after prev'}</label>
                        <input type="number" min="0" value={stage.startsAtOrAfter} onChange={e => updateStage(stage.id, 'startsAtOrAfter', e.target.value)} className={smallInputClass} />
                      </div>
                      <div>
                        <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Operator Split (%)</label>
                        <input type="number" min="0" max="100" step="0.1" value={stage.splitPercent} onChange={e => updateStage(stage.id, 'splitPercent', e.target.value)} className={smallInputClass} />
                      </div>
                      <div>
                        <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Issuance Rate</label>
                        <input type="number" min="0" value={stage.initialIssuance} onChange={e => updateStage(stage.id, 'initialIssuance', e.target.value)} className={smallInputClass} />
                        <span className={`text-[9px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Tokens/ETH</span>
                      </div>
                      <div>
                        <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Decay Every (days)</label>
                        <input type="number" min="0" value={stage.decayFrequency} onChange={e => updateStage(stage.id, 'decayFrequency', e.target.value)} className={smallInputClass} />
                      </div>
                      <div>
                        <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Decay (%)</label>
                        <input type="number" min="0" max="100" step="0.1" value={stage.decayPercent} onChange={e => updateStage(stage.id, 'decayPercent', e.target.value)} className={smallInputClass} />
                      </div>
                      <div>
                        <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Cash-out curve rate (%)</label>
                        <input type="number" min="0" max="99.99" step="0.01" value={stage.cashOutTaxRate} onChange={e => updateStage(stage.id, 'cashOutTaxRate', e.target.value)} className={smallInputClass} />
                        <span className={`text-[9px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Higher reduces partial exits</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className={`mt-3 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Revnets use automated stage-based issuance decay. Once deployed, stage configurations cannot be changed.
              </p>
              {stageError && (
                <p className={`mt-2 text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>{stageError}</p>
              )}
            </div>
          </>
        )}

        {/* ================= STEP: RULESET ================= */}
        {step === 'ruleset' && (
          <>
            {/* Issuance + reserved */}
            <div className={cardClass}>
              <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Issuance</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Issuance Rate</label>
                  <input type="number" min="0" value={formState.weight} onChange={e => update('weight', e.target.value)} placeholder="1000000" className={inputClass} />
                  <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Tokens per ETH</span>
                </div>
                <div>
                  <label className={labelClass}>Reserved (%)</label>
                  <input type="number" min="0" max="100" step="0.01" value={formState.reservedPercent} onChange={e => update('reservedPercent', e.target.value)} placeholder="0" className={inputClass} />
                  <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Held for the team</span>
                </div>
              </div>

              {/* Reserved recipients */}
              {parseFloat(formState.reservedPercent) > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <label className={labelClass} style={{ marginBottom: 0 }}>Reserved recipients</label>
                    <button onClick={addReservedSplit} className={`text-xs px-2 py-1 ${isDark ? 'bg-juice-orange/20 text-juice-orange hover:bg-juice-orange/30' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>+ Add</button>
                  </div>
                  <div className="space-y-2">
                    {formState.reservedSplits.map(r => (
                      <div key={r.id} className="flex items-center gap-2">
                        <input value={r.beneficiary} onChange={e => updateReservedSplit(r.id, 'beneficiary', e.target.value)} placeholder="0x..." className={`${smallInputClass} font-mono flex-1`} />
                        <input type="number" min="0" max="100" value={r.value} onChange={e => updateReservedSplit(r.id, 'value', e.target.value)} placeholder="%" className={`${smallInputClass} w-16`} />
                        <button onClick={() => removeReservedSplit(r.id)} className={`text-xs px-2 py-0.5 ${isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'}`}>×</button>
                      </div>
                    ))}
                  </div>
                  <p className={`mt-1 text-[10px] ${reservedSum > 100 ? 'text-red-400' : isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {reservedSum > 100 ? `Recipients sum to ${reservedSum}% — must be ≤ 100%` : `Recipients sum: ${reservedSum}% of reserved pool (remainder → owner)`}
                  </p>
                </div>
              )}
            </div>

            {/* Cash-out curve */}
            <div className={cardClass}>
              <label className={labelClass}>Cash-out curve</label>
              <div className="flex gap-2 mb-2">
                {(['none', 'light', 'medium', 'heavy'] as const).map(p => (
                  <button key={p} onClick={() => update('cashOutPreset', p)} className={segButton(formState.cashOutPreset === p)}>
                    {p === 'none' ? 'No' : p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
                <button onClick={() => update('cashOutPreset', 'custom')} className={segButton(formState.cashOutPreset === 'custom')}>Custom</button>
              </div>
              {formState.cashOutPreset === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="number" min="0" max="90" step="0.01" value={formState.cashOutCustom} onChange={e => update('cashOutCustom', e.target.value)} placeholder="0" className={`${inputClass} flex-1`} />
                  <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>%</span>
                </div>
              )}
              <p className={`mt-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Higher rates reduce small partial exits. 0% is the proportional baseline.
              </p>
            </div>

            {/* Cycle duration */}
            <div className={cardClass}>
              <label className={labelClass}>Cycle duration</label>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map(d => (
                  <button
                    key={d.label}
                    onClick={() => update('durationDays', d.days)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      formState.durationDays === d.days
                        ? isDark ? 'bg-juice-orange/30 text-juice-orange' : 'bg-orange-100 text-orange-700'
                        : isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p className={`mt-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Flexible = no fixed cycles; the owner can reconfigure anytime.
              </p>
            </div>

            {/* Payouts */}
            <div className={cardClass}>
              <label className={labelClass}>Payouts</label>
              <div className="flex gap-2 mb-2">
                {(['none', 'limited', 'unlimited'] as const).map(t => (
                  <button key={t} onClick={() => update('payoutType', t)} className={segButton(formState.payoutType === t)}>
                    {t === 'none' ? 'None' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              {formState.payoutType === 'limited' && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Recipients + amount (ETH)</span>
                    <button onClick={addPayoutSplit} className={`text-xs px-2 py-1 ${isDark ? 'bg-juice-orange/20 text-juice-orange hover:bg-juice-orange/30' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>+ Add</button>
                  </div>
                  <div className="space-y-2">
                    {formState.payoutSplits.map(r => (
                      <div key={r.id} className="flex items-center gap-2">
                        <input value={r.beneficiary} onChange={e => updatePayoutSplit(r.id, 'beneficiary', e.target.value)} placeholder="0x..." className={`${smallInputClass} font-mono flex-1`} />
                        <input type="number" min="0" step="0.0001" value={r.value} onChange={e => updatePayoutSplit(r.id, 'value', e.target.value)} placeholder="ETH" className={`${smallInputClass} w-20`} />
                        <button onClick={() => removePayoutSplit(r.id)} className={`text-xs px-2 py-0.5 ${isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'}`}>×</button>
                      </div>
                    ))}
                  </div>
                  <p className={`mt-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    Payout limit = sum of amounts. Each recipient receives their share; remainder → owner.
                  </p>
                </div>
              )}
              {formState.payoutType === 'unlimited' && (
                <p className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Owner can pay out any amount to themselves. Add recipients later via splits.
                </p>
              )}
            </div>

            {/* Advanced */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={`w-full py-2 text-xs font-medium mb-3 transition-colors ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
            >
              {showAdvanced ? '- Hide' : '+ Show'} Advanced
            </button>

            {showAdvanced && (
              <>
                {/* Surplus allowance */}
                <div className={cardClass}>
                  <label className={labelClass}>Surplus allowance</label>
                  <div className="flex gap-2 mb-2">
                    {(['none', 'limited', 'unlimited'] as const).map(t => (
                      <button key={t} onClick={() => update('surplusAllowanceType', t)} className={segButton(formState.surplusAllowanceType === t)}>
                        {t === 'none' ? 'None' : t.charAt(0).toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                  {formState.surplusAllowanceType === 'limited' && (
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" step="0.01" value={formState.surplusAllowance} onChange={e => update('surplusAllowance', e.target.value)} placeholder="0" className={`${inputClass} flex-1`} />
                      <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>ETH</span>
                    </div>
                  )}
                </div>

                {/* Permissions */}
                <div className={cardClass}>
                  <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Permissions</div>
                  <div className="space-y-2">
                    {([
                      ['pausePay', 'Start with payments paused'],
                      ['allowOwnerMinting', 'Allow owner minting'],
                      ['ownerMustSendPayouts', 'Only owner can send payouts'],
                      ['holdFees', 'Hold fees (owner can unlock)'],
                      ['pauseCreditTransfers', 'Pause credit transfers'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formState[key] as boolean}
                          onChange={e => update(key, e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Approval deadline note */}
                <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Ruleset approval deadline</div>
                  <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    This project deploys with no reconfiguration delay, so approved owner changes can take effect immediately.
                  </p>
                </div>
              </>
            )}
          </>
        )}

        {/* ================= STEP: SHOP ================= */}
        {step === 'shop' && (
          <>
            <div className={cardClass}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formState.shopEnabled} onChange={e => update('shopEnabled', e.target.checked)} className="w-4 h-4" />
                <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Launch with items (NFT tiers)</span>
              </label>
            </div>

            {formState.shopEnabled && (
              <>
                {/* Atomic deploy notice */}
                <div className={`p-3 mb-3 ${isDark ? 'bg-juice-orange/10' : 'bg-orange-50'}`}>
                  <div className={`text-xs font-medium ${isDark ? 'text-juice-orange' : 'text-orange-700'}`}>Items deploy with your project</div>
                  <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    These items are deployed with the project, so there is no separate setup transaction.
                  </p>
                </div>

                <div className={cardClass}>
                  <div className="flex items-center justify-between mb-3">
                    <div className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Items ({formState.tiers.length})</div>
                    <button onClick={addTier} className={`text-xs px-2 py-1 ${isDark ? 'bg-juice-orange/20 text-juice-orange hover:bg-juice-orange/30' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>+ Add Item</button>
                  </div>

                  <div className="space-y-4">
                    {formState.tiers.map((t, i) => (
                      <div key={t.id} className={`p-3 border ${isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'}`}>
                        <div className="flex items-center justify-between mb-3">
                          <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Item {i + 1}</span>
                          <button onClick={() => removeTier(t.id)} className={`text-xs px-2 py-0.5 ${isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'}`}>Remove</button>
                        </div>
                        <div className="space-y-2">
                          <input value={t.name} onChange={e => updateTier(t.id, { name: e.target.value })} placeholder="Item name" className={smallInputClass} />
                          <textarea value={t.description} onChange={e => updateTier(t.id, { description: e.target.value })} placeholder="Description (optional)" rows={2} className={`${smallInputClass} resize-none`} />
                          <input value={t.imageUrl} onChange={e => updateTier(t.id, { imageUrl: e.target.value })} placeholder="Image URL (https:// or ipfs://)" className={smallInputClass} />
                          <div className="grid grid-cols-2 gap-2">
                            <input value={t.animationUrl} onChange={e => updateTier(t.id, { animationUrl: e.target.value })} placeholder="Audio or video URL" className={smallInputClass} />
                            <input value={t.mediaType} onChange={e => updateTier(t.id, { mediaType: e.target.value })} placeholder="Media type" className={smallInputClass} />
                          </div>
                          <input value={t.categoryName} onChange={e => updateTier(t.id, { categoryName: e.target.value })} placeholder="Category (optional)" className={smallInputClass} />
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Price (ETH)</label>
                              <input type="number" min="0" step="0.0001" value={t.price} onChange={e => updateTier(t.id, { price: e.target.value })} placeholder="0.01" className={smallInputClass} />
                            </div>
                            <div>
                              <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Supply</label>
                              {t.unlimited ? (
                                <div className={`px-2 py-1.5 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Unlimited</div>
                              ) : (
                                <input type="number" min="1" value={t.supply} onChange={e => updateTier(t.id, { supply: e.target.value })} placeholder="100" className={smallInputClass} />
                              )}
                            </div>
                          </div>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={t.unlimited} onChange={e => updateTier(t.id, { unlimited: e.target.checked })} className="w-4 h-4" />
                            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Unlimited supply</span>
                          </label>
                        </div>
                      </div>
                    ))}
                    {formState.tiers.length === 0 && (
                      <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No items yet. Add one to configure your shop.</p>
                    )}
                  </div>
                </div>
                {limitedTierOnMultipleChains && (
                  <div className={`p-3 mb-3 border-l-4 ${isDark ? 'bg-red-500/10 border-red-500 text-red-300' : 'bg-red-50 border-red-500 text-red-700'}`}>
                    <p className="text-xs font-medium">Limited inventory needs one chain</p>
                    <p className="text-[10px] mt-1">
                      A limited supply is created separately on each chain. Select one chain so the quantity shown is the total quantity available.
                    </p>
                  </div>
                )}
              </>
            )}

            {!formState.shopEnabled && (
              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Skip this to launch without a shop hook.
              </p>
            )}
          </>
        )}

        {/* ================= STEP: DEPLOY ================= */}
        {step === 'deploy' && (
          <>
            {selectedChains.length > 1 && (
              <div className={`p-3 mb-3 ${isDark ? 'bg-juice-orange/10' : 'bg-orange-50'}`}>
                <div className={`text-xs font-medium ${isDark ? 'text-juice-orange' : 'text-orange-700'}`}>Synchronized Start Time</div>
                <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>{startDate.toLocaleString()}</div>
                <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>All chains activate at the same time</div>
              </div>
            )}

            {/* Review summary */}
            <div className={cardClass}>
              <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Review</div>
              <div className="space-y-2 text-sm">
                <SummaryRow isDark={isDark} label="Name" value={formState.name || '—'} />
                <SummaryRow isDark={isDark} label="Ticker" value={formState.symbol ? `$${formState.symbol}` : '—'} />
                <SummaryRow isDark={isDark} label="Chains" value={selectedChains.map(c => CHAINS[c]?.shortName || c).join(', ')} />
                {flavor === 'revnet' ? (
                  <>
                    <SummaryRow isDark={isDark} label="Stages" value={`${stages.length}`} />
                    <SummaryRow isDark={isDark} label="Operator" value={operatorAddress ? `${operatorAddress.slice(0, 6)}...${operatorAddress.slice(-4)}` : '—'} />
                    <SummaryRow isDark={isDark} label="Suckers" value={autoDeploySuckers ? 'Auto-deploy' : 'None'} />
                  </>
                ) : (
                  <>
                    <SummaryRow isDark={isDark} label="Issuance" value={`${formState.weight} / ETH`} />
                    <SummaryRow isDark={isDark} label="Reserved" value={`${formState.reservedPercent || 0}%`} />
                    <SummaryRow isDark={isDark} label="Cash-out tax" value={`${resolveCashOutPercent(formState)}%`} />
                    <SummaryRow isDark={isDark} label="Cycle" value={formState.durationDays === 0 ? 'Flexible' : `${formState.durationDays} day${formState.durationDays === 1 ? '' : 's'}`} />
                    <SummaryRow isDark={isDark} label="Payouts" value={formState.payoutType} />
                    {activeTierCount > 0 && (
                      <SummaryRow isDark={isDark} label="Shop items" value={`${activeTierCount} (deploy with project)`} />
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Owner / Operator */}
            <div className={cardClass}>
              <div className={labelClass}>{flavor === 'revnet' ? 'Revnet Operator' : 'Project Owner'}</div>
              <div className={`text-sm font-mono ${(flavor === 'revnet' ? operatorAddress : ownerAddress) ? (isDark ? 'text-white' : 'text-gray-900') : 'text-red-400'}`}>
                {(flavor === 'revnet' ? operatorAddress : ownerAddress)
                  ? `${(flavor === 'revnet' ? operatorAddress : ownerAddress).slice(0, 8)}...${(flavor === 'revnet' ? operatorAddress : ownerAddress).slice(-6)}`
                  : 'Connect a wallet to continue'}
              </div>
            </div>

            {/* Memo (custom only) */}
            {flavor === 'custom' && (
              <div className={cardClass}>
                <label className={labelClass}>Creation memo (optional)</label>
                <input type="text" value={formState.memo} onChange={e => update('memo', e.target.value)} placeholder="Launching my project..." className={inputClass} />
              </div>
            )}

            {/* Gas sponsorship */}
            <div className={`p-3 mb-4 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
              <div className={`text-xs font-medium ${isDark ? 'text-green-400' : 'text-green-700'}`}>Gas Sponsored</div>
              <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Gas is sponsored. The exact protocol creation fee is shown before deployment.
              </div>
            </div>

            <button
              onClick={handleDeploy}
              disabled={!isValid || buildingTiers}
              className={`w-full py-3 text-sm font-bold transition-colors ${
                !isValid || buildingTiers
                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                  : flavor === 'revnet'
                    ? 'bg-purple-500 hover:bg-purple-600 text-white'
                    : 'bg-juice-orange hover:bg-juice-orange/90 text-black'
              }`}
            >
              {buildingTiers
                ? 'Preparing metadata...'
                : flavor === 'revnet'
                  ? !isManagedMode
                    ? 'Sign in to deploy'
                    : `Deploy Revnet${selectedChains.length > 1 ? ` on ${selectedChains.length} Chains` : ''}`
                  : !isConnected && !isManagedMode
                    ? 'Connect wallet to create'
                    : `Create Project${selectedChains.length > 1 ? ` on ${selectedChains.length} Chains` : ''}`}
            </button>
            {preparationError && (
              <p className={`mt-2 text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                {preparationError}
              </p>
            )}
          </>
        )}

        {/* Nav buttons */}
        <div className="flex gap-3 mt-4">
          <button
            onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)].id)}
            disabled={stepIndex === 0}
            className={`flex-1 py-2.5 text-sm font-medium border-2 transition-colors ${
              stepIndex === 0
                ? 'opacity-40 cursor-not-allowed border-gray-500/30 text-gray-500'
                : isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Back
          </button>
          {step !== 'deploy' && (
            <button
              onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)].id)}
              disabled={step === 'basics' && !basicsValid}
              className={`flex-1 py-2.5 text-sm font-bold transition-colors ${
                step === 'basics' && !basicsValid
                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                  : 'bg-juice-orange hover:bg-juice-orange/90 text-black'
              }`}
            >
              Next
            </button>
          )}
        </div>
      </div>

      {/* Custom flavor → LaunchProjectModal (with optional 721 tiers hook) */}
      <LaunchProjectModal
        isOpen={showModal && flavor === 'custom'}
        onClose={() => setShowModal(false)}
        projectName={formState.name}
        owner={ownerAddress}
        projectUri={preparedProjectUri}
        chainIds={selectedChains}
        rulesetConfig={rulesetConfig}
        terminalConfigurations={terminalConfigurations}
        synchronizedStartTime={synchronizedStartTime}
        memo={formState.memo}
        deployTiersHookConfig={deployTiersConfig}
      />

      {/* Revnet flavor → DeployRevnetModal */}
      <DeployRevnetModal
        isOpen={showModal && flavor === 'revnet'}
        onClose={() => setShowModal(false)}
        name={formState.name}
        ticker={formState.symbol}
        tagline={formState.tagline}
        projectUri={preparedProjectUri}
        splitOperator={operatorAddress}
        chainIds={selectedChains}
        stageConfigurations={stageConfigurations}
        autoDeploySuckers={autoDeploySuckers}
        deployTiersHookConfig={deployTiersConfig}
      />
    </div>
  )
}

function SummaryRow({ isDark, label, value }: { isDark: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{label}</span>
      <span className={`text-xs font-mono text-right ${isDark ? 'text-white' : 'text-gray-900'}`}>{value}</span>
    </div>
  )
}
