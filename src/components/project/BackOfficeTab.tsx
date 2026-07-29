/**
 * Owner (custom) / Operator (revnet) "back office" tab — 1:1 with
 * website/src/discover.js renderBackOfficeSection (:10577).
 *
 * Card order (website parity):
 *   revnet:  Account → Safe queue → Edits → Buyback & swap router → Permissions
 *   custom:  Account → Safe queue → Edits → Powers → Buyback & swap router → Permissions
 *
 * Edits rows re-open the existing edit flows owned by the dashboard
 * (project metadata / token rename / splits) via the onEdit* props.
 */

import { useMemo } from 'react'
import { useThemeStore } from '../../stores'
import type { Project } from '../../services/bendystraw'
import { makeProjectIdResolver } from '../../utils/projectChains'
import { AccountCard } from './backoffice/AccountCard'
import { PermissionsCard } from './backoffice/PermissionsCard'
import { PowersCard } from './backoffice/PowersCard'
import { BuybackRouterCard } from './backoffice/BuybackRouterCard'
import { BackOfficeCard } from './backoffice/shared'
import { SafeQueueCards } from './backoffice/SafeQueueCards'

export interface BackOfficeTabProps {
  project: Project
  /** The home-chain project id. NOTE: V6 project ids are independent per chain —
   *  every per-chain read/tx resolves the id ON that chain via `chainProjects`. */
  projectId: number
  /** The sucker-group chains the project lives on (home chain first). */
  chainIds: number[]
  /** Per-chain project ids (V6 ids differ per chain); reads/txs target the id ON that chain. */
  chainProjects?: Array<{ chainId: number; projectId: number | string }>
  isRevnet: boolean
  /** Re-opens the existing "edit project metadata" flow. */
  onEditMetadata: () => void
  /** Re-opens the existing "edit token name/symbol" flow. */
  onEditToken: () => void
  /** Re-opens the existing "edit reserved splits" flow. */
  onEditSplits: () => void
}

interface EditRow {
  label: string
  description: string
  cta: string
  open: () => void
}

/** Everyday edits mirrored from their home surfaces (website renderEditsCard :11150). */
function EditsCard({ rows, isDark }: { rows: EditRow[]; isDark: boolean }) {
  return (
    <BackOfficeCard title="Edits" isDark={isDark}>
      <div className="space-y-3">
        {rows.map(row => (
          <div key={row.label} className={`border p-3 space-y-1.5 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{row.label}</div>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{row.description}</p>
            <button
              onClick={row.open}
              className={`text-sm underline decoration-dotted underline-offset-2 transition-colors ${
                isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'
              }`}
            >
              {row.cta}
            </button>
          </div>
        ))}
      </div>
    </BackOfficeCard>
  )
}

export default function BackOfficeTab({
  project,
  projectId,
  chainIds,
  chainProjects,
  isRevnet,
  onEditMetadata,
  onEditToken,
  onEditSplits,
}: BackOfficeTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const resolvedChainIds = chainIds.length ? chainIds : [project.chainId]

  // Every card/modal below reads and transacts per chain. V6 project ids are
  // independent per chain, so each per-chain call must use the id ON that chain
  // — a chain absent from the map resolves to null and is skipped, NEVER read or
  // written with the home id. Memoized on a stable key so the cards' effects
  // don't re-run on every render (chainProjects is a fresh array each render).
  const chainProjectsKey = (chainProjects ?? []).map(cp => `${cp.chainId}:${cp.projectId}`).join(',')
  const resolveProjectId = useMemo(
    () => makeProjectIdResolver(chainProjects, { chainId: project.chainId, projectId: project.projectId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chainProjectsKey, project.chainId, project.projectId],
  )

  const editRows: EditRow[] = [
    {
      label: 'Set project metadata',
      description: "Update the project's name, logo, description, links, and tags.",
      cta: 'Edit project',
      open: onEditMetadata,
    },
    {
      label: 'Set token metadata',
      description: "Set the project token's name and symbol (deploys the ERC-20 if the project still uses credits).",
      cta: 'Edit token',
      open: onEditToken,
    },
    {
      label: 'Set splits',
      description: 'Edit the reserved token recipients. Payout splits are edited per token from the Rulesets tab.',
      cta: 'Edit reserved splits',
      open: onEditSplits,
    },
  ]

  return (
    <div className="space-y-4">
      {/* 1. Account — who controls the project on each chain. */}
      <AccountCard resolveProjectId={resolveProjectId} chainIds={resolvedChainIds} isRevnet={isRevnet} />

      {/* 2. Pending Multisig Transactions — one queue per controlling Safe/chain. */}
      <SafeQueueCards
        resolveProjectId={resolveProjectId}
        chainIds={resolvedChainIds}
        isRevnet={isRevnet}
      />

      {/* 3. Edits — everyday flows mirrored from their home surfaces. */}
      <EditsCard rows={editRows} isDark={isDark} />

      {/* 4. Powers — custom projects only: ruleset-flag-gated owner powers.
          Revnets skip this card (the operator holds a fixed permission set,
          shown read-only in Permissions below, not the owner powers). */}
      {!isRevnet ? <PowersCard resolveProjectId={resolveProjectId} chainIds={resolvedChainIds} /> : null}

      {/* 5. Buyback hook + swap router registry wiring. */}
      <BuybackRouterCard resolveProjectId={resolveProjectId} chainIds={resolvedChainIds} />

      {/* 6. Permissions — operators and what each can do (revnet: read-only). */}
      <PermissionsCard
        projectId={projectId}
        resolveProjectId={resolveProjectId}
        chainIds={resolvedChainIds}
        isRevnet={isRevnet}
      />
    </div>
  )
}
