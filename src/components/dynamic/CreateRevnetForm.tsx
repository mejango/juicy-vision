import { useState, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { parseEther } from 'viem'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import { calculateSynchronizedStartTime, type REVStageConfig } from '../../services/relayr'
import { DeployRevnetModal } from '../payment'
import { ALL_CHAIN_IDS, CHAINS } from '../../constants'

interface CreateRevnetFormProps {
  defaultOperator?: string
  defaultChainIds?: number[]
}

// Single stage configuration in form
interface StageFormState {
  id: string
  startsAtOrAfter: string      // Relative days from previous stage (or absolute for first)
  splitPercent: string         // 0-100 (to operator)
  initialIssuance: string      // Tokens per ETH
  decayFrequency: string       // Days between decay
  decayPercent: string         // 0-100 decay per frequency
  cashOutTaxRate: string       // 0-100
}

// Main form state
interface RevnetFormState {
  name: string
  tagline: string
  splitOperator: string
  autoDeploySuckers: boolean
}

const DEFAULT_STAGE: Omit<StageFormState, 'id'> = {
  startsAtOrAfter: '0',
  splitPercent: '20',
  initialIssuance: '1000000',
  decayFrequency: '7',
  decayPercent: '5',
  cashOutTaxRate: '10',
}

const DEFAULT_FORM_STATE: RevnetFormState = {
  name: '',
  tagline: '',
  splitOperator: '',
  autoDeploySuckers: true,
}

// Generate unique ID for stages
function generateStageId(): string {
  return `stage-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Create default first stage
function createDefaultStage(): StageFormState {
  return {
    ...DEFAULT_STAGE,
    id: generateStageId(),
  }
}

/**
 * Convert form stage to REVStageConfig for contract call
 */
function stageFormToConfig(
  stage: StageFormState,
  previousEndTime: number,
  isFirst: boolean
): REVStageConfig {
  // For first stage, use synchronized start time
  // For subsequent stages, calculate from previous + days offset
  let startsAtOrAfter: number
  if (isFirst) {
    const daysOffset = parseFloat(stage.startsAtOrAfter) || 0
    startsAtOrAfter = previousEndTime + Math.floor(daysOffset * 24 * 60 * 60)
  } else {
    const daysOffset = parseFloat(stage.startsAtOrAfter) || 0
    startsAtOrAfter = previousEndTime + Math.floor(daysOffset * 24 * 60 * 60)
  }

  // Convert split percent (0-100) to protocol scale (0-1000000000)
  const splitPercent = Math.floor((parseFloat(stage.splitPercent) || 0) * 10000000)

  // Convert issuance to wei (18 decimals)
  const initialIssuance = parseEther(stage.initialIssuance || '1000000').toString()

  // Convert decay frequency from days to seconds
  const decayDays = parseFloat(stage.decayFrequency) || 7
  const issuanceDecayFrequency = Math.floor(decayDays * 24 * 60 * 60)

  // Convert decay percent (0-100) to protocol scale (0-1000000000)
  const issuanceDecayPercent = Math.floor((parseFloat(stage.decayPercent) || 0) * 10000000)

  // Convert cash out tax (0-100) to protocol scale (0-10000)
  const cashOutTaxRate = Math.floor((parseFloat(stage.cashOutTaxRate) || 0) * 100)

  return {
    startsAtOrAfter,
    splitPercent,
    initialIssuance,
    issuanceDecayFrequency,
    issuanceDecayPercent,
    cashOutTaxRate,
    extraMetadata: 0,
  }
}

export default function CreateRevnetForm({ defaultOperator, defaultChainIds }: CreateRevnetFormProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  const { address, isConnected } = useAccount()
  const { address: managedAddress } = useManagedWallet()

  const [formState, setFormState] = useState<RevnetFormState>({
    ...DEFAULT_FORM_STATE,
    splitOperator: defaultOperator || '',
  })
  const [stages, setStages] = useState<StageFormState[]>([createDefaultStage()])
  const [selectedChains, setSelectedChains] = useState<number[]>(
    defaultChainIds || [...ALL_CHAIN_IDS]
  )
  const [showModal, setShowModal] = useState(false)

  // Get operator address - use managed wallet if in managed mode and not specified
  const operatorAddress = formState.splitOperator ||
    (isManagedMode ? managedAddress : address) || ''

  // Calculate synchronized start time for omnichain deployment
  const synchronizedStartTime = calculateSynchronizedStartTime()
  const startDate = new Date(synchronizedStartTime * 1000)

  // Validation
  const isValid = formState.name.trim().length > 0 &&
    selectedChains.length > 0 &&
    operatorAddress &&
    stages.length > 0

  const updateFormState = useCallback((key: keyof RevnetFormState, value: string | boolean) => {
    setFormState(prev => ({ ...prev, [key]: value }))
  }, [])

  const updateStage = useCallback((stageId: string, key: keyof StageFormState, value: string) => {
    setStages(prev => prev.map(stage =>
      stage.id === stageId ? { ...stage, [key]: value } : stage
    ))
  }, [])

  const addStage = useCallback(() => {
    setStages(prev => [...prev, {
      ...DEFAULT_STAGE,
      id: generateStageId(),
      startsAtOrAfter: '30', // Default 30 days after previous stage
    }])
  }, [])

  const removeStage = useCallback((stageId: string) => {
    setStages(prev => {
      if (prev.length <= 1) return prev // Keep at least one stage
      return prev.filter(stage => stage.id !== stageId)
    })
  }, [])

  const toggleChain = useCallback((chainId: number) => {
    setSelectedChains(prev =>
      prev.includes(chainId)
        ? prev.filter(id => id !== chainId)
        : [...prev, chainId]
    )
  }, [])

  const handleDeploy = useCallback(() => {
    if (!isValid) return

    if (!isConnected && !isManagedMode) {
      window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
      return
    }

    setShowModal(true)
  }, [isValid, isConnected, isManagedMode])

  // Build stage configurations for modal
  const stageConfigurations: REVStageConfig[] = stages.map((stage, index) =>
    stageFormToConfig(
      stage,
      index === 0 ? synchronizedStartTime : 0,
      index === 0
    )
  )

  return (
    <div className="w-full">
      <div className={`max-w-lg border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-14 h-14 flex items-center justify-center text-2xl ${
            isDark ? 'bg-purple-500/20' : 'bg-purple-100'
          }`}>
            🌀
          </div>
          <div>
            <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Deploy Revnet
            </h3>
            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Stage-based revenue network on {selectedChains.length} chain{selectedChains.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Chain Selection */}
        <div className={`p-3 mb-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            Deploy on chains:
          </div>
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
                      ? isDark
                        ? 'bg-purple-500/30 text-purple-400 border border-purple-500/50'
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
                  {chain?.shortName || chainId}
                </button>
              )
            })}
          </div>
        </div>

        {/* Synchronized Start Time */}
        {selectedChains.length > 1 && (
          <div className={`p-3 mb-4 ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
            <div className={`text-xs font-medium ${isDark ? 'text-purple-400' : 'text-purple-700'}`}>
              Synchronized Start Time
            </div>
            <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {startDate.toLocaleString()}
            </div>
            <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              All chains activate at the same time
            </div>
          </div>
        )}

        {/* Revnet Info */}
        <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            Revnet Info
          </div>

          <div className="space-y-3">
            <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Name *
              </label>
              <input
                type="text"
                value={formState.name}
                onChange={(e) => updateFormState('name', e.target.value)}
                placeholder="My Revnet"
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
            </div>

            <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Tagline
              </label>
              <input
                type="text"
                value={formState.tagline}
                onChange={(e) => updateFormState('tagline', e.target.value)}
                placeholder="A revenue network for..."
                className={`w-full px-3 py-2 text-sm outline-none ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
            </div>

            <div>
              <label className={`block text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Split Operator Address
              </label>
              <input
                type="text"
                value={formState.splitOperator}
                onChange={(e) => updateFormState('splitOperator', e.target.value)}
                placeholder={operatorAddress || '0x...'}
                className={`w-full px-3 py-2 text-sm font-mono outline-none ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                }`}
              />
              <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Receives operator split from each stage
              </span>
            </div>
          </div>
        </div>

        {/* Stages */}
        <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Stages ({stages.length})
            </div>
            <button
              onClick={addStage}
              className={`text-xs px-2 py-1 transition-colors ${
                isDark
                  ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                  : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
              }`}
            >
              + Add Stage
            </button>
          </div>

          <div className="space-y-4">
            {stages.map((stage, index) => (
              <div
                key={stage.id}
                className={`p-3 border ${
                  isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    Stage {index + 1}
                  </span>
                  {stages.length > 1 && (
                    <button
                      onClick={() => removeStage(stage.id)}
                      className={`text-xs px-2 py-0.5 transition-colors ${
                        isDark
                          ? 'text-red-400 hover:bg-red-500/10'
                          : 'text-red-600 hover:bg-red-50'
                      }`}
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Start Offset */}
                  <div>
                    <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {index === 0 ? 'Delay (days)' : 'Days after prev'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={stage.startsAtOrAfter}
                      onChange={(e) => updateStage(stage.id, 'startsAtOrAfter', e.target.value)}
                      className={`w-full px-2 py-1.5 text-xs outline-none ${
                        isDark
                          ? 'bg-white/5 border border-white/10 text-white'
                          : 'bg-gray-50 border border-gray-200 text-gray-900'
                      }`}
                    />
                  </div>

                  {/* Split Percent */}
                  <div>
                    <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Operator Split (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={stage.splitPercent}
                      onChange={(e) => updateStage(stage.id, 'splitPercent', e.target.value)}
                      className={`w-full px-2 py-1.5 text-xs outline-none ${
                        isDark
                          ? 'bg-white/5 border border-white/10 text-white'
                          : 'bg-gray-50 border border-gray-200 text-gray-900'
                      }`}
                    />
                  </div>

                  {/* Initial Issuance */}
                  <div>
                    <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Issuance Rate
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={stage.initialIssuance}
                      onChange={(e) => updateStage(stage.id, 'initialIssuance', e.target.value)}
                      className={`w-full px-2 py-1.5 text-xs outline-none ${
                        isDark
                          ? 'bg-white/5 border border-white/10 text-white'
                          : 'bg-gray-50 border border-gray-200 text-gray-900'
                      }`}
                    />
                    <span className={`text-[9px] ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                      Tokens/ETH
                    </span>
                  </div>

                  {/* Decay Frequency */}
                  <div>
                    <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Decay Every (days)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={stage.decayFrequency}
                      onChange={(e) => updateStage(stage.id, 'decayFrequency', e.target.value)}
                      className={`w-full px-2 py-1.5 text-xs outline-none ${
                        isDark
                          ? 'bg-white/5 border border-white/10 text-white'
                          : 'bg-gray-50 border border-gray-200 text-gray-900'
                      }`}
                    />
                  </div>

                  {/* Decay Percent */}
                  <div>
                    <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Decay (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={stage.decayPercent}
                      onChange={(e) => updateStage(stage.id, 'decayPercent', e.target.value)}
                      className={`w-full px-2 py-1.5 text-xs outline-none ${
                        isDark
                          ? 'bg-white/5 border border-white/10 text-white'
                          : 'bg-gray-50 border border-gray-200 text-gray-900'
                      }`}
                    />
                  </div>

                  {/* Cash Out Tax */}
                  <div>
                    <label className={`block text-[10px] mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Exit Tax (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={stage.cashOutTaxRate}
                      onChange={(e) => updateStage(stage.id, 'cashOutTaxRate', e.target.value)}
                      className={`w-full px-2 py-1.5 text-xs outline-none ${
                        isDark
                          ? 'bg-white/5 border border-white/10 text-white'
                          : 'bg-gray-50 border border-gray-200 text-gray-900'
                      }`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sucker Configuration */}
        <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formState.autoDeploySuckers}
              onChange={(e) => updateFormState('autoDeploySuckers', e.target.checked)}
              className="w-4 h-4"
            />
            <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Auto-deploy suckers for cross-chain token bridging
            </span>
          </label>
          <p className={`mt-1 ml-6 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Suckers enable $TOKEN bridging between chains. Recommended for multi-chain revnets.
          </p>
        </div>

        {/* Gas Sponsorship Notice */}
        <div className={`p-3 mb-4 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
          <div className={`text-xs font-medium ${isDark ? 'text-green-400' : 'text-green-700'}`}>
            Gas Sponsored
          </div>
          <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Revnet deployment is free - gas is sponsored by the platform
          </div>
        </div>

        {/* Deploy Button */}
        <button
          onClick={handleDeploy}
          disabled={!isValid}
          className={`w-full py-3 text-sm font-bold transition-colors ${
            isValid
              ? 'bg-purple-500 hover:bg-purple-600 text-white'
              : 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
          }`}
        >
          Deploy Revnet{selectedChains.length > 1 ? ` on ${selectedChains.length} Chains` : ''}
        </button>

        {/* Info */}
        <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Revnets use automated stage-based issuance decay. Once deployed, stage configurations cannot be changed.
        </p>
      </div>

      {/* Deploy Modal */}
      <DeployRevnetModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        name={formState.name}
        tagline={formState.tagline}
        splitOperator={operatorAddress}
        chainIds={selectedChains}
        stageConfigurations={stageConfigurations}
        autoDeploySuckers={formState.autoDeploySuckers}
      />
    </div>
  )
}
