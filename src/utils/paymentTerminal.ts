import { type PublicClient, type Address, zeroAddress } from 'viem'
import { NATIVE_TOKEN, jbDirectoryAbi, jbRouterTerminalRegistryAbi, type JBChainId } from '@bananapus/nana-sdk-core'
import { getAccountingContexts, resolvePaymentTerminal, tokenCurrencyId } from '@bananapus/nana-sdk-core/v6'
import { JB_CONTRACTS, JB_ROUTER_TERMINAL, JB_ROUTER_TERMINAL_REGISTRY, USDC_ADDRESSES, type SupportedChainId } from '../constants'

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

export function recognizedTerminalType(address: Address): TerminalType | null {
  const normalized = address.toLowerCase()
  if (normalized === JB_CONTRACTS.JBMultiTerminal.toLowerCase()) return 'multi'
  if (
    normalized === JB_ROUTER_TERMINAL.toLowerCase() ||
    normalized === JB_ROUTER_TERMINAL_REGISTRY.toLowerCase()
  ) return 'router'
  return null
}

export function requireRecognizedTerminal(
  address: Address,
  operation: 'pay' | 'accounting' = 'accounting'
): PaymentTerminal {
  const type = recognizedTerminalType(address)
  if (!type || (operation === 'accounting' && type !== 'multi')) {
    throw new Error(`Terminal not recognized for ${operation}: ${address}`)
  }
  return { address, type }
}

async function requireRecognizedRegistryDestination(
  client: Pick<PublicClient, 'readContract'>,
  projectId: bigint,
  registry: Address,
): Promise<PaymentTerminal> {
  const destination = await client.readContract({
    address: registry,
    abi: jbRouterTerminalRegistryAbi,
    functionName: 'terminalOf',
    args: [projectId],
  })

  if (destination === zeroAddress) {
    throw new Error('The payment router has no destination for this project')
  }

  const recognized = requireRecognizedTerminal(destination, 'pay')
  if (destination.toLowerCase() === JB_ROUTER_TERMINAL_REGISTRY.toLowerCase()) {
    throw new Error('The payment router resolves back to itself')
  }
  return recognized
}

async function requireRecognizedRouterSurface(
  client: Pick<PublicClient, 'readContract'>,
  projectId: bigint,
): Promise<void> {
  const terminals = await client.readContract({
    address: JB_CONTRACTS.JBDirectory,
    abi: jbDirectoryAbi,
    functionName: 'terminalsOf',
    args: [projectId],
  })

  if (terminals.length === 0) {
    throw new Error('This project has no payment routes')
  }

  for (const terminal of terminals) {
    requireRecognizedTerminal(terminal, 'pay')
    if (terminal.toLowerCase() === JB_ROUTER_TERMINAL_REGISTRY.toLowerCase()) {
      await requireRecognizedRegistryDestination(client, projectId, terminal)
    }
  }
}

async function requireRecognizedPaymentRoute(
  client: Pick<PublicClient, 'readContract'>,
  projectId: bigint,
  terminal: PaymentTerminal,
): Promise<void> {
  if (terminal.type !== 'router') return

  if (terminal.address.toLowerCase() === JB_ROUTER_TERMINAL_REGISTRY.toLowerCase()) {
    const destination = await requireRecognizedRegistryDestination(client, projectId, terminal.address)
    if (destination.type === 'multi') return
  }

  await requireRecognizedRouterSurface(client, projectId)
}

/**
 * Determines which terminal to use for a payment based on the project's configuration.
 *
 * Queries JBDirectory.primaryTerminalOf(projectId, tokenAddress) to find which terminal
 * accepts the payment token. A missing or unrecognized terminal is never replaced
 * with a guessed fallback: the directory is the project's source of truth.
 *
 * @param client - Viem public client for the chain
 * @param chainId - Chain ID (mainnets or sepolias)
 * @param projectId - Juicebox project ID
 * @param paymentToken - Token address the user wants to pay with (ETH native token or USDC)
 * @returns The terminal address and type to use for the payment
 */
export async function getPaymentTerminal(
  client: Pick<PublicClient, 'readContract'>,
  chainId: number,
  projectId: bigint,
  paymentToken: Address,
  operation: 'pay' | 'accounting' = 'pay',
): Promise<PaymentTerminal> {
  if (operation === 'accounting') {
    const normalizedToken = paymentToken.toLowerCase()
    const canonicalUsdc = USDC_ADDRESSES[chainId as SupportedChainId]?.toLowerCase()
    const isNative = normalizedToken === NATIVE_TOKEN.toLowerCase()
    if (!isNative && normalizedToken !== canonicalUsdc) {
      throw new Error(`Accounting token not recognized: ${paymentToken}`)
    }

    const terminals = await client.readContract({
      address: JB_CONTRACTS.JBDirectory,
      abi: jbDirectoryAbi,
      functionName: 'terminalsOf',
      args: [projectId],
    })
    if (terminals.length === 0) throw new Error('This project has no accounting terminal')
    for (const terminal of terminals) {
      requireRecognizedTerminal(terminal, 'pay')
      if (terminal.toLowerCase() === JB_ROUTER_TERMINAL_REGISTRY.toLowerCase()) {
        await requireRecognizedRegistryDestination(client, projectId, terminal)
      }
    }

    const multiTerminal = terminals.find(
      terminal => terminal.toLowerCase() === JB_CONTRACTS.JBMultiTerminal.toLowerCase(),
    )
    if (!multiTerminal) throw new Error('Recognized accounting terminal not found')
    const contexts = await getAccountingContexts(client as PublicClient, {
      chainId: chainId as JBChainId,
      projectId,
    })
    const matching = contexts.filter(context => context.token.toLowerCase() === normalizedToken)
    if (matching.length !== 1) {
      throw new Error('The selected token is not a unique live accounting context')
    }
    const expectedDecimals = isNative ? 18 : 6
    const expectedCurrency = tokenCurrencyId(paymentToken)
    if (
      Number(matching[0].decimals) !== expectedDecimals ||
      Number(matching[0].currency) !== expectedCurrency
    ) {
      throw new Error(`Accounting context not recognized: ${paymentToken}`)
    }
    return { address: multiTerminal, type: 'multi' }
  }

  // Query directory for the primary terminal that accepts this token.
  const resolved = await resolvePaymentTerminal(client as PublicClient, {
    chainId: chainId as JBChainId,
    projectId,
    token: paymentToken,
  })

  // Never replace a missing directory result with a guessed direct or router
  // terminal. A project must explicitly expose the selected payment route:
  // `isRouter` marks the SDK's registry fallback for a zero-address result.
  if (resolved.isRouter) {
    throw new Error('This project does not accept the selected payment token')
  }

  const recognized = requireRecognizedTerminal(resolved.address, 'pay')
  await requireRecognizedPaymentRoute(client, projectId, recognized)
  return recognized
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
  if (token === 'ETH') return NATIVE_TOKEN
  if (token === 'PAY_CREDITS') {
    throw new Error('Juice balance is not an on-chain payment token')
  }
  const usdc = USDC_ADDRESSES[chainId as SupportedChainId]
  if (!usdc) throw new Error(`USDC is not configured for chain ${chainId}`)
  return usdc
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
  client: Pick<PublicClient, 'readContract'>,
  projectId: bigint
): Promise<Address> {
  const controller = await client.readContract({
    address: JB_CONTRACTS.JBDirectory,
    abi: jbDirectoryAbi,
    functionName: 'controllerOf',
    args: [projectId],
  })

  if (controller === zeroAddress) throw new Error('Project has no controller')

  return requireRecognizedController(controller)
}

function isRecognizedController(controller: Address): boolean {
  return controller.toLowerCase() === JB_CONTRACTS.JBController.toLowerCase()
}

export function requireRecognizedController(controller: Address): Address {
  if (!isRecognizedController(controller)) {
    throw new Error(`Controller not recognized: ${controller}`)
  }
  return controller
}
