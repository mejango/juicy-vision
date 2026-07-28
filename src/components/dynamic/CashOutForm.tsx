import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { useThemeStore, useAuthStore, useViewAsStore } from '../../stores'
import { useCashOutFormState } from '../../hooks/useComponentState'
import { useProjectDataInvalidation } from '../../hooks/useProjectDataInvalidation'
import { useManagedWallet } from '../../hooks'
import {
  fetchProject,
  fetchProjectAccountingContexts,
  fetchUserTokenBalance,
  type ConnectedChain,
  type Project,
  type ProjectAccountingContext,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { CashOutModal } from '../payment'
import { ProjectLink } from './ProjectLink'
import { CHAINS, MAINNET_CHAINS } from '../../constants'
import { resolveProjectChains } from '../../utils/projectChains'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'

interface CashOutFormProps {
  projectId: string
  chainId?: string
  messageId?: string // For persisting state to server (visible to all chat users)
}

export default function CashOutForm({ projectId, chainId: initialChainId = '1', messageId }: CashOutFormProps) {
  // Persistent state (visible to all chat users)
  const { state: persistedState, updateState: updatePersistedState } = useCashOutFormState(messageId)

  const [project, setProject] = useState<Project | null>(null)
  const [accountingContexts, setAccountingContexts] = useState<ProjectAccountingContext[]>([])
  const [selectedAccountingToken, setSelectedAccountingToken] = useState('')
  const [configurationError, setConfigurationError] = useState<string | null>(null)
  const [userTokenBalance, setUserTokenBalance] = useState<bigint | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tokenAmount, setTokenAmount] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [selectedChainId, setSelectedChainId] = useState(initialChainId)
  const [connectedChains, setConnectedChains] = useState<ConnectedChain[]>([])
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const { isConnected, address } = useAccount()
  const { mode, isAuthenticated } = useAuthStore()
  const { address: managedAddress } = useManagedWallet()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const activeAddress = isManagedMode ? managedAddress : address
  const hasActiveWallet = isManagedMode ? !!managedAddress : isConnected && !!address
  // "Your token balance" read follows view-as; the cash-out write keeps the
  // real wallet context (and is refused at the review seam while active).
  const viewAs = useViewAsStore(s => s.viewAs)
  const balanceAddress = viewAs ?? activeAddress

  // Check if form should be locked due to active/completed transaction
  const isLocked = persistedState?.status === 'in_progress' || persistedState?.status === 'completed'

  // Restore state from persisted data on load
  useEffect(() => {
    if (persistedState && persistedState.status !== 'pending') {
      if (persistedState.tokenAmount) setTokenAmount(persistedState.tokenAmount)
      if (persistedState.selectedChainId) setSelectedChainId(String(persistedState.selectedChainId))
      if (persistedState.accountingToken) setSelectedAccountingToken(persistedState.accountingToken)
    }
  }, [persistedState])

  // Transaction callbacks for persistence
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

  const chainInfo = CHAINS[parseInt(selectedChainId)] || MAINNET_CHAINS[parseInt(selectedChainId)] || MAINNET_CHAINS[1]

  // Use connected chains if available, otherwise fall back to single chain
  const availableChains = connectedChains.length > 0
    ? connectedChains
    : [{ chainId: parseInt(initialChainId), projectId: parseInt(projectId) }]
  const selectedProjectId = availableChains.find(chain => chain.chainId === parseInt(selectedChainId))?.projectId ?? parseInt(projectId)
  const { refreshRevision, invalidateProjectData } = useProjectDataInvalidation(parseInt(selectedChainId), selectedProjectId)
  const accountingContext = accountingContexts.find(
    context => context.token.toLowerCase() === selectedAccountingToken.toLowerCase(),
  ) || accountingContexts[0]

  // Clear the stale amount and refresh project data once the cash out confirms.
  const handleConfirmed = useCallback((txHash: string) => {
    setShowModal(false)
    setTokenAmount('')
    updatePersistedState({
      status: 'completed',
      tokenAmount: '',
      txHash,
      confirmedAt: new Date().toISOString(),
    })
    invalidateProjectData()
  }, [invalidateProjectData, updatePersistedState])

  // Resolve the omnichain project IDs once from the chain/project in the tag.
  useEffect(() => {
    resolveProjectChains(projectId, parseInt(initialChainId)).then(resolution => {
      setConnectedChains(resolution.chains)
      setChainMappingAvailable(resolution.mappingAvailable)
    })
  }, [projectId, initialChainId])

  // Fetch the selected chain's actual project ID and current ruleset.
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const chainIdNum = parseInt(selectedChainId)
        const chainProjectId = String(selectedProjectId)
        const [data, contexts] = await Promise.all([
          fetchProject(chainProjectId, chainIdNum),
          fetchProjectAccountingContexts(chainProjectId, chainIdNum),
        ])
        setProject(data)
        setAccountingContexts(contexts)
        setConfigurationError(contexts.length > 0 ? null : 'No recognized accounting context is configured')
        setSelectedAccountingToken(previous => {
          const stillAvailable = contexts.some(context => context.token.toLowerCase() === previous.toLowerCase())
          return stillAvailable ? previous : contexts[0]?.token || ''
        })
      } catch (err) {
        console.error('Failed to load project:', err)
        setAccountingContexts([])
        setSelectedAccountingToken('')
        setConfigurationError(err instanceof Error ? err.message : 'Accounting configuration unavailable')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [selectedProjectId, selectedChainId])

  useEffect(() => {
    let cancelled = false
    if (!balanceAddress) {
      setUserTokenBalance(null)
      setBalanceLoading(false)
      return
    }

    setBalanceLoading(true)
    fetchUserTokenBalance(String(selectedProjectId), parseInt(selectedChainId), balanceAddress)
      .then(result => {
        if (!cancelled) setUserTokenBalance(BigInt(result.balance))
      })
      .catch(err => {
        console.error('Failed to load selected-chain token balance:', err)
        if (!cancelled) setUserTokenBalance(null)
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [balanceAddress, selectedProjectId, selectedChainId, refreshRevision])

  let tokenAmountRaw: bigint | null = null
  try {
    tokenAmountRaw = tokenAmount.trim() === '' ? null : parseUnits(tokenAmount, 18)
  } catch {
    tokenAmountRaw = null
  }
  const hasValidAmount = tokenAmountRaw !== null && tokenAmountRaw > 0n
  const exceedsBalance = tokenAmountRaw !== null
    && userTokenBalance !== null
    && tokenAmountRaw > userTokenBalance
  const balanceUnavailable = hasActiveWallet && !balanceLoading && userTokenBalance === null
  const transactionBlocked = !hasValidAmount
    || isLocked
    || !accountingContext
    || (hasActiveWallet && (balanceLoading || balanceUnavailable || exceedsBalance))

  // Dispatch event to open wallet panel
  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  const handleCashOut = () => {
    if (!hasValidAmount || isLocked || !accountingContext) return

    if (!hasActiveWallet) {
      openWalletPanel()
      return
    }

    if (balanceLoading || balanceUnavailable || exceedsBalance) return

    // Persist the reviewed inputs without locking the form. It becomes in-progress
    // only after a wallet or managed account actually submits a transaction.
    updatePersistedState({
      status: 'pending',
      tokenAmount,
      selectedChainId: parseInt(selectedChainId),
      accountingToken: accountingContext.token,
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
            <IpfsImage uri={project?.logoUri} alt={project?.name || 'Project'} className="w-14 h-14 object-cover" fallback={<div className="w-14 h-14 bg-juice-cyan/20" />} />
          ) : (
            <div className="w-14 h-14 bg-juice-cyan/20 flex items-center justify-center">
              <span className="text-2xl">🔄</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Cash Out
            </h3>
            <ProjectLink chainSlug={chainInfo.slug} projectId={String(selectedProjectId)} className={`text-xs hover:underline ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}>
              {project?.name || `Project #${selectedProjectId}`}
            </ProjectLink>
          </div>
          {/* Chain selector - show dropdown if multiple chains available */}
          {availableChains.length > 1 ? (
            <div className="relative">
              <button
                onClick={() => setChainDropdownOpen(!chainDropdownOpen)}
                className={`px-2 py-0.5 text-xs font-medium flex items-center gap-1 ${
                  isDark ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {chainInfo.shortName}
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {chainDropdownOpen && (
                <div className={`absolute right-0 mt-1 py-1 min-w-[120px] border z-10 ${
                  isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
                }`}>
                  {availableChains.map(chain => {
                    const info = CHAINS[chain.chainId] || MAINNET_CHAINS[chain.chainId]
                    if (!info) return null
                    return (
                      <button
                        key={chain.chainId}
                        onClick={() => {
                          setSelectedChainId(String(chain.chainId))
                          setTokenAmount('')
                          setChainDropdownOpen(false)
                        }}
                        className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 ${
                          selectedChainId === String(chain.chainId)
                            ? isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900'
                            : isDark ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: info.color }} />
                        {info.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <span className={`px-2 py-0.5 text-xs font-medium ${isDark ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
              {chainInfo.shortName}
            </span>
          )}
        </div>

        {/* Form */}
        <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className={`text-sm font-medium mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Burn tokens for funds
          </div>

          {accountingContexts.length > 1 && (
            <div className="mb-3">
              <div className={`text-xs mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Receive</div>
              <div className="grid grid-cols-2 gap-2">
                {accountingContexts.map(context => (
                  <button
                    key={context.token}
                    type="button"
                    onClick={() => setSelectedAccountingToken(context.token)}
                    disabled={isLocked}
                    className={`px-3 py-2 text-xs font-medium border ${
                      accountingContext?.token.toLowerCase() === context.token.toLowerCase()
                        ? isDark ? 'border-juice-cyan text-juice-cyan bg-juice-cyan/10' : 'border-cyan-600 text-cyan-700 bg-cyan-50'
                        : isDark ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-600'
                    }`}
                  >
                    {context.symbol}
                  </button>
                ))}
              </div>
            </div>
          )}

          {configurationError && (
            <div className={`mb-3 p-2 text-xs ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-700'}`}>
              {configurationError}
            </div>
          )}

          {/* Amount input */}
          <div className="flex gap-2">
            <div className={`flex-1 min-w-0 flex items-center ${
              isDark
                ? 'bg-juice-dark border border-white/10'
                : 'bg-white border border-gray-200'
            }`}>
              <input
                type="number"
                step="any"
                min="0"
                max={userTokenBalance !== null ? formatUnits(userTokenBalance, 18) : undefined}
                value={tokenAmount}
                onChange={(e) => setTokenAmount(e.target.value)}
                placeholder="10000"
                disabled={isLocked}
                className={`flex-1 px-3 py-2 text-sm bg-transparent outline-none ${
                  isDark ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
              <span className={`px-3 py-2 text-sm border-l ${
                isDark ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'
              }`}>
                tokens
              </span>
            </div>
            <button
              onClick={handleCashOut}
              disabled={transactionBlocked}
              className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                transactionBlocked
                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                  : 'bg-juice-cyan hover:bg-juice-cyan/90 text-black'
              }`}
            >
              {persistedState?.status === 'completed' ? 'Cashed out' : persistedState?.status === 'in_progress' ? 'Pending...' : 'Cash Out'}
            </button>
          </div>

          {hasActiveWallet && (
            <div className={`mt-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Selected-chain balance:{' '}
              {balanceLoading
                ? 'Checking...'
                : userTokenBalance !== null
                  ? `${formatUnits(userTokenBalance, 18)} tokens`
                  : 'Unavailable'}
            </div>
          )}

          {exceedsBalance && (
            <div className={`mt-2 text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              Amount exceeds your token balance on {chainInfo.name}.
            </div>
          )}

          {balanceUnavailable && (
            <div className={`mt-2 text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              Your selected-chain balance could not be verified. Cash out is blocked.
            </div>
          )}

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
                    <span>Cash out successful!</span>
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
                  href={`${chainInfo.explorerTx}${persistedState.txHash}`}
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

          {/* Balance-based amount options */}
          {userTokenBalance !== null && userTokenBalance > 0n && (
          <div className="flex gap-2 mt-2">
            {[
              { label: '25%', value: (userTokenBalance * 25n) / 100n },
              { label: '50%', value: (userTokenBalance * 50n) / 100n },
              { label: 'Max', value: userTokenBalance },
            ].map(option => (
              <button
                key={option.label}
                type="button"
                disabled={isLocked || option.value <= 0n}
                onClick={() => setTokenAmount(formatUnits(option.value, 18))}
                className={`flex-1 px-2 py-1 text-xs transition-colors ${
                  tokenAmountRaw === option.value
                    ? isDark ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-900'
                    : isDark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-150'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          )}

          {hasValidAmount && accountingContext && (
            <div className={`mt-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              The exact {accountingContext.symbol} return is checked from the terminal before confirmation.
            </div>
          )}
        </div>

        {/* Info */}
        <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Burn project tokens for the terminal's live cash-out quote. The active curve, surplus scope, hooks, and fees all affect the return.
        </p>
      </div>

      {/* Modal */}
      {accountingContext && <CashOutModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        projectId={String(selectedProjectId)}
        projectName={project?.name}
        chainId={parseInt(selectedChainId)}
        tokenAmount={tokenAmount}
        reclaimToken={accountingContext.token}
        reclaimTokenDecimals={accountingContext.decimals}
        currencySymbol={accountingContext.symbol}
        expectedTerminal={accountingContext.terminal}
        onSubmitted={handleSubmitted}
        onConfirmed={handleConfirmed}
        onError={handleError}
      />}
    </div>
  )
}
