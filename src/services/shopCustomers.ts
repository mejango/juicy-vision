/**
 * Data layer for the Shop → Customers subtab and the item-redemption modal.
 *
 * Ports website/src/discover.js: nftMintsQuery (:550), fetchNftMints (:565),
 * fetchOwnedItems (:18306), resolveShopItemNames (:1275), itemLabelFrom /
 * tallyItems (:1285), and buildTierCashOutMetadata (:478).
 *
 * Store-item purchases are indexed as `mintNftEvents` (one row per minted NFT).
 * The pure helpers (metadata envelope, tallies, customer ranking) are unit
 * tested; the fetch wrappers only marshal bendystraw / on-chain reads.
 */

import { createPublicClient, http, type Address } from 'viem'
import { build721CashOutMetadata } from '@bananapus/nana-sdk-core/v6'
import { VIEM_CHAINS, MAINNET_VIEM_CHAINS, RPC_ENDPOINTS, MAINNET_RPC_ENDPOINTS, type SupportedChainId } from '../constants/chains'
import { safeRequest, getNetworkOption } from './bendystraw/client'
import { fetchProjectNFTTiers } from './nft'

// --- Types ---------------------------------------------------------------

/** One indexed store-item purchase (a minted 721). */
export interface MintRow {
  tierId: number
  beneficiary: string
  from?: string
  timestamp: number
  txHash: string
  tokenId: string
  chainId: number
}

export interface MintFetchResult {
  rows: MintRow[]
  total: number
  /** True when a chain hit the fetch cap (only the latest rows are shown). */
  capped: boolean
}

/** A per-item tally, most-owned first. */
export interface ItemTally {
  tierId: number
  count: number
  label: string
}

/** A customer's rank entry: their address, home chain, and their mint rows. */
export interface CustomerRank {
  address: string
  chainId: number
  mints: MintRow[]
}

/** A currently-owned store item (verified via ownerOf). */
export interface OwnedItem {
  tokenId: string
  tierId: number
}

/** tierId → display name map. */
export type ItemNames = Record<number, string>

/** A chain the project lives on, with its per-chain project id (V6 ids differ per chain). */
export interface ShopChain {
  chainId: number
  projectId: number | string
}

// --- Pure helpers --------------------------------------------------------

/**
 * The metadata envelope carrying redeemed token IDs to the 721 hook, keyed by
 * the hook's cash-out metadata id. `data = abi.encode(uint256[] tokenIds)`; the
 * hook's beforeCashOutRecordedWith reads the ids and burns them.
 *
 * Delegates to the SDK's `build721CashOutMetadata` (nana-sdk-core 1.3.0) — the
 * canonical, byte-identical encoder shared across frontends. It additionally
 * validates the ids (non-empty, unique, positive). `idTarget` MUST be the hook's
 * METADATA_ID_TARGET (the shared implementation address), NOT the clone.
 */
export function buildTierCashOutMetadata(idTarget: Address, tokenIds: Array<bigint | string | number>): `0x${string}` {
  return build721CashOutMetadata({ metadataIdTarget: idTarget, tokenIds: tokenIds.map(t => BigInt(t)) })
}

/** A store item's display name, falling back to "Item #<id>". */
export function itemLabelFrom(names: ItemNames | null | undefined, tierId: number | string): string {
  const id = Number(tierId)
  return (names && names[id]) || `Item #${id}`
}

/** Group mint rows into per-item tallies, most-owned first. */
export function tallyItems(rows: MintRow[], names: ItemNames): ItemTally[] {
  const byTier: Record<number, number> = {}
  for (const m of rows) {
    const k = Number(m.tierId)
    byTier[k] = (byTier[k] || 0) + 1
  }
  return Object.keys(byTier)
    .map(k => ({ tierId: Number(k), count: byTier[Number(k)], label: itemLabelFrom(names, k) }))
    .sort((a, b) => b.count - a.count)
}

/** Distinct customers ranked by items owned (desc), keyed by lowercased address. */
export function rankCustomers(rows: MintRow[]): CustomerRank[] {
  const byCust: Record<string, MintRow[]> = {}
  for (const m of rows) {
    const k = String(m.beneficiary || '').toLowerCase()
    if (!k) continue
    ;(byCust[k] = byCust[k] || []).push(m)
  }
  return Object.keys(byCust)
    .sort((a, b) => byCust[b].length - byCust[a].length)
    .map(k => ({ address: byCust[k][0].beneficiary, chainId: byCust[k][0].chainId, mints: byCust[k] }))
}

// --- Fetch wrappers (thin marshalling; not unit tested) ------------------

const NFT_MINTS_PAGE = 200
const NFT_MINTS_MAX = 1000

function nftMintsQuery(withBeneficiary: boolean): string {
  return (
    'query($projectId: Int!, $chainId: Int!, $version: Int!, $limit: Int!, $offset: Int!' +
    (withBeneficiary ? ', $beneficiary: String!' : '') +
    ') { mintNftEvents(where: { projectId: $projectId, chainId: $chainId, version: $version' +
    (withBeneficiary ? ', beneficiary: $beneficiary' : '') +
    ' }, orderBy: "timestamp", orderDirection: "desc", limit: $limit, offset: $offset) { ' +
    'totalCount items { tierId beneficiary from timestamp txHash tokenId chainId } } }'
  )
}

interface RawMintEvents {
  mintNftEvents?: { totalCount?: number; items?: Array<Partial<MintRow>> }
}

/**
 * All store-item purchases across a project's chains, newest first. Optionally
 * filtered to one beneficiary ("You"). Paginated (200/page) and capped (1000).
 */
export async function fetchNftMints(chains: ShopChain[], beneficiary?: string): Promise<MintFetchResult> {
  const query = nftMintsQuery(!!beneficiary)
  const perChain = await Promise.all(
    chains.map(async chain => {
      const chainId = Number(chain.chainId)
      let rows: MintRow[] = []
      let total = 0
      let offset = 0
      try {
        for (;;) {
          const vars: Record<string, unknown> = {
            projectId: Number(chain.projectId),
            chainId,
            version: 6,
            limit: NFT_MINTS_PAGE,
            offset,
          }
          if (beneficiary) vars.beneficiary = String(beneficiary).toLowerCase()
          const data = await safeRequest<RawMintEvents>(query, vars, getNetworkOption(chainId))
          const res = data.mintNftEvents || {}
          const items = res.items || []
          if (res.totalCount != null) total = Number(res.totalCount) || 0
          rows = rows.concat(items.map(m => ({
            tierId: Number(m.tierId),
            beneficiary: String(m.beneficiary || ''),
            from: m.from,
            timestamp: Number(m.timestamp),
            txHash: String(m.txHash || ''),
            tokenId: String(m.tokenId ?? ''),
            chainId: Number(m.chainId ?? chainId),
          })))
          offset += items.length
          if (!items.length || rows.length >= total || rows.length >= NFT_MINTS_MAX) break
        }
      } catch {
        return { rows: [] as MintRow[], total: 0, capped: false }
      }
      return { rows, total, capped: rows.length >= NFT_MINTS_MAX }
    }),
  )
  let rows: MintRow[] = []
  let total = 0
  let capped = false
  for (const r of perChain) {
    rows = rows.concat(r.rows)
    total += r.total
    if (r.capped) capped = true
  }
  rows.sort((a, b) => b.timestamp - a.timestamp)
  return { rows, total, capped }
}

/**
 * Resolve every store item's display name (tierId → name) via the same media
 * resolver the shop cards use. Missing entries fall back to "Item #<id>".
 */
export async function resolveShopItemNames(projectId: string | number, chainId: number): Promise<ItemNames> {
  try {
    const tiers = await fetchProjectNFTTiers(String(projectId), chainId)
    const map: ItemNames = {}
    for (const t of tiers) {
      if (t.name) map[Number(t.tierId)] = t.name
    }
    return map
  } catch {
    return {}
  }
}

const OWNER_OF_ABI = [{
  name: 'ownerOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const

function clientForChain(chainId: number) {
  const chain = VIEM_CHAINS[chainId as SupportedChainId] || MAINNET_VIEM_CHAINS[chainId as keyof typeof MAINNET_VIEM_CHAINS]
  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0] || MAINNET_RPC_ENDPOINTS[chainId as keyof typeof MAINNET_RPC_ENDPOINTS]?.[0]
  if (!chain || !rpcUrl) throw new Error(`Unsupported chain ${chainId}`)
  return createPublicClient({ chain, transport: http(rpcUrl) })
}

/**
 * The connected wallet's currently-owned store items on one chain: mint events
 * give candidate token IDs, then ownerOf() confirms the wallet still holds them
 * (dropping transferred/burned tokens). `hook` is the 721 hook that mints/owns
 * the tokens (resolved by the caller via getProjectDataHook).
 */
export async function fetchOwnedItems(
  chainId: number,
  projectId: number | string,
  hook: Address,
  wallet: Address,
): Promise<OwnedItem[]> {
  const res = await fetchNftMints([{ chainId, projectId }], wallet)
  const candidates = res.rows.filter(m => Number(m.chainId) === Number(chainId) && m.tokenId)
  if (!candidates.length) return []
  const client = clientForChain(chainId)
  const owned = await Promise.all(
    candidates.map(async m => {
      try {
        const owner = await client.readContract({
          address: hook,
          abi: OWNER_OF_ABI,
          functionName: 'ownerOf',
          args: [BigInt(m.tokenId)],
        })
        return owner && owner.toLowerCase() === wallet.toLowerCase()
          ? ({ tokenId: String(m.tokenId), tierId: Number(m.tierId) } as OwnedItem)
          : null
      } catch {
        return null
      }
    }),
  )
  return owned.filter((o): o is OwnedItem => o !== null)
}
