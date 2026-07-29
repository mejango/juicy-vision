import { useState, useEffect, useCallback, useMemo } from 'react'
import { formatEther, isAddress, keccak256, toBytes } from 'viem'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import { useOmnichainDeployRevnet } from '../../hooks/relayr'
import { type REVStageConfig } from '../../services/relayr'
import {
  fetchProjectCreationFee,
  type JBDeployTiersHookConfig,
} from '../../services/omnichainDeployer'
import { useSlowChains, useCreationFees } from './modalHooks'
import { CHAINS, EXPLORER_URLS, REV_DEPLOYER } from '../../constants'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifyDeployRevnetParams } from '../../utils/transactionVerification'
import { type JBSuckerBridge } from '../../utils/suckerConfig'
import { isIpfsUri } from '../../utils/ipfs'
import { useReviewedTransactionAccount } from '../../hooks/useReviewedTransactionAccount'
import DialogShell from '../ui/DialogShell'
import ChainLogo from '../ui/ChainLogo'

function revnetDeploymentKey(value: unknown): string {
  return keccak256(toBytes(JSON.stringify(
    value,
    (_key, item) => typeof item === 'bigint' ? item.toString() : item,
  )))
}

interface DeployRevnetModalProps {
  isOpen: boolean
  onClose: () => void
  name: string
  ticker: string
  tagline: string
  projectUri: string
  splitOperator: string
  chainIds: number[]
  stageConfigurations: REVStageConfig[]
  autoDeploySuckers: boolean
  /** Bridge infrastructure for auto-generated suckers ("ccip" default). */
  suckerBridge?: JBSuckerBridge
  /** Optional 721 tiers hook (NFT shop) to deploy atomically with the revnet. */
  deployTiersHookConfig?: JBDeployTiersHookConfig
}

export default function DeployRevnetModal({
  isOpen,
  onClose,
  name,
  ticker,
  tagline,
  projectUri,
  splitOperator,
  chainIds,
  stageConfigurations,
  autoDeploySuckers,
  suckerBridge,
  deployTiersHookConfig,
}: DeployRevnetModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  const { address: managedAddress } = useManagedWallet()
  const { assertCurrentAccount } = useReviewedTransactionAccount(
    isOpen,
    managedAddress,
    'managed',
  )

  const [hasStarted, setHasStarted] = useState(false)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const {
    creationFeesWei,
    setCreationFeesWei,
    creationFeesLoading,
    creationFeeError,
    setCreationFeeError,
    creationFeesReady,
    totalCreationFee,
  } = useCreationFees(isOpen, chainIds)
  const deploymentKey = useMemo(() => revnetDeploymentKey({
    chainIds,
    stageConfigurations,
    splitOperator,
    name,
    ticker,
    tagline,
    projectUri,
    autoDeploySuckers,
    deployTiersHookConfig,
  }), [
    chainIds,
    stageConfigurations,
    splitOperator,
    name,
    ticker,
    tagline,
    projectUri,
    autoDeploySuckers,
    deployTiersHookConfig,
  ])

  // Revnet deployment hook
  const {
    deploy,
    bundleState: revnetBundleState,
    isDeploying: isDeployingRevnet,
    isComplete: revnetComplete,
    hasError: revnetError,
    createdProjectIds,
    predictedTokenAddress,
    persistedTxHashes,
    reset: resetRevnet,
  } = useOmnichainDeployRevnet({
    deploymentKey,
    onSuccess: (bundleId, txHashes) => {
      console.log('Revnet deployed:', bundleId, txHashes)
    },
    onError: (error) => {
      console.error('Revnet deployment failed:', error)
    },
  })

  const isDeploying = isDeployingRevnet
  const allComplete = revnetComplete
  const hasError = revnetError

  // Slow-chain detection
  const { slowChainIds, hasSlowChains } = useSlowChains(isDeploying, revnetBundleState)

  // Verify transaction parameters
  const verificationResult = useMemo(() => {
    return verifyDeployRevnetParams({
      splitOperator: splitOperator as `0x${string}`,
      name,
      ticker,
      tagline,
      projectUri,
      chainIds,
      stageConfigurations,
    })
  }, [splitOperator, name, ticker, tagline, projectUri, chainIds, stageConfigurations])

  const hasWarnings = verificationResult.doubts.length > 0
  const hasCriticalDoubts = verificationResult.doubts.some(d => d.severity === 'critical')
  const operatorMatchesManagedAccount = !!managedAddress &&
    isAddress(splitOperator) &&
    splitOperator.toLowerCase() === managedAddress.toLowerCase()
  const canProceed = operatorMatchesManagedAccount &&
    isManagedMode &&
    !hasCriticalDoubts &&
    (!hasWarnings || warningsAcknowledged) &&
    creationFeesReady &&
    !creationFeesLoading &&
    isIpfsUri(projectUri, false)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setHasStarted(false)
      setWarningsAcknowledged(false)
      resetRevnet()
    }
  }, [isOpen, resetRevnet])

  useEffect(() => {
    if (isOpen && (isDeploying || allComplete)) setHasStarted(true)
  }, [isOpen, isDeploying, allComplete])

  const handleDeploy = useCallback(async () => {
    if (!isManagedMode || !managedAddress || !operatorMatchesManagedAccount) return
    try {
      assertCurrentAccount()
      const freshFees = Object.fromEntries(await Promise.all(
        chainIds.map(async chainId => [chainId, await fetchProjectCreationFee(chainId)] as const),
      ))
      for (const chainId of chainIds) {
        if (freshFees[chainId] !== creationFeesWei[chainId]) {
          setCreationFeesWei(freshFees)
          throw new Error('The project creation fee changed. Review the updated fee before continuing.')
        }
      }
      setHasStarted(true)
      assertCurrentAccount()
      await deploy({
        chainIds,
        stageConfigurations,
        splitOperator,
        name,
        ticker,
        tagline,
        projectUri,
        suckerBridge,
        configureSuckers: autoDeploySuckers && chainIds.length > 1,
        deployTiersHookConfig,
      })
    } catch (err) {
      setCreationFeeError(err instanceof Error ? err.message : 'Project creation fee unavailable')
    }
  }, [splitOperator, chainIds, stageConfigurations, name, ticker, tagline, projectUri, suckerBridge, autoDeploySuckers, deployTiersHookConfig, deploy, isManagedMode, managedAddress, operatorMatchesManagedAccount, creationFeesWei, assertCurrentAccount, setCreationFeesWei, setCreationFeeError])

  const handleClose = useCallback(() => {
    resetRevnet()
    onClose()
  }, [resetRevnet, onClose])

  if (!isOpen) return null

  const activeBundleState = revnetBundleState

  return (
    <DialogShell isOpen onClose={handleClose} dismissible={!hasStarted || allComplete || hasSlowChains} labelledBy="deploy-revnet-modal-title">
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
              <h2 id="deploy-revnet-modal-title" className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {allComplete && !hasError
                  ? 'Revnet Deployed'
                  : hasError
                    ? 'Deployment Failed'
                    : hasStarted
                      ? 'Deploying Revnet...'
                      : 'Deploy Revnet'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {name || 'New Revnet'}
              </p>
            </div>
          </div>
          {(!hasStarted || allComplete || hasSlowChains) && (
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
          {/* Atomic deployment indicator */}
          {hasStarted && (
            <div className={`p-3 ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
              <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    revnetComplete
                      ? 'bg-green-500 text-white'
                      : 'bg-purple-500 text-white'
                  }`}>
                    {revnetComplete ? '✓' : '1'}
                  </div>
                  <span className={`text-xs font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    {autoDeploySuckers && chainIds.length > 1
                      ? 'Revnet and cross-chain bridges'
                      : 'Revnet'}
                  </span>
              </div>
            </div>
          )}

          {/* Chain Status */}
          <div className="space-y-2">
            {chainIds.map((chainId) => {
              const chain = CHAINS[chainId]
              const chainState = activeBundleState.chainStates.find(cs => cs.chainId === chainId)
              const persistedHash = persistedTxHashes?.[chainId]
              const displayStatus = chainState?.status || (persistedHash ? 'confirmed' : undefined)
              const displayHash = chainState?.txHash || persistedHash
              const projectId = createdProjectIds[chainId]

              return (
                <div
                  key={chainId}
                  className={`p-3 flex items-center justify-between ${
                    isDark ? 'bg-white/5' : 'bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ChainLogo chainId={chainId} size={16} />
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
                    {!displayStatus && (
                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Waiting...
                      </span>
                    )}
                    {displayStatus === 'pending' && (
                      slowChainIds.includes(chainId)
                        ? <span className="text-xs text-amber-500">Slow</span>
                        : <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Pending</span>
                    )}
                    {displayStatus === 'submitted' && (
                      slowChainIds.includes(chainId)
                        ? <span className="text-xs text-amber-500">Slow</span>
                        : <div className="flex items-center gap-2">
                            <div className="animate-spin w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full" />
                            <span className={`text-xs ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
                              Creating...
                            </span>
                          </div>
                    )}
                    {displayStatus === 'confirmed' && (
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">✓</span>
                        {displayHash && (
                          <a
                            href={`${EXPLORER_URLS[chainId]}${displayHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-juice-cyan hover:underline"
                          >
                            View
                          </a>
                        )}
                      </div>
                    )}
                    {displayStatus === 'failed' && (
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
          {hasError && revnetBundleState.error && (
            <div className={`p-3 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              <span className={`text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                {revnetBundleState.error}
              </span>
            </div>
          )}

          {/* Pre-deploy info */}
          {!hasStarted && !allComplete && (
            <>
              {/* Stages summary */}
              <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {stageConfigurations.length} Stage{stageConfigurations.length !== 1 ? 's' : ''} Configured
                </div>
                {stageConfigurations.map((stage, idx) => (
                  <div key={idx} className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    Stage {idx + 1}: {(stage.splitPercent / 100).toFixed(1)}% operator split,{' '}
                    {(stage.issuanceCutPercent / 10000000).toFixed(1)}% issuance cut every{' '}
                    {Math.round(stage.issuanceCutFrequency / 86400)} days
                  </div>
                ))}
              </div>

              {/* Project operator */}
              <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className={`text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Project operator
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
                    Cross-chain bridges will be deployed atomically with the revnet
                  </div>
                </div>
              )}

              {/* Gas Sponsorship */}
              <div className={`p-3 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
                <div className={`text-xs font-medium ${isDark ? 'text-green-400' : 'text-green-700'}`}>
                  Gas Sponsored
                </div>
                <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {creationFeesLoading
                    ? 'Checking the protocol creation fee...'
                    : !creationFeesReady
                      ? creationFeeError
                      : `${creationFeeError ? `${creationFeeError} ` : ''}Protocol creation fee included: ${formatEther(totalCreationFee)} ETH total across ${chainIds.length} chain${chainIds.length !== 1 ? 's' : ''}.`}
                </div>
              </div>

              {!isManagedMode && (
                <div className={`p-3 text-xs ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-50 text-amber-800'}`}>
                  Revnet deployment is unavailable until you sign in with a managed wallet.
                </div>
              )}

              {isManagedMode && !operatorMatchesManagedAccount && (
                <div className={`p-3 text-xs ${isDark ? 'bg-red-500/10 text-red-300' : 'bg-red-50 text-red-800'}`}>
                  Deployment blocked: the revnet operator must be your active managed account.
                </div>
              )}

              {/* Transaction Summary */}
              <TransactionSummary
                type="deployRevnet"
                details={{
                  name,
                  chainIds,
                  stages: stageConfigurations.map((stage) => ({
                    splitPercent: stage.splitPercent / 100,
                    decayPercent: stage.issuanceCutPercent / 10000000,
                    decayFrequency: `${Math.round(stage.issuanceCutFrequency / 86400)} days`,
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
                  chainName: CHAINS[cid]?.name || `Chain ${cid}`,
                }))}
              />

            </>
          )}

          {/* Processing indicator */}
          {isDeploying && (
            <div className={`p-3 flex items-center gap-3 ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full" />
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {activeBundleState.status === 'creating'
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
                    <ChainLogo chainId={Number(chainId)} size={14} />
                    <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {CHAINS[Number(chainId)]?.shortName}: #{projectId}
                    </span>
                  </div>
                ))}
              </div>

              {Object.keys(createdProjectIds).length === 0 && (
                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Project IDs could not be decoded yet. Use the confirmed transaction links below to verify them.
                </div>
              )}

              {/* Token address */}
              {predictedTokenAddress && (
                <div className={`text-xs mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Token: {predictedTokenAddress.slice(0, 10)}...{predictedTokenAddress.slice(-8)}
                </div>
              )}

              {autoDeploySuckers && chainIds.length > 1 && (
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

          {isDeploying && !hasSlowChains && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Do not close this window
            </div>
          )}

          {isDeploying && hasSlowChains && (
            <div className="space-y-3">
              <div className={`p-3 text-sm ${isDark ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-700'}`}>
                Some chains are taking longer than expected. Confirmed chains are already live. You can safely close.
              </div>
              <button
                onClick={handleClose}
                className="w-full py-3 font-medium bg-amber-500 text-black hover:bg-amber-600 transition-colors"
              >
                Close (slow chains will continue)
              </button>
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
    </DialogShell>
  )
}
