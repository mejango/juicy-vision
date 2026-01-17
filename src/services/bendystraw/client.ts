import { GraphQLClient } from 'graphql-request'
import { useSettingsStore } from '../../stores'
import { PROJECT_QUERY, PROJECTS_QUERY, PARTICIPANTS_QUERY, SEARCH_PROJECTS_QUERY, ACTIVITY_EVENTS_QUERY } from './queries'

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
  handle?: string
  owner: string
  metadataUri?: string
  metadata?: ProjectMetadata
  name: string
  description?: string
  logoUri?: string
  volume: string
  volumeUSD?: string
  balance: string
  contributorsCount: number
  nftsMintedCount?: number
  paymentsCount?: number
  createdAt: number
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

export async function fetchProject(projectId: string, chainId: number = 1): Promise<Project> {
  const client = getClient()
  const data = await client.request<{ project: Project & { metadata: ProjectMetadata } }>(
    PROJECT_QUERY,
    { projectId: parseInt(projectId), chainId }
  )

  const project = data.project
  return {
    ...project,
    name: project.metadata?.name || `Project #${projectId}`,
    description: project.metadata?.description,
    logoUri: project.metadata?.logoUri,
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

  const data = await client.request<{ projects: Array<Project & { metadata: ProjectMetadata }> }>(
    PROJECTS_QUERY,
    { first, skip, orderBy, orderDirection }
  )

  return data.projects.map(project => ({
    ...project,
    name: project.metadata?.name || `Project #${project.projectId}`,
    description: project.metadata?.description,
    logoUri: project.metadata?.logoUri,
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
