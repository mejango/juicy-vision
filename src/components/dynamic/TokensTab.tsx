import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { formatEther, formatUnits, createPublicClient, http, erc20Abi } from 'viem'
import { useThemeStore } from '../../stores'
import {
  fetchProject,
  fetchProjectWithRuleset,
  fetchProjectTokenSymbol,
  fetchProjectTokenAddress,
  fetchProjectTokenSupply,
  fetchConnectedChains,
  fetchProjectSplits,
  fetchPendingReservedTokens,
  type Project,
  type ConnectedChain,
  type JBSplitData,
  type ProjectRuleset,
} from '../../services/bendystraw'
import { resolveEnsName, truncateAddress } from '../../utils/ens'
import { VIEM_CHAINS, RPC_ENDPOINTS, CHAINS, type SupportedChainId } from '../../constants'
import { SendReservedTokensModal } from '../payment'
import HoldersChart from './charts/HoldersChart'

interface TokensTabProps {
  projectId: string
  chainId: string
  isOwner?: boolean // Unused but kept for interface compatibility
}

// Chain info for display
const CHAIN_INFO: Record<number, { name: string; shortName: string; color: string }> = {
  1: { name: 'Ethereum', shortName: 'ETH', color: '#627EEA' },
  10: { name: 'Optimism', shortName: 'OP', color: '#FF0420' },
  8453: { name: 'Base', shortName: 'BASE', color: '#0052FF' },
  42161: { name: 'Arbitrum', shortName: 'ARB', color: '#28A0F0' },
}

// Per-chain token data
interface ChainTokenData {
  chainId: number
  projectId: number
  tokenAddress: string | null
  totalSupply: string
  pendingReserved: string
  reservedSplits: JBSplitData[]
  reservedPercent: number
  ruleset: ProjectRuleset | null
}

function formatTokenAmount(wei: string): string {
  try {
    const num = parseFloat(formatEther(BigInt(wei)))
    if (num === 0) return '0'
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 })
  } catch {
    return '0'
  }
}

export default function TokensTab({ projectId, chainId, isOwner }: TokensTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address, isConnected } = useAccount()

  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState<Project | null>(null)
  const [tokenSymbol, setTokenSymbol] = useState<string>('TOKEN')
  const [tokenAddress, setTokenAddress] = useState<string | null>(null)
  const [totalSupply, setTotalSupply] = useState<string>('0')
  const [userBalance, setUserBalance] = useState<string>('0')
  const [chainTokenData, setChainTokenData] = useState<ChainTokenData[]>([])
  const [selectedChainId, setSelectedChainId] = useState<number>(parseInt(chainId))
  const [showSplits, setShowSplits] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [splitEnsNames, setSplitEnsNames] = useState<Record<string, string>>({})

  const chainIdNum = parseInt(chainId)
  const chain = CHAINS[chainIdNum]

  // Get active chain data
  const activeChainData = chainTokenData.find(cd => cd.chainId === selectedChainId) || chainTokenData[0]
  const isOmnichain = chainTokenData.length > 1

  // Calculate pending tokens
  const pendingTokens = activeChainData
    ? parseFloat(activeChainData.pendingReserved) / 1e18
    : 0

  // Total pending across all chains
  const totalPendingAcrossChains = chainTokenData.reduce((sum, cd) => {
    return sum + parseFloat(cd.pendingReserved) / 1e18
  }, 0)

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)

        // Fetch project and token info
        const [projectData, symbol, connectedChains] = await Promise.all([
          fetchProject(projectId, chainIdNum),
          fetchProjectTokenSymbol(projectId, chainIdNum),
          fetchConnectedChains(projectId, chainIdNum),
        ])

        setProject(projectData)
        setTokenSymbol(symbol || 'TOKEN')

        // Determine chains to fetch
        const chainsToFetch: ConnectedChain[] = connectedChains.length > 0
          ? connectedChains
          : [{ chainId: chainIdNum, projectId: parseInt(projectId) }]

        // Fetch token data from all chains in parallel
        const chainDataPromises = chainsToFetch.map(async (chain): Promise<ChainTokenData> => {
          try {
            const [pendingReserved, chainProject, supply, tokenAddr] = await Promise.all([
              fetchPendingReservedTokens(String(chain.projectId), chain.chainId),
              fetchProjectWithRuleset(String(chain.projectId), chain.chainId),
              fetchProjectTokenSupply(String(chain.projectId), chain.chainId),
              fetchProjectTokenAddress(String(chain.projectId), chain.chainId),
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
              tokenAddress: tokenAddr || null,
              totalSupply: supply || '0',
              pendingReserved,
              reservedSplits,
              reservedPercent: chainProject?.currentRuleset?.reservedPercent || 0,
              ruleset: chainProject?.currentRuleset || null,
            }
          } catch (err) {
            console.error(`Failed to fetch token data for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              tokenAddress: null,
              totalSupply: '0',
              pendingReserved: '0',
              reservedSplits: [],
              reservedPercent: 0,
              ruleset: null,
            }
          }
        })

        const allChainData = await Promise.all(chainDataPromises)
        setChainTokenData(allChainData)

        // Set token address and supply from primary chain
        const primaryChainData = allChainData.find(cd => cd.chainId === chainIdNum)
        if (primaryChainData) {
          setTokenAddress(primaryChainData.tokenAddress)
          setTotalSupply(primaryChainData.totalSupply)
        }

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
        console.error('Failed to load token data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainId, chainIdNum])

  // Fetch user's token balance when connected
  useEffect(() => {
    async function fetchUserBalance() {
      if (!address || !tokenAddress) {
        setUserBalance('0')
        return
      }

      try {
        const viemChain = VIEM_CHAINS[chainIdNum as SupportedChainId]
        if (!viemChain) return

        const rpcUrl = RPC_ENDPOINTS[chainIdNum]?.[0]
        const publicClient = createPublicClient({
          chain: viemChain,
          transport: http(rpcUrl),
        })

        const balance = await publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        })

        setUserBalance(balance.toString())
      } catch (err) {
        console.error('Failed to fetch user token balance:', err)
        setUserBalance('0')
      }
    }

    fetchUserBalance()
  }, [address, tokenAddress, chainIdNum])

  const reservedPercent = activeChainData?.reservedPercent || 0
  const hasPendingTokens = pendingTokens > 0

  if (loading) {
    return (
      <div className={`p-4 border animate-pulse ${
        isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className={`h-5 w-32 mb-4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        <div className="space-y-3">
          <div className={`h-4 w-40 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className={`h-4 w-48 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className={`h-4 w-36 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Your Balance */}
      {isConnected && (
        <div className={`p-4 border ${
          isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
        }`}>
          <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Your Balance
          </div>
          <div className={`text-lg font-mono font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {formatTokenAmount(userBalance)} ${tokenSymbol}
          </div>
        </div>
      )}

      {/* Project Token Info */}
      <div className={`p-4 border ${
        isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
      }`}>
        <h3 className={`text-sm font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Project Token
        </h3>

        <div className="space-y-3">
          {/* Token symbol and ERC-20 badge */}
          <div className="flex items-center gap-2">
            <span className={`text-lg font-mono font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              ${tokenSymbol}
            </span>
            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
              isDark ? 'bg-juice-cyan/20 text-juice-cyan' : 'bg-cyan-100 text-cyan-700'
            }`}>
              ERC-20
            </span>
          </div>

          {/* Token address */}
          {tokenAddress && (
            <div className="flex items-center gap-2">
              <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Contract:
              </span>
              <a
                href={chain ? `${chain.explorer}/token/${tokenAddress}` : '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={`font-mono text-xs hover:underline ${
                  isDark ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tokenAddress.slice(0, 6)}...{tokenAddress.slice(-4)}
              </a>
              <button
                onClick={() => navigator.clipboard.writeText(tokenAddress)}
                className={`p-1 transition-colors ${
                  isDark ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-600'
                }`}
                title="Copy address"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          )}

          {/* Total supply */}
          <div className="flex items-center justify-between">
            <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Total Supply
            </span>
            <span className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {formatTokenAmount(totalSupply)}
            </span>
          </div>
        </div>
      </div>

      {/* Reserved Tokens Section */}
      <div className={`p-4 border ${
        isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
      }`}>
        <h3 className={`text-sm font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Reserved Tokens
        </h3>

        {/* Chain selector for omnichain */}
        {isOmnichain && (
          <div className="flex items-center gap-1 flex-wrap mb-4">
            {chainTokenData.map(cd => {
              const chainInfo = CHAIN_INFO[cd.chainId]
              if (!chainInfo) return null
              const isSelected = selectedChainId === cd.chainId
              const hasPending = BigInt(cd.pendingReserved) > 0n
              return (
                <button
                  key={cd.chainId}
                  onClick={() => setSelectedChainId(cd.chainId)}
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
                    style={{ backgroundColor: chainInfo.color }}
                  />
                  {chainInfo.shortName}
                  {hasPending && (
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" title="Has pending tokens" />
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Reserved rate */}
        <div className="flex items-center justify-between mb-3">
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Reserved Rate
          </span>
          <span className={`text-sm font-mono ${reservedPercent > 0 ? 'text-amber-400' : isDark ? 'text-white' : 'text-gray-900'}`}>
            {(reservedPercent / 100).toFixed(1)}%
          </span>
        </div>

        {/* Pending reserved tokens */}
        <div className={`p-3 mb-3 ${
          hasPendingTokens
            ? isDark ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-amber-50 border border-amber-200'
            : isDark ? 'bg-white/5' : 'bg-gray-100'
        }`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${
              hasPendingTokens
                ? isDark ? 'text-amber-300' : 'text-amber-700'
                : isDark ? 'text-gray-400' : 'text-gray-500'
            }`}>
              Pending Distribution
            </span>
            <div className="flex items-center gap-2">
              <span className={`font-mono text-sm ${hasPendingTokens ? 'text-amber-400' : isDark ? 'text-white' : 'text-gray-900'}`}>
                {pendingTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenSymbol}
              </span>
              {hasPendingTokens && (
                <button
                  onClick={() => setShowModal(true)}
                  className={`px-2 py-0.5 text-xs font-medium transition-colors ${
                    isDark
                      ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                      : 'bg-amber-200 text-amber-800 hover:bg-amber-300'
                  }`}
                >
                  Distribute
                </button>
              )}
            </div>
          </div>
          {hasPendingTokens && (
            <div className={`text-xs mt-1 ${isDark ? 'text-amber-400/70' : 'text-amber-600'}`}>
              Reserved ${tokenSymbol} waiting to be sent to recipients
            </div>
          )}
        </div>

        {/* Reserved token recipients */}
        {activeChainData && activeChainData.reservedSplits.length > 0 && (
          <div className={`border-t pt-3 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <button
              onClick={() => setShowSplits(!showSplits)}
              className={`flex items-center justify-between w-full text-sm ${
                isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <span>Recipients ({activeChainData.reservedSplits.length})</span>
              <svg
                className={`w-4 h-4 transition-transform ${showSplits ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showSplits && (
              <div className="mt-2 space-y-2">
                {activeChainData.reservedSplits.map((split, idx) => {
                  const percent = (split.percent / 10000000).toFixed(2)
                  const beneficiary = split.beneficiary?.toLowerCase() || ''
                  const displayName = splitEnsNames[beneficiary] || truncateAddress(split.beneficiary || '')

                  return (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className={`font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        {split.projectId > 0 ? (
                          `Project #${split.projectId}`
                        ) : (
                          displayName
                        )}
                      </span>
                      <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {percent}%
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Token Holders Chart */}
      <HoldersChart projectId={projectId} chainId={chainId} limit={10} />

      {/* Send Reserved Tokens Modal */}
      {showModal && activeChainData && (
        <SendReservedTokensModal
          isOpen
          onClose={() => setShowModal(false)}
          projectId={projectId}
          projectName={project?.name || `Project #${projectId}`}
          chainId={selectedChainId}
          tokenSymbol={tokenSymbol}
          amount={activeChainData.pendingReserved}
          reservedRate={reservedPercent / 100}
          allChainProjects={chainTokenData.map(cd => ({ chainId: cd.chainId, projectId: cd.projectId }))}
        />
      )}
    </div>
  )
}
