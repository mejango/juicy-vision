/**
 * Shared create-flow composite controls — React ports of the website's
 * cashOutTaxCard/curve, recipient picker, split rows, per-chain overrides,
 * and split lock row (website/src/create-flow.js). Copy is verbatim.
 */

import { useRef, useState, type ReactNode } from 'react'
import { CHAINS } from '../../../constants'
import type { CreateFlowState, RecipientRow } from './state'
import {
  CurrencySelect, EnsAddressInput, Hint, InfoNote, NumberInput, Select, TextInput, useIsDark,
} from './controls'

// ---------------------------------------------------------------------------
// Cash-out tax chips + bonding-curve preview
// ---------------------------------------------------------------------------

const CASHOUT_LEVELS: { n: string; v: number }[] = [
  { n: 'No tax', v: 0 }, { n: '', v: 0.1 }, { n: '', v: 0.2 }, { n: 'Light', v: 0.3 }, { n: '', v: 0.4 },
  { n: 'Medium', v: 0.5 }, { n: '', v: 0.6 }, { n: 'Heavy', v: 0.7 }, { n: '', v: 0.8 }, { n: 'Extreme', v: 0.9 },
]

function CashOutCurve({ r }: { r: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ cx: number; cy: number; label: string } | null>(null)
  const W = 320, H = 170, padL = 30, padR = 10, padT = 10, padB = 26
  const x0 = padL, x1 = W - padR, y0 = H - padB, y1 = padT
  const X = (t: number) => x0 + (x1 - x0) * t
  const Y = (v: number) => y0 + (y1 - y0) * v
  const pts: string[] = []
  for (let i = 0; i <= 40; i++) {
    const t = i / 40
    const f = t * ((1 - r) + r * t)
    pts.push(`${X(t).toFixed(1)},${Y(f).toFixed(1)}`)
  }
  const midY = (y0 + y1) / 2

  return (
    <div
      ref={wrapRef}
      className="relative mt-2"
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const rect = wrapRef.current?.querySelector('svg')?.getBoundingClientRect()
        const wr = wrapRef.current?.getBoundingClientRect()
        if (!rect || !wr) return
        const plotL = rect.left + (padL / W) * rect.width
        const plotR = rect.left + ((W - padR) / W) * rect.width
        const plotT = rect.top + (padT / H) * rect.height
        const plotB = rect.top + ((H - padB) / H) * rect.height
        let x = (e.clientX - plotL) / (plotR - plotL)
        x = Math.max(0, Math.min(1, x))
        const f = x * ((1 - r) + r * x)
        setHover({
          cx: plotL + x * (plotR - plotL) - wr.left,
          cy: plotB - f * (plotB - plotT) - wr.top,
          label: `${(x * 100).toFixed(1)}% cashed out → ${(f * 100).toFixed(1)}% of funds`,
        })
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
        <line x1={x0} y1={y1} x2={x0} y2={y0} stroke="#7d6858" strokeWidth="1" />
        <line x1={x0} y1={y0} x2={x1} y2={y0} stroke="#7d6858" strokeWidth="1" />
        <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="rgba(128,128,128,0.35)" strokeWidth="1.2" />
        <polyline points={pts.join(' ')} fill="none" stroke="#b8602e" strokeWidth="2" />
        <text x={(x0 + x1) / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="#8d7a6e">% tokens cashed out</text>
        <text x={11} y={midY} textAnchor="middle" fontSize="9" fill="#8d7a6e" transform={`rotate(-90 11 ${midY})`}>cash out value</text>
      </svg>
      {hover && (
        <>
          <div className="absolute w-2 h-2 rounded-full bg-orange-500 -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ left: hover.cx, top: hover.cy }} />
          <div
            className="absolute text-[10px] px-1.5 py-0.5 bg-black/80 text-white whitespace-nowrap -translate-x-1/2 pointer-events-none"
            style={{ left: Math.max(56, Math.min(hover.cx, (wrapRef.current?.clientWidth || 320) - 56)), top: hover.cy - 24 }}
          >
            {hover.label}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Tax chips + custom input + curve. `taxRate` is a percent 0–100.
 * `reclaimVerb` switches to the revnet copy ("Cashing out 10% of $TK gets …").
 */
export function CashOutTaxCard(props: {
  taxRate: number
  onChange: (pct: number) => void
  acctSym: string
  reclaimVerb?: string
  bare?: boolean
}) {
  const isDark = useIsDark()
  const presetPcts = CASHOUT_LEVELS.map((l) => l.v * 100)
  const isCustom = !presetPcts.includes(Number(props.taxRate))
  const r = Math.max(0, Math.min(100, Number(props.taxRate) || 0)) / 100
  const pct10 = 0.1 * ((1 - r) + r * 0.1) * 100
  const subCopy = props.reclaimVerb
    ? `Cashing out 10% of $${props.reclaimVerb} gets ${Math.round(pct10 * 10) / 10}% of the revnet’s ${props.acctSym}.`
    : `Cashing out 10% of your tokens returns ${Math.round(pct10 * 10) / 10}% of the project’s surplus ${props.acctSym}.`

  const chipClass = (active: boolean) =>
    `flex flex-col items-center px-2 py-1 border text-xs min-w-[44px] ${
      active
        ? 'border-teal-400 text-teal-400 bg-teal-400/10'
        : isDark ? 'border-white/15 text-gray-400 hover:border-white/30' : 'border-gray-300 text-gray-500 hover:border-gray-400'
    }`

  return (
    <div className={props.bare ? '' : `border p-3 mt-2 ${isDark ? 'border-white/10 bg-white/[0.02]' : 'border-gray-200 bg-gray-50/50'}`}>
      <div className="flex flex-wrap gap-1.5">
        {CASHOUT_LEVELS.map((l) => {
          const pct = l.v * 100
          return (
            <button key={l.v} type="button" className={chipClass(!isCustom && Number(props.taxRate) === pct)} onClick={() => props.onChange(pct)}>
              <span>{String(l.v)}</span>
              <span className="text-[10px] opacity-70 h-3.5">{l.n || ''}</span>
            </button>
          )
        })}
        <button type="button" className={chipClass(isCustom)} onClick={() => { if (!isCustom) props.onChange(5) }}>
          <span>Custom</span>
          <span className="text-[10px] h-3.5" />
        </button>
      </div>
      {isCustom && (
        <div className="flex items-center gap-2 mt-2 text-sm">
          <span>Cash out tax</span>
          <NumberInput
            value={Math.round(props.taxRate) / 100}
            onChange={(v) => props.onChange(Math.max(0, Math.min(0.99, Number(v) || 0)) * 100)}
            min={0} max={0.99} step={0.01}
            className="w-20"
          />
          <span>(0–1)</span>
        </div>
      )}
      <Hint>{subCopy}</Hint>
      <CashOutCurve r={r} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-chain override controls ("Set per chain" / "Use same on all chains")
// ---------------------------------------------------------------------------

function perChainOps(state: CreateFlowState, update: (fn: (s: CreateFlowState) => void) => void) {
  return {
    get(chainId: number, kind: 'addr' | 'num', key: string): string {
      return state.perChain[chainId]?.[kind]?.[key] || ''
    },
    set(chainId: number, kind: 'addr' | 'num', key: string, value: string) {
      update((s) => {
        if (!s.perChain[chainId]) s.perChain[chainId] = {}
        const bucket = (s.perChain[chainId][kind] ||= {})
        if (value) bucket[key] = value
        else delete bucket[key]
      })
    },
    clear(kind: 'addr' | 'num', key: string) {
      update((s) => {
        Object.values(s.perChain).forEach((c) => { if (c[kind]) delete c[kind]![key] })
      })
    },
  }
}

/** Only shown with 2+ chains. Collapsed → "Set per chain" link; expanded → one field per chain. */
export function PerChainControl(props: {
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
  fieldKey: string
  kind: 'addr' | 'num'
  linkLabel?: string
  renderField: (chainId: number, value: string, setValue: (v: string) => void) => ReactNode
}) {
  const isDark = useIsDark()
  const [open, setOpen] = useState(perChainHasAny(props.state, props.kind, props.fieldKey))
  const pc = perChainOps(props.state, props.update)
  if (props.state.chainIds.length < 2) return null
  if (!open) {
    return (
      <div className="text-right">
        <button
          type="button"
          title="Set a different value on each chain"
          onClick={() => setOpen(true)}
          className="text-xs text-gray-500 hover:text-teal-400"
        >
          {props.linkLabel || 'Set per chain'}
        </button>
      </div>
    )
  }
  return (
    <div className={`mt-2 border p-2 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
      {props.state.chainIds.map((chainId) => (
        <div key={chainId} className="flex items-center gap-2 mb-1.5">
          <span className={`text-xs w-20 shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {CHAINS[chainId]?.shortName || chainId}
          </span>
          <div className="flex-1">
            {props.renderField(chainId, pc.get(chainId, props.kind, props.fieldKey), (v) => pc.set(chainId, props.kind, props.fieldKey, v))}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => { pc.clear(props.kind, props.fieldKey); setOpen(false) }}
        className="text-xs text-gray-500 hover:text-teal-400"
      >
        Use same on all chains
      </button>
    </div>
  )
}

function perChainHasAny(state: CreateFlowState, kind: 'addr' | 'num', key: string): boolean {
  return Object.values(state.perChain || {}).some((c) => !!c[kind]?.[key])
}

export function PerChainAddrControl(props: {
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
  fieldKey: string
}) {
  return (
    <PerChainControl
      state={props.state}
      update={props.update}
      fieldKey={props.fieldKey}
      kind="addr"
      renderField={(chainId, value, setValue) => (
        <TextInput value={value} onChange={setValue} placeholder="0x…" mono />
      )}
    />
  )
}

export function PerChainNumControl(props: {
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
  fieldKey: string
  placeholder?: string
  /** Custom collapsed-link label (website: 'Set amount per chain', 'Set quantity per chain'). */
  linkLabel?: string
}) {
  return (
    <PerChainControl
      state={props.state}
      update={props.update}
      fieldKey={props.fieldKey}
      // All per-chain overrides live in the addr store under prefixed keys —
      // the website's canonical scheme (ef5fbdf), shared via .jb drafts.
      kind="addr"
      linkLabel={props.linkLabel}
      renderField={(chainId, value, setValue) => (
        <NumberInput value={value} onChange={setValue} placeholder={props.placeholder || ''} min={0} className="w-28" />
      )}
    />
  )
}

/** Per-chain PROJECT-ID key for a split slot's address key: r:→rpid:, p:→ppid:, pk:→pkpid:. */
function pidKeyFor(perChainKey: string): string {
  return perChainKey.replace(/^(pk|p|r):/, (_, prefix: string) => `${prefix}pid:`)
}

/**
 * ONE "Set per chain" for a fixed-amount payout row (website eff02f6): each
 * chain's row carries the amount AND the recipient's chain-specific fields
 * together (wallet address, or project id + token beneficiary) — two
 * side-by-side per-field links read as clutter. Writes the same override keys
 * the deploy build consumes (pamt/pkamt, p/pk, ppid/pkpid), all in addr.
 */
export function PerChainPayoutRowControl(props: {
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
  rec: RecipientRow
  keys: { amt: string; addr: string; pid: string }
  defaults: { amt: string; addr: string; pid: string }
}) {
  const isDark = useIsDark()
  const allKeys = [props.keys.amt, props.keys.addr, props.keys.pid]
  const hasOverrides = props.state.chainIds.some((cid) =>
    allKeys.some((k) => !!props.state.perChain[cid]?.addr?.[k]))
  const [open, setOpen] = useState(hasOverrides)
  const pc = perChainOps(props.state, props.update)
  if (props.state.chainIds.length < 2) return null
  if (!open) {
    return (
      <div className="text-right">
        <button
          type="button"
          title="Set a different amount and recipient on each chain"
          onClick={() => setOpen(true)}
          className="text-xs text-gray-500 hover:text-teal-400"
        >
          Set per chain
        </button>
      </div>
    )
  }
  const wantsPid = props.rec.type === 'project' || props.rec.type === 'customhook'
  const wantsAddr = props.rec.type === 'wallet' || !(props.rec.preferAddToBalance && props.rec.type === 'project')
  return (
    <div className={`mt-2 border p-2 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
      {props.state.chainIds.map((chainId) => (
        <div key={chainId} className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className={`text-xs w-20 shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {CHAINS[chainId]?.shortName || chainId}
          </span>
          <NumberInput
            value={pc.get(chainId, 'addr', props.keys.amt)}
            onChange={(v) => pc.set(chainId, 'addr', props.keys.amt, v)}
            placeholder={props.defaults.amt || '0.0'}
            min={0} step="any"
            className="w-24"
          />
          {wantsPid && (
            <NumberInput
              value={pc.get(chainId, 'addr', props.keys.pid)}
              onChange={(v) => pc.set(chainId, 'addr', props.keys.pid, v)}
              placeholder={props.defaults.pid || 'ID'}
              min={1}
              className="w-20"
            />
          )}
          {wantsAddr && (
            <div className="flex-1 min-w-[180px]">
              <TextInput
                value={pc.get(chainId, 'addr', props.keys.addr)}
                onChange={(v) => pc.set(chainId, 'addr', props.keys.addr, v)}
                placeholder={props.defaults.addr || '0x…'}
                mono
              />
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          props.update((s) => {
            s.chainIds.forEach((cid) => {
              const bucket = s.perChain[cid]?.addr
              if (bucket) allKeys.forEach((k) => { delete bucket[k] })
            })
          })
          setOpen(false)
        }}
        className="text-xs text-gray-500 hover:text-teal-400"
      >
        Use same on all chains
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Split lock row — only when the ruleset has a duration
// ---------------------------------------------------------------------------

export function SplitLockRow(props: {
  durationSeconds: number
  rec: RecipientRow
  onChange: (patch: Partial<RecipientRow>) => void
}) {
  if (!props.durationSeconds) return null
  const locked = !!props.rec.lockedUntil
  const TEN_YEARS = 10 * 365 * 24 * 60 * 60
  return (
    <div className="pl-6 mt-1">
      <label className="flex items-center gap-2 text-xs text-gray-500">
        <input
          type="checkbox"
          checked={locked}
          className="accent-teal-500"
          onChange={(e) => {
            if (e.target.checked) {
              const until = Math.floor(Date.now() / 1000) + Math.min(props.durationSeconds, TEN_YEARS)
              props.onChange({ lockedUntil: until })
            } else {
              props.onChange({ lockedUntil: 0 })
            }
          }}
        />
        Locked
      </label>
      {locked && (
        <>
          <input
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={props.rec.lockedUntil ? new Date(props.rec.lockedUntil * 1000).toISOString().slice(0, 10) : ''}
            onChange={(e) => {
              const ts = Math.floor(new Date(e.target.value).getTime() / 1000)
              if (Number.isFinite(ts)) props.onChange({ lockedUntil: ts })
            }}
            className="mt-1 px-2 py-1 text-xs border border-white/15 bg-transparent"
          />
          <InfoNote>Locked until this date — the split can’t be edited or removed for the rest of this ruleset.</InfoNote>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recipient picker — inline Address / Project / Hook column
// ---------------------------------------------------------------------------

export interface RecipientPickerOpts {
  isPayout?: boolean
  isReserved?: boolean
  allowFundMarket?: boolean
}

export function RecipientPicker(props: {
  rec: RecipientRow
  onChange: (patch: Partial<RecipientRow>) => void
  opts: RecipientPickerOpts
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
  perChainKey: string
  /** The row renders a combined per-chain control instead (fixed-amount payout rows). */
  suppressPerChain?: boolean
}) {
  const { rec, onChange, opts } = props
  const typeValue = rec.type === 'wallet' ? 'address' : rec.type === 'project' ? 'project' : 'hook'
  const hookSub = rec.type === 'lphook' ? 'fundmarket' : 'custom'

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-start gap-2 flex-wrap">
        <Select
          value={typeValue}
          onChange={(v) => {
            // Switching type clears per-chain overrides for this slot.
            props.update((s) => {
              Object.values(s.perChain).forEach((c) => { if (c.addr) delete c.addr[props.perChainKey] })
            })
            if (v === 'address') onChange({ type: 'wallet' })
            else if (v === 'project') onChange({ type: 'project' })
            else onChange({ type: opts.allowFundMarket ? 'lphook' : 'customhook' })
          }}
          options={[['address', 'Address'], ['project', 'Project'], ['hook', 'Hook']]}
        />

        {rec.type === 'project' && (
          <NumberInput
            value={rec.projectId || ''}
            onChange={(v) => onChange({ projectId: parseInt(v, 10) || 0 })}
            placeholder="ID"
            min={1}
            className="w-20"
          />
        )}
      </div>

      {(rec.type === 'project' || rec.type === 'customhook') && !props.suppressPerChain && (
        <PerChainNumControl
          state={props.state}
          update={props.update}
          fieldKey={pidKeyFor(props.perChainKey)}
          placeholder="ID"
        />
      )}

      {/* Address input sits on its own line under the type select (website layout) */}
      {rec.type === 'wallet' && (
        <div className="mt-1.5">
          <EnsAddressInput
            value={rec.address}
            onChange={(v) => onChange({ address: v })}
            onResolved={(addr) => onChange({ resolvedAddress: addr || undefined })}
          />
        </div>
      )}

      {rec.type === 'project' && (
        <div className="mt-1.5 space-y-1.5">
          {opts.isPayout && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">route as</span>
              <Select
                value={rec.preferAddToBalance ? 'balance' : 'pay'}
                onChange={(v) => onChange({ preferAddToBalance: v === 'balance' })}
                options={[['pay', 'Pay project | mint its tokens'], ['balance', 'Add to project balance | mint none']]}
              />
            </div>
          )}
          <div>
            <span className="text-xs text-gray-500">
              {opts.isPayout ? 'destination-token beneficiary' : 'fallback token beneficiary'}
            </span>
            <EnsAddressInput
              value={rec.address}
              onChange={(v) => onChange({ address: v })}
              onResolved={(addr) => onChange({ resolvedAddress: addr || undefined })}
            />
          </div>
          {opts.isReserved && (
            <Hint>
              Reserved tokens pay this project only when the source token is an ERC-20 and the destination has a
              terminal for it; credits or an unavailable/reverting route go to the fallback beneficiary.
            </Hint>
          )}
        </div>
      )}

      {(rec.type === 'lphook' || rec.type === 'customhook') && (
        <div className="mt-1.5 space-y-1.5">
          {opts.allowFundMarket && (
            <Select
              value={hookSub}
              onChange={(v) => onChange({ type: v === 'fundmarket' ? 'lphook' : 'customhook' })}
              options={[['fundmarket', 'Fund market'], ['custom', 'Custom']]}
            />
          )}
          {rec.type === 'lphook' ? (
            <Hint>Pools split tokens into a Uniswap V4 buyback position. Trading fees route back to your project.</Hint>
          ) : (
            <>
              <TextInput
                value={rec.hookAddress || ''}
                onChange={(v) => onChange({ hookAddress: v })}
                placeholder="0x… (split hook address)"
                mono
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">with project</span>
                <NumberInput
                  value={rec.projectId || ''}
                  onChange={(v) => onChange({ projectId: parseInt(v, 10) || 0 })}
                  placeholder="ID" min={0} className="w-20"
                />
              </div>
              <div>
                <span className="text-xs text-gray-500">and beneficiary</span>
                <EnsAddressInput
                  value={rec.address}
                  onChange={(v) => onChange({ address: v })}
                  onResolved={(addr) => onChange({ resolvedAddress: addr || undefined })}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Split/payout rows — "Split [x]% to <recipient> ✕", "Pay [amt] <cur> to … ✕"
// ---------------------------------------------------------------------------

export function SplitRowShell(props: {
  lead: string
  onRemove?: (() => void) | null
  children: ReactNode
}) {
  const isDark = useIsDark()
  return (
    <div className="flex items-start gap-2 mb-2">
      <span className={`text-sm pt-2 shrink-0 w-14 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{props.lead}</span>
      {props.children}
      {props.onRemove && (
        <button type="button" onClick={props.onRemove} className="text-gray-500 hover:text-red-400 pt-2" title="Remove">✕</button>
      )}
    </div>
  )
}

/** Reserved-token split row: "Split [%] to <picker>" + lock. */
export function ReservedSplitRow(props: {
  rec: RecipientRow
  index: number
  durationSeconds: number
  onChange: (patch: Partial<RecipientRow>) => void
  onRemove: () => void
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
  perChainKey: string
}) {
  return (
    <div>
      <SplitRowShell lead={props.index === 0 ? 'Split' : '… and'} onRemove={props.onRemove}>
        <NumberInput
          value={props.rec.percent || ''}
          onChange={(v) => props.onChange({ percent: parseFloat(v) || 0 })}
          min={0} max={100} step={0.1}
          className="w-20"
        />
        <span className="text-sm pt-2 shrink-0">% to</span>
        <RecipientPicker
          rec={props.rec}
          onChange={props.onChange}
          opts={{ isReserved: true, allowFundMarket: true }}
          state={props.state}
          update={props.update}
          perChainKey={props.perChainKey}
        />
      </SplitRowShell>
      <SplitLockRow durationSeconds={props.durationSeconds} rec={props.rec} onChange={props.onChange} />
    </div>
  )
}

/** Payout row — percent mode (unlimited) or amount+currency mode (limited). */
export function PayoutRow(props: {
  rec: RecipientRow
  index: number
  mode: 'percent' | 'amount'
  durationSeconds: number
  payoutCurrency: number
  lockedSymbol?: string | null
  onPayoutCurrencyChange?: (v: number) => void
  /** Static token symbol suffix for multi-token rows (replaces the currency select). */
  staticSuffix?: string
  onChange: (patch: Partial<RecipientRow>) => void
  onRemove: (() => void) | null
  state: CreateFlowState
  update: (fn: (s: CreateFlowState) => void) => void
  perChainKey: string
}) {
  return (
    <div>
      <SplitRowShell lead={props.index === 0 ? (props.mode === 'percent' ? 'Split' : 'Pay') : '… and'} onRemove={props.onRemove}>
        {props.mode === 'percent' ? (
          <>
            <NumberInput
              value={props.rec.percent || ''}
              onChange={(v) => props.onChange({ percent: parseFloat(v) || 0 })}
              min={0} max={100} step={0.1}
              className="w-20"
            />
            <span className="text-sm pt-2 shrink-0">% to</span>
          </>
        ) : (
          <>
            <NumberInput
              value={props.rec.amountEth || ''}
              onChange={(v) => props.onChange({ amountEth: v })}
              placeholder="0.0" min={0} step="any"
              className="w-24"
            />
            {props.staticSuffix ? (
              <span className="text-sm pt-2 shrink-0">{props.staticSuffix}</span>
            ) : (
              <CurrencySelect
                value={props.payoutCurrency}
                onChange={(v) => props.onPayoutCurrencyChange?.(v)}
                lockedSymbol={props.lockedSymbol}
              />
            )}
            <span className="text-sm pt-2 shrink-0">to</span>
          </>
        )}
        <RecipientPicker
          rec={props.rec}
          onChange={props.onChange}
          opts={{ isPayout: true }}
          state={props.state}
          update={props.update}
          perChainKey={props.perChainKey}
          suppressPerChain={props.mode === 'amount'}
        />
      </SplitRowShell>
      {props.mode === 'amount' && (
        // ONE per-chain control for the whole row — amount + recipient fields
        // together (website eff02f6). Percent rows keep the picker's own control.
        <div className="pl-14">
          <PerChainPayoutRowControl
            state={props.state}
            update={props.update}
            rec={props.rec}
            keys={{
              amt: props.perChainKey.replace(/^(pk|p):/, (_, prefix: string) => `${prefix}amt:`),
              addr: props.perChainKey,
              pid: pidKeyFor(props.perChainKey),
            }}
            defaults={{
              amt: props.rec.amountEth || '',
              addr: props.rec.resolvedAddress || props.rec.address || '',
              pid: props.rec.projectId ? String(props.rec.projectId) : '',
            }}
          />
        </div>
      )}
      <SplitLockRow durationSeconds={props.durationSeconds} rec={props.rec} onChange={props.onChange} />
    </div>
  )
}
