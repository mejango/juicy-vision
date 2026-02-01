import { useEffect, useState } from 'react'
import { fetchProject, fetchConnectedChains, type Project } from '../../services/bendystraw'
import { resolveIpfsUri } from '../../utils/ipfs'
import { resolveEnsName, truncateAddress } from '../../utils/ens'
import { useThemeStore } from '../../stores'
import { CHAINS, ALL_CHAIN_IDS } from '../../constants'

interface ProjectChainPickerProps {
  projectId: string
}

interface ProjectOption {
  chainIds: number[]  // Can be multiple if linked via suckers
  projectIds: number[]  // Corresponding project IDs per chain
  name: string
  logoUri?: string
  owner: string
  primaryChainId: number  // The chain to use when selected
}

// Use environment-aware chain info from constants

export default function ProjectChainPicker({ projectId }: ProjectChainPickerProps) {
  const [options, setOptions] = useState<ProjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [ensNames, setEnsNames] = useState<Record<string, string>>({})
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  // Resolve ENS names for all owners
  useEffect(() => {
    if (options.length === 0) return

    const owners = [...new Set(options.map(o => o.owner.toLowerCase()))]

    owners.forEach(async (owner) => {
      const ensName = await resolveEnsName(owner)
      if (ensName) {
        setEnsNames(prev => ({ ...prev, [owner]: ensName }))
      }
    })
  }, [options])

  // Helper to get display name for owner
  const getOwnerDisplay = (owner: string) => {
    const ensName = ensNames[owner.toLowerCase()]
    return ensName || truncateAddress(owner)
  }

  useEffect(() => {
    async function loadProjects() {
      setLoading(true)
      setError(null)

      try {
        // Step 1: Fetch project data from all chains in parallel
        const projectPromises = ALL_CHAIN_IDS.map(async (chainId) => {
          try {
            const project = await fetchProject(projectId, chainId)
            return { chainId, project }
          } catch {
            return { chainId, project: null }
          }
        })

        const results = await Promise.all(projectPromises)
        const foundProjects = results.filter(r => r.project !== null) as { chainId: number; project: Project }[]

        if (foundProjects.length === 0) {
          setError(`Project ${projectId} not found on any chain`)
          setLoading(false)
          return
        }

        // Step 2: Get sucker pairs for each project
        const suckerPromises = foundProjects.map(async ({ chainId, project }) => {
          const connected = await fetchConnectedChains(projectId, chainId)
          return { chainId, project, suckerChainIds: new Set(connected.map(c => c.chainId)) }
        })

        const withSuckers = await Promise.all(suckerPromises)

        // Step 3: Group projects that are ACTUALLY connected via suckers
        // Key insight: only group if BOTH projects list each other in their sucker groups
        const grouped: ProjectOption[] = []
        const processed = new Set<number>()

        for (const { chainId, project, suckerChainIds } of withSuckers) {
          if (processed.has(chainId)) continue

          // Find all other projects that are mutually connected to this one
          const connectedProjects = withSuckers.filter(other => {
            if (other.chainId === chainId) return false
            if (processed.has(other.chainId)) return false
            // Check mutual connection: this project lists the other AND the other lists this
            return suckerChainIds.has(other.chainId) && other.suckerChainIds.has(chainId)
          })

          if (connectedProjects.length > 0) {
            // This project is linked to others via suckers
            const allConnected = [{ chainId, project }, ...connectedProjects.map(p => ({ chainId: p.chainId, project: p.project }))]
            const chainIds = allConnected.map(p => p.chainId)
            const projectIds = allConnected.map(() => parseInt(projectId))

            // Mark all as processed
            chainIds.forEach(id => processed.add(id))

            grouped.push({
              chainIds,
              projectIds,
              name: project.name,
              logoUri: project.logoUri,
              owner: project.owner,
              primaryChainId: chainId,
            })
          } else {
            // Standalone project on this chain (not connected via suckers)
            processed.add(chainId)
            grouped.push({
              chainIds: [chainId],
              projectIds: [parseInt(projectId)],
              name: project.name,
              logoUri: project.logoUri,
              owner: project.owner,
              primaryChainId: chainId,
            })
          }
        }

        setOptions(grouped)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects')
      } finally {
        setLoading(false)
      }
    }

    loadProjects()
  }, [projectId])

  const handleSubmit = () => {
    const selected = options[selectedIndex]
    if (!selected) return

    // Send message with the selection
    const chainNames = selected.chainIds.map(id => CHAINS[id]?.name).filter(Boolean).join(' + ')
    const message = `Show me ${selected.name} on ${chainNames} (chainId: ${selected.primaryChainId})`

    window.dispatchEvent(new CustomEvent('juice:send-message', { detail: { message } }))
  }

  if (loading) {
    return (
      <div className={`inline-block border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <span className="w-2 h-2 bg-juice-orange rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-juice-orange rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-juice-orange rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Looking up project {projectId} on all chains...
          </span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`inline-block border p-4 ${
        isDark ? 'bg-juice-dark-lighter border-red-500/30' : 'bg-white border-red-200'
      }`}>
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    )
  }

  if (options.length === 1) {
    // Only one option - auto-select it
    const option = options[0]
    const chainNames = option.chainIds.map(id => CHAINS[id]?.name).filter(Boolean).join(' + ')

    return (
      <div className={`inline-block border overflow-hidden ${
        isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
      }`}>
        <div className="p-3">
          <div className="flex items-center gap-3">
            {option.logoUri ? (
              <img
                src={resolveIpfsUri(option.logoUri) ?? undefined}
                alt={option.name}
                className="w-10 h-10 object-cover"
              />
            ) : (
              <div className="w-10 h-10 bg-juice-orange/20 flex items-center justify-center">
                <span className="text-juice-orange font-bold">{option.name.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {option.name}
              </div>
              <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {chainNames}
              </div>
              <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Owner: {getOwnerDisplay(option.owner)}
              </div>
            </div>
          </div>
        </div>
        <div className={`px-3 py-2 border-t flex justify-end ${
          isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'
        }`}>
          <button
            onClick={handleSubmit}
            className="px-3 py-1 text-sm font-medium bg-green-500 text-black hover:bg-green-600 transition-colors"
          >
            Pay project
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`inline-block border overflow-hidden ${
      isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'
    }`}>
      <div className="p-3">
        <div className="space-y-2">
          {options.map((option, index) => {
            const chainNames = option.chainIds.map(id => CHAINS[id]?.name).filter(Boolean).join(' + ')
            const isSelected = index === selectedIndex

            return (
              <button
                key={option.primaryChainId}
                onClick={() => setSelectedIndex(index)}
                className={`w-full flex items-center gap-3 p-2 border-l-2 transition-all text-left ${
                  isSelected
                    ? 'border-l-green-500'
                    : isDark
                      ? 'border-l-transparent hover:border-l-white/30'
                      : 'border-l-transparent hover:border-l-gray-400'
                }`}
              >
                {/* Radio indicator */}
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  isSelected
                    ? 'border-green-500'
                    : isDark ? 'border-gray-500' : 'border-gray-400'
                }`}>
                  {isSelected && (
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                  )}
                </div>

                {/* Logo */}
                {option.logoUri ? (
                  <img
                    src={resolveIpfsUri(option.logoUri) ?? undefined}
                    alt={option.name}
                    className="w-10 h-10 object-cover shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 bg-juice-orange/20 flex items-center justify-center shrink-0">
                    <span className="text-juice-orange font-bold text-sm">{option.name.charAt(0).toUpperCase()}</span>
                  </div>
                )}

                {/* Name, chains, owner, and balance */}
                <div className="flex-1 min-w-0">
                  <div className={`font-medium truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {option.name}
                  </div>
                  <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {chainNames}
                  </div>
                  <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    Owner: {getOwnerDisplay(option.owner)}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Submit row */}
      <div className={`px-3 py-2 border-t flex items-center justify-between ${
        isDark ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'
      }`}>
        <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {options[selectedIndex]?.name}
        </div>
        <button
          onClick={handleSubmit}
          className="px-3 py-1 text-sm font-medium bg-green-500 text-black hover:bg-green-600 transition-colors"
        >
          Pay project
        </button>
      </div>
    </div>
  )
}
