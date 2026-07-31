import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { parseUnits, formatUnits, encodeFunctionData, createPublicClient, http, erc20Abi, type Hex, type Address, type Chain, type PublicClient } from 'viem'
import {
  buildPermit2ApproveTx,
  buildUniswapV4ExactInputSwapTx,
  cashOutPoolBufferBps,
  chooseBestCashOutRoute,
  prepareHookAwareCashOut,
  quoteUniswapV4ExactInputSingle,
  uniswapV4Deployment,
  uniswapV4SwapDirection,
  type BestCashOutRoute,
  type CashOutPreviewSnapshot,
} from '@bananapus/nana-sdk-core/v6'
import { type JBChainId } from '@bananapus/nana-sdk-core'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, useManagedWallet } from '../../hooks'
import { useGuardedTx } from '../../hooks/useGuardedTx'
import { useReviewedTransactionAccount } from '../../hooks/useReviewedTransactionAccount'
import { txErrorMessage } from '../../utils/txErrors'
import { GasBalanceStatus } from './GasBalanceStatus'
import { useStatusCallbacks } from './modalHooks'
import { ALL_VIEM_CHAINS, CHAINS as CHAIN_INFO, JB_BUYBACK_HOOK, JB_CONTRACTS, MAINNET_CHAINS, RPC_ENDPOINTS } from '../../constants'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifyCashOutParams } from '../../utils/transactionVerification'
import { getPaymentTerminal } from '../../utils/paymentTerminal'
import { simulateTransaction } from '../../utils/transactionSafety'
import { assertCurrentProjectCashOutConfigurationTrusted, requireRecognizedRuntimeHook } from '../../utils/projectTrust'
import { type CashOutPreviewOutcome } from '../../utils/terminalPreview'
import { readPoolState, PERMIT2_ADDRESS } from '../../services/ammMarket'
import DialogShell from '../ui/DialogShell'

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

const PERMIT2_ALLOWANCE_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
  },
] as const

// viem chain objects for wallet operations
const CHAINS: Record<number, Chain> = ALL_VIEM_CHAINS

// Max-slippage presets for the preview floor (basis points), juicescan-style.
const SLIPPAGE_PRESETS: { label: string; bps: bigint }[] = [
  { label: '0.5%', bps: 50n },
  { label: '1%', bps: 100n },
  { label: '3%', bps: 300n },
]
const DEFAULT_SLIPPAGE_BPS = 100n

function bestRouteFingerprint(route: BestCashOutRoute): string {
  const common = [
    route.kind,
    route.expectedReturn.toString(),
    route.minimumReturn.toString(),
  ]
  if (route.kind === 'cash-out') {
    return [...common, route.cashOut.route, route.cashOut.metadata.toLowerCase()].join('|')
  }
  return [
    ...common,
    route.poolKey.currency0.toLowerCase(),
    route.poolKey.currency1.toLowerCase(),
    route.poolKey.fee.toString(),
    route.poolKey.tickSpacing.toString(),
    route.poolKey.hooks.toLowerCase(),
    route.zeroForOne,
  ].join('|')
}

async function readCashOutPreviewOutcome(params: { client: PublicClient; chainId: JBChainId; terminal: Address; holder: Address; projectId: bigint; cashOutCount: bigint; reclaimToken: Address; slippageBps: bigint }) {
  const beneficiaryIsFeeless = await params.client.readContract({
    address: JB_CONTRACTS.JBFeelessAddresses,
    abi: FEELESS_ADDRESSES_ABI,
    functionName: 'isFeelessFor',
    args: [params.holder, params.projectId, params.holder],
  })
  const prepared = await prepareHookAwareCashOut(params.client, {
    chainId: params.chainId,
    terminal: params.terminal,
    holder: params.holder,
    projectId: params.projectId,
    cashOutCount: params.cashOutCount,
    tokenToReclaim: params.reclaimToken,
    beneficiary: params.holder,
    buybackHookAddress: JB_BUYBACK_HOOK,
    beneficiaryIsFeeless,
    slippageBps: params.slippageBps,
  })
  const validateHooks = async (preview: CashOutPreviewSnapshot) => {
    if (preview.rulesetId === null) throw new Error('Cash out preview returned no ruleset id')
    for (const specification of preview.hookSpecifications) {
      if (!specification.noop) {
        await requireRecognizedRuntimeHook({
          client: params.client,
          projectId: params.projectId,
          rulesetId: preview.rulesetId,
          hook: specification.hook,
        })
      }
    }
  }
  await validateHooks(prepared.preview)
  if (prepared.lockedPreview) await validateHooks(prepared.lockedPreview)
  if (prepared.route.expectedReturn <= 0n || prepared.route.minimumReturn <= 0n) {
    throw new Error('No funds are currently reclaimable for this cash out')
  }
  return { preview: prepared.preview, outcome: prepared.route, prepared }
}

async function readBestCashOutPreview(params: {
  client: PublicClient
  chainId: JBChainId
  terminal: Address
  holder: Address
  projectId: bigint
  cashOutCount: bigint
  reclaimToken: Address
  slippageBps: bigint
}) {
  const terminal = await readCashOutPreviewOutcome(params)
  let best: BestCashOutRoute = chooseBestCashOutRoute({
    cashOut: terminal.outcome,
    cashOutCount: params.cashOutCount,
    slippageBps: params.slippageBps,
  })
  let directProjectToken: Address | null = null
  // Direct-sale discovery is an optional optimization. Any pool, token, or
  // quoter read failure must fail closed to the already verified terminal
  // route instead of making an otherwise valid cash out unavailable.
  try {
    const pool = await readPoolState(params.chainId, params.projectId)
    if (pool) {
      const projectToken = pool.projectToken
      const zeroForOne = uniswapV4SwapDirection({
        poolKey: pool.key,
        tokenIn: projectToken,
        tokenOut: params.reclaimToken,
      })
      if (zeroForOne !== null) {
        const claimedBalance = await params.client.readContract({
          address: projectToken,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [params.holder],
        })
        if (claimedBalance >= params.cashOutCount) {
          const directSwapQuote = await quoteUniswapV4ExactInputSingle(params.client, {
            chainId: params.chainId,
            poolKey: pool.key,
            zeroForOne,
            amountIn: params.cashOutCount,
          })
          best = chooseBestCashOutRoute({
            cashOut: terminal.outcome,
            directSwapQuote,
            directSwapPoolKey: pool.key,
            directSwapZeroForOne: zeroForOne,
            spendableProjectTokenCount: claimedBalance,
            cashOutCount: params.cashOutCount,
            slippageBps: params.slippageBps,
          })
          if (best.kind === 'direct-swap') directProjectToken = projectToken
        }
      }
    }
  } catch (error) {
    console.warn('Direct cash-out swap preview unavailable; using the terminal route.', error)
  }
  return { ...terminal, best, directProjectToken }
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
  const { addTransaction, updateTransaction } = useTransactionStore()
  const { perChain, loading: balancesLoading, available: balancesAvailable } = useWalletBalances()

  // Managed mode support
  const { mode, isAuthenticated } = useAuthStore()
  const isManagedMode = mode === 'managed' && isAuthenticated()
  const { address: managedAddress } = useManagedWallet()
  const guarded = useGuardedTx()

  const [status, setStatus] = useState<CashOutStatus>('preview')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const [terminalAddress, setTerminalAddress] = useState<Address | null>(null)
  const [terminalLoading, setTerminalLoading] = useState(false)
  // Slippage floor + fee info sourced from the contract's previewCashOutFrom.
  // A cash out is never submitted without a positive, current preview.
  const [previewOutcome, setPreviewOutcome] = useState<CashOutPreviewOutcome | null>(null)
  const [bestRoute, setBestRoute] = useState<BestCashOutRoute | null>(null)
  const [previewTaxRate, setPreviewTaxRate] = useState<number | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewRevision, setPreviewRevision] = useState(0)
  // User-selected max slippage for the preview floor. Changing it re-runs the
  // preview (same invalidation path as changing the amount), so the quote the
  // user reviews and the locked-in re-preview always share one tolerance.
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS)
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
  const hasGasBalance = isManagedMode || guarded.isSafeMode || (balancesAvailable && chainGasBalance > 0n)

  const minReclaimed = previewOutcome?.terminalMinimum ?? 0n
  const previewReturnFloat = bestRoute ? Number(formatUnits(bestRoute.expectedReturn, reclaimTokenDecimals)) : null
  const minimumReturnFloat = bestRoute && bestRoute.minimumReturn > 0n ? Number(formatUnits(bestRoute.minimumReturn, reclaimTokenDecimals)) : null
  const displayedReturn = previewReturnFloat
  const returnDecimals = reclaimTokenDecimals <= 6 ? 2 : 4
  const directSwapSelected = bestRoute?.kind === 'direct-swap'
  const poolBufferBps = cashOutPoolBufferBps(previewOutcome)

  // Verify transaction parameters
  const activeAddress = guarded.activeAddress
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
  const hasSafePreview = cashOutCount !== null && !!bestRoute && bestRoute.expectedReturn > 0n && bestRoute.minimumReturn > 0n && !previewError
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
      setBestRoute(null)
      setPreviewTaxRate(null)
      setPreviewError(null)
      setSlippageBps(DEFAULT_SLIPPAGE_BPS)
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
      setBestRoute(null)
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

        const result = await readBestCashOutPreview({
          client: publicClient,
          chainId: chainId as JBChainId,
          terminal: terminalAddress,
          holder: activeAddress as Address,
          projectId: BigInt(projectId),
          cashOutCount,
          reclaimToken,
          slippageBps,
        })
        if (cancelled) return
        setPreviewOutcome(result.outcome)
        setBestRoute(result.best)
        setPreviewTaxRate(Number(result.preview.cashOutTaxRate))
      } catch (err) {
        if (cancelled) return
        setPreviewOutcome(null)
        setBestRoute(null)
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
  }, [isOpen, terminalAddress, activeAddress, cashOutCount, chainId, projectId, reclaimToken, slippageBps, previewRevision])

  const handleConfirm = useCallback(async () => {
    // Check wallet connection based on mode
    const activeAddress = guarded.activeAddress
    if (guarded.isSafeMode) {
      if (!activeAddress) throw new Error('Safe not connected')
    } else if (isManagedMode) {
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
      if (!guarded.isSafeMode) assertCurrentAccount(isManagedMode ? undefined : walletClient?.account?.address)
      if (cashOutCount === null) throw new Error('Enter a valid token amount')
      const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
      if (!rpcUrl) throw new Error(`No RPC endpoint for chain ${chainId}`)
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      })
      const directSwapDeadline = BigInt(Math.floor(Date.now() / 1000) + 1_800)
      const prepareCashOut = async () => {
        const freshTerminal = await getPaymentTerminal(publicClient, chainId, BigInt(projectId), reclaimToken, 'accounting')
        if (freshTerminal.address.toLowerCase() !== terminalAddress.toLowerCase()) {
          throw new Error('The project accounting terminal changed. Close this review and try again.')
        }
        await assertCurrentProjectCashOutConfigurationTrusted({
          client: publicClient,
          projectId: BigInt(projectId),
        })

        const reviewed = await readBestCashOutPreview({
          client: publicClient,
          chainId: chainId as JBChainId,
          terminal: freshTerminal.address,
          holder,
          projectId: BigInt(projectId),
          cashOutCount,
          reclaimToken,
          slippageBps,
        })
        const transaction = reviewed.best.kind === 'direct-swap'
          ? buildUniswapV4ExactInputSwapTx({
              chainId: chainId as JBChainId,
              poolKey: reviewed.best.poolKey,
              zeroForOne: reviewed.best.zeroForOne,
              amountIn: cashOutCount,
              minimumAmountOut: reviewed.best.minimumReturn,
              recipient: holder,
              deadline: directSwapDeadline,
            })
          : reviewed.prepared.transaction
        const data = encodeFunctionData({ abi: transaction.abi, functionName: transaction.functionName, args: transaction.args })
        // Terminal cash-outs can be simulated immediately. Direct swaps may
        // still need ERC-20/Permit2 authorization, so the guarded runner
        // simulates them after those approvals instead.
        if (reviewed.best.kind === 'cash-out') {
          await simulateTransaction({
            chainId,
            account: holder,
            to: transaction.address,
            data,
            value: 0n,
          })
        }
        return {
          target: transaction.address,
          data,
          value: 'value' in transaction ? transaction.value : 0n,
          review: {
            abi: transaction.abi,
            functionName: transaction.functionName,
            args: transaction.args,
          },
          outcome: reviewed.best,
          terminalOutcome: reviewed.outcome,
          directProjectToken: reviewed.directProjectToken,
          quoteFingerprint: [
            reviewed.preview.rulesetId?.toString() ?? 'unknown',
            bestRouteFingerprint(reviewed.best),
            ...reviewed.preview.hookSpecifications.map((specification) => [specification.hook.toLowerCase(), specification.noop, specification.amount.toString(), specification.metadata.toLowerCase()].join(':')),
          ].join('|'),
        }
      }
      const prepared = await prepareCashOut()
      if (
        !bestRoute ||
        bestRouteFingerprint(prepared.outcome) !== bestRouteFingerprint(bestRoute)
      ) {
        setPreviewOutcome(prepared.terminalOutcome)
        setBestRoute(prepared.outcome)
        setPreviewError('The cash out quote changed. Refreshing the review…')
        setPreviewRevision((revision) => revision + 1)
        return
      }

      if (prepared.outcome.kind === 'direct-swap') {
        if (!prepared.directProjectToken) throw new Error('The direct pool token is unavailable')
        const deployment = uniswapV4Deployment(chainId)
        if (!deployment?.universalRouter) throw new Error('The direct swap router is unavailable')
        const [permitAmount, permitExpiration] = await publicClient.readContract({
          address: PERMIT2_ADDRESS,
          abi: PERMIT2_ALLOWANCE_ABI,
          functionName: 'allowance',
          args: [holder, prepared.directProjectToken, deployment.universalRouter],
        })
        if (permitAmount < cashOutCount || Number(permitExpiration) <= Math.floor(Date.now() / 1000) + 1_800) {
          const permit = buildPermit2ApproveTx({
            chainId: chainId as JBChainId,
            token: prepared.directProjectToken,
            amount: cashOutCount,
            expiration: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          })
          await guarded.run({
            chainId,
            to: permit.address,
            data: encodeFunctionData({ abi: permit.abi, functionName: permit.functionName, args: permit.args }),
            approval: { token: prepared.directProjectToken, spender: PERMIT2_ADDRESS, amount: cashOutCount },
            review: {
              title: 'Review swap authorization',
              label: 'Authorize the direct pool sale for this exact token amount',
              contractName: 'Permit2',
              abi: permit.abi,
              functionName: permit.functionName,
              args: permit.args,
            },
            onPhase: phase => setStatus(phase === 'signing' ? 'signing' : 'pending'),
          })
        }
      }

      const txId = addTransaction({
        type: 'cashout',
        projectId,
        chainId,
        amount: tokenAmount,
        status: 'pending',
      })

      const hash = await guarded.run({
        chainId,
        to: prepared.target,
        data: prepared.data,
        value: prepared.value,
        approval: prepared.outcome.kind === 'direct-swap' && prepared.directProjectToken
          ? { token: prepared.directProjectToken, spender: PERMIT2_ADDRESS, amount: cashOutCount }
          : undefined,
        activityId: txId,
        review: {
          title: prepared.outcome.kind === 'direct-swap' ? 'Review direct pool sale' : 'Review cash out',
          label: prepared.outcome.kind === 'direct-swap'
            ? `Sell ${tokenAmount} claimed project tokens through the better pool route`
            : `Cash out ${tokenAmount} project tokens for the reviewed minimum`,
          contractName: prepared.outcome.kind === 'direct-swap' ? 'Uniswap Universal Router' : 'JBMultiTerminal',
          ...prepared.review,
        },
        reverify: async () => {
          const finalPrepared = await prepareCashOut()
          if (
            finalPrepared.target.toLowerCase() !== prepared.target.toLowerCase() ||
            finalPrepared.quoteFingerprint !== prepared.quoteFingerprint ||
            finalPrepared.data.toLowerCase() !== prepared.data.toLowerCase() ||
            finalPrepared.value !== prepared.value
          ) {
            throw new Error('The cash out quote changed. Close this review and try again.')
          }
        },
        onPhase: phase => setStatus(phase === 'signing' ? 'signing' : 'pending'),
        onSubmitted: submittedHash => {
          setTxHash(submittedHash)
          onSubmitted?.(submittedHash)
        },
      })

      setTxHash(hash)
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
    isManagedMode,
    managedAddress,
    terminalAddress,
    reclaimToken,
    onSubmitted,
    assertCurrentAccount,
    bestRoute,
    slippageBps,
    guarded,
  ])

  if (!isOpen) return null

  return (
    <DialogShell isOpen onClose={onClose} dismissible={status === 'preview' || status === 'confirmed' || status === 'failed'} labelledBy="cash-out-modal-title">
      <div className={`relative w-full max-w-md border ${isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'}`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center text-xl ${isDark ? 'bg-juice-cyan/20' : 'bg-cyan-100'}`}>🔄</div>
            <div>
              <h2 id="cash-out-modal-title" className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
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
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>{directSwapSelected ? 'Selling' : 'Burning'}</span>
                  <span className={`font-mono font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {tokenNum.toLocaleString()} {tokenSymbol}
                  </span>
                </div>

                {!directSwapSelected && (previewTaxRate ?? cashOutTaxRate) > 0 && (
                  <div className="flex justify-between items-center">
                    <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Cash-out curve rate</span>
                    <span className={`font-mono ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>{((previewTaxRate ?? cashOutTaxRate) / 100).toFixed(2).replace(/\.?0+$/, '') || '0'}%</span>
                  </div>
                )}

                {displayedReturn != null && displayedReturn > 0 && (
                  <div className={`flex justify-between items-center pt-2 border-t ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
                    <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {directSwapSelected ? 'Direct pool sale' : previewOutcome?.route === 'amm' ? 'Buyback pool preview' : 'You receive'}
                    </span>
                    <span className={`font-mono font-bold text-lg ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                      {displayedReturn.toFixed(returnDecimals)} {currencySymbol}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Max slippage</span>
                  <div className="flex items-center gap-1">
                    {SLIPPAGE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => setSlippageBps(preset.bps)}
                        disabled={submitting}
                        className={`px-2 py-1 text-xs font-mono border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          slippageBps === preset.bps
                            ? 'bg-juice-cyan border-juice-cyan text-black font-bold'
                            : isDark
                              ? 'border-white/20 text-gray-300 hover:bg-white/10'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                    <label className={`flex h-[30px] w-[64px] items-center border px-1.5 text-xs font-mono ${isDark ? 'border-white/20 text-gray-300' : 'border-gray-200 text-gray-600'}`}>
                      <span className="sr-only">Custom max slippage percent</span>
                      <input
                        type="number"
                        min="0"
                        max="99.99"
                        step="0.1"
                        inputMode="decimal"
                        value={Number(slippageBps) / 100}
                        onChange={(event) => {
                          const percent = Number(event.target.value)
                          if (Number.isFinite(percent) && percent >= 0 && percent < 100) {
                            setSlippageBps(BigInt(Math.round(percent * 100)))
                          }
                        }}
                        disabled={submitting}
                        className="min-w-0 flex-1 bg-transparent text-right outline-none"
                      />
                      <span>%</span>
                    </label>
                  </div>
                </div>
                {!directSwapSelected && previewOutcome?.route === 'amm' && poolBufferBps !== null && (
                  <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    The pool preview already allows about {(Number(poolBufferBps) / 100).toFixed(2).replace(/\.00$/, '')}% for its fee and price impact. Your setting additionally covers movement before inclusion.
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
                  {directSwapSelected
                    ? 'Your claimed project ERC-20s are sold directly through the better live pool route. This bypasses the terminal and its cash-out fee; internal credits remain eligible only for the terminal route.'
                    : previewOutcome?.route === 'amm'
                    ? 'The recognized buyback hook routes this cash out through its pool because it beats the treasury return. Its on-chain metadata enforces the minimum shown.'
                    : `This is the exact preview after the current protocol fee${
                        previewOutcome?.treasuryProtocolFee ? ` (${formatUnits(previewOutcome.treasuryProtocolFee, reclaimTokenDecimals)} ${currencySymbol})` : ''
                      }. The transaction reverts below the minimum shown.`}
                </div>
              )}

              {/* Gas balance check */}
              <GasBalanceStatus balance={chainGasBalance} hasGasBalance={hasGasBalance} loading={balancesLoading} available={balancesAvailable} managed={isManagedMode} isDark={isDark} />

              <div className={`p-3 text-sm ${isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
                {directSwapSelected
                  ? 'Your claimed tokens will be sold through the live pool. The transaction reverts if the pool cannot meet the reviewed minimum.'
                  : 'Your tokens will be burned. The return comes from the live terminal quote for the active cash-out curve and hooks.'}
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
                contract={directSwapSelected ? 'UNISWAP_UNIVERSAL_ROUTER' : 'JB_MULTI_TERMINAL'}
                contractAddress={directSwapSelected ? (uniswapV4Deployment(chainId)?.universalRouter ?? '0x0000000000000000000000000000000000000000') : (terminalAddress || '0x0000000000000000000000000000000000000000')}
                functionName={directSwapSelected ? 'execute' : 'cashOutTokensOf'}
                chainId={chainId}
                chainName={chainName}
                projectId={projectId}
                parameters={directSwapSelected && bestRoute?.kind === 'direct-swap'
                  ? {
                      amountIn: cashOutCount ?? 0n,
                      minimumAmountOut: bestRoute.minimumReturn,
                      currency0: bestRoute.poolKey.currency0,
                      currency1: bestRoute.poolKey.currency1,
                    }
                  : verificationResult.verifiedParams}
                isDark={isDark}
              />
            </>
          )}

          {/* Summary (for confirmed) */}
          {status === 'confirmed' && (
            <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>{directSwapSelected ? 'Sold' : 'Burned'}</span>
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
                {directSwapSelected ? 'Sell on Pool' : 'Confirm Cash Out'}
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
    </DialogShell>
  )
}
