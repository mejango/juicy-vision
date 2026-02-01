/**
 * Moonshot (Kimi) AI Service
 *
 * OpenAI-compatible API for Moonshot's Kimi model.
 * Drop-in alternative to Claude with similar interface.
 */

import { getConfig } from '../utils/config.ts';
import { OMNICHAIN_CONTEXT, OMNICHAIN_TOOLS } from '../context/omnichain.ts';
import { handleOmnichainTool } from './omnichain.ts';
import { SYSTEM_PROMPT } from '@shared/prompts.ts';
import { recordToolUsage, recordInvocation } from './aiMetrics.ts';
import type { ChatMessage, ToolDefinition, ClaudeRequest, ClaudeResponse, ToolCall, ToolResult } from './claude.ts';

// Moonshot API base URL
const MOONSHOT_API_URL = 'https://api.moonshot.cn/v1';

// ============================================================================
// Rate Limiting (Simple in-memory implementation)
// ============================================================================

interface RateLimitEntry {
  tokens: number;
  requests: number;
  windowStart: number;
}

const rateLimits = new Map<string, RateLimitEntry>();

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_REQUESTS_PER_WINDOW = 100;
const MAX_TOKENS_PER_WINDOW = 500_000;

function getRateLimitKey(userId: string): string {
  return `moonshot:rate:${userId}`;
}

function checkRateLimit(userId: string): { allowed: boolean; remaining: { requests: number; tokens: number } } {
  const key = getRateLimitKey(userId);
  const now = Date.now();

  let entry = rateLimits.get(key);

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

// ============================================================================
// Message Format Conversion
// ============================================================================

interface MoonshotMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

interface MoonshotTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

function convertToolsToMoonshot(tools: ToolDefinition[]): MoonshotTool[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.input_schema.properties,
        required: t.input_schema.required,
      },
    },
  }));
}

function convertMessagesToMoonshot(messages: ChatMessage[], systemPrompt: string): MoonshotMessage[] {
  const result: MoonshotMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({
        role: msg.role,
        content: msg.content,
      });
    } else {
      // Handle multimodal content - extract text only for Moonshot
      // (Moonshot doesn't support images in the same way)
      const textParts = msg.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text);

      // Handle tool results
      const toolResults = msg.content.filter(
        (block): block is { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean } =>
          block.type === 'tool_result'
      );

      if (toolResults.length > 0) {
        // Add tool result messages
        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            content: tr.content,
            tool_call_id: tr.tool_use_id,
          });
        }
      } else if (textParts.length > 0) {
        result.push({
          role: msg.role,
          content: textParts.join('\n'),
        });
      }

      // Handle tool use blocks in assistant messages
      const toolUses = msg.content.filter(
        (block): block is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          block.type === 'tool_use'
      );

      if (toolUses.length > 0 && msg.role === 'assistant') {
        // Moonshot expects tool_calls in assistant message
        const lastAssistant = result[result.length - 1];
        if (lastAssistant && lastAssistant.role === 'assistant') {
          lastAssistant.tool_calls = toolUses.map(tu => ({
            id: tu.id,
            type: 'function',
            function: {
              name: tu.name,
              arguments: JSON.stringify(tu.input),
            },
          }));
        }
      }
    }
  }

  return result;
}

// ============================================================================
// Build System Prompt
// ============================================================================

function buildSystemPrompt(customSystem?: string, includeOmnichain = true): string {
  const parts: string[] = [];

  parts.push(customSystem || SYSTEM_PROMPT);

  if (includeOmnichain) {
    parts.push('\n\n---\n\n# Knowledge Base\n');
    parts.push(OMNICHAIN_CONTEXT);
  }

  return parts.join('');
}

function getAllTools(customTools?: ToolDefinition[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [...(OMNICHAIN_TOOLS as ToolDefinition[])];

  if (customTools) {
    tools.push(...customTools);
  }

  return tools;
}

// ============================================================================
// API Methods
// ============================================================================

export async function sendMessage(
  userId: string,
  request: ClaudeRequest
): Promise<ClaudeResponse> {
  const rateLimit = checkRateLimit(userId);
  if (!rateLimit.allowed) {
    throw new Error(
      `Rate limit exceeded. Remaining: ${rateLimit.remaining.requests} requests, ${rateLimit.remaining.tokens} tokens`
    );
  }

  const config = getConfig();
  if (!config.moonshotApiKey) {
    throw new Error('MOONSHOT_API_KEY not configured');
  }

  const includeOmnichain = request.includeOmnichainContext !== false;
  const systemPrompt = buildSystemPrompt(request.system, includeOmnichain);
  const allTools = includeOmnichain
    ? getAllTools(request.tools)
    : request.tools ?? [];

  const messages = convertMessagesToMoonshot(request.messages, systemPrompt);

  const body: Record<string, unknown> = {
    model: config.moonshotModel,
    messages,
    max_tokens: request.maxTokens ?? 4096,
  };

  if (allTools.length > 0) {
    body.tools = convertToolsToMoonshot(allTools);
    body.tool_choice = 'auto';
  }

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  const response = await fetch(`${MOONSHOT_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.moonshotApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Moonshot API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const message = choice?.message;

  const totalTokens = (data.usage?.total_tokens ?? 0);
  recordUsage(userId, totalTokens);

  // Extract tool calls if any
  const toolCalls: ClaudeResponse['toolCalls'] = [];
  if (message?.tool_calls) {
    for (const tc of message.tool_calls) {
      try {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      } catch {
        // Invalid JSON in tool arguments
      }
    }
  }

  return {
    content: message?.content ?? '',
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
    stopReason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
  };
}

// Streaming version
export async function* streamMessage(
  userId: string,
  request: ClaudeRequest,
  userApiKey?: string
): AsyncGenerator<{ type: 'text' | 'tool_use' | 'usage'; data: unknown }> {
  if (!userApiKey) {
    const rateLimit = checkRateLimit(userId);
    if (!rateLimit.allowed) {
      throw new Error(
        `Rate limit exceeded. Remaining: ${rateLimit.remaining.requests} requests, ${rateLimit.remaining.tokens} tokens`
      );
    }
  }

  const config = getConfig();
  const apiKey = userApiKey || config.moonshotApiKey;
  if (!apiKey) {
    throw new Error('MOONSHOT_API_KEY not configured');
  }

  const includeOmnichain = request.includeOmnichainContext !== false;
  const systemPrompt = buildSystemPrompt(request.system, includeOmnichain);
  const allTools = includeOmnichain
    ? getAllTools(request.tools)
    : request.tools ?? [];

  const messages = convertMessagesToMoonshot(request.messages, systemPrompt);

  const body: Record<string, unknown> = {
    model: config.moonshotModel,
    messages,
    max_tokens: request.maxTokens ?? 4096,
    stream: true,
  };

  if (allTools.length > 0) {
    body.tools = convertToolsToMoonshot(allTools);
    body.tool_choice = 'auto';
  }

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  console.log('[Moonshot] Request:', JSON.stringify({
    model: body.model,
    messageCount: messages.length,
    toolCount: (body.tools as unknown[])?.length ?? 0,
    maxTokens: body.max_tokens,
    firstMessage: messages[0]?.content?.slice(0, 200),
    lastUserMessage: messages.filter(m => m.role === 'user').pop()?.content?.slice(0, 200),
  }));

  console.log('[Moonshot] Calling API...');
  const response = await fetch(`${MOONSHOT_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  console.log('[Moonshot] Response status:', response.status);

  if (!response.ok) {
    const error = await response.text();
    console.error('[Moonshot] Error response:', error);
    throw new Error(`Moonshot API error: ${response.status} ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    console.error('[Moonshot] No response body from API');
    throw new Error('No response body');
  }

  console.log('[Moonshot] Got response reader, starting stream...');

  const decoder = new TextDecoder();
  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let chunkCount = 0;
  let totalTextReceived = '';

  // Track tool calls being built
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.log('[Moonshot] Stream done. Total chunks:', chunkCount, 'Total text length:', totalTextReceived.length);
      break;
    }

    const rawChunk = decoder.decode(value, { stream: true });
    buffer += rawChunk;
    chunkCount++;

    if (chunkCount <= 3) {
      console.log(`[Moonshot] Chunk ${chunkCount}:`, rawChunk.slice(0, 500));
    }

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        console.log('[Moonshot] Received [DONE] marker');
        continue;
      }

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;

        if (delta?.content) {
          totalTextReceived += delta.content;
          yield { type: 'text', data: delta.content };
        }

        // Handle tool calls in streaming
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls.has(idx)) {
              toolCalls.set(idx, { id: tc.id || '', name: '', arguments: '' });
            }
            const current = toolCalls.get(idx)!;
            if (tc.id) current.id = tc.id;
            if (tc.function?.name) current.name = tc.function.name;
            if (tc.function?.arguments) current.arguments += tc.function.arguments;
          }
        }

        // Usage info at the end
        if (parsed.usage) {
          inputTokens = parsed.usage.prompt_tokens ?? 0;
          outputTokens = parsed.usage.completion_tokens ?? 0;
        }
      } catch (e) {
        console.error('[Moonshot] Failed to parse chunk:', data.slice(0, 200), 'Error:', e);
      }
    }
  }

  // Yield completed tool calls
  for (const [, tc] of toolCalls) {
    if (tc.id && tc.name) {
      try {
        yield {
          type: 'tool_use',
          data: { id: tc.id, name: tc.name, input: JSON.parse(tc.arguments) },
        };
      } catch {
        // Invalid JSON arguments
      }
    }
  }

  if (!userApiKey) {
    recordUsage(userId, inputTokens + outputTokens);
  }

  console.log('[Moonshot] streamMessage complete. Tokens:', { inputTokens, outputTokens }, 'ToolCalls:', toolCalls.size);

  yield {
    type: 'usage',
    data: { inputTokens, outputTokens, stopReason: toolCalls.size > 0 ? 'tool_use' : 'end_turn' },
  };
}

// Agentic streaming with tool execution
export async function* streamMessageWithTools(
  userId: string,
  request: ClaudeRequest,
  userApiKey?: string,
  maxIterations = 10
): AsyncGenerator<{ type: 'text' | 'tool_use' | 'tool_result' | 'usage' | 'thinking'; data: unknown }> {
  console.log('[Moonshot] streamMessageWithTools called for user:', userId);
  console.log('[Moonshot] Message count:', request.messages.length, 'Max iterations:', maxIterations);

  const messages: ChatMessage[] = [...request.messages];

  const invocationStart = Date.now();
  const toolsUsed: string[] = [];
  let fullResponseContent = '';

  let iteration = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (iteration < maxIterations) {
    iteration++;

    let textContent = '';
    const toolCalls: ToolCall[] = [];
    let stopReason = 'end_turn';
    let isFirstTextChunkThisTurn = true;

    for await (const event of streamMessage(userId, { ...request, messages }, userApiKey)) {
      if (event.type === 'text') {
        const textChunk = event.data as string;
        textContent += textChunk;
        if (isFirstTextChunkThisTurn && fullResponseContent &&
            !fullResponseContent.match(/[\s\n]$/) && !textChunk.match(/^[\s\n]/)) {
          fullResponseContent += ' ';
          yield { type: 'text', data: ' ' };
        }
        isFirstTextChunkThisTurn = false;
        fullResponseContent += textChunk;
        yield event;
      } else if (event.type === 'tool_use') {
        const toolCall = event.data as ToolCall;
        toolCalls.push(toolCall);
        toolsUsed.push(toolCall.name);
        yield { type: 'thinking', data: `Using tool: ${toolCall.name}` };
      } else if (event.type === 'usage') {
        const usage = event.data as { inputTokens: number; outputTokens: number; stopReason: string };
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;
        stopReason = usage.stopReason;
      }
    }

    if (toolCalls.length === 0 || stopReason !== 'tool_use') {
      break;
    }

    // Build assistant message with tool calls
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

    messages.push({
      role: 'assistant',
      content: assistantContent as unknown as string,
    });

    // Execute tools
    const toolResults: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      yield { type: 'tool_use', data: toolCall };

      const toolStart = Date.now();
      try {
        const result = await handleOmnichainTool(toolCall.name, toolCall.input);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

        toolResults.push({
          tool_use_id: toolCall.id,
          content: resultStr,
        });

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

    // Add tool results
    messages.push({
      role: 'user',
      content: toolResults.map(tr => ({
        type: 'tool_result',
        tool_use_id: tr.tool_use_id,
        content: tr.content,
        is_error: tr.is_error,
      })) as unknown as string,
    });
  }

  // Record metrics
  const promptLength = request.messages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length;
    return sum + JSON.stringify(m.content).length;
  }, 0);

  recordInvocation({
    chatId: userId,
    promptLength,
    responseLength: fullResponseContent.length,
    totalDurationMs: Date.now() - invocationStart,
    toolsUsed: [...new Set(toolsUsed)],
    iterations: iteration,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    success: true,
  });

  yield {
    type: 'usage',
    data: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
  };
}

// Usage stats
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
