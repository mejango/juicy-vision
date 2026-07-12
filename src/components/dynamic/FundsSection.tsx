import { useState, useEffect } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { useAccount } from 'wagmi'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import { getWalletSession, hasValidWalletSession } from '../../services/siwe'
import {
  fetchProjectWithRuleset,
  fetchProjectSplits,
  fetchProjectTokenSupply,
  fetchPendingReservedTokens,
  fetchProjectTokenSymbol,
  fetchUpcomingRulesetWithMetadata,
  fetchUserTokenBalance,
  calculateCashOutValue,
  calculateFloorPrice,
  type JBSplitData,
  type QueuedRulesetInfo,
} from '../../services/bendystraw'
import {
  createFundAccessClient,
  currencyLabel as fundAccessCurrencyLabel,
  formatFundAccessAmount,
  readFundAccessContexts,
  type FundAccessContextSnapshot,
} from '../../services/fundAccess'
import { resolveEnsName, truncateAddress } from '../../utils/ens'
import { resolveProjectChains } from '../../utils/projectChains'
import { ChainMappingWarning } from './ChainMappingWarning'
import { ProjectSplitRoute } from './ProjectSplitRoute'

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
  11155111: { name: 'Sepolia', shortName: 'SEP', color: '#627EEA' },
  11155420: { name: 'OP Sepolia', shortName: 'OP-SEP', color: '#FF0420' },
  84532: { name: 'Base Sepolia', shortName: 'BASE-SEP', color: '#0052FF' },
  421614: { name: 'Arb Sepolia', shortName: 'ARB-SEP', color: '#28A0F0' },
}

// Per-chain funds data
interface ChainFundsData {
  chainId: number
  projectId: number
  balance: string
  fundAccess: FundAccessContextSnapshot
  payoutSplits: JBSplitData[]
  accountingToken: string
  accountingCurrency: bigint
  accountingSymbol: string
  decimals: number
  // Cash out related data
  tokenSupply: string // Total token supply on this chain (raw totalSupplyOf, 18 decimals)
  cashOutTaxRate: number // 0-10000 basis points (10000 = 100% = no cash out)
  cashOutPerToken: number // Calculated floor price per token
  scopeCashOutsToLocalBalances: boolean
  useDataHookForCashOut: boolean
  // Reclaimable surplus = balance NET of the remaining (undistributed) payout limit,
  // in the accounting token's decimals. Cash outs draw only from this, never raw balance.
  reclaimableSurplus: string
  // Cash-out denominator = tokenSupply + pending (undistributed) reserved tokens (18 decimals).
  // Pending reserved tokens still dilute each token's reclaim value.
  cashOutSupply: string
}

function formatBalance(value: string, decimals: number = 18): string {
  try {
    const raw = BigInt(value)
    if (raw === 0n) return '0'
    if (decimals >= 3 && raw < 10n ** BigInt(decimals - 3)) return '<0.001'
    const [whole, fraction = ''] = formatUnits(raw, decimals).split('.')
    const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const compactFraction = fraction.slice(0, 4).replace(/0+$/, '')
    return compactFraction ? `${groupedWhole}.${compactFraction}` : groupedWhole
  } catch {
    return '0'
  }
}

function formatCurrency(value: string, decimals: number, symbol: string): string {
  const formatted = formatBalance(value, decimals)
  return `${formatted} ${symbol}`
}

// Selected-chain baseline calculator. Execution uses the terminal's fresh preview instead.
function CashOutCalculator({
  chain,
  isDark,
  tokenSymbol,
  userTokenBalance,
}: {
  chain: ChainFundsData
  tokenSymbol?: string | null
  isDark: boolean
  userTokenBalance?: bigint
}) {
  const defaultAmount = userTokenBalance && userTokenBalance > 0n
    ? formatUnits(userTokenBalance, 18)
    : ''
  const [expanded, setExpanded] = useState(false)
  const [tokenAmount, setTokenAmount] = useState(defaultAmount)
  const chainInfo = CHAIN_INFO[chain.chainId]
  const supply = BigInt(chain.cashOutSupply)
  let tokenAmountRaw = 0n
  let amountIsValid = tokenAmount.trim() === ''
  try {
    tokenAmountRaw = tokenAmount.trim() === '' ? 0n : parseUnits(tokenAmount, 18)
    amountIsValid = tokenAmountRaw >= 0n
  } catch {
    amountIsValid = false
  }
  const exceedsSupply = tokenAmountRaw > supply
  const exceedsBalance = userTokenBalance !== undefined && tokenAmountRaw > userTokenBalance
  const returnRaw = amountIsValid && !exceedsSupply && tokenAmountRaw > 0n
    ? calculateCashOutValue(
        BigInt(chain.reclaimableSurplus),
        supply,
        tokenAmountRaw,
        chain.cashOutTaxRate,
      )
    : 0n
  const returnAmount = Number(formatUnits(returnRaw, chain.decimals))
  const tokensNum = Number(formatUnits(tokenAmountRaw, 18))

  return (
    <div className={`mb-3 border max-w-sm ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
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
                min="0"
                max={userTokenBalance !== undefined ? formatUnits(userTokenBalance, 18) : undefined}
                step="any"
                value={tokenAmount}
                onChange={(e) => setTokenAmount(e.target.value)}
                placeholder="0"
                className={`w-full mt-1 px-2 py-1.5 text-sm font-mono border ${
                  isDark
                    ? 'bg-white/5 border-white/10 text-white placeholder-gray-600'
                    : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                } focus:outline-none focus:border-green-500`}
              />
            </div>

            <div className={`p-2 ${exceedsSupply || exceedsBalance || !amountIsValid ? (isDark ? 'bg-red-500/10' : 'bg-red-50') : (isDark ? 'bg-green-500/10' : 'bg-green-50')}`}>
                <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Current {chainInfo?.shortName || `chain ${chain.chainId}`} curve estimate
                </div>
                <div className={`text-lg font-mono font-semibold ${exceedsSupply || exceedsBalance || !amountIsValid ? (isDark ? 'text-red-400' : 'text-red-600') : (isDark ? 'text-green-400' : 'text-green-600')}`}>
                  {returnAmount > 0 ? returnAmount.toFixed(6) : '0'} {chain.accountingSymbol}
                </div>
                {tokensNum > 0 && returnAmount > 0 && !exceedsSupply && !exceedsBalance && (
                  <div className={`text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    ~{(returnAmount / tokensNum).toFixed(8)} {chain.accountingSymbol}/{tokenSymbol || 'token'}
                  </div>
                )}
                {!amountIsValid && (
                  <div className={`text-[10px] mt-1 ${isDark ? 'text-red-400' : 'text-red-500'}`}>
                    Enter a valid token amount
                  </div>
                )}
                {exceedsBalance && (
                  <div className={`text-[10px] mt-1 ${isDark ? 'text-red-400' : 'text-red-500'}`}>
                    Amount exceeds your balance on this chain
                  </div>
                )}
                {exceedsSupply && !exceedsBalance && (
                  <div className={`text-[10px] mt-1 ${isDark ? 'text-red-400' : 'text-red-500'}`}>
                    Amount exceeds the cash-out supply on this chain
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
  defaultDecimals,
  defaultSymbol,
  isDark,
}: {
  projectBalances: Array<{ chainId: number; balance: string; symbol?: string; decimals?: number }>
  defaultDecimals: number
  defaultSymbol: string
  isDark: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
      >
        <span>Breakdown</span>
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
            const pbDecimals = pb.decimals ?? defaultDecimals
            const pbSymbol = pb.symbol ?? defaultSymbol
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
                  {formatCurrency(pb.balance, pbDecimals, pbSymbol)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Collapsible per-chain payout splits breakdown
function PayoutSplitsBreakdown({
  chainFundsData,
  splitEnsNames,
  isDark,
}: {
  chainFundsData: ChainFundsData[]
  splitEnsNames: Record<string, string>
  isDark: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mt-3 pt-2 border-t border-dashed" style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1 text-xs ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
      >
        <span>Breakdown</span>
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
        <div className="mt-2 space-y-3">
          {chainFundsData.filter(cd => cd.payoutSplits.length > 0).map(cd => {
            const chainInfo = CHAIN_INFO[cd.chainId]
            if (!chainInfo) return null
            return (
              <div key={cd.chainId}>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: chainInfo.color }}
                  />
                  <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    {chainInfo.shortName}
                  </span>
                </div>
                <div className="ml-3.5 space-y-1">
                  {cd.payoutSplits.map((split, idx) => {
                    const percent = (split.percent / 10000000).toFixed(2)
                    const beneficiary = split.beneficiary?.toLowerCase() || ''
                    const displayName = splitEnsNames[beneficiary] || (split.beneficiary ? `${split.beneficiary.slice(0, 6)}...${split.beneficiary.slice(-4)}` : '')
                    return (
                      <div key={idx} className="flex items-start justify-between gap-2 text-xs">
                        {split.projectId > 0 ? (
                          <ProjectSplitRoute
                            projectId={split.projectId}
                            chainId={cd.chainId}
                            beneficiary={split.beneficiary}
                            kind="payout"
                            preferAddToBalance={split.preferAddToBalance}
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
      )}
    </div>
  )
}

// Cash out tax rate display with per-chain breakdown
function CashOutTaxRateDisplay({
  cashOutEnabledChains,
  unifiedTaxRate,
  isDark,
}: {
  cashOutEnabledChains: ChainFundsData[]
  unifiedTaxRate: number | null
  isDark: boolean
}) {
  const [showBreakdown, setShowBreakdown] = useState(false)

  const formatTaxRate = (rate: number) => `${(rate / 100).toFixed(2).replace(/\.?0+$/, '') || '0'}%`

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Current cash-out curve rate:
        </span>
        {unifiedTaxRate !== null ? (
          <span className={`text-xs font-mono font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {formatTaxRate(unifiedTaxRate)}
          </span>
        ) : (
          <button
            onClick={() => setShowBreakdown(!showBreakdown)}
            className={`flex items-center gap-1 text-xs font-mono font-medium ${isDark ? 'text-white hover:text-gray-300' : 'text-gray-900 hover:text-gray-600'}`}
          >
            <span>Varies by chain</span>
            <svg
              className={`w-3 h-3 transition-transform ${showBreakdown ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>
      {/* Per-chain breakdown when rates differ */}
      {unifiedTaxRate === null && showBreakdown && (
        <div className="mt-2 space-y-1">
          {cashOutEnabledChains.map(cd => {
            const chainInfo = CHAIN_INFO[cd.chainId]
            if (!chainInfo) return null
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
                <span className={`text-xs font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {formatTaxRate(cd.cashOutTaxRate)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function FundsSection({ projectId, chainId, isOwner, onSendPayouts, isRevnet = false, onCashOut }: FundsSectionProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address: wagmiAddress } = useAccount()
  const { mode, isAuthenticated } = useAuthStore()
  const { address: managedAddress } = useManagedWallet()

  // Check if user is signed in
  const isSelfCustodySignedIn = mode === 'self_custody' && hasValidWalletSession()
  const isManagedSignedIn = mode === 'managed' && isAuthenticated()
  const isSignedIn = isSelfCustodySignedIn || isManagedSignedIn
  const userAddress = isManagedSignedIn
    ? managedAddress
    : getWalletSession()?.address || wagmiAddress

  const [loading, setLoading] = useState(true)
  const [chainFundsData, setChainFundsData] = useState<ChainFundsData[]>([])
  const [selectedAccountingSymbol, setSelectedAccountingSymbol] = useState('ETH')
  const [configurationError, setConfigurationError] = useState<string | null>(null)
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [upcomingRuleset, setUpcomingRuleset] = useState<QueuedRulesetInfo | null>(null)
  const [showSplits, setShowSplits] = useState(false)
  const [splitEnsNames, setSplitEnsNames] = useState<Record<string, string>>({})
  const [userTokenBalance, setUserTokenBalance] = useState<bigint>(0n)
  const [userTokenBalanceAvailable, setUserTokenBalanceAvailable] = useState(false)
  const [userTokenBalanceLoading, setUserTokenBalanceLoading] = useState(false)
  const [tokenSymbol, setTokenSymbol] = useState<string | null>(null)
  const [projectDataRevision, setProjectDataRevision] = useState(0)

  const chainIdNum = parseInt(chainId)

  const availableAccountingSymbols = [...new Set(chainFundsData.map(data => data.accountingSymbol))]
  const activeAccountingSymbol = availableAccountingSymbols.includes(selectedAccountingSymbol)
    ? selectedAccountingSymbol
    : availableAccountingSymbols[0] || 'ETH'
  const visibleChainFundsData = chainFundsData.filter(
    data => data.accountingSymbol === activeAccountingSymbol,
  )
  const activeChainData = visibleChainFundsData.find(cd => cd.chainId === chainIdNum) || visibleChainFundsData[0]
  const currencySymbol = activeAccountingSymbol

  useEffect(() => {
    const refresh = () => setProjectDataRevision(revision => revision + 1)
    window.addEventListener('juice:project-data-invalidated', refresh)
    return () => window.removeEventListener('juice:project-data-invalidated', refresh)
  }, [])

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)

        setConfigurationError(null)
        const chainResolution = await resolveProjectChains(projectId, chainIdNum)
        setChainMappingAvailable(chainResolution.mappingAvailable)

        // Fetch payout data from all chains in parallel
        // Skip payout-related fetches for revnets since they don't have payouts
        const chainDataPromises = chainResolution.chains.map(async (chain): Promise<{ data: ChainFundsData[]; error?: string }> => {
          try {
            const [chainProject, tokenSupply, pendingReserved, accountingContexts] = await Promise.all([
              fetchProjectWithRuleset(String(chain.projectId), chain.chainId),
              fetchProjectTokenSupply(String(chain.projectId), chain.chainId),
              fetchPendingReservedTokens(String(chain.projectId), chain.chainId),
              readFundAccessContexts(
                createFundAccessClient(chain.chainId),
                chain.chainId,
                BigInt(chain.projectId),
              ),
            ])
            if (tokenSupply === null) throw new Error('Project token supply could not be verified')
            if (accountingContexts.length === 0) throw new Error('No recognized accounting context')

            let splitsData: Awaited<ReturnType<typeof fetchProjectSplits>> | null = null
            if (!isRevnet && chainProject?.currentRuleset?.id) {
              splitsData = await fetchProjectSplits(
                String(chain.projectId),
                chain.chainId,
                chainProject.currentRuleset.id
              )
              if (!splitsData.configurationComplete) throw new Error('Treasury configuration could not be verified')
            }

            const cashOutTaxRate = chainProject?.currentRuleset?.cashOutTaxRate ?? 10000
            const supply = BigInt(tokenSupply)
            const cashOutSupply = supply + BigInt(pendingReserved)

            const data = accountingContexts.map(context => {
              const payoutSplits = splitsData?.splitGroups?.find(
                group => group.groupId === BigInt(context.token).toString(),
              )?.splits || []
              const reclaimableSurplus = context.currentSurplus

              return {
                chainId: chain.chainId,
                projectId: chain.projectId,
                balance: context.balance.toString(),
                fundAccess: context,
                payoutSplits,
                accountingToken: context.token,
                accountingCurrency: context.accountingCurrency,
                accountingSymbol: context.tokenSymbol,
                decimals: context.decimals,
                tokenSupply,
                cashOutTaxRate,
                scopeCashOutsToLocalBalances: chainProject?.currentRuleset?.scopeCashOutsToLocalBalances === true,
                useDataHookForCashOut: chainProject?.currentRuleset?.useDataHookForCashOut === true,
                cashOutPerToken: calculateFloorPrice(
                  reclaimableSurplus,
                  cashOutSupply,
                  cashOutTaxRate,
                  context.decimals,
                ),
                reclaimableSurplus: reclaimableSurplus.toString(),
                cashOutSupply: cashOutSupply.toString(),
              } satisfies ChainFundsData
            })
            return { data }
          } catch (err) {
            console.error(`Failed to fetch funds data for chain ${chain.chainId}:`, err)
            return { data: [], error: err instanceof Error ? err.message : 'Treasury configuration unavailable' }
          }
        })

        const chainResults = await Promise.all(chainDataPromises)
        const allChainData = chainResults.flatMap(result => result.data)
        setChainFundsData(allChainData)
        const errors = chainResults.flatMap(result => result.error ? [result.error] : [])
        setConfigurationError(errors.length > 0 ? [...new Set(errors)].join('. ') : null)
        const symbols = [...new Set(allChainData.map(data => data.accountingSymbol))]
        setSelectedAccountingSymbol(previous => symbols.includes(previous) ? previous : symbols[0] || 'ETH')

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
  }, [projectId, chainId, chainIdNum, isRevnet, projectDataRevision])

  // Cash-out actions are chain-local, so never present an aggregate balance as spendable.
  useEffect(() => {
    async function loadUserTokenBalance() {
      if (!isSignedIn || !userAddress || chainFundsData.length === 0) {
        setUserTokenBalance(0n)
        setUserTokenBalanceAvailable(!isSignedIn || !userAddress)
        setUserTokenBalanceLoading(false)
        return
      }

      try {
        setUserTokenBalanceLoading(true)
        setUserTokenBalanceAvailable(false)
        const activeProject = chainFundsData.find(data => data.chainId === chainIdNum)
        if (!activeProject) {
          setUserTokenBalance(0n)
          setUserTokenBalanceAvailable(false)
          return
        }
        const result = await fetchUserTokenBalance(
          String(activeProject.projectId),
          activeProject.chainId,
          userAddress,
        )
        setUserTokenBalance(BigInt(result.balance))
        setUserTokenBalanceAvailable(true)
      } catch (err) {
        console.error('Failed to fetch user token balance:', err)
        setUserTokenBalance(0n)
        setUserTokenBalanceAvailable(false)
      } finally {
        setUserTokenBalanceLoading(false)
      }
    }
    loadUserTokenBalance()
  }, [isSignedIn, userAddress, chainFundsData, chainIdNum])

  // Calculate totals
  const totalBalance = visibleChainFundsData.reduce(
    (sum, data) => sum + BigInt(data.balance),
    0n,
  ).toString()
  const decimals = activeChainData?.decimals || (currencySymbol === 'USDC' ? 6 : 18)

  const payoutAccess = visibleChainFundsData.flatMap(data => data.fundAccess.payoutLimits)
  const availablePayoutRoutes = payoutAccess.filter(limit => limit.available > 0n)
  const allPayoutsUseAccountingCurrency = visibleChainFundsData.every(data =>
    data.fundAccess.payoutLimits.every(limit => limit.currency === data.accountingCurrency)
  )
  const totalAvailable = allPayoutsUseAccountingCurrency
    ? payoutAccess.reduce((sum, limit) => sum + limit.available, 0n)
    : 0n

  // This is the protocol's live currentSurplusOf result per terminal/token,
  // not a balance-minus-configuration estimate.
  const surplus = visibleChainFundsData.reduce(
    (sum, data) => sum + BigInt(data.reclaimableSurplus),
    0n,
  )

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
      {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}
      {availableAccountingSymbols.length > 1 && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {availableAccountingSymbols.map(symbol => (
            <button
              key={symbol}
              type="button"
              onClick={() => setSelectedAccountingSymbol(symbol)}
              className={`px-3 py-2 text-xs font-medium border ${
                currencySymbol === symbol
                  ? isDark ? 'border-green-400 text-green-400 bg-green-500/10' : 'border-green-600 text-green-700 bg-green-50'
                  : isDark ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-600'
              }`}
            >
              {symbol} treasury
            </button>
          ))}
        </div>
      )}

      {configurationError && (
        <div className={`p-3 mb-4 text-xs ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-700'}`}>
          {configurationError}. Transactions are blocked until the live configuration can be verified.
        </div>
      )}

      {/* Balance */}
      <div className="mb-4">
        <h3 className={`text-sm font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Balance
        </h3>
        <div className={`text-lg font-mono font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {formatCurrency(totalBalance, decimals, currencySymbol)}
        </div>
      </div>

      {/* Per-chain breakdown (collapsible) */}
      {visibleChainFundsData.length > 1 && (
        <PerChainBreakdown
          projectBalances={visibleChainFundsData.map(data => ({
            chainId: data.chainId,
            balance: data.balance,
            symbol: data.accountingSymbol,
            decimals: data.decimals,
          }))}
          defaultDecimals={decimals}
          defaultSymbol={currencySymbol}
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
              <div className={`text-sm font-mono ${availablePayoutRoutes.length > 0 ? (isDark ? 'text-white' : 'text-gray-900') : (isDark ? 'text-gray-500' : 'text-gray-400')}`}>
                {allPayoutsUseAccountingCurrency
                  ? `${formatCurrency(totalAvailable.toString(), decimals, currencySymbol)} available`
                  : `${availablePayoutRoutes.length} live currency route${availablePayoutRoutes.length === 1 ? '' : 's'} available`}
              </div>
              {availablePayoutRoutes.length > 0 && !configurationError && (
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
            {availablePayoutRoutes.length === 0 && (
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
            {formatCurrency(surplus > 0n ? surplus.toString() : '0', decimals, currencySymbol)}
          </span>
        </div>
      </div>

      {/* Cash-out actions and estimates are scoped to the dashboard's selected chain. */}
      {(() => {
        const activeCashOut = visibleChainFundsData.find(cd => cd.chainId === chainIdNum)
        if (!activeCashOut || activeCashOut.cashOutTaxRate >= 10000) return null
        const hasSurplus = BigInt(activeCashOut.reclaimableSurplus) > 0n
        const canShowLocalBaseline = activeCashOut.scopeCashOutsToLocalBalances
          && !activeCashOut.useDataHookForCashOut

        return (
          <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            {/* Cash out value header */}
            <div className="mb-3">
              <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Membership cash out value
              </div>
              <div className={`text-lg font-mono font-semibold ${
                canShowLocalBaseline && hasSurplus && activeCashOut.cashOutPerToken > 0
                  ? isDark ? 'text-green-400' : 'text-green-600'
                  : isDark ? 'text-gray-500' : 'text-gray-400'
              }`}>
                {canShowLocalBaseline && hasSurplus && activeCashOut.cashOutPerToken > 0
                  ? `${activeCashOut.cashOutPerToken.toFixed(6)} ${activeCashOut.accountingSymbol}`
                  : 'Live quote required'
                }
              </div>
            </div>

            {/* Explanation */}
            <div className={`text-xs mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {canShowLocalBaseline
                ? hasSurplus
                  ? `This is the selected chain's baseline share of reclaimable surplus.`
                  : <>Cash outs require reclaimable surplus on the selected chain.<span className={isDark ? 'text-yellow-400' : 'text-yellow-600'}> None is currently visible.</span></>
                : 'The active cross-chain or hook configuration must be quoted by the terminal for the amount you choose.'
              }
            </div>

            {/* Current cash out tax rate */}
            <CashOutTaxRateDisplay
              cashOutEnabledChains={[activeCashOut]}
              unifiedTaxRate={activeCashOut.cashOutTaxRate}
              isDark={isDark}
            />

            <div className={`text-xs mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              This is a current curve estimate before hooks and any protocol fee. The transaction uses a fresh terminal preview and a minimum return.
            </div>

            {/* User token balance - right below tax rate */}
            {isSignedIn && (
              <div className="mb-3">
                <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Your balance: <span className={`font-mono ${userTokenBalance > 0n ? (isDark ? 'text-white' : 'text-gray-900') : ''}`}>
                    {userTokenBalanceLoading
                      ? 'Loading…'
                      : userTokenBalanceAvailable ? formatBalance(userTokenBalance.toString(), 18) : 'Unavailable'}
                  </span> {userTokenBalanceAvailable && !userTokenBalanceLoading ? tokenSymbol || 'tokens' : ''}
                </span>
              </div>
            )}

            {/* Cash out calculator (collapsible) - only show when there's surplus */}
            {canShowLocalBaseline && hasSurplus && (
              <CashOutCalculator
                chain={activeCashOut}
                isDark={isDark}
                tokenSymbol={tokenSymbol}
                userTokenBalance={userTokenBalanceAvailable ? userTokenBalance : undefined}
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
              const currentTaxPercent = (currentTax / 100).toFixed(2).replace(/\.?0+$/, '') || '0'
              const upcomingTaxPercent = (upcomingTax / 100).toFixed(2).replace(/\.?0+$/, '') || '0'
              const effectiveDate = new Date(upcomingRuleset.start * 1000)
              const dateStr = effectiveDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

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
                    Curve rate changing from {currentTaxPercent}% to {upcomingTaxPercent}% on {dateStr}.
                    {upcomingTax >= 10000
                      ? ' Cash outs will be disabled.'
                      : isIncreasing
                        ? ' The baseline for partial exits will decrease.'
                        : ' The baseline for partial exits will increase.'}
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
                        onClick={userTokenBalanceAvailable && userTokenBalance > 0n && !configurationError ? onCashOut : undefined}
                        className={`px-3 py-1.5 text-xs transition-colors border ${
                          userTokenBalanceAvailable && userTokenBalance > 0n && !configurationError
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
                      {(!userTokenBalanceAvailable || userTokenBalance === 0n || !!configurationError) && (
                        <div className={`absolute bottom-full left-0 mb-1 px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap ${
                          isDark ? 'bg-juice-dark border border-white/20 text-gray-300' : 'bg-white border border-gray-200 text-gray-600 shadow-sm'
                        }`}>
                          {configurationError
                            ? 'Live configuration could not be verified'
                            : !userTokenBalanceAvailable
                              ? 'Your balance could not be verified'
                              : "You don't have tokens on this chain"}
                        </div>
                      )}
                    </div>
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

        // Use the live, ruleset-ID-scoped allowance and protocol surplus snapshot.
        const surplusAllowances = activeChainData?.fundAccess.surplusAllowances || []
        const surplusAllowance = surplusAllowances[0]
        const availableAllowanceRoutes = surplusAllowances.filter(allowance => allowance.available > 0n)

        // Only show if there's a surplus allowance configured
        if (!surplusAllowance || surplusAllowance.configured === 0n) return null
        const allowanceUnit = fundAccessCurrencyLabel(surplusAllowance.currency, activeChainData!.fundAccess)
        const allowanceDisplay = surplusAllowance.unlimited
          ? `Unlimited ${allowanceUnit}`
          : surplusAllowances.length > 1
            ? `${surplusAllowances.length} configured currencies`
            : `${formatFundAccessAmount(surplusAllowance.remaining, activeChainData!.decimals)} ${allowanceUnit} remaining`

        return (
          <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Surplus Allowance
            </div>
            <div className="flex items-center justify-between">
              <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {allowanceDisplay}
              </div>
              {isOwner && availableAllowanceRoutes.length > 0 && (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('juice:use-surplus-allowance', {
                    detail: {
                      projectId,
                      chainId: chainIdNum,
                      allowance: availableAllowanceRoutes[0].available.toString(),
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
              Available now is capped by both remaining allowance and protocol-calculated surplus.
            </div>
          </div>
        )
      })()}

      {/* Payouts configuration - hidden for revnets */}
      {!isRevnet && activeChainData && activeChainData.payoutSplits.length > 0 && (
        <div className={`py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <button
            onClick={() => setShowSplits(!showSplits)}
            className={`flex items-center gap-1 text-sm ${
              isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>Payout recipients ({activeChainData.payoutSplits.length})</span>
            <svg
              className={`w-3 h-3 transition-transform ${showSplits ? 'rotate-180' : ''}`}
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
                  <div key={idx} className="flex items-start justify-between gap-3 text-sm">
                    {split.projectId > 0 ? (
                      <ProjectSplitRoute
                        projectId={split.projectId}
                        chainId={activeChainData.chainId}
                        beneficiary={split.beneficiary}
                        kind="payout"
                        preferAddToBalance={split.preferAddToBalance}
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
              {/* Per-chain breakdown for multi-chain projects */}
              {visibleChainFundsData.length > 1 && (
                <PayoutSplitsBreakdown
                  chainFundsData={visibleChainFundsData}
                  splitEnsNames={splitEnsNames}
                  isDark={isDark}
                />
              )}
            </div>
          )}
        </div>
      )}

    </div>
  )
}
