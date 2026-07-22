/**
 * "Powers" card (custom projects only) — ports website/src/discover.js
 * renderPowersCard (:11172) + OWNER_POWERS (:11137) + openPowerModal (:11766).
 *
 * Each owner power is gated on the CURRENT ruleset's metadata flag: enabled
 * powers open a danger-gated per-power form; disabled ones render with the
 * reason (the flag that must be turned on by a ruleset change). Every
 * transaction runs per chain through the guarded runner, whose reverify
 * re-reads the ruleset flag on that chain and aborts if it turned off.
 */

import { useEffect, useState } from 'react'
import { useThemeStore } from '../../../stores'
import { ExplainerMessage } from '../../ui/ExplainerMessage'
import { useGuardedTx } from '../../../hooks/useGuardedTx'
import {
  buildOwnerPowerRequest,
  OWNER_POWERS,
  powerAvailability,
  readOwnerPowerFlags,
  type OwnerPowerDef,
  type OwnerPowerValues,
  type PowerAvailability,
} from '../../../services/permissionsAdmin'
import { BackOfficeCard, BackOfficeModal, ChainRunRows, DangerGate, chainName, type ChainRunState } from './shared'

export interface PowersCardProps {
  /** Resolve the project's id ON a given chain (V6 ids differ per chain); null = not on that chain. */
  resolveProjectId: (chainId: number) => bigint | null
  chainIds: number[]
}

// Powers whose values are inherently per-chain (feeds, mints, migrations)
// default to the home chain only; infra-address powers default to every chain.
const PRIMARY_CHAIN_DEFAULT: ReadonlySet<string> = new Set(['mintTokens', 'migrateBalance', 'addPriceFeed'])

// ─── Per-power form modal ────────────────────────────────────────────────────

function PowerModal({
  power,
  resolveProjectId,
  chainIds,
  onClose,
}: {
  power: OwnerPowerDef
  resolveProjectId: (chainId: number) => bigint | null
  chainIds: number[]
  onClose: () => void
}) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { activeAddress, run } = useGuardedTx()

  const [values, setValues] = useState<OwnerPowerValues>(() => {
    const initial: OwnerPowerValues = {}
    for (const field of power.fields) {
      if (field.kind === 'bool') initial[field.name] = false
      else initial[field.name] = ''
    }
    return initial
  })
  const [selectedChains, setSelectedChains] = useState<Record<number, boolean>>(() => {
    const primaryOnly = PRIMARY_CHAIN_DEFAULT.has(power.key)
    return Object.fromEntries(chainIds.map((chainId, index) => [chainId, primaryOnly ? index === 0 : true]))
  })
  const [gateChecked, setGateChecked] = useState(false)
  const [statuses, setStatuses] = useState<Record<number, ChainRunState>>({})

  // Default the beneficiary-style fields to the connected account once known.
  useEffect(() => {
    if (!activeAddress) return
    setValues(previous => {
      let next = previous
      for (const field of power.fields) {
        if (field.defaultAccount && !previous[field.name]) {
          if (next === previous) next = { ...previous }
          next[field.name] = activeAddress
        }
      }
      return next
    })
  }, [activeAddress, power])

  const activeChainIds = chainIds.filter(chainId => selectedChains[chainId])
  const anyRunning = Object.values(statuses).some(status => status.kind === 'running')

  // Validate by building one selected chain's calldata; the error doubles as the
  // hint. Uses that chain's OWN project id (V6 ids differ per chain).
  let inputError: string | null = null
  if (activeChainIds.length === 0) inputError = 'Select at least one chain'
  else {
    const validationPid = resolveProjectId(activeChainIds[0])
    if (validationPid == null) {
      inputError = `This project is not on ${chainName(activeChainIds[0])}`
    } else {
      try {
        buildOwnerPowerRequest(power, { chainId: activeChainIds[0], projectId: validationPid, values })
      } catch (error) {
        inputError = error instanceof Error ? error.message : 'Check the form values'
      }
    }
  }

  const setStatus = (chainId: number, status: ChainRunState) =>
    setStatuses(previous => ({ ...previous, [chainId]: status }))

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
      const request = buildOwnerPowerRequest(power, { chainId, projectId: pid, values })
      const txHash = await run({
        chainId,
        to: request.to,
        data: request.data,
        review: {
          title: `Review ${power.label.toLowerCase()}`,
          label: `${power.actionLabel} for project #${pid.toString()}`,
          contractName: power.contract,
          ...request.review,
        },
        // Reviewed-state re-verification: the ruleset may have rolled over
        // since review — abort when this power's flag is off on this chain.
        reverify: async () => {
          const flags = await readOwnerPowerFlags(chainId, pid)
          if (!flags[power.flag]) {
            throw new Error(
              `The current ruleset on ${chainName(chainId)} no longer allows this (${power.flag} is off).`,
            )
          }
        },
        onPhase: phase => setStatus(chainId, { kind: 'running', phase }),
      })
      setStatus(chainId, { kind: 'done', txHash })
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

  return (
    <BackOfficeModal title={power.actionLabel} onClose={onClose} busy={anyRunning} isDark={isDark}>
      <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{power.description}</p>

      {power.fields.map(field =>
        field.kind === 'bool' ? (
          <label key={field.name} className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!values[field.name]}
              onChange={event => setValues(previous => ({ ...previous, [field.name]: event.target.checked }))}
              className="mt-0.5 w-4 h-4"
            />
            <span className="min-w-0">
              <span className={`block text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{field.label}</span>
              {field.help ? (
                <span className={`block text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{field.help}</span>
              ) : null}
            </span>
          </label>
        ) : (
          <div key={field.name} className="space-y-1">
            <label className={`block text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              {field.label}
            </label>
            <input
              type="text"
              value={String(values[field.name] ?? '')}
              onChange={event => setValues(previous => ({ ...previous, [field.name]: event.target.value }))}
              placeholder={field.placeholder}
              spellCheck={false}
              className={`${inputClass} ${field.kind === 'address' || field.kind === 'addressList' ? 'font-mono' : ''}`}
            />
            {field.infra ? (
              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                Blank uses each chain's canonical {String(field.infra)}.
              </p>
            ) : null}
            {field.help ? <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{field.help}</p> : null}
          </div>
        ),
      )}

      <div className="space-y-1">
        <div className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>Run on</div>
        <div className="flex flex-wrap gap-3">
          {chainIds.map(chainId => (
            <label key={chainId} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!selectedChains[chainId]}
                onChange={event =>
                  setSelectedChains(previous => ({ ...previous, [chainId]: event.target.checked }))
                }
                className="w-4 h-4"
              />
              <span className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{chainName(chainId)}</span>
            </label>
          ))}
        </div>
      </div>

      {inputError && activeChainIds.length > 0 ? (
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{inputError}</p>
      ) : null}

      <DangerGate
        isDark={isDark}
        text={power.danger}
        confirmLabel="I understand the risk and have verified every value above."
        checked={gateChecked}
        onChange={setGateChecked}
      />

      <ChainRunRows
        chainIds={activeChainIds}
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

export function PowersCard({ resolveProjectId, chainIds }: PowersCardProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'

  const [availability, setAvailability] = useState<Record<string, PowerAvailability> | null>(null)
  const [failed, setFailed] = useState(false)
  const [openPower, setOpenPower] = useState<OwnerPowerDef | null>(null)

  const homeChainId = chainIds[0]
  // The home chain's OWN project id — powers availability reads the home
  // ruleset, but with the id ON the home chain, never a blind home fallback.
  const homeProjectId = homeChainId == null ? null : resolveProjectId(homeChainId)

  useEffect(() => {
    let cancelled = false
    setAvailability(null)
    setFailed(false)
    if (homeChainId == null || homeProjectId == null) {
      setFailed(true)
      return
    }
    readOwnerPowerFlags(homeChainId, homeProjectId)
      .then(flags => {
        if (!cancelled) setAvailability(powerAvailability(flags))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [homeProjectId, homeChainId])

  return (
    <BackOfficeCard title="Powers" isDark={isDark}>
      <ExplainerMessage>
        What the current ruleset lets the owner do. Enabled powers can be used here; disabled ones need a
        ruleset change to turn on.
      </ExplainerMessage>

      {failed ? (
        <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Could not read the current ruleset.</p>
      ) : availability === null ? (
        <div className={`h-16 animate-pulse ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
      ) : (
        <div className="space-y-3">
          {OWNER_POWERS.map(power => {
            const state = availability[power.key] ?? { enabled: false }
            return (
              <div key={power.key} className={`border p-3 space-y-1.5 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {power.label}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 text-xs font-medium ${
                      state.enabled
                        ? isDark
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-green-100 text-green-700'
                        : isDark
                          ? 'bg-white/10 text-gray-400'
                          : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {state.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{power.description}</p>
                {state.enabled ? (
                  <>
                    <p className={`text-xs ${isDark ? 'text-red-400/80' : 'text-red-600/90'}`}>{power.danger}</p>
                    <button
                      onClick={() => setOpenPower(power)}
                      className={`text-sm underline decoration-dotted underline-offset-2 transition-colors ${
                        isDark ? 'text-juice-cyan hover:text-white' : 'text-cyan-700 hover:text-gray-900'
                      }`}
                    >
                      {power.actionLabel}
                    </button>
                  </>
                ) : (
                  <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>{state.reason}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {openPower ? (
        <PowerModal power={openPower} resolveProjectId={resolveProjectId} chainIds={chainIds} onClose={() => setOpenPower(null)} />
      ) : null}
    </BackOfficeCard>
  )
}
