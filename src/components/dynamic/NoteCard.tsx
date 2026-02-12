import { useEffect, useState, useMemo, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { createPublicClient, http, formatEther, erc20Abi } from 'viem'
import { useTranslation } from 'react-i18next'
import { fetchProject, fetchConnectedChains, fetchIssuanceRate, fetchProjectTokenSymbol, type Project, type ConnectedChain, type IssuanceRate } from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { useThemeStore, useTransactionStore } from '../../stores'
import { VIEM_CHAINS, USDC_ADDRESSES, RPC_ENDPOINTS, type SupportedChainId } from '../../constants'

interface NoteCardProps {
  projectId: string
  chainId?: string
  defaultNote?: string
}

const CHAIN_INFO: Record<string, { name: string; slug: string }> = {
  '1': { name: 'Ethereum', slug: 'eth' },
  '10': { name: 'Optimism', slug: 'op' },
  '8453': { name: 'Base', slug: 'base' },
  '42161': { name: 'Arbitrum', slug: 'arb' },
}

const ALL_CHAINS: Array<{ chainId: number; projectId: number }> = [
  { chainId: 1, projectId: 0 },
  { chainId: 10, projectId: 0 },
  { chainId: 8453, projectId: 0 },
  { chainId: 42161, projectId: 0 },
]

export default function NoteCard({ projectId, chainId: initialChainId = '1', defaultNote = '' }: NoteCardProps) {
  const { t } = useTranslation()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState(defaultNote)
  const [amount, setAmount] = useState('0')
  const [selectedToken, setSelectedToken] = useState('ETH')
  const [sending, setSending] = useState(false)
  const [selectedChainId, setSelectedChainId] = useState(initialChainId)
  const [connectedChains, setConnectedChains] = useState<ConnectedChain[]>([])
  const [showPaymentOptions, setShowPaymentOptions] = useState(false)
  const [issuanceRate, setIssuanceRate] = useState<IssuanceRate | null>(null)
  const [projectTokenSymbol, setProjectTokenSymbol] = useState<string | null>(null)
  const [walletEthBalance, setWalletEthBalance] = useState<bigint | null>(null)
  const [walletUsdcBalance, setWalletUsdcBalance] = useState<bigint | null>(null)
  const [payUs, setPayUs] = useState(true)
  const [juicyIssuanceRate, setJuicyIssuanceRate] = useState<IssuanceRate | null>(null)
  const { theme } = useThemeStore()
  const { addTransaction } = useTransactionStore()
  const isDark = theme === 'dark'
  const { address, isConnected } = useAccount()

  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  const availableChains = connectedChains.length > 0 ? connectedChains : ALL_CHAINS
  const chainData = availableChains.find(c => c.chainId === parseInt(selectedChainId))
  const currentProjectId = (chainData?.projectId && chainData.projectId !== 0)
    ? chainData.projectId.toString()
    : projectId
  const selectedChainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO['1']

  // JUICY fee configuration
  const JUICY_PROJECT_ID = 1
  const JUICY_FEE_PERCENT = 2.5

  // Fetch connected chains
  useEffect(() => {
    async function loadConnectedChains() {
      const chains = await fetchConnectedChains(projectId, parseInt(initialChainId))
      setConnectedChains(chains)
    }
    loadConnectedChains()
  }, [projectId, initialChainId])

  // Fetch project data
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const chainIdNum = parseInt(selectedChainId)
        const [data, rate, tokenSymbol] = await Promise.all([
          fetchProject(currentProjectId, chainIdNum),
          fetchIssuanceRate(currentProjectId, chainIdNum),
          fetchProjectTokenSymbol(currentProjectId, chainIdNum),
        ])
        setProject(data)
        setIssuanceRate(rate)
        setProjectTokenSymbol(tokenSymbol)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentProjectId, selectedChainId])

  // Fetch JUICY issuance rate when chain changes
  useEffect(() => {
    fetchIssuanceRate(String(JUICY_PROJECT_ID), parseInt(selectedChainId))
      .then(setJuicyIssuanceRate)
      .catch(() => setJuicyIssuanceRate(null))
  }, [selectedChainId])

  // Fetch wallet balances
  const fetchWalletBalances = useCallback(async () => {
    if (!address) return

    const chainIdNum = parseInt(selectedChainId)
    const chain = VIEM_CHAINS[chainIdNum as SupportedChainId]
    if (!chain) return

    try {
      const rpcUrl = RPC_ENDPOINTS[chainIdNum]?.[0]
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      })

      const ethBalance = await publicClient.getBalance({
        address: address as `0x${string}`,
      })
      setWalletEthBalance(ethBalance)

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
    }
  }, [address, selectedChainId])

  useEffect(() => {
    fetchWalletBalances()
  }, [fetchWalletBalances])

  // Calculate expected tokens
  const expectedTokens = useMemo(() => {
    if (!issuanceRate || !amount || parseFloat(amount) <= 0) return null
    try {
      const amountFloat = parseFloat(amount)
      const paymentInWei = selectedToken === 'ETH'
        ? amountFloat * 1e18
        : amountFloat * 1e6
      const tokensWei = paymentInWei * issuanceRate.tokensPerEth
      const tokens = tokensWei / 1e18
      if (tokens < 0.001) return null
      return tokens
    } catch {
      return null
    }
  }, [amount, issuanceRate, selectedToken])

  const handleSend = async () => {
    if (!note.trim()) return

    if (!isConnected) {
      openWalletPanel()
      return
    }

    // Check balance for non-zero payments
    const amountNum = parseFloat(amount) || 0
    if (amountNum > 0) {
      await fetchWalletBalances()
      if (selectedToken === 'ETH') {
        const ethBalanceNum = walletEthBalance ? parseFloat(formatEther(walletEthBalance)) : 0
        if (ethBalanceNum < amountNum + 0.001) {
          openWalletPanel()
          return
        }
      } else {
        const usdcBalanceNum = walletUsdcBalance ? Number(walletUsdcBalance) / 1e6 : 0
        if (usdcBalanceNum < amountNum) {
          openWalletPanel()
          return
        }
      }
    }

    setSending(true)
    try {
      const txId = addTransaction({
        type: 'pay',
        projectId: currentProjectId,
        chainId: parseInt(selectedChainId),
        amount: amountNum > 0 ? amount : '0',
        token: selectedToken,
        status: 'pending',
      })

      window.dispatchEvent(new CustomEvent('juice:pay-project', {
        detail: {
          txId,
          projectId: currentProjectId,
          chainId: parseInt(selectedChainId),
          amount: amountNum > 0 ? amount : '0',
          token: selectedToken,
          memo: note,
          payUs: false,
          feeAmount: '0',
        }
      }))
      setNote('')
      setAmount('0')
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return (
      <div className="glass p-4 animate-pulse">
        <div className="h-6 bg-white/10 w-3/4 mb-3" />
        <div className="h-20 bg-white/10 w-full" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="glass p-4 border-red-500/30">
        <p className="text-red-400 text-sm">{error || 'Project not found'}</p>
      </div>
    )
  }

  const logoUrl = resolveIpfsUri(project.logoUri)
  const projectUrl = `https://juicebox.money/v5/${selectedChainInfo.slug}:${currentProjectId}`
  const amountNum = parseFloat(amount) || 0

  // Calculate fee and JUICY tokens
  const feeAmount = payUs && amountNum > 0 ? amountNum * (JUICY_FEE_PERCENT / 100) : 0
  const estimatedJuicyTokens = payUs && juicyIssuanceRate && feeAmount > 0
    ? feeAmount * juicyIssuanceRate.tokensPerEth
    : 0

  return (
    <div className="w-full">
      <div className={`max-w-md border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Compact header */}
        <div className="flex items-center gap-2 mb-3">
          {logoUrl ? (
            <img src={logoUrl} alt={project.name} className="w-8 h-8 object-cover" />
          ) : (
            <div className="w-8 h-8 bg-juice-orange/20 flex items-center justify-center">
              <span className="text-juice-orange font-bold text-sm">{project.name.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <a
              href={projectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-sm font-medium hover:underline ${isDark ? 'text-white' : 'text-gray-900'}`}
            >
              {project.name}
            </a>
          </div>
          {/* Chain selector - compact */}
          <select
            value={selectedChainId}
            onChange={(e) => setSelectedChainId(e.target.value)}
            className={`text-xs px-2 py-1 border ${
              isDark
                ? 'bg-juice-dark border-white/10 text-gray-300'
                : 'bg-white border-gray-200 text-gray-600'
            }`}
          >
            {availableChains.map(chain => {
              const info = CHAIN_INFO[chain.chainId.toString()]
              if (!info) return null
              return (
                <option key={chain.chainId} value={chain.chainId.toString()}>
                  {info.name}
                </option>
              )
            })}
          </select>
        </div>

        {/* Note input - PRIMARY FOCUS */}
        <div className="mb-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('note.placeholder', 'Write your note...')}
            rows={3}
            className={`w-full px-3 py-2 text-sm outline-none resize-none border ${
              isDark
                ? 'bg-juice-dark border-juice-cyan/30 text-white placeholder-gray-500 focus:border-juice-cyan'
                : 'bg-white border-teal-300 text-gray-900 placeholder-gray-400 focus:border-teal-500'
            }`}
          />
        </div>

        {/* Payment toggle */}
        <div className="mb-3 pt-1">
          <button
            onClick={() => setShowPaymentOptions(!showPaymentOptions)}
            className={`flex items-center gap-2 text-xs py-1 ${
              isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
            }`}
          >
            <svg className={`w-3 h-3 transition-transform ${showPaymentOptions ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {amountNum > 0
              ? t('note.withPayment', 'With {{amount}} {{token}} payment', { amount, token: selectedToken })
              : t('note.addPayment', 'Add a payment (optional)')}
          </button>

          {showPaymentOptions && (
            <div className={`mt-2 p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              {/* Amount with token */}
              <div className="flex gap-2 mb-2">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className={`flex-1 px-3 py-2 text-sm outline-none border ${
                    isDark
                      ? 'bg-juice-dark border-white/10 text-white placeholder-gray-500'
                      : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                  }`}
                />
                <select
                  value={selectedToken}
                  onChange={(e) => setSelectedToken(e.target.value)}
                  className={`px-2 py-2 text-sm border ${
                    isDark
                      ? 'bg-juice-dark border-white/10 text-white'
                      : 'bg-white border-gray-200 text-gray-900'
                  }`}
                >
                  <option value="ETH">ETH</option>
                  <option value="USDC">USDC</option>
                </select>
              </div>

              {/* Quick amounts */}
              <div className="flex gap-2 flex-wrap">
                {(selectedToken === 'USDC' ? ['0', '1', '5', '10'] : ['0', '0.001', '0.01', '0.05']).map(val => (
                  <button
                    key={val}
                    onClick={() => setAmount(val)}
                    className={`px-3 py-1.5 text-xs transition-colors ${
                      amount === val
                        ? isDark ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-900'
                        : isDark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-150'
                    }`}
                  >
                    {val === '0' ? t('note.free', 'Free') : val}
                  </button>
                ))}
              </div>

              {/* Token preview */}
              {amountNum > 0 && expectedTokens !== null && (
                <div className={`mt-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  → ~{expectedTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${projectTokenSymbol || project.name.split(' ')[0].toUpperCase().slice(0, 6)}
                </div>
              )}

              {/* Pay JUICY checkbox - only show when payment > 0 */}
              {amountNum > 0 && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  <label
                    className={`flex items-center gap-2 cursor-pointer text-xs ${
                      isDark ? 'text-gray-300' : 'text-gray-600'
                    }`}
                    title="Help us keep building"
                  >
                    <input
                      type="checkbox"
                      checked={payUs}
                      onChange={(e) => setPayUs(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-juice-orange focus:ring-juice-orange"
                    />
                    <span>{t('note.joinJuicy', 'Pay for Juicy (+{{percent}}%)', { percent: JUICY_FEE_PERCENT })}</span>
                  </label>
                  {payUs && estimatedJuicyTokens > 0 && (
                    <div className={`ml-6 mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {feeAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {selectedToken} → ~{estimatedJuicyTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} $JUICY
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={sending || !note.trim()}
          className={`w-full py-2.5 text-sm font-medium transition-colors ${
            sending || !note.trim()
              ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
              : isDark
                ? 'bg-juice-cyan hover:bg-juice-cyan/90 text-black'
                : 'bg-teal-500 hover:bg-teal-600 text-white'
          }`}
        >
          {sending
            ? '...'
            : amountNum > 0
              ? t('note.sendWithPayment', 'Send note with {{amount}} {{token}}', { amount, token: selectedToken })
              : t('note.send', 'Send note')}
        </button>
      </div>
    </div>
  )
}
