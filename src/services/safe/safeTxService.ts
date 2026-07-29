/**
 * Safe Transaction Service reads used by the Account view: enumerate the Safes
 * an address co-owns so their projects can be surfaced alongside directly
 * owned ones. Chains without a hosted service are skipped — enumeration is a
 * service-only capability (there is no on-chain reverse owner index).
 */

import {
  getAddress,
  hashTypedData,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'

// Unified-gateway prefixes (api.safe.global/tx-service/<prefix>) for the
// mainnet chains the app supports. Mirrors the map in services/safeInfo.ts,
// minus testnets: the Account view's Safe enumeration is mainnet-only.
export const SAFE_TX_SERVICE_PREFIX: Record<number, string> = {
  1: 'eth',
  10: 'oeth',
  8453: 'base',
  42161: 'arb1',
}

/** Chains where getSafesByOwner can actually enumerate (has a hosted service). */
export function safeServiceChainIds(): number[] {
  return Object.keys(SAFE_TX_SERVICE_PREFIX).map(Number)
}

/**
 * Safes on `chainId` that list `address` as an owner. Returns [] for chains
 * without a hosted service, for malformed addresses, and on any service
 * failure — the Account view degrades to direct ownership only.
 */
export async function getSafesByOwner(address: string, chainId: number): Promise<Address[]> {
  const prefix = SAFE_TX_SERVICE_PREFIX[chainId]
  if (!prefix) return []

  // The service rejects non-checksummed addresses (HTTP 422).
  let checksummed: Address
  try {
    checksummed = getAddress(address)
  } catch {
    return []
  }

  try {
    const res = await fetch(
      `https://api.safe.global/tx-service/${prefix}/api/v1/owners/${checksummed}/safes/`
    )
    if (!res.ok) return []
    const data = (await res.json()) as { safes?: string[] }
    return Array.isArray(data?.safes) ? (data.safes as Address[]) : []
  } catch {
    return []
  }
}

/**
 * Dedupe rows by (chainId, projectId), keeping the FIRST occurrence. Callers
 * put directly owned rows before Safe-owned rows so a project owned by a Safe
 * the viewer also co-owns renders once, with the direct row winning.
 */
export function dedupeByChainAndProject<T extends { chainId: number; projectId: number }>(
  items: T[]
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = `${item.chainId}:${item.projectId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

export type SafeConfirmation = { owner: Address; signature?: Hex | null }

export type SafeQueuedTransaction = {
  to: Address
  value: string | number
  data: Hex | null
  operation: number
  safeTxGas: string | number
  baseGas: string | number
  gasPrice: string | number
  gasToken: Address
  refundReceiver: Address
  nonce: number
  safeTxHash?: Hex
  contractTransactionHash?: Hex
  confirmationsRequired?: number
  confirmations?: SafeConfirmation[]
}

export const SAFE_VIEW_ABI = [
  {
    type: 'function',
    name: 'nonce',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const SAFE_EXEC_ABI = [
  {
    type: 'function',
    name: 'execTransaction',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

export const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

export function safeQueueLink(chainId: number, safe: Address): string | null {
  const prefix = SAFE_TX_SERVICE_PREFIX[chainId]
  return prefix ? `https://app.safe.global/transactions/queue?safe=${prefix}:${safe}` : null
}

export function safeMessage(tx: SafeQueuedTransaction) {
  return {
    to: tx.to,
    value: BigInt(tx.value ?? 0),
    data: tx.data ?? '0x',
    operation: Number(tx.operation ?? 0),
    safeTxGas: BigInt(tx.safeTxGas ?? 0),
    baseGas: BigInt(tx.baseGas ?? 0),
    gasPrice: BigInt(tx.gasPrice ?? 0),
    gasToken: tx.gasToken ?? zeroAddress,
    refundReceiver: tx.refundReceiver ?? zeroAddress,
    nonce: BigInt(tx.nonce),
  }
}

export function safeTransactionHash(
  chainId: number,
  safe: Address,
  tx: SafeQueuedTransaction,
): Hex {
  return hashTypedData({
    domain: { chainId, verifyingContract: safe },
    types: SAFE_TX_TYPES,
    primaryType: 'SafeTx',
    message: safeMessage(tx),
  })
}

export async function listPendingSafeTransactions(
  chainId: number,
  safe: Address,
  currentNonce: number,
): Promise<SafeQueuedTransaction[]> {
  const prefix = SAFE_TX_SERVICE_PREFIX[chainId]
  if (!prefix) throw new Error('Safe queue service is unavailable on this chain.')
  const base = `https://api.safe.global/tx-service/${prefix}`
  let next: string | null =
    `${base}/api/v1/safes/${getAddress(safe)}/multisig-transactions/?executed=false&trusted=true&ordering=nonce&limit=100&nonce__gte=${currentNonce}`
  const transactions: SafeQueuedTransaction[] = []
  for (let page = 0; next && page < 10; page += 1) {
    const response = await fetch(next)
    if (!response.ok) throw new Error(`Safe queue service returned ${response.status}.`)
    const body = (await response.json()) as {
      next?: string | null
      results?: SafeQueuedTransaction[]
    }
    transactions.push(...(body.results ?? []))
    if (!body.next) {
      next = null
    } else {
      const candidate = new URL(body.next, base).toString()
      if (!candidate.startsWith(`${base}/api/v1/`)) {
        throw new Error('Safe queue service returned an unexpected pagination URL.')
      }
      next = candidate
    }
  }
  if (next) throw new Error('Safe queue has more than 1,000 pending transactions.')
  return transactions.filter(tx => Number(tx.nonce) >= currentNonce)
}

export async function submitSafeConfirmation(
  chainId: number,
  tx: SafeQueuedTransaction,
  signature: Hex,
): Promise<void> {
  const prefix = SAFE_TX_SERVICE_PREFIX[chainId]
  const hash = tx.safeTxHash ?? tx.contractTransactionHash
  if (!prefix || !hash) throw new Error('The queued Safe transaction has no service hash.')
  const response = await fetch(
    `https://api.safe.global/tx-service/${prefix}/api/v1/multisig-transactions/${hash}/confirmations/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature }),
    },
  )
  if (!response.ok && response.status !== 201) {
    throw new Error(`Safe confirmation service returned ${response.status}.`)
  }
}

function signatureBytes(confirmation: SafeConfirmation): string | null {
  const signature = confirmation.signature?.replace(/^0x/, '')
  if (signature) return /^[0-9a-fA-F]{130}$/.test(signature) ? signature : null
  if (!confirmation.owner) return null
  return (
    confirmation.owner.replace(/^0x/, '').toLowerCase().padStart(64, '0') +
    '0'.repeat(64) +
    '01'
  )
}

export function usableSafeConfirmations(
  tx: SafeQueuedTransaction,
  allowedOwners?: readonly Address[],
): SafeConfirmation[] {
  const allowed = allowedOwners
    ? new Set(allowedOwners.map(owner => owner.toLowerCase()))
    : null
  const byOwner = new Map<string, SafeConfirmation>()
  for (const confirmation of tx.confirmations ?? []) {
    if (!signatureBytes(confirmation)) continue
    const key = confirmation.owner.toLowerCase()
    if (allowed && !allowed.has(key)) continue
    const existing = byOwner.get(key)
    if (!existing || (!existing.signature && confirmation.signature)) {
      byOwner.set(key, confirmation)
    }
  }
  return [...byOwner.values()].sort((a, b) =>
    a.owner.toLowerCase().localeCompare(b.owner.toLowerCase()),
  )
}

export function safeExecutionArgs(
  tx: SafeQueuedTransaction,
  allowedOwners?: readonly Address[],
) {
  const signatures = `0x${usableSafeConfirmations(tx, allowedOwners)
    .map(signatureBytes)
    .join('')}` as Hex
  return [
    getAddress(tx.to),
    BigInt(tx.value ?? 0),
    tx.data ?? '0x',
    Number(tx.operation ?? 0),
    BigInt(tx.safeTxGas ?? 0),
    BigInt(tx.baseGas ?? 0),
    BigInt(tx.gasPrice ?? 0),
    tx.gasToken ?? zeroAddress,
    tx.refundReceiver ?? zeroAddress,
    signatures,
  ] as const
}
