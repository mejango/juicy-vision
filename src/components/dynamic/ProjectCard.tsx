import { useEffect, useState, useMemo } from 'react'
import { fetchProject, fetchConnectedChains, fetchIssuanceRate, fetchSuckerGroupBalance, fetchOwnersCount, type Project, type ConnectedChain, type IssuanceRate } from '../../services/bendystraw'
import { resolveIpfsUri, fetchIpfsMetadata, type IpfsProjectMetadata } from '../../utils/ipfs'
import { useThemeStore, useTransactionStore } from '../../stores'

// Parse HTML/markdown description to clean text with line breaks
function parseDescription(html: string): string[] {
  // Replace <p> tags with newlines, strip other HTML
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<p>/gi, '')
    .replace(/<\/p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
}

interface ProjectCardProps {
  projectId: string
  chainId?: string
}

const CHAIN_INFO: Record<string, { name: string; slug: string }> = {
  '1': { name: 'Ethereum', slug: 'eth' },
  '10': { name: 'Optimism', slug: 'op' },
  '8453': { name: 'Base', slug: 'base' },
  '42161': { name: 'Arbitrum', slug: 'arb' },
}

// All chains as fallback when no sucker data available
const ALL_CHAINS: Array<{ chainId: number; projectId: number }> = [
  { chainId: 1, projectId: 0 },  // projectId 0 means use the prop value
  { chainId: 10, projectId: 0 },
  { chainId: 8453, projectId: 0 },
  { chainId: 42161, projectId: 0 },
]

const TOKENS = [
  { symbol: 'ETH', name: 'Ether' },
  { symbol: 'USDC', name: 'USD Coin' },
]

export default function ProjectCard({ projectId, chainId: initialChainId = '1' }: ProjectCardProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState('25')
  const [memo, setMemo] = useState('')
  const [paying, setPaying] = useState(false)
  const [selectedChainId, setSelectedChainId] = useState(initialChainId)
  const [selectedToken, setSelectedToken] = useState('USDC')
  const [chainDropdownOpen, setChainDropdownOpen] = useState(false)
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false)
  // Connected chains with their project IDs (may differ per chain)
  const [connectedChains, setConnectedChains] = useState<ConnectedChain[]>([])
  // Current issuance rate for token calculation
  const [issuanceRate, setIssuanceRate] = useState<IssuanceRate | null>(null)
  // Full metadata from IPFS (has complete description)
  const [fullMetadata, setFullMetadata] = useState<IpfsProjectMetadata | null>(null)
  // Total balance across sucker group
  const [totalBalance, setTotalBalance] = useState<string | null>(null)
  // Owners count (unique token holders with balance > 0)
  const [ownersCount, setOwnersCount] = useState<number | null>(null)
  const { theme } = useThemeStore()
  const { addTransaction } = useTransactionStore()
  const isDark = theme === 'dark'

  // Use connected chains if available, otherwise fall back to all chains
  const availableChains = connectedChains.length > 0 ? connectedChains : ALL_CHAINS

  // Get the current project ID for the selected chain (may differ from initial projectId)
  const chainData = availableChains.find(c => c.chainId === parseInt(selectedChainId))
  const currentProjectId = (chainData?.projectId && chainData.projectId !== 0)
    ? chainData.projectId.toString()
    : projectId
  const selectedChainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO['1']

  // Fetch connected chains on mount
  useEffect(() => {
    async function loadConnectedChains() {
      const chains = await fetchConnectedChains(projectId, parseInt(initialChainId))
      setConnectedChains(chains)
    }
    loadConnectedChains()
  }, [projectId, initialChainId])

  // Fetch project data and issuance rate when chain changes
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const chainIdNum = parseInt(selectedChainId)
        const [data, rate, groupBalance, owners] = await Promise.all([
          fetchProject(currentProjectId, chainIdNum),
          fetchIssuanceRate(currentProjectId, chainIdNum),
          fetchSuckerGroupBalance(currentProjectId, chainIdNum),
          fetchOwnersCount(currentProjectId, chainIdNum),
        ])
        setProject(data)
        setIssuanceRate(rate)
        setTotalBalance(groupBalance.totalBalance)
        setOwnersCount(owners)

        // Fetch full metadata from IPFS if metadataUri available
        if (data.metadataUri) {
          const ipfsMetadata = await fetchIpfsMetadata(data.metadataUri)
          setFullMetadata(ipfsMetadata)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentProjectId, selectedChainId])

  // Calculate expected tokens based on amount and issuance rate
  const expectedTokens = useMemo(() => {
    if (!issuanceRate || !amount || parseFloat(amount) <= 0) return null

    try {
      const amountFloat = parseFloat(amount)
      // tokensPerEth is already in the right format (tokens per 1 ETH)
      const tokens = amountFloat * issuanceRate.tokensPerEth

      if (tokens < 0.01) return null

      return tokens
    } catch (err) {
      console.error('Token calc error:', err)
      return null
    }
  }, [amount, issuanceRate])

  if (loading) {
    return (
      <div className="glass  p-4 animate-pulse">
        <div className="h-6 bg-white/10  w-3/4 mb-3" />
        <div className="h-4 bg-white/10  w-1/2 mb-2" />
        <div className="h-4 bg-white/10  w-2/3" />
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

  const formatBalance = (wei: string) => {
    const eth = parseFloat(wei) / 1e18
    return eth.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }

  const handlePay = async () => {
    if (!amount || parseFloat(amount) <= 0) return

    setPaying(true)
    try {
      const txId = addTransaction({
        type: 'pay',
        projectId: currentProjectId,
        chainId: parseInt(selectedChainId),
        amount,
        token: selectedToken,
        status: 'pending',
      })

      window.dispatchEvent(new CustomEvent('juice:pay-project', {
        detail: {
          txId,
          projectId: currentProjectId,
          chainId: parseInt(selectedChainId),
          amount,
          token: selectedToken,
          memo,
        }
      }))
      setAmount('')
      setMemo('')
    } finally {
      setPaying(false)
    }
  }

  const logoUrl = resolveIpfsUri(project.logoUri)
  const projectUrl = `https://juicebox.money/v5/${selectedChainInfo.slug}:${currentProjectId}`

  return (
    <div className="w-full">
      {/* Card with border - constrained width */}
      <div className={`border p-4 max-w-md ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        {logoUrl ? (
          <img src={logoUrl} alt={project.name} className="w-10 h-10 object-cover" />
        ) : (
          <div className="w-10 h-10 bg-juice-orange/20 flex items-center justify-center">
            <span className="text-juice-orange font-bold">{project.name.charAt(0).toUpperCase()}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
            {project.name}
          </h3>
          <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Project #{currentProjectId}
          </p>
        </div>
      </div>

      {/* Stats - inline, no background */}
      <div className="flex gap-6 mb-3 text-sm">
        <div>
          <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>{formatBalance(totalBalance || project.balance)} ETH</span>
          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}> balance</span>
        </div>
        <div>
          <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>{ownersCount ?? 0}</span>
          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}> owners</span>
        </div>
      </div>

      {/* Pay form */}
      <div className={`mb-3 p-3  ${
        isDark ? 'bg-white/5' : 'bg-gray-50'
      }`}>
        {/* Chain selector */}
        <div className="relative mb-3">
          <button
            onClick={() => {
              setChainDropdownOpen(!chainDropdownOpen)
              setTokenDropdownOpen(false)
            }}
            className={`flex items-center gap-1 text-sm font-medium ${
              isDark ? 'text-white' : 'text-gray-900'
            }`}
          >
            Pay on <span className="underline">{selectedChainInfo.name}</span>
            <svg className={`w-4 h-4 transition-transform ${chainDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {chainDropdownOpen && (
            <div className={`absolute top-full left-0 mt-1 py-1 shadow-lg z-10 min-w-[140px] ${
              isDark ? 'bg-juice-dark border border-white/10' : 'bg-white border border-gray-200'
            }`}>
              {availableChains.map(chain => {
                const info = CHAIN_INFO[chain.chainId.toString()]
                if (!info) return null
                return (
                  <button
                    key={chain.chainId}
                    onClick={() => {
                      setSelectedChainId(chain.chainId.toString())
                      setChainDropdownOpen(false)
                    }}
                    className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                      chain.chainId.toString() === selectedChainId
                        ? isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900'
                        : isDark ? 'text-gray-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {info.name}
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

        {/* Amount input with token selector and pay button */}
        <div className="flex gap-2">
          <div className={`flex-1 flex items-center ${
            isDark
              ? 'bg-juice-dark border border-white/10'
              : 'bg-white border border-gray-200'
          }`}>
            <input
              type="number"
              step="0.001"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onFocus={() => { setChainDropdownOpen(false); setTokenDropdownOpen(false) }}
              placeholder="0.00"
              className={`flex-1 px-3 py-2 text-sm bg-transparent outline-none ${
                isDark ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
              }`}
            />
            {/* Token selector */}
            <div className="relative">
              <button
                onClick={() => {
                  setTokenDropdownOpen(!tokenDropdownOpen)
                  setChainDropdownOpen(false)
                }}
                className={`flex items-center justify-between w-20 px-2 py-2 text-sm font-medium border-l ${
                  isDark ? 'border-white/10 text-white hover:bg-white/5' : 'border-gray-200 text-gray-900 hover:bg-gray-50'
                }`}
              >
                <span>{selectedToken}</span>
                <svg className={`w-3 h-3 transition-transform ${tokenDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {tokenDropdownOpen && (
                <div className={`absolute top-full right-0 mt-1 py-1  shadow-lg z-10 min-w-[100px] ${
                  isDark ? 'bg-juice-dark border border-white/10' : 'bg-white border border-gray-200'
                }`}>
                  {TOKENS.map(token => (
                    <button
                      key={token.symbol}
                      onClick={() => {
                        setSelectedToken(token.symbol)
                        setTokenDropdownOpen(false)
                      }}
                      className={`w-full px-3 py-1.5 text-left text-sm transition-colors ${
                        token.symbol === selectedToken
                          ? isDark ? 'bg-white/10 text-white' : 'bg-gray-100 text-gray-900'
                          : isDark ? 'text-gray-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {token.symbol}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={handlePay}
            disabled={paying || !amount || parseFloat(amount) <= 0}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              paying || !amount || parseFloat(amount) <= 0
                ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600 text-black'
            }`}
          >
            {paying ? '...' : 'Pay'}
          </button>
        </div>

        {/* Quick amount options */}
        <div className="flex gap-2 mt-2">
          {(selectedToken === 'USDC' ? ['10', '25', '50', '100'] : ['0.01', '0.05', '0.1', '0.5']).map(val => (
            <button
              key={val}
              onClick={() => setAmount(val)}
              className={`min-w-[3rem] px-2 py-1 text-xs transition-colors ${
                amount === val
                  ? isDark ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-900'
                  : isDark ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-gray-100 text-gray-500 hover:bg-gray-150'
              }`}
            >
              {val}
            </button>
          ))}
        </div>

        {/* Memo input */}
        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Add a memo (optional)"
          className={`w-full mt-4 px-3 py-2 text-sm outline-none ${
            isDark
              ? 'bg-transparent text-white placeholder-gray-500'
              : 'bg-transparent text-gray-900 placeholder-gray-400'
          }`}
        />

        {/* Token count preview */}
        {expectedTokens !== null && (
          <div className={`mt-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            You'll receive ~{expectedTokens.toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens
          </div>
        )}
      </div>

      {/* Footer link inside card */}
      <a
        href={projectUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`text-xs hover:underline ${
          isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'
        }`}
      >
        View on Juicebox →
      </a>
      </div>

      {/* Tagline - blockquote style */}
      {(fullMetadata?.tagline || fullMetadata?.projectTagline) && (
        <div className={`mt-3 pl-3 border-l-2 ${
          isDark ? 'text-gray-300 border-gray-600' : 'text-gray-600 border-gray-300'
        }`}>
          <div className={`text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Tagline
          </div>
          <p className="text-sm italic">
            {fullMetadata.tagline || fullMetadata.projectTagline}
          </p>
        </div>
      )}

      {/* About section - blockquote style, collapsible */}
      {fullMetadata?.description && (
        <details className={`mt-3 pl-3 border-l-2 group ${
          isDark ? 'border-gray-600' : 'border-gray-300'
        }`}>
          <summary className={`text-xs font-medium cursor-pointer list-none flex items-center gap-1 ${
            isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'
          }`}>
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            About
          </summary>
          <div className={`mt-2 text-sm space-y-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            {parseDescription(fullMetadata.description).map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
