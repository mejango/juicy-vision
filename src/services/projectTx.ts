/**
 * Shared guarded transaction runner for project-page actions.
 *
 * Every new project-page transaction (claim credits, loans, bridge moves,
 * LP ops, permissions, powers, transfers, payer deploys, …) runs through
 * this one path so the safety conventions hold everywhere:
 *   reviewed-state re-verification after every await gap → optional ERC-20
 *   approval pre-step → eth_call simulation → send (managed or self-custody)
 *   → success wait → `juice:project-data-invalidated` refresh event.
 *
 * The wallet context is passed in (see hooks/useGuardedTx.ts) so this stays
 * a plain testable service.
 */

import { createPublicClient, http, erc20Abi, encodeFunctionData, type Chain, type WalletClient } from 'viem'
import { ALL_VIEM_CHAINS, RPC_ENDPOINTS } from '../constants/chains'

const CHAINS = ALL_VIEM_CHAINS as Record<number, Chain>
import { simulateTransaction, waitForSuccessfulTransaction } from '../utils/transactionSafety'
import { executeManagedTransaction } from '../hooks/useManagedWallet'

export type GuardedTxPhase = 'reverifying' | 'switching' | 'approving' | 'simulating' | 'signing' | 'pending'

export interface GuardedWalletContext {
  /** True when the managed (passkey smart-account) mode is active and authenticated. */
  isManagedMode: boolean
  /** The address transactions execute from (managed address or connected account). */
  activeAddress: `0x${string}`
  /** Self-custody only. */
  walletClient?: WalletClient | null
  /** Self-custody only: wagmi switchChainAsync. */
  switchChain?: (chainId: number) => Promise<unknown>
}

export interface GuardedTxRequest {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value?: bigint
  /** ERC-20 approval pre-step: approve exactly `amount` to `spender` before the call. */
  approval?: { token: `0x${string}`; spender: `0x${string}`; amount: bigint }
  /**
   * Re-verification of reviewed state. Runs before the approval and again after
   * any chain switch, immediately before the send. Throw to abort — the message
   * is surfaced to the user. Re-read on-chain state here and compare against the
   * fingerprints captured at review time; never trust values across await gaps.
   */
  reverify?: () => Promise<void>
  onPhase?: (phase: GuardedTxPhase) => void
}

export function publicClientFor(chainId: number) {
  const chain = CHAINS[chainId]
  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
  if (!chain || !rpcUrl) throw new Error(`Unsupported chain ${chainId}`)
  return createPublicClient({ chain, transport: http(rpcUrl) })
}

async function ensureWalletOnChain(ctx: GuardedWalletContext, chainId: number): Promise<void> {
  if (ctx.isManagedMode) return
  if (!ctx.walletClient) throw new Error('Wallet not connected')
  if (ctx.switchChain) await ctx.switchChain(chainId)
  if ((await ctx.walletClient.getChainId()) !== chainId) {
    throw new Error(`Wallet did not switch to ${CHAINS[chainId]?.name ?? `chain ${chainId}`}`)
  }
}

async function sendRaw(
  ctx: GuardedWalletContext,
  chainId: number,
  to: `0x${string}`,
  data: `0x${string}`,
  value: bigint,
): Promise<`0x${string}`> {
  if (ctx.isManagedMode) {
    return (await executeManagedTransaction(chainId, to, data, value.toString())) as `0x${string}`
  }
  const account = ctx.walletClient!.account
  if (!account || account.address.toLowerCase() !== ctx.activeAddress.toLowerCase()) {
    throw new Error('The connected account changed since review. Reopen and try again.')
  }
  return ctx.walletClient!.sendTransaction({ account, chain: CHAINS[chainId], to, data, value })
}

/**
 * Run a fully guarded transaction. Resolves with the tx hash after the
 * receipt confirms success (managed mode resolves when the backend accepts).
 */
export async function runGuardedTx(ctx: GuardedWalletContext, req: GuardedTxRequest): Promise<`0x${string}`> {
  const { chainId, to, data } = req
  const value = req.value ?? 0n

  req.onPhase?.('reverifying')
  await req.reverify?.()

  req.onPhase?.('switching')
  await ensureWalletOnChain(ctx, chainId)

  if (req.approval) {
    const { token, spender, amount } = req.approval
    const client = publicClientFor(chainId)
    const current = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [ctx.activeAddress, spender],
    })
    if (current < amount) {
      req.onPhase?.('approving')
      const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] })
      const approveHash = await sendRaw(ctx, chainId, token, approveData, 0n)
      if (!ctx.isManagedMode) await waitForSuccessfulTransaction(chainId, approveHash)
      const after = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [ctx.activeAddress, spender],
      })
      if (after < amount) throw new Error('The token approval did not take effect')
    }
  }

  // State may have moved while the approval confirmed or the chain switched.
  await req.reverify?.()

  req.onPhase?.('simulating')
  await simulateTransaction({ chainId, account: ctx.activeAddress, to, data, value })

  req.onPhase?.(ctx.isManagedMode ? 'pending' : 'signing')
  const hash = await sendRaw(ctx, chainId, to, data, value)
  req.onPhase?.('pending')
  if (!ctx.isManagedMode) await waitForSuccessfulTransaction(chainId, hash)

  // Let every open project surface refresh its reads.
  window.dispatchEvent(new CustomEvent('juice:project-data-invalidated', { detail: { chainId } }))
  return hash
}
