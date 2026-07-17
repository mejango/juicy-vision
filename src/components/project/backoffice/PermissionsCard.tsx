/**
 * "Permissions" card — ports website/src/discover.js renderPermissionsCard
 * (:11497) + openSetPermissionsModal (:11548).
 *
 * Lists every operator the project has authorized (bendystraw
 * permissionHolders, version 6 — there is no on-chain enumeration). Revnet →
 * READ-ONLY with an "Operator" badge: the operator role is set on the revnet
 * itself, not via setPermissionsFor. Custom → each operator is editable and
 * "+ Add operator" opens the same editor.
 *
 * CRITICAL SEMANTIC: JBPermissions.setPermissionsFor REPLACES the operator's
 * ENTIRE permission set. The editor preloads the operator's existing ids from
 * an on-chain read (per chain), and the guarded run's reverify re-reads the
 * CURRENT set, aborting if it drifted from that preloaded snapshot.
 */

import { useCallback, useEffect, useState } from 'react'
import { isAddress, type Address } from 'viem'
import { useThemeStore } from '../../../stores'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import {
  buildSetPermissionsRequest,
  canEditPermissions,
  fetchPermissionOperators,
  PERMISSIONS,
  permissionDescription,
  permissionLabel,
  permissionSetsDiffer,
  preloadPermissionSelection,
  readPermissionIds,
  readProjectOwner,
  selectedPermissionIds,
  type PermissionSelection,
  type ProjectOperator,
} from '../../../services/permissionsAdmin'
import { BackOfficeCard, BackOfficeModal, ChainRunRows, DangerGate, chainName, shortAddress, type ChainRunState } from './shared'

export interface PermissionsCardProps {
  projectId: number
  chainIds: number[]
  isRevnet: boolean
}

// ─── Editor modal (custom projects only) ─────────────────────────────────────

interface ChainSnapshot {
  chainId: number
  /** The grantor baked into the calldata — the project owner at review time. */
  owner: Address
  /** The operator's on-chain permission ids at review time (the preloaded snapshot). */
  permissionIds: number[]
}

function SetPermissionsModal({
  projectId,
  chainIds,
  existingOperator,
  onClose,
  onChanged,
}: {
  projectId: number
  chainIds: number[]
  /** null → adding a new operator. */
  existingOperator: Address | null
  onClose: () => void
  onChanged: () => void
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const editing = existingOperator !== null
  const [operatorInput, setOperatorInput] = useState(existingOperator ?? '')
  const [selection, setSelection] = useState<PermissionSelection | null>(editing ? null : preloadPermissionSelection([]))
  const [snapshots, setSnapshots] = useState<Record<number, ChainSnapshot> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [gateChecked, setGateChecked] = useState(false)
  const [statuses, setStatuses] = useState<Record<number, ChainRunState>>({})

  const trimmedOperator = operatorInput.trim()
  const operatorValid = isAddress(trimmedOperator)
  const operator = operatorValid ? (trimmedOperator as Address) : null

  // Snapshot the reviewed state per chain: the owner (grantor) and the
  // operator's CURRENT on-chain permission ids. For an edit, the checklist
  // preloads from the union of those per-chain sets (on-chain truth, not the
  // indexer); for a new operator the snapshot is whatever it already holds
  // (normally nothing).
  const loadSnapshots = useCallback(async (op: Address) => {
    setSnapshots(null)
    setLoadError(null)
    try {
      const pid = BigInt(projectId)
      const loaded = await Promise.all(
        chainIds.map(async (chainId): Promise<ChainSnapshot> => {
          const owner = await readProjectOwner(chainId, pid)
          const permissionIds = await readPermissionIds({ chainId, operator: op, account: owner, projectId: pid })
          return { chainId, owner, permissionIds }
        }),
      )
      const byChain: Record<number, ChainSnapshot> = {}
      const union = new Set<number>()
      for (const snapshot of loaded) {
        byChain[snapshot.chainId] = snapshot
        for (const id of snapshot.permissionIds) union.add(id)
      }
      setSnapshots(byChain)
      // Merge-with-existing preload: the replacement set starts from what the
      // operator already holds so a single add doesn't silently revoke the rest.
      setSelection(preloadPermissionSelection([...union]))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not read the current permissions.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, chainIds.join(',')])

  useEffect(() => {
    if (editing && existingOperator) void loadSnapshots(existingOperator)
  }, [editing, existingOperator, loadSnapshots])

  // New operator: snapshot once the address is valid (re-run when it changes).
  useEffect(() => {
    if (!editing && operator) void loadSnapshots(operator)
  }, [editing, operator, loadSnapshots])

  const ids = selection ? selectedPermissionIds(selection) : []
  const anyRunning = Object.values(statuses).some(status => status.kind === 'running')
  const ready = !!operator && !!selection && !!snapshots && !loadError

  const setStatus = (chainId: number, status: ChainRunState) =>
    setStatuses(previous => ({ ...previous, [chainId]: status }))

  const execute = async (chainId: number) => {
    if (!activeAddress) {
      setStatus(chainId, { kind: 'error', message: 'Connect a wallet first.' })
      return
    }
    if (!operator || !snapshots) return
    const snapshot = snapshots[chainId]
    if (!snapshot) {
      setStatus(chainId, { kind: 'error', message: `No reviewed snapshot for ${chainName(chainId)}. Reopen to refresh.` })
      return
    }
    const pid = BigInt(projectId)
    try {
      const request = buildSetPermissionsRequest({
        chainId,
        account: snapshot.owner,
        operator,
        projectId: pid,
        permissionIds: ids,
      })
      const txHash = await run({
        chainId,
        to: request.to,
        data: request.data,
        // Reviewed-state re-verification: abort when the operator's CURRENT
        // set drifted from the preloaded snapshot (someone else changed it —
        // this tx would silently clobber theirs), or the owner changed.
        reverify: async () => {
          const owner = await readProjectOwner(chainId, pid)
          if (owner.toLowerCase() !== snapshot.owner.toLowerCase()) {
            throw new Error(`The project owner on ${chainName(chainId)} changed since review. Reopen to refresh.`)
          }
          const current = await readPermissionIds({ chainId, operator, account: owner, projectId: pid })
          if (permissionSetsDiffer(current, snapshot.permissionIds)) {
            throw new Error(
              `The operator's permissions on ${chainName(chainId)} changed since review — setting them now would overwrite that change. Reopen to refresh.`,
            )
          }
        },
        onPhase: phase => setStatus(chainId, { kind: 'running', phase }),
      })
      setStatus(chainId, { kind: 'done', txHash })
      onChanged()
    } catch (error) {
      setStatus(chainId, {
        kind: 'error',
        message: error instanceof Error ? error.message : 'Setting the permissions failed.',
      })
    }
  }

  return (
    <BackOfficeModal
      title={editing ? 'Edit permissions' : 'Add operator'}
      onClose={onClose}
      busy={anyRunning}
      isDark={isDark}
    >
      <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        Grants the checked permissions to the operator for this project. Setting permissions REPLACES the
        operator's current set on each chain — unchecking a box revokes that power, and clearing every box
        removes the operator.
      </p>

      <div className="space-y-1">
        <label className={`block text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Operator</label>
        <input
          type="text"
          value={operatorInput}
          onChange={event => setOperatorInput(event.target.value)}
          disabled={editing}
          placeholder="0x… operator address"
          spellCheck={false}
          className={`w-full px-3 py-2 text-sm font-mono border bg-transparent outline-none disabled:opacity-60 ${
            isDark
              ? 'border-white/20 text-white placeholder-gray-600 focus:border-white/40'
              : 'border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-500'
          }`}
        />
        {trimmedOperator && !operatorValid ? <p className="text-sm text-red-400">Not a valid address.</p> : null}
      </div>

      {loadError ? (
        <p className="text-sm text-red-400" role="alert">
          {loadError}
        </p>
      ) : null}

      {operator && !selection ? (
        <div className={`h-20 animate-pulse ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
      ) : null}

      {selection ? (
        <div className="space-y-1">
          <div className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Permissions</div>
          <div className={`max-h-72 overflow-y-auto border divide-y ${
            isDark ? 'border-white/10 divide-white/5' : 'border-gray-200 divide-gray-100'
          }`}>
            {PERMISSIONS.map(info => (
              <label key={info.id} className="flex items-start gap-3 px-3 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!selection[info.id]}
                  onChange={event =>
                    setSelection(previous => (previous ? { ...previous, [info.id]: event.target.checked } : previous))
                  }
                  className="mt-0.5 w-4 h-4"
                />
                <span className="min-w-0">
                  <span className={`block text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {info.label} <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>#{info.id}</span>
                  </span>
                  <span className={`block text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                    {info.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
            {ids.length
              ? `This replaces the operator's set with ${ids.length} permission${ids.length === 1 ? '' : 's'}.`
              : 'No boxes checked — this removes the operator entirely.'}
          </p>
        </div>
      ) : null}

      <DangerGate
        isDark={isDark}
        text="Granting permissions lets the operator act on the project's behalf for the checked powers. Verify the address — a wrong or malicious operator can use these powers against the project. You can change or revoke them here at any time."
        confirmLabel="I've verified the operator address and the permissions I'm granting."
        checked={gateChecked}
        onChange={setGateChecked}
      />

      <ChainRunRows
        chainIds={chainIds}
        statuses={statuses}
        onExecute={execute}
        disabled={!ready || !gateChecked || anyRunning}
        disabledReason={
          !operator ? 'Enter a valid operator address first' : !ready ? 'Reading current permissions…' : 'Tick the confirmation box to proceed'
        }
        isDark={isDark}
      />
    </BackOfficeModal>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function PermissionsCard({ projectId, chainIds, isRevnet }: PermissionsCardProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [operators, setOperators] = useState<ProjectOperator[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [editor, setEditor] = useState<{ operator: Address | null } | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  const editable = canEditPermissions(isRevnet)

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    fetchPermissionOperators(projectId, chainIds)
      .then(result => {
        if (!cancelled) setOperators(result)
      })
      .catch(() => {
        if (!cancelled) {
          setOperators(null)
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, chainIds.join(','), refreshNonce])

  return (
    <BackOfficeCard title="Permissions" isDark={isDark}>
      <ExplainerMessage>
        {isRevnet
          ? "What this revnet's operator is allowed to do. These powers come with the operator role (the default revnet powers plus any NFT powers granted when the revnet was deployed)."
          : "Operators the owner has authorized to act on the project's behalf, and what each one can do. The owner can grant or revoke permissions at any time."}
      </ExplainerMessage>

      {failed ? (
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Could not read permissions.</p>
      ) : operators === null ? (
        <div className={`h-10 animate-pulse ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
      ) : operators.length === 0 ? (
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {isRevnet ? 'No operator permissions found.' : 'No operators authorized yet.'}
        </p>
      ) : (
        <div className="space-y-3">
          {operators.map(group => (
            <div key={group.operator} className={`border p-3 space-y-2 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-mono ${isDark ? 'text-white' : 'text-gray-900'}`} title={group.operator}>
                  {shortAddress(group.operator)}
                </span>
                {group.isRevnetOperator ? (
                  <span
                    className={`px-1.5 py-0.5 text-xs font-medium ${
                      isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700'
                    }`}
                  >
                    Operator
                  </span>
                ) : null}
                <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  {group.chains.map(chainName).join(', ')}
                </span>
              </div>
              <div className="space-y-1">
                {group.permissionIds.map(id => (
                  <div key={id} className="text-sm">
                    <span className={isDark ? 'text-gray-200' : 'text-gray-800'}>{permissionLabel(id)}</span>{' '}
                    <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                      {permissionDescription(id)}
                    </span>
                  </div>
                ))}
              </div>
              {editable ? (
                <button
                  onClick={() => setEditor({ operator: group.operator })}
                  className={`text-sm underline decoration-dotted underline-offset-2 transition-colors ${
                    isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'
                  }`}
                >
                  Edit permissions
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {editable ? (
        <button
          onClick={() => setEditor({ operator: null })}
          className={`text-sm underline decoration-dotted underline-offset-2 transition-colors ${
            isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'
          }`}
        >
          + Add operator
        </button>
      ) : null}

      {editor ? (
        <SetPermissionsModal
          projectId={projectId}
          chainIds={chainIds}
          existingOperator={editor.operator}
          onClose={() => setEditor(null)}
          onChanged={() => setRefreshNonce(nonce => nonce + 1)}
        />
      ) : null}
    </BackOfficeCard>
  )
}
