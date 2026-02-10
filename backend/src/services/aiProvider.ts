/**
 * AI Provider Abstraction
 *
 * Switches between AI providers (Anthropic Claude, Moonshot Kimi) based on config.
 * Provides a unified interface for all AI operations.
 */

import { getConfig } from '../utils/config.ts';
import * as claude from './claude.ts';
import * as moonshot from './moonshot.ts';

// Re-export types from claude.ts (they're shared)
export type {
  ChatMessage,
  ToolDefinition,
  ClaudeRequest,
  ClaudeResponse,
  ToolCall,
  ToolResult,
  ContentBlock,
  TextBlock,
  ImageBlock,
  DocumentBlock,
} from './claude.ts';

// Get the current provider based on config
function getProvider() {
  const config = getConfig();
  return config.aiProvider === 'moonshot' ? moonshot : claude;
}

/**
 * Send a message to the AI and get a response
 */
export async function sendMessage(
  userId: string,
  request: claude.ClaudeRequest
): Promise<claude.ClaudeResponse> {
  const provider = getProvider();
  return provider.sendMessage(userId, request);
}

/**
 * Stream a message response from the AI
 */
export async function* streamMessage(
  userId: string,
  request: claude.ClaudeRequest,
  userApiKey?: string
): AsyncGenerator<{ type: 'text' | 'tool_use' | 'usage'; data: unknown }> {
  const provider = getProvider();
  yield* provider.streamMessage(userId, request, userApiKey);
}

/**
 * Stream a message with automatic tool execution loop
 */
export async function* streamMessageWithTools(
  userId: string,
  request: claude.ClaudeRequest,
  userApiKey?: string,
  maxIterations = 10
): AsyncGenerator<{ type: 'text' | 'tool_use' | 'tool_result' | 'usage' | 'thinking'; data: unknown }> {
  const provider = getProvider();
  yield* provider.streamMessageWithTools(userId, request, userApiKey, maxIterations);
}

/**
 * Get usage stats for a user
 */
export function getUserUsageStats(userId: string) {
  const provider = getProvider();
  return provider.getUserUsageStats(userId);
}

/**
 * Build enhanced system prompt with context management
 * (Only available in Claude provider currently)
 *
 * New options for Phase 1 & 2:
 * - useSubModules: Enable granular sub-module loading (saves ~40% tokens)
 * - useSemanticDetection: Enable semantic intent detection via embeddings
 */
export async function buildEnhancedPrompt(options: {
  customSystem?: string;
  chatId?: string;
  userId?: string;
  includeOmnichain?: boolean;
  useSemanticDetection?: boolean;  // Enable semantic intent detection (Phase 2)
  useSubModules?: boolean;  // Enable granular sub-module loading (Phase 1)
}): Promise<{
  systemPrompt: string;
  context: import('./contextManager.ts').OptimizedContext | null;
  intents?: import('./contextManager.ts').DetectedIntents;
  semanticResult?: import('./intentDetection.ts').SemanticIntentResult;
}> {
  // Use Claude's implementation as it has context management
  return claude.buildEnhancedPrompt(options);
}

/**
 * Get the current provider name
 */
export function getCurrentProvider(): 'anthropic' | 'moonshot' {
  const config = getConfig();
  return config.aiProvider;
}

/**
 * Re-export omnichain tools and context
 */
export { OMNICHAIN_CONTEXT, OMNICHAIN_TOOLS, handleOmnichainTool } from './claude.ts';

/**
 * Cleanup rate limits (shared across providers)
 */
export { cleanupRateLimits } from './claude.ts';
