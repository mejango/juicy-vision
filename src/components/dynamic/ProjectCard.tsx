import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from 'wagmi'
import { createPublicClient, http, formatEther, formatUnits, parseUnits, erc20Abi, type Address, type Hex, type PublicClient } from 'viem'
import { NATIVE_TOKEN, type JBChainId } from '@bananapus/nana-sdk-core'
import { getAccountingContexts, tokenCurrencyId } from '@bananapus/nana-sdk-core/v6'
import {
  fetchProject,
  fetchSuckerGroupBalance,
  fetchOwnersCount,
  fetchEthPrice,
  fetchProjectTokenSymbol,
  type Project,
  type ConnectedChain,
  type SuckerGroupBalance,
} from '../../services/bendystraw'
import type { IpfsProjectMetadata } from '../../utils/ipfs'
import { getProjectDataHook, fetchResolvedNFTTiers, fetchHookFlags, getEffectiveTierPrice, requireRecognized721HookIdentity, resolveTierUri, fetchPayCredits, type ResolvedNFTTier, type JB721HookFlags } from '../../services/nft'
import { inlineSvgImages } from '../../utils/ipfs'
import { useThemeStore, useTransactionStore, type PaymentStage, type TransactionStatus } from '../../stores'
import { VIEM_CHAINS, USDC_ADDRESSES, RPC_ENDPOINTS, CHAINS, type SupportedChainId } from '../../constants'
import { isUsdcCurrency } from '../../utils/technicalDetails'
import { useJuiceBalance } from '../../hooks/useJuiceBalance'
import { useWalletBalances } from '../../hooks/useWalletBalances'
import { useManagedWallet } from '../../hooks'
import { useProjectCardPaymentState } from '../../hooks/useComponentState'
import BuyJuiceModal from '../juice/BuyJuiceModal'
import { ProjectLink } from './ProjectLink'
import { getPaymentTerminal } from '../../utils/paymentTerminal'
import { assertCurrentProjectPayConfigurationTrusted } from '../../utils/projectTrust'
import { resolveProjectChains } from '../../utils/projectChains'
import { fetchProjectBalanceBreakdown, type ProjectBalanceBreakdown } from '../../services/projectBalanceBreakdown'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'
import { ExplainerMessage } from '../ui/ExplainerMessage'
import { resolvePayPreviewOutcome, TERMINAL_PREVIEW_PAY_ABI } from '../../utils/terminalPreview'
import { buildNftPayMetadata } from '../../utils/nftPayMetadata'
import {
  computeNftCheckout,
  fmtCountdown,
  formatExactTokenEstimate,
  formatRoutingTag,
  isVerifiedZeroIssuance,
  landedAcceptedAfterSwap,
  probeRouterPayRoute,
  readPayScheduleGate,
  resolveDirectSwapOffer,
  shortHex,
  tierDiscountLabel,
  uniswapPoolLink,
} from '../../services/payPreviewCard'
import { quoteDirectBuy } from '../../services/ammMarket'

// Metadata extracted from on-chain resolver
interface OnChainTierMetadata {
  productName?: string
  categoryName?: string
}

function isEthTierCurrency(currency: number): boolean {
  return currency === 1 || currency === 61166
}

function isUsdTierCurrency(currency: number): boolean {
  return currency === 2 || isUsdcCurrency(currency)
}

function isSupportedTierCurrency(currency: number): boolean {
  return isEthTierCurrency(currency) || isUsdTierCurrency(currency)
}

function formatTierPrice(tier: ResolvedNFTTier): string {
  const amount = formatUnits(getEffectiveTierPrice(tier), tier.pricingDecimals)
  if (isUsdTierCurrency(tier.currency)) return `$${amount}`
  if (isEthTierCurrency(tier.currency)) return `${amount} ETH`
  return 'Pricing unavailable'
}

// Small component for tier preview images with on-chain fallback
function TierPreviewImage({
  tier,
  hookAddress,
  chainId,
  isDark,
  size = 'default',
  onMetadataLoaded,
}: {
  tier: ResolvedNFTTier
  hookAddress: `0x${string}` | null
  chainId: number
  isDark: boolean
  size?: 'default' | 'small' | 'large'
  onMetadataLoaded?: (tierId: number, metadata: OnChainTierMetadata) => void
}) {
  const sizeClass = size === 'large' ? 'w-full h-full' : size === 'small' ? 'w-5 h-5' : 'w-6 h-6'
  const spinnerSize = size === 'large' ? 'w-6 h-6' : size === 'small' ? 'w-2.5 h-2.5' : 'w-3 h-3'
  const [onChainImage, setOnChainImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [ipfsUnavailable, setIpfsUnavailable] = useState(false)

  const hasIpfsImage = Boolean(tier.imageUri) && !ipfsUnavailable

  useEffect(() => {
    setIpfsUnavailable(false)
    setOnChainImage(null)
  }, [tier.imageUri])

  // Lazy load on-chain SVG if no IPFS image
  useEffect(() => {
    if (hasIpfsImage || onChainImage || loading || !hookAddress) return

    setLoading(true)
    resolveTierUri(hookAddress, tier.tierId, chainId)
      .then(async (dataUri) => {
        if (dataUri) {
          try {
            const base64Data = dataUri.split(',')[1]
            const jsonStr = atob(base64Data)
            const metadata = JSON.parse(jsonStr)
            if (metadata.image) {
              let processedImage = metadata.image
              if (metadata.image.startsWith('data:image/svg+xml')) {
                processedImage = await inlineSvgImages(metadata.image)
              }
              setOnChainImage(processedImage)
            }
            // Extract and report productName and categoryName
            if (onMetadataLoaded && (metadata.productName || metadata.categoryName)) {
              onMetadataLoaded(tier.tierId, {
                productName: metadata.productName,
                categoryName: metadata.categoryName,
              })
            }
          } catch (e) {
            console.error(`[NFT] Tier ${tier.tierId} parse error:`, e)
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [hasIpfsImage, onChainImage, loading, hookAddress, tier.tierId, chainId, onMetadataLoaded])

  if (loading) {
    return (
      <div className={`${sizeClass} flex items-center justify-center ${isDark ? 'bg-white/10' : 'bg-gray-100'}`}>
        <div className={`${spinnerSize} border border-current border-t-transparent rounded-full animate-spin opacity-50`} />
      </div>
    )
  }

  if (hasIpfsImage && tier.imageUri) {
    return <IpfsImage uri={tier.imageUri} alt="" className={`${sizeClass} object-contain bg-white`} onError={() => setIpfsUnavailable(true)} />
  }

  if (onChainImage) {
    return <IpfsImage uri={onChainImage} alt="" className={`${sizeClass} object-contain bg-white`} />
  }

  return (
    <div className={`${sizeClass} flex items-center justify-center ${size === 'large' ? 'text-lg' : 'text-[8px]'} ${isDark ? 'bg-white/10 text-gray-500' : 'bg-gray-100 text-gray-400'}`}>
      #{tier.tierId}
    </div>
  )
}

interface ProjectCardProps {
  projectId: string
  chainId?: string
  messageId?: string // For persisting payment state to server (visible to all chat users)
  embedded?: boolean // For sidebar display mode - removes outer container styling
  children?: React.ReactNode // For embedded mode - content to render inside scrollable area (e.g., Activity)
  // Flavor for the pay explainer: revnets have locked terms, custom projects have
  // owner-configured rulesets. Falls back to the indexed isRevnet flag when omitted.
  isRevnet?: boolean
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

function payChainName(chainId: string): string {
  const compactNames: Record<string, string> = {
    '11155420': 'OP Sep',
    '84532': 'Base Sep',
    '421614': 'Arb Sep',
  }
  return compactNames[chainId] ?? CHAIN_INFO[chainId]?.name ?? `Chain ${chainId}`
}

type PayCardPreview =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | {
      status: 'ready'
      beneficiaryTokenCount: bigint
      reservedTokenCount: bigint
      route: 'issuance' | 'amm'
      // The exact minReturnedTokens the executor submits: equal to the quote on
      // the issuance route, slippage-floored on the AMM route. Displayed value
      // and submitted parameter must always match.
      minReturnedTokens: bigint
      // Buyback pool the AMM route filled through, when applicable.
      buybackPoolId: Hex | null
      // On-chain V4 Quoter probe of buying straight from the buyback pool with
      // this pay amount (plain pair-token buys only; null when gated off / no
      // pool / no verified Quoter). Lets the direct-swap offer fire even on the
      // ISSUANCE route when a pool swap beats what pay would mint.
      directSwapQuote: { poolId: Hex; out: bigint } | null
      // A verified zero/zero quote (weight-0 ruleset): legitimate, but the
      // "0 tokens" output is hidden instead of shown as a broken quote.
      zeroIssuance: boolean
      // Gross issuance the ruleset would mint WITHOUT the buyback hook (from
      // tokenCountWithoutHook), used to explain why the AMM route won.
      grossIssuance: bigint
    }

// ETH/USDC/PAY_CREDITS keep their canonical string ids; a custom accounting-token
// option carries its own token address as the id (with an ERC-20 symbol label).
export type PaymentToken = string

interface PaymentTokenOption {
  // Selection id: 'ETH' | 'USDC' | 'PAY_CREDITS' | <custom token address>.
  symbol: PaymentToken
  // Human label shown in the dropdown (ERC-20 symbol for custom tokens).
  label: string
  name: string
  // The on-chain token address the pay flow submits (NATIVE for ETH; empty for credits).
  tokenAddress: Address
  decimals: number
  currency: number
  route: 'direct' | 'routed' | 'credits'
}

const PREVIEW_BENEFICIARY = '0x000000000000000000000000000000000000dEaD' as Address

// Stage labels for payment progress
const STAGE_LABELS: Record<PaymentStage, string> = {
  checking: 'Checking wallet...',
  switching: 'Switching network...',
  approving: 'Approve USDC in wallet...',
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
      <div className={`mt-2 p-2 text-sm ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
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
      <div className={`mt-2 p-2 text-sm ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
        <div className={`flex items-center gap-2 ${isDark ? 'text-green-400' : 'text-green-600'}`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>Payment queued!</span>
        </div>
        <p className={`text-xs mt-1 ml-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Your Pay Credits have been deducted. The on-chain payment will be processed shortly.</p>
      </div>
    )
  }

  // Submitted/confirming state - show spinner and explorer link
  if (status === 'submitted' || stage === 'confirming') {
    return (
      <div className={`mt-2 p-2 text-sm ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
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
      <div className={`mt-2 p-2 text-sm ${isDark ? 'bg-yellow-500/10' : 'bg-yellow-50'}`}>
        <div className={`flex items-center gap-2 ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>{status === 'cancelled' ? 'Payment cancelled' : 'Payment failed'}</span>
        </div>
        {error && <p className={`text-xs mt-1 ml-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{error}</p>}
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
        <button onClick={onRetry} className={`mt-2 ml-6 text-xs underline ${isDark ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}>
          Try again
        </button>
      </div>
    )
  }

  // In progress state (before submission)
  const stageLabel = stage ? STAGE_LABELS[stage] : 'Processing...'
  return (
    <div className={`mt-2 p-2 text-sm flex items-center gap-2 ${isDark ? 'bg-juice-cyan/10 text-juice-cyan' : 'bg-cyan-50 text-cyan-600'}`}>
      <svg className="w-4 h-4 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      <span>{stageLabel}</span>
    </div>
  )
}

export default function ProjectCard({ projectId, chainId: initialChainId = '1', messageId, embedded = false, children, isRevnet }: ProjectCardProps) {
  // Persistent payment state (visible to all chat users)
  const { state: persistedPayment, updateState: updatePersistedPayment } = useProjectCardPaymentState(messageId)

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState('1')
  const [memo, setMemo] = useState('')
  const [contributionOnly, setContributionOnly] = useState(false)
  const [paying, setPaying] = useState(false)
  const [selectedChainId, setSelectedChainId] = useState(initialChainId)
  const [selectedToken, setSelectedToken] = useState<PaymentToken>('ETH')
  const [actionDropdownOpen, setActionDropdownOpen] = useState(false)
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false)
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false)
  const [showBuyJuiceModal, setShowBuyJuiceModal] = useState(false)
  const amountInputRef = useRef<HTMLInputElement>(null)
  // Connected chains with their project IDs (may differ per chain)
  const [connectedChains, setConnectedChains] = useState<ConnectedChain[]>([])
  // On-chain, all-accounting-tokens balance priced through JBPrices. Supersedes the indexed single-token
  // sucker-group figure once it resolves; balanceRefreshTick re-runs it after a balance-changing tx.
  const [balanceBreakdown, setBalanceBreakdown] = useState<ProjectBalanceBreakdown | null>(null)
  const [balanceRefreshTick, setBalanceRefreshTick] = useState(0)
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [payPreview, setPayPreview] = useState<PayCardPreview>({ status: 'idle' })
  // Unix start of the first ruleset when it is still in the future ("Starts in" gate).
  const [payStartsAt, setPayStartsAt] = useState<number | null>(null)
  const [countdownNow, setCountdownNow] = useState(() => Math.floor(Date.now() / 1000))
  // Full metadata from IPFS (has complete description)
  const [fullMetadata, setFullMetadata] = useState<IpfsProjectMetadata | null>(null)
  // Sucker group balance (total + per-chain breakdown)
  const [suckerBalance, setSuckerBalance] = useState<SuckerGroupBalance | null>(null)
  // ETH price in USD
  const [ethPrice, setEthPrice] = useState<number | null>(null)
  const [ethPriceLoading, setEthPriceLoading] = useState(true)
  // Owners count (unique token holders with balance > 0)
  const [ownersCount, setOwnersCount] = useState<number | null>(null)
  // Tooltip hover states
  const [showBalanceTooltip, setShowBalanceTooltip] = useState(false)
  const [showPaymentsTooltip, setShowPaymentsTooltip] = useState(false)
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
  const [nftSafetyError, setNftSafetyError] = useState<string | null>(null)
  const [paymentSafetyError, setPaymentSafetyError] = useState<string | null>(null)
  const [paymentSafetyLoading, setPaymentSafetyLoading] = useState(true)
  const [paymentTokenOptions, setPaymentTokenOptions] = useState<PaymentTokenOption[]>([])
  // Shop credit (payCreditsOf) for the connected beneficiary, offsets NFT checkout.
  const [nftCredits, setNftCredits] = useState<bigint>(0n)
  const [nftCreditsLoading, setNftCreditsLoading] = useState(false)
  // "≈ X ACC lands after the swap" note for a swap-via-router add-to-balance top-up.
  const [routedConversion, setRoutedConversion] = useState<{ landed: bigint; decimals: number; label: string } | null>(null)
  const [routedConversionLoading, setRoutedConversionLoading] = useState(false)
  // Track quantity for each selected tier: { tierId: quantity }
  const [tierQuantities, setTierQuantities] = useState<Record<number, number>>({})
  // Derived: array of tier IDs (each ID repeated by quantity) for payment encoding
  const selectedTierIds = useMemo(
    () => Object.entries(tierQuantities).flatMap(([id, qty]) => Array(qty).fill(Number(id))),
    [tierQuantities],
  )
  const selectedPaymentOption = paymentTokenOptions.find((option) => option.symbol === selectedToken)
  // Add-to-balance works for any onchain currency — including a swap-via-router token
  // (the router swaps it into the accepted token, then adds it to the balance).
  // Add-to-balance is direct-token-only: juicy's executor rejects routed
  // add-to-balance (executeAddToBalanceTransaction requires a directly accepted
  // accounting token). Offering it for routed tokens would be a broken button —
  // TODO(parity): enable once the executor supports routed add-to-balance.
  const canContributeOnly =
    selectedToken !== 'PAY_CREDITS' &&
    selectedPaymentOption?.route === 'direct' &&
    selectedTierIds.length === 0
  const addsToBalance = contributionOnly && canContributeOnly
  // First directly-accepted token — the currency a swap-via-router top-up lands in.
  const acceptedDirectOption = paymentTokenOptions.find((option) => option.route === 'direct')
  useEffect(() => {
    if (!canContributeOnly) {
      setContributionOnly(false)
      setActionDropdownOpen(false)
    }
  }, [canContributeOnly])
  // Cache for on-chain metadata (productName, categoryName) by tierId
  const [tierMetadata, setTierMetadata] = useState<Record<number, OnChainTierMetadata>>({})

  // Emit event when checkout quantities change (for ShopTab to sync)
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('juice:checkout-quantities', {
        detail: { quantities: tierQuantities },
      })
    )
  }, [tierQuantities])

  const { theme } = useThemeStore()
  const { addTransaction, getTransaction } = useTransactionStore()
  const isDark = theme === 'dark'

  // Get active payment transaction for status display
  const activePayment = activePaymentId ? getTransaction(activePaymentId) : null

  // wagmi hooks
  const { address, isConnected } = useAccount()

  // Pay Credits balance
  const { balance: juiceBalance, refetch: refetchJuiceBalance } = useJuiceBalance()

  // Managed accounts use the same address on every supported chain.
  const { address: managedAddress, isManagedMode } = useManagedWallet()
  const activeWalletAddress = isManagedMode ? managedAddress : address

  // Cross-chain wallet balances for zero-state detection
  const { totalEth: crossChainEth, totalUsdc: crossChainUsdc, loading: crossChainLoading, available: crossChainBalancesAvailable } = useWalletBalances(activeWalletAddress ?? undefined)

  // Funding options popover state (shown when user has zero balance)
  const [showFundingOptions, setShowFundingOptions] = useState(false)
  const [fundingOptionsAnchor, setFundingOptionsAnchor] = useState<{
    top: number
    left: number
  } | null>(null)
  const [copiedAddress, setCopiedAddress] = useState(false)

  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  const availableChains = connectedChains.length > 0 ? connectedChains : [{ chainId: parseInt(initialChainId), projectId: parseInt(projectId) }]

  // Get the current project ID for the selected chain (may differ from initial projectId)
  const chainData = availableChains.find((c) => c.chainId === parseInt(selectedChainId))
  const currentProjectId = chainData?.projectId && chainData.projectId !== 0 ? chainData.projectId.toString() : projectId
  const selectedChainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO['1']

  // Fetch connected chains on mount
  useEffect(() => {
    async function loadConnectedChains() {
      try {
        const resolution = await resolveProjectChains(projectId, parseInt(initialChainId))
        setConnectedChains(resolution.chains)
        setChainMappingAvailable(resolution.mappingAvailable)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Project chain is invalid')
      }
    }
    loadConnectedChains()
  }, [projectId, initialChainId])

  // Restore only payments which are still pending review or failed. Confirmed
  // payments clear their inputs so an old cart cannot be submitted twice.
  useEffect(() => {
    if (persistedPayment && persistedPayment.status !== 'pending' && persistedPayment.status !== 'completed') {
      // Restore form values from persisted state
      if (persistedPayment.amount) setAmount(persistedPayment.amount)
      if (persistedPayment.token) setSelectedToken(persistedPayment.token)
      if (persistedPayment.memo) setMemo(persistedPayment.memo)
      if (persistedPayment.selectedChainId) setSelectedChainId(persistedPayment.selectedChainId)
      // Convert selectedTierIds array back to quantities (count occurrences)
      if (persistedPayment.selectedTierIds) {
        const quantities: Record<number, number> = {}
        persistedPayment.selectedTierIds.forEach((id: number) => {
          quantities[id] = (quantities[id] || 0) + 1
        })
        setTierQuantities(quantities)
      } else if (persistedPayment.selectedTierId != null) {
        setTierQuantities({ [persistedPayment.selectedTierId]: 1 })
      }
    }
  }, [persistedPayment])

  // Read whether the project's first ruleset has started. Paying before the start
  // reverts in the terminal, so the Pay button idles behind a live countdown.
  useEffect(() => {
    let cancelled = false
    async function loadScheduleGate() {
      try {
        const chainIdNum = parseInt(selectedChainId)
        const chain = VIEM_CHAINS[chainIdNum as SupportedChainId]
        const rpcUrl = RPC_ENDPOINTS[chainIdNum]?.[0]
        if (!chain || !rpcUrl) return
        const client = createPublicClient({ chain, transport: http(rpcUrl) })
        const gate = await readPayScheduleGate(client, BigInt(currentProjectId))
        if (!cancelled) setPayStartsAt(gate.startsAt)
      } catch {
        if (!cancelled) setPayStartsAt(null)
      }
    }
    setPayStartsAt(null)
    loadScheduleGate()
    return () => {
      cancelled = true
    }
  }, [currentProjectId, selectedChainId])

  const notStarted = payStartsAt !== null && payStartsAt > countdownNow

  // Tick the countdown once per second while the start is in the future; when it
  // passes, the gate clears itself and the Pay button wakes up.
  useEffect(() => {
    if (!notStarted) return
    const timer = setInterval(() => {
      setCountdownNow(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [notStarted])

  // Fetch NFT tiers when chain changes
  useEffect(() => {
    async function loadNFTTiers() {
      setNftSafetyError(null)
      try {
        const hookAddr = await getProjectDataHook(currentProjectId, parseInt(selectedChainId))
        if (hookAddr) {
          setNftHookAddress(hookAddr)
          const [tiers, flags] = await Promise.all([fetchResolvedNFTTiers(hookAddr, parseInt(selectedChainId)), fetchHookFlags(hookAddr, parseInt(selectedChainId))])
          setNftTiers(tiers.filter((t) => t.remainingSupply > 0).sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0)))
          setNftHookFlags(flags)
        } else {
          setNftTiers([])
          setNftHookAddress(null)
          setNftHookFlags(null)
        }
      } catch (err) {
        setNftTiers([])
        setNftHookAddress(null)
        setNftHookFlags(null)
        setNftSafetyError(err instanceof Error ? err.message : 'Project hook configuration not recognized')
      } finally {
        setTierQuantities({})
      }
    }
    loadNFTTiers()
  }, [currentProjectId, selectedChainId])

  // Fetch ETH price on mount
  useEffect(() => {
    setEthPriceLoading(true)
    fetchEthPrice()
      .then((price) => {
        setEthPrice(price)
      })
      .catch(() => {
        setEthPrice(null)
      })
      .finally(() => setEthPriceLoading(false))
  }, [])

  // Fetch project data when chain changes.
  const hasLoadedProjectRef = useRef(false)
  useEffect(() => {
    async function load() {
      try {
        // Only show loading skeleton on initial load, not when switching chains
        if (!hasLoadedProjectRef.current) {
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

        setFullMetadata((data.metadata as IpfsProjectMetadata | undefined) ?? null)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load project'
        setError(errorMsg)
      } finally {
        hasLoadedProjectRef.current = true
        setLoading(false)
      }
    }
    load()
  }, [currentProjectId, selectedChainId])

  // Refresh only the treasury total after a confirmed balance-changing tx (pay / cash out / payout /
  // surplus allowance), so the header USD figure never lags the Funds panel until a reload. Balance-only
  // (no full reload → no loading flash); the emitting forms fire `juice:project-data-invalidated`, and the
  // pay flow below dispatches it too. Keeps the prior figure on a transient read failure.
  useEffect(() => {
    const refetchBalance = () => {
      fetchSuckerGroupBalance(currentProjectId, parseInt(selectedChainId))
        .then(setSuckerBalance)
        .catch(() => {})
      setBalanceRefreshTick(tick => tick + 1)
    }
    window.addEventListener('juice:project-data-invalidated', refetchBalance)
    return () => window.removeEventListener('juice:project-data-invalidated', refetchBalance)
  }, [currentProjectId, selectedChainId])

  // Price every accounting token this project holds (across its chains) through JBPrices. Fail-closed: a chain
  // that can't be verified marks the whole aggregate unpriced, and an unpriceable token falls back to a raw
  // per-token summary rather than a guessed dollar figure.
  useEffect(() => {
    let cancelled = false
    const chains = (connectedChains.length > 0
      ? connectedChains
      : [{ chainId: parseInt(initialChainId), projectId: parseInt(projectId) }]
    ).map(chain => ({ chainId: chain.chainId, projectId: chain.projectId }))
    fetchProjectBalanceBreakdown(chains)
      .then(breakdown => { if (!cancelled) setBalanceBreakdown(breakdown) })
      .catch(() => { if (!cancelled) setBalanceBreakdown(null) })
    return () => { cancelled = true }
  }, [connectedChains, projectId, initialChainId, balanceRefreshTick])

  // Fetch wallet balances when connected and chain changes
  const fetchWalletBalances = useCallback(async () => {
    if (!activeWalletAddress) {
      setWalletEthBalance(null)
      setWalletUsdcBalance(null)
      return null
    }

    const chainIdNum = parseInt(selectedChainId)
    const chain = VIEM_CHAINS[chainIdNum as SupportedChainId]
    if (!chain) return null

    setBalanceLoading(true)
    try {
      const rpcUrl = RPC_ENDPOINTS[chainIdNum]?.[0]
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      })

      // Fetch ETH balance
      const ethBalance = await publicClient.getBalance({
        address: activeWalletAddress as `0x${string}`,
      })
      setWalletEthBalance(ethBalance)

      // Fetch USDC balance
      const usdcAddress = USDC_ADDRESSES[chainIdNum as SupportedChainId]
      let usdcBalance: bigint | null = null
      if (usdcAddress) {
        usdcBalance = await publicClient.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [activeWalletAddress as `0x${string}`],
        })
        setWalletUsdcBalance(usdcBalance)
      }
      return { eth: ethBalance, usdc: usdcBalance }
    } catch (err) {
      console.error('Failed to fetch wallet balances:', err)
      return null
    } finally {
      setBalanceLoading(false)
    }
  }, [activeWalletAddress, selectedChainId])

  useEffect(() => {
    fetchWalletBalances()
  }, [fetchWalletBalances])

  useEffect(() => {
    let cancelled = false

    async function loadPaymentRoutes() {
      setPaymentSafetyLoading(true)
      setPaymentSafetyError(null)
      setPaymentTokenOptions([])
      try {
        const chainIdNum = parseInt(selectedChainId)
        const chain = VIEM_CHAINS[chainIdNum as SupportedChainId]
        const rpcUrl = RPC_ENDPOINTS[chainIdNum]?.[0]
        if (!chain || !rpcUrl) throw new Error('Unsupported payment chain')
        const client = createPublicClient({ chain, transport: http(rpcUrl) })
        // Direct-pay currencies come from the project's ACTUAL accounting contexts,
        // not a hardcoded ETH/USDC probe — a custom-ERC-20-denominated project must
        // surface its own token as a direct pay currency.
        const accountingContexts = await getAccountingContexts(client as PublicClient, {
          chainId: chainIdNum as JBChainId,
          projectId: BigInt(currentProjectId),
        })
        await assertCurrentProjectPayConfigurationTrusted({
          client,
          projectId: BigInt(currentProjectId),
        })

        const nativeLower = NATIVE_TOKEN.toLowerCase()
        const usdcAddress = USDC_ADDRESSES[chainIdNum as SupportedChainId]
        const usdcLower = usdcAddress?.toLowerCase()

        // Every accounting-context token is a direct pay option (correct decimals /
        // currency from the context). Managed accounts pay only in ETH.
        const directContexts = isManagedMode
          ? accountingContexts.filter((context) => context.token.toLowerCase() === nativeLower)
          : accountingContexts
        const directOptions: PaymentTokenOption[] = await Promise.all(
          directContexts.map(async (context) => {
            const tokenLower = context.token.toLowerCase()
            let symbol: string
            let label: string
            let name: string
            if (tokenLower === nativeLower) {
              symbol = 'ETH'; label = 'ETH'; name = 'Ether'
            } else if (usdcLower && tokenLower === usdcLower) {
              symbol = 'USDC'; label = 'USDC'; name = 'USD Coin'
            } else {
              // Custom accounting token: the id is its address, the label its ERC-20 symbol.
              const resolved = await client
                .readContract({ address: context.token as Address, abi: erc20Abi, functionName: 'symbol' })
                .catch(() => shortHex(context.token))
              symbol = context.token
              label = resolved || shortHex(context.token)
              name = label
            }
            return {
              symbol,
              label,
              name,
              tokenAddress: context.token as Address,
              decimals: Number(context.decimals),
              currency: Number(context.currency),
              route: 'direct' as const,
            }
          }),
        )

        const directlyAccepts = (token: Address) =>
          directOptions.some((option) => option.tokenAddress.toLowerCase() === token.toLowerCase())

        // ETH / USDC the project does NOT accept directly are appended as swap-via-router
        // options — but only when the router can actually route them right now (a listed
        // router with no pool/feed path reverts at pay time; offering it is a trap).
        const routerCandidates: Array<{ symbol: string; name: string; tokenAddress: Address; decimals: number }> = []
        if (!directlyAccepts(NATIVE_TOKEN)) {
          routerCandidates.push({ symbol: 'ETH', name: 'Ether', tokenAddress: NATIVE_TOKEN, decimals: 18 })
        }
        if (!isManagedMode && usdcAddress && !directlyAccepts(usdcAddress)) {
          routerCandidates.push({ symbol: 'USDC', name: 'USD Coin', tokenAddress: usdcAddress, decimals: 6 })
        }
        const routedOptions = (
          await Promise.all(
            routerCandidates.map(async (candidate): Promise<PaymentTokenOption | null> => {
              try {
                const terminal = await getPaymentTerminal(client, chainIdNum, BigInt(currentProjectId), candidate.tokenAddress, 'pay')
                // Directory says the project accepts it directly after all → 'direct',
                // otherwise a live router route → 'routed'.
                if (terminal.type !== 'multi') {
                  const routable = await probeRouterPayRoute(client, terminal.address, BigInt(currentProjectId), candidate.tokenAddress, candidate.decimals)
                  if (!routable) return null
                }
                return {
                  symbol: candidate.symbol,
                  label: candidate.symbol,
                  name: candidate.name,
                  tokenAddress: candidate.tokenAddress,
                  decimals: candidate.decimals,
                  currency: tokenCurrencyId(candidate.tokenAddress),
                  route: terminal.type === 'multi' ? 'direct' : 'routed',
                }
              } catch (err) {
                if (err instanceof Error && err.message === 'This project does not accept the selected payment token') {
                  return null
                }
                throw err
              }
            }),
          )
        ).filter((option): option is PaymentTokenOption => option !== null)

        const verified = [...directOptions, ...routedOptions]
        if (verified.length === 0) throw new Error('This project has no recognized payment route')

        const nativeRoute = verified.find((route) => route.symbol === 'ETH')
        const options: PaymentTokenOption[] = [
          ...verified,
          ...(nativeRoute
            ? [
                {
                  symbol: 'PAY_CREDITS' as const,
                  label: 'Credits',
                  name: 'Pay Credits',
                  tokenAddress: NATIVE_TOKEN,
                  decimals: nativeRoute.decimals,
                  currency: nativeRoute.currency,
                  route: 'credits' as const,
                },
              ]
            : []),
        ]
        if (!cancelled) {
          setPaymentTokenOptions(options)
          setSelectedToken((current) => (options.some((option) => option.symbol === current) ? current : options[0].symbol))
        }
      } catch (err) {
        if (!cancelled) {
          setPaymentSafetyError(err instanceof Error ? err.message : 'Payment route not recognized')
        }
      } finally {
        if (!cancelled) setPaymentSafetyLoading(false)
      }
    }

    loadPaymentRoutes()
    return () => {
      cancelled = true
    }
  }, [currentProjectId, selectedChainId, isManagedMode])

  // Smart token default: select token with highest USD value
  useEffect(() => {
    if (balanceLoading || ethPriceLoading || !ethPrice) return

    const ethBalanceUsd = walletEthBalance ? parseFloat(formatEther(walletEthBalance)) * ethPrice : 0
    const usdcBalanceUsd = walletUsdcBalance ? Number(walletUsdcBalance) / 1e6 : 0
    const payCreditsUsd = juiceBalance?.balance ?? 0

    // Find the token with the highest USD value
    const balances = (
      [
        { token: 'ETH', usd: ethBalanceUsd },
        { token: 'USDC', usd: usdcBalanceUsd },
        { token: 'PAY_CREDITS', usd: payCreditsUsd },
      ] satisfies Array<{ token: PaymentToken; usd: number }>
    ).filter((balance) => paymentTokenOptions.some((option) => option.symbol === balance.token))

    if (balances.length === 0) return

    const best = balances.reduce((a, b) => (b.usd > a.usd ? b : a))

    // Only auto-select if user has some balance and hasn't manually changed
    if (best.usd > 0) {
      setSelectedToken(best.token)
    }
  }, [balanceLoading, ethPriceLoading, ethPrice, walletEthBalance, walletUsdcBalance, juiceBalance, paymentTokenOptions])

  // The card uses the same hook-aware terminal preview as final transaction review.
  // This covers issuance, buyback/AMM routing, cross-currency payments, and reserved splits.
  useEffect(() => {
    let cancelled = false

    if (
      addsToBalance ||
      selectedToken === 'PAY_CREDITS' ||
      !selectedPaymentOption ||
      paymentSafetyLoading ||
      paymentSafetyError ||
      !amount
    ) {
      setPayPreview({ status: 'idle' })
      return
    }

    let paymentAmount: bigint
    try {
      paymentAmount = parseUnits(amount, selectedPaymentOption.decimals)
    } catch {
      setPayPreview({ status: 'idle' })
      return
    }
    if (paymentAmount <= 0n) {
      setPayPreview({ status: 'idle' })
      return
    }

    setPayPreview({ status: 'loading' })
    const timer = setTimeout(async () => {
      try {
        const chainIdNum = parseInt(selectedChainId)
        const chain = VIEM_CHAINS[chainIdNum as SupportedChainId]
        const rpcUrl = RPC_ENDPOINTS[chainIdNum]?.[0]
        if (!chain || !rpcUrl) throw new Error('Unsupported payment chain')

        const client = createPublicClient({ chain, transport: http(rpcUrl) })
        const tokenAddress = selectedPaymentOption.tokenAddress
        const terminal = await getPaymentTerminal(
          client,
          chainIdNum,
          BigInt(currentProjectId),
          tokenAddress,
        )

        let metadata: Hex = '0x'
        if (selectedTierIds.length > 0) {
          if (!nftHookAddress) throw new Error('NFT payment configuration is unavailable')
          const currentHook = await getProjectDataHook(currentProjectId, chainIdNum)
          if (!currentHook || currentHook.toLowerCase() !== nftHookAddress.toLowerCase()) {
            throw new Error('The project NFT hook changed')
          }
          const identity = await requireRecognized721HookIdentity(
            client,
            nftHookAddress,
            BigInt(currentProjectId),
          )
          metadata = buildNftPayMetadata(identity.metadataIdTarget, selectedTierIds)
        }

        const beneficiary = (activeWalletAddress ?? PREVIEW_BENEFICIARY) as Address
        const preview = await client.readContract({
          account: beneficiary,
          address: terminal.address,
          abi: TERMINAL_PREVIEW_PAY_ABI,
          functionName: 'previewPayFor',
          args: [BigInt(currentProjectId), tokenAddress, paymentAmount, beneficiary, metadata],
        })
        const outcome = resolvePayPreviewOutcome({
          beneficiaryTokenCount: preview[1],
          reservedTokenCount: preview[2],
          hookSpecifications: preview[3],
        })
        // A verified zero/zero quote is a legitimate pay (weight-0 ruleset): keep it
        // submittable and hide the meaningless "0 tokens" line instead of blocking.
        const zeroIssuance = selectedTierIds.length === 0 &&
          isVerifiedZeroIssuance(outcome.beneficiaryTokenCount, outcome.reservedTokenCount)
        // Probe the buyback pool with the V4 Quoter so the direct-swap offer can
        // fire even on the ISSUANCE route (a pool swap that beats what pay would
        // mint). Plain pair-token buys only; quoteDirectBuy null-gates everything
        // else (tiers/router/no pool/no verified Quoter/quote revert).
        let directSwapQuote: { poolId: Hex; out: bigint } | null = null
        if (selectedTierIds.length === 0 && selectedPaymentOption.route === 'direct') {
          directSwapQuote = await quoteDirectBuy(
            chainIdNum,
            BigInt(currentProjectId),
            tokenAddress,
            paymentAmount,
          ).catch(() => null)
        }
        if (!cancelled) {
          setPayPreview({
            status: 'ready',
            beneficiaryTokenCount: outcome.beneficiaryTokenCount,
            reservedTokenCount: outcome.reservedTokenCount,
            route: outcome.route,
            minReturnedTokens: outcome.minReturnedTokens,
            buybackPoolId: outcome.buyback?.poolId ?? null,
            zeroIssuance,
            grossIssuance: outcome.buyback?.tokenCountWithoutHook ?? 0n,
            directSwapQuote,
          })
        }
      } catch (err) {
        if (!cancelled) {
          const reason = err instanceof Error
            ? err.message.split('\n')[0].slice(0, 160)
            : 'Live pay preview unavailable'
          setPayPreview({ status: 'unavailable', reason })
        }
      }
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    activeWalletAddress,
    addsToBalance,
    amount,
    currentProjectId,
    nftHookAddress,
    paymentSafetyError,
    paymentSafetyLoading,
    selectedChainId,
    selectedPaymentOption,
    selectedTierIds,
    selectedToken,
  ])

  // Load the connected beneficiary's shop credit for the NFT checkout summary.
  useEffect(() => {
    let cancelled = false
    if (!nftHookAddress || selectedTierIds.length === 0 || !activeWalletAddress) {
      setNftCredits(0n)
      setNftCreditsLoading(false)
      return
    }
    setNftCreditsLoading(true)
    fetchPayCredits(nftHookAddress, activeWalletAddress as Address, parseInt(selectedChainId))
      .then((credits) => { if (!cancelled) setNftCredits(credits) })
      .catch(() => { if (!cancelled) setNftCredits(0n) })
      .finally(() => { if (!cancelled) setNftCreditsLoading(false) })
    return () => { cancelled = true }
  }, [nftHookAddress, activeWalletAddress, selectedChainId, selectedTierIds.length])

  // For a swap-via-router add-to-balance top-up, back out how much of the project's
  // accepted token lands onchain after the swap (same issuance curve on both legs).
  useEffect(() => {
    let cancelled = false
    if (
      !addsToBalance ||
      selectedPaymentOption?.route !== 'routed' ||
      !acceptedDirectOption ||
      !amount
    ) {
      setRoutedConversion(null)
      setRoutedConversionLoading(false)
      return
    }
    let inputAmount: bigint
    try {
      inputAmount = parseUnits(amount, selectedPaymentOption.decimals)
    } catch {
      setRoutedConversion(null)
      return
    }
    if (inputAmount <= 0n) {
      setRoutedConversion(null)
      return
    }
    const routedToken = selectedPaymentOption.tokenAddress
    const acceptedToken = acceptedDirectOption.tokenAddress
    const acceptedDecimals = acceptedDirectOption.decimals
    const acceptedLabel = acceptedDirectOption.label
    setRoutedConversionLoading(true)
    const timer = setTimeout(async () => {
      try {
        const chainIdNum = parseInt(selectedChainId)
        const chain = VIEM_CHAINS[chainIdNum as SupportedChainId]
        const rpcUrl = RPC_ENDPOINTS[chainIdNum]?.[0]
        if (!chain || !rpcUrl) throw new Error('Unsupported payment chain')
        const client = createPublicClient({ chain, transport: http(rpcUrl) })
        const beneficiary = (activeWalletAddress ?? PREVIEW_BENEFICIARY) as Address

        const routedTerminal = await getPaymentTerminal(client, chainIdNum, BigInt(currentProjectId), routedToken)
        const routedPreview = await client.readContract({
          account: beneficiary,
          address: routedTerminal.address,
          abi: TERMINAL_PREVIEW_PAY_ABI,
          functionName: 'previewPayFor',
          args: [BigInt(currentProjectId), routedToken, inputAmount, beneficiary, '0x'],
        })
        const routedOutcome = resolvePayPreviewOutcome({
          beneficiaryTokenCount: routedPreview[1],
          reservedTokenCount: routedPreview[2],
          hookSpecifications: routedPreview[3],
        })
        const routedIssuance = routedOutcome.beneficiaryTokenCount + routedOutcome.reservedTokenCount

        const unit = 10n ** BigInt(acceptedDecimals)
        const acceptedTerminal = await getPaymentTerminal(client, chainIdNum, BigInt(currentProjectId), acceptedToken)
        const unitPreview = await client.readContract({
          account: beneficiary,
          address: acceptedTerminal.address,
          abi: TERMINAL_PREVIEW_PAY_ABI,
          functionName: 'previewPayFor',
          args: [BigInt(currentProjectId), acceptedToken, unit, beneficiary, '0x'],
        })
        const unitOutcome = resolvePayPreviewOutcome({
          beneficiaryTokenCount: unitPreview[1],
          reservedTokenCount: unitPreview[2],
          hookSpecifications: unitPreview[3],
        })
        const unitIssuance = unitOutcome.beneficiaryTokenCount + unitOutcome.reservedTokenCount

        const landed = landedAcceptedAfterSwap({ routedIssuance, unitIssuance, acceptedDecimals })
        if (!cancelled) {
          setRoutedConversion(landed != null ? { landed, decimals: acceptedDecimals, label: acceptedLabel } : null)
        }
      } catch {
        if (!cancelled) setRoutedConversion(null)
      } finally {
        if (!cancelled) setRoutedConversionLoading(false)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    addsToBalance,
    amount,
    selectedChainId,
    currentProjectId,
    activeWalletAddress,
    selectedPaymentOption,
    acceptedDirectOption,
  ])

  const requiresLivePayPreview = selectedToken !== 'PAY_CREDITS' && !addsToBalance
  const livePayPreviewReady = payPreview.status === 'ready'

  // Direct AMM swap offer: when the buyback hook already routes this pay through the
  // pool, buying straight from the pool keeps the reserved share too. Only for plain
  // buys — no NFT mints, not add-to-balance, and only directly accepted pair tokens.
  const directSwapOffer = useMemo(() => {
    if (payPreview.status !== 'ready') return null
    return resolveDirectSwapOffer({
      route: payPreview.route,
      beneficiaryTokenCount: payPreview.beneficiaryTokenCount,
      reservedTokenCount: payPreview.reservedTokenCount,
      ammPoolId: payPreview.buybackPoolId,
      quote: payPreview.directSwapQuote,
      hasTiers: selectedTierIds.length > 0,
      addsToBalance,
      viaRouter: selectedPaymentOption?.route !== 'direct',
    })
  }, [payPreview, selectedTierIds.length, addsToBalance, selectedPaymentOption?.route])

  // Check if form should be locked due to active/completed payment
  const isPaymentLocked = persistedPayment?.status && persistedPayment.status !== 'pending'
  const paymentButtonDisabled = Boolean(
    nftSafetyError ||
    paymentSafetyError ||
    paymentSafetyLoading ||
    paying ||
    notStarted ||
    !amount ||
    parseFloat(amount) <= 0 ||
    isPaymentLocked ||
    (requiresLivePayPreview && !livePayPreviewReady),
  )

  // Check if user has sufficient balance for the payment
  const checkSufficientBalance = useCallback(
    (fresh?: { eth: bigint; usdc: bigint | null } | null) => {
      if (balanceLoading && !fresh) return { sufficient: false, reason: 'loading' }

      const paymentAmount = parseFloat(amount) || 0
      const total = paymentAmount

      const eth = fresh?.eth ?? walletEthBalance
      const usdc = fresh?.usdc ?? walletUsdcBalance
      const ethBalanceNum = eth ? parseFloat(formatEther(eth)) : 0

      if (selectedToken === 'ETH') {
        // Leave some ETH for the wallet's exact gas estimate without imposing a guessed threshold.
        if (isManagedMode ? ethBalanceNum < total : ethBalanceNum <= total) {
          return {
            sufficient: false,
            reason: 'insufficient_eth',
            needed: total,
            have: ethBalanceNum,
          }
        }
      } else if (selectedToken === 'USDC') {
        // Need USDC for payment and ETH for gas
        const usdcBalanceNum = usdc ? Number(usdc) / 1e6 : 0
        if (usdcBalanceNum < total) {
          return {
            sufficient: false,
            reason: 'insufficient_usdc',
            needed: total,
            have: usdcBalanceNum,
          }
        }
        if (ethBalanceNum <= 0) {
          return {
            sufficient: false,
            reason: 'insufficient_gas',
            needed: 0,
            have: ethBalanceNum,
          }
        }
      } else if (selectedToken === 'PAY_CREDITS') {
        // Need Pay Credits balance
        const juiceBalanceNum = juiceBalance?.balance ?? 0
        if (juiceBalanceNum < total) {
          return {
            sufficient: false,
            reason: 'insufficient_pay_credits',
            needed: total,
            have: juiceBalanceNum,
          }
        }
      }

      return { sufficient: true }
    },
    [amount, selectedToken, walletEthBalance, walletUsdcBalance, balanceLoading, juiceBalance, isManagedMode]
  )

  // Handle NFT tier selection - increments quantity on click
  const handleTierSelect = useCallback(
    (tier: ResolvedNFTTier) => {
      if (!isSupportedTierCurrency(tier.currency)) return

      const requiredToken = isEthTierCurrency(tier.currency) ? 'ETH' : 'USDC'
      if (!paymentTokenOptions.some((option) => option.symbol === requiredToken)) return

      // Auto-switch payment token based on tier currency
      // ETH-denominated tiers (currency=1) → ETH
      // USD-denominated tiers → canonical USDC on the selected chain.
      if (isEthTierCurrency(tier.currency)) {
        setSelectedToken('ETH')
      } else {
        setSelectedToken('USDC')
      }

      setTierQuantities((prev) => {
        const currentQty = prev[tier.tierId] || 0
        const newQty = currentQty + 1
        const newQuantities = { ...prev, [tier.tierId]: newQty }

        // Calculate total price from all selected tiers and quantities
        const totalPrice = Object.entries(newQuantities).reduce((sum, [id, qty]) => {
          const t = nftTiers.find((t) => t.tierId === Number(id))
          return sum + (t ? getEffectiveTierPrice(t) * BigInt(qty) : 0n)
        }, 0n)

        setAmount(formatUnits(totalPrice, tier.pricingDecimals))

        return newQuantities
      })
    },
    [nftTiers, paymentTokenOptions]
  )

  // Adjust tier quantity (for +/- buttons)
  const adjustTierQuantity = useCallback(
    (tierId: number, delta: number) => {
      setTierQuantities((prev) => {
        const currentQty = prev[tierId] || 0
        const newQty = Math.max(0, currentQty + delta)

        let newQuantities: Record<number, number>
        if (newQty === 0) {
          // Remove tier from selection
          const { [tierId]: _, ...rest } = prev
          newQuantities = rest
        } else {
          newQuantities = { ...prev, [tierId]: newQty }
        }

        // Recalculate total price
        const totalPrice = Object.entries(newQuantities).reduce((sum, [id, qty]) => {
          const t = nftTiers.find((t) => t.tierId === Number(id))
          return sum + (t ? getEffectiveTierPrice(t) * BigInt(qty) : 0n)
        }, 0n)

        if (totalPrice === 0n) {
          setAmount('')
        } else {
          const tier = nftTiers.find((t) => t.tierId === tierId)
          if (tier && isSupportedTierCurrency(tier.currency)) {
            setSelectedToken(isEthTierCurrency(tier.currency) ? 'ETH' : 'USDC')
            setAmount(formatUnits(totalPrice, tier.pricingDecimals))
          }
        }

        return newQuantities
      })
    },
    [nftTiers]
  )

  // Handle on-chain metadata loaded for a tier
  const handleTierMetadataLoaded = useCallback((tierId: number, metadata: OnChainTierMetadata) => {
    setTierMetadata((prev) => ({
      ...prev,
      [tierId]: metadata,
    }))
  }, [])

  // Get display name for a tier (productName from on-chain, or tier.name)
  const getTierDisplayName = useCallback(
    (tier: ResolvedNFTTier) => {
      // If tier.name is not a placeholder "Tier X", use it directly
      if (!/^Tier \d+$/.test(tier.name)) {
        return tier.name
      }
      // Otherwise, check for productName from on-chain metadata
      const metadata = tierMetadata[tier.tierId]
      return metadata?.productName || tier.name
    },
    [tierMetadata]
  )

  // Listen for add-to-checkout events from Shop tab
  useEffect(() => {
    const handleAddToCheckout = (e: CustomEvent<{ tierId: number; price: string; name?: string }>) => {
      const { tierId, name } = e.detail
      const tier = nftTiers.find((t) => t.tierId === tierId)
      if (tier) {
        // Store the tier name in metadata if provided (so it displays correctly in "You get")
        if (name && /^Tier \d+$/.test(tier.name)) {
          setTierMetadata((prev) => ({
            ...prev,
            [tierId]: { ...prev[tierId], productName: name },
          }))
        }
        handleTierSelect(tier)
      }
    }

    window.addEventListener('juice:add-to-checkout', handleAddToCheckout as EventListener)
    return () => window.removeEventListener('juice:add-to-checkout', handleAddToCheckout as EventListener)
  }, [nftTiers, handleTierSelect])

  // Listen for quantity adjustment events from Shop tab
  useEffect(() => {
    const handleAdjustQuantity = (e: CustomEvent<{ tierId: number; delta: number; name?: string }>) => {
      const { tierId, delta, name } = e.detail
      // Store the tier name in metadata if provided
      if (name) {
        const tier = nftTiers.find((t) => t.tierId === tierId)
        if (tier && /^Tier \d+$/.test(tier.name)) {
          setTierMetadata((prev) => ({
            ...prev,
            [tierId]: { ...prev[tierId], productName: name },
          }))
        }
      }
      adjustTierQuantity(tierId, delta)
    }

    window.addEventListener('juice:adjust-checkout-quantity', handleAdjustQuantity as EventListener)
    return () => window.removeEventListener('juice:adjust-checkout-quantity', handleAdjustQuantity as EventListener)
  }, [nftTiers, adjustTierQuantity])

  // Handle payment status updates. Inputs remain frozen through submission and
  // are cleared only after an onchain receipt confirms success.
  useEffect(() => {
    if (activePayment?.status === 'confirmed') {
      setPaying(false)
      setAmount('')
      setMemo('')
      setTierQuantities({})
      updatePersistedPayment({
        status: 'completed',
        amount: '',
        memo: '',
        selectedTierIds: [],
        selectedTierId: null,
        txHash: activePayment.hash,
        confirmedAt: new Date().toISOString(),
      })
      // A confirmed pay grew the treasury — tell the header refetch above and the Funds panel to refresh
      // (the cash out / payout / allowance forms already emit this; the pay flow otherwise did not).
      window.dispatchEvent(new CustomEvent('juice:project-data-invalidated', {
        detail: { chainId: parseInt(selectedChainId), projectId: Number(currentProjectId) },
      }))
    } else if (activePayment?.status === 'queued') {
      setPaying(false)
      refetchJuiceBalance()
      updatePersistedPayment({
        status: 'in_progress',
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
  }, [activePayment?.status, activePayment?.hash, activePayment?.error, refetchJuiceBalance, updatePersistedPayment, selectedChainId, currentProjectId])

  // Format a shop pricing amount ($ for USD tiers, ETH otherwise).
  const formatPricingAmount = (raw: bigint, decimals: number, currency: number) => {
    const value = formatUnits(raw, decimals)
    return isUsdTierCurrency(currency) ? `$${value}` : `${value} ETH`
  }

  const renderSelectedTierList = () => {
    const entries = Object.entries(tierQuantities)
    if (entries.length === 0) return null
    const muted = isDark ? 'text-gray-400' : 'text-gray-500'

    // Shop-credit checkout math, in the first selected tier's pricing units.
    const selectedTiers = entries
      .map(([tierId, qty]) => ({ tier: nftTiers.find((candidate) => candidate.tierId === Number(tierId)), qty }))
      .filter((entry): entry is { tier: ResolvedNFTTier; qty: number } => Boolean(entry.tier))
    const pricingTier = selectedTiers[0]?.tier
    const pricingDecimals = pricingTier?.pricingDecimals ?? 18
    const pricingCurrency = pricingTier?.currency ?? 1
    const fmt = (raw: bigint) => formatPricingAmount(raw, pricingDecimals, pricingCurrency)
    const subtotal = selectedTiers.reduce((sum, { tier, qty }) => sum + getEffectiveTierPrice(tier) * BigInt(qty), 0n)
    const restrictedCost = selectedTiers.reduce(
      (sum, { tier, qty }) => (tier.cannotBuyWithCredits ? sum + getEffectiveTierPrice(tier) * BigInt(qty) : sum),
      0n,
    )
    const breakdown = computeNftCheckout({ subtotal, restrictedCost, credits: nftCredits })
    let entered: bigint | null = null
    try {
      if (amount) entered = parseUnits(amount, pricingDecimals)
    } catch {
      entered = null
    }
    const shortfall = entered != null && breakdown.due > entered ? breakdown.due - entered : 0n

    return (
      <div className="mt-2">
        <div className="space-y-1">
          {selectedTiers.map(({ tier, qty }) => {
            const exceedsSupply = qty > tier.remainingSupply
            return (
              <div key={tier.tierId} className={`flex items-center gap-2 ${exceedsSupply ? 'text-orange-400' : ''}`}>
                <span className={muted}>+</span>
                <TierPreviewImage tier={tier} hookAddress={nftHookAddress} chainId={parseInt(selectedChainId)} isDark={isDark} size="small" onMetadataLoaded={handleTierMetadataLoaded} />
                <span>
                  {getTierDisplayName(tier)}
                  {qty > 1 ? ` ×${qty}` : ''}
                </span>
                {exceedsSupply && <span className="text-xs">(only {tier.remainingSupply} left)</span>}
              </div>
            )
          })}
        </div>

        {/* Shop-credit checkout summary */}
        <div className={`mt-2 space-y-0.5 border-t pt-2 text-xs ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className="flex justify-between gap-4">
            <span className={muted}>Items</span>
            <span>{fmt(breakdown.subtotal)}</span>
          </div>
          {!activeWalletAddress ? (
            <div className="flex justify-between gap-4">
              <span className={muted}>Shop credit</span>
              <span className={muted}>Connect wallet to check</span>
            </div>
          ) : nftCreditsLoading ? (
            <div className="flex justify-between gap-4">
              <span className={muted}>Shop credit</span>
              <span className={muted}>Checking…</span>
            </div>
          ) : breakdown.applied > 0n ? (
            <div className={`flex justify-between gap-4 ${isDark ? 'text-green-400' : 'text-green-600'}`}>
              <span>Shop credit applied</span>
              <span>−{fmt(breakdown.applied)}</span>
            </div>
          ) : nftCredits > 0n ? (
            <div className="flex justify-between gap-4">
              <span className={muted}>Shop credit</span>
              <span className={muted}>{fmt(nftCredits)}</span>
            </div>
          ) : null}
          {breakdown.restrictedCost > 0n && (
            <div className="flex justify-between gap-4">
              <span className={muted}>Fresh payment required</span>
              <span className={muted}>{fmt(breakdown.restrictedCost)}</span>
            </div>
          )}
          <div className={`flex justify-between gap-4 font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            <span>Amount due</span>
            <span>{fmt(breakdown.due)}</span>
          </div>
          {entered != null && (
            <div className={`flex justify-between gap-4 ${shortfall > 0n ? 'text-orange-400' : ''}`}>
              <span className={muted}>Entered value</span>
              <span>{fmt(entered)}</span>
            </div>
          )}
          {shortfall > 0n && (
            <div className="flex justify-between gap-4 text-orange-400">
              <span>Still needed</span>
              <span>{fmt(shortfall)}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderPayOutcomePreview = () => {
    const muted = isDark ? 'text-gray-400' : 'text-gray-500'

    if (addsToBalance) {
      const routedTopUp = selectedPaymentOption?.route === 'routed'
      const acceptedLabel = acceptedDirectOption?.label || 'the project token'
      return (
        <div className={`mt-3 text-xs ${muted}`}>
          {routedTopUp && (
            <div className="mb-1">
              {routedConversionLoading
                ? 'Estimating swap…'
                : routedConversion
                ? `≈ ${formatUnits(routedConversion.landed, routedConversion.decimals)} ${routedConversion.label} lands onchain after the swap`
                : `Swaps into ${acceptedLabel} onchain`}
            </div>
          )}
          Adds to the project balance — nothing else. It does not issue project tokens; choose Pay to receive them.
        </div>
      )
    }
    if (selectedToken === 'PAY_CREDITS' || payPreview.status === 'idle') return null
    if (payPreview.status === 'loading') {
      return <div className={`mt-3 text-xs ${muted}`} aria-live="polite">Checking live token quote…</div>
    }
    if (payPreview.status === 'unavailable') {
      return (
        <div className={`mt-3 text-xs ${isDark ? 'text-amber-300' : 'text-amber-700'}`} role="status">
          Live token quote unavailable: {payPreview.reason}
        </div>
      )
    }

    const tokenSymbol = projectTokenSymbol || project?.name.split(' ')[0].toUpperCase().slice(0, 6) || 'TOKENS'

    // Direct AMM swap beats paying: the buyback hook skims the reserved % even on
    // its swap route, while a straight pool swap keeps 100% of the output.
    // TODO(parity): UniversalRouter execution — juicy has no Universal Router
    // plumbing yet, so the offer links out to the pool on Uniswap instead of
    // executing the swap in place. Never ship a half-guarded swap execution.
    if (directSwapOffer) {
      const poolLink = uniswapPoolLink(parseInt(selectedChainId), directSwapOffer.poolId)
      return (
        <div className={`mt-4 min-w-0 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`} aria-live="polite">
          <div className={`text-xs ${muted}`}>You get at least</div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <span className={`min-w-0 break-all text-lg font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {formatExactTokenEstimate(directSwapOffer.minOut)} {tokenSymbol}
            </span>
            <span
              className={`shrink-0 border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                isDark ? 'border-juice-cyan/50 text-juice-cyan' : 'border-cyan-400 text-cyan-700'
              }`}
              title="Bought straight from the Uniswap pool, bypassing pay — so the reserved % / splits take nothing"
            >
              swap
            </span>
          </div>
          <div className={`mt-1 break-all text-xs font-medium ${muted}`}>
            Swapping the pool directly beats paying by {formatExactTokenEstimate(directSwapOffer.advantage)} {tokenSymbol} — splits take 0 {tokenSymbol}.
          </div>
          {poolLink && (
            <a
              href={poolLink}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-1 inline-block text-xs underline ${isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'}`}
            >
              Swap via Uniswap ↗
            </a>
          )}
          <div className={`mt-1 text-[10px] ${muted}`}>
            Paying below still works — it fills through the same pool, but splits keep their share.
          </div>
        </div>
      )
    }

    // A verified payment can intentionally mint no tokens (weight-0 ruleset). Keep
    // selected NFT receipts, but omit "0 tokens" and "Splits get 0 tokens" entirely.
    if (payPreview.zeroIssuance) {
      return (
        <div className={`mt-3 text-xs ${muted}`} aria-live="polite">
          This project currently issues no tokens for payments — a payment simply funds the project.
          {renderSelectedTierList()}
        </div>
      )
    }

    return (
      <div className={`mt-4 min-w-0 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`} aria-live="polite">
        <div className={`text-xs ${muted}`}>{payPreview.route === 'amm' ? 'You get at least' : 'You get'}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('juice:switch-tab', {
                  detail: { tab: 'tokens' },
                }),
              )
            }
            className={`min-w-0 break-all text-left text-lg font-semibold hover:underline ${
              isDark ? 'text-white hover:text-juice-cyan' : 'text-gray-900 hover:text-juice-orange'
            }`}
          >
            {formatExactTokenEstimate(payPreview.minReturnedTokens)} {tokenSymbol}
          </button>
          <span className={`shrink-0 border px-2 py-0.5 text-[10px] font-semibold uppercase ${
            payPreview.route === 'amm'
              ? isDark
                ? 'border-purple-400/40 text-purple-300'
                : 'border-purple-300 text-purple-700'
              : isDark
                ? 'border-gray-500 text-gray-300'
                : 'border-gray-300 text-gray-700'
          }`}>
            {formatRoutingTag(payPreview.route)}
          </span>
        </div>
        {payPreview.reservedTokenCount > 0n && (
          <div className={`mt-1 break-all text-xs font-medium ${muted}`}>
            Splits get {formatExactTokenEstimate(payPreview.reservedTokenCount)} {tokenSymbol}
          </div>
        )}
        {payPreview.route === 'amm' && payPreview.buybackPoolId && (() => {
          const poolLink = uniswapPoolLink(parseInt(selectedChainId), payPreview.buybackPoolId)
          // Beneficiary-share comparison (excludes splits): scale gross issuance by the
          // same beneficiary fraction the swap output exposes, so the two lines compare
          // like for like and explain why the AMM route won.
          const benef = payPreview.beneficiaryTokenCount
          const reserved = payPreview.reservedTokenCount
          const swapTotal = benef + reserved
          const issuanceBenef = swapTotal > 0n ? (payPreview.grossIssuance * benef) / swapTotal : payPreview.grossIssuance
          return (
            <div className="mt-1 text-xs">
              <div className={muted}>
                Filled via Uniswap pool{' '}
                {poolLink ? (
                  <a href={poolLink} target="_blank" rel="noopener noreferrer" className={`underline ${isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'}`}>
                    {shortHex(payPreview.buybackPoolId)}
                  </a>
                ) : (
                  <span className="font-mono">{shortHex(payPreview.buybackPoolId)}</span>
                )}
              </div>
              {payPreview.grossIssuance > 0n && (
                <div className={`mt-0.5 ${muted}`}>
                  AMM: {formatExactTokenEstimate(payPreview.minReturnedTokens)} {tokenSymbol} vs. Issuance: {formatExactTokenEstimate(issuanceBenef)} {tokenSymbol}
                </div>
              )}
            </div>
          )
        })()}
        {renderSelectedTierList()}
      </div>
    )
  }

  // Natural-language intro above the pay controls — juicy's signature is more
  // explainer text than the website, same structure.
  const projectIsRevnet = isRevnet ?? Boolean(project?.isRevnet)
  const renderPayExplainer = () => {
    const tokenSymbol = projectTokenSymbol || 'its token'
    return (
      <div className="mb-3">
        <ExplainerMessage>
          {projectIsRevnet
            ? `Paying this revnet routes your payment into its treasury and issues ${tokenSymbol} at the current stage rate. Revnet terms are locked onchain — nobody can change the issuance schedule or take a special cut.`
            : `Paying this project routes your payment into its treasury and issues ${tokenSymbol} under its current ruleset. The project's owner configures issuance and reserved splits, so check the quote below before paying.`}
        </ExplainerMessage>
      </div>
    )
  }

  // Inline caveat near the Pay button: the minimum shown is the exact minimum the
  // transaction enforces (issuance quotes are exact; AMM routes allow 1% slippage).
  const renderPayCaveat = () => {
    if (!requiresLivePayPreview || payPreview.status !== 'ready' || payPreview.zeroIssuance) return null
    return (
      <p className={`mt-2 text-[11px] leading-relaxed ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        {payPreview.route === 'amm'
          ? 'The minimum shown is enforced onchain when you sign — AMM fills allow up to 1% slippage, and payments take no protocol fee.'
          : 'The minimum shown is enforced onchain when you sign — issuance quotes are exact, and payments take no protocol fee.'}
      </p>
    )
  }

  // "Starts in" countdown — the first ruleset hasn't started, so paying reverts.
  const renderCountdownBanner = () => {
    if (!notStarted || payStartsAt === null) return null
    return (
      <div
        className={`mb-3 flex items-center justify-between gap-2 border px-3 py-2 text-sm ${
          isDark ? 'border-juice-cyan/40 bg-juice-cyan/10 text-juice-cyan' : 'border-cyan-300 bg-cyan-50 text-cyan-700'
        }`}
        role="status"
      >
        <span className="font-medium">Starts in</span>
        <span className="font-mono">{fmtCountdown(payStartsAt - countdownNow)}</span>
      </div>
    )
  }

  // Terminal-surface warnings live at the bottom of the card, mirroring the website.
  const renderSafetyNotices = () => {
    if (!nftSafetyError && !paymentSafetyError) return null
    return (
      <>
        {nftSafetyError && (
          <div className={`mt-3 border p-3 text-xs ${isDark ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
            {nftSafetyError}. Payments are unavailable until this project uses a recognized hook configuration.
          </div>
        )}
        {paymentSafetyError && (
          <div className={`mt-3 border p-3 text-xs ${isDark ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-red-300 bg-red-50 text-red-800'}`}>
            {paymentSafetyError}. Payments are blocked until the live project route is recognized.
          </div>
        )}
      </>
    )
  }

  const renderPaymentModeAndChainSelector = () => {
    const canSelectChain = availableChains.length > 1
    const selectorColor = isDark
      ? 'text-gray-300 hover:text-white'
      : 'text-gray-700 hover:text-gray-900'
    const disabledColor = isPaymentLocked ? 'cursor-not-allowed opacity-60' : ''

    return (
      <div className="relative mb-3 flex flex-wrap items-center gap-2 text-sm">
        <div className="relative">
          <button
            type="button"
            aria-label={`Payment action: ${addsToBalance ? 'Add to balance' : 'Pay'}`}
            aria-haspopup={canContributeOnly ? 'menu' : undefined}
            aria-expanded={canContributeOnly ? actionDropdownOpen : undefined}
            onClick={() => {
              if (isPaymentLocked || !canContributeOnly) return
              setActionDropdownOpen(!actionDropdownOpen)
              setChainDropdownOpen(false)
              setTokenDropdownOpen(false)
            }}
            disabled={Boolean(isPaymentLocked) || !canContributeOnly}
            className={`flex items-center gap-1 font-semibold underline underline-offset-2 ${selectorColor} ${disabledColor}`}
          >
            {addsToBalance ? 'Add to balance' : 'Pay'}
            {canContributeOnly && (
              <svg className={`h-3 w-3 transition-transform ${actionDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>
          {actionDropdownOpen && canContributeOnly && (
            <div className={`absolute left-0 top-full z-30 mt-1 min-w-[170px] border py-1 shadow-lg ${isDark ? 'border-white/10 bg-juice-dark' : 'border-gray-200 bg-white'}`} role="menu">
              {[
                { label: 'Pay', contributionOnly: false },
                { label: 'Add to balance', contributionOnly: true },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setContributionOnly(option.contributionOnly)
                    setActionDropdownOpen(false)
                  }}
                  className={`w-full px-3 py-2 text-left text-sm ${
                    contributionOnly === option.contributionOnly
                      ? isDark
                        ? 'bg-white/10 text-white'
                        : 'bg-gray-100 text-gray-900'
                      : isDark
                        ? 'text-gray-300 hover:bg-white/5'
                        : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="text-gray-500">on</span>

        <div className="relative">
          <button
            type="button"
            aria-label={`Payment chain: ${selectedChainInfo.name}`}
            aria-haspopup={canSelectChain ? 'menu' : undefined}
            aria-expanded={canSelectChain ? chainDropdownOpen : undefined}
            onClick={() => {
              if (isPaymentLocked || !canSelectChain) return
              setChainDropdownOpen(!chainDropdownOpen)
              setActionDropdownOpen(false)
              setTokenDropdownOpen(false)
            }}
            disabled={Boolean(isPaymentLocked) || !canSelectChain}
            className={`flex items-center gap-1 font-semibold underline underline-offset-2 ${selectorColor} ${disabledColor}`}
          >
            {payChainName(selectedChainId)}
            {canSelectChain && (
              <svg className={`h-3 w-3 transition-transform ${chainDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </button>
          {chainDropdownOpen && canSelectChain && (
            <div className={`absolute left-0 top-full z-30 mt-1 min-w-[150px] border py-1 shadow-lg ${isDark ? 'border-white/10 bg-juice-dark' : 'border-gray-200 bg-white'}`} role="menu">
              {availableChains.map((chain) => {
                const info = CHAIN_INFO[chain.chainId.toString()]
                if (!info) return null
                return (
                  <button
                    key={chain.chainId}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSelectedChainId(chain.chainId.toString())
                      setChainDropdownOpen(false)
                    }}
                    className={`w-full px-3 py-2 text-left text-sm ${
                      chain.chainId.toString() === selectedChainId
                        ? isDark
                          ? 'bg-white/10 text-white'
                          : 'bg-gray-100 text-gray-900'
                        : isDark
                          ? 'text-gray-300 hover:bg-white/5'
                          : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {payChainName(chain.chainId.toString())}
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
      </div>
    )
  }

  if (loading) {
    return (
      <div className="w-full">
        <div className={`max-w-md border p-4 animate-pulse ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`}>
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
              {[1, 2, 3, 4].map((i) => (
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
      return value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    }
    if (currency === 1) {
      if (!ethPrice) return null
      const usd = value * ethPrice
      return usd.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    }
    return null
  }

  const balanceAvailable = !!suckerBalance && suckerBalance.balanceAvailable !== false
  const paymentsAvailable = !!suckerBalance && suckerBalance.paymentsAvailable !== false
  const displayedBalance = suckerBalance?.totalBalance ?? project.balance
  const balanceScope = suckerBalance?.dataScope === 'project' ? ' on this chain' : ' balance'

  // Calculate total balance USD value using currency/decimals from suckerBalance
  const totalBalanceUsd = balanceAvailable ? formatUsd(displayedBalance, suckerBalance.currency, suckerBalance.decimals) : null

  // Prefer the on-chain, JBPrices-priced breakdown (all accounting tokens) once it resolves; until then show the
  // faster indexed single-token figure. When a total can't be summed honestly, show the raw per-token summary.
  const usdFigure = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const balanceHeadline = balanceBreakdown
    ? (!balanceBreakdown.verified
      ? 'Unavailable'
      : balanceBreakdown.priced
      ? usdFigure(balanceBreakdown.totalUsd)
      : balanceBreakdown.rawSummary)
    : (!balanceAvailable
      ? 'Unavailable'
      : totalBalanceUsd
      ? `$${totalBalanceUsd}`
      : suckerBalance
      ? `${formatBalance(displayedBalance, suckerBalance.decimals)} ${suckerBalance.currency === 2 ? 'USDC' : 'ETH'}`
      : 'Unavailable')

  const balanceTooltipRows: Array<{ key: string; label: string; value: string }> = balanceBreakdown
    ? balanceBreakdown.rows.filter(row => row.balance > 0n).map((row, index) => ({
      key: `${row.chainId}-${row.token}-${index}`,
      label: CHAIN_INFO[row.chainId.toString()]?.name ?? `Chain ${row.chainId}`,
      value: `${formatBalance(row.balance.toString(), row.decimals)}${row.symbol ? ` ${row.symbol}` : ''}`,
    }))
    : (suckerBalance?.projectBalances ?? [])
      .filter(pb => !!CHAIN_INFO[pb.chainId.toString()])
      .map(pb => {
        const pbCurrency = pb.currency ?? suckerBalance!.currency
        const pbDecimals = pb.decimals ?? suckerBalance!.decimals
        return {
          key: String(pb.chainId),
          label: CHAIN_INFO[pb.chainId.toString()]!.name,
          value: pbCurrency === 2 ? `$${formatBalance(pb.balance, pbDecimals)}` : `${formatBalance(pb.balance, pbDecimals)} ETH`,
        }
      })

  const showBalanceTooltipContent = (balanceBreakdown ? balanceBreakdown.verified : balanceAvailable) && balanceTooltipRows.length > 0

  const handlePay = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (nftSafetyError || paymentSafetyError || paymentSafetyLoading) return
    // Paying before the first ruleset starts reverts in the terminal.
    if (notStarted) return
    if (!amount || parseFloat(amount) <= 0) return
    const tierSelections = Object.entries(tierQuantities).map(([tierId, quantity]) => {
      const tier = nftTiers.find((candidate) => candidate.tierId === Number(tierId))
      return {
        tierId: Number(tierId),
        quantity,
        name: tier ? getTierDisplayName(tier) : `Tier ${tierId}`,
      }
    })

    // Wallet connection comes before optional balance heuristics. A missing
    // account must open the wallet flow, not be misclassified as a zero balance.
    if (selectedToken !== 'PAY_CREDITS' && !isConnected && !(isManagedMode && managedAddress)) {
      openWalletPanel()
      return
    }

    // Zero-state check: if user has no funds anywhere, show funding options
    const hasPayCredits = (juiceBalance?.balance ?? 0) > 0
    const hasEth = crossChainEth > 0n
    const hasUsdc = crossChainUsdc > 0n
    const hasAnyFunds = hasPayCredits || hasEth || hasUsdc

    if (!hasAnyFunds && !crossChainLoading && crossChainBalancesAvailable) {
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
        selectedTierIds,
        txId,
        submittedAt: new Date().toISOString(),
      })

      window.dispatchEvent(
        new CustomEvent('juice:pay-project', {
          detail: {
            txId,
            projectId: currentProjectId,
            chainId: parseInt(selectedChainId),
            amount,
            token: selectedToken,
            tokenAddress: selectedPaymentOption?.tokenAddress,
            memo,
            action: 'pay',
            tierIds: selectedTierIds,
            tierSelections,
            hookAddress: nftHookAddress,
          },
        })
      )
      return
    }

    // Refresh balances and check if sufficient.
    const freshBalances = await fetchWalletBalances()
    if (!freshBalances) return
    const balanceCheck = checkSufficientBalance(freshBalances)

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
      type: addsToBalance ? 'addToBalance' : 'pay',
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
      selectedTierIds,
      txId,
      submittedAt: new Date().toISOString(),
    })

    window.dispatchEvent(
      new CustomEvent('juice:pay-project', {
        detail: {
          txId,
          projectId: currentProjectId,
          chainId: parseInt(selectedChainId),
          amount,
          token: selectedToken,
          tokenAddress: selectedPaymentOption?.tokenAddress,
          memo,
          action: addsToBalance ? 'addToBalance' : 'pay',
          tierIds: selectedTierIds,
          tierSelections,
          hookAddress: nftHookAddress,
        },
      })
    )
    // Don't clear form here - wait for transaction result
  }

  // Shared pay-UI render helpers used by both return branches below. Defined here
  // (inside the component, like the other render fns) so they close over the same
  // state and handlers.
  const renderTierCarousel = (wrapperClassName: string, scrollPaddingClassName: string) => {
    if (nftTiers.length === 0) return null
    return (
      <div className={wrapperClassName}>
        <div className={`text-xs mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Shop</div>
        <div className={`flex gap-3 overflow-x-auto pt-3 pb-2 ${scrollPaddingClassName}`} style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {nftTiers.slice(0, 12).map((tier) => {
                  const quantity = tierQuantities[tier.tierId] || 0
                  const isSelected = quantity > 0
                  const exceedsSupply = quantity > tier.remainingSupply
                  const currencyRecognized = isSupportedTierCurrency(tier.currency)
                  const tierToken = isEthTierCurrency(tier.currency) ? 'ETH' : 'USDC'
                  const currencySupported = currencyRecognized && paymentTokenOptions.some((option) => option.symbol === tierToken)
                  return (
                    <div
                      key={tier.tierId}
                      title={currencySupported ? undefined : currencyRecognized ? `This project does not accept ${tierToken}` : `Pricing currency not recognized: ${tier.currency}`}
                      className={`relative flex-shrink-0 w-24 border transition-colors ${
                        isSelected
                          ? exceedsSupply
                            ? 'border-orange-500 bg-orange-500/10'
                            : 'border-green-500 bg-green-500/10'
                          : isDark
                          ? 'border-white/10 hover:border-juice-orange'
                          : 'border-gray-200 hover:border-juice-orange'
                      } ${isPaymentLocked || !currencySupported ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                      onClick={() => {
                        if (isPaymentLocked || !currencySupported) return
                        handleTierSelect(tier)
                        window.dispatchEvent(
                          new CustomEvent('juice:open-shop', {
                            detail: { tierId: tier.tierId },
                          })
                        )
                      }}
                    >
                      {/* Quantity badge */}
                      {isSelected && (
                        <div
                          className={`absolute -top-2 -right-2 z-10 min-w-[20px] h-5 px-1 flex items-center justify-center text-xs font-bold rounded-full ${
                            exceedsSupply ? 'bg-orange-500 text-white' : 'bg-green-500 text-white'
                          }`}
                        >
                          {quantity}
                        </div>
                      )}
                      <div className="relative w-full aspect-square overflow-hidden bg-white">
                        <TierPreviewImage tier={tier} hookAddress={nftHookAddress} chainId={parseInt(selectedChainId)} isDark={isDark} size="large" onMetadataLoaded={handleTierMetadataLoaded} />
                        {tierDiscountLabel(tier.discountPercent) && (
                          <span className="absolute bottom-0 left-0 z-10 bg-juice-orange px-1 py-0.5 text-[9px] font-bold text-black">
                            {tierDiscountLabel(tier.discountPercent)}
                          </span>
                        )}
                      </div>
                      <div className="p-1.5 text-left">
                        <div className={`text-[10px] font-medium truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{getTierDisplayName(tier)}</div>
                        <div className={`text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{formatTierPrice(tier)}</div>
                      </div>
                      {/* Quantity controls when selected */}
                      {isSelected && (
                        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-1 py-0.5 bg-black/60" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => adjustTierQuantity(tier.tierId, -1)} className="w-5 h-5 flex items-center justify-center text-white hover:bg-white/20 rounded">
                            −
                          </button>
                          <span className="text-xs text-white font-medium">{quantity}</span>
                          <button onClick={() => adjustTierQuantity(tier.tierId, 1)} className="w-5 h-5 flex items-center justify-center text-white hover:bg-white/20 rounded">
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
                {nftTiers.length > 12 && (
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent('juice:open-shop'))}
                    className={`flex-shrink-0 w-24 flex items-center justify-center text-xs ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    +{nftTiers.length - 12} more
                  </button>
                )}
        </div>
      </div>
    )
  }

  const renderAmountAndPay = (inputContainerBg: string) => (
          <div className="flex gap-2">
            <div className="flex-1">
              <div
                onClick={(e) => {
                  // Focus input when clicking anywhere in the container (except the dropdown button)
                  if (!(e.target as HTMLElement).closest('button')) {
                    amountInputRef.current?.focus()
                  }
                }}
                className={`flex items-center cursor-text border border-green-500 ${inputContainerBg}`}
              >
                <input
                  ref={amountInputRef}
                  type="number"
                  step="0.001"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onFocus={() => {
                    setActionDropdownOpen(false)
                    setChainDropdownOpen(false)
                    setTokenDropdownOpen(false)
                  }}
                  placeholder="0.00"
                  disabled={isPaymentLocked || (nftHookFlags?.preventOverspending && nftTiers.length > 0)}
                  style={{
                    width: `${Math.max(5, (amount || '0.00').toString().length + 2)}ch`,
                  }}
                  className={`min-w-[4ch] pl-3 py-2 text-sm bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                    isDark ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                  } ${isPaymentLocked || (nftHookFlags?.preventOverspending && nftTiers.length > 0) ? 'cursor-not-allowed opacity-60' : ''}`}
                />
                {/* Token selector - inline after input */}
                <div className="relative ml-auto flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!isPaymentLocked) {
                        setTokenDropdownOpen(!tokenDropdownOpen)
                        setActionDropdownOpen(false)
                        setChainDropdownOpen(false)
                      }
                    }}
                    disabled={isPaymentLocked}
                    className={`flex items-center gap-1 py-2 pl-2 pr-3 text-sm font-medium ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'} ${
                      isPaymentLocked ? 'cursor-not-allowed opacity-60' : ''
                    }`}
                  >
                    <span>{selectedPaymentOption?.label ?? selectedToken}</span>
                    <svg className={`w-3 h-3 transition-transform ${tokenDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {tokenDropdownOpen && (
                    <div className={`absolute top-full right-0 mt-1 py-1 shadow-lg z-10 min-w-[140px] ${isDark ? 'bg-juice-dark border border-white/10' : 'bg-white border border-gray-200'}`}>
                      {paymentTokenOptions.map((token) => (
                        <button
                          key={token.symbol}
                          onClick={() => {
                            setSelectedToken(token.symbol as PaymentToken)
                            setTokenDropdownOpen(false)
                          }}
                          className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                            token.symbol === selectedToken
                              ? isDark
                                ? 'bg-white/10 text-white'
                                : 'bg-gray-100 text-gray-900'
                              : isDark
                              ? 'text-gray-300 hover:bg-white/5'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <span className="flex justify-between items-center gap-2">
                            <span>{token.label}</span>
                            {token.symbol === 'PAY_CREDITS' && juiceBalance && <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>${juiceBalance.balance.toFixed(2)}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="relative">
              <button
                onClick={(e) => handlePay(e)}
                disabled={paymentButtonDisabled}
                className={`px-4 py-2 text-sm font-medium transition-colors border border-transparent ${
                  paymentButtonDisabled
                    ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                    : 'bg-green-500 hover:bg-green-600 text-black'
                }`}
              >
                {notStarted
                  ? 'Not started'
                  : paymentSafetyLoading
                  ? 'Checking...'
                  : requiresLivePayPreview && payPreview.status === 'loading'
                  ? 'Quoting...'
                  : paying
                  ? '...'
                  : persistedPayment?.status === 'completed'
                  ? addsToBalance
                    ? 'Added'
                    : 'Paid'
                  : persistedPayment?.status === 'in_progress'
                  ? 'Pending...'
                  : addsToBalance
                  ? 'Add'
                  : 'Pay'}
              </button>
            </div>
          </div>
  )

  const renderMemoAndFeedback = () => (
    <>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Add a memo (optional)"
            disabled={isPaymentLocked}
            className={`w-full mt-1 py-2 text-sm outline-none ${isDark ? 'bg-transparent text-white placeholder-gray-500' : 'bg-transparent text-gray-900 placeholder-gray-400'} ${
              isPaymentLocked ? 'cursor-not-allowed opacity-60' : ''
            }`}
          />

          {renderPayOutcomePreview()}

          {/* Payment progress indicator (the status line) */}
          {(activePayment || (persistedPayment && persistedPayment.status !== 'pending')) && (
            <PaymentProgress
              stage={activePayment?.stage}
              status={activePayment?.status || ((persistedPayment?.status === 'completed' ? 'confirmed' : persistedPayment?.status === 'failed' ? 'failed' : 'submitted') as TransactionStatus)}
              error={activePayment?.error || persistedPayment?.error}
              hash={activePayment?.hash || persistedPayment?.txHash}
              chainId={activePayment?.chainId || parseInt(selectedChainId)}
              isDark={isDark}
              onRetry={() => setActivePaymentId(null)}
            />
          )}
    </>
  )

  const renderFundingPopover = () => (
      showFundingOptions &&
        fundingOptionsAnchor &&
        createPortal(
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-[99]" onClick={() => setShowFundingOptions(false)} />
            {/* Popover */}
            <div
              className={`fixed z-[100] w-80 p-4 border shadow-xl ${isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-200'}`}
              style={{
                top: fundingOptionsAnchor.top - 8,
                left: fundingOptionsAnchor.left,
                transform: 'translate(-50%, -100%)',
              }}
            >
              {/* Close button */}
              <button
                onClick={() => setShowFundingOptions(false)}
                className={`absolute top-3 right-3 p-1 transition-colors ${isDark ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <h3 className={`text-sm font-semibold mb-1 pr-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>How would you like to pay?</h3>
              <p className={`text-xs mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>You don't have any funds yet. Choose how to add some.</p>

              <div className="space-y-2">
                {/* Credit Card option */}
                <button
                  onClick={() => {
                    setShowFundingOptions(false)
                    setShowBuyJuiceModal(true)
                  }}
                  className={`w-full p-3 text-left transition-colors border ${
                    isDark ? 'border-white/20 hover:border-juice-cyan hover:bg-juice-cyan/10' : 'border-gray-200 hover:border-cyan-500 hover:bg-cyan-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Credit Card</div>
                      <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>5% markup · available after verification</div>
                    </div>
                    <svg className={`w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>

                {/* Crypto option */}
                <div className={`w-full p-3 text-left border ${isDark ? 'border-white/20' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>ETH or USDC</div>
                      <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Network fees and confirmation time vary</div>
                    </div>
                  </div>
                  {managedAddress ? (
                    <div className="mt-2">
                      <div className={`text-xs mb-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Send to your wallet on any chain:</div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(managedAddress)
                          setCopiedAddress(true)
                          setTimeout(() => setCopiedAddress(false), 2000)
                        }}
                        className={`w-full p-2 font-mono text-xs text-left transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-gray-300' : 'bg-gray-50 hover:bg-gray-100 text-gray-600'}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">{managedAddress}</span>
                          <span className={`ml-2 text-xs ${copiedAddress ? 'text-green-500' : isDark ? 'text-gray-500' : 'text-gray-400'}`}>{copiedAddress ? '✓' : 'Copy'}</span>
                        </div>
                      </button>
                      <div className={`text-xs mt-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Works on Ethereum, Base, Optimism, Arbitrum</div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setShowFundingOptions(false)
                        openWalletPanel()
                      }}
                      className={`w-full mt-2 p-2 text-xs font-medium transition-colors border ${
                        isDark ? 'border-juice-cyan text-juice-cyan hover:bg-juice-cyan/10' : 'border-cyan-600 text-cyan-600 hover:bg-cyan-50'
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
        )
  )

  const buyJuiceModal = (
    <BuyJuiceModal
      isOpen={showBuyJuiceModal}
      onClose={() => setShowBuyJuiceModal(false)}
      onSuccess={() => {
        refetchJuiceBalance()
        setShowBuyJuiceModal(false)
      }}
    />
  )

  // Embedded mode renders a sticky header + scrollable content for the sidebar;
  // non-embedded mode renders the standard card. The Buy Pay Credits modal is a
  // portal shared by both branches, rendered once outside the branch split.
  return (
    <>
      {embedded ? (
        <>
        {/* Single scrollable container */}
        <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {!chainMappingAvailable && (
            <div className="mx-4 mt-3">
              <ChainMappingWarning isDark={isDark} />
            </div>
          )}
          {/* Starts-in countdown sits at the top of the card, above everything else. */}
          {notStarted && <div className={`px-4 pt-3 ${isDark ? 'bg-[#222]' : 'bg-gray-50'}`}>{renderCountdownBanner()}</div>}
          {/* Intro explainer for this pay flavor */}
          <div className={`px-4 pt-3 ${isDark ? 'bg-[#222]' : 'bg-gray-50'}`}>{renderPayExplainer()}</div>
          {renderTierCarousel(`px-4 pt-3 ${isDark ? 'bg-[#222]' : 'bg-gray-50'}`, '-mx-4 px-4')}

          {/* Sticky pay controls - sticks to top when scrolling */}
          <div className={`sticky top-0 z-20 px-4 ${nftTiers.length > 0 ? 'py-3' : 'pt-4 pb-3'} ${isDark ? 'bg-[#222]' : 'bg-gray-50/80 backdrop-blur-sm'}`}>
            {renderPaymentModeAndChainSelector()}
            {renderAmountAndPay(isDark ? 'bg-[#222]' : 'bg-gray-50')}
          </div>

          {/* Content below sticky with lighter background.
              Website pay-card order: memo → feedback → status line → terminal warning. */}
          <div className={`flow-root ${isDark ? 'bg-[#222]' : 'bg-gray-50'}`}>
            <div className="px-4">
              {renderPayCaveat()}

              {renderMemoAndFeedback()}

              {renderSafetyNotices()}
              <div className="pb-10" />
            </div>
          </div>

          {/* Activity section header */}
          <div className={`px-4 pt-3 pb-2 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <span className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Activity</span>
          </div>

          {/* Children (Activity feed) */}
          {children}
        </div>

          {renderFundingPopover()}
        </>
      ) : (
      <div className="w-full">
      {/* Card with border - constrained width */}
      <div className={`max-w-md border p-4 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`}>
        {/* Starts-in countdown sits at the very top of the card. */}
        {renderCountdownBanner()}
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          {project.logoUri ? (
            <IpfsImage
              uri={project.logoUri}
              alt={project.name}
              className="w-14 h-14 object-cover"
              fallback={
                <div className="w-14 h-14 bg-juice-orange/20 flex items-center justify-center">
                  <span className="text-juice-orange font-bold text-xl">{project.name.charAt(0).toUpperCase()}</span>
                </div>
              }
            />
          ) : (
            <div className="w-14 h-14 bg-juice-orange/20 flex items-center justify-center">
              <span className="text-juice-orange font-bold text-xl">{project.name.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{project.name}</h3>
            <ProjectLink
              chainSlug={selectedChainInfo.slug}
              projectId={currentProjectId}
              className={`text-xs hover:underline ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
            >
              Project #{currentProjectId}
            </ProjectLink>
          </div>
        </div>

        {/* Tagline */}
        {(fullMetadata?.tagline || fullMetadata?.projectTagline) && (
          <p className={`text-sm italic mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{fullMetadata.tagline || fullMetadata.projectTagline}</p>
        )}

        {/* Stats */}
        <div className="flex gap-6 mb-3 text-sm">
          <div className="relative" onMouseEnter={() => setShowBalanceTooltip(true)} onMouseLeave={() => setShowBalanceTooltip(false)} onClick={() => setShowBalanceTooltip((prev) => !prev)}>
            <span className={`font-mono cursor-pointer ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {balanceHeadline}
            </span>
            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{balanceScope}</span>

            {/* Per-chain / per-token breakdown tooltip */}
            {showBalanceTooltip && showBalanceTooltipContent && (
              <div className={`absolute top-full left-0 mt-1 p-2 shadow-lg z-20 min-w-[180px] text-xs ${isDark ? 'bg-juice-dark border border-white/20' : 'bg-white border border-gray-200'}`}>
                {balanceTooltipRows.map((row) => (
                  <div key={row.key} className="flex justify-between gap-4 py-0.5">
                    <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{row.label}</span>
                    <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>{row.value}</span>
                  </div>
                ))}
                <div className={`flex justify-between gap-4 pt-1 mt-1 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                  <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Total</span>
                  <span className={`font-mono font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {balanceHeadline}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div>
            <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>{ownersCount ?? 'Unavailable'}</span>
            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}> owner{ownersCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="relative" onMouseEnter={() => setShowPaymentsTooltip(true)} onMouseLeave={() => setShowPaymentsTooltip(false)}>
            <span className={`font-mono cursor-help ${isDark ? 'text-white' : 'text-gray-900'}`}>{paymentsAvailable ? suckerBalance.totalPaymentsCount : 'Unavailable'}</span>
            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
              {' '}
              payment
              {!paymentsAvailable || suckerBalance.totalPaymentsCount !== 1 ? 's' : ''}
            </span>

            {/* Per-chain payments breakdown tooltip */}
            {showPaymentsTooltip && paymentsAvailable && suckerBalance.projectBalances.length > 0 && (
              <div className={`absolute top-full left-0 mt-1 p-2 shadow-lg z-20 min-w-[140px] text-xs ${isDark ? 'bg-juice-dark border border-white/20' : 'bg-white border border-gray-200'}`}>
                {suckerBalance.projectBalances.map((pb) => {
                  const chainInfo = CHAIN_INFO[pb.chainId.toString()]
                  if (!chainInfo) return null
                  return (
                    <div key={pb.chainId} className="flex justify-between gap-4 py-0.5">
                      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{chainInfo.name}</span>
                      <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>{pb.paymentsCount}</span>
                    </div>
                  )
                })}
                <div className={`flex justify-between gap-4 pt-1 mt-1 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                  <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>[All chains]</span>
                  <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>{suckerBalance.totalPaymentsCount}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Pay form — website pay-card order: shop strip → countdown → mode/chain →
            amount/currency/Pay → memo → feedback → status → terminal warnings. */}
        <div className={`mb-3 px-3 pb-3 ${nftTiers.length > 0 ? 'pt-3' : 'pt-4'} ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}
          {renderPayExplainer()}
          {renderTierCarousel('mb-3', '-mx-3 px-3')}

          {renderPaymentModeAndChainSelector()}

          {renderAmountAndPay(isDark ? 'bg-juice-dark' : 'bg-white')}

          {renderPayCaveat()}

          {renderMemoAndFeedback()}

          {renderSafetyNotices()}
        </div>
      </div>

      {renderFundingPopover()}
      </div>
      )}
      {buyJuiceModal}
    </>
  )
}
