import { useEffect, useCallback } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { getWalletClient } from 'wagmi/actions'
import { parseEther, parseUnits, encodeFunctionData, encodeAbiParameters, keccak256, toBytes, type Hex, type Address, type Chain } from 'viem'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useTransactionStore } from '../stores'
import { wagmiConfig } from '../config/wagmi'
import { USDC_ADDRESSES, type SupportedChainId } from '../constants'

// JBMultiTerminal5_1 address (same on all chains)
const JB_MULTI_TERMINAL = '0x52869db3d61dde1e391967f2ce5039ad0ecd371c' as const

// Native token address for ETH payments
const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

// Canonical Permit2 address (same on all chains)
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

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

// Permit2 PermitSingle typed data
const PERMIT2_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
} as const

// Chain configs
const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
}

// Compute the permit2 metadata ID: bytes4(bytes20(terminal) ^ bytes20(keccak256("permit2")))
function computePermit2MetadataId(): Hex {
  const terminalBytes = BigInt(JB_MULTI_TERMINAL)
  const purposeHash = BigInt(keccak256(toBytes('permit2')))
  // Get first 20 bytes (160 bits) of purpose hash
  const purposeBytes20 = purposeHash >> BigInt(96)
  // XOR and take first 4 bytes
  const xored = terminalBytes ^ purposeBytes20
  const result = (xored >> BigInt(128)) & BigInt(0xFFFFFFFF)
  return `0x${result.toString(16).padStart(8, '0')}` as Hex
}

// Build JB metadata with permit2 data
// Format: 32B reserved | (id, offset) entries padded to 32B | data padded to 32B
function buildPermit2Metadata(allowanceData: Hex): Hex {
  const permit2Id = computePermit2MetadataId()
  // Reserved 32 bytes + one entry (4B id + 1B offset) + padding to 32B = 64 bytes before data
  // Offset is 2 (after reserved word and lookup table word)
  const offset = 2

  // Build: 32B zeros | id (4B) | offset (1B) | padding (27B) | data (padded to 32B multiple)
  const reserved = '00'.repeat(32) // 32 bytes of zeros (64 hex chars)
  const lookupEntry = permit2Id.slice(2) + offset.toString(16).padStart(2, '0') + '00'.repeat(27)

  // Pad allowance data to 32B multiple
  const dataLen = (allowanceData.length - 2) / 2
  const paddedLen = Math.ceil(dataLen / 32) * 32
  const paddedData = allowanceData.slice(2).padEnd(paddedLen * 2, '0')

  const result = ('0x' + reserved + lookupEntry + paddedData) as Hex
  console.log('[TX] Permit2 metadata:', result.slice(0, 140) + '...')
  console.log('[TX] Metadata length:', (result.length - 2) / 2, 'bytes')
  return result
}

// Encode JBSingleAllowance struct
function encodeJBSingleAllowance(
  sigDeadline: bigint,
  amount: bigint,
  expiration: number,
  nonce: number,
  signature: Hex
): Hex {
  return encodeAbiParameters(
    [
      { type: 'uint256' },  // sigDeadline
      { type: 'uint160' },  // amount
      { type: 'uint48' },   // expiration
      { type: 'uint48' },   // nonce
      { type: 'bytes' },    // signature
    ],
    [sigDeadline, amount, expiration, nonce, signature]
  )
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

// ABI to read Permit2 allowance nonce
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

export function useTransactionExecutor() {
  const { address, isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { updateTransaction } = useTransactionStore()

  const buildPayCallData = useCallback((
    projectId: number,
    tokenAddress: Address,
    amount: bigint,
    beneficiary: Address,
    memo: string,
    metadata: Hex = '0x'
  ): Hex => {
    return encodeFunctionData({
      abi: TERMINAL_PAY_ABI,
      functionName: 'pay',
      args: [
        BigInt(projectId),
        tokenAddress,
        amount,
        beneficiary,
        0n, // minReturnedTokens - 0 for no slippage protection
        memo,
        metadata,
      ],
    })
  }, [])

  const executePayTransaction = useCallback(async (detail: PayEventDetail) => {
    const { txId, projectId, chainId, amount, memo, payUs, feeAmount, juicyProjectId, token } = detail
    const isUsdc = token === 'USDC'

    // Start with checking stage
    updateTransaction(txId, { stage: 'checking' })

    const chain = CHAINS[chainId]
    if (!chain) {
      console.error('[TX] Unsupported chain:', chainId)
      updateTransaction(txId, { status: 'failed', error: 'Unsupported chain' })
      return
    }

    // For USDC, get the address for this chain
    const usdcAddress = isUsdc ? USDC_ADDRESSES[chainId as SupportedChainId] : null
    if (isUsdc && !usdcAddress) {
      console.error('[TX] USDC not supported on chain:', chainId)
      updateTransaction(txId, { status: 'failed', error: 'USDC not supported on this chain' })
      return
    }

    const tokenAddress = isUsdc ? usdcAddress! : NATIVE_TOKEN

    // Get wallet client without chainId first (to check current state)
    let client
    try {
      client = await getWalletClient(wagmiConfig)
    } catch (err) {
      console.error('[TX] Failed to get wallet client:', err)
      updateTransaction(txId, { status: 'failed', error: 'Wallet not connected' })
      return
    }

    if (!client || !client.account) {
      console.error('[TX] Wallet not connected or client not ready')
      updateTransaction(txId, { status: 'failed', error: 'Wallet not ready' })
      return
    }

    const currentAddress = client.account.address
    const beneficiary = currentAddress as Address

    try {
      // Switch to the correct chain if needed
      const currentChainId = await client.getChainId()
      if (currentChainId !== chainId) {
        updateTransaction(txId, { stage: 'switching' })
        await switchChainAsync({ chainId })
        // Re-fetch client after chain switch
        client = await getWalletClient(wagmiConfig)
        if (!client) {
          throw new Error('Lost wallet connection after chain switch')
        }
      }

      // Parse amounts based on token decimals (USDC = 6, ETH = 18)
      const projectAmount = isUsdc
        ? parseUnits(amount, 6)
        : parseEther(amount)
      const juicyFeeAmount = payUs
        ? (isUsdc ? parseUnits(feeAmount, 6) : parseEther(feeAmount))
        : 0n
      const totalAmount = projectAmount + juicyFeeAmount

      // For USDC payments, try Permit2 for gasless approval, fall back to regular approve
      let permit2Metadata: Hex = '0x'
      let needsDirectApprove = false

      if (isUsdc) {
        const { createPublicClient, http: viemHttp } = await import('viem')
        const publicClient = createPublicClient({
          chain,
          transport: viemHttp(),
        })

        // Check if USDC is approved to Permit2 (required for Permit2 to work)
        const usdcToPermit2Allowance = await publicClient.readContract({
          address: usdcAddress!,
          abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
          functionName: 'allowance',
          args: [currentAddress, PERMIT2_ADDRESS],
        })

        if (usdcToPermit2Allowance >= totalAmount) {
          // Permit2 is enabled, use it
          try {
            updateTransaction(txId, { stage: 'signing' })

            const allowanceResult = await publicClient.readContract({
              address: PERMIT2_ADDRESS,
              abi: PERMIT2_ALLOWANCE_ABI,
              functionName: 'allowance',
              args: [currentAddress, usdcAddress!, JB_MULTI_TERMINAL],
            })

            const currentNonce = Number(allowanceResult[2])

            // Set permit expiration to 30 days from now, signature deadline to 30 minutes
            const expiration = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
            const sigDeadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60)

            // Sign Permit2 message
            const signature = await client.signTypedData({
              account: currentAddress,
              domain: {
                name: 'Permit2',
                chainId: chainId,
                verifyingContract: PERMIT2_ADDRESS,
              },
              types: PERMIT2_TYPES,
              primaryType: 'PermitSingle',
              message: {
                details: {
                  token: usdcAddress!,
                  amount: totalAmount,
                  expiration: expiration,
                  nonce: currentNonce,
                },
                spender: JB_MULTI_TERMINAL,
                sigDeadline: sigDeadline,
              },
            })

            // Encode JBSingleAllowance and build metadata
            const allowanceData = encodeJBSingleAllowance(
              sigDeadline,
              totalAmount,
              expiration,
              currentNonce,
              signature
            )
            permit2Metadata = buildPermit2Metadata(allowanceData)
          } catch (err) {
            console.warn('[TX] Permit2 signing failed, falling back to direct approve:', err)
            needsDirectApprove = true
          }
        } else {
          // USDC not approved to Permit2, prompt for one-time Permit2 approval
          console.log('[TX] USDC not approved to Permit2, prompting for approval')
          updateTransaction(txId, { stage: 'approving' })

          // First approve USDC to Permit2 (max uint256 for one-time unlimited approval)
          await client.sendTransaction({
            to: usdcAddress!,
            data: encodeFunctionData({
              abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const,
              functionName: 'approve',
              args: [PERMIT2_ADDRESS, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
            }),
            value: 0n,
            chain,
            account: currentAddress,
          })

          // Now proceed with Permit2 signing
          updateTransaction(txId, { stage: 'signing' })
          const allowanceResult = await publicClient.readContract({
            address: PERMIT2_ADDRESS,
            abi: PERMIT2_ALLOWANCE_ABI,
            functionName: 'allowance',
            args: [currentAddress, usdcAddress!, JB_MULTI_TERMINAL],
          })

          const currentNonce = Number(allowanceResult[2])
          const expiration = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
          const sigDeadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60)

          const signature = await client.signTypedData({
            account: currentAddress,
            domain: {
              name: 'Permit2',
              chainId: chainId,
              verifyingContract: PERMIT2_ADDRESS,
            },
            types: PERMIT2_TYPES,
            primaryType: 'PermitSingle',
            message: {
              details: {
                token: usdcAddress!,
                amount: totalAmount,
                expiration: expiration,
                nonce: currentNonce,
              },
              spender: JB_MULTI_TERMINAL,
              sigDeadline: sigDeadline,
            },
          })

          const allowanceData = encodeJBSingleAllowance(
            sigDeadline,
            totalAmount,
            expiration,
            currentNonce,
            signature
          )
          permit2Metadata = buildPermit2Metadata(allowanceData)
        }

        // Handle Permit2 signing failure - fall back to direct terminal approval
        if (needsDirectApprove) {
          await client.sendTransaction({
            to: usdcAddress!,
            data: encodeFunctionData({
              abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const,
              functionName: 'approve',
              args: [JB_MULTI_TERMINAL, totalAmount],
            }),
            value: 0n,
            chain,
            account: currentAddress,
          })
        }
      }

      // Update to submitting stage
      updateTransaction(txId, { stage: 'submitting' })

      if (payUs && juicyFeeAmount > 0n) {
        // Batched transaction: pay project + pay $JUICY
        // For USDC with Permit2, only the first call needs the permit metadata
        const calls = [
          {
            to: JB_MULTI_TERMINAL as Address,
            data: buildPayCallData(parseInt(projectId), tokenAddress, projectAmount, beneficiary, memo, permit2Metadata),
            value: isUsdc ? 0n : projectAmount,
          },
          {
            to: JB_MULTI_TERMINAL as Address,
            data: buildPayCallData(juicyProjectId, tokenAddress, juicyFeeAmount, beneficiary, 'juicy fee'),
            value: isUsdc ? 0n : juicyFeeAmount,
          },
        ]

        // Check if wallet supports batch calls (EIP-5792)
        const clientWithBatch = client as typeof client & { sendCalls?: unknown }
        if (typeof clientWithBatch.sendCalls === 'function') {
          try {
            const batchResult = await (clientWithBatch.sendCalls as (params: unknown) => Promise<{ id?: string }>)({
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
        // First pay the project (with permit metadata for USDC)
        const projectHash = await client.sendTransaction({
          to: JB_MULTI_TERMINAL,
          data: buildPayCallData(parseInt(projectId), tokenAddress, projectAmount, beneficiary, memo, permit2Metadata),
          value: isUsdc ? 0n : projectAmount,
          chain,
          account: currentAddress,
        })

        updateTransaction(txId, { hash: projectHash, status: 'submitted' })

        // Then pay $JUICY (no permit needed, allowance already set by first tx)
        await client.sendTransaction({
          to: JB_MULTI_TERMINAL,
          data: buildPayCallData(juicyProjectId, tokenAddress, juicyFeeAmount, beneficiary, 'juicy fee'),
          value: isUsdc ? 0n : juicyFeeAmount,
          chain,
          account: currentAddress,
        })
      } else {
        // Single transaction: just pay the project
        const hash = await client.sendTransaction({
          to: JB_MULTI_TERMINAL,
          data: buildPayCallData(parseInt(projectId), tokenAddress, projectAmount, beneficiary, memo, permit2Metadata),
          value: isUsdc ? 0n : projectAmount,
          chain,
          account: currentAddress,
        })

        updateTransaction(txId, { hash, status: 'submitted' })
      }
    } catch (error) {
      console.error('Transaction failed:', error)

      // Detect user rejection/cancellation
      const errorMessage = error instanceof Error ? error.message : String(error)
      const isCancelled = errorMessage.includes('rejected') ||
                          errorMessage.includes('denied') ||
                          errorMessage.includes('cancelled') ||
                          errorMessage.includes('User rejected') ||
                          errorMessage.includes('user rejected')

      if (isCancelled) {
        updateTransaction(txId, { status: 'cancelled', error: 'Transaction cancelled' })
      } else {
        updateTransaction(txId, { status: 'failed', error: errorMessage.slice(0, 100) })
      }
    }
  }, [switchChainAsync, updateTransaction, buildPayCallData])

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
