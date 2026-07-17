/**
 * Transfer the project's controlling authority — ports website/src/discover.js
 * openTransferAuthorityModal (:7156).
 *
 * Revnet: REVOwner.setOperatorOf(projectId, to) hands over the operator role
 * (zero address relinquishes it permanently).
 * Custom: JBProjects.transferFrom(owner, to, projectId) transfers the
 * ownership NFT itself.
 *
 * DANGER-gated, executed per chain through the guarded runner. The reverify
 * step re-reads the current authority on that chain and aborts if it changed
 * since review.
 */

import { useState } from 'react'
import { isAddress, zeroAddress, type Address } from 'viem'
import { useThemeStore } from '../../../stores'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import {
  buildSetOperatorRequest,
  buildTransferOwnershipRequest,
  readIsRevnetOperator,
  readProjectOwner,
} from '../../../services/permissionsAdmin'
import { BackOfficeModal, ChainRunRows, DangerGate, chainName, shortAddress, type ChainRunState } from './shared'

export interface TransferAuthorityModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: number
  isRevnet: boolean
  /** The authority shown at review time — the current owner (custom) or operator (revnet). */
  currentAuthority: Address
  /** The chains this authority controls (per-chain execution, one guarded run each). */
  chainIds: number[]
}

export function TransferAuthorityModal({
  isOpen,
  onClose,
  projectId,
  isRevnet,
  currentAuthority,
  chainIds,
}: TransferAuthorityModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const [to, setTo] = useState('')
  const [gateChecked, setGateChecked] = useState(false)
  const [statuses, setStatuses] = useState<Record<number, ChainRunState>>({})

  if (!isOpen) return null

  const roleLabel = isRevnet ? 'operator' : 'ownership'
  const trimmed = to.trim()
  // Revnets may set the zero address to relinquish the operator role; a custom
  // ownership transfer to the zero address would burn the project NFT — block it.
  const validTo =
    isAddress(trimmed) && (isRevnet || trimmed.toLowerCase() !== zeroAddress)
  const anyRunning = Object.values(statuses).some(status => status.kind === 'running')

  const setStatus = (chainId: number, status: ChainRunState) =>
    setStatuses(previous => ({ ...previous, [chainId]: status }))

  const execute = async (chainId: number) => {
    if (!activeAddress) {
      setStatus(chainId, { kind: 'error', message: 'Connect a wallet first.' })
      return
    }
    const newAuthority = trimmed as Address
    const pid = BigInt(projectId)
    try {
      const request = isRevnet
        ? buildSetOperatorRequest({ chainId, to: newAuthority, projectId: pid })
        : buildTransferOwnershipRequest({ chainId, owner: currentAuthority, to: newAuthority, projectId: pid })
      const txHash = await run({
        chainId,
        to: request.to,
        data: request.data,
        // Reviewed-state re-verification: abort when the authority shown at
        // review time is no longer the current authority on this chain.
        reverify: async () => {
          if (isRevnet) {
            const stillOperator = await readIsRevnetOperator(chainId, pid, currentAuthority)
            if (!stillOperator) {
              throw new Error(
                `${shortAddress(currentAuthority)} is no longer the operator on ${chainName(chainId)}. Reopen to refresh.`,
              )
            }
          } else {
            const owner = await readProjectOwner(chainId, pid)
            if (owner.toLowerCase() !== currentAuthority.toLowerCase()) {
              throw new Error(
                `The owner on ${chainName(chainId)} changed since review (now ${shortAddress(owner)}). Reopen to refresh.`,
              )
            }
          }
        },
        onPhase: phase => setStatus(chainId, { kind: 'running', phase }),
      })
      setStatus(chainId, { kind: 'done', txHash })
    } catch (error) {
      setStatus(chainId, {
        kind: 'error',
        message: error instanceof Error ? error.message : 'The transfer failed.',
      })
    }
  }

  return (
    <BackOfficeModal
      title={isRevnet ? 'Transfer operator' : 'Transfer ownership'}
      onClose={onClose}
      busy={anyRunning}
      isDark={isDark}
    >
      <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        {isRevnet
          ? `Hands over operator control on ${chainIds.map(chainName).join(', ')}. Use the zero address to relinquish operator powers permanently. Does not move funds or change rulesets.`
          : `Transfers project ownership (the JBProjects NFT) on ${chainIds.map(chainName).join(', ')}. The new owner controls owner-only actions there. Does not move funds or change rulesets.`}
      </p>

      <div className="space-y-1">
        <label className={`block text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          Current {isRevnet ? 'operator' : 'owner'}
        </label>
        <div className={`text-sm font-mono break-all ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          {currentAuthority}
        </div>
      </div>

      <div className="space-y-1">
        <label className={`block text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
          New {isRevnet ? 'operator' : 'owner'}
        </label>
        <input
          type="text"
          value={to}
          onChange={event => setTo(event.target.value)}
          placeholder={`0x… new ${isRevnet ? 'operator' : 'owner'} address`}
          spellCheck={false}
          className={`w-full px-3 py-2 text-sm font-mono border bg-transparent outline-none ${
            isDark
              ? 'border-white/20 text-white placeholder-gray-600 focus:border-white/40'
              : 'border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-500'
          }`}
        />
        {trimmed && !validTo ? (
          <p className="text-sm text-red-400">
            {isAddress(trimmed) ? 'Ownership cannot be transferred to the zero address.' : 'Not a valid address.'}
          </p>
        ) : null}
        {isRevnet && trimmed.toLowerCase() === zeroAddress ? (
          <p className={`text-sm ${isDark ? 'text-yellow-400' : 'text-yellow-700'}`}>
            Zero address: the operator role is relinquished permanently.
          </p>
        ) : null}
      </div>

      <DangerGate
        isDark={isDark}
        text={
          isRevnet
            ? 'Dangerous and hard to reverse: the new operator gains every operator power over this revnet, and only they (or the zero address, permanently no one) can hand it back.'
            : 'Dangerous and irreversible from your side: the new owner gains full control of the project, and only they can transfer it back.'
        }
        confirmLabel={`I understand — I have verified the new ${isRevnet ? 'operator' : 'owner'} address and want to transfer ${roleLabel}.`}
        checked={gateChecked}
        onChange={setGateChecked}
      />

      <ChainRunRows
        chainIds={chainIds}
        statuses={statuses}
        onExecute={execute}
        disabled={!validTo || !gateChecked || anyRunning}
        disabledReason={!validTo ? 'Enter a valid address first' : 'Tick the confirmation box to proceed'}
        isDark={isDark}
      />
    </BackOfficeModal>
  )
}
