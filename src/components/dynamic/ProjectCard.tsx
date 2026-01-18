import { useEffect, useState, useMemo, useCallback } from 'react'
import { useWallet, useModal } from '@getpara/react-sdk'
import { createPublicClient, http, formatEther, erc20Abi } from 'viem'
import { fetchProject, fetchConnectedChains, fetchIssuanceRate, fetchSuckerGroupBalance, fetchOwnersCount, fetchEthPrice, fetchProjectTokenSymbol, type Project, type ConnectedChain, type IssuanceRate, type SuckerGroupBalance } from '../../services/bendystraw'
import { resolveIpfsUri, fetchIpfsMetadata, type IpfsProjectMetadata } from '../../utils/ipfs'
import { useThemeStore, useTransactionStore } from '../../stores'
import { VIEM_CHAINS, USDC_ADDRESSES, type SupportedChainId } from '../../constants'

// Parse HTML/markdown description to clean text with line breaks
function parseDescription(html: string): string[] {
  // Replace <p> tags with newlines, strip other HTML
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
}

interface ProjectCardProps {
  projectId: string
  chainId?: string
}

const CHAIN_INFO: Record<string, { name: string; slug: string }> = {
  '1': { name: 'Ethereum', slug: 'eth' },
  '10': { name: 'Optimism', slug: 'op' },
  '8453': { name: 'Base', slug: 'base' },
  '42161': { name: 'Arbitrum', slug: 'arb' },
}

// All chains as fallback when no sucker data available
const ALL_CHAINS: Array<{ chainId: number; projectId: number }> = [
  { chainId: 1, projectId: 0 },  // projectId 0 means use the prop value
  { chainId: 10, projectId: 0 },
  { chainId: 8453, projectId: 0 },
  { chainId: 42161, projectId: 0 },
]

const TOKENS = [
  { symbol: 'ETH', name: 'Ether' },
  { symbol: 'USDC', name: 'USD Coin' },
]

export default function ProjectCard({ projectId, chainId: initialChainId = '1' }: ProjectCardProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState('25')
  const [memo, setMemo] = useState('')
  const [paying, setPaying] = useState(false)
  const [selectedChainId, setSelectedChainId] = useState(initialChainId)
  const [selectedToken, setSelectedToken] = useState('USDC')
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false)
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false)
  // Connected chains with their project IDs (may differ per chain)
  const [connectedChains, setConnectedChains] = useState<ConnectedChain[]>([])
  // Current issuance rate for token calculation
  const [issuanceRate, setIssuanceRate] = useState<IssuanceRate | null>(null)
  // Full metadata from IPFS (has complete description)
  const [fullMetadata, setFullMetadata] = useState<IpfsProjectMetadata | null>(null)
  // Sucker group balance (total + per-chain breakdown)
  const [suckerBalance, setSuckerBalance] = useState<SuckerGroupBalance | null>(null)
  // ETH price in USD
  const [ethPrice, setEthPrice] = useState<number | null>(null)
  // Owners count (unique token holders with balance > 0)
  const [ownersCount, setOwnersCount] = useState<number | null>(null)
  // Tooltip hover states
  const [showBalanceTooltip, setShowBalanceTooltip] = useState(false)
  const [showPaymentsTooltip, setShowPaymentsTooltip] = useState(false)
  // Pay us feature
  const [payUs, setPayUs] = useState(true)
  const [juicyIssuanceRate, setJuicyIssuanceRate] = useState<IssuanceRate | null>(null)
  // Wallet balance state
  const [walletEthBalance, setWalletEthBalance] = useState<bigint | null>(null)
  const [walletUsdcBalance, setWalletUsdcBalance] = useState<bigint | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  // Project's issued ERC20 token symbol (e.g., NANA for Bananapus)
  const [projectTokenSymbol, setProjectTokenSymbol] = useState<string | null>(null)
  const { theme } = useThemeStore()
  const { addTransaction } = useTransactionStore()
  const isDark = theme === 'dark'

  // Para SDK hooks
  const { data: wallet } = useWallet()
  const { openModal } = useModal()
  const isConnected = !!wallet?.address

  // $JUICY project ID (using NANA as placeholder until real deployment)
  const JUICY_PROJECT_ID = 1
  const JUICY_FEE_PERCENT = 2.5

  // Use connected chains if available, otherwise fall back to all chains
  const availableChains = connectedChains.length > 0 ? connectedChains : ALL_CHAINS

  // Get the current project ID for the selected chain (may differ from initial projectId)
  const chainData = availableChains.find(c => c.chainId === parseInt(selectedChainId))
  const currentProjectId = (chainData?.projectId && chainData.projectId !== 0)
    ? chainData.projectId.toString()
    : projectId
  const selectedChainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO['1']

  // Fetch connected chains on mount
  useEffect(() => {
    async function loadConnectedChains() {
      const chains = await fetchConnectedChains(projectId, parseInt(initialChainId))
      setConnectedChains(chains)
    }
    loadConnectedChains()
  }, [projectId, initialChainId])

  // Fetch $JUICY issuance rate when chain changes
  useEffect(() => {
    fetchIssuanceRate(String(JUICY_PROJECT_ID), parseInt(selectedChainId))
      .then(setJuicyIssuanceRate)
      .catch(() => setJuicyIssuanceRate(null))
  }, [selectedChainId])

  // Fetch ETH price on mount
  useEffect(() => {
    fetchEthPrice().then(setEthPrice)
  }, [])

  // Fetch project data and issuance rate when chain changes
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const chainIdNum = parseInt(selectedChainId)
        const [data, rate, groupBalance, owners, tokenSymbol] = await Promise.all([
          fetchProject(currentProjectId, chainIdNum),
          fetchIssuanceRate(currentProjectId, chainIdNum),
          fetchSuckerGroupBalance(currentProjectId, chainIdNum),
          fetchOwnersCount(currentProjectId, chainIdNum),
          fetchProjectTokenSymbol(currentProjectId, chainIdNum),
        ])
        setProject(data)
        setIssuanceRate(rate)
        setSuckerBalance(groupBalance)
        setOwnersCount(owners)
        setProjectTokenSymbol(tokenSymbol)

        // Fetch full metadata from IPFS if metadataUri available
        if (data.metadataUri) {
          const ipfsMetadata = await fetchIpfsMetadata(data.metadataUri)
          setFullMetadata(ipfsMetadata)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentProjectId, selectedChainId])

  // Fetch wallet balances when connected and chain changes
  const fetchWalletBalances = useCallback(async () => {
    if (!wallet?.address) {
      setWalletEthBalance(null)
      setWalletUsdcBalance(null)
      return
    }

    const chainIdNum = parseInt(selectedChainId)
    const chain = VIEM_CHAINS[chainIdNum as SupportedChainId]
    if (!chain) return

    setBalanceLoading(true)
    try {
      const publicClient = createPublicClient({
        chain,
        transport: http(),
      })

      // Fetch ETH balance
      const ethBalance = await publicClient.getBalance({
        address: wallet.address as `0x${string}`,
      })
      setWalletEthBalance(ethBalance)

      // Fetch USDC balance
      const usdcAddress = USDC_ADDRESSES[chainIdNum as SupportedChainId]
      if (usdcAddress) {
        const usdcBalance = await publicClient.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [wallet.address as `0x${string}`],
        })
        setWalletUsdcBalance(usdcBalance)
      }
    } catch (err) {
      console.error('Failed to fetch wallet balances:', err)
    } finally {
      setBalanceLoading(false)
    }
  }, [wallet?.address, selectedChainId])

  useEffect(() => {
    fetchWalletBalances()
  }, [fetchWalletBalances])

  // Calculate expected tokens based on amount and issuance rate
  const expectedTokens = useMemo(() => {
    if (!issuanceRate || !amount || parseFloat(amount) <= 0) return null

    try {
      const amountFloat = parseFloat(amount)

      // Convert to ETH equivalent if paying in USDC
      let ethEquivalent = amountFloat
      if (selectedToken === 'USDC' && ethPrice) {
        ethEquivalent = amountFloat / ethPrice
      }

      // tokensPerEth is tokens per 1 ETH
      const tokens = ethEquivalent * issuanceRate.tokensPerEth

      if (tokens < 0.01) return null

      return tokens
    } catch (err) {
      console.error('Token calc error:', err)
      return null
    }
  }, [amount, issuanceRate, selectedToken, ethPrice])

  // Calculate fee and totals for Pay us feature
  const amountNum = parseFloat(amount) || 0
  const feeAmount = payUs ? amountNum * (JUICY_FEE_PERCENT / 100) : 0
  const totalAmount = amountNum + feeAmount

  // Calculate $JUICY tokens from fee (convert to ETH equivalent if USDC)
  const estimatedJuicyTokens = useMemo(() => {
    if (!payUs || !juicyIssuanceRate || feeAmount <= 0) return 0
    let feeEthEquivalent = feeAmount
    if (selectedToken === 'USDC' && ethPrice) {
      feeEthEquivalent = feeAmount / ethPrice
    }
    return feeEthEquivalent * juicyIssuanceRate.tokensPerEth
  }, [payUs, juicyIssuanceRate, feeAmount, selectedToken, ethPrice])

  // Check if user has sufficient balance for the payment
  const checkSufficientBalance = useCallback(() => {
    if (balanceLoading) return { sufficient: false, reason: 'loading' }

    const paymentAmount = parseFloat(amount) || 0
    const total = paymentAmount + feeAmount

    // Minimum ETH needed for gas (rough estimate)
    const minGasEth = 0.001
    const ethBalanceNum = walletEthBalance ? parseFloat(formatEther(walletEthBalance)) : 0

    if (selectedToken === 'ETH') {
      // Need ETH for both payment and gas
      const totalEthNeeded = total + minGasEth
      if (ethBalanceNum < totalEthNeeded) {
        return { sufficient: false, reason: 'insufficient_eth', needed: totalEthNeeded, have: ethBalanceNum }
      }
    } else if (selectedToken === 'USDC') {
      // Need USDC for payment and ETH for gas
      const usdcBalanceNum = walletUsdcBalance ? Number(walletUsdcBalance) / 1e6 : 0
      if (usdcBalanceNum < total) {
        return { sufficient: false, reason: 'insufficient_usdc', needed: total, have: usdcBalanceNum }
      }
      if (ethBalanceNum < minGasEth) {
        return { sufficient: false, reason: 'insufficient_gas', needed: minGasEth, have: ethBalanceNum }
      }
    }

    return { sufficient: true }
  }, [amount, feeAmount, selectedToken, walletEthBalance, walletUsdcBalance, balanceLoading])

  if (loading) {
    return (
      <div className="glass  p-4 animate-pulse">
        <div className="h-6 bg-white/10  w-3/4 mb-3" />
        <div className="h-4 bg-white/10  w-1/2 mb-2" />
        <div className="h-4 bg-white/10  w-2/3" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="glass  p-4 border-red-500/30">
        <p className="text-red-400 text-sm">{error || 'Project not found'}</p>
      </div>
    )
  }

  const formatBalance = (wei: string) => {
    const eth = parseFloat(wei) / 1e18
    return eth.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }

  const formatUsd = (wei: string) => {
    if (!ethPrice) return null
    const eth = parseFloat(wei) / 1e18
    const usd = eth * ethPrice
    return usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  // Calculate total balance USD value
  const totalBalanceUsd = suckerBalance?.totalBalance ? formatUsd(suckerBalance.totalBalance) : null

  const handlePay = async () => {
    if (!amount || parseFloat(amount) <= 0) return

    // Step 1: Check if wallet is connected
    if (!isConnected) {
      openModal()
      return
    }

    // Step 2: Refresh balances and check if sufficient
    await fetchWalletBalances()
    const balanceCheck = checkSufficientBalance()

    if (!balanceCheck.sufficient) {
      if (balanceCheck.reason === 'loading') {
        // Wait and retry
        return
      }
      // Insufficient funds - open modal for onramp
      // Para modal will show options to add funds
      openModal()
      return
    }

    // Step 3: Proceed with payment
    setPaying(true)
    try {
      const txId = addTransaction({
        type: 'pay',
        projectId: currentProjectId,
        chainId: parseInt(selectedChainId),
        amount,
        token: selectedToken,
        status: 'pending',
      })

      window.dispatchEvent(new CustomEvent('juice:pay-project', {
        detail: {
          txId,
          projectId: currentProjectId,
          chainId: parseInt(selectedChainId),
          amount,
          token: selectedToken,
          memo,
          // Include fee info for batched transaction
          payUs,
          feeAmount: feeAmount.toString(),
          juicyProjectId: JUICY_PROJECT_ID,
          totalAmount: totalAmount.toString(),
        }
      }))
      setAmount('')
      setMemo('')
    } finally {
      setPaying(false)
    }
  }

  const logoUrl = resolveIpfsUri(project.logoUri)
  const projectUrl = `https://juicebox.money/v5/${selectedChainInfo.slug}:${currentProjectId}`

  return (
    <div className={`w-full border-l-2 pl-3 ${
      isDark ? 'border-gray-600' : 'border-gray-300'
    }`}>
      {/* Card with border - constrained width */}
      <div className={`max-w-md border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        {logoUrl ? (
          <img src={logoUrl} alt={project.name} className="w-14 h-14 object-cover" />
        ) : (
          <div className="w-14 h-14 bg-juice-orange/20 flex items-center justify-center">
            <span className="text-juice-orange font-bold text-xl">{project.name.charAt(0).toUpperCase()}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {project.name}
          </h3>
          <a
            href={projectUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-xs hover:underline ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
          >
            Project #{currentProjectId}
          </a>
        </div>
      </div>

      {/* Stats - inline, no background */}
      <div className="flex gap-6 mb-3 text-sm">
        <div
          className="relative"
          onMouseEnter={() => setShowBalanceTooltip(true)}
          onMouseLeave={() => setShowBalanceTooltip(false)}
        >
          <span className={`font-mono cursor-help ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {totalBalanceUsd ? `$${totalBalanceUsd}` : `${formatBalance(suckerBalance?.totalBalance || project.balance)} ETH`}
          </span>
          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}> balance</span>

          {/* Per-chain breakdown tooltip */}
          {showBalanceTooltip && suckerBalance && suckerBalance.projectBalances.length > 0 && (
            <div className={`absolute top-full left-0 mt-1 p-2 shadow-lg z-20 min-w-[180px] text-xs ${
              isDark ? 'bg-juice-dark border border-white/20' : 'bg-white border border-gray-200'
            }`}>
              {suckerBalance.projectBalances.map(pb => {
                const chainInfo = CHAIN_INFO[pb.chainId.toString()]
                if (!chainInfo) return null
                return (
                  <div key={pb.chainId} className="flex justify-between gap-4 py-0.5">
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{chainInfo.name}</span>
                    <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {formatBalance(pb.balance)} ETH
                    </span>
                  </div>
                )
              })}
              <div className={`flex justify-between gap-4 pt-1 mt-1 border-t ${
                isDark ? 'border-white/10' : 'border-gray-100'
              }`}>
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>[All chains]</span>
                <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {totalBalanceUsd ? `$${totalBalanceUsd}` : `${formatBalance(suckerBalance.totalBalance)} ETH`}
                </span>
              </div>
            </div>
          )}
        </div>
        <div>
          <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>{ownersCount ?? 0}</span>
          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}> owner{ownersCount !== 1 ? 's' : ''}</span>
        </div>
        <div
          className="relative"
          onMouseEnter={() => setShowPaymentsTooltip(true)}
          onMouseLeave={() => setShowPaymentsTooltip(false)}
        >
          <span className={`font-mono cursor-help ${isDark ? 'text-white' : 'text-gray-900'}`}>{suckerBalance?.totalPaymentsCount ?? 0}</span>
          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}> payment{suckerBalance?.totalPaymentsCount !== 1 ? 's' : ''}</span>

          {/* Per-chain payments breakdown tooltip */}
          {showPaymentsTooltip && suckerBalance && suckerBalance.projectBalances.length > 0 && (
            <div className={`absolute top-full left-0 mt-1 p-2 shadow-lg z-20 min-w-[140px] text-xs ${
              isDark ? 'bg-juice-dark border border-white/20' : 'bg-white border border-gray-200'
            }`}>
              {suckerBalance.projectBalances.map(pb => {
                const chainInfo = CHAIN_INFO[pb.chainId.toString()]
                if (!chainInfo) return null
                return (
                  <div key={pb.chainId} className="flex justify-between gap-4 py-0.5">
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{chainInfo.name}</span>
                    <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {pb.paymentsCount}
                    </span>
                  </div>
                )
              })}
              <div className={`flex justify-between gap-4 pt-1 mt-1 border-t ${
                isDark ? 'border-white/10' : 'border-gray-100'
              }`}>
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>[All chains]</span>
                <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {suckerBalance.totalPaymentsCount}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pay form */}
      <div className={`mb-3 p-3  ${
        isDark ? 'bg-white/5' : 'bg-gray-50'
      }`}>
        {/* Chain selector */}
        <div className="relative mb-3">
          <button
            onClick={() => {
              setChainDropdownOpen(!chainDropdownOpen)
              setTokenDropdownOpen(false)
            }}
            className={`flex items-center gap-1 text-sm font-medium ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}
          >
            Pay on <span className="underline">{selectedChainInfo.name}</span>
            <svg className={`w-4 h-4 transition-transform ${chainDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {chainDropdownOpen && (
            <div className={`absolute top-full left-0 mt-1 py-1 shadow-lg z-10 min-w-[140px] ${
              isDark ? 'bg-juice-dark border border-white/10' : 'bg-white border border-gray-200'
            }`}>
              {availableChains.map(chain => {
                const info = CHAIN_INFO[chain.chainId.toString()]
                if (!info) return null
                return (
                  <button
                    key={chain.chainId}
                    onClick={() => {
                      setSelectedChainId(chain.chainId.toString())
                      setChainDropdownOpen(false)
                    }}
                    className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                      chain.chainId.toString() === selectedChainId
                        ? isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900'
                        : isDark ? 'text-gray-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {info.name}
                    {chain.projectId !== 0 && chain.projectId.toString() !== projectId && (
                      <span className={`ml-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        (#{chain.projectId})
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Amount input with token selector and pay button */}
        <div className="flex gap-2">
          <div className={`flex-1 flex items-center ${
            isDark
              ? 'bg-juice-dark border border-white/10'
              : 'bg-white border border-gray-200'
          }`}>
            <input
              type="number"
              step="0.001"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onFocus={() => { setChainDropdownOpen(false); setTokenDropdownOpen(false) }}
              placeholder="0.00"
              className={`flex-1 px-3 py-2 text-sm bg-transparent outline-none ${
                isDark ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
              }`}
            />
            {/* Token selector */}
            <div className="relative">
              <button
                onClick={() => {
                  setTokenDropdownOpen(!tokenDropdownOpen)
                  setChainDropdownOpen(false)
                }}
                className={`flex items-center justify-between w-20 px-2 py-2 text-sm font-medium border-l ${
                  isDark ? 'border-white/10 text-white hover:bg-white/5' : 'border-gray-200 text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span>{selectedToken}</span>
                <svg className={`w-3 h-3 transition-transform ${tokenDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {tokenDropdownOpen && (
                <div className={`absolute top-full right-0 mt-1 py-1  shadow-lg z-10 min-w-[100px] ${
                  isDark ? 'bg-juice-dark border border-white/10' : 'bg-white border border-gray-200'
                }`}>
                  {TOKENS.map(token => (
                    <button
                      key={token.symbol}
                      onClick={() => {
                        setSelectedToken(token.symbol)
                        setTokenDropdownOpen(false)
                      }}
                      className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                        token.symbol === selectedToken
                          ? isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900'
                          : isDark ? 'text-gray-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {token.symbol}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={handlePay}
            disabled={paying || !amount || parseFloat(amount) <= 0}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              paying || !amount || parseFloat(amount) <= 0
                ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                : !isConnected
                  ? 'bg-juice-cyan hover:bg-juice-cyan/90 text-black'
                  : !checkSufficientBalance().sufficient
                    ? 'bg-juice-orange hover:bg-juice-orange/90 text-black'
                    : 'bg-green-500 hover:bg-green-600 text-black'
            }`}
          >
            {paying ? '...' : 'Pay'}
          </button>
        </div>

        {/* Quick amount options */}
        <div className="flex gap-2 mt-2">
          {(selectedToken === 'USDC' ? ['10', '25', '50', '100'] : ['0.01', '0.05', '0.1', '0.5']).map(val => (
            <button
              key={val}
              onClick={() => setAmount(val)}
              className={`min-w-[3rem] px-2 py-1 text-xs transition-colors ${
                amount === val
                  ? isDark ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-900'
                  : isDark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-150'
              }`}
            >
              {val}
            </button>
          ))}
        </div>

        {/* Token preview */}
        {amountNum > 0 && expectedTokens !== null && (
          <div className={`mt-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            You get ~{expectedTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${projectTokenSymbol || project.name.split(' ')[0].toUpperCase().slice(0, 6)}
            {payUs && estimatedJuicyTokens > 0 && (
              <span> + {estimatedJuicyTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} $JUICY</span>
            )}
          </div>
        )}

        {/* Memo input */}
        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Add a memo (optional)"
          className={`w-full mt-4 px-3 py-2 text-sm outline-none ${
            isDark
              ? 'bg-transparent text-white placeholder-gray-500'
              : 'bg-transparent text-gray-900 placeholder-gray-400'
          }`}
        />

      </div>

      {/* Pay Juicy checkbox */}
      <div className="mt-2">
        <label className={`group relative flex items-center gap-2 cursor-pointer ${
          isDark ? 'text-gray-300' : 'text-gray-600'
        }`}>
          <input
            type="checkbox"
            checked={payUs}
            onChange={(e) => setPayUs(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-300 text-juice-orange focus:ring-juice-orange"
          />
          <span className="text-sm">Pay Juicy (+{JUICY_FEE_PERCENT}%)</span>
          {/* Hover tooltip */}
          <div className={`absolute left-0 bottom-full mb-1 px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap ${
            isDark ? 'bg-juice-dark border border-white/20 text-gray-300' : 'bg-white border border-gray-200 text-gray-600 shadow-sm'
          }`}>
            Invest in $JUICY, we keep building.
          </div>
        </label>
        {payUs && amountNum > 0 && estimatedJuicyTokens > 0 && (
          <div className={`ml-6 mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {feeAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {selectedToken} → ~{estimatedJuicyTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} $JUICY
          </div>
        )}
      </div>
      </div>

      {/* Tagline */}
      {(fullMetadata?.tagline || fullMetadata?.projectTagline) && (
        <div className={`mt-3 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          <div className={`text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Tagline
          </div>
          <p className="text-sm italic">
            {fullMetadata.tagline || fullMetadata.projectTagline}
          </p>
        </div>
      )}

      {/* About section - collapsible */}
      {fullMetadata?.description && (
        <details className="mt-3 group">
          <summary className={`text-xs font-medium cursor-pointer list-none flex items-center gap-1 ${
            isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
          }`}>
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            About
          </summary>
          <div className={`mt-2 text-sm space-y-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            {parseDescription(fullMetadata.description).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
