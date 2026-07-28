/**
 * Sucker bridge data + tx layer for the Settlement subtab and the
 * Move-between-chains flow. Ports website/src/discover.js:
 *   - suckerLeafProof / suckerBranchRoot (:19950/:19966) — MerkleLib depth-32
 *     incremental tree (Z[i+1]=keccak(Z[i]‖Z[i]); leaf-left when index bit==0)
 *   - findToRemoteValue / findSyncValue (:19985/:19585) — escalating-value
 *     simulation to discover the bridge messaging fee. NEVER 0 on CCIP: a zero
 *     transport payment flips a CCIP sucker to LINK-fee mode, which pulls
 *     unapproved LINK from the caller via transferFrom.
 *   - fetchBridgeTransactions (:14841) — queued-movement reconstruction from
 *     the InsertToOutboxTree log scan, with the recomputed root verified
 *     against the emitted root AND the destination inbox root.
 *   - fetchOps / readGossipAdjustment / peerChainAccountsOf reads
 *     (:21849/:21829/:19483) — per-chain composition + gossip snapshots.
 *
 * All reads are null-tolerant per chain (the UI renders an em dash); tx
 * helpers throw descriptive errors instead of guessing. The RPC client
 * factory is injectable for tests.
 */

import {
  encodeFunctionData,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import {
  jbContractAddress,
  jbControllerAbi,
  jbDirectoryAbi,
  jbMultiTerminalAbi,
  jbSuckerRegistryAbi,
  jbTerminalStoreAbi,
  jbTokensAbi,
  type JBChainId,
} from '@bananapus/nana-sdk-core'
import {
  CCIP_SUCKER_TRANSPORT_VALUES,
  NATIVE_SUCKER_TRANSPORT_VALUES,
  assertSuckerTransportValue,
  buildSyncAccountingDataTx,
  buildToRemoteTx,
  classifySuckerMovement,
  classifySuckerTransport,
  findSuckerTransportValue,
  getAccountingContexts,
  getAllV6SuckerPairs,
  getSuckerMovements,
  getV6SuckerPairs,
  jbSuckerV6ViewAbi,
  relativeSuckerDrift,
  suckerBranchRoot as sdkSuckerBranchRoot,
  suckerBytes32ToAddress,
  suckerHashPair as sdkSuckerHashPair,
  suckerLeafProof as sdkSuckerLeafProof,
  suckerTimestampSeconds,
  suckerZeroHashes as sdkSuckerZeroHashes,
} from '@bananapus/nana-sdk-core/v6'
import { NATIVE_TOKEN, JB_CONTRACTS, JB_ROUTER_TERMINAL, JB_ROUTER_TERMINAL_REGISTRY } from '../constants'
import { cashOutProtocolFee, quotedOutputFloor } from '../utils/terminalPreview'
import { publicClientFor } from './projectTx'
import { describeAccountingToken, type YouAccountingToken } from './youPosition'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SuckerInfra = 'CCIP' | 'native' | 'unknown'

export interface SuckerPair {
  local: Address
  remote: Address
  remoteChainId: number
}

export interface BridgeRoute {
  a: number
  b: number
  infra: SuckerInfra
}

export interface CompositionToken {
  token: Address
  balance: bigint | null
  decimals: number
  symbol: string
}

export interface CompositionRow {
  chainId: number
  /** Controller totalTokenSupplyWithReservedTokensOf. null = unreadable. */
  supply: bigint | null
  /** Terminal-recorded balance per accounting context. */
  tokens: CompositionToken[]
  /** True when every context balance read succeeded. */
  tokensVerified: boolean
  /** Reclaim for 1 token at current supply + surplus, in the accounting token. */
  unitValue: bigint | null
  acct: YouAccountingToken | null
  /** Supply as a gossip snapshot would record it (controller + data-hook adjustment). */
  gossipSupply: bigint | null
  gossipTokens: CompositionToken[]
  /** False when any live source value is unreadable — staleness must report Unverified, not drift. */
  gossipVerified: boolean
}

export interface GossipPeerRow {
  peerChainId: number
  /** What the viewing chain's registry knows about the peer's supply. */
  supply: bigint
  balances: CompositionToken[]
  /** Unix seconds of the snapshot (0 = never), unpacked from (ts<<128|seq). */
  snapshot: number
  /** The PEER chain's sucker pointing back — syncAccountingData runs there (sync PUSHES local→peer). */
  syncSucker: Address | null
}

export interface GossipChainKnowledge {
  chainId: number
  peers: GossipPeerRow[]
}

export type MovementStatus = 'pending' | 'claimable' | 'claimed'

export interface QueuedMovement {
  createdAt: number | null
  chainId: number
  peerChainId: number
  beneficiary: Address
  beneficiary32: Hex
  projectTokenCount: bigint
  terminalTokenAmount: bigint
  status: MovementStatus
  index: number
  sourceSucker: Address
  peerSucker: Address
  metadata: Hex
  leafHash: Hex
  /** 32-element sibling path; present only when claimable (verified against the inbox root). */
  proof: Hex[] | null
  /** The destination inbox root the proof was verified against (claimable rows). */
  inboxRoot: Hex | null
  /** pending + not yet shipped by toRemote — the group Execute covers it. */
  canExecute: boolean
  token: Address
  remoteToken: Address
  tokenDecimals: number
  tokenSymbol: string
  infra: SuckerInfra
}

export interface QueuedMovementsResult {
  rows: QueuedMovement[]
  /** Chains whose scan failed (RPC/log gaps) — the UI renders them as unreadable, never empty. */
  failedChains: number[]
}

export interface SuckerBridgeDeps {
  clientFor?: (chainId: number) => PublicClient
}

/**
 * A chain the project lives on, with the project's id ON THAT CHAIN. V6 project
 * ids are independent per chain, so every per-chain read/tx must use the id for
 * that specific chain — never the home id everywhere.
 */
export interface SuckerChainProject {
  chainId: number
  projectId: number | string | bigint
}

// ---------------------------------------------------------------------------
// Merkle helpers (pure) — exact port of the website's MerkleLib mirror
// ---------------------------------------------------------------------------

export const BYTES32_ZERO = `0x${'0'.repeat(64)}` as Hex

export function suckerHashPair(a: Hex, b: Hex): Hex {
  return sdkSuckerHashPair(a, b)
}

/** z[0..32]; z[32] === 0x27ae5ba0… (the empty-tree root). */
export function suckerZeroHashes(): Hex[] {
  return [...sdkSuckerZeroHashes()]
}

/** Sibling path (32 elements) for the leaf at `index`, given the dense leaf-hash array [0,count). */
export function suckerLeafProof(leafHashes: readonly Hex[], index: number): Hex[] {
  return [...sdkSuckerLeafProof(leafHashes, index)]
}

/** Recompute the root from a leaf + proof (mirrors MerkleLib.branchRoot) — used to verify before submitting. */
export function suckerBranchRoot(leaf: Hex, proof: readonly Hex[], index: number): Hex {
  return sdkSuckerBranchRoot(leaf, proof, index)
}

// ---------------------------------------------------------------------------
// Fee-escalation simulation (pure ladder logic + on-chain wrappers)
// ---------------------------------------------------------------------------

/** 0.001 … 0.5 ETH of CCIP transport budget. A too-low tier reverts; the first success wins (excess refunds on-chain). */
export const CCIP_TRANSPORT_LADDER = CCIP_SUCKER_TRANSPORT_VALUES

/** Native bridges may accept 0 for a sync push; escalate if not. */
export const NATIVE_SYNC_LADDER = NATIVE_SUCKER_TRANSPORT_VALUES

/**
 * Try each value in order; the first whose simulation resolves wins. All
 * rejecting → null (callers surface an error instead of prompting a reverting
 * or LINK-pulling transaction).
 */
export async function escalateValue(
  values: readonly bigint[],
  simulate: (value: bigint) => Promise<unknown>,
): Promise<bigint | null> {
  return findSuckerTransportValue(values, simulate)
}

/**
 * Guard: a CCIP sucker must receive a positive transport payment
 * (msg.value − base fee). Zero transport flips it to LINK-fee mode, which
 * pulls unapproved LINK from the caller. Throws instead of letting a 0-value
 * CCIP send through.
 */
export function assertCcipTransport(infra: SuckerInfra, value: bigint, baseFee: bigint = 0n): void {
  try {
    assertSuckerTransportValue(infra === 'CCIP' ? 'ccip' : infra, value, baseFee)
  } catch {
    if (infra === 'CCIP') {
      throw new Error('A CCIP bridge message needs a positive native fee budget — refusing to send zero.')
    }
    throw new Error('The bridge type could not be verified, so its fee regime is unknown. Try again shortly.')
  }
}

// ---------------------------------------------------------------------------
// Queued-movement classification (pure)
// ---------------------------------------------------------------------------

export function classifyMovementStatus(input: {
  executed: boolean
  index: number
  deliveredCount: number
  sentCount: number
}): { status: MovementStatus; canExecute: boolean } {
  return classifySuckerMovement(input)
}

// ---------------------------------------------------------------------------
// Gossip staleness (pure)
// ---------------------------------------------------------------------------

export type StalenessLevel = 'synced' | 'slight' | 'danger' | 'unknown'

export interface Staleness {
  level: StalenessLevel
  label: string
  pct?: number
}

/** Relative drift between two values, as a 0..1 fraction of the larger one. */
export function relativeDrift(a: bigint, b: bigint): number {
  return relativeSuckerDrift(a, b)
}

/** Drift below the keeper's 5% sync threshold stays green — it's the % that matters. */
export function stalenessFromPct(worst: number): Staleness {
  if (worst === 0) return { level: 'synced', label: 'In sync', pct: 0 }
  const label = `${Math.round(worst * 10000) / 100}% stale`
  if (worst <= 0.05) return { level: 'slight', label, pct: worst }
  return { level: 'danger', label, pct: worst }
}

const GOSSIP_U128_MAX = (1n << 128n) - 1n

/**
 * Canonical accounting-context key: native and USDC normalize across chains
 * (canonical USDC addresses differ per chain); anything else keys by address.
 */
export function accountingContextKey(token: Address, symbol: string, decimals: number): string {
  const lc = token.toLowerCase()
  if (lc === NATIVE_TOKEN.toLowerCase()) return `native@${decimals}`
  if (symbol === 'USDC') return `usdc@${decimals}`
  return `${lc}@${decimals}`
}

function contextBalanceMap(rows: readonly CompositionToken[]): Record<string, bigint> {
  const out: Record<string, bigint> = {}
  for (const row of rows) {
    if (row.balance == null) continue
    const key = accountingContextKey(row.token, row.symbol, row.decimals)
    // Snapshots cap each source context to uint128, and the receiver's folding saturates too.
    let amount = row.balance > GOSSIP_U128_MAX ? GOSSIP_U128_MAX : row.balance
    amount = (out[key] ?? 0n) + amount
    out[key] = amount > GOSSIP_U128_MAX ? GOSSIP_U128_MAX : amount
  }
  return out
}

const customKeysOf = (map: Record<string, bigint>): string[] =>
  Object.keys(map)
    .filter(key => !key.startsWith('native@') && !key.startsWith('usdc@'))
    .sort()

/**
 * Freshness of a gossiped snapshot vs the peer's actual current values —
 * worst relative drift across supply and every accounting context. Unreadable
 * live values, or custom-token contexts whose addresses don't line up (a
 * sucker token mapping we haven't verified), report Unverified instead of
 * inventing drift a user would pay to "fix".
 */
export function gossipSnapshotStaleness(
  peer: Pick<GossipPeerRow, 'supply' | 'balances'>,
  live: Pick<CompositionRow, 'gossipSupply' | 'gossipTokens' | 'gossipVerified'> | undefined,
): Staleness {
  if (!live || live.gossipSupply == null || !live.gossipVerified) return { level: 'unknown', label: 'Unverified' }
  const snapshot = contextBalanceMap(peer.balances)
  const actual = contextBalanceMap(live.gossipTokens)
  if (JSON.stringify(customKeysOf(snapshot)) !== JSON.stringify(customKeysOf(actual))) {
    return { level: 'unknown', label: 'Unverified' }
  }
  let worst = relativeDrift(peer.supply, live.gossipSupply)
  const keys = new Set([...Object.keys(snapshot), ...Object.keys(actual)])
  for (const key of keys) {
    const drift = relativeDrift(snapshot[key] ?? 0n, actual[key] ?? 0n)
    if (drift > worst) worst = drift
  }
  return stalenessFromPct(worst)
}

/** Packed sucker timestamp (block.timestamp << 128 | seq) → unix seconds. */
export function unpackSuckerTimestamp(raw: bigint): number {
  return suckerTimestampSeconds(raw)
}

/** "Snapshot N ago" age label for a unix timestamp (0 → never). */
export function snapshotAge(ts: number, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  if (!ts) return 'never'
  const s = nowSeconds - ts
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

// Canonical sucker reads, writes, and movement event definitions live in the SDK.
const suckerViewAbi = jbSuckerV6ViewAbi

/** The registry's aggregated cross-chain accounting record (direct + gossiped, folded per source chain). */
const peerChainAdjustedAccountsAbi = [
  {
    type: 'function',
    name: 'peerChainAdjustedAccountsOf',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      { name: 'supply', type: 'uint256' },
      {
        name: 'contexts',
        type: 'tuple[]',
        components: [
          { name: 'token', type: 'bytes32' },
          { name: 'decimals', type: 'uint8' },
          { name: 'surplus', type: 'uint128' },
          { name: 'balance', type: 'uint128' },
        ],
      },
    ],
  },
] as const

const feelessAbi = [
  {
    type: 'function',
    name: 'isFeelessFor',
    stateMutability: 'view',
    inputs: [
      { name: 'addr', type: 'address' },
      { name: 'projectId', type: 'uint256' },
      { name: 'caller', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

const erc20BalanceOfAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

// ---------------------------------------------------------------------------
// Read layer
// ---------------------------------------------------------------------------

const clientOf = (deps: SuckerBridgeDeps, chainId: number): PublicClient =>
  (deps.clientFor ?? (publicClientFor as (chainId: number) => PublicClient))(chainId)

export function suckerRegistryAddress(chainId: number): Address | null {
  const byChain = jbContractAddress['6'].JBSuckerRegistry as Record<string, Address> | undefined
  return byChain?.[String(chainId)] ?? null
}

const bytes32ToAddress = (value: Hex | string): Address => suckerBytes32ToAddress(value as Hex)
const isZeroHex = (value: string | null | undefined): boolean => !value || /^0x0+$/.test(value)

/** Active sucker pairs for a project on `chainId`. RPC failures propagate so callers can distinguish "no routes" from "could not verify". */
export async function readSuckerPairsOf(
  projectId: number | string | bigint,
  chainId: number,
  deps: SuckerBridgeDeps = {},
): Promise<SuckerPair[]> {
  if (!suckerRegistryAddress(chainId)) return []
  const pairs = await getV6SuckerPairs(clientOf(deps, chainId), {
    chainId: chainId as JBChainId,
    projectId: BigInt(projectId),
  })
  return pairs.map(pair => ({ local: pair.local, remote: pair.remote, remoteChainId: Number(pair.remoteChainId) }))
}

/**
 * Movement history must include deprecated suckers too: their leaves remain
 * claimable after a route is replaced, and `suckerPairsOf` intentionally
 * returns active routes only.
 */
export async function readAllSuckerPairsOf(
  projectId: number | string | bigint,
  chainId: number,
  deps: SuckerBridgeDeps = {},
): Promise<SuckerPair[]> {
  if (!suckerRegistryAddress(chainId)) throw new Error(`Sucker registry unavailable on chain ${chainId}.`)
  const pairs = await getAllV6SuckerPairs(clientOf(deps, chainId), {
    chainId: chainId as JBChainId,
    projectId: BigInt(projectId),
  })
  return pairs.map(pair => ({ local: pair.local, remoteChainId: Number(pair.remoteChainId), remote: pair.remote }))
}

/**
 * CCIP suckers expose a non-zero CCIP_ROUTER(); native-bridge suckers revert
 * on it but answer OPMESSENGER/ARBINBOX. Only when no probe answers is the
 * infra genuinely unknown — treating an RPC failure as native could select
 * the wrong fee regime (LINK-fee mode on a CCIP sucker).
 */
export async function classifySuckerInfra(
  chainId: number,
  sucker: Address,
  deps: SuckerBridgeDeps = {},
): Promise<SuckerInfra> {
  const transport = await classifySuckerTransport(clientOf(deps, chainId), sucker)
  return transport === 'ccip' ? 'CCIP' : transport
}

/**
 * Distinct bridge routes with the infra each uses. Routes are symmetric, so
 * dedup by the sorted chain pair — but a pair can carry BOTH a native and a
 * CCIP sucker, so a native edge and a CCIP edge on the same pair both stay.
 */
export async function fetchBridgeRoutes(
  chainProjects: readonly SuckerChainProject[],
  deps: SuckerBridgeDeps = {},
): Promise<BridgeRoute[]> {
  const lists = await Promise.all(
    // Each chain resolves its sucker pairs with ITS OWN project id.
    chainProjects.map(async ({ chainId, projectId }) => {
      const pairs = await readSuckerPairsOf(projectId, chainId, deps)
      return pairs.map(pair => ({ a: chainId, b: pair.remoteChainId, local: pair.local }))
    }),
  )
  const all = lists.flat()
  const classified = await Promise.all(
    all.map(async entry => ({ ...entry, infra: await classifySuckerInfra(entry.a, entry.local, deps) })),
  )
  const seen = new Set<string>()
  const routes: (BridgeRoute & { _lo: number; _hi: number })[] = []
  for (const entry of classified) {
    const [lo, hi] = [entry.a, entry.b].sort((x, y) => x - y)
    const key = `${lo}-${hi}:${entry.infra}`
    if (seen.has(key)) continue
    seen.add(key)
    routes.push({ a: entry.a, b: entry.b, infra: entry.infra, _lo: lo, _hi: hi })
  }
  routes.sort((x, y) => x._lo - y._lo || x._hi - y._hi || x.infra.localeCompare(y.infra))
  return routes.map(({ a, b, infra }) => ({ a, b, infra }))
}

const ONE_TOKEN = 10n ** 18n

/**
 * Per-chain composition: supply, terminal-recorded balances per accounting
 * context, unit cash-out value — plus the gossip-comparable view (supply +
 * balances as a snapshot would record them, including any data-hook
 * adjustment via peerChainAdjustedAccountsOf). Null-tolerant per field.
 */
export async function fetchCompositionRows(
  chainProjects: readonly SuckerChainProject[],
  deps: SuckerBridgeDeps = {},
): Promise<CompositionRow[]> {
  return Promise.all(
    // Each chain reads its composition with ITS OWN project id (V6 ids differ per chain).
    chainProjects.map(async ({ chainId, projectId }) => {
      const pid = BigInt(projectId)
      const empty: CompositionRow = {
        chainId,
        supply: null,
        tokens: [],
        tokensVerified: false,
        unitValue: null,
        acct: null,
        gossipSupply: null,
        gossipTokens: [],
        gossipVerified: false,
      }
      let client: PublicClient
      try {
        client = clientOf(deps, chainId)
      } catch {
        return empty
      }

      const controllerJob = client
        .readContract({ address: JB_CONTRACTS.JBDirectory, abi: jbDirectoryAbi, functionName: 'controllerOf', args: [pid] })
        .catch(() => null)
      const terminalsJob = client
        .readContract({ address: JB_CONTRACTS.JBDirectory, abi: jbDirectoryAbi, functionName: 'terminalsOf', args: [pid] })
        .then(list => ({ verified: true, list: (list ?? []) as readonly Address[] }))
        .catch(() => ({ verified: false, list: [] as readonly Address[] }))
      const contextsJob = getAccountingContexts(client, { chainId: chainId as JBChainId, projectId: pid }).catch(() => null)

      const [controller, surface, contexts] = await Promise.all([controllerJob, terminalsJob, contextsJob])

      const controllerReads =
        controller && controller !== zeroAddress
          ? await Promise.all([
              client
                .readContract({
                  address: controller,
                  abi: jbControllerAbi,
                  functionName: 'totalTokenSupplyWithReservedTokensOf',
                  args: [pid],
                })
                .catch(() => null),
              client
                .readContract({ address: controller, abi: jbControllerAbi, functionName: 'currentRulesetOf', args: [pid] })
                .catch(() => null),
            ])
          : [null, null]
      const supply = controllerReads[0]
      const currentRuleset = controllerReads[1]

      const described = (contexts ?? []).map(context => describeAccountingToken(chainId, context))
      const acct = described[0] ?? null

      // Terminal-recorded balance per accounting context — the value a gossip snapshot records.
      const tokens: CompositionToken[] = await Promise.all(
        described.map(async token => ({
          token: token.token,
          decimals: token.decimals,
          symbol: token.symbol,
          balance: await client
            .readContract({
              address: JB_CONTRACTS.JBTerminalStore,
              abi: jbTerminalStoreAbi,
              functionName: 'balanceOf',
              args: [JB_CONTRACTS.JBMultiTerminal, pid, token.token],
            })
            .catch(() => null),
        })),
      )
      const tokensVerified = contexts != null && tokens.every(token => token.balance != null)

      // Unit value = reclaim for 1 token; only meaningful once there's at least a token of supply.
      let unitValue: bigint | null = null
      if (supply != null && supply >= ONE_TOKEN && acct) {
        unitValue = await client
          .readContract({
            address: JB_CONTRACTS.JBTerminalStore,
            abi: jbTerminalStoreAbi,
            functionName: 'currentReclaimableSurplusOf',
            args: [pid, ONE_TOKEN, [], [acct.token], BigInt(acct.decimals), BigInt(acct.currency)],
          })
          .catch(() => null)
      }

      // The sucker treats a non-supporting/reverting data hook as no adjustment; an RPC
      // failure can't be told apart, so a failed read stays conservative (unverified).
      const metadata = currentRuleset ? (currentRuleset as unknown as [unknown, { dataHook: Address }])[1] : null
      const dataHook = metadata?.dataHook
      let adjustment: { verified: boolean; supply: bigint; tokens: CompositionToken[] }
      if (!currentRuleset) {
        adjustment = { verified: false, supply: 0n, tokens: [] }
      } else if (!dataHook || dataHook === zeroAddress) {
        adjustment = { verified: true, supply: 0n, tokens: [] }
      } else {
        adjustment = await client
          .readContract({ address: dataHook, abi: peerChainAdjustedAccountsAbi, functionName: 'peerChainAdjustedAccountsOf', args: [pid] })
          .then(([adjSupply, adjContexts]) => ({
            verified: true,
            supply: adjSupply,
            tokens: (adjContexts ?? []).map(context => {
              const token = bytes32ToAddress(context.token)
              const decimals = Number(context.decimals)
              const symbol = describeAccountingToken(chainId, { token, decimals, currency: 0 }).symbol
              return { token, balance: context.balance, decimals, symbol }
            }),
          }))
          .catch(() => ({ verified: false, supply: 0n, tokens: [] as CompositionToken[] }))
      }

      // Forwarding router terminals record 0 balances (their surplus reads are hardwired
      // to 0), so they only add zero-amount duplicate contexts to a snapshot — having them
      // listed must not block verification.
      const exempt = new Set([JB_ROUTER_TERMINAL.toLowerCase(), JB_ROUTER_TERMINAL_REGISTRY.toLowerCase()])
      const accounted = surface.list.filter(terminal => !exempt.has(terminal.toLowerCase()))
      const standardOnly = accounted.every(terminal => terminal.toLowerCase() === JB_CONTRACTS.JBMultiTerminal.toLowerCase())
      const standardListed = surface.list.some(terminal => terminal.toLowerCase() === JB_CONTRACTS.JBMultiTerminal.toLowerCase())

      const baseGossipTokens = standardListed ? tokens : []
      let gossipTokens = baseGossipTokens.concat(adjustment.tokens)
      const gossipVerified =
        supply != null && surface.verified && standardOnly && (!standardListed || tokensVerified) && adjustment.verified

      let gossipSupply = supply
      if (gossipSupply != null && adjustment.verified) {
        const maxUint = (1n << 256n) - 1n
        // SuckerLib drops both parts of a hook adjustment when its supply would overflow.
        if (adjustment.supply <= maxUint - gossipSupply) gossipSupply += adjustment.supply
        else gossipTokens = baseGossipTokens
      }

      return { chainId, supply, tokens, tokensVerified, unitValue, acct, gossipSupply, gossipTokens, gossipVerified }
    }),
  )
}

/**
 * What each chain knows about its peers' accounting, read from the REGISTRY's
 * aggregated `peerChainAccountsOf` — NOT individual suckers — because a
 * transitively-gossiped record can live on a different sucker than the direct
 * A↔B one. Timestamps arrive packed (ts<<128|seq) and are unpacked here.
 */
export async function fetchGossipKnowledge(
  chainProjects: readonly SuckerChainProject[],
  deps: SuckerBridgeDeps = {},
): Promise<GossipChainKnowledge[]> {
  if (chainProjects.length < 2) return []
  const chainIds = chainProjects.map(cp => cp.chainId)
  const pairLists = await Promise.all(
    chainProjects.map(async ({ chainId, projectId }) => ({ chainId, pairs: await readSuckerPairsOf(projectId, chainId, deps) })),
  )
  const pairsByChain = new Map(pairLists.map(entry => [entry.chainId, entry.pairs]))
  return Promise.all(
    // Each viewing chain reads its own registry with ITS OWN project id.
    chainProjects.map(async ({ chainId: viewChainId, projectId }) => {
      const pid = BigInt(projectId)
      const registry = suckerRegistryAddress(viewChainId)
      if (!registry) throw new Error(`Sucker registry unavailable on chain ${viewChainId}.`)
      const accounts = await clientOf(deps, viewChainId).readContract({
        address: registry,
        abi: jbSuckerRegistryAbi,
        functionName: 'peerChainAccountsOf',
        args: [pid, BigInt(viewChainId)],
      })
      const byChain = new Map<number, { supply: bigint; balances: CompositionToken[]; snapshot: number }>()
      for (const account of accounts ?? []) {
        byChain.set(Number(account.chainId), {
          supply: account.totalSupply,
          balances: (account.contexts ?? []).map(context => {
            const token = bytes32ToAddress(context.token)
            const decimals = Number(context.decimals)
            return {
              token,
              balance: context.balance,
              decimals,
              symbol: describeAccountingToken(viewChainId, { token, decimals, currency: 0 }).symbol,
            }
          }),
          snapshot: unpackSuckerTimestamp(account.timestamp),
        })
      }
      // One row per peer chain the project spans (so even not-yet-known peers show as "never").
      const peers: GossipPeerRow[] = chainIds
        .filter(peerChainId => peerChainId !== viewChainId)
        .map(peerChainId => {
          const record = byChain.get(peerChainId) ?? { supply: 0n, balances: [], snapshot: 0 }
          // Sync runs on the PEER's sucker pointing back at the viewing chain (sync PUSHES local→peer).
          const syncSucker =
            (pairsByChain.get(peerChainId) ?? []).find(pair => pair.remoteChainId === viewChainId)?.local ?? null
          return { peerChainId, supply: record.supply, balances: record.balances, snapshot: record.snapshot, syncSucker }
        })
      return { chainId: viewChainId, peers }
    }),
  )
}

// ---------------------------------------------------------------------------
// Queued movements (log scan + merkle reconstruction)
// ---------------------------------------------------------------------------

async function scanChainMovements(
  pid: bigint,
  chainId: number,
  remotePidFor: (chainId: number) => bigint | null,
  deps: SuckerBridgeDeps,
): Promise<QueuedMovement[]> {
  const client = clientOf(deps, chainId)
  const sourceContexts = (
    await getAccountingContexts(client, { chainId: chainId as JBChainId, projectId: pid })
  ).map(context => describeAccountingToken(chainId, context))
  const pairs = await readAllSuckerPairsOf(pid, chainId, deps)
  const rows: QueuedMovement[] = []

  await Promise.all(
    pairs.map(async ({ local: sourceSucker, remoteChainId, remote: peerSucker }) => {
      const remotePid = remotePidFor(remoteChainId)
      if (remotePid == null) throw new Error(`No known project id on peer chain ${remoteChainId}.`)

      const remoteClient = clientOf(deps, remoteChainId)
      const remoteContexts = (
        await getAccountingContexts(remoteClient, {
          chainId: remoteChainId as JBChainId,
          projectId: remotePid,
        })
      ).map(context => describeAccountingToken(remoteChainId, context))
      const infra = await classifySuckerInfra(chainId, sourceSucker, deps)

      await Promise.all(
        sourceContexts.map(async sourceContext => {
          // Cleared historical mappings can only be recovered from one exact
          // cross-chain accounting-context match. The SDK verifies any supplied
          // override against a live mapping before reconstructing movements.
          const sourceKey = accountingContextKey(
            sourceContext.token,
            sourceContext.symbol,
            sourceContext.decimals,
          )
          const historicalCandidates = remoteContexts.filter(
            context =>
              accountingContextKey(context.token, context.symbol, context.decimals) === sourceKey,
          )
          const historicalRemoteToken =
            historicalCandidates.length === 1 ? historicalCandidates[0].token : undefined

          const movements = await getSuckerMovements(client, remoteClient, {
            sourceSucker,
            destinationSucker: peerSucker,
            sourceToken: sourceContext.token,
            remoteToken: historicalRemoteToken,
          })
          if (movements.length === 0) return

          const remoteToken = movements[0].remoteToken
          if (movements.some(movement => movement.remoteToken.toLowerCase() !== remoteToken.toLowerCase())) {
            throw new Error('The bridge returned inconsistent destination tokens.')
          }
          const remoteContext = remoteContexts.find(
            context => context.token.toLowerCase() === remoteToken.toLowerCase(),
          )
          if (!remoteContext || remoteContext.decimals !== sourceContext.decimals) {
            throw new Error(
              'The bridge token mapping does not match a verified destination accounting context.',
            )
          }

          const timestamps = new Map<string, number>()
          await Promise.all(
            [...new Set(movements.map(movement => movement.blockNumber.toString()))].map(
              async blockNumber => {
                const block = await client.getBlock({ blockNumber: BigInt(blockNumber) })
                timestamps.set(blockNumber, Number(block.timestamp))
              },
            ),
          )

          for (const movement of movements) {
            const index = Number(movement.leaf.index)
            if (!Number.isSafeInteger(index) || index < 0) {
              throw new Error('The bridge movement returned an invalid leaf index.')
            }
            const proof = movement.proof ? [...movement.proof] : null
            const inboxRoot = proof
              ? sdkSuckerBranchRoot(movement.leafHash, proof, index)
              : null

            rows.push({
              createdAt: timestamps.get(movement.blockNumber.toString()) ?? null,
              chainId,
              peerChainId: remoteChainId,
              beneficiary: suckerBytes32ToAddress(movement.leaf.beneficiary),
              beneficiary32: movement.leaf.beneficiary,
              projectTokenCount: movement.leaf.projectTokenCount,
              terminalTokenAmount: movement.leaf.terminalTokenAmount,
              status: movement.status,
              index,
              sourceSucker,
              peerSucker,
              metadata: movement.leaf.metadata,
              leafHash: movement.leafHash,
              proof,
              inboxRoot,
              canExecute: movement.canExecute,
              token: movement.sourceToken,
              remoteToken: movement.remoteToken,
              tokenDecimals: sourceContext.decimals,
              tokenSymbol: sourceContext.symbol,
              infra,
            })
          }
        }),
      )
    }),
  )

  return rows
}

/**
 * All queued movements across the project's chains. Per-chain failures are
 * reported (not silently dropped) so the UI can render "—" for that chain
 * while the others stay live.
 */
export async function fetchQueuedMovements(
  chainProjects: readonly SuckerChainProject[],
  deps: SuckerBridgeDeps = {},
): Promise<QueuedMovementsResult> {
  const pidByChain = new Map(chainProjects.map(cp => [cp.chainId, BigInt(cp.projectId)]))
  const remotePidFor = (chainId: number) => pidByChain.get(chainId) ?? null
  const rows: QueuedMovement[] = []
  const failedChains: number[] = []
  await Promise.all(
    // Each chain scans with ITS OWN project id; peer contexts resolve via the map too.
    chainProjects.map(async ({ chainId, projectId }) => {
      try {
        rows.push(...(await scanChainMovements(BigInt(projectId), chainId, remotePidFor, deps)))
      } catch {
        failedChains.push(chainId)
      }
    }),
  )
  rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return { rows, failedChains }
}

// ---------------------------------------------------------------------------
// Fee discovery (escalating simulation)
// ---------------------------------------------------------------------------

const FUNDED_BALANCE = 10n ** 21n // 1000 ETH state override so the sim never fails on the caller's balance

/**
 * The msg.value toRemote needs. Native-bridge suckers: msg.value must EQUAL
 * the registry's toRemoteFee (any non-zero transportPayment reverts). CCIP
 * suckers also need the CCIP messaging fee in native ETH on top — discovered
 * by simulating toRemote itself at escalating budgets (the contract computes
 * getFee internally; excess transport refunds on-chain). Returns null when no
 * tier simulates cleanly, so callers surface an error instead of prompting a
 * reverting (or LINK-pulling) transaction.
 */
export async function findToRemoteValue(
  chainId: number,
  sucker: Address,
  token: Address,
  account: Address | null,
  deps: SuckerBridgeDeps = {},
): Promise<bigint | null> {
  const registry = suckerRegistryAddress(chainId)
  if (!registry) return null
  const client = clientOf(deps, chainId)
  let fee: bigint
  try {
    fee = await client.readContract({ address: registry, abi: jbSuckerRegistryAbi, functionName: 'toRemoteFee' })
  } catch {
    return null
  }
  const infra = await classifySuckerInfra(chainId, sucker, deps)
  if (infra === 'unknown') return null
  if (infra === 'native') return fee
  if (!account) return null // need a caller to simulate against
  const request = buildToRemoteTx({
    chainId: chainId as JBChainId,
    sucker,
    token,
  })
  const data = encodeFunctionData({
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
  })
  const value = await escalateValue(
    CCIP_TRANSPORT_LADDER.map(tier => fee + tier),
    value =>
      client.call({
        account,
        to: sucker,
        data,
        value,
        stateOverride: [{ address: account, balance: FUNDED_BALANCE }],
      }),
  )
  if (value !== null) assertSuckerTransportValue('ccip', value, fee)
  return value
}

/**
 * The msg.value syncAccountingData needs. It forwards msg.value as the bridge
 * TRANSPORT payment (no registry fee, unlike toRemote), so on CCIP the ladder
 * starts positive — value 0 would flip to LINK-fee mode. Discovered by
 * simulating syncAccountingData ITSELF (not toRemote — that reverts when the
 * outbox is empty). Native bridges may accept 0.
 */
export async function findSyncValue(
  chainId: number,
  sucker: Address,
  account: Address | null,
  deps: SuckerBridgeDeps = {},
): Promise<bigint | null> {
  if (!account) return null
  const infra = await classifySuckerInfra(chainId, sucker, deps)
  if (infra === 'unknown') return null
  const client = clientOf(deps, chainId)
  const request = buildSyncAccountingDataTx({
    chainId: chainId as JBChainId,
    sucker,
  })
  const data = encodeFunctionData({
    abi: request.abi,
    functionName: request.functionName,
    args: request.args,
  })
  const ladder = infra === 'CCIP' ? CCIP_TRANSPORT_LADDER : NATIVE_SYNC_LADDER
  const value = await escalateValue(ladder, candidate =>
    client.call({
      account,
      to: sucker,
      data,
      value: candidate,
      stateOverride: [{ address: account, balance: FUNDED_BALANCE }],
    }),
  )
  if (value !== null) {
    assertSuckerTransportValue(infra === 'CCIP' ? 'ccip' : infra, value)
  }
  return value
}

// ---------------------------------------------------------------------------
// Move-between-chains helpers
// ---------------------------------------------------------------------------

export interface BridgeableBalance {
  /** False = RPC/read failure; a confirmed missing ERC-20 and a failed read must never share a UI state. */
  verified: boolean
  /** The project's ERC-20 on this chain, or null when none is deployed (credits can't bridge). */
  token: Address | null
  balance: bigint | null
}

/** The wallet's CLAIMED ERC-20 balance — the only kind a sucker can bridge. */
export async function readBridgeableBalance(
  projectId: number | string | bigint,
  chainId: number,
  account: Address,
  deps: SuckerBridgeDeps = {},
): Promise<BridgeableBalance> {
  try {
    const client = clientOf(deps, chainId)
    const erc20 = await client.readContract({
      address: JB_CONTRACTS.JBTokens,
      abi: jbTokensAbi,
      functionName: 'tokenOf',
      args: [BigInt(projectId)],
    })
    if (!erc20 || erc20 === zeroAddress) return { verified: true, token: null, balance: 0n }
    const balance = await client.readContract({ address: erc20, abi: erc20BalanceOfAbi, functionName: 'balanceOf', args: [account] })
    return { verified: true, token: erc20, balance }
  } catch {
    return { verified: false, token: null, balance: null }
  }
}

export interface MoveBackingQuote {
  /** JBTokens.totalSupplyOf on the source chain (the proportional-share denominator). */
  supply: bigint | null
  /** The accounting token's surplus (balance − payout limits) — what the sucker's 0%-tax cash out draws from. */
  surplus: bigint | null
  acct: YouAccountingToken | null
}

/** The proportional backing that bridges with the tokens: surplus × amount / totalSupply. Read on the FROM chain. */
export async function quoteMoveBacking(
  projectId: number | string | bigint,
  chainId: number,
  deps: SuckerBridgeDeps = {},
): Promise<MoveBackingQuote> {
  const pid = BigInt(projectId)
  const client = clientOf(deps, chainId)
  const acct = await getAccountingContexts(client, { chainId: chainId as JBChainId, projectId: pid })
    .then(contexts => (contexts.length ? describeAccountingToken(chainId, contexts[0]) : null))
    .catch(() => null)
  if (!acct) return { supply: null, surplus: null, acct: null }
  const [supply, surplus] = await Promise.all([
    client.readContract({ address: JB_CONTRACTS.JBTokens, abi: jbTokensAbi, functionName: 'totalSupplyOf', args: [pid] }).catch(() => null),
    client
      .readContract({
        address: JB_CONTRACTS.JBTerminalStore,
        abi: jbTerminalStoreAbi,
        functionName: 'currentSurplusOf',
        args: [pid, [], [acct.token], BigInt(acct.decimals), BigInt(acct.currency)],
      })
      .catch(() => null),
  ])
  return { supply, surplus, acct }
}

export interface MoveRouteCheck {
  infra: SuckerInfra
  /** The destination token the sucker's mapping delivers. */
  remoteToken: Address
}

/**
 * Pre-flight guards for a move. Throws a descriptive error when any check
 * fails; nothing is sent on a guessed route.
 */
export async function verifyMoveRoute(
  args: {
    /** The project's id on the FROM chain — the id the source sucker is bound to. */
    fromProjectId: number | string | bigint
    /** The project's id on the TO chain — used to read the destination's accounting contexts. */
    toProjectId: number | string | bigint
    fromChainId: number
    toChainId: number
    sucker: Address
    /** The TERMINAL (backing) token the sucker reclaims + bridges — the project's accounting token. */
    termToken: Address
  },
  deps: SuckerBridgeDeps = {},
): Promise<MoveRouteCheck> {
  const { fromProjectId, toProjectId, fromChainId, toChainId, sucker, termToken } = args
  const client = clientOf(deps, fromChainId)
  const [suckerProject, mapping, infra, remoteContexts] = await Promise.all([
    client.readContract({ address: sucker, abi: suckerViewAbi, functionName: 'projectId' }),
    client.readContract({ address: sucker, abi: suckerViewAbi, functionName: 'remoteTokenFor', args: [termToken] }),
    classifySuckerInfra(fromChainId, sucker, deps),
    // The destination contexts belong to the project's id ON the TO chain, not the source id.
    getAccountingContexts(clientOf(deps, toChainId), { chainId: toChainId as JBChainId, projectId: BigInt(toProjectId) }).catch(
      () => null,
    ),
  ])
  if (suckerProject !== BigInt(fromProjectId)) throw new Error('The selected bridge belongs to a different project.')
  if (!mapping.enabled || isZeroHex(mapping.addr)) throw new Error('This backing token is not mapped on the selected bridge.')
  if (infra === 'unknown') {
    throw new Error('The selected bridge type could not be verified. Try again when the source RPC is available.')
  }
  // Canonical ERC-20s (USDC) over an OP-stack/Arbitrum NATIVE sucker strand in bridge
  // escrow — the mapping may exist on-chain but the delivery leg can never settle.
  if (infra === 'native' && termToken.toLowerCase() !== NATIVE_TOKEN.toLowerCase()) {
    throw new Error(
      'This pair’s native bridge can’t deliver an ERC-20 backing token — canonical tokens sent over a native bridge get stuck in escrow. Pick the CCIP bridge for this move.',
    )
  }
  const remoteToken = bytes32ToAddress(mapping.addr)
  if (!remoteContexts) throw new Error('The destination chain’s accounting contexts could not be verified.')
  const remoteMatch = remoteContexts.find(context => context.token.toLowerCase() === remoteToken.toLowerCase())
  if (!remoteMatch) throw new Error('The selected bridge maps this backing token to a token the destination doesn’t account for.')
  return { infra, remoteToken }
}

export interface PrepareQuote {
  /** Gross reclaim previewCashOutFrom reports for the sucker's cash out. */
  gross: bigint
  /** Gross minus the 2.5% protocol fee where it applies. */
  net: bigint
  /** 99% of net — the on-chain minTokensReclaimed floor for prepare. */
  minReclaimed: bigint
}

/**
 * Quote the backing a prepare would reclaim right now and derive the 99%
 * floor. Used at review time AND re-run inside the tx runner's reverify — the
 * move aborts if the fresh net quote drops below the reviewed floor.
 */
export async function quotePrepareMin(
  args: { projectId: number | string | bigint; chainId: number; sucker: Address; amount: bigint; termToken: Address },
  deps: SuckerBridgeDeps = {},
): Promise<PrepareQuote> {
  const { projectId, chainId, sucker, amount, termToken } = args
  const pid = BigInt(projectId)
  const client = clientOf(deps, chainId)
  const [preview, feeless, feeFreeSurplus] = await Promise.all([
    client.readContract({
      address: JB_CONTRACTS.JBMultiTerminal,
      abi: jbMultiTerminalAbi,
      functionName: 'previewCashOutFrom',
      args: [sucker, pid, amount, termToken, sucker, '0x'],
    }),
    // The sucker's prepare cashes out with itself as BOTH beneficiary and the
    // terminal's _msgSender(), so it is the addr AND the caller here.
    client.readContract({ address: JB_CONTRACTS.JBFeelessAddresses, abi: feelessAbi, functionName: 'isFeelessFor', args: [sucker, pid, sucker] }),
    client.readContract({ address: JB_CONTRACTS.JBMultiTerminal, abi: jbMultiTerminalAbi, functionName: 'feeFreeSurplusOf', args: [pid, termToken] }),
  ])
  const gross = preview[1]
  const taxRate = preview[2]
  const net =
    gross -
    cashOutProtocolFee({
      reclaimAmount: gross,
      cashOutTaxRate: taxRate,
      beneficiaryIsFeeless: Boolean(feeless),
      feeFreeSurplus,
    })
  return { gross, net, minReclaimed: net > 0n ? quotedOutputFloor(net, 9_900n) : 0n }
}
