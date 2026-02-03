import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { useThemeStore } from '../../stores'
import { useUseSurplusAllowanceFormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchConnectedChains,
  fetchProjectSplits,
  fetchProjectWithRuleset,
  type Project,
  type ConnectedChain,
  type FundAccessLimits,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { UseSurplusAllowanceModal } from '../payment'

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
  chainId: number
  projectId: number
  fundAccessLimits: FundAccessLimits | null
  balance: string
  surplusAllowance: bigint
  usedSurplusAllowance: bigint
  isUnlimited: boolean
  baseCurrency: number // 1 = ETH, 2 = USD
}

// Inline chain selector component
function InlineChainSelector({
  chainData,
  selectedChainId,
  onSelect,
  isDark,
}: {
  chainData: ChainSurplusData[]
  selectedChainId: number | null
  onSelect: (chainId: number) => void
  isDark: boolean
}) {
  if (chainData.length <= 1) return null

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {chainData.map(cd => {
        const chain = CHAIN_INFO[cd.chainId] || { name: `Chain ${cd.chainId}`, shortName: String(cd.chainId), color: '#888888' }
        const isSelected = selectedChainId === cd.chainId
        const hasAllowance = cd.surplusAllowance > 0n || cd.isUnlimited
        return (
          <button
            key={cd.chainId}
            onClick={() => onSelect(cd.chainId)}
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
            {chain.shortName}
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
  return amount > BigInt('1000000000000000000000000000000')
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

  // Check if form should be locked due to active/completed transaction
  const isLocked = persistedState?.status && persistedState.status !== 'pending'

  // Restore state from persisted data on load
  useEffect(() => {
    if (persistedState && persistedState.status !== 'pending') {
      if (persistedState.amount) setAmount(persistedState.amount)
      if (persistedState.selectedChainId) setSelectedChainId(persistedState.selectedChainId)
    }
  }, [persistedState?.status])

  // Transaction callbacks for persistence
  const handleConfirmed = useCallback((txHash: string) => {
    updatePersistedState({
      status: 'completed',
      txHash,
      confirmedAt: new Date().toISOString(),
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
  const [selectedChainId, setSelectedChainId] = useState<number>(parseInt(chainId))

  const isOmnichain = chainSurplusData.length > 1

  // Get active chain data
  const activeChainData = chainSurplusData.find(cd => cd.chainId === selectedChainId) || chainSurplusData[0]
  const chainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO[1]
  const baseCurrency = activeChainData?.baseCurrency || 1
  const currencyLabel = baseCurrency === 2 ? 'USDC' : 'ETH'

  // Calculate available surplus
  const surplusAllowance = activeChainData?.surplusAllowance || 0n
  const usedSurplusAllowance = activeChainData?.usedSurplusAllowance || 0n
  const isUnlimited = activeChainData?.isUnlimited || false
  const treasuryBalance = activeChainData ? parseFloat(activeChainData.balance) / 1e18 : 0

  // Available = min(allowance - used, treasury balance) for non-unlimited
  // For unlimited, available = treasury balance
  const availableAllowance = isUnlimited
    ? treasuryBalance
    : Math.min(
        parseFloat(formatEther(surplusAllowance > usedSurplusAllowance ? surplusAllowance - usedSurplusAllowance : 0n)),
        treasuryBalance
      )

  const allowanceDisabled = !isUnlimited && surplusAllowance === 0n

  // Fetch data for all chains
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

        // Fetch surplus data from all chains in parallel
        const chainDataPromises = chainsToFetch.map(async (chain): Promise<ChainSurplusData> => {
          try {
            const chainProject = await fetchProjectWithRuleset(String(chain.projectId), chain.chainId)

            // Fetch fund access limits if we have a ruleset
            let fundAccessLimits: FundAccessLimits | null = null
            if (chainProject?.currentRuleset?.id) {
              const splitsData = await fetchProjectSplits(
                String(chain.projectId),
                chain.chainId,
                chainProject.currentRuleset.id
              )
              fundAccessLimits = splitsData.fundAccessLimits || null
            }

            // Extract surplus allowance info
            const surplusAllowanceData = fundAccessLimits?.surplusAllowances?.[0]
            const surplusAllowanceAmount = surplusAllowanceData?.amount
              ? BigInt(surplusAllowanceData.amount)
              : 0n

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              fundAccessLimits,
              balance: chainProject?.balance || '0',
              surplusAllowance: surplusAllowanceAmount,
              usedSurplusAllowance: 0n, // Would need on-chain read for actual used value
              isUnlimited: isUnlimitedValue(surplusAllowanceAmount),
              baseCurrency: chainProject?.currentRuleset?.baseCurrency || 1,
            }
          } catch (err) {
            console.error(`Failed to fetch surplus data for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              fundAccessLimits: null,
              balance: '0',
              surplusAllowance: 0n,
              usedSurplusAllowance: 0n,
              isUnlimited: false,
              baseCurrency: 1,
            }
          }
        })

        const allChainData = await Promise.all(chainDataPromises)
        setChainSurplusData(allChainData)

        // Set initial selected chain to one with allowance, or primary
        const chainWithAllowance = allChainData.find(cd => cd.surplusAllowance > 0n || cd.isUnlimited)
        setSelectedChainId(chainWithAllowance?.chainId || primaryChainId)

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
    if (!amount || amountNum <= 0 || isLocked) return

    if (!isConnected) {
      openWalletPanel()
      return
    }

    // Persist in_progress state
    updatePersistedState({
      status: 'in_progress',
      amount,
      selectedChainId,
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
  const projectUrl = `https://juicebox.money/v5/${chainInfo.slug}:${projectId}`

  return (
    <div className="w-full">
      <div className={`max-w-md border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          {logoUrl ? (
            <img src={logoUrl} alt={project?.name || 'Project'} className="w-14 h-14 object-cover" />
          ) : (
            <div className="w-14 h-14 bg-purple-500/20 flex items-center justify-center">
              <span className="text-2xl">💰</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Use Surplus Allowance
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

        {/* Chain Selector for omnichain */}
        {isOmnichain && (
          <div className="mb-3">
            <div className={`text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Select chain:
            </div>
            <InlineChainSelector
              chainData={chainSurplusData}
              selectedChainId={selectedChainId}
              onSelect={setSelectedChainId}
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
                  : `${parseFloat(formatEther(surplusAllowance)).toFixed(4)} ${currencyLabel}`
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
                  {parseFloat(formatEther(usedSurplusAllowance)).toFixed(4)} {currencyLabel}
                </span>
              </div>
            </>
          )}

          <div className="flex justify-between items-center">
            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Treasury balance
            </span>
            <span className="text-xs font-mono">
              {treasuryBalance.toFixed(4)} {currencyLabel}
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
              disabled={!amount || amountNum <= 0 || allowanceDisabled || availableAllowance <= 0 || isLocked}
              className={`px-5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                !amount || amountNum <= 0 || allowanceDisabled || availableAllowance <= 0 || isLocked
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
          {allowanceDisabled
            ? 'No surplus allowance is configured for this ruleset. The project owner cannot withdraw surplus funds.'
            : isUnlimited
              ? 'The project has unlimited surplus allowance. This is typically used by Revnets to facilitate loans against treasury funds.'
              : 'Withdraw funds from the treasury surplus. Only the project owner can use this allowance.'
          }
        </p>
      </div>

      {/* Modal */}
      <UseSurplusAllowanceModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        projectId={projectId}
        projectName={project?.name}
        chainId={selectedChainId}
        amount={amount}
        baseCurrency={baseCurrency}
        onConfirmed={handleConfirmed}
        onError={handleError}
      />
    </div>
  )
}
