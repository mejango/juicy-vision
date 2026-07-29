/**
 * Shared building blocks for the Owner/Operator ("back office") tab modals:
 * the red danger gate every state-changing action must pass, the modal shell,
 * and the per-chain guarded-execution rows (one guarded run per chain — no
 * Relayr bundling here).
 */

import { type ReactNode } from 'react'
import { CHAINS } from '../../../constants'
import type { GuardedTxPhase } from '../../../services/projectTx'
import { isSafeAppActive } from '../../../services/safeApp'
import DialogShell from '../../ui/DialogShell'

export const PHASE_LABELS: Record<GuardedTxPhase, string> = {
  reverifying: 'Re-checking on-chain state…',
  switching: 'Switching network…',
  approving: 'Approving…',
  simulating: 'Simulating…',
  signing: 'Confirm in your wallet…',
  pending: 'Transaction pending…',
}

export type ChainRunState =
  | { kind: 'idle' }
  | { kind: 'running'; phase: GuardedTxPhase }
  | { kind: 'done'; txHash: `0x${string}` }
  | { kind: 'error'; message: string }

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function chainName(chainId: number): string {
  return CHAINS[chainId]?.name ?? `Chain ${chainId}`
}

/**
 * The mandatory danger gate: red banner + explicit "I understand" checkbox.
 * Actions stay disabled until the box is ticked (website appendDangerGate).
 */
export function DangerGate({
  text,
  confirmLabel,
  checked,
  onChange,
  isDark,
}: {
  text: string
  confirmLabel?: string
  checked: boolean
  onChange: (checked: boolean) => void
  isDark: boolean
}) {
  return (
    <div className={`border ${isDark ? 'bg-red-500/10 border-red-500/30' : 'bg-red-50 border-red-200'}`}>
      <p className={`px-4 py-3 text-sm ${isDark ? 'text-red-400' : 'text-red-700'}`}>{text}</p>
      <label
        className={`flex items-start gap-3 px-4 py-3 border-t cursor-pointer ${
          isDark ? 'border-red-500/20' : 'border-red-200'
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={event => onChange(event.target.checked)}
          className="mt-0.5 w-4 h-4 border-2 border-red-400 text-red-500 focus:ring-red-500"
        />
        <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          {confirmLabel ?? 'I understand this is permanent and have verified every detail above.'}
        </span>
      </label>
    </div>
  )
}

/** Portal modal shell shared by the back-office action modals. */
export function BackOfficeModal({
  title,
  onClose,
  busy,
  isDark,
  children,
}: {
  title: string
  onClose: () => void
  /** Blocks closing while a guarded run is in flight. */
  busy: boolean
  isDark: boolean
  children: ReactNode
}) {
  // Escape is handled natively by the <dialog>'s `cancel` event; DialogShell
  // suppresses it while `busy`.
  return (
    <DialogShell isOpen onClose={onClose} dismissible={!busy} labelledBy="back-office-modal-title">
      <div
        className={`relative w-full max-w-lg max-h-[85vh] overflow-y-auto border ${
          isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
        }`}
      >
        <div
          className={`sticky top-0 px-5 py-4 border-b flex items-center justify-between ${
            isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-100'
          }`}
        >
          <h2 id="back-office-modal-title" className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{title}</h2>
          {!busy ? (
            <button
              onClick={onClose}
              aria-label="Close"
              className={`p-2 transition-colors ${
                isDark
                  ? 'text-gray-400 hover:text-white hover:bg-white/10'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </DialogShell>
  )
}

/**
 * Per-chain guarded execution rows: each selected chain gets its own Execute
 * button running ONE guarded transaction (reverify → simulate → send).
 */
export function ChainRunRows({
  chainIds,
  statuses,
  onExecute,
  disabled,
  disabledReason,
  isDark,
}: {
  chainIds: number[]
  statuses: Record<number, ChainRunState>
  onExecute: (chainId: number) => void
  /** True while the gate is unticked or inputs are invalid. */
  disabled: boolean
  disabledReason?: string
  isDark: boolean
}) {
  return (
    <div className="space-y-2">
      {chainIds.map(chainId => {
        const status = statuses[chainId] ?? { kind: 'idle' }
        const chain = CHAINS[chainId]
        return (
          <div key={chainId} className={`border p-3 space-y-2 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between gap-3">
              <span className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{chainName(chainId)}</span>
              {status.kind === 'idle' || status.kind === 'error' ? (
                <button
                  onClick={() => onExecute(chainId)}
                  disabled={disabled}
                  title={disabled ? disabledReason : undefined}
                  className={`px-3 py-1 text-sm border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    isDark
                      ? 'border-white/20 text-white hover:bg-white/10'
                      : 'border-gray-300 text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  {status.kind === 'error' ? 'Retry' : 'Execute'}
                </button>
              ) : null}
            </div>
            {status.kind === 'running' ? (
              <div className={`flex items-center gap-2 text-sm ${isDark ? 'text-juice-cyan' : 'text-cyan-700'}`}>
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                {PHASE_LABELS[status.phase]}
              </div>
            ) : null}
            {status.kind === 'done' ? (
              isSafeAppActive() ? (
                <div className={`text-sm ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                  Proposed to your Safe on {chainName(chainId)} — owners must sign &amp; execute it in Safe&#123;Wallet&#125;.
                </div>
              ) : (
                <div className={`text-sm ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                  Executed on {chainName(chainId)}.{' '}
                  {chain ? (
                    <a
                      href={`${chain.explorerTx}${status.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-juice-cyan hover:underline"
                    >
                      View on explorer →
                    </a>
                  ) : null}
                </div>
              )
            ) : null}
            {status.kind === 'error' ? (
              <div className="text-sm text-red-400" role="alert">
                {status.message}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** Card shell matching the project-page detail cards (squared corners, titled). */
export function BackOfficeCard({
  title,
  isDark,
  children,
}: {
  title: string
  isDark: boolean
  children: ReactNode
}) {
  return (
    <div className={`border p-4 space-y-3 ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`}>
      <div className={`text-xs font-medium uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        {title}
      </div>
      {children}
    </div>
  )
}
