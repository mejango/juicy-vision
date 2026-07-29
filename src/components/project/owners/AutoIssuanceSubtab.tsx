/**
 * Auto Issuance subtab (revnets only) — tokens auto-issued to specific
 * accounts, unlocking per stage across every chain. Rows come solely from
 * Bendystraw (no fallback — a failed index shows an error, never fabricated
 * data), enriched with the live remaining amount from REVOwner. Distribution
 * is permissionless once a stage has started and the amount is > 0.
 * Ports website/src/discover.js renderAutoIssuance (:13766) + table (:14343)
 * + the Distribute action (:14403).
 */

import { useEffect, useState, useMemo, useCallback } from 'react'
import { encodeFunctionData } from 'viem'
import { type JBChainId } from '@bananapus/nana-sdk-core'
import { buildAutoIssueTx, getAmountToAutoIssue } from '@bananapus/nana-sdk-core/v6'
import { useThemeStore } from '../../../stores'
import { CHAINS } from '../../../constants'
import ChainLogo from '../../ui/ChainLogo'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { publicClientFor, type GuardedTxPhase } from '../../../services/projectTx'
import type { Project } from '../../../services/bendystraw'
import { formatTokenCount18 } from '../../../services/revnetStages'
import {
  autoIssueKey,
  fetchAutoIssuanceRows,
  type AutoIssuanceRow,
  type ChainProject,
} from '../../../services/reservedSplits'

export interface AutoIssuanceSubtabProps {
  project: Project
  /** The sucker-group chains the revnet lives on (home chain first). */
  chainIds: number[]
  /** Per-chain project ids (V6 ids differ per chain). Falls back to the home id. */
  chainProjects?: ChainProject[]
}

type RowStatus =
  | { kind: 'idle' }
  | { kind: 'running'; phase: GuardedTxPhase }
  | { kind: 'done'; txHash: `0x${string}` }
  | { kind: 'error'; message: string }

const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: 'Re-checking the amount…',
  switching: 'Switching network…',
  approving: 'Approving…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function formatUnlockDate(start: number): string {
  return new Date(start * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function AutoIssuanceSubtab({ project, chainIds, chainProjects }: AutoIssuanceSubtabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const symbol = project.tokenSymbol || 'tokens'
  // V6 project ids are independent per chain — resolve each chain's own id.
  const pidFor = useCallback(
    (cid: number): number | string => chainProjects?.find(cp => cp.chainId === cid)?.projectId ?? project.projectId,
    [chainProjects, project.projectId],
  )
  const chainProjectList = useMemo<ChainProject[]>(
    () => chainIds.map(cid => ({ chainId: cid, projectId: pidFor(cid) })),
    [chainIds, pidFor],
  )

  const [rows, setRows] = useState<AutoIssuanceRow[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({})

  useEffect(() => {
    let cancelled = false
    setLoadError(false)
    fetchAutoIssuanceRows(chainProjectList)
      .then(loaded => {
        if (!cancelled) setRows(loaded)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [chainProjectList])

  const setStatus = (key: string, status: RowStatus) =>
    setStatuses(previous => ({ ...previous, [key]: status }))

  const distribute = async (row: AutoIssuanceRow) => {
    const key = autoIssueKey(row)
    if (!activeAddress) {
      setStatus(key, { kind: 'error', message: 'Connect a wallet first.' })
      return
    }
    try {
      // Exact calldata from the SDK — REVOwner.autoIssueFor(revnetId, stageId,
      // beneficiary), permissionless; it mints whatever amountToAutoIssue reports.
      const request = buildAutoIssueTx({
        chainId: row.chainId as JBChainId,
        revnetId: BigInt(pidFor(row.chainId)),
        stageId: BigInt(row.stageId),
        beneficiary: row.beneficiary,
      })
      const data = encodeFunctionData({
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
      })
      const txHash = await run({
        chainId: row.chainId,
        to: request.address,
        data,
        review: {
          title: 'Review automatic token issuance',
          label: `Issue the unlocked stage allocation to ${shortAddress(row.beneficiary)}`,
          contractName: 'REVOwner',
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
        },
        // Abort when the live amount dropped to zero since review — someone
        // else may have auto-issued this allocation already.
        reverify: async () => {
          const fresh = await getAmountToAutoIssue(publicClientFor(row.chainId), {
            chainId: row.chainId as JBChainId,
            revnetId: BigInt(pidFor(row.chainId)),
            stageId: BigInt(row.stageId),
            beneficiary: row.beneficiary,
          })
          if (fresh === 0n) {
            throw new Error('Nothing left to auto-issue — this allocation was already distributed.')
          }
        },
        onPhase: phase => setStatus(key, { kind: 'running', phase }),
      })
      setStatus(key, { kind: 'done', txHash })
      setRows(previous =>
        previous
          ? previous.map(existing => (autoIssueKey(existing) === key ? { ...existing, remaining: 0n } : existing))
          : previous,
      )
    } catch (error) {
      setStatus(key, {
        kind: 'error',
        message: error instanceof Error ? error.message : 'The auto-issue transaction failed.',
      })
    }
  }

  const mutedText = isDark ? 'text-gray-500' : 'text-gray-400'
  const bodyText = isDark ? 'text-gray-400' : 'text-gray-600'
  const cardClass = `border p-4 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`
  const cardTitleClass = `text-xs font-medium uppercase tracking-wide mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`

  const actionCell = (row: AutoIssuanceRow) => {
    const key = autoIssueKey(row)
    const status = statuses[key] ?? { kind: 'idle' }
    const now = Math.floor(Date.now() / 1000)
    const chain = CHAINS[row.chainId]

    if (status.kind === 'done') {
      return chain ? (
        <a
          href={`${chain.explorerTx}${status.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`hover:underline ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}
        >
          Distributed
        </a>
      ) : (
        <span className={mutedText}>Distributed</span>
      )
    }
    if (row.distributedTxHash && row.remaining !== null && row.remaining === 0n) {
      // Idle "Distributed" text, linked to the indexed tx.
      return chain ? (
        <a
          href={`${chain.explorerTx}${row.distributedTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`hover:underline ${mutedText}`}
        >
          Distributed
        </a>
      ) : (
        <span className={mutedText}>Distributed</span>
      )
    }
    if (row.remaining === 0n) return <span className={mutedText}>Distributed</span>
    if (status.kind === 'running') {
      return <span className={`text-xs ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>{PHASE_LABELS[status.phase]}</span>
    }

    const button = (label: string, opts: { disabled?: boolean; title?: string } = {}) => (
      <button
        onClick={opts.disabled ? undefined : () => distribute(row)}
        disabled={opts.disabled}
        title={opts.title}
        className={`px-3 py-1 text-xs border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-300 text-gray-800 hover:bg-gray-50'
        }`}
      >
        {label}
      </button>
    )

    return (
      <div className="space-y-1">
        {row.remaining === null
          ? button('Unavailable', { disabled: true, title: 'Could not read the remaining amount' })
          : row.stageStart > now
            ? button('Locked', { disabled: true, title: `Unlocks ${formatUnlockDate(row.stageStart)}` })
            : button('Distribute', {
                title: `Mint this allocation to its beneficiary (anyone can)`,
              })}
        {status.kind === 'error' ? (
          <div className="text-xs text-red-400" role="alert">
            {status.message}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cardClass}>
      <div className={cardTitleClass}>Auto issue</div>
      <div className="mb-3">
        <ExplainerMessage>
          Tokens auto-issued to specific accounts, unlocking per stage across every chain.
        </ExplainerMessage>
      </div>

      {loadError ? (
        <p className="text-sm text-red-400" role="alert">
          Could not load auto issuance.
        </p>
      ) : !rows ? (
        <p className={`text-sm ${mutedText}`}>Loading from Bendystraw…</p>
      ) : !rows.length ? (
        <p className={`text-sm ${bodyText}`}>No auto issuance configured for this revnet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
            <thead>
              <tr className={`text-xs uppercase tracking-wide ${mutedText}`}>
                <th className="py-1.5 font-medium text-left">Chain</th>
                <th className="py-1.5 font-medium text-left">Stage</th>
                <th className="py-1.5 font-medium text-left">Account</th>
                <th className="py-1.5 font-medium text-right">Amount ({symbol})</th>
                <th className="py-1.5 font-medium text-right">Unlock date</th>
                <th className="py-1.5 font-medium text-right">Distribute</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={autoIssueKey(row)} className={`border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1.5">
                      <ChainLogo chainId={row.chainId} size={14} />
                      {CHAINS[row.chainId]?.name ?? `Chain ${row.chainId}`}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{row.stageIndex + 1}</td>
                  <td className="py-2 pr-3">
                    <span className="font-mono text-xs" title={row.beneficiary}>
                      {shortAddress(row.beneficiary)}
                    </span>
                  </td>
                  <td className="py-2 pl-3 text-right">
                    <div>{formatTokenCount18(row.count)}</div>
                    {row.remaining !== null && row.remaining > 0n && row.remaining !== row.count ? (
                      <div className={`text-xs ${mutedText}`}>{formatTokenCount18(row.remaining)} remaining</div>
                    ) : null}
                  </td>
                  <td className="py-2 pl-3 text-right">{formatUnlockDate(row.stageStart)}</td>
                  <td className="py-2 pl-3 text-right">{actionCell(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
