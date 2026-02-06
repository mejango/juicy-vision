import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../stores'
import { useManagedWallet } from '../hooks'
import { CHAINS } from '../constants'
import { fetchProject, type Project } from '../services/bendystraw'
import { getProjectSupporters, type ProjectConversation } from '../api/projectConversations'
import { getWalletSession } from '../services/siwe'
import { resolveIpfsUri } from '../utils/ipfs'
import { formatUnits } from 'viem'

type DashboardTab = 'overview' | 'payments'

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

export default function ProjectDashboard({ chainId, projectId }: ProjectDashboardProps) {
  const { theme } = useThemeStore()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [project, setProject] = useState<Project | null>(null)
  const [projectLoading, setProjectLoading] = useState(true)
  const [supporters, setSupporters] = useState<ProjectConversation[]>([])
  const [supportersLoading, setSupportersLoading] = useState(false)
  const [supportersLoaded, setSupportersLoaded] = useState(false)
  const [supportersTotal, setSupportersTotal] = useState(0)

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
        const data = await fetchProject(String(projectId), chainId)
        setProject(data)
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

  if (projectLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        theme === 'dark' ? 'bg-juice-dark' : 'bg-white'
      }`}>
        <div className="w-8 h-8 border-2 border-juice-orange border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${
        theme === 'dark' ? 'bg-juice-dark text-white' : 'bg-white text-gray-900'
      }`}>
        <div className="text-center max-w-md px-4">
          <h1 className="text-xl font-semibold mb-2">{t('project.notFound', 'Project not found')}</h1>
          <p className={`text-sm mb-6 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
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

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-juice-dark' : 'bg-white'}`}>
      {/* Header with back button */}
      <div className={`sticky top-0 z-40 backdrop-blur-sm border-b ${
        theme === 'dark' ? 'bg-juice-dark/80 border-white/10' : 'bg-white/80 border-gray-200'
      }`}>
        <div className="max-w-4xl mx-auto px-4 py-4">
          <button
            onClick={handleBackClick}
            className={`flex items-center gap-2 text-sm mb-4 transition-colors ${
              theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
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
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl ${
                theme === 'dark' ? 'bg-white/10' : 'bg-gray-200'
              }`}>
                🍊
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className={`text-xl font-semibold truncate ${
                theme === 'dark' ? 'text-white' : 'text-gray-900'
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
                <span className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  #{projectId}
                </span>
              </div>
              {/* Owner address */}
              {project.owner && (
                <div className={`flex items-center gap-1.5 mt-2 text-xs ${
                  theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                }`}>
                  <span>{t('project.owner', 'Owner')}:</span>
                  <a
                    href={chain ? `${chain.explorer}/address/${project.owner}` : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`font-mono hover:underline ${
                      theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
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
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="max-w-4xl mx-auto px-4">
        <div className={`flex border-b ${theme === 'dark' ? 'border-white/10' : 'border-gray-200'}`}>
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'overview'
                ? theme === 'dark'
                  ? 'text-white border-b-2 border-juice-orange'
                  : 'text-gray-900 border-b-2 border-juice-orange'
                : theme === 'dark'
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
                ? theme === 'dark'
                  ? 'text-white border-b-2 border-juice-orange'
                  : 'text-gray-900 border-b-2 border-juice-orange'
                : theme === 'dark'
                  ? 'text-gray-400 hover:text-gray-200'
                  : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('project.paymentsReceived', 'Payments received')}
          </button>
        </div>

        {/* Overview tab */}
        {activeTab === 'overview' && (
          <div className="py-6">
            {project.description && (
              <p className={`text-sm mb-6 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                {project.description}
              </p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {/* Stats cards */}
              <div className={`p-4 border ${
                theme === 'dark' ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
              }`}>
                <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('project.volume', 'Total volume')}
                </div>
                <div className={`text-lg font-semibold mt-1 ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  {formatEth(project.volume || '0')} ETH
                </div>
              </div>

              <div className={`p-4 border ${
                theme === 'dark' ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
              }`}>
                <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('project.paymentsCount', 'Payments')}
                </div>
                <div className={`text-lg font-semibold mt-1 ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  {project.paymentsCount || 0}
                </div>
              </div>

              <div className={`p-4 border ${
                theme === 'dark' ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
              }`}>
                <div className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  {t('project.balance', 'Balance')}
                </div>
                <div className={`text-lg font-semibold mt-1 ${
                  theme === 'dark' ? 'text-white' : 'text-gray-900'
                }`}>
                  {formatEth(project.balance || '0')} ETH
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Payments received tab */}
        {activeTab === 'payments' && (
          <div className="py-6">
            {supportersLoading ? (
              <div className={`p-8 text-center ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                <div className="w-6 h-6 border-2 border-juice-orange border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-sm">{t('ui.loading', 'Loading...')}</p>
              </div>
            ) : supporters.length === 0 ? (
              <div className={`p-8 text-center ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                <p className="text-sm">{t('project.noSupporters', 'No payments yet')}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <span className={`text-xs font-medium ${
                    theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
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
                          ? theme === 'dark'
                            ? 'border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 cursor-pointer'
                            : 'border-gray-200 hover:border-gray-300 bg-gray-50 hover:bg-gray-100 cursor-pointer'
                          : theme === 'dark'
                            ? 'border-white/10 bg-white/5'
                            : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${
                            theme === 'dark' ? 'text-white' : 'text-gray-900'
                          }`}>
                            {supporter.supporterAddress.slice(0, 6)}...{supporter.supporterAddress.slice(-4)}
                          </div>
                          <div className={`text-xs mt-0.5 ${
                            theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                          }`}>
                            {supporter.paymentCount} {supporter.paymentCount === 1 ? 'payment' : 'payments'}
                            {' · '}
                            {formatEth(supporter.totalPaidWei)} ETH
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {supporter.lastPaymentAt && (
                            <span className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                              {formatTimeAgo(supporter.lastPaymentAt)}
                            </span>
                          )}
                          {isOwner && (
                            <svg
                              className={`w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity ${
                                theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
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
                          theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
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
  )
}
