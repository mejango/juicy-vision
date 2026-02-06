import { useEffect, useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from 'wagmi'
import { createPublicClient, http, formatEther, erc20Abi } from 'viem'
import { fetchProject, fetchConnectedChains, fetchIssuanceRate, fetchSuckerGroupBalance, fetchOwnersCount, fetchEthPrice, fetchProjectTokenSymbol, fetchProjectWithRuleset, type Project, type ConnectedChain, type IssuanceRate, type SuckerGroupBalance } from '../../services/bendystraw'
import { resolveIpfsUri, fetchIpfsMetadata, type IpfsProjectMetadata } from '../../utils/ipfs'
import { getProjectDataHook, fetchResolvedNFTTiers, fetchHookFlags, type ResolvedNFTTier, type JB721HookFlags } from '../../services/nft'
import { useThemeStore, useTransactionStore, type PaymentStage, type TransactionStatus } from '../../stores'
import { VIEM_CHAINS, USDC_ADDRESSES, RPC_ENDPOINTS, CHAINS, type SupportedChainId } from '../../constants'
import { useJuiceBalance } from '../../hooks/useJuiceBalance'
import { useWalletBalances } from '../../hooks/useWalletBalances'
import { useManagedWallet } from '../../hooks'
import { useProjectCardPaymentState, type ProjectCardPaymentState } from '../../hooks/useComponentState'
import BuyJuiceModal from '../juice/BuyJuiceModal'

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
  messageId?: string // For persisting payment state to server (visible to all chat users)
}

const CHAIN_INFO: Record<string, { name: string; slug: string }> = {
  // Mainnets
  '1': { name: 'Ethereum', slug: 'eth' },
  '10': { name: 'Optimism', slug: 'op' },
  '8453': { name: 'Base', slug: 'base' },
  '42161': { name: 'Arbitrum', slug: 'arb' },
  // Testnets
  '11155111': { name: 'Sepolia', slug: 'sepolia' },
  '11155420': { name: 'OP Sepolia', slug: 'opsepolia' },
  '84532': { name: 'Base Sepolia', slug: 'basesepolia' },
  '421614': { name: 'Arb Sepolia', slug: 'arbsepolia' },
}

// All chains as fallback when no sucker data available
const ALL_MAINNET_CHAINS: Array<{ chainId: number; projectId: number }> = [
  { chainId: 1, projectId: 0 },  // projectId 0 means use the prop value
  { chainId: 10, projectId: 0 },
  { chainId: 8453, projectId: 0 },
  { chainId: 42161, projectId: 0 },
]

const ALL_TESTNET_CHAINS: Array<{ chainId: number; projectId: number }> = [
  { chainId: 11155111, projectId: 0 },  // Sepolia
  { chainId: 11155420, projectId: 0 },  // OP Sepolia
  { chainId: 84532, projectId: 0 },     // Base Sepolia
  { chainId: 421614, projectId: 0 },    // Arb Sepolia
]

// Testnet chain IDs for detection
const TESTNET_CHAIN_IDS = [11155111, 11155420, 84532, 421614]

const TOKENS = [
  { symbol: 'ETH', name: 'Ether' },
  { symbol: 'USDC', name: 'USD Coin' },
  { symbol: 'PAY_CREDITS', name: 'Pay Credits' },
]

export type PaymentToken = 'ETH' | 'USDC' | 'PAY_CREDITS'

// Stage labels for payment progress
const STAGE_LABELS: Record<PaymentStage, string> = {
  checking: 'Checking wallet...',
  switching: 'Switching network...',
  approving: 'Approve USDC in wallet...',
  signing: 'Sign permit in wallet...',
  submitting: 'Confirm transaction...',
  confirming: 'Waiting for confirmation...',
  queueing: 'Queuing payment...',
}

// Payment progress indicator component
function PaymentProgress({
  stage,
  status,
  error,
  hash,
  chainId,
  isDark,
  onRetry,
}: {
  stage?: PaymentStage
  status: TransactionStatus
  error?: string
  hash?: string
  chainId: number
  isDark: boolean
  onRetry: () => void
}) {
  // Get explorer link for transaction
  const explorerLink = hash ? (CHAINS[chainId]?.explorerTx || 'https://etherscan.io/tx/') + hash : null

  // Confirmed state - show success with checkmark
  if (status === 'confirmed') {
    return (
      <div className={`mt-2 p-2 text-sm ${
        isDark ? 'bg-green-500/10' : 'bg-green-50'
      }`}>
        <div className={`flex items-center gap-2 ${isDark ? 'text-green-400' : 'text-green-600'}`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>Payment confirmed!</span>
        </div>
        {explorerLink && (
          <a
            href={explorerLink}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-xs mt-1 ml-6 underline block ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
          >
            View on explorer
          </a>
        )}
      </div>
    )
  }

  // Queued state - show success for Pay Credits payments
  if (status === 'queued') {
    return (
      <div className={`mt-2 p-2 text-sm ${
        isDark ? 'bg-green-500/10' : 'bg-green-50'
      }`}>
        <div className={`flex items-center gap-2 ${isDark ? 'text-green-400' : 'text-green-600'}`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>Payment queued!</span>
        </div>
        <p className={`text-xs mt-1 ml-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          Your Pay Credits have been deducted. The on-chain payment will be processed shortly.
        </p>
      </div>
    )
  }

  // Submitted/confirming state - show spinner and explorer link
  if (status === 'submitted' || stage === 'confirming') {
    return (
      <div className={`mt-2 p-2 text-sm ${
        isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'
      }`}>
        <div className={`flex items-center gap-2 ${isDark ? 'text-juice-cyan' : 'text-cyan-600'}`}>
          <svg className="w-4 h-4 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Waiting for confirmation...</span>
        </div>
        {explorerLink && (
          <a
            href={explorerLink}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-xs mt-1 ml-6 underline block ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
          >
            View on explorer
          </a>
        )}
      </div>
    )
  }

  // Cancelled/failed state
  if (status === 'cancelled' || status === 'failed') {
    return (
      <div className={`mt-2 p-2 text-sm ${
        isDark ? 'bg-yellow-500/10' : 'bg-yellow-50'
      }`}>
        <div className={`flex items-center gap-2 ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{status === 'cancelled' ? 'Payment cancelled' : 'Payment failed'}</span>
        </div>
        {error && (
          <p className={`text-xs mt-1 ml-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {error}
          </p>
        )}
        {explorerLink && (
          <a
            href={explorerLink}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-xs mt-1 ml-6 underline block ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
          >
            View on explorer
          </a>
        )}
        <button
          onClick={onRetry}
          className={`mt-2 ml-6 text-xs underline ${
            isDark ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Try again
        </button>
      </div>
    )
  }

  // In progress state (before submission)
  const stageLabel = stage ? STAGE_LABELS[stage] : 'Processing...'
  return (
    <div className={`mt-2 p-2 text-sm flex items-center gap-2 ${
      isDark ? 'bg-juice-cyan/10 text-juice-cyan' : 'bg-cyan-50 text-cyan-600'
    }`}>
      <svg className="w-4 h-4 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      <span>{stageLabel}</span>
    </div>
  )
}

export default function ProjectCard({ projectId, chainId: initialChainId = '1', messageId }: ProjectCardProps) {
  // Persistent payment state (visible to all chat users)
  const { state: persistedPayment, updateState: updatePersistedPayment } = useProjectCardPaymentState(messageId)

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState('25')
  const [memo, setMemo] = useState('')
  const [paying, setPaying] = useState(false)
  const [selectedChainId, setSelectedChainId] = useState(initialChainId)
  const [selectedToken, setSelectedToken] = useState<PaymentToken>('USDC')
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false)
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false)
  const [showBuyJuiceModal, setShowBuyJuiceModal] = useState(false)
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
  const [ethPriceLoading, setEthPriceLoading] = useState(true)
  const [ethPriceError, setEthPriceError] = useState(false)
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
  // Active payment tracking
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null)
  // NFT tier state
  const [nftTiers, setNftTiers] = useState<ResolvedNFTTier[]>([])
  const [nftHookAddress, setNftHookAddress] = useState<`0x${string}` | null>(null)
  const [nftHookFlags, setNftHookFlags] = useState<JB721HookFlags | null>(null)
  const [selectedTierId, setSelectedTierId] = useState<number | null>(null)
  const [showAllTiers, setShowAllTiers] = useState(false)
  const { theme } = useThemeStore()
  const { addTransaction, getTransaction } = useTransactionStore()
  const isDark = theme === 'dark'

  // Get active payment transaction for status display
  const activePayment = activePaymentId ? getTransaction(activePaymentId) : null

  // wagmi hooks
  const { address, isConnected } = useAccount()

  // Pay Credits balance
  const { balance: juiceBalance, refetch: refetchJuiceBalance } = useJuiceBalance()

  // Cross-chain wallet balances for zero-state detection
  const { totalEth: crossChainEth, totalUsdc: crossChainUsdc, loading: crossChainLoading } = useWalletBalances()

  // Managed wallet for deposit address
  const { address: managedAddress } = useManagedWallet()

  // Funding options popover state (shown when user has zero balance)
  const [showFundingOptions, setShowFundingOptions] = useState(false)
  const [fundingOptionsAnchor, setFundingOptionsAnchor] = useState<{ top: number; left: number } | null>(null)
  const [copiedAddress, setCopiedAddress] = useState(false)

  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  // $JUICY project ID (using NANA as placeholder until real deployment)
  const JUICY_PROJECT_ID = 1
  const JUICY_FEE_PERCENT = 2.5

  // Use connected chains if available, otherwise fall back to all chains
  // Detect if this is a testnet project based on initial chainId
  const isTestnet = TESTNET_CHAIN_IDS.includes(parseInt(initialChainId))
  const fallbackChains = isTestnet ? ALL_TESTNET_CHAINS : ALL_MAINNET_CHAINS
  const availableChains = connectedChains.length > 0 ? connectedChains : fallbackChains

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

  // Restore form state from persisted payment (for chat users who join later)
  useEffect(() => {
    if (persistedPayment && persistedPayment.status !== 'pending') {
      // Restore form values from persisted state
      if (persistedPayment.amount) setAmount(persistedPayment.amount)
      if (persistedPayment.token) setSelectedToken(persistedPayment.token)
      if (persistedPayment.memo) setMemo(persistedPayment.memo)
      if (persistedPayment.selectedChainId) setSelectedChainId(persistedPayment.selectedChainId)
      if (persistedPayment.selectedTierId !== undefined) setSelectedTierId(persistedPayment.selectedTierId)
    }
  }, [persistedPayment?.status]) // Only run when status changes (initial load or update)

  // Fetch $JUICY issuance rate when chain changes
  useEffect(() => {
    fetchIssuanceRate(String(JUICY_PROJECT_ID), parseInt(selectedChainId))
      .then(setJuicyIssuanceRate)
      .catch(() => setJuicyIssuanceRate(null))
  }, [selectedChainId])

  // Fetch NFT tiers when chain changes
  useEffect(() => {
    async function loadNFTTiers() {
      const hookAddr = await getProjectDataHook(currentProjectId, parseInt(selectedChainId))
      if (hookAddr) {
        setNftHookAddress(hookAddr)
        const [tiers, flags] = await Promise.all([
          fetchResolvedNFTTiers(hookAddr, parseInt(selectedChainId)),
          fetchHookFlags(hookAddr, parseInt(selectedChainId)),
        ])
        // Only show available tiers sorted by price
        setNftTiers(tiers.filter(t => t.remainingSupply > 0).sort((a, b) =>
          Number(a.price - b.price)
        ))
        setNftHookFlags(flags)
      } else {
        setNftTiers([])
        setNftHookAddress(null)
        setNftHookFlags(null)
      }
      setSelectedTierId(null) // Reset selection on chain change
      setShowAllTiers(false) // Reset expanded state
    }
    loadNFTTiers()
  }, [currentProjectId, selectedChainId])

  // Fetch ETH price on mount
  useEffect(() => {
    setEthPriceLoading(true)
    setEthPriceError(false)
    fetchEthPrice()
      .then((price) => {
        setEthPrice(price)
        setEthPriceError(price === null)
      })
      .catch(() => {
        setEthPrice(null)
        setEthPriceError(true)
      })
      .finally(() => setEthPriceLoading(false))
  }, [])

  // Fetch project data and issuance rate when chain changes
  useEffect(() => {
    async function load() {
      try {
        // Only show loading skeleton on initial load, not when switching chains
        if (!project) {
          setLoading(true)
        }
        const chainIdNum = parseInt(selectedChainId)

        const [data, groupBalance, owners, tokenSymbol] = await Promise.all([
          fetchProject(currentProjectId, chainIdNum),
          fetchSuckerGroupBalance(currentProjectId, chainIdNum),
          fetchOwnersCount(currentProjectId, chainIdNum),
          fetchProjectTokenSymbol(currentProjectId, chainIdNum),
        ])
        setProject(data)
        setSuckerBalance(groupBalance)
        setOwnersCount(owners)
        setProjectTokenSymbol(tokenSymbol)

        // Fetch issuance rate for current chain (tokens are issued on the chain where payment happens)
        // First try from recent pay events, then fall back to ruleset weight
        let rate = await fetchIssuanceRate(currentProjectId, chainIdNum)

        // If no rate from pay events, calculate from ruleset weight
        if (!rate || rate.tokensPerEth === 0) {
          const projectRuleset = await fetchProjectWithRuleset(currentProjectId, chainIdNum)
          if (projectRuleset?.currentRuleset?.weight) {
            // Weight is tokens (18 decimals) per unit of base currency
            // For USDC projects (6 decimals), we need to account for decimal difference
            const weight = BigInt(projectRuleset.currentRuleset.weight)
            const decimals = groupBalance.decimals ?? 18
            // tokensPerWei = weight / 1e18 gives tokens per 1 unit of currency
            // For USDC (6 decimals): multiply by 1e12 to get tokens per USDC-wei
            const decimalAdjustment = decimals === 6 ? 1e12 : 1
            const tokensPerWei = (Number(weight) / 1e18) * decimalAdjustment
            rate = { tokensPerEth: tokensPerWei, basedOnPayments: 0 }
          }
        }
        setIssuanceRate(rate)

        // Fetch full metadata from IPFS if metadataUri available
        if (data.metadataUri) {
          const ipfsMetadata = await fetchIpfsMetadata(data.metadataUri)
          setFullMetadata(ipfsMetadata)
        }
      } catch (err) {
        // If project not found (not indexed yet), show a placeholder card
        // with known info - newly created projects take ~1 minute to index
        const errorMsg = err instanceof Error ? err.message : 'Failed to load project'
        if (errorMsg.includes('not found') || errorMsg.includes('404')) {
          // Create a placeholder project with known info
          setProject({
            id: currentProjectId,
            projectId: parseInt(currentProjectId),
            chainId: parseInt(selectedChainId),
            version: 5,
            name: `Project #${currentProjectId}`,
            handle: undefined,
            owner: '',
            createdAt: Math.floor(Date.now() / 1000),
            balance: '0',
            volume: '0',
            paymentsCount: 0,
          })
          setSuckerBalance({
            totalBalance: '0',
            totalVolume: '0',
            totalVolumeUsd: '0',
            currency: 1,
            decimals: 18,
            totalPaymentsCount: 0,
            projectBalances: [],
          })
          setOwnersCount(0)
          setError(null) // Clear error - we're showing placeholder
        } else {
          setError(errorMsg)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentProjectId, selectedChainId])

  // Fetch wallet balances when connected and chain changes
  const fetchWalletBalances = useCallback(async () => {
    if (!address) {
      setWalletEthBalance(null)
      setWalletUsdcBalance(null)
      return
    }

    const chainIdNum = parseInt(selectedChainId)
    const chain = VIEM_CHAINS[chainIdNum as SupportedChainId]
    if (!chain) return

    setBalanceLoading(true)
    try {
      const rpcUrl = RPC_ENDPOINTS[chainIdNum]?.[0]
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      })

      // Fetch ETH balance
      const ethBalance = await publicClient.getBalance({
        address: address as `0x${string}`,
      })
      setWalletEthBalance(ethBalance)

      // Fetch USDC balance
      const usdcAddress = USDC_ADDRESSES[chainIdNum as SupportedChainId]
      if (usdcAddress) {
        const usdcBalance = await publicClient.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        })
        setWalletUsdcBalance(usdcBalance)
      }
    } catch (err) {
      console.error('Failed to fetch wallet balances:', err)
    } finally {
      setBalanceLoading(false)
    }
  }, [address, selectedChainId])

  useEffect(() => {
    fetchWalletBalances()
  }, [fetchWalletBalances])

  // Smart token default: select token with highest USD value
  useEffect(() => {
    if (balanceLoading || ethPriceLoading || !ethPrice) return

    const ethBalanceUsd = walletEthBalance
      ? parseFloat(formatEther(walletEthBalance)) * ethPrice
      : 0
    const usdcBalanceUsd = walletUsdcBalance
      ? Number(walletUsdcBalance) / 1e6
      : 0
    const payCreditsUsd = juiceBalance?.balance ?? 0

    // Find the token with the highest USD value
    const balances: Array<{ token: PaymentToken; usd: number }> = [
      { token: 'ETH', usd: ethBalanceUsd },
      { token: 'USDC', usd: usdcBalanceUsd },
      { token: 'PAY_CREDITS', usd: payCreditsUsd },
    ]

    const best = balances.reduce((a, b) => (b.usd > a.usd ? b : a))

    // Only auto-select if user has some balance and hasn't manually changed
    if (best.usd > 0) {
      setSelectedToken(best.token)
    }
  // Only run once when all balances are loaded
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!balanceLoading && !ethPriceLoading && ethPrice !== null])

  // Check if cross-currency conversion is needed (requires ETH price)
  const projectCurrency = suckerBalance?.currency ?? 1 // 1=ETH, 2=USD
  const needsCrossConversion = (projectCurrency === 2 && selectedToken === 'ETH') ||
                               (projectCurrency === 1 && selectedToken === 'USDC')
  const crossConversionBlocked = needsCrossConversion && !ethPrice && !ethPriceLoading

  // Calculate expected tokens based on amount and issuance rate
  // issuanceRate.tokensPerEth is calculated from recent pay events:
  // - For ETH projects: tokens per ETH-wei (18 decimals)
  // - For USDC projects: tokens per USDC-wei (6 decimals)
  const expectedTokens = useMemo(() => {
    if (!issuanceRate || !amount || parseFloat(amount) <= 0) {
      return null
    }

    try {
      const amountFloat = parseFloat(amount)
      const projectCurrency = suckerBalance?.currency ?? 1 // 1=ETH, 2=USD

      // Convert payment amount to the project's native currency wei
      let paymentInProjectWei: number

      if (projectCurrency === 2) {
        // Project accepts USDC (6 decimals)
        if (selectedToken === 'USDC') {
          // Paying USDC to USDC project - direct conversion
          paymentInProjectWei = amountFloat * 1e6
        } else {
          // Paying ETH to USDC project - convert ETH to USD
          paymentInProjectWei = ethPrice ? amountFloat * ethPrice * 1e6 : 0
        }
      } else {
        // Project accepts ETH (18 decimals)
        if (selectedToken === 'ETH') {
          // Paying ETH to ETH project - direct conversion
          paymentInProjectWei = amountFloat * 1e18
        } else {
          // Paying USDC to ETH project - convert USD to ETH
          paymentInProjectWei = ethPrice ? (amountFloat / ethPrice) * 1e18 : 0
        }
      }

      // tokensPerWei from pay events (tokens in 18 decimals / payment in project decimals)
      const tokensWei = paymentInProjectWei * issuanceRate.tokensPerEth
      const tokens = tokensWei / 1e18 // Convert to display units

      if (tokens < 0.01) return null

      return tokens
    } catch {
      return null
    }
  }, [amount, issuanceRate, selectedToken, ethPrice, suckerBalance?.currency])

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

  // Check if form should be locked due to active/completed payment
  const isPaymentLocked = persistedPayment?.status && persistedPayment.status !== 'pending'

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
    } else if (selectedToken === 'PAY_CREDITS') {
      // Need Pay Credits balance
      const juiceBalanceNum = juiceBalance?.balance ?? 0
      if (juiceBalanceNum < total) {
        return { sufficient: false, reason: 'insufficient_pay_credits', needed: total, have: juiceBalanceNum }
      }
    }

    return { sufficient: true }
  }, [amount, feeAmount, selectedToken, walletEthBalance, walletUsdcBalance, balanceLoading, juiceBalance])

  // Handle NFT tier selection
  const handleTierSelect = useCallback((tier: ResolvedNFTTier) => {
    if (selectedTierId === tier.tierId) {
      // Deselect
      setSelectedTierId(null)
      setAmount('')
    } else {
      // Select tier and auto-fill amount
      setSelectedTierId(tier.tierId)
      const priceEth = parseFloat(formatEther(tier.price))
      if (selectedToken === 'ETH') {
        setAmount(priceEth.toFixed(6).replace(/\.?0+$/, ''))
      } else if (ethPrice) {
        // Convert to USD for USDC/Pay Credits
        setAmount((priceEth * ethPrice).toFixed(2))
      }
    }
  }, [selectedTierId, selectedToken, ethPrice])

  // Handle payment status updates
  // Keep form values and payment status visible after submission (similar to project deployment)
  // This allows all chat users to see the transaction details
  useEffect(() => {
    if (activePayment?.status === 'confirmed') {
      // Payment confirmed - keep showing form values and status
      setPaying(false)
      // Persist completed state for all chat users
      updatePersistedPayment({
        status: 'completed',
        txHash: activePayment.hash,
        confirmedAt: new Date().toISOString(),
      })
    } else if (activePayment?.status === 'queued') {
      // Pay Credits payment queued - keep showing form values and status
      setPaying(false)
      refetchJuiceBalance()
      // Persist completed state for all chat users
      updatePersistedPayment({
        status: 'completed',
        confirmedAt: new Date().toISOString(),
      })
    } else if (activePayment?.status === 'submitted') {
      // Payment submitted but not yet confirmed - keep form values visible
      setPaying(false)
      // Persist submitted state with tx hash
      updatePersistedPayment({
        status: 'in_progress',
        txHash: activePayment.hash,
      })
    } else if (activePayment?.status === 'cancelled' || activePayment?.status === 'failed') {
      // Payment cancelled/failed - keep form values, just reset paying state
      setPaying(false)
      // Persist failed state with error
      updatePersistedPayment({
        status: 'failed',
        error: activePayment.error || 'Transaction failed',
      })
    }
  }, [activePayment?.status, activePayment?.hash, activePayment?.error, refetchJuiceBalance, updatePersistedPayment])

  if (loading) {
    return (
      <div className="w-full">
        <div className={`max-w-md border p-4 animate-pulse ${
          isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
        }`}>
          {/* Header skeleton */}
          <div className="flex items-center gap-3 mb-2">
            <div className={`w-14 h-14 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className="flex-1">
              <div className={`h-5 w-32 mb-1 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
              <div className={`h-3 w-20 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            </div>
          </div>

          {/* Tagline skeleton */}
          <div className={`h-4 w-3/4 mb-3 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />

          {/* Stats row skeleton */}
          <div className="flex gap-6 mb-3">
            <div className={`h-4 w-24 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className={`h-4 w-16 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className={`h-4 w-20 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          </div>

          {/* Pay form area skeleton */}
          <div className={`p-3 mb-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            {/* Chain selector */}
            <div className={`h-4 w-28 mb-3 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />

            {/* Amount input row */}
            <div className="flex gap-2 mb-2">
              <div className={`flex-1 h-10 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
              <div className={`w-16 h-10 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            </div>

            {/* Quick amount chips */}
            <div className="flex gap-2 mb-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className={`h-6 w-12 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
              ))}
            </div>

            {/* Token preview */}
            <div className={`h-4 w-40 mb-4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />

            {/* Memo input */}
            <div className={`h-8 w-full ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          </div>

          {/* Pay Juicy checkbox skeleton */}
          <div className="flex items-center gap-2 mt-2">
            <div className={`w-3.5 h-3.5 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className={`h-4 w-28 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          </div>

          {/* More link skeleton */}
          <div className={`h-3 w-12 mt-4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
        </div>
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

  const formatBalance = (wei: string, decimals: number = 18) => {
    const value = parseFloat(wei) / Math.pow(10, decimals)
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }

  const formatUsd = (balance: string, currency: number = 1, decimals: number = 18) => {
    const value = parseFloat(balance) / Math.pow(10, decimals)
    // If currency is USD (2), the balance is already in USD
    if (currency === 2) {
      return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    // Currency is ETH (1), convert to USD
    if (!ethPrice) return null
    const usd = value * ethPrice
    return usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  // Calculate total balance USD value using currency/decimals from suckerBalance
  const totalBalanceUsd = suckerBalance?.totalBalance
    ? formatUsd(suckerBalance.totalBalance, suckerBalance.currency, suckerBalance.decimals)
    : null

  const handlePay = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (!amount || parseFloat(amount) <= 0) return

    // Zero-state check: if user has no funds anywhere, show funding options
    const hasPayCredits = (juiceBalance?.balance ?? 0) > 0
    const hasEth = crossChainEth > 0n
    const hasUsdc = crossChainUsdc > 0n
    const hasAnyFunds = hasPayCredits || hasEth || hasUsdc

    if (!hasAnyFunds && !crossChainLoading) {
      // Show funding options popover
      if (event?.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect()
        setFundingOptionsAnchor({
          top: rect.top,
          left: rect.left + rect.width / 2,
        })
      }
      setShowFundingOptions(true)
      return
    }

    // For PAY_CREDITS, check if user has sufficient balance first
    if (selectedToken === 'PAY_CREDITS') {
      const balanceCheck = checkSufficientBalance()
      if (!balanceCheck.sufficient) {
        if (balanceCheck.reason === 'insufficient_pay_credits') {
          // Open BuyJuiceModal to purchase more credits
          setShowBuyJuiceModal(true)
          return
        }
        return
      }

      // Proceed with Pay Credits payment via API
      setPaying(true)
      const txId = addTransaction({
        type: 'pay',
        projectId: currentProjectId,
        chainId: parseInt(selectedChainId),
        amount,
        token: selectedToken,
        status: 'pending',
        stage: 'queueing',
      })

      // Track this payment for UI updates
      setActivePaymentId(txId)

      // Persist payment state for all chat users
      updatePersistedPayment({
        status: 'in_progress',
        amount,
        token: selectedToken,
        memo,
        selectedChainId,
        selectedTierId,
        txId,
        submittedAt: new Date().toISOString(),
      })

      window.dispatchEvent(new CustomEvent('juice:pay-project', {
        detail: {
          txId,
          projectId: currentProjectId,
          chainId: parseInt(selectedChainId),
          amount,
          token: selectedToken,
          memo,
          payUs,
          feeAmount: feeAmount.toString(),
          juicyProjectId: JUICY_PROJECT_ID,
          totalAmount: totalAmount.toString(),
          tierId: selectedTierId,
          hookAddress: nftHookAddress,
          preventOverspending: nftHookFlags?.preventOverspending ?? false,
          tierPrice: selectedTierId ? nftTiers.find(t => t.tierId === selectedTierId)?.price?.toString() : undefined,
        }
      }))
      return
    }

    // Step 1: Check if wallet is connected (for ETH/USDC)
    if (!isConnected) {
      openWalletPanel()
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
      // Insufficient funds - open wallet panel for top up options
      openWalletPanel()
      return
    }

    // Step 3: Proceed with payment - track the transaction
    setPaying(true)
    const txId = addTransaction({
      type: 'pay',
      projectId: currentProjectId,
      chainId: parseInt(selectedChainId),
      amount,
      token: selectedToken,
      status: 'pending',
    })

    // Track this payment for UI updates
    setActivePaymentId(txId)

    // Persist payment state for all chat users
    updatePersistedPayment({
      status: 'in_progress',
      amount,
      token: selectedToken,
      memo,
      selectedChainId,
      selectedTierId,
      txId,
      submittedAt: new Date().toISOString(),
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
        tierId: selectedTierId,
        hookAddress: nftHookAddress,
        preventOverspending: nftHookFlags?.preventOverspending ?? false,
        tierPrice: selectedTierId ? nftTiers.find(t => t.tierId === selectedTierId)?.price?.toString() : undefined,
      }
    }))
    // Don't clear form here - wait for transaction result
  }

  const logoUrl = resolveIpfsUri(project.logoUri)
  const projectUrl = `https://juicebox.money/v5/${selectedChainInfo.slug}:${currentProjectId}`

  return (
    <div className="w-full">
      {/* Card with border - constrained width */}
      <div className={`max-w-md border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
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

      {/* Tagline - inside card near name */}
      {(fullMetadata?.tagline || fullMetadata?.projectTagline) && (
        <p className={`text-sm italic mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {fullMetadata.tagline || fullMetadata.projectTagline}
        </p>
      )}

      {/* Stats - inline, no background */}
      <div className="flex gap-6 mb-3 text-sm">
        <div
          className="relative"
          onMouseEnter={() => setShowBalanceTooltip(true)}
          onMouseLeave={() => setShowBalanceTooltip(false)}
        >
          <span className={`font-mono cursor-help ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {totalBalanceUsd ? `$${totalBalanceUsd}` : `${formatBalance(suckerBalance?.totalBalance || project.balance, suckerBalance?.decimals || 18)} ${suckerBalance?.currency === 2 ? 'USDC' : 'ETH'}`}
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
                const pbCurrency = pb.currency ?? suckerBalance.currency
                const pbDecimals = pb.decimals ?? suckerBalance.decimals
                return (
                  <div key={pb.chainId} className="flex justify-between gap-4 py-0.5">
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{chainInfo.name}</span>
                    <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {pbCurrency === 2 ? `$${formatBalance(pb.balance, pbDecimals)}` : `${formatBalance(pb.balance, pbDecimals)} ETH`}
                    </span>
                  </div>
                )
              })}
              <div className={`flex justify-between gap-4 pt-1 mt-1 border-t ${
                isDark ? 'border-white/10' : 'border-gray-100'
              }`}>
                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>[All chains]</span>
                <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {totalBalanceUsd ? `$${totalBalanceUsd}` : `${formatBalance(suckerBalance.totalBalance, suckerBalance.decimals)} ${suckerBalance.currency === 2 ? 'USDC' : 'ETH'}`}
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
              if (!isPaymentLocked) {
                setChainDropdownOpen(!chainDropdownOpen)
                setTokenDropdownOpen(false)
              }
            }}
            disabled={isPaymentLocked}
            className={`flex items-center gap-1 text-sm font-medium ${
              isDark ? 'text-white' : 'text-gray-900'
            } ${isPaymentLocked ? 'cursor-not-allowed opacity-60' : ''}`}
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

        {/* NFT Tier selector */}
        {nftTiers.length > 0 && (
          <div className="mb-3">
            <div className={`text-xs mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Buy a reward
            </div>
            <div className="flex flex-wrap gap-2">
              {(showAllTiers ? nftTiers : nftTiers.slice(0, 3)).map(tier => (
                <button
                  key={tier.tierId}
                  onClick={() => !isPaymentLocked && handleTierSelect(tier)}
                  disabled={isPaymentLocked}
                  className={`flex items-center gap-2 px-2 py-1.5 border transition-colors ${
                    selectedTierId === tier.tierId
                      ? 'border-green-500 bg-green-500/10'
                      : isDark ? 'border-white/10 hover:border-white/20' : 'border-gray-200 hover:border-gray-300'
                  } ${isPaymentLocked ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  {tier.imageUri && (
                    <img src={resolveIpfsUri(tier.imageUri) || undefined} alt="" className="w-8 h-8 object-cover" />
                  )}
                  <div className="text-left">
                    <div className={`text-xs font-medium truncate max-w-[100px] ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {tier.name}
                    </div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {formatEther(tier.price)} ETH
                    </div>
                  </div>
                </button>
              ))}
              {!showAllTiers && nftTiers.length > 3 && (
                <button
                  onClick={() => setShowAllTiers(true)}
                  className={`px-2 py-1.5 text-xs ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  +{nftTiers.length - 3} more
                </button>
              )}
            </div>
            {selectedTierId && (
              <button
                onClick={() => { setSelectedTierId(null); setAmount('') }}
                className={`mt-2 text-xs ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
              >
                Or pay a custom amount
              </button>
            )}
          </div>
        )}

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
              disabled={isPaymentLocked}
              className={`flex-1 px-3 py-2 text-sm bg-transparent outline-none ${
                isDark ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
              } ${isPaymentLocked ? 'cursor-not-allowed opacity-60' : ''}`}
            />
            {/* Token selector */}
            <div className="relative">
              <button
                onClick={() => {
                  if (!isPaymentLocked) {
                    setTokenDropdownOpen(!tokenDropdownOpen)
                    setChainDropdownOpen(false)
                  }
                }}
                disabled={isPaymentLocked}
                className={`flex items-center justify-between w-20 px-2 py-2 text-sm font-medium border-l ${
                  isDark ? 'border-white/10 text-white hover:bg-white/5' : 'border-gray-200 text-gray-900 hover:bg-gray-50'
                } ${isPaymentLocked ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <span>{selectedToken === 'PAY_CREDITS' ? 'Credits' : selectedToken}</span>
                <svg className={`w-3 h-3 transition-transform ${tokenDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {tokenDropdownOpen && (
                <div className={`absolute top-full right-0 mt-1 py-1  shadow-lg z-10 min-w-[140px] ${
                  isDark ? 'bg-juice-dark border border-white/10' : 'bg-white border border-gray-200'
                }`}>
                  {TOKENS.map(token => (
                    <button
                      key={token.symbol}
                      onClick={() => {
                        setSelectedToken(token.symbol as PaymentToken)
                        setTokenDropdownOpen(false)
                      }}
                      className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                        token.symbol === selectedToken
                          ? isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900'
                          : isDark ? 'text-gray-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span className="flex justify-between items-center gap-2">
                        <span>{token.symbol === 'PAY_CREDITS' ? 'Pay Credits' : token.symbol}</span>
                        {token.symbol === 'PAY_CREDITS' && juiceBalance && (
                          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            ${juiceBalance.balance.toFixed(2)}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={(e) => handlePay(e)}
            disabled={paying || !amount || parseFloat(amount) <= 0 || crossConversionBlocked || (persistedPayment?.status && persistedPayment.status !== 'pending')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              paying || !amount || parseFloat(amount) <= 0 || crossConversionBlocked || (persistedPayment?.status && persistedPayment.status !== 'pending')
                ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600 text-black'
            }`}
          >
            {paying ? '...' : persistedPayment?.status === 'completed' ? 'Paid' : persistedPayment?.status === 'in_progress' ? 'Pending...' : 'Pay'}
          </button>
        </div>

        {/* Payment progress indicator - show from local state or persisted state */}
        {(activePayment || (persistedPayment && persistedPayment.status !== 'pending')) && (
          <PaymentProgress
            stage={activePayment?.stage}
            status={activePayment?.status || (persistedPayment?.status === 'completed' ? 'confirmed' : persistedPayment?.status === 'failed' ? 'failed' : 'submitted') as TransactionStatus}
            error={activePayment?.error || persistedPayment?.error}
            hash={activePayment?.hash || persistedPayment?.txHash}
            chainId={activePayment?.chainId || parseInt(selectedChainId)}
            isDark={isDark}
            onRetry={() => setActivePaymentId(null)}
          />
        )}

        {/* Cross-currency warning when ETH price unavailable */}
        {crossConversionBlocked && (
          <div className={`mt-2 p-2 text-sm ${
            isDark ? 'bg-yellow-500/10' : 'bg-yellow-50'
          }`}>
            <div className={`flex items-center gap-2 ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>ETH price unavailable — pay with {projectCurrency === 2 ? 'USDC' : 'ETH'} instead</span>
            </div>
          </div>
        )}

        {/* Quick amount options */}
        <div className="flex gap-2 mt-2">
          {(selectedToken === 'USDC' || selectedToken === 'PAY_CREDITS' ? ['10', '25', '50', '100'] : ['0.01', '0.05', '0.1', '0.5']).map(val => (
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

        {/* Pay Credits balance indicator */}
        {selectedToken === 'PAY_CREDITS' && juiceBalance && (
          <div className={`mt-2 text-xs flex items-center gap-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            <span>Balance: ${juiceBalance.balance.toFixed(2)}</span>
            {juiceBalance.balance < totalAmount && (
              <button
                onClick={() => setShowBuyJuiceModal(true)}
                className={`underline ${isDark ? 'text-juice-cyan hover:text-juice-cyan/80' : 'text-cyan-600 hover:text-cyan-700'}`}
              >
                Buy more
              </button>
            )}
          </div>
        )}

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
          disabled={isPaymentLocked}
          className={`w-full mt-4 px-3 py-2 text-sm outline-none ${
            isDark
              ? 'bg-transparent text-white placeholder-gray-500'
              : 'bg-transparent text-gray-900 placeholder-gray-400'
          } ${isPaymentLocked ? 'cursor-not-allowed opacity-60' : ''}`}
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
          <span className="text-sm">Join Juicy (+{JUICY_FEE_PERCENT}%)</span>
          {/* Hover tooltip */}
          <div className={`absolute left-0 bottom-full mb-1 px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap ${
            isDark ? 'bg-juice-dark border border-white/20 text-gray-300' : 'bg-white border border-gray-200 text-gray-600 shadow-sm'
          }`}>
            Help us keep building
          </div>
        </label>
        {payUs && amountNum > 0 && estimatedJuicyTokens > 0 && (
          <div className={`ml-6 mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {selectedToken === 'PAY_CREDITS' ? '$' : ''}{feeAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {selectedToken === 'PAY_CREDITS' ? '' : selectedToken} → ~{estimatedJuicyTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} $JUICY
          </div>
        )}
      </div>

      {/* About section - collapsible, inside card */}
      {fullMetadata?.description && (
        <details className="mt-4 group">
          <summary className={`text-xs font-medium cursor-pointer list-none flex items-center gap-1 ${
            isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
          }`}>
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            More
          </summary>
          <div className={`mt-2 text-sm space-y-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            {parseDescription(fullMetadata.description).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </details>
      )}
      </div>

      {/* BuyJuiceModal for purchasing Pay Credits */}
      <BuyJuiceModal
        isOpen={showBuyJuiceModal}
        onClose={() => setShowBuyJuiceModal(false)}
        onSuccess={() => {
          refetchJuiceBalance()
          setShowBuyJuiceModal(false)
        }}
      />

      {/* Funding Options Popover - shown when user has zero balance */}
      {showFundingOptions && fundingOptionsAnchor && createPortal(
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[99]"
            onClick={() => setShowFundingOptions(false)}
          />
          {/* Popover */}
          <div
            className={`fixed z-[100] w-80 p-4 border shadow-xl ${
              isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'
            }`}
            style={{
              top: fundingOptionsAnchor.top - 8,
              left: fundingOptionsAnchor.left,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setShowFundingOptions(false)}
              className={`absolute top-3 right-3 p-1 transition-colors ${
                isDark ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className={`text-sm font-semibold mb-1 pr-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              How would you like to pay?
            </h3>
            <p className={`text-xs mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              You don't have any funds yet. Choose how to add some.
            </p>

            <div className="space-y-2">
              {/* Credit Card option */}
              <button
                onClick={() => {
                  setShowFundingOptions(false)
                  setShowBuyJuiceModal(true)
                }}
                className={`w-full p-3 text-left transition-colors border ${
                  isDark
                    ? 'border-white/20 hover:border-juice-cyan hover:bg-juice-cyan/10'
                    : 'border-gray-200 hover:border-cyan-500 hover:bg-cyan-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      Credit Card
                    </div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      3% fee · 3 day delay
                    </div>
                  </div>
                  <svg className={`w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Crypto option */}
              <div
                className={`w-full p-3 text-left border ${
                  isDark ? 'border-white/20' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      ETH or USDC
                    </div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Free · Instant
                    </div>
                  </div>
                </div>
                {managedAddress ? (
                  <div className="mt-2">
                    <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Send to your wallet on any chain:
                    </div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(managedAddress)
                        setCopiedAddress(true)
                        setTimeout(() => setCopiedAddress(false), 2000)
                      }}
                      className={`w-full p-2 font-mono text-xs text-left transition-colors ${
                        isDark
                          ? 'bg-white/5 hover:bg-white/10 text-gray-300'
                          : 'bg-gray-50 hover:bg-gray-100 text-gray-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate">{managedAddress}</span>
                        <span className={`ml-2 text-xs ${copiedAddress ? 'text-green-500' : isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          {copiedAddress ? '✓' : 'Copy'}
                        </span>
                      </div>
                    </button>
                    <div className={`text-xs mt-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      Works on Ethereum, Base, Optimism, Arbitrum
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setShowFundingOptions(false)
                      openWalletPanel()
                    }}
                    className={`w-full mt-2 p-2 text-xs font-medium transition-colors border ${
                      isDark
                        ? 'border-juice-cyan text-juice-cyan hover:bg-juice-cyan/10'
                        : 'border-cyan-600 text-cyan-600 hover:bg-cyan-50'
                    }`}
                  >
                    Connect to get your deposit address
                  </button>
                )}
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  )
}
