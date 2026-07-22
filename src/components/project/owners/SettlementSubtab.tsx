/**
 * Settlement subtab — cross-chain composition, gossip freshness, bridge
 * routes, and queued movements. Ports website/src/discover.js:
 * renderAcrossChainsBody (:17014), renderGossipSection (:19704),
 * renderBridgesSubsection (:17087), renderBridgeTransactions (:17503).
 *
 * Every transaction (Sync / Claim / Execute) runs through the shared guarded
 * runner (reverify → simulate → send → confirm), with the sucker-specific
 * guards from services/suckerBridge: claims verify the reconstructed merkle
 * root against the destination inbox, and CCIP sends never carry zero value.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { encodeFunctionData, formatUnits, type Hex } from 'viem'
import { type JBChainId } from '@bananapus/nana-sdk-core'
import {
  buildBridgeClaimTx,
  buildSyncAccountingDataTx,
  buildToRemoteTx,
  type JBLeafProof,
} from '@bananapus/nana-sdk-core/v6'
import { useThemeStore } from '../../../stores'
import { CHAINS } from '../../../constants'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { publicClientFor, type GuardedTxPhase } from '../../../services/projectTx'
import type { Project } from '../../../services/bendystraw'
import {
  BYTES32_ZERO,
  assertCcipTransport,
  classifySuckerInfra,
  fetchBridgeRoutes,
  fetchCompositionRows,
  fetchGossipKnowledge,
  fetchQueuedMovements,
  findSyncValue,
  findToRemoteValue,
  gossipSnapshotStaleness,
  snapshotAge,
  suckerBranchRoot,
  type BridgeRoute,
  type CompositionRow,
  type GossipChainKnowledge,
  type MovementStatus,
  type QueuedMovement,
  type QueuedMovementsResult,
  type Staleness,
  type SuckerInfra,
} from '../../../services/suckerBridge'

export interface SettlementSubtabProps {
  project: Project
  /** The sucker-group chains the project lives on (home chain first). */
  chainIds: number[]
  /** Per-chain project ids (V6 ids differ per chain); every per-chain read targets the id ON that chain. */
  chainProjects?: Array<{ chainId: number; projectId: number | string }>
}

const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: 'Re-checking on-chain state…',
  switching: 'Switching network…',
  approving: 'Approving…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
}

type TxState =
  | { kind: 'idle' }
  | { kind: 'running'; phase: GuardedTxPhase | 'fee' }
  | { kind: 'done'; note: string }
  | { kind: 'error'; message: string }

const chainName = (chainId: number) => CHAINS[chainId]?.name ?? `Chain ${chainId}`
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

function formatTokens(value: bigint): string {
  const [whole, fraction = ''] = formatUnits(value, 18).split('.')
  const visible = fraction.slice(0, whole === '0' ? 6 : 2).replace(/0+$/, '')
  const main = BigInt(whole).toLocaleString('en-US')
  return visible ? `${main}.${visible}` : main
}

function formatBalance(value: bigint, decimals: number, symbol: string): string {
  const amount = parseFloat(formatUnits(value, decimals))
  if (value > 0n && amount < 0.0001) return `<0.0001 ${symbol}`
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`
}

function timeAgo(seconds: number | null): string {
  return seconds ? snapshotAge(seconds) : '—'
}

/**
 * A part's share of a cross-chain total as a compact percent ("100%", "42.5%").
 * Null when the denominator is unknown — a share without a complete cross-chain
 * total is worse than none, so it renders as nothing rather than a fake 100%.
 */
function pctOf(part: bigint | null, total: bigint | null): string | null {
  if (part == null || total == null || total <= 0n || part < 0n) return null
  const pct = Number((part * 1_000_000n) / total) / 10_000
  if (pct >= 10) return `${pct.toFixed(2).replace(/\.?0+$/, '')}%`
  if (pct >= 0.01) return `${pct.toFixed(4).replace(/\.?0+$/, '')}%`
  return pct > 0 ? '<0.01%' : '0%'
}

/** Order infra tags native → CCIP → unknown so a mixed pair reads consistently. */
const INFRA_ORDER: Record<string, number> = { native: 0, CCIP: 1, unknown: 2 }

/** Rough delivery estimate by route — native L2→L1 exits wait out the challenge period. */
function bridgeEtaHint(tx: QueuedMovement): string | null {
  const L1 = new Set([1, 11155111])
  if (tx.infra === 'CCIP') return '20–30 min'
  if (tx.infra !== 'native') return null
  if (!L1.has(tx.chainId) && L1.has(tx.peerChainId)) return '7 days (challenge period)'
  return 'a few min'
}

export function SettlementSubtab({ project, chainIds, chainProjects }: SettlementSubtabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const symbol = project.tokenSymbol || 'tokens'
  // Per-chain project ids (V6 ids differ per chain), restricted to the chains shown.
  const settlementChains = useMemo(
    () =>
      (chainProjects && chainProjects.length
        ? chainProjects
        : [{ chainId: project.chainId, projectId: project.projectId }]
      ).filter(cp => chainIds.includes(cp.chainId)),
    [chainProjects, chainIds, project.chainId, project.projectId],
  )

  const [composition, setComposition] = useState<CompositionRow[] | null>(null)
  const [compositionError, setCompositionError] = useState(false)
  const [gossip, setGossip] = useState<GossipChainKnowledge[] | null>(null)
  const [gossipError, setGossipError] = useState(false)
  const [routes, setRoutes] = useState<BridgeRoute[] | null>(null)
  const [routesError, setRoutesError] = useState(false)
  const [movements, setMovements] = useState<QueuedMovementsResult | null>(null)
  const [movementsError, setMovementsError] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'claimable'>('all')
  const [txStates, setTxStates] = useState<Record<string, TxState>>({})
  const [reloadNonce, setReloadNonce] = useState(0)
  /** Gossip rows with an in-flight sync push (bridging takes minutes), keyed `${view}:${peer}`. */
  const [syncInFlight, setSyncInFlight] = useState<Record<string, number>>({})

  const reload = useCallback(() => setReloadNonce(nonce => nonce + 1), [])
  useEffect(() => {
    window.addEventListener('juice:project-data-invalidated', reload)
    return () => window.removeEventListener('juice:project-data-invalidated', reload)
  }, [reload])

  useEffect(() => {
    let cancelled = false
    setCompositionError(false)
    setGossipError(false)
    setRoutesError(false)
    setMovementsError(false)
    fetchCompositionRows(settlementChains)
      .then(rows => !cancelled && setComposition(rows))
      .catch(() => !cancelled && setCompositionError(true))
    if (settlementChains.length >= 2) {
      fetchGossipKnowledge(settlementChains)
        .then(data => !cancelled && setGossip(data))
        .catch(() => !cancelled && setGossipError(true))
    } else {
      setGossip([])
    }
    fetchBridgeRoutes(settlementChains)
      .then(data => !cancelled && setRoutes(data))
      .catch(() => !cancelled && setRoutesError(true))
    fetchQueuedMovements(settlementChains)
      .then(data => !cancelled && setMovements(data))
      .catch(() => !cancelled && setMovementsError(true))
    return () => {
      cancelled = true
    }
  }, [settlementChains, reloadNonce])

  const setTx = (key: string, state: TxState) => setTxStates(previous => ({ ...previous, [key]: state }))
  const txOf = (key: string): TxState => txStates[key] ?? { kind: 'idle' }

  // -- Sync: run syncAccountingData on the PEER's sucker so the peer re-pushes
  // -- its snapshot here (sync PUSHES local→peer; the tx runs on the peer chain).
  const syncFromPeer = async (viewChainId: number, peer: { peerChainId: number; syncSucker: `0x${string}` }) => {
    const key = `sync:${viewChainId}:${peer.peerChainId}`
    if (!activeAddress) {
      setTx(key, { kind: 'error', message: 'Connect a wallet first.' })
      return
    }
    try {
      setTx(key, { kind: 'running', phase: 'fee' })
      const infra = await classifySuckerInfra(peer.peerChainId, peer.syncSucker)
      const value = await findSyncValue(peer.peerChainId, peer.syncSucker, activeAddress)
      if (value == null) throw new Error('Could not determine the bridge messaging fee — try again shortly.')
      // Never send 0 native on a CCIP sucker — that flips it to LINK-fee mode.
      assertCcipTransport(infra, value)
      const request = buildSyncAccountingDataTx({
        chainId: peer.peerChainId as JBChainId,
        sucker: peer.syncSucker,
        value,
      })
      await run({
        chainId: peer.peerChainId,
        to: request.address,
        data: encodeFunctionData({
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
        }),
        value,
        review: {
          title: 'Review cross-chain accounting sync',
          label: `Send this sucker's accounting snapshot across the bridge`,
          contractName: 'JBSucker',
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
        },
        onPhase: phase => setTx(key, { kind: 'running', phase }),
      })
      setSyncInFlight(previous => ({ ...previous, [`${viewChainId}:${peer.peerChainId}`]: Math.floor(Date.now() / 1000) }))
      setTx(key, { kind: 'done', note: 'Snapshot pushed — it arrives over the bridge in a few minutes.' })
    } catch (error) {
      setTx(key, { kind: 'error', message: error instanceof Error ? error.message : 'The sync transaction failed.' })
    }
  }

  // -- Claim: per-leaf on the DESTINATION chain. The proof was verified against
  // -- the inbox root at fetch time; reverify re-reads that root and the
  // -- executed flag immediately before the send.
  const claimMovement = async (tx: QueuedMovement) => {
    const key = `claim:${tx.chainId}:${tx.sourceSucker}:${tx.index}`
    if (!activeAddress) {
      setTx(key, { kind: 'error', message: 'Connect a wallet first.' })
      return
    }
    if (!tx.proof || !tx.inboxRoot) {
      setTx(key, { kind: 'error', message: 'This movement has no verified proof yet. Refresh and try again.' })
      return
    }
    // Frozen reviewed inputs — the guard below re-verifies against these exact values.
    const proof = tx.proof.slice() as unknown as JBLeafProof
    const reviewedRoot = tx.inboxRoot
    const leaf = {
      index: BigInt(tx.index),
      beneficiary: tx.beneficiary32,
      projectTokenCount: tx.projectTokenCount,
      terminalTokenAmount: tx.terminalTokenAmount,
      metadata: tx.metadata,
    }
    try {
      if (suckerBranchRoot(tx.leafHash, proof as unknown as Hex[], tx.index).toLowerCase() !== reviewedRoot.toLowerCase()) {
        throw new Error('The reconstructed proof does not match the destination inbox. Refresh and try again.')
      }
      const request = buildBridgeClaimTx({
        chainId: tx.peerChainId as JBChainId,
        sucker: tx.peerSucker,
        claim: { token: tx.remoteToken, leaf, proof },
      })
      await run({
        chainId: tx.peerChainId,
        to: request.address,
        data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }),
        review: {
          title: 'Review cross-chain claim',
          label: `Claim queued movement #${tx.index} for its reviewed beneficiary`,
          contractName: 'JBSucker',
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
        },
        reverify: async () => {
          const client = publicClientFor(tx.peerChainId)
          const [inbox, executed] = await Promise.all([
            client.readContract({
              address: tx.peerSucker,
              abi: [
                {
                  type: 'function',
                  name: 'inboxOf',
                  stateMutability: 'view',
                  inputs: [{ name: 'token', type: 'address' }],
                  outputs: [
                    { type: 'tuple', components: [{ name: 'nonce', type: 'uint64' }, { name: 'root', type: 'bytes32' }] },
                  ],
                },
              ] as const,
              functionName: 'inboxOf',
              args: [tx.remoteToken],
            }),
            client.readContract({
              address: tx.peerSucker,
              abi: [
                {
                  type: 'function',
                  name: 'executedLeafHashOf',
                  stateMutability: 'view',
                  inputs: [
                    { name: 'token', type: 'address' },
                    { name: 'index', type: 'uint256' },
                  ],
                  outputs: [{ type: 'bytes32' }],
                },
              ] as const,
              functionName: 'executedLeafHashOf',
              args: [tx.remoteToken, BigInt(tx.index)],
            }),
          ])
          if (executed && !/^0x0+$/.test(executed)) throw new Error('This movement was already claimed.')
          if ((inbox.root || BYTES32_ZERO).toLowerCase() !== reviewedRoot.toLowerCase()) {
            throw new Error('The destination inbox advanced since review — refresh to rebuild the proof.')
          }
        },
        onPhase: phase => setTx(key, { kind: 'running', phase }),
      })
      setTx(key, { kind: 'done', note: `Claimed on ${chainName(tx.peerChainId)}.` })
    } catch (error) {
      setTx(key, { kind: 'error', message: error instanceof Error ? error.message : 'The claim transaction failed.' })
    }
  }

  // -- Execute: one toRemote ships the ENTIRE outbox for a (source sucker,
  // -- token) pair — permissionless; the value is only the messaging fee.
  const executeGroup = async (sample: QueuedMovement) => {
    const key = `execute:${sample.chainId}:${sample.sourceSucker}:${sample.token}`
    if (!activeAddress) {
      setTx(key, { kind: 'error', message: 'Connect a wallet first.' })
      return
    }
    try {
      setTx(key, { kind: 'running', phase: 'fee' })
      const value = await findToRemoteValue(sample.chainId, sample.sourceSucker, sample.token, activeAddress)
      if (value == null) throw new Error('Could not determine the bridge fee — try again shortly.')
      // CCIP lanes must carry a positive fee budget (zero flips to LINK-fee mode).
      assertCcipTransport(sample.infra, value)
      const request = buildToRemoteTx({
        chainId: sample.chainId as JBChainId,
        sucker: sample.sourceSucker,
        token: sample.token,
        value,
      })
      await run({
        chainId: sample.chainId,
        to: request.address,
        data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }),
        value,
        review: {
          title: 'Review queued bridge execution',
          label: 'Send the queued token outbox to the remote chain',
          contractName: 'JBSucker',
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
        },
        reverify: async () => {
          const outbox = await publicClientFor(sample.chainId).readContract({
            address: sample.sourceSucker,
            abi: [
              {
                type: 'function',
                name: 'outboxOf',
                stateMutability: 'view',
                inputs: [{ name: 'token', type: 'address' }],
                outputs: [
                  {
                    type: 'tuple',
                    components: [
                      { name: 'nonce', type: 'uint64' },
                      { name: 'numberOfClaimsSent', type: 'uint192' },
                      { name: 'balance', type: 'uint256' },
                      {
                        name: 'tree',
                        type: 'tuple',
                        components: [
                          { name: 'branch', type: 'bytes32[32]' },
                          { name: 'count', type: 'uint256' },
                        ],
                      },
                    ],
                  },
                ],
              },
            ] as const,
            functionName: 'outboxOf',
            args: [sample.token],
          })
          if (outbox.tree.count <= BigInt(outbox.numberOfClaimsSent)) {
            throw new Error('The bridge outbox has nothing queued to send — someone else already shipped it.')
          }
        },
        onPhase: phase => setTx(key, { kind: 'running', phase }),
      })
      setTx(key, { kind: 'done', note: `Shipped to ${chainName(sample.peerChainId)} — claim it once it delivers.` })
    } catch (error) {
      setTx(key, { kind: 'error', message: error instanceof Error ? error.message : 'The execute transaction failed.' })
    }
  }

  // -- Rendering helpers ------------------------------------------------------

  const cardClass = `border p-4 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`
  const cardTitleClass = `text-xs font-medium uppercase tracking-wide mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`
  const headText = `text-xs uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`
  const rowBorder = `border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`
  const muted = isDark ? 'text-gray-500' : 'text-gray-400'
  const bodyText = isDark ? 'text-gray-200' : 'text-gray-800'

  const stalenessClass = (level: Staleness['level']) =>
    level === 'synced'
      ? isDark
        ? 'text-green-400'
        : 'text-green-600'
      : level === 'slight'
        ? isDark
          ? 'text-amber-400'
          : 'text-amber-600'
        : level === 'danger'
          ? 'text-red-400'
          : muted

  const txStatusLine = (key: string) => {
    const state = txOf(key)
    if (state.kind === 'running') {
      return (
        <span className={`inline-flex items-center gap-1.5 text-xs ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
          <span className="animate-spin w-3 h-3 border-2 border-current border-t-transparent rounded-full" />
          {state.phase === 'fee' ? 'Finding bridge fee…' : PHASE_LABELS[state.phase]}
        </span>
      )
    }
    if (state.kind === 'done') return <span className={`text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}>{state.note}</span>
    if (state.kind === 'error')
      return (
        <span className="text-xs text-red-400" role="alert">
          {state.message}
        </span>
      )
    return null
  }

  const smallButton = (label: string, onClick: () => void, disabled = false, title?: string) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2.5 py-1 text-xs border transition-colors disabled:opacity-50 ${
        isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-300 text-gray-800 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  )

  // Composition totals — only when every chain's reads completed.
  const compositionTotals = useMemo(() => {
    if (!composition) return null
    const supplyComplete = composition.every(row => row.supply != null)
    const totalSupply = supplyComplete ? composition.reduce((sum, row) => sum + (row.supply as bigint), 0n) : null
    const balancesComplete = composition.every(row => row.tokensVerified)
    const byUnit: Record<string, { sum: bigint; decimals: number; symbol: string }> = {}
    if (balancesComplete) {
      for (const row of composition) {
        for (const token of row.tokens) {
          if (token.balance == null) continue
          const key = `${token.symbol}@${token.decimals}`
          byUnit[key] = byUnit[key] ?? { sum: 0n, decimals: token.decimals, symbol: token.symbol }
          byUnit[key].sum += token.balance
        }
      }
    }
    return { totalSupply, balancesComplete, byUnit }
  }, [composition])

  // Bridges: one row per unordered chain-pair, tagging each with its infra(s) —
  // a pair carrying both a native and a CCIP sucker shows both tags on one row.
  const bridgeGroups = useMemo(() => {
    if (!routes) return null
    const byPair = new Map<string, { a: number; b: number; infras: SuckerInfra[] }>()
    const order: string[] = []
    for (const route of routes) {
      const [lo, hi] = route.a <= route.b ? [route.a, route.b] : [route.b, route.a]
      const key = `${lo}-${hi}`
      let group = byPair.get(key)
      if (!group) {
        group = { a: route.a, b: route.b, infras: [] }
        byPair.set(key, group)
        order.push(key)
      }
      if (!group.infras.includes(route.infra)) group.infras.push(route.infra)
    }
    for (const key of order) {
      byPair.get(key)!.infras.sort((x, y) => (INFRA_ORDER[x] ?? 9) - (INFRA_ORDER[y] ?? 9))
    }
    return order.map(key => byPair.get(key)!)
  }, [routes])

  const compositionByChain = useMemo(() => {
    const map = new Map<number, CompositionRow>()
    for (const row of composition ?? []) map.set(row.chainId, row)
    return map
  }, [composition])

  const visibleMovements = (movements?.rows ?? []).filter(
    row => row.status !== 'claimed' && (statusFilter === 'all' || row.status === statusFilter),
  )
  const movementGroups = useMemo(() => {
    const groups: { key: string; rows: QueuedMovement[] }[] = []
    const byKey = new Map<string, QueuedMovement[]>()
    for (const row of visibleMovements) {
      const key = `${row.chainId}->${row.peerChainId}:${row.sourceSucker}:${row.token}`
      if (!byKey.has(key)) {
        byKey.set(key, [])
        groups.push({ key, rows: byKey.get(key)! })
      }
      byKey.get(key)!.push(row)
    }
    return groups
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movements, statusFilter])

  const statusBadge = (status: MovementStatus) => (
    <span
      className={`px-1.5 py-0.5 text-xs border ${
        status === 'claimable'
          ? isDark
            ? 'border-green-500/40 text-green-400'
            : 'border-green-300 text-green-700'
          : isDark
            ? 'border-amber-500/40 text-amber-400'
            : 'border-amber-300 text-amber-700'
      }`}
    >
      {status}
    </span>
  )

  return (
    <div className="space-y-4">
      {/* Composition */}
      <div className={cardClass}>
        <div className={cardTitleClass}>Composition</div>
        <div className="mb-3">
          <ExplainerMessage>
            This project&rsquo;s token lives on several chains at once — each chain holds part of the supply
            and part of the backing funds, and holders can move between them. Here&rsquo;s how it breaks down.
          </ExplainerMessage>
        </div>
        {compositionError ? (
          <p className={`text-sm ${muted}`}>Could not read cross-chain state.</p>
        ) : !composition ? (
          <p className={`text-sm ${muted}`}>Reading each chain…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={`w-full text-sm ${bodyText}`}>
              <thead>
                <tr className={headText}>
                  <th className="py-1.5 font-medium text-left">Chain</th>
                  <th className="py-1.5 font-medium text-right">Supply ({symbol})</th>
                  <th className="py-1.5 font-medium text-right">Balance</th>
                  <th className="py-1.5 font-medium text-right">Unit value</th>
                </tr>
              </thead>
              <tbody>
                {composition.map(row => {
                  // Supply share of the cross-chain total (only when every chain's supply read succeeded).
                  const supplyPct = pctOf(row.supply, compositionTotals?.totalSupply ?? null)
                  return (
                    <tr key={row.chainId} className={rowBorder}>
                      <td className="py-2 pr-3">{chainName(row.chainId)}</td>
                      <td className="py-2 pl-3 text-right">
                        {row.supply == null ? (
                          '—'
                        ) : (
                          <>
                            <div>{formatTokens(row.supply)}</div>
                            {supplyPct ? <div className={`text-xs ${muted}`}>{supplyPct}</div> : null}
                          </>
                        )}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        {row.tokens.length === 0
                          ? '—'
                          : row.tokens.map(token => {
                              // Balance share of THAT token's cross-chain total.
                              const unit = compositionTotals?.balancesComplete
                                ? compositionTotals.byUnit[`${token.symbol}@${token.decimals}`]
                                : undefined
                              const balancePct = pctOf(token.balance, unit?.sum ?? null)
                              return (
                                <div key={token.token}>
                                  <div>
                                    {token.balance == null ? '—' : formatBalance(token.balance, token.decimals, token.symbol)}
                                  </div>
                                  {balancePct ? <div className={`text-xs ${muted}`}>{balancePct}</div> : null}
                                </div>
                              )
                            })}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        {row.unitValue == null || !row.acct
                          ? '—'
                          : formatBalance(row.unitValue, row.acct.decimals, row.acct.symbol)}
                      </td>
                    </tr>
                  )
                })}
                {composition.length > 1 && compositionTotals ? (
                  <tr className={`border-t font-medium ${isDark ? 'border-white/20' : 'border-gray-200'}`}>
                    <td className="py-2 pr-3">Total</td>
                    <td className="py-2 pl-3 text-right">
                      {compositionTotals.totalSupply == null ? '—' : formatTokens(compositionTotals.totalSupply)}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      {!compositionTotals.balancesComplete || !Object.keys(compositionTotals.byUnit).length
                        ? '—'
                        : Object.entries(compositionTotals.byUnit).map(([key, unit]) => (
                            <div key={key}>{formatBalance(unit.sum, unit.decimals, unit.symbol)}</div>
                          ))}
                    </td>
                    <td className="py-2 pl-3" />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Gossip */}
      {chainIds.length >= 2 ? (
        <div className={cardClass}>
          <div className={cardTitleClass}>Gossip</div>
          <div className="mb-3">
            <ExplainerMessage>
              Each chain&rsquo;s cash out and loan availability depends on its knowledge of the project&rsquo;s
              composition on the other chains. Stale rows can be refreshed with a Sync — a paid bridge message
              that takes a few minutes to arrive (longer for native L2→L1 routes, which wait out the challenge
              period).
            </ExplainerMessage>
          </div>
          {gossipError ? (
            <p className={`text-sm ${muted}`}>Could not verify cross-chain gossip state.</p>
          ) : !gossip || !composition ? (
            <p className={`text-sm ${muted}`}>Reading gossip snapshots…</p>
          ) : (
            <div className="space-y-4">
              {gossip.map(block => (
                <div key={block.chainId}>
                  <div className={`text-sm font-medium mb-1.5 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {chainName(block.chainId)} knows
                  </div>
                  <div className="overflow-x-auto">
                    <table className={`w-full text-sm ${bodyText}`}>
                      <thead>
                        <tr className={headText}>
                          <th className="py-1.5 font-medium text-left">Chain</th>
                          <th className="py-1.5 font-medium text-left">Status</th>
                          <th className="py-1.5 font-medium text-left" />
                          <th className="py-1.5 font-medium text-right">Supply</th>
                          <th className="py-1.5 font-medium text-right">Balance</th>
                          <th className="py-1.5 font-medium text-right">Snapshot</th>
                        </tr>
                      </thead>
                      <tbody>
                        {block.peers.map(peer => {
                          const live = compositionByChain.get(peer.peerChainId)
                          const staleness = gossipSnapshotStaleness(peer, live)
                          const flightKey = `${block.chainId}:${peer.peerChainId}`
                          const sentAt = syncInFlight[flightKey]
                          const pending =
                            sentAt != null && (peer.snapshot < sentAt) && Math.floor(Date.now() / 1000) - sentAt < 1800
                          const key = `sync:${block.chainId}:${peer.peerChainId}`
                          const running = txOf(key).kind === 'running'
                          const showSync =
                            peer.syncSucker && (pending || (staleness.level !== 'synced' && staleness.level !== 'unknown'))
                          return (
                            <tr key={peer.peerChainId} className={rowBorder}>
                              <td className="py-2 pr-3">{chainName(peer.peerChainId)}</td>
                              <td className="py-2 pr-3">
                                <span className={`text-xs ${pending ? stalenessClass('slight') : stalenessClass(staleness.level)}`}>
                                  {pending ? 'Syncing…' : staleness.label}
                                </span>
                              </td>
                              <td className="py-2 pr-3">
                                {showSync ? (
                                  <span className="inline-flex items-center gap-2">
                                    {smallButton(
                                      pending ? 'Sent' : 'Sync',
                                      () =>
                                        syncFromPeer(block.chainId, {
                                          peerChainId: peer.peerChainId,
                                          syncSucker: peer.syncSucker as `0x${string}`,
                                        }),
                                      pending || running,
                                      `Run syncAccountingData on ${chainName(peer.peerChainId)} so it re-pushes its accounting here. You pay the bridge messaging fee; excess is refunded.`,
                                    )}
                                    {txStatusLine(key)}
                                  </span>
                                ) : null}
                              </td>
                              <td className="py-2 pl-3 text-right">{formatTokens(peer.supply)}</td>
                              <td className="py-2 pl-3 text-right">
                                {peer.balances.length
                                  ? peer.balances.map(balance => (
                                      <div key={`${balance.token}@${balance.decimals}`}>
                                        {balance.balance == null
                                          ? '—'
                                          : formatBalance(balance.balance, balance.decimals, balance.symbol)}
                                      </div>
                                    ))
                                  : '0'}
                              </td>
                              <td className={`py-2 pl-3 text-right text-xs ${muted}`}>{snapshotAge(peer.snapshot)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Bridges */}
      <div className={cardClass}>
        <div className={cardTitleClass}>Bridges</div>
        <div className="mb-3">
          <ExplainerMessage>
            {symbol}, funds, and information move through these bridges. Native routes ride the chain&rsquo;s
            own canonical bridge (slower, chain-grade security); CCIP routes relay through Chainlink&rsquo;s
            network (minutes, but a third-party dependency).
          </ExplainerMessage>
        </div>
        {routesError ? (
          <p className={`text-sm ${muted}`}>Could not verify the project&rsquo;s bridge routes.</p>
        ) : !routes ? (
          <p className={`text-sm ${muted}`}>Reading bridge routes…</p>
        ) : !routes.length ? (
          <p className={`text-sm ${muted}`}>No bridges configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={`w-full text-sm ${bodyText}`}>
              <thead>
                <tr className={headText}>
                  <th className="py-1.5 font-medium text-left">Chains</th>
                  <th className="py-1.5 font-medium text-left">Types</th>
                </tr>
              </thead>
              <tbody>
                {(bridgeGroups ?? []).map(group => (
                  <tr key={`${group.a}-${group.b}`} className={rowBorder}>
                    <td className="py-2 pr-3">
                      {chainName(group.a)} <span className={muted}>↔</span> {chainName(group.b)}
                    </td>
                    <td className="py-2">
                      <span className="inline-flex flex-wrap gap-1">
                        {group.infras.map(infra => (
                          <span
                            key={infra}
                            className={`px-1.5 py-0.5 text-xs border ${
                              isDark ? 'border-white/15 text-gray-300' : 'border-gray-200 text-gray-600'
                            }`}
                          >
                            {infra === 'unknown' ? 'Unverified' : infra}
                          </span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Queued movements */}
      <div className={cardClass}>
        <div className="flex items-center justify-between mb-3">
          <div className={`text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            Queued movements
          </div>
          <select
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}
            className={`select-caret pl-2 pr-6 py-1 text-xs border bg-transparent ${
              isDark ? 'border-white/20 text-gray-300' : 'border-gray-300 text-gray-700'
            }`}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="claimable">Claimable</option>
          </select>
        </div>
        <div className="mb-3">
          <ExplainerMessage>
            Anything in flight between chains shows here until it clears: queued moves wait for an Execute
            (one bridge message ships the whole queue — anyone can send it), then become claimable on the
            destination. Claiming runs on the destination chain, so your wallet needs gas there. Native
            L2→L1 exits wait out the ~7-day challenge period before they turn claimable.
          </ExplainerMessage>
        </div>
        {movementsError ? (
          <p className={`text-sm ${muted}`}>Could not load bridge transactions.</p>
        ) : !movements ? (
          <p className={`text-sm ${muted}`}>Scanning bridge outboxes…</p>
        ) : (
          <>
            {movements.failedChains.length ? (
              <p className={`text-xs mb-2 ${muted}`}>
                Could not verify movements on {movements.failedChains.map(chainName).join(', ')} — those chains show
                &ldquo;—&rdquo; until the RPC recovers.
              </p>
            ) : null}
            {!visibleMovements.length ? (
              <p className={`text-sm ${muted}`}>
                No queued movements — anything in flight shows here until it clears.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className={`w-full text-sm ${bodyText}`}>
                  <thead>
                    <tr className={headText}>
                      <th className="py-1.5 font-medium text-left">Initiated</th>
                      <th className="py-1.5 font-medium text-left">Chains</th>
                      <th className="py-1.5 font-medium text-left">Beneficiary</th>
                      <th className="py-1.5 font-medium text-right">Tokens</th>
                      <th className="py-1.5 font-medium text-right">Value</th>
                      <th className="py-1.5 font-medium text-left pl-3">Status</th>
                      <th className="py-1.5 font-medium text-left pl-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementGroups.map(group => {
                      const sendable = group.rows.filter(row => row.status === 'pending' && row.canExecute)
                      const sample = group.rows[0]
                      const executeKey = `execute:${sample.chainId}:${sample.sourceSucker}:${sample.token}`
                      return (
                        <MovementGroup
                          key={group.key}
                          rows={group.rows}
                          sendable={sendable}
                          rowBorder={rowBorder}
                          muted={muted}
                          symbol={symbol}
                          claimKeyOf={tx => `claim:${tx.chainId}:${tx.sourceSucker}:${tx.index}`}
                          txOf={txOf}
                          txStatusLine={txStatusLine}
                          smallButton={smallButton}
                          statusBadge={statusBadge}
                          onClaim={claimMovement}
                          onExecute={() => executeGroup(sendable[0] ?? sample)}
                          executeKey={executeKey}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** One from→to group: its rows plus (when anything is still unsent) a one-per-group Execute footer. */
function MovementGroup(props: {
  rows: QueuedMovement[]
  sendable: QueuedMovement[]
  rowBorder: string
  muted: string
  symbol: string
  claimKeyOf: (tx: QueuedMovement) => string
  txOf: (key: string) => TxState
  txStatusLine: (key: string) => React.ReactNode
  smallButton: (label: string, onClick: () => void, disabled?: boolean, title?: string) => React.ReactNode
  statusBadge: (status: MovementStatus) => React.ReactNode
  onClaim: (tx: QueuedMovement) => void
  onExecute: () => void
  executeKey: string
}) {
  const {
    rows,
    sendable,
    rowBorder,
    muted,
    symbol,
    claimKeyOf,
    txOf,
    txStatusLine,
    smallButton,
    statusBadge,
    onClaim,
    onExecute,
    executeKey,
  } = props
  return (
    <>
      {rows.map(tx => {
        const claimKey = claimKeyOf(tx)
        const claimRunning = txOf(claimKey).kind === 'running'
        const eta = bridgeEtaHint(tx)
        return (
          <tr key={`${tx.chainId}:${tx.sourceSucker}:${tx.index}`} className={rowBorder}>
            <td className={`py-2 pr-3 text-xs ${muted}`}>{timeAgo(tx.createdAt)}</td>
            <td className="py-2 pr-3 whitespace-nowrap">
              {chainName(tx.chainId)} <span className={muted}>→</span> {chainName(tx.peerChainId)}
            </td>
            <td className="py-2 pr-3 font-mono text-xs" title={tx.beneficiary}>
              {shortAddress(tx.beneficiary)}
            </td>
            <td className="py-2 pl-3 text-right whitespace-nowrap">
              {formatTokens(tx.projectTokenCount)} {symbol}
            </td>
            <td className="py-2 pl-3 text-right whitespace-nowrap">
              {formatBalance(tx.terminalTokenAmount, tx.tokenDecimals, tx.tokenSymbol)}
            </td>
            <td className="py-2 pl-3">{statusBadge(tx.status)}</td>
            <td className="py-2 pl-3">
              {tx.status === 'claimable' ? (
                <span className="inline-flex items-center gap-2">
                  {smallButton(
                    'Claim',
                    () => onClaim(tx),
                    claimRunning,
                    `Claim on ${chainName(tx.peerChainId)} — the transaction runs there, so your wallet needs ${chainName(tx.peerChainId)} gas.`,
                  )}
                  {txStatusLine(claimKey)}
                </span>
              ) : tx.status === 'pending' && tx.canExecute ? (
                <span className={`text-xs ${muted}`}>Queued</span>
              ) : (
                <span className={`text-xs ${muted}`}>Bridging…{eta ? ` ~${eta}` : ''}</span>
              )}
            </td>
          </tr>
        )
      })}
      {sendable.length ? (
        <tr className={rowBorder}>
          <td colSpan={7} className="py-2">
            <span className={`inline-flex flex-wrap items-center gap-2 text-xs ${muted}`}>
              {sendable.length} queued move{sendable.length > 1 ? 's' : ''} to {chainName(sendable[0].peerChainId)} —
              send all in one bridge message:
              {smallButton(
                'Execute',
                onExecute,
                txOf(executeKey).kind === 'running',
                `Ship the queued outbox to ${chainName(sendable[0].peerChainId)} (anyone can call this). The value is the bridge's messaging fee, not the bridged tokens.`,
              )}
              {txStatusLine(executeKey)}
            </span>
          </td>
        </tr>
      ) : null}
    </>
  )
}

export default SettlementSubtab
