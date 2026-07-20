import { fetchConnectedChains, type ConnectedChain } from '../services/bendystraw'

interface ProjectChainResolution {
  chains: ConnectedChain[]
  mappingAvailable: boolean
  error?: string
}

/**
 * Resolve Bendystraw's sucker-group mapping without making it a dependency for
 * current-chain reads or transactions.
 */
export async function resolveProjectChains(
  projectId: string,
  chainId: number,
  loadConnectedChains: typeof fetchConnectedChains = fetchConnectedChains,
): Promise<ProjectChainResolution> {
  const numericProjectId = Number(projectId)
  if (!/^\d+$/.test(projectId) || !Number.isSafeInteger(numericProjectId) || numericProjectId <= 0) {
    throw new Error('Project ID is invalid')
  }
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Chain ID is invalid')

  const current = [{ chainId, projectId: numericProjectId }]
  try {
    const connected = await loadConnectedChains(projectId, chainId)
    return {
      chains: connected.length > 0 ? connected : current,
      mappingAvailable: true,
    }
  } catch (error) {
    return {
      chains: current,
      mappingAvailable: false,
      error: error instanceof Error ? error.message : 'Connected project chains unavailable',
    }
  }
}
