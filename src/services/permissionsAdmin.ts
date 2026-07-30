/**
 * Owner/Operator ("back office") data + transaction layer.
 *
 * Ports website/src/discover.js renderBackOfficeSection helpers onto typed,
 * testable services:
 *   - the JBPermissions catalog (ids come from the SDK's JBPermissionIdsV6 —
 *     V6 renumbered permission ids, so ids are NEVER hardcoded from memory),
 *   - the setPermissionsFor REPLACE semantics (the editor preloads the
 *     operator's existing ids so the replacement set carries them forward),
 *   - the ruleset-flag → owner-power availability map,
 *   - the revnet read-only permissions rule,
 *   - calldata builders for transfer-authority, owner powers, and the
 *     buyback/router registries, all executed via the shared guarded runner.
 */

import { encodeFunctionData, parseUnits, type Abi, type Address } from 'viem'
import {
  jbPermissionsAbi,
  jbProjectsAbi,
  revOwnerAbi,
  jbBuybackHookRegistryAbi,
  jbRouterTerminalRegistryAbi,
  jbControllerAbi,
  jbDirectoryAbi,
  jbMultiTerminalAbi,
  jbContractAddress,
  type JBChainId,
} from '@bananapus/nana-sdk-core'
import {
  JBPermissionCatalogV6,
  JBPermissionIdsV6,
  buildSetPermissionsTx,
  decodePermissionBitmap as decodeSdkPermissionBitmap,
  getCurrentRuleset,
} from '@bananapus/nana-sdk-core/v6'

// ─── Contract addresses ──────────────────────────────────────────────────────

type V6ContractName = keyof (typeof jbContractAddress)['6']

export interface AdminTxRequest {
  chainId: number
  to: Address
  data: `0x${string}`
  review: { abi: Abi; functionName: string; args: readonly unknown[] }
}

/** Resolve a V6 contract address from the SDK's canonical address book. */
export function v6ContractAddress(name: V6ContractName, chainId: number): Address {
  const byChain = jbContractAddress['6'][name] as Record<string, Address> | undefined
  const address = byChain?.[String(chainId)]
  if (!address) throw new Error(`No ${String(name)} deployment on chain ${chainId}`)
  return address
}

// ─── Permission catalog (ids from the SDK, labels keyed by SDK name) ─────────

export interface PermissionInfo {
  id: number
  /** The SDK constant name, e.g. "QUEUE_RULESETS". */
  key: string
  label: string
  description: string
}

// Human copy keyed by the SDK's permission NAME (not raw id) so an upstream
// renumbering keeps every label attached to the right semantic.
const PERMISSION_COPY: Record<keyof typeof JBPermissionIdsV6, { label: string; description: string }> = {
  ROOT: { label: 'Full control (root)', description: 'Grants every permission below — full control of the project.' },
  QUEUE_RULESETS: { label: 'Queue rulesets', description: 'Queue new rulesets (change duration, issuance, payouts, and rules).' },
  LAUNCH_RULESETS: { label: 'Launch rulesets', description: "Launch the project's first rulesets." },
  CASH_OUT_TOKENS: { label: 'Cash out tokens', description: "Cash out (redeem) project tokens for a share of the project's funds on a holder's behalf." },
  SEND_PAYOUTS: { label: 'Send payouts', description: "Send the project's scheduled payouts to its splits." },
  MIGRATE_TERMINAL: { label: 'Migrate terminal', description: "Move the project's funds to a new terminal version." },
  SET_PROJECT_URI: { label: 'Set project metadata', description: "Update the project's metadata (name, logo, description)." },
  DEPLOY_ERC20: { label: 'Deploy ERC-20', description: "Deploy the project's ERC-20 token." },
  SET_TOKEN: { label: 'Set custom token', description: 'Replace the project token with a custom ERC-20.' },
  MINT_TOKENS: { label: 'Mint tokens', description: 'Mint project tokens to any address without a payment.' },
  BURN_TOKENS: { label: 'Burn tokens', description: "Burn project tokens from a holder's balance." },
  CLAIM_TOKENS: { label: 'Claim tokens', description: "Claim a holder's credits into the ERC-20 token." },
  TRANSFER_CREDITS: { label: 'Transfer credits', description: "Transfer a holder's unclaimed token credits." },
  SET_CONTROLLER: { label: 'Set controller', description: 'Swap the controller contract that manages rulesets and tokens.' },
  SET_TERMINALS: { label: 'Set terminals', description: "Set the full list of the project's payment terminals." },
  ADD_TERMINALS: { label: 'Add terminals', description: 'Add payment terminals to the project.' },
  SET_PRIMARY_TERMINAL: { label: 'Set primary terminal', description: 'Set which terminal is primary for a given token.' },
  USE_ALLOWANCE: { label: 'Use surplus allowance', description: "Spend the project's surplus allowance." },
  SET_SPLIT_GROUPS: { label: 'Set splits', description: "Edit the project's payout and reserved-token splits." },
  ADD_PRICE_FEED: { label: 'Add price feed', description: 'Add a price feed used to convert between currencies.' },
  ADD_ACCOUNTING_CONTEXTS: { label: 'Add accounting tokens', description: 'Register new tokens the terminal accepts directly (e.g. an ERC-20 or USDC).' },
  SET_TOKEN_METADATA: { label: 'Set token metadata', description: "Set the project token's name and symbol." },
  SIGN_FOR_ERC20: { label: 'Sign for ERC-20 (permit)', description: "Sign permit (ERC-20 approval) messages on the project's behalf." },
  ADJUST_721_TIERS: { label: 'Adjust NFT tiers', description: "Add or remove the project's NFT tiers." },
  SET_721_METADATA: { label: 'Set NFT metadata', description: "Update the NFT collection's metadata." },
  MINT_721: { label: 'Mint NFTs', description: "Mint the project's NFTs without a payment." },
  SET_721_DISCOUNT_PERCENT: { label: 'Set NFT discount', description: 'Set the discount applied to NFT prices.' },
  SET_BUYBACK_TWAP: { label: 'Set buyback TWAP', description: "Set the buyback hook's TWAP window." },
  SET_BUYBACK_POOL: { label: 'Set buyback pool', description: "Set the buyback hook's Uniswap pool." },
  SET_BUYBACK_HOOK: { label: 'Set buyback hook', description: "Set the project's buyback hook." },
  SET_ROUTER_TERMINAL: { label: 'Set router terminal', description: 'Set the router terminal used for swaps.' },
  MAP_SUCKER_TOKEN: { label: 'Map sucker token', description: 'Map a token for cross-chain bridging via suckers.' },
  DEPLOY_SUCKERS: { label: 'Deploy suckers', description: "Deploy the project's cross-chain suckers." },
  SET_SUCKER_PEER: { label: 'Set sucker peer', description: "Set a sucker's peer on another chain." },
  SUCKER_SAFETY: { label: 'Sucker safety controls', description: 'Control sucker safety limits (caps, emergency hatch).' },
  SET_SUCKER_DEPRECATION: { label: 'Set sucker deprecation', description: 'Deprecate a sucker (wind down a bridge).' },
  OPEN_LOAN: { label: 'Open loans', description: "Open loans against the project's tokens." },
  REALLOCATE_LOAN: { label: 'Reallocate loans', description: "Move collateral between the project's loans." },
  REPAY_LOAN: { label: 'Repay loans', description: "Repay the project's loans." },
}

/** The full V6 permission catalog, sorted by id. Ids come from the SDK. */
export const PERMISSIONS: PermissionInfo[] = JBPermissionCatalogV6.map(
  ({ key, id }) => ({
    id,
    key: String(key),
    label: PERMISSION_COPY[key]?.label ?? String(key),
    description: PERMISSION_COPY[key]?.description ?? '',
  }),
)

const PERMISSION_BY_ID = new Map(PERMISSIONS.map(info => [info.id, info]))

export const JB_PERMISSION_MAX_ID = PERMISSIONS[PERMISSIONS.length - 1]?.id ?? 0

/** ROOT (id 1) grants EVERY permission — full control of the project. Gated behind an extra confirm in the UI. */
export const JB_ROOT_PERMISSION_ID: number = JBPermissionIdsV6.ROOT

export function permissionLabel(id: number): string {
  return PERMISSION_BY_ID.get(id)?.label ?? `Permission #${id}`
}

export function permissionDescription(id: number): string {
  return PERMISSION_BY_ID.get(id)?.description ?? ''
}

// ─── setPermissionsFor REPLACE semantics ─────────────────────────────────────
//
// JBPermissions.setPermissionsFor REPLACES the operator's ENTIRE permission
// set for (account, projectId). The editor therefore works on a selection
// PRELOADED with the operator's existing ids: adding a permission must carry
// every existing id forward, and unchecking one removes exactly that id.

/** Checkbox state for the permission editor, keyed by permission id. */
export type PermissionSelection = Record<number, boolean>

/**
 * Build the editor's initial selection: every catalog permission, with the
 * operator's EXISTING ids pre-checked (the merge-with-existing preload that
 * makes the replacement set safe). Unknown ids are ignored.
 */
export function preloadPermissionSelection(existingIds: number[]): PermissionSelection {
  const existing = new Set(existingIds)
  const selection: PermissionSelection = {}
  for (const info of PERMISSIONS) selection[info.id] = existing.has(info.id)
  return selection
}

/**
 * The exact permission-id set a selection resolves to — this array is what
 * setPermissionsFor writes, REPLACING whatever the operator held before.
 * Only catalog ids are included; sorted ascending.
 */
export function selectedPermissionIds(selection: PermissionSelection): number[] {
  return PERMISSIONS.filter(info => selection[info.id]).map(info => info.id)
}

/** Order-insensitive set comparison, used to detect on-chain drift from the reviewed snapshot. */
export function permissionSetsDiffer(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return true
  const setA = new Set(a)
  return b.some(id => !setA.has(id))
}

/** Decode a JBPermissions.permissionsOf packed bitmap (bit N set → id N granted). */
export function decodePermissionBitmap(bitmap: bigint): number[] {
  return decodeSdkPermissionBitmap(bitmap)
}

/**
 * Build the JBPermissions.setPermissionsFor calldata for one chain. The ids
 * REPLACE the operator's entire set — callers must pass the full desired set
 * (see preloadPermissionSelection), and an empty array removes the operator.
 */
export function buildSetPermissionsRequest(args: {
  chainId: number
  /** The grantor — the project owner. */
  account: Address
  operator: Address
  projectId: bigint
  permissionIds: number[]
}): AdminTxRequest {
  const request = buildSetPermissionsTx({
    chainId: args.chainId as JBChainId,
    account: args.account,
    operator: args.operator,
    projectId: args.projectId,
    permissionIds: args.permissionIds,
  })
  return {
    chainId: args.chainId,
    to: request.address,
    data: encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args }),
    review: { abi: request.abi, functionName: request.functionName, args: request.args },
  }
}

// ─── Revnet rule ─────────────────────────────────────────────────────────────

/**
 * Revnet permissions are READ-ONLY here: the operator role is granted by the
 * revnet itself (REVDeployer/REVOwner), not via setPermissionsFor. Only
 * custom projects can add/edit operators from the Permissions card.
 */
export function canEditPermissions(isRevnet: boolean): boolean {
  return !isRevnet
}

// ─── Operators list (bendystraw permissionHolders) ───────────────────────────

export interface PermissionHolderItem {
  chainId: number
  account: string
  operator: string
  permissions: unknown[] | null
  isRevnetOperator?: boolean
}

export interface ProjectOperator {
  operator: Address
  account: string
  isRevnetOperator: boolean
  chains: number[]
  /** Union of granted permission ids across chains, sorted ascending. */
  permissionIds: number[]
}

export const PERMISSION_HOLDERS_QUERY = `
  query PermissionHolders(
    $projectId: Int!
    $version: Int!
    $chainIds: [Int!]
    $limit: Int!
    $offset: Int!
  ) {
    permissionHolders(
      where: { projectId: $projectId, version: $version, chainId_in: $chainIds }
      limit: $limit
      offset: $offset
    ) {
      items { chainId account operator permissions isRevnetOperator }
      totalCount
    }
  }
`

/**
 * Dedupe permission-holder rows into one entry per operator: stale grants with
 * no permissions are dropped, chains are collected, and permission ids are
 * unioned across chains. Pure — the fetch wrapper below feeds it.
 */
export function aggregatePermissionHolders(items: PermissionHolderItem[]): ProjectOperator[] {
  const byOperator = new Map<string, ProjectOperator>()
  const order: ProjectOperator[] = []
  for (const item of items) {
    const permissionIds = (item.permissions ?? []).map(Number).filter(n => Number.isInteger(n) && n > 0)
    if (!permissionIds.length) continue // cleared grant — the operator holds nothing
    const operator = (item.operator || '').toLowerCase()
    if (!operator) continue
    let group = byOperator.get(operator)
    if (!group) {
      group = {
        operator: item.operator as Address,
        account: item.account,
        isRevnetOperator: false,
        chains: [],
        permissionIds: [],
      }
      byOperator.set(operator, group)
      order.push(group)
    }
    group.isRevnetOperator = group.isRevnetOperator || !!item.isRevnetOperator
    const chainId = Number(item.chainId)
    if (!group.chains.includes(chainId)) group.chains.push(chainId)
    for (const id of permissionIds) {
      if (!group.permissionIds.includes(id)) group.permissionIds.push(id)
    }
  }
  for (const group of order) {
    group.chains.sort((a, b) => a - b)
    group.permissionIds.sort((a, b) => a - b)
  }
  return order
}

export interface OperatedProject {
  chainId: number
  projectId: number
  isRevnetOperator: boolean
  /** Granted permission ids on this (chainId, projectId), sorted ascending. */
  permissionIds: number[]
}

/**
 * Account-view counterpart to aggregatePermissionHolders: instead of collapsing
 * one project's rows per OPERATOR, collapse one operator's rows per PROJECT.
 * Cleared grants (no permissions) are dropped the same way.
 */
export function aggregateOperatedProjects(
  items: Array<PermissionHolderItem & { projectId: number }>,
): OperatedProject[] {
  const byProject = new Map<string, OperatedProject>()
  const order: OperatedProject[] = []
  for (const item of items) {
    const permissionIds = (item.permissions ?? []).map(Number).filter(n => Number.isInteger(n) && n > 0)
    if (!permissionIds.length) continue // cleared grant — nothing operable
    const chainId = Number(item.chainId)
    const projectId = Number(item.projectId)
    if (!Number.isInteger(projectId) || projectId <= 0) continue
    const key = `${chainId}:${projectId}`
    let group = byProject.get(key)
    if (!group) {
      group = { chainId, projectId, isRevnetOperator: false, permissionIds: [] }
      byProject.set(key, group)
      order.push(group)
    }
    group.isRevnetOperator = group.isRevnetOperator || !!item.isRevnetOperator
    for (const id of permissionIds) {
      if (!group.permissionIds.includes(id)) group.permissionIds.push(id)
    }
  }
  for (const group of order) group.permissionIds.sort((a, b) => a - b)
  return order
}

/**
 * Every operator the project has authorized, deduped across chains. Source is
 * bendystraw — there is no on-chain way to ENUMERATE operators, only to check
 * a known one (which is what the on-chain reverify reads do).
 */
export async function fetchPermissionOperators(
  chainProjects: ReadonlyArray<{ chainId: number; projectId: number | string | bigint }>,
): Promise<ProjectOperator[]> {
  if (!chainProjects.length) return []
  // Lazy import keeps this module's test import-graph free of the graphql client.
  const { safeRequest, getNetworkOption } = await import('./bendystraw/client')
  // V6 project ids are independent per chain — query each chain by ITS OWN id
  // and merge; a single projectId + chainId_in filter reads the wrong project off-home.
  const pages = await Promise.all(
    chainProjects.map(async cp => {
      const items: PermissionHolderItem[] = []
      let totalCount = 0
      do {
        const data = await safeRequest<{
          permissionHolders: { items: PermissionHolderItem[]; totalCount: number }
        }>(
          PERMISSION_HOLDERS_QUERY,
          {
            projectId: Number(cp.projectId),
            version: 6,
            chainIds: [cp.chainId],
            limit: 250,
            offset: items.length,
          },
          getNetworkOption(cp.chainId),
        )
        const page = data.permissionHolders?.items ?? []
        totalCount = data.permissionHolders?.totalCount ?? page.length
        items.push(...page)
        if (!page.length) break
      } while (items.length < totalCount)
      return items
    }),
  )
  return aggregatePermissionHolders(pages.flat())
}

/** Read the operator's CURRENT on-chain permission ids for (account, project) on one chain. */
export async function readPermissionIds(args: {
  chainId: number
  operator: Address
  account: Address
  projectId: bigint
}): Promise<number[]> {
  const { publicClientFor } = await import('./projectTx')
  const bitmap = await publicClientFor(args.chainId).readContract({
    address: v6ContractAddress('JBPermissions', args.chainId),
    abi: jbPermissionsAbi,
    functionName: 'permissionsOf',
    args: [args.operator, args.account, args.projectId],
  })
  return decodePermissionBitmap(bitmap as bigint)
}

// ─── Authority (owner / revnet operator) ─────────────────────────────────────

/** Read the project's JBProjects owner on one chain. */
export async function readProjectOwner(chainId: number, projectId: bigint): Promise<Address> {
  const { publicClientFor } = await import('./projectTx')
  return (await publicClientFor(chainId).readContract({
    address: v6ContractAddress('JBProjects', chainId),
    abi: jbProjectsAbi,
    functionName: 'ownerOf',
    args: [projectId],
  })) as Address
}

/** Check whether `addr` is the revnet's current operator on one chain (live REVOwner read). */
export async function readIsRevnetOperator(chainId: number, projectId: bigint, addr: Address): Promise<boolean> {
  const { publicClientFor } = await import('./projectTx')
  return (await publicClientFor(chainId).readContract({
    address: v6ContractAddress('REVOwner', chainId),
    abi: revOwnerAbi,
    functionName: 'isOperatorOf',
    args: [projectId, addr],
  })) as boolean
}

/** Custom project: transfer the JBProjects ownership NFT. */
export function buildTransferOwnershipRequest(args: {
  chainId: number
  owner: Address
  to: Address
  projectId: bigint
}): AdminTxRequest {
  const callArgs = [args.owner, args.to, args.projectId] as const
  return {
    chainId: args.chainId,
    to: v6ContractAddress('JBProjects', args.chainId),
    data: encodeFunctionData({
      abi: jbProjectsAbi,
      functionName: 'transferFrom',
      args: callArgs,
    }),
    review: { abi: jbProjectsAbi, functionName: 'transferFrom', args: callArgs },
  }
}

/** Revnet: hand the operator role to a new address via REVOwner.setOperatorOf. */
export function buildSetOperatorRequest(args: {
  chainId: number
  to: Address
  projectId: bigint
}): AdminTxRequest {
  const callArgs = [args.projectId, args.to] as const
  return {
    chainId: args.chainId,
    to: v6ContractAddress('REVOwner', args.chainId),
    data: encodeFunctionData({
      abi: revOwnerAbi,
      functionName: 'setOperatorOf',
      args: callArgs,
    }),
    review: { abi: revOwnerAbi, functionName: 'setOperatorOf', args: callArgs },
  }
}

// ─── Owner powers (ruleset-flag gated) ───────────────────────────────────────

export type OwnerPowerKey =
  | 'mintTokens'
  | 'setController'
  | 'setTerminals'
  | 'migrateBalance'
  | 'addPriceFeed'
  | 'setToken'

export type OwnerPowerFlag =
  | 'allowOwnerMinting'
  | 'allowSetController'
  | 'allowSetTerminals'
  | 'allowTerminalMigration'
  | 'allowAddPriceFeed'
  | 'allowSetCustomToken'

export type OwnerPowerFlags = Record<OwnerPowerFlag, boolean>

export interface OwnerPowerField {
  name: string
  label: string
  kind: 'address' | 'addressList' | 'amount' | 'uint' | 'bool'
  placeholder?: string
  help?: string
  /** Default to the connected account (e.g. mint beneficiary). */
  defaultAccount?: boolean
  /** Blank resolves to this V6 infra contract's per-chain address. */
  infra?: V6ContractName
}

export interface OwnerPowerDef {
  key: OwnerPowerKey
  /** The CURRENT ruleset metadata flag that must be on for this power. */
  flag: OwnerPowerFlag
  label: string
  description: string
  actionLabel: string
  danger: string
  contract: V6ContractName
  fn: string
  fields: OwnerPowerField[]
}

/** The owner powers, each gated on a current-ruleset metadata flag (website OWNER_POWERS :11137). */
export const OWNER_POWERS: OwnerPowerDef[] = [
  {
    key: 'addPriceFeed',
    flag: 'allowAddPriceFeed',
    label: 'Add price feeds',
    description: 'Add a price feed the project uses to convert between currencies (e.g. ETH↔USD).',
    actionLabel: 'Add price feed',
    danger: 'Irreversible: a price feed cannot be removed once added, and a wrong feed misprices the whole project.',
    contract: 'JBController',
    fn: 'addPriceFeedFor',
    fields: [
      { name: 'pricingCurrency', label: 'Pricing currency (id)', kind: 'uint', placeholder: 'e.g. 2 (USD)' },
      { name: 'unitCurrency', label: 'Unit currency (id)', kind: 'uint', placeholder: 'e.g. 1 (ETH)' },
      { name: 'feed', label: 'Feed', kind: 'address', placeholder: '0x… price feed' },
    ],
  },
  {
    key: 'mintTokens',
    flag: 'allowOwnerMinting',
    label: 'Mint tokens freely',
    description: 'Mint project tokens to any address without a payment.',
    actionLabel: 'Mint tokens',
    danger: 'Irreversible: minting dilutes every existing token holder and cannot be undone.',
    contract: 'JBController',
    fn: 'mintTokensOf',
    fields: [
      { name: 'tokenCount', label: 'Amount (tokens)', kind: 'amount', placeholder: '0.0' },
      { name: 'beneficiary', label: 'Recipient', kind: 'address', placeholder: '0x… recipient', defaultAccount: true },
      {
        name: 'useReservedPercent',
        label: 'Also send the reserved share',
        kind: 'bool',
        help: 'On: split this mint with the reserved recipients too. Off: the recipient gets the full amount.',
      },
    ],
  },
  {
    key: 'setTerminals',
    flag: 'allowSetTerminals',
    label: 'Set payment terminals',
    description: 'Add or replace the project’s payment terminals (where funds are paid in).',
    actionLabel: 'Set terminals',
    danger: 'Dangerous: this reroutes where funds are paid in. A wrong terminal can misdirect or strand funds.',
    contract: 'JBDirectory',
    fn: 'setTerminalsOf',
    fields: [
      { name: 'terminals', label: 'Terminals', kind: 'addressList', placeholder: '0x…, 0x…', infra: 'JBMultiTerminal' },
    ],
  },
  {
    key: 'setController',
    flag: 'allowSetController',
    label: 'Set controller',
    description: 'Swap the controller contract that manages the project’s rulesets and tokens.',
    actionLabel: 'Set controller',
    danger:
      'Dangerous: this hands control of the project’s rules and tokens to a new contract. A wrong address can permanently brick or compromise the project.',
    contract: 'JBDirectory',
    fn: 'setControllerOf',
    fields: [{ name: 'controller', label: 'Controller', kind: 'address', placeholder: '0x… controller', infra: 'JBController' }],
  },
  {
    key: 'migrateBalance',
    flag: 'allowTerminalMigration',
    label: 'Migrate terminal',
    description: 'Move the project’s funds to a new terminal version.',
    actionLabel: 'Migrate balance',
    danger: 'Dangerous: this moves the project’s funds to another terminal. A wrong destination can lose the funds.',
    contract: 'JBMultiTerminal',
    fn: 'migrateBalanceOf',
    fields: [
      { name: 'token', label: 'Token', kind: 'address', placeholder: '0x… token (0xEeee…EEeE for ETH)' },
      { name: 'to', label: 'New terminal', kind: 'address', placeholder: '0x… destination terminal' },
    ],
  },
  {
    key: 'setToken',
    flag: 'allowSetCustomToken',
    label: 'Set custom token',
    description: 'Replace the project token with a custom ERC-20.',
    actionLabel: 'Set token',
    danger: 'Irreversible: replacing the project token is permanent and affects every holder.',
    contract: 'JBController',
    fn: 'setTokenFor',
    fields: [{ name: 'token', label: 'Token', kind: 'address', placeholder: '0x… ERC-20 (IJBToken)' }],
  },
]

export interface PowerAvailability {
  enabled: boolean
  /** Present when disabled — the ruleset flag that must be turned on. */
  reason?: string
}

/**
 * Map the CURRENT ruleset's metadata flags to per-power availability. A power
 * whose flag is off (or missing) is disabled with the reason to surface.
 */
export function powerAvailability(flags: Partial<OwnerPowerFlags>): Record<OwnerPowerKey, PowerAvailability> {
  const result = {} as Record<OwnerPowerKey, PowerAvailability>
  for (const power of OWNER_POWERS) {
    if (flags[power.flag]) {
      result[power.key] = { enabled: true }
    } else {
      result[power.key] = {
        enabled: false,
        reason: `Disabled by the current ruleset (${power.flag} is off). Queue a ruleset that turns it on to use this power.`,
      }
    }
  }
  return result
}

/** Read the six owner-power flags from the project's CURRENT ruleset on one chain. */
export async function readOwnerPowerFlags(chainId: number, projectId: bigint): Promise<OwnerPowerFlags> {
  const { publicClientFor } = await import('./projectTx')
  const { metadata } = await getCurrentRuleset(publicClientFor(chainId), {
    chainId: chainId as JBChainId,
    projectId,
  })
  return {
    allowOwnerMinting: !!metadata.allowOwnerMinting,
    allowSetController: !!metadata.allowSetController,
    allowSetTerminals: !!metadata.allowSetTerminals,
    allowTerminalMigration: !!metadata.allowTerminalMigration,
    allowAddPriceFeed: !!metadata.allowAddPriceFeed,
    allowSetCustomToken: !!metadata.allowSetCustomToken,
  }
}

/** Raw editor values for an owner-power form, keyed by field name. */
export type OwnerPowerValues = Record<string, string | boolean>

function requireAddress(raw: string | boolean | undefined, label: string): Address {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`Enter a valid address for ${label}`)
  return value as Address
}

/**
 * Build the calldata for one owner power on one chain from the form values.
 * Blank `infra` address fields resolve to that chain's canonical contract.
 */
export function buildOwnerPowerRequest(
  power: OwnerPowerDef,
  args: { chainId: number; projectId: bigint; values: OwnerPowerValues },
): AdminTxRequest {
  const { chainId, projectId, values } = args
  const to = v6ContractAddress(power.contract, chainId)
  const addressOrInfra = (field: OwnerPowerField): Address => {
    const raw = values[field.name]
    if ((typeof raw !== 'string' || !raw.trim()) && field.infra) return v6ContractAddress(field.infra, chainId)
    return requireAddress(raw, field.label)
  }
  switch (power.key) {
    case 'mintTokens': {
      const rawAmount = typeof values.tokenCount === 'string' ? values.tokenCount.trim() : ''
      if (!rawAmount || Number.isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) {
        throw new Error('Enter a token amount greater than zero')
      }
      const tokenCount = parseUnits(rawAmount, 18)
      const beneficiary = requireAddress(values.beneficiary, 'Recipient')
      const data = encodeFunctionData({
        abi: jbControllerAbi,
        functionName: 'mintTokensOf',
        args: [projectId, tokenCount, beneficiary, '', !!values.useReservedPercent],
      })
      return {
        chainId,
        to,
        data,
        review: {
          abi: jbControllerAbi,
          functionName: 'mintTokensOf',
          args: [projectId, tokenCount, beneficiary, '', !!values.useReservedPercent],
        },
      }
    }
    case 'setController': {
      const controller = addressOrInfra(power.fields[0])
      const data = encodeFunctionData({
        abi: jbDirectoryAbi,
        functionName: 'setControllerOf',
        args: [projectId, controller],
      })
      return { chainId, to, data, review: { abi: jbDirectoryAbi, functionName: 'setControllerOf', args: [projectId, controller] } }
    }
    case 'setTerminals': {
      const raw = typeof values.terminals === 'string' ? values.terminals.trim() : ''
      const list = raw
        ? raw.split(',').map(part => requireAddress(part, 'Terminals'))
        : [v6ContractAddress('JBMultiTerminal', chainId)]
      const data = encodeFunctionData({
        abi: jbDirectoryAbi,
        functionName: 'setTerminalsOf',
        args: [projectId, list],
      })
      return { chainId, to, data, review: { abi: jbDirectoryAbi, functionName: 'setTerminalsOf', args: [projectId, list] } }
    }
    case 'migrateBalance': {
      const token = requireAddress(values.token, 'Token')
      const destination = requireAddress(values.to, 'New terminal')
      const data = encodeFunctionData({
        abi: jbMultiTerminalAbi,
        functionName: 'migrateBalanceOf',
        args: [projectId, token, destination],
      })
      return { chainId, to, data, review: { abi: jbMultiTerminalAbi, functionName: 'migrateBalanceOf', args: [projectId, token, destination] } }
    }
    case 'addPriceFeed': {
      const pricing = BigInt(String(values.pricingCurrency ?? '').trim() || '0')
      const unit = BigInt(String(values.unitCurrency ?? '').trim() || '0')
      if (pricing <= 0n || unit <= 0n) throw new Error('Enter both currency ids')
      const feed = requireAddress(values.feed, 'Feed')
      const data = encodeFunctionData({
        abi: jbControllerAbi,
        functionName: 'addPriceFeedFor',
        args: [projectId, pricing, unit, feed],
      })
      return { chainId, to, data, review: { abi: jbControllerAbi, functionName: 'addPriceFeedFor', args: [projectId, pricing, unit, feed] } }
    }
    case 'setToken': {
      const token = requireAddress(values.token, 'Token')
      const data = encodeFunctionData({
        abi: jbControllerAbi,
        functionName: 'setTokenFor',
        args: [projectId, token],
      })
      return { chainId, to, data, review: { abi: jbControllerAbi, functionName: 'setTokenFor', args: [projectId, token] } }
    }
  }
}

// ─── Buyback hook + swap-router registries ───────────────────────────────────

const ZERO = '0x0000000000000000000000000000000000000000'

/** The project's registered buyback hook on one chain (null when unset). */
export async function readBuybackHookOf(chainId: number, projectId: bigint): Promise<Address | null> {
  const { publicClientFor } = await import('./projectTx')
  const hook = (await publicClientFor(chainId).readContract({
    address: v6ContractAddress('JBBuybackHookRegistry', chainId),
    abi: jbBuybackHookRegistryAbi,
    functionName: 'hookOf',
    args: [projectId],
  })) as Address
  return hook && hook.toLowerCase() !== ZERO ? hook : null
}

/** The project's registered router terminal on one chain (null when unset). */
export async function readRouterTerminalOf(chainId: number, projectId: bigint): Promise<Address | null> {
  const { publicClientFor } = await import('./projectTx')
  const terminal = (await publicClientFor(chainId).readContract({
    address: v6ContractAddress('JBRouterTerminalRegistry', chainId),
    abi: jbRouterTerminalRegistryAbi,
    functionName: 'terminalOf',
    args: [projectId],
  })) as Address
  return terminal && terminal.toLowerCase() !== ZERO ? terminal : null
}

export function buildSetBuybackHookRequest(args: {
  chainId: number
  projectId: bigint
  hook: Address
}): AdminTxRequest {
  const callArgs = [args.projectId, args.hook] as const
  return {
    chainId: args.chainId,
    to: v6ContractAddress('JBBuybackHookRegistry', args.chainId),
    data: encodeFunctionData({
      abi: jbBuybackHookRegistryAbi,
      functionName: 'setHookFor',
      args: callArgs,
    }),
    review: { abi: jbBuybackHookRegistryAbi, functionName: 'setHookFor', args: callArgs },
  }
}

export function buildSetRouterTerminalRequest(args: {
  chainId: number
  projectId: bigint
  terminal: Address
}): AdminTxRequest {
  const callArgs = [args.projectId, args.terminal] as const
  return {
    chainId: args.chainId,
    to: v6ContractAddress('JBRouterTerminalRegistry', args.chainId),
    data: encodeFunctionData({
      abi: jbRouterTerminalRegistryAbi,
      functionName: 'setTerminalFor',
      args: callArgs,
    }),
    review: { abi: jbRouterTerminalRegistryAbi, functionName: 'setTerminalFor', args: callArgs },
  }
}

export function buildInitializeBuybackPoolRequest(args: {
  chainId: number
  projectId: bigint
  fee: number
  tickSpacing: number
  twapWindow: bigint
  terminalToken: Address
  sqrtPriceX96: bigint
}): AdminTxRequest {
  const callArgs = [args.projectId, args.fee, args.tickSpacing, args.twapWindow, args.terminalToken, args.sqrtPriceX96] as const
  return {
    chainId: args.chainId,
    to: v6ContractAddress('JBBuybackHookRegistry', args.chainId),
    data: encodeFunctionData({
      abi: jbBuybackHookRegistryAbi,
      functionName: 'initializePoolFor',
      args: callArgs,
    }),
    review: { abi: jbBuybackHookRegistryAbi, functionName: 'initializePoolFor', args: callArgs },
  }
}

// ─── Buyback pool-init state ─────────────────────────────────────────────────

const TWAP_WINDOW_OF_ABI = [
  {
    type: 'function',
    name: 'twapWindowOf',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'terminalToken', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

export interface PoolProbe {
  /** Pair label, e.g. 'native' or 'USDC'. */
  label: string
  /** The hook's twapWindowOf for this pair — 0 means the pool isn't initialized. */
  twapWindow: number
}

/**
 * Derive the human pool-init state from a hook-set flag + per-pair TWAP probes.
 * A non-zero TWAP window means that pair's Uniswap pool is initialized on the
 * hook; every window 0 means the pool was never initialized. Pure — unit tested.
 */
export function derivePoolInitState(hookIsSet: boolean, probes: PoolProbe[]): string {
  if (!hookIsSet) return 'no hook set'
  const init = probes.filter(probe => probe.twapWindow > 0)
  if (!init.length) return 'not initialized'
  return init.map(probe => `${probe.label} pool (TWAP ${probe.twapWindow}s)`).join(', ')
}

/**
 * Read the buyback pool-init state for a project on one chain: resolve the
 * registered hook, then probe its `twapWindowOf` for the native pair (zero
 * address — the hook stores native pool keys under address(0)) and the chain's
 * USDC pair. Returns a human string, or null when unreadable. There is no scalar
 * getter for the internal PoolKey, so the TWAP window is the init signal.
 */
export async function readPoolInitState(chainId: number, projectId: bigint): Promise<string | null> {
  try {
    const hook = await readBuybackHookOf(chainId, projectId)
    if (!hook) return derivePoolInitState(false, [])

    const { publicClientFor } = await import('./projectTx')
    const { USDC_ADDRESSES } = await import('../constants/chains')
    const client = publicClientFor(chainId)

    const pairs: { label: string; token: Address }[] = [{ label: 'native', token: ZERO as Address }]
    const usdc = (USDC_ADDRESSES as Record<number, Address>)[chainId]
    if (usdc) pairs.push({ label: 'USDC', token: usdc })

    const probes = await Promise.all(
      pairs.map(async (pair): Promise<PoolProbe> => {
        try {
          const window = (await client.readContract({
            address: hook,
            abi: TWAP_WINDOW_OF_ABI,
            functionName: 'twapWindowOf',
            args: [projectId, pair.token],
          })) as bigint
          return { label: pair.label, twapWindow: Number(window) }
        } catch {
          return { label: pair.label, twapWindow: 0 }
        }
      }),
    )
    return derivePoolInitState(true, probes)
  } catch {
    return null
  }
}
