import { useEffect, useCallback } from 'react'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
import { parseEther, encodeFunctionData, type Hex, type Address, type Chain } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useTransactionStore } from '../stores'

// JBMultiTerminal5_1 address (same on all chains)
const JB_MULTI_TERMINAL = '0x52869db3d61dde1e391967f2ce5039ad0ecd371c' as const

// Native token address for ETH payments
const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

// ABI for JBMultiTerminal.pay function
const TERMINAL_PAY_ABI = [
  {
    name: 'pay',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'minReturnedTokens', type: 'uint256' },
      { name: 'memo', type: 'string' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [{ name: 'beneficiaryTokenCount', type: 'uint256' }],
  },
] as const

// Chain configs
const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
}

interface PayEventDetail {
  txId: string
  projectId: string
  chainId: number
  amount: string
  memo: string
  token?: string
  payUs: boolean
  feeAmount: string
  juicyProjectId: number
  totalAmount: string
}

export function useTransactionExecutor() {
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChainAsync } = useSwitchChain()
  const { updateTransaction } = useTransactionStore()

  const buildPayCallData = useCallback((
    projectId: number,
    amount: bigint,
    beneficiary: Address,
    memo: string
  ): Hex => {
    return encodeFunctionData({
      abi: TERMINAL_PAY_ABI,
      functionName: 'pay',
      args: [
        BigInt(projectId),
        NATIVE_TOKEN,
        amount,
        beneficiary,
        0n, // minReturnedTokens - 0 for no slippage protection
        memo,
        '0x' as Hex, // empty metadata
      ],
    })
  }, [])

  const executePayTransaction = useCallback(async (detail: PayEventDetail) => {
    if (!walletClient || !address) {
      console.error('Wallet not connected')
      updateTransaction(detail.txId, { status: 'failed' })
      return
    }

    const { txId, projectId, chainId, amount, memo, payUs, feeAmount, juicyProjectId } = detail
    const beneficiary = address as Address
    const chain = CHAINS[chainId]

    if (!chain) {
      console.error('Unsupported chain:', chainId)
      updateTransaction(txId, { status: 'failed' })
      return
    }

    try {
      // Switch to the correct chain if needed
      const currentChainId = await walletClient.getChainId()
      if (currentChainId !== chainId) {
        await switchChainAsync({ chainId })
      }

      const projectAmount = parseEther(amount)
      const juicyFeeAmount = payUs ? parseEther(feeAmount) : 0n

      if (payUs && juicyFeeAmount > 0n) {
        // Batched transaction: pay project + pay $JUICY
        // Try EIP-5792 batch first (for smart wallets)
        const calls = [
          {
            to: JB_MULTI_TERMINAL as Address,
            data: buildPayCallData(parseInt(projectId), projectAmount, beneficiary, memo),
            value: projectAmount,
          },
          {
            to: JB_MULTI_TERMINAL as Address,
            data: buildPayCallData(juicyProjectId, juicyFeeAmount, beneficiary, 'juicy fee'),
            value: juicyFeeAmount,
          },
        ]

        // Check if wallet supports batch calls (EIP-5792)
        const walletWithBatch = walletClient as typeof walletClient & { sendCalls?: unknown }
        if (typeof walletWithBatch.sendCalls === 'function') {
          try {
            const batchResult = await (walletWithBatch.sendCalls as (params: unknown) => Promise<{ id?: string }>)({
              account: beneficiary,
              chain,
              calls,
            })

            updateTransaction(txId, {
              hash: batchResult.id || String(batchResult),
              status: 'submitted'
            })
            return
          } catch {
            // Batch not supported, falling back to sequential
          }
        }

        // Fallback: Sequential transactions
        // First pay the project
        const projectHash = await walletClient.sendTransaction({
          to: JB_MULTI_TERMINAL,
          data: buildPayCallData(parseInt(projectId), projectAmount, beneficiary, memo),
          value: projectAmount,
          chain,
          account: address,
        })

        updateTransaction(txId, { hash: projectHash, status: 'submitted' })

        // Then pay $JUICY
        await walletClient.sendTransaction({
          to: JB_MULTI_TERMINAL,
          data: buildPayCallData(juicyProjectId, juicyFeeAmount, beneficiary, 'juicy fee'),
          value: juicyFeeAmount,
          chain,
          account: address,
        })
      } else {
        // Single transaction: just pay the project
        const hash = await walletClient.sendTransaction({
          to: JB_MULTI_TERMINAL,
          data: buildPayCallData(parseInt(projectId), projectAmount, beneficiary, memo),
          value: projectAmount,
          chain,
          account: address,
        })

        updateTransaction(txId, { hash, status: 'submitted' })
      }
    } catch (error) {
      console.error('Transaction failed:', error)
      updateTransaction(txId, { status: 'failed' })
    }
  }, [walletClient, address, switchChainAsync, updateTransaction, buildPayCallData])

  // Listen for pay events
  useEffect(() => {
    const handlePayEvent = (event: CustomEvent<PayEventDetail>) => {
      executePayTransaction(event.detail)
    }

    window.addEventListener('juice:pay-project', handlePayEvent as EventListener)

    return () => {
      window.removeEventListener('juice:pay-project', handlePayEvent as EventListener)
    }
  }, [executePayTransaction])

  return {
    isConnected,
    address,
  }
}
