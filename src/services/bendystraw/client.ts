import { GraphQLClient } from 'graphql-request'
import { createPublicClient, http } from 'viem'
import { useSettingsStore } from '../../stores'
import { VIEM_CHAINS, JB_CONTRACTS, ZERO_ADDRESS, type SupportedChainId } from '../../constants'
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
  SUCKER_GROUP_BALANCE_QUERY,
  TOKEN_HOLDERS_QUERY,
  SUCKER_GROUP_PARTICIPANTS_QUERY,
  PROJECT_SUCKER_GROUP_QUERY,
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
  wallet: string
  balance: string
  volume: string
  stakedBalance: string
  lastPaidTimestamp?: number
}

function getClient(): GraphQLClient {
  const endpoint = useSettingsStore.getState().bendystrawEndpoint
  return new GraphQLClient(endpoint)
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
  first: number = 50
): Promise<Participant[]> {
  const client = getClient()

  const data = await client.request<{ participants: Participant[] }>(
    PARTICIPANTS_QUERY,
    { projectId: parseInt(projectId), chainId, first }
  )

  return data.participants
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

  const data = await client.request<{ participants: Participant[] }>(
    USER_PARTICIPANT_QUERY,
    { projectId: parseInt(projectId), chainId, wallet: wallet.toLowerCase() }
  )

  if (data.participants.length === 0) {
    return null
  }

  return {
    balance: data.participants[0].balance,
    volume: data.participants[0].volume,
  }
}

// Project ruleset info for eligibility checks
export interface ProjectRuleset {
  weight: string
  decayPercent: string
  duration: number
  pausePay: boolean
  allowOwnerMinting: boolean
  reservedPercent: number
  cashOutTaxRate: number
}

export interface ProjectWithRuleset {
  id: string
  projectId: number
  chainId: number
  owner: string
  name: string
  balance: string
  currentRuleset: ProjectRuleset | null
}

export async function fetchProjectWithRuleset(
  projectId: string,
  chainId: number = 1,
  version: number = 5
): Promise<ProjectWithRuleset | null> {
  const client = getClient()

  try {
    const data = await client.request<{
      project: {
        id: string
        projectId: number
        chainId: number
        owner: string
        metadata?: { name?: string }
        currentRuleset?: ProjectRuleset
        balance: string
      }
    }>(PROJECT_RULESET_QUERY, {
      projectId: parseFloat(projectId),
      chainId: parseFloat(String(chainId)),
      version: parseFloat(String(version))
    })

    if (!data.project) {
      return null
    }

    return {
      id: data.project.id,
      projectId: data.project.projectId,
      chainId: data.project.chainId,
      owner: data.project.owner,
      name: data.project.metadata?.name || `Project #${projectId}`,
      balance: data.project.balance,
      currentRuleset: data.project.currentRuleset || null,
    }
  } catch {
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

    // Calculate tokens per ETH (both in 18 decimal format, so they cancel out)
    // tokens/amount gives us tokens per wei, multiply by 1e18 to get per ETH
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
  totalBalance: string  // Sum of all projects in the group
  totalPaymentsCount: number  // Sum of all payments across the group
  projectBalances: Array<{ chainId: number; projectId: number; balance: string; paymentsCount: number }>
}

// Get the total balance across all projects in a sucker group
export async function fetchSuckerGroupBalance(
  projectId: string,
  chainId: number,
  version: number = 5
): Promise<SuckerGroupBalance> {
  const client = getClient()

  try {
    const data = await client.request<{
      project: {
        id: string
        balance: string
        paymentsCount: number
        suckerGroup?: {
          projects: {
            items: Array<{ projectId: number; chainId: number; balance: string; paymentsCount: number }>
          }
        }
      }
    }>(SUCKER_GROUP_BALANCE_QUERY, {
      projectId: parseFloat(projectId),
      chainId: parseFloat(String(chainId)),
      version: parseFloat(String(version)),
    })

    const items = data.project?.suckerGroup?.projects?.items
    if (!items || items.length === 0) {
      // No sucker group, return single project balance
      return {
        totalBalance: data.project.balance,
        totalPaymentsCount: data.project.paymentsCount || 0,
        projectBalances: [{ chainId, projectId: parseInt(projectId), balance: data.project.balance, paymentsCount: data.project.paymentsCount || 0 }],
      }
    }

    // Sum all balances and payments in the group
    let totalBalance = BigInt(0)
    let totalPayments = 0
    for (const item of items) {
      totalBalance += BigInt(item.balance || '0')
      totalPayments += item.paymentsCount || 0
    }

    return {
      totalBalance: totalBalance.toString(),
      totalPaymentsCount: totalPayments,
      projectBalances: items.map(item => ({
        chainId: item.chainId,
        projectId: item.projectId,
        balance: item.balance,
        paymentsCount: item.paymentsCount || 0,
      })),
    }
  } catch {
    return {
      totalBalance: '0',
      totalPaymentsCount: 0,
      projectBalances: [],
    }
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
      // Fallback to single-chain query if no suckerGroup
      const data = await client.request<{
        participants: Array<{ wallet: string; balance: string }>
      }>(TOKEN_HOLDERS_QUERY, {
        projectId: parseInt(projectId),
        chainId,
        first: 1000,
      })

      if (!data.participants || data.participants.length === 0) {
        return 0
      }

      const uniqueWallets = new Set(
        data.participants.map(p => p.wallet.toLowerCase())
      )
      return uniqueWallets.size
    }

    // Fetch participants across all chains in the sucker group
    const data = await client.request<{
      participants: {
        totalCount: number
        items: Array<{ address: string; chainId: number; balance: string }>
      }
    }>(SUCKER_GROUP_PARTICIPANTS_QUERY, {
      suckerGroupId,
      limit: 1000, // TODO: will break once more than 1000 participants exist
    })

    if (!data.participants?.items || data.participants.items.length === 0) {
      return 0
    }

    // Deduplicate participants who are on multiple chains
    const uniqueWallets = new Set(
      data.participants.items.map(p => p.address.toLowerCase())
    )

    return uniqueWallets.size
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
  chainId: number
): Promise<string | null> {
  const cacheKey = `${chainId}-${projectId}`
  const cached = tokenSymbolCache.get(cacheKey)
  if (cached) return cached

  const chain = VIEM_CHAINS[chainId as SupportedChainId]
  if (!chain) return null

  try {
    const publicClient = createPublicClient({
      chain,
      transport: http(),
    })

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
