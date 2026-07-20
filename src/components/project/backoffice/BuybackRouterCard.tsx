/**
 * "Buyback & swap router" card — ports website/src/discover.js
 * renderBuybackRouterCard (:11421).
 *
 * Three per-project registry writes, each owner/operator-gated on chain and
 * danger-gated here, with the CURRENT registered value read across chains:
 *   - JBBuybackHookRegistry.setHookFor(projectId, hook)
 *   - JBRouterTerminalRegistry.setTerminalFor(projectId, terminal)
 *   - JBBuybackHookRegistry.initializePoolFor(projectId, fee, tickSpacing,
 *     twapWindow, terminalToken, sqrtPriceX96)
 *
 * Executed per chain through the guarded runner; reverify re-reads the
 * registry value shown at review and aborts if it changed underneath.
 */

import { useEffect, useState } from 'react'
import { isAddress, type Address } from 'viem'
import { useThemeStore } from '../../../stores'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import {
  buildInitializeBuybackPoolRequest,
  buildSetBuybackHookRequest,
  buildSetRouterTerminalRequest,
  readBuybackHookOf,
  readPoolInitState,
  readRouterTerminalOf,
} from '../../../services/permissionsAdmin'
import { BackOfficeCard, BackOfficeModal, ChainRunRows, DangerGate, chainName, shortAddress, type ChainRunState } from './shared'

export interface BuybackRouterCardProps {
  /** Resolve the project's id ON a given chain (V6 ids differ per chain); null = not on that chain. */
  resolveProjectId: (chainId: number) => bigint | null
  chainIds: number[]
}

type ActionKind = 'setHook' | 'setTerminal' | 'initPool'

interface ActionDef {
  kind: ActionKind
  title: string
  note: string
  danger: string
  /** The registry read the "Current:" line and the reverify snapshot use. */
  read: (chainId: number, projectId: bigint) => Promise<Address | null>
}

const ACTIONS: ActionDef[] = [
  {
    kind: 'setHook',
    title: 'Set buyback hook',
    note: "Points the project at its buyback hook in the registry. Pre-filled with the project's current hook.",
    danger:
      'Dangerous: the buyback hook intercepts every pay/swap and decides issuance-vs-AMM routing. A wrong hook can misroute or strand funds.',
    read: readBuybackHookOf,
  },
  {
    kind: 'setTerminal',
    title: 'Set router terminal',
    note: "Sets the terminal the swap router forwards into for this project (used when paying in USDC etc.). Pre-filled with the project's current terminal.",
    danger: 'Dangerous: this reroutes where router-swapped funds are deposited. A wrong terminal can misdirect or strand funds.',
    read: readRouterTerminalOf,
  },
  {
    kind: 'initPool',
    title: 'Initialize buyback pool',
    note: "Initializes the project's Uniswap buyback pool on the registered hook: fee tier, tick spacing, TWAP window, terminal token, and starting price.",
    danger:
      'Dangerous and permanent: the pool parameters and starting price cannot be re-initialized. A wrong starting price invites an immediate arbitrage drain.',
    // Pool init requires a registered hook; its address is the reviewed state.
    read: readBuybackHookOf,
  },
]

interface CurrentRow {
  chainId: number
  value: Address | null
}

/** Per-chain buyback pool-init state string (null = unreadable / not this project's chain). */
interface PoolInitRow {
  chainId: number
  state: string | null
}

/** Uniswap fee is in hundredths of a bip; 1_000_000 == 100%. */
const MAX_UNISWAP_FEE = 1_000_000

/**
 * Validate the `initializePoolFor` inputs. `initializePoolFor` is PERMANENT, so
 * every value-bearing param is bounded away from the footgun defaults:
 *   - fee: an integer in (0, 1_000_000) — a 0 fee is not a real tier.
 *   - tickSpacing: non-zero (0 would make the pool uninitializable).
 *   - twapWindow: > 0 — a 0 window disables TWAP-manipulation protection and
 *     invites an immediate arbitrage drain (see card danger copy).
 *   - terminalToken: a valid address (must equal the accounting/pair token).
 *   - sqrtPriceX96: a non-zero starting price.
 * Returns an error string, or null when every param is safe. Pure — unit tested.
 */
export function validateInitPoolParams(params: {
  fee: string
  tickSpacing: string
  twapWindow: string
  terminalToken: string
  sqrtPriceX96: string
}): string | null {
  const { fee, tickSpacing, twapWindow, terminalToken, sqrtPriceX96 } = params
  if (!/^\d+$/.test(fee.trim())) return 'Enter the fee tier (e.g. 10000 = 1%)'
  const feeNum = Number(fee.trim())
  if (feeNum <= 0 || feeNum >= MAX_UNISWAP_FEE)
    return 'Fee tier must be between 1 and 999999 (hundredths of a bip)'
  if (!/^-?\d+$/.test(tickSpacing.trim())) return 'Enter the tick spacing (e.g. 200)'
  if (BigInt(tickSpacing.trim()) === 0n) return 'Tick spacing must be non-zero'
  if (!/^\d+$/.test(twapWindow.trim())) return 'Enter the TWAP window in seconds (e.g. 1800)'
  if (BigInt(twapWindow.trim()) === 0n)
    return 'TWAP window must be greater than 0 — a 0 window disables manipulation protection'
  if (!isAddress(terminalToken.trim())) return 'Enter the terminal token address'
  if (!/^\d+$/.test(sqrtPriceX96.trim()) || BigInt(sqrtPriceX96.trim() || '0') === 0n)
    return 'Enter the starting sqrtPriceX96'
  return null
}

function summarizeCurrent(rows: CurrentRow[]): string {
  const distinct = [...new Set(rows.filter(row => row.value).map(row => row.value!.toLowerCase()))]
  const setCount = rows.filter(row => row.value).length
  if (distinct.length === 0) return 'not set on any chain'
  if (distinct.length === 1) {
    return `${shortAddress(distinct[0])}${setCount === rows.length ? ' (all chains)' : ` (${setCount}/${rows.length} chains — rest unset)`}`
  }
  return rows.map(row => `${chainName(row.chainId)} ${row.value ? shortAddress(row.value) : 'unset'}`).join(' | ')
}

/** Collapse per-chain pool-init state strings for the card + modal "Pool:" line. */
function summarizePoolInit(rows: PoolInitRow[]): string {
  const known = rows.filter(row => row.state != null)
  if (!known.length) return 'unreadable'
  const distinct = [...new Set(known.map(row => row.state!))]
  if (distinct.length === 1) {
    return `${distinct[0]}${known.length === rows.length ? '' : ` (${known.length}/${rows.length} chains)`}`
  }
  return rows.map(row => `${chainName(row.chainId)}: ${row.state ?? '—'}`).join(' | ')
}

// ─── Action modal ────────────────────────────────────────────────────────────

function BuybackRouterModal({
  action,
  resolveProjectId,
  chainIds,
  current,
  stateSummary,
  onClose,
  onChanged,
}: {
  action: ActionDef
  resolveProjectId: (chainId: number) => bigint | null
  chainIds: number[]
  /** The per-chain registry value shown at review time (the reverify snapshot). */
  current: CurrentRow[]
  /** Pre-summarized state line to show as "Current:"; falls back to the registry value when absent. */
  stateSummary?: string
  onClose: () => void
  onChanged: () => void
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const firstCurrent = current.find(row => row.value)?.value ?? ''
  const [address, setAddress] = useState(action.kind === 'initPool' ? '' : firstCurrent)
  const [fee, setFee] = useState('10000')
  const [tickSpacing, setTickSpacing] = useState('200')
  const [twapWindow, setTwapWindow] = useState('1800')
  const [terminalToken, setTerminalToken] = useState('')
  const [sqrtPriceX96, setSqrtPriceX96] = useState('')
  const [gateChecked, setGateChecked] = useState(false)
  const [statuses, setStatuses] = useState<Record<number, ChainRunState>>({})

  const snapshotByChain = new Map(current.map(row => [row.chainId, row.value]))
  const anyRunning = Object.values(statuses).some(status => status.kind === 'running')

  let inputError: string | null = null
  if (action.kind === 'initPool') {
    inputError = validateInitPoolParams({ fee, tickSpacing, twapWindow, terminalToken, sqrtPriceX96 })
  } else if (!isAddress(address.trim())) {
    inputError = 'Enter a valid address'
  }

  const setStatus = (chainId: number, status: ChainRunState) =>
    setStatuses(previous => ({ ...previous, [chainId]: status }))

  const buildRequest = (chainId: number, pid: bigint) => {
    if (action.kind === 'setHook') {
      return buildSetBuybackHookRequest({ chainId, projectId: pid, hook: address.trim() as Address })
    }
    if (action.kind === 'setTerminal') {
      return buildSetRouterTerminalRequest({ chainId, projectId: pid, terminal: address.trim() as Address })
    }
    return buildInitializeBuybackPoolRequest({
      chainId,
      projectId: pid,
      fee: Number(fee.trim()),
      tickSpacing: Number(tickSpacing.trim()),
      twapWindow: BigInt(twapWindow.trim()),
      terminalToken: terminalToken.trim() as Address,
      sqrtPriceX96: BigInt(sqrtPriceX96.trim()),
    })
  }

  const execute = async (chainId: number) => {
    if (!activeAddress) {
      setStatus(chainId, { kind: 'error', message: 'Connect a wallet first.' })
      return
    }
    // This chain's OWN project id (V6 ids differ per chain); no id → skip it.
    const pid = resolveProjectId(chainId)
    if (pid == null) {
      setStatus(chainId, { kind: 'error', message: `This project is not on ${chainName(chainId)}.` })
      return
    }
    try {
      const request = buildRequest(chainId, pid)
      const txHash = await run({
        chainId,
        to: request.to,
        data: request.data,
        // Reviewed-state re-verification: abort when the registry value shown
        // at review changed underneath (or, for pool init, the hook is gone).
        reverify: async () => {
          const fresh = await action.read(chainId, pid)
          const reviewed = snapshotByChain.get(chainId) ?? null
          if (action.kind === 'initPool' && !fresh) {
            throw new Error(`No buyback hook is registered on ${chainName(chainId)} — set the hook first.`)
          }
          if ((fresh ?? '').toLowerCase() !== (reviewed ?? '').toLowerCase()) {
            throw new Error(
              `The current value on ${chainName(chainId)} changed since review (now ${fresh ? shortAddress(fresh) : 'unset'}). Reopen to refresh.`,
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
        message: error instanceof Error ? error.message : 'The transaction failed.',
      })
    }
  }

  const inputClass = `w-full px-3 py-2 text-sm border bg-transparent outline-none ${
    isDark
      ? 'border-white/20 text-white placeholder-gray-600 focus:border-white/40'
      : 'border-gray-300 text-gray-900 placeholder-gray-400 focus:border-gray-500'
  }`

  const field = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    placeholder: string,
    mono = false,
    help?: string,
  ) => (
    <div className="space-y-1">
      <label className={`block text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`${inputClass} ${mono ? 'font-mono' : ''}`}
      />
      {help ? <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{help}</p> : null}
    </div>
  )

  return (
    <BackOfficeModal title={action.title} onClose={onClose} busy={anyRunning} isDark={isDark}>
      <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{action.note}</p>
      <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
        Current: {stateSummary ?? summarizeCurrent(current)}. Only the project's owner/operator can execute — anyone
        else's transaction fails in simulation.
      </p>

      {action.kind === 'initPool' ? (
        <>
          {field('Fee tier', fee, setFee, 'e.g. 10000 (= 1%)')}
          {field('Tick spacing', tickSpacing, setTickSpacing, 'e.g. 200')}
          {field('TWAP window (seconds)', twapWindow, setTwapWindow, 'e.g. 1800')}
          {field('Terminal token', terminalToken, setTerminalToken, '0x… terminal token (pool pair)', true,
            "Must equal the project's accounting (pair) token on this chain — a mismatched token points the buyback at the wrong pool. Verify it against the token the project accepts before initializing.")}
          {field('sqrtPriceX96', sqrtPriceX96, setSqrtPriceX96, 'starting price as sqrtPriceX96', true,
            'The pool’s starting price in Uniswap sqrtPriceX96 form. Wrong values invite immediate arbitrage.')}
        </>
      ) : (
        field(
          action.kind === 'setHook' ? 'Buyback hook' : 'Router terminal',
          address,
          setAddress,
          action.kind === 'setHook' ? '0x… buyback hook' : '0x… router terminal',
          true,
        )
      )}

      {inputError ? <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{inputError}</p> : null}

      <DangerGate
        isDark={isDark}
        text={action.danger}
        confirmLabel="I understand the risk and have verified every value above."
        checked={gateChecked}
        onChange={setGateChecked}
      />

      <ChainRunRows
        chainIds={chainIds}
        statuses={statuses}
        onExecute={execute}
        disabled={!!inputError || !gateChecked || anyRunning}
        disabledReason={inputError ?? 'Tick the confirmation box to proceed'}
        isDark={isDark}
      />
    </BackOfficeModal>
  )
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function BuybackRouterCard({ resolveProjectId, chainIds }: BuybackRouterCardProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [currentByKind, setCurrentByKind] = useState<Record<ActionKind, CurrentRow[] | null>>({
    setHook: null,
    setTerminal: null,
    initPool: null,
  })
  // Pool-init state for the initPool action's "Current:" line: whether the hook's
  // Uniswap pool is initialized (TWAP window set), rather than the hook address.
  const [poolInit, setPoolInit] = useState<PoolInitRow[] | null>(null)
  const [open, setOpen] = useState<ActionDef | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setCurrentByKind({ setHook: null, setTerminal: null, initPool: null })
    setPoolInit(null)
    const load = async (read: ActionDef['read']): Promise<CurrentRow[]> =>
      Promise.all(
        chainIds.map(async chainId => {
          // Each chain reads with ITS OWN project id (V6 ids differ per chain);
          // a chain that isn't this project's is left unset, never read with home id.
          const pid = resolveProjectId(chainId)
          if (pid == null) return { chainId, value: null }
          try {
            return { chainId, value: await read(chainId, pid) }
          } catch {
            return { chainId, value: null }
          }
        }),
      )
    const loadPoolInit = async (): Promise<PoolInitRow[]> =>
      Promise.all(
        chainIds.map(async chainId => {
          const pid = resolveProjectId(chainId)
          if (pid == null) return { chainId, state: null }
          return { chainId, state: await readPoolInitState(chainId, pid) }
        }),
      )
    Promise.all([load(readBuybackHookOf), load(readRouterTerminalOf), loadPoolInit()]).then(
      ([hooks, terminals, pools]) => {
        if (cancelled) return
        setCurrentByKind({ setHook: hooks, setTerminal: terminals, initPool: hooks })
        setPoolInit(pools)
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveProjectId, chainIds.join(','), refreshNonce])

  return (
    <BackOfficeCard title="Buyback & swap router" isDark={isDark}>
      <ExplainerMessage>
        Wire up the project's buyback hook + swap router and initialize its Uniswap pool. Each action runs
        per chain — execute it on every chain the project should cover.
      </ExplainerMessage>

      <div className="space-y-3">
        {ACTIONS.map(action => {
          const current = currentByKind[action.kind]
          const isInitPool = action.kind === 'initPool'
          // initPool shows pool-init state (TWAP window set?) rather than the hook address;
          // the hook rows still back the modal's reverify snapshot.
          const ready = isInitPool ? current !== null && poolInit !== null : current !== null
          return (
            <div key={action.kind} className={`border p-3 space-y-1.5 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
              <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{action.title}</div>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{action.note}</p>
              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                {isInitPool ? 'Pool' : 'Current'}:{' '}
                {isInitPool
                  ? poolInit === null
                    ? 'reading across chains…'
                    : summarizePoolInit(poolInit)
                  : current === null
                    ? 'reading across chains…'
                    : summarizeCurrent(current)}
              </p>
              <button
                onClick={() => ready && setOpen(action)}
                disabled={!ready}
                className={`text-sm underline decoration-dotted underline-offset-2 transition-colors disabled:opacity-40 ${
                  isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'
                }`}
              >
                {action.title}
              </button>
            </div>
          )
        })}
      </div>

      {open && currentByKind[open.kind] ? (
        <BuybackRouterModal
          action={open}
          resolveProjectId={resolveProjectId}
          chainIds={chainIds}
          current={currentByKind[open.kind]!}
          stateSummary={open.kind === 'initPool' && poolInit ? summarizePoolInit(poolInit) : undefined}
          onClose={() => setOpen(null)}
          onChanged={() => setRefreshNonce(nonce => nonce + 1)}
        />
      ) : null}
    </BackOfficeCard>
  )
}
