import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { parseUnits, formatUnits, encodeFunctionData, createPublicClient, http, type Hex, type Address, type Chain } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useThemeStore, useTransactionStore, useAuthStore } from '../../stores'
import { useWalletBalances, formatEthBalance, executeManagedTransaction, useManagedWallet } from '../../hooks'
import { CHAINS as CHAIN_INFO, MAINNET_CHAINS, RPC_ENDPOINTS } from '../../constants'
import TechnicalDetails from '../shared/TechnicalDetails'
import TransactionSummary from '../shared/TransactionSummary'
import TransactionWarning from '../shared/TransactionWarning'
import { verifyCashOutParams } from '../../utils/transactionVerification'
import { getPaymentTerminal, getPaymentTokenAddress } from '../../utils/paymentTerminal'

const TERMINAL_CASH_OUT_ABI = [
  {
    name: 'cashOutTokensOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'holder', type: 'address' },
      { name: 'projectId', type: 'uint256' },
      { name: 'cashOutCount', type: 'uint256' },
      { name: 'tokenToReclaim', type: 'address' },
      { name: 'minTokensReclaimed', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [{ name: 'reclaimAmount', type: 'uint256' }],
  },
  // JBMultiTerminal.previewCashOutFrom — the contract's exact reclaim preview
  // (hook-aware, net of any data-hook fee, BEFORE the 2.5% protocol fee). Used to
  // set the slippage floor from contract truth rather than a client estimate, and
  // to surface the on-chain cash out tax rate for the fee note.
  {
    name: 'previewCashOutFrom',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'holder', type: 'address' },
      { name: 'projectId', type: 'uint256' },
      { name: 'cashOutCount', type: 'uint256' },
      { name: 'tokenToReclaim', type: 'address' },
      { name: 'beneficiary', type: 'address' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [
      {
        name: 'ruleset',
        type: 'tuple',
        components: [
          { name: 'cycleNumber', type: 'uint256' },
          { name: 'id', type: 'uint256' },
          { name: 'basedOnId', type: 'uint256' },
          { name: 'start', type: 'uint256' },
          { name: 'duration', type: 'uint256' },
          { name: 'weight', type: 'uint256' },
          { name: 'weightCutPercent', type: 'uint256' },
          { name: 'approvalHook', type: 'address' },
          { name: 'metadata', type: 'uint256' },
        ],
      },
      { name: 'reclaimAmount', type: 'uint256' },
      { name: 'cashOutTaxRate', type: 'uint256' },
      {
        name: 'hookSpecifications',
        type: 'tuple[]',
        components: [
          { name: 'hook', type: 'address' },
          { name: 'noop', type: 'bool' },
          { name: 'amount', type: 'uint256' },
          { name: 'metadata', type: 'bytes' },
        ],
      },
    ],
  },
] as const

// viem chain objects for wallet operations
const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
}

interface CashOutModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName?: string
  chainId: number
  tokenAmount: string
  tokenSymbol?: string
  estimatedReturn?: number
  cashOutTaxRate?: number
  /** Currency symbol for the return amount - 'ETH' or 'USDC'. Defaults to 'ETH' */
  currencySymbol?: 'ETH' | 'USDC'
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
  estimatedReturn = 0,
  cashOutTaxRate = 0,
  currencySymbol = 'ETH',
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
  const { totalEth } = useWalletBalances()

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
  // minReclaimed is expressed in the RECLAIM TOKEN's own decimals (6 for USDC,
  // 18 for ETH) — it is 95% of the previewed reclaim. 0n falls back to "no floor"
  // (e.g. a cash-out delay makes the preview revert) so the tx stays submittable.
  const [minReclaimed, setMinReclaimed] = useState<bigint>(0n)
  const [previewReclaim, setPreviewReclaim] = useState<bigint | null>(null)
  const [previewTaxRate, setPreviewTaxRate] = useState<number | null>(null)

  // The token cash outs reclaim: native ETH or the chain's USDC. NOT always ETH.
  const reclaimToken = useMemo(() => getPaymentTokenAddress(currencySymbol, chainId), [currencySymbol, chainId])
  const terminalDecimals = currencySymbol === 'USDC' ? 6 : 18

  const chainInfo = CHAIN_INFO[chainId] || MAINNET_CHAINS[chainId] || MAINNET_CHAINS[1]
  const chainName = chainInfo.name
  const tokenNum = parseFloat(tokenAmount) || 0
  const taxPercent = cashOutTaxRate / 100
  const hasGasBalance = totalEth >= 0.001

  // A 2.5% protocol fee is taken from cash outs whenever the ruleset cash out tax
  // rate is non-zero (unless the beneficiary is feeless). The previewed/displayed
  // amount is BEFORE that fee, so surface the fee and an after-fee estimate.
  // Prefer the on-chain tax rate from previewCashOutFrom; fall back to the prop.
  const PROTOCOL_FEE = 0.025
  const feeApplies = (previewTaxRate ?? cashOutTaxRate) > 0
  const previewReclaimFloat = previewReclaim != null ? Number(formatUnits(previewReclaim, terminalDecimals)) : null
  // Gross reclaim (before protocol fee): contract preview when available, else the client estimate.
  const grossReturn = previewReclaimFloat ?? (estimatedReturn > 0 ? estimatedReturn : null)
  const netReturn = grossReturn != null && feeApplies ? grossReturn * (1 - PROTOCOL_FEE) : grossReturn
  const returnDecimals = currencySymbol === 'USDC' ? 2 : 4

  // Verify transaction parameters
  const activeAddress = isManagedMode ? managedAddress : address
  const verificationResult = useMemo(() => {
    const holderAddress = activeAddress || '0x0000000000000000000000000000000000000000'
    return verifyCashOutParams({
      holder: holderAddress,
      projectId: BigInt(projectId),
      cashOutCount: parseUnits(tokenAmount || '0', 18),
      tokenToReclaim: reclaimToken,
      minTokensReclaimed: minReclaimed,
      beneficiary: holderAddress,
      metadata: '0x' as Hex,
    })
  }, [activeAddress, projectId, tokenAmount, reclaimToken, minReclaimed])

  const hasWarnings = verificationResult.doubts.length > 0
  const canProceed = hasGasBalance && (!hasWarnings || warningsAcknowledged) && !!terminalAddress && !terminalLoading

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStatus('preview')
      setTxHash(null)
      setError(null)
      setWarningsAcknowledged(false)
    }
  }, [isOpen])

  // Call parent callbacks when status changes (for persistence)
  useEffect(() => {
    if (status === 'confirmed' && txHash) {
      onConfirmed?.(txHash)
    } else if (status === 'failed' && error) {
      onError?.(error)
    }
  }, [status, txHash, error, onConfirmed, onError])

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
        const terminal = await getPaymentTerminal(publicClient, chainId, BigInt(projectId), reclaimToken)
        setTerminalAddress(terminal.address)
      } catch (err) {
        console.error('Failed to fetch payment terminal:', err)
        setError('Failed to fetch payment terminal')
      } finally {
        setTerminalLoading(false)
      }
    }

    fetchTerminal()
  }, [isOpen, projectId, chainId, currencySymbol, reclaimToken])

  // Read the contract's exact reclaim preview to set the slippage floor and to
  // surface the on-chain cash out tax rate. The preview is hook-aware and in the
  // reclaim token's decimals, so 95% of it is a correct min in those same decimals.
  useEffect(() => {
    if (!isOpen || !terminalAddress || !activeAddress || tokenNum <= 0 || !tokenAmount) {
      setMinReclaimed(0n)
      setPreviewReclaim(null)
      setPreviewTaxRate(null)
      return
    }

    let cancelled = false
    const fetchPreview = async () => {
      try {
        const chain = CHAINS[chainId]
        if (!chain) return
        const rpcUrl = RPC_ENDPOINTS[chainId]?.[0]
        const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

        const cashOutCount = parseUnits(tokenAmount, 18)
        const result = await publicClient.readContract({
          address: terminalAddress,
          abi: TERMINAL_CASH_OUT_ABI,
          functionName: 'previewCashOutFrom',
          args: [
            activeAddress as Address,
            BigInt(projectId),
            cashOutCount,
            reclaimToken,
            activeAddress as Address,
            '0x' as Hex,
          ],
        })
        if (cancelled) return

        const reclaim = result[1] as bigint
        const taxRate = Number(result[2])
        setPreviewReclaim(reclaim)
        setPreviewTaxRate(taxRate)
        // 95% floor covers the 2.5% protocol fee plus ~2.5% tolerance. A near-zero
        // reclaim (surplus drained / MEV) then reverts instead of silently draining.
        setMinReclaimed(reclaim > 0n ? (reclaim * 95n) / 100n : 0n)
      } catch {
        // Cash-out delay active or read failed → no floor so the tx stays submittable.
        if (cancelled) return
        setMinReclaimed(0n)
        setPreviewReclaim(null)
        setPreviewTaxRate(null)
      }
    }

    fetchPreview()
    return () => {
      cancelled = true
    }
  }, [isOpen, terminalAddress, activeAddress, tokenAmount, tokenNum, chainId, projectId, reclaimToken])

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

    setStatus('signing')
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

    try {
      // Create transaction record
      const txId = addTransaction({
        type: 'cashout',
        projectId,
        chainId,
        amount: tokenAmount,
        status: 'pending',
      })

      // Tokens typically have 18 decimals
      const cashOutCount = parseUnits(tokenAmount, 18)

      const callData = encodeFunctionData({
        abi: TERMINAL_CASH_OUT_ABI,
        functionName: 'cashOutTokensOf',
        args: [
          holder,
          BigInt(projectId),
          cashOutCount,
          reclaimToken, // native ETH or USDC — matches the terminal's accounting token
          minReclaimed, // slippage floor from previewCashOutFrom (0 if preview unavailable)
          holder, // beneficiary
          '0x' as Hex,
        ],
      })

      setStatus('pending')

      let hash: string

      if (isManagedMode) {
        // Execute via backend for managed mode
        hash = await executeManagedTransaction(chainId, terminalAddress, callData, '0')
      } else {
        // Execute via wallet for self-custody mode
        await switchChainAsync({ chainId })
        hash = await walletClient!.sendTransaction({
          to: terminalAddress,
          data: callData,
          value: 0n,
        })
      }

      setTxHash(hash)
      updateTransaction(txId, { hash, status: 'submitted' })
      setStatus('confirmed')
    } catch (err) {
      console.error('Cash out failed:', err)
      setError(err instanceof Error ? err.message : 'Transaction failed')
      setStatus('failed')
    }
  }, [walletClient, address, chainId, projectId, tokenAmount, addTransaction, updateTransaction, switchChainAsync, isManagedMode, managedAddress, terminalAddress, reclaimToken, minReclaimed])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={status === 'preview' || status === 'confirmed' || status === 'failed' ? onClose : undefined}
      />

      {/* Modal */}
      <div className={`relative w-full max-w-md border ${
        isDark ? 'bg-juice-dark border-white/10' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-center justify-between ${
          isDark ? 'border-white/10' : 'border-gray-100'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center text-xl ${
              isDark ? 'bg-juice-cyan/20' : 'bg-cyan-100'
            }`}>
              🔄
            </div>
            <div>
              <h2 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {status === 'confirmed' ? 'Cash Out Complete' : status === 'failed' ? 'Cash Out Failed' : 'Confirm Cash Out'}
              </h2>
              <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {chainName}
              </p>
            </div>
          </div>
          {(status === 'preview' || status === 'confirmed' || status === 'failed') && (
            <button
              onClick={onClose}
              className={`p-2 transition-colors ${
                isDark ? 'text-gray-400 hover:text-white hover:bg-white/10' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
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
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Waiting for signature...
                </p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Check your wallet
                </p>
              </div>
            </div>
          )}

          {status === 'pending' && (
            <div className={`p-4 flex items-center gap-3 ${isDark ? 'bg-juice-cyan/10' : 'bg-cyan-50'}`}>
              <div className="animate-spin w-5 h-5 border-2 border-juice-cyan border-t-transparent rounded-full" />
              <div>
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Transaction pending...
                </p>
                <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Confirming on {chainName}
                </p>
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
                <p className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  Cash out successful
                </p>
                {txHash && (
                  <a
                    href={`${chainInfo.explorerTx}${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-juice-cyan hover:underline"
                  >
                    View on explorer →
                  </a>
                )}
              </div>
            </div>
          )}

          {status === 'failed' && error && (
            <div className={`p-4 ${isDark ? 'bg-red-500/10' : 'bg-red-50'}`}>
              <p className={`font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                Transaction failed
              </p>
              <p className={`text-sm mt-1 ${isDark ? 'text-red-400/70' : 'text-red-500'}`}>
                {error}
              </p>
            </div>
          )}

          {/* Cash Out Details */}
          {(status === 'preview' || status === 'signing' || status === 'pending') && (
            <>
              {/* Project */}
              <div className={`p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                <div className={`text-xs uppercase tracking-wide mb-2 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                  Cashing out from
                </div>
                <div className={`font-semibold text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {projectName || `Project #${projectId}`}
                </div>
              </div>

              {/* Amount breakdown */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Burning</span>
                  <span className={`font-mono font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                    {tokenNum.toLocaleString()} {tokenSymbol}
                  </span>
                </div>

                {cashOutTaxRate > 0 && (
                  <div className="flex justify-between items-center">
                    <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>
                      Cash out tax
                    </span>
                    <span className={`font-mono ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
                      {taxPercent.toFixed(1)}%
                    </span>
                  </div>
                )}

                {grossReturn != null && grossReturn > 0 && (
                  <div className={`flex justify-between items-center pt-2 border-t ${
                    isDark ? 'border-white/10' : 'border-gray-200'
                  }`}>
                    <span className={`font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      You receive{feeApplies ? ' (after fee)' : ''}
                    </span>
                    <span className={`font-mono font-bold text-lg ${isDark ? 'text-green-400' : 'text-green-600'}`}>
                      ~{(netReturn ?? grossReturn).toFixed(returnDecimals)} {currencySymbol}
                    </span>
                  </div>
                )}
              </div>

              {/* Protocol fee note — the preview/estimate above is before the fee */}
              {feeApplies && (
                <div className={`p-3 text-xs ${isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
                  Heads up: a 2.5% protocol fee is taken from cash outs, so you'll receive a little less than the raw surplus share.
                  {grossReturn != null && grossReturn > 0 && (
                    <> Before the fee this cash out is worth ~{grossReturn.toFixed(returnDecimals)} {currencySymbol}.</>
                  )}
                </div>
              )}

              {/* Gas balance check */}
              <div className={`flex justify-between items-center text-sm ${
                isDark ? 'text-gray-400' : 'text-gray-500'
              }`}>
                <span>Your ETH balance (for gas)</span>
                <span className={`font-mono ${!hasGasBalance ? 'text-red-400' : ''}`}>
                  {formatEthBalance(totalEth)} ETH
                </span>
              </div>

              {!hasGasBalance && (
                <div className={`p-3 text-sm ${isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
                  Insufficient ETH for gas fees
                </div>
              )}

              <div className={`p-3 text-sm ${isDark ? 'bg-white/5 text-gray-400' : 'bg-gray-50 text-gray-500'}`}>
                Your tokens will be burned and you'll receive funds based on the project balance and cash out tax rate.
              </div>

              {/* Transaction Summary */}
              <TransactionSummary
                type="cashOut"
                details={{
                  projectId,
                  projectName,
                  tokens: tokenNum.toString(),
                  tokensFormatted: `${tokenNum.toLocaleString()} ${tokenSymbol}`,
                  estimatedReturn: estimatedReturn.toString(),
                  estimatedReturnFormatted: `${estimatedReturn.toFixed(currencySymbol === 'USDC' ? 2 : 4)} ${currencySymbol}`,
                  taxRate: cashOutTaxRate,
                  currency: currencySymbol,
                }}
                isDark={isDark}
              />

              {/* Transaction Warning */}
              {hasWarnings && (
                <TransactionWarning
                  doubts={verificationResult.doubts}
                  onConfirm={() => setWarningsAcknowledged(true)}
                  onCancel={onClose}
                  isDark={isDark}
                />
              )}

              {/* Terminal loading indicator */}
              {terminalLoading && (
                <div className={`p-3 text-sm flex items-center gap-2 ${isDark ? 'bg-juice-cyan/10 text-juice-cyan' : 'bg-cyan-50 text-cyan-700'}`}>
                  <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                  Fetching payment terminal...
                </div>
              )}

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
                {estimatedReturn > 0 && (
                  <div className="flex justify-between items-center">
                    <span className={isDark ? 'text-gray-300' : 'text-gray-600'}>Received</span>
                    <span className={`font-mono text-green-500`}>
                      ~{estimatedReturn.toFixed(currencySymbol === 'USDC' ? 2 : 4)} {currencySymbol}
                    </span>
                  </div>
                )}
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
                className={`flex-1 py-3 font-medium border-2 transition-colors ${
                  isDark
                    ? 'border-white/20 text-white hover:bg-white/10'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
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

          {(status === 'signing' || status === 'pending') && (
            <div className={`text-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Do not close this window
            </div>
          )}

          {(status === 'confirmed' || status === 'failed') && (
            <button
              onClick={onClose}
              className="w-full py-3 font-medium bg-juice-cyan text-black hover:bg-juice-cyan/90 transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
