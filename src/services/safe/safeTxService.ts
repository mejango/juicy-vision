/**
 * Safe Transaction Service reads used by the Account view: enumerate the Safes
 * an address co-owns so their projects can be surfaced alongside directly
 * owned ones. Chains without a hosted service are skipped — enumeration is a
 * service-only capability (there is no on-chain reverse owner index).
 */

import { getAddress, type Address } from 'viem'

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
