import { useState, useMemo, useCallback, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { createPublicClient, http, formatEther, erc20Abi } from 'viem'
import { VIEM_CHAINS, USDC_ADDRESSES, RPC_ENDPOINTS, type SupportedChainId } from '../constants'
import { fetchIssuanceRate, type IssuanceRate } from '../services/bendystraw'
import { useTransactionStore } from '../stores'

export interface UsePaymentFormOptions {
  projectId: string
  chainId: string
  ethPrice: number | null
  issuanceRate: IssuanceRate | null
}

export interface UsePaymentFormReturn {
  // Form state
  amount: string
  setAmount: (amount: string) => void
  memo: string
  setMemo: (memo: string) => void
  selectedToken: 'ETH' | 'USDC'
  setSelectedToken: (token: 'ETH' | 'USDC') => void
  paying: boolean

  // Pay Juicy feature
  payUs: boolean
  setPayUs: (payUs: boolean) => void
  feeAmount: number
  totalAmount: number
  estimatedJuicyTokens: number

  // Token calculations
  expectedTokens: number | null

  // Wallet state
  isConnected: boolean
  walletEthBalance: bigint | null
  walletUsdcBalance: bigint | null
  balanceLoading: boolean
  balanceCheck: { sufficient: boolean; reason?: string; needed?: number; have?: number }

  // Actions
  handlePay: () => Promise<void>
  fetchWalletBalances: () => Promise<void>
}

// $JUICY project config
const JUICY_PROJECT_ID = 1
const JUICY_FEE_PERCENT = 2.5

// Dispatch event to open wallet panel
function openWalletPanel() {
  window.dispatchEvent(new CustomEvent('juice:open-wallet-panel'))
}

export function usePaymentForm({
  projectId,
  chainId,
  ethPrice,
  issuanceRate,
}: UsePaymentFormOptions): UsePaymentFormReturn {
  const [amount, setAmount] = useState('25')
  const [memo, setMemo] = useState('')
  const [selectedToken, setSelectedToken] = useState<'ETH' | 'USDC'>('USDC')
  const [paying, setPaying] = useState(false)
  const [payUs, setPayUs] = useState(true)
  const [juicyIssuanceRate, setJuicyIssuanceRate] = useState<IssuanceRate | null>(null)
  const [walletEthBalance, setWalletEthBalance] = useState<bigint | null>(null)
  const [walletUsdcBalance, setWalletUsdcBalance] = useState<bigint | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  const { address, isConnected } = useAccount()
  const { addTransaction } = useTransactionStore()

  // Fetch $JUICY issuance rate when chain changes
  useEffect(() => {
    fetchIssuanceRate(String(JUICY_PROJECT_ID), parseInt(chainId))
      .then(setJuicyIssuanceRate)
      .catch(() => setJuicyIssuanceRate(null))
  }, [chainId])

  // Fetch wallet balances
  const fetchWalletBalances = useCallback(async () => {
    if (!address) {
      setWalletEthBalance(null)
      setWalletUsdcBalance(null)
      return
    }

    const chainIdNum = parseInt(chainId)
    const chain = VIEM_CHAINS[chainIdNum as SupportedChainId]
    if (!chain) return

    setBalanceLoading(true)
    try {
      const rpcUrl = RPC_ENDPOINTS[chainIdNum]?.[0]
      const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
      })

      const ethBalance = await publicClient.getBalance({
        address: address as `0x${string}`,
      })
      setWalletEthBalance(ethBalance)

      const usdcAddress = USDC_ADDRESSES[chainIdNum as SupportedChainId]
      if (usdcAddress) {
        const usdcBalance = await publicClient.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        })
        setWalletUsdcBalance(usdcBalance)
      }
    } catch (err) {
      console.error('Failed to fetch wallet balances:', err)
    } finally {
      setBalanceLoading(false)
    }
  }, [address, chainId])

  useEffect(() => {
    fetchWalletBalances()
  }, [fetchWalletBalances])

  // Calculate fee and totals
  const amountNum = parseFloat(amount) || 0
  const feeAmount = payUs ? amountNum * (JUICY_FEE_PERCENT / 100) : 0
  const totalAmount = amountNum + feeAmount

  // Calculate expected tokens based on amount and issuance rate
  const expectedTokens = useMemo(() => {
    if (!issuanceRate || !amount || parseFloat(amount) <= 0) return null

    try {
      const amountFloat = parseFloat(amount)
      let ethEquivalent = amountFloat
      if (selectedToken === 'USDC' && ethPrice) {
        ethEquivalent = amountFloat / ethPrice
      }
      const tokens = ethEquivalent * issuanceRate.tokensPerEth
      if (tokens < 0.01) return null
      return tokens
    } catch {
      return null
    }
  }, [amount, issuanceRate, selectedToken, ethPrice])

  // Calculate $JUICY tokens from fee
  const estimatedJuicyTokens = useMemo(() => {
    if (!payUs || !juicyIssuanceRate || feeAmount <= 0) return 0
    let feeEthEquivalent = feeAmount
    if (selectedToken === 'USDC' && ethPrice) {
      feeEthEquivalent = feeAmount / ethPrice
    }
    return feeEthEquivalent * juicyIssuanceRate.tokensPerEth
  }, [payUs, juicyIssuanceRate, feeAmount, selectedToken, ethPrice])

  // Check if user has sufficient balance
  const balanceCheck = useMemo(() => {
    if (balanceLoading) return { sufficient: false, reason: 'loading' as const }

    const paymentAmount = parseFloat(amount) || 0
    const total = paymentAmount + feeAmount
    const minGasEth = 0.001
    const ethBalanceNum = walletEthBalance ? parseFloat(formatEther(walletEthBalance)) : 0

    if (selectedToken === 'ETH') {
      const totalEthNeeded = total + minGasEth
      if (ethBalanceNum < totalEthNeeded) {
        return { sufficient: false, reason: 'insufficient_eth' as const, needed: totalEthNeeded, have: ethBalanceNum }
      }
    } else if (selectedToken === 'USDC') {
      const usdcBalanceNum = walletUsdcBalance ? Number(walletUsdcBalance) / 1e6 : 0
      if (usdcBalanceNum < total) {
        return { sufficient: false, reason: 'insufficient_usdc' as const, needed: total, have: usdcBalanceNum }
      }
      if (ethBalanceNum < minGasEth) {
        return { sufficient: false, reason: 'insufficient_gas' as const, needed: minGasEth, have: ethBalanceNum }
      }
    }

    return { sufficient: true }
  }, [amount, feeAmount, selectedToken, walletEthBalance, walletUsdcBalance, balanceLoading])

  // Handle payment
  const handlePay = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) return

    if (!isConnected) {
      openWalletPanel()
      return
    }

    await fetchWalletBalances()
    if (!balanceCheck.sufficient) {
      if (balanceCheck.reason === 'loading') return
      openWalletPanel()
      return
    }

    setPaying(true)
    try {
      const txId = addTransaction({
        type: 'pay',
        projectId,
        chainId: parseInt(chainId),
        amount,
        token: selectedToken,
        status: 'pending',
      })

      window.dispatchEvent(new CustomEvent('juice:pay-project', {
        detail: {
          txId,
          projectId,
          chainId: parseInt(chainId),
          amount,
          token: selectedToken,
          memo,
          payUs,
          feeAmount: feeAmount.toString(),
          juicyProjectId: JUICY_PROJECT_ID,
          totalAmount: totalAmount.toString(),
        }
      }))
      setAmount('')
      setMemo('')
    } finally {
      setPaying(false)
    }
  }, [amount, isConnected, balanceCheck, projectId, chainId, selectedToken, memo, payUs, feeAmount, totalAmount, fetchWalletBalances, addTransaction])

  return {
    amount,
    setAmount,
    memo,
    setMemo,
    selectedToken,
    setSelectedToken,
    paying,
    payUs,
    setPayUs,
    feeAmount,
    totalAmount,
    estimatedJuicyTokens,
    expectedTokens,
    isConnected,
    walletEthBalance,
    walletUsdcBalance,
    balanceLoading,
    balanceCheck,
    handlePay,
    fetchWalletBalances,
  }
}
