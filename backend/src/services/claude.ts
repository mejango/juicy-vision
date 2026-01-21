import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../utils/config.ts';
import { OMNICHAIN_CONTEXT, OMNICHAIN_TOOLS } from '../context/omnichain.ts';
import { handleOmnichainTool } from './omnichain.ts';
import { SYSTEM_PROMPT } from '@shared/prompts.ts';

// ============================================================================
// Rate Limiting (Simple in-memory implementation)
// ============================================================================

interface RateLimitEntry {
  tokens: number;
  requests: number;
  windowStart: number;
}

const rateLimits = new Map<string, RateLimitEntry>();

// Rate limit config (per user, per hour)
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 100;
const MAX_TOKENS_PER_WINDOW = 100_000; // Input + output tokens

function getRateLimitKey(userId: string): string {
  return `rate:${userId}`;
}

function checkRateLimit(userId: string): { allowed: boolean; remaining: { requests: number; tokens: number } } {
  const key = getRateLimitKey(userId);
  const now = Date.now();

  let entry = rateLimits.get(key);

  // Reset if window expired
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { tokens: 0, requests: 0, windowStart: now };
    rateLimits.set(key, entry);
  }

  const remainingRequests = MAX_REQUESTS_PER_WINDOW - entry.requests;
  const remainingTokens = MAX_TOKENS_PER_WINDOW - entry.tokens;

  return {
    allowed: remainingRequests > 0 && remainingTokens > 0,
    remaining: {
      requests: Math.max(0, remainingRequests),
      tokens: Math.max(0, remainingTokens),
    },
  };
}

function recordUsage(userId: string, tokensUsed: number): void {
  const key = getRateLimitKey(userId);
  const entry = rateLimits.get(key);

  if (entry) {
    entry.requests++;
    entry.tokens += tokensUsed;
  }
}

// Cleanup old rate limit entries periodically
export function cleanupRateLimits(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimits.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimits.delete(key);
    }
  }
}

// ============================================================================
// Claude Client
// ============================================================================

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const config = getConfig();
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }
    anthropicClient = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
  }
  return anthropicClient;
}

// ============================================================================
// Message Types
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ClaudeRequest {
  messages: ChatMessage[];
  system?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  includeOmnichainContext?: boolean; // Default true - adds JB omnichain knowledge
}

// System prompt imported from @shared/prompts.ts (single source of truth)
// To edit the prompt, update /shared/prompts.ts

/**
 * Build the full system prompt including omnichain context
 */
function buildSystemPrompt(customSystem?: string, includeOmnichain = true): string {
  const parts: string[] = [];

  // Start with default or custom system
  parts.push(customSystem || SYSTEM_PROMPT);

  // Add omnichain knowledge if enabled
  if (includeOmnichain) {
    parts.push('\n\n---\n\n# Knowledge Base\n');
    parts.push(OMNICHAIN_CONTEXT);
  }

  return parts.join('');
}

/**
 * Get all tools including omnichain tools
 */
function getAllTools(customTools?: ToolDefinition[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [...(OMNICHAIN_TOOLS as ToolDefinition[])];

  if (customTools) {
    tools.push(...customTools);
  }

  return tools;
}

export interface ClaudeResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: string;
}

// ============================================================================
// API Methods
// ============================================================================

export async function sendMessage(
  userId: string,
  request: ClaudeRequest
): Promise<ClaudeResponse> {
  // Check rate limit
  const rateLimit = checkRateLimit(userId);
  if (!rateLimit.allowed) {
    throw new Error(
      `Rate limit exceeded. Remaining: ${rateLimit.remaining.requests} requests, ${rateLimit.remaining.tokens} tokens`
    );
  }

  const client = getAnthropicClient();
  const includeOmnichain = request.includeOmnichainContext !== false;

  // Build system prompt with omnichain knowledge
  const systemPrompt = buildSystemPrompt(request.system, includeOmnichain);

  // Get all tools including omnichain tools
  const allTools = includeOmnichain
    ? getAllTools(request.tools)
    : request.tools ?? [];

  // Build message request
  const messageRequest: Anthropic.MessageCreateParams = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: request.maxTokens ?? 4096,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    system: systemPrompt,
  };

  if (allTools.length > 0) {
    messageRequest.tools = allTools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  if (request.temperature !== undefined) {
    messageRequest.temperature = request.temperature;
  }

  // Make API call
  const response = await client.messages.create(messageRequest);

  // Record usage
  const totalTokens = response.usage.input_tokens + response.usage.output_tokens;
  recordUsage(userId, totalTokens);

  // Extract content
  let textContent = '';
  const toolCalls: ClaudeResponse['toolCalls'] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  return {
    content: textContent,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    stopReason: response.stop_reason ?? 'end_turn',
  };
}

// Streaming version (for real-time responses)
export async function* streamMessage(
  userId: string,
  request: ClaudeRequest
): AsyncGenerator<{ type: 'text' | 'tool_use' | 'usage'; data: unknown }> {
  // Check rate limit
  const rateLimit = checkRateLimit(userId);
  if (!rateLimit.allowed) {
    throw new Error(
      `Rate limit exceeded. Remaining: ${rateLimit.remaining.requests} requests, ${rateLimit.remaining.tokens} tokens`
    );
  }

  const client = getAnthropicClient();
  const includeOmnichain = request.includeOmnichainContext !== false;

  // Build system prompt with omnichain knowledge
  const systemPrompt = buildSystemPrompt(request.system, includeOmnichain);

  // Get all tools including omnichain tools
  const allTools = includeOmnichain
    ? getAllTools(request.tools)
    : request.tools ?? [];

  // Build message request
  const messageRequest: Anthropic.MessageCreateParams = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: request.maxTokens ?? 4096,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    system: systemPrompt,
    stream: true,
  };

  if (allTools.length > 0) {
    messageRequest.tools = allTools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  }

  if (request.temperature !== undefined) {
    messageRequest.temperature = request.temperature;
  }

  // Stream the response
  const stream = client.messages.stream(messageRequest);

  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === 'content_block_delta') {
      const delta = event.delta;
      if ('text' in delta) {
        yield { type: 'text', data: delta.text };
      } else if ('partial_json' in delta) {
        yield { type: 'tool_use', data: delta.partial_json };
      }
    } else if (event.type === 'message_delta') {
      if (event.usage) {
        outputTokens = event.usage.output_tokens;
      }
    } else if (event.type === 'message_start') {
      if (event.message.usage) {
        inputTokens = event.message.usage.input_tokens;
      }
    }
  }

  // Record final usage
  const totalTokens = inputTokens + outputTokens;
  recordUsage(userId, totalTokens);

  yield {
    type: 'usage',
    data: { inputTokens, outputTokens },
  };
}

// ============================================================================
// Usage Stats
// ============================================================================

export function getUserUsageStats(userId: string): {
  windowStart: Date;
  requests: number;
  tokens: number;
  remaining: { requests: number; tokens: number };
} {
  const key = getRateLimitKey(userId);
  const entry = rateLimits.get(key);

  if (!entry) {
    return {
      windowStart: new Date(),
      requests: 0,
      tokens: 0,
      remaining: {
        requests: MAX_REQUESTS_PER_WINDOW,
        tokens: MAX_TOKENS_PER_WINDOW,
      },
    };
  }

  return {
    windowStart: new Date(entry.windowStart),
    requests: entry.requests,
    tokens: entry.tokens,
    remaining: {
      requests: Math.max(0, MAX_REQUESTS_PER_WINDOW - entry.requests),
      tokens: Math.max(0, MAX_TOKENS_PER_WINDOW - entry.tokens),
    },
  };
}

// Re-export omnichain tool handler for use in routes
export { handleOmnichainTool } from './omnichain.ts';

// Export context and tools for frontend
export { OMNICHAIN_CONTEXT, OMNICHAIN_TOOLS } from '../context/omnichain.ts';
