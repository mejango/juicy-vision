import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAccount } from 'wagmi'
import { formatEther, isAddress } from 'viem'
import { useThemeStore, useAuthStore } from '../../stores'
import { useManagedWallet } from '../../hooks'
import { useOmnichainLaunchProject } from '../../hooks/relayr'
import { type JBRulesetConfig, type JBTerminalConfig } from '../../services/relayr'
import { type ChainConfigOverride } from '../../services/omnichainDeployer'
import { type JBSuckerBridge } from '../../utils/suckerConfig'
import {
  fetchProjectCreationFee,
  type JBDeployTiersHookConfig,
} from '../../services/omnichainDeployer'
import { useSlowChains, useCreationFees } from './modalHooks'
import { CHAINS, EXPLORER_URLS, JB_OMNICHAIN_DEPLOYER } from '../../constants'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifyLaunchProjectParams } from '../../utils/transactionVerification'
import { useReviewedTransactionAccount } from '../../hooks/useReviewedTransactionAccount'
import DialogShell from '../ui/DialogShell'
import ChainLogo from '../ui/ChainLogo'

interface LaunchProjectModalProps {
  isOpen: boolean
  onClose: () => void
  projectName: string
  owner: string
  projectUri: string
  chainIds: number[]
  rulesetConfig: JBRulesetConfig
  /** Optional multi-ruleset launch (staged rulesets); overrides rulesetConfig when set. */
  rulesetConfigs?: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  /** Optional per-chain terminal/tier overrides (e.g. chain-specific USDC contexts). */
  chainConfigs?: ChainConfigOverride[]
  /** Bridge infrastructure for auto-generated suckers ("ccip" default). */
  suckerBridge?: JBSuckerBridge
  synchronizedStartTime: number
  memo: string
  /**
   * Optional: deploy a 721 NFT tiers hook WITH the project atomically (single-chain
   * AND omnichain). When present the launch routes through JBOmnichainDeployer's 721
   * launchProjectFor overload. Non-721 callers omit it → behavior unchanged.
   */
  deployTiersHookConfig?: JBDeployTiersHookConfig
}

export default function LaunchProjectModal({
  isOpen,
  onClose,
  projectName,
  projectUri,
  chainIds,
  rulesetConfig,
  rulesetConfigs,
  terminalConfigurations,
  chainConfigs,
  suckerBridge,
  synchronizedStartTime,
  memo,
  deployTiersHookConfig,
}: LaunchProjectModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  const { isConnected, address: connectedAddress } = useAccount()
  const { address: managedAddress } = useManagedWallet()

  // Check if user has both options available
  const hasBothOptions = !!(isManagedMode && managedAddress && isConnected && connectedAddress)

  // Track user's choice when both options are available
  // null = no choice made yet (will show choice UI)
  // 'managed' = use smart account + server signing
  // 'wallet' = use connected wallet + wallet signing
  const [ownerChoice, setOwnerChoice] = useState<'managed' | 'wallet' | null>(null)

  // Reset choice when modal opens
  useEffect(() => {
    if (isOpen) {
      setOwnerChoice(null)
    }
  }, [isOpen])

  // Determine the effective owner based on choice or defaults
  const effectiveOwner = useMemo(() => {
    // If user made an explicit choice
    if (hasBothOptions && ownerChoice) {
      return ownerChoice === 'managed' ? managedAddress : connectedAddress
    }
    // Default behavior when only one option
    if (isManagedMode && managedAddress) {
      return managedAddress
    }
    if (isConnected && connectedAddress) {
      return connectedAddress
    }
    return undefined
  }, [hasBothOptions, ownerChoice, isManagedMode, managedAddress, isConnected, connectedAddress])

  // Determine if we should force self-custody mode (wallet signing)
  const forceSelfCustody = hasBothOptions && ownerChoice === 'wallet'
  const usesManagedOwner = !!effectiveOwner && !!managedAddress &&
    effectiveOwner.toLowerCase() === managedAddress.toLowerCase() && !forceSelfCustody
  const reviewedMode = usesManagedOwner ? 'managed' : 'self_custody'
  const reviewSelectionComplete = isOpen && (!hasBothOptions || ownerChoice !== null)
  const { assertCurrentAccount } = useReviewedTransactionAccount(
    reviewSelectionComplete,
    effectiveOwner,
    reviewedMode,
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

  const {
    launch,
    bundleState,
    isLaunching,
    isComplete,
    hasError,
    createdProjectIds,
    reset,
  } = useOmnichainLaunchProject({
    deploymentKey: projectUri, // Scope localStorage by projectUri to prevent state bleeding
    onSuccess: (bundleId, txHashes) => {
      console.log('Projects launched:', bundleId, txHashes)
    },
    onError: (error) => {
      console.error('Launch failed:', error)
    },
  })

  const startDate = new Date(synchronizedStartTime * 1000)
  const allCompleted = isComplete || hasError

  // Slow-chain detection
  const { slowChainIds, hasSlowChains } = useSlowChains(isLaunching, bundleState)

  // Verify transaction parameters
  const verificationResult = useMemo(() => {
    return verifyLaunchProjectParams({
      owner: effectiveOwner as `0x${string}`,
      projectUri,
      chainIds,
      rulesetConfigurations: rulesetConfigs ?? [rulesetConfig],
      terminalConfigurations,
      memo,
    })
  }, [effectiveOwner, projectUri, chainIds, rulesetConfig, rulesetConfigs, terminalConfigurations, memo])

  const hasWarnings = verificationResult.doubts.length > 0
  const hasCriticalDoubts = verificationResult.doubts.some(d => d.severity === 'critical')
  const canProceed = !!effectiveOwner &&
    isAddress(effectiveOwner) &&
    !hasCriticalDoubts &&
    (!hasWarnings || warningsAcknowledged) &&
    creationFeesReady &&
    !creationFeesLoading

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setHasStarted(false)
      setWarningsAcknowledged(false)
      reset()
    }
  }, [isOpen, reset])

  const handleLaunch = useCallback(async () => {
    if (!effectiveOwner) return
    // If both options available but no choice made, don't proceed
    if (hasBothOptions && !ownerChoice) return

    try {
      assertCurrentAccount(reviewedMode === 'self_custody' ? connectedAddress : undefined)
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
      assertCurrentAccount(reviewedMode === 'self_custody' ? connectedAddress : undefined)
      await launch({
        chainIds,
        owner: effectiveOwner,
        projectUri,
        rulesetConfigurations: rulesetConfigs ?? [rulesetConfig],
        terminalConfigurations,
        chainConfigs,
        suckerBridge,
        memo,
        forceSelfCustody,
        deployTiersHookConfig,
      })
    } catch (err) {
      setCreationFeeError(err instanceof Error ? err.message : 'Project creation fee unavailable')
    }
  }, [effectiveOwner, hasBothOptions, ownerChoice, forceSelfCustody, chainIds, projectUri, rulesetConfig, rulesetConfigs, terminalConfigurations, chainConfigs, suckerBridge, memo, deployTiersHookConfig, launch, creationFeesWei, setCreationFeesWei, setCreationFeeError, reviewedMode, connectedAddress, assertCurrentAccount])

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  if (!isOpen) return null

  return (
    <DialogShell isOpen onClose={handleClose} dismissible={!hasStarted || allCompleted || hasSlowChains} labelledBy="launch-project-modal-title">
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
              <h2 id="launch-project-modal-title" className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
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
          {(!hasStarted || allCompleted || hasSlowChains) && (
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
                    {!chainState && (
                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Waiting...
                      </span>
                    )}
                    {chainState?.status === 'pending' && (
                      slowChainIds.includes(chainId)
                        ? <span className="text-xs text-amber-500">Slow</span>
                        : <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Pending</span>
                    )}
                    {chainState?.status === 'submitted' && (
                      slowChainIds.includes(chainId)
                        ? <span className="text-xs text-amber-500">Slow</span>
                        : <div className="flex items-center gap-2">
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
              {/* Owner choice when both options available */}
              {hasBothOptions && !ownerChoice && (
                <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className={`text-xs font-medium mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Choose project owner
                  </div>
                  <div className="space-y-2">
                    <button
                      onClick={() => setOwnerChoice('wallet')}
                      className={`w-full p-3 text-left transition-colors ${
                        isDark
                          ? 'bg-white/5 hover:bg-white/10 border border-white/10'
                          : 'bg-white hover:bg-gray-50 border border-gray-200'
                      }`}
                    >
                      <div className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        Use {connectedAddress?.slice(0, 6)}...{connectedAddress?.slice(-4)}
                      </div>
                      <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Connected wallet • Sign with wallet
                      </div>
                    </button>
                    <button
                      onClick={() => setOwnerChoice('managed')}
                      className={`w-full p-3 text-left transition-colors ${
                        isDark
                          ? 'bg-white/5 hover:bg-white/10 border border-white/10'
                          : 'bg-white hover:bg-gray-50 border border-gray-200'
                      }`}
                    >
                      <div className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                        Use {managedAddress?.slice(0, 6)}...{managedAddress?.slice(-4)}
                      </div>
                      <div className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        Smart Account • No signing needed
                      </div>
                    </button>
                  </div>
                </div>
              )}

              {/* Owner (show after choice or when only one option) */}
              {(!hasBothOptions || ownerChoice) && (
                <div className={`p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                  <div className={`text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Project owner {ownerChoice === 'managed' || (!hasBothOptions && isManagedMode) ? '(Smart Account)' : '(Wallet)'}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {effectiveOwner ? `${effectiveOwner.slice(0, 8)}...${effectiveOwner.slice(-6)}` : 'Not connected'}
                    </div>
                    {hasBothOptions && ownerChoice && (
                      <button
                        onClick={() => setOwnerChoice(null)}
                        className={`text-xs ${isDark ? 'text-juice-cyan hover:text-juice-cyan/80' : 'text-blue-600 hover:text-blue-500'}`}
                      >
                        Change
                      </button>
                    )}
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

              {/* Transaction Summary */}
              <TransactionSummary
                type="launchProject"
                details={{
                  projectName,
                  owner: effectiveOwner || '',
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
                contract="JB_OMNICHAIN_DEPLOYER"
                contractAddress={JB_OMNICHAIN_DEPLOYER}
                functionName="launchProjectFor"
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
                    <ChainLogo chainId={Number(chainId)} size={14} />
                    <span className={`text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                      {CHAINS[Number(chainId)]?.shortName}: #{projectId}
                    </span>
                  </div>
                ))}
              </div>
              {chainIds.length > 1 && (
                <div className={`text-xs mt-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Cross-chain bridges were deployed atomically with these projects.
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
                disabled={!canProceed || (hasBothOptions && !ownerChoice)}
                className="flex-1 py-3 font-bold bg-juice-orange text-black hover:bg-juice-orange/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {hasBothOptions && !ownerChoice ? 'Choose project owner' : `Create Project${chainIds.length > 1 ? 's' : ''}`}
              </button>
            </div>
          )}

          {isLaunching && !hasSlowChains && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Do not close this window
            </div>
          )}

          {isLaunching && hasSlowChains && (
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
    </DialogShell>
  )
}
