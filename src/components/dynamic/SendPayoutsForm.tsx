import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { useThemeStore } from '../../stores'
import { useSendPayoutsFormState } from '../../hooks/useComponentState'
import { useManagedWallet } from '../../hooks'
import { useProjectDataInvalidation } from '../../hooks/useProjectDataInvalidation'
import {
  fetchProject,
  fetchProjectSplits,
  type JBSplitData,
  type Project,
} from '../../services/bendystraw'
import {
  createFundAccessClient,
  currencyLabel,
  parseFundAccessAmount,
  readFundAccessContexts,
  type FundAccessContextSnapshot,
} from '../../services/fundAccess'
import { resolveProjectChains } from '../../utils/projectChains'
import { truncateAddress } from '../../utils/ens'
import { CHAINS, MAINNET_CHAINS } from '../../constants'
import { assertSafeStoredSplitGroups as assertSimpleStoredSplitGroups } from '../../utils/splitSafety'
import { SendPayoutsModal } from '../payment'
import InlineChainSelector from './InlineChainSelector'
import { resolveSplitEnsNames } from './resolveSplitEnsNames'
import { FundAccessAmountInput } from '../fundAccess/FundAccessAmountInput'
import { FundAccessSummary } from '../fundAccess/FundAccessSummary'
import { ProjectLink } from './ProjectLink'
import { ProjectSplitRoute } from './ProjectSplitRoute'
import { ChainMappingWarning } from './ChainMappingWarning'
import { IpfsImage } from '../ui/IpfsMedia'

interface SendPayoutsFormProps {
  projectId: string
  chainId?: string
  messageId?: string
}

const CHAIN_INFO = { ...MAINNET_CHAINS, ...CHAINS }

interface ChainPayoutData {
  optionKey: string
  chainId: number
  projectId: number
  context: FundAccessContextSnapshot | null
  payoutSplits: JBSplitData[]
  configurationError?: string
}

export default function SendPayoutsForm({ projectId, chainId = '1', messageId }: SendPayoutsFormProps) {
  const { state: persistedState, updateState: updatePersistedState } = useSendPayoutsFormState(messageId)
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { isConnected } = useAccount()
  const { address: managedAddress, isManagedMode } = useManagedWallet()
  const hasActiveWallet = isManagedMode ? !!managedAddress : isConnected

  const [project, setProject] = useState<Project | null>(null)
  const [options, setOptions] = useState<ChainPayoutData[]>([])
  const [selectedOptionKey, setSelectedOptionKey] = useState('')
  const [selectedCurrency, setSelectedCurrency] = useState('')
  const [chainMappingAvailable, setChainMappingAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showSplits, setShowSplits] = useState(false)
  const [splitEnsNames, setSplitEnsNames] = useState<Record<string, string>>({})

  const active = options.find(option => option.optionKey === selectedOptionKey) || options[0]
  const context = active?.context || null
  const limits = context?.payoutLimits || []
  const access = limits.find(limit => limit.currency.toString() === selectedCurrency) || limits[0] || null
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
          const client = createFundAccessClient(chain.chainId)
          const contexts = await readFundAccessContexts(client, chain.chainId, BigInt(chain.projectId))
          const configuration = await fetchProjectSplits(
            String(chain.projectId),
            chain.chainId,
            contexts[0].rulesetId.toString(),
          )
          if (!configuration.configurationComplete) throw new Error('Payout configuration could not be verified')
          return contexts.map(current => {
            const payoutSplits = configuration.splitGroups?.find(
              group => group.groupId === BigInt(current.token).toString(),
            )?.splits || []
            assertSimpleStoredSplitGroups([{ splits: payoutSplits }], {
              kind: 'payout',
              sourceProjectId: String(chain.projectId),
            })
            return {
              optionKey: `${chain.chainId}:${current.token.toLowerCase()}`,
              chainId: chain.chainId,
              projectId: chain.projectId,
              context: current,
              payoutSplits,
            } satisfies ChainPayoutData
          })
        } catch (error) {
          return [{
            optionKey: `${chain.chainId}:error`,
            chainId: chain.chainId,
            projectId: chain.projectId,
            context: null,
            payoutSplits: [],
            configurationError: error instanceof Error ? error.message : 'Payout configuration unavailable',
          } satisfies ChainPayoutData]
        }
      }))).flat()
      setOptions(all)
      setSelectedOptionKey(previous => {
        if (all.some(option => option.optionKey === previous)) return previous
        return all.find(option => option.chainId === primaryChainId && option.context?.payoutLimits.length)?.optionKey
          || all.find(option => option.context?.payoutLimits.length)?.optionKey
          || all[0]?.optionKey
          || ''
      })

      setSplitEnsNames(await resolveSplitEnsNames(all.map(option => option.payoutSplits)))
    } catch (error) {
      console.error('Failed to load payout access:', error)
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
    setSelectedCurrency(previous => context.payoutLimits.some(limit => limit.currency.toString() === previous)
      ? previous
      : context.payoutLimits[0]?.currency.toString() || '')
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

  const totalSplitPercent = useMemo(
    () => (active?.payoutSplits || []).reduce((sum, split) => sum + BigInt(split.percent), 0n),
    [active?.payoutSplits],
  )

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
            <IpfsImage uri={project.logoUri} alt={project.name || 'Project'} className="h-14 w-14 shrink-0 object-cover" fallback={<div className="h-14 w-14 shrink-0 bg-juice-orange/20" />} />
          ) : <div className="flex h-14 w-14 shrink-0 items-center justify-center bg-juice-orange/20 text-2xl">📤</div>}
          <div className="min-w-0 flex-1">
            <h3 className={`truncate font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Distribute payouts</h3>
            <ProjectLink chainSlug={chainInfo.slug} projectId={String(active?.projectId ?? projectId)} className={`block truncate text-xs hover:underline ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {project?.name || `Project #${projectId}`}
            </ProjectLink>
          </div>
        </div>

        <InlineChainSelector
          variant="row"
          ariaLabel="Payout treasury"
          options={options.map(option => ({
            key: option.optionKey,
            chainId: option.chainId,
            selected: option.optionKey === selectedOptionKey,
            label: `${CHAIN_INFO[option.chainId]?.shortName ?? String(option.chainId)} ${option.context?.tokenSymbol || 'Unavailable'}`,
          }))}
          onSelect={option => setSelectedOptionKey(String(option.key))}
          isDark={isDark}
        />

        {context && limits.length > 1 && (
          <label className={`mt-3 block text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Payout currency
            <select
              aria-label="Payout currency"
              value={access?.currency.toString() || ''}
              onChange={event => { setSelectedCurrency(event.target.value); setAmount('') }}
              className={`mt-1 w-full min-w-0 border px-2 py-2 text-sm ${isDark ? 'border-white/10 bg-juice-dark text-white' : 'border-gray-200 bg-white text-gray-900'}`}
            >
              {limits.map(limit => <option key={limit.currency.toString()} value={limit.currency.toString()}>{currencyLabel(limit.currency, context)} ({limit.currency.toString()})</option>)}
            </select>
          </label>
        )}

        {context && access ? (
          <div className="mt-3 space-y-3">
            <FundAccessSummary kind="payout" context={context} access={access} isDark={isDark} />

            {active.payoutSplits.length > 0 && (
              <div className="min-w-0">
                <button type="button" onClick={() => setShowSplits(value => !value)} className={`flex w-full items-center justify-between py-2 text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                  <span>Payout recipients ({active.payoutSplits.length})</span><span>{showSplits ? '▲' : '▼'}</span>
                </button>
                {showSplits && <div className={`space-y-1.5 border-t py-2 ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                  {active.payoutSplits.map((split, index) => {
                    const beneficiary = split.beneficiary.toLowerCase()
                    const whole = (BigInt(split.percent) * 10_000n) / 1_000_000_000n
                    const percent = `${whole / 100n}.${(whole % 100n).toString().padStart(2, '0')}%`
                    return <div key={`${beneficiary}:${index}`} className={`flex min-w-0 items-center justify-between gap-2 p-2 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}>
                      <div className="min-w-0 truncate">
                        {split.projectId > 0 ? <ProjectSplitRoute projectId={split.projectId} chainId={active.chainId} beneficiary={split.beneficiary} kind="payout" preferAddToBalance={split.preferAddToBalance} hook={split.hook} isDark={isDark} />
                          : <span className="font-mono text-xs text-juice-orange">{splitEnsNames[beneficiary] || truncateAddress(split.beneficiary)}</span>}
                      </div>
                      <span className="shrink-0 font-mono text-xs text-emerald-400">{percent}</span>
                    </div>
                  })}
                  {totalSplitPercent < 1_000_000_000n && <div className={`flex justify-between p-2 text-xs ${isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                    <span>Project treasury</span>
                    <span className="font-mono text-emerald-400">{((1_000_000_000n - totalSplitPercent) / 10_000_000n).toString()}%</span>
                  </div>}
                </div>}
              </div>
            )}

            <FundAccessAmountInput
              kind="payout"
              context={context}
              access={access}
              amount={amount}
              onAmountChange={setAmount}
              onSubmit={handleSubmit}
              disabled={transactionInProgress}
              submitLabel={transactionInProgress ? 'Pending…' : 'Review'}
              isDark={isDark}
            />
          </div>
        ) : (
          <p className={`mt-3 break-words text-xs ${active?.configurationError ? 'text-red-500' : isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {active?.configurationError || 'No payout limit is configured for this accounting token.'}
          </p>
        )}

        {persistedState?.status === 'completed' && (
          <p className={`mt-3 text-xs ${isDark ? 'text-green-400' : 'text-green-600'}`}>Payouts confirmed. Live balances have been refreshed.</p>
        )}
        {persistedState?.status === 'failed' && persistedState.error && (
          <p className="mt-3 break-words text-xs text-red-500">{persistedState.error}</p>
        )}
      </div>

      {context && access && (
        <SendPayoutsModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          projectId={String(active.projectId)}
          projectName={project?.name}
          chainId={active.chainId}
          amount={amount}
          context={context}
          access={access}
          splits={active.payoutSplits}
          onSubmitted={txHash => updatePersistedState({ status: 'in_progress', txHash, submittedAt: new Date().toISOString() })}
          onConfirmed={invalidate}
          onError={error => updatePersistedState({ status: 'failed', error })}
          onRefresh={refreshAfterStaleReview}
        />
      )}
    </div>
  )
}
