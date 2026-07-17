/**
 * Shop → Customers subtab: what's been bought and by whom.
 * Ports website/src/discover.js renderShopCustomers (:1267), renderCustomerYou
 * (:1298), renderCustomerAll (:1330).
 *
 * "You"  = the connected wallet's owned items (per-item tally), plus a Redeem
 *          link when the shop is configured for item cash outs.
 * "All"  = distinct customer count + items-sold total + ranked buyers (top 100)
 *          + a tx-linked recent-purchases feed (latest 25).
 *
 * Both cards are backed by the same indexed `mintNftEvents` (one row per minted
 * 721) and a shared tierId → name map, resolved via the media resolver.
 */

import { useEffect, useMemo, useState } from 'react'
import { useThemeStore } from '../../../stores'
import { CHAINS } from '../../../constants'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { truncateAddress } from '../../../utils'
import { formatTimeAgo } from '../../../utils/activityEvents'
import { fetchProjectWithRuleset } from '../../../services/bendystraw'
import {
  fetchNftMints,
  resolveShopItemNames,
  tallyItems,
  rankCustomers,
  itemLabelFrom,
  type MintFetchResult,
  type ItemNames,
  type ShopChain,
} from '../../../services/shopCustomers'
import { RedeemItemsModal } from './RedeemItemsModal'

export interface CustomersSubtabProps {
  /** Revnets are token-based — item redemption (721 cash out) is custom-only. */
  isRevnet?: boolean
  /** Home-chain project id (used to resolve item names + the redeem gate). */
  projectId: string
  /** Home chain id. */
  chainId: number
  /** The chains this project lives on, with per-chain project ids. */
  chains: ShopChain[]
}

function explorerAddressUrl(chainId: number, address: string): string | null {
  const base = CHAINS[chainId]?.explorer
  return base ? `${base}/address/${address}` : null
}

function explorerTxUrl(chainId: number, txHash: string): string | null {
  const base = CHAINS[chainId]?.explorerTx
  return base ? `${base}${txHash}` : null
}

export function CustomersSubtab({ projectId, chainId, chains, isRevnet }: CustomersSubtabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress } = useGuardedTx()

  const chainKey = chains.map(c => `${c.chainId}:${c.projectId}`).join(',')

  const [names, setNames] = useState<ItemNames>({})
  const [redeemEnabled, setRedeemEnabled] = useState(false)
  const [redeemOpen, setRedeemOpen] = useState(false)

  const [you, setYou] = useState<MintFetchResult | null>(null)
  const [youLoading, setYouLoading] = useState(false)
  const [youError, setYouError] = useState(false)

  const [all, setAll] = useState<MintFetchResult | null>(null)
  const [allLoading, setAllLoading] = useState(false)
  const [allError, setAllError] = useState(false)

  const [reloadNonce, setReloadNonce] = useState(0)

  // Shared item-name map + redeem-eligibility (the shop's cash-out gate).
  useEffect(() => {
    let cancelled = false
    resolveShopItemNames(projectId, chainId).then(n => {
      if (!cancelled) setNames(n)
    })
    fetchProjectWithRuleset(projectId, chainId)
      .then(project => {
        // Revnet useDataHookForCashOut means TOKEN cash out (REVOwner hook), not item
        // redemption — the 721 redeem path is custom-projects only.
        if (!cancelled) setRedeemEnabled(!isRevnet && Boolean(project?.currentRuleset?.useDataHookForCashOut))
      })
      .catch(() => {
        if (!cancelled) setRedeemEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, chainId, isRevnet])

  // "All" customers — every buyer across the project's chains.
  useEffect(() => {
    let cancelled = false
    setAllLoading(true)
    setAllError(false)
    fetchNftMints(chains)
      .then(res => {
        if (!cancelled) setAll(res)
      })
      .catch(() => {
        if (!cancelled) setAllError(true)
      })
      .finally(() => {
        if (!cancelled) setAllLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey, reloadNonce])

  // "You" — the connected wallet's purchases.
  useEffect(() => {
    if (!activeAddress) {
      setYou(null)
      return
    }
    let cancelled = false
    setYouLoading(true)
    setYouError(false)
    fetchNftMints(chains, activeAddress)
      .then(res => {
        if (!cancelled) setYou(res)
      })
      .catch(() => {
        if (!cancelled) setYouError(true)
      })
      .finally(() => {
        if (!cancelled) setYouLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey, activeAddress, reloadNonce])

  // Refresh after a confirmed redemption.
  useEffect(() => {
    const reload = () => setReloadNonce(n => n + 1)
    window.addEventListener('juice:project-data-invalidated', reload)
    return () => window.removeEventListener('juice:project-data-invalidated', reload)
  }, [])

  const youTally = useMemo(() => (you ? tallyItems(you.rows, names) : []), [you, names])
  const ranked = useMemo(() => (all ? rankCustomers(all.rows) : []), [all])

  const cardClass = `border p-4 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`
  const cardTitleClass = `text-xs font-medium uppercase tracking-wide mb-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`
  const keyText = isDark ? 'text-gray-400' : 'text-gray-600'
  const rowClass = `flex items-baseline justify-between gap-3 py-1 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`

  return (
    <div className="space-y-4">
      <ExplainerMessage>
        See who&rsquo;s bought from this shop — the items you own, every customer ranked by what they hold,
        and the most recent purchases.
      </ExplainerMessage>

      {/* You */}
      <div className={cardClass}>
        <div className={cardTitleClass}>You</div>
        {!activeAddress ? (
          <p className={`text-sm ${keyText}`}>Connect a wallet to see the items you own.</p>
        ) : youLoading && !you ? (
          <p className={`text-sm ${keyText}`}>Loading your items…</p>
        ) : youError ? (
          <p className="text-sm text-red-400" role="alert">Could not load your items.</p>
        ) : you && !you.rows.length ? (
          <p className={`text-sm ${keyText}`}>You don&rsquo;t own any items from this shop yet.</p>
        ) : you ? (
          <div>
            <div className={`text-sm font-medium mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {you.rows.length} item{you.rows.length === 1 ? '' : 's'} owned
            </div>
            <div>
              {youTally.map(t => (
                <div key={t.tierId} className={rowClass}>
                  <span className={isDark ? 'text-gray-300' : 'text-gray-700'}>{t.label}</span>
                  <span className={`font-mono ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>×{t.count}</span>
                </div>
              ))}
            </div>
            {redeemEnabled ? (
              <button
                onClick={() => setRedeemOpen(true)}
                className="mt-3 text-sm text-juice-cyan hover:underline"
              >
                Redeem items for surplus →
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* All */}
      <div className={cardClass}>
        <div className={cardTitleClass}>All</div>
        {allLoading && !all ? (
          <p className={`text-sm ${keyText}`}>Loading customers…</p>
        ) : allError ? (
          <p className="text-sm text-red-400" role="alert">Could not load customers.</p>
        ) : all && !all.rows.length ? (
          <p className={`text-sm ${keyText}`}>No items have been bought yet.</p>
        ) : all ? (
          <div>
            <div className={`text-sm font-medium mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {ranked.length} customer{ranked.length === 1 ? '' : 's'} · {all.total} item{all.total === 1 ? '' : 's'} sold
              {all.capped ? ` (showing latest ${all.rows.length})` : ''}
            </div>

            {/* Ranked customers */}
            <div className="overflow-x-auto">
              {ranked.slice(0, 100).map(cust => {
                const url = explorerAddressUrl(cust.chainId, cust.address)
                const items = tallyItems(cust.mints, names)
                  .map(t => (t.count > 1 ? `${t.count}× ${t.label}` : t.label))
                  .join(', ')
                return (
                  <div key={cust.address.toLowerCase()} className={rowClass}>
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-juice-cyan hover:underline font-mono text-sm whitespace-nowrap">
                        {truncateAddress(cust.address)}
                      </a>
                    ) : (
                      <span className="font-mono text-sm whitespace-nowrap">{truncateAddress(cust.address)}</span>
                    )}
                    <span className={`text-sm text-right ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{items}</span>
                  </div>
                )
              })}
            </div>

            {/* Recent purchases */}
            <div className={`text-xs font-medium uppercase tracking-wide mt-4 mb-1 ${keyText}`}>Recent purchases</div>
            <div>
              {all.rows.slice(0, 25).map(m => {
                const tx = explorerTxUrl(m.chainId, m.txHash)
                return (
                  <div key={`${m.txHash}-${m.tokenId}`} className={rowClass}>
                    {tx ? (
                      <a href={tx} target="_blank" rel="noopener noreferrer" className="text-juice-cyan hover:underline text-sm whitespace-nowrap">
                        {formatTimeAgo(m.timestamp)}
                      </a>
                    ) : (
                      <span className="text-sm whitespace-nowrap">{formatTimeAgo(m.timestamp)}</span>
                    )}
                    <span className={`text-sm text-right ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                      {itemLabelFrom(names, m.tierId)} → {truncateAddress(m.beneficiary)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>

      <RedeemItemsModal
        isOpen={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        chains={chains}
        defaultChainId={chainId}
        onRedeemed={() => setReloadNonce(n => n + 1)}
      />
    </div>
  )
}
