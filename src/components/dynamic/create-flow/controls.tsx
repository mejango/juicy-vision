/**
 * Shared create-flow primitives — React/Tailwind ports of the website's
 * fieldBlock / toggleRow / collapse / notes / pills / currencySelect etc.
 * (website/src/create-flow.js). Copy comes verbatim from the source flow.
 */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { isAddress } from 'viem'
import { resolveEnsToAddress, truncateAddress } from '../../../utils/ens'

// ---------------------------------------------------------------------------
// Theme context — avoids threading isDark through every level
// ---------------------------------------------------------------------------

export const CreateFlowTheme = createContext<{ isDark: boolean }>({ isDark: true })
export const useIsDark = () => useContext(CreateFlowTheme).isDark

// Shared class helpers
export function inputClass(isDark: boolean): string {
  return `w-full px-3 py-2 text-sm border outline-none transition-colors ${
    isDark
      ? 'bg-white/5 border-white/15 text-white placeholder-gray-500 focus:border-teal-400'
      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-teal-600'
  }`
}

export function labelClass(isDark: boolean): string {
  return `block text-xs font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`
}

export function cardClass(isDark: boolean): string {
  return `border p-4 mb-4 ${isDark ? 'border-white/10 bg-white/[0.03]' : 'border-gray-200 bg-gray-50/50'}`
}

// ---------------------------------------------------------------------------
// Text primitives
// ---------------------------------------------------------------------------

/** Step description line (the website's stepHead renders only the desc). */
export function StepHead({ desc }: { desc: string }) {
  const isDark = useIsDark()
  return <p className={`text-sm mb-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{desc}</p>
}

export function Hint({ warn, children }: { warn?: boolean; children: ReactNode }) {
  const isDark = useIsDark()
  return (
    <div className={`text-xs mt-2 ${warn ? 'text-red-400' : isDark ? 'text-gray-400' : 'text-gray-500'}`}>
      {children}
    </div>
  )
}

export function InfoNote({ children }: { children: ReactNode }) {
  const isDark = useIsDark()
  return (
    <div className={`text-xs mt-2 px-3 py-2 border ${
      isDark ? 'border-white/10 bg-white/[0.03] text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'
    }`}>
      {children}
    </div>
  )
}

export function WarnNote({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs mt-2 px-3 py-2 border border-red-400/40 bg-red-500/10 text-red-400">
      {children}
    </div>
  )
}

export function PinkNote({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs mt-2 px-3 py-2 border border-pink-400/40 bg-pink-500/10 text-pink-400">
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field block + inputs
// ---------------------------------------------------------------------------

export function FieldBlock({ label, optional, children }: { label?: string | null; optional?: boolean; children: ReactNode }) {
  const isDark = useIsDark()
  return (
    <div className="mb-4">
      {label && (
        <label className={labelClass(isDark)}>
          {label}
          {optional && <span className={`ml-1 font-normal ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>optional</span>}
        </label>
      )}
      {children}
    </div>
  )
}

export function TextInput(props: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  className?: string
  type?: string
  disabled?: boolean
}) {
  const isDark = useIsDark()
  return (
    <input
      type={props.type || 'text'}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      className={`${inputClass(isDark)} ${props.mono ? 'font-mono' : ''} ${props.className || ''}`}
    />
  )
}

export function TextArea(props: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  const isDark = useIsDark()
  return (
    <textarea
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      rows={props.rows ?? 2}
      className={inputClass(isDark)}
    />
  )
}

export function NumberInput(props: {
  value: string | number
  onChange: (v: string) => void
  placeholder?: string
  min?: number
  max?: number
  step?: number | string
  className?: string
}) {
  const isDark = useIsDark()
  return (
    <input
      type="number"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      min={props.min}
      max={props.max}
      step={props.step}
      className={`${inputClass(isDark)} ${props.className || 'w-24'}`}
    />
  )
}

export function Select(props: {
  value: string
  onChange: (v: string) => void
  options: [string, string][]
  className?: string
  disabled?: boolean
}) {
  const isDark = useIsDark()
  return (
    <select
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
      className={`select-caret pl-3 pr-6 py-2 text-sm border outline-none ${
        isDark ? 'bg-juice-dark border-white/15 text-white' : 'bg-white border-gray-300 text-gray-900'
      } ${props.className || 'w-auto'}`}
    >
      {props.options.map(([v, label]) => (
        <option key={v} value={v}>{label}</option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Toggle rows — the website's toggleRow(label, dz(on, off), checked)
// ---------------------------------------------------------------------------

export function ToggleRow(props: {
  label: string
  on?: string
  off?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const isDark = useIsDark()
  const sub = props.checked ? props.on : props.off
  return (
    <label className="flex items-start gap-3 py-2 cursor-pointer">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="mt-0.5 accent-teal-500"
      />
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{props.label}</div>
        {sub ? <div className={`text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{sub}</div> : null}
      </div>
    </label>
  )
}

/** Disabled toggle with an explanatory sub-line (the website's idleToggle). */
export function IdleToggle({ label, sub }: { label: string; sub: string }) {
  const isDark = useIsDark()
  return (
    <div className="flex items-start gap-3 py-2 opacity-50">
      <input type="checkbox" checked={false} disabled className="mt-0.5" readOnly />
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>{label}</div>
        <div className={`text-xs mt-0.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{sub}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapse — label row with caret; open flag lives in caller state
// ---------------------------------------------------------------------------

export function Collapse(props: {
  label: string
  optional?: boolean
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const isDark = useIsDark()
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={props.onToggle}
        className={`flex items-center gap-2 text-sm w-full text-left py-1 ${isDark ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'}`}
      >
        <span className="text-xs">{props.open ? '▾' : '▸'}</span>
        <span>{props.label}</span>
        {props.optional && <span className={`text-xs font-normal ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>optional</span>}
      </button>
      {props.open && <div className="mt-2 pl-5">{props.children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pills + inline toggle link
// ---------------------------------------------------------------------------

export function Pill(props: { label: string; selected: boolean; onClick: () => void }) {
  const isDark = useIsDark()
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`px-3 py-1.5 text-sm border transition-colors ${
        props.selected
          ? 'border-teal-400 text-teal-400 bg-teal-400/10'
          : isDark
            ? 'border-white/15 text-gray-400 hover:border-white/30'
            : 'border-gray-300 text-gray-500 hover:border-gray-400'
      }`}
    >
      {props.label}
    </button>
  )
}

/** Inline dotted-underline toggle link (the website's .create-inline-toggle). */
export function InlineToggleLink({ label, title, onClick }: { label: string; title?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="underline decoration-dotted underline-offset-2 text-teal-400 hover:text-teal-300"
    >
      {label}
    </button>
  )
}

export function AddLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-teal-400 hover:text-teal-300 mt-1"
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Currency select — ETH/USD, or locked to a fixed symbol (custom token / USDC)
// ---------------------------------------------------------------------------

export function CurrencySelect(props: {
  value: number
  onChange: (v: number) => void
  /** When set the control is a fixed non-interactive symbol (custom token / USD lock). */
  lockedSymbol?: string | null
}) {
  const isDark = useIsDark()
  if (props.lockedSymbol) {
    return (
      <span className={`px-2 py-1 text-sm border ${isDark ? 'border-white/15 text-gray-300' : 'border-gray-300 text-gray-600'}`}>
        {props.lockedSymbol}
      </span>
    )
  }
  return (
    <Select
      value={String(props.value)}
      onChange={(v) => props.onChange(parseInt(v, 10))}
      options={[['1', 'ETH'], ['2', 'USD']]}
    />
  )
}

// ---------------------------------------------------------------------------
// ENS-aware address input (0x… or name.eth) with 400ms debounce resolution
// ---------------------------------------------------------------------------

export function EnsAddressInput(props: {
  value: string
  onChange: (v: string) => void
  onResolved?: (address: string | null) => void
  placeholder?: string
  className?: string
}) {
  const [resolved, setResolved] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const { onResolved } = props
  const value = props.value

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    setResolved(null)
    const v = value.trim()
    if (!v || isAddress(v, { strict: false }) || !v.includes('.')) {
      onResolved?.(isAddress(v, { strict: false }) ? v : null)
      return
    }
    timer.current = window.setTimeout(async () => {
      const addr = await resolveEnsToAddress(v)
      setResolved(addr)
      onResolved?.(addr)
    }, 400)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [value, onResolved])

  return (
    <div className={props.className}>
      <TextInput
        value={props.value}
        onChange={props.onChange}
        placeholder={props.placeholder || '0x… or name.eth'}
        mono
      />
      {resolved && (
        <div className="text-xs mt-1 text-teal-400 font-mono">→ {truncateAddress(resolved)}</div>
      )}
      {!resolved && value.trim().includes('.') && !isAddress(value.trim(), { strict: false }) && value.trim() && (
        <div className="text-xs mt-1 text-gray-500">Resolving…</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Image / media picker — preview square + native file input; caller pins
// ---------------------------------------------------------------------------

export function ImagePicker(props: {
  uri: string
  busy: boolean
  accept?: string
  onPick: (file: File) => void
  onClear?: () => void
}) {
  const isDark = useIsDark()
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`w-16 h-16 border flex items-center justify-center overflow-hidden ${
          isDark ? 'border-white/15 bg-white/5 text-gray-500' : 'border-gray-300 bg-gray-50 text-gray-400'
        }`}
      >
        {props.busy ? (
          <span className="text-[10px]">Uploading…</span>
        ) : props.uri ? (
          <img src={props.uri.replace('ipfs://', 'https://ipfs.io/ipfs/')} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-2xl">+</span>
        )}
      </button>
      {props.uri && props.onClear && (
        <button type="button" onClick={props.onClear} className="text-xs text-gray-500 hover:text-red-400">✕ remove</button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={props.accept || 'image/*'}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) props.onPick(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
