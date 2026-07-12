import { execute, queryOne } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';
import { bendystrawEndpointForChain, resolveProjectMetadataForDisplay } from './bendystraw.ts';
import { formatUnits } from 'viem';

// ============================================================================
// Trending Context Service
// ============================================================================
// Fetches trending projects from Bendystraw and caches them for injection
// into AI system prompts. Prevents hallucination about project stats.

const CACHE_KEY = 'trending_projects';
const CACHE_TTL_SECONDS = 3600; // 1 hour

interface TrendingProject {
  projectId: number;
  chainId: number;
  name: string | null;
  handle: string | null;
  metadataUri?: string;
  metadata?: unknown;
  description?: string;
  projectTagline?: string;
  logoUri?: string;
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
  volumeUsd: string | null;
  contributorsCount: number | null;
  trendingScore: string;
}

interface ProjectsResponse {
  projects: {
    items: TrendingProject[];
  };
}

const TRENDING_PROJECTS_QUERY = `
  query TrendingProjects($limit: Int) {
    projects(
      where: { version: 6 }
      limit: $limit
      orderBy: "trendingScore"
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
        tags
        tokens
        handle
        volumeUsd
        contributorsCount
        trendingScore
      }
    }
  }
`;

/**
 * Fetch trending projects from Bendystraw.
 */
async function fetchTrendingProjects(limit = 10): Promise<TrendingProject[]> {
  const config = getConfig();

  if (!config.bendystrawApiKey) {
    console.error('[TrendingContext] Bendystraw API key not configured');
    return [];
  }

  const endpoint = bendystrawEndpointForChain(
    config.bendystrawApiKey,
    config.isTestnet ? 11155111 : 1,
  );

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: TRENDING_PROJECTS_QUERY,
        variables: { limit },
      }),
    });

    if (!response.ok) {
      console.error('[TrendingContext] Fetch failed:', response.status);
      return [];
    }

    const result = await response.json();

    if (result.errors?.length) {
      console.error('[TrendingContext] GraphQL errors:', result.errors);
      return [];
    }

    const projects: TrendingProject[] = result.data?.projects?.items ?? [];
    return await Promise.all(projects.map(async (project) => {
      const resolved = await resolveProjectMetadataForDisplay({
        indexedMetadata: project.metadata,
        indexedFields: project,
        indexedMetadataUri: project.metadataUri,
      });
      return {
        ...project,
        name: resolved.metadata?.name ?? null,
      };
    }));
  } catch (error) {
    console.error('[TrendingContext] Error fetching trending projects:', error);
    return [];
  }
}

/**
 * Format trending projects as markdown for AI context.
 */
function formatAsContext(projects: TrendingProject[]): string {
  if (projects.length === 0) {
    return 'No trending project data available.';
  }

  const lines = projects.map((p, i) => {
    const name = p.name || p.handle || `Project ${p.projectId}`;
    let formattedVolume = 'volume unavailable';
    if (typeof p.volumeUsd === 'string' && /^\d+$/.test(p.volumeUsd)) {
      const volumeUsd = Number(formatUnits(BigInt(p.volumeUsd), 18));
      if (Number.isFinite(volumeUsd)) {
        formattedVolume = volumeUsd >= 1000
          ? `$${(volumeUsd / 1000).toFixed(1)}k volume`
          : `$${volumeUsd.toFixed(2)} volume`;
      }
    }
    const contributors = Number.isSafeInteger(p.contributorsCount) && p.contributorsCount! >= 0
      ? `${p.contributorsCount} contributors`
      : 'contributors unavailable';

    return `${
      i + 1
    }. **${name}** (ID: ${p.projectId}, Chain: ${p.chainId}) - ${formattedVolume}, ${contributors}`;
  });

  return lines.join('\n');
}

/**
 * Refresh trending context cache.
 * Called by cron job hourly.
 */
export async function refreshTrendingContext(): Promise<{
  success: boolean;
  projectCount: number;
}> {
  const projects = await fetchTrendingProjects(10);

  if (projects.length === 0) {
    console.warn('[TrendingContext] No projects fetched, keeping existing cache');
    return { success: false, projectCount: 0 };
  }

  const markdown = formatAsContext(projects);
  const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000);

  // Upsert cache entry
  await execute(
    `INSERT INTO context_cache (cache_key, content, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (cache_key) DO UPDATE
     SET content = $2, expires_at = $3, created_at = NOW()`,
    [CACHE_KEY, markdown, expiresAt],
  );

  console.log(`[TrendingContext] Cached ${projects.length} trending projects`);
  return { success: true, projectCount: projects.length };
}

/**
 * Get trending context if cache is valid.
 * Returns null if cache is expired or empty.
 */
export async function getTrendingContext(): Promise<string | null> {
  const row = await queryOne<{ content: string; expires_at: Date }>(
    `SELECT content, expires_at
     FROM context_cache
     WHERE cache_key = $1 AND expires_at > NOW()`,
    [CACHE_KEY],
  );

  return row?.content ?? null;
}

/**
 * Force refresh and return trending context.
 * Useful for initial load or manual refresh.
 */
export async function getOrRefreshTrendingContext(): Promise<string | null> {
  // Try cache first
  const cached = await getTrendingContext();
  if (cached) {
    return cached;
  }

  // Refresh and return
  const result = await refreshTrendingContext();
  if (result.success) {
    return getTrendingContext();
  }

  return null;
}
