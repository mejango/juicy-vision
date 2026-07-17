/**
 * Owner (custom) / Operator (revnet) "back office" tab — 1:1 with
 * website/src/discover.js renderBackOfficeSection (:10577).
 *
 * Card order (website parity):
 *   revnet:  Account → [Safe queue — deferred] → Edits → Buyback & swap router → Permissions
 *   custom:  Account → [Safe queue — deferred] → Edits → Powers → Buyback & swap router → Permissions
 *
 * The "Pending Multisig Transactions" (Safe queue/sign/execute) cards are
 * DEFERRED — they need the Safe transaction-service integration. Placeholders
 * are marked below where they slot in.
 *
 * Edits rows re-open the existing edit flows owned by the dashboard
 * (project metadata / token rename / splits) via the onEdit* props.
 */

import { useThemeStore } from '../../stores'
import type { Project } from '../../services/bendystraw'
import { AccountCard } from './backoffice/AccountCard'
import { PermissionsCard } from './backoffice/PermissionsCard'
import { PowersCard } from './backoffice/PowersCard'
import { BuybackRouterCard } from './backoffice/BuybackRouterCard'
import { BackOfficeCard } from './backoffice/shared'

export interface BackOfficeTabProps {
  project: Project
  /** The on-chain project id (same across the sucker group). */
  projectId: number
  /** The sucker-group chains the project lives on (home chain first). */
  chainIds: number[]
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
  isRevnet,
  onEditMetadata,
  onEditToken,
  onEditSplits,
}: BackOfficeTabProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const resolvedChainIds = chainIds.length ? chainIds : [project.chainId]

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
      <AccountCard projectId={projectId} chainIds={resolvedChainIds} isRevnet={isRevnet} />

      {/* 2. Pending Multisig Transactions (Safe queue) — DEFERRED.
          Website: renderPendingSafeTxsCard / renderRevnetPendingSafeTxs slot
          here (revnet: one card per operator Safe; custom: one card when the
          owner is a Safe). Needs the Safe transaction-service integration. */}

      {/* 3. Edits — everyday flows mirrored from their home surfaces. */}
      <EditsCard rows={editRows} isDark={isDark} />

      {/* 4. Powers — custom projects only: ruleset-flag-gated owner powers.
          Revnets skip this card (the operator holds a fixed permission set,
          shown read-only in Permissions below, not the owner powers). */}
      {!isRevnet ? <PowersCard projectId={projectId} chainIds={resolvedChainIds} /> : null}

      {/* 5. Buyback hook + swap router registry wiring. */}
      <BuybackRouterCard projectId={projectId} chainIds={resolvedChainIds} />

      {/* 6. Permissions — operators and what each can do (revnet: read-only). */}
      <PermissionsCard projectId={projectId} chainIds={resolvedChainIds} isRevnet={isRevnet} />
    </div>
  )
}
