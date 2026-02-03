import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { useThemeStore } from '../../stores'
import { useSendPayoutsFormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchDistributablePayout,
  fetchConnectedChains,
  fetchProjectSplits,
  fetchProjectWithRuleset,
  type Project,
  type DistributablePayout,
  type ConnectedChain,
  type JBSplitData,
  type FundAccessLimits,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { resolveEnsName, truncateAddress } from '../../utils/ens'
import { SendPayoutsModal } from '../payment'

interface SendPayoutsFormProps {
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

// Per-chain payout data
interface ChainPayoutData {
  chainId: number
  projectId: number
  distributablePayout: DistributablePayout | null
  payoutSplits: JBSplitData[]
  fundAccessLimits: FundAccessLimits | null
  balance: string
  baseCurrency: number // 1 = ETH, 2 = USD
}

// Inline chain selector component
function InlineChainSelector({
  chainData,
  selectedChainId,
  onSelect,
  isDark,
}: {
  chainData: ChainPayoutData[]
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
          </button>
        )
      })}
    </div>
  )
}

export default function SendPayoutsForm({ projectId, chainId = '1', messageId }: SendPayoutsFormProps) {
  // Persistent state (visible to all chat users)
  const { state: persistedState, updateState: updatePersistedState } = useSendPayoutsFormState(messageId)

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showSplits, setShowSplits] = useState(false)
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

  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  // Omnichain state
  const [chainPayoutData, setChainPayoutData] = useState<ChainPayoutData[]>([])
  const [selectedChainId, setSelectedChainId] = useState<number>(parseInt(chainId))
  const [splitEnsNames, setSplitEnsNames] = useState<Record<string, string>>({})

  const isOmnichain = chainPayoutData.length > 1

  // Get active chain data
  const activeChainData = chainPayoutData.find(cd => cd.chainId === selectedChainId) || chainPayoutData[0]
  const chainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO[1]
  const baseCurrency = activeChainData?.baseCurrency || 1
  const currencyLabel = baseCurrency === 2 ? 'USDC' : 'ETH'

  // Fetch project data and distributable payout for all chains
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

        // Fetch payout data from all chains in parallel
        const chainDataPromises = chainsToFetch.map(async (chain): Promise<ChainPayoutData> => {
          try {
            const [payoutData, chainProject] = await Promise.all([
              fetchDistributablePayout(String(chain.projectId), chain.chainId),
              fetchProjectWithRuleset(String(chain.projectId), chain.chainId),
            ])

            // Fetch splits if we have a ruleset
            let payoutSplits: JBSplitData[] = []
            let fundAccessLimits: FundAccessLimits | null = null
            if (chainProject?.currentRuleset?.id) {
              const splitsData = await fetchProjectSplits(
                String(chain.projectId),
                chain.chainId,
                chainProject.currentRuleset.id
              )
              payoutSplits = splitsData.payoutSplits
              fundAccessLimits = splitsData.fundAccessLimits || null
            }

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              distributablePayout: payoutData,
              payoutSplits,
              fundAccessLimits,
              balance: chainProject?.balance || '0',
              baseCurrency: chainProject?.currentRuleset?.baseCurrency || 1,
            }
          } catch (err) {
            console.error(`Failed to fetch payout data for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              distributablePayout: null,
              payoutSplits: [],
              fundAccessLimits: null,
              balance: '0',
              baseCurrency: 1,
            }
          }
        })

        const allChainData = await Promise.all(chainDataPromises)
        setChainPayoutData(allChainData)

        // Set initial selected chain
        setSelectedChainId(primaryChainId)

        // Resolve ENS names for split beneficiaries
        const allBeneficiaries = new Set<string>()
        allChainData.forEach(cd => {
          cd.payoutSplits.forEach(split => {
            if (split.beneficiary && split.projectId === 0) {
              allBeneficiaries.add(split.beneficiary.toLowerCase())
            }
          })
        })

        const ensPromises = Array.from(allBeneficiaries).map(async addr => {
          const ens = await resolveEnsName(addr)
          return { addr, ens }
        })

        const ensResults = await Promise.all(ensPromises)
        const ensMap: Record<string, string> = {}
        ensResults.forEach(({ addr, ens }) => {
          if (ens) ensMap[addr] = ens
        })
        setSplitEnsNames(ensMap)

      } catch (err) {
        console.error('Failed to load project:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainId])

  // Available balance for payouts
  const availableBalance = (() => {
    if (activeChainData?.distributablePayout) {
      try {
        return parseFloat(formatEther(activeChainData.distributablePayout.available))
      } catch {
        return 0
      }
    }
    return 0
  })()

  // Check if payouts are disabled
  const payoutsDisabled = activeChainData?.distributablePayout
    ? activeChainData.distributablePayout.limit === 0n
    : true

  // Calculate fee and net payout
  const amountNum = parseFloat(amount) || 0
  const protocolFee = amountNum * 0.025
  const netPayout = amountNum - protocolFee

  // Get payout limit info
  const payoutLimit = activeChainData?.distributablePayout?.limit || 0n
  const usedPayout = activeChainData?.distributablePayout?.used || 0n
  const isUnlimited = payoutLimit > BigInt('1000000000000000000000000000000')

  const handleSendPayouts = () => {
    if (!amount || parseFloat(amount) <= 0 || isLocked) return

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
            <div className="w-14 h-14 bg-juice-orange/20 flex items-center justify-center">
              <span className="text-2xl">📤</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Distribute Payouts
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
              chainData={chainPayoutData}
              selectedChainId={selectedChainId}
              onSelect={setSelectedChainId}
              isDark={isDark}
            />
          </div>
        )}

        {/* Payout Limit Status */}
        <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex justify-between items-center mb-2">
            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Payout Limit
            </span>
            <span className={`text-xs font-mono ${
              payoutsDisabled ? 'text-amber-400' : isUnlimited ? 'text-emerald-400' : ''
            }`}>
              {payoutsDisabled
                ? 'None'
                : isUnlimited
                  ? 'Unlimited'
                  : `${parseFloat(formatEther(payoutLimit)).toFixed(4)} ${currencyLabel}`
              }
            </span>
          </div>
          {!payoutsDisabled && !isUnlimited && (
            <>
              <div className="flex justify-between items-center mb-1">
                <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Used this cycle
                </span>
                <span className="text-xs font-mono">
                  {parseFloat(formatEther(usedPayout)).toFixed(4)} {currencyLabel}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className={`text-xs font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                  Available to distribute
                </span>
                <span className={`text-xs font-mono font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                  {availableBalance.toFixed(4)} {currencyLabel}
                </span>
              </div>
              {/* Progress bar */}
              <div className={`mt-2 h-1.5 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{
                    width: `${Math.min(100, Number(usedPayout) / Number(payoutLimit) * 100)}%`
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Splits Preview */}
        {activeChainData && activeChainData.payoutSplits.length > 0 && (
          <div className={`mb-3 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <button
              onClick={() => setShowSplits(!showSplits)}
              className={`w-full flex items-center justify-between py-2 text-xs ${
                isDark ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="font-medium">
                Payout Recipients ({activeChainData.payoutSplits.length})
              </span>
              <span>{showSplits ? '▲' : '▼'}</span>
            </button>

            {showSplits && (
              <div className={`space-y-1.5 py-2 ${isDark ? 'border-t border-white/10' : 'border-t border-gray-200'}`}>
                {activeChainData.payoutSplits.map((split, idx) => {
                  const percent = (split.percent / 1e9) * 100
                  const beneficiaryKey = split.beneficiary.toLowerCase()
                  const displayName = splitEnsNames[beneficiaryKey] || truncateAddress(split.beneficiary)
                  const isProject = split.projectId > 0

                  // Calculate estimated amount if we have an amount entered
                  const estimatedAmount = amountNum > 0
                    ? (netPayout * percent / 100).toFixed(4)
                    : null

                  return (
                    <div key={idx} className={`flex items-center justify-between p-2 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                      <div className="flex items-center gap-2">
                        {isProject ? (
                          <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400">
                            Project #{split.projectId}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-juice-orange">
                            {displayName}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {estimatedAmount && (
                          <span className={`font-mono text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            {estimatedAmount} {currencyLabel}
                          </span>
                        )}
                        <span className="font-mono text-xs text-emerald-400">{percent.toFixed(2)}%</span>
                      </div>
                    </div>
                  )
                })}
                {/* Project treasury remainder */}
                {(() => {
                  const totalPercent = activeChainData.payoutSplits.reduce((sum, s) => sum + (s.percent / 1e9) * 100, 0)
                  const remainder = 100 - totalPercent
                  if (remainder > 0.01) {
                    const estimatedAmount = amountNum > 0
                      ? (netPayout * remainder / 100).toFixed(4)
                      : null
                    return (
                      <div className={`flex items-center justify-between p-2 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          Project treasury
                        </span>
                        <div className="flex items-center gap-2">
                          {estimatedAmount && (
                            <span className={`font-mono text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                              {estimatedAmount} {currencyLabel}
                            </span>
                          )}
                          <span className="font-mono text-xs text-emerald-400">{remainder.toFixed(2)}%</span>
                        </div>
                      </div>
                    )
                  }
                  return null
                })()}
              </div>
            )}
          </div>
        )}

        {/* Form */}
        <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Amount to distribute
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
                max={availableBalance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                disabled={payoutsDisabled || isLocked}
                className={`flex-1 px-3 py-2 text-sm bg-transparent outline-none ${
                  isDark ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                } ${payoutsDisabled || isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
              <span className={`px-3 py-2 text-sm border-l ${
                isDark ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'
              }`}>
                {currencyLabel}
              </span>
            </div>
            <button
              onClick={handleSendPayouts}
              disabled={!amount || parseFloat(amount) <= 0 || payoutsDisabled || isLocked}
              className={`px-5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                !amount || parseFloat(amount) <= 0 || payoutsDisabled || isLocked
                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                  : 'bg-juice-orange hover:bg-juice-orange/90 text-black'
              }`}
            >
              {persistedState?.status === 'completed' ? 'Sent' : persistedState?.status === 'in_progress' ? 'Pending...' : 'Send'}
            </button>
          </div>

          {/* Transaction status indicator */}
          {isLocked && (
            <div className={`mt-2 p-2 text-sm ${
              persistedState?.status === 'completed'
                ? isDark ? 'bg-green-500/10' : 'bg-green-50'
                : persistedState?.status === 'failed'
                  ? isDark ? 'bg-red-500/10' : 'bg-red-50'
                  : isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'
            }`}>
              <div className={`flex items-center gap-2 ${
                persistedState?.status === 'completed'
                  ? isDark ? 'text-green-400' : 'text-green-600'
                  : persistedState?.status === 'failed'
                    ? isDark ? 'text-red-400' : 'text-red-600'
                    : isDark ? 'text-juice-cyan' : 'text-cyan-600'
              }`}>
                {persistedState?.status === 'completed' ? (
                  <>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Payouts sent successfully!</span>
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
          {!payoutsDisabled && availableBalance > 0 && (
            <div className="flex gap-2 mt-2">
              {[0.25, 0.5, 0.75].map(fraction => {
                const val = (availableBalance * fraction).toFixed(4)
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
                onClick={() => setAmount(availableBalance.toFixed(4))}
                className={`flex-1 px-2 py-1 text-xs transition-colors ${
                  amount === availableBalance.toFixed(4)
                    ? isDark ? 'bg-juice-orange/30 text-juice-orange' : 'bg-orange-100 text-orange-700'
                    : isDark ? 'bg-juice-orange/10 text-juice-orange hover:bg-juice-orange/20' : 'bg-orange-50 text-orange-600 hover:bg-orange-100'
                }`}
              >
                max
              </button>
            </div>
          )}

          {/* Fee preview */}
          {amountNum > 0 && (
            <div className={`mt-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Net to splits: <span className="font-mono">{netPayout.toFixed(4)} {currencyLabel}</span>
              <span className={isDark ? 'text-gray-500' : 'text-gray-400'}> (2.5% fee)</span>
            </div>
          )}
        </div>

        {/* Info */}
        <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {payoutsDisabled
            ? 'No payout limit is configured for this ruleset. Payouts are not available.'
            : 'Distribute treasury funds to the payout split recipients. A 2.5% protocol fee applies.'}
        </p>
      </div>

      {/* Modal */}
      <SendPayoutsModal
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
