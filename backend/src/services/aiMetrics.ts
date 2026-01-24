/**
 * AI Metrics & Observability
 *
 * Tracks tool usage patterns, response times, and error rates
 * for the agentic loop. Useful for understanding AI behavior
 * and optimizing performance.
 */

import { logger } from '../utils/logger.ts';

// ============================================================================
// Types
// ============================================================================

export interface ToolUsageEvent {
  timestamp: Date;
  chatId: string;
  toolName: string;
  success: boolean;
  durationMs: number;
  errorMessage?: string;
}

export interface AIInvocationEvent {
  timestamp: Date;
  chatId: string;
  promptLength: number;
  responseLength: number;
  totalDurationMs: number;
  toolsUsed: string[];
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  errorMessage?: string;
}

export interface AIMetricsSummary {
  // Time range
  from: Date;
  to: Date;

  // Invocation stats
  totalInvocations: number;
  successfulInvocations: number;
  failedInvocations: number;
  avgResponseTimeMs: number;
  p95ResponseTimeMs: number;

  // Token usage
  totalInputTokens: number;
  totalOutputTokens: number;
  avgTokensPerRequest: number;

  // Tool usage
  toolUsageCounts: Record<string, number>;
  toolSuccessRates: Record<string, number>;
  avgToolsPerInvocation: number;
  invocationsWithTools: number;
  invocationsWithoutTools: number;

  // Iteration stats (multi-turn tool use)
  avgIterations: number;
  maxIterations: number;
}

// ============================================================================
// In-Memory Storage (replace with DB for production)
// ============================================================================

const MAX_EVENTS = 10000;
const toolUsageEvents: ToolUsageEvent[] = [];
const invocationEvents: AIInvocationEvent[] = [];

// ============================================================================
// Recording Functions
// ============================================================================

/**
 * Record a tool usage event
 */
export function recordToolUsage(event: Omit<ToolUsageEvent, 'timestamp'>): void {
  const fullEvent: ToolUsageEvent = {
    ...event,
    timestamp: new Date(),
  };

  toolUsageEvents.push(fullEvent);

  // Trim old events
  if (toolUsageEvents.length > MAX_EVENTS) {
    toolUsageEvents.splice(0, toolUsageEvents.length - MAX_EVENTS);
  }

  // Log for immediate visibility
  logger.info('AI Tool Used', {
    chatId: event.chatId,
    tool: event.toolName,
    success: event.success,
    durationMs: event.durationMs,
    error: event.errorMessage,
  });
}

/**
 * Record an AI invocation event
 */
export function recordInvocation(event: Omit<AIInvocationEvent, 'timestamp'>): void {
  const fullEvent: AIInvocationEvent = {
    ...event,
    timestamp: new Date(),
  };

  invocationEvents.push(fullEvent);

  // Trim old events
  if (invocationEvents.length > MAX_EVENTS) {
    invocationEvents.splice(0, invocationEvents.length - MAX_EVENTS);
  }

  // Log summary
  logger.info('AI Invocation Complete', {
    chatId: event.chatId,
    success: event.success,
    durationMs: event.totalDurationMs,
    toolsUsed: event.toolsUsed,
    iterations: event.iterations,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    promptLength: event.promptLength,
    responseLength: event.responseLength,
  });
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get metrics summary for a time range
 */
export function getMetricsSummary(hoursBack = 24): AIMetricsSummary {
  const now = new Date();
  const from = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);

  // Filter events in range
  const invocations = invocationEvents.filter((e) => e.timestamp >= from);
  const toolEvents = toolUsageEvents.filter((e) => e.timestamp >= from);

  // Calculate invocation stats
  const successful = invocations.filter((e) => e.success);
  const responseTimes = invocations.map((e) => e.totalDurationMs).sort((a, b) => a - b);
  const p95Index = Math.floor(responseTimes.length * 0.95);

  // Calculate tool usage counts
  const toolUsageCounts: Record<string, number> = {};
  const toolSuccessCounts: Record<string, { success: number; total: number }> = {};

  for (const event of toolEvents) {
    toolUsageCounts[event.toolName] = (toolUsageCounts[event.toolName] || 0) + 1;

    if (!toolSuccessCounts[event.toolName]) {
      toolSuccessCounts[event.toolName] = { success: 0, total: 0 };
    }
    toolSuccessCounts[event.toolName].total++;
    if (event.success) {
      toolSuccessCounts[event.toolName].success++;
    }
  }

  const toolSuccessRates: Record<string, number> = {};
  for (const [tool, counts] of Object.entries(toolSuccessCounts)) {
    toolSuccessRates[tool] = counts.total > 0 ? counts.success / counts.total : 0;
  }

  // Calculate token usage
  const totalInputTokens = invocations.reduce((sum, e) => sum + e.inputTokens, 0);
  const totalOutputTokens = invocations.reduce((sum, e) => sum + e.outputTokens, 0);

  // Calculate tool usage per invocation
  const totalToolsUsed = invocations.reduce((sum, e) => sum + e.toolsUsed.length, 0);
  const invocationsWithTools = invocations.filter((e) => e.toolsUsed.length > 0).length;

  // Calculate iterations
  const totalIterations = invocations.reduce((sum, e) => sum + e.iterations, 0);
  const maxIterations = Math.max(...invocations.map((e) => e.iterations), 0);

  return {
    from,
    to: now,
    totalInvocations: invocations.length,
    successfulInvocations: successful.length,
    failedInvocations: invocations.length - successful.length,
    avgResponseTimeMs:
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0,
    p95ResponseTimeMs: responseTimes[p95Index] || 0,
    totalInputTokens,
    totalOutputTokens,
    avgTokensPerRequest:
      invocations.length > 0 ? (totalInputTokens + totalOutputTokens) / invocations.length : 0,
    toolUsageCounts,
    toolSuccessRates,
    avgToolsPerInvocation: invocations.length > 0 ? totalToolsUsed / invocations.length : 0,
    invocationsWithTools,
    invocationsWithoutTools: invocations.length - invocationsWithTools,
    avgIterations: invocations.length > 0 ? totalIterations / invocations.length : 0,
    maxIterations,
  };
}

/**
 * Get recent tool usage events
 */
export function getRecentToolUsage(limit = 100): ToolUsageEvent[] {
  return toolUsageEvents.slice(-limit).reverse();
}

/**
 * Get recent invocation events
 */
export function getRecentInvocations(limit = 100): AIInvocationEvent[] {
  return invocationEvents.slice(-limit).reverse();
}

/**
 * Get tool usage breakdown for a specific chat
 */
export function getChatToolUsage(chatId: string): {
  tools: Record<string, number>;
  totalInvocations: number;
  avgResponseTime: number;
} {
  const chatInvocations = invocationEvents.filter((e) => e.chatId === chatId);
  const tools: Record<string, number> = {};

  for (const inv of chatInvocations) {
    for (const tool of inv.toolsUsed) {
      tools[tool] = (tools[tool] || 0) + 1;
    }
  }

  const avgResponseTime =
    chatInvocations.length > 0
      ? chatInvocations.reduce((sum, e) => sum + e.totalDurationMs, 0) / chatInvocations.length
      : 0;

  return {
    tools,
    totalInvocations: chatInvocations.length,
    avgResponseTime,
  };
}
