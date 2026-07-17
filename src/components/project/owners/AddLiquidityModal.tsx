/**
 * Add market liquidity — seed the buyback pool with a Uniswap V4 position.
 * Ports website/src/discover.js buildAddLiquidityModal (:21479) +
 * prepareAddLiquidity (:21137): price-range corridor defaulting to the cash
 * out floor → issuance ceiling, single-sided support with an
 * order-independent counterpart calc, and MINT_POSITION/CLOSE_CURRENCY
 * encoding.
 *
 * Transactions run through the shared guarded runner. ERC-20 sides use
 * ON-CHAIN Permit2 allowances (ERC-20 → Permit2 approval pre-step, then
 * Permit2.approve(token, PositionManager, …) as a plain tx) instead of the
 * website's gasless signTypedData permit: managed wallets cannot sign typed
 * data, and the PositionManager only pulls ERC-20s through Permit2 — a
 * direct approve to it would never be spent. The mint reverifies the pool
 * price at submit and aborts when it moved beyond the reviewed corridor.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { erc20Abi, formatUnits, parseUnits } from 'viem'
import { useThemeStore } from '../../../stores'
import { CHAINS } from '../../../constants'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { publicClientFor, type GuardedTxPhase } from '../../../services/projectTx'
import type { Project } from '../../../services/bendystraw'
import { makeProjectIdResolver } from '../../../utils/projectChains'
import {
  ammChainAvailable,
  buildModifyLiquiditiesTx,
  buildPermit2ApproveTx,
  deriveAddLiquidityPlan,
  lpCounterpart,
  lpDefaultRange,
  lpTrimNum,
  PERMIT2_ADDRESS,
  permit2AllowanceCovers,
  readCashOutFloorPrice,
  readMarketRulesetFacts,
  readPoolState,
  reverifyAddLiquidity,
  type AddLiquidityPlan,
  type PoolState,
} from '../../../services/ammMarket'

export interface AddLiquidityModalProps {
  isOpen: boolean
  onClose: () => void
  project: Project
  /** The sucker-group chains the project lives on (home chain first). */
  chainIds: number[]
  /** Per-chain project ids (V6 ids differ per chain); reads/txs target the id ON that chain. */
  chainProjects?: Array<{ chainId: number; projectId: number | string }>
}

interface MarketContext {
  pool: PoolState
  floor: number
  ceiling: number
  /** Wallet balances: the pair token and the project ERC-20 (raw). */
  pairBalance: bigint | null
  tokenBalance: bigint | null
}

type Status =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'review'; plan: AddLiquidityPlan; snapshot: string }
  | { kind: 'running'; step: string; phase: GuardedTxPhase }
  | { kind: 'done'; txHash: `0x${string}`; chainId: number }
  | { kind: 'error'; message: string }

const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: 'Re-checking the pool price…',
  switching: 'Switching network…',
  approving: 'Approving…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
}

function formatPairAmount(value: bigint, decimals: number, symbol: string): string {
  const amount = parseFloat(formatUnits(value, decimals))
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${symbol}`
}

export function AddLiquidityModal({ isOpen, onClose, project, chainIds, chainProjects }: AddLiquidityModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const lpChains = useMemo(() => chainIds.filter(ammChainAvailable), [chainIds])
  const [chainId, setChainId] = useState<number>(lpChains[0] ?? 0)
  const [context, setContext] = useState<MarketContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [tokenAmount, setTokenAmount] = useState('')
  const [pairAmount, setPairAmount] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [reloadNonce, setReloadNonce] = useState(0)

  const symbol = project.tokenSymbol || 'tokens'
  const pidFor = useMemo(
    () => makeProjectIdResolver(chainProjects, { chainId: project.chainId, projectId: project.projectId }),
    [chainProjects, project.chainId, project.projectId],
  )
  // The selected chain's own project id (V6 ids differ per chain); null = not this project on that chain.
  const projectId = pidFor(chainId)

  useEffect(() => {
    if (isOpen) {
      setStatus({ kind: 'idle' })
      if (!lpChains.includes(chainId)) setChainId(lpChains[0] ?? 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Load pool state + floor/ceiling + wallet balances for the selected chain.
  useEffect(() => {
    if (!isOpen || !chainId || projectId == null) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setContext(null)
    ;(async () => {
      const pool = await readPoolState(chainId, projectId)
      if (!pool) throw new Error('Pool not initialized on this chain.')
      const client = publicClientFor(chainId)
      const [floor, facts, pairBalance, tokenBalance] = await Promise.all([
        readCashOutFloorPrice(chainId, projectId, pool.pair),
        readMarketRulesetFacts(chainId, projectId),
        activeAddress
          ? pool.pair.isNative
            ? client.getBalance({ address: activeAddress }).catch(() => null)
            : client
                .readContract({ address: pool.pair.addr, abi: erc20Abi, functionName: 'balanceOf', args: [activeAddress] })
                .catch(() => null)
          : Promise.resolve(null),
        activeAddress
          ? client
              .readContract({ address: pool.projectToken, abi: erc20Abi, functionName: 'balanceOf', args: [activeAddress] })
              .catch(() => null)
          : Promise.resolve(null),
      ])
      if (cancelled) return
      const loaded: MarketContext = {
        pool,
        floor: floor ?? 0,
        ceiling: facts?.ceiling ?? 0,
        pairBalance,
        tokenBalance,
      }
      setContext(loaded)
      const defaults = lpDefaultRange(pool.poolPrice, loaded.floor, loaded.ceiling)
      if (defaults.min > 0) setMinPrice(lpTrimNum(defaults.min))
      if (defaults.max > 0) setMaxPrice(lpTrimNum(defaults.max))
    })()
      .catch(error => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not read the pool.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, chainId, projectId, activeAddress, reloadNonce])

  const range = useMemo(() => {
    const pa = parseFloat(minPrice)
    const pb = parseFloat(maxPrice)
    return { pa: pa > 0 ? pa : 0, pb: pb > 0 ? pb : 0 }
  }, [minPrice, maxPrice])

  // Which side(s) the position needs at the current price + range (website
  // activeSides :21474). At/above the range top the position is single-sided
  // PAIR; at/below the bottom, single-sided project token; strictly inside,
  // both. Order-independent — lpCounterpart hits the same boundaries.
  const sides = useMemo(() => {
    const p = context?.pool.poolPrice ?? 0
    if (!(p > 0) || !(range.pa > 0) || !(range.pb > range.pa)) return { token: true, pair: true }
    if (p >= range.pb) return { token: false, pair: true }
    if (p <= range.pa) return { token: true, pair: false }
    return { token: true, pair: true }
  }, [context, range])

  const pairSymbol = context?.pool.pair.symbol ?? 'ETH'
  const pairDecimals = context?.pool.pair.decimals ?? 18

  const autofill = useCallback(
    (driver: 'token' | 'pair', value: string) => {
      if (driver === 'token') setTokenAmount(value)
      else setPairAmount(value)
      const p = context?.pool.poolPrice ?? 0
      if (!sides.token || !sides.pair) return // single-sided: no counterpart to fill
      const amount = parseFloat(value)
      if (!(amount > 0)) {
        if (driver === 'token') setPairAmount('')
        else setTokenAmount('')
        return
      }
      const other = lpCounterpart(amount, driver === 'pair', p, range.pa, range.pb)
      if (other == null) return
      if (driver === 'pair') setTokenAmount(lpTrimNum(other))
      else setPairAmount(lpTrimNum(other))
    },
    [context, sides, range],
  )

  // Zero out a side the position can't use so typing can't strand a value there.
  useEffect(() => {
    if (!sides.token && tokenAmount !== '0') setTokenAmount('0')
    if (!sides.pair && pairAmount !== '0') setPairAmount('0')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sides.token, sides.pair])

  const inputSnapshot = [chainId, minPrice, maxPrice, tokenAmount, pairAmount].join('|')

  const prepare = async () => {
    if (!activeAddress) {
      setStatus({ kind: 'error', message: 'Connect a wallet first.' })
      return
    }
    if (!context) return
    let tokenRaw: bigint
    let pairRaw: bigint
    try {
      tokenRaw = tokenAmount ? parseUnits(tokenAmount, 18) : 0n
    } catch {
      setStatus({ kind: 'error', message: `Invalid ${symbol} amount.` })
      return
    }
    try {
      pairRaw = pairAmount ? parseUnits(pairAmount, pairDecimals) : 0n
    } catch {
      setStatus({ kind: 'error', message: `Invalid ${pairSymbol} amount.` })
      return
    }
    if (tokenRaw <= 0n && pairRaw <= 0n) {
      setStatus({ kind: 'error', message: 'Enter an amount.' })
      return
    }
    if (context.tokenBalance == null || context.pairBalance == null) {
      setStatus({ kind: 'error', message: 'Wallet balances are still loading or could not be verified.' })
      return
    }
    if (tokenRaw > context.tokenBalance) {
      setStatus({ kind: 'error', message: `${symbol} amount exceeds your balance.` })
      return
    }
    if (pairRaw > context.pairBalance) {
      setStatus({ kind: 'error', message: `${pairSymbol} amount exceeds your balance.` })
      return
    }
    if (!(range.pa > 0) || !(range.pb > range.pa)) {
      setStatus({ kind: 'error', message: 'Set a valid price range.' })
      return
    }
    if (projectId == null) {
      setStatus({ kind: 'error', message: 'This project is not on the selected chain.' })
      return
    }
    setStatus({ kind: 'preparing' })
    try {
      // Re-read the live pool right before deriving, so the reviewed plan is fresh.
      const pool = await readPoolState(chainId, projectId)
      if (!pool) throw new Error('Pool not initialized on this chain.')
      const plan = deriveAddLiquidityPlan({
        key: pool.key,
        sqrtP: pool.sqrtP,
        pair: pool.pair,
        pairAmount: pairRaw,
        tokenAmount: tokenRaw,
        pa: range.pa,
        pb: range.pb,
        recipient: activeAddress,
      })
      setStatus({ kind: 'review', plan, snapshot: inputSnapshot })
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Could not prepare.' })
    }
  }

  const execute = async (plan: AddLiquidityPlan) => {
    if (!activeAddress) return
    try {
      // 1. Each ERC-20 side (the project token always; the pair too when it's
      //    USDC) needs Permit2 coverage: ERC-20→Permit2 allowance (guarded
      //    approval pre-step), then Permit2.approve(token, PositionManager).
      for (const side of plan.erc20Sides) {
        const covered = await permit2AllowanceCovers(chainId, activeAddress, side.currency, side.max)
        if (covered) continue
        const permitTx = buildPermit2ApproveTx(chainId, side.currency, side.max)
        await run({
          chainId,
          to: permitTx.to,
          data: permitTx.data,
          approval: { token: side.currency, spender: PERMIT2_ADDRESS, amount: side.max },
          onPhase: phase => setStatus({ kind: 'running', step: 'Token approval (Permit2)', phase }),
        })
      }
      // 2. The mint. Reverify re-reads slot0 and aborts when the price moved
      //    beyond the reviewed 1% corridor.
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)
      const mintTx = buildModifyLiquiditiesTx(chainId, plan, deadline)
      const txHash = await run({
        chainId,
        to: mintTx.to,
        data: mintTx.data,
        value: mintTx.value,
        reverify: () => reverifyAddLiquidity(chainId, plan),
        onPhase: phase => setStatus({ kind: 'running', step: 'Add liquidity', phase }),
      })
      setStatus({ kind: 'done', txHash, chainId })
      setReloadNonce(nonce => nonce + 1)
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Add liquidity failed.' })
    }
  }

  if (!isOpen) return null

  const running = status.kind === 'running' || status.kind === 'preparing'
  const chain = CHAINS[chainId]
  const inputClass = `w-full px-3 py-2 text-sm border bg-transparent ${
    isDark ? 'border-white/20 text-white placeholder-gray-600' : 'border-gray-300 text-gray-900 placeholder-gray-400'
  }`
  const labelClass = `block text-xs font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`
  const mutedClass = `text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`
  const maxButton = (onClick: () => void, disabled: boolean) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-xs underline decoration-dotted underline-offset-2 disabled:opacity-40 ${
        isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'
      }`}
    >
      Max
    </button>
  )

  const reviewPlan = status.kind === 'review' && status.snapshot === inputSnapshot ? status.plan : null
  const planPairMax = reviewPlan ? (reviewPlan.pairIsC0 ? reviewPlan.amount0Max : reviewPlan.amount1Max) : 0n
  const planTokenMax = reviewPlan ? (reviewPlan.pairIsC0 ? reviewPlan.amount1Max : reviewPlan.amount0Max) : 0n

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={running ? undefined : onClose} />
      <div
        className={`relative w-full max-w-lg max-h-[90vh] overflow-y-auto border ${
          isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
        }`}
      >
        <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Add market liquidity</h2>
          {!running ? (
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

        <div className="p-5 space-y-4">
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Seed the buyback pool so payers can route through the AMM. Liquidity is added at the current pool price.
          </p>

          {!lpChains.length ? (
            <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              No Uniswap V4 position manager on this project&rsquo;s chains.
            </p>
          ) : (
            <>
              {lpChains.length > 1 ? (
                <div>
                  <label className={labelClass}>Chain</label>
                  <select
                    value={chainId}
                    onChange={event => {
                      setChainId(Number(event.target.value))
                      setStatus({ kind: 'idle' })
                    }}
                    disabled={running}
                    className={`select-caret pl-3 pr-6 py-2 text-sm border bg-transparent ${
                      isDark ? 'border-white/20 text-white' : 'border-gray-300 text-gray-900'
                    }`}
                  >
                    {lpChains.map(id => (
                      <option key={id} value={id}>
                        {CHAINS[id]?.name ?? `Chain ${id}`}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {loading ? (
                <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Reading the pool…</p>
              ) : loadError ? (
                <p className="text-sm text-red-400" role="alert">
                  {loadError}
                </p>
              ) : context ? (
                <>
                  <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    Pool price: ~{lpTrimNum(context.pool.poolPrice)} {pairSymbol} / {symbol}
                    {context.floor > 0 ? (
                      <span className={`ml-2 ${mutedClass}`}>floor {lpTrimNum(context.floor)}</span>
                    ) : null}
                    {context.ceiling > 0 ? (
                      <span className={`ml-2 ${mutedClass}`}>ceiling {lpTrimNum(context.ceiling)}</span>
                    ) : null}
                  </div>
                  {activeAddress ? (
                    <div className={mutedClass}>
                      Your {pairSymbol}:{' '}
                      {context.pairBalance != null ? formatPairAmount(context.pairBalance, pairDecimals, pairSymbol) : '—'}
                      {' | '}Your {symbol}:{' '}
                      {context.tokenBalance != null ? formatPairAmount(context.tokenBalance, 18, symbol) : '—'}
                    </div>
                  ) : null}

                  <div>
                    <label className={labelClass}>
                      Price range ({pairSymbol} per {symbol})
                    </label>
                    <p className={`${mutedClass} mb-2`}>Defaults span the current cash out floor to the issuance ceiling.</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        placeholder="Min"
                        value={minPrice}
                        disabled={running}
                        onChange={event => setMinPrice(event.target.value)}
                        className={inputClass}
                      />
                      <span className={mutedClass}>to</span>
                      <input
                        type="number"
                        placeholder="Max"
                        value={maxPrice}
                        disabled={running}
                        onChange={event => setMaxPrice(event.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className={sides.token ? '' : 'opacity-45'}>
                      <div className="flex items-center justify-between">
                        <label className={labelClass}>{symbol} to add</label>
                        {sides.token
                          ? maxButton(() => {
                              if (context.tokenBalance == null) return
                              autofill('token', formatUnits(context.tokenBalance, 18))
                            }, running || context.tokenBalance == null)
                          : null}
                      </div>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={tokenAmount}
                        disabled={running || !sides.token}
                        onChange={event => autofill('token', event.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div className={sides.pair ? '' : 'opacity-45'}>
                      <div className="flex items-center justify-between">
                        <label className={labelClass}>{pairSymbol} to add</label>
                        {sides.pair
                          ? maxButton(() => {
                              if (context.pairBalance == null) return
                              // Keep ~0.001 ETH for gas only when the pair IS native;
                              // an ERC-20 pair (USDC) can go to the brim.
                              const buffer = context.pool.pair.isNative ? 1_000_000_000_000_000n : 0n
                              const spendable = context.pairBalance > buffer ? context.pairBalance - buffer : 0n
                              autofill('pair', formatUnits(spendable, pairDecimals))
                            }, running || context.pairBalance == null)
                          : null}
                      </div>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={pairAmount}
                        disabled={running || !sides.pair}
                        onChange={event => autofill('pair', event.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  {sides.token && sides.pair ? (
                    <p className={mutedClass}>
                      Enter either amount; the other is calculated at the pool price. Near Min uses more {symbol}; near
                      Max uses more {pairSymbol}.
                    </p>
                  ) : (
                    <p className={`text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                      {sides.pair
                        ? `At the current price (top of your range) the position is single-sided ${pairSymbol} — add ${pairSymbol} only. To seed ${symbol}, the pool price has to be lower within your range.`
                        : `At the current price (bottom of your range) the position is single-sided ${symbol} — add ${symbol} only. To seed ${pairSymbol}, the pool price has to be higher within your range.`}
                    </p>
                  )}

                  {/* Decoded review — the exact position, shown before anything is sent. */}
                  {reviewPlan ? (
                    <div className={`p-3 space-y-2 text-xs ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                      <div className={`font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                        Uniswap V4 PositionManager.modifyLiquidities on {chain?.name ?? `chain ${chainId}`}
                      </div>
                      <div className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                        <span>actions</span>
                        <span>
                          {reviewPlan.pair.isNative
                            ? 'MINT_POSITION, CLOSE, CLOSE, SWEEP (0x02121214)'
                            : 'MINT_POSITION, CLOSE, CLOSE (0x021212)'}
                        </span>
                        <span>ticks</span>
                        <span>
                          {reviewPlan.tickLower} → {reviewPlan.tickUpper}
                        </span>
                        <span>liquidity</span>
                        <span className="break-all">{reviewPlan.liquidity.toString()}</span>
                        <span>max {pairSymbol}</span>
                        <span>{formatPairAmount(planPairMax, pairDecimals, pairSymbol)}</span>
                        <span>max {symbol}</span>
                        <span>{formatPairAmount(planTokenMax, 18, symbol)}</span>
                        {reviewPlan.erc20Sides.length ? (
                          <>
                            <span>approvals</span>
                            <span>{reviewPlan.erc20Sides.length} via Permit2 → PositionManager</span>
                          </>
                        ) : null}
                        <span>recipient</span>
                        <span className="break-all">{reviewPlan.recipient}</span>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => execute(reviewPlan)}
                          className="px-3 py-1 text-xs font-bold bg-amber-500 text-black hover:bg-amber-500/90 transition-colors"
                        >
                          Confirm & add liquidity
                        </button>
                        <button
                          onClick={() => setStatus({ kind: 'idle' })}
                          className={`px-3 py-1 text-xs border transition-colors ${
                            isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-300 text-gray-800 hover:bg-gray-50'
                          }`}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {status.kind === 'running' ? (
                    <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                      <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                      {status.step}: {PHASE_LABELS[status.phase]}
                    </div>
                  ) : null}
                  {status.kind === 'preparing' ? (
                    <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Preparing…</div>
                  ) : null}
                  {status.kind === 'done' ? (
                    <div className={`text-sm ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                      Liquidity added.{' '}
                      {CHAINS[status.chainId] ? (
                        <a
                          href={`${CHAINS[status.chainId].explorerTx}${status.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-juice-cyan hover:underline"
                        >
                          View on explorer →
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                  {status.kind === 'error' ? (
                    <div className="text-sm text-red-400" role="alert">
                      {status.message}
                    </div>
                  ) : null}

                  {status.kind !== 'review' && status.kind !== 'running' && status.kind !== 'preparing' ? (
                    <button
                      onClick={prepare}
                      disabled={!activeAddress}
                      className={`w-full py-3 font-medium border-2 transition-colors disabled:opacity-40 ${
                        isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {activeAddress ? 'Review add liquidity' : 'Connect a wallet to add liquidity'}
                    </button>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
