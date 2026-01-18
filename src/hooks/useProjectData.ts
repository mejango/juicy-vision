import { useState, useEffect, useMemo } from 'react'
import {
  fetchProject,
  fetchConnectedChains,
  fetchIssuanceRate,
  fetchSuckerGroupBalance,
  fetchOwnersCount,
  fetchEthPrice,
  fetchProjectTokenSymbol,
  type Project,
  type ConnectedChain,
  type IssuanceRate,
  type SuckerGroupBalance,
} from '../services/bendystraw'
import { fetchIpfsMetadata, type IpfsProjectMetadata } from '../utils/ipfs'

// All chains as fallback when no sucker data available
const ALL_CHAINS: ConnectedChain[] = [
  { chainId: 1, projectId: 0 },
  { chainId: 10, projectId: 0 },
  { chainId: 8453, projectId: 0 },
  { chainId: 42161, projectId: 0 },
]

export interface UseProjectDataOptions {
  projectId: string
  initialChainId?: string
}

export interface UseProjectDataReturn {
  // Core project data
  project: Project | null
  loading: boolean
  error: string | null

  // Chain selection
  selectedChainId: string
  setSelectedChainId: (chainId: string) => void
  connectedChains: ConnectedChain[]
  availableChains: ConnectedChain[]
  currentProjectId: string

  // Derived data
  issuanceRate: IssuanceRate | null
  suckerBalance: SuckerGroupBalance | null
  ownersCount: number | null
  ethPrice: number | null
  projectTokenSymbol: string | null
  fullMetadata: IpfsProjectMetadata | null
}

export function useProjectData({
  projectId,
  initialChainId = '1',
}: UseProjectDataOptions): UseProjectDataReturn {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedChainId, setSelectedChainId] = useState(initialChainId)
  const [connectedChains, setConnectedChains] = useState<ConnectedChain[]>([])
  const [issuanceRate, setIssuanceRate] = useState<IssuanceRate | null>(null)
  const [fullMetadata, setFullMetadata] = useState<IpfsProjectMetadata | null>(null)
  const [suckerBalance, setSuckerBalance] = useState<SuckerGroupBalance | null>(null)
  const [ethPrice, setEthPrice] = useState<number | null>(null)
  const [ownersCount, setOwnersCount] = useState<number | null>(null)
  const [projectTokenSymbol, setProjectTokenSymbol] = useState<string | null>(null)

  // Use connected chains if available, otherwise fall back to all chains
  const availableChains = connectedChains.length > 0 ? connectedChains : ALL_CHAINS

  // Get the current project ID for the selected chain (may differ from initial projectId)
  const currentProjectId = useMemo(() => {
    const chainData = availableChains.find(c => c.chainId === parseInt(selectedChainId))
    return (chainData?.projectId && chainData.projectId !== 0)
      ? chainData.projectId.toString()
      : projectId
  }, [availableChains, selectedChainId, projectId])

  // Fetch connected chains on mount
  useEffect(() => {
    async function loadConnectedChains() {
      const chains = await fetchConnectedChains(projectId, parseInt(initialChainId))
      setConnectedChains(chains)
    }
    loadConnectedChains()
  }, [projectId, initialChainId])

  // Fetch ETH price on mount
  useEffect(() => {
    fetchEthPrice().then(setEthPrice)
  }, [])

  // Fetch project data and related info when chain changes
  useEffect(() => {
    async function load() {
      try {
        setLoading(true)
        const chainIdNum = parseInt(selectedChainId)
        const [data, rate, groupBalance, owners, tokenSymbol] = await Promise.all([
          fetchProject(currentProjectId, chainIdNum),
          fetchIssuanceRate(currentProjectId, chainIdNum),
          fetchSuckerGroupBalance(currentProjectId, chainIdNum),
          fetchOwnersCount(currentProjectId, chainIdNum),
          fetchProjectTokenSymbol(currentProjectId, chainIdNum),
        ])
        setProject(data)
        setIssuanceRate(rate)
        setSuckerBalance(groupBalance)
        setOwnersCount(owners)
        setProjectTokenSymbol(tokenSymbol)

        // Fetch full metadata from IPFS if metadataUri available
        if (data.metadataUri) {
          const ipfsMetadata = await fetchIpfsMetadata(data.metadataUri)
          setFullMetadata(ipfsMetadata)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load project')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentProjectId, selectedChainId])

  return {
    project,
    loading,
    error,
    selectedChainId,
    setSelectedChainId,
    connectedChains,
    availableChains,
    currentProjectId,
    issuanceRate,
    suckerBalance,
    ownersCount,
    ethPrice,
    projectTokenSymbol,
    fullMetadata,
  }
}
