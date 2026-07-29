import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../stores'
import { useViewAsStore } from '../stores/viewAsStore'
import { useTransactionStore, type Transaction } from '../stores/transactionStore'
import { useEnsNameResolved, useViewedAccount } from '../hooks'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useRelayrStatus } from '../hooks/relayr'
import { useAllChainBalances } from '../components/wallet/useAllChainBalances'
import ActivityItem from '../components/chat/ActivityItem'
import { IpfsImage } from '../components/ui/IpfsMedia'
import ChainLogo from '../components/ui/ChainLogo'
import {
  fetchAccountActivityEvents,
  fetchAccountOperatedPermissions,
  fetchAccountTokenHoldings,
  fetchAccountNftHoldings,
  fetchProjectsByOwner,
  groupTokenHoldings,
  groupNftHoldings,
  type ActivityEvent,
  type Project,
  type TokenHoldingGroup,
  type NftHoldingGroup,
} from '../services/bendystraw'
import { resolveProjectNameForDisplay, fetchProjectTokenSymbol } from '../services/bendystraw/client'
import {
  resolveShopItemMedia,
  itemLabelFrom,
  type ShopItemMeta,
} from '../services/shopCustomers'
import { toTokenFloat } from '../utils/currency'
import { fetchSafeInfo } from '../services/safeInfo'
import {
  getSafesByOwner,
  safeServiceChainIds,
  dedupeByChainAndProject,
} from '../services/safe/safeTxService'
import {
  aggregateOperatedProjects,
  permissionLabel,
  type OperatedProject,
} from '../services/permissionsAdmin'
import { truncateAddress } from '../utils/ens'
import { CHAINS, MAINNET_CHAINS } from '../constants'
import { projectPathFor } from '../utils/projectLink'
import type { Address } from 'viem'

const ACTIVITY_PAGE_SIZE = 25

// Tab set mirrors the project page's idiom (ProjectTabs + URL hash): the tab
// row switches panels, and the active tab is written to the location hash so
// deep links and back/forward keep working.
type AccountTabId = 'activity' | 'holdings' | 'projects' | 'roles'

const ACCOUNT_TABS: Array<{ id: AccountTabId; label: string }> = [
  { id: 'activity', label: 'Activity' },
  { id: 'holdings', label: 'Holdings' },
  { id: 'projects', label: 'Projects' },
  { id: 'roles', label: 'Roles' },
]

function parseAccountHash(hash: string): AccountTabId | null {
  const slug = hash.replace(/^#/, '').toLowerCase()
  return ACCOUNT_TABS.some(tab => tab.id === slug) ? (slug as AccountTabId) : null
}

// True when a raw 18-decimal balance string is present and positive.
function isPositiveRaw(raw?: string): boolean {
  if (!raw) return false
  try {
    return toTokenFloat(raw) > 0
  } catch {
    return false
  }
}

// 18-decimal project-token balance for display ("<0.0001" floor, 4 dp).
function formatTokenBalance(raw: string): string {
  let amount: number
  try {
    amount = toTokenFloat(raw)
  } catch {
    return '0'
  }
  if (amount > 0 && amount < 0.0001) return '<0.0001'
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

// Statuses that mean "still in flight" — mirrors getPendingTransactions.
const PENDING_STATUSES: ReadonlyArray<Transaction['status']> = [
  'pending',
  'safe-proposed',
  'relayr-pending',
  'submitted',
]

interface AccountViewProps {
  address: string
}

interface OwnedRow {
  chainId: number
  projectId: number
  project: Project
  /** Present when ownership is held through a Safe the account co-owns. */
  viaSafe?: { safe: string; threshold?: number; ownerCount?: number }
}

interface OperatedRow extends OperatedProject {
  name: string | null
}

interface TokenHoldingRowView extends TokenHoldingGroup {
  name: string | null
  symbol: string | null
}

interface NftHoldingRowView extends NftHoldingGroup {
  name: string | null
  meta: ShopItemMeta | null
}

function chainInfo(chainId: number) {
  return CHAINS[chainId] || MAINNET_CHAINS[chainId]
}

// Re-polls a Relayr bundle and writes the fresh per-chain states back into the
// local transaction store.
function RelayrRepoll({ tx }: { tx: Transaction }) {
  const updateTransaction = useTransactionStore(s => s.updateTransaction)
  const { data, error } = useRelayrStatus({
    bundleId: tx.bundleUuid ?? null,
    enabled: true,
    stopOnComplete: true,
  })

  useEffect(() => {
    if (!data) return
    const chainStates = data.transactions.map(t => ({
      chainId: t.chain_id,
      status: t.status,
      txHash: t.tx_hash,
      error: t.error,
    }))
    const status =
      data.status === 'completed'
        ? ('confirmed' as const)
        : data.status === 'failed' || data.status === 'partial'
          ? ('failed' as const)
          : tx.status
    updateTransaction(tx.id, { chainStates, status })
  }, [data, tx.id, tx.status, updateTransaction])

  return (
    <span className="text-[10px] opacity-70">
      {error ? 'Status check failed' : 'Checking status…'}
    </span>
  )
}

// The account's pending local transactions, layered above the confirmed
// (indexed) activity. Only rendered for the viewer's own account: the store is
// this device's record of what it submitted.
function InFlightActivity({
  address,
  confirmedHashes,
}: {
  address: string
  confirmedHashes: Set<string>
}) {
  // Relayr is expected to ship a query-by-account API soon. When it does,
  // replace this local-store read with a fetch against that endpoint so any
  // viewer (and any device) sees the account's Relayr history/state.
  const transactions = useTransactionStore(s => s.transactions)
  const { theme } = useThemeStore()
  const [repollingIds, setRepollingIds] = useState<Record<string, boolean>>({})

  const rows = useMemo(
    () =>
      transactions.filter(
        tx =>
          tx.account?.toLowerCase() === address.toLowerCase() &&
          PENDING_STATUSES.includes(tx.status) &&
          !(tx.hash && confirmedHashes.has(tx.hash.toLowerCase()))
      ),
    [transactions, address, confirmedHashes]
  )

  if (!rows.length) return null

  return (
    <div className="mb-2">
      {rows.map(tx => {
        const chain = chainInfo(tx.chainId)
        return (
          <div
            key={tx.id}
            data-testid="in-flight-tx"
            className={`px-3 py-2 border-b text-xs ${
              theme === 'dark' ? 'border-white/10' : 'border-gray-200'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-juice-orange animate-pulse shrink-0" />
              <span className="font-medium capitalize">{tx.label || tx.type}</span>
              <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}>
                {tx.status}
              </span>
              {chain && (
                <span
                  className="inline-flex items-center gap-1 text-[8px] font-bold px-1 py-0.5 rounded"
                  style={{ backgroundColor: `${chain.color}80`, color: 'rgba(255,255,255,0.85)' }}
                >
                  <ChainLogo chainId={tx.chainId} size={12} />
                  {chain.shortName}
                </span>
              )}
              {tx.bundleUuid && (
                repollingIds[tx.id] ? (
                  <RelayrRepoll tx={tx} />
                ) : (
                  <button
                    onClick={() => setRepollingIds(prev => ({ ...prev, [tx.id]: true }))}
                    className="text-juice-orange hover:text-juice-orange/80 transition-colors"
                  >
                    Retry
                  </button>
                )
              )}
            </div>
            {tx.chainStates && tx.chainStates.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-1 pl-3.5">
                {tx.chainStates.map(cs => {
                  const csChain = chainInfo(cs.chainId)
                  return (
                    <span key={cs.chainId} className="flex items-center gap-1 text-[10px]">
                      <ChainLogo chainId={cs.chainId} size={12} />
                      <span>{csChain?.shortName || cs.chainId}</span>
                      <span className={theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}>
                        {cs.status}
                      </span>
                      {cs.txHash && csChain && (
                        <a
                          href={`${csChain.explorer}/tx/${cs.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-juice-cyan hover:underline"
                        >
                          tx
                        </a>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function AccountView({ address }: AccountViewProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Display surfaces ("your account" badge) follow the viewed account; the
  // in-flight transaction layer stays keyed to the genuinely CONNECTED
  // account — the local store records what THIS device submitted.
  const { address: viewedAddress, connectedAddress } = useViewedAccount()
  const isSelf = !!viewedAddress && viewedAddress.toLowerCase() === address.toLowerCase()
  const isConnectedSelf =
    !!connectedAddress && connectedAddress.toLowerCase() === address.toLowerCase()

  const { ensName } = useEnsNameResolved(address)
  useDocumentTitle(ensName || truncateAddress(address))
  const { balances, loading: balancesLoading } = useAllChainBalances(address)

  // Site-wide "View as" activation for this account
  const viewAs = useViewAsStore(s => s.viewAs)
  const setViewAs = useViewAsStore(s => s.setViewAs)
  const isViewingAsThis = !!viewAs && viewAs.toLowerCase() === address.toLowerCase()

  // Activity. `fromOffset` tracks how many FROM-BRANCH rows have been
  // consumed — the server offset pages only that branch, while `events` also
  // contains merged beneficiary rows the offset must not advance past.
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [fromOffset, setFromOffset] = useState(0)
  const [activityLoading, setActivityLoading] = useState(true)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // Owned projects
  const [owned, setOwned] = useState<OwnedRow[]>([])
  const [ownedLoading, setOwnedLoading] = useState(true)
  const [ownedError, setOwnedError] = useState<string | null>(null)

  // Operated projects
  const [operated, setOperated] = useState<OperatedRow[]>([])
  const [operatedLoading, setOperatedLoading] = useState(true)
  const [operatedError, setOperatedError] = useState<string | null>(null)

  // Holdings: project tokens + owned store items (null = still loading).
  // The truncation states carry "showing first N of M" when the account holds
  // more rows than the query window returned.
  const [tokenHoldings, setTokenHoldings] = useState<TokenHoldingRowView[] | null>(null)
  const [tokenHoldingsError, setTokenHoldingsError] = useState<string | null>(null)
  const [tokenTruncation, setTokenTruncation] = useState<{ shown: number; total: number } | null>(null)
  const [itemHoldings, setItemHoldings] = useState<NftHoldingRowView[] | null>(null)
  const [itemHoldingsError, setItemHoldingsError] = useState<string | null>(null)
  const [itemTruncation, setItemTruncation] = useState<{ shown: number; total: number } | null>(null)

  // Active tab mirrors the project page's mechanism: state seeded from the URL
  // hash, written back on change, and re-read on hashchange (back/forward).
  const [activeTab, setActiveTabState] = useState<AccountTabId>(
    () => parseAccountHash(window.location.hash) ?? 'activity'
  )
  const setActiveTab = useCallback((tab: AccountTabId) => {
    setActiveTabState(tab)
    window.history.replaceState(null, '', `#${tab}`)
  }, [])
  useEffect(() => {
    const handleHashChange = () => {
      const tab = parseAccountHash(window.location.hash)
      if (tab) setActiveTabState(tab)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const goToProject = useCallback(
    (chainId: number, projectId: number) => {
      const path = projectPathFor(chainId, projectId)
      if (path) navigate(path)
    },
    [navigate]
  )

  // Load first page of activity on address change
  useEffect(() => {
    let cancelled = false
    setEvents([])
    setFromOffset(0)
    setActivityLoading(true)
    setActivityError(null)
    setHasMore(false)
    fetchAccountActivityEvents(address, { limit: ACTIVITY_PAGE_SIZE, offset: 0 })
      .then(page => {
        if (cancelled) return
        setEvents(page.events)
        setFromOffset(page.fromCount)
        setHasMore(page.fromCount >= ACTIVITY_PAGE_SIZE)
      })
      .catch(err => {
        if (!cancelled) setActivityError(err instanceof Error ? err.message : 'Activity unavailable')
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [address])

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      // Page by the from-branch consumed count, NOT events.length — the merged
      // feed also contains beneficiary rows the server offset would skip past.
      const page = await fetchAccountActivityEvents(address, {
        limit: ACTIVITY_PAGE_SIZE,
        offset: fromOffset,
      })
      setEvents(prev => {
        const known = new Set(prev.map(e => e.id))
        return [...prev, ...page.events.filter(e => !known.has(e.id))]
      })
      setFromOffset(prev => prev + page.fromCount)
      setHasMore(page.fromCount >= ACTIVITY_PAGE_SIZE)
    } catch {
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [address, fromOffset])

  // Owned projects: direct ownership plus projects owned by Safes the account co-owns
  useEffect(() => {
    let cancelled = false
    setOwned([])
    setOwnedLoading(true)
    setOwnedError(null)
    ;(async () => {
      const direct = await fetchProjectsByOwner(address).catch((err: unknown) => {
        if (!cancelled) setOwnedError(err instanceof Error ? err.message : 'Owned projects unavailable')
        return [] as Project[]
      })

      // Enumerate Safes per service-covered chain; chains without a service are skipped.
      const safeLists = await Promise.all(
        safeServiceChainIds().map(chainId => getSafesByOwner(address, chainId))
      )
      const uniqueSafes = [...new Map(safeLists.flat().map(s => [s.toLowerCase(), s])).values()]

      const safeRows: OwnedRow[] = []
      await Promise.all(
        uniqueSafes.map(async safe => {
          const projects = await fetchProjectsByOwner(safe).catch(() => [] as Project[])
          for (const p of projects) {
            safeRows.push({
              chainId: p.chainId,
              projectId: p.projectId,
              project: p,
              viaSafe: { safe },
            })
          }
        })
      )

      // Best-effort threshold badge enrichment (cached per (safe, chainId)).
      await Promise.all(
        safeRows.map(async row => {
          try {
            const info = await fetchSafeInfo(row.viaSafe!.safe as Address, row.chainId)
            if (info.isSafe) {
              row.viaSafe!.threshold = info.threshold
              row.viaSafe!.ownerCount = info.owners.length
            }
          } catch {
            // Badge shows without a threshold.
          }
        })
      )

      const directRows: OwnedRow[] = direct.map(p => ({
        chainId: p.chainId,
        projectId: p.projectId,
        project: p,
      }))
      if (!cancelled) {
        setOwned(dedupeByChainAndProject([...directRows, ...safeRows]))
        setOwnedLoading(false)
      }
    })().catch(err => {
      if (!cancelled) {
        setOwnedError(err instanceof Error ? err.message : 'Owned projects unavailable')
        setOwnedLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [address])

  // Operated projects: permission grants naming this address as operator
  useEffect(() => {
    let cancelled = false
    setOperated([])
    setOperatedLoading(true)
    setOperatedError(null)
    ;(async () => {
      const items = await fetchAccountOperatedPermissions(address)
      const grouped = aggregateOperatedProjects(items)
      const rows: OperatedRow[] = await Promise.all(
        grouped.map(async g => ({
          ...g,
          name: await resolveProjectNameForDisplay(g.projectId, g.chainId).catch(() => null),
        }))
      )
      if (!cancelled) {
        setOperated(rows)
        setOperatedLoading(false)
      }
    })().catch(err => {
      if (!cancelled) {
        setOperatedError(err instanceof Error ? err.message : 'Operated projects unavailable')
        setOperatedLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [address])

  // Token holdings: V6 participant rows grouped one row per sucker group
  // across chains (ungrouped rows stay per chain+project), enriched with the
  // display name + token symbol resolved from the group's own leading row.
  useEffect(() => {
    let cancelled = false
    setTokenHoldings(null)
    setTokenHoldingsError(null)
    setTokenTruncation(null)
    ;(async () => {
      const page = await fetchAccountTokenHoldings(address)
      const groups = groupTokenHoldings(page.rows)
      const rows: TokenHoldingRowView[] = await Promise.all(
        groups.map(async g => {
          const home = g.chains[0]
          const [name, symbol] = await Promise.all([
            resolveProjectNameForDisplay(home.projectId, home.chainId).catch(() => null),
            fetchProjectTokenSymbol(String(home.projectId), home.chainId).catch(() => null),
          ])
          return { ...g, name, symbol }
        })
      )
      if (!cancelled) {
        setTokenHoldings(rows)
        setTokenTruncation(
          page.truncated ? { shown: page.rows.length, total: page.totalCount } : null
        )
      }
    })().catch(err => {
      if (!cancelled) {
        setTokenHoldingsError(err instanceof Error ? err.message : 'Token holdings unavailable')
        setTokenHoldings([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [address])

  // Store-item holdings: owned 721s (deduped by chain+hook+tokenId by the
  // fetcher), grouped per chain+project with per-tier tallies, enriched with
  // the project's name and the shop's tier name/media maps.
  useEffect(() => {
    let cancelled = false
    setItemHoldings(null)
    setItemHoldingsError(null)
    setItemTruncation(null)
    ;(async () => {
      const page = await fetchAccountNftHoldings(address)
      const groups = groupNftHoldings(page.rows)
      const rows: NftHoldingRowView[] = await Promise.all(
        groups.map(async g => {
          const [name, meta] = await Promise.all([
            resolveProjectNameForDisplay(g.projectId, g.chainId).catch(() => null),
            resolveShopItemMedia(g.projectId, g.chainId).catch(() => null),
          ])
          return { ...g, name, meta }
        })
      )
      if (!cancelled) {
        setItemHoldings(rows)
        setItemTruncation(
          page.truncated ? { shown: page.rows.length, total: page.totalCount } : null
        )
      }
    })().catch(err => {
      if (!cancelled) {
        setItemHoldingsError(err instanceof Error ? err.message : 'Store items unavailable')
        setItemHoldings([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [address])

  const confirmedHashes = useMemo(() => {
    const set = new Set<string>()
    for (const event of events) {
      const hash = 'txHash' in event ? event.txHash : undefined
      if (hash) set.add(hash.toLowerCase())
    }
    return set
  }, [events])

  const sectionClass = `border p-4 ${
    isDark ? 'border-white/10 bg-white/[0.02]' : 'border-gray-200 bg-white'
  }`
  const sectionTitleClass = `text-sm font-semibold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`
  const mutedClass = isDark ? 'text-gray-400' : 'text-gray-500'

  return (
    <div className={`min-h-screen ${isDark ? 'bg-juice-dark text-white' : 'bg-white text-gray-900'}`}>
      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <button
              onClick={() => navigate('/')}
              className={`text-xs mb-2 transition-colors ${
                isDark ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              ← {t('account.home', 'Home')}
            </button>
            <h1 className="text-xl font-semibold">
              {ensName || truncateAddress(address)}
            </h1>
            <div className={`text-xs mt-0.5 font-mono ${mutedClass}`}>{address}</div>
            {isSelf && (
              <div className="text-[10px] mt-1 text-juice-orange">
                {t('account.yourAccount', 'This is your connected account')}
              </div>
            )}
          </div>

          {/* Activate site-wide view-as for this account. Account-page
              navigation itself is covered by the ProjectSearch combobox. */}
          <div className="w-full sm:w-auto">
            <button
              onClick={() => setViewAs(address)}
              disabled={isViewingAsThis}
              className="px-3 py-1.5 text-xs bg-juice-orange text-juice-dark font-medium hover:bg-juice-orange/90 transition-colors disabled:opacity-50"
            >
              {isViewingAsThis
                ? t('account.viewingAsThis', 'Viewing site as this account')
                : t('account.viewSiteAs', 'View site as this account')}
            </button>
          </div>
        </div>

        {/* Balances */}
        <div className={`${sectionClass} mb-4`}>
          <h2 className={sectionTitleClass}>{t('account.balances', 'Balances')}</h2>
          {balancesLoading ? (
            <div className={`text-xs ${mutedClass}`}>{t('account.loading', 'Loading…')}</div>
          ) : balances.length === 0 ? (
            <div className={`text-xs ${mutedClass}`}>
              {t('account.balancesUnavailable', 'Balances unavailable')}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {balances.map(b => (
                <div key={b.chainId} className="text-xs">
                  <div className={`flex items-center gap-1 text-[10px] font-bold ${mutedClass}`}>
                    <ChainLogo chainId={b.chainId} size={12} />
                    {b.chainName}
                  </div>
                  <div>{parseFloat(b.eth).toFixed(4)} ETH</div>
                  <div>{parseFloat(b.usdc).toFixed(2)} USDC</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tab bar — same idiom as the project page's ProjectTabs */}
        <div
          className={`flex gap-6 overflow-x-auto border-b mb-4 ${
            isDark ? 'border-white/10' : 'border-gray-200'
          }`}
        >
          {ACCOUNT_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'border-juice-orange text-juice-orange'
                  : isDark
                    ? 'border-transparent text-gray-400 hover:text-gray-200'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t(`account.tab.${tab.id}`, tab.label)}
            </button>
          ))}
        </div>

        {/* Activity */}
        {activeTab === 'activity' && (
        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>{t('account.activity', 'Activity')}</h2>
          {isConnectedSelf && <InFlightActivity address={address} confirmedHashes={confirmedHashes} />}
          {activityLoading ? (
            <div className={`text-xs ${mutedClass}`}>{t('account.loading', 'Loading…')}</div>
          ) : activityError ? (
            <div className="text-xs text-red-500">{activityError}</div>
          ) : events.length === 0 ? (
            <div className={`text-xs ${mutedClass}`}>{t('account.noActivity', 'No activity yet')}</div>
          ) : (
            <>
              <div className="px-4">
                {events.map(event => {
                  const projectId = event.project?.projectId
                  return (
                    <ActivityItem
                      key={event.id}
                      event={event}
                      onProjectClick={
                        projectId != null
                          ? () => goToProject(event.chainId, projectId)
                          : undefined
                      }
                    />
                  )
                })}
              </div>
              {hasMore && (
                <button
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className={`mt-3 text-xs transition-colors disabled:opacity-50 ${
                    isDark ? 'text-juice-cyan hover:text-juice-cyan/80' : 'text-teal-600 hover:text-teal-500'
                  }`}
                >
                  {loadingMore ? t('account.loading', 'Loading…') : t('account.loadMore', 'Load more')}
                </button>
              )}
            </>
          )}
        </div>
        )}

        {/* Holdings: project tokens + store items */}
        {activeTab === 'holdings' && (
        <>
        <div className={`${sectionClass} mb-4`}>
          <h2 className={sectionTitleClass}>{t('account.tokens', 'Tokens')}</h2>
          {tokenHoldings === null ? (
            <div className={`text-xs ${mutedClass}`}>{t('account.loading', 'Loading…')}</div>
          ) : tokenHoldingsError ? (
            <div className="text-xs text-red-500">{tokenHoldingsError}</div>
          ) : tokenHoldings.length === 0 ? (
            <div className={`text-xs ${mutedClass}`}>
              {t('account.noTokens', 'No project tokens held')}
            </div>
          ) : (
            <div className="space-y-2">
              {tokenHoldings.map(row => (
                <button
                  key={row.suckerGroupId ?? `${row.chains[0].chainId}:${row.chains[0].projectId}`}
                  data-testid="token-holding"
                  onClick={() => goToProject(row.chains[0].chainId, row.chains[0].projectId)}
                  className={`block w-full p-2 border text-left transition-colors ${
                    isDark
                      ? 'border-white/10 hover:bg-white/5'
                      : 'border-gray-200 hover:bg-black/5'
                  }`}
                >
                  <div className="text-xs font-medium truncate">
                    {row.name || `Project ${row.projectId}`}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                    {row.chains.map(c => {
                      const chain = chainInfo(c.chainId)
                      return (
                        <span key={c.chainId} className="flex items-center gap-1 text-[10px]">
                          {chain && (
                            <span
                              className="inline-flex items-center gap-1 text-[8px] font-bold px-1 py-0.5 rounded"
                              style={{ backgroundColor: `${chain.color}80`, color: 'rgba(255,255,255,0.85)' }}
                            >
                              <ChainLogo chainId={c.chainId} size={12} />
                              {chain.shortName}
                            </span>
                          )}
                          <span>
                            {formatTokenBalance(c.balance)}{' '}
                            {row.symbol || t('account.tokensFallback', 'tokens')}
                          </span>
                          {isPositiveRaw(c.creditBalance) && (
                            <span className={mutedClass}>
                              ({formatTokenBalance(c.erc20Balance ?? '0')}{' '}
                              {t('account.claimed', 'claimed')},{' '}
                              {formatTokenBalance(c.creditBalance!)}{' '}
                              {t('account.credits', 'credits')})
                            </span>
                          )}
                        </span>
                      )
                    })}
                  </div>
                </button>
              ))}
              {tokenTruncation && (
                <div className={`text-[10px] ${mutedClass}`} data-testid="token-holdings-truncated">
                  {t('account.showingFirst', 'Showing first')} {tokenTruncation.shown}{' '}
                  {t('account.of', 'of')} {tokenTruncation.total}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>{t('account.storeItems', 'Store items')}</h2>
          {itemHoldings === null ? (
            <div className={`text-xs ${mutedClass}`}>{t('account.loading', 'Loading…')}</div>
          ) : itemHoldingsError ? (
            <div className="text-xs text-red-500">{itemHoldingsError}</div>
          ) : itemHoldings.length === 0 ? (
            <div className={`text-xs ${mutedClass}`}>
              {t('account.noStoreItems', 'No store items held')}
            </div>
          ) : (
            <div className="space-y-2">
              {itemHoldings.map(row => {
                const chain = chainInfo(row.chainId)
                return (
                  <div
                    key={`${row.chainId}:${row.projectId}`}
                    data-testid="item-holding"
                    className={`p-2 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => goToProject(row.chainId, row.projectId)}
                        className={`text-xs font-medium hover:underline ${
                          isDark ? 'text-juice-cyan' : 'text-teal-600'
                        }`}
                      >
                        {row.name || `Project ${row.projectId}`}
                      </button>
                      {chain && (
                        <span
                          className="inline-flex items-center gap-1 text-[8px] font-bold px-1 py-0.5 rounded"
                          style={{ backgroundColor: `${chain.color}80`, color: 'rgba(255,255,255,0.85)' }}
                        >
                          <ChainLogo chainId={row.chainId} size={12} />
                          {chain.shortName}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1.5">
                      {row.tiers.map(tier => {
                        const media = row.meta?.media?.[tier.tierId]
                        return (
                          <span key={tier.tierId} className="flex items-center gap-1.5 text-[10px]">
                            {media?.imageUri ? (
                              <IpfsImage
                                uri={media.imageUri}
                                alt=""
                                className="w-6 h-6 object-contain shrink-0"
                              />
                            ) : (
                              <span
                                className={`w-6 h-6 shrink-0 inline-flex items-center justify-center text-[8px] ${
                                  isDark ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'
                                }`}
                              >
                                #{tier.tierId}
                              </span>
                            )}
                            <span>
                              {itemLabelFrom(row.meta?.names, tier.tierId)} ({tier.count})
                            </span>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {itemTruncation && (
                <div className={`text-[10px] ${mutedClass}`} data-testid="item-holdings-truncated">
                  {t('account.showingFirst', 'Showing first')} {itemTruncation.shown}{' '}
                  {t('account.of', 'of')} {itemTruncation.total}
                </div>
              )}
            </div>
          )}
        </div>
        </>
        )}

        {/* Owned projects */}
        {activeTab === 'projects' && (
        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>{t('account.ownedProjects', 'Owned projects')}</h2>
          {ownedLoading ? (
            <div className={`text-xs ${mutedClass}`}>{t('account.loading', 'Loading…')}</div>
          ) : ownedError && owned.length === 0 ? (
            <div className="text-xs text-red-500">{ownedError}</div>
          ) : owned.length === 0 ? (
            <div className={`text-xs ${mutedClass}`}>{t('account.noOwned', 'No projects owned')}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {owned.map(row => {
                const chain = chainInfo(row.chainId)
                return (
                  <button
                    key={`${row.chainId}:${row.projectId}`}
                    onClick={() => goToProject(row.chainId, row.projectId)}
                    className={`flex items-center gap-3 p-2 border text-left transition-colors ${
                      isDark
                        ? 'border-white/10 hover:bg-white/5'
                        : 'border-gray-200 hover:bg-black/5'
                    }`}
                  >
                    {row.project.logoUri ? (
                      <IpfsImage
                        uri={row.project.logoUri}
                        alt=""
                        className="w-8 h-8 object-contain shrink-0"
                      />
                    ) : (
                      <div className={`w-8 h-8 shrink-0 ${isDark ? 'bg-white/10' : 'bg-gray-100'}`} />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">
                        {row.project.name || `Project ${row.projectId}`}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {chain && (
                          <span
                            className="inline-flex items-center gap-1 text-[8px] font-bold px-1 py-0.5 rounded"
                            style={{ backgroundColor: `${chain.color}80`, color: 'rgba(255,255,255,0.85)' }}
                          >
                            <ChainLogo chainId={row.chainId} size={12} />
                            {chain.shortName}
                          </span>
                        )}
                        {row.viaSafe && (
                          <span className={`text-[10px] ${mutedClass}`}>
                            {t('account.viaSafe', 'via Safe')} {truncateAddress(row.viaSafe.safe)}
                            {row.viaSafe.threshold != null && row.viaSafe.ownerCount != null
                              ? ` (${row.viaSafe.threshold}/${row.viaSafe.ownerCount})`
                              : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        )}

        {/* Operated projects */}
        {activeTab === 'roles' && (
        <div className={sectionClass}>
          <h2 className={sectionTitleClass}>{t('account.operatedProjects', 'Operated projects')}</h2>
          {operatedLoading ? (
            <div className={`text-xs ${mutedClass}`}>{t('account.loading', 'Loading…')}</div>
          ) : operatedError ? (
            <div className="text-xs text-red-500">{operatedError}</div>
          ) : operated.length === 0 ? (
            <div className={`text-xs ${mutedClass}`}>
              {t('account.noOperated', 'No operator permissions granted to this account')}
            </div>
          ) : (
            <div className="space-y-2">
              {operated.map(row => {
                const chain = chainInfo(row.chainId)
                return (
                  <div
                    key={`${row.chainId}:${row.projectId}`}
                    className={`p-2 border ${isDark ? 'border-white/10' : 'border-gray-200'}`}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => goToProject(row.chainId, row.projectId)}
                        className={`text-xs font-medium hover:underline ${
                          isDark ? 'text-juice-cyan' : 'text-teal-600'
                        }`}
                      >
                        {row.name || `Project ${row.projectId}`}
                      </button>
                      {chain && (
                        <span
                          className="inline-flex items-center gap-1 text-[8px] font-bold px-1 py-0.5 rounded"
                          style={{ backgroundColor: `${chain.color}80`, color: 'rgba(255,255,255,0.85)' }}
                        >
                          <ChainLogo chainId={row.chainId} size={12} />
                          {chain.shortName}
                        </span>
                      )}
                      {row.isRevnetOperator && (
                        <span className="text-[9px] font-bold px-1 py-0.5 border border-juice-cyan text-juice-cyan">
                          {t('account.revnetOperator', 'Revnet operator')}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {row.permissionIds.map(id => (
                        <span
                          key={id}
                          className={`text-[9px] px-1.5 py-0.5 border ${
                            isDark
                              ? 'border-white/20 text-gray-300'
                              : 'border-gray-300 text-gray-600'
                          }`}
                        >
                          {permissionLabel(id)}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
