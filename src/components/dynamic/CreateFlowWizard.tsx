import { useState, useCallback, useMemo } from 'react'
import { useAccount } from 'wagmi'
import { parseEther } from 'viem'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import {
  calculateSynchronizedStartTime,
  type JBRulesetConfig,
  type JBTerminalConfig,
} from '../../services/relayr'
import { LaunchProjectModal } from '../payment'
import { JB_CONTRACTS, ZERO_ADDRESS, NATIVE_TOKEN, ALL_CHAIN_IDS, CHAINS } from '../../constants'

// ============================================================================
// Types
// ============================================================================

interface CreateFlowWizardProps {
  defaultOwner?: string
  // mapProps forwards all-string props, so chainIds may arrive as "1,10,8453,42161"
  defaultChainIds?: number[] | string
}

/** Normalize the defaultChainIds prop (number[] or comma-separated string) to a valid chain-id list. */
function normalizeChainIds(input: number[] | string | undefined): number[] {
  if (Array.isArray(input) && input.length > 0) {
    const filtered = input.filter(id => (ALL_CHAIN_IDS as readonly number[]).includes(id))
    return filtered.length > 0 ? filtered : [...ALL_CHAIN_IDS]
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    const parsed = input
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(id => Number.isFinite(id) && (ALL_CHAIN_IDS as readonly number[]).includes(id))
    if (parsed.length > 0) return parsed
  }
  return [...ALL_CHAIN_IDS]
}

type StepId = 'basics' | 'ruleset' | 'shop' | 'deploy'

const STEPS: { id: StepId; label: string }[] = [
  { id: 'basics', label: 'Basics' },
  { id: 'ruleset', label: 'Ruleset' },
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
  imageUrl: string
  price: string // in accounting currency (ETH)
  unlimited: boolean
  supply: string
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
  return /^0x[0-9a-fA-F]{40}$/.test(v.trim())
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
      payoutLimits.push({ amount: parseEther(String(total)).toString(), currency: 1 })
    }
  } else if (state.payoutType === 'unlimited') {
    payoutLimits.push({ amount: UINT224_MAX, currency: 1 })
  }

  if (state.surplusAllowanceType === 'limited') {
    surplusAllowances.push({ amount: parseEther(state.surplusAllowance || '0').toString(), currency: 1 })
  } else if (state.surplusAllowanceType === 'unlimited') {
    surplusAllowances.push({ amount: UINT224_MAX, currency: 1 })
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

function buildTerminalConfigurations(): JBTerminalConfig[] {
  return [{
    terminal: JB_CONTRACTS.JBMultiTerminal,
    accountingContextsToAccept: [{
      token: NATIVE_TOKEN,
      decimals: 18,
      currency: 1, // ETH
    }],
  }]
}

// ============================================================================
// Component
// ============================================================================

export default function CreateFlowWizard({ defaultOwner, defaultChainIds }: CreateFlowWizardProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  const { address, isConnected } = useAccount()
  const { address: managedAddress } = useManagedWallet()

  const [step, setStep] = useState<StepId>('basics')
  const [formState, setFormState] = useState<WizardFormState>(DEFAULT_FORM_STATE)
  const [selectedChains, setSelectedChains] = useState<number[]>(() => normalizeChainIds(defaultChainIds))
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const ownerAddress = defaultOwner || (isManagedMode ? managedAddress : address) || ''

  const synchronizedStartTime = calculateSynchronizedStartTime()
  const startDate = new Date(synchronizedStartTime * 1000)

  const stepIndex = STEPS.findIndex(s => s.id === step)

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
      tiers: [...prev.tiers, { id: genId('tier'), name: '', imageUrl: '', price: '', unlimited: true, supply: '' }],
    }))
  const removeTier = (id: string) =>
    setFormState(prev => ({ ...prev, tiers: prev.tiers.filter(t => t.id !== id) }))
  const updateTier = (id: string, patch: Partial<TierRow>) =>
    setFormState(prev => ({ ...prev, tiers: prev.tiers.map(t => t.id === id ? { ...t, ...patch } : t) }))

  // --- validation ---
  const reservedSum = useMemo(
    () => formState.reservedSplits.reduce((a, r) => a + (parseFloat(r.value) || 0), 0),
    [formState.reservedSplits]
  )
  const reservedSplitsValid = reservedSum <= 100 &&
    formState.reservedSplits.every(r => (!r.beneficiary && !r.value) || isValidAddress(r.beneficiary))

  const payoutSplitsValid = formState.payoutType !== 'limited' ||
    formState.payoutSplits.every(r => (!r.beneficiary && !r.value) || (isValidAddress(r.beneficiary) && parseFloat(r.value) > 0))

  const basicsValid = formState.name.trim().length > 0 && selectedChains.length > 0
  const isValid = basicsValid && !!ownerAddress && reservedSplitsValid && payoutSplitsValid

  // --- build configs ---
  const rulesetConfig = useMemo(
    () => buildRulesetConfig(formState, synchronizedStartTime),
    [formState, synchronizedStartTime]
  )
  const terminalConfigurations = useMemo(() => buildTerminalConfigurations(), [])

  const projectUri = useMemo(
    () => JSON.stringify({
      name: formState.name,
      description: formState.description,
      tagline: formState.tagline,
      logoUri: formState.logoUrl,
      // TODO: pin metadata to IPFS and pass the CID instead of inline JSON (matches CreateProjectForm v1).
    }),
    [formState.name, formState.description, formState.tagline, formState.logoUrl]
  )

  const handleDeploy = useCallback(() => {
    if (!isValid) return
    if (!isConnected && !isManagedMode) {
      window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
      return
    }
    setShowModal(true)
  }, [isValid, isConnected, isManagedMode])

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

  const activeTierCount = formState.shopEnabled ? formState.tiers.length : 0

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="w-full">
      <div className={`max-w-lg border p-4 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-14 h-14 flex items-center justify-center text-2xl ${isDark ? 'bg-juice-orange/20' : 'bg-orange-100'}`}>
            +
          </div>
          <div>
            <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Create a Project</h3>
            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              V6 · omnichain · {selectedChains.length} chain{selectedChains.length !== 1 ? 's' : ''}
            </p>
          </div>
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
                  <label className={labelClass}>Token Ticker</label>
                  <input
                    type="text"
                    value={formState.symbol}
                    onChange={e => update('symbol', e.target.value.toUpperCase().slice(0, 11))}
                    placeholder="TOKEN"
                    className={`${inputClass} font-mono uppercase`}
                  />
                  <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Up to 11 characters</span>
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

            {/* Cash-out tax */}
            <div className={cardClass}>
              <label className={labelClass}>Cash-out tax</label>
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
                Higher tax = more value stays in the project on cash-out. 0% = full refund.
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
                    JBDeadline approval-hook addresses are not configured in this build, so the project deploys with no
                    reconfiguration delay (changes take effect immediately). Add a deadline hook later via Queue Ruleset.
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
                {/* Deploy-path gate notice */}
                <div className={`p-3 mb-3 ${isDark ? 'bg-amber-500/10' : 'bg-amber-50'}`}>
                  <div className={`text-xs font-medium ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>Items deploy separately (coming soon)</div>
                  <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Launching a brand-new project together with NFT items in a single omnichain transaction is not yet
                    wired up. Your base project deploys now; add these items afterward from Manage Tiers. Configure them
                    here so they are ready.
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
                          <input value={t.imageUrl} onChange={e => updateTier(t.id, { imageUrl: e.target.value })} placeholder="Image URL (https:// or ipfs://)" className={smallInputClass} />
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
              </>
            )}

            {!formState.shopEnabled && (
              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Skip this to launch a token-only project. You can add a shop later.
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
                <SummaryRow isDark={isDark} label="Issuance" value={`${formState.weight} / ETH`} />
                <SummaryRow isDark={isDark} label="Reserved" value={`${formState.reservedPercent || 0}%`} />
                <SummaryRow isDark={isDark} label="Cash-out tax" value={`${resolveCashOutPercent(formState)}%`} />
                <SummaryRow isDark={isDark} label="Cycle" value={formState.durationDays === 0 ? 'Flexible' : `${formState.durationDays} day${formState.durationDays === 1 ? '' : 's'}`} />
                <SummaryRow isDark={isDark} label="Payouts" value={formState.payoutType} />
                {activeTierCount > 0 && (
                  <SummaryRow isDark={isDark} label="Shop items" value={`${activeTierCount} (deploy separately)`} />
                )}
              </div>
            </div>

            {/* Owner */}
            <div className={cardClass}>
              <div className={labelClass}>Project Owner</div>
              <div className={`text-sm font-mono ${ownerAddress ? (isDark ? 'text-white' : 'text-gray-900') : 'text-red-400'}`}>
                {ownerAddress ? `${ownerAddress.slice(0, 8)}...${ownerAddress.slice(-6)}` : 'Connect a wallet to continue'}
              </div>
            </div>

            {/* Memo */}
            <div className={cardClass}>
              <label className={labelClass}>Creation memo (optional)</label>
              <input type="text" value={formState.memo} onChange={e => update('memo', e.target.value)} placeholder="Launching my project..." className={inputClass} />
            </div>

            {/* Gas sponsorship */}
            <div className={`p-3 mb-4 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
              <div className={`text-xs font-medium ${isDark ? 'text-green-400' : 'text-green-700'}`}>Gas Sponsored</div>
              <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Project creation is free — gas is sponsored by the platform</div>
            </div>

            <button
              onClick={handleDeploy}
              disabled={!isValid}
              className={`w-full py-3 text-sm font-bold transition-colors ${
                isValid ? 'bg-juice-orange hover:bg-juice-orange/90 text-black' : 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
              }`}
            >
              Create Project{selectedChains.length > 1 ? ` on ${selectedChains.length} Chains` : ''}
            </button>
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

      {/* Launch modal — reused as-is */}
      <LaunchProjectModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        projectName={formState.name}
        owner={ownerAddress}
        projectUri={projectUri}
        chainIds={selectedChains}
        rulesetConfig={rulesetConfig}
        terminalConfigurations={terminalConfigurations}
        synchronizedStartTime={synchronizedStartTime}
        memo={formState.memo}
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
