import { useEffect, useState } from 'react'
import {
  JBCoreContracts,
  jbContractAddress,
  jbControllerAbi,
  jbDirectoryAbi,
  jbTokensAbi,
  type JBChainId,
} from '@bananapus/nana-sdk-core'
import { encodeFunctionData, formatUnits, parseUnits, zeroAddress } from 'viem'
import { CHAINS } from '../../../constants'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import { publicClientFor, type GuardedTxPhase } from '../../../services/projectTx'
import { useThemeStore } from '../../../stores'
import ChainLogo from '../../ui/ChainLogo'
import DialogShell from '../../ui/DialogShell'

export type BurnTokensRow = {
  chainId: number
  projectId: number | string
  balance: bigint
}

export function BurnTokensModal({
  isOpen,
  onClose,
  rows,
  tokenSymbol,
  onBurned,
}: {
  isOpen: boolean
  onClose: () => void
  rows: BurnTokensRow[]
  tokenSymbol: string
  onBurned?: (chainId: number) => void
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [memos, setMemos] = useState<Record<number, string>>({})
  const [status, setStatus] = useState<Record<number, string>>({})
  const [running, setRunning] = useState<number | null>(null)

  useEffect(() => {
    if (isOpen) {
      setAmounts({})
      setMemos({})
      setStatus({})
      setRunning(null)
    }
  }, [isOpen])
  if (!isOpen) return null

  async function burn(row: BurnTokensRow) {
    if (!activeAddress) return
    let count = 0n
    try {
      count = parseUnits((amounts[row.chainId] || '').trim(), 18)
    } catch {
      count = 0n
    }
    if (count <= 0n || count > row.balance) {
      setStatus(previous => ({ ...previous, [row.chainId]: 'Enter an amount within your balance.' }))
      return
    }
    setRunning(row.chainId)
    setStatus(previous => ({ ...previous, [row.chainId]: 'Re-checking the controller and balance…' }))
    try {
      const chainId = row.chainId as JBChainId
      const directory = jbContractAddress['6'][JBCoreContracts.JBDirectory][chainId]
      const client = publicClientFor(row.chainId)
      const projectId = BigInt(row.projectId)
      const freshBalance = await client.readContract({
        address: jbContractAddress['6'][JBCoreContracts.JBTokens][chainId],
        abi: jbTokensAbi,
        functionName: 'totalBalanceOf',
        args: [activeAddress, projectId],
      })
      if (count > freshBalance) throw new Error('Your token balance changed. Review the amount.')
      const controller = await client.readContract({
        address: directory,
        abi: jbDirectoryAbi,
        functionName: 'controllerOf',
        args: [projectId],
      })
      if (!controller || controller === zeroAddress) throw new Error('Project controller is unavailable.')
      const args = [activeAddress, projectId, count, memos[row.chainId]?.trim() || ''] as const
      const data = encodeFunctionData({
        abi: jbControllerAbi,
        functionName: 'burnTokensOf',
        args,
      })
      const hash = await run({
        chainId: row.chainId,
        to: controller,
        data,
        review: {
          title: 'Review permanent token burn',
          label: `Burn ${formatUnits(count, 18)} ${tokenSymbol} without receiving funds`,
          contractName: 'JBController',
          abi: jbControllerAbi,
          functionName: 'burnTokensOf',
          args,
        },
        reverify: async () => {
          const latestBalance = await client.readContract({
            address: jbContractAddress['6'][JBCoreContracts.JBTokens][chainId],
            abi: jbTokensAbi,
            functionName: 'totalBalanceOf',
            args: [activeAddress, projectId],
          })
          if (count > latestBalance) throw new Error('Your token balance changed. Review the amount.')
          const freshController = await client.readContract({
            address: directory,
            abi: jbDirectoryAbi,
            functionName: 'controllerOf',
            args: [projectId],
          })
          if (freshController.toLowerCase() !== controller.toLowerCase()) {
            throw new Error('The project controller changed. Review again.')
          }
        },
        onPhase: (phase: GuardedTxPhase) =>
          setStatus(previous => ({ ...previous, [row.chainId]: phaseLabel(phase) })),
      })
      setStatus(previous => ({ ...previous, [row.chainId]: `Burned. ${hash.slice(0, 10)}…` }))
      onBurned?.(row.chainId)
    } catch (error) {
      setStatus(previous => ({
        ...previous,
        [row.chainId]: error instanceof Error ? error.message : 'Burn failed.',
      }))
    } finally {
      setRunning(null)
    }
  }

  return (
    <DialogShell isOpen onClose={onClose} dismissible={running === null} labelledBy="burn-tokens-title">
      <div className={`w-full max-w-lg border ${isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'}`}>
        <div className={`px-5 py-4 border-b ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <h2 id="burn-tokens-title" className="font-semibold">Burn tokens</h2>
          <p className={`mt-1 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            Permanently remove tokens from supply without receiving treasury funds. Credits burn
            before claimed ERC-20 tokens. This cannot be undone.
          </p>
        </div>
        <div className="p-5 space-y-3">
          {rows.map(row => (
            <div key={row.chainId} className={`border p-3 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2">
                  <ChainLogo chainId={row.chainId} size={14} />
                  {CHAINS[row.chainId]?.name ?? row.chainId}
                </span>
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => setAmounts(previous => ({ ...previous, [row.chainId]: formatUnits(row.balance, 18) }))}
                >
                  Max {formatUnits(row.balance, 18)}
                </button>
              </div>
              <input
                className={`mt-2 w-full border px-3 py-2 text-sm ${isDark ? 'bg-juice-dark border-white/15' : 'bg-white border-gray-300'}`}
                inputMode="decimal"
                placeholder={`Amount of ${tokenSymbol}`}
                value={amounts[row.chainId] || ''}
                onChange={event => setAmounts(previous => ({ ...previous, [row.chainId]: event.target.value }))}
              />
              <input
                className={`mt-2 w-full border px-3 py-2 text-sm ${isDark ? 'bg-juice-dark border-white/15' : 'bg-white border-gray-300'}`}
                placeholder="Memo (optional)"
                maxLength={256}
                value={memos[row.chainId] || ''}
                onChange={event => setMemos(previous => ({ ...previous, [row.chainId]: event.target.value }))}
              />
              {status[row.chainId] ? <p className="mt-2 text-xs">{status[row.chainId]}</p> : null}
              <button
                type="button"
                className="mt-2 w-full bg-amber-500 px-3 py-2 text-sm font-bold text-black disabled:opacity-40"
                disabled={running !== null}
                onClick={() => burn(row)}
              >
                Burn permanently
              </button>
            </div>
          ))}
        </div>
      </div>
    </DialogShell>
  )
}

function phaseLabel(phase: GuardedTxPhase) {
  const labels: Record<GuardedTxPhase, string> = {
    reverifying: 'Re-checking reviewed state…',
    switching: 'Switching network…',
    approving: 'Approving…',
    simulating: 'Simulating…',
    signing: 'Confirm in your wallet…',
    pending: 'Transaction pending…',
  }
  return labels[phase]
}
