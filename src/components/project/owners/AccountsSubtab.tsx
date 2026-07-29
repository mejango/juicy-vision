/**
 * Accounts subtab — the "You" card (the connected wallet's per-chain position
 * + wallet actions) over the "All" card (ownership donut + holders list).
 * Ports website/src/discover.js renderYouCard (:17295) + renderOwnersAll (:15083).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatUnits, type Address } from 'viem'
import { useThemeStore } from '../../../stores'
import { CHAINS } from '../../../constants'
import ChainLogo from '../../ui/ChainLogo'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { HoldersChart } from '../../dynamic/charts'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { truncateAddress } from '../../../utils/ens'
import {
  fetchHoldersDistribution,
  type HolderRow,
  type Project,
} from '../../../services/bendystraw'
import { isAmmAddress, POSITION_MANAGER_BY_CHAIN, readUserLpPositions } from '../../../services/ammMarket'
import {
  LOAN_LIQUIDATION_SECONDS,
  describeLoanToken,
  fetchProjectLoans,
  type IndexedLoan,
} from '../../../services/revLoans'
import {
  isCashOutLocked,
  loadYouPosition,
  monetaryTotalIfComplete,
  totalIfComplete,
  type YouAccountingToken,
  type YouPositionRow,
} from '../../../services/youPosition'
import { ClaimCreditsModal, type ClaimCreditsRow } from './ClaimCreditsModal'
import { OpenLoanModal } from './OpenLoanModal'
import MoveChainsModal from './MoveChainsModal'
import { AddLiquidityModal } from './AddLiquidityModal'
import { RemoveLiquidityModal } from './RemoveLiquidityModal'

export interface AccountsSubtabProps {
  project: Project
  chainIds: number[]
  /** Per-chain project ids (V6 ids differ per chain) — threaded to the loan modal. */
  chainProjects?: Array<{ chainId: number; projectId: number | string }>
  isRevnet: boolean
  hasErc20: boolean
  /** Opens the existing CashOutForm modal. */
  onCashOut: () => void
  onOpenLoan?: () => void
  /** Loans run through REVLoans — revnet-only; the dashboard decides. */
  loanAvailable?: boolean
  onMoveChains?: () => void
  moveChainsAvailable?: boolean
  onAddLiquidity?: () => void
  addLiquidityAvailable?: boolean
  onConnectWallet?: () => void
}

/** Compact 18-decimal project-token count, e.g. "12,345.67". */
function formatTokenCount(value: bigint): string {
  const [whole, fraction = ''] = formatUnits(value, 18).split('.')
  const visibleFraction = fraction.slice(0, whole === '0' ? 6 : 2).replace(/0+$/, '')
  const formattedWhole = BigInt(whole).toLocaleString('en-US')
  return visibleFraction ? `${formattedWhole}.${visibleFraction}` : formattedWhole
}

/** Accounting-token amount with its unit, e.g. "1.234 ETH" / "56.78 USDC". */
function formatAccountingAmount(value: bigint, token: YouAccountingToken | null): string {
  const decimals = token?.decimals ?? 18
  const symbol = token?.symbol ?? 'ETH'
  const amount = parseFloat(formatUnits(value, decimals))
  if (value > 0n && amount < 0.0001) return `<0.0001 ${symbol}`
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`
}

function formatUnlockDate(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

interface Cell {
  main: string
  sub?: string
}

/** "Credits" (all unclaimed), "Credits & ERC-20s" (both), or none (all claimed). */
function balanceSub(hasCredit: boolean, hasErc20Portion: boolean): string | undefined {
  if (hasCredit && hasErc20Portion) return 'Credits & ERC-20s'
  if (hasCredit) return 'Credits'
  return undefined
}

/** Strip trailing zeros from a fixed-decimal percent and append "%". */
function trimPct(value: string): string {
  return `${value.replace(/\.?0+$/, '')}%`
}

/**
 * A holder's share of the cross-chain total supply (website formatOwnerPortion
 * :4640). Null supply → "—": a share without a complete supply denominator is
 * worse than none, so RPC failures render unknown rather than treating the
 * indexed balances as 100%.
 */
function formatOwnerPortion(balance: bigint, total: bigint | null): string {
  if (total == null) return '—'
  if (total <= 0n) return balance <= 0n ? '0%' : '—'
  if (balance <= 0n) return '0%'
  const pct = Number((balance * 100_000_000n) / total) / 1_000_000
  if (pct >= 10) return trimPct(pct.toFixed(2))
  if (pct >= 1) return trimPct(pct.toFixed(3))
  if (pct >= 0.01) return trimPct(pct.toFixed(4))
  return pct > 0 ? '<0.01%' : '0%'
}

/** bendystraw volumeUsd is scaled by 1e18; format the paid-in total as USD. */
function formatUsd(volumeUsd: bigint): string {
  if (volumeUsd <= 0n) return '—'
  const usd = Number(volumeUsd / 1_000_000_000_000n) / 1e6
  if (!isFinite(usd) || usd <= 0) return '—'
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}k`
  if (usd >= 1) return `$${usd.toFixed(0)}`
  return `$${usd.toFixed(2)}`
}

/** Compact 18-dec balance for the holders-table share tooltip. */
function formatCompactTokenAmount(value: bigint): string {
  const amount = parseFloat(formatUnits(value, 18))
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`
  if (amount >= 1_000) return `${(amount / 1_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}K`
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

const HOLDERS_PAGE_SIZE = 30
const HOLDERS_SEARCH_THRESHOLD = 8

/**
 * The full owners table (website renderOwnersTable :15966): Account | Share |
 * Chains | Paid, over EVERY indexed holder, with client-side search (once the
 * list is long enough to scan) + pagination. The AMM (buyback pool) row reads
 * "Market [AMM]" and jumps to the Market subtab.
 */
function HoldersTable({
  chains,
  symbol,
  isDark,
  onGotoMarket,
}: {
  chains: Array<{ chainId: number; projectId: number }>
  symbol: string
  isDark: boolean
  onGotoMarket: () => void
}) {
  const [data, setData] = useState<{ holders: HolderRow[]; totalSupply: bigint | null; truncated: boolean } | null>(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  const chainKey = chains.map(c => `${c.chainId}:${c.projectId}`).join(',')
  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(false)
    setPage(0)
    fetchHoldersDistribution(chains)
      .then(result => {
        if (!cancelled) setData({ holders: result.holders, totalSupply: result.totalSupply, truncated: result.truncated })
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
    // chainKey captures the identity of `chains`; refetch only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey])

  const muted = isDark ? 'text-gray-500' : 'text-gray-400'
  const headText = `text-xs uppercase tracking-wide ${muted}`
  const rowBorder = `border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`

  if (error) return <p className={`text-sm ${muted}`}>Could not load owner distribution from Bendystraw.</p>
  if (!data) return <p className={`text-sm ${muted}`}>Loading owners from Bendystraw…</p>
  if (!data.holders.length) {
    return (
      <p className={`text-sm ${muted}`}>
        No owners indexed yet — this list trails the chain. Your own balance shows live under You above.
      </p>
    )
  }

  const searchable = data.holders.filter(holder => !isAmmAddress(holder.address))
  const trimmedQuery = query.trim().toLowerCase()
  const filtered = trimmedQuery
    ? data.holders.filter(holder => holder.address.toLowerCase().includes(trimmedQuery))
    : data.holders
  const pageCount = Math.max(1, Math.ceil(filtered.length / HOLDERS_PAGE_SIZE))
  const clampedPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(clampedPage * HOLDERS_PAGE_SIZE, (clampedPage + 1) * HOLDERS_PAGE_SIZE)

  return (
    <div className="space-y-3">
      {searchable.length > HOLDERS_SEARCH_THRESHOLD ? (
        <input
          type="text"
          value={query}
          onChange={event => {
            setQuery(event.target.value)
            setPage(0)
          }}
          placeholder="Search by account address…"
          className={`w-full max-w-xs px-2 py-1 text-sm border bg-transparent ${
            isDark ? 'border-white/20 text-gray-200 placeholder-gray-600' : 'border-gray-300 text-gray-800 placeholder-gray-400'
          }`}
        />
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={headText}>
              <th className="py-1.5 pr-3 font-medium text-left">Account</th>
              <th className="py-1.5 pr-3 font-medium text-right">Share</th>
              <th className="py-1.5 pr-3 font-medium text-left">Chains</th>
              <th className="py-1.5 font-medium text-right">Paid</th>
            </tr>
          </thead>
          <tbody className={isDark ? 'text-gray-200' : 'text-gray-800'}>
            {pageRows.map(holder => {
              const isAmm = isAmmAddress(holder.address)
              const explorer = CHAINS[holder.chains[0]]?.explorer
              return (
                <tr
                  key={holder.address}
                  className={`${rowBorder} ${isAmm ? 'cursor-pointer' : ''}`}
                  onClick={isAmm ? onGotoMarket : undefined}
                  title={isAmm ? 'Open the Market' : undefined}
                >
                  <td className="py-1.5 pr-3">
                    {isAmm ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span>Market</span>
                        <span
                          title={`${holder.address} — Uniswap V4 pool holding pooled LP liquidity`}
                          className={`px-1 py-0.5 border text-[10px] ${
                            isDark ? 'border-white/20 text-gray-300' : 'border-gray-300 text-gray-600'
                          }`}
                        >
                          AMM
                        </span>
                      </span>
                    ) : explorer ? (
                      <a
                        href={`${explorer}/address/${holder.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={event => event.stopPropagation()}
                        title={holder.address}
                        className="font-mono text-xs hover:underline"
                      >
                        {truncateAddress(holder.address)}
                      </a>
                    ) : (
                      <span className="font-mono text-xs" title={holder.address}>
                        {truncateAddress(holder.address)}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <strong title={`${formatCompactTokenAmount(holder.balance)} ${symbol}`}>
                      {formatOwnerPortion(holder.balance, data.totalSupply)}
                    </strong>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="inline-flex flex-wrap gap-1">
                      {holder.chains.map(chainId => (
                        <span
                          key={chainId}
                          title={CHAINS[chainId]?.name ?? `Chain ${chainId}`}
                          className={`px-1 py-0.5 border text-[10px] inline-flex items-center gap-1 ${
                            isDark ? 'border-white/15 text-gray-400' : 'border-gray-200 text-gray-500'
                          }`}
                        >
                          <ChainLogo chainId={chainId} size={12} />
                          {CHAINS[chainId]?.shortName ?? chainId}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className={`py-1.5 text-right whitespace-nowrap ${holder.volumeUsd > 0n ? '' : muted}`}>
                    {formatUsd(holder.volumeUsd)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className={`flex items-center justify-between text-xs ${muted}`}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={clampedPage === 0}
            className="px-2 py-1 border disabled:opacity-40 border-current/30"
          >
            Prev
          </button>
          <span>
            Page {clampedPage + 1} of {pageCount}
          </span>
          <button
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            disabled={clampedPage >= pageCount - 1}
            className="px-2 py-1 border disabled:opacity-40 border-current/30"
          >
            Next
          </button>
        </div>
      ) : null}

      {data.totalSupply == null ? (
        <p className={`text-xs ${muted}`}>
          Supply shares are unavailable because the live supply could not be verified on every chain.
        </p>
      ) : null}
      {data.truncated ? (
        <p className={`text-xs ${muted}`}>Showing the first {data.holders.length} indexed owners by balance.</p>
      ) : null}
    </div>
  )
}

/**
 * The connected wallet's open loans, surfaced compactly inside the You card
 * (website renderYouCard :18069). Full loan management (repay, all active
 * loans) stays in the Loans subtab.
 */
function YourLoansSection({
  chains,
  symbol,
  account,
  isDark,
}: {
  chains: Array<{ chainId: number; projectId: number | string }>
  symbol: string
  account: string
  isDark: boolean
}) {
  const [mine, setMine] = useState<IndexedLoan[] | null>(null)

  const chainKey = chains.map(c => `${c.chainId}:${c.projectId}`).join(',')
  const reload = useCallback(() => {
    let cancelled = false
    fetchProjectLoans(chains.map(c => ({ chainId: c.chainId, projectId: c.projectId })))
      .then(loans => {
        if (cancelled) return
        setMine(loans.filter(loan => String(loan.owner || '').toLowerCase() === account.toLowerCase()))
      })
      .catch(() => {
        if (!cancelled) setMine([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey, account])

  useEffect(() => reload(), [reload])
  useEffect(() => {
    const handler = () => reload()
    window.addEventListener('juice:project-data-invalidated', handler)
    return () => window.removeEventListener('juice:project-data-invalidated', handler)
  }, [reload])

  if (!mine || !mine.length) return null

  const muted = isDark ? 'text-gray-500' : 'text-gray-400'
  const formatLoanAmount = (loan: IndexedLoan, value: bigint): string => {
    const meta = describeLoanToken(loan.chainId, loan.token)
    if (!meta) return `${value.toLocaleString('en-US')} units`
    const amount = parseFloat(formatUnits(value, meta.decimals))
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: meta.decimals === 6 ? 2 : 5 })} ${meta.symbol}`
  }
  const formatDate = (timestamp: number) =>
    new Date(timestamp * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

  return (
    <div className={`mt-4 border-t pt-3 ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
      <div className={`text-xs font-medium uppercase tracking-wide mb-2 ${muted}`}>Your loans</div>
      <div className="space-y-1.5">
        {mine.map(loan => {
          const chain = CHAINS[loan.chainId]
          const dueBy = Number(loan.createdAt || 0) + LOAN_LIQUIDATION_SECONDS
          return (
            <div
              key={`${loan.chainId}-${loan.id}`}
              className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}
            >
              <span>
                {formatLoanAmount(loan, BigInt(loan.borrowAmount))}
                <span className={`ml-2 text-xs ${muted}`}>
                  against {formatCompactTokenAmount(BigInt(loan.collateral))} {symbol}
                  {chain ? ` on ${chain.name}` : ''}
                </span>
              </span>
              <span className={`text-xs ${muted}`}>due by {formatDate(dueBy)}</span>
            </div>
          )
        })}
      </div>
      <p className={`text-xs mt-2 ${muted}`}>Repay and manage these in the Loans tab.</p>
    </div>
  )
}

export function AccountsSubtab({
  project,
  chainIds,
  chainProjects,
  isRevnet,
  hasErc20,
  onCashOut,
  onOpenLoan,
  loanAvailable,
  onMoveChains,
  moveChainsAvailable,
  onAddLiquidity,
  addLiquidityAvailable,
  onConnectWallet,
}: AccountsSubtabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress } = useGuardedTx()

  const [rows, setRows] = useState<YouPositionRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [claimOpen, setClaimOpen] = useState(false)
  const [loanOpen, setLoanOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [addLpOpen, setAddLpOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  // Per-chain LP-position count for the You table's LP column (item: ERC-20 only).
  const [lpByChain, setLpByChain] = useState<Record<number, { status: 'loading' | 'ready' | 'error'; count: number }>>({})

  const symbol = hasErc20 ? project.tokenSymbol || 'tokens' : 'project credits'
  // Per-chain project ids (V6 ids differ per chain). Only chains with a known id
  // are read; a chain absent from the map is "not this project on that chain".
  const youChains = useMemo(
    () =>
      (chainProjects && chainProjects.length
        ? chainProjects
        : [{ chainId: project.chainId, projectId: project.projectId }]
      ).filter(cp => chainIds.includes(cp.chainId)),
    [chainProjects, chainIds, project.chainId, project.projectId],
  )

  useEffect(() => {
    if (!activeAddress) {
      setRows(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    loadYouPosition({ isRevnet }, youChains, activeAddress)
      .then(loaded => {
        if (!cancelled) setRows(loaded)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not read your position.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeAddress, isRevnet, youChains, reloadNonce])

  const reload = useCallback(() => setReloadNonce(nonce => nonce + 1), [])

  // Any confirmed project transaction (claim, cash out, …) refreshes the card.
  useEffect(() => {
    window.addEventListener('juice:project-data-invalidated', reload)
    return () => window.removeEventListener('juice:project-data-invalidated', reload)
  }, [reload])

  const held = (rows ?? []).filter(row => row.balance != null && row.balance > 0n)
  const balanceComplete = (rows ?? []).every(row => row.balance != null) && rows != null
  // Each row's project id ON its chain (V6 ids differ per chain) — carried into
  // the claim so it targets the right project off-home, never the home id.
  const projectIdByChain = new Map(youChains.map(cp => [cp.chainId, cp.projectId]))

  // The connected wallet's V4 LP positions per held chain (current + old buyback
  // pools), loaded lazily behind the balance reads. Only when an ERC-20 exists.
  const showLp = hasErc20
  const heldLpKey = held.map(row => row.chainId).join(',')
  useEffect(() => {
    if (!showLp || !activeAddress) {
      setLpByChain({})
      return
    }
    let cancelled = false
    const account = activeAddress as Address
    const eligible = held.filter(
      row => POSITION_MANAGER_BY_CHAIN[row.chainId] && projectIdByChain.get(row.chainId) != null,
    )
    const initial: Record<number, { status: 'loading' | 'ready' | 'error'; count: number }> = {}
    for (const row of eligible) initial[row.chainId] = { status: 'loading', count: 0 }
    setLpByChain(initial)
    for (const row of eligible) {
      const projectId = projectIdByChain.get(row.chainId) as number | string
      readUserLpPositions(row.chainId, BigInt(projectId), account)
        .then(positions => {
          if (!cancelled) setLpByChain(prev => ({ ...prev, [row.chainId]: { status: 'ready', count: positions.length } }))
        })
        .catch(() => {
          if (!cancelled) setLpByChain(prev => ({ ...prev, [row.chainId]: { status: 'error', count: 0 } }))
        })
    }
    return () => {
      cancelled = true
    }
    // heldLpKey captures which chains are held; projectIdByChain is stable per those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLp, activeAddress, heldLpKey, reloadNonce])

  const claimRows: ClaimCreditsRow[] = held
    .filter(row => row.creditBalance != null && row.creditBalance > 0n)
    .map(row => {
      const chainProjectId = projectIdByChain.get(row.chainId)
      return chainProjectId == null
        ? null
        : { chainId: row.chainId, projectId: chainProjectId, creditBalance: row.creditBalance as bigint }
    })
    .filter((row): row is ClaimCreditsRow => row !== null)

  // The delay gates cash outs AND loans; the value still computes, shown locked.
  const lockedUntil = (rows ?? []).reduce<bigint | null>(
    (max, row) => (row.lockedUntil != null && (max == null || row.lockedUntil > max) ? row.lockedUntil : max),
    null,
  )
  const locked = isCashOutLocked(lockedUntil)

  const cellFor = {
    balance(row: YouPositionRow): Cell {
      const main = `${formatTokenCount(row.balance as bigint)} ${symbol}`
      if (row.creditBalance == null || row.erc20Balance == null) return { main }
      return { main, sub: balanceSub(row.creditBalance > 0n, row.erc20Balance > 0n) }
    },
    cashOut(row: YouPositionRow): Cell {
      if (row.cashOutValue == null) return { main: '—' }
      const main = formatAccountingAmount(row.cashOutValue, row.accountingToken)
      return locked ? { main, sub: 'locked' } : { main }
    },
    // While locked, borrowableAmountFrom returns 0, but the borrowable capacity
    // IS the bonding-curve reclaim — show the cash-out value as the would-be loan.
    loan(row: YouPositionRow): Cell {
      if (row.maxLoan == null) return { main: '—' }
      if (row.maxLoan > 0n) return { main: formatAccountingAmount(row.maxLoan, row.accountingToken) }
      if (locked && row.cashOutValue != null && row.cashOutValue > 0n) {
        return { main: formatAccountingAmount(row.cashOutValue, row.accountingToken), sub: 'locked' }
      }
      return locked ? { main: 'Locked' } : { main: formatAccountingAmount(0n, row.accountingToken) }
    },
  }

  const totalBalance = balanceComplete ? totalIfComplete(held, 'balance') : null
  const totalCash = monetaryTotalIfComplete(held, 'cashOutValue')
  const totalLoan = monetaryTotalIfComplete(held, 'maxLoan')
  const anyCredit = held.some(row => row.creditBalance != null && row.creditBalance > 0n)
  const anyErc20Portion = held.some(row => row.erc20Balance != null && row.erc20Balance > 0n)
  const totalUnit = held[0]?.accountingToken ?? null

  const totalCells: Cell[] = [
    totalBalance != null
      ? { main: `${formatTokenCount(totalBalance)} ${symbol}`, sub: balanceSub(anyCredit, anyErc20Portion) }
      : { main: '—' },
    totalCash != null
      ? locked
        ? { main: formatAccountingAmount(totalCash, totalUnit), sub: 'locked' }
        : { main: formatAccountingAmount(totalCash, totalUnit) }
      : { main: '—' },
    ...(isRevnet
      ? [
          locked
            ? totalCash != null && totalCash > 0n
              ? { main: formatAccountingAmount(totalCash, totalUnit), sub: 'locked' }
              : { main: totalCash != null ? 'Locked' : '—' }
            : totalLoan != null
              ? { main: formatAccountingAmount(totalLoan, totalUnit) }
              : { main: '—' },
        ]
      : []),
  ]

  const headers = [
    'Chain',
    'Balance',
    'Cash out',
    ...(isRevnet ? ['Max loan'] : []),
    ...(showLp ? ['LP'] : []),
  ]

  // Jump to the Market subtab (holders-table AMM row) — mirrors the website's
  // jb:goto-subtab CustomEvent; OwnersTab listens and switches.
  const gotoMarket = useCallback(() => {
    window.dispatchEvent(new CustomEvent('juice:goto-owners-subtab', { detail: 'market' }))
  }, [])

  const lpCell = (row: YouPositionRow): ReactNode => {
    const mutedText = isDark ? 'text-gray-500' : 'text-gray-400'
    if (!POSITION_MANAGER_BY_CHAIN[row.chainId]) return <span>—</span>
    const entry = lpByChain[row.chainId]
    if (!entry || entry.status === 'loading') return <span className={mutedText}>…</span>
    if (entry.status === 'error')
      return (
        <span className={mutedText} title="Could not verify the LP-position history on this chain.">
          Unavailable
        </span>
      )
    if (entry.count === 0) return <span>—</span>
    return (
      <button
        onClick={() => setRemoveOpen(true)}
        title="Manage / remove your LP positions"
        className={`underline decoration-dotted underline-offset-2 ${isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'}`}
      >
        {entry.count} position{entry.count > 1 ? 's' : ''}
      </button>
    )
  }

  const actionButton = (label: string, onClick: (() => void) | undefined, title?: string) => (
    <button
      key={label}
      onClick={onClick}
      title={title}
      className={`px-3 py-1.5 text-sm border transition-colors ${
        isDark
          ? 'border-white/20 text-white hover:bg-white/10'
          : 'border-gray-300 text-gray-800 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  )

  const renderCell = (cell: Cell, alignRight = true) => (
    <div className={alignRight ? 'text-right' : ''}>
      <div>{cell.main}</div>
      {cell.sub ? <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{cell.sub}</div> : null}
    </div>
  )

  const cardClass = `border p-4 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`
  const cardTitleClass = `text-xs font-medium uppercase tracking-wide mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`

  return (
    <div className="space-y-4">
      {/* "You" card */}
      <div className={cardClass}>
        <div className={cardTitleClass}>You</div>
        <div className="mb-3">
          <ExplainerMessage>
            Here&rsquo;s where you stand with this project — your {symbol} on each chain, what they&rsquo;re
            worth to cash out{isRevnet ? ', and what you could borrow against them' : ''}.
          </ExplainerMessage>
        </div>

        {!activeAddress ? (
          <div className="space-y-3">
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              Connect a wallet to see your {symbol} across chains and their cash out value
              {isRevnet ? ', plus your max loan.' : '.'}
            </p>
            {onConnectWallet ? actionButton('Connect wallet', onConnectWallet) : null}
          </div>
        ) : loading && !rows ? (
          <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Reading your position…</p>
        ) : loadError ? (
          <p className="text-sm text-red-400" role="alert">
            {loadError}
          </p>
        ) : rows && !held.length ? (
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            {balanceComplete
              ? `You don’t hold any ${symbol} yet.`
              : 'Could not verify your token balance on every project chain. Try again shortly.'}
          </p>
        ) : rows ? (
          <div className="overflow-x-auto">
            <table className={`w-full text-sm ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
              <thead>
                <tr className={`text-xs uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {headers.map((header, index) => (
                    <th key={header} className={`py-1.5 font-medium ${index === 0 ? 'text-left' : 'text-right'}`}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {held.map(row => (
                  <tr key={row.chainId} className={`border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
                    <td className="py-2 pr-3">{CHAINS[row.chainId]?.name ?? `Chain ${row.chainId}`}</td>
                    <td className="py-2 pl-3">{renderCell(cellFor.balance(row))}</td>
                    <td className="py-2 pl-3">{renderCell(cellFor.cashOut(row))}</td>
                    {isRevnet ? <td className="py-2 pl-3">{renderCell(cellFor.loan(row))}</td> : null}
                    {showLp ? <td className="py-2 pl-3 text-right">{lpCell(row)}</td> : null}
                  </tr>
                ))}
                {held.length > 1 ? (
                  <tr className={`border-t font-medium ${isDark ? 'border-white/20' : 'border-gray-200'}`}>
                    <td className="py-2 pr-3">Total</td>
                    {totalCells.map((cell, index) => (
                      <td key={index} className="py-2 pl-3">
                        {renderCell(cell)}
                      </td>
                    ))}
                    {showLp ? <td className="py-2 pl-3" /> : null}
                  </tr>
                ) : null}
              </tbody>
            </table>
            {!balanceComplete ? (
              <p className={`text-xs mt-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Some chain balances could not be verified, so cross-chain totals are hidden.
              </p>
            ) : null}
            {locked && lockedUntil != null ? (
              <p className={`text-xs mt-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {isRevnet
                  ? `Cash outs and loans unlock ${formatUnlockDate(lockedUntil)}. Locked values estimate what you could redeem or borrow then.`
                  : `Cash outs unlock ${formatUnlockDate(lockedUntil)}. Locked values estimate what you could redeem then.`}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Wallet actions — shown only while connected. */}
        {activeAddress ? (
          <div className="flex flex-wrap gap-2 mt-4">
            {actionButton('Cash out', onCashOut)}
            {loanAvailable ? actionButton('Get a loan', onOpenLoan ?? (() => setLoanOpen(true))) : null}
            {moveChainsAvailable ? actionButton('Move between chains', onMoveChains ?? (() => setMoveOpen(true))) : null}
            {addLiquidityAvailable ? actionButton('Add market liquidity', onAddLiquidity ?? (() => setAddLpOpen(true))) : null}
            {hasErc20 && claimRows.length
              ? actionButton(
                  'Claim credits',
                  () => setClaimOpen(true),
                  'Claim your unclaimed credits as transferable ERC-20 tokens',
                )
              : null}
          </div>
        ) : null}

        {/* Your open loans — surfaced here (website renderYouCard); full management stays in Loans. */}
        {isRevnet && activeAddress ? (
          <YourLoansSection chains={youChains} symbol={symbol} account={activeAddress} isDark={isDark} />
        ) : null}
      </div>

      {/* "All" card — indexer-backed ownership donut + holders list. */}
      <div className={cardClass}>
        <div className={cardTitleClass}>All</div>
        <div className="mb-3">
          <ExplainerMessage>
            {project.tokenSymbol || 'Token'} owners paid in, received splits, received auto-issuance, or got
            them second-hand. This list comes from the indexer, which trails the chain by a bit — your own
            balance shows live under You above.
          </ExplainerMessage>
        </div>
        <div className="space-y-4">
          <HoldersChart projectId={String(project.projectId)} chainId={String(project.chainId)} limit={10} />
          <HoldersTable
            chains={youChains.map(cp => ({ chainId: cp.chainId, projectId: Number(cp.projectId) }))}
            symbol={project.tokenSymbol || 'tokens'}
            isDark={isDark}
            onGotoMarket={gotoMarket}
          />
        </div>
      </div>

      <ClaimCreditsModal
        isOpen={claimOpen}
        onClose={() => setClaimOpen(false)}
        projectId={project.projectId}
        tokenSymbol={project.tokenSymbol}
        rows={claimRows}
        onClaimed={reload}
      />
      {loanAvailable ? (
        <OpenLoanModal
          isOpen={loanOpen}
          onClose={() => setLoanOpen(false)}
          project={project}
          chainIds={chainIds}
          chainProjects={chainProjects}
          onOpened={reload}
        />
      ) : null}
      {moveChainsAvailable ? (
        <MoveChainsModal
          isOpen={moveOpen}
          onClose={() => setMoveOpen(false)}
          project={project}
          chainIds={chainIds}
          chainProjects={chainProjects}
        />
      ) : null}
      {addLiquidityAvailable ? (
        <AddLiquidityModal
          isOpen={addLpOpen}
          onClose={() => setAddLpOpen(false)}
          project={project}
          chainIds={chainIds}
          chainProjects={chainProjects}
        />
      ) : null}
      {showLp ? (
        <RemoveLiquidityModal
          isOpen={removeOpen}
          onClose={() => setRemoveOpen(false)}
          project={project}
          chainIds={chainIds}
          chainProjects={chainProjects}
        />
      ) : null}
    </div>
  )
}
