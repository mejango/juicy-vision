import { useEffect, useMemo, useRef, useState } from 'react'
import { useTransactionStore, useThemeStore } from '../../stores'
import { ALL_VIEM_CHAINS, RPC_ENDPOINTS } from '../../constants/chains'
import { txHashForSafeTx } from '../../services/safeApp'
import { getBundleStatus, transformBundleResponse, type RawBundleResponse } from '../../services/relayr'
import { getManagedBundleStatus, useIsManagedMode } from '../../hooks/useManagedWallet'
import { useSafeApp } from '../../hooks/useSafeApp'
import { createPublicClient, http, type Chain, type Hex } from 'viem'
import TransactionStatus from '../dynamic/TransactionStatus'

const ACTIVE_STATUSES = new Set(['pending', 'submitted', 'safe-proposed', 'relayr-pending'])

/** Persistent, app-wide status and recovery surface for direct, Safe, and Relayr activity. */
export default function TransactionStatusCenter() {
  const transactions = useTransactionStore(state => state.transactions)
  const updateTransaction = useTransactionStore(state => state.updateTransaction)
  const { theme } = useThemeStore()
  const { safeInfo } = useSafeApp()
  const isManagedMode = useIsManagedMode()
  const [open, setOpen] = useState(false)
  const previousActiveCount = useRef(0)

  const visible = useMemo(() => {
    const active = transactions.filter(tx => ACTIVE_STATUSES.has(tx.status))
    const recent = transactions.filter(tx => !ACTIVE_STATUSES.has(tx.status)).slice(0, 3)
    return [...active, ...recent]
  }, [transactions])
  const activeCount = transactions.filter(tx => ACTIVE_STATUSES.has(tx.status)).length

  useEffect(() => {
    if (activeCount > previousActiveCount.current) setOpen(true)
    previousActiveCount.current = activeCount
  }, [activeCount])

  // Recover async work from the persisted store. Safe proposals remain
  // proposals until Safe gives us the distinct mined hash; Relayr remains
  // pending until every destination has reached a terminal state.
  useEffect(() => {
    let cancelled = false
    const reconcile = async () => {
      const pending = useTransactionStore.getState().getPendingTransactions()
      const settleSubmitted = async (
        id: string,
        chainId: number,
        hash: Hex,
        bundleUuid?: string,
      ) => {
        const chain = ALL_VIEM_CHAINS[chainId as keyof typeof ALL_VIEM_CHAINS] as Chain | undefined
        const rpc = RPC_ENDPOINTS[chainId]?.[0] ?? chain?.rpcUrls.default.http[0]
        if (!chain || !rpc) return
        try {
          const receipt = await createPublicClient({ chain, transport: http(rpc) })
            .getTransactionReceipt({ hash })
          if (cancelled) return
          updateTransaction(id, {
            status: receipt.status === 'success'
              ? bundleUuid ? 'relayr-pending' : 'confirmed'
              : 'failed',
            stage: undefined,
            confirmedAt: receipt.status === 'success' && !bundleUuid ? Date.now() : undefined,
            error: receipt.status === 'reverted' ? 'Transaction reverted' : undefined,
          })
        } catch {
          // Not mined yet or the RPC is unavailable: retain submitted/unknown.
        }
      }
      await Promise.allSettled(pending.map(async transaction => {
        if (
          transaction.status === 'safe-proposed' &&
          transaction.safeTxHash &&
          safeInfo &&
          safeInfo.chainId === transaction.chainId &&
          (!transaction.account || transaction.account.toLowerCase() === safeInfo.safeAddress.toLowerCase())
        ) {
          const hash = await txHashForSafeTx(transaction.safeTxHash)
          if (!hash || cancelled) return
          updateTransaction(transaction.id, { hash, status: 'submitted', stage: 'confirming' })
          await settleSubmitted(
            transaction.id,
            transaction.chainId,
            hash as Hex,
            transaction.bundleUuid,
          )
          return
        }

        if (transaction.status === 'submitted' && transaction.hash) {
          await settleSubmitted(
            transaction.id,
            transaction.chainId,
            transaction.hash as Hex,
            transaction.bundleUuid,
          )
          return
        }

        if (transaction.status === 'relayr-pending' && transaction.bundleUuid) {
          const response = isManagedMode
            ? transformBundleResponse(await getManagedBundleStatus(transaction.bundleUuid) as RawBundleResponse)
            : await getBundleStatus(transaction.bundleUuid)
          if (cancelled) return
          const chainStates = response.transactions.map(item => ({
            chainId: item.chain_id,
            status: item.status,
            txHash: item.tx_hash,
            error: item.error,
          }))
          const failed = response.status === 'failed' || response.status === 'partial'
          updateTransaction(transaction.id, {
            status: response.status === 'completed' ? 'confirmed' : failed ? 'failed' : 'relayr-pending',
            chainStates,
            confirmedAt: response.status === 'completed' ? Date.now() : undefined,
            ...(failed && {
              error: response.status === 'partial'
                ? 'Relayr completed only some destination transactions. Review each chain below.'
                : 'Relayr bundle failed. Review each destination below.',
            }),
          })
        }
      }))
    }

    void reconcile()
    const interval = window.setInterval(() => void reconcile(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [isManagedMode, safeInfo, updateTransaction])

  if (!visible.length) return null
  const isDark = theme === 'dark'

  return (
    <aside className="fixed bottom-4 right-4 z-[70] w-[min(24rem,calc(100vw-2rem))]">
      <button
        type="button"
        className={`ml-auto flex items-center gap-2 border px-4 py-3 text-xs font-semibold shadow-xl ${
          isDark ? 'border-white/20 bg-juice-dark text-white' : 'border-gray-200 bg-white text-gray-900'
        }`}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className={`size-2 ${activeCount ? 'animate-pulse bg-juice-orange' : 'bg-green-500'}`} />
        Transactions{activeCount ? ` · ${activeCount} active` : ''}
      </button>
      {open && (
        <div className={`mt-2 max-h-[55vh] space-y-2 overflow-y-auto border p-2 shadow-2xl ${
          isDark ? 'border-white/20 bg-juice-dark' : 'border-gray-200 bg-white'
        }`}>
          {visible.map(transaction => <TransactionStatus key={transaction.id} txId={transaction.id} />)}
        </div>
      )}
    </aside>
  )
}
