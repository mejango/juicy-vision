import { useState, useEffect } from 'react'
import { useWallet, useModal } from '@getpara/react-sdk'
import { formatEther } from 'viem'
import { useThemeStore } from '../../stores'
import { fetchProject, fetchDistributablePayout, type Project, type DistributablePayout } from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { SendPayoutsModal } from '../payment'

interface SendPayoutsFormProps {
  projectId: string
  chainId?: string
}

const CHAIN_INFO: Record<string, { name: string; slug: string }> = {
  '1': { name: 'Ethereum', slug: 'eth' },
  '10': { name: 'Optimism', slug: 'op' },
  '8453': { name: 'Base', slug: 'base' },
  '42161': { name: 'Arbitrum', slug: 'arb' },
}

export default function SendPayoutsForm({ projectId, chainId = '1' }: SendPayoutsFormProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [distributablePayout, setDistributablePayout] = useState<DistributablePayout | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [showModal, setShowModal] = useState(false)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const { data: wallet } = useWallet()
  const { openModal } = useModal()
  const isConnected = !!wallet?.address

  const chainInfo = CHAIN_INFO[chainId] || CHAIN_INFO['1']

  // Fetch project data and distributable payout
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)

        const [projectData, payoutData] = await Promise.all([
          fetchProject(projectId, parseInt(chainId)),
          fetchDistributablePayout(projectId, parseInt(chainId))
        ])
        setProject(projectData)
        setDistributablePayout(payoutData)
      } catch (err) {
        console.error('Failed to load project:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainId])

  // Available balance for payouts (from payout limit, not total treasury)
  const availableBalance = (() => {
    if (distributablePayout) {
      try {
        return parseFloat(formatEther(distributablePayout.available))
      } catch {
        return 0
      }
    }
    // If we couldn't fetch payout limit data, return 0 (don't show balance as that's misleading)
    return 0
  })()

  // Check if payouts are disabled (no payout limit configured)
  const payoutsDisabled = distributablePayout ? distributablePayout.limit === 0n : false

  // Calculate fee and net payout
  const amountNum = parseFloat(amount) || 0
  const protocolFee = amountNum * 0.025
  const netPayout = amountNum - protocolFee

  const handleSendPayouts = () => {
    if (!amount || parseFloat(amount) <= 0) return

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
            <div className="w-14 h-14 bg-juice-orange/20 flex items-center justify-center">
              <span className="text-2xl">📤</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Distribute Payouts
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
          <div className="flex items-center justify-between mb-2">
            <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Send ETH to payout splits
            </div>
            <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Available: <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {payoutsDisabled ? 'N/A' : `${availableBalance.toFixed(4)} ETH`}
              </span>
            </div>
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
                step="0.01"
                min="0"
                max={availableBalance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="1.0"
                className={`flex-1 px-3 py-2 text-sm bg-transparent outline-none ${
                  isDark ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
                }`}
              />
              <span className={`px-3 py-2 text-sm border-l ${
                isDark ? 'border-white/10 text-gray-400' : 'border-gray-200 text-gray-500'
              }`}>
                ETH
              </span>
            </div>
            <button
              onClick={handleSendPayouts}
              disabled={!amount || parseFloat(amount) <= 0 || payoutsDisabled}
              className={`px-5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                !amount || parseFloat(amount) <= 0 || payoutsDisabled
                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                  : 'bg-juice-orange hover:bg-juice-orange/90 text-black'
              }`}
            >
              Send Payouts
            </button>
          </div>

          {/* Quick amount options */}
          <div className="flex gap-2 mt-2">
            {['0.1', '0.5', '1'].map(val => (
              <button
                key={val}
                onClick={() => setAmount(val)}
                className={`flex-1 px-2 py-1 text-xs transition-colors ${
                  amount === val
                    ? isDark ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-900'
                    : isDark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-150'
                }`}
              >
                {val}
              </button>
            ))}
            <button
              onClick={() => setAmount(availableBalance.toFixed(4))}
              disabled={availableBalance <= 0}
              className={`flex-1 px-2 py-1 text-xs transition-colors ${
                amount === availableBalance.toFixed(4)
                  ? isDark ? 'bg-juice-orange/30 text-juice-orange' : 'bg-orange-100 text-orange-700'
                  : availableBalance <= 0
                    ? 'bg-gray-500/20 text-gray-500 cursor-not-allowed'
                    : isDark ? 'bg-juice-orange/10 text-juice-orange hover:bg-juice-orange/20' : 'bg-orange-50 text-orange-600 hover:bg-orange-100'
              }`}
            >
              max
            </button>
          </div>

          {/* Fee preview */}
          {amountNum > 0 && (
            <div className={`mt-2 text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Net to splits: {netPayout.toFixed(4)} ETH <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>(2.5% protocol fee)</span>
            </div>
          )}
        </div>

        {/* Info */}
        <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {payoutsDisabled
            ? 'No payout limit is configured for this ruleset. Payouts are not available.'
            : distributablePayout && distributablePayout.limit > 0n
              ? 'Distribute funds up to the payout limit to the project\'s payout splits. A 2.5% protocol fee applies.'
              : 'Distribute treasury funds to the project\'s payout splits. A 2.5% protocol fee applies.'}
        </p>
      </div>

      {/* Modal */}
      <SendPayoutsModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        projectId={projectId}
        projectName={project?.name}
        chainId={parseInt(chainId)}
        amount={amount}
      />
    </div>
  )
}
