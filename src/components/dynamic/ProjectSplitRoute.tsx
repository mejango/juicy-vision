import { useEffect, useState } from 'react'
import { zeroAddress, type Address } from 'viem'
import { fetchConnectedChains, fetchProject, type ConnectedChain, type Project } from '../../services/bendystraw'
import { ProjectLink } from './ProjectLink'
import { getSafetyPublicClient } from '../../utils/transactionSafety'
import { requireRecognizedRuntimeSplitHook } from '../../utils/projectTrust'
import ChainLogo from '../ui/ChainLogo'

const CHAIN_SLUGS: Record<number, string> = {
  1: 'eth',
  10: 'op',
  8453: 'base',
  42161: 'arb',
  11155111: 'sep',
  11155420: 'opsep',
  84532: 'basesep',
  421614: 'arbsep',
}

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  10: 'Optimism',
  8453: 'Base',
  42161: 'Arbitrum',
  11155111: 'Sepolia',
  11155420: 'OP Sepolia',
  84532: 'Base Sepolia',
  421614: 'Arbitrum Sepolia',
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function ProjectSplitRoute({
  projectId,
  chainId,
  beneficiary,
  kind,
  preferAddToBalance = false,
  hook,
  isDark,
}: {
  projectId: number
  chainId: number
  beneficiary: string
  kind: 'payout' | 'reserved'
  preferAddToBalance?: boolean
  hook?: string
  isDark: boolean
}) {
  const [project, setProject] = useState<Project | null>(null)
  const [connectedProjects, setConnectedProjects] = useState<ConnectedChain[]>([
    { chainId, projectId },
  ])
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [hookStatus, setHookStatus] = useState<'none' | 'checking' | 'recognized' | 'unknown'>('none')

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      fetchProject(String(projectId), chainId),
      fetchConnectedChains(String(projectId), chainId),
    ]).then(([projectResult, chainsResult]) => {
      if (cancelled) return
      setProject(projectResult.status === 'fulfilled' ? projectResult.value : null)
      const mapped = chainsResult.status === 'fulfilled' ? chainsResult.value : []
      setConnectedProjects(mapped.length > 0 ? mapped : [{ chainId, projectId }])
      setChainMappingAvailable(chainsResult.status === 'fulfilled')
    })
    return () => { cancelled = true }
  }, [projectId, chainId])

  const hasHook = !!hook && hook.toLowerCase() !== zeroAddress
  useEffect(() => {
    let cancelled = false
    if (!hasHook || !hook) {
      setHookStatus('none')
      return
    }
    setHookStatus('checking')
    requireRecognizedRuntimeSplitHook(getSafetyPublicClient(chainId), hook as Address)
      .then(() => {
        if (!cancelled) setHookStatus('recognized')
      })
      .catch(() => {
        if (!cancelled) setHookStatus('unknown')
      })
    return () => { cancelled = true }
  }, [chainId, hasHook, hook])

  const route = hasHook
    ? hookStatus === 'recognized'
      ? 'recognized split hook · project context'
      : hookStatus === 'unknown'
        ? 'split hook not recognized'
        : 'checking split hook provenance'
    : kind === 'reserved'
      ? 'reserved-token project recipient'
      : preferAddToBalance
        ? 'add to balance · no tokens minted'
        : 'pay project'
  const beneficiaryMissing = beneficiary.toLowerCase() === zeroAddress
  const beneficiaryLabel = hasHook
    ? beneficiaryMissing ? 'Hook beneficiary context: none' : `Hook beneficiary context: ${shortAddress(beneficiary)}`
    : kind === 'reserved'
    ? beneficiaryMissing ? 'Fallback: distribution caller' : `Fallback: ${shortAddress(beneficiary)}`
    : preferAddToBalance
      ? 'No destination tokens minted'
      : beneficiaryMissing
        ? 'Tokens: distribution caller'
        : `Tokens: ${shortAddress(beneficiary)}`
  const slug = CHAIN_SLUGS[chainId] || 'eth'
  const otherProjects = connectedProjects.filter(
    connected => connected.chainId !== chainId || connected.projectId !== projectId,
  )

  return (
    <div className="min-w-0 text-left">
      <ProjectLink
        chainSlug={slug}
        projectId={projectId}
        className={`block truncate text-xs font-medium hover:underline ${isDark ? 'text-cyan-300' : 'text-cyan-700'}`}
      >
        {project?.name || `Project #${projectId}`} · #{projectId}
      </ProjectLink>
      <div className={`text-[10px] ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{route}</div>
      <div className={`text-[10px] font-mono ${beneficiaryMissing ? 'text-amber-500' : isDark ? 'text-gray-500' : 'text-gray-500'}`}>
        {beneficiaryLabel}
      </div>
      {otherProjects.length > 0 && (
        <div className={`flex flex-wrap gap-x-2 text-[10px] ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
          {otherProjects.map(connected => (
            <ProjectLink
              key={`${connected.chainId}:${connected.projectId}`}
              chainSlug={CHAIN_SLUGS[connected.chainId] || 'eth'}
              projectId={connected.projectId}
              className="hover:underline"
            >
              <span className="inline-flex items-center gap-1">
                <ChainLogo chainId={connected.chainId} size={12} />
                {CHAIN_NAMES[connected.chainId] || `Chain ${connected.chainId}`}
              </span>
              {` · #${connected.projectId}`}
            </ProjectLink>
          ))}
        </div>
      )}
      {!chainMappingAvailable && (
        <div className="text-[10px] text-amber-500">Cross-chain mapping unavailable</div>
      )}
      {hasHook && hookStatus !== 'checking' && (
        <div className={`text-[10px] font-mono ${
          hookStatus === 'recognized'
            ? isDark ? 'text-cyan-400' : 'text-cyan-700'
            : 'text-amber-500'
        }`}>
          {hookStatus === 'recognized' ? 'Recognized split hook' : 'Unrecognized split hook'} · {shortAddress(hook)}
        </div>
      )}
    </div>
  )
}
