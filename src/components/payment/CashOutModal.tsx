import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { parseUnits, formatUnits, encodeFunctionData, createPublicClient, http, type Hex, type Address, type Chain, type PublicClient } from 'viem'
import { buildCashOutTx } from '@bananapus/nana-sdk-core/v6'
import { type JBChainId } from '@bananapus/nana-sdk-core'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { useReviewedTransactionAccount } from '../../hooks/useReviewedTransactionAccount'
import { txErrorMessage } from '../../utils/txErrors'
import { GasBalanceStatus } from './GasBalanceStatus'
import { useStatusCallbacks } from './modalHooks'
import { ALL_VIEM_CHAINS, CHAINS as CHAIN_INFO, JB_CONTRACTS, MAINNET_CHAINS, RPC_ENDPOINTS } from '../../constants'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifyCashOutParams } from '../../utils/transactionVerification'
import { getPaymentTerminal } from '../../utils/paymentTerminal'
import { simulateTransaction, waitForSuccessfulTransaction } from '../../utils/transactionSafety'
import { assertCurrentProjectCashOutConfigurationTrusted, requireRecognizedRuntimeHook } from '../../utils/projectTrust'
import { resolveCashOutPreviewOutcome, TERMINAL_PREVIEW_CASH_OUT_ABI, type CashOutPreviewOutcome } from '../../utils/terminalPreview'

const FEELESS_ADDRESSES_ABI = [
  {
    name: 'isFeelessFor',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'addr', type: 'address' },
      { name: 'projectId', type: 'uint256' },
      { name: 'caller', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const FEE_FREE_SURPLUS_ABI = [
  {
    name: 'feeFreeSurplusOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// viem chain objects for wallet operations
const CHAINS: Record<number, Chain> = ALL_VIEM_CHAINS

async function readCashOutPreviewOutcome(params: { client: PublicClient; terminal: Address; holder: Address; projectId: bigint; cashOutCount: bigint; reclaimToken: Address }) {
  const readPreview = (metadata: Hex) =>
    params.client.readContract({
      address: params.terminal,
      abi: TERMINAL_PREVIEW_CASH_OUT_ABI,
      functionName: 'previewCashOutFrom',
      args: [params.holder, params.projectId, params.cashOutCount, params.reclaimToken, params.holder, metadata],
    })
  const [initialPreview, feeFreeSurplus, beneficiaryIsFeeless] = await Promise.all([
    readPreview('0x'),
    params.client.readContract({
      address: params.terminal,
      abi: FEE_FREE_SURPLUS_ABI,
      functionName: 'feeFreeSurplusOf',
      args: [params.projectId, params.reclaimToken],
    }),
    params.client.readContract({
      address: JB_CONTRACTS.JBFeelessAddresses,
      abi: FEELESS_ADDRESSES_ABI,
      functionName: 'isFeelessFor',
      args: [params.holder, params.projectId, params.holder],
    }),
  ])
  const validateHooks = async (preview: typeof initialPreview) => {
    for (const specification of preview[3]) {
      if (!specification.noop) {
        await requireRecognizedRuntimeHook({
          client: params.client,
          projectId: params.projectId,
          rulesetId: preview[0].id,
          hook: specification.hook,
        })
      }
    }
  }
  const resolve = (preview: typeof initialPreview) =>
    resolveCashOutPreviewOutcome({
      reclaimAmount: preview[1],
      cashOutTaxRate: preview[2],
      hookSpecifications: preview[3],
      beneficiaryIsFeeless,
      feeFreeSurplus,
    })

  await validateHooks(initialPreview)
  let preview = initialPreview
  let outcome = resolve(initialPreview)
  if (outcome.route === 'amm') {
    const quotedOutcome = outcome
    preview = await readPreview(outcome.metadata)
    await validateHooks(preview)
    const lockedOutcome = resolve(preview)
    if (lockedOutcome.route !== 'amm' || lockedOutcome.minimumReturn !== quotedOutcome.minimumReturn || lockedOutcome.metadata.toLowerCase() !== quotedOutcome.metadata.toLowerCase()) {
      throw new Error('The buyback cash out route changed')
    }
    // Keep the raw market quote for display while using the second preview to
    // prove that the exact metadata/floor remains executable.
    outcome = quotedOutcome
  }
  if (outcome.expectedReturn <= 0n || outcome.minimumReturn <= 0n) {
    throw new Error('No funds are currently reclaimable for this cash out')
  }
  return { preview, outcome }
}

interface CashOutModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName?: string
  chainId: number
  tokenAmount: string
  tokenSymbol?: string
  cashOutTaxRate?: number
  reclaimToken: Address
  reclaimTokenDecimals: number
  currencySymbol: string
  expectedTerminal: Address
  // Transaction status callbacks for persistence
  onSubmitted?: (txHash: string) => void
  onConfirmed?: (txHash: string) => void
  onError?: (error: string) => void
}

type CashOutStatus = 'preview' | 'signing' | 'pending' | 'confirmed' | 'failed'

export default function CashOutModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  chainId,
  tokenAmount,
  tokenSymbol = 'tokens',
  cashOutTaxRate = 0,
  reclaimToken,
  reclaimTokenDecimals,
  currencySymbol,
  expectedTerminal,
  onSubmitted,
  onConfirmed,
  onError,
}: CashOutModalProps) {
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const { addTransaction, updateTransaction } = useTransactionStore()
  const { perChain, loading: balancesLoading, available: balancesAvailable } = useWalletBalances()

  // Managed mode support
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address: managedAddress } = useManagedWallet()

  const [status, setStatus] = useState<CashOutStatus>('preview')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const [terminalAddress, setTerminalAddress] = useState<Address | null>(null)
  const [terminalLoading, setTerminalLoading] = useState(false)
  // Slippage floor + fee info sourced from the contract's previewCashOutFrom.
  // A cash out is never submitted without a positive, current preview.
  const [previewOutcome, setPreviewOutcome] = useState<CashOutPreviewOutcome | null>(null)
  const [previewTaxRate, setPreviewTaxRate] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewRevision, setPreviewRevision] = useState(0)
  // Ref-based in-flight lock: a state flag alone can't stop two same-tick
  // clicks (both read the stale `false` before the first re-render). The ref
  // is the mutex; `submitting` only mirrors it into the button's disabled UI.
  const inFlightRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)

  const chainInfo = CHAIN_INFO[chainId] || MAINNET_CHAINS[chainId] || MAINNET_CHAINS[1]
  const chainName = chainInfo.name
  const cashOutCount = useMemo(() => {
    try {
      const parsed = parseUnits(tokenAmount, 18)
      return parsed > 0n ? parsed : null
    } catch {
      return null
    }
  }, [tokenAmount])
  const tokenNum = cashOutCount !== null ? Number(formatUnits(cashOutCount, 18)) : 0
  const chainGasBalance = perChain.find((balance) => balance.chainId === chainId)?.eth ?? 0n
  const hasGasBalance = isManagedMode || (balancesAvailable && chainGasBalance > 0n)

  const minReclaimed = previewOutcome?.terminalMinimum ?? 0n
  const previewReturnFloat = previewOutcome ? Number(formatUnits(previewOutcome.expectedReturn, reclaimTokenDecimals)) : null
  const minimumReturnFloat = previewOutcome && previewOutcome.minimumReturn > 0n ? Number(formatUnits(previewOutcome.minimumReturn, reclaimTokenDecimals)) : null
  const displayedReturn = previewReturnFloat
  const returnDecimals = reclaimTokenDecimals <= 6 ? 2 : 4

  // Verify transaction parameters
  const activeAddress = isManagedMode ? managedAddress : address
  const { assertCurrentAccount } = useReviewedTransactionAccount(isOpen, activeAddress, isManagedMode ? 'managed' : 'self_custody')
  const verificationResult = useMemo(() => {
    const holderAddress = activeAddress || '0x0000000000000000000000000000000000000000'
    return verifyCashOutParams({
      holder: holderAddress,
      projectId,
      cashOutCount: cashOutCount ?? 0n,
      tokenToReclaim: reclaimToken,
      minTokensReclaimed: minReclaimed,
      beneficiary: holderAddress,
      metadata: previewOutcome?.metadata ?? ('0x' as Hex),
      buybackRoute: previewOutcome?.route === 'amm',
    })
  }, [activeAddress, projectId, cashOutCount, reclaimToken, minReclaimed, previewOutcome])

  const hasWarnings = verificationResult.doubts.length > 0
  const hasCriticalDoubts = verificationResult.doubts.some((d) => d.severity === 'critical')
  const hasSafePreview = cashOutCount !== null && !!previewOutcome && previewOutcome.expectedReturn > 0n && previewOutcome.minimumReturn > 0n && !previewError
  const canProceed = hasGasBalance && !hasCriticalDoubts && (!hasWarnings || warningsAcknowledged) && hasSafePreview && !previewLoading && !!terminalAddress && !terminalLoading && !submitting

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('preview')
      setTxHash(null)
      setError(null)
      setWarningsAcknowledged(false)
      setTerminalAddress(null)
      setPreviewOutcome(null)
      setPreviewTaxRate(null)
      setPreviewError(null)
      inFlightRef.current = false
      setSubmitting(false)
    }
  }, [isOpen, projectId, chainId, reclaimToken, expectedTerminal])

  // Call parent callbacks when status changes (for persistence)
  useStatusCallbacks(status, txHash, error, onConfirmed, onError)

  // Fetch the project's terminal from JBDirectory
  useEffect(() => {
    if (!isOpen || !projectId || !chainId) {
      setTerminalAddress(null)
      return
    }

    const fetchTerminal = async () => {
      setTerminalLoading(true)
      try {
        const chain = CHAINS[chainId]
        if (!chain) {
          console.error('Unsupported chain for terminal lookup:', chainId)
          return
        }

        const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        })

        // Cash out returns the native token (or USDC based on currencySymbol)
        const terminal = await getPaymentTerminal(publicClient, chainId, BigInt(projectId), reclaimToken, 'accounting')
        if (terminal.address.toLowerCase() !== expectedTerminal.toLowerCase()) {
          throw new Error('The project accounting terminal changed. Close this review and try again.')
        }
        await assertCurrentProjectCashOutConfigurationTrusted({
          client: publicClient,
          projectId: BigInt(projectId),
        })
        setTerminalAddress(terminal.address)
      } catch (err) {
        console.error('Failed to fetch payment terminal:', err)
        setTerminalAddress(null)
        setError(err instanceof Error ? err.message : 'Failed to fetch payment terminal')
      } finally {
        setTerminalLoading(false)
      }
    }

    fetchTerminal()
  }, [isOpen, projectId, chainId, reclaimToken, expectedTerminal])

  // Read the exact hook-aware outcome, including beneficiary-specific protocol
  // fees and the buyback route metadata used by website's complete journey.
  useEffect(() => {
    if (!isOpen || !terminalAddress || !activeAddress || cashOutCount === null) {
      setPreviewOutcome(null)
      setPreviewTaxRate(null)
      setPreviewError(null)
      setPreviewLoading(false)
      return
    }

    let cancelled = false
    const fetchPreview = async () => {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        const chain = CHAINS[chainId]
        if (!chain) return
        const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
        const publicClient = createPublicClient({
          chain,
          transport: http(rpcUrl),
        })

        const result = await readCashOutPreviewOutcome({
          client: publicClient,
          terminal: terminalAddress,
          holder: activeAddress as Address,
          projectId: BigInt(projectId),
          cashOutCount,
          reclaimToken,
        })
        if (cancelled) return
        setPreviewOutcome(result.outcome)
        setPreviewTaxRate(Number(result.preview[2]))
      } catch (err) {
        if (cancelled) return
        setPreviewOutcome(null)
        setPreviewTaxRate(null)
        setPreviewError(err instanceof Error ? err.message : 'Cash out preview is unavailable. No transaction will be sent.')
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }

    fetchPreview()
    return () => {
      cancelled = true
    }
  }, [isOpen, terminalAddress, activeAddress, cashOutCount, chainId, projectId, reclaimToken, previewRevision])

  const handleConfirm = useCallback(async () => {
    // Check wallet connection based on mode
    const activeAddress = isManagedMode ? managedAddress : address
    if (isManagedMode) {
      if (!managedAddress) {
        setError('Managed wallet not available')
        return
      }
    } else {
      if (!walletClient || !address) {
        setError('Wallet not connected')
        return
      }
    }

    setError(null)

    const holder = activeAddress as Address
    const chain = CHAINS[chainId]

    if (!chain) {
      setError('Unsupported chain')
      setStatus('failed')
      return
    }

    if (!terminalAddress) {
      setError('Terminal address not available')
      setStatus('failed')
      return
    }

    // Acquire the in-flight lock immediately before the first await. A second
    // concurrent click returns here without entering the try (so it never
    // resets the lock), guaranteeing only one cash out can burn tokens.
    if (inFlightRef.current) return
    inFlightRef.current = true
    setSubmitting(true)

    try {
      assertCurrentAccount(isManagedMode ? undefined : walletClient?.account?.address)
      if (cashOutCount === null) throw new Error('Enter a valid token amount')
      const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
      if (!rpcUrl) throw new Error(`No RPC endpoint for chain ${chainId}`)
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      })
      const prepareCashOut = async () => {
        const freshTerminal = await getPaymentTerminal(publicClient, chainId, BigInt(projectId), reclaimToken, 'accounting')
        if (freshTerminal.address.toLowerCase() !== terminalAddress.toLowerCase()) {
          throw new Error('The project accounting terminal changed. Close this review and try again.')
        }
        await assertCurrentProjectCashOutConfigurationTrusted({
          client: publicClient,
          projectId: BigInt(projectId),
        })

        const reviewed = await readCashOutPreviewOutcome({
          client: publicClient,
          terminal: freshTerminal.address,
          holder,
          projectId: BigInt(projectId),
          cashOutCount,
          reclaimToken,
        })
        const cashOutTx = buildCashOutTx({
          chainId: chainId as JBChainId,
          terminal: freshTerminal.address,
          holder,
          projectId: BigInt(projectId),
          cashOutCount,
          tokenToReclaim: reclaimToken,
          minTokensReclaimed: reviewed.outcome.terminalMinimum,
          beneficiary: holder,
          metadata: reviewed.outcome.metadata,
        })
        const data = encodeFunctionData({ abi: cashOutTx.abi, functionName: cashOutTx.functionName, args: cashOutTx.args })
        await simulateTransaction({
          chainId,
          account: holder,
          to: freshTerminal.address,
          data,
        })
        return {
          target: freshTerminal.address,
          data,
          outcome: reviewed.outcome,
          quoteFingerprint: [
            reviewed.preview[0].id.toString(),
            reviewed.outcome.route,
            reviewed.outcome.expectedReturn.toString(),
            reviewed.outcome.minimumReturn.toString(),
            reviewed.outcome.metadata.toLowerCase(),
            ...reviewed.preview[3].map((specification) => [specification.hook.toLowerCase(), specification.noop, specification.amount.toString(), specification.metadata.toLowerCase()].join(':')),
          ].join('|'),
        }
      }
      const prepared = await prepareCashOut()
      if (
        !previewOutcome ||
        prepared.outcome.route !== previewOutcome.route ||
        prepared.outcome.expectedReturn !== previewOutcome.expectedReturn ||
        prepared.outcome.minimumReturn !== previewOutcome.minimumReturn ||
        prepared.outcome.metadata.toLowerCase() !== previewOutcome.metadata.toLowerCase()
      ) {
        setPreviewOutcome(prepared.outcome)
        setPreviewError('The cash out quote changed. Refreshing the review…')
        setPreviewRevision((revision) => revision + 1)
        return
      }

      const txId = addTransaction({
        type: 'cashout',
        projectId,
        chainId,
        amount: tokenAmount,
        status: 'pending',
      })

      let hash: string

      if (isManagedMode) {
        // Execute via backend for managed mode
        assertCurrentAccount()
        setStatus('pending')
        hash = await executeManagedTransaction(chainId, prepared.target, prepared.data, '0')
      } else {
        // Execute via wallet for self-custody mode
        setStatus('signing')
        await switchChainAsync({ chainId })
        if ((await walletClient!.getChainId()) !== chainId) {
          throw new Error(`Wallet did not switch to chain ${chainId}`)
        }
        const finalPrepared = await prepareCashOut()
        if (finalPrepared.target.toLowerCase() !== prepared.target.toLowerCase() || finalPrepared.quoteFingerprint !== prepared.quoteFingerprint) {
          throw new Error('The cash out quote changed. Close this review and try again.')
        }
        assertCurrentAccount(walletClient!.account?.address)
        hash = await walletClient!.sendTransaction({
          to: finalPrepared.target,
          data: finalPrepared.data,
          value: 0n,
        })
        setStatus('pending')
      }

      setTxHash(hash)
      updateTransaction(txId, { hash, status: 'submitted' })
      onSubmitted?.(hash)
      if (!isManagedMode) await waitForSuccessfulTransaction(chainId, hash as `0x${string}`)
      updateTransaction(txId, { hash, status: 'confirmed' })
      setStatus('confirmed')
    } catch (err) {
      console.error('Cash out failed:', err)
      setError(txErrorMessage(err, 'Transaction failed'))
      setStatus('failed')
    } finally {
      inFlightRef.current = false
      setSubmitting(false)
    }
  }, [
    walletClient,
    address,
    chainId,
    projectId,
    tokenAmount,
    cashOutCount,
    addTransaction,
    updateTransaction,
    switchChainAsync,
    isManagedMode,
    managedAddress,
    terminalAddress,
    reclaimToken,
    onSubmitted,
    assertCurrentAccount,
    previewOutcome,
  ])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={status === 'preview' || status === 'confirmed' || status === 'failed' ? onClose : undefined} />

      {/* Modal */}
      <div className={`relative w-full max-w-md border ${isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'}`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center text-xl ${isDark ? 'bg-juice-cyan/20' : 'bg-cyan-100'}`}>🔄</div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {status === 'confirmed' ? 'Cash Out Complete' : status === 'failed' ? 'Cash Out Failed' : 'Confirm Cash Out'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{chainName}</p>
            </div>
          </div>
          {(status === 'preview' || status === 'confirmed' || status === 'failed') && (
            <button onClick={onClose} className={`p-2 transition-colors ${isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Status Messages */}
          {status === 'signing' && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-juice-cyan border-t-transparent rounded-full" />
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Waiting for signature...</p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Check your wallet</p>
              </div>
            </div>
          )}

          {status === 'pending' && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-juice-cyan border-t-transparent rounded-full" />
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Transaction pending...</p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Confirming on {chainName}</p>
              </div>
            </div>
          )}

          {status === 'confirmed' && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-green-500/10' : 'bg-green-50'}`}>
              <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>Cash out successful</p>
                {txHash && (
                  <a href={`${chainInfo.explorerTx}${txHash}`} target="_blank" rel="noopener noreferrer" className="text-sm text-juice-cyan hover:underline">
                    View on explorer →
                  </a>
                )}
              </div>
            </div>
          )}

          {status === 'failed' && error && (
            <div className={`p-4 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              <p className={`font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>Transaction failed</p>
              <p className={`text-sm mt-1 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>{error}</p>
            </div>
          )}

          {/* Cash Out Details */}
          {(status === 'preview' || status === 'signing' || status === 'pending') && (
            <>
              {/* Project */}
              <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className={`text-xs uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Cashing out from</div>
                <div className={`font-semibold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>{projectName || `Project #${projectId}`}</div>
              </div>

              {/* Amount breakdown */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Burning</span>
                  <span className={`font-mono font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {tokenNum.toLocaleString()} {tokenSymbol}
                  </span>
                </div>

                {(previewTaxRate ?? cashOutTaxRate) > 0 && (
                  <div className="flex justify-between items-center">
                    <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Cash-out curve rate</span>
                    <span className={`font-mono ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>{((previewTaxRate ?? cashOutTaxRate) / 100).toFixed(2).replace(/\.?0+$/, '') || '0'}%</span>
                  </div>
                )}

                {displayedReturn != null && displayedReturn > 0 && (
                  <div className={`flex justify-between items-center pt-2 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                    <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>{previewOutcome?.route === 'amm' ? 'Buyback pool preview' : 'You receive'}</span>
                    <span className={`font-mono font-bold text-lg ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                      {displayedReturn.toFixed(returnDecimals)} {currencySymbol}
                    </span>
                  </div>
                )}
                {minimumReturnFloat != null && minimumReturnFloat > 0 && (
                  <div className="flex justify-between items-center">
                    <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Transaction minimum</span>
                    <span className={`font-mono ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {minimumReturnFloat.toFixed(returnDecimals)} {currencySymbol}
                    </span>
                  </div>
                )}
              </div>

              {displayedReturn != null && displayedReturn > 0 && (
                <div className={`p-3 text-xs ${isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
                  {previewOutcome?.route === 'amm'
                    ? 'The recognized buyback hook routes this cash out through its pool because it beats the treasury return. Its on-chain metadata enforces the minimum shown.'
                    : `This is the exact preview after the current protocol fee${
                        previewOutcome?.treasuryProtocolFee ? ` (${formatUnits(previewOutcome.treasuryProtocolFee, reclaimTokenDecimals)} ${currencySymbol})` : ''
                      }. The transaction reverts below the minimum shown.`}
                </div>
              )}

              {/* Gas balance check */}
              <GasBalanceStatus balance={chainGasBalance} hasGasBalance={hasGasBalance} loading={balancesLoading} available={balancesAvailable} managed={isManagedMode} isDark={isDark} />

              <div className={`p-3 text-sm ${isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
                Your tokens will be burned. The return comes from the live terminal quote for the active cash-out curve and hooks.
              </div>

              {/* Transaction Summary */}
              <TransactionSummary
                type="cashOut"
                details={{
                  projectId,
                  projectName,
                  tokens: tokenNum.toString(),
                  tokensFormatted: `${tokenNum.toLocaleString()} ${tokenSymbol}`,
                  previewReturnFormatted: displayedReturn != null ? `${displayedReturn.toFixed(returnDecimals)} ${currencySymbol}` : undefined,
                  minimumReturnFormatted: minimumReturnFloat != null ? `${minimumReturnFloat.toFixed(returnDecimals)} ${currencySymbol}` : undefined,
                  taxRate: previewTaxRate ?? cashOutTaxRate,
                  currency: currencySymbol,
                }}
                isDark={isDark}
              />

              {/* Transaction Warning */}
              {hasWarnings && <TransactionWarning doubts={verificationResult.doubts} onConfirm={() => setWarningsAcknowledged(true)} onCancel={onClose} isDark={isDark} />}

              {/* Terminal loading indicator */}
              {terminalLoading && (
                <div className={`p-3 text-sm flex items-center gap-2 ${isDark ? 'bg-juice-cyan/10 text-juice-cyan' : 'bg-cyan-50 text-cyan-700'}`}>
                  <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  Fetching payment terminal...
                </div>
              )}

              {previewLoading && (
                <div className={`p-3 text-sm flex items-center gap-2 ${isDark ? 'bg-juice-cyan/10 text-juice-cyan' : 'bg-cyan-50 text-cyan-700'}`}>
                  <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  Checking the current cash out value...
                </div>
              )}

              {previewError && !previewLoading && <div className={`p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-700'}`}>{previewError}</div>}

              {/* Technical Details */}
              <TechnicalDetails
                contract="JB_MULTI_TERMINAL"
                contractAddress={terminalAddress || '0x0000000000000000000000000000000000000000'}
                functionName="cashOutTokensOf"
                chainId={chainId}
                chainName={chainName}
                projectId={projectId}
                parameters={verificationResult.verifiedParams}
                isDark={isDark}
              />
            </>
          )}

          {/* Summary (for confirmed) */}
          {status === 'confirmed' && (
            <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Burned</span>
                  <span className={`font-mono ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                    -{tokenNum.toLocaleString()} {tokenSymbol}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`px-5 py-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          {status === 'preview' && (
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className={`flex-1 py-3 font-medium border-2 transition-colors ${isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!canProceed}
                className="flex-1 py-3 font-bold bg-juice-cyan text-black hover:bg-juice-cyan/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm Cash Out
              </button>
            </div>
          )}

          {(status === 'signing' || status === 'pending') && <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Do not close this window</div>}

          {(status === 'confirmed' || status === 'failed') && (
            <button onClick={onClose} className="w-full py-3 font-medium bg-juice-cyan text-black hover:bg-juice-cyan/90 transition-colors">
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
