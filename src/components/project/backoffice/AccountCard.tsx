/**
 * "Account" card — ports website/src/discover.js renderAccountCard (:10407) +
 * classifyOwner (:10791).
 *
 * Shows the project's controlling account on each chain: the JBProjects owner
 * for a custom project, or the REVOwner operator for a revnet (the NFT owner
 * is the singleton REVOwner there). Chains sharing the same authority collapse
 * into one row; a "differs by chain" warning appears when they diverge. Each
 * row offers Transfer operator/ownership via the danger-gated modal.
 *
 * When an authority is a Gnosis Safe, the row shows its policy (M-of-N) + the
 * signer list. A same-address Safe that is deployed on one chain but not another
 * reads as an EOA there — it is relabeled "Safe Multisig (not deployed here
 * yet)" and offered a "Deploy Safe on <chain>" button that replays the Safe's
 * original createProxyWithNonce to reproduce the identical address (guarded
 * runner + post-deploy address verification). Distinct from the Safe App
 * (postMessage) integration — this is the Transaction-Service classification +
 * same-address replay deploy.
 */

import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { useThemeStore } from '../../../stores'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { fetchRevnetOperator } from '../../../services/bendystraw'
import { readProjectOwner } from '../../../services/permissionsAdmin'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import {
  buildDeploySafeRequest,
  fetchSafeCreation,
  fetchSafeInfo,
  formatSafePolicy,
  invalidateSafeInfo,
  safeAppHomeLink,
  verifySafeDeployed,
} from '../../../services/safeInfo'
import { BackOfficeCard, PHASE_LABELS, chainName, shortAddress, type ChainRunState } from './shared'
import { TransferAuthorityModal } from './TransferAuthorityModal'

export interface AccountCardProps {
  /** Resolve the project's id ON a given chain (V6 ids differ per chain); null = not on that chain. */
  resolveProjectId: (chainId: number) => bigint | null
  chainIds: number[]
  isRevnet: boolean
}

/** A deployed Safe's policy, when the authority is a Safe on that chain. */
interface SafePolicy {
  threshold: number
  owners: Address[]
}

interface AuthorityRow {
  chainId: number
  authority: Address | null
  /** 'Safe Multisig' | 'EOA' | 'Contract' | 'Unknown' | '—' (unreadable). */
  type: string
  /** Non-null only when `authority` is a deployed Safe on THIS chain. */
  safe: SafePolicy | null
}

interface AuthorityGroup {
  authority: Address
  type: string
  safe: SafePolicy | null
  chainIds: number[]
}

async function classify(
  chainId: number,
  address: Address,
): Promise<{ type: string; safe: SafePolicy | null }> {
  try {
    const info = await fetchSafeInfo(address, chainId)
    if (info.isSafe) return { type: 'Safe Multisig', safe: { threshold: info.threshold, owners: info.owners } }
    return { type: info.deployed ? 'Contract' : 'EOA', safe: null }
  } catch {
    return { type: 'Unknown', safe: null }
  }
}

// ─── Same-address Safe deploy button (per chain) ─────────────────────────────

function DeploySafeButton({
  authority,
  chainId,
  isDark,
  onDeployed,
}: {
  authority: Address
  chainId: number
  isDark: boolean
  onDeployed: () => void
}) {
  const { activeAddress, run } = useGuardedTx()
  const [status, setStatus] = useState<ChainRunState>({ kind: 'idle' })

  const deploy = async () => {
    if (!activeAddress) {
      setStatus({ kind: 'error', message: 'Connect a wallet first.' })
      return
    }
    setStatus({ kind: 'running', phase: 'reverifying' })
    try {
      // Creation params are chain-independent; read them from any chain that has the Safe.
      const creation = await fetchSafeCreation(authority)
      if (!creation) {
        throw new Error(
          `Couldn't read the Safe's creation config — deploy it on ${chainName(chainId)} from Safe{Wallet} instead.`,
        )
      }
      const request = buildDeploySafeRequest(chainId, creation)
      const txHash = await run({
        chainId,
        to: request.to,
        data: request.data,
        review: {
          title: 'Review same-address Safe deployment',
          label: `Replay this Safe's verified creation parameters on ${chainName(chainId)}`,
          contractName: 'Safe Proxy Factory',
          ...request.review,
        },
        // Guard against a race: abort if the Safe was deployed here since the button rendered.
        reverify: async () => {
          invalidateSafeInfo(authority, chainId)
          const fresh = await fetchSafeInfo(authority, chainId)
          if (fresh.deployed) throw new Error(`A Safe is already deployed on ${chainName(chainId)}.`)
        },
        onPhase: phase => setStatus({ kind: 'running', phase }),
      })
      // The replay is only trustworthy if the identical address actually landed.
      const landed = await verifySafeDeployed(chainId, authority)
      if (!landed) {
        throw new Error(
          `Deployed, but the Safe isn't readable at ${shortAddress(authority)} on ${chainName(chainId)} yet — reload to check.`,
        )
      }
      invalidateSafeInfo(authority, chainId)
      setStatus({ kind: 'done', txHash })
      onDeployed()
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The deploy failed.',
      })
    }
  }

  if (status.kind === 'done') {
    return (
      <div className={`text-sm ${isDark ? 'text-green-400' : 'text-green-600'}`}>
        Safe deployed on {chainName(chainId)}.
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <button
          onClick={deploy}
          disabled={status.kind === 'running'}
          className={`text-sm underline decoration-dotted underline-offset-2 transition-colors disabled:opacity-40 disabled:no-underline ${
            isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'
          }`}
        >
          {status.kind === 'error' ? 'Retry deploy' : 'Deploy Safe on'} {chainName(chainId)}
        </button>
        {status.kind === 'running' ? (
          <span className={`flex items-center gap-2 text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
            <span className="animate-spin w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" />
            {PHASE_LABELS[status.phase]}
          </span>
        ) : null}
      </div>
      {status.kind === 'error' ? (
        <div className="text-sm text-red-400" role="alert">
          {status.message}{' '}
          <a
            href={safeAppHomeLink(chainId, authority)}
            target="_blank"
            rel="noopener noreferrer"
            className={isDark ? 'text-juice-cyan hover:underline' : 'text-cyan-700 hover:underline'}
          >
            Open in Safe&#123;Wallet&#125; →
          </a>
        </div>
      ) : null}
    </div>
  )
}

export function AccountCard({ resolveProjectId, chainIds, isRevnet }: AccountCardProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [rows, setRows] = useState<AuthorityRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [transfer, setTransfer] = useState<{ authority: Address; chainIds: number[] } | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  // Chains re-fetch only when membership actually changes, not on array identity.
  const chainKey = chainIds.join(',')

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setFailed(false)
    Promise.all(
      chainIds.map(async (chainId): Promise<AuthorityRow> => {
        // This chain's OWN project id (V6 ids differ per chain); no id → not this
        // project on this chain, so read nothing (never fall back to the home id).
        const pid = resolveProjectId(chainId)
        if (pid == null) return { chainId, authority: null, type: '—', safe: null }
        try {
          const authority = isRevnet
            ? ((await fetchRevnetOperator(String(pid), chainId)) as Address | null)
            : await readProjectOwner(chainId, pid)
          if (!authority) return { chainId, authority: null, type: '—', safe: null }
          const { type, safe } = await classify(chainId, authority)
          return { chainId, authority, type, safe }
        } catch {
          return { chainId, authority: null, type: '—', safe: null }
        }
      }),
    )
      .then(result => {
        if (cancelled) return
        if (result.every(row => !row.authority)) setFailed(true)
        setRows(result)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveProjectId, isRevnet, chainKey, refreshNonce])

  const addrLabel = isRevnet ? 'Operator' : 'Owner'

  // Collapse chains sharing the same authority + type + policy into one row.
  const groups: AuthorityGroup[] = []
  if (rows) {
    const byKey = new Map<string, AuthorityGroup>()
    for (const row of rows) {
      if (!row.authority) continue
      const policyKey = row.safe
        ? `${row.safe.threshold}/${row.safe.owners.map(owner => owner.toLowerCase()).sort().join(',')}`
        : ''
      const key = `${row.authority.toLowerCase()}|${row.type}|${policyKey}`
      let group = byKey.get(key)
      if (!group) {
        group = { authority: row.authority, type: row.type, safe: row.safe, chainIds: [] }
        byKey.set(key, group)
        groups.push(group)
      }
      group.chainIds.push(row.chainId)
    }
  }
  const distinctAuthorities = new Set(groups.map(group => group.authority.toLowerCase()))
  const diverged = distinctAuthorities.size > 1
  const unreadable = (rows ?? []).filter(row => !row.authority)

  // Addresses that ARE a deployed Safe on at least one chain — so the same address showing as
  // "EOA" elsewhere is really the SAME Safe, not yet deployed there (deployable via replay).
  const safeByAddr = new Map<string, SafePolicy>()
  for (const group of groups) {
    if (group.safe) safeByAddr.set(group.authority.toLowerCase(), group.safe)
  }

  return (
    <BackOfficeCard title="Account" isDark={isDark}>
      <ExplainerMessage>
        The account controlling this project on each chain — {isRevnet
          ? 'the operator role granted by the revnet.'
          : 'the owner of the project NFT.'}
      </ExplainerMessage>

      {rows === null ? (
        <div className={`h-14 animate-pulse ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
      ) : failed ? (
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Could not read {addrLabel.toLowerCase()}ship.
        </p>
      ) : (
        <div className="space-y-3">
          {diverged ? (
            <div
              className={`px-3 py-2 text-sm border ${
                isDark ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' : 'bg-yellow-50 border-yellow-200 text-yellow-700'
              }`}
            >
              {addrLabel} differs by chain
            </div>
          ) : null}

          {groups.map(group => {
            // A non-Safe whose SAME address is a deployed Safe elsewhere is an undeployed Safe, not an EOA.
            const undeployedSafe = !group.safe ? safeByAddr.get(group.authority.toLowerCase()) : undefined
            const policy = group.safe ?? undeployedSafe ?? null
            return (
              <div
                key={`${group.authority}-${group.type}`}
                className={`border p-3 space-y-2 ${isDark ? 'border-white/10' : 'border-gray-200'}`}
              >
                <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {group.chainIds.map(chainName).join(', ')}
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>{addrLabel}:</span>
                  <span className={`font-mono ${isDark ? 'text-gray-200' : 'text-gray-800'}`} title={group.authority}>
                    {shortAddress(group.authority)}
                  </span>
                  <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Type:</span>
                  <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>
                    {undeployedSafe ? 'Safe Multisig (not deployed here yet)' : group.type}
                  </span>
                  {policy ? (
                    <>
                      <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Policy:</span>
                      <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>
                        {formatSafePolicy(policy.threshold, policy.owners.length)}
                        {undeployedSafe ? ' (once deployed)' : ''}
                      </span>
                    </>
                  ) : null}
                  {group.safe ? (
                    <>
                      <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>Signers:</span>
                      <span className={`font-mono break-all ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                        {group.safe.owners.map(owner => shortAddress(owner)).join(', ')}
                      </span>
                    </>
                  ) : null}
                </div>

                {undeployedSafe ? (
                  <div className="space-y-2 pt-1">
                    <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                      Same Safe address — deploy it to activate here.
                    </p>
                    {group.chainIds.map(chainId => (
                      <DeploySafeButton
                        key={chainId}
                        authority={group.authority}
                        chainId={chainId}
                        isDark={isDark}
                        onDeployed={() => setRefreshNonce(nonce => nonce + 1)}
                      />
                    ))}
                  </div>
                ) : null}

                <button
                  onClick={() => setTransfer({ authority: group.authority, chainIds: group.chainIds })}
                  title={`${isRevnet ? 'Transfer the operator role on' : 'Transfer project ownership on'} ${group.chainIds
                    .map(chainName)
                    .join(', ')}`}
                  className={`text-sm underline decoration-dotted underline-offset-2 transition-colors ${
                    isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'
                  }`}
                >
                  {isRevnet ? 'Transfer operator' : 'Transfer ownership'}
                </button>
              </div>
            )
          })}

          {unreadable.length ? (
            <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {addrLabel} unreadable on {unreadable.map(row => chainName(row.chainId)).join(', ')}.
            </p>
          ) : null}
        </div>
      )}

      {transfer ? (
        <TransferAuthorityModal
          isOpen
          onClose={() => setTransfer(null)}
          resolveProjectId={resolveProjectId}
          isRevnet={isRevnet}
          currentAuthority={transfer.authority}
          chainIds={transfer.chainIds}
        />
      ) : null}
    </BackOfficeCard>
  )
}
