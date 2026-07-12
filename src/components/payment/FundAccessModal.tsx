import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useSwitchChain, useWalletClient } from 'wagmi'
import { formatUnits, type Address } from 'viem'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { executeManagedTransaction, useManagedWallet, useWalletBalances } from '../../hooks'
import { useReviewedTransactionAccount } from '../../hooks/useReviewedTransactionAccount'
import {
  createFundAccessClient,
  currencyLabel,
  formatFundAccessAmount,
  fundAccessErrorMessage,
  parseFundAccessAmount,
  prepareFundAccessTransaction,
  type FundAccessAmountSnapshot,
  type FundAccessContextSnapshot,
  type FundAccessKind,
} from '../../services/fundAccess'
import { fetchProjectSplits, type JBSplitData } from '../../services/bendystraw'
import { assertSimpleStoredSplitGroups } from '../../utils/splitSafety'
import { waitForSuccessfulTransaction } from '../../utils/transactionSafety'
import { verifySendPayoutsParams, verifyUseAllowanceParams } from '../../utils/transactionVerification'
import { CHAINS as CHAIN_INFO, MAINNET_CHAINS } from '../../constants'
import { FundAccessSummary } from '../fundAccess/FundAccessSummary'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { ProjectSplitRoute } from '../dynamic/ProjectSplitRoute'
import { GasBalanceStatus } from './GasBalanceStatus'

export interface FundAccessModalProps {
  kind: FundAccessKind
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName?: string
  chainId: number
  amount: string
  context: FundAccessContextSnapshot
  access: FundAccessAmountSnapshot
  splits?: JBSplitData[]
  onSubmitted?: (txHash: string) => void
  onConfirmed?: (txHash: string) => void
  onError?: (error: string) => void
  onRefresh?: () => void
}

type Status = 'preview' | 'preparing' | 'signing' | 'pending' | 'failed'

function splitFingerprint(entries: JBSplitData[]): string {
  return entries.map(split => [
    split.beneficiary.toLowerCase(),
    split.percent,
    split.hook.toLowerCase(),
    split.projectId,
    split.preferAddToBalance,
    split.lockedUntil,
  ].join(':')).join('|')
}

function splitPercentLabel(percent: number): string {
  const hundredths = (BigInt(percent) * 10_000n) / 1_000_000_000n
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}%`
}

export default function FundAccessModal({
  kind,
  isOpen,
  onClose,
  projectId,
  projectName,
  chainId,
  amount,
  context,
  access,
  splits = [],
  onSubmitted,
  onConfirmed,
  onError,
  onRefresh,
}: FundAccessModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const { addTransaction, updateTransaction } = useTransactionStore()
  const { perChain, loading: balancesLoading, available: balancesAvailable } = useWalletBalances()
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address: managedAddress } = useManagedWallet()
  const activeAddress = isManagedMode ? managedAddress : address
  const { assertCurrentAccount } = useReviewedTransactionAccount(
    isOpen,
    activeAddress,
    isManagedMode ? 'managed' : 'self_custody',
  )

  const [status, setStatus] = useState<Status>('preview')
  const [error, setError] = useState<string | null>(null)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const [quotedAmount, setQuotedAmount] = useState<bigint | null>(null)
  const [minimumOutput, setMinimumOutput] = useState<bigint | null>(null)
  const reviewRef = useRef({ chainId, token: context.token, currency: access.currency, amount, account: activeAddress })
  reviewRef.current = { chainId, token: context.token, currency: access.currency, amount, account: activeAddress }

  const chainName = CHAIN_INFO[chainId]?.name || MAINNET_CHAINS[chainId]?.name || `Chain ${chainId}`
  const unit = currencyLabel(access.currency, context)
  const requestedAmount = useMemo(
    () => parseFundAccessAmount(amount, context.decimals),
    [amount, context.decimals],
  )
  const chainGasBalance = perChain.find(balance => balance.chainId === chainId)?.eth ?? 0n
  const hasGasBalance = isManagedMode || (balancesAvailable && chainGasBalance > 0n)
  const provisionalMinimum = requestedAmount && kind === 'payout' && access.currency === context.accountingCurrency
    ? requestedAmount
    : 1n

  const verificationResult = useMemo(() => {
    if (kind === 'payout') {
      return verifySendPayoutsParams({
        projectId: BigInt(projectId),
        token: context.token,
        amount: requestedAmount ?? 0n,
        currency: access.currency,
        accountingCurrency: context.accountingCurrency,
        minTokensPaidOut: provisionalMinimum,
      })
    }
    const beneficiary = activeAddress || '0x0000000000000000000000000000000000000000'
    return verifyUseAllowanceParams({
      projectId: BigInt(projectId),
      token: context.token,
      amount: requestedAmount ?? 0n,
      currency: access.currency,
      accountingCurrency: context.accountingCurrency,
      minTokensPaidOut: provisionalMinimum,
      beneficiary,
      feeBeneficiary: beneficiary,
      memo: '',
    })
  }, [access.currency, activeAddress, context.accountingCurrency, context.token, kind, projectId, provisionalMinimum, requestedAmount])

  const hasWarnings = verificationResult.doubts.length > 0
  const hasCriticalDoubts = verificationResult.doubts.some(doubt => doubt.severity === 'critical')
  const canProceed = requestedAmount !== null && requestedAmount <= access.available && hasGasBalance &&
    !hasCriticalDoubts && (!hasWarnings || warningsAcknowledged) && (status === 'preview' || status === 'failed')

  useEffect(() => {
    if (!isOpen) return
    setStatus('preview')
    setError(null)
    setWarningsAcknowledged(false)
    setQuotedAmount(null)
    setMinimumOutput(null)
  }, [isOpen, chainId, context.token, access.currency, amount])

  const assertReviewUnchanged = useCallback((expectedAccount: Address, expectedAmount: bigint) => {
    const current = reviewRef.current
    if (
      current.chainId !== chainId ||
      current.token.toLowerCase() !== context.token.toLowerCase() ||
      current.currency !== access.currency ||
      parseFundAccessAmount(current.amount, context.decimals) !== expectedAmount ||
      !current.account ||
      current.account.toLowerCase() !== expectedAccount.toLowerCase()
    ) {
      throw new Error('The chain, account, token, currency, or amount changed. Review and try again.')
    }
  }, [access.currency, chainId, context.decimals, context.token])

  const handleConfirm = useCallback(async () => {
    if (!activeAddress || requestedAmount === null) {
      setError(activeAddress ? 'Enter a valid amount' : 'Wallet not connected')
      return
    }
    if (!isManagedMode && !walletClient) {
      setError('Wallet not connected')
      return
    }

    const reviewedAccount = activeAddress as Address
    const reviewedAmount = requestedAmount
    const originalSplitFingerprint = splitFingerprint(splits)
    const prepare = async () => {
      assertReviewUnchanged(reviewedAccount, reviewedAmount)
      assertCurrentAccount(isManagedMode ? undefined : walletClient?.account?.address)
      const prepared = await prepareFundAccessTransaction({
        client: createFundAccessClient(chainId),
        chainId,
        projectId: BigInt(projectId),
        token: context.token,
        currency: access.currency,
        amount: reviewedAmount,
        account: reviewedAccount,
        kind,
      })
      if (
        prepared.context.terminal.toLowerCase() !== context.terminal.toLowerCase() ||
        prepared.context.accountingCurrency !== context.accountingCurrency ||
        prepared.context.decimals !== context.decimals
      ) {
        throw new Error('The terminal accounting context changed. Close this review and load the latest configuration.')
      }
      if (kind === 'payout') {
        const freshConfiguration = await fetchProjectSplits(projectId, chainId, prepared.context.rulesetId.toString())
        if (!freshConfiguration.configurationComplete) throw new Error('Payout configuration could not be verified')
        const freshSplits = freshConfiguration.splitGroups?.find(
          group => group.groupId === BigInt(context.token).toString(),
        )?.splits || []
        assertSimpleStoredSplitGroups([{ splits: freshSplits }], { kind: 'payout', sourceProjectId: projectId })
        if (splitFingerprint(freshSplits) !== originalSplitFingerprint) {
          throw new Error('Payout recipients changed. Close this review and load the latest configuration.')
        }
      }
      assertReviewUnchanged(reviewedAccount, reviewedAmount)
      return prepared
    }

    setError(null)
    setStatus('preparing')
    let txId: string | null = null
    try {
      const prepared = await prepare()
      setQuotedAmount(prepared.quotedAmount)
      setMinimumOutput(prepared.minimumOutput)
      txId = addTransaction({
        type: kind === 'payout' ? 'sendPayouts' : 'useAllowance',
        projectId,
        chainId,
        amount,
        token: context.token,
        status: 'pending',
      })

      let hash: string
      if (isManagedMode) {
        assertCurrentAccount()
        assertReviewUnchanged(reviewedAccount, reviewedAmount)
        setStatus('pending')
        hash = await executeManagedTransaction(chainId, prepared.target, prepared.data, '0')
      } else {
        setStatus('signing')
        await switchChainAsync({ chainId })
        if (await walletClient!.getChainId() !== chainId) throw new Error(`Wallet did not switch to chain ${chainId}`)
        const finalPrepared = await prepare()
        if (
          finalPrepared.target.toLowerCase() !== prepared.target.toLowerCase() ||
          finalPrepared.data.toLowerCase() !== prepared.data.toLowerCase()
        ) {
          throw new Error('The live balance, price, or quote changed. Review the updated amount and try again.')
        }
        assertReviewUnchanged(reviewedAccount, reviewedAmount)
        assertCurrentAccount(walletClient!.account?.address)
        hash = await walletClient!.sendTransaction({
          to: finalPrepared.target,
          data: finalPrepared.data,
          value: 0n,
        })
        setStatus('pending')
      }

      updateTransaction(txId, { hash, status: 'submitted' })
      onSubmitted?.(hash)
      if (!isManagedMode) await waitForSuccessfulTransaction(chainId, hash as `0x${string}`)
      updateTransaction(txId, { hash, status: 'confirmed', confirmedAt: Date.now() })
      onConfirmed?.(hash)
      onClose()
    } catch (caught) {
      const message = fundAccessErrorMessage(caught, kind)
      console.error(`${kind} transaction failed:`, caught)
      if (txId !== null) updateTransaction(txId, { status: 'failed', error: message })
      setError(message)
      setStatus('failed')
      onError?.(message)
      if (/depleted|balance|surplus|price|quote|configuration|currency|accounting context|recipients/i.test(message)) {
        onRefresh?.()
      }
    }
  }, [access.currency, activeAddress, addTransaction, amount, assertCurrentAccount, assertReviewUnchanged, chainId, context.accountingCurrency, context.decimals, context.terminal, context.token, isManagedMode, kind, onClose, onConfirmed, onError, onRefresh, onSubmitted, projectId, requestedAmount, splits, switchChainAsync, updateTransaction, walletClient])

  if (!isOpen) return null

  const requestedDisplay = requestedAmount === null
    ? amount
    : formatFundAccessAmount(requestedAmount, context.decimals, context.decimals)
  const processing = status === 'preparing' || status === 'signing' || status === 'pending'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={!processing ? onClose : undefined} />
      <div className={`relative flex max-h-[calc(100vh-1rem)] w-full max-w-md min-w-0 flex-col overflow-hidden border ${isDark ? 'border-white/10 bg-juice-dark' : 'border-gray-200 bg-white'}`}>
        <div className={`flex shrink-0 items-center justify-between border-b px-4 py-3 ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <div className="min-w-0">
            <h2 className={`truncate font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {kind === 'payout' ? 'Confirm payout distribution' : 'Confirm surplus withdrawal'}
            </h2>
            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{chainName}</p>
          </div>
          {!processing && <button type="button" aria-label="Close" onClick={onClose} className="shrink-0 p-2 text-gray-400">×</button>}
        </div>

        <div className="min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden p-4">
          {processing && <div className={`flex items-center gap-2 p-3 text-sm ${isDark ? 'bg-juice-cyan/10 text-juice-cyan' : 'bg-cyan-50 text-cyan-700'}`}>
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {status === 'preparing' ? 'Refreshing live limits, balance, surplus, and price…' : status === 'signing' ? 'Waiting for wallet confirmation…' : 'Confirming onchain…'}
          </div>}
          {status === 'failed' && error && <div className="break-words bg-red-500/10 p-3 text-sm text-red-500">{error}</div>}

          <div className={`min-w-0 p-3 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <p className={`text-[10px] uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {kind === 'payout' ? 'Distributing from' : 'Withdrawing from'}
            </p>
            <p className={`truncate font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>{projectName || `Project #${projectId}`}</p>
            <div className="mt-2 flex min-w-0 items-start justify-between gap-3 text-sm">
              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>Requested</span>
              <span className={`min-w-0 break-all text-right font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>{requestedDisplay} {unit}</span>
            </div>
            <p className={`mt-2 break-words text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              Up to 2.5% applies only to fee-eligible terminal-token egress. The exact output is simulated before signing.
            </p>
          </div>

          <FundAccessSummary kind={kind} context={context} access={access} isDark={isDark} />

          {quotedAmount !== null && minimumOutput !== null && <div className={`min-w-0 p-3 text-xs ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <div className="flex min-w-0 justify-between gap-3"><span>Live terminal-token quote</span><span className="min-w-0 break-all text-right font-mono">{formatUnits(quotedAmount, context.decimals)} {context.tokenSymbol}</span></div>
            <div className="mt-1 flex min-w-0 justify-between gap-3"><span>Protected minimum</span><span className="min-w-0 break-all text-right font-mono">{formatUnits(minimumOutput, context.decimals)} {context.tokenSymbol}</span></div>
          </div>}

          {kind === 'payout' && splits.length > 0 && <div className={`min-w-0 space-y-1 p-3 text-xs ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
            <p className={`mb-2 uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Recipients</p>
            {splits.slice(0, 3).map((split, index) => <div key={`${split.beneficiary}:${index}`} className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0 truncate">{split.projectId > 0
                ? <ProjectSplitRoute projectId={split.projectId} chainId={chainId} beneficiary={split.beneficiary} kind="payout" preferAddToBalance={split.preferAddToBalance} hook={split.hook} isDark={isDark} />
                : <span className="font-mono">{split.beneficiary.slice(0, 6)}…{split.beneficiary.slice(-4)}</span>}
              </div>
              <span className="shrink-0 font-mono">{splitPercentLabel(split.percent)}</span>
            </div>)}
            {splits.length > 3 && <p className="text-center text-gray-500">+{splits.length - 3} more</p>}
          </div>}

          <GasBalanceStatus balance={chainGasBalance} hasGasBalance={hasGasBalance} loading={balancesLoading} available={balancesAvailable} managed={isManagedMode} isDark={isDark} />

          {kind === 'payout' ? (
            <TransactionSummary
              type="sendPayouts"
              details={{
                projectId,
                projectName,
                amount,
                amountFormatted: `${requestedDisplay} ${unit}`,
                currency: unit,
                recipients: splits.map(split => ({ address: split.beneficiary, percent: split.percent })),
              }}
              isDark={isDark}
            />
          ) : (
            <TransactionSummary
              type="useAllowance"
              details={{
                projectId,
                projectName,
                amount,
                amountFormatted: `${requestedDisplay} ${unit}`,
                currency: unit,
                destination: activeAddress || '',
              }}
              isDark={isDark}
            />
          )}

          {hasWarnings && <TransactionWarning doubts={verificationResult.doubts} onConfirm={() => setWarningsAcknowledged(true)} onCancel={onClose} isDark={isDark} />}

          <TechnicalDetails
            contract="JB_MULTI_TERMINAL"
            contractAddress={context.terminal}
            functionName={kind === 'payout' ? 'sendPayoutsOf' : 'useAllowanceOf'}
            chainId={chainId}
            chainName={chainName}
            projectId={projectId}
            parameters={{
              ...verificationResult.verifiedParams,
              minTokensPaidOut: minimumOutput?.toString() || 'Derived from the final live simulation',
            }}
            isDark={isDark}
          />
        </div>

        <div className={`grid shrink-0 grid-cols-2 gap-2 border-t p-4 ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <button type="button" onClick={onClose} disabled={processing} className={`min-h-11 border px-3 py-2 font-medium disabled:opacity-50 ${isDark ? 'border-white/20 text-white' : 'border-gray-200 text-gray-700'}`}>Cancel</button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canProceed}
            className={`min-h-11 px-3 py-2 font-bold disabled:cursor-not-allowed disabled:opacity-50 ${kind === 'payout' ? 'bg-juice-orange text-black' : 'bg-purple-500 text-white'}`}
          >
            {status === 'failed' ? 'Try again' : kind === 'payout' ? 'Distribute' : 'Withdraw'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
