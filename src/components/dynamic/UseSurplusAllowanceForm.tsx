import { useCallback, useEffect, useState } from 'react'
import { defaultChainId } from '../../config/environment'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useUseSurplusAllowanceFormState } from '../../hooks/useComponentState'
import { useManagedWallet } from '../../hooks'
import { useProjectDataInvalidation } from '../../hooks/useProjectDataInvalidation'
import { fetchProject, type Project } from '../../services/bendystraw'
import {
  createFundAccessClient,
  currencyLabel,
  parseFundAccessAmount,
  readFundAccessContexts,
  type FundAccessContextSnapshot,
} from '../../services/fundAccess'
import { resolveProjectChains } from '../../utils/projectChains'
import { CHAINS, MAINNET_CHAINS } from '../../constants'
import { UseSurplusAllowanceModal } from '../payment'
import InlineChainSelector from './InlineChainSelector'
import { FundAccessAmountInput } from '../fundAccess/FundAccessAmountInput'
import { FundAccessSummary } from '../fundAccess/FundAccessSummary'
import { ProjectLink } from './ProjectLink'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'

interface UseSurplusAllowanceFormProps {
  projectId: string
  chainId?: string
  messageId?: string
}

const CHAIN_INFO = { ...MAINNET_CHAINS, ...CHAINS }

interface ChainAllowanceData {
  optionKey: string
  chainId: number
  projectId: number
  context: FundAccessContextSnapshot | null
  configurationError?: string
}

export default function UseSurplusAllowanceForm({ projectId, chainId = defaultChainId(), messageId }: UseSurplusAllowanceFormProps) {
  const { state: persistedState, updateState: updatePersistedState } = useUseSurplusAllowanceFormState(messageId)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { isConnected } = useAccount()
  const { address: managedAddress, isManagedMode } = useManagedWallet()
  const hasActiveWallet = isManagedMode ? !!managedAddress : isConnected

  const [project, setProject] = useState<Project | null>(null)
  const [options, setOptions] = useState<ChainAllowanceData[]>([])
  const [selectedOptionKey, setSelectedOptionKey] = useState('')
  const [selectedCurrency, setSelectedCurrency] = useState('')
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [showModal, setShowModal] = useState(false)

  const active = options.find(option => option.optionKey === selectedOptionKey) || options[0]
  const context = active?.context || null
  const allowances = context?.surplusAllowances || []
  const access = allowances.find(allowance => allowance.currency.toString() === selectedCurrency) || allowances[0] || null
  const selectedChainId = active?.chainId ?? Number.parseInt(chainId, 10)
  const chainInfo = CHAIN_INFO[selectedChainId] || CHAIN_INFO[1]
  const { refreshRevision, bumpRefresh, invalidateProjectData } = useProjectDataInvalidation(selectedChainId, active?.projectId)
  const transactionInProgress = persistedState?.status === 'in_progress'

  const load = useCallback(async () => {
    const primaryChainId = Number.parseInt(chainId, 10)
    setLoading(true)
    try {
      const [projectData, chainResolution] = await Promise.all([
        fetchProject(projectId, primaryChainId),
        resolveProjectChains(projectId, primaryChainId),
      ])
      setProject(projectData)
      setChainMappingAvailable(chainResolution.mappingAvailable)
      const all = (await Promise.all(chainResolution.chains.map(async chain => {
        try {
          const contexts = await readFundAccessContexts(
            createFundAccessClient(chain.chainId),
            chain.chainId,
            BigInt(chain.projectId),
          )
          return contexts.map(current => ({
            optionKey: `${chain.chainId}:${current.token.toLowerCase()}`,
            chainId: chain.chainId,
            projectId: chain.projectId,
            context: current,
          } satisfies ChainAllowanceData))
        } catch (error) {
          return [{
            optionKey: `${chain.chainId}:error`,
            chainId: chain.chainId,
            projectId: chain.projectId,
            context: null,
            configurationError: error instanceof Error ? error.message : 'Surplus allowance unavailable',
          } satisfies ChainAllowanceData]
        }
      }))).flat()
      setOptions(all)
      setSelectedOptionKey(previous => {
        if (all.some(option => option.optionKey === previous)) return previous
        return all.find(option => option.chainId === primaryChainId && option.context?.surplusAllowances.length)?.optionKey
          || all.find(option => option.context?.surplusAllowances.length)?.optionKey
          || all[0]?.optionKey
          || ''
      })
    } catch (error) {
      console.error('Failed to load surplus allowance:', error)
      setOptions([])
    } finally {
      setLoading(false)
    }
  }, [chainId, projectId])

  useEffect(() => { void load() }, [load, refreshRevision])

  useEffect(() => {
    if (!context) {
      setSelectedCurrency('')
      return
    }
    setSelectedCurrency(previous => context.surplusAllowances.some(item => item.currency.toString() === previous)
      ? previous
      : context.surplusAllowances[0]?.currency.toString() || '')
    setAmount('')
  }, [active?.chainId, context])

  useEffect(() => {
    if (persistedState?.status === 'in_progress' && persistedState.amount) setAmount(persistedState.amount)
    if (persistedState?.selectedChainId && persistedState.accountingToken) {
      setSelectedOptionKey(`${persistedState.selectedChainId}:${persistedState.accountingToken.toLowerCase()}`)
    }
  }, [persistedState])

  const invalidate = useCallback((txHash: string) => {
    setShowModal(false)
    setAmount('')
    updatePersistedState({
      status: 'completed',
      amount: '',
      txHash,
      confirmedAt: new Date().toISOString(),
    })
    invalidateProjectData()
  }, [invalidateProjectData, updatePersistedState])

  const refreshAfterStaleReview = useCallback(() => {
    setShowModal(false)
    bumpRefresh()
  }, [bumpRefresh])

  const handleSubmit = () => {
    if (!context || !access || transactionInProgress) return
    const parsed = parseFundAccessAmount(amount, context.decimals)
    if (parsed === null || parsed > access.available) return
    if (!hasActiveWallet) {
      window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
      return
    }
    updatePersistedState({
      status: 'pending',
      amount,
      selectedChainId,
      accountingToken: context.token,
    })
    setShowModal(true)
  }

  if (loading) {
    return <div className={`w-full max-w-md animate-pulse border p-4 ${isDark ? 'border-gray-600 bg-juice-dark-lighter' : 'border-gray-300 bg-white'}`}>
      <div className="mb-3 h-6 w-3/4 bg-white/10" />
      <div className="h-4 w-1/2 bg-white/10" />
    </div>
  }

  return (
    <div className="w-full min-w-0">
      <div className={`w-full max-w-md min-w-0 overflow-hidden border p-4 ${isDark ? 'border-gray-600 bg-juice-dark-lighter' : 'border-gray-300 bg-white'}`}>
        {!chainMappingAvailable && <ChainMappingWarning isDark={isDark} />}
        <div className="mb-3 flex min-w-0 items-center gap-3">
          {project?.logoUri ? (
            <IpfsImage uri={project.logoUri} alt={project.name || 'Project'} className="h-14 w-14 shrink-0 object-cover" fallback={<div className="h-14 w-14 shrink-0 bg-purple-500/20" />} />
          ) : <div className="flex h-14 w-14 shrink-0 items-center justify-center bg-purple-500/20 text-2xl">💰</div>}
          <div className="min-w-0 flex-1">
            <h3 className={`truncate font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Use surplus allowance</h3>
            <ProjectLink chainSlug={chainInfo.slug} projectId={String(active?.projectId ?? projectId)} className={`block truncate text-xs hover:underline ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {project?.name || `Project #${projectId}`}
            </ProjectLink>
          </div>
        </div>

        <InlineChainSelector
          variant="row"
          ariaLabel="Surplus treasury"
          options={options.map(option => ({
            key: option.optionKey,
            chainId: option.chainId,
            selected: option.optionKey === selectedOptionKey,
            label: `${CHAIN_INFO[option.chainId]?.shortName ?? String(option.chainId)} ${option.context?.tokenSymbol || 'Unavailable'}`,
          }))}
          onSelect={option => setSelectedOptionKey(String(option.key))}
          isDark={isDark}
        />

        {context && allowances.length > 1 && (
          <label className={`mt-3 block text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Allowance currency
            <select
              aria-label="Allowance currency"
              value={access?.currency.toString() || ''}
              onChange={event => { setSelectedCurrency(event.target.value); setAmount('') }}
              className={`mt-1 w-full min-w-0 border px-2 py-2 text-sm ${isDark ? 'border-white/10 bg-juice-dark text-white' : 'border-gray-200 bg-white text-gray-900'}`}
            >
              {allowances.map(item => <option key={item.currency.toString()} value={item.currency.toString()}>{currencyLabel(item.currency, context)} ({item.currency.toString()})</option>)}
            </select>
          </label>
        )}

        {context && access ? (
          <div className="mt-3 space-y-3">
            <FundAccessSummary kind="allowance" context={context} access={access} isDark={isDark} />
            <FundAccessAmountInput
              kind="allowance"
              context={context}
              access={access}
              amount={amount}
              onAmountChange={setAmount}
              onSubmit={handleSubmit}
              disabled={transactionInProgress}
              submitLabel={transactionInProgress ? 'Pending…' : 'Review'}
              isDark={isDark}
            />
            <p className={`break-words text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Withdraws only the protocol-calculated surplus. A fee of up to 2.5% may apply; the exact net output is simulated before signing.
            </p>
          </div>
        ) : (
          <p className={`mt-3 break-words text-xs ${active?.configurationError ? 'text-red-500' : isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {active?.configurationError || 'No surplus allowance is configured for this accounting token.'}
          </p>
        )}

        {persistedState?.status === 'completed' && (
          <p className={`mt-3 text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}>Withdrawal confirmed. Live surplus has been refreshed.</p>
        )}
        {persistedState?.status === 'failed' && persistedState.error && (
          <p className="mt-3 break-words text-xs text-red-500">{persistedState.error}</p>
        )}
      </div>

      {context && access && (
        <UseSurplusAllowanceModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          projectId={String(active.projectId)}
          projectName={project?.name}
          chainId={active.chainId}
          amount={amount}
          context={context}
          access={access}
          onSubmitted={txHash => updatePersistedState({ status: 'in_progress', txHash, submittedAt: new Date().toISOString() })}
          onConfirmed={invalidate}
          onError={error => updatePersistedState({ status: 'failed', error })}
          onRefresh={refreshAfterStaleReview}
        />
      )}
    </div>
  )
}
