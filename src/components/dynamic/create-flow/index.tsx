/**
 * Create-flow wizard — 1:1 port of website/src/create-flow.js (layout + contents).
 * Steps: Flavor · Basics · Rulesets (custom) | Stages (revnet) · Shop · Deploy.
 * Deploy execution hands off to juicy-vision's LaunchProjectModal /
 * DeployRevnetModal (Relayr bundles, managed + self-custody signing).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { isAddress } from 'viem'
import { useAuthStore, useThemeStore } from '../../../stores'
import { useManagedWallet } from '../../../hooks'
import { pinMetadata } from '../../../services/ipfsPinning'
import { calculateSynchronizedStartTime } from '../../../services/relayr'
import type { JBDeployTiersHookConfig } from '../../../services/omnichainDeployer'
import { ALL_CHAIN_IDS } from '../../../constants'
import LaunchProjectModal from '../../payment/LaunchProjectModal'
import DeployRevnetModal from '../../payment/DeployRevnetModal'
import {
  type CreateFlowState,
  initState, loadDraft, saveDraft, clearDraft, exportDraftFile, parseCreateDraftJson, stepsFor,
} from './state'
import { CreateFlowTheme, useIsDark } from './controls'
import {
  buildRulesetConfigsForChain,
  buildTerminalConfigsForChain,
  buildChainConfigOverrides,
  buildDeployTiersConfigFromState,
  buildRevnetStageConfigs,
} from './builders'
import StepFlavor from './StepFlavor'
import StepBasics from './StepBasics'
import StepRulesets from './StepRulesets'
import StepStages from './StepStages'
import StepShop from './StepShop'
import StepDeploy from './StepDeploy'

interface CreateFlowWizardProps {
  /** mapProps forwards all-string props, so chainIds may arrive as "1,10,8453,42161". */
  defaultChainIds?: number[] | string
  /** Rendered as the header ✕ when provided (dock modal host). */
  onClose?: () => void
}

function normalizeChainIds(input: number[] | string | undefined): number[] | null {
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',').map((s) => parseInt(s.trim(), 10))
      : []
  const valid = [...new Set(list.filter((id) => (ALL_CHAIN_IDS as readonly number[]).includes(id)))]
  return valid.length > 0 ? valid : null
}

export default function CreateFlowWizard({ defaultChainIds, onClose }: CreateFlowWizardProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address, isConnected } = useAccount()
  const { address: managedAddress } = useManagedWallet()

  const [state, setState] = useState<CreateFlowState>(() => {
    const restored = loadDraft()
    if (restored) return restored
    const fresh = initState()
    const chains = normalizeChainIds(defaultChainIds)
    if (chains) fresh.chainIds = chains
    return fresh
  })

  // Immer-style draft mutation over a deep clone; steps mutate freely.
  const update = useCallback((fn: (s: CreateFlowState) => void) => {
    setState((prev) => {
      const next = structuredClone(prev)
      fn(next)
      return next
    })
  }, [])

  // Draft auto-saved on every change (the website saves on every render).
  useEffect(() => { saveDraft(state) }, [state])

  // Prefill owner/operator from the active wallet only when blank (website behavior).
  const fallbackOwner = (isManagedMode ? managedAddress : address) || ''
  const prefilledRef = useRef(false)
  useEffect(() => {
    if (prefilledRef.current || !fallbackOwner) return
    prefilledRef.current = true
    update((s) => {
      if (!s.details.owner) s.details.owner = fallbackOwner
      if (!s.revOperator) s.revOperator = fallbackOwner
    })
  }, [fallbackOwner, update])

  // --- deploy handoff ---
  const [showModal, setShowModal] = useState(false)
  const [preparedProjectUri, setPreparedProjectUri] = useState('')
  const [deployTiersConfig, setDeployTiersConfig] = useState<JBDeployTiersHookConfig | undefined>()
  const [buildingLabel, setBuildingLabel] = useState<string | null>(null)
  const [preparationError, setPreparationError] = useState<string | null>(null)

  const synchronizedStartTime = useMemo(() => calculateSynchronizedStartTime(), [showModal]) // eslint-disable-line react-hooks/exhaustive-deps

  const resolvedOwner = state.details.ownerResolved
    || (isAddress(state.details.owner.trim(), { strict: false }) ? state.details.owner.trim() : '')
    || fallbackOwner
  const resolvedOperator = state.revOperatorResolved
    || (isAddress(state.revOperator.trim(), { strict: false }) ? state.revOperator.trim() : '')
    || fallbackOwner

  const isRev = state.projectType === 'revnet'

  const handleLaunch = useCallback(async () => {
    if (isRev && !isManagedMode) {
      window.dispatchEvent(new CustomEvent('juice:open-auth-modal'))
      return
    }
    if (!isRev && !isConnected && !isManagedMode) {
      window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
      return
    }
    setPreparationError(null)
    setBuildingLabel('Preparing metadata...')
    try {
      const d = state.details
      const projectMetadata: Record<string, unknown> = {
        name: d.name,
        description: d.description,
        tagline: d.tagline,
        logoUri: d.logoUri,
        infoUri: d.website,
        twitter: d.twitter,
        discord: d.discord,
        telegram: d.telegram,
        instagram: d.instagram,
        whatsapp: d.whatsapp,
        tags: d.tags,
        coverImageUri: d.coverImageUri,
        payDisclosure: d.payDisclosure,
      }
      // Drop empty fields so the pinned JSON stays lean.
      Object.keys(projectMetadata).forEach((k) => {
        const v = projectMetadata[k]
        if (v === '' || (Array.isArray(v) && v.length === 0)) delete projectMetadata[k]
      })
      const projectUri = await pinMetadata(projectMetadata, `project-${d.name}`)
      let tiersConfig: JBDeployTiersHookConfig | undefined
      if (state.shopEnabled && state.nfts.length > 0) {
        tiersConfig = await buildDeployTiersConfigFromState(state)
      }
      setPreparedProjectUri(projectUri)
      setDeployTiersConfig(tiersConfig)
      setShowModal(true)
    } catch (err) {
      console.error('Failed to prepare project metadata:', err)
      setPreparedProjectUri('')
      setDeployTiersConfig(undefined)
      setPreparationError(err instanceof Error ? err.message : 'Could not prepare project metadata')
    } finally {
      setBuildingLabel(null)
    }
  }, [state, isRev, isManagedMode, isConnected])

  // Configs for the launch modal (built lazily; only meaningful once valid).
  const launchConfigs = useMemo(() => {
    if (isRev || state.chainIds.length === 0) return null
    try {
      const firstChain = state.chainIds[0]
      return {
        rulesetConfigs: buildRulesetConfigsForChain(state, firstChain, synchronizedStartTime),
        terminalConfigurations: buildTerminalConfigsForChain(state, firstChain),
        chainConfigs: buildChainConfigOverrides(state, state.chainIds, synchronizedStartTime, deployTiersConfig?.tiersConfig?.tiers),
      }
    } catch {
      return null
    }
  }, [state, isRev, synchronizedStartTime, deployTiersConfig])

  const revnetStageConfigs = useMemo(() => {
    if (!isRev) return []
    try {
      return buildRevnetStageConfigs(state, synchronizedStartTime)
    } catch {
      return []
    }
  }, [state, isRev, synchronizedStartTime])

  // --- header actions ---
  const fileInputRef = useRef<HTMLInputElement>(null)
  const handleImport = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const imported = parseCreateDraftJson(String(reader.result || ''))
        setState(imported)
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Could not import this file.')
      }
    }
    reader.readAsText(file)
  }, [])

  const steps = stepsFor(state)
  const stepName = steps[state.step] || 'Flavor'

  return (
    <CreateFlowTheme.Provider value={{ isDark }}>
      <div className={`w-full border ${isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'}`}>
        {/* Header: title + Import/Export .jb + ✕ */}
        <div className={`flex items-center gap-2 px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <div className={`flex-1 text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Create a project
          </div>
          <button
            type="button"
            title="Load a saved or shared project draft (.jb)"
            onClick={() => fileInputRef.current?.click()}
            className={`px-2 py-1 text-xs border ${isDark ? 'border-white/15 text-gray-400 hover:text-white' : 'border-gray-300 text-gray-500 hover:text-gray-900'}`}
          >
            Import
          </button>
          <button
            type="button"
            title="Download this draft as a .jb file to save or share for review"
            onClick={() => exportDraftFile(state)}
            className={`px-2 py-1 text-xs border ${isDark ? 'border-white/15 text-gray-400 hover:text-white' : 'border-gray-300 text-gray-500 hover:text-gray-900'}`}
          >
            Export
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jb,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImport(f)
              e.target.value = ''
            }}
          />
          {onClose && (
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className={`ml-1 px-1 ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}`}
            >
              ✕
            </button>
          )}
        </div>

        {/* Stepper */}
        <Stepper state={state} update={update} />

        {/* Step body */}
        <div className="px-4 py-4">
          {stepName === 'Flavor' && <StepFlavor state={state} update={update} />}
          {stepName === 'Basics' && <StepBasics state={state} update={update} />}
          {stepName === 'Rulesets' && <StepRulesets state={state} update={update} />}
          {stepName === 'Stages' && <StepStages state={state} update={update} />}
          {stepName === 'Shop' && <StepShop state={state} update={update} />}
          {stepName === 'Deploy' && (
            <StepDeploy
              state={state}
              update={update}
              fallbackOwner={fallbackOwner}
              launching={false}
              buildingLabel={buildingLabel}
              preparationError={preparationError}
              onLaunch={handleLaunch}
            />
          )}
        </div>

        {/* Footer: ← Back / Next → */}
        <div className={`flex items-center justify-between px-4 py-3 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
          <button
            type="button"
            disabled={state.step === 0}
            onClick={() => update((s) => { s.step = Math.max(0, s.step - 1) })}
            className={`px-3 py-1.5 text-sm border disabled:opacity-40 ${isDark ? 'border-white/15 text-gray-300' : 'border-gray-300 text-gray-600'}`}
          >
            ← Back
          </button>
          {state.step < steps.length - 1 && (
            <button
              type="button"
              onClick={() => update((s) => { s.step = Math.min(stepsFor(s).length - 1, s.step + 1) })}
              className="px-3 py-1.5 text-sm border border-teal-400 text-teal-400 hover:bg-teal-400/10"
            >
              Next →
            </button>
          )}
        </div>
      </div>

      {/* Launch modals — juicy-vision's deploy machinery */}
      {!isRev && launchConfigs && (
        <LaunchProjectModal
          isOpen={showModal}
          onClose={() => { setShowModal(false); clearDraft() }}
          projectName={state.details.name}
          owner={resolvedOwner}
          projectUri={preparedProjectUri}
          chainIds={state.chainIds}
          rulesetConfig={launchConfigs.rulesetConfigs[0]}
          rulesetConfigs={launchConfigs.rulesetConfigs}
          terminalConfigurations={launchConfigs.terminalConfigurations}
          chainConfigs={launchConfigs.chainConfigs}
          synchronizedStartTime={synchronizedStartTime}
          memo=""
          deployTiersHookConfig={deployTiersConfig}
        />
      )}
      {isRev && (
        <DeployRevnetModal
          isOpen={showModal}
          onClose={() => { setShowModal(false); clearDraft() }}
          name={state.details.name}
          ticker={state.details.ticker}
          tagline={state.details.tagline}
          projectUri={preparedProjectUri}
          splitOperator={resolvedOperator}
          chainIds={state.chainIds}
          stageConfigurations={revnetStageConfigs}
          autoDeploySuckers={state.chainIds.length > 1}
          deployTiersHookConfig={deployTiersConfig}
        />
      )}
    </CreateFlowTheme.Provider>
  )
}

function Stepper({ state, update }: { state: CreateFlowState; update: (fn: (s: CreateFlowState) => void) => void }) {
  const isDark = useIsDark()
  const steps = stepsFor(state)
  return (
    <div className="flex items-center flex-wrap gap-0.5 px-4 pt-3 pb-1">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center">
          {i > 0 && (
            <div className={`w-6 h-px mx-1 ${i <= state.step ? 'bg-teal-400' : isDark ? 'bg-white/15' : 'bg-gray-300'}`} />
          )}
          <button
            type="button"
            onClick={() => update((s) => { s.step = i })}
            className="flex items-center gap-1.5"
          >
            <span className={`w-2.5 h-2.5 rounded-full border ${
              i <= state.step ? 'bg-teal-400 border-teal-400' : isDark ? 'border-white/30' : 'border-gray-400'
            }`} />
            <span className={`text-xs ${
              i === state.step
                ? isDark ? 'text-white font-medium' : 'text-gray-900 font-medium'
                : isDark ? 'text-gray-500' : 'text-gray-400'
            }`}>
              {label}
            </span>
          </button>
        </div>
      ))}
    </div>
  )
}
