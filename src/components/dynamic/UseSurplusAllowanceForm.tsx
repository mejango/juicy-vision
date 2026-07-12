import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { formatUnits } from 'viem'
import { useThemeStore } from '../../stores'
import { useUseSurplusAllowanceFormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchProjectAccountingContexts,
  fetchProjectSplits,
  fetchProjectWithRuleset,
  type Project,
  type FundAccessLimits,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { UseSurplusAllowanceModal } from '../payment'
import { ProjectLink } from './ProjectLink'
import { useManagedWallet } from '../../hooks'
import { resolveProjectChains } from '../../utils/projectChains'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'

interface UseSurplusAllowanceFormProps {
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

// Per-chain surplus allowance data
interface ChainSurplusData {
  optionKey: string
  chainId: number
  projectId: number
  accountingToken: `0x${string}` | null
  accountingCurrency: number | null
  tokenDecimals: number
  tokenSymbol: 'ETH' | 'USDC' | null
  fundAccessLimits: FundAccessLimits | null
  surplusAllowance: bigint
  usedSurplusAllowance: bigint
  isUnlimited: boolean
  configurationError?: string
}

// Inline chain selector component
function InlineChainSelector({
  chainData,
  selectedOptionKey,
  onSelect,
  isDark,
}: {
  chainData: ChainSurplusData[]
  selectedOptionKey: string | null
  onSelect: (optionKey: string) => void
  isDark: boolean
}) {
  if (chainData.length <= 1) return null

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {chainData.map(cd => {
        const chain = CHAIN_INFO[cd.chainId] || { name: `Chain ${cd.chainId}`, shortName: String(cd.chainId), color: '#888888' }
        const isSelected = selectedOptionKey === cd.optionKey
        const hasAllowance = cd.surplusAllowance > 0n || cd.isUnlimited
        return (
          <button
            key={cd.optionKey}
            onClick={() => onSelect(cd.optionKey)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium transition-colors ${
              isSelected
                ? isDark
                  ? 'bg-white/20 text-white'
                  : 'bg-gray-200 text-gray-900'
                : isDark
                  ? 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: chain.color }}
            />
            {chain.shortName} {cd.tokenSymbol || 'Unavailable'}
            {hasAllowance && (
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" title="Has surplus allowance" />
            )}
          </button>
        )
      })}
    </div>
  )
}

// Helper to check if unlimited
const isUnlimitedValue = (amount: bigint | undefined): boolean => {
  if (!amount) return false
  return amount === (1n << 224n) - 1n
}

export default function UseSurplusAllowanceForm({ projectId, chainId = '1', messageId }: UseSurplusAllowanceFormProps) {
  // Persistent state (visible to all chat users)
  const { state: persistedState, updateState: updatePersistedState } = useUseSurplusAllowanceFormState(messageId)

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [showModal, setShowModal] = useState(false)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const { isConnected } = useAccount()
  const { address: managedAddress, isManagedMode } = useManagedWallet()
  const hasActiveWallet = isManagedMode ? !!managedAddress : isConnected

  // Check if form should be locked due to active/completed transaction
  const isLocked = persistedState?.status === 'in_progress' || persistedState?.status === 'completed'

  // Restore state from persisted data on load
  useEffect(() => {
    if (persistedState && persistedState.status !== 'pending') {
      if (persistedState.amount) setAmount(persistedState.amount)
      if (persistedState.selectedChainId && persistedState.accountingToken) {
        setSelectedOptionKey(`${persistedState.selectedChainId}:${persistedState.accountingToken.toLowerCase()}`)
      }
    }
  }, [persistedState])

  // Transaction callbacks for persistence
  const handleConfirmed = useCallback((txHash: string) => {
    updatePersistedState({
      status: 'completed',
      txHash,
      confirmedAt: new Date().toISOString(),
    })
  }, [updatePersistedState])

  const handleSubmitted = useCallback((txHash: string) => {
    updatePersistedState({
      status: 'in_progress',
      txHash,
      submittedAt: new Date().toISOString(),
    })
  }, [updatePersistedState])

  const handleError = useCallback((error: string) => {
    updatePersistedState({
      status: 'failed',
      error,
    })
  }, [updatePersistedState])

  // Dispatch event to open wallet panel
  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  // Omnichain state
  const [chainSurplusData, setChainSurplusData] = useState<ChainSurplusData[]>([])
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [selectedOptionKey, setSelectedOptionKey] = useState<string>('')

  const isOmnichain = chainSurplusData.length > 1

  // Get active chain data
  const activeChainData = chainSurplusData.find(cd => cd.optionKey === selectedOptionKey) || chainSurplusData[0]
  const selectedChainId = activeChainData?.chainId ?? parseInt(chainId)
  const chainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO[1]
  const allowanceData = activeChainData?.fundAccessLimits?.surplusAllowances[0]
  const allowanceToken = activeChainData?.accountingToken
  const allowanceTokenDecimals = activeChainData?.tokenDecimals ?? 18
  const allowanceCurrency = allowanceData?.currency ?? activeChainData?.accountingCurrency ?? 0
  const currencyLabel = activeChainData?.tokenSymbol || 'units'
  const allowanceDecimals = allowanceTokenDecimals

  // Calculate available surplus
  const surplusAllowance = activeChainData?.surplusAllowance || 0n
  const usedSurplusAllowance = activeChainData?.usedSurplusAllowance || 0n
  const isUnlimited = activeChainData?.isUnlimited || false
  const currentSurplus = allowanceData
    ? parseFloat(formatUnits(BigInt(allowanceData.currentSurplus || '0'), allowanceDecimals))
    : 0

  // Compare values in the allowance's exact currency/decimals. The terminal
  // converts its live surplus into these same units onchain.
  const availableAllowance = isUnlimited
    ? currentSurplus
    : Math.min(
        parseFloat(formatUnits(surplusAllowance > usedSurplusAllowance ? surplusAllowance - usedSurplusAllowance : 0n, allowanceDecimals)),
        currentSurplus
      )

  const allowanceDisabled = !!activeChainData?.configurationError || (!isUnlimited && surplusAllowance === 0n)

  // Fetch data for all chains
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const primaryChainId = parseInt(chainId)

        // Fetch project and connected chains
        const [projectData, chainResolution] = await Promise.all([
          fetchProject(projectId, primaryChainId),
          resolveProjectChains(projectId, primaryChainId),
        ])
        setProject(projectData)
        setChainMappingAvailable(chainResolution.mappingAvailable)

        // Fetch surplus data from all chains in parallel
        const chainDataPromises = chainResolution.chains.map(async (chain): Promise<ChainSurplusData[]> => {
          try {
            const [chainProject, accountingContexts] = await Promise.all([
              fetchProjectWithRuleset(String(chain.projectId), chain.chainId),
              fetchProjectAccountingContexts(String(chain.projectId), chain.chainId),
            ])
            if (accountingContexts.length === 0) throw new Error('No recognized accounting context')

            let allowanceGroups: FundAccessLimits[] = []
            if (chainProject?.currentRuleset?.id) {
              const splitsData = await fetchProjectSplits(
                String(chain.projectId),
                chain.chainId,
                chainProject.currentRuleset.id
              )
              if (!splitsData.configurationComplete) {
                throw new Error('Surplus allowance configuration could not be verified')
              }
              allowanceGroups = (splitsData.fundAccessLimitGroups || [])
                .filter(group => group.surplusAllowances.length > 0)
              if (allowanceGroups.some(group => group.surplusAllowances.length > 1)) {
                throw new Error('Multiple surplus allowance denominations for one token are not supported')
              }
              const hasUnmatchedGroup = allowanceGroups.some(group => !accountingContexts.some(context =>
                group.terminal.toLowerCase() === context.terminal.toLowerCase() &&
                group.token.toLowerCase() === context.token.toLowerCase()
              ))
              if (hasUnmatchedGroup) {
                throw new Error('Surplus allowance accounting context is not recognized')
              }
            }

            return accountingContexts.map(context => {
              const fundAccessLimits = allowanceGroups.find(group =>
                group.terminal.toLowerCase() === context.terminal.toLowerCase() &&
                group.token.toLowerCase() === context.token.toLowerCase()
              ) || null
              const surplusAllowanceData = fundAccessLimits?.surplusAllowances[0]
              if (surplusAllowanceData && surplusAllowanceData.currency !== context.currency) {
                throw new Error('Surplus allowance currency conversion is not supported in this view')
              }
              const surplusAllowanceAmount = surplusAllowanceData
                ? BigInt(surplusAllowanceData.amount)
                : 0n

              return {
                optionKey: `${chain.chainId}:${context.token.toLowerCase()}`,
                chainId: chain.chainId,
                projectId: chain.projectId,
                accountingToken: context.token,
                accountingCurrency: context.currency,
                tokenDecimals: context.decimals,
                tokenSymbol: context.symbol,
                fundAccessLimits,
                surplusAllowance: surplusAllowanceAmount,
                usedSurplusAllowance: BigInt(surplusAllowanceData?.usedAmount || '0'),
                isUnlimited: isUnlimitedValue(surplusAllowanceAmount),
              } satisfies ChainSurplusData
            })
          } catch (err) {
            console.error(`Failed to fetch surplus data for chain ${chain.chainId}:`, err)
            return [{
              optionKey: `${chain.chainId}:error`,
              chainId: chain.chainId,
              projectId: chain.projectId,
              accountingToken: null,
              accountingCurrency: null,
              tokenDecimals: 18,
              tokenSymbol: null,
              fundAccessLimits: null,
              surplusAllowance: 0n,
              usedSurplusAllowance: 0n,
              isUnlimited: false,
              configurationError: err instanceof Error ? err.message : 'Surplus allowance configuration unavailable',
            }]
          }
        })

        const allChainData = (await Promise.all(chainDataPromises)).flat()
        setChainSurplusData(allChainData)

        setSelectedOptionKey(previous => {
          if (allChainData.some(data => data.optionKey === previous)) return previous
          return allChainData.find(data => data.chainId === primaryChainId && (data.surplusAllowance > 0n || data.isUnlimited))?.optionKey
            || allChainData.find(data => data.surplusAllowance > 0n || data.isUnlimited)?.optionKey
            || allChainData.find(data => data.chainId === primaryChainId)?.optionKey
            || allChainData[0]?.optionKey
            || ''
        })

      } catch (err) {
        console.error('Failed to load project:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainId])

  const amountNum = parseFloat(amount) || 0

  const handleUseSurplus = () => {
    if (
      !amount || amountNum <= 0 || amountNum > availableAllowance || isLocked ||
      !allowanceData || !allowanceToken
    ) return

    if (!hasActiveWallet) {
      openWalletPanel()
      return
    }

    // Save reviewed inputs without claiming a transaction exists yet.
    updatePersistedState({
      status: 'pending',
      amount,
      selectedChainId,
      accountingToken: allowanceToken,
      submittedAt: new Date().toISOString(),
    })

    setShowModal(true)
  }

  if (loading) {
    return (
      <div className="w-full">
        <div className={`max-w-md border p-4 animate-pulse ${
          isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
        }`}>
          <div className="h-6 bg-white/10 w-3/4 mb-3" />
          <div className="h-4 bg-white/10 w-1/2" />
        </div>
      </div>
    )
  }

  const logoUrl = project?.logoUri ? resolveIpfsUri(project.logoUri) : null

  return (
    <div className="w-full">
      <div className={`max-w-md border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          {logoUrl ? (
            <IpfsImage uri={project?.logoUri} alt={project?.name || 'Project'} className="w-14 h-14 object-cover" fallback={<div className="w-14 h-14 bg-purple-500/20" />} />
          ) : (
            <div className="w-14 h-14 bg-purple-500/20 flex items-center justify-center">
              <span className="text-2xl">💰</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Use Surplus Allowance
            </h3>
            <ProjectLink chainSlug={chainInfo.slug} projectId={String(activeChainData?.projectId ?? projectId)} className={`text-xs hover:underline ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}>
              {project?.name || `Project #${projectId}`}
            </ProjectLink>
          </div>
        </div>

        {/* Chain Selector for omnichain */}
        {isOmnichain && (
          <div className="mb-3">
            <div className={`text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Select chain:
            </div>
            <InlineChainSelector
              chainData={chainSurplusData}
              selectedOptionKey={selectedOptionKey}
              onSelect={setSelectedOptionKey}
              isDark={isDark}
            />
          </div>
        )}

        {/* Surplus Allowance Status */}
        <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex justify-between items-center mb-2">
            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Surplus Allowance
            </span>
            <span className={`text-xs font-mono ${
              allowanceDisabled ? 'text-amber-400' : isUnlimited ? 'text-emerald-400' : ''
            }`}>
              {allowanceDisabled
                ? 'None'
                : isUnlimited
                  ? 'Unlimited'
                  : `${parseFloat(formatUnits(surplusAllowance, allowanceDecimals)).toFixed(4)} ${currencyLabel}`
              }
            </span>
          </div>

          {!allowanceDisabled && !isUnlimited && (
            <>
              <div className="flex justify-between items-center mb-1">
                <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Used this cycle
                </span>
                <span className="text-xs font-mono">
                  {parseFloat(formatUnits(usedSurplusAllowance, allowanceDecimals)).toFixed(4)} {currencyLabel}
                </span>
              </div>
            </>
          )}

          <div className="flex justify-between items-center">
            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Current surplus
            </span>
            <span className="text-xs font-mono">
              {currentSurplus.toFixed(4)} {currencyLabel}
            </span>
          </div>

          <div className={`flex justify-between items-center mt-2 pt-2 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <span className={`text-xs font-medium ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
              Available to withdraw
            </span>
            <span className={`text-xs font-mono font-medium ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
              {availableAllowance.toFixed(4)} {currencyLabel}
            </span>
          </div>
        </div>

        {/* Form */}
        <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Amount to withdraw
            </div>
          </div>

          {/* Amount input */}
          <div className="flex gap-2">
            <div className={`flex-1 flex items-center ${
              isDark
                ? 'bg-juice-dark border border-white/10'
                : 'bg-white border border-gray-200'
            }`}>
              <input
                type="number"
                step="0.01"
                min="0"
                max={availableAllowance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                disabled={allowanceDisabled || availableAllowance <= 0 || isLocked}
                className={`flex-1 px-3 py-2 text-sm bg-transparent outline-none ${
                  isDark ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                } ${allowanceDisabled || availableAllowance <= 0 || isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
              <span className={`px-3 py-2 text-sm border-l ${
                isDark ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'
              }`}>
                {currencyLabel}
              </span>
            </div>
            <button
              onClick={handleUseSurplus}
              disabled={!amount || amountNum <= 0 || amountNum > availableAllowance || allowanceDisabled || availableAllowance <= 0 || isLocked}
              className={`px-5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                !amount || amountNum <= 0 || amountNum > availableAllowance || allowanceDisabled || availableAllowance <= 0 || isLocked
                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                  : 'bg-purple-500 hover:bg-purple-500/90 text-white'
              }`}
            >
              {persistedState?.status === 'completed' ? 'Used' : persistedState?.status === 'in_progress' ? 'Pending...' : 'Withdraw'}
            </button>
          </div>

          {/* Transaction status indicator */}
          {isLocked && (
            <div className={`mt-2 p-2 text-sm ${
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
                    <span>Funds withdrawn successfully!</span>
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
                  href={`${CHAIN_INFO[selectedChainId]?.slug ? `https://${CHAIN_INFO[selectedChainId].slug === 'eth' ? '' : CHAIN_INFO[selectedChainId].slug + '.'}etherscan.io` : 'https://etherscan.io'}/tx/${persistedState.txHash}`}
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

          {/* Quick amount options */}
          {!allowanceDisabled && availableAllowance > 0 && (
            <div className="flex gap-2 mt-2">
              {[0.25, 0.5, 0.75].map(fraction => {
                const val = (availableAllowance * fraction).toFixed(4)
                return (
                  <button
                    key={fraction}
                    onClick={() => setAmount(val)}
                    className={`flex-1 px-2 py-1 text-xs transition-colors ${
                      amount === val
                        ? isDark ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-900'
                        : isDark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-150'
                    }`}
                  >
                    {Math.round(fraction * 100)}%
                  </button>
                )
              })}
              <button
                onClick={() => setAmount(availableAllowance.toFixed(4))}
                className={`flex-1 px-2 py-1 text-xs transition-colors ${
                  amount === availableAllowance.toFixed(4)
                    ? isDark ? 'bg-purple-500/30 text-purple-400' : 'bg-purple-100 text-purple-700'
                    : isDark ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20' : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                }`}
              >
                max
              </button>
            </div>
          )}
        </div>

        {/* Info */}
        <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {activeChainData?.configurationError
            ? activeChainData.configurationError
            : allowanceDisabled
            ? 'No surplus allowance is configured for this ruleset. The project owner cannot withdraw surplus funds.'
            : isUnlimited
              ? 'The project has unlimited surplus allowance. This is typically used by Revnets to facilitate loans against treasury funds.'
              : 'Withdraw funds from the treasury surplus. Only the project owner can use this allowance.'
          }
        </p>
      </div>

      {/* Modal */}
      {allowanceData && allowanceToken && (
        <UseSurplusAllowanceModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        projectId={String(activeChainData.projectId)}
        projectName={project?.name}
        chainId={selectedChainId}
        amount={amount}
        allowanceCurrency={allowanceCurrency}
        allowanceTokenAddress={allowanceToken}
        allowanceTokenDecimals={allowanceTokenDecimals}
        onSubmitted={handleSubmitted}
        onConfirmed={handleConfirmed}
        onError={handleError}
        />
      )}
    </div>
  )
}
