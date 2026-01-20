import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import {
  fetchProject,
  fetchProjectTokenAddress,
  fetchProjectTokenSymbol,
  fetchConnectedChains,
  type Project,
  type ConnectedChain,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { DeployERC20Modal } from '../payment'

interface DeployERC20FormProps {
  projectId: string
  chainId?: string
}

// Chain info for display
const CHAIN_INFO: Record<number, { name: string; shortName: string; slug: string; color: string }> = {
  1: { name: 'Ethereum', shortName: 'ETH', slug: 'eth', color: '#627EEA' },
  10: { name: 'Optimism', shortName: 'OP', slug: 'op', color: '#FF0420' },
  8453: { name: 'Base', shortName: 'BASE', slug: 'base', color: '#0052FF' },
  42161: { name: 'Arbitrum', shortName: 'ARB', slug: 'arb', color: '#28A0F0' },
}

// Per-chain token data
interface ChainTokenData {
  chainId: number
  projectId: number
  tokenAddress: string | null
  tokenSymbol: string | null
}

// Inline chain selector component
function InlineChainSelector({
  chainData,
  selectedChainId,
  onSelect,
  isDark,
}: {
  chainData: ChainTokenData[]
  selectedChainId: number | null
  onSelect: (chainId: number) => void
  isDark: boolean
}) {
  // Only show chains that don't have a token deployed
  const deployCandidates = chainData.filter(cd => !cd.tokenAddress)
  if (deployCandidates.length <= 1) return null

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {deployCandidates.map(cd => {
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

export default function DeployERC20Form({ projectId, chainId = '1' }: DeployERC20FormProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [tokenName, setTokenName] = useState('')
  const [tokenSymbol, setTokenSymbol] = useState('')
  const [showModal, setShowModal] = useState(false)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const { isConnected } = useAccount()

  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  // Omnichain state
  const [chainTokenData, setChainTokenData] = useState<ChainTokenData[]>([])
  const [selectedChainId, setSelectedChainId] = useState<number>(parseInt(chainId))

  // Check if all chains have tokens deployed
  const allChainsHaveTokens = chainTokenData.length > 0 && chainTokenData.every(cd => cd.tokenAddress)
  const hasAnyTokenDeployed = chainTokenData.some(cd => cd.tokenAddress)

  // Get chains without tokens
  const chainsWithoutTokens = chainTokenData.filter(cd => !cd.tokenAddress)
  const chainsWithTokens = chainTokenData.filter(cd => cd.tokenAddress)

  // Get active chain data
  const activeChainData = chainTokenData.find(cd => cd.chainId === selectedChainId)
  const chainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO[1]

  // Fetch project data and token status for all chains
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

        // Pre-fill token name from project name
        if (projectData.name) {
          setTokenName(projectData.name)
        }

        // Determine chains to check
        const chainsToCheck: ConnectedChain[] = connectedChains.length > 0
          ? connectedChains
          : [{ chainId: primaryChainId, projectId: parseInt(projectId) }]

        // Check token status on all chains in parallel
        const tokenDataPromises = chainsToCheck.map(async (chain): Promise<ChainTokenData> => {
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
        const firstWithoutToken = allTokenData.find(td => !td.tokenAddress)
        if (firstWithoutToken) {
          setSelectedChainId(firstWithoutToken.chainId)
        } else {
          setSelectedChainId(primaryChainId)
        }

      } catch (err) {
        console.error('Failed to load project:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainId])

  const handleDeploy = () => {
    if (!tokenName.trim() || !tokenSymbol.trim()) return

    if (!isConnected) {
      openWalletPanel()
      return
    }

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
            <div className="w-14 h-14 bg-juice-cyan/20 flex items-center justify-center">
              <span className="text-2xl">🪙</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Deploy ERC-20 Token
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

        {/* Chain Selector for chains without tokens */}
        {chainsWithoutTokens.length > 1 && (
          <div className="mb-3">
            <div className={`text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Deploy on:
            </div>
            <InlineChainSelector
              chainData={chainTokenData}
              selectedChainId={selectedChainId}
              onSelect={setSelectedChainId}
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
              className={`w-full px-3 py-2 text-sm outline-none ${
                isDark
                  ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                  : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
              }`}
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
                className={`flex-1 px-3 py-2 text-sm font-mono outline-none uppercase ${
                  isDark
                    ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-500'
                    : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
                } ${tokenSymbol && !isValidSymbol ? 'border-red-500' : ''}`}
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
            disabled={!isValidName || !isValidSymbol}
            className={`w-full py-3 text-sm font-medium transition-colors ${
              !isValidName || !isValidSymbol
                ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                : 'bg-juice-cyan hover:bg-juice-cyan/90 text-black'
            }`}
          >
            Deploy ${tokenSymbol || 'TOKEN'}
          </button>
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
      />
    </div>
  )
}
