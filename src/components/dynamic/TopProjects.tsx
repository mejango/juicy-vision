import { useState, useEffect } from 'react'
import { fetchProjects, type Project } from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { useThemeStore } from '../../stores'

interface TopProjectsProps {
  limit?: number
  orderBy?: 'volume' | 'volumeUsd' | 'balance' | 'contributorsCount' | 'paymentsCount' | 'trendingScore'
}

const CHAIN_INFO: Record<number, { name: string; color: string }> = {
  1: { name: 'ETH', color: '#627EEA' },
  10: { name: 'OP', color: '#FF0420' },
  8453: { name: 'Base', color: '#0052FF' },
  42161: { name: 'Arb', color: '#28A0F0' },
}

function formatVolumeUsd(volumeUsd: string | undefined): string {
  if (!volumeUsd || volumeUsd === '0') return '$0'

  try {
    // volumeUsd comes in 18 decimal format, use BigInt for precision
    const raw = BigInt(volumeUsd.split('.')[0]) // Handle any decimals in string
    const usd = Number(raw / BigInt(1e12)) / 1e6 // Divide in steps to preserve precision

    if (usd >= 1000000) {
      return `$${(usd / 1000000).toFixed(1)}M`
    }
    if (usd >= 1000) {
      return `$${(usd / 1000).toFixed(1)}k`
    }
    if (usd >= 1) {
      return `$${usd.toFixed(0)}`
    }
    return `$${usd.toFixed(2)}`
  } catch {
    return '$0'
  }
}

function formatTrendingVolume(trendingVolume: string | undefined): string {
  if (!trendingVolume || trendingVolume === '0') return '$0'

  try {
    // trendingVolume is in wei (18 decimals)
    const raw = BigInt(trendingVolume.split('.')[0])
    const eth = Number(raw) / 1e18

    // Assume ~$3500/ETH for display (rough estimate)
    const usd = eth * 3500

    if (usd >= 1000000) {
      return `$${(usd / 1000000).toFixed(1)}M`
    }
    if (usd >= 1000) {
      return `$${(usd / 1000).toFixed(1)}k`
    }
    if (usd >= 1) {
      return `$${usd.toFixed(0)}`
    }
    return `$${usd.toFixed(2)}`
  } catch {
    return '$0'
  }
}

export default function TopProjects({
  limit = 10,
  orderBy = 'trendingScore'
}: TopProjectsProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  useEffect(() => {
    async function loadProjects() {
      setLoading(true)
      setError(null)

      try {
        // Fetch more projects to account for grouping
        const data = await fetchProjects({
          first: limit * 4,
          orderBy,
          orderDirection: 'desc'
        })

        // Group projects by projectId + version (V4 and V5 are different projects!)
        // Same project can exist on multiple chains, but different versions are separate
        const isTrending = orderBy === 'trendingScore'
        const grouped = new Map<string, Project & {
          chainIds: number[]
          totalScoreBigInt: bigint
          totalTrendingVolume: bigint
          totalTrendingPayments: number
        }>()

        for (const project of data) {
          // Key includes version so V4 #1 and V5 #1 stay separate
          const groupKey = `${project.projectId}-v${project.version || 4}`
          const existing = grouped.get(groupKey)

          // Get the score value based on orderBy
          const rawScore = isTrending
            ? (project.trendingScore || '0')
            : (project.volumeUsd || '0')
          const projectScoreBigInt = BigInt(rawScore.split('.')[0] || '0')
          const trendingVolumeBigInt = BigInt((project.trendingVolume || '0').split('.')[0] || '0')
          const trendingPayments = project.trendingPaymentsCount || 0

          if (existing) {
            // Add to existing group (deduplicate chainIds)
            const chainIdNum = Number(project.chainId)
            if (!existing.chainIds.includes(chainIdNum)) {
              existing.chainIds.push(chainIdNum)
            }
            existing.totalScoreBigInt += projectScoreBigInt
            existing.totalTrendingVolume += trendingVolumeBigInt
            existing.totalTrendingPayments += trendingPayments
            // Update strings to reflect totals
            if (isTrending) {
              existing.trendingScore = existing.totalScoreBigInt.toString()
              existing.trendingVolume = existing.totalTrendingVolume.toString()
              existing.trendingPaymentsCount = existing.totalTrendingPayments
            } else {
              existing.volumeUsd = existing.totalScoreBigInt.toString()
            }
            // Keep the best metadata (prefer one with logo)
            if (!existing.logoUri && project.logoUri) {
              existing.logoUri = project.logoUri
              existing.name = project.name
            }
          } else {
            // Create new group
            grouped.set(groupKey, {
              ...project,
              chainIds: [Number(project.chainId)],
              totalScoreBigInt: projectScoreBigInt,
              totalTrendingVolume: trendingVolumeBigInt,
              totalTrendingPayments: trendingPayments,
            })
          }
        }

        // Convert to array, sort by score, take top N
        const combined = Array.from(grouped.values())
          .sort((a, b) => {
            if (a.totalScoreBigInt > b.totalScoreBigInt) return -1
            if (a.totalScoreBigInt < b.totalScoreBigInt) return 1
            return 0
          })
          .slice(0, limit)

        setProjects(combined)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects')
      } finally {
        setLoading(false)
      }
    }

    loadProjects()
  }, [limit, orderBy])

  const handleProjectClick = (project: Project) => {
    const message = `Tell me about ${project.name} (project ${project.projectId} on chain ${project.chainId})`
    window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message } }))
  }

  if (loading) {
    return (
      <div className={`rounded-lg border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <span className="w-2 h-2 bg-juice-orange rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-juice-orange rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-juice-orange rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Loading top projects...
          </span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`rounded-lg border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-red-500/30' : 'bg-white border-red-200'
      }`}>
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    )
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b ${
        isDark ? 'border-white/10' : 'border-gray-100'
      }`}>
        <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          {orderBy === 'trendingScore' ? 'Trending Projects' : 'Top Projects by Volume'}
        </span>
        {orderBy === 'trendingScore' && (
          <span className={`ml-2 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            7-day window
          </span>
        )}
      </div>

      {/* Projects list */}
      <div className="divide-y divide-white/5">
        {projects.map((project, index) => {
          // Get chainIds from grouped project or fall back to single chain
          const chainIds = (project as Project & { chainIds?: number[] }).chainIds || [project.chainId]

          return (
            <button
              key={project.id}
              onClick={() => handleProjectClick(project)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                isDark
                  ? 'hover:bg-white/5'
                  : 'hover:bg-gray-50'
              }`}
            >
              {/* Rank */}
              <div className={`w-6 text-center font-bold ${
                index === 0 ? 'text-yellow-400' :
                index === 1 ? 'text-gray-300' :
                index === 2 ? 'text-amber-600' :
                isDark ? 'text-gray-500' : 'text-gray-400'
              }`}>
                {index + 1}
              </div>

              {/* Logo */}
              {project.logoUri ? (
                <img
                  src={resolveIpfsUri(project.logoUri) ?? undefined}
                  alt={project.name}
                  className="w-10 h-10 rounded-lg object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-juice-orange/20 flex items-center justify-center">
                  <span className="text-juice-orange font-bold">
                    {project.name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}

              {/* Name and chains */}
              <div className="flex-1 min-w-0">
                <div className={`font-medium truncate ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}>
                  {project.name}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {chainIds.map(chainId => {
                    const chain = CHAIN_INFO[chainId]
                    const version = project.version || 4
                    return (
                      <span
                        key={chainId}
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: `${chain?.color}20`,
                          color: chain?.color
                        }}
                      >
                        V{version} {chain?.name || `${chainId}`} #{project.projectId}
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* Volume/Trending info */}
              <div className="text-right">
                <div className={`font-mono font-medium ${
                  isDark ? 'text-emerald-400' : 'text-emerald-600'
                }`}>
                  {orderBy === 'trendingScore'
                    ? formatTrendingVolume(project.trendingVolume)
                    : formatVolumeUsd(project.volumeUsd)}
                </div>
                <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {orderBy === 'trendingScore'
                    ? `${project.trendingPaymentsCount || 0} payments`
                    : 'total volume'}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className={`px-4 py-2 text-xs ${
        isDark ? 'bg-white/5 text-gray-500' : 'bg-gray-50 text-gray-400'
      }`}>
        Click a project to learn more
      </div>
    </div>
  )
}
