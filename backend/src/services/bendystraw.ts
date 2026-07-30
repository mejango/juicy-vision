/**
 * Bendystraw GraphQL Client
 *
 * Server-side client for querying Bendystraw API.
 * Used for payment verification and project data.
 */

import { resolveBendystrawNetwork } from '@bananapus/nana-sdk-core';
import { getConfig } from '../utils/config.ts';
import { getProjectOwner } from './chainReader.ts';

// =============================================================================
// Types
// =============================================================================

export interface Participant {
  address: string;
  balance: string;
  volume: string;
  lastPaidTimestamp: number | null;
}

export interface ProjectMetadata {
  name?: string;
  description?: string;
  tagline?: string;
  projectTagline?: string;
  logoUri?: string;
  coverImageUri?: string;
  infoUri?: string;
  payDisclosure?: string;
  twitter?: string;
  farcaster?: string;
  discord?: string;
  telegram?: string;
  whatsapp?: string;
  domain?: string;
  tags?: string[];
  tokens?: unknown[];
  symbol?: string;
  ticker?: string;
  tokenSymbol?: string;
  storeCategories?: Record<string, string>;
  '721Categories'?: Record<string, string>;
  [key: string]: unknown;
}

export interface Project {
  id: string;
  projectId: number;
  chainId: number;
  owner: string;
  name?: string;
  handle?: string;
  logoUri?: string;
  description?: string;
  projectTagline?: string;
  coverImageUri?: string;
  infoUri?: string;
  payDisclosure?: string;
  twitter?: string;
  farcaster?: string;
  discord?: string;
  telegram?: string;
  domain?: string;
  tags?: string[];
  tokens?: unknown[];
  metadataUri?: string;
  metadata?: ProjectMetadata;
}

// =============================================================================
// GraphQL Queries
// =============================================================================

export const USER_PARTICIPANT_QUERY = `
  query UserParticipant($projectId: Int!, $chainId: Int!, $address: String!) {
    participants(
      where: {
        projectId: $projectId
        chainId: $chainId
        address: $address
        version: 6
      }
      limit: 1
    ) {
      totalCount
      items {
        address
        balance
        volume
        lastPaidTimestamp
      }
    }
  }
`;

const PROJECT_QUERY = `
  query Project($projectId: Float!, $chainId: Float!, $version: Float!) {
    project(projectId: $projectId, chainId: $chainId, version: $version) {
      id
      projectId
      chainId
      owner
      name
      handle
      logoUri
      metadataUri
      metadata
      description
      projectTagline
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
    }
  }
`;

// =============================================================================
// API Client
// =============================================================================

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export function bendystrawHostForChain(chainId: number): string {
  try {
    return resolveBendystrawNetwork({ chainId }) === 'mainnet'
      ? 'bendystraw.xyz'
      : 'testnet.bendystraw.xyz';
  } catch {
    throw new Error(`Unsupported Bendystraw chain: ${chainId}`);
  }
}

export function bendystrawEndpointForChain(apiKey: string, chainId: number): string {
  if (!apiKey) throw new Error('Bendystraw API is not configured');
  return `https://${bendystrawHostForChain(chainId)}/${apiKey}/graphql`;
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
] as const;

const STRING_METADATA_FIELDS = new Set([
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
]);

function normalizeCategoryMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string'
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeProjectMetadata(value: unknown): ProjectMetadata | undefined {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const metadata = { ...(parsed as Record<string, unknown>) };
    for (const field of STRING_METADATA_FIELDS) {
      if (metadata[field] != null && typeof metadata[field] !== 'string') delete metadata[field];
    }
    if (metadata.tags != null) {
      metadata.tags = Array.isArray(metadata.tags)
        ? metadata.tags.filter((tag): tag is string => typeof tag === 'string')
        : undefined;
    }
    if (metadata.tokens != null && !Array.isArray(metadata.tokens)) delete metadata.tokens;
    const storeCategories = normalizeCategoryMap(metadata.storeCategories);
    const tierCategories = normalizeCategoryMap(metadata['721Categories']);
    if (storeCategories) metadata.storeCategories = storeCategories;
    else delete metadata.storeCategories;
    if (tierCategories) metadata['721Categories'] = tierCategories;
    else delete metadata['721Categories'];
    return metadata as ProjectMetadata;
  } catch {
    return undefined;
  }
}

function indexedProjectMetadataFields(value: unknown): ProjectMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const selected: Record<string, unknown> = {};
  for (const field of INDEXED_PROJECT_METADATA_FIELDS) {
    if (record[field] != null) selected[field] = record[field];
  }
  return normalizeProjectMetadata(selected) ?? {};
}

function fillMissingMetadata(
  primary: ProjectMetadata | undefined,
  fallback: ProjectMetadata,
): ProjectMetadata {
  const merged = { ...(primary ?? {}) };
  for (const [field, value] of Object.entries(fallback)) {
    if (merged[field] == null && value != null) merged[field] = value;
  }
  return merged;
}

function hasMetadataValues(metadata: ProjectMetadata | undefined): boolean {
  return !!metadata && Object.values(metadata).some((value) => value != null);
}

const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://ipfs.io/ipfs/',
] as const;

function ipfsPath(uri: string): string | null {
  const value = uri.trim();
  if (/^ipfs:\/\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})(?:\/[^\s]*)?$/.test(value)) {
    return value.slice('ipfs://'.length);
  }
  if (/^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})(?:\/[^\s]*)?$/.test(value)) {
    return value;
  }
  return null;
}

async function fetchProjectMetadata(uri: string): Promise<ProjectMetadata | null> {
  const path = ipfsPath(uri);
  if (!path) return null;
  for (const gateway of IPFS_GATEWAYS) {
    try {
      const response = await fetch(`${gateway}${path}`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) continue;
      const metadata = normalizeProjectMetadata(await response.json());
      if (metadata) return metadata;
    } catch {
      // Try the next immutable gateway.
    }
  }
  return null;
}

export async function resolveProjectMetadataForDisplay(args: {
  indexedMetadata: unknown;
  indexedFields?: unknown;
  indexedMetadataUri?: string;
  loadOnchainMetadataUri?: () => Promise<string | undefined>;
  fetchMetadata?: (uri: string) => Promise<ProjectMetadata | null>;
}): Promise<{
  metadata?: ProjectMetadata;
  metadataUri?: string;
  source: 'bendystraw' | 'onchain' | 'unavailable';
}> {
  const loadMetadata = args.fetchMetadata ?? fetchProjectMetadata;
  const embedded = normalizeProjectMetadata(args.indexedMetadata);
  const indexedFields = indexedProjectMetadataFields(args.indexedFields);
  const indexed = fillMissingMetadata(embedded, indexedFields);
  const hasEmbeddedMetadata = !!embedded && Object.keys(embedded).length > 0;
  const hasIndexedMetadata = hasMetadataValues(indexed);

  if (hasEmbeddedMetadata) {
    return { metadata: indexed, metadataUri: args.indexedMetadataUri, source: 'bendystraw' };
  }
  if (args.indexedMetadataUri) {
    const fetched = await loadMetadata(args.indexedMetadataUri);
    if (fetched) {
      return {
        metadata: fillMissingMetadata(fetched, indexed),
        metadataUri: args.indexedMetadataUri,
        source: 'bendystraw',
      };
    }
  }
  if (args.loadOnchainMetadataUri) {
    const onchainUri = await args.loadOnchainMetadataUri();
    if (onchainUri) {
      const fetched = await loadMetadata(onchainUri);
      if (fetched) {
        return {
          metadata: fillMissingMetadata(indexed, fetched),
          metadataUri: args.indexedMetadataUri || onchainUri,
          source: hasIndexedMetadata ? 'bendystraw' : 'onchain',
        };
      }
    }
  }
  if (hasIndexedMetadata) {
    return {
      metadata: indexed,
      metadataUri: args.indexedMetadataUri,
      source: 'bendystraw',
    };
  }
  return { source: 'unavailable' };
}

async function queryBendystraw<T>(
  query: string,
  variables: Record<string, unknown>,
  chainId: number,
): Promise<T | null> {
  const config = getConfig();
  const endpoint = bendystrawEndpointForChain(config.bendystrawApiKey, chainId);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bendystraw query failed (${response.status}): ${errorText}`);
    }

    const result: GraphQLResponse<T> = await response.json();

    if (result.errors?.length) {
      throw new Error(
        `Bendystraw query failed: ${result.errors.map((error) => error.message).join('; ')}`,
      );
    }

    return result.data || null;
  } catch (error) {
    console.error('Bendystraw query error:', error);
    throw new Error(
      `Bendystraw data unavailable: ${
        error instanceof Error ? error.message : 'Unknown read failure'
      }`,
    );
  }
}

// =============================================================================
// Public Functions
// =============================================================================

/**
 * Check if an address has paid a specific project.
 * Returns the participant record if they have, null otherwise.
 */
export async function getParticipant(
  projectId: number,
  chainId: number,
  address: string,
): Promise<Participant | null> {
  const data = await queryBendystraw<{
    participants: { items: Participant[]; totalCount: number };
  }>(USER_PARTICIPANT_QUERY, {
    projectId,
    chainId,
    address: address.toLowerCase(),
  }, chainId);

  if (!data?.participants?.items?.length) {
    return null;
  }

  return data.participants.items[0];
}

/**
 * Check if an address has paid a project (volume > 0).
 */
export async function hasAddressPaidProject(
  projectId: number,
  chainId: number,
  address: string,
): Promise<boolean> {
  const participant = await getParticipant(projectId, chainId, address);

  if (!participant) {
    return false;
  }

  return participantHasPaymentVolume(participant.volume);
}

export function participantHasPaymentVolume(volume: unknown): boolean {
  if (typeof volume !== 'string' || !/^\d+$/.test(volume)) {
    throw new Error('Bendystraw participant payment volume is unavailable');
  }
  return BigInt(volume) > 0n;
}

/**
 * Get project info by ID.
 */
export async function getProject(
  projectId: number,
  chainId: number,
  version: number = 6,
): Promise<Project | null> {
  const data = await queryBendystraw<{
    project: (Omit<Project, 'metadata'> & { metadata?: unknown }) | null;
  }>(
    PROJECT_QUERY,
    { projectId, chainId, version },
    chainId,
  );

  const project = data?.project;
  if (!project) return null;
  const resolved = await resolveProjectMetadataForDisplay({
    indexedMetadata: project.metadata,
    indexedFields: project,
    indexedMetadataUri: project.metadataUri,
  });
  return {
    ...project,
    metadata: resolved.metadata,
    metadataUri: resolved.metadataUri ?? project.metadataUri,
    name: resolved.metadata?.name ?? project.name,
    description: resolved.metadata?.description ?? project.description,
    projectTagline: resolved.metadata?.projectTagline ?? project.projectTagline,
    logoUri: resolved.metadata?.logoUri ?? project.logoUri,
    coverImageUri: resolved.metadata?.coverImageUri ?? project.coverImageUri,
    infoUri: resolved.metadata?.infoUri ?? project.infoUri,
    payDisclosure: resolved.metadata?.payDisclosure ?? project.payDisclosure,
    twitter: resolved.metadata?.twitter ?? project.twitter,
    farcaster: resolved.metadata?.farcaster ?? project.farcaster,
    discord: resolved.metadata?.discord ?? project.discord,
    telegram: resolved.metadata?.telegram ?? project.telegram,
    domain: resolved.metadata?.domain ?? project.domain,
    tags: resolved.metadata?.tags ?? project.tags,
    tokens: resolved.metadata?.tokens ?? project.tokens,
  };
}

/**
 * Check if an address owns a project.
 */
export async function isProjectOwner(
  projectId: number,
  chainId: number,
  address: string,
): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const owner = await getProjectOwner(chainId, projectId);
  return owner.toLowerCase() === address.toLowerCase();
}
