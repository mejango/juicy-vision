import { useState, useEffect } from 'react'
import { formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import { hasValidWalletSession } from '../../services/siwe'
import {
  fetchSuckerGroupBalance,
  fetchDistributablePayout,
  fetchConnectedChains,
  fetchProjectWithRuleset,
  fetchProjectSplits,
  fetchProjectTokenSupply,
  fetchProjectTokenSymbol,
  fetchUpcomingRulesetWithMetadata,
  fetchUserTokenBalance,
  calculateFloorPrice,
  type SuckerGroupBalance,
  type DistributablePayout,
  type ConnectedChain,
  type JBSplitData,
  type FundAccessLimits,
  type QueuedRulesetInfo,
} from '../../services/bendystraw'
import { resolveEnsName, truncateAddress } from '../../utils/ens'

interface FundsSectionProps {
  projectId: string
  chainId: string
  isOwner: boolean
  onSendPayouts: () => void
  /** If true, hides payout-related UI since revnets don't have payouts by design */
  isRevnet?: boolean
  /** Callback when user wants to cash out tokens */
  onCashOut?: () => void
}

// Chain info for display (ALL CAPS for symbols)
const CHAIN_INFO: Record<number, { name: string; shortName: string; color: string }> = {
  1: { name: 'Ethereum', shortName: 'ETH', color: '#627EEA' },
  10: { name: 'Optimism', shortName: 'OP', color: '#FF0420' },
  8453: { name: 'Base', shortName: 'BASE', color: '#0052FF' },
  42161: { name: 'Arbitrum', shortName: 'ARB', color: '#28A0F0' },
}

// Per-chain funds data
interface ChainFundsData {
  chainId: number
  projectId: number
  balance: string
  distributablePayout: DistributablePayout | null
  payoutSplits: JBSplitData[]
  fundAccessLimits: FundAccessLimits | null
  baseCurrency: number
  decimals: number
  // Cash out related data
  tokenSupply: string // Total token supply on this chain
  cashOutTaxRate: number // 0-10000 basis points (10000 = 100% = no cash out)
  cashOutPerToken: number // Calculated floor price per token
}

function formatBalance(value: string, decimals: number = 18): string {
  try {
    const num = parseFloat(formatUnits(BigInt(value), decimals))
    if (num === 0) return '0'
    if (num < 0.001) return '<0.001'
    return num.toLocaleString(undefined, { maximumFractionDigits: 4 })
  } catch {
    return '0'
  }
}

function formatCurrency(value: string, decimals: number, currency: number): string {
  const formatted = formatBalance(value, decimals)
  return currency === 2 ? `$${formatted}` : `${formatted} ETH`
}

// Collapsible cash out calculator with chain selector
function CashOutCalculator({
  chainFundsData,
  initialChainId,
  isDark,
  tokenSymbol,
}: {
  chainFundsData: ChainFundsData[]
  tokenSymbol?: string | null
  initialChainId: number
  isDark: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [tokenAmount, setTokenAmount] = useState('')
  const [selectedChainId, setSelectedChainId] = useState(initialChainId)

  // Get selected chain data
  const selectedChain = chainFundsData.find(cd => cd.chainId === selectedChainId) || chainFundsData[0]
  const chainInfo = CHAIN_INFO[selectedChain.chainId]
  const currencySymbol = selectedChain.baseCurrency === 2 ? 'USDC' : 'ETH'

  // Token decimals (typically 18)
  const TOKEN_DECIMALS = 18

  // Convert supply from raw (wei) to human-readable
  const supplyHuman = Number(BigInt(selectedChain.tokenSupply)) / Math.pow(10, TOKEN_DECIMALS)
  const balance = BigInt(selectedChain.balance)

  // Bonding curve formula: y = x * ((1 - r) + r * x)
  // Where x = fraction of supply, r = rate, y = fraction of funds
  const r = selectedChain.cashOutTaxRate / 10000

  // Calculate return for human-readable token amount
  const calculateReturn = (tokensHuman: number): number => {
    if (supplyHuman === 0 || tokensHuman <= 0) return 0
    const x = tokensHuman / supplyHuman // fraction of supply
    if (x > 1) return Number(balance) / Math.pow(10, selectedChain.decimals) // Can't cash out more than supply
    const y = x * ((1 - r) + r * x)
    return (y * Number(balance)) / Math.pow(10, selectedChain.decimals)
  }

  const tokensNum = parseFloat(tokenAmount) || 0
  const estimatedReturn = calculateReturn(tokensNum)
  const exceedsSupply = tokensNum > supplyHuman && supplyHuman > 0

  return (
    <div className={`mb-3 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-3 py-2 flex items-center justify-between text-xs ${
          isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
        }`}
      >
        <span>Cash out calculator</span>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className={`px-3 pb-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="pt-3 space-y-3">
            {/* Chain selector (only show if multi-chain) */}
            {chainFundsData.length > 1 && (
              <div>
                <label className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Chain
                </label>
                <div className="flex gap-1 mt-1">
                  {chainFundsData.filter(cd => cd.cashOutTaxRate < 10000).map(cd => {
                    const info = CHAIN_INFO[cd.chainId]
                    if (!info) return null
                    const isSelected = cd.chainId === selectedChainId
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
                          style={{ backgroundColor: info.color }}
                        />
                        {info.shortName}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Token input */}
            <div>
              <label className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Tokens to cash out
              </label>
              <input
                type="number"
                value={tokenAmount}
                onChange={(e) => setTokenAmount(e.target.value)}
                placeholder="0"
                className={`w-full mt-1 px-2 py-1.5 text-sm font-mono border ${
                  exceedsSupply
                    ? 'border-red-500'
                    : isDark
                      ? 'bg-white/5 border-white/10 text-white placeholder-gray-600'
                      : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                } ${isDark ? 'bg-white/5 text-white placeholder-gray-600' : 'bg-gray-50 text-gray-900 placeholder-gray-400'} focus:outline-none ${!exceedsSupply ? 'focus:border-green-500' : ''}`}
              />
              {supplyHuman > 0 && (
                <div className={`mt-1 text-[10px] ${exceedsSupply ? 'text-red-400' : isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {exceedsSupply
                    ? `Exceeds ${chainInfo?.shortName || 'chain'} supply of ${supplyHuman.toLocaleString()} tokens`
                    : tokensNum > 0
                      ? `${((tokensNum / supplyHuman) * 100).toFixed(2)}% of supply (${supplyHuman.toLocaleString()} total)`
                      : `Total supply: ${supplyHuman.toLocaleString()}`
                  }
                </div>
              )}
            </div>

            {/* Result */}
            <div className={`p-2 ${exceedsSupply ? (isDark ? 'bg-red-500/10' : 'bg-red-50') : (isDark ? 'bg-green-500/10' : 'bg-green-50')}`}>
              <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {exceedsSupply ? `Max you could receive on ${chainInfo?.shortName || 'this chain'}` : 'You would receive'}
              </div>
              <div className={`text-lg font-mono font-semibold ${exceedsSupply ? (isDark ? 'text-red-400' : 'text-red-600') : (isDark ? 'text-green-400' : 'text-green-600')}`}>
                {estimatedReturn > 0 ? estimatedReturn.toFixed(6) : '0'} {currencySymbol}
              </div>
              {tokensNum > 0 && estimatedReturn > 0 && !exceedsSupply && (
                <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  ≈ {(estimatedReturn / tokensNum).toFixed(8)} {currencySymbol}/{tokenSymbol || 'token'}
                </div>
              )}
              {exceedsSupply && (
                <div className={`text-[10px] mt-1 ${isDark ? 'text-red-400' : 'text-red-500'}`}>
                  This chain only has {supplyHuman.toLocaleString()} tokens available
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Collapsible per-chain balance breakdown
function PerChainBreakdown({
  projectBalances,
  defaultCurrency,
  defaultDecimals,
  isDark,
}: {
  projectBalances: Array<{ chainId: number; balance: string; currency?: number; decimals?: number }>
  defaultCurrency: number
  defaultDecimals: number
  isDark: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
      >
        <span>Per-chain breakdown</span>
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1">
          {projectBalances.map(pb => {
            const chainInfo = CHAIN_INFO[pb.chainId]
            if (!chainInfo) return null
            const pbCurrency = pb.currency ?? defaultCurrency
            const pbDecimals = pb.decimals ?? defaultDecimals
            return (
              <div key={pb.chainId} className="flex items-center gap-3">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: chainInfo.color }}
                />
                <span className={`text-xs w-10 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {chainInfo.shortName}
                </span>
                <span className={`text-xs font-mono ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  {formatCurrency(pb.balance, pbDecimals, pbCurrency)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Collapsible per-chain cash out values breakdown
function PerChainCashOutBreakdown({
  cashOutEnabledChains,
  isDark,
}: {
  cashOutEnabledChains: ChainFundsData[]
  isDark: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
      >
        <span>Per-chain cash out values</span>
        <svg
          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1">
          {cashOutEnabledChains.map(cd => {
            const chainInfo = CHAIN_INFO[cd.chainId]
            if (!chainInfo) return null
            const chainRate = (cd.cashOutTaxRate / 10000).toFixed(2)
            return (
              <div key={cd.chainId} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: chainInfo.color }}
                  />
                  <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {chainInfo.shortName}
                  </span>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-mono ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                    {cd.cashOutPerToken > 0 ? cd.cashOutPerToken.toFixed(6) : '0'} {cd.baseCurrency === 2 ? 'USDC' : 'ETH'}
                  </span>
                  <span className={`text-[10px] ml-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    (rate {chainRate})
                  </span>
                </div>
              </div>
            )
          })}
          <div className={`text-[10px] mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Cash outs use each chain's balance and token supply.
          </div>
        </div>
      )}
    </div>
  )
}

export default function FundsSection({ projectId, chainId, isOwner, onSendPayouts, isRevnet = false, onCashOut }: FundsSectionProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { isConnected, address: wagmiAddress } = useAccount()
  const { mode, isAuthenticated } = useAuthStore()
  const { address: managedAddress } = useManagedWallet()

  // Check if user is signed in
  const isSelfCustodySignedIn = mode === 'self_custody' && hasValidWalletSession()
  const isManagedSignedIn = mode === 'managed' && isAuthenticated()
  const isSignedIn = isSelfCustodySignedIn || isManagedSignedIn
  const userAddress = managedAddress || wagmiAddress

  const [loading, setLoading] = useState(true)
  const [suckerBalance, setSuckerBalance] = useState<SuckerGroupBalance | null>(null)
  const [chainFundsData, setChainFundsData] = useState<ChainFundsData[]>([])
  const [upcomingRuleset, setUpcomingRuleset] = useState<QueuedRulesetInfo | null>(null)
  const [showSplits, setShowSplits] = useState(false)
  const [splitEnsNames, setSplitEnsNames] = useState<Record<string, string>>({})
  const [userTokenBalance, setUserTokenBalance] = useState<bigint>(0n)
  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null)

  const chainIdNum = parseInt(chainId)

  // Get active chain data
  const activeChainData = chainFundsData.find(cd => cd.chainId === chainIdNum) || chainFundsData[0]
  const currencySymbol = activeChainData?.baseCurrency === 2 ? 'USDC' : 'ETH'

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)

        // Fetch sucker balance and connected chains
        const [groupBalance, connectedChains] = await Promise.all([
          fetchSuckerGroupBalance(projectId, chainIdNum),
          fetchConnectedChains(projectId, chainIdNum),
        ])

        setSuckerBalance(groupBalance)

        // Determine chains to fetch
        const chainsToFetch: ConnectedChain[] = connectedChains.length > 0
          ? connectedChains
          : [{ chainId: chainIdNum, projectId: parseInt(projectId) }]

        // Fetch payout data from all chains in parallel
        // Skip payout-related fetches for revnets since they don't have payouts
        const chainDataPromises = chainsToFetch.map(async (chain): Promise<ChainFundsData> => {
          try {
            // Fetch project with ruleset and token supply
            const [chainProject, tokenSupply] = await Promise.all([
              fetchProjectWithRuleset(String(chain.projectId), chain.chainId),
              fetchProjectTokenSupply(String(chain.projectId), chain.chainId),
            ])

            let payoutData: DistributablePayout | null = null
            if (!isRevnet) {
              try {
                payoutData = await fetchDistributablePayout(String(chain.projectId), chain.chainId)
              } catch {
                // Silently ignore payout fetch errors (expected for some project types)
              }
            }

            // Fetch splits if we have a ruleset (skip for revnets)
            let payoutSplits: JBSplitData[] = []
            let fundAccessLimits: FundAccessLimits | null = null
            if (!isRevnet && chainProject?.currentRuleset?.id) {
              const splitsData = await fetchProjectSplits(
                String(chain.projectId),
                chain.chainId,
                chainProject.currentRuleset.id
              )
              payoutSplits = splitsData.payoutSplits
              fundAccessLimits = splitsData.fundAccessLimits || null
            }

            // Get cash out tax rate from ruleset (10000 = 100% tax = no cash out allowed)
            const cashOutTaxRate = chainProject?.currentRuleset?.cashOutTaxRate ?? 10000
            const balance = BigInt(chainProject?.balance || '0')
            const supply = BigInt(tokenSupply || '0')
            const chainDecimals = groupBalance.decimals

            // Calculate floor price per token using bonding curve
            const cashOutPerToken = calculateFloorPrice(balance, supply, cashOutTaxRate, chainDecimals)

            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              balance: chainProject?.balance || '0',
              distributablePayout: payoutData,
              payoutSplits,
              fundAccessLimits,
              baseCurrency: chainProject?.currentRuleset?.baseCurrency || 1,
              decimals: chainDecimals,
              tokenSupply: tokenSupply || '0',
              cashOutTaxRate,
              cashOutPerToken,
            }
          } catch (err) {
            console.error(`Failed to fetch funds data for chain ${chain.chainId}:`, err)
            return {
              chainId: chain.chainId,
              projectId: chain.projectId,
              balance: '0',
              distributablePayout: null,
              payoutSplits: [],
              fundAccessLimits: null,
              baseCurrency: 1,
              decimals: 18,
              tokenSupply: '0',
              cashOutTaxRate: 10000,
              cashOutPerToken: 0,
            }
          }
        })

        const allChainData = await Promise.all(chainDataPromises)
        setChainFundsData(allChainData)

        // Fetch upcoming ruleset to check for cash out tax changes
        try {
          const upcoming = await fetchUpcomingRulesetWithMetadata(projectId, chainIdNum)
          setUpcomingRuleset(upcoming)
        } catch {
          // Silently ignore - upcoming ruleset is optional
        }

        // Fetch project token symbol (e.g., NANA, REV)
        try {
          const symbol = await fetchProjectTokenSymbol(projectId, chainIdNum)
          setTokenSymbol(symbol)
        } catch {
          // Silently ignore - token symbol is optional
        }

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
        console.error('Failed to load funds:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainId, chainIdNum, isRevnet])

  // Fetch user's token balance across all connected chains when signed in
  useEffect(() => {
    async function loadUserTokenBalance() {
      if (!isSignedIn || !userAddress || chainFundsData.length === 0) {
        setUserTokenBalance(0n)
        return
      }

      try {
        // Fetch balance from all chains and sum them
        const balancePromises = chainFundsData.map(async cd => {
          const result = await fetchUserTokenBalance(
            String(cd.projectId),
            cd.chainId,
            userAddress
          )
          return result?.balance ? BigInt(result.balance) : 0n
        })

        const balances = await Promise.all(balancePromises)
        const totalBalance = balances.reduce((sum, b) => sum + b, 0n)
        setUserTokenBalance(totalBalance)
      } catch (err) {
        console.error('Failed to fetch user token balance:', err)
        setUserTokenBalance(0n)
      }
    }
    loadUserTokenBalance()
  }, [isSignedIn, userAddress, chainFundsData])

  // Calculate totals
  const totalBalance = suckerBalance?.totalBalance || '0'
  const decimals = suckerBalance?.decimals || 18
  const currency = suckerBalance?.currency || 1

  // Calculate available to pay out (sum across chains)
  const totalAvailable = chainFundsData.reduce((sum, cd) => {
    if (cd.distributablePayout?.available) {
      return sum + BigInt(cd.distributablePayout.available)
    }
    return sum
  }, 0n)

  // Calculate surplus (balance - used payout limit)
  const totalUsedPayout = chainFundsData.reduce((sum, cd) => {
    if (cd.distributablePayout?.used) {
      return sum + BigInt(cd.distributablePayout.used)
    }
    return sum
  }, 0n)

  const surplus = BigInt(totalBalance) - totalUsedPayout

  if (loading) {
    return (
      <div className={`p-4 border animate-pulse ${
        isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className={`h-5 w-24 mb-4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        <div className="space-y-3">
          <div className={`h-4 w-32 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className={`h-4 w-40 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          <div className={`h-4 w-28 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        </div>
      </div>
    )
  }

  return (
    <div className={`p-4 border ${
      isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
    }`}>
      <h3 className={`text-sm font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
        Project's money
      </h3>

      {/* Total Balance */}
      <div className="mb-4">
        <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Total Balance
        </div>
        <div className={`text-lg font-mono font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {formatCurrency(totalBalance, decimals, currency)}
        </div>
      </div>

      {/* Per-chain breakdown (collapsible) */}
      {suckerBalance && suckerBalance.projectBalances.length > 1 && (
        <PerChainBreakdown
          projectBalances={suckerBalance.projectBalances}
          defaultCurrency={currency}
          defaultDecimals={decimals}
          isDark={isDark}
        />
      )}

      {/* Payouts Section */}
      <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Payouts
        </div>
        {isRevnet ? (
          <>
            <div className={`text-sm font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              0 {currencySymbol}
            </div>
            <div className={`text-xs mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Revnets don't have payouts by design. All funds remain in the treasury for member cash outs and loans.
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className={`text-sm font-mono ${totalAvailable > 0n ? (isDark ? 'text-white' : 'text-gray-900') : (isDark ? 'text-gray-500' : 'text-gray-400')}`}>
                {formatCurrency(totalAvailable.toString(), decimals, currency)} available
              </div>
              {totalAvailable > 0n && (
                <button
                  onClick={onSendPayouts}
                  className={`px-2 py-1 text-xs font-medium transition-colors border ${
                    isDark
                      ? 'text-juice-orange hover:text-orange-300 border-juice-orange/50 hover:border-orange-300'
                      : 'text-orange-600 hover:text-orange-700 border-orange-500 hover:border-orange-600'
                  }`}
                >
                  Distribute
                </button>
              )}
            </div>
            {totalAvailable === 0n && (
              <div className={`text-xs mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                No payouts available this cycle. The payout limit has been fully distributed or is set to zero.
              </div>
            )}
          </>
        )}
      </div>

      {/* Surplus */}
      <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Surplus
          </span>
          <span className={`text-sm font-mono ${surplus > 0n ? 'text-green-500' : isDark ? 'text-white' : 'text-gray-900'}`}>
            {formatCurrency(surplus > 0n ? surplus.toString() : '0', decimals, currency)}
          </span>
        </div>
      </div>

      {/* Cash Out Section - shows when cash outs are enabled (tax rate < 100%) */}
      {(() => {
        // Check if any chain has cash outs enabled (tax rate < 10000 = 100%)
        const cashOutEnabledChains = chainFundsData.filter(cd => cd.cashOutTaxRate < 10000)
        const hasCashOutsEnabled = cashOutEnabledChains.length > 0
        const hasSurplus = surplus > 0n

        // Get the active chain's data for display
        const activeCashOut = chainFundsData.find(cd => cd.chainId === chainIdNum)
        if (!hasCashOutsEnabled) return null

        return (
          <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            {/* Cash out rate header */}
            <div className="mb-3">
              <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Token Cash Out Value
              </div>
              <div className={`text-lg font-mono font-semibold ${
                hasSurplus && activeCashOut && activeCashOut.cashOutPerToken > 0
                  ? isDark ? 'text-green-400' : 'text-green-600'
                  : isDark ? 'text-gray-500' : 'text-gray-400'
              }`}>
                {hasSurplus && activeCashOut && activeCashOut.cashOutPerToken > 0
                  ? `${activeCashOut.cashOutPerToken.toFixed(6)} ${currency === 2 ? 'USDC' : 'ETH'}/${tokenSymbol || 'token'}`
                  : 'No surplus'
                }
              </div>
            </div>

            {/* Explanation */}
            <div className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Token holders may be able to cash out for a share of the surplus.
              {activeCashOut && activeCashOut.cashOutTaxRate > 0 && (
                <span> A {((activeCashOut.cashOutTaxRate / 10000) * 100).toFixed(0)}% cash out tax rate determines value — cashing out after others yields more.</span>
              )}
              {activeCashOut && activeCashOut.cashOutTaxRate === 0 && (
                <span> No cash out tax — each token returns equal value.</span>
              )}
              {surplus === 0n && (
                <span className={isDark ? 'text-yellow-400' : 'text-yellow-600'}> Currently no surplus available for cash outs.</span>
              )}
            </div>

            {/* Per-chain cash out breakdown (collapsible) */}
            {hasSurplus && cashOutEnabledChains.length > 1 && (
              <PerChainCashOutBreakdown
                cashOutEnabledChains={cashOutEnabledChains}
                isDark={isDark}
              />
            )}

            {/* Cash out calculator (collapsible) - only show when there's surplus */}
            {hasSurplus && activeCashOut && (
              <CashOutCalculator
                chainFundsData={cashOutEnabledChains}
                initialChainId={chainIdNum}
                isDark={isDark}
                tokenSymbol={tokenSymbol}
              />
            )}

            {/* Upcoming cash out tax change warning */}
            {(() => {
              if (!upcomingRuleset || !activeCashOut) return null

              const currentTax = activeCashOut.cashOutTaxRate
              const upcomingTax = upcomingRuleset.cashOutTaxRate

              // Only show if tax rate is changing
              if (currentTax === upcomingTax) return null

              const isIncreasing = upcomingTax > currentTax
              // Display as decimal (0-1) not percentage
              const currentTaxDecimal = (currentTax / 10000).toFixed(2)
              const upcomingTaxDecimal = (upcomingTax / 10000).toFixed(2)
              const effectiveDate = new Date(upcomingRuleset.start * 1000)
              const dateStr = effectiveDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

              // Calculate approximate value impact
              // Current retention = (10000 - currentTax) / 10000
              // Upcoming retention = (10000 - upcomingTax) / 10000
              const currentRetention = (10000 - currentTax) / 10000
              const upcomingRetention = (10000 - upcomingTax) / 10000
              const valueChange = ((upcomingRetention - currentRetention) / currentRetention * 100).toFixed(0)

              return (
                <div className={`p-2 mb-3 ${
                  isIncreasing
                    ? isDark ? 'bg-purple-500/10 border border-purple-500/20' : 'bg-purple-50 border border-purple-200'
                    : isDark ? 'bg-green-500/10 border border-green-500/20' : 'bg-green-50 border border-green-200'
                }`}>
                  <div className={`text-xs font-medium ${
                    isIncreasing
                      ? isDark ? 'text-purple-400' : 'text-purple-700'
                      : isDark ? 'text-green-400' : 'text-green-700'
                  }`}>
                    {isIncreasing ? 'Cash Out Rate Increasing' : 'Cash Out Rate Decreasing'}
                  </div>
                  <div className={`text-xs mt-1 ${
                    isIncreasing
                      ? isDark ? 'text-purple-300/80' : 'text-purple-600'
                      : isDark ? 'text-green-300/80' : 'text-green-600'
                  }`}>
                    Rate changing from {currentTaxDecimal} to {upcomingTaxDecimal} on {dateStr}.
                    {isIncreasing
                      ? ` Token cash out value will decrease.`
                      : ` Token cash out value will increase.`
                    }
                  </div>
                </div>
              )
            })()}

            {/* Cash Out button and user balance */}
            {onCashOut && (
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-3">
                  {!isSignedIn ? (
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))}
                      className={`px-3 py-1.5 text-xs transition-colors border ${
                        isDark
                          ? 'text-white hover:text-gray-200 border-white/40 hover:border-white/60'
                          : 'text-gray-700 hover:text-gray-900 border-gray-400 hover:border-gray-600'
                      }`}
                    >
                      Sign in
                    </button>
                  ) : (
                    <div className="relative group">
                      <button
                        onClick={userTokenBalance > 0n && hasSurplus ? onCashOut : undefined}
                        className={`px-3 py-1.5 text-xs transition-colors border ${
                          userTokenBalance > 0n && hasSurplus
                            ? isDark
                              ? 'text-green-400 hover:text-green-300 border-green-400 hover:border-green-300'
                              : 'text-green-600 hover:text-green-700 border-green-600 hover:border-green-700'
                            : isDark
                              ? 'text-gray-500 border-gray-600 cursor-not-allowed'
                              : 'text-gray-400 border-gray-300 cursor-not-allowed'
                        }`}
                      >
                        Cash out
                      </button>
                      {/* Tooltip for disabled state */}
                      {(userTokenBalance === 0n || !hasSurplus) && (
                        <div className={`absolute bottom-full left-0 mb-1 px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap ${
                          isDark ? 'bg-juice-dark border border-white/20 text-gray-300' : 'bg-white border border-gray-200 text-gray-600 shadow-sm'
                        }`}>
                          {userTokenBalance === 0n ? "You don't have tokens" : 'No surplus available'}
                        </div>
                      )}
                    </div>
                  )}
                  {/* User token balance */}
                  {isSignedIn && (
                    <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Your balance: <span className={`font-mono ${userTokenBalance > 0n ? (isDark ? 'text-white' : 'text-gray-900') : ''}`}>
                        {formatBalance(userTokenBalance.toString(), 18)}
                      </span> tokens
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Surplus Allowance Section */}
      {(() => {
        // For revnets, show the unlimited surplus allowance for loans
        if (isRevnet) {
          return (
            <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Surplus Allowance
              </div>
              <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Unlimited
              </div>
              <div className={`text-xs mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Revnets have unlimited surplus allowance that facilitates loans only. Funds cannot be withdrawn directly.
              </div>
            </div>
          )
        }

        // For regular projects, show the surplus allowance from fundAccessLimits
        const activeFundLimits = activeChainData?.fundAccessLimits
        const surplusAllowance = activeFundLimits?.surplusAllowances?.[0]
        const allowanceAmount = surplusAllowance ? BigInt(surplusAllowance.amount) : 0n

        // Only show if there's a surplus allowance configured
        if (!surplusAllowance || allowanceAmount === 0n) return null

        return (
          <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Surplus Allowance
            </div>
            <div className="flex items-center justify-between">
              <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {formatBalance(allowanceAmount.toString(), decimals)} {currencySymbol}
              </div>
              {isOwner && surplus > 0n && (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('juice:use-surplus-allowance', {
                    detail: {
                      projectId,
                      chainId: chainIdNum,
                      allowance: allowanceAmount.toString(),
                    }
                  }))}
                  className={`px-2 py-1 text-xs font-medium transition-colors border ${
                    isDark
                      ? 'text-yellow-400 hover:text-yellow-300 border-yellow-400/50 hover:border-yellow-300'
                      : 'text-yellow-600 hover:text-yellow-700 border-yellow-500 hover:border-yellow-600'
                  }`}
                >
                  Use allowance
                </button>
              )}
            </div>
            <div className={`text-xs mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              The project owner can withdraw up to this amount from surplus this cycle.
            </div>
          </div>
        )
      })()}

      {/* Payouts configuration - hidden for revnets */}
      {!isRevnet && activeChainData && activeChainData.payoutSplits.length > 0 && (
        <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <button
            onClick={() => setShowSplits(!showSplits)}
            className={`flex items-center justify-between w-full text-sm ${
              isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>Payout recipients ({activeChainData.payoutSplits.length})</span>
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
              {activeChainData.payoutSplits.map((split, idx) => {
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
  )
}
