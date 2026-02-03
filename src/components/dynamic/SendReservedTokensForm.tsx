import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useSendReservedTokensFormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchConnectedChains,
  fetchProjectSplits,
  fetchProjectWithRuleset,
  fetchPendingReservedTokens,
  fetchProjectTokenSymbol,
  type Project,
  type ConnectedChain,
  type JBSplitData,
  type ProjectRuleset,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { resolveEnsName, truncateAddress } from '../../utils/ens'
import { SendReservedTokensModal } from '../payment'

interface SendReservedTokensFormProps {
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

// Per-chain reserved tokens data
interface ChainReservedData {
  chainId: number
  projectId: number
  pendingReserved: string
  reservedSplits: JBSplitData[]
  reservedPercent: number
  ruleset: ProjectRuleset | null
}

// Inline chain selector component
function InlineChainSelector({
  chainData,
  selectedChainId,
  onSelect,
  isDark,
}: {
  chainData: ChainReservedData[]
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
        const hasPending = BigInt(cd.pendingReserved) > 0n
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
            {hasPending && (
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" title="Has pending tokens" />
            )}
          </button>
        )
      })}
    </div>
  )
}

export default function SendReservedTokensForm({ projectId, chainId = '1', messageId }: SendReservedTokensFormProps) {
  // Persistent state (visible to all chat users)
  const { state: persistedState, updateState: updatePersistedState } = useSendReservedTokensFormState(messageId)

  const [project, setProject] = useState<Project | null>(null)
  const [tokenSymbol, setTokenSymbol] = useState<string>('tokens')
  const [loading, setLoading] = useState(true)
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
  const [chainReservedData, setChainReservedData] = useState<ChainReservedData[]>([])
  const [selectedChainId, setSelectedChainId] = useState<number>(parseInt(chainId))
  const [splitEnsNames, setSplitEnsNames] = useState<Record<string, string>>({})

  const isOmnichain = chainReservedData.length > 1

  // Get active chain data
  const activeChainData = chainReservedData.find(cd => cd.chainId === selectedChainId) || chainReservedData[0]
  const chainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO[1]

  // Calculate pending tokens in human-readable format
  const pendingTokens = activeChainData
    ? parseFloat(activeChainData.pendingReserved) / 1e18
    : 0

  // Total pending across all chains
  const totalPendingAcrossChains = chainReservedData.reduce((sum, cd) => {
    return sum + parseFloat(cd.pendingReserved) / 1e18
  }, 0)

  // Fetch data for all chains
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const primaryChainId = parseInt(chainId)

        // Fetch project and connected chains
        const [projectData, connectedChains, symbol] = await Promise.all([
          fetchProject(projectId, primaryChainId),
          fetchConnectedChains(projectId, primaryChainId),
          fetchProjectTokenSymbol(projectId, primaryChainId),
        ])
        setProject(projectData)
        setTokenSymbol(symbol || 'tokens')

        // Determine chains to fetch
        const chainsToFetch: ConnectedChain[] = connectedChains.length > 0
          ? connectedChains
          : [{ chainId: primaryChainId, projectId: parseInt(projectId) }]

        // Fetch reserved token data from all chains in parallel
        const chainDataPromises = chainsToFetch.map(async (chain): Promise<ChainReservedData> => {
          try {
            const [pendingReserved, chainProject] = await Promise.all([
              fetchPendingReservedTokens(String(chain.projectId), chain.chainId),
              fetchProjectWithRuleset(String(chain.projectId), chain.chainId),
            ])

            // Fetch splits if we have a ruleset
            let reservedSplits: JBSplitData[] = []
            if (chainProject?.currentRuleset?.id) {
              const splitsData = await fetchProjectSplits(
                String(chain.projectId),
                chain.chainId,
                chainProject.currentRuleset.id
              )
              reservedSplits = splitsData.reservedSplits
            }

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              pendingReserved,
              reservedSplits,
              reservedPercent: chainProject?.currentRuleset?.reservedPercent || 0,
              ruleset: chainProject?.currentRuleset || null,
            }
          } catch (err) {
            console.error(`Failed to fetch reserved data for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              pendingReserved: '0',
              reservedSplits: [],
              reservedPercent: 0,
              ruleset: null,
            }
          }
        })

        const allChainData = await Promise.all(chainDataPromises)
        setChainReservedData(allChainData)

        // Set initial selected chain to one with pending tokens, or primary
        const chainWithPending = allChainData.find(cd => BigInt(cd.pendingReserved) > 0n)
        setSelectedChainId(chainWithPending?.chainId || primaryChainId)

        // Resolve ENS names for split beneficiaries
        const allBeneficiaries = new Set<string>()
        allChainData.forEach(cd => {
          cd.reservedSplits.forEach(split => {
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

  const handleSendReservedTokens = () => {
    if (pendingTokens <= 0 || isLocked) return

    if (!isConnected) {
      openWalletPanel()
      return
    }

    // Persist in_progress state
    updatePersistedState({
      status: 'in_progress',
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

  const hasPendingTokens = pendingTokens > 0
  const reservedPercent = activeChainData?.reservedPercent || 0

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
            <div className="w-14 h-14 bg-amber-500/20 flex items-center justify-center">
              <span className="text-2xl">🎟️</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Distribute Reserved {tokenSymbol}
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
              chainData={chainReservedData}
              selectedChainId={selectedChainId}
              onSelect={setSelectedChainId}
              isDark={isDark}
            />
          </div>
        )}

        {/* Reserved Rate Info */}
        <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className="flex justify-between items-center mb-2">
            <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Reserved Rate
            </span>
            <span className={`text-xs font-mono ${reservedPercent > 0 ? 'text-amber-400' : ''}`}>
              {(reservedPercent / 100).toFixed(1)}%
            </span>
          </div>
          <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {reservedPercent > 0
              ? `${(reservedPercent / 100).toFixed(1)}% of newly minted ${tokenSymbol} are reserved for distribution`
              : `No ${tokenSymbol} are reserved. All minted ${tokenSymbol} go to contributors.`
            }
          </div>
        </div>

        {/* Pending Tokens */}
        <div className={`p-3 mb-3 ${
          hasPendingTokens
            ? isDark ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-amber-50 border border-amber-200'
            : isDark ? 'bg-white/5' : 'bg-gray-50'
        }`}>
          <div className="flex justify-between items-center">
            <span className={`text-xs font-medium ${
              hasPendingTokens
                ? isDark ? 'text-amber-300' : 'text-amber-700'
                : isDark ? 'text-gray-400' : 'text-gray-500'
            }`}>
              Pending Distribution
            </span>
            <span className={`font-mono text-sm ${hasPendingTokens ? 'text-amber-400' : ''}`}>
              {pendingTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} {tokenSymbol}
            </span>
          </div>
          {hasPendingTokens && (
            <div className={`text-xs mt-1 ${isDark ? 'text-amber-400/70' : 'text-amber-600'}`}>
              Reserved {tokenSymbol} waiting to be sent to recipients
            </div>
          )}
          {!hasPendingTokens && (
            <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              No reserved {tokenSymbol} pending distribution
            </div>
          )}

          {/* Cross-chain total for omnichain */}
          {isOmnichain && totalPendingAcrossChains > 0 && (
            <div className={`mt-2 pt-2 border-t ${isDark ? 'border-amber-500/20' : 'border-amber-200'}`}>
              <div className="flex justify-between items-center">
                <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Total across all chains
                </span>
                <span className={`font-mono text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  {totalPendingAcrossChains.toLocaleString(undefined, { maximumFractionDigits: 2 })} {tokenSymbol}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Splits Preview */}
        {activeChainData && activeChainData.reservedSplits.length > 0 && (
          <div className={`mb-3 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <button
              onClick={() => setShowSplits(!showSplits)}
              className={`w-full flex items-center justify-between py-2 text-xs ${
                isDark ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <span className="font-medium">
                {tokenSymbol} Recipients ({activeChainData.reservedSplits.length})
              </span>
              <span>{showSplits ? '▲' : '▼'}</span>
            </button>

            {showSplits && (
              <div className={`space-y-1.5 py-2 ${isDark ? 'border-t border-white/10' : 'border-t border-gray-200'}`}>
                {activeChainData.reservedSplits.map((split, idx) => {
                  const splitPercent = (split.percent / 1e9) * 100
                  const reservedRate = activeChainData.reservedPercent / 100
                  const actualPercent = (reservedRate * splitPercent) / 100
                  const beneficiaryKey = split.beneficiary.toLowerCase()
                  const displayName = splitEnsNames[beneficiaryKey] || truncateAddress(split.beneficiary)
                  const isProject = split.projectId > 0

                  // Calculate estimated tokens
                  const estimatedTokens = hasPendingTokens
                    ? (pendingTokens * splitPercent / 100).toFixed(2)
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
                        {estimatedTokens && (
                          <span className={`font-mono text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            {estimatedTokens} {tokenSymbol}
                          </span>
                        )}
                        <span className="font-mono text-xs text-amber-400">{actualPercent.toFixed(0)}%</span>
                        <span className={`font-mono text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          ({splitPercent.toFixed(0)}%)
                        </span>
                      </div>
                    </div>
                  )
                })}
                {/* Project owner remainder */}
                {(() => {
                  const totalSplitPercent = activeChainData.reservedSplits.reduce((sum, s) => sum + (s.percent / 1e9) * 100, 0)
                  const remainderSplitPercent = 100 - totalSplitPercent
                  const reservedRate = activeChainData.reservedPercent / 100
                  const remainderActualPercent = (reservedRate * remainderSplitPercent) / 100
                  if (remainderSplitPercent > 0.01) {
                    const estimatedTokens = hasPendingTokens
                      ? (pendingTokens * remainderSplitPercent / 100).toFixed(2)
                      : null
                    return (
                      <div className={`flex items-center justify-between p-2 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                          Project owner
                        </span>
                        <div className="flex items-center gap-2">
                          {estimatedTokens && (
                            <span className={`font-mono text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                              {estimatedTokens} {tokenSymbol}
                            </span>
                          )}
                          <span className="font-mono text-xs text-amber-400">{remainderActualPercent.toFixed(0)}%</span>
                          <span className={`font-mono text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            ({remainderSplitPercent.toFixed(0)}%)
                          </span>
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

        {/* Action Button */}
        <button
          onClick={handleSendReservedTokens}
          disabled={!hasPendingTokens || isLocked}
          className={`w-full py-3 text-sm font-medium transition-colors ${
            !hasPendingTokens || isLocked
              ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
              : 'bg-amber-500 hover:bg-amber-500/90 text-black'
          }`}
        >
          {persistedState?.status === 'completed'
            ? 'Sent'
            : persistedState?.status === 'in_progress'
              ? 'Pending...'
              : hasPendingTokens
                ? `Distribute ${pendingTokens.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${tokenSymbol}`
                : `No ${tokenSymbol} to Distribute`
          }
        </button>

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
                  <span>{tokenSymbol} distributed successfully!</span>
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

        {/* Info */}
        <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {reservedPercent > 0
            ? `Send accumulated reserved ${tokenSymbol} to the configured recipients. Anyone can trigger this distribution.`
            : `This project does not reserve any ${tokenSymbol}. All minted tokens go directly to contributors.`
          }
        </p>
      </div>

      {/* Modal */}
      <SendReservedTokensModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        projectId={projectId}
        projectName={project?.name}
        chainId={selectedChainId}
        tokenSymbol={tokenSymbol}
        amount={activeChainData?.pendingReserved || '0'}
        onConfirmed={handleConfirmed}
        onError={handleError}
      />
    </div>
  )
}
