import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAccount } from 'wagmi'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import { useOmnichainSetUri, type ChainState } from '../../hooks/relayr'
import TechnicalDetails from '../shared/TechnicalDetails'
import { useReviewedTransactionAccount } from '../../hooks/useReviewedTransactionAccount'
import { CHAINS as CHAIN_INFO } from '../../constants'
import ChainStatusRow from './ChainStatusRow'
import DialogShell from '../ui/DialogShell'

interface ChainProjectData {
  chainId: number
  projectId: number
}

interface SetUriModalProps {
  isOpen: boolean
  onClose: () => void
  projectName?: string
  chainProjectData: ChainProjectData[]
  newUri: string
  currentUri?: string
  deploymentKey?: string
  onStarted?: () => void
  onConfirmed?: (txHashes: Record<number, string>, bundleId?: string) => void
  onError?: (error: string) => void
}

type ChainStatus = 'pending' | 'signing' | 'submitted' | 'confirmed' | 'failed'

interface ChainTxState {
  chainId: number
  projectId: number
  status: ChainStatus
  txHash?: string
  error?: string
}

export default function SetUriModal({
  isOpen,
  onClose,
  projectName,
  chainProjectData,
  newUri,
  currentUri,
  deploymentKey,
  onStarted,
  onConfirmed,
  onError,
}: SetUriModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address } = useAccount()

  // Managed mode support
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address: managedAddress } = useManagedWallet()
  const activeAddress = isManagedMode ? managedAddress : address
  const { assertCurrentAccount } = useReviewedTransactionAccount(
    isOpen,
    activeAddress,
    isManagedMode ? 'managed' : 'self_custody',
  )

  // Local chain states for display
  const [chainStates, setChainStates] = useState<ChainTxState[]>([])
  const [isStarted, setIsStarted] = useState(false)

  const operationKey = useMemo(() => {
    if (deploymentKey) return deploymentKey
    const projects = [...chainProjectData]
      .sort((a, b) => a.chainId - b.chainId)
      .map(({ chainId, projectId }) => `${chainId}:${projectId}`)
      .join(',')
    return `metadata:${projects}:${newUri}`
  }, [deploymentKey, chainProjectData, newUri])

  // Use the omnichain setUri hook
  const {
    setUri,
    bundleState,
    isUpdating,
    isSigning,
    signingChainId,
    isComplete: omnichainComplete,
    hasError: omnichainError,
    persistedTxHashes,
    persistedBundleId,
    reset: resetOmnichain,
  } = useOmnichainSetUri({
    deploymentKey: operationKey,
    onSuccess: (bundleId, txHashes) => {
      console.log('SetUri completed:', bundleId, txHashes)
    },
    onError: (error) => {
      console.error('SetUri failed:', error)
    },
  })

  const isOmnichain = chainProjectData.length > 1

  // Derive chain states from bundle state
  const effectiveChainStates = bundleState.bundleId
    ? bundleState.chainStates.map((cs: ChainState) => ({
        chainId: cs.chainId,
        projectId: cs.projectId || chainProjectData.find(cd => cd.chainId === cs.chainId)?.projectId || 0,
        status: cs.status as ChainStatus,
        txHash: cs.txHash,
        error: cs.error,
      }))
    : persistedTxHashes
      ? chainProjectData.map(cd => ({
          ...cd,
          status: 'confirmed' as const,
          txHash: persistedTxHashes[cd.chainId],
        }))
      : chainStates

  // Track signing state per chain
  useEffect(() => {
    if (isSigning && signingChainId) {
      setChainStates(prev =>
        prev.map(cs =>
          cs.chainId === signingChainId ? { ...cs, status: 'signing' } : cs
        )
      )
    }
  }, [isSigning, signingChainId])

  // All chains completed
  const allCompleted = omnichainComplete || omnichainError
  const anyFailed = omnichainError
  const allSucceeded = omnichainComplete

  // Call parent callbacks when transactions complete
  useEffect(() => {
    if (allSucceeded) {
      const txHashes: Record<number, string> = { ...(persistedTxHashes ?? {}) }
      bundleState.chainStates.forEach((cs: ChainState) => {
        if (cs.txHash) txHashes[cs.chainId] = cs.txHash
      })
      onConfirmed?.(txHashes, bundleState.bundleId || persistedBundleId || undefined)
    } else if (anyFailed) {
      const failedChain = bundleState.chainStates.find((cs: ChainState) => cs.status === 'failed')
      onError?.(failedChain?.error || bundleState.error || 'Transaction failed')
    }
  }, [
    allSucceeded,
    anyFailed,
    bundleState.chainStates,
    bundleState.bundleId,
    bundleState.error,
    persistedTxHashes,
    persistedBundleId,
    onConfirmed,
    onError,
  ])

  // Initialize chain states
  useEffect(() => {
    if (isOpen) {
      setChainStates(
        chainProjectData.map(cd => ({
          chainId: cd.chainId,
          projectId: cd.projectId,
          status: 'pending',
        }))
      )
      setIsStarted(false)
      resetOmnichain()
    }
  }, [isOpen, chainProjectData, resetOmnichain])

  // Start the setUri process
  const handleStart = useCallback(async () => {
    if (!activeAddress || chainProjectData.length === 0) return

    try {
      assertCurrentAccount(isManagedMode ? undefined : activeAddress)
      onStarted?.()
      setIsStarted(true)

      assertCurrentAccount(isManagedMode ? undefined : activeAddress)
      await setUri({
        chainProjectMappings: chainProjectData.map(cd => ({
          chainId: cd.chainId,
          projectId: cd.projectId,
        })),
        uri: newUri,
      })
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'The reviewed account could not be verified')
    }
  }, [activeAddress, isManagedMode, chainProjectData, newUri, setUri, onStarted, onError, assertCurrentAccount])

  const handleClose = useCallback(() => {
    resetOmnichain()
    onClose()
  }, [resetOmnichain, onClose])

  if (!isOpen) return null

  return (
    <DialogShell isOpen onClose={handleClose} dismissible={!isStarted || allCompleted} labelledBy="set-uri-modal-title">
      <div className={`relative w-full max-w-md border ${
        isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${
          isDark ? 'border-white/10' : 'border-gray-100'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center text-xl ${
              allSucceeded
                ? 'bg-green-500/20'
                : anyFailed
                  ? 'bg-red-500/20'
                  : isDark ? 'bg-purple-500/20' : 'bg-purple-100'
            }`}>
              {allSucceeded ? '✓' : anyFailed ? '!' : '📝'}
            </div>
            <div>
              <h2 id="set-uri-modal-title" className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {allSucceeded
                  ? 'Metadata Updated'
                  : anyFailed && allCompleted
                    ? 'Update Failed'
                    : isStarted
                      ? 'Updating Metadata...'
                      : 'Confirm Metadata Update'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {projectName || 'Project'}
              </p>
            </div>
          </div>
          {(!isStarted || allCompleted) && (
            <button
              onClick={handleClose}
              className={`p-2 transition-colors ${
                isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* URI Change Summary */}
          <div className={`p-3 ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
            <div className={`text-xs font-medium mb-2 ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>
              New Metadata URI
            </div>
            <code className={`text-sm font-mono break-all ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {newUri.startsWith('Qm') || newUri.startsWith('b') ? `ipfs://${newUri}` : newUri}
            </code>
            {currentUri && (
              <div className={`mt-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Replacing: <code className="font-mono">{currentUri.slice(0, 30)}...</code>
              </div>
            )}
          </div>

          {/* Chain Status */}
          <div className="space-y-2">
            {effectiveChainStates.map((cs: ChainTxState) => (
              <ChainStatusRow
                key={cs.chainId}
                chainId={cs.chainId}
                projectId={cs.projectId}
                status={cs.status}
                txHash={cs.txHash}
                highlighted={isSigning && signingChainId === cs.chainId}
                signing={isSigning && signingChainId === cs.chainId}
                accent="purple"
                isDark={isDark}
              />
            ))}
          </div>

          {/* Error details */}
          {anyFailed && (
            <div className={`p-3 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              {effectiveChainStates.filter((cs: ChainTxState) => cs.status === 'failed').map((cs: ChainTxState) => (
                <div key={cs.chainId} className="text-xs">
                  <span className={isDark ? 'text-red-400' : 'text-red-600'}>
                    {CHAIN_INFO[cs.chainId]?.name || `Chain ${cs.chainId}`}:
                  </span>
                  <span className={`ml-1 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>
                    {cs.error || bundleState.error || 'Unknown error'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Pre-execution info */}
          {!isStarted && (
            <>
              <div className={`p-3 text-sm ${isDark ? 'bg-green-500/10 text-green-300' : 'bg-green-50 text-green-700'}`}>
                Gas fees are sponsored
              </div>

              {isOmnichain && !isManagedMode && (
                <div className={`p-3 text-sm ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                  Your wallet will ask you to authorize one update for each chain.
                </div>
              )}

              {/* Technical Details */}
              <TechnicalDetails
                contract="JB_CONTROLLER"
                contractAddress="(varies per chain)"
                functionName="setUriOf"
                chainId={chainProjectData[0]?.chainId || 1}
                projectId={chainProjectData[0]?.projectId?.toString()}
                parameters={{
                  uri: newUri,
                }}
                isDark={isDark}
                allChains={isOmnichain ? chainProjectData.map(cd => ({
                  chainId: cd.chainId,
                  chainName: CHAIN_INFO[cd.chainId]?.name || `Chain ${cd.chainId}`,
                  projectId: cd.projectId,
                })) : undefined}
              />
            </>
          )}

          {/* Processing indicator */}
          {isUpdating && !isSigning && (
            <div className={`p-3 flex items-center gap-3 ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-juice-cyan border-t-transparent rounded-full" />
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {bundleState.status === 'creating' ? 'Creating bundle...' : 'Processing transactions...'}
                </p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Relayr is executing on all chains
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          {!isStarted && (
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className={`flex-1 py-3 font-medium border-2 transition-colors ${
                  isDark
                    ? 'border-white/20 text-white hover:bg-white/10'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleStart}
                className="flex-1 py-3 font-bold bg-purple-500 text-white hover:bg-purple-500/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Update{isOmnichain ? ` on ${chainProjectData.length} Chains` : ''}
              </button>
            </div>
          )}

          {isStarted && !allCompleted && !isUpdating && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Please sign each transaction in your wallet
            </div>
          )}

          {isUpdating && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Do not close this window
            </div>
          )}

          {allCompleted && (
            <button
              onClick={handleClose}
              className="w-full py-3 font-medium bg-purple-500 text-white hover:bg-purple-500/90 transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </DialogShell>
  )
}
