import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../stores'
import { fetchProjects, type Project } from '../../services/bendystraw'
import { resolveEnsToAddress, truncateAddress } from '../../utils/ens'
import { projectPathFor } from '../../utils/projectLink'

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/
// Loose ENS shape: dot-separated labels (e.g. "jango.eth"). Actual validity is
// decided by forward resolution — this only gates when we bother resolving.
const ENS_REGEX = /^[a-z0-9][a-z0-9-_]*(\.[a-z0-9][a-z0-9-_]*)+$/i
const ENS_DEBOUNCE_MS = 300
const MAX_PROJECT_ROWS = 6
const PROJECT_FETCH_COUNT = 100

interface ProjectRow {
  projectId: number
  name: string
  logoUri?: string
  chainIds: number[]
}

type ResultRow =
  | { kind: 'account'; label: string; sublabel?: string; to: string }
  | { kind: 'project'; project: ProjectRow; to: string }

/**
 * Same grouping rules as TrendingProjects: bendystraw returns one row per
 * chain, collapse to one row per projectId (V6 only) with chains combined.
 */
function groupProjects(projects: Project[]): ProjectRow[] {
  const grouped = new Map<number, ProjectRow>()
  for (const p of projects) {
    if ((p.version || 6) !== 6) continue
    const existing = grouped.get(p.projectId)
    if (existing) {
      if (!existing.chainIds.includes(Number(p.chainId))) existing.chainIds.push(Number(p.chainId))
      if (!existing.logoUri && p.logoUri) { existing.logoUri = p.logoUri; existing.name = p.name }
    } else {
      grouped.set(p.projectId, {
        projectId: p.projectId,
        name: p.name || `Project #${p.projectId}`,
        logoUri: p.logoUri,
        chainIds: [Number(p.chainId)],
      })
    }
  }
  return [...grouped.values()]
}

function projectPath(row: ProjectRow): string | null {
  return projectPathFor(row.chainIds[0], row.projectId)
}

/**
 * The app's project/account search. Matches indexed V6 projects by name or ID,
 * and recognizes 0x addresses and ENS names — those get an "Account" row that
 * routes to /account/:address (AccountRouteHandler forward-resolves ENS).
 */
export default function ProjectSearch() {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [ensMatch, setEnsMatch] = useState<{ name: string; address: string } | null>(null)
  const projectsRequested = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const trimmed = query.trim()
  const isAddress = ADDRESS_REGEX.test(trimmed)

  // Lazy-load the searchable project list the first time the input is used.
  const ensureProjects = () => {
    if (projectsRequested.current) return
    projectsRequested.current = true
    fetchProjects({ first: PROJECT_FETCH_COUNT, orderBy: 'volume', orderDirection: 'desc' })
      .then(list => setProjects(groupProjects(list)))
      .catch(() => setProjects([]))
  }

  // Debounced forward ENS resolution for ENS-looking queries. Failure simply
  // yields no account row.
  useEffect(() => {
    setEnsMatch(null)
    if (isAddress || !ENS_REGEX.test(trimmed)) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      resolveEnsToAddress(trimmed).then(address => {
        if (!cancelled && address) setEnsMatch({ name: trimmed, address })
      })
    }, ENS_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [trimmed, isAddress])

  // Account row (address or resolved ENS) always sorts first so Enter on a
  // pure address / resolved name prefers it.
  const rows = useMemo<ResultRow[]>(() => {
    const out: ResultRow[] = []
    if (isAddress) {
      out.push({ kind: 'account', label: truncateAddress(trimmed), to: `/account/${trimmed}` })
    } else if (ensMatch && ensMatch.name === trimmed) {
      out.push({
        kind: 'account',
        label: ensMatch.name,
        sublabel: truncateAddress(ensMatch.address),
        to: `/account/${ensMatch.name}`,
      })
    }
    if (trimmed && projects) {
      const q = trimmed.toLowerCase()
      const matches = projects.filter(
        p => p.name.toLowerCase().includes(q) || String(p.projectId) === q,
      )
      for (const p of matches.slice(0, MAX_PROJECT_ROWS)) {
        const to = projectPath(p)
        if (to) out.push({ kind: 'project', project: p, to })
      }
    }
    return out
  }, [trimmed, isAddress, ensMatch, projects])

  // Reset keyboard cursor whenever the query changes.
  useEffect(() => {
    setActiveIndex(0)
  }, [trimmed])

  const select = (row: ResultRow) => {
    setQuery('')
    setOpen(false)
    navigate(row.to)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, Math.max(rows.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const row = rows[Math.min(activeIndex, rows.length - 1)]
      if (row) select(row)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showDropdown = open && trimmed.length > 0

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={e => {
        if (!containerRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <input
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-label={t('ui.searchAria', 'Search projects and accounts')}
        value={query}
        onFocus={() => {
          setOpen(true)
          ensureProjects()
        }}
        onChange={e => {
          setQuery(e.target.value)
          setOpen(true)
          ensureProjects()
        }}
        onKeyDown={handleKeyDown}
        placeholder={t('ui.searchPlaceholder', 'Search projects, 0x address, or ENS…')}
        className={`w-full px-2 py-1.5 text-xs border bg-transparent focus:outline-none transition-colors ${
          isDark
            ? 'border-white/20 text-gray-200 placeholder-gray-600 focus:border-white/40'
            : 'border-gray-300 text-gray-800 placeholder-gray-400 focus:border-gray-400'
        }`}
      />
      {showDropdown && (
        <div
          role="listbox"
          className={`absolute inset-x-0 top-full z-30 border max-h-72 overflow-y-auto ${
            isDark ? 'bg-juice-dark border-white/20' : 'bg-white border-gray-300'
          }`}
        >
          {rows.map((row, i) => (
            <button
              key={row.kind === 'project' ? `p:${row.project.projectId}` : `a:${row.to}`}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => select(row)}
              className={`w-full flex items-center gap-2 px-2 py-2 text-left border-b last:border-b-0 transition-colors ${
                isDark ? 'border-white/10' : 'border-gray-100'
              } ${
                i === activeIndex
                  ? isDark ? 'bg-white/10' : 'bg-gray-100'
                  : isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'
              }`}
            >
              {row.kind === 'account' ? (
                <>
                  <span
                    className={`w-7 h-7 shrink-0 flex items-center justify-center ${
                      isDark ? 'bg-juice-cyan/20 text-juice-cyan' : 'bg-teal-50 text-teal-600'
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-xs truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {row.label}
                    </span>
                    {row.sublabel && (
                      <span className={`block text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {row.sublabel}
                      </span>
                    )}
                  </span>
                  <span className={`text-[11px] shrink-0 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {t('ui.viewAccount', 'View account')}
                  </span>
                </>
              ) : (
                <>
                  {row.project.logoUri ? (
                    <img
                      src={row.project.logoUri.replace('ipfs://', 'https://ipfs.io/ipfs/')}
                      alt=""
                      className="w-7 h-7 object-cover shrink-0"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <span
                      className={`w-7 h-7 shrink-0 flex items-center justify-center text-xs ${
                        isDark ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {row.project.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="flex-1 min-w-0">
                    <span className={`block text-xs truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {row.project.name}
                    </span>
                    <span className={`block text-[11px] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      #{row.project.projectId}
                      {row.project.chainIds.length > 1 ? ` | ${row.project.chainIds.length} chains` : ''}
                    </span>
                  </span>
                </>
              )}
            </button>
          ))}
          {rows.length === 0 && (
            <div className={`px-2 py-2 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {projects === null
                ? t('ui.searching', 'Searching…')
                : t('ui.noMatches', 'No matches')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
