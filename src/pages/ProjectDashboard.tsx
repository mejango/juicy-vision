import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAccount } from 'wagmi'
import { createPortal } from 'react-dom'
import { useThemeStore } from '../stores'
import { useManagedWallet, useIsMobile } from '../hooks'
import { CHAINS } from '../constants'
import { fetchProject, fetchProjectWithRuleset, fetchConnectedChains, type Project, type ConnectedChain } from '../services/bendystraw'
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

// Payment modals
import CashOutModal from '../components/payment/CashOutModal'
import SendPayoutsModal from '../components/payment/SendPayoutsModal'
// Note: QueueRulesetForm is used for ruleset changes - it has its own modal internally
import QueueRulesetForm from '../components/dynamic/QueueRulesetForm'

type DashboardTab = 'overview' | 'payments'
type ModalType = 'pay' | 'cashout' | 'payouts' | 'ruleset' | null

interface ProjectDashboardProps {
  chainId: number
  projectId: number
}

function formatEth(weiString: string): string {
  try {
    const wei = BigInt(weiString)
    const eth = formatUnits(wei, 18)
    const num = parseFloat(eth)
    if (num === 0) return '0'
    if (num < 0.001) return '<0.001'
    return num.toLocaleString(undefined, { maximumFractionDigits: 4 })
  } catch {
    return '0'
  }
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

  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [project, setProject] = useState<Project | null>(null)
  const [projectLoading, setProjectLoading] = useState(true)
  const [supporters, setSupporters] = useState<ProjectConversation[]>([])
  const [supportersLoading, setSupportersLoading] = useState(false)
  const [supportersLoaded, setSupportersLoaded] = useState(false)
  const [supportersTotal, setSupportersTotal] = useState(0)
  const [connectedChains, setConnectedChains] = useState<ConnectedChain[]>([])

  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null)

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

  // Load project data
  useEffect(() => {
    async function loadProject() {
      setProjectLoading(true)
      try {
        const [data, chains] = await Promise.all([
          fetchProject(String(projectId), chainId),
          fetchConnectedChains(String(projectId), chainId),
        ])
        setProject(data)
        setConnectedChains(chains)
      } catch (error) {
        console.error('Failed to load project:', error)
      } finally {
        setProjectLoading(false)
      }
    }
    loadProject()
  }, [projectId, chainId])

  // Load supporters when payments tab is active
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

  useEffect(() => {
    if (activeTab === 'payments' && !supportersLoaded) {
      loadSupporters()
    }
  }, [activeTab, supportersLoaded, loadSupporters])

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

    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: {
        message: contextMessage,
        newChat: true
      }
    }))
    navigate('/') // Go to home to see chat
  }

  // Handle activity project click
  const handleActivityProjectClick = (query: string) => {
    window.dispatchEvent(new CustomEvent('juice:send-message', {
      detail: { message: query, newChat: true }
    }))
    navigate('/')
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

  // Desktop layout with 3-column structure
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

              {/* Project header with Pay button */}
              <div className="flex items-start gap-4">
                {project.logoUri ? (
                  <img
                    src={resolveIpfsUri(project.logoUri) || undefined}
                    alt=""
                    className="w-16 h-16 rounded-full object-cover"
                  />
                ) : (
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl ${
                    isDark ? 'bg-white/10' : 'bg-gray-200'
                  }`}>
                    🍊
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h1 className={`text-xl font-semibold truncate ${
                      isDark ? 'text-white' : 'text-gray-900'
                    }`}>
                      {project.name || `Project #${projectId}`}
                    </h1>
                    <button
                      onClick={() => setActiveModal('pay')}
                      className="px-4 py-1.5 bg-green-500 text-black text-sm font-medium hover:bg-green-400 transition-colors shrink-0"
                    >
                      Pay
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {chain && (
                      <span
                        className="px-2 py-0.5 text-xs font-medium rounded-full"
                        style={{ backgroundColor: chain.color + '20', color: chain.color }}
                      >
                        {chain.shortName}
                      </span>
                    )}
                    <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      #{projectId}
                    </span>
                  </div>
                  {/* Owner address */}
                  {project.owner && (
                    <div className={`flex items-center gap-1.5 mt-2 text-xs ${
                      isDark ? 'text-gray-500' : 'text-gray-400'
                    }`}>
                      <span>{t('project.owner', 'Owner')}:</span>
                      <a
                        href={chain ? `${chain.explorer}/address/${project.owner}` : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`font-mono hover:underline ${
                          isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {project.owner.slice(0, 6)}...{project.owner.slice(-4)}
                      </a>
                      {isOwner && (
                        <span className="px-1.5 py-0.5 bg-green-500/20 text-green-500 rounded text-[10px] font-medium">
                          {t('project.you', 'You')}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Stats row */}
                <div className="flex gap-6 text-sm shrink-0">
                  <div>
                    <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Volume</div>
                    <div className={`font-mono font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {formatEth(project.volume || '0')} ETH
                    </div>
                  </div>
                  <div>
                    <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Payments</div>
                    <div className={`font-mono font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {project.paymentsCount || 0}
                    </div>
                  </div>
                  <div>
                    <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Balance</div>
                    <div className={`font-mono font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {formatEth(project.balance || '0')} ETH
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Scrollable main content */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-6 py-6 space-y-6">
              {/* Description */}
              {project.description && (
                <p className={`text-sm whitespace-pre-line ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  {stripHtmlTags(project.description)}
                </p>
              )}

              {/* Charts grid - 2x2 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <BalanceChart projectId={String(projectId)} chainId={String(chainId)} />
                <VolumeChart projectId={String(projectId)} chainId={String(chainId)} />
                <PriceChart projectId={String(projectId)} chainId={String(chainId)} />
                <HoldersChart projectId={String(projectId)} chainId={String(chainId)} />
              </div>

              {/* Ruleset Schedule */}
              <RulesetSchedule projectId={String(projectId)} chainId={String(chainId)} />

              {/* Activity Feed */}
              <ActivityFeed projectId={String(projectId)} chainId={String(chainId)} limit={10} />

              {/* Owner Actions */}
              {isOwner && (
                <div className={`p-4 border ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                  <h3 className={`text-sm font-semibold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    Owner Actions
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => setActiveModal('payouts')}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        isDark
                          ? 'bg-juice-orange/20 text-juice-orange hover:bg-juice-orange/30'
                          : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                      }`}
                    >
                      Send Payouts
                    </button>
                    <button
                      onClick={() => setActiveModal('ruleset')}
                      className={`px-4 py-2 text-sm font-medium transition-colors ${
                        isDark
                          ? 'bg-juice-cyan/20 text-juice-cyan hover:bg-juice-cyan/30'
                          : 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200'
                      }`}
                    >
                      Queue Ruleset
                    </button>
                  </div>
                </div>
              )}

              {/* Payments received tab content */}
              {activeTab === 'payments' && (
                <div className={`p-4 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                  {supportersLoading ? (
                    <div className={`p-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      <div className="w-6 h-6 border-2 border-juice-orange border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-sm">{t('ui.loading', 'Loading...')}</p>
                    </div>
                  ) : supporters.length === 0 ? (
                    <div className={`p-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      <p className="text-sm">{t('project.noSupporters', 'No payments yet')}</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <span className={`text-xs font-medium ${
                          isDark ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                          {t('project.supporters', 'Supporters')} ({supportersTotal})
                        </span>
                      </div>

                      <div className="space-y-2">
                        {supporters.map(supporter => (
                          <div
                            key={supporter.id}
                            onClick={() => handleSupporterClick(supporter.chatId)}
                            className={`group p-4 border transition-colors ${
                              isOwner
                                ? isDark
                                  ? 'border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 cursor-pointer'
                                  : 'border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-gray-100 cursor-pointer'
                                : isDark
                                  ? 'border-white/10 bg-white/5'
                                  : 'border-gray-200 bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1 min-w-0">
                                <div className={`text-sm font-medium truncate ${
                                  isDark ? 'text-white' : 'text-gray-900'
                                }`}>
                                  {supporter.supporterAddress.slice(0, 6)}...{supporter.supporterAddress.slice(-4)}
                                </div>
                                <div className={`text-xs mt-0.5 ${
                                  isDark ? 'text-gray-400' : 'text-gray-500'
                                }`}>
                                  {supporter.paymentCount} {supporter.paymentCount === 1 ? 'payment' : 'payments'}
                                  {' · '}
                                  {formatEth(supporter.totalPaidWei)} ETH
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                {supporter.lastPaymentAt && (
                                  <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                                    {formatTimeAgo(supporter.lastPaymentAt)}
                                  </span>
                                )}
                                {isOwner && (
                                  <svg
                                    className={`w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity ${
                                      isDark ? 'text-gray-400' : 'text-gray-500'
                                    }`}
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                )}
                              </div>
                            </div>
                            {supporter.latestMessage && (
                              <p className={`text-xs mt-2 truncate ${
                                isDark ? 'text-gray-500' : 'text-gray-400'
                              }`}>
                                "{supporter.latestMessage.content}"
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
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

        {/* Activity sidebar - desktop only */}
        <div className="hidden lg:flex w-[calc(38%*0.38)] min-w-[200px] h-full border-4 border-juice-orange flex-col">
          {/* Header */}
          <div className={`px-3 py-2 border-b flex items-center justify-between shrink-0 ${
            isDark ? 'border-white/10' : 'border-gray-200'
          }`}>
            <h2 className={`text-sm font-semibold whitespace-nowrap ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}>
              Live juicy activity
            </h2>
          </div>

          {/* Activity list */}
          <div className="flex-1 overflow-y-auto px-4 hide-scrollbar">
            <ProtocolActivity onProjectClick={handleActivityProjectClick} />
          </div>
        </div>

        {/* Modals */}
        {activeModal === 'pay' && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setActiveModal(null)}
            />
            <div className={`relative w-full max-w-md max-h-[90vh] overflow-y-auto ${
              isDark ? 'bg-juice-dark' : 'bg-white'
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
              <ProjectCard projectId={String(projectId)} chainId={String(chainId)} />
            </div>
          </div>,
          document.body
        )}

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
          <div className="flex items-start gap-4">
            {project.logoUri ? (
              <img
                src={resolveIpfsUri(project.logoUri) || undefined}
                alt=""
                className="w-14 h-14 rounded-full object-cover"
              />
            ) : (
              <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl ${
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
              <div className="flex items-center gap-2 mt-1">
                {chain && (
                  <span
                    className="px-2 py-0.5 text-xs font-medium rounded-full"
                    style={{ backgroundColor: chain.color + '20', color: chain.color }}
                  >
                    {chain.shortName}
                  </span>
                )}
                <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  #{projectId}
                </span>
              </div>
            </div>
            {/* Pay button */}
            <button
              onClick={() => setActiveModal('pay')}
              className="px-4 py-2 bg-green-500 text-black text-sm font-medium hover:bg-green-400 transition-colors shrink-0"
            >
              Pay
            </button>
          </div>

          {/* Owner info */}
          {project.owner && (
            <div className={`flex items-center gap-1.5 mt-3 text-xs ${
              isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              <span>{t('project.owner', 'Owner')}:</span>
              <a
                href={chain ? `${chain.explorer}/address/${project.owner}` : '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={`font-mono hover:underline ${
                  isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {project.owner.slice(0, 6)}...{project.owner.slice(-4)}
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

      {/* Tab navigation */}
      <div className="px-4">
        <div className={`flex border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'overview'
                ? isDark
                  ? 'text-white border-b-2 border-juice-orange'
                  : 'text-gray-900 border-b-2 border-juice-orange'
                : isDark
                  ? 'text-gray-400 hover:text-gray-200'
                  : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('project.overview', 'Overview')}
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'payments'
                ? isDark
                  ? 'text-white border-b-2 border-juice-orange'
                  : 'text-gray-900 border-b-2 border-juice-orange'
                : isDark
                  ? 'text-gray-400 hover:text-gray-200'
                  : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('project.paymentsReceived', 'Payments received')}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
        {/* Overview tab */}
        {activeTab === 'overview' && (
          <>
            {project.description && (
              <p className={`text-sm whitespace-pre-line ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                {stripHtmlTags(project.description)}
              </p>
            )}

            {/* Stats cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className={`p-3 border ${
                isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
              }`}>
                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('project.volume', 'Volume')}
                </div>
                <div className={`text-sm font-semibold mt-0.5 ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}>
                  {formatEth(project.volume || '0')} ETH
                </div>
              </div>
              <div className={`p-3 border ${
                isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
              }`}>
                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('project.paymentsCount', 'Payments')}
                </div>
                <div className={`text-sm font-semibold mt-0.5 ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}>
                  {project.paymentsCount || 0}
                </div>
              </div>
              <div className={`p-3 border ${
                isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
              }`}>
                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('project.balance', 'Balance')}
                </div>
                <div className={`text-sm font-semibold mt-0.5 ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}>
                  {formatEth(project.balance || '0')} ETH
                </div>
              </div>
            </div>

            {/* Charts - stacked on mobile */}
            <div className="space-y-4">
              <BalanceChart projectId={String(projectId)} chainId={String(chainId)} />
              <VolumeChart projectId={String(projectId)} chainId={String(chainId)} />
            </div>

            {/* Ruleset Schedule */}
            <RulesetSchedule projectId={String(projectId)} chainId={String(chainId)} />

            {/* Activity Feed */}
            <ActivityFeed projectId={String(projectId)} chainId={String(chainId)} limit={5} />

            {/* Owner Actions */}
            {isOwner && (
              <div className={`p-4 border ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                <h3 className={`text-sm font-semibold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Owner Actions
                </h3>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => setActiveModal('payouts')}
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                      isDark
                        ? 'bg-juice-orange/20 text-juice-orange hover:bg-juice-orange/30'
                        : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                    }`}
                  >
                    Send Payouts
                  </button>
                  <button
                    onClick={() => setActiveModal('ruleset')}
                    className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                      isDark
                        ? 'bg-juice-cyan/20 text-juice-cyan hover:bg-juice-cyan/30'
                        : 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200'
                    }`}
                  >
                    Queue Ruleset
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Payments received tab */}
        {activeTab === 'payments' && (
          <>
            {supportersLoading ? (
              <div className={`p-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <div className="w-6 h-6 border-2 border-juice-orange border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-sm">{t('ui.loading', 'Loading...')}</p>
              </div>
            ) : supporters.length === 0 ? (
              <div className={`p-8 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                <p className="text-sm">{t('project.noSupporters', 'No payments yet')}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <span className={`text-xs font-medium ${
                    isDark ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    {t('project.supporters', 'Supporters')} ({supportersTotal})
                  </span>
                </div>

                <div className="space-y-2">
                  {supporters.map(supporter => (
                    <div
                      key={supporter.id}
                      onClick={() => handleSupporterClick(supporter.chatId)}
                      className={`group p-4 border transition-colors ${
                        isOwner
                          ? isDark
                            ? 'border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 cursor-pointer'
                            : 'border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-gray-100 cursor-pointer'
                          : isDark
                            ? 'border-white/10 bg-white/5'
                            : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${
                            isDark ? 'text-white' : 'text-gray-900'
                          }`}>
                            {supporter.supporterAddress.slice(0, 6)}...{supporter.supporterAddress.slice(-4)}
                          </div>
                          <div className={`text-xs mt-0.5 ${
                            isDark ? 'text-gray-400' : 'text-gray-500'
                          }`}>
                            {supporter.paymentCount} {supporter.paymentCount === 1 ? 'payment' : 'payments'}
                            {' · '}
                            {formatEth(supporter.totalPaidWei)} ETH
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {supporter.lastPaymentAt && (
                            <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              {formatTimeAgo(supporter.lastPaymentAt)}
                            </span>
                          )}
                          {isOwner && (
                            <svg
                              className={`w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity ${
                                isDark ? 'text-gray-400' : 'text-gray-500'
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </div>
                      </div>
                      {supporter.latestMessage && (
                        <p className={`text-xs mt-2 truncate ${
                          isDark ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                          "{supporter.latestMessage.content}"
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
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
      {activeModal === 'pay' && createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setActiveModal(null)}
          />
          <div className={`relative w-full max-h-[90vh] overflow-y-auto ${
            isDark ? 'bg-juice-dark' : 'bg-white'
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
            <ProjectCard projectId={String(projectId)} chainId={String(chainId)} />
          </div>
        </div>,
        document.body
      )}

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
