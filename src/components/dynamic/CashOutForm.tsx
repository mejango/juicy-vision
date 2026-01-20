import { useState, useEffect } from 'react'
import { useWallet, useModal } from '@getpara/react-sdk'
import { useThemeStore } from '../../stores'
import { fetchProject, fetchIssuanceRate, type Project, type IssuanceRate } from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { CashOutModal } from '../payment'

interface CashOutFormProps {
  projectId: string
  chainId?: string
}

const CHAIN_INFO: Record<string, { name: string; slug: string }> = {
  '1': { name: 'Ethereum', slug: 'eth' },
  '10': { name: 'Optimism', slug: 'op' },
  '8453': { name: 'Base', slug: 'base' },
  '42161': { name: 'Arbitrum', slug: 'arb' },
}

export default function CashOutForm({ projectId, chainId = '1' }: CashOutFormProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [issuanceRate, setIssuanceRate] = useState<IssuanceRate | null>(null)
  const [loading, setLoading] = useState(true)
  const [tokenAmount, setTokenAmount] = useState('')
  const [showModal, setShowModal] = useState(false)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const { data: wallet } = useWallet()
  const { openModal } = useModal()
  const isConnected = !!wallet?.address

  const chainInfo = CHAIN_INFO[chainId] || CHAIN_INFO['1']

  // Fetch project data
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const [data, rate] = await Promise.all([
          fetchProject(projectId, parseInt(chainId)),
          fetchIssuanceRate(projectId, parseInt(chainId)),
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
  }, [projectId, chainId])

  // Calculate estimated return (in whatever currency the project holds)
  const tokenNum = parseFloat(tokenAmount) || 0
  const estimatedReturn = issuanceRate && tokenNum > 0
    ? tokenNum / issuanceRate.tokensPerEth
    : 0

  const handleCashOut = () => {
    if (!tokenAmount || parseFloat(tokenAmount) <= 0) return

    if (!isConnected) {
      openModal()
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
          <span className={`px-2 py-0.5 text-xs font-medium ${isDark ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
            {chainInfo.name}
          </span>
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
              Estimated return: ~{estimatedReturn.toFixed(4)}
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
        chainId={parseInt(chainId)}
        tokenAmount={tokenAmount}
        estimatedReturn={estimatedReturn}
      />
    </div>
  )
}
