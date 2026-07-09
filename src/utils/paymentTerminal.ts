import { type PublicClient, type Address, zeroAddress } from 'viem'
import { JB_CONTRACTS, JB_ROUTER_TERMINAL, JB_ROUTER_TERMINAL_REGISTRY, USDC_ADDRESSES, type SupportedChainId } from '../constants'

// JBMultiTerminal address (Juicebox V6 - same on all chains)
const JB_MULTI_TERMINAL = JB_CONTRACTS.JBMultiTerminal

// Native token address for ETH payments
const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

// ABI for JBDirectory
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
  {
    name: 'controllerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

// In V6 the JBSwapTerminal no longer exists. Its replacement is the
// JBRouterTerminal (a universal terminal that accepts any token and converts
// it to a token the project accepts) fronted by the JBRouterTerminalRegistry
// (a forwarding layer projects register with empty accounting contexts).
// 'router' is the V6 equivalent of the old 'swap' terminal type.
export type TerminalType = 'multi' | 'router'

export interface PaymentTerminal {
  address: Address
  type: TerminalType
}

/**
 * Determines which terminal to use for a payment based on the project's configuration.
 *
 * Queries JBDirectory.primaryTerminalOf(projectId, tokenAddress) to find which terminal
 * accepts the payment token. If no terminal is registered for that token (zero address),
 * falls back to the JBRouterTerminalRegistry, which forwards to the project's chosen
 * router terminal (which swaps the payment into a token the project accepts).
 *
 * Note: the registry resolves per-project. Projects that never registered the
 * registry (or have no accounting context the router can target yet) revert on
 * router payments — callers should surface that as "token not accepted".
 *
 * @param client - Viem public client for the chain
 * @param chainId - Chain ID (mainnets or sepolias)
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
  // Query directory for the primary terminal that accepts this token
  const terminal = await client.readContract({
    address: JB_CONTRACTS.JBDirectory,
    abi: JB_DIRECTORY_ABI,
    functionName: 'primaryTerminalOf',
    args: [projectId, paymentToken],
  })

  // If no terminal registered for this token (zero address), pay through the
  // router terminal registry (V6 replacement for the swap terminal)
  if (terminal === zeroAddress) {
    return { address: JB_ROUTER_TERMINAL_REGISTRY, type: 'router' }
  }

  // Check if the returned terminal IS the router terminal or its registry
  const terminalLower = terminal.toLowerCase()
  const isRouterTerminal =
    terminalLower === JB_ROUTER_TERMINAL_REGISTRY.toLowerCase() ||
    terminalLower === JB_ROUTER_TERMINAL.toLowerCase()

  if (isRouterTerminal) {
    return { address: terminal, type: 'router' }
  }

  // Otherwise it's the multi terminal
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
export function getPaymentTokenAddress(token: 'ETH' | 'USDC' | 'PAY_CREDITS', chainId: number): Address {
  if (token === 'ETH' || token === 'PAY_CREDITS') {
    // PAY_CREDITS payments are handled via backend API, use native token as fallback
    return NATIVE_TOKEN
  }
  return USDC_ADDRESSES[chainId as SupportedChainId] || NATIVE_TOKEN
}

/**
 * Gets the controller address for a project from JBDirectory.
 *
 * Queries JBDirectory.controllerOf(projectId) to find the controller that manages
 * the project's configuration, rulesets, and reserved token distributions.
 *
 * @param client - Viem public client for the chain
 * @param projectId - Juicebox project ID
 * @returns The controller address for the project
 */
export async function getProjectController(
  client: PublicClient,
  projectId: bigint
): Promise<Address> {
  const controller = await client.readContract({
    address: JB_CONTRACTS.JBDirectory,
    abi: JB_DIRECTORY_ABI,
    functionName: 'controllerOf',
    args: [projectId],
  })

  return controller
}

// Re-export for existing consumers
export { JB_MULTI_TERMINAL }
