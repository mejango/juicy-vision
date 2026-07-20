import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from 'wagmi'
import { formatEther } from 'viem'
import { useThemeStore } from '../../stores'
import {
  fetchProject,
  fetchProjectWithRuleset,
  fetchProjectTokenSymbol,
  fetchProjectTokenAddress,
  fetchProjectTokenSupply,
  fetchProjectSplits,
  fetchPendingReservedTokens,
  fetchUserTokenBalance,
  isRevnetProject,
  type Project,
  type JBSplitData,
  type ProjectRuleset,
} from '../../services/bendystraw'
import { resolveEnsName, truncateAddress } from '../../utils/ens'
import { CHAINS, MAINNET_CHAINS } from '../../constants'
import SendReservedTokensForm from './SendReservedTokensForm'
import HoldersChart from './charts/HoldersChart'
import PriceChart from './PriceChart'
import { ExplainerMessage } from '../ui/ExplainerMessage'
import { resolveProjectChains } from '../../utils/projectChains'
import { ChainMappingWarning } from './ChainMappingWarning'
import { ProjectSplitRoute } from './ProjectSplitRoute'

interface TokensTabProps {
  projectId: string
  chainId: string
  isOwner?: boolean
  onDeployErc20?: () => void
}

// Chain info for display (ALL CAPS for symbols)
const CHAIN_INFO: Record<number, { name: string; shortName: string; color: string }> = {
  1: { name: 'Ethereum', shortName: 'ETH', color: '#627EEA' },
  10: { name: 'Optimism', shortName: 'OP', color: '#FF0420' },
  8453: { name: 'Base', shortName: 'BASE', color: '#0052FF' },
  42161: { name: 'Arbitrum', shortName: 'ARB', color: '#28A0F0' },
  11155111: { name: 'Sepolia', shortName: 'SEP', color: '#627EEA' },
  11155420: { name: 'OP Sepolia', shortName: 'OP-SEP', color: '#FF0420' },
  84532: { name: 'Base Sepolia', shortName: 'BASE-SEP', color: '#0052FF' },
  421614: { name: 'Arb Sepolia', shortName: 'ARB-SEP', color: '#28A0F0' },
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
  configurationError?: string
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
    return 'Unavailable'
  }
}

export default function TokensTab({ projectId, chainId, isOwner, onDeployErc20 }: TokensTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address, isConnected } = useAccount()

  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState<Project | null>(null)
  const [tokenSymbol, setTokenSymbol] = useState<string>('TOKEN')
  const [tokenAddress, setTokenAddress] = useState<string | null>(null)
  const [userBalance, setUserBalance] = useState<string>('0')
  const [userBalanceByChain, setUserBalanceByChain] = useState<Record<number, string>>({})
  const [chainTokenData, setChainTokenData] = useState<ChainTokenData[]>([])
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const selectedChainId = parseInt(chainId)
  const [showSplits, setShowSplits] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [splitEnsNames, setSplitEnsNames] = useState<Record<string, string>>({})
  const [showReservedBreakdown, setShowReservedBreakdown] = useState(false)
  const [showIssuedBreakdown, setShowIssuedBreakdown] = useState(false)
  const [showBalanceBreakdown, setShowBalanceBreakdown] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [userBalanceAvailable, setUserBalanceAvailable] = useState(false)
  const [userBalanceLoading, setUserBalanceLoading] = useState(false)

  const chainIdNum = parseInt(chainId)
  const chain = CHAINS[chainIdNum] || MAINNET_CHAINS[chainIdNum]

  // Get active chain data
  const activeChainData = chainTokenData.find(cd => cd.chainId === selectedChainId) || chainTokenData[0]
  const isOmnichain = chainTokenData.length > 1
  const tokenDataComplete = chainTokenData.length > 0 && chainTokenData.every(cd => !cd.configurationError)

  // Cross-chain aggregate supply (project token is always 18 decimals). The headline
  // shows the omnichain total; the per-chain "Breakdown" is the disclosure.
  const totalSupplyAllChains = chainTokenData
    .reduce((sum, cd) => sum + BigInt(cd.totalSupply || '0'), 0n)
    .toString()

  // Total pending across all chains
  const totalPendingAcrossChains = chainTokenData.reduce((sum, cd) => {
    return sum + parseFloat(cd.pendingReserved) / 1e18
  }, 0)

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        setLoadError(null)

        // Fetch project and token info
        const [projectData, symbol, chainResolution] = await Promise.all([
          fetchProject(projectId, chainIdNum),
          fetchProjectTokenSymbol(projectId, chainIdNum),
          resolveProjectChains(projectId, chainIdNum),
        ])

        setProject(projectData)
        setTokenSymbol(symbol || 'TOKEN')
        setChainMappingAvailable(chainResolution.mappingAvailable)

        // Fetch token data from all chains in parallel
        const chainDataPromises = chainResolution.chains.map(async (chain): Promise<ChainTokenData> => {
          try {
            const [pendingReserved, chainProject, supply, tokenAddr] = await Promise.all([
              fetchPendingReservedTokens(String(chain.projectId), chain.chainId),
              fetchProjectWithRuleset(String(chain.projectId), chain.chainId),
              fetchProjectTokenSupply(String(chain.projectId), chain.chainId),
              fetchProjectTokenAddress(String(chain.projectId), chain.chainId),
            ])

            if (!chainProject) throw new Error('Current project ruleset could not be verified')
            if (supply === null) throw new Error('Project token supply could not be verified')

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
            }

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              tokenAddress: tokenAddr || null,
              totalSupply: supply,
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
              configurationError: err instanceof Error ? err.message : 'Token configuration unavailable',
            }
          }
        })

        const allChainData = await Promise.all(chainDataPromises)
        setChainTokenData(allChainData)

        // Token contract address for the display/copy link. The CREATE2 address is
        // identical across chains; use the primary chain's for the explorer link.
        const primaryChainData = allChainData.find(cd => cd.chainId === chainIdNum)
        if (primaryChainData) {
          setTokenAddress(primaryChainData.tokenAddress)
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
        setLoadError(err instanceof Error ? err.message : 'Token data unavailable')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainId, chainIdNum])

  // Fetch the user's token balance across ALL connected chains and sum them.
  // The project token is deployed at the same deterministic CREATE2 address on every
  // chain, but each chain holds an independent balance — read balanceOf per chain and
  // aggregate so an omnichain holder sees their true total. Always 18 decimals.
  useEffect(() => {
    async function fetchUserBalance() {
      if (!address || chainTokenData.length === 0) {
        setUserBalance('0')
        setUserBalanceByChain({})
        setUserBalanceAvailable(true)
        setUserBalanceLoading(false)
        return
      }

      try {
        setUserBalanceLoading(true)
        setUserBalanceAvailable(false)
        const results = await Promise.all(
          chainTokenData.map(async (cd): Promise<{ chainId: number; balance: bigint }> => {
            if (cd.configurationError) throw new Error(cd.configurationError)
            const participant = await fetchUserTokenBalance(String(cd.projectId), cd.chainId, address)
            return { chainId: cd.chainId, balance: BigInt(participant.balance) }
          })
        )

        let total = 0n
        const byChain: Record<number, string> = {}
        results.forEach(({ chainId, balance }) => {
          total += balance
          byChain[chainId] = balance.toString()
        })

        setUserBalance(total.toString())
        setUserBalanceByChain(byChain)
        setUserBalanceAvailable(true)
      } catch (err) {
        console.error('Failed to fetch user token balance:', err)
        setUserBalance('0')
        setUserBalanceByChain({})
        setUserBalanceAvailable(false)
      } finally {
        setUserBalanceLoading(false)
      }
    }

    fetchUserBalance()
  }, [address, chainTokenData])

  const reservedPercent = tokenDataComplete ? activeChainData?.reservedPercent || 0 : 0
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
      <ExplainerMessage>
        Membership is represented on blockchains to make agreements permanent.
      </ExplainerMessage>

      {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}

      {(loadError || !tokenDataComplete) && (
        <div className={`border p-3 text-sm ${
          isDark ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800'
        }`}>
          Token information is unavailable because every project chain could not be verified.
        </div>
      )}

      {/* Project Token Info */}
      <div className={`p-4 border ${
        isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
      }`}>
        <h3 className={`text-sm font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Membership accounting
        </h3>
        <p className={`text-xs mb-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Here's how membership is tracked.
        </p>

        <div className="space-y-3">
          {/* Token symbol with chain indicators; no symbol exists while balances are credits */}
          <div className="flex items-center gap-2 flex-wrap">
            {tokenAddress ? (
              <span className={`text-lg font-mono font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {tokenSymbol}
              </span>
            ) : (
              <span className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Project credits
              </span>
            )}
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>on</span>
              {chainTokenData.map(cd => {
                const chainInfo = CHAIN_INFO[cd.chainId]
                if (!chainInfo) return null
                return (
                  <span
                    key={cd.chainId}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${
                      isDark ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'
                    }`}
                    title={chainInfo.name}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: chainInfo.color }}
                    />
                    {chainInfo.shortName}
                  </span>
                )
              })}
            </div>
          </div>

          {/* Token address */}
          {!tokenAddress && (
            <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              <span>
                No ERC-20 yet. Balances are internal Juicebox credits — they can still be cashed out, and deploying an ERC-20 later makes them transferable.
              </span>
              {isOwner && onDeployErc20 && (
                <button
                  onClick={onDeployErc20}
                  className={`ml-2 border px-2 py-0.5 text-xs font-medium transition-colors ${
                    isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-300 text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  Deploy ERC-20
                </button>
              )}
            </div>
          )}
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
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Total issued
              </span>
              <span className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {tokenDataComplete ? formatTokenAmount(totalSupplyAllChains) : 'Unavailable'}
              </span>
            </div>
            {/* Per-chain breakdown */}
            {isOmnichain && (
              <div className="mt-2">
                <button
                  onClick={() => setShowIssuedBreakdown(!showIssuedBreakdown)}
                  className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
                >
                  <span>Breakdown</span>
                  <svg
                    className={`w-3 h-3 transition-transform ${showIssuedBreakdown ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showIssuedBreakdown && (
                  <div className="mt-2 space-y-1">
                    {chainTokenData.map(cd => {
                      const chainInfo = CHAIN_INFO[cd.chainId]
                      if (!chainInfo) return null
                      return (
                        <div key={cd.chainId} className="flex items-center gap-3">
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: chainInfo.color }}
                          />
                          <span className={`text-xs w-10 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            {chainInfo.shortName}
                          </span>
                          <span className={`text-xs font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                            {cd.configurationError ? 'Unavailable' : formatTokenAmount(cd.totalSupply)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Your membership - only shown when connected. Balance is the cross-chain sum. */}
          {isConnected && (
            <div className={`pt-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Your membership
                  </span>
                  <span className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {userBalanceLoading
                      ? 'Loading…'
                      : userBalanceAvailable ? formatTokenAmount(userBalance) : 'Unavailable'}
                  </span>
                </div>
              </div>
              {/* Per-chain balance breakdown for omnichain holders */}
              {isOmnichain && userBalanceAvailable && parseFloat(userBalance) > 0 && (
                <div className="mt-2">
                  <button
                    onClick={() => setShowBalanceBreakdown(!showBalanceBreakdown)}
                    className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
                  >
                    <span>Breakdown</span>
                    <svg
                      className={`w-3 h-3 transition-transform ${showBalanceBreakdown ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showBalanceBreakdown && (
                    <div className="mt-2 space-y-1">
                      {chainTokenData.map(cd => {
                        const chainInfo = CHAIN_INFO[cd.chainId]
                        if (!chainInfo) return null
                        return (
                          <div key={cd.chainId} className="flex items-center gap-3">
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: chainInfo.color }}
                            />
                            <span className={`text-xs w-10 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                              {chainInfo.shortName}
                            </span>
                            <span className={`text-xs font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                              {userBalanceByChain[cd.chainId] === undefined
                                ? 'Unavailable'
                                : formatTokenAmount(userBalanceByChain[cd.chainId])}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reserved Tokens Section */}
      <div className={`p-4 border ${
        isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
      }`}>
        {/* Header with reserved rate */}
        <h3 className={`text-sm font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Reserved membership: <span className={`font-mono ${reservedPercent > 0 ? 'text-amber-400' : isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {tokenDataComplete ? `${(reservedPercent / 100).toFixed(0)}%` : 'Unavailable'}
          </span>
        </h3>

        {/* Description */}
        <p className={`text-xs mb-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {tokenDataComplete
            ? <>A portion of new membership is currently set aside for recipients below.{isRevnetProject(project) && ' These recipients are locked in and cannot be changed.'}</>
            : 'Reserved membership settings could not be verified.'}
        </p>

        {/* Check for chain differences */}
        {(() => {
          if (!tokenDataComplete) return null
          const rates = chainTokenData.map(cd => cd.reservedPercent)
          const ratesDiffer = isOmnichain && rates.length > 1 && !rates.every(r => r === rates[0])

          // Check if recipients differ across chains
          const recipientCounts = chainTokenData.map(cd => cd.reservedSplits.length)
          const recipientsDiffer = isOmnichain && recipientCounts.length > 1 && !recipientCounts.every(c => c === recipientCounts[0])

          const hasDifferences = ratesDiffer || recipientsDiffer

          return (
            <>
              {/* Warning about chain differences */}
              {hasDifferences && (
                <div className={`flex items-center gap-2 mb-3 px-2 py-1.5 text-xs ${
                  isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600'
                }`}>
                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>
                    {ratesDiffer && recipientsDiffer
                      ? 'Reserved rates and recipients vary by chain'
                      : ratesDiffer
                        ? 'Reserved rates vary by chain'
                        : 'Recipients vary by chain'}
                  </span>
                </div>
              )}

              {/* Per-chain breakdown (collapsible) */}
              {isOmnichain && (
                <div className="mb-3">
                  <button
                    onClick={() => setShowReservedBreakdown(!showReservedBreakdown)}
                    className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
                  >
                    <span>Breakdown</span>
                    <svg
                      className={`w-3 h-3 transition-transform ${showReservedBreakdown ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showReservedBreakdown && (
                    <div className="mt-2 space-y-1">
                      {chainTokenData.map(cd => {
                        const chainInfo = CHAIN_INFO[cd.chainId]
                        if (!chainInfo) return null
                        const pendingOnChain = parseFloat(cd.pendingReserved) / 1e18
                        return (
                          <div key={cd.chainId} className="flex items-center gap-3">
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: chainInfo.color }}
                            />
                            <span className={`text-xs w-10 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                              {chainInfo.shortName}
                            </span>
                            <span className={`text-xs font-mono ${cd.reservedPercent > 0 ? 'text-amber-400' : isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              {(cd.reservedPercent / 100).toFixed(0)}%
                            </span>
                            {pendingOnChain > 0 && (
                              <span className={`text-xs font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                {pendingOnChain.toLocaleString(undefined, { maximumFractionDigits: 1 })} pending
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )
        })()}

        {/* Pending tokens to distribute */}
        {tokenDataComplete && totalPendingAcrossChains > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {totalPendingAcrossChains.toLocaleString(undefined, { maximumFractionDigits: 2 })} {tokenAddress ? tokenSymbol : 'credits'}
            </span>
            <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              ready to distribute
            </span>
            <button
              onClick={() => setShowModal(true)}
              className={`px-2 py-0.5 text-xs font-medium transition-colors ${
                isDark
                  ? 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white'
                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
              }`}
            >
              Distribute
            </button>
          </div>
        )}

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
                    <div key={idx} className="flex items-start justify-between gap-3 text-sm">
                      {split.projectId > 0 ? (
                        <ProjectSplitRoute
                          projectId={split.projectId}
                          chainId={activeChainData.chainId}
                          beneficiary={split.beneficiary}
                          kind="reserved"
                          hook={split.hook}
                          isDark={isDark}
                        />
                      ) : (
                        <span className={`font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          {displayName}
                        </span>
                      )}
                      <div className="flex shrink-0 items-center gap-1">
                        <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {percent}%
                        </span>
                        {split.lockedUntil > Math.floor(Date.now() / 1000) && (
                          <span className="text-[10px] text-amber-500">Locked</span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Per-chain breakdown for omnichain projects */}
                {isOmnichain && chainTokenData.some(cd => cd.reservedSplits.length > 0) && (
                  <div className={`mt-3 pt-3 border-t ${isDark ? 'border-white/5' : 'border-gray-100'}`}>
                    <div className={`text-[10px] uppercase tracking-wider mb-2 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                      Per-chain recipients
                    </div>
                    <div className="space-y-3">
                      {chainTokenData.map(cd => {
                        const chainInfo = CHAIN_INFO[cd.chainId]
                        if (!chainInfo || cd.reservedSplits.length === 0) return null
                        return (
                          <div key={cd.chainId}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: chainInfo.color }}
                              />
                              <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                {chainInfo.shortName}
                              </span>
                            </div>
                            <div className="pl-3 space-y-1">
                              {cd.reservedSplits.map((split, idx) => {
                                const percent = (split.percent / 10000000).toFixed(2)
                                const beneficiary = split.beneficiary?.toLowerCase() || ''
                                const displayName = splitEnsNames[beneficiary] || truncateAddress(split.beneficiary || '')
                                return (
                                  <div key={idx} className="flex items-start justify-between gap-3 text-xs">
                                    {split.projectId > 0 ? (
                                      <ProjectSplitRoute
                                        projectId={split.projectId}
                                        chainId={cd.chainId}
                                        beneficiary={split.beneficiary}
                                        kind="reserved"
                                        hook={split.hook}
                                        isDark={isDark}
                                      />
                                    ) : (
                                      <span className={`font-mono ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {displayName}
                                      </span>
                                    )}
                                    <div className="flex shrink-0 items-center gap-1">
                                      <span className={`font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                                        {percent}%
                                      </span>
                                      {split.lockedUntil > Math.floor(Date.now() / 1000) && (
                                        <span className="text-[10px] text-amber-500">Locked</span>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Membership Price Section */}
      <div className={`p-4 border ${
        isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
      }`}>
        <h3 className={`text-sm font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Membership price
        </h3>
        <p className={`text-xs mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Here's the cost to join over time.
          {isRevnetProject(project) && ' Earlier members pay less.'}
        </p>

        {/* Chart - includes disclaimer for non-revnets */}
        <PriceChart projectId={projectId} chainId={chainId} />
      </div>

      {/* Token Holders Chart */}
      <ExplainerMessage>
        Here's who the members are.
      </ExplainerMessage>
      <HoldersChart projectId={projectId} chainId={chainId} limit={10} />

      {/* Send Reserved Tokens Modal */}
      {showModal && activeChainData && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className={`relative w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 ${
            isDark ? 'bg-juice-dark border border-white/10' : 'bg-white border border-gray-200'
          }`}>
            <button
              onClick={() => setShowModal(false)}
              className={`absolute top-4 right-4 z-10 p-2 transition-colors ${
                isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
              aria-label="Close"
            >
              <span aria-hidden="true">X</span>
            </button>
            <SendReservedTokensForm
              projectId={String(activeChainData.projectId)}
              chainId={String(activeChainData.chainId)}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
