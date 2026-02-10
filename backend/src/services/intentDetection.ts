/**
 * Intent Detection Service
 *
 * Hybrid semantic + keyword intent detection for routing user queries
 * to the appropriate knowledge domains and sub-modules.
 *
 * Architecture:
 * 1. Generate embedding for user query
 * 2. Query top-K similar intents from pgvector
 * 3. Combine with keyword matching for fallback/boost
 * 4. Return ranked domains + sub-modules with confidence scores
 */

import { query } from '../db/index.ts';
import {
  generateEmbedding,
  formatEmbeddingForPostgres,
  cosineSimilarity,
  type EmbeddingResult,
} from './embeddingService.ts';
import {
  TRANSACTION_SUB_MODULES,
  matchSubModulesByKeywords,
  INTENT_HINTS,
} from '@shared/prompts/index.ts';

// ============================================================================
// Types
// ============================================================================

export interface IntentMatch {
  domain: string;
  subModule: string | null;
  similarity: number;
  tokenCost: number;
  source: 'semantic' | 'keyword' | 'hybrid';
}

export interface SemanticIntentResult {
  // Top-level domain detection
  domains: {
    dataQuery: { matched: boolean; confidence: number };
    hookDeveloper: { matched: boolean; confidence: number };
    transaction: { matched: boolean; confidence: number };
  };

  // Granular sub-modules for transaction domain
  transactionSubModules: string[];

  // All matched intents with scores
  matches: IntentMatch[];

  // Method used for detection
  method: 'semantic' | 'keyword' | 'hybrid';

  // Average confidence across all matches
  overallConfidence: number;

  // Debug/analytics info
  metadata: {
    queryEmbeddingTokens?: number;
    topKResults?: number;
    keywordMatches?: string[];
    processingTimeMs: number;
  };
}

// ============================================================================
// Configuration
// ============================================================================

// Similarity thresholds for intent matching
const SIMILARITY_THRESHOLDS = {
  // Minimum similarity to consider a match
  minimum: 0.3,
  // High confidence threshold
  high: 0.6,
  // Medium confidence threshold
  medium: 0.45,
};

// Number of top results to fetch from pgvector
const TOP_K_RESULTS = 10;

// Weight for combining semantic and keyword scores
const SEMANTIC_WEIGHT = 0.7;
const KEYWORD_WEIGHT = 0.3;

// ============================================================================
// Database Queries
// ============================================================================

interface IntentEmbeddingRow {
  id: string;
  domain: string;
  sub_module: string | null;
  description: string;
  token_cost: number;
  similarity: number;
}

/**
 * Query top-K similar intents from pgvector
 */
async function queryTopKIntents(
  queryEmbedding: number[],
  k: number = TOP_K_RESULTS
): Promise<IntentEmbeddingRow[]> {
  const vectorStr = formatEmbeddingForPostgres(queryEmbedding);

  const results = await query<IntentEmbeddingRow>(
    `SELECT
       id,
       domain,
       sub_module,
       description,
       token_cost,
       1 - (embedding <=> $1::vector) as similarity
     FROM intent_embeddings
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorStr, k]
  );

  return results;
}

/**
 * Check if intent_embeddings table has data
 */
async function hasIntentEmbeddings(): Promise<boolean> {
  try {
    const result = await query<{ count: number }>(
      'SELECT COUNT(*) as count FROM intent_embeddings'
    );
    return result.length > 0 && result[0].count > 0;
  } catch {
    // Table doesn't exist or other error
    return false;
  }
}

// ============================================================================
// Keyword-Based Detection
// ============================================================================

interface KeywordResult {
  domains: {
    dataQuery: boolean;
    hookDeveloper: boolean;
    transaction: boolean;
  };
  subModules: string[];
  matchedKeywords: string[];
}

/**
 * Detect intents using keyword matching (fallback/boost)
 */
function detectIntentsWithKeywords(text: string): KeywordResult {
  const lowerText = text.toLowerCase();
  const matchedKeywords: string[] = [];

  // Check domain hints
  const checkHints = (hints: string[]): boolean => {
    for (const hint of hints) {
      if (lowerText.includes(hint.toLowerCase())) {
        matchedKeywords.push(hint);
        return true;
      }
    }
    return false;
  };

  const domains = {
    dataQuery: checkHints(INTENT_HINTS.dataQuery),
    hookDeveloper: checkHints(INTENT_HINTS.hookDeveloper),
    transaction: checkHints(INTENT_HINTS.transaction),
  };

  // Get sub-modules if transaction is detected
  const subModules = domains.transaction
    ? matchSubModulesByKeywords(lowerText)
    : [];

  return { domains, subModules, matchedKeywords };
}

// ============================================================================
// Hybrid Intent Detection
// ============================================================================

/**
 * Main entry point for semantic intent detection
 *
 * Combines:
 * 1. Semantic similarity from pgvector
 * 2. Keyword matching for fallback/boost
 *
 * Returns ranked intents with confidence scores
 */
export async function detectSemanticIntents(
  userMessage: string,
  options: {
    useKeywordFallback?: boolean;
    minConfidence?: number;
  } = {}
): Promise<SemanticIntentResult> {
  const startTime = Date.now();
  const useKeywordFallback = options.useKeywordFallback ?? true;
  const minConfidence = options.minConfidence ?? SIMILARITY_THRESHOLDS.minimum;

  // Initialize result
  const result: SemanticIntentResult = {
    domains: {
      dataQuery: { matched: false, confidence: 0 },
      hookDeveloper: { matched: false, confidence: 0 },
      transaction: { matched: false, confidence: 0 },
    },
    transactionSubModules: [],
    matches: [],
    method: 'keyword',
    overallConfidence: 0,
    metadata: {
      processingTimeMs: 0,
    },
  };

  // Check if we have embeddings in the database
  const hasEmbeddings = await hasIntentEmbeddings();

  if (hasEmbeddings) {
    try {
      // Generate embedding for user query
      const embeddingResult = await generateEmbedding(userMessage);
      result.metadata.queryEmbeddingTokens = embeddingResult.tokenCount;

      // Query top-K similar intents
      const semanticMatches = await queryTopKIntents(embeddingResult.embedding);
      result.metadata.topKResults = semanticMatches.length;

      // Process semantic matches
      for (const match of semanticMatches) {
        if (match.similarity >= minConfidence) {
          result.matches.push({
            domain: match.domain,
            subModule: match.sub_module,
            similarity: match.similarity,
            tokenCost: match.token_cost,
            source: 'semantic',
          });

          // Update domain confidence (take max for each domain)
          const domainKey = match.domain as keyof typeof result.domains;
          if (domainKey in result.domains) {
            const current = result.domains[domainKey];
            if (match.similarity > current.confidence) {
              result.domains[domainKey] = {
                matched: true,
                confidence: match.similarity,
              };
            }
          }

          // Track sub-modules for transaction domain
          if (match.domain === 'transaction' && match.sub_module) {
            if (!result.transactionSubModules.includes(match.sub_module)) {
              result.transactionSubModules.push(match.sub_module);
            }
          }
        }
      }

      if (result.matches.length > 0) {
        result.method = 'semantic';
      }
    } catch (error) {
      console.error('Semantic intent detection failed, falling back to keywords:', error);
      // Fall through to keyword detection
    }
  }

  // Keyword fallback/boost
  if (useKeywordFallback) {
    const keywordResult = detectIntentsWithKeywords(userMessage);
    result.metadata.keywordMatches = keywordResult.matchedKeywords;

    // Apply keyword matches
    for (const [domain, matched] of Object.entries(keywordResult.domains)) {
      if (matched) {
        const domainKey = domain as keyof typeof result.domains;
        const currentConfidence = result.domains[domainKey].confidence;

        // Boost existing semantic match or add keyword match
        if (currentConfidence > 0) {
          // Hybrid: boost semantic with keyword confirmation
          const boostedConfidence = Math.min(
            1,
            currentConfidence * SEMANTIC_WEIGHT + KEYWORD_WEIGHT
          );
          result.domains[domainKey] = {
            matched: true,
            confidence: boostedConfidence,
          };
          result.method = 'hybrid';
        } else {
          // Pure keyword match
          result.domains[domainKey] = {
            matched: true,
            confidence: KEYWORD_WEIGHT,
          };
        }
      }
    }

    // Add keyword-detected sub-modules
    for (const subModule of keywordResult.subModules) {
      if (!result.transactionSubModules.includes(subModule)) {
        result.transactionSubModules.push(subModule);

        // Add to matches if not already there
        const existing = result.matches.find(
          m => m.domain === 'transaction' && m.subModule === subModule
        );
        if (!existing) {
          const moduleInfo = TRANSACTION_SUB_MODULES.find(m => m.id === subModule);
          result.matches.push({
            domain: 'transaction',
            subModule,
            similarity: KEYWORD_WEIGHT,
            tokenCost: moduleInfo?.tokenEstimate || 0,
            source: 'keyword',
          });
        }
      }
    }
  }

  // Calculate overall confidence
  const matchedDomains = Object.values(result.domains).filter(d => d.matched);
  if (matchedDomains.length > 0) {
    result.overallConfidence =
      matchedDomains.reduce((sum, d) => sum + d.confidence, 0) / matchedDomains.length;
  }

  result.metadata.processingTimeMs = Date.now() - startTime;

  return result;
}

/**
 * Convert SemanticIntentResult to DetectedIntents format
 * for compatibility with existing contextManager
 */
export function toDetectedIntents(
  semanticResult: SemanticIntentResult
): {
  needsDataQuery: boolean;
  needsHookDeveloper: boolean;
  needsTransaction: boolean;
  transactionSubModules?: string[];
  reasons: string[];
} {
  const reasons: string[] = [];

  if (semanticResult.domains.dataQuery.matched) {
    reasons.push(
      `dataQuery (${semanticResult.method}, confidence: ${semanticResult.domains.dataQuery.confidence.toFixed(2)})`
    );
  }

  if (semanticResult.domains.hookDeveloper.matched) {
    reasons.push(
      `hookDeveloper (${semanticResult.method}, confidence: ${semanticResult.domains.hookDeveloper.confidence.toFixed(2)})`
    );
  }

  if (semanticResult.domains.transaction.matched) {
    reasons.push(
      `transaction (${semanticResult.method}, confidence: ${semanticResult.domains.transaction.confidence.toFixed(2)})`
    );
    if (semanticResult.transactionSubModules.length > 0) {
      reasons.push(`sub-modules: ${semanticResult.transactionSubModules.join(', ')}`);
    }
  }

  return {
    needsDataQuery: semanticResult.domains.dataQuery.matched,
    needsHookDeveloper: semanticResult.domains.hookDeveloper.matched,
    needsTransaction: semanticResult.domains.transaction.matched,
    transactionSubModules:
      semanticResult.transactionSubModules.length > 0
        ? semanticResult.transactionSubModules
        : undefined,
    reasons,
  };
}

// ============================================================================
// Seeding
// ============================================================================

/**
 * Seed intent embeddings for all domains and sub-modules
 * Call this after running the migration
 */
export async function seedIntentEmbeddings(): Promise<void> {
  const { generateBatchEmbeddings, formatEmbeddingForPostgres } = await import('./embeddingService.ts');
  const { SUB_MODULE_DESCRIPTIONS, SUB_MODULE_EXAMPLES } = await import('@shared/prompts/index.ts');
  const { execute } = await import('../db/index.ts');

  console.log('Seeding intent embeddings...');

  // Domain-level embeddings
  const domainEmbeddings = [
    {
      domain: 'dataQuery',
      description: 'Queries about project data, balances, activity, participants, and trending projects',
      examples: [
        'What is the balance of this project?',
        'Show me the top trending projects',
        'Who are the holders of this project?',
        'What is happening with NANA?',
      ],
      tokenCost: 2000,
    },
    {
      domain: 'hookDeveloper',
      description: 'Custom hook development, Solidity code, smart contract interfaces, and protocol internals',
      examples: [
        'How do I implement a custom pay hook?',
        'Show me the IJBPayHook interface',
        'Write a Solidity contract for...',
        'What is the data hook pattern?',
      ],
      tokenCost: 3000,
    },
    {
      domain: 'transaction',
      description: 'Creating, deploying, and managing Juicebox projects and transactions',
      examples: [
        'Deploy a new project',
        'Launch my crowdfund',
        'How do I withdraw funds?',
        'Create a revnet',
      ],
      tokenCost: 8000,
    },
  ];

  // Prepare texts for batch embedding
  const texts: string[] = [];
  const metadata: Array<{
    domain: string;
    subModule: string | null;
    description: string;
    examples: string[];
    tokenCost: number;
  }> = [];

  // Add domain-level texts
  for (const domain of domainEmbeddings) {
    // Combine description and examples for richer embedding
    const text = `${domain.description}\n\nExample queries:\n${domain.examples.join('\n')}`;
    texts.push(text);
    metadata.push({
      domain: domain.domain,
      subModule: null,
      description: domain.description,
      examples: domain.examples,
      tokenCost: domain.tokenCost,
    });
  }

  // Add sub-module texts
  for (const [subModuleId, description] of Object.entries(SUB_MODULE_DESCRIPTIONS)) {
    const examples = SUB_MODULE_EXAMPLES[subModuleId as keyof typeof SUB_MODULE_EXAMPLES] || [];
    const text = `${description}\n\nExample queries:\n${examples.join('\n')}`;
    texts.push(text);

    const moduleInfo = TRANSACTION_SUB_MODULES.find(m => m.id === subModuleId);
    metadata.push({
      domain: 'transaction',
      subModule: subModuleId,
      description,
      examples,
      tokenCost: moduleInfo?.tokenEstimate || 500,
    });
  }

  // Generate embeddings in batch
  console.log(`Generating embeddings for ${texts.length} intents...`);
  const { embeddings } = await generateBatchEmbeddings(texts);

  // Insert into database
  console.log('Inserting embeddings into database...');
  for (let i = 0; i < embeddings.length; i++) {
    const meta = metadata[i];
    const embedding = embeddings[i];
    const vectorStr = formatEmbeddingForPostgres(embedding.embedding);

    await execute(
      `INSERT INTO intent_embeddings (domain, sub_module, description, example_queries, embedding, token_cost)
       VALUES ($1, $2, $3, $4, $5::vector, $6)
       ON CONFLICT (domain, sub_module) DO UPDATE SET
         description = EXCLUDED.description,
         example_queries = EXCLUDED.example_queries,
         embedding = EXCLUDED.embedding,
         token_cost = EXCLUDED.token_cost,
         updated_at = NOW()`,
      [
        meta.domain,
        meta.subModule,
        meta.description,
        meta.examples,
        vectorStr,
        meta.tokenCost,
      ]
    );
  }

  console.log(`Seeded ${embeddings.length} intent embeddings`);
}

// ============================================================================
// Exports
// ============================================================================

export {
  SIMILARITY_THRESHOLDS,
  TOP_K_RESULTS,
  hasIntentEmbeddings,
};
