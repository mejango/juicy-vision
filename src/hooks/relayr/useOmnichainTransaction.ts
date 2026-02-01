import { useCallback, useEffect, useMemo } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { useAuthStore } from '../../stores'
import { useManagedWallet } from '../useManagedWallet'
import {
  createPrepaidBundle,
  createBalanceBundle,
  sendBundlePayment,
  buildOmnichainQueueRulesetTransactions,
  buildOmnichainDistributeTransactions,
  buildOmnichainDeployERC20Transactions,
  type JBOmnichainQueueRequest,
  type JBOmnichainDistributeRequest,
  type JBOmnichainDeployERC20Request,
  type JBRulesetConfig,
} from '../../services/relayr'
import { useRelayrBundle } from './useRelayrBundle'
import { useRelayrStatus } from './useRelayrStatus'
import type {
  OmnichainExecuteParams,
  UseOmnichainTransactionOptions,
  UseOmnichainTransactionReturn,
} from './types'

// Relayr app ID for sponsored bundles
const RELAYR_APP_ID = import.meta.env.VITE_RELAYR_APP_ID || 'juicy-vision'

/**
 * High-level hook for omnichain transaction execution.
 * Supports dual-mode: managed wallets (org-sponsored) and self-custody (user pays on one chain).
 *
 * @example
 * const { execute, bundleState, isExecuting } = useOmnichainTransaction({
 *   onSuccess: (bundleId, txHashes) => console.log('All chains confirmed'),
 * })
 *
 * // Queue rulesets across chains
 * await execute({
 *   chainIds: [1, 10, 8453],
 *   projectIds: { 1: 100, 10: 100, 8453: 100 },
 *   rulesetConfig: { rulesetConfigurations: [...], memo: 'Queue' },
 * })
 */
export function useOmnichainTransaction(
  options: UseOmnichainTransactionOptions = {}
): UseOmnichainTransactionReturn {
  const { onSuccess, onError, onPaymentRequired } = options

  // Auth state
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()

  // Wallet state
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { address: managedAddress } = useManagedWallet()

  // Bundle state management
  const bundle = useRelayrBundle() as ReturnType<typeof useRelayrBundle> & {
    _initializeBundle: (
      bundleId: string,
      chainIds: number[],
      projectIds: Record<number, number>,
      paymentOptions: Array<{ chainId: number; token: string; amount: string; estimatedGas: string }>,
      synchronizedStartTime?: number,
      expiresAt?: number
    ) => void
    _setCreating: () => void
    _setProcessing: (txHash: string) => void
    _setError: (error: string) => void
    _setExpired: () => void
  }
  const { bundleState, reset, setPaymentChain, updateFromStatus } = bundle

  // Status polling
  const { data: statusData } = useRelayrStatus({
    bundleId: bundleState.bundleId,
    enabled: bundleState.status === 'processing',
    stopOnComplete: true,
  })

  // Update bundle state from polling
  useEffect(() => {
    if (statusData) {
      updateFromStatus(statusData)
    }
  }, [statusData, updateFromStatus])

  // Call onSuccess when complete
  useEffect(() => {
    if (bundleState.status === 'completed' && bundleState.bundleId) {
      const txHashes: Record<number, string> = {}
      bundleState.chainStates.forEach(cs => {
        if (cs.txHash) {
          txHashes[cs.chainId] = cs.txHash
        }
      })
      onSuccess?.(bundleState.bundleId, txHashes)
    }
  }, [bundleState.status, bundleState.bundleId, bundleState.chainStates, onSuccess])

  // Call onError when failed or expired
  useEffect(() => {
    if ((bundleState.status === 'failed' || bundleState.status === 'expired') && bundleState.error) {
      onError?.(new Error(bundleState.error))
    }
  }, [bundleState.status, bundleState.error, onError])

  /**
   * Execute omnichain transactions.
   * For managed mode: creates balance-sponsored bundle.
   * For self-custody: creates prepaid bundle, returns payment options.
   */
  const execute = useCallback(async (params: OmnichainExecuteParams) => {
    const { chainIds, projectIds, rulesetConfig, distributeConfig, deployERC20Config } = params

    // Validate wallet
    const activeAddress = isManagedMode ? managedAddress : address
    if (!activeAddress) {
      bundle._setError('Wallet not connected')
      return
    }

    bundle._setCreating()

    try {
      if (isManagedMode) {
        // MANAGED MODE: Create balance-sponsored bundle
        let transactions: Array<{ chain: number; target: string; data?: string; value?: string }>

        if (rulesetConfig) {
          const omnichainRequest: JBOmnichainQueueRequest = {
            chainIds,
            projectIds,
            rulesetConfigurations: rulesetConfig.rulesetConfigurations as JBRulesetConfig[],
            memo: rulesetConfig.memo,
            mustStartAtOrAfter: rulesetConfig.mustStartAtOrAfter,
          }
          const response = await buildOmnichainQueueRulesetTransactions(omnichainRequest)
          transactions = response.transactions.map(tx => ({
            chain: tx.txData.chainId,
            target: tx.txData.to,
            data: tx.txData.data,
            value: tx.txData.value,
          }))
        } else if (distributeConfig) {
          const distributeRequest: JBOmnichainDistributeRequest = {
            chainIds,
            projectIds,
            type: distributeConfig.type,
          }
          const response = await buildOmnichainDistributeTransactions(distributeRequest)
          transactions = response.transactions.map(tx => ({
            chain: tx.txData.chainId,
            target: tx.txData.to,
            data: tx.txData.data,
            value: tx.txData.value,
          }))
        } else if (deployERC20Config) {
          const deployRequest: JBOmnichainDeployERC20Request = {
            chainIds,
            projectIds,
            tokenName: deployERC20Config.tokenName,
            tokenSymbol: deployERC20Config.tokenSymbol,
            salt: deployERC20Config.salt,
          }
          const response = await buildOmnichainDeployERC20Transactions(deployRequest)
          transactions = response.transactions.map(tx => ({
            chain: tx.txData.chainId,
            target: tx.txData.to,
            data: tx.txData.data,
            value: tx.txData.value,
          }))
        } else {
          throw new Error('One of rulesetConfig, distributeConfig, or deployERC20Config is required')
        }

        const bundleResponse = await createBalanceBundle({
          app_id: RELAYR_APP_ID,
          transactions: transactions.map(tx => ({
            ...tx,
          })),
          perform_simulation: true,
          virtual_nonce_mode: 'Disabled',
        })

        // For managed mode, bundle starts processing immediately
        bundle._initializeBundle(
          bundleResponse.bundle_uuid,
          chainIds,
          projectIds,
          [],
          rulesetConfig?.mustStartAtOrAfter
        )
        bundle._setProcessing('sponsored')
      } else {
        // SELF-CUSTODY MODE: Create prepaid bundle
        if (!walletClient) {
          throw new Error('Wallet client not available')
        }

        let transactions: Array<{ chain: number; target: string; data?: string; value?: string }>
        let synchronizedStartTime: number | undefined

        if (rulesetConfig) {
          const omnichainRequest: JBOmnichainQueueRequest = {
            chainIds,
            projectIds,
            rulesetConfigurations: rulesetConfig.rulesetConfigurations as JBRulesetConfig[],
            memo: rulesetConfig.memo,
            mustStartAtOrAfter: rulesetConfig.mustStartAtOrAfter,
          }
          const response = await buildOmnichainQueueRulesetTransactions(omnichainRequest)
          transactions = response.transactions.map(tx => ({
            chain: tx.txData.chainId,
            target: tx.txData.to,
            data: tx.txData.data,
            value: tx.txData.value,
          }))
          synchronizedStartTime = response.synchronizedStartTime
        } else if (distributeConfig) {
          const distributeRequest: JBOmnichainDistributeRequest = {
            chainIds,
            projectIds,
            type: distributeConfig.type,
          }
          const response = await buildOmnichainDistributeTransactions(distributeRequest)
          transactions = response.transactions.map(tx => ({
            chain: tx.txData.chainId,
            target: tx.txData.to,
            data: tx.txData.data,
            value: tx.txData.value,
          }))
        } else if (deployERC20Config) {
          const deployRequest: JBOmnichainDeployERC20Request = {
            chainIds,
            projectIds,
            tokenName: deployERC20Config.tokenName,
            tokenSymbol: deployERC20Config.tokenSymbol,
            salt: deployERC20Config.salt,
          }
          const response = await buildOmnichainDeployERC20Transactions(deployRequest)
          transactions = response.transactions.map(tx => ({
            chain: tx.txData.chainId,
            target: tx.txData.to,
            data: tx.txData.data,
            value: tx.txData.value,
          }))
        } else {
          throw new Error('One of rulesetConfig, distributeConfig, or deployERC20Config is required')
        }

        const bundleResponse = await createPrepaidBundle({
          signer_address: activeAddress,
          transactions,
        })

        bundle._initializeBundle(
          bundleResponse.bundle_uuid,
          chainIds,
          projectIds,
          bundleResponse.payment_options,
          synchronizedStartTime,
          bundleResponse.expires_at
        )

        // Notify about payment options
        onPaymentRequired?.(bundleResponse.payment_options)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create bundle'
      bundle._setError(errorMessage)
      onError?.(err instanceof Error ? err : new Error(errorMessage))
    }
  }, [
    isManagedMode,
    managedAddress,
    address,
    walletClient,
    bundle,
    onPaymentRequired,
    onError,
  ])

  /**
   * Submit payment for a prepaid bundle (self-custody mode).
   * Call this after user signs the payment transaction.
   */
  const submitPayment = useCallback(async (signedTx: string) => {
    if (!bundleState.bundleId || !bundleState.selectedPaymentChain) {
      bundle._setError('No bundle or payment chain selected')
      return
    }

    try {
      await sendBundlePayment({
        bundle_uuid: bundleState.bundleId,
        chain_id: bundleState.selectedPaymentChain,
        signed_tx: signedTx,
      })

      bundle._setProcessing(signedTx.slice(0, 66)) // Use first 66 chars as pseudo tx hash
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit payment'
      bundle._setError(errorMessage)
      onError?.(err instanceof Error ? err : new Error(errorMessage))
    }
  }, [bundleState.bundleId, bundleState.selectedPaymentChain, bundle, onError])

  const isExecuting = bundleState.status === 'creating' ||
    bundleState.status === 'awaiting_payment' ||
    bundleState.status === 'processing'

  return useMemo(() => ({
    execute,
    submitPayment,
    bundleState,
    isExecuting,
    isComplete: bundleState.status === 'completed',
    isExpired: bundleState.status === 'expired',
    hasError: bundleState.status === 'failed' || bundleState.status === 'partial' || bundleState.status === 'expired',
    reset,
    setPaymentChain,
  }), [
    execute,
    submitPayment,
    bundleState,
    isExecuting,
    reset,
    setPaymentChain,
  ])
}
