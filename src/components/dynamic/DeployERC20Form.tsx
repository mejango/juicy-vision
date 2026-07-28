import { useState, useEffect, useCallback } from 'react'
import { defaultChainId } from '../../config/environment'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useDeployERC20FormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchProjectTokenAddress,
  fetchProjectTokenSymbol,
  type Project,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { MAINNET_CHAINS } from '../../constants'
import { DeployERC20Modal } from '../payment'
import InlineChainSelector from './InlineChainSelector'
import { ProjectLink } from './ProjectLink'
import { useManagedWallet } from '../../hooks'
import { resolveProjectChains } from '../../utils/projectChains'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'

interface DeployERC20FormProps {
  projectId: string
  chainId?: string
  messageId?: string // For persisting state to server (visible to all chat users)
}

// Chain info for display
const CHAIN_INFO = MAINNET_CHAINS

// Per-chain token data
interface ChainTokenData {
  chainId: number
  projectId: number
  tokenAddress: string | null
  tokenSymbol: string | null
  configurationError?: string
}

export default function DeployERC20Form({ projectId, chainId = defaultChainId(), messageId }: DeployERC20FormProps) {
  // Persistent state (visible to all chat users)
  const { state: persistedState, updateState: updatePersistedState } = useDeployERC20FormState(messageId)

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tokenName, setTokenName] = useState('')
  const [tokenSymbol, setTokenSymbol] = useState('')
  const [showModal, setShowModal] = useState(false)
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
      if (persistedState.tokenName) setTokenName(persistedState.tokenName)
      if (persistedState.tokenSymbol) setTokenSymbol(persistedState.tokenSymbol)
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
  const [chainTokenData, setChainTokenData] = useState<ChainTokenData[]>([])
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [selectedChainId, setSelectedChainId] = useState<number>(parseInt(chainId))

  // Check if all chains have tokens deployed
  const allChainsHaveTokens = chainTokenData.length > 0 && chainTokenData.every(cd => cd.tokenAddress && !cd.configurationError)
  const hasAnyTokenDeployed = chainTokenData.some(cd => cd.tokenAddress)
  const configurationErrors = chainTokenData.filter(cd => cd.configurationError)

  // Get chains without tokens
  const chainsWithoutTokens = chainTokenData.filter(cd => !cd.tokenAddress && !cd.configurationError)
  const chainsWithTokens = chainTokenData.filter(cd => cd.tokenAddress)

  // Get active chain data
  const activeChainData = chainTokenData.find(cd => cd.chainId === selectedChainId)
  const chainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO[1]

  // Fetch project data and token status for all chains
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        setLoadError(null)
        setProject(null)
        setChainTokenData([])
        const primaryChainId = parseInt(chainId)

        // Fetch project and connected chains
        const [projectData, chainResolution] = await Promise.all([
          fetchProject(projectId, primaryChainId),
          resolveProjectChains(projectId, primaryChainId),
        ])
        setProject(projectData)
        setChainMappingAvailable(chainResolution.mappingAvailable)

        // Pre-fill token name from project name
        if (projectData.name) {
          setTokenName(projectData.name)
        }

        // Check token status on all chains in parallel
        const tokenDataPromises = chainResolution.chains.map(async (chain): Promise<ChainTokenData> => {
          try {
            const [tokenAddress, tokenSymbol] = await Promise.all([
              fetchProjectTokenAddress(String(chain.projectId), chain.chainId),
              fetchProjectTokenSymbol(String(chain.projectId), chain.chainId),
            ])

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              tokenAddress,
              tokenSymbol,
            }
          } catch (err) {
            console.error(`Failed to fetch token data for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              tokenAddress: null,
              tokenSymbol: null,
              configurationError: err instanceof Error ? err.message : 'Token configuration unavailable',
            }
          }
        })

        const allTokenData = await Promise.all(tokenDataPromises)
        setChainTokenData(allTokenData)

        // Pre-fill symbol if one chain has it deployed
        const existingSymbol = allTokenData.find(td => td.tokenSymbol)?.tokenSymbol
        if (existingSymbol) {
          setTokenSymbol(existingSymbol)
        }

        // Select first chain without a token
        const firstWithoutToken = allTokenData.find(td => !td.tokenAddress && !td.configurationError)
        if (firstWithoutToken) {
          setSelectedChainId(firstWithoutToken.chainId)
        } else {
          setSelectedChainId(primaryChainId)
        }

      } catch (err) {
        console.error('Failed to load project:', err)
        setLoadError(err instanceof Error ? err.message : 'Project configuration unavailable')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainId])

  const handleDeploy = () => {
    if (!tokenName.trim() || !tokenSymbol.trim() || isLocked || loadError || !activeChainData || activeChainData.configurationError) return

    if (!hasActiveWallet) {
      openWalletPanel()
      return
    }

    // Save reviewed inputs without claiming a transaction exists yet.
    updatePersistedState({
      status: 'pending',
      tokenName: tokenName.trim(),
      tokenSymbol: tokenSymbol.trim(),
      selectedChainId,
      submittedAt: new Date().toISOString(),
    })

    setShowModal(true)
  }

  // Validate symbol (typically 2-5 uppercase letters)
  const isValidSymbol = /^[A-Z0-9]{2,10}$/i.test(tokenSymbol.trim())
  const isValidName = tokenName.trim().length >= 1

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

  // If all chains have tokens deployed, show success state
  if (allChainsHaveTokens) {
    return (
      <div className="w-full">
        <div className={`max-w-md border p-4 ${
          isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
        }`}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 bg-emerald-500/20 flex items-center justify-center">
              <span className="text-2xl">✓</span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                ERC-20 Token Deployed
              </h3>
              <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {project?.name || `Project #${projectId}`}
              </span>
            </div>
          </div>

          <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            {chainTokenData.map(cd => {
              const chain = CHAIN_INFO[cd.chainId]
              return (
                <div key={cd.chainId} className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: chain?.color || '#888' }}
                    />
                    <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {chain?.name || `Chain ${cd.chainId}`}
                    </span>
                  </div>
                  <span className={`font-mono text-sm font-medium ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                    ${cd.tokenSymbol}
                  </span>
                </div>
              )
            })}
          </div>
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
              <span className="text-2xl">🪙</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Deploy ERC-20 Token
            </h3>
            <ProjectLink chainSlug={chainInfo.slug} projectId={projectId} className={`text-xs hover:underline ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}>
              {project?.name || `Project #${projectId}`}
            </ProjectLink>
          </div>
        </div>

        {/* Show existing tokens on other chains */}
        {hasAnyTokenDeployed && (
          <div className={`p-3 mb-3 ${isDark ? 'bg-emerald-500/10' : 'bg-emerald-50'}`}>
            <div className={`text-xs font-medium mb-2 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
              Token deployed on:
            </div>
            <div className="flex flex-wrap gap-2">
              {chainsWithTokens.map(cd => {
                const chain = CHAIN_INFO[cd.chainId]
                return (
                  <div
                    key={cd.chainId}
                    className={`inline-flex items-center gap-1 px-2 py-1 text-xs ${
                      isDark ? 'bg-white/10 text-white' : 'bg-white text-gray-700'
                    }`}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: chain?.color || '#888' }}
                    />
                    {chain?.shortName || cd.chainId}
                    <span className="font-mono text-emerald-500">${cd.tokenSymbol}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {configurationErrors.length > 0 && (
          <div className={`p-3 mb-3 text-xs ${
            isDark
              ? 'border border-red-500/40 bg-red-500/10 text-red-300'
              : 'border border-red-300 bg-red-50 text-red-800'
          }`}>
            Token status could not be verified on {configurationErrors.map(cd => CHAIN_INFO[cd.chainId]?.name || `chain ${cd.chainId}`).join(', ')}. Deployment is blocked on those chains.
          </div>
        )}

        {loadError && (
          <div className={`p-3 mb-3 text-xs border ${
            isDark
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}>
            Token deployment is unavailable because project configuration could not be verified.
          </div>
        )}

        {/* Chain Selector for chains without tokens */}
        {chainsWithoutTokens.length > 1 && (
          <div className="mb-3">
            <div className={`text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Deploy on:
            </div>
            <InlineChainSelector
              options={chainsWithoutTokens.map(cd => ({
                key: cd.chainId,
                chainId: cd.chainId,
                selected: selectedChainId === cd.chainId,
              }))}
              onSelect={option => setSelectedChainId(option.chainId)}
              isDark={isDark}
            />
          </div>
        )}

        {/* Form */}
        <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          {/* Token Name */}
          <div className="mb-3">
            <label className={`block text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Token Name
            </label>
            <input
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder="e.g., Bananapus"
              disabled={isLocked}
              className={`w-full px-3 py-2 text-sm outline-none ${
                isDark
                  ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                  : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
              } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
          </div>

          {/* Token Symbol */}
          <div className="mb-3">
            <label className={`block text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Token Symbol
            </label>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>$</span>
              <input
                type="text"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                placeholder="e.g., NANA"
                maxLength={10}
                disabled={isLocked}
                className={`flex-1 px-3 py-2 text-sm font-mono outline-none uppercase ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                } ${tokenSymbol && !isValidSymbol ? 'border-red-500' : ''} ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
            </div>
            {tokenSymbol && !isValidSymbol && (
              <p className="text-xs text-red-400 mt-1">
                Symbol must be 2-10 alphanumeric characters
              </p>
            )}
          </div>

          {/* Deploy Button */}
          <button
            onClick={handleDeploy}
            disabled={!isValidName || !isValidSymbol || isLocked || !!loadError || !activeChainData || !!activeChainData.configurationError}
            className={`w-full py-3 text-sm font-medium transition-colors ${
              !isValidName || !isValidSymbol || isLocked || loadError || !activeChainData || activeChainData.configurationError
                ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                : 'bg-juice-cyan hover:bg-juice-cyan/90 text-black'
            }`}
          >
            {persistedState?.status === 'completed' ? 'Deployed' : persistedState?.status === 'in_progress' ? 'Pending...' : `Deploy $${tokenSymbol || 'TOKEN'}`}
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
                    <span>Token deployed successfully!</span>
                  </>
                ) : persistedState?.status === 'failed' ? (
                  <>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span>Deployment failed</span>
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
                  href={`${CHAIN_INFO[selectedChainId]?.explorerTx || 'https://etherscan.io/tx/'}${persistedState.txHash}`}
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
        </div>

        {/* Info */}
        <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Deploying an ERC-20 allows token holders to transfer tokens to other wallets.
          Once deployed, the name and symbol cannot be changed.
        </p>
      </div>

      {/* Modal */}
      <DeployERC20Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        projectId={activeChainData?.projectId ? String(activeChainData.projectId) : projectId}
        projectName={project?.name}
        chainId={selectedChainId}
        tokenName={tokenName.trim()}
        tokenSymbol={tokenSymbol.trim()}
        onSubmitted={handleSubmitted}
        onConfirmed={handleConfirmed}
        onError={handleError}
      />
    </div>
  )
}
