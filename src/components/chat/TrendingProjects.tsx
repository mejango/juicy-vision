import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useThemeStore } from '../../stores'
import { fetchProjects, type Project } from '../../services/bendystraw'
import { CHAINS } from '../../constants'
import { projectPathFor } from '../../utils/projectLink'
import { rememberProjectNavigation } from '../../utils/projectNavigationCache'

interface TrendingProjectsProps {
  onProjectClick?: (query: string) => void
}

interface TrendingRow {
  projectId: number
  name: string
  logoUri?: string
  chainIds: number[]
  score: bigint
  payments: number
}

/**
 * V6-only trending list for the right sidebar. Same grouping rules as
 * TopProjects: one row per projectId with chains combined (bendystraw returns
 * one row per chain), ranked by summed trendingScore.
 */
export default function TrendingProjects({ onProjectClick }: TrendingProjectsProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const [rows, setRows] = useState<TrendingRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchProjects({ first: 60, orderBy: 'trendingScore', orderDirection: 'desc' })
      .then((projects) => {
        if (cancelled) return
        const grouped = new Map<number, TrendingRow>()
        for (const p of projects as Project[]) {
          if ((p.version || 6) !== 6) continue
          const score = BigInt((p.trendingScore || '0').split('.')[0] || '0')
          const existing = grouped.get(p.projectId)
          if (existing) {
            if (!existing.chainIds.includes(Number(p.chainId))) existing.chainIds.push(Number(p.chainId))
            existing.score += score
            existing.payments += p.trendingPaymentsCount || 0
            if (!existing.logoUri && p.logoUri) { existing.logoUri = p.logoUri; existing.name = p.name }
          } else {
            grouped.set(p.projectId, {
              projectId: p.projectId,
              name: p.name || `Project #${p.projectId}`,
              logoUri: p.logoUri,
              chainIds: [Number(p.chainId)],
              score,
              payments: p.trendingPaymentsCount || 0,
            })
          }
        }
        const top = [...grouped.values()]
          .filter((r) => r.score > 0n)
          .sort((a, b) => (b.score > a.score ? 1 : b.score < a.score ? -1 : 0))
          .slice(0, 10)
        setRows(top)
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  const handleClick = (row: TrendingRow) => {
    if (!onProjectClick) return
    const chainId = row.chainIds[0]
    const chainName = CHAINS[chainId]?.name || `chain ${chainId}`
    onProjectClick(`Tell me about "${row.name}" on ${chainName} (chain ID ${chainId}). What's the project's current state, treasury balance, and recent activity?`)
  }

  if (error) {
    return <div className={`text-xs py-3 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Couldn’t load trending projects.</div>
  }
  if (rows === null) {
    return (
      <div className="py-2 space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={`h-8 animate-pulse ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
        ))}
      </div>
    )
  }
  if (rows.length === 0) {
    return <div className={`text-xs py-3 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Nothing trending right now.</div>
  }

  return (
    <div className="py-1">
      {rows.map((row, i) => {
        // The row keeps the ask-the-chat behavior; the project name itself is
        // a real link to the project page (it stops propagation).
        const path = projectPathFor(row.chainIds[0], row.projectId)
        return (
          <div
            key={row.projectId}
            role="button"
            tabIndex={0}
            onClick={() => handleClick(row)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleClick(row)
            }}
            className={`flex items-center gap-2.5 px-3 py-3 -mx-4 border-b text-left cursor-pointer transition-colors ${
              isDark ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span className={`text-xs w-4 text-right shrink-0 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {i + 1}
            </span>
            {row.logoUri ? (
              <img
                src={row.logoUri.replace('ipfs://', 'https://ipfs.io/ipfs/')}
                alt=""
                className="w-10 h-10 object-cover shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <span className={`w-10 h-10 shrink-0 flex items-center justify-center text-sm ${isDark ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                {row.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="flex-1 min-w-0">
              {path ? (
                <Link
                  to={path}
                  onPointerDown={() =>
                    rememberProjectNavigation({
                      chainId: row.chainIds[0],
                      projectId: row.projectId,
                      name: row.name,
                      logoUri: row.logoUri,
                    })
                  }
                  onFocus={() =>
                    rememberProjectNavigation({
                      chainId: row.chainIds[0],
                      projectId: row.projectId,
                      name: row.name,
                      logoUri: row.logoUri,
                    })
                  }
                  onClick={(e) => {
                    rememberProjectNavigation({
                      chainId: row.chainIds[0],
                      projectId: row.projectId,
                      name: row.name,
                      logoUri: row.logoUri,
                    })
                    e.stopPropagation()
                  }}
                  className={`block text-xs truncate hover:underline ${isDark ? 'text-white' : 'text-gray-900'}`}
                  title={`Open ${row.name}`}
                >
                  {row.name}
                </Link>
              ) : (
                <span className={`block text-xs truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>{row.name}</span>
              )}
              <span className={`block text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {row.payments} payment{row.payments === 1 ? '' : 's'}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
