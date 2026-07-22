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

import { createPublicClient, http, erc20Abi, encodeFunctionData, type Abi, type Chain, type WalletClient } from 'viem'
import { ALL_VIEM_CHAINS, RPC_ENDPOINTS } from '../constants/chains'

const CHAINS = ALL_VIEM_CHAINS as Record<number, Chain>
import { simulateTransaction, waitForSuccessfulTransaction } from '../utils/transactionSafety'
import { executeManagedTransaction } from '../hooks/useManagedWallet'
import { proposeSafeTransactions, encodeApprovalTx, waitForSafeExecution, type SafeTx } from './safeApp'
import { requireTransactionReview, type TransactionReviewCall } from '../utils/transactionReview'
import { useTransactionStore } from '../stores/transactionStore'

export type GuardedTxPhase = 'reverifying' | 'switching' | 'approving' | 'simulating' | 'signing' | 'pending'

export interface GuardedWalletContext {
  /** True when the managed (passkey smart-account) mode is active and authenticated. */
  isManagedMode: boolean
  /**
   * True when running inside Safe{Wallet} as a Safe App. Transactions are
   * PROPOSED to the Safe's queue (owners sign & execute) rather than sent — so
   * there is no mined tx to wait on, and any ERC-20 approval is batched with
   * the main call into one atomic proposal.
   */
  isSafeMode?: boolean
  /** Safe mode only: the single chain the connected Safe lives on. */
  safeChainId?: number
  /** The address transactions execute from (managed / Safe address or connected account). */
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
  /** Called once an actual onchain hash exists (never with a Safe proposal ID). */
  onSubmitted?: (hash: `0x${string}`) => void
  /** Reuse an existing persisted activity row instead of creating a second one. */
  activityId?: string
  /** Metadata used only to make the shared exact-call review human-readable. */
  review?: {
    title?: string
    description?: string
    label?: string
    contractName?: string
    abi?: Abi
    functionName?: string
    args?: readonly unknown[]
  }
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
 * Run a fully guarded transaction. Resolves only with the mined transaction
 * hash after its receipt confirms success. Safe proposals wait for owners to
 * execute; managed transactions wait onchain just like direct wallet sends.
 */
export async function runGuardedTx(ctx: GuardedWalletContext, req: GuardedTxRequest): Promise<`0x${string}`> {
  const { chainId, to, data } = req
  const value = req.value ?? 0n

  const calls: TransactionReviewCall[] = []
  if (req.approval) {
    calls.push({
      chainId,
      from: ctx.activeAddress,
      to: req.approval.token,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [req.approval.spender, req.approval.amount],
      }),
      abi: erc20Abi,
      functionName: 'approve',
      args: [req.approval.spender, req.approval.amount],
      label: 'Approve the exact token amount',
      contractName: 'ERC-20 token',
    })
  }
  calls.push({
    chainId,
    from: ctx.activeAddress,
    to,
    data,
    value,
    abi: req.review?.abi,
    functionName: req.review?.functionName,
    args: req.review?.args,
    label: req.review?.label,
    contractName: req.review?.contractName,
  })

  await requireTransactionReview({
    calls,
    kind: ctx.isSafeMode ? 'authorization' : 'transaction',
    title: req.review?.title ?? (ctx.isSafeMode ? 'Review Safe proposal' : 'Review transaction'),
    description: req.review?.description ?? (ctx.isSafeMode
      ? 'You are proposing this exact batch to Safe. It remains pending until the required owners approve and execute it.'
      : 'Review every call below before your wallet is opened.'),
    confirmLabel: ctx.isSafeMode ? 'Agree & propose to Safe' : 'Agree & continue',
    ...(ctx.isSafeMode && {
      authorization: {
        type: 'Safe transaction proposal',
        safeAddress: ctx.activeAddress,
        chainId,
        calls: calls.map(call => ({
          to: call.to,
          value: `0x${(call.value ?? 0n).toString(16)}`,
          data: call.data,
        })),
      },
    }),
  })

  const callKey = [
    ctx.activeAddress.toLowerCase(),
    chainId,
    ...calls.flatMap(call => [call.to.toLowerCase(), (call.value ?? 0n).toString(), call.data.toLowerCase()]),
  ].join(':')
  const store = useTransactionStore.getState()
  const duplicate = store.transactions.find(tx =>
    tx.id !== req.activityId &&
    tx.callKey === callKey &&
    (tx.status === 'pending' || tx.status === 'submitted' || tx.status === 'safe-proposed')
  )
  if (duplicate) {
    throw new Error(
      duplicate.status === 'safe-proposed'
        ? 'This exact Safe transaction is already awaiting approval or execution.'
        : 'This exact transaction is already pending. Wait for it to settle before trying again.',
    )
  }
  const activityId = req.activityId ?? store.addTransaction({
      type: 'contractCall',
      chainId,
      account: ctx.activeAddress,
      label: req.review?.label ?? req.review?.title ?? 'Contract call',
      callKey,
      status: 'pending',
    })
  if (req.activityId) {
    store.updateTransaction(req.activityId, {
      account: ctx.activeAddress,
      label: req.review?.label ?? req.review?.title,
      callKey,
      status: 'pending',
      error: undefined,
    })
  }
  const updateActivity = (updates: Parameters<typeof store.updateTransaction>[1]) =>
    useTransactionStore.getState().updateTransaction(activityId, updates)
  const reportPhase = (
    phase: GuardedTxPhase,
    stage: NonNullable<Parameters<typeof store.updateTransaction>[1]['stage']>,
  ) => {
    req.onPhase?.(phase)
    updateActivity({ stage })
  }
  let submittedHash: `0x${string}` | null = null
  let safeProposalHash: `0x${string}` | null = null

  try {
    reportPhase('reverifying', 'checking')
    await req.reverify?.()

  // Safe App: a Safe is bound to ONE chain and can't switch networks from
  // inside the app. Re-verify + simulate still run (read-only, against the
  // Safe's chain), but the send PROPOSES to the Safe queue — batching any
  // ERC-20 approval + the main call into ONE atomic entry — and returns the
  // safeTxHash WITHOUT waiting for a receipt (there is no mined tx yet; the
  // owners sign & execute in Safe{Wallet}).
    if (ctx.isSafeMode) {
    if (ctx.safeChainId != null && ctx.safeChainId !== chainId) {
      throw new Error(
        `This Safe is on ${CHAINS[ctx.safeChainId]?.name ?? `chain ${ctx.safeChainId}`}, but this action targets ${
          CHAINS[chainId]?.name ?? `chain ${chainId}`
        }. A Safe App can't switch chains — open a Safe on that network to continue.`,
      )
    }

    reportPhase('simulating', 'checking')
    if (req.approval) {
      const currentAllowance = await publicClientFor(chainId).readContract({
        address: req.approval.token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [ctx.activeAddress, req.approval.spender],
      })
      if (currentAllowance < req.approval.amount) {
        await simulateTransaction({
          chainId,
          account: ctx.activeAddress,
          to: req.approval.token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [req.approval.spender, req.approval.amount],
          }),
          value: 0n,
        })
      } else {
        await simulateTransaction({ chainId, account: ctx.activeAddress, to, data, value })
      }
    } else {
      await simulateTransaction({ chainId, account: ctx.activeAddress, to, data, value })
    }

    // 'pending' == the propose is in flight (no dedicated phase, to avoid
    // widening the union every consumer's PHASE_LABELS map must satisfy).
      reportPhase('pending', 'submitting')
      const txs: SafeTx[] = []
      if (req.approval) {
        txs.push(encodeApprovalTx(req.approval.token, req.approval.spender, req.approval.amount))
      }
      txs.push({ to, value: `0x${value.toString(16)}`, data })
      const safeTxHash = await proposeSafeTransactions(txs)
      safeProposalHash = safeTxHash
      updateActivity({ safeTxHash, status: 'safe-proposed', stage: undefined })

      const hash = await waitForSafeExecution(safeTxHash)
      submittedHash = hash
      updateActivity({ hash, status: 'submitted', stage: 'confirming' })
      req.onSubmitted?.(hash)
      await waitForSuccessfulTransaction(chainId, hash)
      updateActivity({ status: 'confirmed', stage: undefined, confirmedAt: Date.now() })
      window.dispatchEvent(new CustomEvent('juice:project-data-invalidated', { detail: { chainId } }))
      return hash
    }

    reportPhase('switching', 'switching')
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
      reportPhase('approving', 'approving')
      const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] })
      const approvalCallKey = [
        ctx.activeAddress.toLowerCase(),
        chainId,
        token.toLowerCase(),
        '0',
        approveData.toLowerCase(),
      ].join(':')
      const duplicateApproval = useTransactionStore.getState().transactions.find(tx =>
        tx.callKey === approvalCallKey &&
        (tx.status === 'pending' || tx.status === 'submitted' || tx.status === 'safe-proposed')
      )
      if (duplicateApproval) {
        throw new Error(
          `This exact token approval is already pending${duplicateApproval.hash ? ` as ${duplicateApproval.hash}` : ''}. The main transaction was not sent.`,
        )
      }
      const approvalActivityId = useTransactionStore.getState().addTransaction({
        type: 'contractCall',
        chainId,
        account: ctx.activeAddress,
        label: 'Approve exact token amount',
        callKey: approvalCallKey,
        status: 'pending',
        stage: 'approving',
      })
      let approveHash: `0x${string}` | null = null
      try {
        approveHash = await sendRaw(ctx, chainId, token, approveData, 0n)
        useTransactionStore.getState().updateTransaction(approvalActivityId, {
          hash: approveHash,
          status: 'submitted',
          stage: 'confirming',
        })
        await waitForSuccessfulTransaction(chainId, approveHash)
        useTransactionStore.getState().updateTransaction(approvalActivityId, {
          status: 'confirmed',
          stage: undefined,
          confirmedAt: Date.now(),
          error: undefined,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const reverted = /transaction reverted/i.test(message)
        const cancelled = /rejected|denied|cancelled/i.test(message)
        useTransactionStore.getState().updateTransaction(approvalActivityId, {
          status: approveHash && !reverted && !cancelled
            ? 'submitted'
            : cancelled ? 'cancelled' : 'failed',
          stage: approveHash && !reverted && !cancelled ? 'confirming' : undefined,
          error: approveHash && !reverted && !cancelled
            ? `Approval ${approveHash} was submitted, but confirmation is temporarily unavailable. The main transaction was not sent.`
            : cancelled ? 'Token approval cancelled' : message,
        })
        if (approveHash && !reverted && !cancelled) {
          throw new Error(
            `Token approval ${approveHash} was submitted, but confirmation is temporarily unavailable. The main transaction was not sent; check the approval before trying again.`,
          )
        }
        throw error
      }
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

    reportPhase('simulating', 'checking')
    await simulateTransaction({ chainId, account: ctx.activeAddress, to, data, value })

    reportPhase(ctx.isManagedMode ? 'pending' : 'signing', 'submitting')
    const hash = await sendRaw(ctx, chainId, to, data, value)
    submittedHash = hash
    updateActivity({ hash, status: 'submitted', stage: 'confirming' })
    req.onSubmitted?.(hash)
    req.onPhase?.('pending')
    await waitForSuccessfulTransaction(chainId, hash)
    updateActivity({ status: 'confirmed', stage: undefined, confirmedAt: Date.now() })

  // Let every open project surface refresh its reads.
    window.dispatchEvent(new CustomEvent('juice:project-data-invalidated', { detail: { chainId } }))
    return hash
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const cancelled = /rejected|denied|cancelled/i.test(message)
    const reverted = /transaction reverted/i.test(message)
    if (submittedHash && !reverted && !cancelled) {
      updateActivity({
        hash: submittedHash,
        status: 'submitted',
        stage: 'confirming',
        error: `Transaction ${submittedHash} was submitted, but confirmation is temporarily unavailable. Check the explorer and do not submit it again yet.`,
      })
      throw error
    }
    if (safeProposalHash && !submittedHash && !cancelled) {
      updateActivity({
        safeTxHash: safeProposalHash,
        status: 'safe-proposed',
        stage: undefined,
        error: 'The Safe proposal is still awaiting execution or its status is temporarily unavailable. Do not submit it again.',
      })
      throw error
    }
    updateActivity({
      status: cancelled ? 'cancelled' : 'failed',
      stage: undefined,
      error: cancelled ? 'Transaction cancelled' : message,
    })
    throw error
  }
}
