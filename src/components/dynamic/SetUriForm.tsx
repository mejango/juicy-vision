import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useSetUriFormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchConnectedChains,
  type Project,
  type ConnectedChain,
} from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { SetUriModal } from '../payment'

interface SetUriFormProps {
  projectId: string
  chainId?: string
  messageId?: string // For persisting state to server (visible to all chat users)
}

// Chain info for display
const CHAIN_INFO: Record<number, { name: string; shortName: string; slug: string; color: string }> = {
  1: { name: 'Ethereum', shortName: 'ETH', slug: 'eth', color: '#627EEA' },
  10: { name: 'Optimism', shortName: 'OP', slug: 'op', color: '#FF0420' },
  8453: { name: 'Base', shortName: 'BASE', slug: 'base', color: '#0052FF' },
  42161: { name: 'Arbitrum', shortName: 'ARB', slug: 'arb', color: '#28A0F0' },
}

// Per-chain project data
interface ChainProjectData {
  chainId: number
  projectId: number
  selected: boolean
}

// Validate IPFS CID format (basic check)
function isValidIpfsCid(value: string): boolean {
  // Allow both raw CIDs and ipfs:// URIs
  const cid = value.replace(/^ipfs:\/\//, '')
  // Basic CID validation: starts with Qm (CIDv0) or b (CIDv1) and has reasonable length
  return /^(Qm[a-zA-Z0-9]{44}|b[a-z2-7]{58})$/.test(cid) || cid.length >= 46
}

// Extract CID from input (handles both raw CIDs and ipfs:// URIs)
function extractCid(value: string): string {
  return value.replace(/^ipfs:\/\//, '').trim()
}

export default function SetUriForm({ projectId, chainId = '1', messageId }: SetUriFormProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { isConnected } = useAccount()

  // Persistent state
  const { state: persistedState, updateState: updatePersistedState } = useSetUriFormState(messageId)
  const isLocked = persistedState?.status && persistedState.status !== 'pending'

  // Project state
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Chain state
  const [chainProjectData, setChainProjectData] = useState<ChainProjectData[]>([])
  const primaryChainId = parseInt(chainId)

  // Form state
  const [newUri, setNewUri] = useState('')
  const [showModal, setShowModal] = useState(false)

  // Derived state
  const selectedChains = chainProjectData.filter(cd => cd.selected)
  const isOmnichain = chainProjectData.length > 1
  const currentUri = project?.metadataUri || ''
  const newCid = extractCid(newUri)
  const isValidUri = newUri.trim() === '' || isValidIpfsCid(newUri)
  const hasChange = newCid && newCid !== extractCid(currentUri)

  // Dispatch event to open wallet panel
  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  // Load project data
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [projectData, connectedChains] = await Promise.all([
          fetchProject(projectId, primaryChainId),
          fetchConnectedChains(projectId, primaryChainId),
        ])
        setProject(projectData)

        // Determine chains to update
        const chainsToUpdate: ConnectedChain[] = connectedChains.length > 0
          ? connectedChains
          : [{ chainId: primaryChainId, projectId: parseInt(projectId) }]

        setChainProjectData(chainsToUpdate.map(chain => ({
          chainId: chain.chainId,
          projectId: chain.projectId,
          selected: true,
        })))
      } catch (err) {
        console.error('Failed to load project:', err)
        setError('Failed to load project data')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [projectId, primaryChainId])

  // Toggle chain selection
  const toggleChainSelection = useCallback((chainId: number) => {
    if (isLocked) return
    setChainProjectData(prev =>
      prev.map(cd =>
        cd.chainId === chainId ? { ...cd, selected: !cd.selected } : cd
      )
    )
  }, [isLocked])

  // Callbacks for transaction completion
  const handleConfirmed = useCallback((txHashes: Record<number, string>, bundleId?: string) => {
    updatePersistedState({
      status: 'completed',
      txHashes,
      bundleId,
      confirmedAt: new Date().toISOString(),
    })
  }, [updatePersistedState])

  const handleError = useCallback((errorMsg: string) => {
    updatePersistedState({
      status: 'failed',
      error: errorMsg,
    })
  }, [updatePersistedState])

  // Submit handler
  const handleSubmit = useCallback(() => {
    if (isLocked || selectedChains.length === 0) return
    if (!newCid || !isValidUri) return

    if (!isConnected) {
      openWalletPanel()
      return
    }

    // Persist in_progress state
    updatePersistedState({
      status: 'in_progress',
      uri: newCid,
      selectedChains: selectedChains.map(c => c.chainId),
      submittedAt: new Date().toISOString(),
    })

    setShowModal(true)
  }, [isLocked, selectedChains, newCid, isValidUri, isConnected, updatePersistedState])

  // Loading state
  if (loading) {
    return (
      <div className="w-full">
        <div className={`max-w-2xl border p-4 animate-pulse ${
          isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
        }`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-14 h-14 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className="flex-1">
              <div className={`h-5 w-40 mb-2 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
              <div className={`h-4 w-24 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={`max-w-2xl border p-6 text-center ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>{error}</p>
      </div>
    )
  }

  const logoUrl = project?.logoUri ? resolveIpfsUri(project.logoUri) : null
  const chainInfo = CHAIN_INFO[primaryChainId] || CHAIN_INFO[1]
  const projectUrl = `https://juicebox.money/v5/${chainInfo.slug}:${projectId}`

  return (
    <div className="w-full">
      <div className={`max-w-2xl border ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {/* Header */}
        <div className="p-4 border-b border-gray-600/50">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt={project?.name || 'Project'} className="w-14 h-14 object-cover" />
            ) : (
              <div className="w-14 h-14 bg-purple-500/20 flex items-center justify-center">
                <span className="text-2xl">📝</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Update Project Metadata
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
          </div>
        </div>

        {/* Chain Selection for omnichain */}
        {isOmnichain && (
          <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-600/50' : 'border-gray-200'}`}>
            <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Apply to chains:
            </div>
            <div className="flex flex-wrap gap-2">
              {chainProjectData.map(cd => {
                const chain = CHAIN_INFO[cd.chainId]
                return (
                  <button
                    key={cd.chainId}
                    onClick={() => toggleChainSelection(cd.chainId)}
                    disabled={isLocked}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                      isLocked
                        ? 'opacity-50 cursor-not-allowed'
                        : cd.selected
                          ? isDark
                            ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                            : 'bg-purple-100 text-purple-700 border border-purple-300'
                          : isDark
                            ? 'bg-white/5 text-gray-400 border border-white/10'
                            : 'bg-gray-100 text-gray-500 border border-gray-200'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: chain?.color || '#888' }}
                    />
                    {chain?.shortName || cd.chainId}
                    {cd.selected && <span>✓</span>}
                  </button>
                )
              })}
            </div>
            {selectedChains.length > 1 && (
              <div className={`mt-2 text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                Metadata will be updated on all selected chains
              </div>
            )}
          </div>
        )}

        {/* Current URI */}
        <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-600/50' : 'border-gray-200'}`}>
          <div className={`text-xs font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            Current Metadata URI
          </div>
          {currentUri ? (
            <div className="flex items-center gap-2">
              <code className={`text-xs font-mono truncate flex-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {currentUri}
              </code>
              <a
                href={resolveIpfsUri(currentUri) || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-juice-cyan hover:underline"
              >
                View
              </a>
            </div>
          ) : (
            <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              No metadata URI set
            </div>
          )}
        </div>

        {/* New URI Input */}
        <div className="p-4">
          <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            New Metadata URI
          </div>
          <input
            type="text"
            value={newUri}
            onChange={(e) => setNewUri(e.target.value)}
            disabled={isLocked}
            placeholder="ipfs://Qm... or paste IPFS CID"
            className={`w-full px-3 py-2.5 text-sm font-mono outline-none ${
              isDark
                ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-600'
                : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
            } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''} ${
              newUri && !isValidUri ? 'border-red-500' : ''
            }`}
          />
          {newUri && !isValidUri && (
            <div className={`mt-1 text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
              Please enter a valid IPFS CID
            </div>
          )}
          <div className={`mt-2 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            The metadata URI points to a JSON file containing project info (name, description, logo, etc.)
          </div>
        </div>

        {/* Submit Section */}
        <div className={`p-4 border-t ${isDark ? 'border-gray-600/50' : 'border-gray-200'}`}>
          {/* Transaction Status Indicator */}
          {isLocked && (
            <div className={`mb-3 p-3 text-sm ${
              persistedState?.status === 'completed'
                ? isDark ? 'bg-green-500/10' : 'bg-green-50'
                : persistedState?.status === 'failed'
                  ? isDark ? 'bg-red-500/10' : 'bg-red-50'
                  : isDark ? 'bg-purple-500/10' : 'bg-purple-50'
            }`}>
              <div className={`flex items-center gap-2 ${
                persistedState?.status === 'completed'
                  ? isDark ? 'text-green-400' : 'text-green-600'
                  : persistedState?.status === 'failed'
                    ? isDark ? 'text-red-400' : 'text-red-600'
                    : isDark ? 'text-purple-400' : 'text-purple-600'
              }`}>
                {persistedState?.status === 'completed' ? (
                  <>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Metadata updated successfully!</span>
                  </>
                ) : persistedState?.status === 'failed' ? (
                  <>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span>Transaction failed</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Transaction pending...</span>
                  </>
                )}
              </div>
              {persistedState?.txHashes && Object.keys(persistedState.txHashes).length > 0 && (
                <div className="mt-2 space-y-1">
                  {Object.entries(persistedState.txHashes).map(([cid, hash]) => {
                    const chain = CHAIN_INFO[parseInt(cid)]
                    return (
                      <a
                        key={cid}
                        href={`https://${chain?.slug === 'eth' ? '' : chain?.slug + '.'}etherscan.io/tx/${hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-xs ml-6 underline block ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
                      >
                        {chain?.name || `Chain ${cid}`}: View on explorer
                      </a>
                    )
                  })}
                </div>
              )}
              {persistedState?.error && (
                <p className={`text-xs mt-1 ml-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {persistedState.error}
                </p>
              )}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={isLocked || selectedChains.length === 0 || !hasChange || !isValidUri}
            className={`w-full py-3 text-sm font-bold transition-colors ${
              isLocked || selectedChains.length === 0 || !hasChange || !isValidUri
                ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                : 'bg-purple-500 hover:bg-purple-500/90 text-white'
            }`}
          >
            {persistedState?.status === 'completed'
              ? 'Updated'
              : persistedState?.status === 'in_progress'
                ? 'Pending...'
                : `Update Metadata${selectedChains.length > 1 ? ` on ${selectedChains.length} Chains` : ''}`}
          </button>

          <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {isOmnichain
              ? 'The metadata URI will be updated on all selected chains. This affects how the project appears across the ecosystem.'
              : 'Update the metadata URI for this project. This affects how the project name, description, and logo appear.'}
          </p>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <SetUriModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          projectName={project?.name}
          chainProjectData={selectedChains}
          newUri={newCid}
          currentUri={currentUri}
          onConfirmed={handleConfirmed}
          onError={handleError}
        />
      )}
    </div>
  )
}
