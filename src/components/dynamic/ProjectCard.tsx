import { useEffect, useState } from 'react'
import { fetchProject, type Project } from '../../services/bendystraw'

interface ProjectCardProps {
  projectId: string
  chainId?: string
}

const chainNames: Record<string, string> = {
  '1': 'Ethereum',
  '10': 'Optimism',
  '42161': 'Arbitrum',
}

export default function ProjectCard({ projectId, chainId = '1' }: ProjectCardProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const data = await fetchProject(projectId, parseInt(chainId))
        setProject(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, chainId])

  if (loading) {
    return (
      <div className="glass  p-4 animate-pulse">
        <div className="h-6 bg-white/10  w-3/4 mb-3" />
        <div className="h-4 bg-white/10  w-1/2 mb-2" />
        <div className="h-4 bg-white/10  w-2/3" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="glass  p-4 border-red-500/30">
        <p className="text-red-400 text-sm">{error || 'Project not found'}</p>
      </div>
    )
  }

  const formatBalance = (wei: string) => {
    const eth = parseFloat(wei) / 1e18
    return eth.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }

  return (
    <div className="glass  p-4 hover:border-juice-orange/30 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {project.logoUri ? (
            <img
              src={project.logoUri}
              alt={project.name}
              className="w-10 h-10  object-cover"
            />
          ) : (
            <div className="w-10 h-10  bg-juice-orange/20 flex items-center justify-center">
              <span className="text-juice-orange font-bold">
                {project.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div>
            <h3 className="font-semibold text-white">{project.name}</h3>
            <p className="text-xs text-gray-400">
              Project #{projectId} on {chainNames[chainId] || `Chain ${chainId}`}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-juice-dark/50  p-2">
          <p className="text-xs text-gray-400">Balance</p>
          <p className="font-mono text-juice-cyan">{formatBalance(project.balance)} ETH</p>
        </div>
        <div className="bg-juice-dark/50  p-2">
          <p className="text-xs text-gray-400">Contributors</p>
          <p className="font-mono text-white">{project.contributorsCount}</p>
        </div>
      </div>

      {/* Description */}
      {project.description && (
        <p className="text-sm text-gray-300 line-clamp-2">{project.description}</p>
      )}

      {/* Actions */}
      <div className="mt-3 pt-3 border-t border-white/10 flex gap-2">
        <a
          href={`https://juicebox.money/v2/p/${projectId}?chainId=${chainId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-juice-orange hover:underline"
        >
          View on Juicebox
        </a>
      </div>
    </div>
  )
}
