import { type PublicClient, type Address, zeroAddress } from 'viem'
import { JB_CONTRACTS, JB_SWAP_TERMINAL, USDC_ADDRESSES, type SupportedChainId } from '../constants'

// JBMultiTerminal5_1 address (same on all chains via CREATE2)
const JB_MULTI_TERMINAL = '0x52869db3d61dde1e391967f2ce5039ad0ecd371c' as const

// Native token address for ETH payments
const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

// ABI for JBDirectory.primaryTerminalOf
const JB_DIRECTORY_ABI = [
  {
    name: 'primaryTerminalOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export type TerminalType = 'multi' | 'swap'

export interface PaymentTerminal {
  address: Address
  type: TerminalType
}

/**
 * Determines which terminal to use for a payment based on the project's configuration.
 *
 * Queries JBDirectory.primaryTerminalOf(projectId, tokenAddress) to find which terminal
 * accepts the payment token. If no terminal is registered for that token (zero address),
 * falls back to the JBSwapTerminal which can swap tokens before crediting the project.
 *
 * @param client - Viem public client for the chain
 * @param chainId - Chain ID (1, 10, 8453, 42161)
 * @param projectId - Juicebox project ID
 * @param paymentToken - Token address the user wants to pay with (ETH native token or USDC)
 * @returns The terminal address and type to use for the payment
 */
export async function getPaymentTerminal(
  client: PublicClient,
  chainId: number,
  projectId: bigint,
  paymentToken: Address
): Promise<PaymentTerminal> {
  const supportedChainId = chainId as SupportedChainId

  // Query directory for the primary terminal that accepts this token
  const terminal = await client.readContract({
    address: JB_CONTRACTS.JBDirectory,
    abi: JB_DIRECTORY_ABI,
    functionName: 'primaryTerminalOf',
    args: [projectId, paymentToken],
  })

  console.log('[Terminal] primaryTerminalOf result:', terminal, 'for token:', paymentToken)

  // Get swap terminal address for this chain
  const swapTerminal = JB_SWAP_TERMINAL[supportedChainId]

  // If no terminal registered for this token (zero address), use swap terminal
  if (terminal === zeroAddress) {
    console.log('[Terminal] No direct terminal found, using SwapTerminal:', swapTerminal)
    return { address: swapTerminal, type: 'swap' }
  }

  // Check if the returned terminal IS the swap terminal
  const isSwapTerminal = terminal.toLowerCase() === swapTerminal?.toLowerCase()

  if (isSwapTerminal) {
    console.log('[Terminal] Primary terminal is SwapTerminal:', terminal)
    return { address: terminal, type: 'swap' }
  }

  // Otherwise it's the multi terminal
  console.log('[Terminal] Using MultiTerminal:', terminal)
  return { address: terminal, type: 'multi' }
}

/**
 * Checks if a token address is the native token (ETH)
 */
export function isNativeToken(address: Address): boolean {
  return address.toLowerCase() === NATIVE_TOKEN.toLowerCase()
}

/**
 * Gets the token address for a payment token symbol
 */
export function getPaymentTokenAddress(token: 'ETH' | 'USDC', chainId: number): Address {
  if (token === 'ETH') {
    return NATIVE_TOKEN
  }
  return USDC_ADDRESSES[chainId as SupportedChainId] || NATIVE_TOKEN
}
