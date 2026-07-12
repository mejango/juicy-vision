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
import type { IpfsProjectMetadata } from '../utils/ipfs'

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

  // A missing sucker/indexer result does not prove the same project ID exists
  // elsewhere. Fall back only to the chain the caller actually supplied.
  const availableChains = useMemo(
    () => connectedChains.length > 0
      ? connectedChains
      : [{ chainId: parseInt(initialChainId), projectId: parseInt(projectId) }],
    [connectedChains, initialChainId, projectId],
  )

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
      try {
        const chains = await fetchConnectedChains(projectId, parseInt(initialChainId))
        setConnectedChains(chains)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Connected project chains unavailable')
      }
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

        setFullMetadata((data.metadata as IpfsProjectMetadata | undefined) ?? null)
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
