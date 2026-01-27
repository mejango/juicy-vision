import { useCallback, useMemo } from 'react'
import { keccak256, toBytes } from 'viem'
import { useOmnichainTransaction } from './useOmnichainTransaction'
import type { UseOmnichainTransactionOptions, UseOmnichainTransactionReturn } from './types'

export interface OmnichainDeployERC20Params {
  chainIds: number[]
  projectIds: Record<number, number>  // chainId -> projectId
  tokenName: string
  tokenSymbol: string
  // Salt is auto-generated to be deterministic based on project + symbol
  // This ensures same address on all chains via CREATE2
}

export interface UseOmnichainDeployERC20Return extends Omit<UseOmnichainTransactionReturn, 'execute'> {
  deploy: (params: OmnichainDeployERC20Params) => Promise<void>
}

/**
 * Generate a deterministic salt for cross-chain ERC20 deployment.
 * Uses project ID and token symbol to ensure same address on all chains.
 */
function generateDeterministicSalt(projectId: number, tokenSymbol: string): string {
  // Use a deterministic input that's the same regardless of chain
  // This ensures CREATE2 produces the same address on all chains
  const saltInput = `juicebox-erc20-v1-${projectId}-${tokenSymbol.toUpperCase()}`
  return keccak256(toBytes(saltInput))
}

/**
 * Hook for deploying ERC20 tokens across multiple chains with Relayr.
 * User pays gas on ONE chain, Relayr executes on ALL chains.
 * Uses deterministic salt to ensure SAME token address on all chains.
 *
 * @example
 * const { deploy, bundleState, isExecuting } = useOmnichainDeployERC20({
 *   onSuccess: (bundleId, txHashes) => console.log('Deployed on all chains'),
 * })
 *
 * await deploy({
 *   chainIds: [1, 10, 8453, 42161],
 *   projectIds: { 1: 100, 10: 100, 8453: 100, 42161: 100 },
 *   tokenName: 'My Token',
 *   tokenSymbol: 'MTK',
 * })
 */
export function useOmnichainDeployERC20(
  options: UseOmnichainTransactionOptions = {}
): UseOmnichainDeployERC20Return {
  const transaction = useOmnichainTransaction(options)

  const deploy = useCallback(async (params: OmnichainDeployERC20Params) => {
    const { chainIds, projectIds, tokenName, tokenSymbol } = params

    // Use the first project ID for salt generation (they should all be the same cross-chain project)
    const primaryProjectId = Object.values(projectIds)[0]
    if (!primaryProjectId) {
      throw new Error('No project ID provided')
    }

    // Generate deterministic salt for same address on all chains
    const salt = generateDeterministicSalt(primaryProjectId, tokenSymbol)

    await transaction.execute({
      chainIds,
      projectIds,
      deployERC20Config: {
        tokenName,
        tokenSymbol,
        salt,
      },
    })
  }, [transaction])

  return useMemo(() => ({
    deploy,
    bundleState: transaction.bundleState,
    isExecuting: transaction.isExecuting,
    isComplete: transaction.isComplete,
    isExpired: transaction.isExpired,
    hasError: transaction.hasError,
    reset: transaction.reset,
    setPaymentChain: transaction.setPaymentChain,
    submitPayment: transaction.submitPayment,
  }), [transaction, deploy])
}
