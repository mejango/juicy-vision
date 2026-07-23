import { GraphQLClient, type RequestDocument, type Variables } from '../graphqlClient'
import { createPublicClient, erc20Abi, http, isAddress } from 'viem'
import type { JBChainId } from '@bananapus/nana-sdk-core'
import { tokenCurrencyId } from '@bananapus/nana-sdk-core/v6'
import { useSettingsStore, useDebugStore } from '../../stores'
import { VIEM_CHAINS, ZERO_ADDRESS, REV_OWNER, JB_CONTRACTS, JB_ROUTER_TERMINAL, JB_ROUTER_TERMINAL_REGISTRY, RPC_ENDPOINTS, USDC_ADDRESSES, MAINNET_VIEM_CHAINS, MAINNET_RPC_ENDPOINTS, NATIVE_TOKEN, type SupportedChainId } from '../../constants'
import { fetchIpfsMetadata } from '../../utils/ipfs'
import { IS_TESTNET, IS_LOCAL_ONLY_BROWSER_TEST } from '../../config/environment'
import { createCache, CACHE_DURATIONS, bendystrawCircuit } from '../../utils'
import { getPaymentTerminal } from '../../utils/paymentTerminal'
import { sanitizeTokenLabel } from '../../utils/erc20Safety'
import { truncateAddress } from '../../utils/ens'
import { requireRecognizedRuntimeSplitHook } from '../../utils/projectTrust'
import { decodeRecognizedLaunchProjectLog } from '../../utils/launchReceipt'
import { deriveCycledWeight } from '../../utils/rulesetMath'

// Mainnet chain IDs - used to detect when to route to mainnet API in staging
const MAINNET_CHAIN_IDS = [1, 10, 8453, 42161] as const

/**
 * Get network option for API routing.
 * In staging (IS_TESTNET mode), mainnet chain IDs need to route to mainnet API.
 */
export function getNetworkOption(chainId: number): { network: 'mainnet' } | undefined {
  if (IS_TESTNET && MAINNET_CHAIN_IDS.includes(chainId as typeof MAINNET_CHAIN_IDS[number])) {
    return { network: 'mainnet' }
  }
  return undefined
}
import {
  PROJECT_QUERY,
  PROJECTS_QUERY,
  PROJECTS_BY_OWNER_QUERY,
  ACTIVITY_EVENTS_QUERY,
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
  PROJECT_MOMENTS_QUERY,
  REVNET_OPERATOR_QUERY,
} from './queries'

export interface ProjectMetadata {
  name?: string
  description?: string
  tagline?: string
  projectTagline?: string
  logoUri?: string
  coverImageUri?: string
  infoUri?: string
  payDisclosure?: string
  twitter?: string
  farcaster?: string
  discord?: string
  telegram?: string
  whatsapp?: string
  domain?: string
  tags?: string[]
  tokens?: unknown[]
  symbol?: string
  ticker?: string
  tokenSymbol?: string
  storeCategories?: Record<string, string>
  '721Categories'?: Record<string, string>
  [key: string]: unknown
}

const INDEXED_PROJECT_METADATA_FIELDS = [
  'name',
  'description',
  'projectTagline',
  'logoUri',
  'coverImageUri',
  'infoUri',
  'payDisclosure',
  'twitter',
  'farcaster',
  'discord',
  'telegram',
  'domain',
  'tags',
  'tokens',
] as const satisfies readonly (keyof ProjectMetadata)[]

const STRING_PROJECT_METADATA_FIELDS = new Set([
  'name',
  'description',
  'tagline',
  'projectTagline',
  'logoUri',
  'coverImageUri',
  'infoUri',
  'payDisclosure',
  'twitter',
  'farcaster',
  'discord',
  'telegram',
  'whatsapp',
  'domain',
  'symbol',
  'ticker',
  'tokenSymbol',
])

function normalizeCategoryMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string'
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function parseProjectMetadata(value: unknown): ProjectMetadata | undefined {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const metadata = { ...(parsed as Record<string, unknown>) }
    for (const field of STRING_PROJECT_METADATA_FIELDS) {
      if (metadata[field] != null && typeof metadata[field] !== 'string') delete metadata[field]
    }
    if (metadata.tags != null) {
      if (Array.isArray(metadata.tags)) {
        metadata.tags = metadata.tags.filter((tag): tag is string => typeof tag === 'string')
      } else {
        delete metadata.tags
      }
    }
    if (metadata.tokens != null && !Array.isArray(metadata.tokens)) delete metadata.tokens
    const storeCategories = normalizeCategoryMap(metadata.storeCategories)
    const tierCategories = normalizeCategoryMap(metadata['721Categories'])
    if (storeCategories) metadata.storeCategories = storeCategories
    else delete metadata.storeCategories
    if (tierCategories) metadata['721Categories'] = tierCategories
    else delete metadata['721Categories']
    return metadata as ProjectMetadata
  } catch {
    return undefined
  }
}

function indexedProjectMetadataFields(value: unknown): ProjectMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const metadata: Record<string, unknown> = {}
  for (const field of INDEXED_PROJECT_METADATA_FIELDS) {
    if (record[field] != null) {
      metadata[field] = record[field]
    }
  }
  return parseProjectMetadata(metadata) ?? {}
}

function fillMissingMetadata(
  primary: ProjectMetadata | undefined,
  fallback: ProjectMetadata,
): ProjectMetadata {
  const merged = { ...(primary ?? {}) }
  for (const [field, value] of Object.entries(fallback)) {
    if ((merged as Record<string, unknown>)[field] == null && value != null) {
      ;(merged as Record<string, unknown>)[field] = value
    }
  }
  return merged
}

function hasMetadataValues(metadata: ProjectMetadata | undefined): boolean {
  return !!metadata && Object.values(metadata).some(value => value != null)
}

export async function resolveProjectMetadataForDisplay(args: {
  indexedMetadata: unknown
  indexedFields?: unknown
  indexedMetadataUri?: string
  loadOnchainMetadataUri?: () => Promise<string | undefined>
  fetchMetadata?: (uri: string) => Promise<ProjectMetadata | null>
}): Promise<{ metadata?: ProjectMetadata; metadataUri?: string; source: 'bendystraw' | 'onchain' | 'unavailable' }> {
  const fetchMetadata = args.fetchMetadata ?? (uri => fetchIpfsMetadata(uri) as Promise<ProjectMetadata | null>)
  const embedded = parseProjectMetadata(args.indexedMetadata)
  const indexedFields = indexedProjectMetadataFields(args.indexedFields)
  const indexed = fillMissingMetadata(embedded, indexedFields)
  const hasEmbeddedMetadata = !!embedded && Object.keys(embedded).length > 0
  const hasIndexedMetadata = hasMetadataValues(indexed)

  if (hasEmbeddedMetadata) {
    return { metadata: indexed, metadataUri: args.indexedMetadataUri, source: 'bendystraw' }
  }
  if (args.indexedMetadataUri) {
    const fromIndexedUri = parseProjectMetadata(await fetchMetadata(args.indexedMetadataUri))
    if (fromIndexedUri) {
      return {
        metadata: fillMissingMetadata(fromIndexedUri, indexed),
        metadataUri: args.indexedMetadataUri,
        source: 'bendystraw',
      }
    }
  }
  if (args.loadOnchainMetadataUri) {
    const onchainUri = await args.loadOnchainMetadataUri()
    if (onchainUri) {
      const fromOnchain = parseProjectMetadata(await fetchMetadata(onchainUri))
      if (fromOnchain) {
        return {
          metadata: fillMissingMetadata(indexed, fromOnchain),
          metadataUri: onchainUri,
          source: hasIndexedMetadata ? 'bendystraw' : 'onchain',
        }
      }
    }
  }
  if (hasIndexedMetadata) {
    return {
      metadata: indexed,
      metadataUri: args.indexedMetadataUri,
      source: 'bendystraw',
    }
  }
  return { source: 'unavailable' }
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
  // Ruleset metadata flags
  pausePay: boolean
  pauseCreditTransfers?: boolean
  allowOwnerMinting: boolean
  allowSetCustomToken?: boolean
  allowTerminalMigration?: boolean
  allowSetTerminals?: boolean
  allowSetController?: boolean
  allowAddAccountingContext?: boolean
  allowAddPriceFeed?: boolean
  ownerMustSendPayouts?: boolean
  holdFees?: boolean
  scopeCashOutsToLocalBalances?: boolean
  useDataHookForPay?: boolean
  useDataHookForCashOut?: boolean
  dataHook?: string
  reservedPercent: number
  cashOutTaxRate: number
  baseCurrency?: number
  metadata?: number
  approvalHook?: string
}

export interface Project {
  id: string
  projectId: number
  chainId: number
  version: number
  handle?: string
  owner: string
  deployer?: string
  metadataUri?: string
  metadata?: ProjectMetadata
  name: string
  description?: string
  logoUri?: string
  // Indexed classification is informational only. Live JBProjects ownership is
  // the sole classifier used by isRevnetProject.
  isRevnet?: boolean
  suckerGroupId?: string
  volume: string
  volumeUsd?: string
  balance: string
  token?: string
  decimals?: number
  currency?: number | string
  nftsMintedCount?: number
  paymentsCount: number
  createdAt: number
  // Token symbol from the deployed ERC20 (e.g., "NANA", "REV")
  tokenSymbol?: string
  // Trending fields (7-day window)
  trendingScore?: string
  trendingVolume?: string
  trendingPaymentsCount?: number
  // Current identity/configuration comes from JBProjects and JBDirectory. When
  // false, historical/indexed fields must not be presented as live values.
  indexedDataAvailable?: boolean
  configurationError?: string
}

function getClient(options?: { network?: 'mainnet' }): GraphQLClient {
  // If backend API is configured, use the proxy endpoint to keep API keys secure
  const apiUrl = import.meta.env.VITE_API_URL
  if (apiUrl) {
    const params = options?.network ? `?network=${options.network}` : ''
    return new GraphQLClient(`${apiUrl}/proxy/bendystraw${params}`)
  }
  // Fallback to direct endpoint (requires user to configure in settings)
  const endpoint = useSettingsStore.getState().bendystrawEndpoint
  return new GraphQLClient(endpoint)
}

/**
 * Execute a GraphQL request through the Bendystraw circuit breaker
 * If the circuit is open, throws an error that callers can handle gracefully
 * Errors are logged to the debug store for UI visibility
 */
export async function safeRequest<T>(
  document: RequestDocument,
  variables?: Variables,
  options?: { network?: 'mainnet' }
): Promise<T> {
  const client = getClient(options)
  const queryString = typeof document === 'string' ? document : String(document)

  const result = await bendystrawCircuit.call(async () => {
    return client.request<T>(document, variables)
  })

  if (result.status === 'circuit_open') {
    const retrySeconds = Math.ceil((result.retryAfter || 0) / 1000)
    const errorMsg = `Bendystraw API temporarily unavailable. Retry in ${retrySeconds}s`

    // Log to debug store for UI visibility
    useDebugStore.getState().addQueryError({
      queryName: '',
      query: queryString,
      variables: variables || {},
      error: errorMsg,
      errorDetails: { status: 'circuit_open', retryAfter: result.retryAfter },
    })

    throw new Error(errorMsg)
  }

  if (result.status === 'failure') {
    const errorMsg = result.error?.message || 'Bendystraw request failed'

    // Log to debug store for UI visibility
    useDebugStore.getState().addQueryError({
      queryName: '',
      query: queryString,
      variables: variables || {},
      error: errorMsg,
      errorDetails: result.error,
    })

    throw result.error || new Error(errorMsg)
  }

  return result.data as T
}

// Create a viem public client for on-chain reads with reliable RPC
// Supports mainnet chains even in staging mode (for cross-network queries)
const publicClients = new Map<number, ReturnType<typeof createPublicClient>>()

function getPublicClient(chainId: number) {
  const cached = publicClients.get(chainId)
  if (cached) return cached

  // First try environment-specific chains
  let chain = VIEM_CHAINS[chainId as SupportedChainId]
  let rpcUrls = RPC_ENDPOINTS[chainId] || []

  // If not found, try mainnet chains (for staging mode querying mainnet data)
  if (!chain && MAINNET_VIEM_CHAINS[chainId as keyof typeof MAINNET_VIEM_CHAINS]) {
    chain = MAINNET_VIEM_CHAINS[chainId as keyof typeof MAINNET_VIEM_CHAINS]
    rpcUrls = MAINNET_RPC_ENDPOINTS[chainId] || []
  }

  if (!chain) return null

  const rpcUrl = rpcUrls[0] // Use first (most reliable) RPC

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })
  // createPublicClient preserves each chain's exact transaction union, while the
  // cache intentionally stores clients behind viem's chain-agnostic return type.
  publicClients.set(chainId, client as ReturnType<typeof createPublicClient>)
  return client
}

/**
 * Extract project ID from a transaction receipt.
 * Decodes the unindexed V6 LaunchProject event emitted by the recognized controller.
 *
 * IMPORTANT: Uses retry logic with fallback RPCs since receipt fetching can time out,
 * especially on Sepolia where public RPCs are often slow/unreliable.
 */
export async function getProjectIdFromReceipt(
  chainId: number,
  txHash: `0x${string}`
): Promise<number | null> {
  console.log(`[getProjectIdFromReceipt] Starting extraction for chain ${chainId}, tx ${txHash}`)

  const chain = VIEM_CHAINS[chainId as SupportedChainId] ||
    MAINNET_VIEM_CHAINS[chainId as keyof typeof MAINNET_VIEM_CHAINS]
  if (!chain) {
    console.error(`[getProjectIdFromReceipt] No chain config for chain ${chainId}`)
    return null
  }

  const rpcUrls = RPC_ENDPOINTS[chainId] || MAINNET_RPC_ENDPOINTS[chainId] || []
  if (rpcUrls.length === 0) {
    console.error(`[getProjectIdFromReceipt] No RPC endpoints for chain ${chainId}`)
    return null
  }

  // Try each RPC endpoint until one succeeds
  let receipt = null
  let lastError: Error | null = null

  for (let i = 0; i < rpcUrls.length; i++) {
    const rpcUrl = rpcUrls[i]
    console.log(`[getProjectIdFromReceipt] Trying RPC ${i + 1}/${rpcUrls.length} for chain ${chainId}: ${rpcUrl}`)

    try {
      const client = createPublicClient({
        chain,
        transport: http(rpcUrl, { timeout: 15000 }), // 15 second timeout
      })

      receipt = await client.getTransactionReceipt({ hash: txHash })
      console.log(`[getProjectIdFromReceipt] RPC ${rpcUrl} succeeded`)
      break // Success - exit loop
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.warn(`[getProjectIdFromReceipt] RPC ${rpcUrl} failed:`, lastError.message)
      // Continue to next RPC
    }
  }

  if (!receipt) {
    console.error(`[getProjectIdFromReceipt] All RPCs failed for chain ${chainId}:`, lastError?.message)
    return null
  }

  if (receipt.status !== 'success') {
    console.warn(`[getProjectIdFromReceipt] Transaction reverted on chain ${chainId}`)
    return null
  }

  // Process the receipt to extract project ID
  console.log(`[getProjectIdFromReceipt] Receipt for ${txHash}:`, {
    status: receipt.status,
    logsCount: receipt.logs.length,
    logs: receipt.logs.map(log => ({
      address: log.address,
      topic0: log.topics[0],
      topic1: log.topics[1],
    }))
  })

  // Only the recognized controller can establish a newly launched project ID.
  for (const log of receipt.logs) {
    const projectId = decodeRecognizedLaunchProjectLog(log, chainId as JBChainId)
    if (projectId !== null) {
      console.log(`[getProjectIdFromReceipt] Extracted projectId: ${projectId}`)
      return projectId
    }
  }

  console.log(`[getProjectIdFromReceipt] No canonical LaunchProject event found for ${txHash}`)
  return null
}

/**
 * Extract project IDs from multiple transaction receipts across chains.
 */
export async function getProjectIdsFromReceipts(
  txHashes: Record<number, string>
): Promise<Record<number, number>> {
  console.log('[getProjectIdsFromReceipts] Input txHashes:', txHashes)
  const result: Record<number, number> = {}

  if (Object.keys(txHashes).length === 0) {
    console.warn('[getProjectIdsFromReceipts] No txHashes provided!')
    return result
  }

  await Promise.all(
    Object.entries(txHashes).map(async ([chainIdStr, txHash]) => {
      const chainId = Number(chainIdStr)
      if (!txHash) {
        console.warn(`[getProjectIdsFromReceipts] Empty txHash for chain ${chainId}`)
        return
      }
      const projectId = await getProjectIdFromReceipt(chainId, txHash as `0x${string}`)
      if (projectId !== null) {
        result[chainId] = projectId
      } else {
        console.warn(`[getProjectIdsFromReceipts] No projectId found for chain ${chainId}`)
      }
    })
  )

  console.log('[getProjectIdsFromReceipts] Result:', result)
  return result
}

// Minimal ABI fragments for the bendystraw-offline fallback (see fetchProjectOnChain).
const JB_PROJECTS_OWNER_OF_ABI = [{
  type: 'function', name: 'ownerOf', stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const
const JB_CONTROLLER_URI_OF_ABI = [{
  type: 'function', name: 'uriOf', stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'string' }],
}] as const

async function readProjectController(
  publicClient: NonNullable<ReturnType<typeof getPublicClient>>,
  projectId: bigint,
): Promise<`0x${string}`> {
  const controller = await publicClient.readContract({
    address: JB_CONTRACTS.JBDirectory,
    abi: JB_DIRECTORY_ABI,
    functionName: 'controllerOf',
    args: [projectId],
  })
  if (controller === ZERO_ADDRESS) throw new Error('Project has no controller')
  if (controller.toLowerCase() !== JB_CONTRACTS.JBController.toLowerCase()) {
    throw new Error(`Controller not recognized: ${controller}`)
  }
  return controller
}

async function readProjectIdentity(
  publicClient: NonNullable<ReturnType<typeof getPublicClient>>,
  projectId: bigint,
): Promise<{
  owner: `0x${string}`
  controller?: `0x${string}`
  configurationError?: string
}> {
  const owner = await publicClient.readContract({
    address: JB_CONTRACTS.JBProjects,
    abi: JB_PROJECTS_OWNER_OF_ABI,
    functionName: 'ownerOf',
    args: [projectId],
  })

  try {
    return { owner, controller: await readProjectController(publicClient, projectId) }
  } catch (err) {
    return {
      owner,
      configurationError: err instanceof Error ? err.message : 'Project controller could not be verified',
    }
  }
}

/**
 * Contract fallback for {@link fetchProject} when bendystraw is unavailable
 * (circuit open) or hasn't indexed a project yet. Bendystraw is the efficient
 * primary; this only runs when it fails, reconstructing the critical fields from
 * chain so the page can retain its identity without inventing indexed metrics.
 * Returns null only when JBProjects.ownerOf cannot establish that the project
 * exists on the requested chain.
 */
async function fetchProjectOnChain(projectId: string, chainId: number): Promise<Project | null> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) return null
  try {
    const identity = await readProjectIdentity(publicClient, BigInt(projectId))

    let metadataUri = ''
    if (identity.controller) {
      try {
        metadataUri = await publicClient.readContract({
          address: identity.controller,
          abi: JB_CONTROLLER_URI_OF_ABI,
          functionName: 'uriOf',
          args: [BigInt(projectId)],
        })
      } catch {
        // A recognized project may have no URI, and metadata is not executable.
      }
    }

    const metadata = metadataUri ? await fetchIpfsMetadata(metadataUri) : null

    return {
      id: `${chainId}-${projectId}`,
      projectId: parseInt(projectId),
      chainId,
      version: 6,
      owner: identity.owner,
      metadataUri: metadataUri || undefined,
      metadata: (metadata as ProjectMetadata | null) || undefined,
      name: metadata?.name || `Project #${projectId}`,
      description: metadata?.description,
      logoUri: metadata?.logoUri,
      isRevnet: isRevnet(identity.owner),
      tokenSymbol: metadata?.tokenSymbol,
      indexedDataAvailable: false,
      configurationError: identity.configurationError,
      volume: '',
      balance: '',
      paymentsCount: Number.NaN,
      createdAt: Number.NaN,
    } as Project
  } catch {
    // ownerOf reverted → the project doesn't exist on this chain.
    return null
  }
}

// Cached display-name resolver for activity rows. It uses the same Bendystraw-
// first metadata path as project cards, with the controller URI only as fallback.
const projectNameCache = new Map<string, { name: string | null; expiresAt: number }>()
export async function resolveProjectNameForDisplay(projectId: number, chainId: number): Promise<string | null> {
  const key = `${chainId}-${projectId}`
  const cached = projectNameCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.name
  try {
    const project = await fetchProject(String(projectId), chainId)
    const fallbackName = `Project #${projectId}`
    const name = project.name && project.name !== fallbackName ? project.name : null
    projectNameCache.set(key, { name, expiresAt: Date.now() + (name ? 60 * 60_000 : 60_000) })
    return name
  } catch {
    projectNameCache.set(key, { name: null, expiresAt: Date.now() + 60_000 })
    return null
  }
}

export async function fetchProject(projectId: string, chainId: number = 1, version: number = 6): Promise<Project> {
  try {
    const data = await safeRequest<{ project: Project & { metadata: ProjectMetadata | string } }>(
      PROJECT_QUERY,
      { projectId: parseFloat(projectId), chainId: parseFloat(String(chainId)), version: parseFloat(String(version)) },
      getNetworkOption(chainId)
    )

    const project = data.project
    if (!project) {
      throw new Error(`Project ${projectId} not found on chain ${chainId}`)
    }
    let liveOwner = ''
    let liveController: `0x${string}` | undefined
    let configurationError: string | undefined
    const publicClient = getPublicClient(chainId)
    if (!publicClient) {
      configurationError = `Live project configuration is unavailable on chain ${chainId}`
    } else {
      try {
        const identity = await readProjectIdentity(publicClient, BigInt(projectId))
        liveOwner = identity.owner
        liveController = identity.controller
        configurationError = identity.configurationError
      } catch (identityError) {
        configurationError = `Live project ownership unavailable: ${identityError instanceof Error ? identityError.message : 'Unknown read failure'}`
      }
    }
    const resolvedMetadata = await resolveProjectMetadataForDisplay({
      indexedMetadata: project.metadata,
      indexedFields: project,
      indexedMetadataUri: project.metadataUri,
      loadOnchainMetadataUri: liveController && publicClient
        ? async () => {
            try {
              return await publicClient.readContract({
                address: liveController,
                abi: JB_CONTROLLER_URI_OF_ABI,
                functionName: 'uriOf',
                args: [BigInt(projectId)],
              })
            } catch {
              return undefined
            }
          }
        : undefined,
    })
    const metadata = resolvedMetadata.metadata
    const metadataUri = resolvedMetadata.metadataUri

    return {
      ...project,
      owner: liveOwner,
      isRevnet: liveOwner ? isRevnet(liveOwner) : undefined,
      metadataUri: metadataUri || undefined,
      metadata,
      name: metadata?.name || `Project #${projectId}`,
      description: metadata?.description,
      logoUri: metadata?.logoUri,
      indexedDataAvailable: true,
      configurationError,
    }
  } catch (err) {
    // Bendystraw down (circuit open) or the project isn't indexed — fall back to
    // on-chain reads so the page stays alive. Rethrow only if the project truly
    // can't be found on chain either.
    const onChain = await fetchProjectOnChain(projectId, chainId)
    if (onChain) return onChain
    throw err
  }
}

export async function fetchProjects(options: {
  first?: number
  skip?: number
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
} = {}): Promise<Project[]> {
  const { first = 20, skip = 0, orderBy = 'volume', orderDirection = 'desc' } = options

  const data = await safeRequest<{ projects: { items: Array<Project> } }>(
    PROJECTS_QUERY,
    { limit: first, offset: skip, orderBy, orderDirection }
  )

  return data.projects.items.map(project => ({
    ...project,
    name: project.name || `Project #${project.projectId}`,
  }))
}

// Base properties shared by all activity events
interface BaseActivityEvent {
  id: string
  chainId: number
  timestamp: number
  project: {
    projectId?: number
    name?: string
    handle?: string
    logoUri?: string
    decimals?: number  // 6 for USDC, 18 for ETH
    currency?: number  // 1=ETH, 2=USD
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
    projectId?: number
    name?: string
    handle?: string
    logoUri?: string
    decimals?: number
    currency?: number
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

// Raw payload field -> discriminated-union type tag, in match-priority order.
const EVENT_TYPE_BY_FIELD = [
  ['payEvent', 'pay'],
  ['projectCreateEvent', 'projectCreate'],
  ['cashOutTokensEvent', 'cashOut'],
  ['addToBalanceEvent', 'addToBalance'],
  ['mintTokensEvent', 'mintTokens'],
  ['burnEvent', 'burn'],
  ['deployErc20Event', 'deployErc20'],
  ['sendPayoutsEvent', 'sendPayouts'],
  ['sendReservedTokensToSplitsEvent', 'sendReservedTokens'],
  ['useAllowanceEvent', 'useAllowance'],
  ['mintNftEvent', 'mintNft'],
] as const

// Transform raw API event to discriminated union
function transformEvent(raw: RawActivityEvent): ActivityEvent {
  const base = { id: raw.id, chainId: raw.chainId, timestamp: raw.timestamp, project: raw.project }

  for (const [field, type] of EVENT_TYPE_BY_FIELD) {
    const payload = raw[field]
    if (payload) return { ...base, type, ...payload } as ActivityEvent
  }
  return { ...base, type: 'unknown', from: raw.from, txHash: raw.txHash }
}

export async function fetchActivityEvents(limit: number = 20, offset: number = 0): Promise<ActivityEvent[]> {
  // Always fetch from mainnet — the activity feed should show real protocol activity
  // even when running on staging/testnet
  const data = await safeRequest<{ activityEvents: { items: RawActivityEvent[] } }>(
    ACTIVITY_EVENTS_QUERY,
    { limit, offset, orderBy: 'timestamp', orderDirection: 'desc' },
    { network: 'mainnet' }
  )

  // Filter out unknown events (events where no recognized type is present)
  return data.activityEvents.items
    .map(transformEvent)
    .filter(event => event.type !== 'unknown')
}

// Read the holder's current claimed-token plus credit balance from JBTokens.
// Bendystraw participant rows remain useful for history, but are not current
// enough for cash-out or wallet-balance decisions.
export async function fetchUserTokenBalance(
  projectId: string,
  chainId: number,
  wallet: string
): Promise<{ balance: string }> {
  if (!isAddress(wallet)) throw new Error('Token holder address is invalid')
  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`Project token balance unavailable on unsupported chain ${chainId}`)
  const contracts = await getContractsForProject(projectId, chainId)
  const balance = await publicClient.readContract({
    address: contracts.JBTokens,
    abi: [{
      name: 'totalBalanceOf',
      type: 'function',
      stateMutability: 'view',
      inputs: [
        { name: 'holder', type: 'address' },
        { name: 'projectId', type: 'uint256' },
      ],
      outputs: [{ name: '', type: 'uint256' }],
    }] as const,
    functionName: 'totalBalanceOf',
    args: [wallet, BigInt(projectId)],
  })
  return { balance: balance.toString() }
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
  // Indexed classification is informational only; owner is read from JBProjects.
  isRevnet?: boolean
  suckerGroupId?: string
  name: string
  metadata?: ProjectMetadata
  metadataUri?: string
  description?: string
  logoUri?: string
  balance: string
  createdAt?: number
  controllerAddress?: string
  controllerRecognized: boolean
  configurationError?: string
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
  {
    name: 'terminalsOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'primaryTerminalOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

const JB_TERMINAL_ACCOUNTING_CONTEXTS_ABI = [{
  name: 'accountingContextsOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{
    name: '',
    type: 'tuple[]',
    components: [
      { name: 'token', type: 'address' },
      { name: 'decimals', type: 'uint8' },
      { name: 'currency', type: 'uint32' },
    ],
  }],
}] as const

const JB_TERMINAL_STORE_ADDRESS_ABI = [{
  name: 'STORE',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}] as const

const JB_PROJECT_TOKEN_BALANCE_ABI = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'terminal', type: 'address' },
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const

export interface ProjectAccountingContext {
  terminal: `0x${string}`
  token: `0x${string}`
  decimals: number
  currency: number
  symbol: string
  isNative: boolean
  balance: bigint
}

/**
 * Resolve the accounting assets a project actually holds from JBDirectory.
 * Terminals stay strict (recognized multi terminal only); accounting tokens can
 * be native ETH, canonical USDC, or any ERC-20 whose metadata resolves on-chain.
 */
export async function fetchProjectAccountingContexts(
  projectId: string,
  chainId: number,
): Promise<ProjectAccountingContext[]> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`Unsupported chain: ${chainId}`)

  const terminals = await publicClient.readContract({
    address: JB_CONTRACTS.JBDirectory,
    abi: JB_DIRECTORY_ABI,
    functionName: 'terminalsOf',
    args: [BigInt(projectId)],
  })

  for (const terminal of terminals) {
    const normalized = terminal.toLowerCase()
    if (
      normalized !== JB_CONTRACTS.JBMultiTerminal.toLowerCase() &&
      normalized !== JB_ROUTER_TERMINAL.toLowerCase() &&
      normalized !== JB_ROUTER_TERMINAL_REGISTRY.toLowerCase()
    ) {
      throw new Error(`Terminal not recognized: ${terminal}`)
    }
  }

  const multiTerminal = terminals.find(
    terminal => terminal.toLowerCase() === JB_CONTRACTS.JBMultiTerminal.toLowerCase(),
  )
  if (!multiTerminal) throw new Error('Recognized accounting terminal not found')

  // Both reads depend only on the terminal address
  const [contexts, terminalStore] = await Promise.all([
    publicClient.readContract({
      address: multiTerminal,
      abi: JB_TERMINAL_ACCOUNTING_CONTEXTS_ABI,
      functionName: 'accountingContextsOf',
      args: [BigInt(projectId)],
    }),
    publicClient.readContract({
      address: multiTerminal,
      abi: JB_TERMINAL_STORE_ADDRESS_ABI,
      functionName: 'STORE',
    }),
  ])

  const canonicalUsdc = USDC_ADDRESSES[chainId as SupportedChainId]?.toLowerCase()
  const resolved = await Promise.all(contexts.map(async context => {
    const token = context.token.toLowerCase()
    const isNative = token === NATIVE_TOKEN.toLowerCase()
    const isUsdc = !!canonicalUsdc && token === canonicalUsdc

    const contextDecimals = Number(context.decimals)
    const contextCurrency = Number(context.currency)
    const tokenKeyedCurrency = tokenCurrencyId(context.token)

    let symbol: string
    if (isNative) {
      // Native ETH: currency ids 1 and 61166 both mean native.
      if (contextDecimals !== 18 || (contextCurrency !== 1 && contextCurrency !== tokenKeyedCurrency)) {
        throw new Error(`Accounting context is not recognized for token: ${context.token}`)
      }
      symbol = 'ETH'
    } else if (isUsdc) {
      if (contextDecimals !== 6 || contextCurrency !== tokenKeyedCurrency) {
        throw new Error(`Accounting context is not recognized for token: ${context.token}`)
      }
      symbol = 'USDC'
    } else {
      if (contextCurrency !== tokenKeyedCurrency) {
        throw new Error(`Accounting context is not recognized for token: ${context.token}`)
      }
      const [symbolResult, nameResult, decimalsResult] = await Promise.allSettled([
        publicClient.readContract({ address: context.token, abi: erc20Abi, functionName: 'symbol' }),
        publicClient.readContract({ address: context.token, abi: erc20Abi, functionName: 'name' }),
        publicClient.readContract({ address: context.token, abi: erc20Abi, functionName: 'decimals' }),
      ])
      if (decimalsResult.status === 'fulfilled' && Number(decimalsResult.value) !== contextDecimals) {
        throw new Error(
          `Accounting token decimals mismatch for ${context.token}: context has ${contextDecimals}, token reports ${Number(decimalsResult.value)}`,
        )
      }
      symbol = sanitizeTokenLabel(symbolResult.status === 'fulfilled' ? symbolResult.value : null)
        ?? sanitizeTokenLabel(nameResult.status === 'fulfilled' ? nameResult.value : null)
        ?? truncateAddress(context.token)
    }

    // Independent reads: the live-terminal check and the store balance
    const [accountingTerminal, balance] = await Promise.all([
      getPaymentTerminal(
        publicClient,
        chainId,
        BigInt(projectId),
        context.token,
        'accounting',
      ),
      publicClient.readContract({
        address: terminalStore,
        abi: JB_PROJECT_TOKEN_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [multiTerminal, BigInt(projectId), context.token],
      }),
    ])
    if (accountingTerminal.address.toLowerCase() !== multiTerminal.toLowerCase()) {
      throw new Error(`Accounting terminal changed for token: ${context.token}`)
    }

    return {
      terminal: multiTerminal,
      token: context.token,
      decimals: contextDecimals,
      currency: contextCurrency,
      symbol,
      isNative,
      balance,
    }
  }))

  const unique = new Map(resolved.map(context => [context.token.toLowerCase(), context]))
  if (unique.size !== resolved.length) throw new Error('Duplicate accounting context')
  return [...unique.values()]
}

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
          { name: 'scopeCashOutsToLocalBalances', type: 'bool' },
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

// Decode packed ruleset metadata from uint256
// JB V6 metadata packing (from nana-core-v6 JBRulesetMetadataResolver.packRulesetMetadata):
// - version: bits 0-3 (4 bits, currently 1)
// - reservedPercent: bits 4-19 (uint16)
// - cashOutTaxRate: bits 20-35 (uint16)
// - baseCurrency: bits 36-67 (uint32)
// - pausePay: bit 68
// - pauseCreditTransfers: bit 69
// - allowOwnerMinting: bit 70
// - allowSetCustomToken: bit 71
// - allowTerminalMigration: bit 72
// - allowSetTerminals: bit 73
// - allowSetController: bit 74
// - allowAddAccountingContext: bit 75
// - allowAddPriceFeed: bit 76
// - ownerMustSendPayouts: bit 77
// - holdFees: bit 78
// - scopeCashOutsToLocalBalances: bit 79
// - useDataHookForPay: bit 80
// - useDataHookForCashOut: bit 81
// - dataHook: bits 82-241 (address, 160 bits)
// - metadata: bits 242-255 (14 bits)
function decodeRulesetMetadata(packed: bigint) {
  const getBits = (value: bigint, start: number, length: number): bigint => {
    const mask = (1n << BigInt(length)) - 1n
    return (value >> BigInt(start)) & mask
  }
  const getBit = (value: bigint, bit: number): boolean => {
    return ((value >> BigInt(bit)) & 1n) === 1n
  }

  return {
    reservedPercent: Number(getBits(packed, 4, 16)),
    cashOutTaxRate: Number(getBits(packed, 20, 16)),
    baseCurrency: Number(getBits(packed, 36, 32)),
    pausePay: getBit(packed, 68),
    pauseCreditTransfers: getBit(packed, 69),
    allowOwnerMinting: getBit(packed, 70),
    allowSetCustomToken: getBit(packed, 71),
    allowTerminalMigration: getBit(packed, 72),
    allowSetTerminals: getBit(packed, 73),
    allowSetController: getBit(packed, 74),
    allowAddAccountingContext: getBit(packed, 75),
    allowAddPriceFeed: getBit(packed, 76),
    ownerMustSendPayouts: getBit(packed, 77),
    holdFees: getBit(packed, 78),
    scopeCashOutsToLocalBalances: getBit(packed, 79),
    useDataHookForPay: getBit(packed, 80),
    useDataHookForCashOut: getBit(packed, 81),
    dataHook: `0x${getBits(packed, 82, 160).toString(16).padStart(40, '0')}` as `0x${string}`,
    metadata: Number(getBits(packed, 242, 14)),
  }
}

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

interface IndexedRulesetProject {
  id: string
  projectId: number
  chainId: number
  suckerGroupId?: string
  metadataUri?: string
  metadata?: { name?: string } | string
  handle?: string
  name?: string
  description?: string
  projectTagline?: string
  logoUri?: string
  coverImageUri?: string
  infoUri?: string
  payDisclosure?: string
  twitter?: string
  farcaster?: string
  discord?: string
  telegram?: string
  domain?: string
  tags?: string[]
  tokens?: unknown[]
  balance: string
  createdAt?: number
}

async function readLiveProjectRuleset(
  projectId: string,
  chainId: number,
): Promise<{
  owner: string
  controllerAddress?: string
  controllerRecognized: boolean
  configurationError?: string
  currentRuleset: ProjectRuleset | null
}> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) {
    return {
      owner: '',
      controllerRecognized: false,
      configurationError: `Live project configuration is unavailable on chain ${chainId}`,
      currentRuleset: null,
    }
  }

  let owner = ''
  let controllerAddress: string | undefined
  let controllerRecognized = false
  let currentRuleset: ProjectRuleset | null = null
  try {
    owner = await publicClient.readContract({
      address: JB_CONTRACTS.JBProjects,
      abi: JB_PROJECTS_OWNER_OF_ABI,
      functionName: 'ownerOf',
      args: [BigInt(projectId)],
    })
    const discoveredController = await publicClient.readContract({
      address: JB_CONTRACTS.JBDirectory,
      abi: JB_DIRECTORY_ABI,
      functionName: 'controllerOf',
      args: [BigInt(projectId)],
    })
    controllerAddress = discoveredController
    if (discoveredController.toLowerCase() !== JB_CONTRACTS.JBController.toLowerCase()) {
      throw new Error(`Controller not recognized: ${discoveredController}`)
    }
    controllerRecognized = true
    const contracts = await getContractsForProject(projectId, chainId)
    let [ruleset, metadata] = await publicClient.readContract({
      address: discoveredController,
      abi: JB_CONTROLLER_ABI,
      functionName: 'currentRulesetOf',
      args: [BigInt(projectId)],
    })

    if (ruleset.cycleNumber === 0) {
      const currentRulesetDirect = await publicClient.readContract({
        address: contracts.JBRulesets,
        abi: JB_RULESETS_ABI,
        functionName: 'currentOf',
        args: [BigInt(projectId)],
      })
      if (currentRulesetDirect.cycleNumber > 0) {
        ruleset = currentRulesetDirect
        metadata = decodeRulesetMetadata(currentRulesetDirect.metadata)
      }
    }

    if (ruleset.cycleNumber > 0) {
      currentRuleset = {
        id: String(ruleset.id),
        cycleNumber: Number(ruleset.cycleNumber),
        start: Number(ruleset.start),
        duration: Number(ruleset.duration),
        weight: String(ruleset.weight),
        weightCutPercent: Number(ruleset.weightCutPercent),
        decayPercent: String(ruleset.weightCutPercent),
        pausePay: metadata.pausePay,
        pauseCreditTransfers: metadata.pauseCreditTransfers,
        allowOwnerMinting: metadata.allowOwnerMinting,
        allowSetCustomToken: metadata.allowSetCustomToken,
        allowTerminalMigration: metadata.allowTerminalMigration,
        allowSetTerminals: metadata.allowSetTerminals,
        allowSetController: metadata.allowSetController,
        allowAddAccountingContext: metadata.allowAddAccountingContext,
        allowAddPriceFeed: metadata.allowAddPriceFeed,
        ownerMustSendPayouts: metadata.ownerMustSendPayouts,
        holdFees: metadata.holdFees,
        scopeCashOutsToLocalBalances: metadata.scopeCashOutsToLocalBalances,
        useDataHookForPay: metadata.useDataHookForPay,
        useDataHookForCashOut: metadata.useDataHookForCashOut,
        dataHook: metadata.dataHook,
        reservedPercent: Number(metadata.reservedPercent),
        cashOutTaxRate: Number(metadata.cashOutTaxRate),
        baseCurrency: Number(metadata.baseCurrency),
        metadata: Number(metadata.metadata),
        approvalHook: ruleset.approvalHook,
      }
    }

    return { owner, controllerAddress, controllerRecognized, currentRuleset }
  } catch (err) {
    console.error('Failed to fetch ruleset from chain:', err)
    return {
      owner,
      controllerAddress,
      controllerRecognized,
      configurationError: err instanceof Error ? err.message : 'Could not verify project configuration',
      currentRuleset: null,
    }
  }
}

export async function fetchProjectWithRuleset(
  projectId: string,
  chainId: number = 1,
  version: number = 6
): Promise<ProjectWithRuleset | null> {
  let indexedProject: IndexedRulesetProject | null = null
  let indexedError: unknown
  try {
    const data = await safeRequest<{ project: IndexedRulesetProject | null }>(PROJECT_RULESET_QUERY, {
      projectId: parseFloat(projectId),
      chainId: parseFloat(String(chainId)),
      version: parseFloat(String(version)),
    }, getNetworkOption(chainId))
    indexedProject = data.project
  } catch (err) {
    indexedError = err
  }

  const onChainProject = indexedProject ? null : await fetchProjectOnChain(projectId, chainId)
  if (!indexedProject && !onChainProject) {
    const detail = indexedError instanceof Error ? indexedError.message : 'Project could not be verified on chain'
    throw new Error(`Project ruleset unavailable: ${detail}`)
  }

  const live = await readLiveProjectRuleset(projectId, chainId)
  const publicClient = getPublicClient(chainId)
  const resolvedMetadata = indexedProject
    ? await resolveProjectMetadataForDisplay({
        indexedMetadata: indexedProject.metadata,
        indexedFields: indexedProject,
        indexedMetadataUri: indexedProject.metadataUri,
        loadOnchainMetadataUri: live.controllerRecognized && live.controllerAddress && publicClient
          ? async () => {
              try {
                return await publicClient.readContract({
                  address: live.controllerAddress as `0x${string}`,
                  abi: JB_CONTROLLER_URI_OF_ABI,
                  functionName: 'uriOf',
                  args: [BigInt(projectId)],
                })
              } catch {
                return undefined
              }
            }
          : undefined,
      })
    : {
        metadata: onChainProject?.metadata,
        metadataUri: onChainProject?.metadataUri,
      }
  const projectMetadata = resolvedMetadata.metadata
  const owner = live.owner || onChainProject?.owner || ''

  return {
    id: indexedProject?.id || onChainProject!.id,
    projectId: indexedProject?.projectId ?? onChainProject!.projectId,
    chainId: indexedProject?.chainId ?? onChainProject!.chainId,
    owner,
    isRevnet: owner ? isRevnet(owner) : undefined,
    suckerGroupId: indexedProject?.suckerGroupId,
    name: projectMetadata?.name || indexedProject?.handle || `Project #${projectId}`,
    metadata: projectMetadata,
    metadataUri: resolvedMetadata.metadataUri,
    description: projectMetadata?.description,
    logoUri: projectMetadata?.logoUri,
    balance: indexedProject?.balance || '',
    createdAt: indexedProject?.createdAt,
    controllerAddress: live.controllerAddress,
    controllerRecognized: live.controllerRecognized,
    configurationError: live.configurationError || onChainProject?.configurationError,
    currentRuleset: live.currentRuleset,
    queuedRulesets: [],
  }
}

// Check if user is project owner
// Cache for projects by owner/deployer
const projectsByOwnerCache = createCache<Project[]>(CACHE_DURATIONS.SHORT)

// Ruleset history cache - for regular projects (1 hour TTL)
const rulesetHistoryCache = createCache<RulesetHistoryEntry[]>(CACHE_DURATIONS.LONG)

// Clear the projects by owner cache (call after deployment completes)
export function clearProjectsByOwnerCache(ownerAddress?: string): void {
  if (ownerAddress) {
    // Clear specific address's cache entries (both owner and deployer keys)
    const addr = ownerAddress.toLowerCase()
    projectsByOwnerCache.delete(`owner:${addr}:50`)
    projectsByOwnerCache.delete(`deployer:${addr}:50`)
    projectsByOwnerCache.delete(`merged:${addr}:50`)
  } else {
    // Clear all cached entries
    projectsByOwnerCache.clear()
  }
}

// Fetch all projects owned by OR deployed by an address
// Queries both owner and deployer fields and merges/deduplicates results
export async function fetchProjectsByOwner(
  ownerAddress: string,
  options: { limit?: number } = {}
): Promise<Project[]> {
  const { limit = 50 } = options
  const addr = ownerAddress.toLowerCase()
  const cacheKey = `owner:${addr}:${limit}`

  try {
    // Try cache first
    const cached = projectsByOwnerCache.get(cacheKey)
    if (cached) return cached

    // Query by owner only
    const data = await safeRequest<{ projects: { items: Project[] } }>(
      PROJECTS_BY_OWNER_QUERY,
      { owner: addr, limit }
    )

    const projects = data?.projects?.items || []

    // Sort by createdAt descending
    projects.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

    projectsByOwnerCache.set(cacheKey, projects)
    return projects
  } catch (err) {
    console.error('fetchProjectsByOwner error:', err)
    throw new Error(`Owned projects unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Connected chain info for a project
export interface ConnectedChain {
  chainId: number
  projectId: number
}

// Get all chains a project exists on via suckerGroup
// Returns an empty array only when the project is verified to have no sucker group.
export async function fetchConnectedChains(
  projectId: string,
  chainId: number,
  version: number = 6
): Promise<ConnectedChain[]> {
  try {
    const data = await safeRequest<{
      project: {
        suckerGroup?: {
          projects: {
            items: Array<{ projectId: number; chainId: number }>
          }
        } | null
      } | null
    }>(CONNECTED_CHAINS_QUERY, {
      projectId: parseFloat(projectId),
      chainId: parseFloat(String(chainId)),
      version: parseFloat(String(version)),
    }, getNetworkOption(chainId))

    if (!data.project) throw new Error('Project is not indexed by Bendystraw yet')
    if (!data.project.suckerGroup) {
      return []
    }
    const items = data.project.suckerGroup.projects?.items
    if (!items) throw new Error('Connected project mapping is unavailable')
    if (items.length === 0) throw new Error('Connected project mapping is empty')

    const mappings = new Map<number, number>()
    for (const item of items) {
      if (!Number.isSafeInteger(item.chainId) || item.chainId <= 0 ||
        !Number.isSafeInteger(item.projectId) || item.projectId <= 0) {
        throw new Error('Connected project mapping is invalid')
      }
      const existing = mappings.get(item.chainId)
      if (existing !== undefined && existing !== item.projectId) {
        throw new Error(`Connected project mapping is ambiguous on chain ${item.chainId}`)
      }
      mappings.set(item.chainId, item.projectId)
    }
    if (mappings.get(chainId) !== Number(projectId)) {
      throw new Error('Connected project group does not include the requested project')
    }
    return [...mappings.entries()].map(([mappedChainId, mappedProjectId]) => ({
      chainId: mappedChainId,
      projectId: mappedProjectId,
    }))
  } catch (err) {
    console.error('Failed to fetch connected chains:', err)
    throw new Error(`Connected project chains unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
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
  version: number = 6
): Promise<IssuanceRate | null> {
  try {
    const data = await safeRequest<{
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
  totalVolume: string   // Pre-aggregated volume (total raised) from suckerGroup entity
  totalVolumeUsd: string // Volume in USD
  totalPaymentsCount: number  // Sum of all payments across the group
  currency: number  // 1 = native ETH, 2 = canonical USDC, otherwise token-derived
  decimals: number  // Token decimals (18 for ETH, 6 for USDC)
  projectBalances: Array<{ chainId: number; projectId: number; balance: string; volume?: string; paymentsCount: number; currency?: number; decimals?: number }>
  /** Whether raw monetary values have a recognized, homogeneous denomination. */
  balanceAvailable?: boolean
  /** Historical volume is unavailable when only the local project row was found. */
  volumeAvailable?: boolean
  /** Payment count availability is independent from monetary denomination. */
  paymentsAvailable?: boolean
  /** Distinguishes a complete omnichain aggregate from a local-only fallback. */
  dataScope?: 'group' | 'project' | 'unavailable'
}

function isRawAmount(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value)
}

function recognizedAccountingContext(
  token: string | undefined,
  chainId: number,
  decimals: number | undefined,
): { key: 'native' | 'usdc'; currency: 1 | 2; decimals: number } | null {
  const normalizedToken = token?.toLowerCase()
  if (normalizedToken === NATIVE_TOKEN.toLowerCase() && decimals === 18) {
    return { key: 'native', currency: 1, decimals: 18 }
  }

  const canonicalUsdc = USDC_ADDRESSES[chainId as SupportedChainId]?.toLowerCase()
  if (canonicalUsdc && normalizedToken === canonicalUsdc && decimals === 6) {
    return { key: 'usdc', currency: 2, decimals: 6 }
  }

  return null
}

interface LiveProjectBalance {
  chainId: number
  projectId: number
  balance: string
  currency: 1 | 2
  decimals: number
  key: 'native' | 'usdc'
}

async function fetchLiveProjectBalance(projectId: number, chainId: number): Promise<LiveProjectBalance | null> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient || !Number.isSafeInteger(projectId) || projectId <= 0) return null
  try {
    const terminals = await publicClient.readContract({
      address: JB_CONTRACTS.JBDirectory,
      abi: JB_DIRECTORY_ABI,
      functionName: 'terminalsOf',
      args: [BigInt(projectId)],
    })
    const accountingTerminals = terminals.filter(
      terminal => terminal.toLowerCase() === JB_CONTRACTS.JBMultiTerminal.toLowerCase(),
    )
    if (accountingTerminals.length !== 1) return null
    const terminal = accountingTerminals[0]
    // Both reads depend only on the terminal address
    const [contexts, store] = await Promise.all([
      publicClient.readContract({
        address: terminal,
        abi: JB_TERMINAL_ACCOUNTING_CONTEXTS_ABI,
        functionName: 'accountingContextsOf',
        args: [BigInt(projectId)],
      }),
      publicClient.readContract({
        address: terminal,
        abi: JB_TERMINAL_STORE_ADDRESS_ABI,
        functionName: 'STORE',
      }),
    ])
    if (contexts.length !== 1) return null
    const context = recognizedAccountingContext(
      contexts[0].token,
      chainId,
      Number(contexts[0].decimals),
    )
    if (!context || Number(contexts[0].currency) !== tokenCurrencyId(contexts[0].token)) {
      return null
    }
    // Independent reads: the live-terminal check and the store balance
    const [liveTerminal, balance] = await Promise.all([
      getPaymentTerminal(
        publicClient,
        chainId,
        BigInt(projectId),
        contexts[0].token,
        'accounting',
      ),
      publicClient.readContract({
        address: store,
        abi: JB_PROJECT_TOKEN_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [terminal, BigInt(projectId), contexts[0].token],
      }),
    ])
    if (liveTerminal.address.toLowerCase() !== terminal.toLowerCase()) return null
    return {
      chainId,
      projectId,
      balance: balance.toString(),
      currency: context.currency,
      decimals: context.decimals,
      key: context.key,
    }
  } catch {
    return null
  }
}

/**
 * Build the local-only SuckerGroupBalance shape used whenever group data is
 * unavailable. Pass `local` when an indexed project row supplies a verified
 * per-project payments count; omit it for the bare live-balance fallback.
 */
function localFallbackBalance(
  liveLocal: LiveProjectBalance | null,
  local?: { chainId: number; projectId: number; paymentsCount: number; paymentsAvailable: boolean },
): SuckerGroupBalance {
  return {
    totalBalance: liveLocal?.balance ?? '',
    totalVolume: '', // A current balance is not historical payment volume.
    totalVolumeUsd: '',
    totalPaymentsCount: local?.paymentsAvailable ? local.paymentsCount : Number.NaN,
    currency: liveLocal?.currency ?? Number.NaN,
    decimals: liveLocal?.decimals ?? Number.NaN,
    projectBalances: local
      ? [{
          chainId: local.chainId,
          projectId: local.projectId,
          balance: liveLocal?.balance ?? '',
          paymentsCount: local.paymentsAvailable ? local.paymentsCount : Number.NaN,
          currency: liveLocal?.currency,
          decimals: liveLocal?.decimals,
        }]
      : liveLocal ? [{ ...liveLocal, paymentsCount: 0 }] : [],
    balanceAvailable: !!liveLocal,
    volumeAvailable: false,
    paymentsAvailable: local?.paymentsAvailable ?? false,
    dataScope: liveLocal ? 'project' : 'unavailable',
  }
}

// Get the total balance across all projects in a sucker group
// Uses the suckerGroup entity's pre-aggregated balance (like revnet-app)
export async function fetchSuckerGroupBalance(
  projectId: string,
  chainId: number,
  version: number = 6
): Promise<SuckerGroupBalance> {
  const client = getClient(getNetworkOption(chainId))
  const numericProjectId = Number(projectId)
  const liveLocalBalancePromise = fetchLiveProjectBalance(numericProjectId, chainId)

  try {
    // First, get the suckerGroupId for this project
    const projectData = await client.request<{
      project: {
        id: string
        balance: string
        paymentsCount: number
        suckerGroupId?: string
        token?: string
        decimals?: number
        currency?: number | string
      }
    }>(PROJECT_SUCKER_GROUP_QUERY, {
      projectId: parseFloat(projectId),
      chainId: parseFloat(String(chainId)),
      version: parseFloat(String(version)),
    })

    if (!projectData.project) {
      console.error('[fetchSuckerGroupBalance] Project not found:', projectId, chainId)
      return localFallbackBalance(await liveLocalBalancePromise)
    }

    const suckerGroupId = projectData.project.suckerGroupId

    const liveLocal = await liveLocalBalancePromise

    // If no sucker group exists, return the verified local balance only.
    if (!suckerGroupId) {
      return localFallbackBalance(liveLocal, {
        chainId,
        projectId: parseInt(projectId),
        paymentsCount: projectData.project.paymentsCount,
        paymentsAvailable: Number.isFinite(projectData.project.paymentsCount),
      })
    }

    // Query the suckerGroup directly for its pre-aggregated balance and volume
    const groupData = await client.request<{
      suckerGroup: {
        id: string
        balance: string  // Pre-aggregated balance across all chains
        volume: string   // Pre-aggregated volume (total raised) across all chains
        volumeUsd: string // Volume in USD
        tokenSupply: string
        paymentsCount: number
        contributorsCount: number
        projects: {
          items: Array<{
            projectId: number
            chainId: number
            balance: string
            volume: string
            tokenSupply: string
            paymentsCount: number
            token?: string
            decimals: number
            currency: number | string
          }>
        }
      }
    }>(SUCKER_GROUP_BY_ID_QUERY, {
      id: suckerGroupId,
    })

    const group = groupData.suckerGroup
    if (!group) {
      // Preserve the verified single-project balance, but never substitute it
      // for historical payment volume.
      return localFallbackBalance(liveLocal, {
        chainId,
        projectId: parseInt(projectId),
        paymentsCount: projectData.project.paymentsCount,
        paymentsAvailable: Number.isFinite(projectData.project.paymentsCount),
      })
    }

    const groupProjects = group.projects?.items || []
    const groupMappings = new Map<number, number>()
    for (const item of groupProjects) {
      if (!Number.isSafeInteger(item.chainId) || item.chainId <= 0 ||
        !Number.isSafeInteger(item.projectId) || item.projectId <= 0) {
        throw new Error('Sucker group project mapping is invalid')
      }
      const existing = groupMappings.get(item.chainId)
      if (existing !== undefined && existing !== item.projectId) {
        throw new Error(`Sucker group project mapping is ambiguous on chain ${item.chainId}`)
      }
      groupMappings.set(item.chainId, item.projectId)
    }
    if (groupMappings.get(chainId) !== Number(projectId)) {
      throw new Error('Sucker group does not include the requested project')
    }
    const liveBalances = await Promise.all(groupProjects.map(item =>
      fetchLiveProjectBalance(item.projectId, item.chainId)
    ))
    const firstLiveBalance = liveBalances[0]
    const liveBalancesAvailable = !!firstLiveBalance && liveBalances.every(
      balance => balance?.key === firstLiveBalance.key && balance.decimals === firstLiveBalance.decimals,
    )
    const decimals = liveBalancesAvailable ? firstLiveBalance!.decimals : Number.NaN
    const currency = liveBalancesAvailable ? firstLiveBalance!.currency : Number.NaN
    const totalLiveBalance = liveBalancesAvailable
      ? liveBalances.reduce((sum, balance) => sum + BigInt(balance!.balance), 0n).toString()
      : ''
    const volumeAvailable = liveBalancesAvailable && isRawAmount(group.volume)
    const paymentsAvailable = Number.isFinite(group.paymentsCount)

    // Use the pre-aggregated balance and volume from suckerGroup entity
    return {
      totalBalance: totalLiveBalance,
      totalVolume: isRawAmount(group.volume) ? group.volume : '',
      totalVolumeUsd: isRawAmount(group.volumeUsd) ? group.volumeUsd : '',
      totalPaymentsCount: paymentsAvailable ? group.paymentsCount : Number.NaN,
      currency,
      decimals,
      projectBalances: groupProjects.map((item, index) => ({
        chainId: item.chainId,
        projectId: item.projectId,
        balance: liveBalances[index]?.balance ?? '',
        volume: item.volume,
        paymentsCount: Number.isFinite(item.paymentsCount) ? item.paymentsCount : Number.NaN,
        currency: liveBalances[index]?.currency,
        decimals: liveBalances[index]?.decimals,
      })),
      balanceAvailable: liveBalancesAvailable,
      volumeAvailable,
      paymentsAvailable,
      dataScope: 'group',
    }
  } catch (err) {
    console.error('Failed to fetch sucker group balance:', err)
    return localFallbackBalance(await liveLocalBalancePromise)
  }
}

// Get the suckerGroupId for a project (used for multi-chain aggregation)
export async function fetchProjectSuckerGroupId(
  projectId: string,
  chainId: number,
  version: number = 6
): Promise<string | null> {
  const client = getClient(getNetworkOption(chainId))

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
    throw new Error(`Connected project group unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Get unique token holders (owners) count for a project across all chains
// Fetches participants with balance > 0 via suckerGroupId and deduplicates by wallet
export async function fetchOwnersCount(
  projectId: string,
  chainId: number,
  version: number = 6
): Promise<number | null> {
  const client = getClient(getNetworkOption(chainId))

  // Helper to fetch single-chain participants
  const fetchSingleChain = async (): Promise<number | null> => {
    try {
      const data = await client.request<{
        participants: {
          totalCount: number
          items: Array<{ address: string; chainId: number; balance: string }>
        }
      }>(TOKEN_HOLDERS_QUERY, {
        projectId: parseInt(projectId),
        chainIds: [chainId],
        version,
        limit: 1000,
      })

      if (!data.participants || !Number.isSafeInteger(data.participants.totalCount)) return null
      // A participant row is unique by project/chain/address on a single chain.
      return data.participants.totalCount
    } catch {
      return null
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

    const data = await client.request<{
      participants: {
        totalCount: number
        items: Array<{ address: string; chainId: number; balance: string }>
      }
    }>(SUCKER_GROUP_PARTICIPANTS_QUERY, {
      suckerGroupId,
      version,
      limit: 1000,
    })

    if (!data.participants?.items || !Number.isSafeInteger(data.participants.totalCount)) return null
    if (data.participants.totalCount > data.participants.items.length) {
      // The query was truncated, so deduplicating the returned page would undercount.
      return null
    }
    const uniqueWallets = new Set(
      data.participants.items.map(p => p.address.toLowerCase())
    )
    return uniqueWallets.size
  } catch (err) {
    console.error('Failed to fetch owners count:', err)
    return null
  }
}

// ETH price cache (20 minutes)
const ethPriceCache = createCache<number>(20 * 60 * 1000)

// Fetch current ETH price in USD
export async function fetchEthPrice(): Promise<number | null> {
  if (IS_LOCAL_ONLY_BROWSER_TEST) return null

  const cached = ethPriceCache.get('ethusd')
  if (cached !== null) return cached

  try {
    const response = await fetch('https://juicebox.money/api/juicebox/prices/ethusd')
    const data = await response.json()
    const price = parseFloat(data.price)
    if (!Number.isFinite(price) || price <= 0) throw new Error('ETH price response was invalid')

    ethPriceCache.set('ethusd', price)

    return price
  } catch (err) {
    console.error('Failed to fetch ETH price:', err)
    return null
  }
}

// ABI for JBTokens.tokenOf, totalSupplyOf and ERC20.symbol
const TOKEN_ABI = [
  {
    name: 'tokenOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'totalSupplyOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
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
  version: number = 6
): Promise<string | null> {
  const cacheKey = `${chainId}-${projectId}-v${version}`
  const cached = tokenSymbolCache.get(cacheKey)
  if (cached) return cached

  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`Project token unavailable on unsupported chain ${chainId}`)

  try {
    // Reuse the address lookup (shares its cache and zero-address handling)
    const tokenAddress = await fetchProjectTokenAddress(projectId, chainId, version)

    // No ERC20 token deployed yet
    if (!tokenAddress) return null

    // Get the symbol from the token contract
    const symbol = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: TOKEN_ABI,
      functionName: 'symbol',
    })

    // Cache the result
    tokenSymbolCache.set(cacheKey, symbol)

    return symbol
  } catch (err) {
    // fetchProjectTokenAddress already wraps its failures with this label.
    if (err instanceof Error && err.message.startsWith('Project token unavailable')) throw err
    console.error('Failed to fetch project token symbol:', err)
    throw new Error(`Project token unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Token address cache (caches the project's issued ERC20 token address)
const tokenAddressCache = createCache<string>(CACHE_DURATIONS.LONG)

// Fetch the project's issued ERC20 token address
export async function fetchProjectTokenAddress(
  projectId: string,
  chainId: number,
  version: number = 6
): Promise<string | null> {
  const cacheKey = `token-addr-${chainId}-${projectId}-v${version}`
  const cached = tokenAddressCache.get(cacheKey)
  if (cached) return cached

  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`Project token unavailable on unsupported chain ${chainId}`)

  try {
    const contracts = await getContractsForProject(projectId, chainId)
    const tokenAddress = await publicClient.readContract({
      address: contracts.JBTokens,
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
    throw new Error(`Project token unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

/**
 * Fetch the total token supply for a project from JBTokens on-chain
 * Returns the total supply as a bigint string, or null on error
 */
export async function fetchProjectTokenSupply(
  projectId: string,
  chainId: number
): Promise<string | null> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`Project token supply unavailable on unsupported chain ${chainId}`)

  try {
    const contracts = await getContractsForProject(projectId, chainId)
    const totalSupply = await publicClient.readContract({
      address: contracts.JBTokens,
      abi: TOKEN_ABI,
      functionName: 'totalSupplyOf',
      args: [BigInt(projectId)],
    })

    return totalSupply.toString()
  } catch (err) {
    console.error('Failed to fetch project token supply:', err)
    throw new Error(`Project token supply unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

/**
 * Fetch pending reserved tokens that haven't been distributed yet
 * This is read from the JBController's pendingReservedTokenBalanceOf function
 */
export async function fetchPendingReservedTokens(
  projectId: string,
  chainId: number
): Promise<string> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`Pending reserved tokens unavailable on unsupported chain ${chainId}`)

  try {
    const controllerAddress = (await getContractsForProject(projectId, chainId)).JBController

    // Call pendingReservedTokenBalanceOf on the controller
    const pending = await publicClient.readContract({
      address: controllerAddress,
      abi: [{
        name: 'pendingReservedTokenBalanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'projectId', type: 'uint256' }],
        outputs: [{ name: '', type: 'uint256' }],
      }] as const,
      functionName: 'pendingReservedTokenBalanceOf',
      args: [BigInt(projectId)],
    })

    return String(pending)
  } catch (err) {
    console.error('Failed to fetch pending reserved tokens:', err)
    const message = err instanceof Error ? err.message : 'Unknown read failure'
    if (/not recognized|no controller/i.test(message)) throw err
    throw new Error(`Pending reserved tokens unavailable: ${message}`)
  }
}

// ============================================================================
// REVNET HELPERS
// ============================================================================

// A live existing project is a Revnet only while its JBProjects NFT is owned by
// the recognized REVOwner singleton.
export function isRevnet(owner: string): boolean {
  if (!owner) return false
  return owner.toLowerCase() === REV_OWNER.toLowerCase()
}

export function isRevnetProject(
  project: { owner?: string; isRevnet?: boolean } | null | undefined
): boolean {
  return !!project?.owner && isRevnet(project.owner)
}

// Get the contracts for a project by querying JBDirectory.
// V6 has a single contract set; the controller lookup remains useful for
// projects that use a custom controller.
export async function getContractsForProject(
  projectId: string,
  chainId: number
): Promise<{
  JBRulesets: `0x${string}`
  JBController: `0x${string}`
  JBSplits: `0x${string}`
  JBFundAccessLimits: `0x${string}`
  JBTokens: `0x${string}`
}> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`No RPC client for chain ${chainId}`)

  const controllerAddress = await publicClient.readContract({
    address: JB_CONTRACTS.JBDirectory,
    abi: JB_DIRECTORY_ABI,
    functionName: 'controllerOf',
    args: [BigInt(projectId)],
  })

  if (!controllerAddress || controllerAddress === ZERO_ADDRESS) throw new Error('Project has no controller')
  if (controllerAddress.toLowerCase() !== JB_CONTRACTS.JBController.toLowerCase()) {
    throw new Error(`Controller not recognized: ${controllerAddress}`)
  }

  const dependencyAbi = [
    { name: 'DIRECTORY', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
    { name: 'PROJECTS', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
    { name: 'RULESETS', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
    { name: 'SPLITS', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
    { name: 'FUND_ACCESS_LIMITS', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
    { name: 'TOKENS', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  ] as const

  const [directory, projects, rulesets, splits, fundAccessLimits, tokens] = await Promise.all([
    publicClient.readContract({ address: controllerAddress, abi: dependencyAbi, functionName: 'DIRECTORY' }),
    publicClient.readContract({ address: controllerAddress, abi: dependencyAbi, functionName: 'PROJECTS' }),
    publicClient.readContract({ address: controllerAddress, abi: dependencyAbi, functionName: 'RULESETS' }),
    publicClient.readContract({ address: controllerAddress, abi: dependencyAbi, functionName: 'SPLITS' }),
    publicClient.readContract({ address: controllerAddress, abi: dependencyAbi, functionName: 'FUND_ACCESS_LIMITS' }),
    publicClient.readContract({ address: controllerAddress, abi: dependencyAbi, functionName: 'TOKENS' }),
  ])

  if (directory.toLowerCase() !== JB_CONTRACTS.JBDirectory.toLowerCase() ||
      projects.toLowerCase() !== JB_CONTRACTS.JBProjects.toLowerCase()) {
    throw new Error(`Controller not recognized: ${controllerAddress}`)
  }
  const dependencies = [
    ['Rulesets', rulesets, JB_CONTRACTS.JBRulesets],
    ['Splits', splits, JB_CONTRACTS.JBSplits],
    ['Fund access limits', fundAccessLimits, JB_CONTRACTS.JBFundAccessLimits],
    ['Tokens', tokens, JB_CONTRACTS.JBTokens],
  ] as const
  for (const [name, discovered, recognized] of dependencies) {
    if (discovered.toLowerCase() !== recognized.toLowerCase()) {
      throw new Error(`${name} contract not recognized: ${discovered}`)
    }
  }

  return {
    JBRulesets: rulesets,
    JBController: controllerAddress,
    JBSplits: splits,
    JBFundAccessLimits: fundAccessLimits,
    JBTokens: tokens,
  }
}

// Cache for Revnet operator addresses
const revnetOperatorCache = createCache<string>(CACHE_DURATIONS.LONG)
const REV_OWNER_OPERATOR_ABI = [{
  name: 'isOperatorOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'revnetId', type: 'uint256' },
    { name: 'addr', type: 'address' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const

// Fetch the operator (splitOperator) for a Revnet project. Bendystraw supplies
// candidates, but only the live REVOwner contract determines current authority.
export async function fetchRevnetOperator(
  projectId: string,
  chainId: number
): Promise<string | null> {
  const numericProjectId = Number(projectId)
  if (!/^\d+$/.test(projectId) || !Number.isSafeInteger(numericProjectId) || numericProjectId < 1) {
    throw new Error('Revnet operator unavailable: invalid project ID')
  }
  const projectIdBigInt = BigInt(projectId)
  const cacheKey = `${chainId}-${projectId}`
  const cached = revnetOperatorCache.get(cacheKey)
  if (cached) return cached

  const client = getClient(getNetworkOption(chainId))
  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`Revnet operator unavailable on unsupported chain ${chainId}`)

  try {
    // Query permissionHolders for this project where isRevnetOperator is true
    const data = await client.request<{
      permissionHolders: {
        totalCount: number
        items: Array<{
          operator: string
          projectId: number
          chainId: number
          version: number
          isRevnetOperator: boolean
          permissions: unknown[]
        }>
      }
    }>(REVNET_OPERATOR_QUERY, {
      projectId: numericProjectId,
      chainId,
      version: 6,
    })

    const page = data.permissionHolders
    if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.totalCount)
      || page.totalCount < 0 || page.totalCount !== page.items.length) {
      throw new Error('Indexed Revnet operator data is incomplete')
    }
    const candidates = page.items.filter(item =>
      item?.isRevnetOperator === true
      && item.chainId === chainId
      && item.projectId === numericProjectId
      && item.version === 6
      && Array.isArray(item.permissions)
      && item.permissions.length > 0
      && isAddress(item.operator)
      && item.operator.toLowerCase() !== ZERO_ADDRESS.toLowerCase()
    )
    if (candidates.length === 0) return null

    const projectOwner = await publicClient.readContract({
      address: JB_CONTRACTS.JBProjects,
      abi: JB_PROJECTS_OWNER_OF_ABI,
      functionName: 'ownerOf',
      args: [projectIdBigInt],
    })
    if (projectOwner.toLowerCase() !== REV_OWNER.toLowerCase()) {
      throw new Error(`Revnet owner not recognized: ${projectOwner}`)
    }
    const uniqueCandidates = [...new Map(
      candidates.map(candidate => [candidate.operator.toLowerCase(), candidate])
    ).values()]
    // Independent view reads - verify all candidates in parallel
    const currentFlags = await Promise.all(uniqueCandidates.map(candidate =>
      publicClient.readContract({
        address: projectOwner,
        abi: REV_OWNER_OPERATOR_ABI,
        functionName: 'isOperatorOf',
        args: [projectIdBigInt, candidate.operator as `0x${string}`],
      })
    ))
    const verified = uniqueCandidates
      .filter((_, index) => currentFlags[index])
      .map(candidate => candidate.operator)
    if (verified.length !== 1) throw new Error('Current Revnet operator could not be identified uniquely')
    const operator = verified[0]

    // Cache the result
    revnetOperatorCache.set(cacheKey, operator)

    return operator
  } catch (err) {
    console.error('Failed to fetch Revnet operator:', err)
    throw new Error(`Revnet operator unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
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
  baseCurrency?: number
  useDataHookForPay?: boolean
  useDataHookForCashOut?: boolean
  dataHook?: string
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
  if (!publicClient) throw new Error(`Revnet stages unavailable on unsupported chain ${chainId}`)

  try {
    // REVDeployer stores the complete launch payload only as a hash, but every
    // stage's economic terms are queued as a JBRuleset. Read those canonical
    // records directly, as website/ does, and verify live REVOwner ownership.
    const [rulesets, currentRuleset, owner] = await Promise.all([
      fetchAllRulesets(projectId, chainId),
      publicClient.readContract({
        address: JB_CONTRACTS.JBRulesets,
        abi: JB_RULESETS_ABI,
        functionName: 'currentOf',
        args: [BigInt(projectId)],
      }),
      publicClient.readContract({
        address: JB_CONTRACTS.JBProjects,
        abi: JB_PROJECTS_OWNER_OF_ABI,
        functionName: 'ownerOf',
        args: [BigInt(projectId)],
      }),
    ])
    if (!isRevnet(owner)) throw new Error(`Revnet owner not recognized: ${owner}`)
    if (rulesets.length === 0) return null

    const currentIndex = rulesets.findIndex(ruleset => ruleset.id === String(currentRuleset.id))
    const stages = rulesets.map((ruleset, index): RevnetStage => ({
      stageNumber: index + 1,
      startsAtOrAfter: ruleset.start,
      splitPercent: ruleset.reservedPercent,
      initialIssuance: ruleset.weight,
      issuanceDecayFrequency: ruleset.duration,
      issuanceDecayPercent: ruleset.weightCutPercent,
      cashOutTaxRate: ruleset.cashOutTaxRate,
      isCurrent: index === currentIndex,
      isPast: currentIndex >= 0 && index < currentIndex,
      isFuture: currentIndex < 0 || index > currentIndex,
    }))

    return { stages, currentStage: currentIndex >= 0 ? currentIndex + 1 : 0 }
  } catch (err) {
    console.error('Failed to fetch Revnet stages:', err)
    throw new Error(`Revnet stages unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
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
  const cacheKey = `${chainId}-${projectId}`

  // Check TTL cache (for regular projects)
  const cached = rulesetHistoryCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`Ruleset history unavailable on unsupported chain ${chainId}`)

  try {
    if (!/^\d+$/.test(currentRulesetId) || !Number.isSafeInteger(maxHistory) || maxHistory <= 0) {
      throw new Error('Ruleset history request is invalid')
    }
    // Resolve the project's controller (V6 single contract set)
    const contracts = await getContractsForProject(projectId, chainId)

    // First, get the ACTUAL current ruleset to know what cycle we're on
    // Must use currentOf (not getRulesetOf) to get the computed current cycle number
    const currentRuleset = await publicClient.readContract({
      address: contracts.JBRulesets,
      abi: JB_RULESETS_ABI,
      functionName: 'currentOf',
      args: [BigInt(projectId)],
    })

    if (currentRuleset.cycleNumber === 0) return []

    const currentCycleNum = Number(currentRuleset.cycleNumber)
    const firstCycleNum = Math.max(1, currentCycleNum - maxHistory + 1)

    // Walk back via basedOnId to collect all distinct ruleset configurations
    // These are the "base" rulesets that may cover multiple cycles each
    const distinctRulesets: Array<{
      cycleNumber: number
      id: bigint
      start: number
      duration: number
      weight: string
      weightCutPercent: number
      reservedPercent: number
      cashOutTaxRate: number
      pausePay: boolean
      allowOwnerMinting: boolean
      baseCurrency: number
      useDataHookForPay: boolean
      useDataHookForCashOut: boolean
      dataHook: string
    }> = []

    let rulesetId = BigInt(currentRulesetId)
    let count = 0

    while (rulesetId > 0n && count < 1_000) {
      const ruleset = await publicClient.readContract({
        address: contracts.JBRulesets,
        abi: JB_RULESETS_ABI,
        functionName: 'getRulesetOf',
        args: [BigInt(projectId), rulesetId],
      })
      if (ruleset.cycleNumber === 0) throw new Error(`Ruleset ${rulesetId} is unavailable`)
      const metadata = decodeRulesetMetadata(ruleset.metadata)

      distinctRulesets.push({
        cycleNumber: Number(ruleset.cycleNumber),
        id: BigInt(ruleset.id),
        start: Number(ruleset.start),
        duration: Number(ruleset.duration),
        weight: String(ruleset.weight),
        weightCutPercent: Number(ruleset.weightCutPercent),
        reservedPercent: metadata.reservedPercent,
        cashOutTaxRate: metadata.cashOutTaxRate,
        pausePay: metadata.pausePay,
        allowOwnerMinting: metadata.allowOwnerMinting,
        baseCurrency: metadata.baseCurrency,
        useDataHookForPay: metadata.useDataHookForPay,
        useDataHookForCashOut: metadata.useDataHookForCashOut,
        dataHook: metadata.dataHook,
      })

      rulesetId = BigInt(ruleset.basedOnId)
      count++
      if (Number(ruleset.cycleNumber) <= firstCycleNum) break
    }
    if (rulesetId > 0n && count >= 1_000) throw new Error('Ruleset history exceeds the safe traversal limit')
    if (distinctRulesets.length === 0) throw new Error('Current ruleset history is unavailable')

    // Sort distinct rulesets by cycle number (ascending)
    distinctRulesets.sort((a, b) => a.cycleNumber - b.cycleNumber)

    // Now expand to all cycles from 1 to current
    // Each distinct ruleset covers cycles from its cycleNumber until the next distinct ruleset
    const allCycles: RulesetHistoryEntry[] = []

    for (let cycle = firstCycleNum; cycle <= currentCycleNum; cycle++) {
      // Find which distinct ruleset this cycle is based on
      // It's the last distinct ruleset with cycleNumber <= cycle
      let baseRuleset: typeof distinctRulesets[number] | undefined
      for (const rs of distinctRulesets) {
        if (rs.cycleNumber <= cycle) {
          baseRuleset = rs
        } else {
          break
        }
      }

      // Calculate how many cycles after the base ruleset this is
      if (!baseRuleset) throw new Error(`Ruleset history is incomplete for cycle ${cycle}`)
      const cyclesAfterBase = cycle - baseRuleset.cycleNumber

      // Calculate the start time for this cycle
      let cycleStart: number
      if (cyclesAfterBase === 0) {
        cycleStart = baseRuleset.start
      } else {
        cycleStart = baseRuleset.start + (cyclesAfterBase * baseRuleset.duration)
      }

      allCycles.push({
        cycleNumber: cycle,
        id: String(baseRuleset.id),
        start: cycleStart,
        duration: baseRuleset.duration,
        weight: deriveCycledWeight(baseRuleset.weight, baseRuleset.weightCutPercent, cyclesAfterBase).toString(),
        weightCutPercent: baseRuleset.weightCutPercent,
        reservedPercent: baseRuleset.reservedPercent,
        cashOutTaxRate: baseRuleset.cashOutTaxRate,
        pausePay: baseRuleset.pausePay,
        allowOwnerMinting: baseRuleset.allowOwnerMinting,
        baseCurrency: baseRuleset.baseCurrency,
        useDataHookForPay: baseRuleset.useDataHookForPay,
        useDataHookForCashOut: baseRuleset.useDataHookForCashOut,
        dataHook: baseRuleset.dataHook,
        status: cycle === currentCycleNum ? 'current' : 'past',
      })
    }

    // Limit to maxHistory and reverse so current is first
    const limited = allCycles.slice(-maxHistory).reverse()

    rulesetHistoryCache.set(cacheKey, limited)

    return limited
  } catch (err) {
    console.error('Failed to fetch ruleset history:', err)
    throw new Error(`Ruleset history unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Simple ruleset type for price charts (avoids cycle expansion complexity)
export interface SimpleRuleset {
  id: string
  cycleNumber: number
  start: number
  duration: number
  weight: string
  weightCutPercent: number
  reservedPercent: number
  cashOutTaxRate: number
}

// Fetch all rulesets using allOf for reliable historical data
// This matches the approach used by revnet-app
export async function fetchAllRulesets(
  projectId: string,
  chainId: number
): Promise<SimpleRuleset[]> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`Ruleset history unavailable on unsupported chain ${chainId}`)

  try {
    // Resolve the project's controller (V6 single contract set)
    const contracts = await getContractsForProject(projectId, chainId)

    // allOf is newest-first and follows basedOnId. Page through the exact
    // deployed JBRulesets linked list so a large schedule is never truncated.
    const PAGE_SIZE = 100
    const MAX_RULESETS = 1_000
    const result: SimpleRuleset[] = []
    const seen = new Set<string>()
    let startingId = 0n

    while (true) {
      const page = await publicClient.readContract({
        address: contracts.JBRulesets,
        abi: JB_RULESETS_ABI,
        functionName: 'allOf',
        args: [BigInt(projectId), startingId, BigInt(PAGE_SIZE)],
      })
      if (page.length === 0) break

      for (const ruleset of page) {
        const id = String(ruleset.id)
        if (seen.has(id)) throw new Error('Ruleset history is cyclic')
        seen.add(id)
        if (ruleset.cycleNumber > 0) {
          const metadata = decodeRulesetMetadata(ruleset.metadata)
          result.push({
            id,
            cycleNumber: Number(ruleset.cycleNumber),
            start: Number(ruleset.start),
            duration: Number(ruleset.duration),
            weight: String(ruleset.weight),
            weightCutPercent: Number(ruleset.weightCutPercent),
            reservedPercent: metadata.reservedPercent,
            cashOutTaxRate: metadata.cashOutTaxRate,
          })
        }
      }

      const nextId = BigInt(page[page.length - 1].basedOnId)
      if (page.length < PAGE_SIZE || nextId === 0n) break
      if (result.length >= MAX_RULESETS || seen.has(nextId.toString())) {
        throw new Error('Ruleset history exceeds the safe traversal limit')
      }
      startingId = nextId
    }

    return result.sort((a, b) => a.start - b.start)
  } catch (err) {
    console.error('Failed to fetch all rulesets:', err)
    throw new Error(`Ruleset history unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Fetch queued and upcoming rulesets
export async function fetchQueuedRulesets(
  projectId: string,
  chainId: number
): Promise<{ queued?: RulesetHistoryEntry; upcoming?: RulesetHistoryEntry }> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`Upcoming ruleset unavailable on unsupported chain ${chainId}`)

  try {
    // Resolve the project's controller (V6 single contract set)
    const contracts = await getContractsForProject(projectId, chainId)

    const upcomingRuleset = await publicClient.readContract({
      address: contracts.JBRulesets,
      abi: JB_RULESETS_ABI,
      functionName: 'upcomingOf',
      args: [BigInt(projectId)],
    })
    if (upcomingRuleset.cycleNumber === 0) return {}
    const metadata = decodeRulesetMetadata(upcomingRuleset.metadata)
    return {
      upcoming: {
        cycleNumber: Number(upcomingRuleset.cycleNumber),
        id: String(upcomingRuleset.id),
        start: Number(upcomingRuleset.start),
        duration: Number(upcomingRuleset.duration),
        weight: String(upcomingRuleset.weight),
        weightCutPercent: Number(upcomingRuleset.weightCutPercent),
        reservedPercent: metadata.reservedPercent,
        cashOutTaxRate: metadata.cashOutTaxRate,
        pausePay: metadata.pausePay,
        allowOwnerMinting: metadata.allowOwnerMinting,
        baseCurrency: metadata.baseCurrency,
        useDataHookForPay: metadata.useDataHookForPay,
        useDataHookForCashOut: metadata.useDataHookForCashOut,
        dataHook: metadata.dataHook,
        status: 'upcoming',
      },
    }
  } catch (err) {
    console.error('Failed to fetch queued rulesets:', err)
    throw new Error(`Upcoming ruleset unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Queued ruleset info with decoded metadata
export interface QueuedRulesetInfo {
  cycleNumber: number
  id: string
  start: number
  duration: number
  weight: string
  weightCutPercent: number
  cashOutTaxRate: number // 0-10000 basis points
  reservedPercent: number
  baseCurrency: number
  pausePay: boolean
}

// Fetch the latest QUEUED ruleset with its fully decoded metadata
// This only returns a ruleset if one has been explicitly queued (different from current)
// Use this for showing warnings about upcoming parameter changes
export async function fetchUpcomingRulesetWithMetadata(
  projectId: string,
  chainId: number
): Promise<QueuedRulesetInfo | null> {
  try {
    const { upcoming } = await fetchQueuedRulesets(projectId, chainId)

    // If no queued ruleset, return null
    if (!upcoming) return null

    // Validate cash out tax rate is within bounds (0-10000)
    const cashOutTaxRate = upcoming.cashOutTaxRate ?? Number.NaN
    if (!(cashOutTaxRate >= 0 && cashOutTaxRate <= 10000)) {
      throw new Error(`Upcoming cash-out tax rate is invalid: ${cashOutTaxRate}`)
    }

    return {
      cycleNumber: upcoming.cycleNumber,
      id: upcoming.id,
      start: upcoming.start,
      duration: upcoming.duration,
      weight: upcoming.weight,
      weightCutPercent: upcoming.weightCutPercent,
      cashOutTaxRate,
      reservedPercent: upcoming.reservedPercent ?? 0,
      baseCurrency: upcoming.baseCurrency ?? 0,
      pausePay: upcoming.pausePay ?? false,
    }
  } catch (err) {
    // fetchQueuedRulesets already wraps its failures with this label.
    if (err instanceof Error && err.message.startsWith('Upcoming ruleset unavailable')) throw err
    console.error('Failed to fetch queued ruleset with metadata:', err)
    throw new Error(`Upcoming ruleset unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// ============================================================================
// SPLITS AND FUND ACCESS
// ============================================================================

// JBSplits ABI for reading split configurations
// JBSplit struct order from juice-sdk-core (different from storage layout!)
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
          { name: 'percent', type: 'uint32' },
          { name: 'projectId', type: 'uint64' },
          { name: 'beneficiary', type: 'address' },
          { name: 'preferAddToBalance', type: 'bool' },
          { name: 'lockedUntil', type: 'uint48' },
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

const JB_TERMINAL_STORE_USED_ALLOWANCE_ABI = [{
  name: 'usedSurplusAllowanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'terminal', type: 'address' },
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'rulesetId', type: 'uint256' },
    { name: 'currency', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}, {
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'terminal', type: 'address' },
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const

const JB_TERMINAL_SURPLUS_ABI = [{
  name: 'currentSurplusOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'tokens', type: 'address[]' },
    { name: 'decimals', type: 'uint256' },
    { name: 'currency', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const

// Split group IDs (JB V6) - see JBSplitGroupIds.sol and JBMultiTerminal
// Reserved token splits = group 1 (JBSplitGroupIds.RESERVED_TOKENS)
// Payout splits = uint256(uint160(token)) - computed from the payout token address
const SPLIT_GROUP_RESERVED = 1n

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
  terminal: string
  token: string
  tokenDecimals: number
  balance: string
  payoutLimits: Array<{ amount: string; currency: number }>
  surplusAllowances: Array<{
    amount: string
    currency: number
    usedAmount: string
    currentSurplus: string
  }>
}

export interface JBSplitGroupData {
  groupId: string
  splits: JBSplitData[]
}

// Project splits data
export interface ProjectSplitsData {
  payoutSplits: JBSplitData[]
  reservedSplits: JBSplitData[]
  fundAccessLimits?: FundAccessLimits
  /** Complete effective groups reconstructed from every terminal accounting context. */
  splitGroups?: JBSplitGroupData[]
  fundAccessLimitGroups?: FundAccessLimits[]
  accountingContexts?: Array<{
    terminal: string
    token: string
    tokenDecimals: number
    currency: number
  }>
  /** False means the data is display-only and must not be used to build a transaction. */
  configurationComplete?: boolean
}

/**
 * Fetch project splits (payout and reserved token recipients)
 * Splits are stored per (projectId, rulesetId, groupId) - query directly with the rulesetId
 */
export async function fetchProjectSplits(
  projectId: string,
  chainId: number,
  rulesetId: string
): Promise<ProjectSplitsData> {
  const publicClient = getPublicClient(chainId)
  if (!publicClient) throw new Error(`Treasury configuration unavailable on unsupported chain ${chainId}`)

  // Type for raw split data from contract (matches viem decoded types)
  // uint32 -> number, uint64 -> bigint, uint48 -> number
  type RawSplit = {
    percent: number       // uint32
    projectId: bigint     // uint64
    beneficiary: string   // address
    preferAddToBalance: boolean
    lockedUntil: number   // uint48
    hook: string          // address
  }

  const mapSplit = (s: RawSplit): JBSplitData => {
    if (!Number.isSafeInteger(s.percent) || s.percent <= 0 || s.percent > 1_000_000_000) {
      throw new Error('Split percentage is invalid')
    }
    if (s.projectId < 0n || s.projectId > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Split project ID cannot be represented safely')
    }
    if (!isAddress(s.beneficiary) || !isAddress(s.hook)) {
      throw new Error('Split contains an invalid address')
    }
    if (!Number.isSafeInteger(s.lockedUntil) || s.lockedUntil < 0 || s.lockedUntil > 2 ** 48 - 1) {
      throw new Error('Split lock time is invalid')
    }
    return {
      preferAddToBalance: s.preferAddToBalance,
      percent: s.percent,
      projectId: Number(s.projectId),
      beneficiary: s.beneficiary,
      lockedUntil: s.lockedUntil,
      hook: s.hook,
    }
  }

  const validateSplitGroup = (splits: JBSplitData[], label: string) => {
    const total = splits.reduce((sum, split) => sum + BigInt(split.percent), 0n)
    if (total > 1_000_000_000n) throw new Error(`${label} splits exceed 100%`)
  }

  try {
    const rsId = BigInt(rulesetId)
    const contracts = await getContractsForProject(projectId, chainId)

    const terminals = await publicClient.readContract({
      address: JB_CONTRACTS.JBDirectory,
      abi: JB_DIRECTORY_ABI,
      functionName: 'terminalsOf',
      args: [BigInt(projectId)],
    })
    if (terminals.length === 0) throw new Error('Project has no terminal configured')
    const uniqueTerminals = new Set(terminals.map(terminal => terminal.toLowerCase()))
    if (uniqueTerminals.size !== terminals.length) throw new Error('Project terminal configuration is ambiguous')

    const terminalContexts = (await Promise.all(terminals.map(async terminal => {
      const recognizedTerminal = [
        JB_CONTRACTS.JBMultiTerminal,
        JB_ROUTER_TERMINAL,
        JB_ROUTER_TERMINAL_REGISTRY,
      ].some(address => address.toLowerCase() === terminal.toLowerCase())
      if (!recognizedTerminal) throw new Error(`Terminal not recognized: ${terminal}`)

      const contexts = await publicClient.readContract({
        address: terminal,
        abi: JB_TERMINAL_ACCOUNTING_CONTEXTS_ABI,
        functionName: 'accountingContextsOf',
        args: [BigInt(projectId)],
      })
      if (contexts.length === 0) return []
      if (terminal.toLowerCase() !== JB_CONTRACTS.JBMultiTerminal.toLowerCase()) {
        throw new Error(`Terminal not recognized for accounting contexts: ${terminal}`)
      }
      const store = await publicClient.readContract({
        address: terminal,
        abi: JB_TERMINAL_STORE_ADDRESS_ABI,
        functionName: 'STORE',
      })
      return contexts.map(context => ({
        terminal,
        store,
        token: context.token,
        tokenDecimals: Number(context.decimals),
        currency: Number(context.currency),
      }))
    }))).flat()
    if (terminalContexts.length === 0) throw new Error('Project has no accounting context configured')
    const seenTokens = new Set<string>()
    for (const context of terminalContexts) {
      if (
        !isAddress(context.token) ||
        !Number.isInteger(context.tokenDecimals) ||
        context.tokenDecimals < 0 ||
        context.tokenDecimals > 77 ||
        !Number.isInteger(context.currency) ||
        context.currency < 0 ||
        context.currency > 0xffff_ffff
      ) {
        throw new Error(`Accounting context is invalid for token: ${context.token}`)
      }
      const token = context.token.toLowerCase()
      if (seenTokens.has(token)) throw new Error(`Duplicate accounting context for token: ${context.token}`)
      seenTokens.add(token)
    }

    const reservedResult = await publicClient.readContract({
      address: contracts.JBSplits,
      abi: JB_SPLITS_ABI,
      functionName: 'splitsOf',
      args: [BigInt(projectId), rsId, SPLIT_GROUP_RESERVED],
    })
    const reservedSplits = ([...reservedResult] as RawSplit[]).map(mapSplit)
    validateSplitGroup(reservedSplits, 'Reserved token')

    const payoutGroups = await Promise.all(terminalContexts.map(async context => {
      // V6 payout split groups are keyed by uint256(uint160(token))
      const groupId = BigInt(context.token)
      const result = await publicClient.readContract({
        address: contracts.JBSplits,
        abi: JB_SPLITS_ABI,
        functionName: 'splitsOf',
        args: [BigInt(projectId), rsId, groupId],
      })
      const splits = ([...result] as RawSplit[]).map(mapSplit)
      validateSplitGroup(splits, 'Payout')
      return { groupId: groupId.toString(), splits }
    }))
    await Promise.all(
      [reservedSplits, ...payoutGroups.map(group => group.splits)]
        .flat()
        .map(split => requireRecognizedRuntimeSplitHook(publicClient, split.hook as `0x${string}`)),
    )

    const fundAccessLimitGroups = (await Promise.all(terminalContexts.map(async context => {
      const [payoutLimitsRaw, surplusAllowancesRaw, balance] = await Promise.all([
        publicClient.readContract({
          address: contracts.JBFundAccessLimits,
          abi: JB_FUND_ACCESS_LIMITS_SPLITS_ABI,
          functionName: 'payoutLimitsOf',
          args: [BigInt(projectId), rsId, context.terminal, context.token],
        }),
        publicClient.readContract({
          address: contracts.JBFundAccessLimits,
          abi: JB_FUND_ACCESS_LIMITS_SPLITS_ABI,
          functionName: 'surplusAllowancesOf',
          args: [BigInt(projectId), rsId, context.terminal, context.token],
        }),
        publicClient.readContract({
          address: context.store,
          abi: JB_TERMINAL_STORE_USED_ALLOWANCE_ABI,
          functionName: 'balanceOf',
          args: [context.terminal, BigInt(projectId), context.token],
        }),
      ])
      if (payoutLimitsRaw.length === 0 && surplusAllowancesRaw.length === 0) return null

      const surplusAllowances = await Promise.all(surplusAllowancesRaw.map(async allowance => {
        const allowanceDecimals = context.tokenDecimals
        const [usedAmount, currentSurplus] = await Promise.all([
          publicClient.readContract({
            address: context.store,
            abi: JB_TERMINAL_STORE_USED_ALLOWANCE_ABI,
            functionName: 'usedSurplusAllowanceOf',
            args: [context.terminal, BigInt(projectId), context.token, rsId, allowance.currency],
          }),
          publicClient.readContract({
            address: context.terminal,
            abi: JB_TERMINAL_SURPLUS_ABI,
            functionName: 'currentSurplusOf',
            args: [BigInt(projectId), [context.token], BigInt(allowanceDecimals), allowance.currency],
          }),
        ])
        return {
          amount: String(allowance.amount),
          currency: Number(allowance.currency),
          usedAmount: String(usedAmount),
          currentSurplus: String(currentSurplus),
        }
      }))

      return {
        terminal: context.terminal,
        token: context.token,
        tokenDecimals: context.tokenDecimals,
        balance: String(balance),
        payoutLimits: payoutLimitsRaw.map(limit => ({
          amount: String(limit.amount),
          currency: Number(limit.currency),
        })),
        surplusAllowances,
      } satisfies FundAccessLimits
    }))).filter(group => group !== null)

    const nonEmptyPayoutGroups = payoutGroups.filter(group => group.splits.length > 0)
    const splitGroups: JBSplitGroupData[] = [
      ...(reservedSplits.length > 0 ? [{ groupId: SPLIT_GROUP_RESERVED.toString(), splits: reservedSplits }] : []),
      ...nonEmptyPayoutGroups,
    ]

    return {
      payoutSplits: nonEmptyPayoutGroups[0]?.splits || [],
      reservedSplits,
      fundAccessLimits: fundAccessLimitGroups[0],
      splitGroups,
      fundAccessLimitGroups,
      accountingContexts: terminalContexts,
      configurationComplete: true,
    }
  } catch (err) {
    console.error('Failed to fetch project splits:', err)
    throw new Error(`Treasury configuration unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
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

interface IndexedCashOutTaxSnapshot {
  cashOutTax?: unknown
  start?: unknown
  duration?: unknown
  rulesetId?: unknown
  suckerGroupId?: unknown
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
  reclaimAmountUsd?: string
  cashOutCount: string
  timestamp: number
  from: string
  txHash: string
}

type HistoryPageInfo = { hasNextPage: boolean; endCursor?: string | null }

function requireHistoryLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
    throw new Error('History page size is invalid')
  }
}

function nextHistoryCursor(
  pageInfo: HistoryPageInfo | null | undefined,
  previousCursor: string | null,
): string | null {
  if (!pageInfo || typeof pageInfo.hasNextPage !== 'boolean') {
    throw new Error('History pagination is malformed')
  }
  if (!pageInfo.hasNextPage) return null
  if (typeof pageInfo.endCursor !== 'string' || !pageInfo.endCursor || pageInfo.endCursor === previousCursor) {
    throw new Error('History pagination cursor is invalid')
  }
  return pageInfo.endCursor
}

type HistoryConnection<TRaw> = { items: TRaw[]; pageInfo: HistoryPageInfo }

interface HistoryQueryParams<TRaw, TItem> {
  client: GraphQLClient
  query: RequestDocument
  variables: Variables
  /** Response field holding the connection, e.g. 'payEvents'. */
  field: string
  validate: (item: TRaw) => TItem
  /** Human label used in malformed/limit error messages, e.g. 'Payment history'. */
  label: string
}

// Fetch and validate a single cursor page of a history connection.
async function fetchHistoryPage<TRaw, TItem = TRaw>(
  params: HistoryQueryParams<TRaw, TItem> & { after: string | null },
): Promise<{ items: TItem[]; hasNextPage: boolean; endCursor: string | null }> {
  const data = await params.client.request<Record<string, HistoryConnection<TRaw>>>(params.query, {
    ...params.variables,
    after: params.after,
  })
  const connection = data[params.field]
  if (!Array.isArray(connection?.items)) throw new Error(`${params.label} is malformed`)
  const endCursor = nextHistoryCursor(connection.pageInfo, params.after)
  return {
    items: connection.items.map(params.validate),
    hasNextPage: endCursor !== null,
    endCursor,
  }
}

// Follow the cursor chain until exhausted or the safety limit trips.
async function fetchAllHistoryPages<TRaw, TItem = TRaw>(
  params: HistoryQueryParams<TRaw, TItem> & { maxItems: number },
): Promise<TItem[]> {
  const all: TItem[] = []
  let cursor: string | null = null
  do {
    const page: Awaited<ReturnType<typeof fetchHistoryPage<TRaw, TItem>>> = await fetchHistoryPage<
      TRaw,
      TItem
    >({ ...params, after: cursor })
    all.push(...page.items)
    cursor = page.endCursor
  } while (cursor && all.length < params.maxItems)
  if (cursor) throw new Error(`${params.label} exceeds the safe page limit`)
  return all
}

function isSafeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function isTransactionHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function safeIndexedInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const exact = BigInt(value)
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(exact)
}

// Bendystraw serializes BigInt timestamp/duration fields as decimal strings.
// Normalize those non-monetary integers once at the API boundary while keeping
// ruleset IDs exact strings and rejecting values JavaScript cannot represent.
export function normalizeCashOutTaxSnapshot(
  item: IndexedCashOutTaxSnapshot,
  suckerGroupId: string,
): CashOutTaxSnapshot {
  const cashOutTax = safeIndexedInteger(item.cashOutTax)
  const start = safeIndexedInteger(item.start)
  const duration = safeIndexedInteger(item.duration)
  if (cashOutTax === null || cashOutTax > 10_000
    || start === null || start <= 0 || duration === null
    || !isRawAmount(item.rulesetId) || item.suckerGroupId !== suckerGroupId) {
    throw new Error('Cash-out tax history contains malformed data')
  }
  return { cashOutTax, start, duration, rulesetId: item.rulesetId, suckerGroupId }
}

function validateSuckerGroupMoment(item: SuckerGroupMoment, suckerGroupId: string): SuckerGroupMoment {
  if (!isSafeTimestamp(item.timestamp) || !isRawAmount(item.balance)
    || !isRawAmount(item.tokenSupply) || item.suckerGroupId !== suckerGroupId) {
    throw new Error('Treasury history contains malformed data')
  }
  return item
}

function validatePayHistoryItem(item: PayEventHistoryItem): PayEventHistoryItem {
  if (!isRawAmount(item.amount) || !isRawAmount(item.newlyIssuedTokenCount)
    || (item.amountUsd != null && !isRawAmount(item.amountUsd))
    || !isSafeTimestamp(item.timestamp) || !isAddress(item.from) || !isTransactionHash(item.txHash)) {
    throw new Error('Payment history contains malformed data')
  }
  return item
}

function validateCashOutHistoryItem(item: CashOutEventHistoryItem): CashOutEventHistoryItem {
  if (!isRawAmount(item.reclaimAmount) || !isRawAmount(item.cashOutCount)
    || (item.reclaimAmountUsd != null && !isRawAmount(item.reclaimAmountUsd))
    || !isSafeTimestamp(item.timestamp) || !isAddress(item.from) || !isTransactionHash(item.txHash)) {
    throw new Error('Cash-out history contains malformed data')
  }
  return item
}

// Fetch cash out tax snapshots for floor price calculation
export async function fetchCashOutTaxSnapshots(
  suckerGroupId: string,
  limit: number = 1000,
  chainId?: number
): Promise<CashOutTaxSnapshot[]> {
  requireHistoryLimit(limit)
  const client = getClient(chainId ? getNetworkOption(chainId) : undefined)

  try {
    return await fetchAllHistoryPages<IndexedCashOutTaxSnapshot, CashOutTaxSnapshot>({
      client,
      query: CASH_OUT_TAX_SNAPSHOTS_QUERY,
      variables: { suckerGroupId, limit },
      field: 'cashOutTaxSnapshots',
      validate: item => normalizeCashOutTaxSnapshot(item, suckerGroupId),
      label: 'Cash-out tax history',
      maxItems: 5000,
    })
  } catch (err) {
    console.error('Failed to fetch cash out tax snapshots:', err)
    throw new Error(`Cash-out tax history unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Fetch sucker group moments (balance/supply over time)
export async function fetchSuckerGroupMoments(
  suckerGroupId: string,
  limit: number = 1000,
  chainId?: number
): Promise<SuckerGroupMoment[]> {
  requireHistoryLimit(limit)
  const client = getClient(chainId ? getNetworkOption(chainId) : undefined)

  try {
    return await fetchAllHistoryPages<SuckerGroupMoment>({
      client,
      query: SUCKER_GROUP_MOMENTS_QUERY,
      variables: { suckerGroupId, limit },
      field: 'suckerGroupMoments',
      validate: item => validateSuckerGroupMoment(item, suckerGroupId),
      label: 'Treasury history',
      maxItems: 10000,
    })
  } catch (err) {
    console.error('Failed to fetch sucker group moments:', err)
    throw new Error(`Treasury history unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Fetch pay events history for volume over time
export async function fetchPayEventsHistory(
  projectId: string,
  chainId: number,
  version: number = 6,
  limit: number = 1000
): Promise<PayEventHistoryItem[]> {
  requireHistoryLimit(limit)
  const client = getClient(getNetworkOption(chainId))

  try {
    return await fetchAllHistoryPages<PayEventHistoryItem>({
      client,
      query: PAY_EVENTS_HISTORY_QUERY,
      variables: { projectId: parseInt(projectId), chainId, version, limit },
      field: 'payEvents',
      validate: validatePayHistoryItem,
      label: 'Payment history',
      maxItems: 10000,
    })
  } catch (err) {
    console.error('Failed to fetch pay events history:', err)
    throw new Error(`Payment history unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Paginated version - returns single page with cursor info
export type PayEventsPage = {
  items: PayEventHistoryItem[]
  hasNextPage: boolean
  endCursor: string | null
}

export async function fetchPayEventsPage(
  projectId: string,
  chainId: number,
  version: number = 6,
  limit: number = 15,
  after?: string | null
): Promise<PayEventsPage> {
  requireHistoryLimit(limit)
  const client = getClient(getNetworkOption(chainId))

  try {
    return await fetchHistoryPage<PayEventHistoryItem>({
      client,
      query: PAY_EVENTS_HISTORY_QUERY,
      variables: { projectId: parseInt(projectId), chainId, version, limit },
      field: 'payEvents',
      validate: validatePayHistoryItem,
      label: 'Payment activity',
      after: after || null,
    })
  } catch (err) {
    console.error('Failed to fetch pay events page:', err)
    throw new Error(`Payment activity unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Paginated version - returns single page with cursor info
export type CashOutEventsPage = {
  items: CashOutEventHistoryItem[]
  hasNextPage: boolean
  endCursor: string | null
}

export async function fetchCashOutEventsPage(
  projectId: string,
  chainId: number,
  version: number = 6,
  limit: number = 15,
  after?: string | null
): Promise<CashOutEventsPage> {
  requireHistoryLimit(limit)
  const client = getClient(getNetworkOption(chainId))

  try {
    return await fetchHistoryPage<CashOutEventHistoryItem>({
      client,
      query: CASH_OUT_EVENTS_HISTORY_QUERY,
      variables: { projectId: parseInt(projectId), chainId, version, limit },
      field: 'cashOutTokensEvents',
      validate: validateCashOutHistoryItem,
      label: 'Cash-out activity',
      after: after || null,
    })
  } catch (err) {
    console.error('Failed to fetch cash out events page:', err)
    throw new Error(`Cash-out activity unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

const MAX_CASH_OUT_TAX_RATE = 10_000n

/**
 * Mirror JBCashOuts.cashOutFrom, including its integer rounding and sentinel cases.
 * This is display-only math; executable cash outs always use the terminal preview.
 */
export function calculateCashOutValue(
  surplus: bigint,
  totalSupply: bigint,
  cashOutCount: bigint,
  cashOutTaxRate: number,
): bigint {
  if (
    surplus <= 0n
    || totalSupply <= 0n
    || cashOutCount <= 0n
    || !Number.isInteger(cashOutTaxRate)
    || cashOutTaxRate < 0
    || cashOutTaxRate >= Number(MAX_CASH_OUT_TAX_RATE)
  ) return 0n

  if (cashOutCount >= totalSupply) return surplus

  const rate = BigInt(cashOutTaxRate)
  const base = (surplus * cashOutCount) / totalSupply
  if (rate === 0n) return base

  const curvedRate = (rate * cashOutCount) / totalSupply
  return (base * (MAX_CASH_OUT_TAX_RATE - rate + curvedRate)) / MAX_CASH_OUT_TAX_RATE
}

// The floor's asymptote: (1 − tax) × balance ÷ supply — the 1-token cash-out return without
// the own-share bonus. The live quote approaches it from above as supply grows; payments can
// only raise it, only payouts lower it.
export function calculateFloorMinPrice(
  balance: bigint,
  totalSupply: bigint,
  cashOutTaxRate: number, // 0-10000 basis points
  balanceDecimals: number = 18 // 18 for ETH, 6 for USDC
): number {
  if (
    balance <= 0n
    || totalSupply <= 0n
    || !Number.isInteger(cashOutTaxRate)
    || cashOutTaxRate < 0
    || cashOutTaxRate >= Number(MAX_CASH_OUT_TAX_RATE)
  ) return 0

  const oneToken = 10n ** 18n
  const rate = BigInt(cashOutTaxRate)
  const rawValue = (balance * oneToken * (MAX_CASH_OUT_TAX_RATE - rate)) / (totalSupply * MAX_CASH_OUT_TAX_RATE)
  return Number(rawValue) / Math.pow(10, balanceDecimals)
}

// Calculate the contract-equivalent baseline return for one 18-decimal project token.
export function calculateFloorPrice(
  balance: bigint,
  totalSupply: bigint,
  cashOutTaxRate: number, // 0-10000 basis points
  balanceDecimals: number = 18 // 18 for ETH, 6 for USDC
): number {
  const oneToken = 10n ** 18n
  const rawValue = calculateCashOutValue(balance, totalSupply, oneToken, cashOutTaxRate)
  return Number(rawValue) / Math.pow(10, balanceDecimals)
}

// Aggregate participants across chains by address
export interface AggregatedParticipant {
  address: string
  balance: bigint
  chains: number[]
  percentage: number
}

// Bendystraw rejects participant limits above 1,000. This matches website/'s
// defensive cap and is ample for a top-members view; the live total supply
// still accounts for owners beyond the returned page as the "Others" slice.
const PARTICIPANT_QUERY_LIMIT = 1_000

function parseParticipantPage(
  page: {
    totalCount: number
    items: Array<{ address?: string; wallet?: string; chainId?: number; balance: string; volumeUsd?: string }>
  } | null | undefined,
  expectedChainIds?: number | ReadonlySet<number>,
): Array<{ address: string; chainId: number; balance: string; volumeUsd: string }> {
  if (!page || !Number.isSafeInteger(page.totalCount) || page.totalCount < 0 || !Array.isArray(page.items)) {
    throw new Error('Member data is malformed')
  }
  if (page.items.length > page.totalCount) {
    throw new Error('Member data count is malformed')
  }

  const seen = new Set<string>()
  return page.items.map(item => {
    const address = item.address || item.wallet || ''
    const fallbackChainId = typeof expectedChainIds === 'number' ? expectedChainIds : undefined
    const chainId = item.chainId ?? fallbackChainId
    if (!isAddress(address) || !Number.isSafeInteger(chainId) || !chainId || chainId <= 0) {
      throw new Error('Member data contains an invalid account or chain')
    }
    const chainIsExpected = typeof expectedChainIds === 'number'
      ? chainId === expectedChainIds
      : expectedChainIds?.has(chainId) ?? true
    if (!chainIsExpected) {
      throw new Error(`Member data returned an unexpected chain ${chainId}`)
    }
    if (!isRawAmount(item.balance)) {
      throw new Error('Member data contains an invalid balance')
    }

    const key = `${chainId}:${address.toLowerCase()}`
    if (seen.has(key)) throw new Error('Member data contains duplicate balances')
    seen.add(key)
    // Pay events don't carry their source token, so volumeUsd is the only exact
    // denomination the table's "Paid" column can show. Absent/invalid → 0 (never inferred).
    const volumeUsd = isRawAmount(item.volumeUsd) ? (item.volumeUsd as string) : '0'
    return { address: address.toLowerCase(), chainId, balance: item.balance, volumeUsd }
  })
}

function aggregateParticipants(
  items: Array<{ address: string; chainId: number; balance: string }>,
  totalSupply: bigint,
  limit: number,
): { participants: AggregatedParticipant[]; totalSupply: bigint } {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Member limit is invalid')

  const aggregated = new Map<string, { balance: bigint; chains: Set<number> }>()
  for (const item of items) {
    const existing = aggregated.get(item.address) ?? { balance: 0n, chains: new Set<number>() }
    existing.balance += BigInt(item.balance)
    existing.chains.add(item.chainId)
    aggregated.set(item.address, existing)
  }

  const indexedBalance = [...aggregated.values()].reduce((sum, item) => sum + item.balance, 0n)
  if ((indexedBalance > 0n && totalSupply === 0n) || indexedBalance > totalSupply) {
    throw new Error('Member balances do not match the indexed token supply')
  }

  const participants = [...aggregated.entries()]
    .map(([address, data]) => ({
      address,
      balance: data.balance,
      chains: [...data.chains],
      percentage: totalSupply > 0n
        ? Number((data.balance * 10_000n) / totalSupply) / 100
        : 0,
    }))
    .sort((a, b) => (a.balance === b.balance ? 0 : b.balance > a.balance ? 1 : -1))
    .slice(0, limit)

  return { participants, totalSupply }
}

// Fetch participants from all connected chains and aggregate them. Match the
// versioned `chainId_in` query used by website/; Bendystraw's singular chainId
// participant filter returns an internal error for otherwise valid V6 projects.
export async function fetchMultiChainParticipants(
  connectedChains: Array<{ chainId: number; projectId: number }>,
  limit: number = 100,
): Promise<{ participants: AggregatedParticipant[]; totalSupply: bigint }> {
  if (connectedChains.length === 0) {
    throw new Error('Member data unavailable: no verified project scope')
  }

  const seenChains = new Set<number>()
  for (const mapping of connectedChains) {
    if (!Number.isSafeInteger(mapping.chainId) || mapping.chainId <= 0
      || !Number.isSafeInteger(mapping.projectId) || mapping.projectId <= 0
      || seenChains.has(mapping.chainId)) {
      throw new Error('Member data unavailable: connected project mapping is invalid')
    }
    seenChains.add(mapping.chainId)
  }

  try {
    const chainsByProject = new Map<number, number[]>()
    for (const { chainId, projectId } of connectedChains) {
      const chainIds = chainsByProject.get(projectId) ?? []
      chainIds.push(chainId)
      chainsByProject.set(projectId, chainIds)
    }

    const [participantGroupsResult, suppliesResult] = await Promise.allSettled([
      Promise.all([...chainsByProject.entries()].map(async ([projectId, chainIds]) => {
        const client = getClient(getNetworkOption(chainIds[0]))
        const data = await client.request<{
          participants: {
            totalCount: number
            items: Array<{ address: string; chainId: number; balance: string }>
          }
        }>(TOKEN_HOLDERS_QUERY, {
          projectId,
          chainIds,
          version: 6,
          limit: PARTICIPANT_QUERY_LIMIT,
        })
        return parseParticipantPage(data.participants, new Set(chainIds))
      })),
      Promise.all(connectedChains.map(async ({ chainId, projectId }) => {
        const supply = await fetchProjectTokenSupply(String(projectId), chainId)
        if (!isRawAmount(supply)) {
          throw new Error(`Project token supply is unavailable on chain ${chainId}`)
        }
        return BigInt(supply)
      })),
    ])

    if (suppliesResult.status === 'rejected') throw suppliesResult.reason
    const supplies = suppliesResult.value
    const totalSupply = supplies.reduce((sum, supply) => sum + supply, 0n)
    // Zero live supply proves that no account currently owns project tokens.
    // This also keeps an empty project usable if the indexer rejects its query.
    if (totalSupply === 0n) return aggregateParticipants([], totalSupply, limit)
    if (participantGroupsResult.status === 'rejected') throw participantGroupsResult.reason
    const items = participantGroupsResult.value.flat()
    return aggregateParticipants(items, totalSupply, limit)
  } catch (err) {
    throw new Error(`Member data unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Full owners table (website renderOwnersTable): EVERY indexed holder aggregated
// across the sucker group, carrying paid volume (USD) and the chains each holds on.
// Unlike fetchMultiChainParticipants (top-N donut feed), this keeps the whole list
// so the table can search + paginate client-side.
export interface HolderRow {
  address: string
  balance: bigint
  chains: number[]
  /** Paid-in volume in USD, scaled by 1e18 (bendystraw's volumeUsd denomination). */
  volumeUsd: bigint
}

export interface HoldersDistribution {
  holders: HolderRow[]
  /** Live cross-chain supply for share %s, or null when any chain's supply read failed. */
  totalSupply: bigint | null
  /** Sum of the returned holders' balances (donut denominator). */
  totalBalance: bigint
  /** True when the indexer reported more holder rows than were returned. */
  truncated: boolean
}

function aggregateHolders(
  items: Array<{ address: string; chainId: number; balance: string; volumeUsd: string }>,
): HolderRow[] {
  const byAddress = new Map<string, { balance: bigint; volumeUsd: bigint; chains: Set<number> }>()
  for (const item of items) {
    const existing = byAddress.get(item.address) ?? { balance: 0n, volumeUsd: 0n, chains: new Set<number>() }
    existing.balance += BigInt(item.balance)
    existing.volumeUsd += BigInt(item.volumeUsd)
    existing.chains.add(item.chainId)
    byAddress.set(item.address, existing)
  }
  return [...byAddress.entries()]
    .map(([address, d]) => ({
      address,
      balance: d.balance,
      volumeUsd: d.volumeUsd,
      chains: [...d.chains].sort((a, b) => a - b),
    }))
    .filter(h => h.balance > 0n)
    .sort((a, b) => (a.balance === b.balance ? 0 : b.balance > a.balance ? 1 : -1))
}

/**
 * Every indexed owner of a project across its sucker group, aggregated by
 * address with paid volume + per-holder chains. The live cross-chain supply is
 * read on-chain for share %s; any failed supply read leaves totalSupply null
 * so shares render as unknown rather than treating the indexed set as 100%.
 */
export async function fetchHoldersDistribution(
  connectedChains: Array<{ chainId: number; projectId: number }>,
): Promise<HoldersDistribution> {
  if (connectedChains.length === 0) throw new Error('Member data unavailable: no verified project scope')

  const chainsByProject = new Map<number, number[]>()
  const seenChains = new Set<number>()
  for (const { chainId, projectId } of connectedChains) {
    if (!Number.isSafeInteger(chainId) || chainId <= 0
      || !Number.isSafeInteger(projectId) || projectId <= 0
      || seenChains.has(chainId)) {
      throw new Error('Member data unavailable: connected project mapping is invalid')
    }
    seenChains.add(chainId)
    const list = chainsByProject.get(projectId) ?? []
    list.push(chainId)
    chainsByProject.set(projectId, list)
  }

  try {
    const pages = await Promise.all([...chainsByProject.entries()].map(async ([projectId, chainIds]) => {
      const client = getClient(getNetworkOption(chainIds[0]))
      const data = await client.request<{
        participants: {
          totalCount: number
          items: Array<{ address: string; chainId: number; balance: string; volumeUsd?: string }>
        }
      }>(TOKEN_HOLDERS_QUERY, { projectId, chainIds, version: 6, limit: PARTICIPANT_QUERY_LIMIT })
      return {
        items: parseParticipantPage(data.participants, new Set(chainIds)),
        totalCount: Number(data.participants.totalCount) || 0,
      }
    }))

    // Live supply per chain; a failure hides share %s (never treat indexed as 100%).
    const supplies = await Promise.all(connectedChains.map(async ({ chainId, projectId }) => {
      try {
        const supply = await fetchProjectTokenSupply(String(projectId), chainId)
        return isRawAmount(supply) ? BigInt(supply as string) : null
      } catch {
        return null
      }
    }))
    const totalSupply = supplies.some(s => s == null) ? null : supplies.reduce<bigint>((sum, s) => sum + (s as bigint), 0n)

    const items = pages.flatMap(p => p.items)
    const indexedTotal = pages.reduce((sum, p) => sum + p.totalCount, 0)
    const holders = aggregateHolders(items)
    const totalBalance = holders.reduce((sum, h) => sum + h.balance, 0n)
    return { holders, totalSupply, totalBalance, truncated: indexedTotal > items.length }
  } catch (err) {
    throw new Error(`Member data unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}

// Historical per-chain balance snapshot
export interface ProjectMoment {
  timestamp: number
  block: number
  balance: string
  volume: string
  volumeUsd: string
}

function validateProjectMoment(item: ProjectMoment): ProjectMoment {
  if (!isSafeTimestamp(item.timestamp) || !Number.isSafeInteger(item.block) || item.block < 0
    || !isRawAmount(item.balance) || !isRawAmount(item.volume) || !isRawAmount(item.volumeUsd)) {
    throw new Error('Project history contains malformed data')
  }
  return item
}

// Fetch historical per-chain balance snapshots
export async function fetchProjectMoments(
  projectId: string,
  chainId: number,
  version: number = 6,
  limit: number = 1000
): Promise<ProjectMoment[]> {
  requireHistoryLimit(limit)
  const client = getClient(getNetworkOption(chainId))

  try {
    return await fetchAllHistoryPages<ProjectMoment>({
      client,
      query: PROJECT_MOMENTS_QUERY,
      variables: { projectId: parseInt(projectId), chainId, version, limit },
      field: 'projectMoments',
      validate: validateProjectMoment,
      label: 'Project history',
      maxItems: 10_000,
    })
  } catch (err) {
    console.error('Failed to fetch project moments:', err)
    throw new Error(`Project history unavailable: ${err instanceof Error ? err.message : 'Unknown read failure'}`)
  }
}
