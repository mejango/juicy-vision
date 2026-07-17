import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAccount } from 'wagmi'
import { createPortal } from 'react-dom'
import { useThemeStore, useChatStore } from '../stores'
import { useManagedWallet, useIsMobile } from '../hooks'
import { CHAINS, MAINNET_CHAINS } from '../constants'
import { fetchProject, fetchConnectedChains, fetchSuckerGroupBalance, isRevnetProject, fetchRevnetOperator, fetchEthPrice, type Project, type ConnectedChain, type SuckerGroupBalance } from '../services/bendystraw'
import { resolveEnsName, truncateAddress } from '../utils/ens'
import { getWalletSession } from '../services/siwe'
import { formatBalanceUsd, formatBalanceNative } from '../utils/currency'
import { IpfsImage } from '../components/ui/IpfsMedia'

// Chat components
import { ChatInput } from '../components/chat'

// Dynamic components
import BalanceChart from '../components/dynamic/charts/BalanceChart'
import VolumeChart from '../components/dynamic/charts/VolumeChart'
import PriceChart from '../components/dynamic/PriceChart'
import TokenPriceChart from '../components/dynamic/charts/TokenPriceChart'
import ActivityFeed from '../components/dynamic/ActivityFeed'
import ProjectCard from '../components/dynamic/ProjectCard'
import ShopTab from '../components/dynamic/ShopTab'
import ProjectSummary from '../components/dynamic/ProjectSummary'
import { hasNFTHook } from '../services/nft'
import { ExplainerMessage } from '../components/ui/ExplainerMessage'

// Payment modals
import CashOutForm from '../components/dynamic/CashOutForm'
import SendPayoutsForm from '../components/dynamic/SendPayoutsForm'
// Note: QueueRulesetForm is used for ruleset changes - it has its own modal internally
import QueueRulesetForm from '../components/dynamic/QueueRulesetForm'

// Owner action forms (self-contained with their own modals)
import SendReservedTokensForm from '../components/dynamic/SendReservedTokensForm'
import DeployERC20Form from '../components/dynamic/DeployERC20Form'
import UseSurplusAllowanceForm from '../components/dynamic/UseSurplusAllowanceForm'
import ManageTiersForm from '../components/dynamic/ManageTiersForm'
import SetSplitsForm from '../components/dynamic/SetSplitsForm'
import SetUriForm from '../components/dynamic/SetUriForm'
import { ChainMappingWarning } from '../components/dynamic/ChainMappingWarning'
import ProjectTabs from '../components/project/ProjectTabs'
import { parseProjectHash, projectHashFor, projectTabsFor, type OwnersSubtabId, type ProjectTabId } from '../components/project/flavor'

type ModalType =
  | 'pay' | 'cashout' | 'payouts' | 'ruleset'
  | 'reservedTokens' | 'deployErc20' | 'surplusAllowance'
  | 'manageTiers' | 'setSplits' | 'setUri'
  | null

interface ProjectDashboardProps {
  chainId: number
  projectId: number
}

// Chain info for balance tooltip
const CHAIN_DISPLAY: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  8453: 'Base',
  42161: 'Arbitrum',
  11155111: 'Sepolia',
  11155420: 'OP Sepolia',
  84532: 'Base Sepolia',
  421614: 'Arb Sepolia',
}


export default function ProjectDashboard({ chainId, projectId }: ProjectDashboardProps) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const isDark = theme === 'dark'

  // Tab + owners-subtab from the URL hash (#owners/settlement, #shop, legacy #about…)
  const initialHash = parseProjectHash(window.location.hash)
  const [activeTab, setActiveTabState] = useState<ProjectTabId>(initialHash.tab ?? 'overview')
  const [ownersSubtab, setOwnersSubtabState] = useState<OwnersSubtabId>(initialHash.subtab ?? 'accounts')

  // The hash is rewritten by both setters, so the flavor slug (owner/operator) stays right.
  const isRevnetRef = useRef(false)
  const writeHash = useCallback((tab: ProjectTabId, subtab: OwnersSubtabId | null) => {
    window.history.replaceState(null, '', projectHashFor(tab, isRevnetRef.current, subtab))
  }, [])

  const setActiveTab = useCallback((tab: ProjectTabId) => {
    setActiveTabState(tab)
    writeHash(tab, tab === 'owners' || tab === 'tokens' ? ownersSubtab : null)
  }, [ownersSubtab, writeHash])

  const setOwnersSubtab = useCallback((id: OwnersSubtabId) => {
    setOwnersSubtabState(id)
    writeHash('owners', id)
  }, [writeHash])

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const handleHashChange = () => {
      const { tab, subtab } = parseProjectHash(window.location.hash)
      if (tab) setActiveTabState(tab)
      if (subtab) setOwnersSubtabState(subtab)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // Listen for open-shop event from ProjectCard
  useEffect(() => {
    const handleOpenShop = (e: Event) => {
      const customEvent = e as CustomEvent<{ tierId?: number }>
      const tierId = customEvent.detail?.tierId
      setActiveTab('shop')
      // Scroll to the tier after tab switch (need small delay for tab content to render)
      if (tierId !== undefined) {
        setTimeout(() => {
          const element = document.getElementById(`shop-tier-${tierId}`)
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }, 100)
      }
    }
    window.addEventListener('juice:open-shop', handleOpenShop)
    return () => window.removeEventListener('juice:open-shop', handleOpenShop)
  }, [setActiveTab])

  // Listen for generic tab switch event (e.g., from "You get" token preview)
  useEffect(() => {
    const handleSwitchTab = (e: Event) => {
      const customEvent = e as CustomEvent<{ tab: ProjectTabId }>
      const tab = customEvent.detail?.tab
      if (tab) {
        // 'tokens' is the custom-project label for the same surface revnets call 'owners'.
        setActiveTab(tab === 'tokens' && isRevnetRef.current ? 'owners' : tab)
      }
    }
    window.addEventListener('juice:switch-tab', handleSwitchTab)
    return () => window.removeEventListener('juice:switch-tab', handleSwitchTab)
  }, [setActiveTab])

  const [project, setProject] = useState<Project | null>(null)
  const [projectLoading, setProjectLoading] = useState(true)
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null)
  const [connectedChains, setConnectedChains] = useState<ConnectedChain[]>([])
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [suckerGroupBalance, setSuckerGroupBalance] = useState<SuckerGroupBalance | null>(null)
  const [revnetOperator, setRevnetOperator] = useState<string | null>(null)
  const [revnetOperatorError, setRevnetOperatorError] = useState<string | null>(null)
  const [displayAddressEns, setDisplayAddressEns] = useState<string | null>(null)
  const [hasNftHook, setHasNftHook] = useState(false)
  const [nftHookError, setNftHookError] = useState<string | null>(null)
  const [ethPrice, setEthPrice] = useState<number | null>(null)

  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null)

  // Owner actions menu state
  const [showOwnerMenu, setShowOwnerMenu] = useState(false)
  const ownerMenuRef = useRef<HTMLDivElement>(null)

  // Close owner menu when clicking outside
  useEffect(() => {
    if (!showOwnerMenu) return
    const handleClickOutside = (event: MouseEvent) => {
      if (ownerMenuRef.current && !ownerMenuRef.current.contains(event.target as Node)) {
        setShowOwnerMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showOwnerMenu])

  // Balance tooltip state
  const [showBalanceTooltip, setShowBalanceTooltip] = useState(false)

  const chain = CHAINS[chainId] || MAINNET_CHAINS[chainId]

  // Get current user's address from wallet connections
  const { address: wagmiAddress } = useAccount()
  const { address: managedAddress, isManagedMode } = useManagedWallet()
  const walletSession = getWalletSession()

  // Select the identity from the active custody mode; cached managed state is
  // not evidence that the managed account is currently active.
  const currentUserAddress = useMemo(() => {
    return isManagedMode ? managedAddress : walletSession?.address || wagmiAddress
  }, [isManagedMode, walletSession?.address, managedAddress, wagmiAddress])

  // Check if current user is the project owner
  const isOwner = useMemo(() => {
    if (!currentUserAddress || !project?.owner || project.configurationError) return false
    const authority = isRevnetProject(project) ? revnetOperator : project.owner
    return !!authority && currentUserAddress.toLowerCase() === authority.toLowerCase()
  }, [currentUserAddress, project, revnetOperator])

  // Check if project has deployed an ERC20 token
  const hasErc20Token = useMemo(() => {
    return Boolean(project?.tokenSymbol)
  }, [project?.tokenSymbol])

  const balanceAvailable = !!suckerGroupBalance && suckerGroupBalance.balanceAvailable !== false
  const paymentsAvailable = !!suckerGroupBalance && suckerGroupBalance.paymentsAvailable !== false
  const volumeAvailable = !!suckerGroupBalance && (
    suckerGroupBalance.dataScope === 'project'
      ? !!project && /^\d+$/.test(project.volume)
      : suckerGroupBalance.volumeAvailable !== false
  )
  const balanceScope = suckerGroupBalance?.dataScope === 'project' ? ' on this chain' : ''

  const displayBalance = balanceAvailable ? suckerGroupBalance.totalBalance : ''
  const displayPaymentsCount = paymentsAvailable ? suckerGroupBalance.totalPaymentsCount : Number.NaN
  const displayVolume = volumeAvailable
    ? suckerGroupBalance.dataScope === 'project'
      ? project!.volume
      : suckerGroupBalance.totalVolume
    : ''

  // Load project data
  useEffect(() => {
    let cancelled = false
    async function loadProject() {
      setProjectLoading(true)
      setProject(null)
      setProjectLoadError(null)
      setConnectedChains([{ chainId, projectId }])
      setChainMappingAvailable(true)
      setSuckerGroupBalance(null)
      setNftHookError(null)
      try {
        const nftHookResult = hasNFTHook(String(projectId), chainId)
          .then(value => ({ value, error: null }))
          .catch(error => ({
            value: false,
            error: error instanceof Error ? error.message : 'Reward configuration unavailable',
          }))
        const [projectResult, chainsResult, balanceResult, nftResult, priceResult] = await Promise.allSettled([
          fetchProject(String(projectId), chainId),
          fetchConnectedChains(String(projectId), chainId),
          fetchSuckerGroupBalance(String(projectId), chainId),
          nftHookResult,
          fetchEthPrice(),
        ])
        if (cancelled) return
        if (projectResult.status === 'rejected') throw projectResult.reason

        setProject(projectResult.value)
        if (chainsResult.status === 'fulfilled') {
          setConnectedChains(chainsResult.value.length > 0
            ? chainsResult.value
            : [{ chainId, projectId }])
        } else {
          setConnectedChains([{ chainId, projectId }])
          setChainMappingAvailable(false)
        }
        setSuckerGroupBalance(balanceResult.status === 'fulfilled' ? balanceResult.value : null)
        if (nftResult.status === 'fulfilled') {
          setHasNftHook(nftResult.value.value)
          setNftHookError(nftResult.value.error)
        } else {
          setHasNftHook(false)
          setNftHookError('Reward configuration unavailable')
        }
        setEthPrice(priceResult.status === 'fulfilled' ? priceResult.value : null)
      } catch (error) {
        console.error('Failed to load project:', error)
        if (!cancelled) {
          setProject(null)
          setProjectLoadError(error instanceof Error ? error.message : 'Project verification failed')
        }
      } finally {
        if (!cancelled) setProjectLoading(false)
      }
    }
    loadProject()
    return () => { cancelled = true }
  }, [projectId, chainId])

  // Determine if revnet and fetch operator, then resolve ENS
  const projectIsRevnet = useMemo(() => {
    return isRevnetProject(project)
  }, [project])

  // The address to display: operator for revnets, owner otherwise
  const displayAddress = useMemo(() => {
    if (projectIsRevnet && revnetOperator) {
      return revnetOperator
    }
    return projectIsRevnet ? null : project?.owner || null
  }, [projectIsRevnet, revnetOperator, project?.owner])

  // Fetch revnet operator and resolve ENS for display address
  useEffect(() => {
    async function loadDisplayInfo() {
      if (!project?.owner) return

      // If revnet, fetch the operator
      if (projectIsRevnet) {
        setRevnetOperatorError(null)
        try {
          const operator = await fetchRevnetOperator(String(projectId), chainId)
          setRevnetOperator(operator)
          setDisplayAddressEns(operator ? await resolveEnsName(operator) : null)
        } catch (error) {
          setRevnetOperator(null)
          setDisplayAddressEns(null)
          setRevnetOperatorError(error instanceof Error ? error.message : 'Revnet operator unavailable')
        }
      } else {
        // Resolve ENS for owner
        const ensName = await resolveEnsName(project.owner)
        setDisplayAddressEns(ensName)
      }
    }
    loadDisplayInfo()
  }, [project?.owner, projectIsRevnet, projectId, chainId])

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

  // The tab row itself lives in ProjectTabs (projectTabsFor decides the flavor's set).
  // The hash writer needs the flavor without re-rendering on every tab change.
  useEffect(() => {
    isRevnetRef.current = projectIsRevnet
  }, [projectIsRevnet])

  // A hash naming a tab this flavor doesn't have (e.g. #funds on a revnet, or a
  // stale #shop after the 721 probe came back empty) falls back to Overview.
  useEffect(() => {
    const available = projectTabsFor({
      isRevnet: projectIsRevnet,
      isMobile,
      hasShop: hasNftHook,
      hasErc20: !!project?.token,
    })
    if (!available.some(t => t.id === activeTab)) setActiveTabState('overview')
  }, [projectIsRevnet, isMobile, hasNftHook, project?.token, activeTab])

  /**
   * The tab bar + body, wired once for both layouts. Charts juicy has and the
   * website doesn't (volume/balance history, the issuance projection) ride along
   * as slots so the tabs stay a straight port.
   */
  const renderTabs = (mobile: boolean) => {
    if (!project) return null
    return (
      <ProjectTabs
        project={project}
        projectId={projectId}
        chainId={chainId}
        connectedChains={connectedChains}
        suckerGroupBalance={suckerGroupBalance}
        isRevnet={projectIsRevnet}
        isMobile={mobile}
        hasShop={hasNftHook}
        hasErc20={!!project.token}
        erc20Address={(project.token as `0x${string}`) || null}
        revnetOperator={revnetOperator}
        canEdit={isOwner}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ownersSubtab={ownersSubtab}
        onOwnersSubtabChange={setOwnersSubtab}
        activityFeed={
          <ActivityFeed projectId={String(projectId)} chainId={String(chainId)} limit={15} />
        }
        priceChart={
          <TokenPriceChart projectId={String(projectId)} chainId={String(chainId)} />
        }
        summary={
          <>
            <ProjectSummary
              projectName={project.name}
              balance={displayBalance}
              volume={displayVolume}
              paymentsCount={displayPaymentsCount}
              balanceAvailable={balanceAvailable}
              volumeAvailable={volumeAvailable}
              paymentsAvailable={paymentsAvailable}
              createdAt={project.createdAt}
              isRevnet={projectIsRevnet}
              hasNftHook={hasNftHook}
              connectedChainsCount={connectedChains.length}
              ethPrice={ethPrice}
              currency={suckerGroupBalance?.currency}
              decimals={suckerGroupBalance?.decimals}
            />
            {nftHookError && (
              <div className={`border px-3 py-2 text-xs ${
                isDark
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : 'border-amber-300 bg-amber-50 text-amber-800'
              }`}>
                Reward data unavailable: {nftHookError}
              </div>
            )}
          </>
        }
        rulesetsChart={
          <PriceChart projectId={String(projectId)} chainId={String(chainId)} showHistory={!projectIsRevnet} />
        }
        fundsCharts={
          <>
            <ExplainerMessage>
              Here's how much has been contributed to the project over time.
            </ExplainerMessage>
            <VolumeChart projectId={String(projectId)} chainId={String(chainId)} />
            <ExplainerMessage>
              Here's how the project's funds have changed over time.
            </ExplainerMessage>
            <BalanceChart projectId={String(projectId)} chainId={String(chainId)} />
          </>
        }
        shop={
          <ShopTab
            projectId={String(projectId)}
            chainId={String(chainId)}
            isOwner={isOwner}
            isRevnet={projectIsRevnet}
            connectedChains={connectedChains.map(c => ({ chainId: c.chainId, projectId: c.projectId }))}
            onManageTiers={() => setActiveModal('manageTiers')}
          />
        }
        onQueueRuleset={() => setActiveModal('ruleset')}
        onSendPayouts={() => setActiveModal('payouts')}
        onUseAllowance={() => setActiveModal('surplusAllowance')}
        onEditMetadata={() => setActiveModal('setUri')}
        onEditToken={() => setActiveModal('deployErc20')}
        onEditSplits={() => setActiveModal('setSplits')}
        onDeployErc20={() => setActiveModal('deployErc20')}
        onCashOut={() => setActiveModal('cashout')}
      />
    )
  }

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
          <h1 className="text-xl font-semibold mb-2">Project unavailable</h1>
          <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Project existence could not be verified from the chain. No project actions are available.
          </p>
          {projectLoadError && (
            <p className={`mb-6 break-words text-xs ${isDark ? 'text-red-300' : 'text-red-700'}`}>
              {projectLoadError}
            </p>
          )}
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
                  <IpfsImage
                    uri={project.logoUri}
                    alt=""
                    className="w-16 h-16 object-cover"
                    fallback={<div className={`w-16 h-16 flex items-center justify-center text-2xl ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>?</div>}
                  />
                ) : (
                  <div className={`w-16 h-16 flex items-center justify-center text-2xl ${
                    isDark ? 'bg-white/10' : 'bg-gray-200'
                  }`}>
                    🍊
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h1 className={`text-xl font-semibold truncate ${
                    isDark ? 'text-white' : 'text-gray-900'
                  }`}>
                    {project.name || `Project #${projectId}`}
                  </h1>
                  {/* Stats row */}
                  <div className={`flex items-center gap-4 mt-1 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    <div
                      className="relative"
                      onMouseEnter={() => setShowBalanceTooltip(true)}
                      onMouseLeave={() => setShowBalanceTooltip(false)}
                      onClick={() => setShowBalanceTooltip(prev => !prev)}
                    >
                      <span className={`font-semibold cursor-pointer ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        {balanceAvailable
                          ? `${formatBalanceUsd(displayBalance, ethPrice, suckerGroupBalance?.currency, suckerGroupBalance?.decimals)} balance${balanceScope}`
                          : 'Balance unavailable'}
                      </span>
                      {/* Per-chain balance breakdown tooltip */}
                      {showBalanceTooltip && balanceAvailable && suckerGroupBalance && suckerGroupBalance.projectBalances.length > 1 && (
                        <div className={`absolute top-full left-0 mt-1 p-2 shadow-lg z-50 min-w-[200px] text-xs ${
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
                        {paymentsAvailable ? displayPaymentsCount.toLocaleString() : 'Unavailable'}
                      </span>
                      {' '}payment{!paymentsAvailable || displayPaymentsCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {/* Operator/Owner and Website */}
                  {(displayAddress || revnetOperatorError || project.metadata?.infoUri) && (
                    <div className={`flex items-center flex-wrap gap-x-1.5 gap-y-1 mt-1.5 text-xs ${
                      isDark ? 'text-gray-500' : 'text-gray-400'
                    }`}>
                      {projectIsRevnet && (
                        <>
                          <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] font-medium">
                            Revnet
                          </span>
                          <span className="opacity-50">|</span>
                        </>
                      )}
                      {displayAddress && (
                        <>
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
                            <>
                              <span className="px-1.5 py-0.5 bg-green-500/20 text-green-500 rounded text-[10px] font-medium">
                                {t('project.you', 'You')}
                              </span>
                              <div className="relative" ref={ownerMenuRef}>
                                <button
                                  onClick={() => setShowOwnerMenu(!showOwnerMenu)}
                                  className={`ml-1 p-1 rounded transition-colors ${
                                    isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                                  }`}
                                  title="Owner actions"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                </button>
                                {/* Owner Actions Menu */}
                                {showOwnerMenu && (
                                  <div
                                    className={`absolute top-full left-0 mt-1 w-48 py-1 shadow-lg z-50 ${
                                      isDark ? 'bg-juice-dark border border-white/20' : 'bg-white border border-gray-200'
                                    }`}
                                    onClick={() => setShowOwnerMenu(false)}
                                  >
                                    {/* FUNDS section */}
                                    <div className={`px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                                      isDark ? 'text-gray-500' : 'text-gray-400'
                                    }`}>
                                      Funds
                                    </div>
                                    <button
                                      onClick={() => setActiveModal('payouts')}
                                      className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                        isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                      }`}
                                    >
                                      Send Payouts
                                    </button>
                                    <button
                                      onClick={() => setActiveModal('surplusAllowance')}
                                      className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                        isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                      }`}
                                    >
                                      Use Surplus Allowance
                                    </button>

                                    {/* TOKENS section */}
                                    <div className={`px-3 py-1 mt-1 text-[10px] font-semibold uppercase tracking-wider border-t ${
                                      isDark ? 'text-gray-500 border-white/10' : 'text-gray-400 border-gray-100'
                                    }`}>
                                      Tokens
                                    </div>
                                    <button
                                      onClick={() => setActiveModal('reservedTokens')}
                                      className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                        isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                      }`}
                                    >
                                      Send Reserved Tokens
                                    </button>
                                    {!hasErc20Token && (
                                      <button
                                        onClick={() => setActiveModal('deployErc20')}
                                        className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                          isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                        }`}
                                      >
                                        Deploy ERC20
                                      </button>
                                    )}

                                    {/* CONFIGURATION section */}
                                    <div className={`px-3 py-1 mt-1 text-[10px] font-semibold uppercase tracking-wider border-t ${
                                      isDark ? 'text-gray-500 border-white/10' : 'text-gray-400 border-gray-100'
                                    }`}>
                                      Configuration
                                    </div>
                                    <button
                                      onClick={() => setActiveModal('ruleset')}
                                      className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                        isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                      }`}
                                    >
                                      Queue Ruleset
                                    </button>
                                    <button
                                      onClick={() => setActiveModal('setSplits')}
                                      className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                        isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                      }`}
                                    >
                                      Configure Splits
                                    </button>
                                    <button
                                      onClick={() => setActiveModal('setUri')}
                                      className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                        isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                      }`}
                                    >
                                      Update Metadata
                                    </button>

                                    {/* INVENTORY section - only if project has NFT hook */}
                                    {hasNftHook && (
                                      <>
                                        <div className={`px-3 py-1 mt-1 text-[10px] font-semibold uppercase tracking-wider border-t ${
                                          isDark ? 'text-gray-500 border-white/10' : 'text-gray-400 border-gray-100'
                                        }`}>
                                          Inventory
                                        </div>
                                        <button
                                          onClick={() => setActiveModal('manageTiers')}
                                          className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                            isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                          }`}
                                        >
                                          Manage NFT Tiers
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </>
                      )}
                      {projectIsRevnet && revnetOperatorError && !displayAddress && (
                        <span className="text-red-400">Operator unavailable</span>
                      )}
                      {displayAddress && project.metadata?.infoUri && (
                        <span className="opacity-50">|</span>
                      )}
                      {project.metadata?.infoUri && (
                        <>
                          <span>Site:</span>
                          <a
                            href={project.metadata.infoUri.startsWith('http') ? project.metadata.infoUri : `https://${project.metadata.infoUri}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`hover:underline ${
                              isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {project.metadata.infoUri.replace(/^https?:\/\//, '')}
                          </a>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {project.configurationError && (
                <div className={`mt-3 border px-3 py-2 text-xs ${
                  isDark
                    ? 'border-red-500/40 bg-red-500/10 text-red-300'
                    : 'border-red-300 bg-red-50 text-red-800'
                }`}>
                  {project.configurationError}. Project actions are unavailable.
                </div>
              )}
              {!chainMappingAvailable && (
                <div className="mt-3"><ChainMappingWarning isDark={isDark} /></div>
              )}
            </div>
          </div>

          {/* Two-column layout */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Pay/Activity sidebar - flex column with sticky header */}
            <div className={`w-[380px] shrink-0 border-r flex flex-col ${
              isDark ? 'border-white/10' : 'border-gray-200'
            }`}>
              {/* Pay/Cash out panel - outputs sticky header + scrollable content */}
              <ProjectCard
                projectId={String(projectId)}
                chainId={String(chainId)}
                embedded
              >
                {/* Activity Feed - rendered inside ProjectCard's scrollable area */}
                <ActivityFeed
                  projectId={String(projectId)}
                  chainId={String(chainId)}
                  limit={15}
                  compact
                />
              </ProjectCard>
            </div>

            {/* Right: Main content (scrollable) */}
            <div className="flex-1 overflow-y-auto">
              {renderTabs(false)}
            </div>
          </div>

          {/* Chat dock - fixed at bottom */}
          <div className={`shrink-0 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <ChatInput
              onSend={handleChatSend}
              placeholder={`Ask about ${project.name || 'this project'}...`}
              compact
            />
          </div>

          {/* Bottom border */}
          <div className="h-[4px] bg-juice-orange shrink-0" />
        </div>

        {/* Right border */}
        <div className="w-[4px] bg-juice-orange shrink-0" />

        {/* Modals */}
        {activeModal === 'payouts' && createPortal(
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
                aria-label="Close"
              >
                <span aria-hidden="true">X</span>
              </button>
              <SendPayoutsForm projectId={String(projectId)} chainId={String(chainId)} />
            </div>
          </div>,
          document.body
        )}

        {activeModal === 'cashout' && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setActiveModal(null)}
            />
            <div className={`relative w-full max-w-md max-h-[90vh] overflow-y-auto ${
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
              <div className="p-4">
                <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Cash Out {project.name} Tokens
                </h2>
                <CashOutForm
                  projectId={String(projectId)}
                  chainId={String(chainId)}
                />
              </div>
            </div>
          </div>,
          document.body
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

        {/* Send Reserved Tokens Modal */}
        {activeModal === 'reservedTokens' && createPortal(
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
              <SendReservedTokensForm projectId={String(projectId)} chainId={String(chainId)} />
            </div>
          </div>,
          document.body
        )}

        {/* Deploy ERC20 Modal */}
        {activeModal === 'deployErc20' && createPortal(
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
              <DeployERC20Form projectId={String(projectId)} chainId={String(chainId)} />
            </div>
          </div>,
          document.body
        )}

        {/* Use Surplus Allowance Modal */}
        {activeModal === 'surplusAllowance' && createPortal(
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
              <UseSurplusAllowanceForm projectId={String(projectId)} chainId={String(chainId)} />
            </div>
          </div>,
          document.body
        )}

        {/* Set Splits Modal */}
        {activeModal === 'setSplits' && createPortal(
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
              <SetSplitsForm projectId={String(projectId)} chainId={String(chainId)} />
            </div>
          </div>,
          document.body
        )}

        {/* Set URI Modal */}
        {activeModal === 'setUri' && createPortal(
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
              <SetUriForm projectId={String(projectId)} chainId={String(chainId)} />
            </div>
          </div>,
          document.body
        )}

        {/* Manage Tiers Modal */}
        {activeModal === 'manageTiers' && createPortal(
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
              <ManageTiersForm projectId={String(projectId)} chainId={String(chainId)} />
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
              <IpfsImage
                uri={project.logoUri}
                alt=""
                className="w-14 h-14 object-cover"
                fallback={<div className={`w-14 h-14 flex items-center justify-center text-xl ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>?</div>}
              />
            ) : (
              <div className={`w-14 h-14 flex items-center justify-center text-xl ${
                isDark ? 'bg-white/10' : 'bg-gray-200'
              }`}>
                🍊
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className={`text-lg font-semibold truncate ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}>
                {project.name || `Project #${projectId}`}
              </h1>
              {/* Stats row */}
              <div className={`flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                <div
                  className="relative"
                  onMouseEnter={() => setShowBalanceTooltip(true)}
                  onMouseLeave={() => setShowBalanceTooltip(false)}
                  onClick={() => setShowBalanceTooltip(prev => !prev)}
                >
                  <span className={`font-semibold cursor-pointer ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {balanceAvailable
                      ? `${formatBalanceUsd(displayBalance, ethPrice, suckerGroupBalance?.currency, suckerGroupBalance?.decimals)} balance${balanceScope}`
                      : 'Balance unavailable'}
                  </span>
                  {/* Per-chain balance breakdown tooltip */}
                  {showBalanceTooltip && balanceAvailable && suckerGroupBalance && suckerGroupBalance.projectBalances.length > 1 && (
                    <div className={`absolute top-full left-0 mt-1 p-2 shadow-lg z-50 min-w-[200px] text-xs ${
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
                    {paymentsAvailable ? displayPaymentsCount.toLocaleString() : 'Unavailable'}
                  </span>
                  {' '}payment{!paymentsAvailable || displayPaymentsCount !== 1 ? 's' : ''}
                </span>
              </div>
              {/* Operator/Owner and Website */}
              {(displayAddress || revnetOperatorError || project.metadata?.infoUri) && (
                <div className={`flex items-center flex-wrap gap-x-1.5 gap-y-1 mt-1.5 text-xs ${
                  isDark ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  {projectIsRevnet && (
                    <>
                      <span className="px-1.5 py-0.5 bg-purple-500/20 text-purple-400 text-[10px] font-medium">
                        Revnet
                      </span>
                      <span className="opacity-50">|</span>
                    </>
                  )}
                  {displayAddress && (
                    <>
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
                        <>
                          <span className="px-1.5 py-0.5 bg-green-500/20 text-green-500 rounded text-[10px] font-medium">
                            {t('project.you', 'You')}
                          </span>
                          <div className="relative" ref={ownerMenuRef}>
                            <button
                              onClick={() => setShowOwnerMenu(!showOwnerMenu)}
                              className={`ml-1 p-1 rounded transition-colors ${
                                isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                              }`}
                              title="Owner actions"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </button>
                            {/* Owner Actions Menu - Mobile */}
                            {showOwnerMenu && (
                              <div
                                className={`absolute top-full right-0 mt-1 w-48 py-1 shadow-lg z-50 ${
                                  isDark ? 'bg-juice-dark border border-white/20' : 'bg-white border border-gray-200'
                                }`}
                                onClick={() => setShowOwnerMenu(false)}
                              >
                                {/* FUNDS section */}
                                <div className={`px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                                  isDark ? 'text-gray-500' : 'text-gray-400'
                                }`}>
                                  Funds
                                </div>
                                <button
                                  onClick={() => setActiveModal('payouts')}
                                  className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                    isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  Send Payouts
                                </button>
                                <button
                                  onClick={() => setActiveModal('surplusAllowance')}
                                  className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                    isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  Use Surplus Allowance
                                </button>

                                {/* TOKENS section */}
                                <div className={`px-3 py-1 mt-1 text-[10px] font-semibold uppercase tracking-wider border-t ${
                                  isDark ? 'text-gray-500 border-white/10' : 'text-gray-400 border-gray-100'
                                }`}>
                                  Tokens
                                </div>
                                <button
                                  onClick={() => setActiveModal('reservedTokens')}
                                  className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                    isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  Send Reserved Tokens
                                </button>
                                {!hasErc20Token && (
                                  <button
                                    onClick={() => setActiveModal('deployErc20')}
                                    className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                      isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                    }`}
                                  >
                                    Deploy ERC20
                                  </button>
                                )}

                                {/* CONFIGURATION section */}
                                <div className={`px-3 py-1 mt-1 text-[10px] font-semibold uppercase tracking-wider border-t ${
                                  isDark ? 'text-gray-500 border-white/10' : 'text-gray-400 border-gray-100'
                                }`}>
                                  Configuration
                                </div>
                                <button
                                  onClick={() => setActiveModal('ruleset')}
                                  className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                    isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  Queue Ruleset
                                </button>
                                <button
                                  onClick={() => setActiveModal('setSplits')}
                                  className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                    isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  Configure Splits
                                </button>
                                <button
                                  onClick={() => setActiveModal('setUri')}
                                  className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                    isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  Update Metadata
                                </button>

                                {/* INVENTORY section - only if project has NFT hook */}
                                {hasNftHook && (
                                  <>
                                    <div className={`px-3 py-1 mt-1 text-[10px] font-semibold uppercase tracking-wider border-t ${
                                      isDark ? 'text-gray-500 border-white/10' : 'text-gray-400 border-gray-100'
                                    }`}>
                                      Inventory
                                    </div>
                                    <button
                                      onClick={() => setActiveModal('manageTiers')}
                                      className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                                        isDark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-700 hover:bg-gray-100'
                                      }`}
                                    >
                                      Manage NFT Tiers
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}
                  {projectIsRevnet && revnetOperatorError && !displayAddress && (
                    <span className="text-red-400">Operator unavailable</span>
                  )}
                  {displayAddress && project.metadata?.infoUri && (
                    <span className="opacity-50">|</span>
                  )}
                  {project.metadata?.infoUri && (
                    <>
                      <span>Site:</span>
                      <a
                        href={project.metadata.infoUri.startsWith('http') ? project.metadata.infoUri : `https://${project.metadata.infoUri}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`hover:underline ${
                          isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                        }`}
                      >
                        {project.metadata.infoUri.replace(/^https?:\/\//, '')}
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          {project.configurationError && (
            <div className={`mt-3 border px-3 py-2 text-xs ${
              isDark
                ? 'border-red-500/40 bg-red-500/10 text-red-300'
                : 'border-red-300 bg-red-50 text-red-800'
            }`}>
              {project.configurationError}. Project actions are unavailable.
            </div>
          )}
          {!chainMappingAvailable && (
            <div className="mt-3"><ChainMappingWarning isDark={isDark} /></div>
          )}
        </div>

      </div>

      {/* Tabs (bar + body) — same wiring as desktop. The pay/cash-out panel leads
          on mobile (its own left column on desktop); Activity is a tab here, so the
          card renders childless rather than embedding the feed. */}
      <div className="flex-1 overflow-y-auto">
        <div className={`border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <ProjectCard
            projectId={String(projectId)}
            chainId={String(chainId)}
            embedded
            isRevnet={projectIsRevnet}
          />
        </div>
        {renderTabs(true)}
      </div>

      {/* Chat dock - mobile */}
      <div className={`shrink-0 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <ChatInput
          onSend={handleChatSend}
          placeholder={`Ask about ${project.name || 'this project'}...`}
          compact
        />
      </div>

      {/* Mobile modals */}
      {activeModal === 'payouts' && createPortal(
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
              aria-label="Close"
            >
              <span aria-hidden="true">X</span>
            </button>
            <SendPayoutsForm projectId={String(projectId)} chainId={String(chainId)} />
          </div>
        </div>,
        document.body
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

      {/* Send Reserved Tokens Modal - Mobile */}
      {activeModal === 'reservedTokens' && createPortal(
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
            <SendReservedTokensForm projectId={String(projectId)} chainId={String(chainId)} />
          </div>
        </div>,
        document.body
      )}

      {/* Deploy ERC20 Modal - Mobile */}
      {activeModal === 'deployErc20' && createPortal(
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
            <DeployERC20Form projectId={String(projectId)} chainId={String(chainId)} />
          </div>
        </div>,
        document.body
      )}

      {/* Use Surplus Allowance Modal - Mobile */}
      {activeModal === 'surplusAllowance' && createPortal(
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
            <UseSurplusAllowanceForm projectId={String(projectId)} chainId={String(chainId)} />
          </div>
        </div>,
        document.body
      )}

      {/* Set Splits Modal - Mobile */}
      {activeModal === 'setSplits' && createPortal(
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
            <SetSplitsForm projectId={String(projectId)} chainId={String(chainId)} />
          </div>
        </div>,
        document.body
      )}

      {/* Set URI Modal - Mobile */}
      {activeModal === 'setUri' && createPortal(
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
            <SetUriForm projectId={String(projectId)} chainId={String(chainId)} />
          </div>
        </div>,
        document.body
      )}

      {/* Manage Tiers Modal - Mobile */}
      {activeModal === 'manageTiers' && createPortal(
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
            <ManageTiersForm projectId={String(projectId)} chainId={String(chainId)} />
          </div>
        </div>,
        document.body
      )}

      {/* Cash Out Modal - Mobile */}
      {activeModal === 'cashout' && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setActiveModal(null)}
          />
          <div className={`relative w-full max-h-[90vh] overflow-y-auto ${
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
            <div className="p-4">
              <h2 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Cash Out {project.name} Tokens
              </h2>
              <CashOutForm
                projectId={String(projectId)}
                chainId={String(chainId)}
              />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
