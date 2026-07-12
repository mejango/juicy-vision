/**
 * Omnichain/Sucker Service
 *
 * Implements tool handlers for cross-chain operations:
 * - Querying sucker pairs and bridge status
 * - Read-only project and cross-chain accounting lookup
 */

import { type Address, type Chain, createPublicClient, formatUnits, http, zeroAddress } from 'viem';
import { arbitrum, base, mainnet, optimism } from 'viem/chains';
import { CONTRACTS } from '@shared/chains.ts';
import { logger } from '../utils/logger.ts';
import { getConfig } from '../utils/config.ts';
import { SUCKER_REGISTRY_ABI, SUPPORTED_CHAINS } from '../context/omnichain.ts';
import { resolveRecognizedSuckerRegistry } from './projectTrust.ts';
import {
  bendystrawEndpointForChain,
  type ProjectMetadata,
  resolveProjectMetadataForDisplay,
} from './bendystraw.ts';
import {
  fetchCurrentRuleset,
  fetchProjectAccountingState,
  fetchProjectTokenBalance,
  getProjectOwner,
} from './chainReader.ts';

// ============================================================================
// Chain Configuration
// ============================================================================

const CHAINS: Record<number, { chain: Chain; rpcUrl: string }> = {
  1: { chain: mainnet, rpcUrl: 'https://eth.llamarpc.com' },
  10: { chain: optimism, rpcUrl: 'https://optimism.llamarpc.com' },
  8453: { chain: base, rpcUrl: 'https://base.llamarpc.com' },
  42161: { chain: arbitrum, rpcUrl: 'https://arbitrum.llamarpc.com' },
};

// MCP Documentation API
const MCP_API = 'https://docs.juicebox.money/api/mcp';

// ============================================================================
// Client Factory
// ============================================================================

function getClient(chainId: number) {
  const config = CHAINS[chainId];
  if (!config) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }
  return createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });
}

// ============================================================================
// Fetch with Timeout
// ============================================================================

const DEFAULT_TIMEOUT_MS = 10000; // 10 seconds

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface BendystrawResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function queryMainnetBendystraw<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const endpoint = bendystrawEndpointForChain(getConfig().bendystrawApiKey, 1);
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Bendystraw query failed (${response.status}): ${detail}`);
  }
  const result = await response.json() as BendystrawResponse<T>;
  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join('; '));
  }
  if (!result.data) throw new Error('Bendystraw returned no data');
  return result.data;
}

// ============================================================================
// Types
// ============================================================================

interface SuckerPair {
  local: Address;
  remote: Address;
  remoteChainId: number;
}

interface BridgeTransaction {
  id: string;
  chainId: number;
  peerChainId: number;
  sucker: Address;
  peer: Address;
  beneficiary: Address;
  projectTokenCount: string;
  terminalTokenAmount: string;
  token: Address;
  status: 'pending' | 'claimable' | 'claimed';
  index: number;
  root: string | null;
  createdAt: string;
}

interface CrossChainBalance {
  chainId: number;
  chainName: string;
  balance: string;
  formattedBalance: string;
}

const SUCKER_REGISTRY_MEMBERSHIP_ABI = [{
  name: 'isSuckerOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'addr', type: 'address' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

const SUCKER_IDENTITY_ABI = [
  {
    name: 'projectId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'DIRECTORY',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'PROJECTS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'REGISTRY',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'peer',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'peerChainId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const ROOTS = {
  directory: CONTRACTS.JBDirectory as Address,
  projects: CONTRACTS.JBProjects as Address,
};

const RECOGNIZED_CONTROLLER = CONTRACTS.JBController as Address;
const DIRECTORY_CONTROLLER_ABI = [{
  name: 'controllerOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;
const CONTROLLER_URI_ABI = [{
  name: 'uriOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'string' }],
}] as const;

async function readRecognizedControllerUri(
  chainId: number,
  projectId: number,
): Promise<string | undefined> {
  const client = getClient(chainId);
  const controller = await client.readContract({
    address: ROOTS.directory,
    abi: DIRECTORY_CONTROLLER_ABI,
    functionName: 'controllerOf',
    args: [BigInt(projectId)],
  });
  if (controller === zeroAddress) return undefined;
  if (controller.toLowerCase() !== RECOGNIZED_CONTROLLER.toLowerCase()) return undefined;
  const uri = await client.readContract({
    address: controller,
    abi: CONTROLLER_URI_ABI,
    functionName: 'uriOf',
    args: [BigInt(projectId)],
  });
  return uri || undefined;
}

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Get detailed project data including balance, supply, cash out tax rate
 */
export async function getProjectData(params: {
  projectId: number;
  chainId?: number;
}): Promise<{
  projectId: number;
  chainId: number;
  version: number;
  owner: Address;
  name: string | null;
  description: string | null;
  projectTagline: string | null;
  logoUri: string | null;
  metadataUri: string | null;
  metadata: ProjectMetadata | null;
  metadataSource: 'bendystraw' | 'onchain' | 'unavailable';
  indexedDataAvailable: boolean;
  indexedDataError: string | null;
  balances: Array<{
    terminal: Address;
    token: Address;
    decimals: number;
    currency: number;
    symbol: 'ETH' | 'USDC';
    balance: string;
    formattedBalance: string;
  }>;
  balancesAvailable: boolean;
  balanceError: string | null;
  tokenSymbol: string | null;
  totalSupply: string | null;
  formattedTotalSupply: string | null;
  // Cash out tax rate is a BONDING CURVE parameter (0-1), NOT a simple percentage
  // 0 = linear redemption (full proportional share)
  // Rates below 1 curve partial exits; 1 disables cash outs and returns zero
  cashOutTaxRate: number | null; // Raw value in basis points (0-10000)
  cashOutTaxRateDecimal: number | null; // Converted to 0-1 scale
  rulesetAvailable: boolean;
  rulesetError: string | null;
}> {
  const chainId = params.chainId ?? 1;
  const version = 6; // Juicebox V6 — the only supported protocol version
  if (!CHAINS[chainId]) throw new Error(`Unsupported chain: ${chainId}`);
  if (!Number.isSafeInteger(params.projectId) || params.projectId <= 0) {
    throw new Error('Project ID is invalid');
  }

  // Bendystraw supplies indexed display metadata. Current accounting and
  // ruleset values are read separately from the live project contracts.
  const query = `
    query GetProjectData($projectId: Float!, $chainId: Float!, $version: Float!) {
      project(projectId: $projectId, chainId: $chainId, version: $version) {
        projectId
        chainId
        version
        metadataUri
        metadata
        name
        description
        projectTagline
        logoUri
        coverImageUri
        infoUri
        payDisclosure
        twitter
        farcaster
        discord
        telegram
        domain
        tags
        tokens
        tokenSymbol
      }
    }
  `;

  try {
    let indexedProject: Record<string, unknown> | null = null;
    let indexedDataError: string | null = null;
    try {
      const indexed = await queryMainnetBendystraw<{ project: Record<string, unknown> | null }>(
        query,
        { projectId: params.projectId, chainId, version },
      );
      indexedProject = indexed.project;
    } catch (error) {
      indexedDataError = error instanceof Error ? error.message : 'Bendystraw read failed';
    }

    const [ownerResult, accountingResult, rulesetResult] = await Promise.allSettled([
      getProjectOwner(chainId, params.projectId),
      fetchProjectAccountingState(chainId, params.projectId),
      fetchCurrentRuleset(chainId, params.projectId),
    ]);
    if (ownerResult.status === 'rejected') {
      throw new Error(
        `Project ${params.projectId} could not be verified on chain ${chainId}: ${
          ownerResult.reason instanceof Error ? ownerResult.reason.message : 'ownerOf failed'
        }`,
      );
    }

    const metadata = await resolveProjectMetadataForDisplay({
      indexedMetadata: indexedProject?.metadata,
      indexedFields: indexedProject,
      indexedMetadataUri: typeof indexedProject?.metadataUri === 'string'
        ? indexedProject.metadataUri
        : undefined,
      loadOnchainMetadataUri: async () => {
        try {
          return await readRecognizedControllerUri(chainId, params.projectId);
        } catch {
          return undefined;
        }
      },
    });

    const accounting = accountingResult.status === 'fulfilled' ? accountingResult.value : null;
    const balanceError = accountingResult.status === 'rejected'
      ? accountingResult.reason instanceof Error
        ? accountingResult.reason.message
        : 'Live accounting read failed'
      : null;
    const ruleset = rulesetResult.status === 'fulfilled' ? rulesetResult.value : null;
    const rulesetError = rulesetResult.status === 'rejected'
      ? rulesetResult.reason instanceof Error
        ? rulesetResult.reason.message
        : 'Live ruleset read failed'
      : ruleset
      ? null
      : 'This project has no current ruleset';
    const cashOutTaxRate = ruleset?.metadata.cashOutTaxRate ?? null;
    const tokenSymbol = typeof indexedProject?.tokenSymbol === 'string'
      ? indexedProject.tokenSymbol
      : metadata.metadata?.tokenSymbol ?? metadata.metadata?.symbol ?? metadata.metadata?.ticker ??
        null;

    return {
      projectId: params.projectId,
      chainId,
      version,
      owner: ownerResult.value,
      name: metadata.metadata?.name ?? null,
      description: metadata.metadata?.description ?? null,
      projectTagline: metadata.metadata?.projectTagline ?? metadata.metadata?.tagline ?? null,
      logoUri: metadata.metadata?.logoUri ?? null,
      metadataUri: metadata.metadataUri ?? null,
      metadata: metadata.metadata ?? null,
      metadataSource: metadata.source,
      indexedDataAvailable: indexedProject !== null,
      indexedDataError,
      balances: accounting?.balances.map((entry) => ({
        terminal: entry.terminal,
        token: entry.token,
        decimals: entry.decimals,
        currency: entry.currency,
        symbol: entry.symbol,
        balance: entry.balance.toString(),
        formattedBalance: `${formatUnits(entry.balance, entry.decimals)} ${entry.symbol}`,
      })) ?? [],
      balancesAvailable: accounting !== null,
      balanceError,
      tokenSymbol,
      totalSupply: accounting?.totalSupply.toString() ?? null,
      formattedTotalSupply: accounting
        ? `${formatUnits(accounting.totalSupply, 18)} ${tokenSymbol ?? 'tokens'}`
        : null,
      cashOutTaxRate,
      cashOutTaxRateDecimal: cashOutTaxRate === null ? null : cashOutTaxRate / 10_000,
      rulesetAvailable: ruleset !== null,
      rulesetError,
    };
  } catch (error) {
    logger.error('Failed to get project data', error as Error, {
      projectId: params.projectId,
      chainId,
    });
    throw error;
  }
}

/**
 * Sanitize a string for safe use in GraphQL query interpolation
 * Removes/escapes characters that could be used for injection
 */
function sanitizeForGraphQL(input: string): string {
  // Remove quotes, backslashes, and control characters
  return [...input.replace(/[\\"]/g, '')]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, 100); // Limit length to prevent abuse
}

/**
 * Search for projects by name, description, or tags
 */
export async function searchProjects(params: {
  query: string;
  limit?: number;
}): Promise<{
  projects: Array<{
    projectId: number;
    chainId: number;
    name: string | null;
    description: string | null;
    projectTagline: string | null;
    logoUri: string | null;
    handle: string | null;
    tags: string[];
    volume: string | null;
    volumeAvailable: boolean;
    balance: null;
    balanceAvailable: false;
  }>;
  count: number;
}> {
  const limit = Math.min(params.limit ?? 10, 50);

  // Sanitize input to prevent GraphQL injection
  const searchText = sanitizeForGraphQL(params.query);

  if (!searchText) {
    return { projects: [], count: 0 };
  }

  // Generate case variations for case-insensitive search
  // Bendystraw's name_contains is case-sensitive, so we search multiple variations
  const caseVariations = [
    searchText,
    searchText.toLowerCase(),
    searchText.charAt(0).toUpperCase() + searchText.slice(1).toLowerCase(), // Title case
  ].filter((v, i, arr) => arr.indexOf(v) === i); // Deduplicate

  // Build OR conditions for all case variations (sanitized)
  const nameConditions = caseVariations.map((v) => `{ name_contains: "${v}" }`).join(', ');
  const descConditions = caseVariations.map((v) => `{ description_contains: "${v}" }`).join(', ');
  const tagConditions = caseVariations.map((v) => `{ tags_has: "${v}" }`).join(', ');

  // Use Bendystraw's project search with OR filters for multiple case variations
  const query = `
    query SearchProjects($limit: Int!) {
      projects(
        where: {
          version: 6,
          OR: [
            ${nameConditions},
            ${descConditions},
            ${tagConditions}
          ]
        }
        limit: $limit
        orderBy: "volumeUsd"
        orderDirection: "desc"
      ) {
        items {
          projectId
          chainId
          metadataUri
          metadata
          name
          description
          projectTagline
          logoUri
          coverImageUri
          infoUri
          payDisclosure
          twitter
          farcaster
          discord
          telegram
          domain
          handle
          tags
          tokens
          volume
          balance
        }
      }
    }
  `;

  try {
    const data = await queryMainnetBendystraw<{
      projects?: { items?: Array<Record<string, unknown>> };
    }>(query, { limit });
    const projects = data.projects?.items ?? [];
    const resolvedProjects = await Promise.all(projects.map(async (project) => {
      const metadata = await resolveProjectMetadataForDisplay({
        indexedMetadata: project.metadata,
        indexedFields: project,
        indexedMetadataUri: typeof project.metadataUri === 'string'
          ? project.metadataUri
          : undefined,
      });
      return { project, metadata: metadata.metadata };
    }));

    return {
      projects: resolvedProjects.map(({ project, metadata }) => ({
        projectId: Number(project.projectId),
        chainId: Number(project.chainId),
        name: metadata?.name ?? null,
        description: metadata?.description ?? null,
        projectTagline: metadata?.projectTagline ?? metadata?.tagline ?? null,
        logoUri: metadata?.logoUri ?? null,
        handle: typeof project.handle === 'string' ? project.handle : null,
        tags: metadata?.tags ?? [],
        volume: typeof project.volume === 'string' ? project.volume : null,
        volumeAvailable: typeof project.volume === 'string',
        // Project search is indexed discovery. Current balances require a
        // separate live project lookup and are never copied from the indexer.
        balance: null,
        balanceAvailable: false as const,
      })),
      count: resolvedProjects.length,
    };
  } catch (error) {
    logger.error('Failed to search projects', error as Error, { query: params.query });
    throw error;
  }
}

/**
 * Get all sucker pairs for a project (available bridge destinations)
 */
export async function getSuckerPairs(
  projectId: number,
  chainId: number = 1,
): Promise<SuckerPair[]> {
  const client = getClient(chainId);
  const projectIdBigInt = BigInt(projectId);
  const registryAddress = await resolveRecognizedSuckerRegistry({
    client,
    projectId: projectIdBigInt,
  });
  const pairs = await client.readContract({
    address: registryAddress,
    abi: SUCKER_REGISTRY_ABI,
    functionName: 'suckerPairsOf',
    args: [projectIdBigInt],
  });

  return Promise.all(pairs.map(async (pair) => {
    const remoteChainId = Number(pair.remoteChainId);
    const remote = `0x${pair.remote.slice(-40)}` as Address;
    if (
      pair.local.toLowerCase() === zeroAddress ||
      remote.toLowerCase() === zeroAddress ||
      !CHAINS[remoteChainId] ||
      remoteChainId === chainId
    ) {
      throw new Error(`Project bridge route not recognized: ${pair.local}`);
    }

    const [registered, suckerProjectId, directory, projects, registry, peer, peerChain] =
      await Promise.all([
        client.readContract({
          address: registryAddress,
          abi: SUCKER_REGISTRY_MEMBERSHIP_ABI,
          functionName: 'isSuckerOf',
          args: [projectIdBigInt, pair.local],
        }),
        client.readContract({
          address: pair.local,
          abi: SUCKER_IDENTITY_ABI,
          functionName: 'projectId',
        }),
        client.readContract({
          address: pair.local,
          abi: SUCKER_IDENTITY_ABI,
          functionName: 'DIRECTORY',
        }),
        client.readContract({
          address: pair.local,
          abi: SUCKER_IDENTITY_ABI,
          functionName: 'PROJECTS',
        }),
        client.readContract({
          address: pair.local,
          abi: SUCKER_IDENTITY_ABI,
          functionName: 'REGISTRY',
        }),
        client.readContract({
          address: pair.local,
          abi: SUCKER_IDENTITY_ABI,
          functionName: 'peer',
        }),
        client.readContract({
          address: pair.local,
          abi: SUCKER_IDENTITY_ABI,
          functionName: 'peerChainId',
        }),
      ]);

    if (
      !registered ||
      suckerProjectId !== projectIdBigInt ||
      directory.toLowerCase() !== ROOTS.directory.toLowerCase() ||
      projects.toLowerCase() !== ROOTS.projects.toLowerCase() ||
      registry.toLowerCase() !== registryAddress.toLowerCase() ||
      peer.toLowerCase() !== pair.remote.toLowerCase() ||
      peerChain !== pair.remoteChainId
    ) {
      throw new Error(`Project bridge contract not recognized: ${pair.local}`);
    }

    return { local: pair.local, remote, remoteChainId };
  }));
}

/**
 * Get bridge transactions for a sucker group
 */
export async function getBridgeTransactions(params: {
  suckerGroupId: string;
  status?: 'pending' | 'claimable' | 'claimed';
  beneficiary?: string;
}): Promise<BridgeTransaction[]> {
  const query = `
    query SuckerTransactions($suckerGroupId: String!, $status: suckerTransactionStatus, $beneficiary: String) {
      suckerTransactions(
        where: { suckerGroupId: $suckerGroupId, status: $status, beneficiary: $beneficiary, version: 6 }
        orderBy: "createdAt"
        orderDirection: "desc"
        limit: 100
      ) {
        items {
          id
          chainId
          peerChainId
          sucker
          peer
          beneficiary
          projectTokenCount
          terminalTokenAmount
          token
          status
          index
          root
          createdAt
        }
      }
    }
  `;

  try {
    const data = await queryMainnetBendystraw<{
      suckerTransactions?: { items?: BridgeTransaction[] };
    }>(query, {
      suckerGroupId: params.suckerGroupId,
      status: params.status,
      beneficiary: params.beneficiary,
    });
    if (!data.suckerTransactions?.items) {
      throw new Error('Bendystraw sucker transaction data is unavailable');
    }
    return data.suckerTransactions.items;
  } catch (error) {
    logger.error('Failed to fetch bridge transactions', error as Error, params);
    throw error;
  }
}

/**
 * Get cross-chain token balance for a user
 */
export async function getCrossChainBalance(params: {
  suckerGroupId: string;
  userAddress: Address;
}): Promise<{
  balances: CrossChainBalance[];
  totalBalance: string;
  formattedTotal: string;
}> {
  // First get all projects in the sucker group
  const query = `
    query SuckerGroup($id: String!) {
      suckerGroup(id: $id) {
        projects {
          items {
            chainId
            projectId
          }
        }
      }
    }
  `;

  const data = await queryMainnetBendystraw<{
    suckerGroup?: { projects?: { items?: Array<{ chainId: number; projectId: number }> } };
  }>(query, { id: params.suckerGroupId });
  const projects = data.suckerGroup?.projects?.items;
  if (!projects?.length) throw new Error('Sucker group project mapping is unavailable');

  // Bendystraw supplies only the group mapping. Every balance is read from the
  // live JBTokens dependency derived through that project's controller.
  const balancePromises = projects.map(
    async (project) => {
      if (!CHAINS[project.chainId]) {
        throw new Error(`Unsupported sucker-group chain: ${project.chainId}`);
      }
      if (!Number.isSafeInteger(project.projectId) || project.projectId <= 0) {
        throw new Error('Sucker group contains an invalid project ID');
      }
      const balance = await fetchProjectTokenBalance(
        project.chainId,
        project.projectId,
        params.userAddress,
      );
      const chainInfo = SUPPORTED_CHAINS[project.chainId as keyof typeof SUPPORTED_CHAINS];
      return {
        chainId: project.chainId,
        chainName: chainInfo?.name ?? `Chain ${project.chainId}`,
        balance: balance.toString(),
        formattedBalance: formatUnits(balance, 18),
      };
    },
  );

  const balances: CrossChainBalance[] = await Promise.all(balancePromises);

  const totalBalance = balances.reduce((sum, b) => sum + BigInt(b.balance), 0n);

  return {
    balances,
    totalBalance: totalBalance.toString(),
    formattedTotal: formatUnits(totalBalance, 18),
  };
}

// ============================================================================
// MCP Documentation API Client
// ============================================================================

/**
 * Search Juicebox documentation
 */
export async function searchDocs(params: {
  query: string;
  category?: string;
  limit?: number;
}): Promise<unknown> {
  const response = await fetchWithTimeout(`${MCP_API}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: params.query,
      category: params.category ?? 'all',
      // Juicebox V6 is the only supported protocol version
      version: 'v6',
      limit: params.limit ?? 10,
    }),
  });

  if (!response.ok) {
    throw new Error(`MCP search failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Get a specific documentation page
 */
export async function getDoc(params: { path: string }): Promise<unknown> {
  const response = await fetchWithTimeout(`${MCP_API}/get-doc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: params.path }),
  });

  if (!response.ok) {
    throw new Error(`MCP get-doc failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Get contract addresses
 */
export async function getContracts(params: {
  contract?: string;
  chainId?: string;
  category?: string;
}): Promise<unknown> {
  const queryParams = new URLSearchParams();
  if (params.contract) queryParams.set('contract', params.contract);
  if (params.chainId) queryParams.set('chainId', params.chainId);
  if (params.category) queryParams.set('category', params.category);

  const url = queryParams.toString()
    ? `${MCP_API}/contracts?${queryParams}`
    : `${MCP_API}/contracts`;

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`MCP contracts failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Get integration patterns
 */
export async function getPatterns(params: {
  projectType?: string;
}): Promise<unknown> {
  const url = params.projectType
    ? `${MCP_API}/patterns?projectType=${params.projectType}`
    : `${MCP_API}/patterns`;

  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`MCP patterns failed: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// IPFS Pinning
// ============================================================================

interface PinToIpfsParams {
  content: Record<string, unknown>;
  name?: string;
}

interface PinToIpfsResult {
  cid: string;
  uri: string;
  size?: number;
}

async function pinToIpfs(params: PinToIpfsParams): Promise<PinToIpfsResult> {
  const config = getConfig();
  const apiUrl = config.ipfsApiUrl ?? 'https://api.pinata.cloud';
  const apiKey = config.ipfsApiKey;
  const apiSecret = config.ipfsApiSecret;

  if (!apiKey || !apiSecret) {
    throw new Error(
      'IPFS pinning not configured. Set IPFS_API_KEY and IPFS_API_SECRET in environment.',
    );
  }

  const body = {
    pinataContent: params.content,
    pinataMetadata: params.name ? { name: params.name } : undefined,
  };

  const response = await fetchWithTimeout(`${apiUrl}/pinning/pinJSONToIPFS`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'pinata_api_key': apiKey,
      'pinata_secret_api_key': apiSecret,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`IPFS pin failed: ${error}`);
  }

  const result = await response.json();
  const cid = result.IpfsHash;

  logger.info(`[IPFS] Pinned content to CID: ${cid}`);

  return {
    cid,
    uri: `ipfs://${cid}`,
    size: result.PinSize,
  };
}

// ============================================================================
// Tool Handler Router
// ============================================================================

export function handleOmnichainTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'get_project_data':
      return getProjectData({
        projectId: input.projectId as number,
        chainId: input.chainId as number | undefined,
      });

    case 'search_projects':
      return searchProjects({
        query: input.query as string,
        limit: input.limit as number | undefined,
      });

    case 'get_sucker_pairs':
      return getSuckerPairs(
        input.projectId as number,
        (input.chainId as number) ?? 1,
      );

    case 'get_bridge_transactions':
      return getBridgeTransactions({
        suckerGroupId: input.suckerGroupId as string,
        status: input.status as 'pending' | 'claimable' | 'claimed' | undefined,
        beneficiary: input.beneficiary as string | undefined,
      });

    case 'get_cross_chain_balance':
      return getCrossChainBalance({
        suckerGroupId: input.suckerGroupId as string,
        userAddress: input.userAddress as Address,
      });

    // === MCP Documentation Tools ===
    case 'search_docs':
      return searchDocs({
        query: input.query as string,
        category: input.category as string | undefined,
        limit: input.limit as number | undefined,
      });

    case 'get_doc':
      return getDoc({
        path: input.path as string,
      });

    case 'get_contracts':
      return getContracts({
        contract: input.contract as string | undefined,
        chainId: input.chainId as string | undefined,
        category: input.category as string | undefined,
      });

    case 'get_patterns':
      return getPatterns({
        projectType: input.projectType as string | undefined,
      });

    case 'pin_to_ipfs':
      return pinToIpfs({
        content: input.content as Record<string, unknown>,
        name: input.name as string | undefined,
      });

    default:
      throw new Error(`Unknown omnichain tool: ${toolName}`);
  }
}
