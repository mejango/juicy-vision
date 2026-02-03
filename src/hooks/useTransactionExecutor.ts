import { useEffect, useCallback } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { getWalletClient } from 'wagmi/actions'
import { createPublicClient, http, parseEther, parseUnits, encodeFunctionData, encodeAbiParameters, erc20Abi, keccak256, toBytes, concat, type Hex, type Address, type Chain } from 'viem'
import { ethers } from 'ethers'
import { mainnet, optimism, base, arbitrum } from 'viem/chains'
import { useTransactionStore, useAuthStore } from '../stores'
import { wagmiConfig } from '../config/wagmi'
import { USDC_ADDRESSES, type SupportedChainId } from '../constants'
import { getPaymentTerminal } from '../utils'
import {
  createTransactionRecord,
  updateTransactionRecord,
  type TransactionReceipt,
} from '../api/transactions'

const API_BASE = import.meta.env.VITE_API_URL || ''

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

// ABI for Permit2.permit function (AllowanceTransfer flow)
const PERMIT2_PERMIT_ABI = [
  {
    name: 'permit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      {
        name: 'permitSingle',
        type: 'tuple',
        components: [
          {
            name: 'details',
            type: 'tuple',
            components: [
              { name: 'token', type: 'address' },
              { name: 'amount', type: 'uint160' },
              { name: 'expiration', type: 'uint48' },
              { name: 'nonce', type: 'uint48' },
            ],
          },
          { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

// Chain configs
const CHAINS: Record<number, Chain> = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
}

// =============================================================================
// Permit2 Metadata Encoding
// =============================================================================

/**
 * Compute permit2 metadata ID
 * Matches Solidity: bytes4(bytes20(target) ^ bytes20(keccak256(bytes("permit2"))))
 *
 * In Solidity, bytes4(bytes20_value) takes the FIRST 4 bytes of the bytes20.
 * So we XOR the two 20-byte values and take the first 4 bytes of the result.
 */
function computePermit2MetadataId(targetAddress: Address): Hex {
  const purposeHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('permit2'))

  // bytes20 takes the FIRST 20 bytes of the hash
  const purposeBytes20 = purposeHash.slice(0, 42)
  const terminalBytes20 = targetAddress.toLowerCase()

  // Convert to BigNumber for XOR
  const purposeBN = ethers.BigNumber.from(purposeBytes20)
  const terminalBN = ethers.BigNumber.from(terminalBytes20)
  const xorResult = purposeBN.xor(terminalBN)

  // Pad to exactly 40 hex chars (20 bytes) and take FIRST 4 bytes (8 hex chars)
  const xorHex = xorResult.toHexString().slice(2).padStart(40, '0')
  const first4Bytes = xorHex.slice(0, 8)

  return ('0x' + first4Bytes) as Hex
}

/**
 * Encode JBSingleAllowance struct for permit2 metadata.
 * Must encode as a TUPLE to match Solidity's abi.encode(struct).
 */
function encodeJBSingleAllowance(
  sigDeadline: bigint,
  amount: bigint,
  expiration: number,
  nonce: number,
  signature: Hex
): Hex {
  // Encode as a tuple (struct) - this matches Solidity's abi.encode(JBSingleAllowance)
  return encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { name: 'sigDeadline', type: 'uint256' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
        { name: 'signature', type: 'bytes' },
      ]
    }],
    [{
      sigDeadline,
      amount,
      expiration,
      nonce,
      signature,
    }]
  )
}

/**
 * Build JB metadata with permit2 data.
 * Format matches JBMetadataResolver exactly:
 * - 32B reserved (zeros)
 * - Lookup table: (ID: 4B, offset: 1B) entries, padded to 32B
 * - Data sections, each padded to 32B
 *
 * NO length prefix - JBMetadataResolver.getDataFor returns raw bytes by slicing
 * between offset positions.
 *
 * For a single entry:
 * - Word 0 (bytes 0-31): reserved zeros
 * - Word 1 (bytes 32-63): lookup table (ID + offset) + padding
 * - Word 2+ (bytes 64+): data (must be >= 32 bytes and padded to 32B)
 * So offset = 2 (data starts at word 2 = byte 64)
 */
function buildPermit2Metadata(allowanceData: Hex, terminalAddress: Address): Hex {
  const permit2Id = computePermit2MetadataId(terminalAddress)

  // The raw data bytes (without 0x prefix)
  const dataHex = allowanceData.slice(2)
  const dataBytes = dataHex.length / 2

  // Data must be padded to 32-byte boundary (JBMetadataResolver requirement)
  const paddedDataBytes = Math.ceil(dataBytes / 32) * 32
  const paddedDataHex = dataHex.padEnd(paddedDataBytes * 2, '0')

  // Build metadata:
  // 1. Reserved word (32 bytes of zeros)
  const reserved = '00'.repeat(32)

  // 2. Lookup table: ID (4 bytes) + offset (1 byte) + padding (27 bytes)
  // Offset = 2 (data starts at word 2 = byte 64)
  const idHex = permit2Id.slice(2) // Remove 0x prefix
  const offsetHex = '02' // Offset in words = 2
  const lookupPadding = '00'.repeat(27) // Pad to 32 bytes total

  // 3. Data section: padded data (NO length prefix)
  const metadata = '0x' + reserved + idHex + offsetHex + lookupPadding + paddedDataHex

  return metadata as Hex
}

// =============================================================================
// NFT 721 Metadata Encoding
// =============================================================================

/**
 * Compute NFT metadata ID for 721 hook
 * Matches Solidity: bytes4(bytes20(hook) ^ bytes20(keccak256(bytes("721"))))
 */
function computeNFTMetadataId(hookAddress: Address): Hex {
  const purposeHash = keccak256(toBytes('721'))

  // bytes20 takes the FIRST 20 bytes of the hash
  const purposeBytes20 = purposeHash.slice(0, 42)
  const hookBytes20 = hookAddress.toLowerCase()

  // Convert to BigNumber for XOR
  const purposeBN = ethers.BigNumber.from(purposeBytes20)
  const hookBN = ethers.BigNumber.from(hookBytes20)
  const xorResult = purposeBN.xor(hookBN)

  // Pad to exactly 40 hex chars (20 bytes) and take FIRST 4 bytes (8 hex chars)
  const xorHex = xorResult.toHexString().slice(2).padStart(40, '0')
  const first4Bytes = xorHex.slice(0, 8)

  return ('0x' + first4Bytes) as Hex
}

/**
 * Build NFT mint metadata with tier IDs
 * Format for JBMetadataResolver:
 * - 32B reserved
 * - Lookup table entries (4B ID + 1B offset), padded to 32B
 * - Data section (tier IDs encoded as uint16[])
 */
function buildNFTMintMetadata(hookAddress: Address, tierIds: number[]): Hex {
  const nftId = computeNFTMetadataId(hookAddress)

  // Encode tier IDs as uint16 array
  const tierData = encodeAbiParameters(
    [{ type: 'uint16[]' }],
    [tierIds.map(id => id)]
  )

  // The raw data bytes (without 0x prefix)
  const dataHex = tierData.slice(2)
  const dataBytes = dataHex.length / 2

  // Data must be padded to 32-byte boundary
  const paddedDataBytes = Math.ceil(dataBytes / 32) * 32
  const paddedDataHex = dataHex.padEnd(paddedDataBytes * 2, '0')

  // Build metadata:
  const reserved = '00'.repeat(32)
  const idHex = nftId.slice(2)
  const offsetHex = '02' // Offset in words = 2
  const lookupPadding = '00'.repeat(27)

  const metadata = '0x' + reserved + idHex + offsetHex + lookupPadding + paddedDataHex

  return metadata as Hex
}

/**
 * Combine permit2 metadata and NFT metadata into a single JB metadata blob
 * Uses multi-entry lookup table format
 */
function combineMetadata(permit2Metadata: Hex, nftMetadata: Hex): Hex {
  // Extract components from each metadata
  // Each has: 32B reserved + 32B lookup table + data

  // Get permit2 data (skip reserved word and lookup table)
  const permit2DataHex = permit2Metadata.slice(2 + 64 + 64) // Skip 0x + 32B + 32B
  const permit2Id = permit2Metadata.slice(2 + 64, 2 + 64 + 8) // Get ID from lookup table

  // Get NFT data (skip reserved word and lookup table)
  const nftDataHex = nftMetadata.slice(2 + 64 + 64)
  const nftId = nftMetadata.slice(2 + 64, 2 + 64 + 8)

  // Calculate padded sizes (in words)
  const permit2DataWords = Math.ceil(permit2DataHex.length / 64)
  const nftDataWords = Math.ceil(nftDataHex.length / 64)

  // Build combined metadata:
  // 1. Reserved word
  const reserved = '00'.repeat(32)

  // 2. Lookup table with 2 entries (each 5 bytes: 4B ID + 1B offset)
  // First entry starts at word 2, second at word 2 + permit2DataWords
  const permit2Offset = '02' // Word 2
  const nftOffset = (2 + permit2DataWords).toString(16).padStart(2, '0')
  const lookupTable = permit2Id + permit2Offset + nftId + nftOffset + '00'.repeat(22) // Pad to 32B

  // 3. Data sections (permit2 first, then NFT)
  const paddedPermit2 = permit2DataHex.padEnd(permit2DataWords * 64, '0')
  const paddedNft = nftDataHex.padEnd(nftDataWords * 64, '0')

  return ('0x' + reserved + lookupTable + paddedPermit2 + paddedNft) as Hex
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
  tierId?: number | null
  hookAddress?: `0x${string}` | null
  preventOverspending?: boolean
  tierPrice?: string // Exact tier price in wei as string (for preventOverspending)
}

export function useTransactionExecutor() {
  const { address, isConnected } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { updateTransaction } = useTransactionStore()
  const { token: authToken } = useAuthStore()

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
    const { txId, projectId, chainId, amount, memo, token, payUs, feeAmount, juicyProjectId, tierId, hookAddress, preventOverspending, tierPrice } = detail

    // Handle PAY_CREDITS payments via API
    if (token === 'PAY_CREDITS') {
      updateTransaction(txId, { stage: 'queueing' })

      if (!authToken) {
        updateTransaction(txId, { status: 'failed', error: 'Not authenticated' })
        return
      }

      const beneficiary = address || '0x0000000000000000000000000000000000000000'

      try {
        // Create spend for the main project payment
        const res = await fetch(`${API_BASE}/juice/spend`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            amount: parseFloat(amount),
            projectId: parseInt(projectId),
            chainId,
            beneficiaryAddress: beneficiary,
            memo: memo || undefined,
          }),
        })

        const data = await res.json()

        if (!data.success) {
          throw new Error(data.error || 'Failed to queue payment')
        }

        // If payUs is enabled, create a second spend for the JUICY fee
        if (payUs && parseFloat(feeAmount) > 0) {
          const feeRes = await fetch(`${API_BASE}/juice/spend`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              amount: parseFloat(feeAmount),
              projectId: juicyProjectId,
              chainId,
              beneficiaryAddress: beneficiary,
              memo: 'Juicy fee',
            }),
          })

          const feeData = await feeRes.json()

          if (!feeData.success) {
            // Main payment succeeded but fee failed - still mark as queued
            console.error('Fee payment failed:', feeData.error)
          }
        }

        // Payment successfully queued
        updateTransaction(txId, {
          status: 'queued',
          stage: undefined,
          spendId: data.data.spendId,
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        updateTransaction(txId, { status: 'failed', error: errorMessage.slice(0, 100) })
      }
      return
    }

    const isUsdc = token === 'USDC'

    // Start with checking stage
    updateTransaction(txId, { stage: 'checking' })

    const chain = CHAINS[chainId]
    if (!chain) {
      updateTransaction(txId, { status: 'failed', error: 'Unsupported chain' })
      return
    }

    // For USDC, get the address for this chain
    const usdcAddress = isUsdc ? USDC_ADDRESSES[chainId as SupportedChainId] : null
    if (isUsdc && !usdcAddress) {
      updateTransaction(txId, { status: 'failed', error: 'USDC not supported on this chain' })
      return
    }

    const tokenAddress = isUsdc ? usdcAddress! : NATIVE_TOKEN

    // Create a public client for terminal detection
    const publicClient = createPublicClient({
      chain,
      transport: http(),
    })

    // Dynamically detect which terminal to use
    let terminalAddress: Address
    let terminalType: 'multi' | 'swap'
    try {
      const terminal = await getPaymentTerminal(
        publicClient,
        chainId,
        BigInt(projectId),
        tokenAddress
      )
      terminalAddress = terminal.address
      terminalType = terminal.type
    } catch (err) {
      updateTransaction(txId, { status: 'failed', error: 'Failed to detect payment terminal' })
      return
    }

    // Get wallet client
    let client
    try {
      client = await getWalletClient(wagmiConfig)
    } catch (err) {
      updateTransaction(txId, { status: 'failed', error: 'Wallet not connected' })
      return
    }

    if (!client || !client.account) {
      updateTransaction(txId, { status: 'failed', error: 'Wallet not ready' })
      return
    }

    const currentAddress = client.account.address
    const beneficiary = currentAddress as Address

    // Create backend transaction record for persistent tracking
    let backendTxId: string | null = null
    try {
      const backendTx = await createTransactionRecord({
        chainId,
        fromAddress: currentAddress,
        toAddress: terminalAddress,
        tokenAddress: isUsdc ? usdcAddress! : undefined,
        amount: amount,
        projectId,
      })
      backendTxId = backendTx.id
    } catch (err) {
      // Non-fatal: continue even if backend save fails
    }

    try {
      // Switch to the correct chain if needed
      const currentChainId = await client.getChainId()
      if (currentChainId !== chainId) {
        updateTransaction(txId, { stage: 'switching' })
        await switchChainAsync({ chainId })
        client = await getWalletClient(wagmiConfig)
        if (!client) {
          throw new Error('Lost wallet connection after chain switch')
        }
      }

      // Parse amounts based on token decimals (USDC = 6, ETH = 18)
      // When preventOverspending is enabled and we have an exact tier price, use that
      let projectAmount: bigint
      if (preventOverspending && tierPrice && tierId) {
        // Use exact tier price (already in wei)
        projectAmount = BigInt(tierPrice)
      } else {
        projectAmount = isUsdc
          ? parseUnits(amount, 6)
          : parseEther(amount)
      }

      // For USDC payments, build permit2 metadata for single-tx flow
      let permit2Metadata: Hex = '0x'

      if (isUsdc) {
        // Check if USDC is approved to Permit2
        const usdcToPermit2Allowance = await publicClient.readContract({
          address: usdcAddress!,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [currentAddress, PERMIT2_ADDRESS],
        })

        if (usdcToPermit2Allowance >= projectAmount) {
          // Permit2 is enabled - use single-tx flow with metadata
          try {
            updateTransaction(txId, { stage: 'signing' })

            // Get current nonce from Permit2
            const allowanceResult = await publicClient.readContract({
              address: PERMIT2_ADDRESS,
              abi: PERMIT2_ALLOWANCE_ABI,
              functionName: 'allowance',
              args: [currentAddress, usdcAddress!, terminalAddress],
            })
            const currentNonce = Number(allowanceResult[2])

            // Set permit expiration to 30 days, signature deadline to 30 minutes
            const nowSeconds = Math.floor(Date.now() / 1000)
            const expiration = nowSeconds + 30 * 24 * 60 * 60
            const sigDeadline = BigInt(nowSeconds + 30 * 60)

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
                  amount: projectAmount,
                  expiration: expiration,
                  nonce: currentNonce,
                },
                spender: terminalAddress,
                sigDeadline: sigDeadline,
              },
            })

            // Encode JBSingleAllowance and build metadata
            const allowanceData = encodeJBSingleAllowance(
              sigDeadline,
              projectAmount,
              expiration,
              currentNonce,
              signature
            )

            permit2Metadata = buildPermit2Metadata(allowanceData, terminalAddress)

          } catch (err) {
            // Signature failed, fall back to direct approve
            permit2Metadata = '0x'
          }
        }

        // Fallback: if no permit2 metadata, use direct approve
        if (permit2Metadata === '0x') {
          const currentAllowance = await publicClient.readContract({
            address: usdcAddress!,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [currentAddress, terminalAddress],
          })

          if (currentAllowance < projectAmount) {
            updateTransaction(txId, { stage: 'approving' })

            const approveHash = await client.sendTransaction({
              to: usdcAddress!,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'approve',
                args: [terminalAddress, projectAmount],
              }),
              value: 0n,
              chain,
              account: currentAddress,
            })

            await publicClient.waitForTransactionReceipt({ hash: approveHash })
          }
        }
      }

      // Update to submitting stage
      updateTransaction(txId, { stage: 'submitting' })

      // Build final metadata (may combine permit2 + NFT metadata)
      let finalMetadata: Hex = permit2Metadata

      // If a tier is selected, add NFT metadata for 721 mint
      if (tierId && hookAddress) {
        const nftMetadata = buildNFTMintMetadata(hookAddress, [tierId])
        if (permit2Metadata !== '0x') {
          // Combine permit2 and NFT metadata
          finalMetadata = combineMetadata(permit2Metadata, nftMetadata)
        } else {
          // Just NFT metadata
          finalMetadata = nftMetadata
        }
      }

      // Pay the project with metadata (terminal will call permit internally if permit2)
      const payCallData = buildPayCallData(parseInt(projectId), tokenAddress, projectAmount, beneficiary, memo, finalMetadata)

      const hash = await client.sendTransaction({
        to: terminalAddress,
        data: payCallData,
        value: isUsdc ? 0n : projectAmount,
        chain,
        account: currentAddress,
      })

      // Update to submitted and start confirming stage
      updateTransaction(txId, { hash, status: 'submitted', stage: 'confirming' })

      // Update backend with hash
      if (backendTxId) {
        updateTransactionRecord(backendTxId, { status: 'submitted', txHash: hash }).catch(() => {})
      }

      // Wait for transaction receipt
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash })

        const receiptData: TransactionReceipt = {
          blockNumber: Number(receipt.blockNumber),
          blockHash: receipt.blockHash,
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
          status: receipt.status,
        }

        updateTransaction(txId, {
          status: receipt.status === 'success' ? 'confirmed' : 'failed',
          stage: undefined,
          confirmedAt: Date.now(),
          receipt: receiptData,
          ...(receipt.status === 'reverted' && { error: 'Transaction reverted' }),
        })

        // Update backend with receipt
        if (backendTxId) {
          updateTransactionRecord(backendTxId, {
            status: receipt.status === 'success' ? 'confirmed' : 'failed',
            receipt: receiptData,
            ...(receipt.status === 'reverted' && { errorMessage: 'Transaction reverted' }),
          }).catch(() => {})
        }
      } catch (receiptError) {
        // Transaction was submitted but we couldn't confirm it
        // Keep status as submitted so user can check explorer
      }
    } catch (error) {

      const errorMessage = error instanceof Error ? error.message : String(error)
      const isCancelled = errorMessage.includes('rejected') ||
                          errorMessage.includes('denied') ||
                          errorMessage.includes('cancelled') ||
                          errorMessage.includes('User rejected') ||
                          errorMessage.includes('user rejected')

      const status = isCancelled ? 'cancelled' : 'failed'
      const errorMsg = isCancelled ? 'Transaction cancelled' : errorMessage.slice(0, 100)

      updateTransaction(txId, { status, error: errorMsg })

      // Update backend with error status
      if (backendTxId) {
        updateTransactionRecord(backendTxId, {
          status,
          errorMessage: errorMsg,
        }).catch(() => {})
      }
    }
  }, [switchChainAsync, updateTransaction, buildPayCallData, authToken, address])

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
