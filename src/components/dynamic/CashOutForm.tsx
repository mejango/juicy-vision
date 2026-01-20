import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import { fetchProject, fetchIssuanceRate, fetchConnectedChains, type Project, type IssuanceRate, type ConnectedChain } from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { CashOutModal } from '../payment'
import { CHAINS, ALL_CHAIN_IDS, CURRENCIES } from '../../constants'

interface CashOutFormProps {
  projectId: string
  chainId?: string
}

export default function CashOutForm({ projectId, chainId: initialChainId = '1' }: CashOutFormProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [issuanceRate, setIssuanceRate] = useState<IssuanceRate | null>(null)
  const [loading, setLoading] = useState(true)
  const [tokenAmount, setTokenAmount] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [selectedChainId, setSelectedChainId] = useState(initialChainId)
  const [connectedChains, setConnectedChains] = useState<ConnectedChain[]>([])
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const { isConnected } = useAccount()

  const chainInfo = CHAINS[parseInt(selectedChainId)] || CHAINS[1]

  // Determine currency from project's baseCurrency
  const baseCurrency = project?.baseCurrency || 1
  const currencySymbol = baseCurrency === 2 ? 'USDC' : 'ETH'

  // Use connected chains if available, otherwise fall back to single chain
  const availableChains = connectedChains.length > 0
    ? connectedChains
    : [{ chainId: parseInt(initialChainId), projectId: parseInt(projectId) }]

  // Fetch project data and connected chains
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const chainIdNum = parseInt(selectedChainId)

        // Fetch connected chains first
        const chains = await fetchConnectedChains(projectId, chainIdNum)
        setConnectedChains(chains)

        // Fetch project data for selected chain
        const [data, rate] = await Promise.all([
          fetchProject(projectId, chainIdNum),
          fetchIssuanceRate(projectId, chainIdNum),
        ])
        setProject(data)
        setIssuanceRate(rate)
      } catch (err) {
        console.error('Failed to load project:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, selectedChainId])

  // Calculate estimated return (in whatever currency the project holds)
  const tokenNum = parseFloat(tokenAmount) || 0
  const estimatedReturn = issuanceRate && tokenNum > 0
    ? tokenNum / issuanceRate.tokensPerEth
    : 0

  // Dispatch event to open wallet panel
  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  const handleCashOut = () => {
    if (!tokenAmount || parseFloat(tokenAmount) <= 0) return

    if (!isConnected) {
      openWalletPanel()
      return
    }

    setShowModal(true)
  }

  if (loading) {
    return (
      <div className="w-full">
        <div className={`max-w-md border p-4 animate-pulse ${
          isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
        }`}>
          <div className="h-6 bg-white/10 w-3/4 mb-3" />
          <div className="h-4 bg-white/10 w-1/2" />
        </div>
      </div>
    )
  }

  const logoUrl = project?.logoUri ? resolveIpfsUri(project.logoUri) : null
  const projectUrl = `https://juicebox.money/v5/${chainInfo.slug}:${projectId}`

  return (
    <div className="w-full">
      <div className={`max-w-md border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          {logoUrl ? (
            <img src={logoUrl} alt={project?.name || 'Project'} className="w-14 h-14 object-cover" />
          ) : (
            <div className="w-14 h-14 bg-juice-cyan/20 flex items-center justify-center">
              <span className="text-2xl">🔄</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Cash Out
            </h3>
            <a
              href={projectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-xs hover:underline ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
            >
              {project?.name || `Project #${projectId}`}
            </a>
          </div>
          {/* Chain selector - show dropdown if multiple chains available */}
          {availableChains.length > 1 ? (
            <div className="relative">
              <button
                onClick={() => setChainDropdownOpen(!chainDropdownOpen)}
                className={`px-2 py-0.5 text-xs font-medium flex items-center gap-1 ${
                  isDark ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {chainInfo.shortName}
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {chainDropdownOpen && (
                <div className={`absolute right-0 mt-1 py-1 min-w-[120px] border z-10 ${
                  isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
                }`}>
                  {availableChains.map(chain => {
                    const info = CHAINS[chain.chainId]
                    if (!info) return null
                    return (
                      <button
                        key={chain.chainId}
                        onClick={() => {
                          setSelectedChainId(String(chain.chainId))
                          setChainDropdownOpen(false)
                        }}
                        className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 ${
                          selectedChainId === String(chain.chainId)
                            ? isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900'
                            : isDark ? 'text-gray-300 hover:bg-white/5' : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: info.color }} />
                        {info.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <span className={`px-2 py-0.5 text-xs font-medium ${isDark ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
              {chainInfo.shortName}
            </span>
          )}
        </div>

        {/* Form */}
        <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
          <div className={`text-sm font-medium mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Burn tokens for funds
          </div>

          {/* Amount input */}
          <div className="flex gap-2">
            <div className={`flex-1 flex items-center ${
              isDark
                ? 'bg-juice-dark border border-white/10'
                : 'bg-white border border-gray-200'
            }`}>
              <input
                type="number"
                step="1"
                min="0"
                value={tokenAmount}
                onChange={(e) => setTokenAmount(e.target.value)}
                placeholder="10000"
                className={`flex-1 px-3 py-2 text-sm bg-transparent outline-none ${
                  isDark ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                }`}
              />
              <span className={`px-3 py-2 text-sm border-l ${
                isDark ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'
              }`}>
                tokens
              </span>
            </div>
            <button
              onClick={handleCashOut}
              disabled={!tokenAmount || parseFloat(tokenAmount) <= 0}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                !tokenAmount || parseFloat(tokenAmount) <= 0
                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                  : 'bg-juice-cyan hover:bg-juice-cyan/90 text-black'
              }`}
            >
              Cash Out
            </button>
          </div>

          {/* Quick amount options */}
          <div className="flex gap-2 mt-2">
            {['1000', '10000', '100000', '1000000'].map(val => (
              <button
                key={val}
                onClick={() => setTokenAmount(val)}
                className={`flex-1 px-2 py-1 text-xs transition-colors ${
                  tokenAmount === val
                    ? isDark ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-900'
                    : isDark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-150'
                }`}
              >
                {parseInt(val).toLocaleString()}
              </button>
            ))}
          </div>

          {/* Estimated return */}
          {tokenNum > 0 && estimatedReturn > 0 && (
            <div className={`mt-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Estimated return: ~{estimatedReturn.toFixed(baseCurrency === 2 ? 2 : 4)} {currencySymbol}
            </div>
          )}
        </div>

        {/* Info */}
        <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Burn your tokens to receive funds from the project. Amount depends on balance and cash out tax rate.
        </p>
      </div>

      {/* Modal */}
      <CashOutModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        projectId={projectId}
        projectName={project?.name}
        chainId={parseInt(selectedChainId)}
        tokenAmount={tokenAmount}
        estimatedReturn={estimatedReturn}
        currencySymbol={currencySymbol}
      />
    </div>
  )
}
