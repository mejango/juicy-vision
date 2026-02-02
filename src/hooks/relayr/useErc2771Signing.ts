/**
 * ERC-2771 Meta-Transaction Signing
 *
 * Wraps transactions with user signatures so _msgSender() in contracts
 * returns the user's address instead of the relayer's address.
 *
 * This is critical for:
 * - Project ownership (owner is set correctly)
 * - Future extensibility (user can add chains to their project)
 */

import { useCallback } from 'react'
import { useAccount, useSignTypedData, usePublicClient } from 'wagmi'
import { encodeFunctionData, getContract, type Address, type Hex } from 'viem'
import {
  ERC2771_FORWARDER_ADDRESS,
  ERC2771_FORWARDER_ABI,
  FORWARD_REQUEST_TYPES,
} from '../../constants/abis'

export interface ForwardRequestInput {
  chainId: number
  to: string      // Original target contract
  data: string    // Original calldata
  value: string   // ETH value (usually '0x0')
}

export interface WrappedTransaction {
  chainId: number
  target: string  // TrustedForwarder address
  data: string    // execute(ForwardRequest) calldata
  value: string
}

// 48 hours deadline
const DEADLINE_DURATION_SECONDS = 48 * 60 * 60

/**
 * Hook for signing ERC-2771 forward requests.
 *
 * Usage:
 * 1. Build your original transactions
 * 2. Call signAndWrapTransactions() with the array
 * 3. User signs once per chain
 * 4. Returns wrapped transactions targeting TrustedForwarder
 */
export function useErc2771Signing() {
  const { address } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()

  /**
   * Sign and wrap a single transaction for ERC-2771 forwarding.
   * Returns the wrapped transaction targeting TrustedForwarder.
   */
  const signAndWrapTransaction = useCallback(async (
    tx: ForwardRequestInput,
    publicClient: ReturnType<typeof usePublicClient>
  ): Promise<WrappedTransaction> => {
    if (!address) throw new Error('Wallet not connected')
    if (!publicClient) throw new Error('Public client not available')

    const chainId = tx.chainId

    // Get user's nonce from the forwarder contract
    const forwarderContract = getContract({
      address: ERC2771_FORWARDER_ADDRESS,
      abi: ERC2771_FORWARDER_ABI,
      client: publicClient,
    })

    const nonce = await forwarderContract.read.nonces([address])

    // Calculate deadline (48 hours from now)
    const deadline = Math.floor(Date.now() / 1000) + DEADLINE_DURATION_SECONDS

    // Build the forward request message
    const messageData = {
      from: address as Address,
      to: tx.to as Address,
      value: BigInt(tx.value || '0'),
      gas: BigInt(2000000), // Conservative gas estimate
      nonce,
      deadline,
      data: tx.data as Hex,
    }

    // Sign the EIP-712 typed data
    const signature = await signTypedDataAsync({
      domain: {
        name: 'Juicebox',
        chainId,
        verifyingContract: ERC2771_FORWARDER_ADDRESS,
        version: '1',
      },
      primaryType: 'ForwardRequest',
      types: FORWARD_REQUEST_TYPES,
      message: messageData,
    })

    // Encode the execute() call with the signed request
    const executeData = encodeFunctionData({
      abi: ERC2771_FORWARDER_ABI,
      functionName: 'execute',
      args: [{
        from: messageData.from,
        to: messageData.to,
        value: messageData.value,
        gas: messageData.gas,
        deadline: messageData.deadline,
        data: messageData.data,
        signature,
      }],
    })

    return {
      chainId,
      target: ERC2771_FORWARDER_ADDRESS,
      data: executeData,
      value: tx.value,
    }
  }, [address, signTypedDataAsync])

  /**
   * Sign and wrap multiple transactions for different chains.
   * User will be prompted to sign once per chain.
   */
  const signAndWrapTransactions = useCallback(async (
    transactions: ForwardRequestInput[],
    getPublicClient: (chainId: number) => ReturnType<typeof usePublicClient>
  ): Promise<WrappedTransaction[]> => {
    if (!address) throw new Error('Wallet not connected')

    const wrappedTxs: WrappedTransaction[] = []

    // Sign sequentially (user needs to approve each chain)
    for (const tx of transactions) {
      const publicClient = getPublicClient(tx.chainId)
      const wrapped = await signAndWrapTransaction(tx, publicClient)
      wrappedTxs.push(wrapped)
    }

    return wrappedTxs
  }, [address, signAndWrapTransaction])

  return {
    signAndWrapTransaction,
    signAndWrapTransactions,
    isConnected: !!address,
  }
}
