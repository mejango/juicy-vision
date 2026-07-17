/**
 * "Account" card — ports website/src/discover.js renderAccountCard (:10407).
 *
 * Shows the project's controlling account on each chain: the JBProjects owner
 * for a custom project, or the REVOwner operator for a revnet (the NFT owner
 * is the singleton REVOwner there). Chains sharing the same authority collapse
 * into one row; a "differs by chain" warning appears when they diverge. Each
 * row offers Transfer operator/ownership via the danger-gated modal.
 *
 * Safe multisig classification (policy + signers) and the pending-Safe-queue
 * card are DEFERRED with the rest of the Safe-queue work — accounts classify
 * as EOA/Contract for now.
 */

import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { useThemeStore } from '../../../stores'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { fetchRevnetOperator } from '../../../services/bendystraw'
import { readProjectOwner } from '../../../services/permissionsAdmin'
import { publicClientFor } from '../../../services/projectTx'
import { BackOfficeCard, chainName, shortAddress } from './shared'
import { TransferAuthorityModal } from './TransferAuthorityModal'

export interface AccountCardProps {
  projectId: number
  chainIds: number[]
  isRevnet: boolean
}

interface AuthorityRow {
  chainId: number
  authority: Address | null
  /** 'EOA' | 'Contract' | '—' (unreadable). */
  type: string
}

interface AuthorityGroup {
  authority: Address
  type: string
  chainIds: number[]
}

async function classify(chainId: number, address: Address): Promise<string> {
  try {
    const code = await publicClientFor(chainId).getCode({ address })
    return code && code !== '0x' ? 'Contract' : 'EOA'
  } catch {
    return 'Unknown'
  }
}

export function AccountCard({ projectId, chainIds, isRevnet }: AccountCardProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [rows, setRows] = useState<AuthorityRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [transfer, setTransfer] = useState<{ authority: Address; chainIds: number[] } | null>(null)

  // Chains re-fetch only when membership actually changes, not on array identity.
  const chainKey = chainIds.join(',')

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setFailed(false)
    Promise.all(
      chainIds.map(async (chainId): Promise<AuthorityRow> => {
        try {
          const authority = isRevnet
            ? ((await fetchRevnetOperator(String(projectId), chainId)) as Address | null)
            : await readProjectOwner(chainId, BigInt(projectId))
          if (!authority) return { chainId, authority: null, type: '—' }
          return { chainId, authority, type: await classify(chainId, authority) }
        } catch {
          return { chainId, authority: null, type: '—' }
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
  }, [projectId, isRevnet, chainKey])

  const addrLabel = isRevnet ? 'Operator' : 'Owner'

  // Collapse chains sharing the same authority + type into one row.
  const groups: AuthorityGroup[] = []
  if (rows) {
    const byKey = new Map<string, AuthorityGroup>()
    for (const row of rows) {
      if (!row.authority) continue
      const key = `${row.authority.toLowerCase()}|${row.type}`
      let group = byKey.get(key)
      if (!group) {
        group = { authority: row.authority, type: row.type, chainIds: [] }
        byKey.set(key, group)
        groups.push(group)
      }
      group.chainIds.push(row.chainId)
    }
  }
  const distinctAuthorities = new Set(groups.map(group => group.authority.toLowerCase()))
  const diverged = distinctAuthorities.size > 1
  const unreadable = (rows ?? []).filter(row => !row.authority)

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

          {groups.map(group => (
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
                <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>{group.type}</span>
              </div>
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
          ))}

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
          projectId={projectId}
          isRevnet={isRevnet}
          currentAuthority={transfer.authority}
          chainIds={transfer.chainIds}
        />
      ) : null}
    </BackOfficeCard>
  )
}
