import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../stores'
import { useTransactionStore, type Transaction } from '../stores/transactionStore'
import { useEnsNameResolved } from '../hooks'
import { useRelayrStatus } from '../hooks/relayr'
import { useAllChainBalances } from '../components/wallet/useAllChainBalances'
import ActivityItem from '../components/chat/ActivityItem'
import { IpfsImage } from '../components/ui/IpfsMedia'
import {
  fetchAccountActivityEvents,
  fetchAccountOperatedPermissions,
  fetchProjectsByOwner,
  type ActivityEvent,
  type Project,
} from '../services/bendystraw'
import { resolveProjectNameForDisplay } from '../services/bendystraw/client'
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
import { resolveEnsToAddress, truncateAddress } from '../utils/ens'
import { CHAINS, MAINNET_CHAINS } from '../constants'
import type { Address } from 'viem'

const ACTIVITY_PAGE_SIZE = 25
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/

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
                  className="text-[8px] font-bold px-1 py-0.5 rounded"
                  style={{ backgroundColor: `${chain.color}80`, color: 'rgba(255,255,255,0.85)' }}
                >
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
  const { address: connectedAddress } = useAccount()
  const isSelf = !!connectedAddress && connectedAddress.toLowerCase() === address.toLowerCase()

  const { ensName } = useEnsNameResolved(address)
  const { balances, loading: balancesLoading } = useAllChainBalances(address)

  // "View as" input
  const [viewAsInput, setViewAsInput] = useState('')
  const [viewAsError, setViewAsError] = useState<string | null>(null)
  const [viewAsResolving, setViewAsResolving] = useState(false)

  // Activity
  const [events, setEvents] = useState<ActivityEvent[]>([])
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

  const goToProject = useCallback(
    (chainId: number, projectId: number) => {
      const slug = chainInfo(chainId)?.slug
      if (slug) navigate(`/${slug}:${projectId}`)
    },
    [navigate]
  )

  // Load first page of activity on address change
  useEffect(() => {
    let cancelled = false
    setEvents([])
    setActivityLoading(true)
    setActivityError(null)
    setHasMore(false)
    fetchAccountActivityEvents(address, { limit: ACTIVITY_PAGE_SIZE, offset: 0 })
      .then(page => {
        if (cancelled) return
        setEvents(page)
        setHasMore(page.length >= ACTIVITY_PAGE_SIZE)
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
      const page = await fetchAccountActivityEvents(address, {
        limit: ACTIVITY_PAGE_SIZE,
        offset: events.length,
      })
      setEvents(prev => {
        const known = new Set(prev.map(e => e.id))
        return [...prev, ...page.filter(e => !known.has(e.id))]
      })
      setHasMore(page.length >= ACTIVITY_PAGE_SIZE)
    } catch {
      setHasMore(false)
    } finally {
      setLoadingMore(false)
    }
  }, [address, events.length])

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

  const confirmedHashes = useMemo(() => {
    const set = new Set<string>()
    for (const event of events) {
      const hash = 'txHash' in event ? event.txHash : undefined
      if (hash) set.add(hash.toLowerCase())
    }
    return set
  }, [events])

  const handleViewAs = useCallback(async () => {
    const input = viewAsInput.trim()
    if (!input) return
    setViewAsError(null)
    if (ADDRESS_REGEX.test(input)) {
      navigate(`/account/${input}`)
      setViewAsInput('')
      return
    }
    if (input.includes('.')) {
      setViewAsResolving(true)
      try {
        const resolved = await resolveEnsToAddress(input)
        if (resolved) {
          navigate(`/account/${resolved}`)
          setViewAsInput('')
        } else {
          setViewAsError(t('account.viewAsNotFound', 'Could not resolve that name'))
        }
      } finally {
        setViewAsResolving(false)
      }
      return
    }
    setViewAsError(t('account.viewAsInvalid', 'Enter a 0x address or ENS name'))
  }, [viewAsInput, navigate, t])

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

          {/* View as */}
          <div className="w-full sm:w-64">
            <div className="flex gap-1">
              <input
                value={viewAsInput}
                onChange={e => setViewAsInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleViewAs()
                }}
                placeholder={t('account.viewAsPlaceholder', 'View as address or ENS…')}
                className={`flex-1 min-w-0 px-2 py-1.5 text-xs border bg-transparent outline-none focus:border-juice-orange ${
                  isDark ? 'border-white/20 placeholder-gray-500' : 'border-gray-300 placeholder-gray-400'
                }`}
              />
              <button
                onClick={() => void handleViewAs()}
                disabled={viewAsResolving}
                className="px-3 py-1.5 text-xs bg-juice-orange text-juice-dark font-medium hover:bg-juice-orange/90 transition-colors disabled:opacity-50"
              >
                {viewAsResolving ? '…' : t('account.viewAs', 'View')}
              </button>
            </div>
            {viewAsError && <div className="text-[10px] mt-1 text-red-500">{viewAsError}</div>}
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
                  <div className={`text-[10px] font-bold ${mutedClass}`}>{b.chainName}</div>
                  <div>{parseFloat(b.eth).toFixed(4)} ETH</div>
                  <div>{parseFloat(b.usdc).toFixed(2)} USDC</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity */}
        <div className={`${sectionClass} mb-4`}>
          <h2 className={sectionTitleClass}>{t('account.activity', 'Activity')}</h2>
          {isSelf && <InFlightActivity address={address} confirmedHashes={confirmedHashes} />}
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

        {/* Owned projects */}
        <div className={`${sectionClass} mb-4`}>
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
                            className="text-[8px] font-bold px-1 py-0.5 rounded"
                            style={{ backgroundColor: `${chain.color}80`, color: 'rgba(255,255,255,0.85)' }}
                          >
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

        {/* Operated projects */}
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
                          className="text-[8px] font-bold px-1 py-0.5 rounded"
                          style={{ backgroundColor: `${chain.color}80`, color: 'rgba(255,255,255,0.85)' }}
                        >
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
      </div>
    </div>
  )
}
