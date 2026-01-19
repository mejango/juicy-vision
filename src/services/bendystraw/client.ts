import { GraphQLClient } from 'graphql-request'
import { createPublicClient, http } from 'viem'
import { useSettingsStore } from '../../stores'
import { VIEM_CHAINS, ZERO_ADDRESS, REV_DEPLOYER, JB_CONTRACTS, RPC_ENDPOINTS, type SupportedChainId } from '../../constants'
import { createCache, CACHE_DURATIONS } from '../../utils'
import {
  PROJECT_QUERY,
  PROJECTS_QUERY,
  PARTICIPANTS_QUERY,
  SEARCH_PROJECTS_QUERY,
  ACTIVITY_EVENTS_QUERY,
  USER_PARTICIPANT_QUERY,
  PROJECT_RULESET_QUERY,
  RECENT_PAY_EVENTS_QUERY,
  CONNECTED_CHAINS_QUERY,
  TOKEN_HOLDERS_QUERY,
  SUCKER_GROUP_PARTICIPANTS_QUERY,
  PROJECT_SUCKER_GROUP_QUERY,
  SUCKER_GROUP_BY_ID_QUERY,
  CASH_OUT_TAX_SNAPSHOTS_QUERY,
  SUCKER_GROUP_MOMENTS_QUERY,
  PAY_EVENTS_HISTORY_QUERY,
  CASH_OUT_EVENTS_HISTORY_QUERY,
} from './queries'

export interface ProjectMetadata {
  name: string
  description?: string
  logoUri?: string
  infoUri?: string
  twitter?: string
  discord?: string
  telegram?: string
}

// Project ruleset info for eligibility checks
export interface ProjectRuleset {
  id?: string
  cycleNumber?: number
  start?: number
  duration: number
  weight: string
  weightCutPercent?: number
  decayPercent: string
  pausePay: boolean
  allowOwnerMinting: boolean
  allowSetCustomToken?: boolean
  allowTerminalMigration?: boolean
  allowSetController?: boolean
  allowSetTerminals?: boolean
  allowCreditTransfers?: boolean
  holdFees?: boolean
  useTotalSurplusForCashOuts?: boolean
  reservedPercent: number
  cashOutTaxRate: number
  baseCurrency?: number
  metadata?: string
  approvalHook?: string
}

export interface Project {
  id: string
  projectId: number
  chainId: number
  version: number
  handle?: string
  owner: string
  metadataUri?: string
  metadata?: ProjectMetadata
  name: string
  description?: string
  logoUri?: string
  volume: string
  volumeUsd?: string
  balance: string
  nftsMintedCount?: number
  paymentsCount: number
  createdAt: number
  // Token symbol from the deployed ERC20 (e.g., "NANA", "REV")
  tokenSymbol?: string
  // Trending fields (7-day window)
  trendingScore?: string
  trendingVolume?: string
  trendingPaymentsCount?: number
}

export interface Participant {
  id: string
  address: string
  wallet?: string // Legacy alias for address
  balance: string
  volume: string
  stakedBalance: string
  lastPaidTimestamp?: number
}

function getClient(): GraphQLClient {
  const endpoint = useSettingsStore.getState().bendystrawEndpoint
  return new GraphQLClient(endpoint)
}

// Create a viem public client for on-chain reads with reliable RPC
function getPublicClient(chainId: number) {
  const chain = VIEM_CHAINS[chainId as SupportedChainId]
  if (!chain) return null

  const rpcUrls = RPC_ENDPOINTS[chainId] || []
  const rpcUrl = rpcUrls[0] // Use first (most reliable) RPC

  return createPublicClient({
    chain,
    transport: http(rpcUrl),
  })
}

export async function fetchProject(projectId: string, chainId: number = 1, version: number = 5): Promise<Project> {
  const client = getClient()
  const data = await client.request<{ project: Project & { metadata: ProjectMetadata | string } }>(
    PROJECT_QUERY,
    { projectId: parseFloat(projectId), chainId: parseFloat(String(chainId)), version: parseFloat(String(version)) }
  )

  const project = data.project
  // metadata comes back as JSON scalar, parse if string
  const metadata: ProjectMetadata | undefined =
    typeof project.metadata === 'string' ? JSON.parse(project.metadata) : project.metadata

  return {
    ...project,
    name: metadata?.name || `Project #${projectId}`,
    description: metadata?.description,
    logoUri: metadata?.logoUri,
  }
}

export async function fetchProjects(options: {
  first?: number
  skip?: number
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
} = {}): Promise<Project[]> {
  const client = getClient()
  const { first = 20, skip = 0, orderBy = 'volume', orderDirection = 'desc' } = options

  const data = await client.request<{ projects: { items: Array<Project> } }>(
    PROJECTS_QUERY,
    { limit: first, offset: skip, orderBy, orderDirection }
  )

  return data.projects.items.map(project => ({
    ...project,
    name: project.name || `Project #${project.projectId}`,
  }))
}

export async function fetchParticipants(
  projectId: string,
  chainId: number = 1,
  limit: number = 50
): Promise<Participant[]> {
  const client = getClient()

  const data = await client.request<{
    participants: {
      totalCount: number
      items: Participant[]
    }
  }>(PARTICIPANTS_QUERY, { projectId: parseInt(projectId), chainId, limit })

  return data.participants?.items || []
}

export async function searchProjects(text: string, first: number = 10): Promise<Project[]> {
  const client = getClient()

  const data = await client.request<{ projectSearch: Array<Project & { metadata: ProjectMetadata }> }>(
    SEARCH_PROJECTS_QUERY,
    { text, first }
  )

  return data.projectSearch.map(project => ({
    ...project,
    name: project.metadata?.name || `Project #${project.projectId}`,
    description: project.metadata?.description,
    logoUri: project.metadata?.logoUri,
  }))
}

// Base properties shared by all activity events
interface BaseActivityEvent {
  id: string
  chainId: number
  timestamp: number
  project: {
    name?: string
    handle?: string
    logoUri?: string
  }
}

// Discriminated union event types
export type ActivityEventType =
  | 'pay'
  | 'projectCreate'
  | 'cashOut'
  | 'addToBalance'
  | 'mintTokens'
  | 'burn'
  | 'deployErc20'
  | 'sendPayouts'
  | 'sendReservedTokens'
  | 'useAllowance'
  | 'mintNft'
  | 'unknown'

export interface PayActivityEvent extends BaseActivityEvent {
  type: 'pay'
  amount: string
  amountUsd?: string
  from: string
  txHash: string
}

export interface ProjectCreateActivityEvent extends BaseActivityEvent {
  type: 'projectCreate'
  from: string
  txHash: string
}

export interface CashOutActivityEvent extends BaseActivityEvent {
  type: 'cashOut'
  reclaimAmount: string
  from: string
  txHash: string
}

export interface AddToBalanceActivityEvent extends BaseActivityEvent {
  type: 'addToBalance'
  amount: string
  from: string
  txHash: string
}

export interface MintTokensActivityEvent extends BaseActivityEvent {
  type: 'mintTokens'
  tokenCount: string
  beneficiary: string
  from: string
  txHash: string
}

export interface BurnActivityEvent extends BaseActivityEvent {
  type: 'burn'
  amount: string
  from: string
  txHash: string
}

export interface DeployErc20ActivityEvent extends BaseActivityEvent {
  type: 'deployErc20'
  symbol: string
  from: string
  txHash: string
}

export interface SendPayoutsActivityEvent extends BaseActivityEvent {
  type: 'sendPayouts'
  amount: string
  from: string
  txHash: string
}

export interface SendReservedTokensActivityEvent extends BaseActivityEvent {
  type: 'sendReservedTokens'
  from: string
  txHash: string
}

export interface UseAllowanceActivityEvent extends BaseActivityEvent {
  type: 'useAllowance'
  amount: string
  from: string
  txHash: string
}

export interface MintNftActivityEvent extends BaseActivityEvent {
  type: 'mintNft'
  from: string
  txHash: string
}

export interface UnknownActivityEvent extends BaseActivityEvent {
  type: 'unknown'
  from?: string
  txHash?: string
}

// Discriminated union of all event types
export type ActivityEvent =
  | PayActivityEvent
  | ProjectCreateActivityEvent
  | CashOutActivityEvent
  | AddToBalanceActivityEvent
  | MintTokensActivityEvent
  | BurnActivityEvent
  | DeployErc20ActivityEvent
  | SendPayoutsActivityEvent
  | SendReservedTokensActivityEvent
  | UseAllowanceActivityEvent
  | MintNftActivityEvent
  | UnknownActivityEvent

// Raw API response type (before transformation)
interface RawActivityEvent {
  id: string
  chainId: number
  timestamp: number
  from?: string
  txHash?: string
  project: {
    name?: string
    handle?: string
    logoUri?: string
  }
  payEvent?: { amount: string; amountUsd?: string; from: string; txHash: string }
  projectCreateEvent?: { from: string; txHash: string }
  cashOutTokensEvent?: { reclaimAmount: string; from: string; txHash: string }
  addToBalanceEvent?: { amount: string; from: string; txHash: string }
  mintTokensEvent?: { tokenCount: string; beneficiary: string; from: string; txHash: string }
  burnEvent?: { amount: string; from: string; txHash: string }
  deployErc20Event?: { symbol: string; from: string; txHash: string }
  sendPayoutsEvent?: { amount: string; from: string; txHash: string }
  sendReservedTokensToSplitsEvent?: { from: string; txHash: string }
  useAllowanceEvent?: { amount: string; from: string; txHash: string }
  mintNftEvent?: { from: string; txHash: string }
}

// Transform raw API event to discriminated union
function transformEvent(raw: RawActivityEvent): ActivityEvent {
  const base = { id: raw.id, chainId: raw.chainId, timestamp: raw.timestamp, project: raw.project }

  if (raw.payEvent) {
    return { ...base, type: 'pay', ...raw.payEvent }
  }
  if (raw.projectCreateEvent) {
    return { ...base, type: 'projectCreate', ...raw.projectCreateEvent }
  }
  if (raw.cashOutTokensEvent) {
    return { ...base, type: 'cashOut', ...raw.cashOutTokensEvent }
  }
  if (raw.addToBalanceEvent) {
    return { ...base, type: 'addToBalance', ...raw.addToBalanceEvent }
  }
  if (raw.mintTokensEvent) {
    return { ...base, type: 'mintTokens', ...raw.mintTokensEvent }
  }
  if (raw.burnEvent) {
    return { ...base, type: 'burn', ...raw.burnEvent }
  }
  if (raw.deployErc20Event) {
    return { ...base, type: 'deployErc20', ...raw.deployErc20Event }
  }
  if (raw.sendPayoutsEvent) {
    return { ...base, type: 'sendPayouts', ...raw.sendPayoutsEvent }
  }
  if (raw.sendReservedTokensToSplitsEvent) {
    return { ...base, type: 'sendReservedTokens', ...raw.sendReservedTokensToSplitsEvent }
  }
  if (raw.useAllowanceEvent) {
    return { ...base, type: 'useAllowance', ...raw.useAllowanceEvent }
  }
  if (raw.mintNftEvent) {
    return { ...base, type: 'mintNft', ...raw.mintNftEvent }
  }
  return { ...base, type: 'unknown', from: raw.from, txHash: raw.txHash }
}

export async function fetchActivityEvents(limit: number = 20, offset: number = 0): Promise<ActivityEvent[]> {
  const client = getClient()

  const data = await client.request<{ activityEvents: { items: RawActivityEvent[] } }>(
    ACTIVITY_EVENTS_QUERY,
    { limit, offset, orderBy: 'timestamp', orderDirection: 'desc' }
  )

  return data.activityEvents.items.map(transformEvent)
}

// Check user's token balance for a specific project
export async function fetchUserTokenBalance(
  projectId: string,
  chainId: number,
  wallet: string
): Promise<{ balance: string; volume: string } | null> {
  const client = getClient()

  const data = await client.request<{
    participants: {
      totalCount: number
      items: Participant[]
    }
  }>(USER_PARTICIPANT_QUERY, {
    projectId: parseInt(projectId),
    chainId,
    address: wallet.toLowerCase(),
  })

  if (!data.participants?.items || data.participants.items.length === 0) {
    return null
  }

  return {
    balance: data.participants.items[0].balance,
    volume: data.participants.items[0].volume,
  }
}

export interface QueuedRuleset {
  id: string
  cycleNumber: number
  start: number
  duration: number
  weight: string
  weightCutPercent?: number
  decayPercent?: string
  pausePay?: boolean
  reservedPercent?: number
  cashOutTaxRate?: number
  approvalHook?: string
}

export interface ProjectWithRuleset {
  id: string
  projectId: number
  chainId: number
  owner: string
  name: string
  balance: string
  createdAt?: number
  currentRuleset: ProjectRuleset | null
  queuedRulesets?: QueuedRuleset[]
}

// ABI for JBDirectory.controllerOf - get the controller for a project
const JB_DIRECTORY_ABI = [
  {
    name: 'controllerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

// ABI for JBController.currentRulesetOf - returns ruleset AND decoded metadata
const JB_CONTROLLER_ABI = [
  {
    name: 'currentRulesetOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      {
        name: 'ruleset',
        type: 'tuple',
        components: [
          { name: 'cycleNumber', type: 'uint48' },
          { name: 'id', type: 'uint48' },
          { name: 'basedOnId', type: 'uint48' },
          { name: 'start', type: 'uint48' },
          { name: 'duration', type: 'uint32' },
          { name: 'weight', type: 'uint112' },
          { name: 'weightCutPercent', type: 'uint32' },
          { name: 'approvalHook', type: 'address' },
          { name: 'metadata', type: 'uint256' },
        ],
      },
      {
        name: 'metadata',
        type: 'tuple',
        components: [
          { name: 'reservedPercent', type: 'uint16' },
          { name: 'cashOutTaxRate', type: 'uint16' },
          { name: 'baseCurrency', type: 'uint32' },
          { name: 'pausePay', type: 'bool' },
          { name: 'pauseCreditTransfers', type: 'bool' },
          { name: 'allowOwnerMinting', type: 'bool' },
          { name: 'allowSetCustomToken', type: 'bool' },
          { name: 'allowTerminalMigration', type: 'bool' },
          { name: 'allowSetTerminals', type: 'bool' },
          { name: 'allowSetController', type: 'bool' },
          { name: 'allowAddAccountingContext', type: 'bool' },
          { name: 'allowAddPriceFeed', type: 'bool' },
          { name: 'ownerMustSendPayouts', type: 'bool' },
          { name: 'holdFees', type: 'bool' },
          { name: 'useTotalSurplusForCashOuts', type: 'bool' },
          { name: 'useDataHookForPay', type: 'bool' },
          { name: 'useDataHookForCashOut', type: 'bool' },
          { name: 'dataHook', type: 'address' },
          { name: 'metadata', type: 'uint16' },
        ],
      },
    ],
  },
] as const

// Shared ruleset tuple components
const RULESET_COMPONENTS = [
  { name: 'cycleNumber', type: 'uint48' },
  { name: 'id', type: 'uint48' },
  { name: 'basedOnId', type: 'uint48' },
  { name: 'start', type: 'uint48' },
  { name: 'duration', type: 'uint32' },
  { name: 'weight', type: 'uint112' },
  { name: 'weightCutPercent', type: 'uint32' },
  { name: 'approvalHook', type: 'address' },
  { name: 'metadata', type: 'uint256' },
] as const

// ABI for JBRulesets - multiple functions for ruleset queries
const JB_RULESETS_ABI = [
  {
    name: 'currentOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
  },
  {
    name: 'latestQueuedOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      { name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS },
      { name: 'approvalStatus', type: 'uint8' },
    ],
  },
  {
    name: 'upcomingOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
  },
  {
    name: 'getRulesetOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
    ],
    outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
  },
  {
    name: 'allOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'startingId', type: 'uint256' },
      { name: 'size', type: 'uint256' },
    ],
    outputs: [{ name: 'rulesets', type: 'tuple[]', components: RULESET_COMPONENTS }],
  },
] as const

export async function fetchProjectWithRuleset(
  projectId: string,
  chainId: number = 1,
  version: number = 5
): Promise<ProjectWithRuleset | null> {
  const client = getClient()

  try {
    // Fetch basic project info from API
    const data = await client.request<{
      project: {
        id: string
        projectId: number
        chainId: number
        owner: string
        metadata?: { name?: string } | string
        balance: string
        createdAt?: number
      }
    }>(PROJECT_RULESET_QUERY, {
      projectId: parseFloat(projectId),
      chainId: parseFloat(String(chainId)),
      version: parseFloat(String(version))
    })

    if (!data.project) {
      return null
    }

    // Parse metadata if it's a string
    let name = `Project #${projectId}`
    if (data.project.metadata) {
      const metadata = typeof data.project.metadata === 'string'
        ? JSON.parse(data.project.metadata)
        : data.project.metadata
      name = metadata?.name || name
    }

    // Fetch ruleset from on-chain via the project's controller
    // Important: Projects can have different controllers, so we must look up via JBDirectory
    let currentRuleset: ProjectRuleset | null = null
    const publicClient = getPublicClient(chainId)
    if (publicClient) {
      try {

        // Get the controller address for this project from JBDirectory
        const controllerAddress = await publicClient.readContract({
          address: JB_CONTRACTS.JBDirectory,
          abi: JB_DIRECTORY_ABI,
          functionName: 'controllerOf',
          args: [BigInt(projectId)],
        })

        if (controllerAddress && controllerAddress !== ZERO_ADDRESS) {
          // Call the controller's currentRulesetOf - returns both ruleset AND decoded metadata
          const [ruleset, metadata] = await publicClient.readContract({
            address: controllerAddress,
            abi: JB_CONTROLLER_ABI,
            functionName: 'currentRulesetOf',
            args: [BigInt(projectId)],
          })

          // Only set if there's a valid ruleset (cycleNumber > 0)
          if (ruleset.cycleNumber > 0) {
            currentRuleset = {
              id: String(ruleset.id),
              cycleNumber: Number(ruleset.cycleNumber),
              start: Number(ruleset.start),
              duration: Number(ruleset.duration),
              weight: String(ruleset.weight),
              weightCutPercent: Number(ruleset.weightCutPercent),
              decayPercent: String(ruleset.weightCutPercent),
              // Use properly decoded metadata from controller
              pausePay: metadata.pausePay,
              allowOwnerMinting: metadata.allowOwnerMinting,
              allowSetCustomToken: metadata.allowSetCustomToken,
              allowTerminalMigration: metadata.allowTerminalMigration,
              allowSetController: metadata.allowSetController,
              allowSetTerminals: metadata.allowSetTerminals,
              allowCreditTransfers: !metadata.pauseCreditTransfers,
              holdFees: metadata.holdFees,
              useTotalSurplusForCashOuts: metadata.useTotalSurplusForCashOuts,
              reservedPercent: Number(metadata.reservedPercent),
              cashOutTaxRate: Number(metadata.cashOutTaxRate),
              baseCurrency: Number(metadata.baseCurrency),
              approvalHook: ruleset.approvalHook,
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch ruleset from chain:', err)
      }
    }

    return {
      id: data.project.id,
      projectId: data.project.projectId,
      chainId: data.project.chainId,
      owner: data.project.owner,
      name,
      balance: data.project.balance,
      createdAt: data.project.createdAt,
      currentRuleset,
      queuedRulesets: [],
    }
  } catch (err) {
    console.error('fetchProjectWithRuleset error:', err)
    return null
  }
}

// Check if user is project owner
export async function isProjectOwner(
  projectId: string,
  chainId: number,
  wallet: string
): Promise<boolean> {
  const project = await fetchProjectWithRuleset(projectId, chainId)
  if (!project) return false
  return project.owner.toLowerCase() === wallet.toLowerCase()
}

// Check if payments are enabled for a project
export async function arePaymentsEnabled(
  projectId: string,
  chainId: number
): Promise<{ enabled: boolean; reason?: string }> {
  const project = await fetchProjectWithRuleset(projectId, chainId)

  if (!project) {
    return { enabled: false, reason: 'Project not found' }
  }

  if (!project.currentRuleset) {
    return { enabled: false, reason: 'No active ruleset' }
  }

  if (project.currentRuleset.pausePay) {
    return { enabled: false, reason: 'Payments are currently paused for this project' }
  }

  return { enabled: true }
}

// Distributable payout info
export interface DistributablePayout {
  available: bigint       // Amount available to distribute now
  limit: bigint          // Total payout limit for this ruleset
  used: bigint           // Amount already distributed this ruleset
  currency: number       // Currency (1=ETH, 2=USD)
}

// ABI for JBFundAccessLimits
const JB_FUND_ACCESS_LIMITS_ABI = [
  {
    name: 'payoutLimitOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'terminal', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'currency', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'usedPayoutLimitOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'terminal', type: 'address' },
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'currency', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// Native token address constant (ETH)
const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as `0x${string}`

// Max uint256 represents "unlimited" payout limit
const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

// Fetch the distributable payout amount for a project
// This is the payout limit minus what's already been distributed this ruleset
// Returns available amount based on fund access limits, NOT the total balance
export async function fetchDistributablePayout(
  projectId: string,
  chainId: number
): Promise<DistributablePayout | null> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) return null

  try {
    // Get current ruleset from JBRulesets
    const ruleset = await publicClient.readContract({
      address: JB_CONTRACTS.JBRulesets,
      abi: JB_RULESETS_ABI,
      functionName: 'currentOf',
      args: [BigInt(projectId)],
    })

    if (!ruleset.id) {
      return { available: 0n, limit: 0n, used: 0n, currency: 1 }
    }

    // Get payout limit for ETH (currency 1)
    const payoutLimit = await publicClient.readContract({
      address: JB_CONTRACTS.JBFundAccessLimits,
      abi: JB_FUND_ACCESS_LIMITS_ABI,
      functionName: 'payoutLimitOf',
      args: [BigInt(projectId), BigInt(ruleset.id), JB_CONTRACTS.JBMultiTerminal, NATIVE_TOKEN, 1n],
    })

    // Get used payout limit
    const usedPayoutLimit = await publicClient.readContract({
      address: JB_CONTRACTS.JBFundAccessLimits,
      abi: JB_FUND_ACCESS_LIMITS_ABI,
      functionName: 'usedPayoutLimitOf',
      args: [JB_CONTRACTS.JBMultiTerminal, BigInt(projectId), BigInt(ruleset.id), NATIVE_TOKEN, 1n],
    })

    // Handle different payout limit scenarios:
    // - 0 means no payout limit is set (no payouts allowed)
    // - max uint256 means unlimited
    // - Any other value is the actual cap
    let available: bigint

    if (payoutLimit === 0n) {
      // No payout limit configured = no payouts allowed
      available = 0n
    } else if (payoutLimit === MAX_UINT256) {
      // Unlimited payout limit - fetch terminal balance
      // For unlimited, we need to get the actual terminal balance
      const project = await fetchProject(projectId, chainId)
      const balance = project?.balance ? BigInt(project.balance) : 0n
      available = balance
    } else {
      // Normal limit - return remaining allowance
      available = payoutLimit > usedPayoutLimit ? payoutLimit - usedPayoutLimit : 0n
    }

    return {
      available,
      limit: payoutLimit,
      used: usedPayoutLimit,
      currency: 1,
    }
  } catch (err) {
    console.error('Failed to fetch distributable payout:', err)
    return null
  }
}

// Connected chain info for a project
export interface ConnectedChain {
  chainId: number
  projectId: number
}

// Get all chains a project exists on via suckerGroup
// Returns empty array if no suckerGroup found (signals fallback to all chains)
export async function fetchConnectedChains(
  projectId: string,
  chainId: number,
  version: number = 5
): Promise<ConnectedChain[]> {
  const client = getClient()

  try {
    const data = await client.request<{
      project: {
        suckerGroup?: {
          projects: {
            items: Array<{ projectId: number; chainId: number }>
          }
        }
      }
    }>(CONNECTED_CHAINS_QUERY, {
      projectId: parseFloat(projectId),
      chainId: parseFloat(String(chainId)),
      version: parseFloat(String(version)),
    })

    const items = data.project?.suckerGroup?.projects?.items
    if (!items || items.length === 0) {
      return []
    }

    return items.map(item => ({
      chainId: item.chainId,
      projectId: item.projectId,
    }))
  } catch {
    return []
  }
}

// Issuance rate info calculated from recent pay events
export interface IssuanceRate {
  tokensPerEth: number  // Tokens (in display units) per 1 ETH
  basedOnPayments: number  // Number of payments used to calculate
}

// Get the current issuance rate by looking at recent pay events
// This is more accurate than the weight because it includes any hooks/modifiers
export async function fetchIssuanceRate(
  projectId: string,
  chainId: number,
  version: number = 5
): Promise<IssuanceRate | null> {
  const client = getClient()

  try {
    const data = await client.request<{
      payEvents: {
        items: Array<{
          amount: string
          newlyIssuedTokenCount: string
          timestamp: number
        }>
      }
    }>(RECENT_PAY_EVENTS_QUERY, {
      projectId: parseInt(projectId),
      chainId: chainId,
      version: version,
    })

    const items = data.payEvents?.items
    if (!items || items.length === 0) {
      return null
    }

    // Calculate average rate from recent payments
    let totalTokens = BigInt(0)
    let totalAmount = BigInt(0)

    for (const event of items) {
      totalTokens += BigInt(event.newlyIssuedTokenCount)
      totalAmount += BigInt(event.amount)
    }

    if (totalAmount === BigInt(0)) {
      return null
    }

    // Calculate tokens per wei (tokensPerEth is a misnomer - it's actually tokens per smallest unit)
    // For ETH projects: tokens per ETH-wei
    // For USDC projects: tokens per USDC-wei
    const tokensPerEth = (Number(totalTokens) / Number(totalAmount))

    return {
      tokensPerEth,
      basedOnPayments: items.length,
    }
  } catch (err) {
    console.error('Failed to fetch issuance rate:', err)
    return null
  }
}

// Sucker group balance info
export interface SuckerGroupBalance {
  totalBalance: string  // Pre-aggregated balance from suckerGroup entity
  totalPaymentsCount: number  // Sum of all payments across the group
  currency: number  // 1 = ETH, 2 = USD
  decimals: number  // Token decimals (18 for ETH, 6 for USDC)
  projectBalances: Array<{ chainId: number; projectId: number; balance: string; paymentsCount: number; currency?: number; decimals?: number }>
}

// Get the total balance across all projects in a sucker group
// Uses the suckerGroup entity's pre-aggregated balance (like revnet-app)
export async function fetchSuckerGroupBalance(
  projectId: string,
  chainId: number,
  version: number = 5
): Promise<SuckerGroupBalance> {
  const client = getClient()

  try {
    // First, get the suckerGroupId for this project
    const projectData = await client.request<{
      project: {
        id: string
        balance: string
        paymentsCount: number
        suckerGroupId?: string
      }
    }>(PROJECT_SUCKER_GROUP_QUERY, {
      projectId: parseFloat(projectId),
      chainId: parseFloat(String(chainId)),
      version: parseFloat(String(version)),
    })

    if (!projectData.project) {
      console.error('[fetchSuckerGroupBalance] Project not found:', projectId, chainId)
      return {
        totalBalance: '0',
        totalPaymentsCount: 0,
        currency: 1,
        decimals: 18,
        projectBalances: [],
      }
    }

    const suckerGroupId = projectData.project.suckerGroupId

    // If no suckerGroup, return single project balance (assume ETH, 18 decimals)
    if (!suckerGroupId) {
      return {
        totalBalance: projectData.project.balance,
        totalPaymentsCount: projectData.project.paymentsCount || 0,
        currency: 1,  // Assume ETH for single projects without suckerGroup
        decimals: 18,
        projectBalances: [{
          chainId,
          projectId: parseInt(projectId),
          balance: projectData.project.balance,
          paymentsCount: projectData.project.paymentsCount || 0,
          currency: 1,
          decimals: 18,
        }],
      }
    }

    // Query the suckerGroup directly for its pre-aggregated balance
    const groupData = await client.request<{
      suckerGroup: {
        id: string
        balance: string  // Pre-aggregated balance across all chains
        tokenSupply: string
        paymentsCount: number
        contributorsCount: number
        projects: {
          items: Array<{
            projectId: number
            chainId: number
            balance: string
            tokenSupply: string
            paymentsCount: number
            decimals: number
            currency: number
          }>
        }
      }
    }>(SUCKER_GROUP_BY_ID_QUERY, {
      id: suckerGroupId,
    })

    const group = groupData.suckerGroup
    if (!group) {
      // Fallback to project balance if suckerGroup query fails
      return {
        totalBalance: projectData.project.balance,
        totalPaymentsCount: projectData.project.paymentsCount || 0,
        currency: 1,
        decimals: 18,
        projectBalances: [{
          chainId,
          projectId: parseInt(projectId),
          balance: projectData.project.balance,
          paymentsCount: projectData.project.paymentsCount || 0,
          currency: 1,
          decimals: 18,
        }],
      }
    }

    // Get currency/decimals from first project (they should all be the same)
    const firstProject = group.projects?.items?.[0]
    const rawDecimals = firstProject?.decimals
    const rawCurrency = firstProject?.currency

    // Determine decimals and currency
    // IMPORTANT: 6 decimals = USDC (currency 2), 18 decimals = ETH (currency 1)
    // We prioritize decimals-based inference because API may return incorrect currency
    const decimals = rawDecimals ?? 18
    // If decimals is 6, it's definitely USDC regardless of what API says
    const currency = decimals === 6 ? 2 : (rawCurrency ?? 1)

    // Use the pre-aggregated balance from suckerGroup entity
    return {
      totalBalance: group.balance,
      totalPaymentsCount: group.paymentsCount || 0,
      currency,
      decimals,
      projectBalances: group.projects?.items?.map(item => ({
        chainId: item.chainId,
        projectId: item.projectId,
        balance: item.balance,
        paymentsCount: item.paymentsCount || 0,
        currency: item.currency,
        decimals: item.decimals,
      })) || [],
    }
  } catch (err) {
    console.error('Failed to fetch sucker group balance:', err)
    return {
      totalBalance: '0',
      totalPaymentsCount: 0,
      currency: 1,
      decimals: 18,
      projectBalances: [],
    }
  }
}

// Get the suckerGroupId for a project (used for multi-chain aggregation)
export async function fetchProjectSuckerGroupId(
  projectId: string,
  chainId: number,
  version: number = 5
): Promise<string | null> {
  const client = getClient()

  try {
    const projectData = await client.request<{
      project: { suckerGroupId?: string }
    }>(PROJECT_SUCKER_GROUP_QUERY, {
      projectId: parseFloat(projectId),
      chainId: parseFloat(String(chainId)),
      version: parseFloat(String(version)),
    })

    return projectData.project?.suckerGroupId || null
  } catch (err) {
    console.error('Failed to fetch suckerGroupId:', err)
    return null
  }
}

// Get unique token holders (owners) count for a project across all chains
// Fetches participants with balance > 0 via suckerGroupId and deduplicates by wallet
export async function fetchOwnersCount(
  projectId: string,
  chainId: number,
  version: number = 5
): Promise<number> {
  const client = getClient()

  // Helper to fetch single-chain participants
  const fetchSingleChain = async (): Promise<number> => {
    try {
      const data = await client.request<{
        participants: {
          totalCount: number
          items: Array<{ address: string; chainId: number; balance: string }>
        }
      }>(TOKEN_HOLDERS_QUERY, {
        projectId: parseInt(projectId),
        chainId,
        limit: 1000,
      })

      if (!data.participants?.items || data.participants.items.length === 0) {
        return 0
      }

      const uniqueWallets = new Set(
        data.participants.items.map(p => p.address.toLowerCase())
      )
      return uniqueWallets.size
    } catch {
      return 0
    }
  }

  try {
    // First get the suckerGroupId for this project
    const projectData = await client.request<{
      project: { suckerGroupId?: string }
    }>(PROJECT_SUCKER_GROUP_QUERY, {
      projectId: parseFloat(projectId),
      chainId: parseFloat(String(chainId)),
      version: parseFloat(String(version)),
    })

    const suckerGroupId = projectData.project?.suckerGroupId

    if (!suckerGroupId) {
      return fetchSingleChain()
    }

    // Try suckerGroup query first
    try {
      const data = await client.request<{
        participants: {
          totalCount: number
          items: Array<{ address: string; chainId: number; balance: string }>
        }
      }>(SUCKER_GROUP_PARTICIPANTS_QUERY, {
        suckerGroupId,
        limit: 10000,
      })

      if (data.participants?.items && data.participants.items.length > 0) {
        const uniqueWallets = new Set(
          data.participants.items.map(p => p.address.toLowerCase())
        )
        return uniqueWallets.size
      }
    } catch (err) {
      console.error('SuckerGroup query failed in fetchOwnersCount, trying fallback:', err)
    }

    // Fallback to single-chain if suckerGroup query failed or returned empty
    return fetchSingleChain()
  } catch (err) {
    console.error('Failed to fetch owners count:', err)
    return 0
  }
}

// ETH price cache
let ethPriceCache: { price: number; timestamp: number } | null = null
const ETH_PRICE_CACHE_DURATION = 20 * 60 * 1000 // 20 minutes

// Fetch current ETH price in USD
export async function fetchEthPrice(): Promise<number> {
  // Check cache
  if (ethPriceCache && Date.now() - ethPriceCache.timestamp < ETH_PRICE_CACHE_DURATION) {
    return ethPriceCache.price
  }

  try {
    const response = await fetch('https://juicebox.money/api/juicebox/prices/ethusd')
    const data = await response.json()
    const price = parseFloat(data.price)

    // Update cache
    ethPriceCache = { price, timestamp: Date.now() }

    return price
  } catch (err) {
    console.error('Failed to fetch ETH price:', err)
    return ethPriceCache?.price ?? 3000 // Fallback to cached or default
  }
}

// ABI for JBTokens.tokenOf and ERC20.symbol
const TOKEN_ABI = [
  {
    name: 'tokenOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

// Token symbol cache (caches the project's issued ERC20 token symbol)
const tokenSymbolCache = createCache<string>(CACHE_DURATIONS.LONG)

// Fetch the project's issued ERC20 token symbol (e.g., NANA for Bananapus)
// This is different from the base/accounting token (ETH/USDC)
export async function fetchProjectTokenSymbol(
  projectId: string,
  chainId: number,
  version: number = 5
): Promise<string | null> {
  const cacheKey = `${chainId}-${projectId}-v${version}`
  const cached = tokenSymbolCache.get(cacheKey)
  if (cached) return cached

  const publicClient = getPublicClient(chainId)
  if (!publicClient) return null

  try {
    // Get the token address from JBTokens
    const tokenAddress = await publicClient.readContract({
      address: JB_CONTRACTS.JBTokens,
      abi: TOKEN_ABI,
      functionName: 'tokenOf',
      args: [BigInt(projectId)],
    })

    // Zero address means no ERC20 token deployed yet
    if (tokenAddress === ZERO_ADDRESS) {
      return null
    }

    // Get the symbol from the token contract
    const symbol = await publicClient.readContract({
      address: tokenAddress,
      abi: TOKEN_ABI,
      functionName: 'symbol',
    })

    // Cache the result
    tokenSymbolCache.set(cacheKey, symbol)

    return symbol
  } catch (err) {
    console.error('Failed to fetch project token symbol:', err)
    return null
  }
}

// Token address cache (caches the project's issued ERC20 token address)
const tokenAddressCache = createCache<string>(CACHE_DURATIONS.LONG)

// Fetch the project's issued ERC20 token address
export async function fetchProjectTokenAddress(
  projectId: string,
  chainId: number,
  version: number = 5
): Promise<string | null> {
  const cacheKey = `token-addr-${chainId}-${projectId}-v${version}`
  const cached = tokenAddressCache.get(cacheKey)
  if (cached) return cached

  const publicClient = getPublicClient(chainId)
  if (!publicClient) return null

  try {
    const tokenAddress = await publicClient.readContract({
      address: JB_CONTRACTS.JBTokens,
      abi: TOKEN_ABI,
      functionName: 'tokenOf',
      args: [BigInt(projectId)],
    })

    // Zero address means no ERC20 token deployed yet
    if (tokenAddress === ZERO_ADDRESS) {
      return null
    }

    // Cache and return the address
    tokenAddressCache.set(cacheKey, tokenAddress)
    return tokenAddress
  } catch (err) {
    console.error('Failed to fetch project token address:', err)
    return null
  }
}

// ============================================================================
// REVNET HELPERS
// ============================================================================

// Check if a project is a Revnet (owned by the REVDeployer on any version)
export function isRevnet(owner: string): boolean {
  // REVDeployer uses CREATE2 so same address on all chains
  return owner.toLowerCase() === REV_DEPLOYER.toLowerCase()
}

// ABI for REVDeployer.configurationOf
// REVStageConfig components for reading Revnet stages
const REV_STAGE_CONFIG_COMPONENTS = [
  { name: 'startsAtOrAfter', type: 'uint40' },
  { name: 'splitPercent', type: 'uint16' },
  { name: 'initialIssuance', type: 'uint112' },
  { name: 'issuanceDecayFrequency', type: 'uint32' },
  { name: 'issuanceDecayPercent', type: 'uint32' },
  { name: 'cashOutTaxRate', type: 'uint16' },
  { name: 'extraMetadata', type: 'uint16' },
] as const

// Simplified ABI for fetching operator - uses raw bytes decoding approach
const REV_DEPLOYER_ABI = [
  {
    name: 'configurationOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'revnetId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'description', type: 'tuple', components: [
            { name: 'name', type: 'string' },
            { name: 'ticker', type: 'string' },
            { name: 'uri', type: 'string' },
            { name: 'salt', type: 'bytes32' },
          ]},
          { name: 'baseCurrency', type: 'uint32' },
          { name: 'splitOperator', type: 'address' },
          { name: 'stageConfigurations', type: 'tuple[]', components: REV_STAGE_CONFIG_COMPONENTS },
          { name: 'loanSources', type: 'tuple[]', components: [
            { name: 'token', type: 'address' },
            { name: 'terminal', type: 'address' },
          ]},
          { name: 'loans', type: 'tuple[]', components: [
            { name: 'amount', type: 'uint112' },
            { name: 'source', type: 'uint32' },
            { name: 'prepaidDuration', type: 'uint32' },
            { name: 'prepaidFeePercent', type: 'uint32' },
            { name: 'beneficiary', type: 'address' },
          ]},
          { name: 'hookConfigurations', type: 'tuple[]', components: [
            { name: 'hook', type: 'address' },
            { name: 'data', type: 'bytes' },
          ]},
          { name: 'suckerDeploymentConfiguration', type: 'tuple', components: [
            { name: 'deployer', type: 'address' },
            { name: 'mappings', type: 'tuple[]', components: [
              { name: 'localToken', type: 'address' },
              { name: 'remoteToken', type: 'address' },
              { name: 'minGas', type: 'uint32' },
              { name: 'minBridgeAmount', type: 'uint256' },
            ]},
          ]},
        ],
      },
    ],
  },
  {
    name: 'stageOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'revnetId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// Cache for Revnet operator addresses
const revnetOperatorCache = createCache<string>(CACHE_DURATIONS.LONG)

// Fetch the operator (splitOperator) for a Revnet project
export async function fetchRevnetOperator(
  projectId: string,
  chainId: number
): Promise<string | null> {
  const cacheKey = `${chainId}-${projectId}`
  const cached = revnetOperatorCache.get(cacheKey)
  if (cached) return cached

  const publicClient = getPublicClient(chainId)
  if (!publicClient) return null

  try {
    // Get the configuration from REVDeployer
    const config = await publicClient.readContract({
      address: REV_DEPLOYER,
      abi: REV_DEPLOYER_ABI,
      functionName: 'configurationOf',
      args: [BigInt(projectId)],
    })

    const splitOperator = config.splitOperator

    // If zero address, return null
    if (splitOperator === ZERO_ADDRESS) {
      return null
    }

    // Cache the result
    revnetOperatorCache.set(cacheKey, splitOperator)

    return splitOperator
  } catch (err) {
    console.error('Failed to fetch Revnet operator:', err)
    return null
  }
}

// ============================================================================
// ALL RULESETS (PAST, CURRENT, FUTURE)
// ============================================================================

// Revnet stage configuration
export interface RevnetStage {
  stageNumber: number
  startsAtOrAfter: number
  splitPercent: number // basis points (0-10000)
  initialIssuance: string
  issuanceDecayFrequency: number
  issuanceDecayPercent: number // basis points
  cashOutTaxRate: number // basis points (0-10000)
  isCurrent: boolean
  isPast: boolean
  isFuture: boolean
}

// Full ruleset history entry
export interface RulesetHistoryEntry {
  cycleNumber: number
  id: string
  start: number
  duration: number
  weight: string
  weightCutPercent: number
  reservedPercent?: number
  cashOutTaxRate?: number
  pausePay?: boolean
  allowOwnerMinting?: boolean
  status: 'past' | 'current' | 'queued' | 'upcoming'
}

// Complete ruleset data including history and Revnet stages
export interface AllRulesetsData {
  owner: string
  isRevnet: boolean
  currentStage?: number
  stages?: RevnetStage[]
  rulesets: RulesetHistoryEntry[]
  queuedRuleset?: RulesetHistoryEntry
  upcomingRuleset?: RulesetHistoryEntry
}

// Fetch Revnet stages configuration
export async function fetchRevnetStages(
  projectId: string,
  chainId: number
): Promise<{ stages: RevnetStage[]; currentStage: number } | null> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) return null

  try {
    // Get current stage number
    const currentStage = await publicClient.readContract({
      address: REV_DEPLOYER,
      abi: REV_DEPLOYER_ABI,
      functionName: 'stageOf',
      args: [BigInt(projectId)],
    })

    // Get full configuration including stages
    const config = await publicClient.readContract({
      address: REV_DEPLOYER,
      abi: REV_DEPLOYER_ABI,
      functionName: 'configurationOf',
      args: [BigInt(projectId)],
    })

    const stageConfigs = config.stageConfigurations
    const currentStageNum = Number(currentStage)

    const stages: RevnetStage[] = stageConfigs.map((stage, index) => ({
      stageNumber: index + 1,
      startsAtOrAfter: Number(stage.startsAtOrAfter),
      splitPercent: Number(stage.splitPercent),
      initialIssuance: String(stage.initialIssuance),
      issuanceDecayFrequency: Number(stage.issuanceDecayFrequency),
      issuanceDecayPercent: Number(stage.issuanceDecayPercent),
      cashOutTaxRate: Number(stage.cashOutTaxRate),
      isCurrent: index + 1 === currentStageNum,
      isPast: index + 1 < currentStageNum,
      isFuture: index + 1 > currentStageNum,
    }))

    return { stages, currentStage: currentStageNum }
  } catch (err) {
    console.error('Failed to fetch Revnet stages:', err)
    return null
  }
}

// Fetch historical rulesets by enumerating all cycles from cycle 1 to current
// Returns array with current first, then past rulesets (newest to oldest)
export async function fetchRulesetHistory(
  projectId: string,
  chainId: number,
  currentRulesetId: string,
  maxHistory: number = 20
): Promise<RulesetHistoryEntry[]> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) return []

  try {
    // First, get the current ruleset to know what cycle we're on
    const currentRuleset = await publicClient.readContract({
      address: JB_CONTRACTS.JBRulesets,
      abi: JB_RULESETS_ABI,
      functionName: 'getRulesetOf',
      args: [BigInt(projectId), BigInt(currentRulesetId)],
    })

    if (currentRuleset.cycleNumber === 0) return []

    const currentCycleNum = Number(currentRuleset.cycleNumber)

    // Walk back via basedOnId to collect all distinct ruleset configurations
    // These are the "base" rulesets that may cover multiple cycles each
    const distinctRulesets: Array<{
      cycleNumber: number
      id: bigint
      start: number
      duration: number
      weight: string
      weightCutPercent: number
    }> = []

    let rulesetId = BigInt(currentRulesetId)
    let count = 0

    while (rulesetId > 0n && count < 50) {
      try {
        const ruleset = await publicClient.readContract({
          address: JB_CONTRACTS.JBRulesets,
          abi: JB_RULESETS_ABI,
          functionName: 'getRulesetOf',
          args: [BigInt(projectId), rulesetId],
        })

        if (ruleset.cycleNumber === 0) break

        distinctRulesets.push({
          cycleNumber: Number(ruleset.cycleNumber),
          id: BigInt(ruleset.id),
          start: Number(ruleset.start),
          duration: Number(ruleset.duration),
          weight: String(ruleset.weight),
          weightCutPercent: Number(ruleset.weightCutPercent),
        })

        // Move to previous ruleset
        rulesetId = BigInt(ruleset.basedOnId)
        count++
      } catch {
        break
      }
    }

    // Sort distinct rulesets by cycle number (ascending)
    distinctRulesets.sort((a, b) => a.cycleNumber - b.cycleNumber)

    // Now expand to all cycles from 1 to current
    // Each distinct ruleset covers cycles from its cycleNumber until the next distinct ruleset
    const allCycles: RulesetHistoryEntry[] = []

    for (let cycle = 1; cycle <= currentCycleNum; cycle++) {
      // Find which distinct ruleset this cycle is based on
      // It's the last distinct ruleset with cycleNumber <= cycle
      let baseRuleset = distinctRulesets[0]
      for (const rs of distinctRulesets) {
        if (rs.cycleNumber <= cycle) {
          baseRuleset = rs
        } else {
          break
        }
      }

      // Calculate how many cycles after the base ruleset this is
      const cyclesAfterBase = cycle - baseRuleset.cycleNumber

      // Calculate the start time for this cycle
      let cycleStart: number
      if (cyclesAfterBase === 0) {
        cycleStart = baseRuleset.start
      } else {
        cycleStart = baseRuleset.start + (cyclesAfterBase * baseRuleset.duration)
      }

      // Calculate the actual weight for this cycle by applying weight cuts
      // Weight decreases by weightCutPercent each cycle
      const decayMultiplier = 1 - (baseRuleset.weightCutPercent / 1e9)
      const actualWeight = BigInt(Math.floor(
        parseFloat(baseRuleset.weight) * Math.pow(decayMultiplier, cyclesAfterBase)
      ))

      allCycles.push({
        cycleNumber: cycle,
        id: String(baseRuleset.id),
        start: cycleStart,
        duration: baseRuleset.duration,
        weight: String(actualWeight),
        weightCutPercent: baseRuleset.weightCutPercent,
        status: cycle === currentCycleNum ? 'current' : 'past',
      })
    }

    // Limit to maxHistory and reverse so current is first
    const limited = allCycles.slice(-maxHistory).reverse()

    return limited
  } catch (err) {
    console.error('Failed to fetch ruleset history:', err)
    return []
  }
}

// Simple ruleset type for price charts (avoids cycle expansion complexity)
export interface SimpleRuleset {
  start: number
  duration: number
  weight: string
  weightCutPercent: number
}

// Fetch all rulesets using allOf for reliable historical data
// This matches the approach used by revnet-app
export async function fetchAllRulesets(
  projectId: string,
  chainId: number
): Promise<SimpleRuleset[]> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) return []

  try {
    const MAX_RULESETS = 100
    const rulesets = await publicClient.readContract({
      address: JB_CONTRACTS.JBRulesets,
      abi: JB_RULESETS_ABI,
      functionName: 'allOf',
      args: [BigInt(projectId), 0n, BigInt(MAX_RULESETS)],
    })

    if (!rulesets || rulesets.length === 0) return []

    // Convert to simple ruleset format and filter out empty entries
    const result: SimpleRuleset[] = rulesets
      .filter((r) => r.cycleNumber > 0)
      .map((r) => ({
        start: Number(r.start),
        duration: Number(r.duration),
        weight: String(r.weight),
        weightCutPercent: Number(r.weightCutPercent),
      }))
      .sort((a, b) => a.start - b.start) // Sort chronologically

    return result
  } catch (err) {
    console.error('Failed to fetch all rulesets:', err)
    return []
  }
}

// Fetch queued and upcoming rulesets
export async function fetchQueuedRulesets(
  projectId: string,
  chainId: number
): Promise<{ queued?: RulesetHistoryEntry; upcoming?: RulesetHistoryEntry }> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) return {}

  try {
    const result: { queued?: RulesetHistoryEntry; upcoming?: RulesetHistoryEntry } = {}

    // Get latest queued ruleset
    try {
      const [queuedRuleset, _approvalStatus] = await publicClient.readContract({
        address: JB_CONTRACTS.JBRulesets,
        abi: JB_RULESETS_ABI,
        functionName: 'latestQueuedOf',
        args: [BigInt(projectId)],
      })

      if (queuedRuleset.cycleNumber > 0) {
        result.queued = {
          cycleNumber: Number(queuedRuleset.cycleNumber),
          id: String(queuedRuleset.id),
          start: Number(queuedRuleset.start),
          duration: Number(queuedRuleset.duration),
          weight: String(queuedRuleset.weight),
          weightCutPercent: Number(queuedRuleset.weightCutPercent),
          status: 'queued',
        }
      }
    } catch {
      // No queued ruleset
    }

    // Get upcoming ruleset (next cycle)
    try {
      const upcomingRuleset = await publicClient.readContract({
        address: JB_CONTRACTS.JBRulesets,
        abi: JB_RULESETS_ABI,
        functionName: 'upcomingOf',
        args: [BigInt(projectId)],
      })

      if (upcomingRuleset.cycleNumber > 0) {
        result.upcoming = {
          cycleNumber: Number(upcomingRuleset.cycleNumber),
          id: String(upcomingRuleset.id),
          start: Number(upcomingRuleset.start),
          duration: Number(upcomingRuleset.duration),
          weight: String(upcomingRuleset.weight),
          weightCutPercent: Number(upcomingRuleset.weightCutPercent),
          status: 'upcoming',
        }
      }
    } catch {
      // No upcoming ruleset
    }

    return result
  } catch (err) {
    console.error('Failed to fetch queued rulesets:', err)
    return {}
  }
}

// ============================================================================
// SPLITS AND FUND ACCESS
// ============================================================================

// JBSplits ABI for reading split configurations
const JB_SPLITS_ABI = [
  {
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'group', type: 'uint256' },
    ],
    name: 'splitsOf',
    outputs: [
      {
        components: [
          { name: 'preferAddToBalance', type: 'bool' },
          { name: 'percent', type: 'uint256' },
          { name: 'projectId', type: 'uint256' },
          { name: 'beneficiary', type: 'address' },
          { name: 'lockedUntil', type: 'uint256' },
          { name: 'hook', type: 'address' },
        ],
        name: 'splits',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// JBFundAccessLimits ABI for reading payout limits (plural form)
const JB_FUND_ACCESS_LIMITS_SPLITS_ABI = [
  {
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'terminal', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    name: 'payoutLimitsOf',
    outputs: [
      {
        components: [
          { name: 'amount', type: 'uint256' },
          { name: 'currency', type: 'uint256' },
        ],
        name: 'payoutLimits',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'terminal', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    name: 'surplusAllowancesOf',
    outputs: [
      {
        components: [
          { name: 'amount', type: 'uint256' },
          { name: 'currency', type: 'uint256' },
        ],
        name: 'surplusAllowances',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// Split group IDs
const SPLIT_GROUP_PAYOUT = 1n
const SPLIT_GROUP_RESERVED = 2n

// Split recipient
export interface JBSplitData {
  preferAddToBalance: boolean
  percent: number // basis points (0-1,000,000,000 = 0-100%)
  projectId: number // 0 if not a project
  beneficiary: string // recipient address
  lockedUntil: number // timestamp, 0 if not locked
  hook: string // hook address, zero if none
}

// Fund access limits
export interface FundAccessLimits {
  payoutLimits: Array<{ amount: string; currency: number }>
  surplusAllowances: Array<{ amount: string; currency: number }>
}

// Project splits data
export interface ProjectSplitsData {
  payoutSplits: JBSplitData[]
  reservedSplits: JBSplitData[]
  fundAccessLimits?: FundAccessLimits
}

/**
 * Fetch project splits (payout and reserved token recipients)
 */
export async function fetchProjectSplits(
  projectId: string,
  chainId: number,
  rulesetId: string
): Promise<ProjectSplitsData> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) return { payoutSplits: [], reservedSplits: [] }

  // Type for raw split data from contract
  type RawSplit = {
    preferAddToBalance: boolean
    percent: bigint
    projectId: bigint
    beneficiary: string
    lockedUntil: bigint
    hook: string
  }

  try {
    // Wrap each call separately to handle individual failures gracefully
    let payoutSplitsRaw: RawSplit[] = []
    let reservedSplitsRaw: RawSplit[] = []

    try {
      payoutSplitsRaw = await publicClient.readContract({
        address: JB_CONTRACTS.JBSplits,
        abi: JB_SPLITS_ABI,
        functionName: 'splitsOf',
        args: [BigInt(projectId), BigInt(rulesetId), SPLIT_GROUP_PAYOUT],
      }) as RawSplit[]
    } catch {
      // Payout splits not available
    }

    try {
      reservedSplitsRaw = await publicClient.readContract({
        address: JB_CONTRACTS.JBSplits,
        abi: JB_SPLITS_ABI,
        functionName: 'splitsOf',
        args: [BigInt(projectId), BigInt(rulesetId), SPLIT_GROUP_RESERVED],
      }) as RawSplit[]
    } catch {
      // Reserved splits not available
    }

    const mapSplit = (s: RawSplit): JBSplitData => ({
      preferAddToBalance: s.preferAddToBalance,
      percent: Number(s.percent),
      projectId: Number(s.projectId),
      beneficiary: s.beneficiary,
      lockedUntil: Number(s.lockedUntil),
      hook: s.hook,
    })

    const payoutSplits = payoutSplitsRaw.map(mapSplit)
    const reservedSplits = reservedSplitsRaw.map(mapSplit)

    // Also try to fetch fund access limits
    let fundAccessLimits: FundAccessLimits | undefined
    try {
      const ethToken = '0x000000000000000000000000000000000000EEEe' as `0x${string}`
      const [payoutLimitsRaw, surplusAllowancesRaw] = await Promise.all([
        publicClient.readContract({
          address: JB_CONTRACTS.JBFundAccessLimits,
          abi: JB_FUND_ACCESS_LIMITS_SPLITS_ABI,
          functionName: 'payoutLimitsOf',
          args: [BigInt(projectId), BigInt(rulesetId), JB_CONTRACTS.JBMultiTerminal, ethToken],
        }),
        publicClient.readContract({
          address: JB_CONTRACTS.JBFundAccessLimits,
          abi: JB_FUND_ACCESS_LIMITS_SPLITS_ABI,
          functionName: 'surplusAllowancesOf',
          args: [BigInt(projectId), BigInt(rulesetId), JB_CONTRACTS.JBMultiTerminal, ethToken],
        }),
      ])

      fundAccessLimits = {
        payoutLimits: payoutLimitsRaw.map(p => ({
          amount: String(p.amount),
          currency: Number(p.currency),
        })),
        surplusAllowances: surplusAllowancesRaw.map(s => ({
          amount: String(s.amount),
          currency: Number(s.currency),
        })),
      }
    } catch {
      // Fund access limits not available
    }

    return { payoutSplits, reservedSplits, fundAccessLimits }
  } catch (err) {
    console.error('Failed to fetch project splits:', err)
    return { payoutSplits: [], reservedSplits: [] }
  }
}

// ============================================================================
// DATA VISUALIZATION QUERIES
// ============================================================================

// Cash out tax snapshot for floor price history
export interface CashOutTaxSnapshot {
  cashOutTax: number
  start: number
  duration: number
  rulesetId: string
  suckerGroupId: string
}

// Sucker group moment (balance/supply snapshot)
export interface SuckerGroupMoment {
  timestamp: number
  balance: string
  tokenSupply: string
  suckerGroupId: string
}

// Pay event for volume history
export interface PayEventHistoryItem {
  amount: string
  amountUsd?: string
  timestamp: number
  from: string
  newlyIssuedTokenCount: string
  txHash: string
  memo?: string
}

// Cash out event for redemption history
export interface CashOutEventHistoryItem {
  reclaimAmount: string
  cashOutCount: string
  timestamp: number
  from: string
  txHash: string
}

// Fetch cash out tax snapshots for floor price calculation
export async function fetchCashOutTaxSnapshots(
  suckerGroupId: string,
  limit: number = 1000
): Promise<CashOutTaxSnapshot[]> {
  const client = getClient()
  const allSnapshots: CashOutTaxSnapshot[] = []
  let cursor: string | null = null

  type CashOutTaxResponse = {
    cashOutTaxSnapshots: {
      items: CashOutTaxSnapshot[]
      pageInfo: { hasNextPage: boolean; endCursor: string }
    }
  }

  try {
    do {
      const data: CashOutTaxResponse = await client.request<CashOutTaxResponse>(CASH_OUT_TAX_SNAPSHOTS_QUERY, {
        suckerGroupId,
        limit,
        after: cursor,
      })

      allSnapshots.push(...data.cashOutTaxSnapshots.items)
      cursor = data.cashOutTaxSnapshots.pageInfo.hasNextPage
        ? data.cashOutTaxSnapshots.pageInfo.endCursor
        : null
    } while (cursor && allSnapshots.length < 5000) // Safety limit

    return allSnapshots
  } catch (err) {
    console.error('Failed to fetch cash out tax snapshots:', err)
    return []
  }
}

// Fetch sucker group moments (balance/supply over time)
export async function fetchSuckerGroupMoments(
  suckerGroupId: string,
  limit: number = 1000
): Promise<SuckerGroupMoment[]> {
  const client = getClient()
  const allMoments: SuckerGroupMoment[] = []
  let cursor: string | null = null

  type MomentsResponse = {
    suckerGroupMoments: {
      items: SuckerGroupMoment[]
      pageInfo: { hasNextPage: boolean; endCursor: string }
    }
  }

  try {
    do {
      const data: MomentsResponse = await client.request<MomentsResponse>(SUCKER_GROUP_MOMENTS_QUERY, {
        suckerGroupId,
        limit,
        after: cursor,
      })

      allMoments.push(...data.suckerGroupMoments.items)
      cursor = data.suckerGroupMoments.pageInfo.hasNextPage
        ? data.suckerGroupMoments.pageInfo.endCursor
        : null
    } while (cursor && allMoments.length < 10000) // Safety limit

    return allMoments
  } catch (err) {
    console.error('Failed to fetch sucker group moments:', err)
    return []
  }
}

// Fetch pay events history for volume over time
export async function fetchPayEventsHistory(
  projectId: string,
  chainId: number,
  version: number = 5,
  limit: number = 1000
): Promise<PayEventHistoryItem[]> {
  const client = getClient()
  const allEvents: PayEventHistoryItem[] = []
  let cursor: string | null = null

  type PayEventsResponse = {
    payEvents: {
      items: PayEventHistoryItem[]
      pageInfo: { hasNextPage: boolean; endCursor: string }
    }
  }

  try {
    do {
      const data: PayEventsResponse = await client.request<PayEventsResponse>(PAY_EVENTS_HISTORY_QUERY, {
        projectId: parseInt(projectId),
        chainId,
        version,
        limit,
        after: cursor,
      })

      allEvents.push(...data.payEvents.items)
      cursor = data.payEvents.pageInfo.hasNextPage
        ? data.payEvents.pageInfo.endCursor
        : null
    } while (cursor && allEvents.length < 10000) // Safety limit

    return allEvents
  } catch (err) {
    console.error('Failed to fetch pay events history:', err)
    return []
  }
}

// Fetch cash out events history for redemption visualization
export async function fetchCashOutEventsHistory(
  projectId: string,
  chainId: number,
  version: number = 5,
  limit: number = 1000
): Promise<CashOutEventHistoryItem[]> {
  const client = getClient()
  const allEvents: CashOutEventHistoryItem[] = []
  let cursor: string | null = null

  type CashOutEventsResponse = {
    cashOutTokensEvents: {
      items: CashOutEventHistoryItem[]
      pageInfo: { hasNextPage: boolean; endCursor: string }
    }
  }

  try {
    do {
      const data: CashOutEventsResponse = await client.request<CashOutEventsResponse>(CASH_OUT_EVENTS_HISTORY_QUERY, {
        projectId: parseInt(projectId),
        chainId,
        version,
        limit,
        after: cursor,
      })

      allEvents.push(...data.cashOutTokensEvents.items)
      cursor = data.cashOutTokensEvents.pageInfo.hasNextPage
        ? data.cashOutTokensEvents.pageInfo.endCursor
        : null
    } while (cursor && allEvents.length < 10000) // Safety limit

    return allEvents
  } catch (err) {
    console.error('Failed to fetch cash out events history:', err)
    return []
  }
}

// Calculate floor price from balance, supply, and tax rate
// Formula: y = (o * x / s) * ((1 - r) + (r * x / s))
// where r = tax rate, o = balance, s = supply, x = tokens to cash out
export function calculateFloorPrice(
  balance: bigint,
  totalSupply: bigint,
  cashOutTaxRate: number, // 0-10000 basis points
  balanceDecimals: number = 18 // 18 for ETH, 6 for USDC
): number {
  if (totalSupply === 0n) return 0

  const r = cashOutTaxRate / 10000 // Convert to decimal
  const oneToken = 10n ** 18n

  // Convert to numbers for calculation (may lose precision for very large values)
  const x = Number(oneToken) / 1e18 // 1 token
  const s = Number(totalSupply) / 1e18
  // Use the correct decimals for balance (18 for ETH, 6 for USDC)
  const balanceDivisor = Math.pow(10, balanceDecimals)
  const o = Number(balance) / balanceDivisor

  if (s === 0) return 0

  // y = (o * x / s) * ((1 - r) + (r * x / s))
  const floorPrice = (o * x / s) * ((1 - r) + (r * x / s))
  return floorPrice
}

// Aggregate participants across chains by address
export interface AggregatedParticipant {
  address: string
  balance: bigint
  chains: number[]
  percentage: number
}

export async function fetchAggregatedParticipants(
  suckerGroupId: string,
  limit: number = 100,
  fallbackProjectId?: string,
  fallbackChainId?: number
): Promise<{ participants: AggregatedParticipant[]; totalSupply: bigint }> {
  const client = getClient()

  // Helper to process participants into aggregated format
  const processParticipants = (
    items: Array<{ address?: string; wallet?: string; chainId?: number; balance: string }>,
    defaultChainId?: number
  ): { participants: AggregatedParticipant[]; totalSupply: bigint } => {
    const aggregated: Record<string, { balance: bigint; chains: number[] }> = {}

    for (const p of items) {
      const addr = (p.address || p.wallet || '').toLowerCase()
      if (!addr) continue
      const existing = aggregated[addr] ?? { balance: 0n, chains: [] }
      const chainId = p.chainId ?? defaultChainId
      aggregated[addr] = {
        balance: existing.balance + BigInt(p.balance || '0'),
        chains: chainId ? [...existing.chains, chainId] : existing.chains,
      }
    }

    const totalSupply = Object.values(aggregated).reduce((sum, p) => sum + p.balance, 0n)

    const participants = Object.entries(aggregated)
      .map(([address, data]) => ({
        address,
        balance: data.balance,
        chains: [...new Set(data.chains)],
        percentage: totalSupply > 0n
          ? Number((data.balance * 10000n) / totalSupply) / 100
          : 0,
      }))
      .sort((a, b) => (b.balance > a.balance ? 1 : -1))
      .slice(0, limit)

    return { participants, totalSupply }
  }

  // Try suckerGroup query first (if we have a valid suckerGroupId)
  if (suckerGroupId) {
    try {
      const data = await client.request<{
        participants: {
          totalCount: number
          items: Array<{ address: string; chainId: number; balance: string }>
        }
      }>(SUCKER_GROUP_PARTICIPANTS_QUERY, {
        suckerGroupId,
        limit: 10000,
      })

      if (data.participants?.items && data.participants.items.length > 0) {
        return processParticipants(data.participants.items)
      }
    } catch (err) {
      console.error('SuckerGroup participants query failed, trying fallback:', err)
    }
  }

  // Fallback to single-chain query if we have the params
  if (fallbackProjectId && fallbackChainId) {
    try {
      const data = await client.request<{
        participants: {
          totalCount: number
          items: Array<{ address: string; chainId: number; balance: string }>
        }
      }>(TOKEN_HOLDERS_QUERY, {
        projectId: parseInt(fallbackProjectId),
        chainId: fallbackChainId,
        limit: 1000,
      })

      if (data.participants?.items && data.participants.items.length > 0) {
        return processParticipants(data.participants.items, fallbackChainId)
      }
    } catch (err) {
      console.error('Fallback participants query also failed:', err)
    }
  }

  return { participants: [], totalSupply: 0n }
}
