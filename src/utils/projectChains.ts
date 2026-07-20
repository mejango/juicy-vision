import { fetchConnectedChains, type ConnectedChain } from '../services/bendystraw'

interface ProjectChainResolution {
  chains: ConnectedChain[]
  mappingAvailable: boolean
  error?: string
}

/** A chain the project lives on, with the project's id ON THAT CHAIN. */
export interface ChainProjectId {
  chainId: number
  projectId: number | string
}

/**
 * Build a per-chain project-id resolver. V6 project ids are independent per
 * chain, so every per-chain read/tx must use the id for that specific chain.
 * A chain absent from the map returns null ("project not on this chain") — the
 * caller must skip it, NEVER fall back to the home id on a non-home chain.
 */
export function makeProjectIdResolver(
  chainProjects: ReadonlyArray<ChainProjectId> | undefined,
  home: ChainProjectId,
): (chainId: number) => bigint | null {
  const source = chainProjects && chainProjects.length ? chainProjects : [home]
  const map = new Map<number, bigint>(source.map(cp => [cp.chainId, BigInt(cp.projectId)]))
  return chainId => map.get(chainId) ?? null
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
