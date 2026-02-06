import { useState, useEffect } from 'react'
import { formatEther, formatUnits } from 'viem'
import { useThemeStore } from '../../stores'
import {
  fetchProject,
  fetchSuckerGroupBalance,
  fetchDistributablePayout,
  fetchConnectedChains,
  fetchProjectWithRuleset,
  fetchProjectSplits,
  type Project,
  type SuckerGroupBalance,
  type DistributablePayout,
  type ConnectedChain,
  type JBSplitData,
  type FundAccessLimits,
} from '../../services/bendystraw'
import { resolveEnsName, truncateAddress } from '../../utils/ens'

interface FundsSectionProps {
  projectId: string
  chainId: string
  isOwner: boolean
  onSendPayouts: () => void
  /** If true, hides payout-related UI since revnets don't have payouts by design */
  isRevnet?: boolean
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

export default function FundsSection({ projectId, chainId, isOwner, onSendPayouts, isRevnet = false }: FundsSectionProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [loading, setLoading] = useState(true)
  const [suckerBalance, setSuckerBalance] = useState<SuckerGroupBalance | null>(null)
  const [chainFundsData, setChainFundsData] = useState<ChainFundsData[]>([])
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
        const chainDataPromises = chainsToFetch.map(async (chain): Promise<ChainFundsData> => {
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
              balance: chainProject?.balance || '0',
              distributablePayout: payoutData,
              payoutSplits,
              fundAccessLimits,
              baseCurrency: chainProject?.currentRuleset?.baseCurrency || 1,
              decimals: groupBalance.decimals,
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
            }
          }
        })

        const allChainData = await Promise.all(chainDataPromises)
        setChainFundsData(allChainData)

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
  }, [projectId, chainId, chainIdNum])

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
