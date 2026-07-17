/**
 * Gnosis Safe classification + same-address (replay) deploy — ports the Safe
 * bits of website/src/safe.js (fetchSafeInfo, fetchSafeCreation,
 * deploySafeSameAddress) that the Account card needs.
 *
 * Classification is on-chain first-class (getThreshold/getOwners work on ANY
 * chain the Safe is deployed to); the Safe Transaction Service is used where it
 * exists (faster, and required to read a Safe's original creation params for the
 * same-address replay deploy). Everything degrades gracefully — a failed service
 * call falls back to the chain, and a chain read failure yields isSafe:false.
 */

import { encodeFunctionData, getAddress, type Address } from 'viem'
import { publicClientFor } from './projectTx'

const ZERO = '0x0000000000000000000000000000000000000000'

export interface SafeInfo {
  /** True when `address` is a deployed Gnosis Safe on `chainId`. */
  isSafe: boolean
  threshold: number
  owners: Address[]
  /** True when `address` has contract code on `chainId` (a Safe elsewhere may be undeployed here). */
  deployed: boolean
}

export interface SafeCreation {
  factory: Address
  singleton: Address
  initializer: `0x${string}`
  saltNonce: bigint
}

const SAFE_ABI = [
  { type: 'function', name: 'getThreshold', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getOwners', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
] as const

// createProxyWithNonce reproduces the SAME Safe address on any chain sharing the
// factory+singleton: address = CREATE2(factory, keccak(initializer)+saltNonce, singleton).
const PROXY_FACTORY_ABI = [
  {
    type: 'function',
    name: 'createProxyWithNonce',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_singleton', type: 'address' },
      { name: 'initializer', type: 'bytes' },
      { name: 'saltNonce', type: 'uint256' },
    ],
    outputs: [{ type: 'address' }],
  },
] as const

// Safe wallet-app / Transaction-Service chain short-names. The per-network hosts
// now 308-redirect to the unified gateway (api.safe.global/tx-service/<prefix>),
// which returns 200 for all listed chains with no API key. Chains absent here
// (most testnets) fall back to the on-chain path.
const SAFE_PREFIX: Record<number, string> = {
  1: 'eth',
  10: 'oeth',
  8453: 'base',
  42161: 'arb1',
  11155111: 'sep',
}

function txServiceBase(chainId: number): string | null {
  const prefix = SAFE_PREFIX[chainId]
  return prefix ? `https://api.safe.global/tx-service/${prefix}` : null
}

/** Safe{Wallet} home for a Safe on `chainId` — where an owner can "Add another network". */
export function safeAppHomeLink(chainId: number, safe: Address): string {
  const prefix = SAFE_PREFIX[chainId] ?? 'eth'
  return `https://app.safe.global/home?safe=${prefix}:${safe}`
}

/** True when a hosted Safe Transaction Service covers this chain. */
export function hasSafeService(chainId: number): boolean {
  return !!txServiceBase(chainId)
}

/** "Requires 2 of 3 signatures" — pure, unit-tested. */
export function formatSafePolicy(threshold: number, ownerCount: number): string {
  return `Requires ${threshold} of ${ownerCount} signature${ownerCount === 1 ? '' : 's'}`
}

function cs(address: string): Address {
  try {
    return getAddress(address)
  } catch {
    return address as Address
  }
}

// The Transaction Service rejects non-checksummed addresses (HTTP 422). Checksum everything sent.
async function fetchSafeFromService(
  address: Address,
  chainId: number,
): Promise<{ threshold: number; owners: Address[] } | null> {
  const base = txServiceBase(chainId)
  if (!base) return null
  try {
    const res = await fetch(`${base}/api/v1/safes/${cs(address)}/`)
    if (!res.ok) return null
    const data = (await res.json()) as { threshold?: number; owners?: Address[] }
    if (data && data.threshold != null && Array.isArray(data.owners) && data.owners.length) {
      return { threshold: Number(data.threshold), owners: data.owners as Address[] }
    }
    return null
  } catch {
    return null
  }
}

const _safeCache = new Map<string, Promise<SafeInfo>>()

/**
 * Classify `address` on `chainId`: a deployed Safe → { isSafe:true, threshold,
 * owners }; an EOA or non-Safe contract → isSafe:false. `deployed` reports
 * whether the address has code on this chain (a same-address Safe not yet
 * deployed here reads as isSafe:false, deployed:false). Cached per (address, chainId).
 */
export function fetchSafeInfo(address: Address, chainId: number): Promise<SafeInfo> {
  const empty: SafeInfo = { isSafe: false, threshold: 0, owners: [], deployed: false }
  if (!address || address.toLowerCase() === ZERO || !chainId) return Promise.resolve(empty)
  const key = `${chainId}:${address.toLowerCase()}`
  const cached = _safeCache.get(key)
  if (cached) return cached

  const p = (async (): Promise<SafeInfo> => {
    const client = publicClientFor(chainId)

    let deployed = false
    try {
      const code = await client.getCode({ address })
      deployed = !!code && code !== '0x'
    } catch {
      /* RPC hiccup — the service call below may still classify it */
    }

    // Transaction Service first (fast, no key); its presence implies deployed.
    const svc = await fetchSafeFromService(address, chainId)
    if (svc) return { isSafe: true, threshold: svc.threshold, owners: svc.owners, deployed: true }

    // On-chain fallback (works on any chain the Safe is deployed to).
    if (deployed) {
      try {
        const [threshold, owners] = await Promise.all([
          client.readContract({ address, abi: SAFE_ABI, functionName: 'getThreshold' }) as Promise<bigint>,
          client.readContract({ address, abi: SAFE_ABI, functionName: 'getOwners' }) as Promise<Address[]>,
        ])
        if (owners?.length && BigInt(threshold) > 0n) {
          return { isSafe: true, threshold: Number(threshold), owners, deployed: true }
        }
      } catch {
        /* deployed contract that isn't a Safe */
      }
    }
    return { isSafe: false, threshold: 0, owners: [], deployed }
  })()

  _safeCache.set(key, p)
  // Never cache a rejection.
  p.catch(() => _safeCache.delete(key))
  return p
}

/** Drop a cached classification (e.g. after a same-address deploy lands). */
export function invalidateSafeInfo(address: Address, chainId: number): void {
  _safeCache.delete(`${chainId}:${address.toLowerCase()}`)
}

/**
 * Read the Safe's original creation params from the Transaction Service of ANY
 * chain where it already exists (params are chain-independent) — the input to a
 * same-address replay deploy. Returns null when no covered chain has it.
 */
export async function fetchSafeCreation(safe: Address): Promise<SafeCreation | null> {
  const candidates = [1, 42161, 8453, 10, 11155111]
  for (const chainId of candidates) {
    const base = txServiceBase(chainId)
    if (!base) continue
    try {
      const res = await fetch(`${base}/api/v1/safes/${cs(safe)}/creation/`)
      if (!res.ok) continue
      const j = (await res.json()) as {
        factoryAddress?: string
        masterCopy?: string
        setupData?: `0x${string}`
        saltNonce?: string
      }
      if (j && j.factoryAddress && j.masterCopy && j.setupData) {
        return {
          factory: cs(j.factoryAddress),
          singleton: cs(j.masterCopy),
          initializer: j.setupData,
          saltNonce: BigInt(j.saltNonce ?? 0),
        }
      }
    } catch {
      /* try the next chain */
    }
  }
  return null
}

/**
 * Build the same-address deploy call: createProxyWithNonce on the original
 * factory with the exact singleton/initializer/saltNonce the Safe was first
 * deployed with — reproduces the identical address on `chainId`. Deterministic
 * and verified post-send (the deployed address MUST equal the expected Safe).
 */
export function buildDeploySafeRequest(
  chainId: number,
  creation: SafeCreation,
): { chainId: number; to: Address; data: `0x${string}` } {
  return {
    chainId,
    to: cs(creation.factory),
    data: encodeFunctionData({
      abi: PROXY_FACTORY_ABI,
      functionName: 'createProxyWithNonce',
      args: [cs(creation.singleton), creation.initializer, creation.saltNonce],
    }),
  }
}

/**
 * Confirm the Safe landed at `expectedSafe` after a deploy — retries because a
 * flaky RPC can briefly return empty code for a just-deployed contract. A false
 * result means the target chain's factory/singleton differ from the original.
 */
export async function verifySafeDeployed(chainId: number, expectedSafe: Address): Promise<boolean> {
  const client = publicClientFor(chainId)
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = await client.getCode({ address: expectedSafe }).catch(() => null)
    if (code && code !== '0x') return true
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  return false
}
