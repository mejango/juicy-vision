/**
 * PayTerm Payment Page
 *
 * Minimal interface for terminal payments.
 * Consumer taps NFC or scans QR, then pays with existing Pay Credits or a wallet.
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useAccount, useConnect, useConnectors, useWalletClient, useSwitchChain } from 'wagmi'
import { createPublicClient, encodeFunctionData, erc20Abi, formatUnits, http, type Address, type Hex } from 'viem'
import { NATIVE_TOKEN, type JBChainId } from '@bananapus/nana-sdk-core'
import { buildPayTx } from '@bananapus/nana-sdk-core/v6'
import { useThemeStore, useAuthStore, useTransactionStore } from '../../stores'
import Button from '../../components/ui/Button'
import { getChainName } from '../../components/dynamic/charts/utils'
import { RPC_ENDPOINTS, USDC_ADDRESSES, VIEM_CHAINS, type SupportedChainId } from '../../constants'
import { getPaymentTerminal } from '../../utils/paymentTerminal'
import { truncateAddress } from '../../utils/ens'
import {
  assertCurrentProjectPayConfigurationTrusted,
  requireRecognizedRuntimeHook,
} from '../../utils/projectTrust'
import { requestPaymentReview, type PaymentReview } from '../../utils/paymentReview'
import { resolvePayPreviewOutcome, TERMINAL_PREVIEW_PAY_ABI } from '../../utils/terminalPreview'
import { txErrorMessage } from '../../utils/txErrors'
import { useSafeApp } from '../../hooks/useSafeApp'
import { submitTrackedTokenApproval } from '../../services/trackedTokenApproval'
import {
  encodeApprovalTx,
  getActiveSafeInfo,
  proposeSafeTransactions,
  waitForSafeExecution,
  type SafeTx,
} from '../../services/safeApp'

const API_BASE = import.meta.env.VITE_API_URL || ''

// Payment session types
interface PaymentSession {
  id: string
  deviceId: string
  amountUsd: number
  token: string | null
  tokenSymbol: string
  status: 'pending' | 'paying' | 'completed' | 'failed' | 'expired' | 'cancelled'
  paymentMethod: 'juice' | 'wallet' | 'apple_pay' | 'google_pay' | null
  txHash: Hex | null
  merchantId: string
  merchantName: string
  projectId: number
  chainId: number
  expiresAt: string
  createdAt: string
}

type PaymentStep = 'loading' | 'ready' | 'auth' | 'paying' | 'success' | 'error'

export default function PaymentPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { theme } = useThemeStore()
  const { token, isAuthenticated, login } = useAuthStore()
  const isDark = theme === 'dark'

  // Wallet connection
  const { address: walletAddress, isConnected } = useAccount()
  const { connect, isPending: isConnecting } = useConnect()
  const connectors = useConnectors()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const { safeInfo } = useSafeApp()
  const transactions = useTransactionStore(state => state.transactions)

  // State for wallet connector selection
  const [showWalletOptions, setShowWalletOptions] = useState(false)

  // State
  const [step, setStep] = useState<PaymentStep>('loading')
  const [session, setSession] = useState<PaymentSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pendingWalletTxHash, setPendingWalletTxHash] = useState<Hex | null>(null)

  useEffect(() => {
    if (!sessionId) return
    const activity = transactions.find(transaction => transaction.sessionId === sessionId)
    if (activity?.hash && (activity.status === 'submitted' || activity.status === 'confirmed')) {
      setPendingWalletTxHash(activity.hash as Hex)
    }
  }, [sessionId, transactions])

  // Auth state for email login
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)

  // Fetch session details
  useEffect(() => {
    if (!sessionId) {
      setError('Invalid payment link')
      setStep('error')
      return
    }

    fetch(`${API_BASE}/terminal/session/${sessionId}`)
      .then(res => res.json())
      .then(data => {
        if (!data.success) {
          throw new Error(data.error || 'Session not found')
        }

        const sess = data.data.session as PaymentSession

        // Check session status
        if (sess.status === 'completed') {
          setSession(sess)
          setStep('success')
          return
        }

        if (sess.status === 'expired') {
          setError('This payment session has expired')
          setStep('error')
          return
        }

        if (sess.status === 'cancelled') {
          setError('This payment was cancelled')
          setStep('error')
          return
        }

        if (sess.status === 'failed') {
          setError('This payment failed')
          setStep('error')
          return
        }

        if (sess.status === 'paying') {
          setSession(sess)
          if (sess.paymentMethod === 'wallet' && sess.txHash) {
            setPendingWalletTxHash(sess.txHash)
          }
          setStep('paying')
          return
        }

        // Check expiry
        if (new Date(sess.expiresAt) < new Date()) {
          setError('This payment session has expired')
          setStep('error')
          return
        }

        setSession(sess)
        setStep('ready')
      })
      .catch(err => {
        setError(err.message || 'Failed to load payment')
        setStep('error')
      })
  }, [sessionId])

  // WebSocket for real-time session status updates
  useEffect(() => {
    if (!sessionId || step === 'loading' || step === 'success' || step === 'error') return

    const wsUrl = `${API_BASE.replace(/^http/, 'ws')}/terminal/session/${sessionId}/ws?role=consumer`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)

        if (message.type === 'payment_completed') {
          setSession(prev => prev ? { ...prev, status: 'completed' } : null)
          setStep('success')
        } else if (message.type === 'payment_failed') {
          setError(message.data?.error || 'Payment failed')
          setStep('error')
        } else if (message.type === 'session_expired') {
          setError('This payment session has expired')
          setStep('error')
        } else if (message.type === 'session_cancelled') {
          setError('This payment was cancelled')
          setStep('error')
        }
      } catch {
        // Ignore parse errors
      }
    }

    ws.onerror = () => {
      // Fall back to polling if WebSocket fails
      console.log('WebSocket error, falling back to polling')
    }

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    }
  }, [sessionId, step])

  // Fallback polling for session status (in case WebSocket fails)
  useEffect(() => {
    if (step !== 'paying' || !sessionId) return

    const poll = setInterval(async () => {
      try {
        if (pendingWalletTxHash) {
          const confirmRes = await fetch(`${API_BASE}/terminal/session/${sessionId}/pay/wallet/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txHash: pendingWalletTxHash }),
          })
          const confirmData = await confirmRes.json()
          if (confirmData.success) {
            setPendingWalletTxHash(null)
            setSession(prev => prev ? { ...prev, status: 'completed' } : null)
            setStep('success')
            return
          }
        }

        const res = await fetch(`${API_BASE}/terminal/session/${sessionId}/status`)
        const data = await res.json()

        if (data.success) {
          if (data.data.status === 'completed') {
            setSession(prev => prev ? { ...prev, status: 'completed' } : null)
            setStep('success')
          } else if (data.data.status === 'failed') {
            setError('Payment failed')
            setStep('error')
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 5000) // Slower polling as backup

    return () => clearInterval(poll)
  }, [step, sessionId, pendingWalletTxHash])

  // Request OTP code
  const handleRequestCode = async () => {
    if (!email) return

    setAuthLoading(true)
    try {
      const res = await fetch(`${API_BASE}/auth/request-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to send code')
      }

      setCodeSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setAuthLoading(false)
    }
  }

  // Verify OTP and login
  const handleVerifyCode = async () => {
    if (!email || !code) return

    setAuthLoading(true)
    try {
      await login(email, code)
      setStep('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code')
    } finally {
      setAuthLoading(false)
    }
  }

  // Pay with Juice Credits
  const handlePayWithJuice = useCallback(async () => {
    if (!session || !token) {
      setStep('auth')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`${API_BASE}/terminal/session/${session.id}/pay/juice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      })

      const data = await res.json()

      if (!data.success) {
        throw new Error(data.error || 'Payment failed')
      }

      setStep('paying')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setLoading(false)
    }
  }, [session, token])

  // Pay with connected wallet
  const handlePayWithWallet = useCallback(async () => {
    if (!session) return

    const payerAddress = safeInfo?.safeAddress ?? walletAddress
    if (!payerAddress || (!safeInfo && !isConnected)) {
      setShowWalletOptions(true)
      return
    }

    setLoading(true)
    setError(null)

    let submittedTxHash: Hex | null = null
    let transactionReverted = false
    let activityId: string | null = null
    try {
      // Get payment parameters
      const paramsRes = await fetch(`${API_BASE}/terminal/session/${session.id}/pay/wallet`)
      const paramsData = await paramsRes.json()

      if (!paramsData.success) {
        throw new Error(paramsData.error || 'Failed to get payment params')
      }

      const { terminalAddress, projectId, tokenAddress, paymentAmount, paymentMemo, quoteExpiresAt } = paramsData.data
      if (Date.now() >= new Date(quoteExpiresAt).getTime()) throw new Error('Payment quote expired; request a new quote')

      const chain = VIEM_CHAINS[session.chainId as SupportedChainId]
      const rpcUrl = RPC_ENDPOINTS[session.chainId]?.[0]
      if (!chain || !rpcUrl) throw new Error('Unsupported payment chain')
      const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
      const terminal = terminalAddress as Address
      const paymentToken = tokenAddress as Address
      const amount = BigInt(paymentAmount)
      const isNativeToken = paymentToken.toLowerCase() === NATIVE_TOKEN.toLowerCase()
      const canonicalUsdc = USDC_ADDRESSES[session.chainId as SupportedChainId]
      if (!isNativeToken && paymentToken.toLowerCase() !== canonicalUsdc?.toLowerCase()) {
        throw new Error('The payment quote uses an unsupported token')
      }
      const fetchTrustedPreview = async () => {
        const discoveredTerminal = await getPaymentTerminal(
          publicClient,
          session.chainId,
          BigInt(projectId),
          paymentToken,
        )
        if (discoveredTerminal.address.toLowerCase() !== terminal.toLowerCase()) {
          throw new Error('The project payment terminal changed; request a new quote')
        }
        await assertCurrentProjectPayConfigurationTrusted({
          client: publicClient,
          projectId: BigInt(projectId),
        })
        const trustedPreview = await publicClient.readContract({
          account: payerAddress,
          address: terminal,
          abi: TERMINAL_PREVIEW_PAY_ABI,
          functionName: 'previewPayFor',
          args: [BigInt(projectId), paymentToken, amount, payerAddress, '0x'],
        })
        for (const specification of trustedPreview[3]) {
          if (!specification.noop) {
            await requireRecognizedRuntimeHook({
              client: publicClient,
              projectId: BigInt(projectId),
              rulesetId: trustedPreview[0].id,
              hook: specification.hook,
            })
          }
        }
        return { preview: trustedPreview, route: discoveredTerminal.type }
      }

      if (!safeInfo && (!walletClient?.account || walletClient.account.address.toLowerCase() !== payerAddress.toLowerCase())) {
        throw new Error('Wallet not ready')
      }

      const reviewed = await fetchTrustedPreview()
      const reviewedOutcome = resolvePayPreviewOutcome({
        beneficiaryTokenCount: reviewed.preview[1],
        reservedTokenCount: reviewed.preview[2],
        hookSpecifications: reviewed.preview[3],
      })
      // A verified zero quote is legitimate (zero-issuance project) and encodes minReturnedTokens = 0.
      const minReturnedTokens = reviewedOutcome.minReturnedTokens

      let reviewedAllowance = 0n
      const nativeBalance = await publicClient.getBalance({ address: payerAddress })
      const lacksNativeFunds = isNativeToken
        ? safeInfo ? nativeBalance < amount : nativeBalance <= amount
        : !safeInfo && nativeBalance === 0n
      if (lacksNativeFunds) {
        throw new Error(isNativeToken
          ? safeInfo ? 'The Safe has insufficient ETH for this payment' : 'Insufficient ETH balance and gas'
          : 'Insufficient ETH for gas')
      }
      if (!isNativeToken) {
        const [balance, allowance] = await Promise.all([
          publicClient.readContract({
            address: paymentToken,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [payerAddress],
          }),
          publicClient.readContract({
            address: paymentToken,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [payerAddress, terminal],
          }),
        ])
        if (balance < amount) throw new Error('Insufficient USDC balance')
        reviewedAllowance = allowance
      }

      const value = isNativeToken ? amount : 0n
      const approvalRequired = !isNativeToken && reviewedAllowance < amount
      const approveData = approvalRequired
        ? encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [terminal, amount],
          })
        : null
      const payTx = buildPayTx({
        chainId: session.chainId as JBChainId,
        terminal,
        projectId: BigInt(projectId),
        token: paymentToken,
        amount,
        beneficiary: payerAddress,
        minReturnedTokens,
        memo: paymentMemo,
        metadata: '0x',
      })
      const payData = encodeFunctionData({ abi: payTx.abi, functionName: payTx.functionName, args: payTx.args })
      const paymentReview: PaymentReview = {
        txId: session.id,
        account: payerAddress,
        chainId: session.chainId,
        chainName: chain.name,
        projectId: String(projectId),
        terminal,
        route: reviewed.route === 'router' ? 'routed payment' : 'direct terminal payment',
        outcomeRoute: reviewedOutcome.route,
        tokenSymbol: isNativeToken ? 'ETH' : 'USDC',
        tokenAddress: paymentToken,
        amount: formatUnits(amount, isNativeToken ? 18 : 6),
        amountRaw: amount.toString(),
        valueRaw: value.toString(),
        beneficiary: payerAddress,
        memo: paymentMemo,
        rulesetId: reviewed.preview[0].id.toString(),
        expectedProjectTokens: reviewedOutcome.beneficiaryTokenCount.toString(),
        minimumProjectTokens: minReturnedTokens.toString(),
        metadata: '0x',
        callData: payData,
        approval: approvalRequired ? {
          token: paymentToken,
          spender: terminal,
          amount: amount.toString(),
          callData: approveData!,
        } : null,
        nfts: [],
      }
      if (!await requestPaymentReview(paymentReview)) return

      if (Date.now() >= new Date(quoteExpiresAt).getTime()) {
        throw new Error('Payment quote expired; request a new quote')
      }
      if (!safeInfo && (!walletClient?.account || walletClient.account.address.toLowerCase() !== payerAddress.toLowerCase())) {
        throw new Error('The connected wallet changed; review the payment again')
      }
      if (safeInfo) {
        const currentSafe = getActiveSafeInfo()
        if (
          !currentSafe ||
          currentSafe.chainId !== session.chainId ||
          currentSafe.safeAddress.toLowerCase() !== payerAddress.toLowerCase()
        ) {
          throw new Error('The connected Safe or its network changed; review the payment again')
        }
      }

      const hookFingerprint = (preview: typeof reviewed.preview) => preview[3].map(specification => [
        specification.hook.toLowerCase(),
        specification.noop,
        specification.amount.toString(),
        specification.metadata.toLowerCase(),
      ].join(':')).join('|')
      const assertReviewedPreviewUnchanged = async () => {
        const current = await fetchTrustedPreview()
        if (
          current.route !== reviewed.route ||
          current.preview[0].id !== reviewed.preview[0].id ||
          current.preview[1] !== reviewed.preview[1] ||
          current.preview[2] !== reviewed.preview[2] ||
          hookFingerprint(current.preview) !== hookFingerprint(reviewed.preview)
        ) {
          throw new Error('The payment quote changed; review the payment again')
        }
      }
      await assertReviewedPreviewUnchanged()

      const callKey = [
        payerAddress.toLowerCase(),
        session.chainId,
        terminal.toLowerCase(),
        value.toString(),
        payData.toLowerCase(),
        approveData?.toLowerCase() ?? '',
      ].join(':')
      const store = useTransactionStore.getState()
      const duplicate = store.transactions.find(transaction =>
        transaction.callKey === callKey &&
        (transaction.status === 'pending' || transaction.status === 'submitted' || transaction.status === 'safe-proposed')
      )
      if (duplicate) throw new Error('This exact merchant payment is already pending. Do not pay again.')
      activityId = store.addTransaction({
        type: 'pay',
        projectId: String(projectId),
        sessionId: session.id,
        chainId: session.chainId,
        account: payerAddress,
        amount: paymentReview.amount,
        token: paymentReview.tokenSymbol,
        label: `Pay ${session.merchantName}`,
        callKey,
        status: 'pending',
        stage: 'checking',
      })

      const startRes = await fetch(`${API_BASE}/terminal/session/${session.id}/pay/wallet/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payerAddress }),
      })
      const startData = await startRes.json()
      if (!startData.success) throw new Error(startData.error || 'Payment session is no longer available')
      setStep('paying')

      // Only prompt the wallet after the target, project configuration, runtime
      // hooks, exact call, balance, quote, and session have all been verified.
      if (!safeInfo && await walletClient!.getChainId() !== session.chainId) {
        store.updateTransaction(activityId, { stage: 'switching' })
        await switchChainAsync({ chainId: session.chainId })
      }
      if (!safeInfo && await walletClient!.getChainId() !== session.chainId) {
        throw new Error(`Wallet did not switch to chain ${session.chainId}`)
      }
      if (!safeInfo && (!walletClient!.account || walletClient!.account.address.toLowerCase() !== payerAddress.toLowerCase())) {
        throw new Error('The connected wallet changed; review the payment again')
      }

      if (!isNativeToken) {
        await assertReviewedPreviewUnchanged()
        const allowance = await publicClient.readContract({
          address: paymentToken,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [payerAddress, terminal],
        })
        if ((allowance < amount) !== approvalRequired) {
          throw new Error('The token allowance changed; review the payment again')
        }
        if (approvalRequired && !safeInfo) {
          store.updateTransaction(activityId, { stage: 'approving' })
          await publicClient.call({ account: payerAddress, to: paymentToken, data: approveData! })
          await submitTrackedTokenApproval({
            chainId: session.chainId,
            chain,
            account: payerAddress,
            token: paymentToken,
            spender: terminal,
            amount,
            data: approveData!,
            walletClient: walletClient!,
            publicClient,
          })
        }
      }

      await assertReviewedPreviewUnchanged()
      if (!safeInfo && (!walletClient!.account ||
        walletClient!.account.address.toLowerCase() !== payerAddress.toLowerCase() ||
        await walletClient!.getChainId() !== session.chainId)) {
        throw new Error('Wallet account or network changed; review the payment again')
      }

      if (safeInfo && approvalRequired) {
        await publicClient.call({ account: payerAddress, to: paymentToken, data: approveData!, value: 0n })
      } else {
        await publicClient.call({ account: payerAddress, to: terminal, data: payData, value })
      }
      store.updateTransaction(activityId, { stage: 'submitting' })

      let txHash: Hex
      if (safeInfo) {
        const txs: SafeTx[] = []
        if (approvalRequired) txs.push(encodeApprovalTx(paymentToken, terminal, amount))
        txs.push({ to: terminal, data: payData, value: `0x${value.toString(16)}` })
        const safeTxHash = await proposeSafeTransactions(txs)
        store.updateTransaction(activityId, { safeTxHash, status: 'safe-proposed', stage: undefined })
        txHash = await waitForSafeExecution(safeTxHash)
      } else {
        txHash = await walletClient!.sendTransaction({
          account: payerAddress,
          chain,
          to: terminal,
          data: payData,
          value,
        })
      }
      submittedTxHash = txHash
      setPendingWalletTxHash(txHash)
      store.updateTransaction(activityId, { hash: txHash, status: 'submitted', stage: 'confirming' })

      // Give the backend the exact transaction immediately. It binds the hash
      // before checking the receipt, so an RPC timeout cannot invite a second pay.
      void fetch(`${API_BASE}/terminal/session/${session.id}/pay/wallet/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      }).catch(() => {})

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      if (receipt.status !== 'success') {
        transactionReverted = true
        store.updateTransaction(activityId, {
          hash: txHash,
          status: 'failed',
          stage: undefined,
          error: 'Payment transaction reverted',
        })
        throw new Error('Payment transaction reverted')
      }
      store.updateTransaction(activityId, {
        hash: txHash,
        status: 'confirmed',
        stage: undefined,
        confirmedAt: Date.now(),
      })

      // Confirm payment with backend
      const confirmRes = await fetch(`${API_BASE}/terminal/session/${session.id}/pay/wallet/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash }),
      })
      const confirmData = await confirmRes.json()
      if (!confirmData.success) throw new Error(confirmData.error || 'On-chain payment verification is delayed')

      setPendingWalletTxHash(null)
      setSession(prev => prev ? { ...prev, status: 'completed' } : null)
      setStep('success')
    } catch (err) {
      if (activityId && !submittedTxHash) {
        const message = err instanceof Error ? err.message : String(err)
        useTransactionStore.getState().updateTransaction(activityId, {
          status: /rejected|denied|cancelled/i.test(message) ? 'cancelled' : 'failed',
          stage: undefined,
          error: txErrorMessage(err, 'Wallet payment failed'),
        })
      }
      if (submittedTxHash && !transactionReverted) {
        setError('Your transaction was submitted. Do not pay again while on-chain verification is still processing.')
        setStep('paying')
        return
      }

      // Release only a pre-broadcast attempt or a transaction proven reverted.
      await fetch(`${API_BASE}/terminal/session/${session.id}/pay/wallet/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payerAddress,
          txHash: transactionReverted ? submittedTxHash : undefined,
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        }),
      }).catch(() => {})

      setPendingWalletTxHash(null)
      setError(txErrorMessage(err, 'Wallet payment failed'))
      setStep('ready')
    } finally {
      setLoading(false)
    }
  }, [session, isConnected, walletAddress, walletClient, switchChainAsync, safeInfo])

  // Handle wallet connector selection
  const handleConnectWallet = (connector: typeof connectors[number]) => {
    connect({ connector })
    setShowWalletOptions(false)
  }

  // Countdown timer
  const [timeLeft, setTimeLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!session) return

    const updateTime = () => {
      const expires = new Date(session.expiresAt).getTime()
      const now = Date.now()
      const remaining = Math.max(0, Math.floor((expires - now) / 1000))
      setTimeLeft(remaining)

      if (remaining === 0) {
        setError('This payment session has expired')
        setStep('error')
      }
    }

    updateTime()
    const interval = setInterval(updateTime, 1000)
    return () => clearInterval(interval)
  }, [session])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Render loading state
  if (step === 'loading') {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-juice-cyan border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Loading payment...</p>
        </div>
      </div>
    )
  }

  // Render error state
  if (step === 'error') {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className={`w-full max-w-sm text-center p-6 border ${isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'}`}>
          <div className={`w-16 h-16 mx-auto mb-4 flex items-center justify-center ${isDark ? 'bg-red-500/20' : 'bg-red-100'}`}>
            <svg className={`w-8 h-8 ${isDark ? 'text-red-400' : 'text-red-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Payment Error</h1>
          <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{error}</p>
          <Button variant="secondary" onClick={() => window.close()} className="w-full">
            Close
          </Button>
        </div>
      </div>
    )
  }

  // Render success state
  if (step === 'success' && session) {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className={`w-full max-w-sm text-center p-6 border ${isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'}`}>
          <div className={`w-16 h-16 mx-auto mb-4 flex items-center justify-center bg-green-500`}>
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>Payment Complete</h1>
          <p className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            ${session.amountUsd.toFixed(2)}
          </p>
          <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Paid to {session.merchantName}
          </p>
          <Button variant="primary" onClick={() => window.close()} className="w-full">
            Done
          </Button>
        </div>
      </div>
    )
  }

  // Render auth step
  if (step === 'auth') {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className={`w-full max-w-sm p-6 border ${isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'}`}>
          <h1 className={`text-lg font-semibold mb-4 text-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Sign in to Pay
          </h1>

          {!codeSent ? (
            <div className="space-y-4">
              <div>
                <label className={`block text-xs mb-1.5 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={`w-full px-3 py-2 text-sm border ${
                    isDark
                      ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                      : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                  } focus:border-juice-cyan outline-none`}
                />
              </div>
              <Button
                variant="primary"
                onClick={handleRequestCode}
                loading={authLoading}
                disabled={!email}
                className="w-full"
              >
                Continue
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className={`text-sm text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Enter the code sent to {email}
              </p>
              <div>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className={`w-full px-3 py-2 text-center text-2xl font-mono tracking-widest border ${
                    isDark
                      ? 'bg-white/5 border-white/10 text-white placeholder-gray-500'
                      : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                  } focus:border-juice-cyan outline-none`}
                />
              </div>
              <Button
                variant="primary"
                onClick={handleVerifyCode}
                loading={authLoading}
                disabled={code.length !== 6}
                className="w-full"
              >
                Verify
              </Button>
              <button
                onClick={() => { setCodeSent(false); setCode('') }}
                className={`w-full text-sm ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Use different email
              </button>
            </div>
          )}

          {error && (
            <div className={`mt-4 px-3 py-2 text-xs border ${isDark ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
              {error}
            </div>
          )}

          <div className={`mt-6 pt-4 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
            <button
              onClick={() => setStep('ready')}
              className={`w-full text-sm ${isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Render paying state (processing)
  if (step === 'paying') {
    return (
      <div className={`min-h-screen flex items-center justify-center p-4 ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
        <div className={`w-full max-w-sm text-center p-6 border ${isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'}`}>
          <div className="w-12 h-12 border-3 border-juice-cyan border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h1 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Processing Payment
          </h1>
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Please wait while we complete your payment...
          </p>
        </div>
      </div>
    )
  }

  // Render main payment UI
  return (
    <div className={`min-h-screen flex flex-col ${isDark ? 'bg-juice-dark' : 'bg-gray-50'}`}>
      {/* Header */}
      <header className={`px-4 py-3 border-b ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="max-w-sm mx-auto flex items-center justify-between">
          <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            PayTerm
          </span>
          {timeLeft !== null && (
            <span className={`text-xs font-mono ${timeLeft < 60 ? 'text-red-400' : isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {formatTime(timeLeft)}
            </span>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-4">
        {session && (
          <div className={`w-full max-w-sm border ${isDark ? 'bg-juice-dark-lighter border-white/10' : 'bg-white border-gray-200'}`}>
            {/* Payment amount */}
            <div className="p-6 text-center">
              <p className={`text-sm mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Pay {session.merchantName}
              </p>
              <p className={`text-4xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                ${session.amountUsd.toFixed(2)}
              </p>
              <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {getChainName(session.chainId)} &middot; Project #{session.projectId}
              </p>
            </div>

            {/* Payment options */}
            <div className={`p-4 space-y-3 border-t ${isDark ? 'border-white/10' : 'border-gray-100'}`}>
              {/* Pay with Juice Credits */}
              {isAuthenticated() && (
                <Button
                  variant="secondary"
                  onClick={handlePayWithJuice}
                  loading={loading}
                  className="w-full py-3"
                >
                  Pay with Credits
                </Button>
              )}

              {/* Sign in to pay */}
              {!isAuthenticated() && (
                <Button
                  variant="secondary"
                  onClick={() => setStep('auth')}
                  className="w-full py-3"
                >
                  Sign in to Pay
                </Button>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className={`flex-1 h-px ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
                <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>or</span>
                <div className={`flex-1 h-px ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
              </div>

              {/* Connect wallet */}
              {!showWalletOptions ? (
                <Button
                  variant="ghost"
                  onClick={handlePayWithWallet}
                  className="w-full py-3"
                >
                  {safeInfo
                    ? `Pay with Safe ${truncateAddress(safeInfo.safeAddress)}`
                    : isConnected && walletAddress
                      ? `Pay with ${truncateAddress(walletAddress)}`
                      : 'Connect Wallet'}
                </Button>
              ) : (
                <div className="space-y-2">
                  {connectors.map((connector) => (
                    <Button
                      key={connector.uid}
                      variant="ghost"
                      onClick={() => handleConnectWallet(connector)}
                      loading={isConnecting}
                      className="w-full py-2 text-sm"
                    >
                      {connector.name}
                    </Button>
                  ))}
                  <button
                    onClick={() => setShowWalletOptions(false)}
                    className={`w-full text-xs py-2 ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Error message */}
            {error && (
              <div className={`mx-4 mb-4 px-3 py-2 text-xs border ${isDark ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
                {error}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className={`px-4 py-3 text-center ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        <p className="text-xs">
          Powered by <a href="https://juicebox.money" className="hover:underline">Juicebox</a>
        </p>
      </footer>
    </div>
  )
}
