import type { Address, Chain, Hex, WalletClient } from 'viem'
import { useTransactionStore } from '../stores'

export async function submitTrackedTokenApproval(params: {
  chainId: number
  chain: Chain
  account: Address
  token: Address
  spender: Address
  amount: bigint
  data: Hex
  walletClient: WalletClient
  publicClient: {
    waitForTransactionReceipt: (parameters: { hash: Hex }) => Promise<{
      status: 'success' | 'reverted'
    }>
  }
}): Promise<Hex> {
  const { chainId, chain, account, token, spender, amount, data, walletClient, publicClient } = params
  const store = useTransactionStore.getState()
  const callKey = [
    account.toLowerCase(),
    chainId,
    token.toLowerCase(),
    '0',
    data.toLowerCase(),
  ].join(':')
  const duplicate = store.transactions.find(transaction =>
    transaction.callKey === callKey &&
    (transaction.status === 'pending' || transaction.status === 'submitted' || transaction.status === 'safe-proposed')
  )
  if (duplicate) {
    throw new Error(
      `This exact ${amount.toString()} token-unit approval for ${spender} is already pending${duplicate.hash ? ` as ${duplicate.hash}` : ''}. The payment was not sent.`,
    )
  }

  const approvalId = store.addTransaction({
    type: 'contractCall',
    chainId,
    account,
    label: `Approve ${amount.toString()} raw token units`,
    callKey,
    status: 'pending',
    stage: 'approving',
  })
  let hash: Hex | null = null
  try {
    hash = await walletClient.sendTransaction({
      to: token,
      data,
      value: 0n,
      chain,
      account,
    })
    useTransactionStore.getState().updateTransaction(approvalId, {
      hash,
      status: 'submitted',
      stage: 'confirming',
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`Token approval ${hash} reverted onchain`)
    useTransactionStore.getState().updateTransaction(approvalId, {
      status: 'confirmed',
      stage: undefined,
      confirmedAt: Date.now(),
      error: undefined,
    })
    return hash
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reverted = /reverted/i.test(message)
    const cancelled = /rejected|denied|cancelled/i.test(message)
    useTransactionStore.getState().updateTransaction(approvalId, {
      status: hash && !reverted && !cancelled
        ? 'submitted'
        : cancelled ? 'cancelled' : 'failed',
      stage: hash && !reverted && !cancelled ? 'confirming' : undefined,
      error: hash && !reverted && !cancelled
        ? `Approval ${hash} was submitted, but confirmation is temporarily unavailable. The payment was not sent.`
        : cancelled ? 'Token approval cancelled' : message,
    })
    if (hash && !reverted && !cancelled) {
      throw new Error(
        `Token approval ${hash} was submitted, but confirmation is temporarily unavailable. The payment was not sent; check the approval before trying again.`,
      )
    }
    throw error
  }
}
