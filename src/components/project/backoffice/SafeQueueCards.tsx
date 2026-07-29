import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { encodeFunctionData, type Address } from 'viem'
import { getWalletClient } from 'wagmi/actions'
import { useAccount, useSwitchChain } from 'wagmi'
import { wagmiConfig } from '../../../config/wagmi'
import { useThemeStore } from '../../../stores'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { fetchRevnetOperator } from '../../../services/bendystraw'
import { readProjectOwner } from '../../../services/permissionsAdmin'
import { fetchSafeInfo } from '../../../services/safeInfo'
import { publicClientFor } from '../../../services/projectTx'
import {
  SAFE_EXEC_ABI,
  SAFE_TX_TYPES,
  SAFE_VIEW_ABI,
  listPendingSafeTransactions,
  safeExecutionArgs,
  safeMessage,
  safeQueueLink,
  safeTransactionHash,
  submitSafeConfirmation,
  usableSafeConfirmations,
  type SafeQueuedTransaction,
} from '../../../services/safe/safeTxService'
import { requireTransactionReview } from '../../../utils/transactionReview'
import ChainLogo from '../../ui/ChainLogo'
import { BackOfficeCard, chainName, shortAddress } from './shared'

interface QueueRow {
  chainId: number
  safe: Address
  owners: Address[]
  threshold: number
  nonce: number
  transactions: SafeQueuedTransaction[]
  queueError?: string
}

export function SafeQueueCards({
  resolveProjectId,
  chainIds,
  isRevnet,
}: {
  resolveProjectId: (chainId: number) => bigint | null
  chainIds: number[]
  isRevnet: boolean
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { run, isSafeMode } = useGuardedTx()
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chainKey = useMemo(() => chainIds.join(','), [chainIds])
  const projectKey = chainIds
    .map(chainId => `${chainId}:${resolveProjectId(chainId)?.toString() ?? ''}`)
    .join(',')

  const queue = useQuery({
    queryKey: ['project-safe-queues', chainKey, projectKey, isRevnet],
    staleTime: 15_000,
    queryFn: async (): Promise<QueueRow[]> => {
      const results = await Promise.all(
        chainIds.map(async (chainId): Promise<QueueRow | null> => {
          const projectId = resolveProjectId(chainId)
          if (projectId == null) return null
          const authority = isRevnet
            ? ((await fetchRevnetOperator(String(projectId), chainId)) as Address | null)
            : await readProjectOwner(chainId, projectId)
          if (!authority) return null
          const info = await fetchSafeInfo(authority, chainId)
          if (!info.isSafe) return null
          const nonce = Number(
            await publicClientFor(chainId).readContract({
              address: authority,
              abi: SAFE_VIEW_ABI,
              functionName: 'nonce',
            }),
          )
          let transactions: SafeQueuedTransaction[] = []
          let queueError: string | undefined
          try {
            transactions = await listPendingSafeTransactions(chainId, authority, nonce)
          } catch (cause) {
            queueError =
              cause instanceof Error ? cause.message : 'Safe queue service is unavailable.'
          }
          return {
            chainId,
            safe: authority,
            owners: info.owners,
            threshold: info.threshold,
            nonce,
            transactions,
            queueError,
          }
        }),
      )
      return results.filter((row): row is QueueRow => row !== null)
    },
  })

  if (queue.isLoading || !queue.data?.length) return null

  const sign = async (row: QueueRow, tx: SafeQueuedTransaction) => {
    if (!address) return
    const key = `sign:${row.chainId}:${tx.nonce}`
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      if (!row.owners.some(owner => owner.toLowerCase() === address.toLowerCase())) {
        throw new Error('The connected account is not an owner of this Safe.')
      }
      const digest = safeTransactionHash(row.chainId, row.safe, tx)
      const serviceHash = tx.safeTxHash ?? tx.contractTransactionHash
      if (serviceHash && serviceHash.toLowerCase() !== digest.toLowerCase()) {
        throw new Error('Safe service transaction data does not match its signed hash.')
      }
      await requireTransactionReview({
        kind: 'authorization',
        title: 'Review Safe transaction signature',
        description:
          'This signature approves the exact queued Safe call. It does not execute until the threshold and nonce requirements are met.',
        confirmLabel: 'Agree & sign Safe transaction',
        authorization: {
          type: 'EIP-712 SafeTx',
          safe: row.safe,
          nonce: tx.nonce,
          digest,
          message: safeMessage(tx),
        },
        calls: [
          {
            chainId: row.chainId,
            from: address,
            to: tx.to,
            value: BigInt(tx.value ?? 0),
            data: tx.data ?? '0x',
            label: `Safe transaction #${tx.nonce}`,
          },
        ],
      })
      await switchChainAsync({ chainId: row.chainId })
      const wallet = await getWalletClient(wagmiConfig, { chainId: row.chainId })
      if (!wallet.account || wallet.account.address.toLowerCase() !== address.toLowerCase()) {
        throw new Error('Connected account changed. Review the Safe transaction again.')
      }
      const signature = await wallet.signTypedData({
        account: wallet.account,
        domain: { chainId: row.chainId, verifyingContract: row.safe },
        types: SAFE_TX_TYPES,
        primaryType: 'SafeTx',
        message: safeMessage(tx),
      })
      await submitSafeConfirmation(row.chainId, tx, signature)
      setNotice(`Signed Safe transaction #${tx.nonce} on ${chainName(row.chainId)}.`)
      await queue.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign the Safe transaction.')
    } finally {
      setBusy(null)
    }
  }

  const execute = async (row: QueueRow, tx: SafeQueuedTransaction) => {
    const key = `execute:${row.chainId}:${tx.nonce}`
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      const args = safeExecutionArgs(tx, row.owners)
      const data = encodeFunctionData({
        abi: SAFE_EXEC_ABI,
        functionName: 'execTransaction',
        args,
      })
      await run({
        chainId: row.chainId,
        to: row.safe,
        data,
        review: {
          title: 'Review Safe execution',
          description: `This outer Safe call executes queued nonce ${tx.nonce}. Inner destination: ${tx.to}; value: ${String(
            tx.value ?? 0,
          )} wei; operation: ${tx.operation}; data: ${tx.data ?? '0x'}.`,
          label: `Execute Safe transaction #${tx.nonce}`,
          contractName: 'Safe',
          abi: SAFE_EXEC_ABI,
          functionName: 'execTransaction',
          args,
        },
      })
      setNotice(`Executed Safe transaction #${tx.nonce} on ${chainName(row.chainId)}.`)
      await queue.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not execute the Safe transaction.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <BackOfficeCard title="Pending multisig transactions" isDark={isDark}>
      <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        Safe signers can inspect, co-sign, and execute project proposals here.
      </p>
      <div className="mt-4 space-y-4">
        {queue.data.map(row => (
          <div
            key={`${row.chainId}:${row.safe}`}
            className={`border p-3 ${isDark ? 'border-white/10' : 'border-gray-200'}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className={`inline-flex items-center gap-2 text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                <ChainLogo chainId={row.chainId} size={16} />
                {chainName(row.chainId)} · {shortAddress(row.safe)} · nonce {row.nonce}
              </span>
              {safeQueueLink(row.chainId, row.safe) ? (
                <a
                  className={`text-xs underline ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}
                  href={safeQueueLink(row.chainId, row.safe)!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Safe fallback ↗
                </a>
              ) : null}
            </div>
            {row.queueError ? (
              <p className="mt-2 text-sm text-red-400" role="alert">
                {row.queueError}
                {safeQueueLink(row.chainId, row.safe)
                  ? ' Use the Safe fallback above to inspect the queue.'
                  : ' Inspect this Safe in a client that supports this chain.'}
              </p>
            ) : row.transactions.length === 0 ? (
              <p className={`mt-2 text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                No pending transactions.
              </p>
            ) : (
              <ul className={`mt-2 divide-y ${isDark ? 'divide-white/10' : 'divide-gray-100'}`}>
                {row.transactions.map(tx => {
                  const confirmations = usableSafeConfirmations(tx, row.owners)
                  const signed = confirmations.some(
                    confirmation =>
                      address && confirmation.owner.toLowerCase() === address.toLowerCase(),
                  )
                  const ready = confirmations.length >= row.threshold
                  const current = Number(tx.nonce) === row.nonce
                  return (
                    <li key={`${tx.nonce}:${tx.safeTxHash ?? tx.data}`} className="py-3 text-xs">
                      <details>
                        <summary className={`cursor-pointer font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                          #{tx.nonce} · {tx.data?.slice(0, 10) ?? '0x'} · {confirmations.length}/{row.threshold} signatures
                        </summary>
                        <div className={`mt-2 break-all p-2 font-mono ${isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                          <p>To: {tx.to}</p>
                          <p>Value: {String(tx.value ?? 0)} wei</p>
                          <p>Data: {tx.data ?? '0x'}</p>
                        </div>
                      </details>
                      <div className="mt-2 flex gap-2">
                        {!signed && !ready ? (
                          <button
                            type="button"
                            className={`border px-3 py-1 disabled:opacity-40 ${
                              isDark ? 'border-white/20 text-white' : 'border-gray-300 text-gray-800'
                            }`}
                            disabled={busy !== null || !address}
                            onClick={() => void sign(row, tx)}
                          >
                            {busy === `sign:${row.chainId}:${tx.nonce}` ? 'Signing…' : 'Sign'}
                          </button>
                        ) : null}
                        {ready ? (
                          <button
                            type="button"
                            className="bg-amber-500 px-3 py-1 font-medium text-black disabled:opacity-40"
                            disabled={busy !== null || !current || isSafeMode}
                            title={
                              isSafeMode
                                ? 'Execute from a signer wallet outside the Safe App to avoid proposing the execution back to the same queue.'
                                : current
                                  ? undefined
                                  : `Nonce ${row.nonce} must execute first.`
                            }
                            onClick={() => void execute(row, tx)}
                          >
                            {busy === `execute:${row.chainId}:${tx.nonce}` ? 'Executing…' : 'Execute'}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
      {notice ? <p className={`mt-3 text-sm ${isDark ? 'text-green-400' : 'text-green-700'}`}>{notice}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </BackOfficeCard>
  )
}
