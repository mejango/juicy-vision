import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAccount } from 'wagmi'
import { createPortal } from 'react-dom'
import { useThemeStore, useChatStore } from '../stores'
import { useManagedWallet, useIsMobile } from '../hooks'
import { CHAINS } from '../constants'
import { fetchProject, fetchProjectWithRuleset, fetchConnectedChains, fetchSuckerGroupBalance, isRevnet, fetchRevnetOperator, fetchEthPrice, type Project, type ConnectedChain, type SuckerGroupBalance } from '../services/bendystraw'
import { resolveEnsName, truncateAddress } from '../utils/ens'
import { getProjectSupporters, type ProjectConversation } from '../api/projectConversations'
import { getWalletSession } from '../services/siwe'
import { resolveIpfsUri } from '../utils/ipfs'
import { formatUnits } from 'viem'

// Chat components
import { ChatInput, ProtocolActivity } from '../components/chat'

// Dynamic components
import BalanceChart from '../components/dynamic/charts/BalanceChart'
import VolumeChart from '../components/dynamic/charts/VolumeChart'
import HoldersChart from '../components/dynamic/charts/HoldersChart'
import PriceChart from '../components/dynamic/PriceChart'
import ActivityFeed from '../components/dynamic/ActivityFeed'
import ProjectCard from '../components/dynamic/ProjectCard'
import RulesetSchedule from '../components/dynamic/RulesetSchedule'
import FundsSection from '../components/dynamic/FundsSection'
import TokensTab from '../components/dynamic/TokensTab'
import ShopTab from '../components/dynamic/ShopTab'
import ProjectSummary from '../components/dynamic/ProjectSummary'
import { hasNFTHook } from '../services/nft'

// Payment modals
import CashOutModal from '../components/payment/CashOutModal'
import SendPayoutsModal from '../components/payment/SendPayoutsModal'
// Note: QueueRulesetForm is used for ruleset changes - it has its own modal internally
import QueueRulesetForm from '../components/dynamic/QueueRulesetForm'

type DashboardTab = 'about' | 'analytics' | 'rulesets' | 'funds' | 'tokens' | 'shop'
type ModalType = 'pay' | 'cashout' | 'payouts' | 'ruleset' | null

interface ProjectDashboardProps {
  chainId: number
  projectId: number
}

function formatBalanceUsd(
  balanceString: string,
  ethPrice: number | null,
  currency: number = 1, // 1 = ETH, 2 = USD
  decimals: number = 18
): string {
  try {
    const balance = BigInt(balanceString)
    const value = parseFloat(formatUnits(balance, decimals))

    let usd: number
    if (currency === 2) {
      // Balance is already in USD (USDC project)
      usd = value
    } else {
      // Balance is in ETH, convert to USD
      if (!ethPrice) return '$--'
      usd = value * ethPrice
    }

    if (usd === 0) return '$0'
    if (usd < 0.01) return '<$0.01'
    if (usd >= 1000000) return `$${(usd / 1000000).toFixed(2)}M`
    if (usd >= 1000) return `$${(usd / 1000).toFixed(2)}K`
    return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  } catch {
    return '$0'
  }
}

// Format balance in native currency (ETH or USDC)
function formatBalanceNative(
  balanceString: string,
  currency: number = 1, // 1 = ETH, 2 = USD/USDC
  decimals: number = 18
): string {
  try {
    const balance = BigInt(balanceString)
    const value = parseFloat(formatUnits(balance, decimals))

    if (currency === 2) {
      // USDC - show as dollar amount
      if (value === 0) return '$0'
      if (value < 0.01) return '<$0.01'
      if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`
      if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    } else {
      // ETH - show as ETH amount
      if (value === 0) return '0 ETH'
      if (value < 0.001) return '<0.001 ETH'
      if (value >= 1000) return `${(value / 1000).toFixed(2)}K ETH`
      return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ETH`
    }
  } catch {
    return currency === 2 ? '$0' : '0 ETH'
  }
}

// Chain info for balance tooltip
const CHAIN_DISPLAY: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  8453: 'Base',
  42161: 'Arbitrum',
}

function formatTimeAgo(timestamp: string): string {
  const now = Date.now()
  const time = new Date(timestamp).getTime()
  const diff = now - time
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Strip HTML tags from description for plain text display
function stripHtmlTags(html: string): string {
  // Replace <br>, <br/>, </p> with newlines for proper line breaks
  const withLineBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
  // Remove all remaining HTML tags
  const text = withLineBreaks.replace(/<[^>]*>/g, '')
  // Clean up multiple newlines and trim
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

export default function ProjectDashboard({ chainId, projectId }: ProjectDashboardProps) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const isDark = theme === 'dark'

  // Initialize tab from URL hash (e.g., #shop, #tokens)
  const getInitialTab = (): DashboardTab => {
    const hash = window.location.hash.slice(1) // Remove #
    const validTabs: DashboardTab[] = ['about', 'analytics', 'rulesets', 'funds', 'tokens', 'shop']
    return validTabs.includes(hash as DashboardTab) ? (hash as DashboardTab) : 'about'
  }

  const [activeTab, setActiveTabState] = useState<DashboardTab>(getInitialTab)

  // Wrapper to update both state and URL hash
  const setActiveTab = useCallback((tab: DashboardTab) => {
    setActiveTabState(tab)
    window.history.replaceState(null, '', `#${tab}`)
  }, [])

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1)
      const validTabs: DashboardTab[] = ['about', 'analytics', 'rulesets', 'funds', 'tokens', 'shop']
      if (validTabs.includes(hash as DashboardTab)) {
        setActiveTabState(hash as DashboardTab)
      }
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // Listen for open-shop event from ProjectCard
  useEffect(() => {
    const handleOpenShop = () => {
      setActiveTab('shop')
    }
    window.addEventListener('juice:open-shop', handleOpenShop)
    return () => window.removeEventListener('juice:open-shop', handleOpenShop)
  }, [setActiveTab])

  const [project, setProject] = useState<Project | null>(null)
  const [projectLoading, setProjectLoading] = useState(true)
  const [supporters, setSupporters] = useState<ProjectConversation[]>([])
  const [supportersLoading, setSupportersLoading] = useState(false)
  const [supportersLoaded, setSupportersLoaded] = useState(false)
  const [supportersTotal, setSupportersTotal] = useState(0)
  const [connectedChains, setConnectedChains] = useState<ConnectedChain[]>([])
  const [suckerGroupBalance, setSuckerGroupBalance] = useState<SuckerGroupBalance | null>(null)
  const [revnetOperator, setRevnetOperator] = useState<string | null>(null)
  const [displayAddressEns, setDisplayAddressEns] = useState<string | null>(null)
  const [hasNftHook, setHasNftHook] = useState(false)
  const [ethPrice, setEthPrice] = useState<number | null>(null)

  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null)

  // Balance tooltip state
  const [showBalanceTooltip, setShowBalanceTooltip] = useState(false)

  const chain = CHAINS[chainId]

  // Get current user's address from wallet connections
  const { address: wagmiAddress } = useAccount()
  const { address: managedAddress } = useManagedWallet()
  const walletSession = getWalletSession()

  // Current user address: SIWE session > managed wallet > wagmi
  const currentUserAddress = useMemo(() => {
    return walletSession?.address || managedAddress || wagmiAddress
  }, [walletSession?.address, managedAddress, wagmiAddress])

  // Check if current user is the project owner
  const isOwner = useMemo(() => {
    if (!currentUserAddress || !project?.owner) return false
    return currentUserAddress.toLowerCase() === project.owner.toLowerCase()
  }, [currentUserAddress, project?.owner])

  // Use aggregated sucker group balance when available (for omnichain projects)
  const displayBalance = useMemo(() => {
    if (suckerGroupBalance && suckerGroupBalance.totalBalance !== '0') {
      return suckerGroupBalance.totalBalance
    }
    return project?.balance || '0'
  }, [suckerGroupBalance, project?.balance])

  const displayPaymentsCount = useMemo(() => {
    if (suckerGroupBalance && suckerGroupBalance.totalPaymentsCount > 0) {
      return suckerGroupBalance.totalPaymentsCount
    }
    return project?.paymentsCount || 0
  }, [suckerGroupBalance, project?.paymentsCount])

  // Use aggregated volume from sucker group when available (for omnichain projects)
  const displayVolume = useMemo(() => {
    if (suckerGroupBalance && suckerGroupBalance.totalVolume !== '0') {
      return suckerGroupBalance.totalVolume
    }
    return project?.volume || '0'
  }, [suckerGroupBalance, project?.volume])

  // Load project data
  useEffect(() => {
    async function loadProject() {
      setProjectLoading(true)
      try {
        const [data, chains, groupBalance, nftHook, price] = await Promise.all([
          fetchProject(String(projectId), chainId),
          fetchConnectedChains(String(projectId), chainId),
          fetchSuckerGroupBalance(String(projectId), chainId),
          hasNFTHook(String(projectId), chainId),
          fetchEthPrice(),
        ])
        setProject(data)
        setConnectedChains(chains)
        setSuckerGroupBalance(groupBalance)
        setHasNftHook(nftHook)
        setEthPrice(price)
      } catch (error) {
        console.error('Failed to load project:', error)
      } finally {
        setProjectLoading(false)
      }
    }
    loadProject()
  }, [projectId, chainId])

  // Determine if revnet and fetch operator, then resolve ENS
  const projectIsRevnet = useMemo(() => {
    return project?.owner ? isRevnet(project.owner) : false
  }, [project?.owner])

  // The address to display: operator for revnets, owner otherwise
  const displayAddress = useMemo(() => {
    if (projectIsRevnet && revnetOperator) {
      return revnetOperator
    }
    return project?.owner || null
  }, [projectIsRevnet, revnetOperator, project?.owner])

  // Fetch revnet operator and resolve ENS for display address
  useEffect(() => {
    async function loadDisplayInfo() {
      if (!project?.owner) return

      // If revnet, fetch the operator
      if (projectIsRevnet) {
        const operator = await fetchRevnetOperator(String(projectId), chainId)
        setRevnetOperator(operator)
        // Resolve ENS for operator (or owner if no operator)
        const addressToResolve = operator || project.owner
        const ensName = await resolveEnsName(addressToResolve)
        setDisplayAddressEns(ensName)
      } else {
        // Resolve ENS for owner
        const ensName = await resolveEnsName(project.owner)
        setDisplayAddressEns(ensName)
      }
    }
    loadDisplayInfo()
  }, [project?.owner, projectIsRevnet, projectId, chainId])

  // Load supporters when payments tab is active (kept for compatibility)
  const loadSupporters = useCallback(async () => {
    if (supportersLoading || supportersLoaded) return
    setSupportersLoading(true)
    try {
      const result = await getProjectSupporters(projectId, chainId)
      setSupporters(result.supporters)
      setSupportersTotal(result.total)
      setSupportersLoaded(true)
    } catch (error) {
      console.error('Failed to load supporters:', error)
    } finally {
      setSupportersLoading(false)
    }
  }, [projectId, chainId, supportersLoading, supportersLoaded])

  const handleSupporterClick = (chatId: string) => {
    // Only owners can access supporter chats
    if (!isOwner) return
    navigate(`/chat/${chatId}`)
  }

  const handleBackClick = () => {
    navigate('/')
  }

  // Handle chat dock send - create new chat with project context
  const handleChatSend = (message: string) => {
    const projectName = project?.name || `Project #${projectId}`
    const contextMessage = `[Re: ${projectName} on ${chain?.name || 'Unknown'}] ${message}`

    // Queue the message in the store so ChatContainer can pick it up on mount
    useChatStore.getState().setActiveChat(null)
    useChatStore.getState().setQueuedNewChatMessage(contextMessage)
    navigate('/') // Go to home where ChatContainer will process the queued message
  }

  // Handle activity project click
  const handleActivityProjectClick = (query: string) => {
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message: query, newChat: true }
    }))
    navigate('/')
  }

  // Tab configuration - dynamic based on project features
  // Must be called before early returns to satisfy React hooks rules
  const tabs: Array<{ id: DashboardTab; label: string }> = useMemo(() => {
    const baseTabs: Array<{ id: DashboardTab; label: string }> = [
      { id: 'about', label: 'About' },
      { id: 'analytics', label: 'Analytics' },
      { id: 'rulesets', label: 'Rulesets' },
      { id: 'funds', label: 'Funds' },
      { id: 'tokens', label: 'Tokens' },
    ]
    if (hasNftHook) {
      baseTabs.push({ id: 'shop', label: 'Shop' })
    }
    return baseTabs
  }, [hasNftHook])

  if (projectLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        isDark ? 'bg-juice-dark' : 'bg-white'
      }`}>
        <div className="w-8 h-8 border-2 border-juice-orange border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        isDark ? 'bg-juice-dark text-white' : 'bg-white text-gray-900'
      }`}>
        <div className="text-center max-w-md px-4">
          <h1 className="text-xl font-semibold mb-2">{t('project.notFound', 'Project not found')}</h1>
          <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {t('project.notFoundDesc', 'This project may not exist or the chain/ID is invalid.')}
          </p>
          <button
            onClick={handleBackClick}
            className="px-6 py-2 bg-juice-orange text-juice-dark font-medium hover:bg-juice-orange/90 transition-colors"
          >
            {t('ui.goHome', 'Go home')}
          </button>
        </div>
      </div>
    )
  }

  // Desktop layout with two-column structure
  if (!isMobile) {
    return (
      <div className={`h-screen flex overflow-hidden ${isDark ? 'bg-juice-dark' : 'bg-white'}`}>
        {/* Left border */}
        <div className="w-[4px] bg-juice-orange shrink-0" />

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top border */}
          <div className="h-[4px] bg-juice-orange shrink-0" />

          {/* Header - sticky */}
          <div className={`shrink-0 backdrop-blur-sm border-b ${
            isDark ? 'bg-juice-dark/80 border-white/10' : 'bg-white/80 border-gray-200'
          }`}>
            <div className="px-6 py-4">
              <button
                onClick={handleBackClick}
                className={`flex items-center gap-2 text-sm mb-4 transition-colors ${
                  isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                {t('ui.back', 'Back')}
              </button>

              {/* Project header */}
              <div className="flex items-start gap-4">
                {/* Square logo */}
                {project.logoUri ? (
                  <img
                    src={resolveIpfsUri(project.logoUri) || undefined}
                    alt=""
                    className="w-16 h-16 object-cover"
                  />
                ) : (
                  <div className={`w-16 h-16 flex items-center justify-center text-2xl ${
                    isDark ? 'bg-white/10' : 'bg-gray-200'
                  }`}>
                    🍊
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {/* Title row with chain badge */}
                  <div className="flex items-center gap-2">
                    <h1 className={`text-xl font-semibold truncate ${
                      isDark ? 'text-white' : 'text-gray-900'
                    }`}>
                      {project.name || `Project #${projectId}`}
                    </h1>
                    {chain && (
                      <span
                        className="px-2 py-0.5 text-xs font-medium rounded-full shrink-0"
                        style={{ backgroundColor: chain.color + '20', color: chain.color }}
                      >
                        {chain.shortName}
                      </span>
                    )}
                  </div>
                  {/* Stats row */}
                  <div className={`flex items-center gap-4 mt-1 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    <div
                      className="relative"
                      onMouseEnter={() => setShowBalanceTooltip(true)}
                      onMouseLeave={() => setShowBalanceTooltip(false)}
                      onClick={() => setShowBalanceTooltip(prev => !prev)}
                    >
                      <span className={`font-semibold cursor-pointer ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {formatBalanceUsd(displayBalance, ethPrice, suckerGroupBalance?.currency, suckerGroupBalance?.decimals)} balance
                      </span>
                      {/* Per-chain balance breakdown tooltip */}
                      {showBalanceTooltip && suckerGroupBalance && suckerGroupBalance.projectBalances.length > 1 && (
                        <div className={`absolute top-full left-0 mt-1 p-2 shadow-lg z-20 min-w-[200px] text-xs ${
                          isDark ? 'bg-juice-dark border border-white/20' : 'bg-white border border-gray-200'
                        }`}>
                          {suckerGroupBalance.projectBalances.map(pb => {
                            const chainName = CHAIN_DISPLAY[pb.chainId] || `Chain ${pb.chainId}`
                            const pbCurrency = pb.currency ?? suckerGroupBalance.currency
                            const pbDecimals = pb.decimals ?? suckerGroupBalance.decimals
                            return (
                              <div key={pb.chainId} className="flex justify-between gap-4 py-0.5">
                                <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{chainName}</span>
                                <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                                  {formatBalanceNative(pb.balance, pbCurrency, pbDecimals)}
                                </span>
                              </div>
                            )
                          })}
                          <div className={`flex justify-between gap-4 pt-1 mt-1 border-t ${
                            isDark ? 'border-white/10' : 'border-gray-100'
                          }`}>
                            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Total</span>
                            <span className={`font-mono font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                              {formatBalanceNative(displayBalance, suckerGroupBalance?.currency, suckerGroupBalance?.decimals)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                    <span>
                      <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {displayPaymentsCount.toLocaleString()}
                      </span>
                      {' '}payments
                    </span>
                  </div>
                  {/* Operator (for revnets) or Owner address */}
                  {displayAddress && (
                    <div className={`flex items-center gap-1.5 mt-1.5 text-xs ${
                      isDark ? 'text-gray-500' : 'text-gray-400'
                    }`}>
                      <span>{projectIsRevnet ? t('project.operator', 'Operator') : t('project.owner', 'Owner')}:</span>
                      <a
                        href={chain ? `${chain.explorer}/address/${displayAddress}` : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`hover:underline ${
                          isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                        } ${!displayAddressEns ? 'font-mono' : ''}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {displayAddressEns || truncateAddress(displayAddress)}
                      </a>
                      {isOwner && (
                        <span className="px-1.5 py-0.5 bg-green-500/20 text-green-500 rounded text-[10px] font-medium">
                          {t('project.you', 'You')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Two-column layout */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Pay/Activity sidebar - scrolls together */}
            <div className={`w-[380px] shrink-0 border-r overflow-y-auto ${
              isDark ? 'border-white/10' : 'border-gray-200'
            }`}>
              {/* Pay/Cash out panel - sticky at top */}
              <div className={`sticky top-0 z-10 border-b ${isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'}`}>
                <ProjectCard
                  projectId={String(projectId)}
                  chainId={String(chainId)}
                  embedded
                />
              </div>

              {/* Activity Feed */}
              <div className={`px-4 pt-4 pb-2 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                <span className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Activity
                </span>
              </div>
              <ActivityFeed
                projectId={String(projectId)}
                chainId={String(chainId)}
                limit={15}
                compact
              />
            </div>

            {/* Right: Main content (scrollable) */}
            <div className="flex-1 overflow-y-auto">
              {/* Tab navigation */}
              <div className={`sticky top-0 z-10 px-6 pt-4 pb-0 ${
                isDark ? 'bg-juice-dark' : 'bg-white'
              }`}>
                <div className={`flex gap-6 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                        activeTab === tab.id
                          ? 'border-juice-orange text-juice-orange'
                          : isDark
                            ? 'border-transparent text-gray-400 hover:text-gray-200'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-6 py-6 space-y-6">
                {/* About Tab */}
                {activeTab === 'about' && (
                  <>
                    {project.description ? (
                      <p className={`text-sm whitespace-pre-line ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        {stripHtmlTags(project.description)}
                      </p>
                    ) : (
                      <p className={`text-sm italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        No description available.
                      </p>
                    )}

                    {/* Juicy Summary */}
                    <ProjectSummary
                      projectName={project.name}
                      balance={displayBalance}
                      volume={displayVolume}
                      paymentsCount={displayPaymentsCount}
                      createdAt={project.createdAt}
                      isRevnet={projectIsRevnet}
                      hasNftHook={hasNftHook}
                      connectedChainsCount={connectedChains.length}
                      ethPrice={ethPrice}
                    />
                  </>
                )}

                {/* Analytics Tab */}
                {activeTab === 'analytics' && (
                  <div className="space-y-6">
                    <VolumeChart projectId={String(projectId)} chainId={String(chainId)} />
                    <HoldersChart projectId={String(projectId)} chainId={String(chainId)} />
                    <BalanceChart projectId={String(projectId)} chainId={String(chainId)} />
                    <PriceChart projectId={String(projectId)} chainId={String(chainId)} />
                  </div>
                )}

                {/* Rulesets Tab */}
                {activeTab === 'rulesets' && (
                  <RulesetSchedule projectId={String(projectId)} chainId={String(chainId)} />
                )}

                {/* Funds Tab */}
                {activeTab === 'funds' && (
                  <FundsSection
                    projectId={String(projectId)}
                    chainId={String(chainId)}
                    isOwner={isOwner}
                    onSendPayouts={() => setActiveModal('payouts')}
                    isRevnet={projectIsRevnet}
                  />
                )}

                {/* Tokens Tab */}
                {activeTab === 'tokens' && (
                  <TokensTab
                    projectId={String(projectId)}
                    chainId={String(chainId)}
                    isOwner={isOwner}
                  />
                )}

                {/* Shop Tab */}
                {activeTab === 'shop' && (
                  <ShopTab
                    projectId={String(projectId)}
                    chainId={String(chainId)}
                    isOwner={isOwner}
                    connectedChains={connectedChains.map(c => ({ chainId: c.chainId, projectId: c.projectId }))}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Chat dock - fixed at bottom */}
          <div className={`shrink-0 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <ChatInput
              onSend={handleChatSend}
              placeholder={`Ask about ${project.name || 'this project'}...`}
              compact
              hideWalletInfo
            />
          </div>

          {/* Bottom border */}
          <div className="h-[4px] bg-juice-orange shrink-0" />
        </div>

        {/* Modals */}
        {activeModal === 'payouts' && (
          <SendPayoutsModal
            isOpen
            onClose={() => setActiveModal(null)}
            projectId={String(projectId)}
            projectName={project.name}
            chainId={chainId}
            amount="0"
            allChainProjects={connectedChains.map(c => ({ chainId: c.chainId, projectId: c.projectId }))}
          />
        )}

        {activeModal === 'ruleset' && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setActiveModal(null)}
            />
            <div className={`relative w-full max-w-2xl max-h-[90vh] overflow-y-auto p-4 ${
              isDark ? 'bg-juice-dark border border-white/10' : 'bg-white border border-gray-200'
            }`}>
              <button
                onClick={() => setActiveModal(null)}
                className={`absolute top-4 right-4 z-10 p-2 transition-colors ${
                  isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <QueueRulesetForm projectId={String(projectId)} chainId={String(chainId)} />
            </div>
          </div>,
          document.body
        )}
      </div>
    )
  }

  // Mobile layout - stacked, no sidebar
  return (
    <div className={`min-h-screen flex flex-col ${isDark ? 'bg-juice-dark' : 'bg-white'}`}>
      {/* Header with back button */}
      <div className={`sticky top-0 z-40 backdrop-blur-sm border-b ${
        isDark ? 'bg-juice-dark/80 border-white/10' : 'bg-white/80 border-gray-200'
      }`}>
        <div className="px-4 py-4">
          <button
            onClick={handleBackClick}
            className={`flex items-center gap-2 text-sm mb-4 transition-colors ${
              isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {t('ui.back', 'Back')}
          </button>

          {/* Project header */}
          <div className="flex items-start gap-3">
            {/* Square logo */}
            {project.logoUri ? (
              <img
                src={resolveIpfsUri(project.logoUri) || undefined}
                alt=""
                className="w-14 h-14 object-cover"
              />
            ) : (
              <div className={`w-14 h-14 flex items-center justify-center text-xl ${
                isDark ? 'bg-white/10' : 'bg-gray-200'
              }`}>
                🍊
              </div>
            )}
            <div className="flex-1 min-w-0">
              {/* Title row with chain badge */}
              <div className="flex items-center gap-2">
                <h1 className={`text-lg font-semibold truncate ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}>
                  {project.name || `Project #${projectId}`}
                </h1>
                {chain && (
                  <span
                    className="px-2 py-0.5 text-xs font-medium rounded-full shrink-0"
                    style={{ backgroundColor: chain.color + '20', color: chain.color }}
                  >
                    {chain.shortName}
                  </span>
                )}
              </div>
              {/* Stats row */}
              <div className={`flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                <div
                  className="relative"
                  onMouseEnter={() => setShowBalanceTooltip(true)}
                  onMouseLeave={() => setShowBalanceTooltip(false)}
                  onClick={() => setShowBalanceTooltip(prev => !prev)}
                >
                  <span className={`font-semibold cursor-pointer ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {formatBalanceUsd(displayBalance, ethPrice, suckerGroupBalance?.currency, suckerGroupBalance?.decimals)} balance
                  </span>
                  {/* Per-chain balance breakdown tooltip */}
                  {showBalanceTooltip && suckerGroupBalance && suckerGroupBalance.projectBalances.length > 1 && (
                    <div className={`absolute top-full left-0 mt-1 p-2 shadow-lg z-20 min-w-[200px] text-xs ${
                      isDark ? 'bg-juice-dark border border-white/20' : 'bg-white border border-gray-200'
                    }`}>
                      {suckerGroupBalance.projectBalances.map(pb => {
                        const chainName = CHAIN_DISPLAY[pb.chainId] || `Chain ${pb.chainId}`
                        const pbCurrency = pb.currency ?? suckerGroupBalance.currency
                        const pbDecimals = pb.decimals ?? suckerGroupBalance.decimals
                        return (
                          <div key={pb.chainId} className="flex justify-between gap-4 py-0.5">
                            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>{chainName}</span>
                            <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                              {formatBalanceNative(pb.balance, pbCurrency, pbDecimals)}
                            </span>
                          </div>
                        )
                      })}
                      <div className={`flex justify-between gap-4 pt-1 mt-1 border-t ${
                        isDark ? 'border-white/10' : 'border-gray-100'
                      }`}>
                        <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Total</span>
                        <span className={`font-mono font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                          {formatBalanceNative(displayBalance, suckerGroupBalance?.currency, suckerGroupBalance?.decimals)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <span>
                  <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {displayPaymentsCount.toLocaleString()}
                  </span>
                  {' '}payments
                </span>
              </div>
              {/* Operator/Owner address */}
              {displayAddress && (
                <div className={`flex items-center gap-1.5 mt-1.5 text-xs ${
                  isDark ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  <span>{projectIsRevnet ? t('project.operator', 'Operator') : t('project.owner', 'Owner')}:</span>
                  <a
                    href={chain ? `${chain.explorer}/address/${displayAddress}` : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`hover:underline ${
                      isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                    } ${!displayAddressEns ? 'font-mono' : ''}`}
                  >
                    {displayAddressEns || truncateAddress(displayAddress)}
                  </a>
                  {isOwner && (
                    <span className="px-1.5 py-0.5 bg-green-500/20 text-green-500 rounded text-[10px] font-medium">
                      {t('project.you', 'You')}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="px-4 overflow-x-auto">
          <div className={`flex gap-4 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? 'border-juice-orange text-juice-orange'
                    : isDark
                      ? 'border-transparent text-gray-400 hover:text-gray-200'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {/* About tab */}
        {activeTab === 'about' && (
          <>
            {project.description ? (
              <p className={`text-sm whitespace-pre-line ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                {stripHtmlTags(project.description)}
              </p>
            ) : (
              <p className={`text-sm italic ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                No description available.
              </p>
            )}

            {/* Juicy Summary */}
            <ProjectSummary
              projectName={project.name}
              balance={displayBalance}
              volume={displayVolume}
              paymentsCount={displayPaymentsCount}
              createdAt={project.createdAt}
              isRevnet={projectIsRevnet}
              hasNftHook={hasNftHook}
              connectedChainsCount={connectedChains.length}
              ethPrice={ethPrice}
            />

            {/* Pay button on mobile About tab */}
            <div className={`p-4 border ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
              <ProjectCard
                projectId={String(projectId)}
                chainId={String(chainId)}
                embedded
              />
            </div>
          </>
        )}

        {/* Analytics tab */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <VolumeChart projectId={String(projectId)} chainId={String(chainId)} />
            <HoldersChart projectId={String(projectId)} chainId={String(chainId)} />
            <BalanceChart projectId={String(projectId)} chainId={String(chainId)} />
            <PriceChart projectId={String(projectId)} chainId={String(chainId)} />
          </div>
        )}

        {/* Rulesets tab */}
        {activeTab === 'rulesets' && (
          <RulesetSchedule projectId={String(projectId)} chainId={String(chainId)} />
        )}

        {/* Funds tab */}
        {activeTab === 'funds' && (
          <FundsSection
            projectId={String(projectId)}
            chainId={String(chainId)}
            isOwner={isOwner}
            onSendPayouts={() => setActiveModal('payouts')}
            isRevnet={projectIsRevnet}
          />
        )}

        {/* Tokens tab */}
        {activeTab === 'tokens' && (
          <TokensTab
            projectId={String(projectId)}
            chainId={String(chainId)}
            isOwner={isOwner}
          />
        )}

        {/* Shop tab */}
        {activeTab === 'shop' && (
          <ShopTab
            projectId={String(projectId)}
            chainId={String(chainId)}
            isOwner={isOwner}
            connectedChains={connectedChains.map(c => ({ chainId: c.chainId, projectId: c.projectId }))}
          />
        )}
      </div>

      {/* Chat dock - mobile */}
      <div className={`shrink-0 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <ChatInput
          onSend={handleChatSend}
          placeholder={`Ask about ${project.name || 'this project'}...`}
          compact
          hideWalletInfo
        />
      </div>

      {/* Mobile modals */}
      {activeModal === 'payouts' && (
        <SendPayoutsModal
          isOpen
          onClose={() => setActiveModal(null)}
          projectId={String(projectId)}
          projectName={project.name}
          chainId={chainId}
          amount="0"
          allChainProjects={connectedChains.map(c => ({ chainId: c.chainId, projectId: c.projectId }))}
        />
      )}

      {activeModal === 'ruleset' && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setActiveModal(null)}
          />
          <div className={`relative w-full max-h-[90vh] overflow-y-auto p-4 ${
            isDark ? 'bg-juice-dark border-t border-white/10' : 'bg-white border-t border-gray-200'
          }`}>
            <button
              onClick={() => setActiveModal(null)}
              className={`absolute top-4 right-4 z-10 p-2 transition-colors ${
                isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <QueueRulesetForm projectId={String(projectId)} chainId={String(chainId)} />
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
