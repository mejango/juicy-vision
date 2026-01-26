import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from 'wagmi'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import { useOmnichainLaunchProject } from '../../hooks/relayr'
import { type JBRulesetConfig, type JBTerminalConfig } from '../../services/relayr'
import { CHAINS, EXPLORER_URLS, JB_CONTRACTS } from '../../constants'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifyLaunchProjectParams } from '../../utils/transactionVerification'

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  8453: 'Base',
  42161: 'Arbitrum',
}

interface LaunchProjectModalProps {
  isOpen: boolean
  onClose: () => void
  projectName: string
  owner: string
  projectUri: string
  chainIds: number[]
  rulesetConfig: JBRulesetConfig
  terminalConfigurations: JBTerminalConfig[]
  synchronizedStartTime: number
  memo: string
}

export default function LaunchProjectModal({
  isOpen,
  onClose,
  projectName,
  owner,
  projectUri,
  chainIds,
  rulesetConfig,
  terminalConfigurations,
  synchronizedStartTime,
  memo,
}: LaunchProjectModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  const { isConnected } = useAccount()
  const { address: managedAddress } = useManagedWallet()

  const [hasStarted, setHasStarted] = useState(false)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)

  const {
    launch,
    bundleState,
    isLaunching,
    isComplete,
    hasError,
    createdProjectIds,
    reset,
  } = useOmnichainLaunchProject({
    onSuccess: (bundleId, txHashes) => {
      console.log('Projects launched:', bundleId, txHashes)
    },
    onError: (error) => {
      console.error('Launch failed:', error)
    },
  })

  const startDate = new Date(synchronizedStartTime * 1000)
  const allCompleted = isComplete || hasError

  // Verify transaction parameters
  const verificationResult = useMemo(() => {
    return verifyLaunchProjectParams({
      owner: owner as `0x${string}`,
      projectUri,
      chainIds,
      rulesetConfigurations: [rulesetConfig],
      terminalConfigurations,
      memo,
    })
  }, [owner, projectUri, chainIds, rulesetConfig, terminalConfigurations, memo])

  const hasWarnings = verificationResult.doubts.length > 0
  const canProceed = !hasWarnings || warningsAcknowledged

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setHasStarted(false)
      setWarningsAcknowledged(false)
      reset()
    }
  }, [isOpen, reset])

  const handleLaunch = useCallback(async () => {
    if (!owner) return

    setHasStarted(true)
    await launch({
      chainIds,
      owner,
      projectUri,
      rulesetConfigurations: [rulesetConfig],
      terminalConfigurations,
      memo,
    })
  }, [owner, chainIds, projectUri, rulesetConfig, terminalConfigurations, memo, launch])

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={!hasStarted || allCompleted ? handleClose : undefined}
      />

      {/* Modal */}
      <div className={`relative w-full max-w-md border ${
        isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${
          isDark ? 'border-white/10' : 'border-gray-100'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center text-xl ${
              isComplete
                ? 'bg-green-500/20'
                : hasError
                  ? 'bg-red-500/20'
                  : isDark ? 'bg-juice-orange/20' : 'bg-orange-100'
            }`}>
              {isComplete ? '✓' : hasError ? '!' : '+'}
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {isComplete
                  ? 'Projects Created'
                  : hasError
                    ? 'Launch Failed'
                    : hasStarted
                      ? 'Creating Projects...'
                      : 'Launch Project'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {projectName || 'New Project'}
              </p>
            </div>
          </div>
          {(!hasStarted || allCompleted) && (
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
          {/* Synchronized Start Time */}
          <div className={`p-3 ${isDark ? 'bg-juice-orange/10' : 'bg-orange-50'}`}>
            <div className={`text-xs font-medium ${isDark ? 'text-juice-orange' : 'text-orange-700'}`}>
              Synchronized Start Time
            </div>
            <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {startDate.toLocaleString()}
            </div>
            {chainIds.length > 1 && (
              <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                All chains will activate at the same time
              </div>
            )}
          </div>

          {/* Chain Status */}
          <div className="space-y-2">
            {chainIds.map((chainId) => {
              const chain = CHAINS[chainId]
              const chainState = bundleState.chainStates.find(cs => cs.chainId === chainId)
              const projectId = createdProjectIds[chainId]

              return (
                <div
                  key={chainId}
                  className={`p-3 flex items-center justify-between ${
                    isDark ? 'bg-white/5' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: chain?.color || '#888' }}
                    />
                    <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {chain?.name || `Chain ${chainId}`}
                    </span>
                    {projectId && (
                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        #{projectId}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!chainState && (
                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Waiting...
                      </span>
                    )}
                    {chainState?.status === 'pending' && (
                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Pending
                      </span>
                    )}
                    {chainState?.status === 'submitted' && (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin w-3 h-3 border-2 border-juice-orange border-t-transparent rounded-full" />
                        <span className={`text-xs ${isDark ? 'text-juice-orange' : 'text-orange-600'}`}>
                          Creating...
                        </span>
                      </div>
                    )}
                    {chainState?.status === 'confirmed' && (
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">✓</span>
                        {chainState.txHash && (
                          <a
                            href={`${EXPLORER_URLS[chainId]}${chainState.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-juice-cyan hover:underline"
                          >
                            View
                          </a>
                        )}
                      </div>
                    )}
                    {chainState?.status === 'failed' && (
                      <span className="text-xs text-red-400">
                        Failed
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Error details */}
          {hasError && bundleState.error && (
            <div className={`p-3 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              <span className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                {bundleState.error}
              </span>
            </div>
          )}

          {/* Pre-launch info */}
          {!hasStarted && (
            <>
              {/* Owner */}
              <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className={`text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Project Owner
                </div>
                <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {owner.slice(0, 8)}...{owner.slice(-6)}
                </div>
              </div>

              {/* Gas Sponsorship */}
              <div className={`p-3 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
                <div className={`text-xs font-medium ${isDark ? 'text-green-400' : 'text-green-700'}`}>
                  Gas Sponsored
                </div>
                <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Project creation on all {chainIds.length} chain{chainIds.length !== 1 ? 's' : ''} is free
                </div>
              </div>

              {/* Transaction Summary */}
              <TransactionSummary
                type="launchProject"
                details={{
                  projectName,
                  owner,
                  chainIds,
                }}
                isDark={isDark}
              />

              {/* Transaction Warning */}
              {hasWarnings && (
                <TransactionWarning
                  doubts={verificationResult.doubts}
                  onConfirm={() => setWarningsAcknowledged(true)}
                  onCancel={handleClose}
                  isDark={isDark}
                />
              )}

              {/* Technical Details */}
              <TechnicalDetails
                contract="JB_CONTROLLER"
                contractAddress={JB_CONTRACTS.JBController}
                functionName="launchProjectFor"
                chainId={chainIds[0]}
                parameters={verificationResult.verifiedParams}
                isDark={isDark}
                allChains={chainIds.map(cid => ({
                  chainId: cid,
                  chainName: CHAIN_NAMES[cid] || `Chain ${cid}`,
                }))}
              />
            </>
          )}

          {/* Processing indicator */}
          {isLaunching && (
            <div className={`p-3 flex items-center gap-3 ${isDark ? 'bg-juice-orange/10' : 'bg-orange-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-juice-orange border-t-transparent rounded-full" />
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {bundleState.status === 'creating' ? 'Creating bundle...' : 'Creating projects...'}
                </p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Relayr is deploying on all chains
                </p>
              </div>
            </div>
          )}

          {/* Success summary */}
          {isComplete && Object.keys(createdProjectIds).length > 0 && (
            <div className={`p-3 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
              <div className={`text-xs font-medium mb-2 ${isDark ? 'text-green-400' : 'text-green-700'}`}>
                Created Project IDs
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(createdProjectIds).map(([chainId, projectId]) => (
                  <div key={chainId} className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: CHAINS[Number(chainId)]?.color || '#888' }}
                    />
                    <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {CHAINS[Number(chainId)]?.shortName}: #{projectId}
                    </span>
                  </div>
                ))}
              </div>
              {chainIds.length > 1 && (
                <div className={`text-xs mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Deploy suckers to link these projects for cross-chain token bridging.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          {!hasStarted && (
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
                onClick={handleLaunch}
                disabled={!canProceed}
                className="flex-1 py-3 font-bold bg-juice-orange text-black hover:bg-juice-orange/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Project{chainIds.length > 1 ? `s` : ''}
              </button>
            </div>
          )}

          {isLaunching && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Do not close this window
            </div>
          )}

          {allCompleted && (
            <button
              onClick={handleClose}
              className={`w-full py-3 font-medium transition-colors ${
                isComplete
                  ? 'bg-juice-orange text-black hover:bg-juice-orange/90'
                  : isDark
                    ? 'bg-white/10 text-white hover:bg-white/20'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {isComplete ? 'Done' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
