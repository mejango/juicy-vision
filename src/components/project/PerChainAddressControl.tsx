/**
 * Per-chain address override control — the React/Tailwind analogue of the
 * website's makePerChainAddressControl. Collapsed it is a "Set per chain" link;
 * expanded it shows one ENS-aware input per chain, each defaulting to the global
 * value. Overrides live in the parent, keyed by chainId. Only rendered with 2+
 * chains (a single-chain deploy uses the global input directly).
 */

import { useEffect, useRef, useState } from 'react'
import { isAddress } from 'viem'
import { CHAINS } from '../../constants'
import { resolveEnsToAddress, truncateAddress } from '../../utils/ens'
import ChainLogo from '../ui/ChainLogo'

interface PerChainAddressControlProps {
  chains: Array<{ chainId: number }>
  /** The shared/global raw input every chain falls back to when it has no override. */
  globalValue: string
  overrides: Record<number, string>
  onChange: (chainId: number, value: string) => void
  onClear: () => void
  isDark: boolean
  placeholder?: string
}

function chainLabel(chainId: number): string {
  return CHAINS[chainId]?.shortName || CHAINS[chainId]?.name || `Chain ${chainId}`
}

/** One chain's override input with debounced ENS/address recognition. */
function PerChainRow(props: {
  chainId: number
  value: string
  fallback: string
  onChange: (value: string) => void
  isDark: boolean
  placeholder?: string
}) {
  const { isDark } = props
  const [resolved, setResolved] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  // The value that actually deploys on this chain: its own override, else the global default.
  const effective = (props.value.trim() || props.fallback.trim())

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    setResolved(null)
    const v = effective
    if (!v || isAddress(v, { strict: false }) || !v.includes('.')) return
    timer.current = window.setTimeout(async () => {
      const addr = await resolveEnsToAddress(v)
      setResolved(addr)
    }, 400)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [effective])

  const input = `w-full px-3 py-2 text-sm border outline-none font-mono ${
    isDark
      ? 'bg-juice-dark border-white/15 text-white placeholder-gray-500'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
  }`

  return (
    <div className="flex items-start gap-2">
      <span
        className={`text-xs w-24 shrink-0 pt-2 inline-flex items-center gap-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}
      >
        <ChainLogo chainId={props.chainId} size={14} />
        {chainLabel(props.chainId)}
      </span>
      <div className="flex-1 min-w-0">
        <input
          className={input}
          type="text"
          placeholder={props.fallback.trim() ? `default (${props.placeholder || '0x… or name.eth'})` : (props.placeholder || '0x… or name.eth')}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          spellCheck={false}
        />
        {resolved && isAddress(resolved, { strict: false }) && (
          <div className="text-xs mt-1 text-juice-orange font-mono">→ {truncateAddress(resolved)}</div>
        )}
        {!resolved && effective.includes('.') && !isAddress(effective, { strict: false }) && (
          <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Resolving…</div>
        )}
      </div>
    </div>
  )
}

export default function PerChainAddressControl(props: PerChainAddressControlProps) {
  const { isDark, chains } = props
  const hasOverrides = Object.values(props.overrides).some((v) => v && v.trim())
  const [open, setOpen] = useState(hasOverrides)

  // Fewer than two chains: a single deploy just uses the global input.
  if (chains.length < 2) return null

  if (!open) {
    return (
      <div className="text-right">
        <button
          type="button"
          title="Set a different address on each selected chain"
          onClick={() => setOpen(true)}
          className={`text-xs ${isDark ? 'text-gray-500 hover:text-juice-orange' : 'text-gray-500 hover:text-juice-orange'}`}
        >
          Set per chain
        </button>
      </div>
    )
  }

  return (
    <div className={`mt-2 border p-2 space-y-2 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
      {chains.map((c) => (
        <PerChainRow
          key={c.chainId}
          chainId={c.chainId}
          value={props.overrides[c.chainId] || ''}
          fallback={props.globalValue}
          onChange={(v) => props.onChange(c.chainId, v)}
          isDark={isDark}
          placeholder={props.placeholder}
        />
      ))}
      <button
        type="button"
        onClick={() => { props.onClear(); setOpen(false) }}
        className={`text-xs ${isDark ? 'text-gray-500 hover:text-juice-orange' : 'text-gray-500 hover:text-juice-orange'}`}
      >
        Use same on all chains
      </button>
    </div>
  )
}
