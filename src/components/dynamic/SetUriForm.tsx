import { useState, useEffect, useCallback, useMemo } from 'react'
import { defaultChainId } from '../../config/environment'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useSetUriFormState } from '../../hooks/useComponentState'
import {
  fetchProject,
  fetchCurrentProjectMetadataForEdit,
  type Project,
  type CurrentProjectMetadata,
} from '../../services/bendystraw'
import { pinFileToBackend, pinMetadata } from '../../services/ipfsPinning'
import { resolveIpfsUri } from '../../utils/ipfs'
import {
  customPropertiesOf,
  editsFromMetadata,
  mergeWithCustomProperties,
  metadataEquals,
  parseCustomPropertiesJson,
  type ProjectMetadataEdits,
} from '../../utils/projectMetadataEdit'
import { SetUriModal } from '../payment'
import { ProjectLink } from './ProjectLink'
import { useManagedWallet } from '../../hooks'
import { resolveProjectChains } from '../../utils/projectChains'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'
import { CreateFlowTheme, ImagePicker } from './create-flow/controls'
import { MAINNET_CHAINS } from '../../constants'

interface SetUriFormProps {
  projectId: string
  chainId?: string
  messageId?: string // For persisting state to server (visible to all chat users)
}

// Chain info for display
const CHAIN_INFO = MAINNET_CHAINS

// Per-chain project data
interface ChainProjectData {
  chainId: number
  projectId: number
  selected: boolean
}

interface EditableFields {
  name: string
  tagline: string
  description: string
  logoUri: string
  infoUri: string
  payDisclosure: string
  tagsText: string
  tagsEditable: boolean
  /** Raw JSON of every key the managed inputs don't cover — edited as-is in the Advanced section. */
  customJsonText: string
}

function fieldsFromMetadata(metadata: Record<string, unknown>): EditableFields {
  const prefilled = editsFromMetadata(metadata)
  const custom = customPropertiesOf(metadata)
  return {
    name: prefilled.name,
    tagline: prefilled.tagline,
    description: prefilled.description,
    logoUri: prefilled.logoUri,
    infoUri: prefilled.infoUri,
    payDisclosure: prefilled.payDisclosure,
    tagsText: prefilled.tags.join(', '),
    tagsEditable: prefilled.tagsEditable,
    customJsonText: Object.keys(custom).length > 0 ? JSON.stringify(custom, null, 2) : '',
  }
}

function editsFromFields(fields: EditableFields): ProjectMetadataEdits {
  return {
    name: fields.name,
    tagline: fields.tagline,
    description: fields.description,
    logoUri: fields.logoUri,
    infoUri: fields.infoUri,
    payDisclosure: fields.payDisclosure,
    tags: fields.tagsText.split(',').map(tag => tag.trim()).filter(Boolean),
    tagsEditable: fields.tagsEditable,
  }
}

export default function SetUriForm({ projectId, chainId = defaultChainId(), messageId }: SetUriFormProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { isConnected } = useAccount()
  const { address: managedAddress, isManagedMode } = useManagedWallet()
  const hasActiveWallet = isManagedMode ? !!managedAddress : isConnected

  // Persistent state
  const { state: persistedState, updateState: updatePersistedState } = useSetUriFormState(messageId)
  const isLocked = persistedState?.status && persistedState.status !== 'pending'

  // Project state
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // Current on-chain metadata — the merge base. null + metadataError means the
  // fetch failed and saving stays blocked (never merge over a partial object).
  const [currentMetadata, setCurrentMetadata] = useState<CurrentProjectMetadata | null>(null)
  const [metadataError, setMetadataError] = useState<string | null>(null)

  // Chain state
  const [chainProjectData, setChainProjectData] = useState<ChainProjectData[]>([])
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const primaryChainId = parseInt(chainId)

  // Form state
  const [fields, setFields] = useState<EditableFields | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [preparationError, setPreparationError] = useState<string | null>(null)
  const [newUri, setNewUri] = useState('')
  const [showModal, setShowModal] = useState(false)

  // Derived state
  const selectedChains = chainProjectData.filter(cd => cd.selected)
  const isOmnichain = chainProjectData.length > 1
  const currentUri = currentMetadata?.uri || ''
  // null = the Advanced JSON is invalid, which blocks saving.
  const parsedCustom = useMemo(
    () => fields ? parseCustomPropertiesJson(fields.customJsonText) : null,
    [fields],
  )
  const customJsonInvalid = !!fields && parsedCustom === null
  const mergedMetadata = useMemo(
    () => currentMetadata && fields && parsedCustom
      ? mergeWithCustomProperties(currentMetadata.metadata, editsFromFields(fields), parsedCustom)
      : null,
    [currentMetadata, fields, parsedCustom],
  )
  const hasChange = !!currentMetadata && !!mergedMetadata && !metadataEquals(mergedMetadata, currentMetadata.metadata)
  const nameValid = !!fields && fields.name.trim().length > 0

  // Dispatch event to open wallet panel
  const openWalletPanel = () => {
    window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
  }

  // Load project data + the CURRENT on-chain metadata JSON (the merge base)
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      setMetadataError(null)

      try {
        const [projectData, chainResolution] = await Promise.all([
          fetchProject(projectId, primaryChainId),
          resolveProjectChains(projectId, primaryChainId),
        ])
        setProject(projectData)
        setChainMappingAvailable(chainResolution.mappingAvailable)

        setChainProjectData(chainResolution.chains.map(chain => ({
          chainId: chain.chainId,
          projectId: chain.projectId,
          selected: true,
        })))
      } catch (err) {
        console.error('Failed to load project:', err)
        setError('Failed to load project data')
        setLoading(false)
        return
      }

      try {
        const current = await fetchCurrentProjectMetadataForEdit(projectId, primaryChainId)
        const prefilled = fieldsFromMetadata(current.metadata)
        setCurrentMetadata(current)
        setFields(prefilled)
        // Surface existing custom fields immediately so operators can see them.
        setAdvancedOpen(prefilled.customJsonText !== '')
      } catch (err) {
        console.error('Failed to load current project metadata:', err)
        setCurrentMetadata(null)
        setFields(null)
        setMetadataError(
          'The current project metadata could not be loaded. Editing is disabled so existing fields are never overwritten with a partial copy.'
        )
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [projectId, primaryChainId, reloadNonce])

  const updateField = useCallback(<K extends keyof EditableFields>(key: K, value: EditableFields[K]) => {
    if (isLocked) return
    setFields(prev => prev ? { ...prev, [key]: value } : prev)
  }, [isLocked])

  // Toggle chain selection
  const toggleChainSelection = useCallback((chainId: number) => {
    if (isLocked) return
    setChainProjectData(prev =>
      prev.map(cd =>
        cd.chainId === chainId ? { ...cd, selected: !cd.selected } : cd
      )
    )
  }, [isLocked])

  // Callbacks for transaction completion
  const handleConfirmed = useCallback((txHashes: Record<number, string>, bundleId?: string) => {
    updatePersistedState({
      status: 'completed',
      txHashes,
      bundleId,
      confirmedAt: new Date().toISOString(),
    })
  }, [updatePersistedState])

  const handleStarted = useCallback(() => {
    updatePersistedState({
      status: 'in_progress',
      uri: newUri,
      selectedChains: selectedChains.map(c => c.chainId),
      submittedAt: new Date().toISOString(),
    })
  }, [updatePersistedState, newUri, selectedChains])

  const handleError = useCallback((errorMsg: string) => {
    updatePersistedState({
      status: 'failed',
      error: errorMsg,
    })
  }, [updatePersistedState])

  // Pin the merged metadata (current JSON spread first, edited fields on top),
  // then review the exact pinned URI. The form never accepts a hand-pasted CID.
  const handleSubmit = useCallback(async () => {
    if (isLocked || preparing || logoBusy || selectedChains.length === 0) return
    if (!currentMetadata || !mergedMetadata || !hasChange || !nameValid || !fields || customJsonInvalid) return

    if (!hasActiveWallet) {
      openWalletPanel()
      return
    }

    setPreparing(true)
    setPreparationError(null)
    try {
      const uri = await pinMetadata(mergedMetadata, `project-${fields.name.trim()}`)
      setNewUri(uri)
      // Save reviewed inputs without claiming execution has started.
      updatePersistedState({
        status: 'pending',
        uri,
        selectedChains: selectedChains.map(c => c.chainId),
        submittedAt: new Date().toISOString(),
      })
      setShowModal(true)
    } catch (err) {
      setPreparationError(err instanceof Error ? err.message : 'Could not prepare the updated metadata')
    } finally {
      setPreparing(false)
    }
  }, [
    isLocked,
    preparing,
    logoBusy,
    selectedChains,
    currentMetadata,
    mergedMetadata,
    hasChange,
    nameValid,
    fields,
    customJsonInvalid,
    hasActiveWallet,
    updatePersistedState,
  ])

  const handleLogoPick = useCallback((file: File) => {
    if (isLocked) return
    setLogoBusy(true)
    pinFileToBackend(file, file.name)
      .then(uri => setFields(prev => prev ? { ...prev, logoUri: uri } : prev))
      .catch((err: unknown) => {
        setPreparationError(err instanceof Error ? err.message : 'Could not upload the logo')
      })
      .finally(() => setLogoBusy(false))
  }, [isLocked])

  // Loading state
  if (loading) {
    return (
      <div className="w-full">
        <div className={`max-w-2xl border p-4 animate-pulse ${
          isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
        }`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-14 h-14 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className="flex-1">
              <div className={`h-5 w-40 mb-2 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
              <div className={`h-4 w-24 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className={`max-w-2xl border p-6 text-center ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        <p className={isDark ? 'text-gray-400' : 'text-gray-600'}>{error}</p>
      </div>
    )
  }

  const logoUrl = project?.logoUri ? resolveIpfsUri(project.logoUri) : null
  const chainInfo = CHAIN_INFO[primaryChainId] || CHAIN_INFO[1]

  const inputClass = `w-full px-3 py-2.5 text-sm outline-none ${
    isDark
      ? 'bg-juice-dark border border-white/10 text-white placeholder-gray-600'
      : 'bg-white border border-gray-200 text-gray-900 placeholder-gray-400'
  } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`
  const fieldLabelClass = `text-xs font-medium mb-1 block ${isDark ? 'text-gray-300' : 'text-gray-600'}`

  return (
    <div className="w-full">
      <div className={`max-w-2xl border ${
        isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
      }`}>
        {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}
        {/* Header */}
        <div className="p-4 border-b border-gray-600/50">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <IpfsImage uri={project?.logoUri} alt={project?.name || 'Project'} className="w-14 h-14 object-cover" fallback={<div className="w-14 h-14 bg-purple-500/20" />} />
            ) : (
              <div className="w-14 h-14 bg-purple-500/20 flex items-center justify-center">
                <span className="text-2xl">📝</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className={`font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                Update Project Metadata
              </h3>
              <ProjectLink chainSlug={chainInfo.slug} projectId={projectId} className={`text-xs hover:underline ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}>
                {project?.name || `Project #${projectId}`}
              </ProjectLink>
            </div>
          </div>
        </div>

        {/* Chain Selection for omnichain */}
        {isOmnichain && (
          <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-600/50' : 'border-gray-200'}`}>
            <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
              Apply to chains:
            </div>
            <div className="flex flex-wrap gap-2">
              {chainProjectData.map(cd => {
                const chain = CHAIN_INFO[cd.chainId]
                return (
                  <button
                    key={cd.chainId}
                    onClick={() => toggleChainSelection(cd.chainId)}
                    disabled={isLocked}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors ${
                      isLocked
                        ? 'opacity-50 cursor-not-allowed'
                        : cd.selected
                          ? isDark
                            ? 'bg-purple-500/30 text-purple-300 border border-purple-500/50'
                            : 'bg-purple-100 text-purple-700 border border-purple-300'
                          : isDark
                            ? 'bg-white/5 text-gray-400 border border-white/10'
                            : 'bg-gray-100 text-gray-500 border border-gray-200'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: chain?.color || '#888' }}
                    />
                    {chain?.shortName || cd.chainId}
                    {cd.selected && <span>✓</span>}
                  </button>
                )
              })}
            </div>
            {selectedChains.length > 1 && (
              <div className={`mt-2 text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                Metadata will be updated on all selected chains
              </div>
            )}
          </div>
        )}

        {/* Current URI */}
        <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-600/50' : 'border-gray-200'}`}>
          <div className={`text-xs font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
            Current Metadata URI
          </div>
          {currentUri ? (
            <div className="flex items-center gap-2">
              <code className={`text-xs font-mono truncate flex-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {currentUri}
              </code>
              <a
                href={resolveIpfsUri(currentUri) || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-juice-cyan hover:underline"
              >
                View
              </a>
            </div>
          ) : (
            <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              No metadata URI set
            </div>
          )}
        </div>

        {/* Fail-closed: without the current JSON, editing would overwrite unknown fields. */}
        {metadataError && (
          <div className="p-4">
            <div className={`p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
              {metadataError}
            </div>
            <button
              onClick={() => setReloadNonce(n => n + 1)}
              className={`mt-3 w-full py-2 text-sm font-medium border-2 transition-colors ${
                isDark
                  ? 'border-white/20 text-white hover:bg-white/10'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Retry
            </button>
          </div>
        )}

        {/* Metadata editor */}
        {fields && currentMetadata && (
          <div className="p-4 space-y-4">
            <div>
              <label className={fieldLabelClass}>Name</label>
              <input
                type="text"
                data-testid="seturi-name"
                value={fields.name}
                onChange={(e) => updateField('name', e.target.value)}
                disabled={isLocked || preparing}
                placeholder="Project name"
                className={inputClass}
              />
              {!nameValid && (
                <div className={`mt-1 text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                  A project name is required
                </div>
              )}
            </div>

            <div>
              <label className={fieldLabelClass}>Tagline</label>
              <input
                type="text"
                data-testid="seturi-tagline"
                value={fields.tagline}
                onChange={(e) => updateField('tagline', e.target.value)}
                disabled={isLocked || preparing}
                placeholder="A brief one-sentence summary"
                className={inputClass}
              />
            </div>

            <div>
              <label className={fieldLabelClass}>Description</label>
              <textarea
                data-testid="seturi-description"
                value={fields.description}
                onChange={(e) => updateField('description', e.target.value)}
                disabled={isLocked || preparing}
                placeholder="What is this project about?"
                rows={3}
                className={inputClass}
              />
            </div>

            <div>
              <label className={fieldLabelClass}>Logo</label>
              <CreateFlowTheme.Provider value={{ isDark }}>
                <ImagePicker
                  uri={fields.logoUri}
                  busy={logoBusy}
                  onPick={handleLogoPick}
                  onClear={() => updateField('logoUri', '')}
                />
              </CreateFlowTheme.Provider>
            </div>

            <div>
              <label className={fieldLabelClass}>Website</label>
              <input
                type="text"
                data-testid="seturi-infouri"
                value={fields.infoUri}
                onChange={(e) => updateField('infoUri', e.target.value)}
                disabled={isLocked || preparing}
                placeholder="https://…"
                className={inputClass}
              />
            </div>

            {fields.tagsEditable && (
              <div>
                <label className={fieldLabelClass}>Tags</label>
                <input
                  type="text"
                  data-testid="seturi-tags"
                  value={fields.tagsText}
                  onChange={(e) => updateField('tagsText', e.target.value)}
                  disabled={isLocked || preparing}
                  placeholder="art, music, community"
                  className={inputClass}
                />
                <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Comma-separated. Tags help with project discovery.
                </div>
              </div>
            )}

            <div>
              <label className={fieldLabelClass}>Payment notice</label>
              <textarea
                data-testid="seturi-pay-disclosure"
                value={fields.payDisclosure}
                onChange={(e) => updateField('payDisclosure', e.target.value)}
                disabled={isLocked || preparing}
                placeholder="Shown to payers before they pay. Leave empty for none."
                rows={2}
                className={inputClass}
              />
            </div>

            {/* Advanced: raw JSON for every key the managed inputs don't cover */}
            <div>
              <button
                type="button"
                onClick={() => setAdvancedOpen(open => !open)}
                className={`text-xs font-medium flex items-center gap-1 ${isDark ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
              >
                <span>{advancedOpen ? '▾' : '▸'}</span>
                Advanced: custom fields
              </button>
              {advancedOpen && (
                <div className="mt-2">
                  <textarea
                    data-testid="seturi-custom-json"
                    value={fields.customJsonText}
                    onChange={(e) => updateField('customJsonText', e.target.value)}
                    disabled={isLocked || preparing}
                    placeholder={'{\n  "myCustomField": "value"\n}'}
                    rows={6}
                    spellCheck={false}
                    className={`${inputClass} font-mono`}
                  />
                  {customJsonInvalid && (
                    <div data-testid="seturi-custom-json-error" className={`mt-1 text-xs ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                      Custom fields must be a valid JSON object. Fix it to save.
                    </div>
                  )}
                  <div className={`mt-1 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    Every metadata field the inputs above don't cover, saved exactly as written.
                    Remove a key to delete it; the inputs above win if a key appears in both.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Submit Section */}
        {fields && currentMetadata && (
          <div className={`p-4 border-t ${isDark ? 'border-gray-600/50' : 'border-gray-200'}`}>
            {/* Transaction Status Indicator */}
            {isLocked && (
              <div className={`mb-3 p-3 text-sm ${
                persistedState?.status === 'completed'
                  ? isDark ? 'bg-green-500/10' : 'bg-green-50'
                  : persistedState?.status === 'failed'
                    ? isDark ? 'bg-red-500/10' : 'bg-red-50'
                    : isDark ? 'bg-purple-500/10' : 'bg-purple-50'
              }`}>
                <div className={`flex items-center gap-2 ${
                  persistedState?.status === 'completed'
                    ? isDark ? 'text-green-400' : 'text-green-600'
                    : persistedState?.status === 'failed'
                      ? isDark ? 'text-red-400' : 'text-red-600'
                      : isDark ? 'text-purple-400' : 'text-purple-600'
                }`}>
                  {persistedState?.status === 'completed' ? (
                    <>
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Metadata updated successfully!</span>
                    </>
                  ) : persistedState?.status === 'failed' ? (
                    <>
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span>Transaction failed</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 flex-shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Transaction pending...</span>
                    </>
                  )}
                </div>
                {persistedState?.txHashes && Object.keys(persistedState.txHashes).length > 0 && (
                  <div className="mt-2 space-y-1">
                    {Object.entries(persistedState.txHashes).map(([cid, hash]) => {
                      const chain = CHAIN_INFO[parseInt(cid)]
                      return (
                        <a
                          key={cid}
                          href={`${chain?.explorerTx || 'https://etherscan.io/tx/'}${hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-xs ml-6 underline block ${isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-500 hover:text-gray-600'}`}
                        >
                          {chain?.name || `Chain ${cid}`}: View on explorer
                        </a>
                      )
                    })}
                  </div>
                )}
                {persistedState?.error && (
                  <p className={`text-xs mt-1 ml-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    {persistedState.error}
                  </p>
                )}
              </div>
            )}

            {preparationError && (
              <div className={`mb-3 p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
                {preparationError}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={isLocked || preparing || logoBusy || selectedChains.length === 0 || !hasChange || !nameValid || customJsonInvalid}
              className={`w-full py-3 text-sm font-bold transition-colors ${
                isLocked || preparing || logoBusy || selectedChains.length === 0 || !hasChange || !nameValid || customJsonInvalid
                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                  : 'bg-purple-500 hover:bg-purple-500/90 text-white'
              }`}
            >
              {persistedState?.status === 'completed'
                ? 'Updated'
                : persistedState?.status === 'in_progress'
                  ? 'Pending...'
                  : preparing
                    ? 'Preparing metadata...'
                    : `Update Metadata${selectedChains.length > 1 ? ` on ${selectedChains.length} Chains` : ''}`}
            </button>

            <p className={`mt-3 text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {isOmnichain
                ? 'Your edits are merged into the current metadata (custom fields are kept), pinned to IPFS, and the pinned URI is set on all selected chains.'
                : 'Your edits are merged into the current metadata (custom fields are kept), pinned to IPFS, and the pinned URI is set for this project.'}
            </p>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <SetUriModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          projectName={project?.name}
          chainProjectData={selectedChains}
          newUri={newUri}
          currentUri={currentUri}
          onStarted={handleStarted}
          onConfirmed={handleConfirmed}
          onError={handleError}
        />
      )}
    </div>
  )
}
