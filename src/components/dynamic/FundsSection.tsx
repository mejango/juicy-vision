import { useState, useEffect } from 'react'
import { formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import {
  fetchSuckerGroupBalance,
  fetchDistributablePayout,
  fetchConnectedChains,
  fetchProjectWithRuleset,
  fetchProjectSplits,
  fetchProjectTokenSupply,
  fetchUpcomingRulesetWithMetadata,
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

// Chain info for display
const CHAIN_INFO: Record<number, { name: string; shortName: string; color: string; icon: string }> = {
  1: { name: 'Ethereum', shortName: 'ETH', color: '#627EEA', icon: 'Ξ' },
  10: { name: 'Optimism', shortName: 'OP', color: '#FF0420', icon: 'OP' },
  8453: { name: 'Base', shortName: 'BASE', color: '#0052FF', icon: 'B' },
  42161: { name: 'Arbitrum', shortName: 'ARB', color: '#28A0F0', icon: 'A' },
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

// Collapsible cash out calculator
function CashOutCalculator({
  cashOutTaxRate,
  balance,
  supply,
  decimals,
  currencySymbol,
  isDark,
}: {
  cashOutTaxRate: number
  balance: bigint
  supply: bigint
  decimals: number
  currencySymbol: string
  isDark: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [tokenAmount, setTokenAmount] = useState('')

  // Token decimals (typically 18)
  const TOKEN_DECIMALS = 18

  // Convert supply from raw (wei) to human-readable
  const supplyHuman = Number(supply) / Math.pow(10, TOKEN_DECIMALS)

  // Bonding curve formula: y = x * ((1 - r) + r * x)
  // Where x = fraction of supply, r = rate, y = fraction of funds
  const r = cashOutTaxRate / 10000

  // Calculate return for human-readable token amount
  const calculateReturn = (tokensHuman: number): number => {
    if (supplyHuman === 0 || tokensHuman <= 0) return 0
    const x = tokensHuman / supplyHuman // fraction of supply
    if (x > 1) return Number(balance) / Math.pow(10, decimals) // Can't cash out more than supply
    const y = x * ((1 - r) + r * x)
    return (y * Number(balance)) / Math.pow(10, decimals)
  }

  const tokensNum = parseFloat(tokenAmount) || 0
  const estimatedReturn = calculateReturn(tokensNum)

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
                  isDark
                    ? 'bg-white/5 border-white/10 text-white placeholder-gray-600'
                    : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                } focus:outline-none focus:border-green-500`}
              />
              {supplyHuman > 0 && (
                <div className={`mt-1 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {tokensNum > 0 ? `${((tokensNum / supplyHuman) * 100).toFixed(2)}% of supply (${supplyHuman.toLocaleString()} total)` : `Total supply: ${supplyHuman.toLocaleString()}`}
                </div>
              )}
            </div>

            {/* Result */}
            <div className={`p-2 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
              <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                You would receive
              </div>
              <div className={`text-lg font-mono font-semibold ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                {estimatedReturn > 0 ? estimatedReturn.toFixed(6) : '0'} {currencySymbol}
              </div>
              {tokensNum > 0 && estimatedReturn > 0 && (
                <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  ≈ {(estimatedReturn / tokensNum).toFixed(8)} {currencySymbol}/token
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FundsSection({ projectId, chainId, isOwner, onSendPayouts, isRevnet = false, onCashOut }: FundsSectionProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { isConnected } = useAccount()

  const [loading, setLoading] = useState(true)
  const [suckerBalance, setSuckerBalance] = useState<SuckerGroupBalance | null>(null)
  const [chainFundsData, setChainFundsData] = useState<ChainFundsData[]>([])
  const [upcomingRuleset, setUpcomingRuleset] = useState<QueuedRulesetInfo | null>(null)
  const [showSplits, setShowSplits] = useState(false)
  const [splitEnsNames, setSplitEnsNames] = useState<Record<string, string>>({})

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
        Funds
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

      {/* Per-chain breakdown */}
      {suckerBalance && suckerBalance.projectBalances.length > 1 && (
        <div className="mb-4">
          <div className={`text-xs mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Per-chain breakdown
          </div>
          <div className="space-y-1">
            {suckerBalance.projectBalances.map(pb => {
              const chainInfo = CHAIN_INFO[pb.chainId]
              if (!chainInfo) return null
              const pbCurrency = pb.currency ?? currency
              const pbDecimals = pb.decimals ?? decimals
              return (
                <div key={pb.chainId} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ backgroundColor: chainInfo.color }}
                    >
                      {chainInfo.icon}
                    </span>
                    <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {chainInfo.name}
                    </span>
                  </div>
                  <span className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {formatCurrency(pb.balance, pbDecimals, pbCurrency)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Available to pay out - hidden for revnets since they don't have payouts by design */}
      {!isRevnet && (
        <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="flex items-center justify-between">
            <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Available to pay out
            </span>
            <span className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {formatCurrency(totalAvailable.toString(), decimals, currency)}
            </span>
          </div>
        </div>
      )}

      {/* Surplus */}
      <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="flex items-center justify-between">
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Surplus
          </span>
          <span className={`text-sm font-mono ${surplus > 0n ? 'text-green-500' : isDark ? 'text-white' : 'text-gray-900'}`}>
            {formatCurrency(surplus > 0n ? surplus.toString() : '0', decimals, currency)}
          </span>
        </div>
      </div>

      {/* Cash Out Section - shows when surplus > 0 and cash outs are enabled */}
      {(() => {
        // Check if any chain has cash outs enabled (tax rate < 10000 = 100%)
        const cashOutEnabledChains = chainFundsData.filter(cd => cd.cashOutTaxRate < 10000)
        const hasCashOutsEnabled = cashOutEnabledChains.length > 0 && surplus > 0n

        // Get the active chain's data for display
        const activeCashOut = chainFundsData.find(cd => cd.chainId === chainIdNum)
        // Cash out tax rate as decimal (0-1) for display - NOT a percentage
        const cashOutTaxDecimal = activeCashOut ? (activeCashOut.cashOutTaxRate / 10000).toFixed(2) : '1'

        // Check for surplus allowance
        const activeFundLimits = activeCashOut?.fundAccessLimits
        const activeSurplusAllowance = activeFundLimits?.surplusAllowances?.[0]
        const hasSurplusAllowance = activeSurplusAllowance && BigInt(activeSurplusAllowance.amount) > 0n

        if (!hasCashOutsEnabled) return null

        return (
          <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            {/* Cash out rate header */}
            <div className="mb-3">
              <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Token Cash Out Value
              </div>
              <div className={`text-lg font-mono font-semibold ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                {activeCashOut && activeCashOut.cashOutPerToken > 0
                  ? `${activeCashOut.cashOutPerToken.toFixed(6)} ${currency === 2 ? 'USDC' : 'ETH'}/token`
                  : 'No value'
                }
              </div>
            </div>

            {/* Explanation */}
            <div className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Token holders can cash out for a share of the surplus.
              {activeCashOut && activeCashOut.cashOutTaxRate > 0 && (
                <span> A bonding curve (rate {cashOutTaxDecimal}) determines value — cashing out more tokens at once yields better value per token.</span>
              )}
              {activeCashOut && activeCashOut.cashOutTaxRate === 0 && (
                <span> Linear redemption — each token returns equal value.</span>
              )}
            </div>

            {/* Cash out calculator (collapsible) */}
            {activeCashOut && (
              <CashOutCalculator
                cashOutTaxRate={activeCashOut.cashOutTaxRate}
                balance={BigInt(activeCashOut.balance)}
                supply={BigInt(activeCashOut.tokenSupply)}
                decimals={activeCashOut.decimals}
                currencySymbol={activeCashOut.baseCurrency === 2 ? 'USDC' : 'ETH'}
                isDark={isDark}
              />
            )}

            {/* Per-chain cash out breakdown (if multi-chain) */}
            {cashOutEnabledChains.length > 1 && (
              <div className="mb-3">
                <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Per-chain cash out values
                </div>
                <div className="space-y-1">
                  {cashOutEnabledChains.map(cd => {
                    const chainInfo = CHAIN_INFO[cd.chainId]
                    if (!chainInfo) return null
                    const chainRate = (cd.cashOutTaxRate / 10000).toFixed(2)
                    return (
                      <div key={cd.chainId} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                            style={{ backgroundColor: chainInfo.color }}
                          >
                            {chainInfo.icon}
                          </span>
                          <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
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
                </div>
                <div className={`text-[10px] mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Cash outs use each chain's balance and token supply.
                </div>
              </div>
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

            {/* Surplus Allowance info */}
            {hasSurplusAllowance && activeFundLimits && (
              <div className={`p-2 mb-3 ${isDark ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-yellow-50 border border-yellow-200'}`}>
                <div className={`text-xs font-medium ${isDark ? 'text-yellow-400' : 'text-yellow-700'}`}>
                  Surplus Allowance Active
                </div>
                <div className={`text-xs mt-1 ${isDark ? 'text-yellow-300/80' : 'text-yellow-600'}`}>
                  The project operator can withdraw up to {formatBalance(activeSurplusAllowance!.amount, decimals)} {currencySymbol} from surplus this cycle.
                  This reduces the funds available for token cash outs.
                </div>
              </div>
            )}

            {/* Cash Out button */}
            {onCashOut && isConnected && (
              <div className="flex justify-end">
                <button
                  onClick={onCashOut}
                  className={`px-3 py-1.5 text-xs transition-colors border ${
                    isDark
                      ? 'text-green-400 hover:text-green-300 border-green-400 hover:border-green-300'
                      : 'text-green-600 hover:text-green-700 border-green-600 hover:border-green-700'
                  }`}
                >
                  cash out
                </button>
              </div>
            )}
            {onCashOut && !isConnected && (
              <div className={`text-xs text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Connect wallet to cash out tokens
              </div>
            )}
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

      {/* Send Payouts button (owner only) - hidden for revnets */}
      {!isRevnet && isOwner && totalAvailable > 0n && (
        <button
          onClick={onSendPayouts}
          className={`w-full mt-4 px-4 py-2 text-sm font-medium transition-colors ${
            isDark
              ? 'bg-juice-orange/20 text-juice-orange hover:bg-juice-orange/30'
              : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
          }`}
        >
          Send Payouts
        </button>
      )}
    </div>
  )
}
