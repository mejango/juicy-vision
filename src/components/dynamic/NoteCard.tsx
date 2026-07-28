import { useEffect, useState, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { createPublicClient, http, formatEther, erc20Abi } from 'viem'
import { useTranslation } from 'react-i18next'
import {
  fetchProject,
  fetchProjectAccountingContexts,
  type Project,
  type ConnectedChain,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { useThemeStore, useTransactionStore, useViewAsStore } from '../../stores'
import { VIEM_CHAINS, USDC_ADDRESSES, RPC_ENDPOINTS, MAINNET_CHAINS, type SupportedChainId } from '../../constants'
import { ProjectLink } from './ProjectLink'
import { getPaymentTerminal, getPaymentTokenAddress } from '../../utils/paymentTerminal'
import { assertCurrentProjectPayConfigurationTrusted } from '../../utils/projectTrust'
import { resolveProjectChains } from '../../utils/projectChains'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'

interface NoteCardProps {
  projectId: string
  chainId?: string
  defaultNote?: string
}

const CHAIN_INFO = MAINNET_CHAINS as unknown as Record<string, { name: string; slug: string }>

type PaymentToken = 'ETH' | 'USDC'

export default function NoteCard({ projectId, chainId: initialChainId = '1', defaultNote = '' }: NoteCardProps) {
  const { t } = useTranslation()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState(defaultNote)
  const [amount, setAmount] = useState('0.001')
  const [selectedToken, setSelectedToken] = useState<PaymentToken>('ETH')
  const [paymentTokens, setPaymentTokens] = useState<PaymentToken[]>([])
  const [sending, setSending] = useState(false)
  const [selectedChainId, setSelectedChainId] = useState(initialChainId)
  const [connectedChains, setConnectedChains] = useState<ConnectedChain[]>([])
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [showPaymentOptions, setShowPaymentOptions] = useState(false)
  const [paymentSafetyError, setPaymentSafetyError] = useState<string | null>(null)
  const [paymentSafetyLoading, setPaymentSafetyLoading] = useState(true)
  const { theme } = useThemeStore()
  const { addTransaction, transactions } = useTransactionStore()
  const [activeTransactionId, setActiveTransactionId] = useState<string | null>(null)
  const isDark = theme === 'dark'
  const { address: connectedAddress, isConnected } = useAccount()
  // Balance display follows view-as; the pay write itself runs through the
  // executor's own wallet context and is refused while view-as is active.
  const viewAs = useViewAsStore(s => s.viewAs)
  const address = viewAs ?? connectedAddress

  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  const availableChains = connectedChains.length > 0
    ? connectedChains
    : [{ chainId: parseInt(initialChainId), projectId: parseInt(projectId) }]
  const chainData = availableChains.find(c => c.chainId === parseInt(selectedChainId))
  const currentProjectId = (chainData?.projectId && chainData.projectId !== 0)
    ? chainData.projectId.toString()
    : projectId
  const selectedChainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO['1']

  // Fetch connected chains
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

  // Fetch project data
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const chainIdNum = parseInt(selectedChainId)
        const data = await fetchProject(currentProjectId, chainIdNum)
        setProject(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentProjectId, selectedChainId])

  // Fetch wallet balances
  const fetchWalletBalances = useCallback(async () => {
    if (!address) return null

    const chainIdNum = parseInt(selectedChainId)
    const chain = VIEM_CHAINS[chainIdNum as SupportedChainId]
    if (!chain) return null

    try {
      const rpcUrl = RPC_ENDPOINTS[chainIdNum]?.[0]
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      })

      const ethBalance = await publicClient.getBalance({
        address: address as `0x${string}`,
      })

      const usdcAddress = USDC_ADDRESSES[chainIdNum as SupportedChainId]
      let usdcBalance: bigint | null = null
      if (usdcAddress) {
        usdcBalance = await publicClient.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        })
      }
      return { eth: ethBalance, usdc: usdcBalance }
    } catch (err) {
      console.error('Failed to fetch wallet balances:', err)
      return null
    }
  }, [address, selectedChainId])

  useEffect(() => {
    let cancelled = false
    async function verifyPaymentRoute() {
      setPaymentSafetyLoading(true)
      setPaymentSafetyError(null)
      setPaymentTokens([])
      try {
        const chainIdNum = parseInt(selectedChainId)
        const chain = VIEM_CHAINS[chainIdNum as SupportedChainId]
        const rpcUrl = RPC_ENDPOINTS[chainIdNum]?.[0]
        if (!chain || !rpcUrl) throw new Error('Unsupported payment chain')
        const client = createPublicClient({ chain, transport: http(rpcUrl) })
        const accountingContexts = await fetchProjectAccountingContexts(currentProjectId, chainIdNum)
        await assertCurrentProjectPayConfigurationTrusted({
          client,
          projectId: BigInt(currentProjectId),
        })
        const verified = (await Promise.all((['ETH', 'USDC'] as const).map(async candidate => {
          const token = getPaymentTokenAddress(candidate, chainIdNum)
          try {
            const terminal = await getPaymentTerminal(
              client,
              chainIdNum,
              BigInt(currentProjectId),
              token,
              'pay',
            )
            const directContext = accountingContexts.find(context => context.symbol === candidate)
            if (terminal.type === 'multi' && !directContext) {
              throw new Error(`${candidate} is not a live accounting context`)
            }
            return candidate
          } catch (error) {
            if (error instanceof Error && error.message === 'This project does not accept the selected payment token') {
              return null
            }
            throw error
          }
        }))).filter((token): token is PaymentToken => token !== null)
        if (verified.length === 0) throw new Error('This project has no recognized payment route')
        if (!cancelled) {
          setPaymentTokens(verified)
          setSelectedToken(current => verified.includes(current) ? current : verified[0])
        }
      } catch (err) {
        if (!cancelled) {
          setPaymentSafetyError(err instanceof Error ? err.message : 'Payment route not recognized')
        }
      } finally {
        if (!cancelled) setPaymentSafetyLoading(false)
      }
    }
    verifyPaymentRoute()
    return () => {
      cancelled = true
    }
  }, [currentProjectId, selectedChainId])

  const activeTransaction = activeTransactionId
    ? transactions.find(transaction => transaction.id === activeTransactionId)
    : undefined
  const paymentInProgress = activeTransaction?.status === 'pending' || activeTransaction?.status === 'submitted'

  useEffect(() => {
    if (!activeTransactionId || !activeTransaction) return
    if (activeTransaction.status === 'confirmed') {
      setNote('')
      setAmount(selectedToken === 'USDC' ? '1' : '0.001')
      setActiveTransactionId(null)
    } else if (
      activeTransaction.status === 'failed' ||
      activeTransaction.status === 'cancelled'
    ) {
      setActiveTransactionId(null)
    }
  }, [activeTransactionId, activeTransaction, selectedToken])

  const handleSend = async () => {
    if (paymentSafetyError || paymentSafetyLoading) return
    if (!paymentTokens.includes(selectedToken) || paymentInProgress) return
    if (!note.trim()) return
    if (!Number.isFinite(parseFloat(amount)) || parseFloat(amount) <= 0) return

    if (!isConnected) {
      openWalletPanel()
      return
    }

    // Check balance for non-zero payments
    const amountNum = parseFloat(amount) || 0
    if (amountNum > 0) {
      const balances = await fetchWalletBalances()
      if (!balances) return
      if (selectedToken === 'ETH') {
        const ethBalanceNum = parseFloat(formatEther(balances.eth))
        if (ethBalanceNum <= amountNum) {
          openWalletPanel()
          return
        }
      } else {
        const usdcBalanceNum = balances.usdc ? Number(balances.usdc) / 1e6 : 0
        if (usdcBalanceNum < amountNum) {
          openWalletPanel()
          return
        }
        if (balances.eth <= 0n) {
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
      setActiveTransactionId(txId)

      window.dispatchEvent(new CustomEvent('juice:pay-project', {
        detail: {
          txId,
          projectId: currentProjectId,
          chainId: parseInt(selectedChainId),
          amount: amountNum > 0 ? amount : '0',
          token: selectedToken,
          memo: note,
        }
      }))
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
  const amountNum = parseFloat(amount) || 0

  return (
    <div className="w-full">
      <div className={`max-w-md border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}
        {/* Compact header */}
        <div className="flex items-center gap-2 mb-3">
          {logoUrl ? (
            <IpfsImage uri={project.logoUri} alt={project.name} className="w-8 h-8 object-cover" fallback={<div className="w-8 h-8 bg-juice-orange/20" />} />
          ) : (
            <div className="w-8 h-8 bg-juice-orange/20 flex items-center justify-center">
              <span className="text-juice-orange font-bold text-sm">{project.name.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <ProjectLink chainSlug={selectedChainInfo.slug} projectId={currentProjectId} className={`text-sm font-medium hover:underline ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {project.name}
            </ProjectLink>
          </div>
          {/* Chain selector - compact */}
          <select
            value={selectedChainId}
            onChange={(e) => setSelectedChainId(e.target.value)}
            className={`text-xs select-caret pl-2 pr-6 py-1 border ${
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
            disabled={paymentInProgress}
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
              : t('note.addPayment', 'Payment details')}
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
                  disabled={paymentInProgress}
                  className={`flex-1 px-3 py-2 text-sm outline-none border ${
                    isDark
                      ? 'bg-juice-dark border-white/10 text-white placeholder-gray-500'
                      : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
                  }`}
                />
                <select
                  value={selectedToken}
                  onChange={(e) => setSelectedToken(e.target.value as PaymentToken)}
                  disabled={paymentInProgress}
                  className={`select-caret pl-2 pr-6 py-2 text-sm border ${
                    isDark
                      ? 'bg-juice-dark border-white/10 text-white'
                      : 'bg-white border-gray-200 text-gray-900'
                  }`}
                >
                  {paymentTokens.map(token => <option key={token} value={token}>{token}</option>)}
                </select>
              </div>

              {/* Quick amounts */}
              <div className="flex gap-2 flex-wrap">
                {(selectedToken === 'USDC' ? ['1', '5', '10', '25'] : ['0.001', '0.01', '0.05', '0.1']).map(val => (
                  <button
                    key={val}
                    onClick={() => setAmount(val)}
                    disabled={paymentInProgress}
                    className={`px-3 py-1.5 text-xs transition-colors ${
                      amount === val
                        ? isDark ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-900'
                        : isDark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-150'
                    }`}
                  >
                    {val}
                  </button>
                ))}
              </div>

            </div>
          )}
        </div>

        {paymentSafetyError && (
          <div className={`mb-3 border p-3 text-xs ${
            isDark
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}>
            {paymentSafetyError}. This payment is blocked.
          </div>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={paymentSafetyLoading || !!paymentSafetyError || sending || paymentInProgress || !note.trim() || amountNum <= 0}
          className={`w-full py-2.5 text-sm font-medium transition-colors ${
            paymentSafetyLoading || paymentSafetyError || sending || paymentInProgress || !note.trim() || amountNum <= 0
              ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
              : isDark
                ? 'bg-juice-cyan hover:bg-juice-cyan/90 text-black'
                : 'bg-teal-500 hover:bg-teal-600 text-white'
          }`}
        >
          {paymentSafetyLoading
            ? 'Checking...'
            : sending
            ? '...'
            : t('note.sendWithPayment', 'Send note with {{amount}} {{token}}', { amount, token: selectedToken })}
        </button>
      </div>
    </div>
  )
}
