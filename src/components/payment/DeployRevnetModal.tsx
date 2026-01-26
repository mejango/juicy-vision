import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAccount } from 'wagmi'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import { useOmnichainDeployRevnet, useOmnichainDeploySuckers } from '../../hooks/relayr'
import { type REVStageConfig } from '../../services/relayr'
import { CHAINS, EXPLORER_URLS, REV_DEPLOYER, JB_SUCKER_REGISTRY } from '../../constants'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifyDeployRevnetParams } from '../../utils/transactionVerification'

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  8453: 'Base',
  42161: 'Arbitrum',
}

interface DeployRevnetModalProps {
  isOpen: boolean
  onClose: () => void
  name: string
  tagline: string
  splitOperator: string
  chainIds: number[]
  stageConfigurations: REVStageConfig[]
  autoDeploySuckers: boolean
}

type DeployPhase = 'revnet' | 'suckers' | 'complete'

export default function DeployRevnetModal({
  isOpen,
  onClose,
  name,
  tagline,
  splitOperator,
  chainIds,
  stageConfigurations,
  autoDeploySuckers,
}: DeployRevnetModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  const { isConnected } = useAccount()
  const { address: managedAddress } = useManagedWallet()

  const [hasStarted, setHasStarted] = useState(false)
  const [phase, setPhase] = useState<DeployPhase>('revnet')
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)

  // Revnet deployment hook
  const {
    deploy,
    bundleState: revnetBundleState,
    isDeploying: isDeployingRevnet,
    isComplete: revnetComplete,
    hasError: revnetError,
    createdProjectIds,
    predictedTokenAddress,
    reset: resetRevnet,
  } = useOmnichainDeployRevnet({
    onSuccess: (bundleId, txHashes) => {
      console.log('Revnet deployed:', bundleId, txHashes)
      if (autoDeploySuckers && chainIds.length > 1) {
        setPhase('suckers')
      } else {
        setPhase('complete')
      }
    },
    onError: (error) => {
      console.error('Revnet deployment failed:', error)
    },
  })

  // Sucker deployment hook
  const {
    deploySuckers,
    bundleState: suckerBundleState,
    isDeploying: isDeployingSuckers,
    isComplete: suckersComplete,
    hasError: suckersError,
    suckerAddresses,
    reset: resetSuckers,
  } = useOmnichainDeploySuckers({
    onSuccess: (bundleId, txHashes) => {
      console.log('Suckers deployed:', bundleId, txHashes)
      setPhase('complete')
    },
    onError: (error) => {
      console.error('Sucker deployment failed:', error)
    },
  })

  // Auto-deploy suckers when revnet completes
  useEffect(() => {
    if (phase === 'suckers' && revnetComplete && Object.keys(createdProjectIds).length > 0) {
      deploySuckers({
        chainIds,
        projectIds: createdProjectIds,
      })
    }
  }, [phase, revnetComplete, createdProjectIds, chainIds, deploySuckers])

  const isDeploying = isDeployingRevnet || isDeployingSuckers
  const allComplete = phase === 'complete' || (!autoDeploySuckers && revnetComplete)
  const hasError = revnetError || suckersError

  // Verify transaction parameters
  const verificationResult = useMemo(() => {
    return verifyDeployRevnetParams({
      splitOperator: splitOperator as `0x${string}`,
      name,
      tagline,
      chainIds,
      stageConfigurations,
    })
  }, [splitOperator, name, tagline, chainIds, stageConfigurations])

  const hasWarnings = verificationResult.doubts.length > 0
  const canProceed = !hasWarnings || warningsAcknowledged

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setHasStarted(false)
      setPhase('revnet')
      setWarningsAcknowledged(false)
      resetRevnet()
      resetSuckers()
    }
  }, [isOpen, resetRevnet, resetSuckers])

  const handleDeploy = useCallback(async () => {
    if (!splitOperator) return

    setHasStarted(true)
    await deploy({
      chainIds,
      stageConfigurations,
      splitOperator,
      name,
      tagline,
    })
  }, [splitOperator, chainIds, stageConfigurations, name, tagline, deploy])

  const handleClose = useCallback(() => {
    resetRevnet()
    resetSuckers()
    onClose()
  }, [resetRevnet, resetSuckers, onClose])

  if (!isOpen) return null

  // Choose which bundle state to show based on phase
  const activeBundleState = phase === 'suckers' ? suckerBundleState : revnetBundleState

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={!hasStarted || allComplete ? handleClose : undefined}
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
              allComplete && !hasError
                ? 'bg-green-500/20'
                : hasError
                  ? 'bg-red-500/20'
                  : isDark ? 'bg-purple-500/20' : 'bg-purple-100'
            }`}>
              {allComplete && !hasError ? '✓' : hasError ? '!' : '🌀'}
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {allComplete && !hasError
                  ? 'Revnet Deployed'
                  : hasError
                    ? 'Deployment Failed'
                    : phase === 'suckers'
                      ? 'Deploying Suckers...'
                      : hasStarted
                        ? 'Deploying Revnet...'
                        : 'Deploy Revnet'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {name || 'New Revnet'}
              </p>
            </div>
          </div>
          {(!hasStarted || allComplete) && (
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
          {/* Phase indicator */}
          {hasStarted && (
            <div className={`p-3 ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
              <div className="flex items-center gap-4">
                <div className={`flex items-center gap-2 ${
                  phase === 'revnet' || revnetComplete ? 'opacity-100' : 'opacity-50'
                }`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    revnetComplete
                      ? 'bg-green-500 text-white'
                      : phase === 'revnet'
                        ? 'bg-purple-500 text-white'
                        : isDark ? 'bg-white/10 text-gray-400' : 'bg-gray-200 text-gray-500'
                  }`}>
                    {revnetComplete ? '✓' : '1'}
                  </div>
                  <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    Revnet
                  </span>
                </div>

                <div className={`flex-1 h-px ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />

                {autoDeploySuckers && chainIds.length > 1 && (
                  <div className={`flex items-center gap-2 ${
                    phase === 'suckers' || suckersComplete ? 'opacity-100' : 'opacity-50'
                  }`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      suckersComplete
                        ? 'bg-green-500 text-white'
                        : phase === 'suckers'
                          ? 'bg-purple-500 text-white'
                          : isDark ? 'bg-white/10 text-gray-400' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {suckersComplete ? '✓' : '2'}
                    </div>
                    <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      Suckers
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Chain Status */}
          <div className="space-y-2">
            {chainIds.map((chainId) => {
              const chain = CHAINS[chainId]
              const chainState = activeBundleState.chainStates.find(cs => cs.chainId === chainId)
              const projectId = createdProjectIds[chainId]
              const suckerAddr = suckerAddresses[chainId]

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
                        <div className="animate-spin w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full" />
                        <span className={`text-xs ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
                          {phase === 'suckers' ? 'Deploying sucker...' : 'Creating...'}
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
          {hasError && (revnetBundleState.error || suckerBundleState.error) && (
            <div className={`p-3 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              <span className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                {revnetBundleState.error || suckerBundleState.error}
              </span>
            </div>
          )}

          {/* Pre-deploy info */}
          {!hasStarted && (
            <>
              {/* Stages summary */}
              <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {stageConfigurations.length} Stage{stageConfigurations.length !== 1 ? 's' : ''} Configured
                </div>
                {stageConfigurations.map((stage, idx) => (
                  <div key={idx} className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    Stage {idx + 1}: {(stage.splitPercent / 10000000).toFixed(1)}% operator split,{' '}
                    {(stage.issuanceDecayPercent / 10000000).toFixed(1)}% decay every{' '}
                    {Math.round(stage.issuanceDecayFrequency / 86400)} days
                  </div>
                ))}
              </div>

              {/* Operator */}
              <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className={`text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Split Operator
                </div>
                <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {splitOperator.slice(0, 8)}...{splitOperator.slice(-6)}
                </div>
              </div>

              {/* Sucker toggle info */}
              {autoDeploySuckers && chainIds.length > 1 && (
                <div className={`p-3 ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
                  <div className={`text-xs font-medium ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                    Auto-Deploy Suckers
                  </div>
                  <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Cross-chain token bridging will be enabled after revnet creation
                  </div>
                </div>
              )}

              {/* Gas Sponsorship */}
              <div className={`p-3 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
                <div className={`text-xs font-medium ${isDark ? 'text-green-400' : 'text-green-700'}`}>
                  Gas Sponsored
                </div>
                <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Revnet deployment on all {chainIds.length} chain{chainIds.length !== 1 ? 's' : ''} is free
                </div>
              </div>

              {/* Transaction Summary */}
              <TransactionSummary
                type="deployRevnet"
                details={{
                  name,
                  chainIds,
                  stages: stageConfigurations.map((stage) => ({
                    splitPercent: stage.splitPercent / 10000000,
                    decayPercent: stage.issuanceDecayPercent / 10000000,
                    decayFrequency: `${Math.round(stage.issuanceDecayFrequency / 86400)} days`,
                  })),
                  autoDeploySuckers,
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

              {/* Technical Details - Revnet Deployment */}
              <TechnicalDetails
                contract="REV_DEPLOYER"
                contractAddress={REV_DEPLOYER}
                functionName="deployFor"
                chainId={chainIds[0]}
                parameters={verificationResult.verifiedParams}
                isDark={isDark}
                allChains={chainIds.map(cid => ({
                  chainId: cid,
                  chainName: CHAIN_NAMES[cid] || `Chain ${cid}`,
                }))}
              />

              {/* Technical Details - Sucker Deployment (if enabled) */}
              {autoDeploySuckers && chainIds.length > 1 && (
                <TechnicalDetails
                  contract="JB_SUCKER_REGISTRY"
                  contractAddress={JB_SUCKER_REGISTRY}
                  functionName="deploySuckersFor"
                  chainId={chainIds[0]}
                  parameters={{
                    note: 'Suckers will be deployed after revnet creation',
                    chainIds,
                    projectIds: 'TBD after revnet deploys',
                  }}
                  isDark={isDark}
                  allChains={chainIds.map(cid => ({
                    chainId: cid,
                    chainName: CHAIN_NAMES[cid] || `Chain ${cid}`,
                  }))}
                />
              )}
            </>
          )}

          {/* Processing indicator */}
          {isDeploying && (
            <div className={`p-3 flex items-center gap-3 ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full" />
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {phase === 'suckers'
                    ? 'Deploying suckers...'
                    : activeBundleState.status === 'creating'
                      ? 'Creating bundle...'
                      : 'Deploying revnet...'}
                </p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Relayr is executing on all chains
                </p>
              </div>
            </div>
          )}

          {/* Success summary */}
          {allComplete && !hasError && (
            <div className={`p-3 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
              <div className={`text-xs font-medium mb-2 ${isDark ? 'text-green-400' : 'text-green-700'}`}>
                Deployment Complete
              </div>

              {/* Project IDs */}
              <div className="grid grid-cols-2 gap-2 mb-2">
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

              {/* Token address */}
              {predictedTokenAddress && (
                <div className={`text-xs mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Token: {predictedTokenAddress.slice(0, 10)}...{predictedTokenAddress.slice(-8)}
                </div>
              )}

              {/* Sucker addresses */}
              {Object.keys(suckerAddresses).length > 0 && (
                <div className={`mt-2 pt-2 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                  <div className={`text-xs font-medium mb-1 ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                    Suckers Deployed
                  </div>
                  <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Cross-chain token bridging is now enabled
                  </div>
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
                onClick={handleDeploy}
                disabled={!canProceed}
                className="flex-1 py-3 font-bold bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Deploy Revnet
              </button>
            </div>
          )}

          {isDeploying && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Do not close this window
            </div>
          )}

          {allComplete && (
            <button
              onClick={handleClose}
              className={`w-full py-3 font-medium transition-colors ${
                !hasError
                  ? 'bg-purple-500 text-white hover:bg-purple-600'
                  : isDark
                    ? 'bg-white/10 text-white hover:bg-white/20'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {!hasError ? 'Done' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
