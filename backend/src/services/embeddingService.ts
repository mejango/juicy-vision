/**
 * Embedding Service
 *
 * Wrapper for Claude/Voyage embedding API for semantic intent detection.
 * Provides caching to avoid redundant API calls and batch support for seeding.
 */

import { getConfig } from '../utils/config.ts';

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokenCount: number;
}

export interface BatchEmbeddingResult {
  embeddings: EmbeddingResult[];
  totalTokens: number;
}

// ============================================================================
// Cache
// ============================================================================

// In-memory cache for embeddings (LRU-style with max size)
const EMBEDDING_CACHE = new Map<string, EmbeddingResult>();
const CACHE_MAX_SIZE = 1000;

function getCacheKey(text: string, model: string): string {
  return `${model}:${text}`;
}

function cacheGet(text: string, model: string): EmbeddingResult | undefined {
  return EMBEDDING_CACHE.get(getCacheKey(text, model));
}

function cacheSet(text: string, model: string, result: EmbeddingResult): void {
  const key = getCacheKey(text, model);

  // Simple LRU: if at max size, remove oldest entry
  if (EMBEDDING_CACHE.size >= CACHE_MAX_SIZE) {
    const firstKey = EMBEDDING_CACHE.keys().next().value;
    if (firstKey) {
      EMBEDDING_CACHE.delete(firstKey);
    }
  }

  EMBEDDING_CACHE.set(key, result);
}

export function clearEmbeddingCache(): void {
  EMBEDDING_CACHE.clear();
}

// ============================================================================
// Embedding API
// ============================================================================

// Voyage AI embedding model (1024 dimensions, optimized for similarity)
const DEFAULT_EMBEDDING_MODEL = 'voyage-3-lite';
const EMBEDDING_DIMENSIONS = 1024;

/**
 * Generate embedding for a single text using Voyage AI API
 */
export async function generateEmbedding(
  text: string,
  options: {
    model?: string;
    useCache?: boolean;
  } = {}
): Promise<EmbeddingResult> {
  const config = getConfig();
  const model = options.model || DEFAULT_EMBEDDING_MODEL;
  const useCache = options.useCache ?? true;

  // Check cache first
  if (useCache) {
    const cached = cacheGet(text, model);
    if (cached) {
      return cached;
    }
  }

  const voyageApiKey = config.voyageApiKey;
  if (!voyageApiKey) {
    throw new Error('VOYAGE_API_KEY not configured');
  }

  try {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${voyageApiKey}`,
      },
      body: JSON.stringify({
        input: [text],
        model,
        input_type: 'query',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Voyage API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
      usage: { total_tokens: number };
    };

    const result: EmbeddingResult = {
      embedding: data.data[0].embedding,
      model,
      tokenCount: data.usage.total_tokens,
    };

    // Cache the result
    if (useCache) {
      cacheSet(text, model, result);
    }

    return result;
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts in batch
 * More efficient than calling generateEmbedding multiple times
 */
export async function generateBatchEmbeddings(
  texts: string[],
  options: {
    model?: string;
    useCache?: boolean;
  } = {}
): Promise<BatchEmbeddingResult> {
  const config = getConfig();
  const model = options.model || DEFAULT_EMBEDDING_MODEL;
  const useCache = options.useCache ?? true;

  // Check cache for each text
  const results: EmbeddingResult[] = new Array(texts.length);
  const uncachedTexts: string[] = [];
  const uncachedIndices: number[] = [];

  if (useCache) {
    for (let i = 0; i < texts.length; i++) {
      const cached = cacheGet(texts[i], model);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedTexts.push(texts[i]);
        uncachedIndices.push(i);
      }
    }
  } else {
    uncachedTexts.push(...texts);
    uncachedIndices.push(...texts.map((_, i) => i));
  }

  // If all cached, return immediately
  if (uncachedTexts.length === 0) {
    return {
      embeddings: results,
      totalTokens: 0,
    };
  }

  const voyageApiKey = config.voyageApiKey;
  if (!voyageApiKey) {
    throw new Error('VOYAGE_API_KEY not configured');
  }

  try {
    // Voyage AI supports up to 128 texts per batch
    const BATCH_SIZE = 128;
    let totalTokens = 0;

    for (let i = 0; i < uncachedTexts.length; i += BATCH_SIZE) {
      const batchTexts = uncachedTexts.slice(i, i + BATCH_SIZE);
      const batchIndices = uncachedIndices.slice(i, i + BATCH_SIZE);

      const response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${voyageApiKey}`,
        },
        body: JSON.stringify({
          input: batchTexts,
          model,
          input_type: 'document',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Voyage API error: ${response.status} - ${error}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[] }>;
        usage: { total_tokens: number };
      };

      totalTokens += data.usage.total_tokens;

      // Populate results and cache
      for (let j = 0; j < data.data.length; j++) {
        const result: EmbeddingResult = {
          embedding: data.data[j].embedding,
          model,
          tokenCount: Math.floor(data.usage.total_tokens / data.data.length),
        };

        results[batchIndices[j]] = result;

        if (useCache) {
          cacheSet(batchTexts[j], model, result);
        }
      }
    }

    return {
      embeddings: results,
      totalTokens,
    };
  } catch (error) {
    console.error('Failed to generate batch embeddings:', error);
    throw error;
  }
}

/**
 * Compute cosine similarity between two embedding vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimensions');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Format embedding for PostgreSQL vector type
 */
export function formatEmbeddingForPostgres(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Parse PostgreSQL vector string to number array
 */
export function parsePostgresEmbedding(vectorStr: string): number[] {
  // Remove brackets and split by comma
  const cleaned = vectorStr.replace(/[\[\]]/g, '');
  return cleaned.split(',').map(Number);
}

// ============================================================================
// Exports
// ============================================================================

export {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
};
