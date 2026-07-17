/**
 * Loans subtab (revnet-only) — "Your loans" (connected wallet's open loans +
 * per-loan Repay) over "Active loans" (every indexed open loan). Ports
 * website/src/discover.js renderLoansTable (:15596) and the Loans owners
 * subtab (:13969).
 *
 * Data comes from the Bendystraw `loans` entity (active loans only — repaid/
 * liquidated loans drop out). Loan IDs churn on partial repay/reallocate, so
 * the list re-fetches after every loan tx and no UI state is keyed on a stale
 * id: the repay modal re-reads `loanOf` before sending anything.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { useThemeStore } from '../../../stores'
import { CHAINS } from '../../../constants'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { formatTimeAgo } from '../../../utils/activityEvents'
import type { Project } from '../../../services/bendystraw'
import {
  LOAN_LIQUIDATION_SECONDS,
  describeLoanToken,
  fetchProjectLoans,
  loanOutstandingFee,
  type IndexedLoan,
} from '../../../services/revLoans'
import { RepayLoanModal } from './RepayLoanModal'

export interface LoansSubtabProps {
  project: Project
  /** The sucker-group chains the project lives on (home chain first). */
  chainIds: number[]
  /** Per-chain project ids (V6 ids differ per chain); each chain's loans are read with the id ON that chain. */
  chainProjects?: Array<{ chainId: number; projectId: number | string }>
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function formatTokens18(value: bigint): string {
  const amount = parseFloat(formatUnits(value, 18))
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatDateShort(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Borrowed amounts are denominated in the loan's source token, not the ruleset base currency. */
function formatLoanAmount(loan: IndexedLoan, value: bigint): string {
  const meta = describeLoanToken(loan.chainId, loan.token)
  if (!meta) return `${value.toLocaleString('en-US')} raw units`
  const amount = parseFloat(formatUnits(value, meta.decimals))
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: meta.decimals === 6 ? 2 : 5 })} ${meta.symbol}`
}

export function LoansSubtab({ project, chainIds, chainProjects }: LoansSubtabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress } = useGuardedTx()

  const symbol = project.tokenSymbol || 'tokens'
  // Per-chain project ids (V6 ids differ per chain), restricted to the chains shown.
  const loanChains = useMemo(
    () =>
      (chainProjects && chainProjects.length
        ? chainProjects
        : [{ chainId: project.chainId, projectId: project.projectId }]
      ).filter(cp => chainIds.includes(cp.chainId)),
    [chainProjects, chainIds, project.chainId, project.projectId],
  )

  const [loans, setLoans] = useState<IndexedLoan[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [repaying, setRepaying] = useState<IndexedLoan | null>(null)

  const reload = useCallback(() => setReloadNonce(nonce => nonce + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoadError(false)
    fetchProjectLoans(loanChains)
      .then(rows => {
        if (!cancelled) setLoans(rows)
      })
      .catch(() => {
        if (!cancelled) {
          setLoans(null)
          setLoadError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [loanChains, reloadNonce])

  // Every guarded tx (borrow, repay, …) dispatches this after it confirms.
  useEffect(() => {
    const handler = () => reload()
    window.addEventListener('juice:project-data-invalidated', handler)
    return () => window.removeEventListener('juice:project-data-invalidated', handler)
  }, [reload])

  const mine = activeAddress
    ? (loans ?? []).filter(loan => String(loan.owner || '').toLowerCase() === activeAddress.toLowerCase())
    : []

  const cardClass = `border p-4 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`
  const cardTitleClass = `text-xs font-medium uppercase tracking-wide mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`
  const headText = isDark ? 'text-gray-500' : 'text-gray-400'
  const cellText = isDark ? 'text-gray-200' : 'text-gray-800'
  const mutedText = isDark ? 'text-gray-500' : 'text-gray-400'

  const renderTable = (rows: IndexedLoan[], withRepay: boolean) => {
    const now = Math.floor(Date.now() / 1000)
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={`text-left text-xs ${headText}`}>
              <th className="py-2 pr-3 font-medium">Address</th>
              <th className="py-2 pr-3 font-medium">Collateral</th>
              <th className="py-2 pr-3 font-medium">Borrowed</th>
              <th className="py-2 pr-3 font-medium">Opened</th>
              <th className="py-2 pr-3 font-medium">Prepaid</th>
              <th className="py-2 pr-3 font-medium">Prepaid until</th>
              <th className="py-2 pr-3 font-medium">Outstanding fee</th>
              <th className="py-2 pr-3 font-medium">Due by</th>
              {withRepay ? <th className="py-2 font-medium" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map(loan => {
              const owner = loan.owner || loan.beneficiary
              const chain = CHAINS[loan.chainId]
              const prepaidUntil = Number(loan.createdAt || 0) + Number(loan.prepaidDuration || 0)
              const dueBy = Number(loan.createdAt || 0) + LOAN_LIQUIDATION_SECONDS
              const outstanding = loanOutstandingFee(loan, now)
              return (
                <tr
                  key={`${loan.chainId}-${loan.id}`}
                  className={`border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}
                >
                  <td className={`py-2 pr-3 font-mono whitespace-nowrap ${cellText}`}>
                    {chain ? (
                      <a
                        href={`${chain.explorer}/address/${owner}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${owner} on ${chain.name}`}
                        className="hover:underline"
                      >
                        {shortAddress(owner)}
                      </a>
                    ) : (
                      shortAddress(owner)
                    )}
                  </td>
                  <td className={`py-2 pr-3 whitespace-nowrap ${cellText}`}>
                    {formatTokens18(BigInt(loan.collateral))} {symbol}
                  </td>
                  <td className={`py-2 pr-3 whitespace-nowrap ${cellText}`}>
                    {formatLoanAmount(loan, BigInt(loan.borrowAmount))}
                  </td>
                  <td className={`py-2 pr-3 whitespace-nowrap ${mutedText}`}>{formatTimeAgo(Number(loan.createdAt))}</td>
                  <td className={`py-2 pr-3 whitespace-nowrap ${cellText}`}>{Number(loan.prepaidFeePercent || 0) / 10}%</td>
                  <td className={`py-2 pr-3 whitespace-nowrap ${mutedText}`}>
                    {prepaidUntil > now ? formatDateShort(prepaidUntil) : 'passed'}
                  </td>
                  <td
                    className={`py-2 pr-3 whitespace-nowrap ${
                      outstanding != null && outstanding > 0n ? 'text-amber-500' : cellText
                    }`}
                  >
                    {outstanding == null ? 'expired' : outstanding === 0n ? '—' : `+ ${formatLoanAmount(loan, outstanding)}`}
                  </td>
                  <td className={`py-2 pr-3 whitespace-nowrap ${mutedText}`}>{formatDateShort(dueBy)}</td>
                  {withRepay ? (
                    <td className="py-2 whitespace-nowrap">
                      <button
                        onClick={() => setRepaying(loan)}
                        className={`px-3 py-1 text-xs border transition-colors ${
                          isDark
                            ? 'border-white/20 text-white hover:bg-white/10'
                            : 'border-gray-300 text-gray-800 hover:bg-gray-50'
                        }`}
                      >
                        Repay
                      </button>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Your loans — repayable by the connected wallet. */}
      {activeAddress && mine.length ? (
        <div className={cardClass}>
          <div className={cardTitleClass}>Your loans</div>
          <div className="mb-3">
            <ExplainerMessage>
              Repay a loan to reclaim its {symbol} collateral. Within the prepaid window there is no extra
              cost; afterwards the unlock fee grows until the loan liquidates at 10 years.
            </ExplainerMessage>
          </div>
          {renderTable(mine, true)}
        </div>
      ) : null}

      {/* All active loans. */}
      <div className={cardClass}>
        <div className={cardTitleClass}>Active loans</div>
        <div className="mb-3">
          <ExplainerMessage>
            Open loans against {symbol} collateral, from the indexer. Loans have no interest rate — each one
            prepaid a fee for a window of zero extra cost, then the cost to unlock ramps up until the loan
            liquidates at 10 years.
          </ExplainerMessage>
        </div>
        {loadError ? (
          <p className={`text-sm ${mutedText}`}>Could not load loans from Bendystraw.</p>
        ) : loans == null ? (
          <p className={`text-sm ${mutedText}`}>Loading from Bendystraw…</p>
        ) : loans.length === 0 ? (
          <p className={`text-sm ${mutedText}`}>No active loans indexed.</p>
        ) : (
          renderTable(loans, false)
        )}
      </div>

      {/* Loan ids churn on repay — key the modal by the id captured at open, and drop it on close. */}
      {repaying ? (
        <RepayLoanModal
          isOpen
          onClose={() => setRepaying(null)}
          project={project}
          loan={repaying}
          onRepaid={reload}
        />
      ) : null}
    </div>
  )
}
