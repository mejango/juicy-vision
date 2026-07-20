import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useSendReservedTokensFormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchProjectSplits,
  fetchProjectWithRuleset,
  fetchPendingReservedTokens,
  fetchProjectTokenSymbol,
  type Project,
  type JBSplitData,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { truncateAddress } from '../../utils/ens'
import { MAINNET_CHAINS } from '../../constants'
import { SendReservedTokensModal } from '../payment'
import InlineChainSelector from './InlineChainSelector'
import { resolveSplitEnsNames } from './resolveSplitEnsNames'
import { ProjectLink } from './ProjectLink'
import { ProjectSplitRoute } from './ProjectSplitRoute'
import { assertSafeStoredSplitGroups as assertSimpleStoredSplitGroups } from '../../utils/splitSafety'
import { useManagedWallet } from '../../hooks'
import { resolveProjectChains } from '../../utils/projectChains'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'

interface SendReservedTokensFormProps {
  projectId: string
  chainId?: string
  messageId?: string // For persisting state to server (visible to all chat users)
}

// Chain info for display
const CHAIN_INFO = MAINNET_CHAINS

// Per-chain reserved tokens data
interface ChainReservedData {
  chainId: number
  projectId: number
  pendingReserved: string | null
  reservedSplits: JBSplitData[]
  reservedPercent: number
  configurationError?: string
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
  const { address: managedAddress, isManagedMode } = useManagedWallet()
  const hasActiveWallet = isManagedMode ? !!managedAddress : isConnected

  // Check if form should be locked due to active/completed transaction
  const isLocked = persistedState?.status && persistedState.status !== 'pending'

  // Restore state from persisted data on load
  useEffect(() => {
    if (persistedState && persistedState.status !== 'pending') {
      if (persistedState.selectedChainId) setSelectedChainId(persistedState.selectedChainId)
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

  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  // Omnichain state
  const [chainReservedData, setChainReservedData] = useState<ChainReservedData[]>([])
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [selectedChainId, setSelectedChainId] = useState<number>(parseInt(chainId))
  const [splitEnsNames, setSplitEnsNames] = useState<Record<string, string>>({})

  const isOmnichain = chainReservedData.length > 1

  // Get active chain data
  const activeChainData = chainReservedData.find(cd => cd.chainId === selectedChainId) || chainReservedData[0]
  const chainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO[1]

  // Calculate pending tokens in human-readable format
  const pendingTokens = activeChainData?.pendingReserved !== null && activeChainData?.pendingReserved !== undefined
    ? parseFloat(activeChainData.pendingReserved) / 1e18
    : null

  // Total pending across all chains
  const totalPendingAvailable = chainReservedData.every(cd => cd.pendingReserved !== null)
  const totalPendingAcrossChains = chainReservedData.reduce((sum, cd) => {
    return sum + (cd.pendingReserved === null ? 0 : parseFloat(cd.pendingReserved) / 1e18)
  }, 0)

  // Fetch data for all chains
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const primaryChainId = parseInt(chainId)

        // Fetch project and connected chains
        const [projectData, chainResolution, symbol] = await Promise.all([
          fetchProject(projectId, primaryChainId),
          resolveProjectChains(projectId, primaryChainId),
          fetchProjectTokenSymbol(projectId, primaryChainId),
        ])
        setProject(projectData)
        setTokenSymbol(symbol || 'tokens')
        setChainMappingAvailable(chainResolution.mappingAvailable)

        // Fetch reserved token data from all chains in parallel
        const chainDataPromises = chainResolution.chains.map(async (chain): Promise<ChainReservedData> => {
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
              if (!splitsData.configurationComplete) {
                throw new Error('Reserved split configuration could not be verified')
              }
              reservedSplits = splitsData.reservedSplits
              assertSimpleStoredSplitGroups([{ splits: reservedSplits }], {
                kind: 'reserved',
                sourceProjectId: chain.projectId,
              })
            }

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              pendingReserved,
              reservedSplits,
              reservedPercent: chainProject?.currentRuleset?.reservedPercent || 0,
            }
          } catch (err) {
            console.error(`Failed to fetch reserved data for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              pendingReserved: null,
              reservedSplits: [],
              reservedPercent: 0,
              configurationError: err instanceof Error ? err.message : 'Reserved split configuration unavailable',
            }
          }
        })

        const allChainData = await Promise.all(chainDataPromises)
        setChainReservedData(allChainData)

        // Set initial selected chain to one with pending tokens, or primary
        const chainWithPending = allChainData.find(
          cd => cd.pendingReserved !== null && BigInt(cd.pendingReserved) > 0n,
        )
        setSelectedChainId(chainWithPending?.chainId || primaryChainId)

        // Resolve ENS names for split beneficiaries
        setSplitEnsNames(await resolveSplitEnsNames(allChainData.map(cd => cd.reservedSplits)))

      } catch (err) {
        console.error('Failed to load project:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainId])

  const handleSendReservedTokens = () => {
    if (pendingTokens === null || pendingTokens <= 0 || isLocked || activeChainData?.configurationError) return

    if (!hasActiveWallet) {
      openWalletPanel()
      return
    }

    // Save reviewed inputs without claiming a transaction exists yet.
    updatePersistedState({
      status: 'pending',
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

  const hasPendingTokens = pendingTokens !== null && pendingTokens > 0
  const reservedPercent = activeChainData?.reservedPercent || 0

  return (
    <div className="w-full">
      <div className={`max-w-md border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          {logoUrl ? (
            <IpfsImage uri={project?.logoUri} alt={project?.name || 'Project'} className="w-14 h-14 object-cover" fallback={<div className="w-14 h-14 bg-amber-500/20" />} />
          ) : (
            <div className="w-14 h-14 bg-amber-500/20 flex items-center justify-center">
              <span className="text-2xl">🎟️</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Distribute Reserved {tokenSymbol}
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
              options={chainReservedData.map(cd => ({
                key: cd.chainId,
                chainId: cd.chainId,
                selected: selectedChainId === cd.chainId,
                suffix: cd.pendingReserved !== null && BigInt(cd.pendingReserved) > 0n && (
                  <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" title="Has pending tokens" />
                ),
              }))}
              onSelect={option => setSelectedChainId(option.chainId)}
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
              {pendingTokens === null
                ? 'Unavailable'
                : `${pendingTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenSymbol}`}
            </span>
          </div>
          {hasPendingTokens && (
            <div className={`text-xs mt-1 ${isDark ? 'text-amber-400/70' : 'text-amber-600'}`}>
              Reserved {tokenSymbol} waiting to be sent to recipients
            </div>
          )}
          {pendingTokens === 0 && (
            <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              No reserved {tokenSymbol} pending distribution
            </div>
          )}
          {pendingTokens === null && (
            <div className="text-xs mt-1 text-amber-500">
              Pending reserved tokens could not be verified
            </div>
          )}

          {/* Cross-chain total for omnichain */}
          {isOmnichain && totalPendingAvailable && totalPendingAcrossChains > 0 && (
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
                    ? (pendingTokens! * splitPercent / 100).toFixed(2)
                    : null

                  return (
                    <div key={idx} className={`flex items-center justify-between p-2 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                      <div className="flex items-center gap-2">
                        {isProject ? (
                          <ProjectSplitRoute
                            projectId={split.projectId}
                            chainId={activeChainData.chainId}
                            beneficiary={split.beneficiary}
                            kind="reserved"
                            hook={split.hook}
                            isDark={isDark}
                          />
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
                        {split.lockedUntil > Math.floor(Date.now() / 1000) && (
                          <span className="text-[10px] text-amber-500">Locked</span>
                        )}
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
                      ? (pendingTokens! * remainderSplitPercent / 100).toFixed(2)
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
                ? `Distribute ${pendingTokens!.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${tokenSymbol}`
                : pendingTokens === null
                  ? 'Distribution unavailable'
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
          {activeChainData?.configurationError
            ? activeChainData.configurationError
            : reservedPercent > 0
            ? `Send accumulated reserved ${tokenSymbol} to the configured recipients. Anyone can trigger this distribution.`
            : `This project does not reserve any ${tokenSymbol}. All minted tokens go directly to contributors.`
          }
        </p>
      </div>

      {/* Modal */}
      <SendReservedTokensModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        projectId={String(activeChainData?.projectId ?? projectId)}
        projectName={project?.name}
        chainId={selectedChainId}
        tokenSymbol={tokenSymbol}
        amount={activeChainData?.pendingReserved ?? ''}
        splits={activeChainData?.reservedSplits.map(split => ({
          address: split.beneficiary,
          percent: split.percent,
          projectId: split.projectId,
          lockedUntil: split.lockedUntil,
          hook: split.hook,
        }))}
        onSubmitted={handleSubmitted}
        onConfirmed={handleConfirmed}
        onError={handleError}
      />
    </div>
  )
}
