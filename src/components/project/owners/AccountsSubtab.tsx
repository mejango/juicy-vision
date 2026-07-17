/**
 * Accounts subtab — the "You" card (the connected wallet's per-chain position
 * + wallet actions) over the "All" card (ownership donut + holders list).
 * Ports website/src/discover.js renderYouCard (:17295) + renderOwnersAll (:15083).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { useThemeStore } from '../../../stores'
import { CHAINS } from '../../../constants'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { HoldersChart } from '../../dynamic/charts'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import type { Project } from '../../../services/bendystraw'
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
  const [reloadNonce, setReloadNonce] = useState(0)

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

  const headers = isRevnet ? ['Chain', 'Balance', 'Cash out', 'Max loan'] : ['Chain', 'Balance', 'Cash out']

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
        <HoldersChart projectId={String(project.projectId)} chainId={String(project.chainId)} limit={10} />
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
    </div>
  )
}
