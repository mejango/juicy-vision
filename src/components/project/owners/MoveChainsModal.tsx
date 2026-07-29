/**
 * Move between chains — two-step sucker bridge flow. Ports
 * website/src/discover.js buildMoveModal (:20013):
 *
 *   Step 1 `JBSucker.prepare(projectTokenCount, beneficiary, minTokensReclaimed,
 *   token, metadata)` — with an ERC-20 approval pre-step and a
 *   minTokensReclaimed floor at 99% of the net-of-fee reclaim quote.
 *   Step 2 `JBSucker.toRemote(token)` — payable; the msg.value is discovered
 *   by escalating simulation and is NEVER zero on a CCIP lane.
 *
 * Suckers bridge the CLAIMED ERC-20 only — credits are blocked with an
 * explanatory note. Where a chain pair carries both a native and a CCIP
 * sucker there's a bridge picker; an ERC-20 backing token forces CCIP
 * (canonical tokens over a native bridge strand in escrow).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { encodeFunctionData, formatUnits, parseUnits } from 'viem'
import { type JBChainId } from '@bananapus/nana-sdk-core'
import { buildBridgePrepareTx, buildToRemoteTx } from '@bananapus/nana-sdk-core/v6'
import { useThemeStore } from '../../../stores'
import { CHAINS, NATIVE_TOKEN } from '../../../constants'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { type GuardedTxPhase } from '../../../services/projectTx'
import type { Project } from '../../../services/bendystraw'
import { makeProjectIdResolver } from '../../../utils/projectChains'
import {
  assertCcipTransport,
  classifySuckerInfra,
  findToRemoteValue,
  quoteMoveBacking,
  quotePrepareMin,
  readBridgeableBalance,
  readSuckerPairsOf,
  verifyMoveRoute,
  type BridgeableBalance,
  type MoveBackingQuote,
  type SuckerInfra,
  type SuckerPair,
} from '../../../services/suckerBridge'
import DialogShell from '../../ui/DialogShell'
import ChainLogo from '../../ui/ChainLogo'

export interface MoveChainsModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project
  /** The sucker-group chains the project lives on (home chain first). */
  chainIds: number[]
  /** Per-chain project ids (V6 ids differ per chain); reads/txs target the id ON each chain. */
  chainProjects?: Array<{ chainId: number; projectId: number | string }>
}

const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: 'Re-checking the route and quote…',
  switching: 'Switching network…',
  approving: 'Approving the bridge to move your tokens…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
}

type FlowState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | {
      kind: 'review'
      // Everything below is FROZEN at review time; the runner's reverify
      // re-reads the chain and aborts on drift instead of trusting these.
      amount: bigint
      sucker: `0x${string}`
      erc20: `0x${string}`
      termToken: `0x${string}`
      infra: SuckerInfra
      net: bigint
      minReclaimed: bigint
      backingMoved: bigint | null
    }
  | { kind: 'preparing'; phase: GuardedTxPhase }
  | { kind: 'sending'; phase: GuardedTxPhase | 'fee' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

const chainName = (chainId: number) => CHAINS[chainId]?.name ?? `Chain ${chainId}`

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

export function MoveChainsModal({ isOpen, onClose, project, chainIds, chainProjects }: MoveChainsModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const symbol = project.tokenSymbol || 'tokens'
  // Per-chain project ids (V6 ids differ per chain): the source sucker + FROM-chain
  // reads use the FROM id; the destination contexts use the TO id.
  const pidFor = useMemo(
    () => makeProjectIdResolver(chainProjects, { chainId: project.chainId, projectId: project.projectId }),
    [chainProjects, project.chainId, project.projectId],
  )
  const [fromChainId, setFromChainId] = useState<number>(chainIds[0])
  const [toChainId, setToChainId] = useState<number>(chainIds[1] ?? chainIds[0])
  const [amountInput, setAmountInput] = useState('')
  const [balance, setBalance] = useState<BridgeableBalance | null>(null)
  const [pairs, setPairs] = useState<SuckerPair[] | null | 'error'>(null)
  const [matchInfras, setMatchInfras] = useState<SuckerInfra[] | null>(null)
  const [bridgeIndex, setBridgeIndex] = useState(0)
  const [backing, setBacking] = useState<MoveBackingQuote | null>(null)
  const [flow, setFlow] = useState<FlowState>({ kind: 'idle' })
  // Ref-lock: the Confirm button lives on the frozen 'review' screen, which stays
  // mounted through the async gap before run() flips flow to 'preparing'. Guard
  // against a double-confirm (and against clicks racing a chain-select change).
  const confirmLock = useRef(false)
  const [confirming, setConfirming] = useState(false)

  // The project's id on each selected chain (null = project not on that chain).
  const fromPid = pidFor(fromChainId)
  const toPid = pidFor(toChainId)

  // Reset per open / per source chain.
  useEffect(() => {
    if (!isOpen) return
    setFromChainId(chainIds[0])
    setToChainId(chainIds[1] ?? chainIds[0])
    setAmountInput('')
    setFlow({ kind: 'idle' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Balance + pairs + backing all key off the FROM chain; stale async results
  // are dropped by re-checking the chain the effect ran for.
  useEffect(() => {
    if (!isOpen || fromPid == null) return
    let cancelled = false
    setBalance(null)
    setPairs(null)
    setBacking(null)
    setMatchInfras(null)
    if (activeAddress) {
      readBridgeableBalance(fromPid, fromChainId, activeAddress).then(result => {
        if (!cancelled) setBalance(result)
      })
    }
    readSuckerPairsOf(fromPid, fromChainId)
      .then(result => !cancelled && setPairs(result))
      .catch(() => !cancelled && setPairs('error'))
    quoteMoveBacking(fromPid, fromChainId).then(result => {
      if (!cancelled) setBacking(result)
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, fromChainId, fromPid, activeAddress])

  const matches = useMemo(
    () => (Array.isArray(pairs) ? pairs.filter(pair => pair.remoteChainId === toChainId) : []),
    [pairs, toChainId],
  )

  // Two suckers can connect a pair (native + CCIP) — classify each for the picker.
  useEffect(() => {
    if (matches.length < 2) {
      setMatchInfras(null)
      setBridgeIndex(0)
      return
    }
    let cancelled = false
    Promise.all(matches.map(match => classifySuckerInfra(fromChainId, match.local))).then(infras => {
      if (cancelled) return
      setMatchInfras(infras)
      // Default to the native (fee-only) bridge — EXCEPT when the backing token is an
      // ERC-20: native bridges can't deliver it, so CCIP is the only working route.
      const erc20Backing = backing?.acct && backing.acct.token.toLowerCase() !== NATIVE_TOKEN.toLowerCase()
      const nativeIndex = infras.indexOf('native')
      const ccipIndex = infras.indexOf('CCIP')
      setBridgeIndex(erc20Backing ? (ccipIndex >= 0 ? ccipIndex : 0) : nativeIndex >= 0 ? nativeIndex : 0)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, fromChainId, backing?.acct?.token])

  const selectedSucker = matches.length === 1 ? matches[0].local : matches.length > 1 ? matches[bridgeIndex]?.local : null

  const parsedAmount = useMemo(() => {
    if (!amountInput.trim()) return null
    try {
      return parseUnits(amountInput.trim(), 18)
    } catch {
      return null
    }
  }, [amountInput])

  const backingMoved = useMemo(() => {
    if (!backing || backing.supply == null || backing.surplus == null || backing.supply === 0n) return null
    if (parsedAmount == null || parsedAmount === 0n) return null
    return (backing.surplus * parsedAmount) / backing.supply
  }, [backing, parsedAmount])

  // Why the Move button is disabled — surfaced instead of a silent no-op.
  const blockReason = useMemo(() => {
    if (!activeAddress) return 'Connect a wallet to move tokens.'
    if (fromChainId === toChainId) return 'Pick two different chains to bridge between.'
    if (fromPid == null) return `This project is not on ${chainName(fromChainId)}.`
    if (toPid == null) return `This project is not on ${chainName(toChainId)}.`
    if (pairs === 'error') return `Could not verify bridge routes on ${chainName(fromChainId)}. Try again shortly.`
    if (pairs == null) return 'Finding a verified bridge route…'
    if (!matches.length) return `No bridge from ${chainName(fromChainId)} to ${chainName(toChainId)}.`
    if (!selectedSucker) return 'Pick a bridge for this route.'
    if (!balance) return 'Reading your bridgeable balance…'
    if (!balance.verified) return `Could not verify your bridgeable balance on ${chainName(fromChainId)}. Try again shortly.`
    if (!balance.token)
      return `No ERC-20 ${symbol} on ${chainName(fromChainId)} yet — suckers bridge the ERC-20, not project credits. Claim your credits to an ERC-20 there first (Accounts subtab), then move.`
    if (balance.balance != null && balance.balance === 0n) return `You have no ${symbol} to bridge on ${chainName(fromChainId)}.`
    if (!backing || !backing.acct) return 'Loading the verified backing token…'
    if (parsedAmount == null) return amountInput.trim() ? 'Invalid amount.' : 'Enter an amount.'
    if (parsedAmount === 0n) return 'Enter an amount.'
    if (balance.balance != null && parsedAmount > balance.balance) return 'Amount exceeds your bridgeable balance.'
    return null
  }, [activeAddress, fromChainId, toChainId, fromPid, toPid, pairs, matches, selectedSucker, balance, backing, parsedAmount, amountInput, symbol])

  // -- Review: run every route guard + quote the floor, then freeze the inputs.
  const review = useCallback(async () => {
    if (blockReason || !activeAddress || !selectedSucker || !balance?.token || !backing?.acct || parsedAmount == null) return
    if (fromPid == null || toPid == null) return
    setFlow({ kind: 'checking' })
    try {
      const termToken = backing.acct.token
      const { infra } = await verifyMoveRoute({
        fromProjectId: fromPid,
        toProjectId: toPid,
        fromChainId,
        toChainId,
        sucker: selectedSucker,
        termToken,
      })
      const quote = await quotePrepareMin({
        projectId: fromPid,
        chainId: fromChainId,
        sucker: selectedSucker,
        amount: parsedAmount,
        termToken,
      })
      setFlow({
        kind: 'review',
        amount: parsedAmount,
        sucker: selectedSucker,
        erc20: balance.token,
        termToken,
        infra,
        net: quote.net,
        minReclaimed: quote.minReclaimed,
        backingMoved,
      })
    } catch (error) {
      setFlow({ kind: 'error', message: error instanceof Error ? error.message : 'Could not safely preview this movement.' })
    }
  }, [blockReason, activeAddress, selectedSucker, balance, backing, parsedAmount, backingMoved, fromPid, toPid, fromChainId, toChainId])

  // -- Submit: step 1 prepare (approval pre-step + re-quote guard), step 2 toRemote.
  const submit = useCallback(
    async (reviewed: Extract<FlowState, { kind: 'review' }>) => {
      if (!activeAddress) return
      // Acquire the in-flight lock before the first await; release in finally.
      if (confirmLock.current) return
      confirmLock.current = true
      setConfirming(true)
      const { amount, sucker, erc20, termToken, infra, minReclaimed } = reviewed
      try {
        const prepare = buildBridgePrepareTx({
          chainId: fromChainId as JBChainId,
          sucker,
          projectTokenCount: amount,
          beneficiary: activeAddress,
          minTokensReclaimed: minReclaimed,
          token: termToken,
        })
        await run({
          chainId: fromChainId,
          to: prepare.address,
          data: encodeFunctionData({ abi: prepare.abi, functionName: prepare.functionName, args: prepare.args }),
          approval: { token: erc20, spender: sucker, amount },
          review: {
            title: 'Review cross-chain move preparation',
            label: 'Reclaim project tokens into the source sucker and queue the bridge movement',
            contractName: 'JBSucker',
            abi: prepare.abi,
            functionName: prepare.functionName,
            args: prepare.args,
          },
          reverify: async () => {
            // Re-read the reviewed state right before the send: the route must
            // still be valid and the live net quote must not have dropped
            // below the floor the user reviewed.
            if (fromPid == null || toPid == null) throw new Error('This project is not on the selected chains.')
            await verifyMoveRoute({ fromProjectId: fromPid, toProjectId: toPid, fromChainId, toChainId, sucker, termToken })
            const [fresh, freshBalance] = await Promise.all([
              quotePrepareMin({ projectId: fromPid, chainId: fromChainId, sucker, amount, termToken }),
              activeAddress ? readBridgeableBalance(fromPid, fromChainId, activeAddress) : Promise.resolve(null),
            ])
            if (fresh.net < minReclaimed) {
              throw new Error('The live reclaim quote dropped below the reviewed floor. Reopen to re-review.')
            }
            if (!freshBalance?.verified || freshBalance.balance == null || freshBalance.balance < amount) {
              throw new Error('Your bridgeable balance changed since review. Reopen to refresh.')
            }
          },
          onPhase: phase => setFlow({ kind: 'preparing', phase }),
        })

        // Step 2: ship the queued outbox. Discover the exact msg.value by simulation —
        // native = registry fee only, CCIP = fee + messaging budget (never zero).
        setFlow({ kind: 'sending', phase: 'fee' })
        const value = await findToRemoteValue(fromChainId, sucker, termToken, activeAddress)
        if (value == null) {
          throw new Error('Prepared, but the bridge queue isn’t ready to send yet — use Execute in Queued movements shortly.')
        }
        assertCcipTransport(infra, value)
        const toRemote = buildToRemoteTx({ chainId: fromChainId as JBChainId, sucker, token: termToken, value })
        await run({
          chainId: fromChainId,
          to: toRemote.address,
          data: encodeFunctionData({ abi: toRemote.abi, functionName: toRemote.functionName, args: toRemote.args }),
          value,
          review: {
            title: 'Review cross-chain bridge send',
            label: 'Send the prepared movement to the remote chain',
            contractName: 'JBSucker',
            abi: toRemote.abi,
            functionName: toRemote.functionName,
            args: toRemote.args,
          },
          onPhase: phase => setFlow({ kind: 'sending', phase }),
        })
        setFlow({ kind: 'done' })
      } catch (error) {
        setFlow({ kind: 'error', message: error instanceof Error ? error.message : 'The move failed.' })
      } finally {
        confirmLock.current = false
        setConfirming(false)
      }
    },
    [activeAddress, fromChainId, toChainId, fromPid, toPid, run],
  )

  if (!isOpen) return null

  const busy = flow.kind === 'checking' || flow.kind === 'preparing' || flow.kind === 'sending'
  const acctSymbol = backing?.acct?.symbol ?? 'backing tokens'
  const acctDecimals = backing?.acct?.decimals ?? 18

  const selectClass = `select-caret pl-2 pr-6 py-1 text-sm border bg-transparent ${
    isDark ? 'border-white/20 text-white' : 'border-gray-300 text-gray-900'
  }`
  const labelClass = `text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`

  return (
    <DialogShell isOpen onClose={onClose} dismissible={!busy} labelledBy="move-chains-modal-title">
      <div className={`relative w-full max-w-lg border ${isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'}`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <h2 id="move-chains-modal-title" className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Move between chains</h2>
          {!busy ? (
            <button
              onClick={onClose}
              className={`p-2 transition-colors ${
                isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Bridge your {symbol} to the same project on another chain. A proportional share of the
            project&rsquo;s {acctSymbol} surplus moves with them — the move is a two-step transaction
            (prepare, then send), and you claim on the destination once the bridge delivers.
          </p>

          {/* From / to */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={labelClass}>From</span>
            <ChainLogo chainId={fromChainId} size={16} />
            <select value={fromChainId} onChange={event => setFromChainId(Number(event.target.value))} disabled={busy || flow.kind === 'review'} className={selectClass}>
              {chainIds.map(chainId => (
                <option key={chainId} value={chainId}>
                  {chainName(chainId)}
                </option>
              ))}
            </select>
            <span className={labelClass}>to</span>
            <ChainLogo chainId={toChainId} size={16} />
            <select value={toChainId} onChange={event => setToChainId(Number(event.target.value))} disabled={busy || flow.kind === 'review'} className={selectClass}>
              {chainIds.map(chainId => (
                <option key={chainId} value={chainId}>
                  {chainName(chainId)}
                </option>
              ))}
            </select>
          </div>

          {/* Bridge picker when the pair carries both a native and a CCIP sucker. */}
          {matches.length > 1 && matchInfras ? (
            <div className="space-y-1.5">
              <div className={labelClass}>Bridge</div>
              <select value={bridgeIndex} onChange={event => setBridgeIndex(Number(event.target.value))} disabled={busy} className={selectClass}>
                {matches.map((match, index) => (
                  <option key={match.local} value={index}>
                    {matchInfras[index] === 'CCIP' ? 'CCIP' : matchInfras[index] === 'native' ? 'Native' : 'Unverified'} bridge |{' '}
                    {`${match.local.slice(0, 6)}…${match.local.slice(-4)}`}
                  </option>
                ))}
              </select>
              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {matchInfras[bridgeIndex] === 'CCIP'
                  ? 'CCIP delivers in minutes by relaying through Chainlink’s cross-chain network — faster, but it depends on Chainlink.'
                  : matchInfras[bridgeIndex] === 'native'
                    ? 'Native bridges route through the chain’s own canonical bridge — slower (L2→L1 exits wait out the ~7-day challenge period), but their security comes from the chain itself.'
                    : 'The bridge type could not be verified. Fee-sensitive actions stay unavailable until this route can be read again.'}
              </p>
            </div>
          ) : null}

          {/* Amount */}
          <div className="space-y-1.5">
            <div className={labelClass}>Amount</div>
            <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {!activeAddress
                ? 'Connect a wallet to see your balance.'
                : !balance
                  ? 'Reading your balance…'
                  : !balance.verified
                    ? `Could not verify your bridgeable balance on ${chainName(fromChainId)}.`
                    : !balance.token
                      ? `No ERC-20 ${symbol} on ${chainName(fromChainId)} — project credits can’t bridge. Claim your credits to an ERC-20 first, then move.`
                      : `Your ${symbol} available on ${chainName(fromChainId)}: ${formatTokens(balance.balance ?? 0n)}`}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={event => setAmountInput(event.target.value)}
                placeholder="0.00"
                disabled={busy}
                className={`flex-1 px-3 py-2 text-sm border bg-transparent ${
                  isDark ? 'border-white/20 text-white placeholder-gray-600' : 'border-gray-300 text-gray-900 placeholder-gray-400'
                }`}
              />
              <button
                onClick={() => balance?.balance != null && setAmountInput(formatUnits(balance.balance, 18))}
                disabled={busy || balance?.balance == null}
                className={`px-2.5 py-1 text-xs border transition-colors disabled:opacity-50 ${
                  isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-300 text-gray-800 hover:bg-gray-50'
                }`}
              >
                Max
              </button>
            </div>
          </div>

          {/* Backing preview */}
          {backingMoved != null && backing?.acct ? (
            <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              <span className="font-medium">Surplus that will move: </span>
              {formatBalance(backingMoved, acctDecimals, acctSymbol)}
              {backing.surplus === 0n ? (
                <span className={`block text-xs mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  No {acctSymbol} surplus on {chainName(fromChainId)} — its payout limit covers the whole balance. The
                  same token count still mints on {chainName(toChainId)}, but no backing moves with it.
                </span>
              ) : null}
            </p>
          ) : null}

          {/* Block reason / status */}
          {flow.kind === 'idle' && blockReason ? (
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{blockReason}</p>
          ) : null}
          {flow.kind === 'checking' ? (
            <p className={`text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
              Verifying the bridge route and previewing the backing…
            </p>
          ) : null}

          {/* Review — the exact frozen call, shown before anything is sent. */}
          {flow.kind === 'review' ? (
            <div className={`p-3 space-y-2 text-xs ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className={`font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                Step 1 of 2 — JBSucker.prepare on {chainName(fromChainId)}
              </div>
              <div className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                <span>sucker</span>
                <span className="break-all">{flow.sucker}</span>
                <span>projectTokenCount</span>
                <span>
                  {flow.amount.toString()} ({formatTokens(flow.amount)} {symbol})
                </span>
                <span>beneficiary</span>
                <span className="break-all">{activeAddress}</span>
                <span>minTokensReclaimed</span>
                <span>
                  {flow.minReclaimed.toString()} ({formatBalance(flow.minReclaimed, acctDecimals, acctSymbol)})
                </span>
                <span>token</span>
                <span className="break-all">{flow.termToken}</span>
              </div>
              <p className={isDark ? 'text-gray-500' : 'text-gray-500'}>
                {flow.net > 0n
                  ? `The live bridge cash out preview is ${formatBalance(flow.net, acctDecimals, acctSymbol)}; the transaction reverts below the 99% floor above.`
                  : 'This source chain currently contributes zero backing. The same token count still mints remotely, but no backing tokens move with it.'}{' '}
                Step 2 ships the queued batch to {chainName(toChainId)} — the small value on that transaction is the
                bridge&rsquo;s messaging fee (excess refunds), not your tokens.
              </p>
              {flow.infra === 'native' && new Set([1, 11155111]).has(toChainId) ? (
                <p className={isDark ? 'text-amber-400' : 'text-amber-600'}>
                  This native L2→L1 exit waits out the ~7-day challenge period before it turns claimable on{' '}
                  {chainName(toChainId)}.
                </p>
              ) : null}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => submit(flow)}
                  disabled={confirming}
                  className="px-3 py-1 text-xs font-bold bg-amber-500 text-black hover:bg-amber-500/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm move
                </button>
                <button
                  onClick={() => setFlow({ kind: 'idle' })}
                  className={`px-3 py-1 text-xs border transition-colors ${
                    isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-300 text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {flow.kind === 'preparing' || flow.kind === 'sending' ? (
            <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
              <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
              {flow.kind === 'preparing'
                ? `Step 1 of 2 (prepare): ${PHASE_LABELS[flow.phase]}`
                : flow.phase === 'fee'
                  ? 'Step 2 of 2 (send): finding the bridge fee…'
                  : `Step 2 of 2 (send): ${PHASE_LABELS[flow.phase]}`}
            </div>
          ) : null}

          {flow.kind === 'done' ? (
            <p className={`text-sm ${isDark ? 'text-green-400' : 'text-green-600'}`}>
              Bridging to {chainName(toChainId)} — once it delivers, claim it from the Queued movements table under
              Settlement.
            </p>
          ) : null}

          {flow.kind === 'error' ? (
            <p className="text-sm text-red-400" role="alert">
              {flow.message}{' '}
              <button onClick={() => setFlow({ kind: 'idle' })} className="underline decoration-dotted">
                Try again
              </button>
            </p>
          ) : null}
        </div>

        {/* Footer */}
        <div className={`px-5 py-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          {busy ? (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Do not close this window</div>
          ) : flow.kind === 'idle' ? (
            <button
              onClick={review}
              disabled={!!blockReason}
              title={blockReason ?? undefined}
              className={`w-full py-3 font-medium border-2 transition-colors disabled:opacity-50 ${
                isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Review move
            </button>
          ) : (
            <button
              onClick={onClose}
              className={`w-full py-3 font-medium border-2 transition-colors ${
                isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {flow.kind === 'done' ? 'Done' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </DialogShell>
  )
}

export default MoveChainsModal
