import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../utils/config.ts';
import { OMNICHAIN_CONTEXT, OMNICHAIN_TOOLS } from '../context/omnichain.ts';
import { handleOmnichainTool } from './omnichain.ts';
import { SYSTEM_PROMPT } from '@shared/prompts.ts';
import { recordToolUsage, recordInvocation } from './aiMetrics.ts';

// ============================================================================
// Rate Limiting (PostgreSQL-based - see rateLimit.ts)
// ============================================================================

import { checkRateLimit as checkDbRateLimit, RATE_LIMITS } from './rateLimit.ts';

// Legacy cleanup function - now a no-op since PostgreSQL handles cleanup
export function cleanupRateLimits(): void {
  // Rate limits now handled by PostgreSQL, see cleanupExpiredRateLimits in rateLimit.ts
}

// ============================================================================
// Model Selection & Costs
// ============================================================================

// Available Claude models with cost per 1M tokens
export const MODEL_COSTS = {
  'claude-3-5-haiku-20241022': { inputPer1M: 1.00, outputPer1M: 5.00 },
  'claude-sonnet-4-20250514': { inputPer1M: 3.00, outputPer1M: 15.00 },
} as const;

export type ClaudeModel = keyof typeof MODEL_COSTS;

// Default models for different use cases
const DEFAULT_MODEL: ClaudeModel = 'claude-sonnet-4-20250514';
const FAST_MODEL: ClaudeModel = 'claude-3-5-haiku-20241022';

// Patterns that indicate complex queries needing Sonnet
const COMPLEX_INTENT_PATTERNS = [
  /\b(explain|analyze|compare|implement|design|architect|debug|refactor)\b/i,
  /\b(why|how does|what if|trade-?offs?)\b/i,
  /\b(transaction|bridge|deploy|cash.?out|swap)\b/i,
  /\b(ruleset|terminal|controller|split)\b/i,
  /\b(write|create|generate|build)\s+(a|the|some)?\s*(code|contract|function)\b/i,
];

// Simple queries that can use Haiku
const SIMPLE_INTENT_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure)\b/i,
  /\b(what is|what's)\s+(the\s+)?(address|balance|price|rate)\b/i,
  /\b(show|list|get)\s+(me\s+)?(the\s+)?(projects?|chats?|messages?)\b/i,
  /\bconfirm\b/i,
];

/**
 * Estimate token count for a message (rough approximation)
 */
function estimateTokens(content: string | ChatMessage['content']): number {
  const text = typeof content === 'string'
    ? content
    : JSON.stringify(content);
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Select the appropriate model based on query complexity and context
 */
export function selectModel(
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  forceModel?: ClaudeModel
): ClaudeModel {
  // Allow explicit model override
  if (forceModel && forceModel in MODEL_COSTS) {
    return forceModel;
  }

  // Get the last user message for intent detection
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMessage) {
    return DEFAULT_MODEL;
  }

  const content = typeof lastUserMessage.content === 'string'
    ? lastUserMessage.content
    : JSON.stringify(lastUserMessage.content);

  // Check for simple patterns first (use Haiku)
  for (const pattern of SIMPLE_INTENT_PATTERNS) {
    if (pattern.test(content)) {
      // Only use Haiku if query is short and no tools needed
      if (estimateTokens(content) < 100 && (!tools || tools.length === 0)) {
        return FAST_MODEL;
      }
    }
  }

  // Check for complex patterns (use Sonnet)
  for (const pattern of COMPLEX_INTENT_PATTERNS) {
    if (pattern.test(content)) {
      return DEFAULT_MODEL;
    }
  }

  // Default: use Sonnet if tools are involved or long context
  if (tools && tools.length > 0) {
    return DEFAULT_MODEL;
  }

  // For medium-length queries, use context to decide
  const tokenEstimate = estimateTokens(content);
  if (tokenEstimate > 500) {
    return DEFAULT_MODEL;
  }

  // Short queries without clear intent: try Haiku
  if (tokenEstimate < 50) {
    return FAST_MODEL;
  }

  // Default to Sonnet for safety
  return DEFAULT_MODEL;
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

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ImageBlock | DocumentBlock | ToolUseBlock | ToolResultBlock;

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
 * @deprecated Use buildEnhancedPrompt() for modular prompt loading and context management
 */
function buildSystemPromptSync(customSystem?: string, includeOmnichain = true): string {
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
 *
 * If messages are provided, uses intent detection for modular prompt loading.
 * This saves tokens by only including relevant context modules.
 */
export async function buildEnhancedPrompt(options: {
  customSystem?: string;
  messages?: ChatMessage[];  // Pass messages for intent detection (saves tokens)
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
  const builder = await getBuildEnhancedSystemPrompt();

  // If messages provided and no custom system, use modular mode
  if (options.messages && !options.customSystem) {
    // If semantic detection is enabled, use it to get better intent matching
    let semanticResult: import('./intentDetection.ts').SemanticIntentResult | undefined;

    if (options.useSemanticDetection) {
      try {
        const { detectSemanticIntents } = await import('./intentDetection.ts');
        // Get the last user message for semantic analysis
        const lastUserMessage = [...options.messages]
          .reverse()
          .find(m => m.role === 'user');

        if (lastUserMessage && typeof lastUserMessage.content === 'string') {
          semanticResult = await detectSemanticIntents(lastUserMessage.content);
        }
      } catch (error) {
        console.error('Semantic intent detection failed, falling back to keywords:', error);
      }
    }

    const result = await builder({
      messages: options.messages,
      chatId: options.chatId,
      userId: options.userId,
      includeOmnichain: options.includeOmnichain,
      omnichainContext: OMNICHAIN_CONTEXT,
      useSubModules: options.useSubModules ?? false,
    });

    return {
      ...result,
      semanticResult,
    };
  }

  // Legacy mode: use full prompt
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
// Confidence Parsing
// ============================================================================

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface ParsedConfidence {
  level: ConfidenceLevel;
  reason: string;
}

/**
 * Parse and strip confidence tag from AI response.
 * Returns the cleaned content and extracted confidence metadata.
 *
 * Expected format: <confidence level="high|medium|low" reason="brief explanation"/>
 */
export function parseConfidence(content: string): {
  content: string;
  confidence: ParsedConfidence | null;
} {
  const match = content.match(/<confidence\s+level="(high|medium|low)"\s+reason="([^"]*)"\s*\/>/);

  if (match) {
    return {
      content: content.replace(/<confidence[^>]*\/>/, '').trim(),
      confidence: {
        level: match[1] as ConfidenceLevel,
        reason: match[2],
      },
    };
  }

  return { content, confidence: null };
}

// ============================================================================
// API Methods
// ============================================================================

export async function sendMessage(
  userId: string,
  request: ClaudeRequest
): Promise<ClaudeResponse> {
  // Check rate limit via PostgreSQL
  const rateLimit = await checkDbRateLimit('aiInvoke', userId);
  if (!rateLimit.allowed) {
    throw new Error(
      `Rate limit exceeded. Resets at ${new Date(rateLimit.resetAt * 1000).toISOString()}`
    );
  }

  const client = getAnthropicClient();
  const includeOmnichain = request.includeOmnichainContext !== false;

  // Build system prompt with omnichain knowledge
  // Note: For better token efficiency, prefer using buildEnhancedPrompt() with messages for intent detection
  const systemPrompt = buildSystemPromptSync(request.system, includeOmnichain);

  // Get all tools including omnichain tools
  const allTools = includeOmnichain
    ? getAllTools(request.tools)
    : request.tools ?? [];

  // Select appropriate model based on query complexity
  const model = selectModel(request.messages, allTools);

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
          } else if (block.type === 'document') {
            return {
              type: 'document' as const,
              source: {
                type: 'base64' as const,
                media_type: block.source.media_type as 'application/pdf',
                data: block.source.data,
              },
            };
          } else {
            // Tool use/result blocks — pass through as-is
            return block;
          }
        }),
  })) as unknown as Anthropic.MessageParam[];

  const messageRequest: Anthropic.MessageCreateParams = {
    model, // Dynamic model selection
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
    const rateLimit = await checkDbRateLimit('aiInvoke', userId);
    if (!rateLimit.allowed) {
      throw new Error(
        `Rate limit exceeded. Resets at ${new Date(rateLimit.resetAt * 1000).toISOString()}`
      );
    }
  }

  // Create client: per-request with user key, or singleton with server key
  const client = userApiKey
    ? new Anthropic({ apiKey: userApiKey })
    : getAnthropicClient();
  const includeOmnichain = request.includeOmnichainContext !== false;

  // Build system prompt with omnichain knowledge
  // Note: For better token efficiency, prefer using buildEnhancedPrompt() with messages for intent detection
  const systemPrompt = buildSystemPromptSync(request.system, includeOmnichain);

  // Get all tools including omnichain tools
  const allTools = includeOmnichain
    ? getAllTools(request.tools)
    : request.tools ?? [];

  // Select appropriate model based on query complexity
  const model = selectModel(request.messages, allTools);

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
    model, // Dynamic model selection
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

  // Rate limit already checked at start; usage tracked via aiMetrics
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
    let isFirstTextChunkThisTurn = true;

    // Stream Claude's response for this turn
    for await (const event of streamMessage(userId, { ...request, messages }, userApiKey)) {
      if (event.type === 'text') {
        const textChunk = event.data as string;
        textContent += textChunk;
        // Add space between API turns if needed (only at start of new turn, not between streaming tokens)
        // This fixes "you.Let me try" where previous turn ended without space before this turn starts
        if (isFirstTextChunkThisTurn && fullResponseContent &&
            !fullResponseContent.match(/[\s\n]$/) && !textChunk.match(/^[\s\n]/)) {
          fullResponseContent += ' ';
          yield { type: 'text', data: ' ' }; // Yield space to client
        }
        isFirstTextChunkThisTurn = false;
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

/**
 * Get user's AI usage stats via PostgreSQL rate limits
 */
export async function getUserUsageStats(userId: string): Promise<{
  windowStart: Date;
  requests: number;
  remaining: { requests: number };
  resetAt: Date;
}> {
  const rateLimit = await checkDbRateLimit('aiInvoke', userId);
  const config = RATE_LIMITS.aiInvoke;

  return {
    windowStart: new Date((rateLimit.resetAt - config.windowSeconds) * 1000),
    requests: rateLimit.current,
    remaining: {
      requests: rateLimit.remaining,
    },
    resetAt: new Date(rateLimit.resetAt * 1000),
  };
}

// Re-export omnichain tool handler for use in routes
export { handleOmnichainTool } from './omnichain.ts';

// Export context and tools for frontend
export { OMNICHAIN_CONTEXT, OMNICHAIN_TOOLS } from '../context/omnichain.ts';
