import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../utils/config.ts';
import { OMNICHAIN_CONTEXT, OMNICHAIN_TOOLS } from '../context/omnichain.ts';
import { handleOmnichainTool } from './omnichain.ts';
import { SYSTEM_PROMPT } from '@shared/prompts.ts';
import { recordToolUsage, recordInvocation } from './aiMetrics.ts';

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
const MAX_TOKENS_PER_WINDOW = 500_000; // Input + output tokens (increased for testing)

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

// Content block types for multimodal messages
export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface DocumentBlock {
  type: 'document';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export type ContentBlock = TextBlock | ImageBlock | DocumentBlock;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
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

// Import context management (lazy to avoid circular deps)
let _buildEnhancedSystemPrompt: typeof import('./contextManager.ts').buildEnhancedSystemPrompt | null = null;
async function getBuildEnhancedSystemPrompt() {
  if (!_buildEnhancedSystemPrompt) {
    const contextManager = await import('./contextManager.ts');
    _buildEnhancedSystemPrompt = contextManager.buildEnhancedSystemPrompt;
  }
  return _buildEnhancedSystemPrompt;
}

/**
 * Build the full system prompt including omnichain context (sync version for backward compat)
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
 * Build enhanced system prompt with context management
 * Use this for chat-aware AI invocations
 */
export async function buildEnhancedPrompt(options: {
  customSystem?: string;
  chatId?: string;
  userId?: string;
  includeOmnichain?: boolean;
}): Promise<{ systemPrompt: string; context: import('./contextManager.ts').OptimizedContext | null }> {
  const builder = await getBuildEnhancedSystemPrompt();
  return builder({
    basePrompt: options.customSystem || SYSTEM_PROMPT,
    chatId: options.chatId,
    userId: options.userId,
    includeOmnichain: options.includeOmnichain,
    omnichainContext: OMNICHAIN_CONTEXT,
  });
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

  // Build message request with multimodal support
  const messages = request.messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content
      : m.content.map(block => {
          if (block.type === 'text') {
            return { type: 'text' as const, text: block.text };
          } else if (block.type === 'image') {
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: block.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: block.source.data,
              },
            };
          } else {
            // Document block
            return {
              type: 'document' as const,
              source: {
                type: 'base64' as const,
                media_type: block.source.media_type as 'application/pdf',
                data: block.source.data,
              },
            };
          }
        }),
  })) as unknown as Anthropic.MessageParam[];

  const messageRequest: Anthropic.MessageCreateParams = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: request.maxTokens ?? 4096,
    messages,
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
      // Add space between text blocks if needed (when previous content ends without whitespace)
      if (textContent && !textContent.match(/[\s\n]$/) && !block.text.match(/^[\s\n]/)) {
        textContent += ' ';
      }
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
  request: ClaudeRequest,
  userApiKey?: string // Optional user-provided API key (BYOK)
): AsyncGenerator<{ type: 'text' | 'tool_use' | 'usage'; data: unknown }> {
  // Skip server rate limiting if user provides their own key
  if (!userApiKey) {
    const rateLimit = checkRateLimit(userId);
    if (!rateLimit.allowed) {
      throw new Error(
        `Rate limit exceeded. Remaining: ${rateLimit.remaining.requests} requests, ${rateLimit.remaining.tokens} tokens`
      );
    }
  }

  // Create client: per-request with user key, or singleton with server key
  const client = userApiKey
    ? new Anthropic({ apiKey: userApiKey })
    : getAnthropicClient();
  const includeOmnichain = request.includeOmnichainContext !== false;

  // Build system prompt with omnichain knowledge
  const systemPrompt = buildSystemPrompt(request.system, includeOmnichain);

  // Get all tools including omnichain tools
  const allTools = includeOmnichain
    ? getAllTools(request.tools)
    : request.tools ?? [];

  // Build message request with multimodal support
  // Using 'as unknown as Anthropic.MessageParam[]' to handle dynamic content types
  const messages = request.messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string'
      ? m.content
      : m.content.map((block: ContentBlock | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }) => {
          if (block.type === 'text') {
            return { type: 'text' as const, text: block.text };
          } else if (block.type === 'image') {
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: block.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: block.source.data,
              },
            };
          } else if (block.type === 'document') {
            return {
              type: 'document' as const,
              source: {
                type: 'base64' as const,
                media_type: block.source.media_type as 'application/pdf',
                data: block.source.data,
              },
            };
          } else if (block.type === 'tool_use') {
            // Tool use block (assistant message)
            return {
              type: 'tool_use' as const,
              id: block.id,
              name: block.name,
              input: block.input,
            };
          } else if (block.type === 'tool_result') {
            // Tool result block (user message)
            return {
              type: 'tool_result' as const,
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error,
            };
          } else {
            // Unknown block type, pass through
            return block;
          }
        }),
  })) as unknown as Anthropic.MessageParam[];

  const messageRequest: Anthropic.MessageCreateParams = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: request.maxTokens ?? 4096,
    messages,
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
  let stopReason = 'end_turn';

  // Track tool use blocks being built
  const toolUseBlocks: Map<number, { id: string; name: string; inputJson: string }> = new Map();
  let currentBlockIndex = -1;

  for await (const event of stream) {
    if (event.type === 'content_block_start') {
      currentBlockIndex = event.index;
      if (event.content_block.type === 'tool_use') {
        toolUseBlocks.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          inputJson: '',
        });
      }
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta;
      if ('text' in delta) {
        yield { type: 'text', data: delta.text };
      } else if ('partial_json' in delta) {
        // Accumulate JSON for tool use
        const block = toolUseBlocks.get(currentBlockIndex);
        if (block) {
          block.inputJson += delta.partial_json;
        }
      }
    } else if (event.type === 'content_block_stop') {
      // If this was a tool use block, yield the complete tool call
      const block = toolUseBlocks.get(event.index);
      if (block) {
        try {
          const input = JSON.parse(block.inputJson);
          yield {
            type: 'tool_use',
            data: { id: block.id, name: block.name, input },
          };
        } catch {
          // Invalid JSON, skip this tool call
        }
      }
    } else if (event.type === 'message_delta') {
      if (event.usage) {
        outputTokens = event.usage.output_tokens;
      }
      if (event.delta?.stop_reason) {
        stopReason = event.delta.stop_reason;
      }
    } else if (event.type === 'message_start') {
      if (event.message.usage) {
        inputTokens = event.message.usage.input_tokens;
      }
    }
  }

  // Only record usage for server key (not user's own key)
  const totalTokens = inputTokens + outputTokens;
  if (!userApiKey) {
    recordUsage(userId, totalTokens);
  }

  yield {
    type: 'usage',
    data: { inputTokens, outputTokens, stopReason },
  };
}

// ============================================================================
// Agentic Streaming with Tool Execution
// ============================================================================

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Stream messages with automatic tool execution loop.
 * Continues calling Claude until it stops requesting tools.
 */
export async function* streamMessageWithTools(
  userId: string,
  request: ClaudeRequest,
  userApiKey?: string,
  maxIterations = 10 // Safety limit to prevent infinite loops
): AsyncGenerator<{ type: 'text' | 'tool_use' | 'tool_result' | 'usage' | 'thinking'; data: unknown }> {
  const includeOmnichain = request.includeOmnichainContext !== false;

  // Build the conversation messages (mutable copy)
  const messages: ChatMessage[] = [...request.messages];

  // Metrics tracking
  const invocationStart = Date.now();
  const toolsUsed: string[] = [];
  let fullResponseContent = '';

  let iteration = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (iteration < maxIterations) {
    iteration++;

    // Collect this turn's response
    let textContent = '';
    const toolCalls: ToolCall[] = [];
    let stopReason = 'end_turn';

    // Stream Claude's response for this turn
    for await (const event of streamMessage(userId, { ...request, messages }, userApiKey)) {
      if (event.type === 'text') {
        const textChunk = event.data as string;
        textContent += textChunk;
        // Add space between text blocks if needed (when previous content ends without whitespace)
        if (fullResponseContent && !fullResponseContent.match(/[\s\n]$/) && !textChunk.match(/^[\s\n]/)) {
          fullResponseContent += ' ';
          yield { type: 'text', data: ' ' }; // Yield space to client
        }
        fullResponseContent += textChunk;
        yield event; // Pass through text tokens
      } else if (event.type === 'tool_use') {
        const toolCall = event.data as ToolCall;
        toolCalls.push(toolCall);
        toolsUsed.push(toolCall.name);
        // Notify that Claude is using a tool
        yield { type: 'thinking', data: `Using tool: ${toolCall.name}` };
      } else if (event.type === 'usage') {
        const usage = event.data as { inputTokens: number; outputTokens: number; stopReason: string };
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;
        stopReason = usage.stopReason;
      }
    }

    // If no tool calls, we're done
    if (toolCalls.length === 0 || stopReason !== 'tool_use') {
      break;
    }

    // Build the assistant message with text and tool use blocks
    const assistantContent: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = [];

    if (textContent) {
      assistantContent.push({ type: 'text', text: textContent });
    }

    for (const tc of toolCalls) {
      assistantContent.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: tc.input,
      });
    }

    // Add assistant's response to messages
    messages.push({
      role: 'assistant',
      content: assistantContent as unknown as string, // Type coercion for internal use
    });

    // Execute tools and collect results
    const toolResults: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      yield { type: 'tool_use', data: toolCall };

      const toolStart = Date.now();
      try {
        // Execute the tool
        const result = await handleOmnichainTool(toolCall.name, toolCall.input);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

        toolResults.push({
          tool_use_id: toolCall.id,
          content: resultStr,
        });

        // Record successful tool usage
        recordToolUsage({
          chatId: userId,
          toolName: toolCall.name,
          success: true,
          durationMs: Date.now() - toolStart,
        });

        yield { type: 'tool_result', data: { id: toolCall.id, name: toolCall.name, result: resultStr } };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Tool execution failed';
        toolResults.push({
          tool_use_id: toolCall.id,
          content: `Error: ${errorMsg}`,
          is_error: true,
        });

        // Record failed tool usage
        recordToolUsage({
          chatId: userId,
          toolName: toolCall.name,
          success: false,
          durationMs: Date.now() - toolStart,
          errorMessage: errorMsg,
        });

        yield { type: 'tool_result', data: { id: toolCall.id, name: toolCall.name, error: errorMsg } };
      }
    }

    // Add tool results as user message
    messages.push({
      role: 'user',
      content: toolResults.map(tr => ({
        type: 'tool_result',
        tool_use_id: tr.tool_use_id,
        content: tr.content,
        is_error: tr.is_error,
      })) as unknown as string, // Type coercion for internal use
    });
  }

  // Record the full invocation metrics
  const promptLength = request.messages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    return sum + JSON.stringify(m.content).length;
  }, 0);

  recordInvocation({
    chatId: userId,
    promptLength,
    responseLength: fullResponseContent.length,
    totalDurationMs: Date.now() - invocationStart,
    toolsUsed: [...new Set(toolsUsed)], // Dedupe tool names
    iterations: iteration,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    success: true,
  });

  // Yield final usage stats
  yield {
    type: 'usage',
    data: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
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
