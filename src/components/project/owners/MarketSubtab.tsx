/**
 * Market subtab — the project's Uniswap V4 buyback pool. Ports
 * website/src/discover.js renderOwnersAmm (:15125): pool summary, LP ownership
 * donut (:20982), LP provider table (:21063), pool composition bar (:21108)
 * and the liquidity-by-price depth chart (:20882); plus renderSplitHookCard
 * (:15172), the permissionless JBP6FeeLPSplitHook keeper card.
 *
 * The website renders one chain; a project's pool can exist on some of its
 * chains only, so this reads per chain behind a selector — no pool, or a chain
 * without the V4 surface, is a plain state, never an error. The log-scan
 * enumeration in the service caps its own work and reports `complete: false`
 * when it did; that partial-data note is surfaced rather than passed off as a
 * full picture. Reads that fail render "—" instead of a fabricated zero.
 *
 * The website's hand-rolled SVG charts are re-expressed in this codebase's
 * recharts idiom (theme via isDark ternaries, juice-orange/cyan accents,
 * squared corners, ResponsiveContainer).
 */

import { useEffect, useMemo, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { useThemeStore } from '../../../stores'
import { CHAINS } from '../../../constants'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import type { GuardedTxPhase } from '../../../services/projectTx'
import type { Project } from '../../../services/bendystraw'
import { truncateAddress } from '../../../utils/ens'
import { makeProjectIdResolver } from '../../../utils/projectChains'
import { CHART_COLORS, PIE_COLORS } from '../../dynamic/charts/utils'
import { RemoveLiquidityModal } from './RemoveLiquidityModal'
import {
  ammChainAvailable,
  buildSplitHookActionTx,
  lpGetAmountsForLiquidity,
  lpHookErrorText,
  lpSqrtAtTick,
  lpTrimNum,
  projectUsesLpSplitHook,
  readCashOutFloorPrice,
  readLpPositions,
  readMarketRulesetFacts,
  readSplitHookState,
  splitHookAddressFor,
  type LpPositionsSnapshot,
  type SplitHookChainState,
} from '../../../services/ammMarket'

export interface MarketSubtabProps {
  project: Project
  /** The sucker-group chains the project lives on (home chain first). */
  chainIds: number[]
  /** Per-chain project ids (V6 ids differ per chain); reads/txs target the id ON that chain. */
  chainProjects?: Array<{ chainId: number; projectId: number | string }>
}

const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: 'Re-checking the split hook…',
  switching: 'Switching network…',
  approving: 'Approving…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
}

/** Compact token amount, matching the website's owners tables. */
function formatCompact(value: bigint, decimals: number): string {
  const amount = parseFloat(formatUnits(value, decimals))
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`
  if (amount >= 1_000) return `${(amount / 1_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}K`
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function formatBalance(value: bigint, decimals: number, symbol: string): string {
  return `${formatCompact(value, decimals)} ${symbol}`
}

// ---------------------------------------------------------------------------
// Depth bands (website renderLpDepthChart :20882)
// ---------------------------------------------------------------------------

interface DepthBand {
  logMid: number
  mid: number
  pLo: number
  pHi: number
  liq: number
  pairWei: bigint
  tokenWei: bigint
}

const DEPTH_BANDS = 56

/**
 * Bucket the pool's positions into log-spaced price bands: bar height is the
 * liquidity active in the band, and the hover shows what that band actually
 * holds at the current price.
 *
 * Written order-independently (min/max over the mapped ends) rather than
 * assuming the pair is currency0: when the project token sorts first, ticks
 * rise with price instead of falling, and the website's ETH-pool assumption
 * would invert every overlap test.
 */
function buildDepthBands(snapshot: LpPositionsSnapshot, floor: number, ceiling: number): DepthBand[] {
  const { state, positions } = snapshot
  if (!positions.length) return []
  const decFactor = 10 ** (18 - state.pair.decimals)
  const priceAtTick = (tick: number) => (state.pairIsC0 ? 1 / 1.0001 ** tick : 1.0001 ** tick) * decFactor
  const tickAtPrice = (price: number) =>
    Math.log(state.pairIsC0 ? decFactor / price : price / decFactor) / Math.log(1.0001)

  let pMin = Infinity
  let pMax = -Infinity
  for (const position of positions) {
    const a = priceAtTick(position.tickLower)
    const b = priceAtTick(position.tickUpper)
    pMin = Math.min(pMin, a, b)
    pMax = Math.max(pMax, a, b)
  }
  for (const marker of [state.poolPrice, floor, ceiling]) {
    if (marker > 0) {
      pMin = Math.min(pMin, marker)
      pMax = Math.max(pMax, marker)
    }
  }
  if (!(pMax > pMin) || !isFinite(pMin) || !isFinite(pMax) || pMin <= 0) return []

  const lMin = Math.log(pMin)
  const span = Math.log(pMax) - lMin || 1
  const bands: DepthBand[] = []
  for (let i = 0; i < DEPTH_BANDS; i++) {
    const pLo = Math.exp(lMin + (i / DEPTH_BANDS) * span)
    const pHi = Math.exp(lMin + ((i + 1) / DEPTH_BANDS) * span)
    const logMid = lMin + ((i + 0.5) / DEPTH_BANDS) * span
    const mid = Math.exp(logMid)
    const bandTickA = tickAtPrice(pLo)
    const bandTickB = tickAtPrice(pHi)
    const bandLo = Math.min(bandTickA, bandTickB)
    const bandHi = Math.max(bandTickA, bandTickB)
    let liq = 0
    let pairWei = 0n
    let tokenWei = 0n
    for (const position of positions) {
      const edgeA = priceAtTick(position.tickLower)
      const edgeB = priceAtTick(position.tickUpper)
      if (mid >= Math.min(edgeA, edgeB) && mid <= Math.max(edgeA, edgeB)) liq += Number(position.liquidity)
      const overlapLo = Math.max(bandLo, position.tickLower)
      const overlapHi = Math.min(bandHi, position.tickUpper)
      if (overlapLo < overlapHi && state.sqrtP > 0n) {
        const amounts = lpGetAmountsForLiquidity(
          state.sqrtP,
          lpSqrtAtTick(Math.round(overlapLo)),
          lpSqrtAtTick(Math.round(overlapHi)),
          position.liquidity,
        )
        pairWei += state.pairIsC0 ? amounts.amount0 : amounts.amount1
        tokenWei += state.pairIsC0 ? amounts.amount1 : amounts.amount0
      }
    }
    bands.push({ logMid, mid, pLo, pHi, liq, pairWei, tokenWei })
  }
  return bands
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

interface PieDatum {
  name: string
  address: string
  value: number
  share: number
  pairText: string
  tokenText: string
  positions: number
  [key: string]: string | number
}

function LpOwnersPie({ snapshot, symbol, isDark }: { snapshot: LpPositionsSnapshot; symbol: string; isDark: boolean }) {
  const rows = snapshot.owners.filter(owner => owner.valuePair > 0)
  const total = rows.reduce((sum, owner) => sum + owner.valuePair, 0)
  if (!rows.length || !(total > 0)) return null
  const data: PieDatum[] = rows.map(owner => ({
    name: truncateAddress(owner.address),
    address: owner.address,
    value: owner.valuePair,
    share: (owner.valuePair / total) * 100,
    pairText: formatBalance(owner.pairAmount, snapshot.state.pair.decimals, snapshot.state.pair.symbol),
    tokenText: formatBalance(owner.tokenAmount, 18, symbol),
    positions: owner.positions,
  }))

  const PieTooltip = ({ active, payload }: TooltipContentProps<number, string>) => {
    if (!active || !payload?.length) return null
    const item = payload[0].payload as PieDatum
    return (
      <div
        className={`px-3 py-2 border shadow-lg text-xs ${
          isDark ? 'bg-zinc-900 border-zinc-700 text-white' : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        <div className="font-mono mb-1 opacity-70">{item.address}</div>
        <div>
          {item.tokenText} + {item.pairText}
        </div>
        <div className={isDark ? 'text-zinc-400' : 'text-gray-500'}>
          {item.share.toFixed(1)}% of pooled liquidity
          {item.positions > 1 ? ` | ${item.positions} positions` : ''}
        </div>
      </div>
    )
  }

  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="45%"
            outerRadius="80%"
            paddingAngle={1}
            dataKey="value"
            nameKey="name"
            isAnimationActive={false}
          >
            {data.map((row, index) => (
              <Cell key={row.address} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={PieTooltip} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

function LpCompositionBar({ snapshot, symbol, isDark }: { snapshot: LpPositionsSnapshot; symbol: string; isDark: boolean }) {
  const { state, totalPair, totalToken } = snapshot
  const pairValue = parseFloat(formatUnits(totalPair, state.pair.decimals))
  const tokenValue = parseFloat(formatUnits(totalToken, 18)) * state.poolPrice
  const total = pairValue + tokenValue
  if (!(total > 0)) return null
  const pairPercent = (pairValue / total) * 100
  const tokenPercent = (tokenValue / total) * 100
  const data = [{ name: 'composition', pair: pairPercent, token: tokenPercent }]

  const legend = [
    {
      color: CHART_COLORS.secondary,
      text: `${state.pair.symbol} ${formatBalance(totalPair, state.pair.decimals, '')} (${pairPercent.toFixed(1)}%)`,
    },
    { color: CHART_COLORS.primary, text: `${symbol} ${formatCompact(totalToken, 18)} (${tokenPercent.toFixed(1)}%)` },
  ]

  return (
    <div>
      <div className="h-[18px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="name" hide />
            <Bar dataKey="pair" stackId="composition" fill={CHART_COLORS.secondary} isAnimationActive={false} />
            <Bar dataKey="token" stackId="composition" fill={CHART_COLORS.primary} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {legend.map(item => (
          <span key={item.text} className={`inline-flex items-center gap-1.5 text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            <span className="w-2.5 h-2.5 flex-shrink-0" style={{ backgroundColor: item.color }} />
            {item.text}
          </span>
        ))}
      </div>
    </div>
  )
}

function LpDepthChart({
  snapshot,
  bands,
  floor,
  ceiling,
  symbol,
  isDark,
}: {
  snapshot: LpPositionsSnapshot
  bands: DepthBand[]
  floor: number
  ceiling: number
  symbol: string
  isDark: boolean
}) {
  if (!bands.length) return null
  const { state } = snapshot
  const lMin = Math.log(bands[0].pLo)
  const lMax = Math.log(bands[bands.length - 1].pHi)
  const inRange = (price: number) => price > 0 && Math.log(price) >= lMin && Math.log(price) <= lMax
  const markers = [
    { price: floor, label: 'floor', color: isDark ? '#94a3b8' : '#64748b' },
    { price: state.poolPrice, label: 'price', color: CHART_COLORS.primary },
    { price: ceiling, label: 'ceiling', color: CHART_COLORS.secondary },
  ].filter(marker => inRange(marker.price))

  const DepthTooltip = ({ active, payload }: TooltipContentProps<number, string>) => {
    if (!active || !payload?.length) return null
    const band = payload[0].payload as DepthBand
    const hasLiquidity = band.liq > 0 || band.pairWei > 0n || band.tokenWei > 0n
    const side = state.poolPrice > 0 ? (band.mid < state.poolPrice ? ' | buy-side' : ' | sell-side') : ''
    return (
      <div
        className={`px-3 py-2 border shadow-lg text-xs ${
          isDark ? 'bg-zinc-900 border-zinc-700 text-white' : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        <div>
          ≈ {lpTrimNum(band.mid)} {state.pair.symbol}/{symbol}
          {side}
        </div>
        <div className={isDark ? 'text-zinc-400' : 'text-gray-500'}>
          {hasLiquidity
            ? `${formatCompact(band.tokenWei, 18)} ${symbol} + ${formatCompact(band.pairWei, state.pair.decimals)} ${state.pair.symbol}`
            : 'no liquidity here'}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className={`text-xs font-medium uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        Depth
      </div>
      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bands} margin={{ top: 12, right: 4, bottom: 0, left: 4 }}>
            <XAxis
              type="number"
              dataKey="logMid"
              domain={[lMin, lMax]}
              ticks={[lMin, lMax]}
              tickFormatter={value => lpTrimNum(Math.exp(value))}
              tick={{ fontSize: 11, fill: isDark ? CHART_COLORS.axis : CHART_COLORS.axisLight }}
              stroke={isDark ? CHART_COLORS.axis : CHART_COLORS.axisLight}
            />
            <YAxis hide />
            <Tooltip content={DepthTooltip} cursor={{ fill: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }} />
            <Bar dataKey="liq" isAnimationActive={false}>
              {bands.map(band => (
                <Cell
                  key={band.logMid}
                  fill={state.poolPrice > 0 && band.mid < state.poolPrice ? CHART_COLORS.secondary : CHART_COLORS.primary}
                  fillOpacity={0.55}
                />
              ))}
            </Bar>
            {markers.map(marker => (
              <ReferenceLine
                key={marker.label}
                x={Math.log(marker.price)}
                stroke={marker.color}
                strokeDasharray="3 2"
                label={{ value: marker.label, position: 'top', fontSize: 11, fill: marker.color }}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Split-hook keeper card (website renderSplitHookCard :15172)
// ---------------------------------------------------------------------------

type ActionKind = 'deployPool' | 'addLiquidity' | 'collectFees' | 'claimFees'

type ActionStatus =
  | { kind: 'idle' }
  | { kind: 'running'; action: ActionKind; phase: GuardedTxPhase }
  | { kind: 'done'; action: ActionKind }
  | { kind: 'error'; message: string }

interface SplitHookRow {
  chainId: number
  /** The project's id ON this chain (V6 ids differ per chain). */
  projectId: bigint
  /** null = the reads failed on this chain — render a note, never zeros. */
  state: SplitHookChainState | null
  weight: bigint
}

function SplitHookChainBlock({
  project,
  row,
  onRefresh,
}: {
  project: Project
  row: SplitHookRow
  onRefresh: () => void
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()
  const [status, setStatus] = useState<ActionStatus>({ kind: 'idle' })

  const symbol = project.tokenSymbol || 'tokens'
  const chainName = CHAINS[row.chainId]?.name ?? `Chain ${row.chainId}`
  const projectId = row.projectId // this chain's own project id
  const mutedText = isDark ? 'text-gray-500' : 'text-gray-400'

  if (!row.state) {
    return (
      <div className={`border-t pt-2 ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
        <div className={`text-xs font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{chainName}</div>
        <p className={`text-sm ${mutedText}`}>Could not read the split hook on {chainName}.</p>
      </div>
    )
  }
  const state = row.state

  /**
   * Every keeper action is permissionless — anyone may call it — but still runs
   * the full guarded chain. Reverify re-reads the hook's live state right
   * before the send and aborts when the work is already gone: another keeper
   * deployed the pool, swept the accumulated tokens, or claimed the fees while
   * this card sat open. Without it the tx would burn gas on a revert (or, for
   * claimFees, send a no-op).
   */
  const act = async (action: ActionKind, label: string) => {
    if (!activeAddress) {
      setStatus({ kind: 'error', message: 'Connect a wallet first.' })
      return
    }
    try {
      const tx = buildSplitHookActionTx(
        state.hookAddress,
        action === 'deployPool'
          ? { kind: 'deployPool', projectId }
          : action === 'addLiquidity'
            ? { kind: 'addLiquidity', projectId, terminalToken: state.terminalToken }
            : action === 'collectFees'
              ? { kind: 'collectFees', projectId, terminalToken: state.terminalToken }
              : { kind: 'claimFees', projectId, beneficiary: activeAddress as Address },
      )
      await run({
        chainId: row.chainId,
        to: tx.to,
        data: tx.data,
        value: tx.value,
        reverify: async () => {
          const fresh = await readSplitHookState(row.chainId, projectId, row.weight)
          if (!fresh) throw new Error(`Could not re-read the split hook on ${chainName}.`)
          if (action === 'deployPool') {
            if (fresh.hasPool) throw new Error('The pool is already deployed — someone else seeded it. Use Add liquidity instead.')
            if (fresh.accumulated === 0n) throw new Error(`No reserved ${symbol} is accumulated here anymore.`)
          }
          if (action === 'addLiquidity') {
            if (!fresh.hasPool) throw new Error('No pool exists for this token yet — deploy the pool first.')
            if (fresh.accumulated === 0n) throw new Error(`No reserved ${symbol} is accumulated here anymore — someone already added it.`)
          }
          if (action === 'collectFees' && !fresh.hasPool) {
            throw new Error('No pool exists for this token yet — deploy the pool first.')
          }
          if (action === 'claimFees' && fresh.claimableFees === 0n) {
            throw new Error('There are no claimable fee tokens left — someone already claimed them.')
          }
        },
        onPhase: phase => setStatus({ kind: 'running', action, phase }),
      })
      setStatus({ kind: 'done', action })
      onRefresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : `${label} failed.`
      setStatus({ kind: 'error', message: lpHookErrorText(message, symbol) || message })
    }
  }

  const running = status.kind === 'running'
  const buttonClass = `px-3 py-1 text-xs border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
    isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-300 text-gray-800 hover:bg-gray-50'
  }`
  const caveatClass = `text-xs mt-1 ${mutedText}`

  const kv = (key: string, value: string) => (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className={`text-xs ${mutedText}`}>{key}</span>
      <span className={`text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{value}</span>
    </div>
  )

  const actionLabel = (action: ActionKind, label: string) =>
    status.kind === 'done' && status.action === action
      ? 'Confirmed'
      : running && status.action === action
        ? 'Sending…'
        : label

  return (
    <div className={`border-t pt-2 ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
      <div className={`text-xs font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{chainName}</div>
      {kv('Pool', state.hasPool ? 'Deployed' : 'Not deployed yet')}
      {kv(`Accumulated ${symbol}`, formatBalance(state.accumulated, 18, symbol))}
      {state.hasPool && state.tokenId > 0n
        ? kv(
            'LP position',
            `#${state.tokenId.toString()}${
              state.tickLower != null && state.tickUpper != null ? ` (ticks ${state.tickLower} → ${state.tickUpper})` : ''
            }`,
          )
        : null}
      {kv('Claimable LP fees', formatBalance(state.claimableFees, 18, symbol))}

      <div className="mt-2 space-y-2">
        {!state.hasPool ? (
          <div>
            <button onClick={() => act('deployPool', 'Deploy pool')} disabled={running} className={buttonClass}>
              {actionLabel('deployPool', 'Deploy pool')}
            </button>
            <p className={caveatClass}>
              {state.deployGated
                ? `Deploying the pool currently requires the project ${
                    project.isRevnet ? 'operator' : 'owner'
                  } (or SET_BUYBACK_POOL permission). It becomes permissionless for anyone once the issuance rate decays to 10% of what it was when tokens started accumulating.`
                : `Anyone can call this. It cashes out part of the accumulated ${symbol} for the terminal token and mints a two-sided position — the hook picks the amounts and accepts any cash out return.`}
            </p>
          </div>
        ) : (
          <>
            {state.accumulated > 0n ? (
              <div>
                <button onClick={() => act('addLiquidity', 'Add liquidity')} disabled={running} className={buttonClass}>
                  {actionLabel('addLiquidity', 'Add liquidity')}
                </button>
                <p className={caveatClass}>
                  Anyone can call this. It adds the accumulated {symbol} to the hook&rsquo;s existing position — it reverts
                  if the pool price is off its oracle average right now.
                </p>
              </div>
            ) : null}
            <div>
              <button onClick={() => act('collectFees', 'Collect fees')} disabled={running} className={buttonClass}>
                {actionLabel('collectFees', 'Collect fees')}
              </button>
              <p className={caveatClass}>
                Anyone can call this. It collects the position&rsquo;s trading fees and routes them into the project&rsquo;s
                terminal balance — the caller gets nothing.
              </p>
            </div>
          </>
        )}
        {state.claimableFees > 0n ? (
          <div>
            <button onClick={() => act('claimFees', 'Claim fees')} disabled={running} className={buttonClass}>
              {actionLabel('claimFees', 'Claim fees')}
            </button>
            <p className={caveatClass}>
              Anyone can call this. It sends the already-routed fee tokens to your connected wallet as the beneficiary.
            </p>
          </div>
        ) : null}
      </div>

      {status.kind === 'running' ? (
        <p className={`text-xs mt-2 ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>{PHASE_LABELS[status.phase]}</p>
      ) : null}
      {status.kind === 'done' ? (
        <p className={`text-xs mt-2 ${isDark ? 'text-green-400' : 'text-green-600'}`}>Confirmed on {chainName}.</p>
      ) : null}
      {status.kind === 'error' ? (
        <p className="text-xs mt-2 text-red-400" role="alert">
          {status.message}
        </p>
      ) : null}
    </div>
  )
}

function SplitHookCard({ project, chainIds, chainProjects }: MarketSubtabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [rows, setRows] = useState<SplitHookRow[] | null>(null)
  const [nonce, setNonce] = useState(0)

  const symbol = project.tokenSymbol || 'tokens'
  const pidFor = useMemo(
    () => makeProjectIdResolver(chainProjects, { chainId: project.chainId, projectId: project.projectId }),
    [chainProjects, project.chainId, project.projectId],
  )
  const chainKey = chainIds.join(',')

  useEffect(() => {
    let cancelled = false
    const chains = chainKey ? chainKey.split(',').map(Number) : []
    Promise.all(
      chains
        .filter(chainId => splitHookAddressFor(chainId))
        .map(async (chainId): Promise<SplitHookRow | null> => {
          // Each chain reads with ITS OWN project id; a chain with no id is skipped.
          const projectId = pidFor(chainId)
          if (projectId == null) return null
          // Only chains whose CURRENT reserved splits actually route here.
          if (!(await projectUsesLpSplitHook(chainId, projectId))) return null
          const facts = await readMarketRulesetFacts(chainId, projectId)
          const weight = facts?.weight ?? 0n
          const state = await readSplitHookState(chainId, projectId, weight).catch(() => null)
          return { chainId, projectId, state, weight }
        }),
    )
      .then(loaded => {
        if (!cancelled) setRows(loaded.filter((row): row is SplitHookRow => row !== null))
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [pidFor, chainKey, nonce])

  if (!rows?.length) return null

  return (
    <div className={`border p-4 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`}>
      <div className={`text-xs font-medium uppercase tracking-wide mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        Split hook
      </div>
      <div className="mb-3">
        <ExplainerMessage>
          Reserved {symbol} routed to this hook accumulates until the pool is seeded: Deploy pool cashes out part of the
          accumulated {symbol} for the terminal token and mints a two-sided Uniswap V4 position. Once the pool exists the
          other actions are permissionless — Collect fees routes the position&rsquo;s trading fees into the project&rsquo;s
          terminal balance.
        </ExplainerMessage>
      </div>
      <div className="space-y-2">
        {rows.map(row => (
          <SplitHookChainBlock key={row.chainId} project={project} row={row} onRefresh={() => setNonce(n => n + 1)} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Market subtab
// ---------------------------------------------------------------------------

type ChainLoad =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'none' }
  | { kind: 'ready'; snapshot: LpPositionsSnapshot; floor: number; ceiling: number }

export function MarketSubtab({ project, chainIds, chainProjects }: MarketSubtabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const lpChains = useMemo(() => chainIds.filter(ammChainAvailable), [chainIds])
  const [chainId, setChainId] = useState<number>(lpChains[0] ?? chainIds[0] ?? 0)
  const [loads, setLoads] = useState<Record<number, ChainLoad>>({})
  const [removeOpen, setRemoveOpen] = useState(false)

  const symbol = project.tokenSymbol || 'token'
  const pidFor = useMemo(
    () => makeProjectIdResolver(chainProjects, { chainId: project.chainId, projectId: project.projectId }),
    [chainProjects, project.chainId, project.projectId],
  )
  const load = loads[chainId]

  // Read the selected chain once and keep it — switching back is free.
  useEffect(() => {
    if (!chainId || !ammChainAvailable(chainId) || loads[chainId]) return
    // This chain's own project id (V6 ids differ per chain); no id → no pool here.
    const projectId = pidFor(chainId)
    if (projectId == null) {
      setLoads(previous => ({ ...previous, [chainId]: { kind: 'none' } }))
      return
    }
    let cancelled = false
    setLoads(previous => ({ ...previous, [chainId]: { kind: 'loading' } }))
    ;(async () => {
      const snapshot = await readLpPositions(chainId, projectId)
      if (cancelled) return
      if (!snapshot) {
        setLoads(previous => ({ ...previous, [chainId]: { kind: 'none' } }))
        return
      }
      const [floor, facts] = await Promise.all([
        readCashOutFloorPrice(chainId, projectId, snapshot.state.pair),
        readMarketRulesetFacts(chainId, projectId),
      ])
      if (cancelled) return
      setLoads(previous => ({
        ...previous,
        [chainId]: { kind: 'ready', snapshot, floor: floor ?? 0, ceiling: facts?.ceiling ?? 0 },
      }))
    })().catch(() => {
      if (!cancelled) setLoads(previous => ({ ...previous, [chainId]: { kind: 'error' } }))
    })
    return () => {
      cancelled = true
    }
  }, [chainId, pidFor, loads])

  const ready = load?.kind === 'ready' ? load : null
  const bands = useMemo(
    () => (ready ? buildDepthBands(ready.snapshot, ready.floor, ready.ceiling) : []),
    [ready],
  )

  const cardClass = `border p-4 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`
  const cardTitleClass = `text-xs font-medium uppercase tracking-wide mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`
  const mutedText = isDark ? 'text-gray-500' : 'text-gray-400'
  const bodyText = isDark ? 'text-gray-400' : 'text-gray-600'

  const ownerTotal = ready ? ready.snapshot.owners.reduce((sum, owner) => sum + owner.valuePair, 0) : 0

  return (
    <div className="space-y-4">
      <div className={cardClass}>
        <div className={cardTitleClass}>Market</div>
        <div className="mb-3">
          <ExplainerMessage>
            This project&rsquo;s token trades on a Uniswap pool. The market is used to fill orders that give payers more{' '}
            {symbol} than issuance would — anyone can pool liquidity into it, and the liquidity below is what backs those
            fills.
          </ExplainerMessage>
        </div>

        {!lpChains.length ? (
          <p className={`text-sm ${bodyText}`}>No Uniswap V4 pool contracts on this project&rsquo;s chains.</p>
        ) : (
          <div className="space-y-3">
            {lpChains.length > 1 ? (
              <div className="flex flex-wrap gap-1">
                {lpChains.map(id => (
                  <button
                    key={id}
                    onClick={() => setChainId(id)}
                    className={`px-2.5 py-1 text-xs border transition-colors ${
                      id === chainId
                        ? isDark
                          ? 'border-juice-cyan text-white'
                          : 'border-cyan-700 text-gray-900'
                        : isDark
                          ? 'border-white/15 text-gray-400 hover:text-gray-200'
                          : 'border-gray-200 text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    {CHAINS[id]?.shortName ?? `Chain ${id}`}
                  </button>
                ))}
              </div>
            ) : null}

            {!load || load.kind === 'loading' ? (
              <p className={`text-sm ${mutedText}`}>Reading the buyback pool…</p>
            ) : load.kind === 'error' ? (
              <p className="text-sm text-red-400" role="alert">
                Could not read the buyback pool on {CHAINS[chainId]?.name ?? `chain ${chainId}`}.
              </p>
            ) : load.kind === 'none' ? (
              <p className={`text-sm ${bodyText}`}>
                No pool on {CHAINS[chainId]?.name ?? `chain ${chainId}`} — this project&rsquo;s token isn&rsquo;t traded
                here yet.
              </p>
            ) : (
              <>
                <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                  Pool price: ~{lpTrimNum(load.snapshot.state.poolPrice)} {load.snapshot.state.pair.symbol} / {symbol}
                  {load.floor > 0 ? <span className={`ml-2 text-xs ${mutedText}`}>floor {lpTrimNum(load.floor)}</span> : null}
                  {load.ceiling > 0 ? (
                    <span className={`ml-2 text-xs ${mutedText}`}>ceiling {lpTrimNum(load.ceiling)}</span>
                  ) : null}
                </div>

                {/* The log scan caps its own work; say so rather than passing a
                    partial list off as the whole pool. */}
                {!load.snapshot.complete ? (
                  <p className={`text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                    Partial data: the position history scan was capped or a block range failed, so some positions may be
                    missing from the totals below.
                  </p>
                ) : null}

                {!load.snapshot.owners.length ? (
                  <p className={`text-sm ${bodyText}`}>
                    The pool is seeded but has no LP positions yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-4 min-w-0">
                      <LpOwnersPie snapshot={load.snapshot} symbol={symbol} isDark={isDark} />
                      <div>
                        <div className={cardTitleClass}>Composition</div>
                        <LpCompositionBar snapshot={load.snapshot} symbol={symbol} isDark={isDark} />
                      </div>
                      <LpDepthChart
                        snapshot={load.snapshot}
                        bands={bands}
                        floor={load.floor}
                        ceiling={load.ceiling}
                        symbol={symbol}
                        isDark={isDark}
                      />
                    </div>

                    <div className="overflow-x-auto min-w-0">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className={`text-xs uppercase tracking-wide ${mutedText}`}>
                            <th className="py-1.5 pr-3 font-medium text-left">Account</th>
                            <th className="py-1.5 pr-3 font-medium text-right">{load.snapshot.state.pair.symbol}</th>
                            <th className="py-1.5 pr-3 font-medium text-right">{symbol}</th>
                            <th className="py-1.5 font-medium text-right">Share</th>
                          </tr>
                        </thead>
                        <tbody className={isDark ? 'text-gray-200' : 'text-gray-800'}>
                          {load.snapshot.owners.map((owner, index) => (
                            <tr key={owner.address}>
                              <td className="py-1.5 pr-3">
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    className="w-2.5 h-2.5 flex-shrink-0"
                                    style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                                  />
                                  <span className="font-mono text-xs" title={owner.address}>
                                    {truncateAddress(owner.address)}
                                  </span>
                                </span>
                                {owner.positions > 1 ? (
                                  <div className={`text-[10px] ${mutedText}`}>{owner.positions} positions</div>
                                ) : null}
                              </td>
                              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                                {formatCompact(owner.pairAmount, load.snapshot.state.pair.decimals)}
                              </td>
                              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                                {formatCompact(owner.tokenAmount, 18)}
                              </td>
                              <td className="py-1.5 text-right whitespace-nowrap">
                                <strong>{ownerTotal > 0 ? `${((owner.valuePair / ownerTotal) * 100).toFixed(1)}%` : '—'}</strong>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="pt-1">
              <button
                onClick={() => setRemoveOpen(true)}
                title="Burn one of your LP positions back to its two tokens"
                className={`text-sm underline decoration-dotted underline-offset-2 transition-colors ${
                  isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'
                }`}
              >
                Remove liquidity
              </button>
              <p className={`text-xs mt-1 ${mutedText}`}>
                Only your own positions can be removed — the whole position is burned back to your wallet.
              </p>
            </div>
          </div>
        )}
      </div>

      <SplitHookCard project={project} chainIds={chainIds} chainProjects={chainProjects} />

      <RemoveLiquidityModal
        isOpen={removeOpen}
        onClose={() => setRemoveOpen(false)}
        project={project}
        chainIds={chainIds}
        chainProjects={chainProjects}
      />
    </div>
  )
}

export default MarketSubtab
