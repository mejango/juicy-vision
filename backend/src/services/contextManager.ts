/**
 * Context Manager Service
 *
 * Orchestrates all memory layers to build optimized context for AI invocations.
 * Implements token budgeting to ensure predictable context window usage.
 *
 * Memory Layers:
 * 1. Working Memory - Recent raw messages (volatile, zero-latency)
 * 2. Transaction State - Entity memory for project design (persistent)
 * 3. Context Summaries - Compressed history (anchored iterative)
 * 4. Attachment Summaries - Document extracts (preserved independently)
 */

import { query, queryOne, execute } from '../db/index.ts';
import { getConfig } from '../utils/config.ts';
import {
  getTransactionState,
  formatStateForPrompt,
  ChatTransactionState,
} from './transactionState.ts';
import {
  getLatestSummary,
  getAttachmentSummaries,
  estimateTokens,
  ChatSummary,
  AttachmentSummary,
} from './summarization.ts';
import { getContextForSystemPrompt } from './userContext.ts';
import type { ChatMessage } from './claude.ts';
import {
  BASE_PROMPT,
  DATA_QUERY_CONTEXT,
  HOOK_DEVELOPER_CONTEXT,
  TRANSACTION_CONTEXT,
  EXAMPLE_INTERACTIONS,
  INTENT_HINTS,
  MODULE_TOKENS,
} from '@shared/prompts.ts';

// ============================================================================
// Types
// ============================================================================

export interface OptimizedContext {
  // Layer 1: Working memory (raw messages)
  recentMessages: ChatMessage[];

  // Layer 2: Transaction state (entity memory)
  transactionState: ChatTransactionState | null;

  // Layer 3: Context summaries
  summaries: ChatSummary[];

  // Layer 4: Attachment summaries
  attachmentSummaries: AttachmentSummary[];

  // User context (jargon level, preferences)
  userContext: string | null;

  // Participant context (for multi-user chats)
  participantContext: string | null;

  // Token accounting
  metadata: {
    totalTokens: number;
    recentMessageTokens: number;
    transactionStateTokens: number;
    summaryTokens: number;
    attachmentSummaryTokens: number;
    userContextTokens: number;
    participantContextTokens: number;
    recentMessageCount: number;
    summaryCount: number;
    attachmentCount: number;
    budgetExceeded: boolean;
    triggeredSummarization: boolean;
    // Modular prompt info (when using intent detection)
    modularPrompt?: {
      estimatedTokens: number;
      modulesLoaded: string[];
      reasons: string[];
    };
  };
}

export interface ParticipantInfo {
  address: string;
  userId?: string;
  role: string;
  displayName?: string;
}

// ============================================================================
// Token Budget Configuration
// ============================================================================

// Safety margin multiplier to account for "4 chars per token" approximation errors
// The estimateTokens() function uses a rough 4:1 char-to-token ratio, which can be off
// by up to 20% depending on content. Applying 0.8x gives us a safety buffer.
const TOKEN_SAFETY_MARGIN = 0.8;

export const TOKEN_BUDGET = {
  // Total context budget (conservative to leave room for response)
  total: 50000,

  // Fixed allocations (always included)
  transactionState: 2000,
  userContext: 1000,
  participantContext: 500,

  // Variable allocations (with safety margin for approximation errors)
  attachmentSummaries: Math.floor(3000 * TOKEN_SAFETY_MARGIN), // ~2400
  summaries: Math.floor(10000 * TOKEN_SAFETY_MARGIN), // ~8000

  // Remainder goes to recent messages
  // recentMessages = total - fixed - variable = ~35600 (more headroom after safety margin)
};

// ============================================================================
// Intent Detection for Modular Prompts
// ============================================================================

export interface DetectedIntents {
  needsDataQuery: boolean;
  needsHookDeveloper: boolean;
  needsTransaction: boolean;
  // Reason for each module being included (for debugging/logging)
  reasons: string[];
}

/**
 * Analyze conversation + user/project context to detect which modules are needed
 *
 * Uses multiple signals:
 * 1. Keywords in recent messages (INTENT_HINTS)
 * 2. User's project design phase (from transactionState)
 * 3. User's experience level (from userContext)
 * 4. Active project being discussed
 */
export async function detectIntentsWithContext(
  messages: ChatMessage[],
  transactionState?: ChatTransactionState | null,
  userJargonLevel?: string
): Promise<DetectedIntents> {
  const reasons: string[] = [];

  // Combine recent messages for keyword analysis (last 5 user messages)
  const recentUserMessages = messages
    .filter(m => m.role === 'user')
    .slice(-5)
    .map(m => typeof m.content === 'string' ? m.content.toLowerCase() : '')
    .join(' ');

  const checkHints = (hints: string[]): boolean =>
    hints.some(hint => recentUserMessages.includes(hint.toLowerCase()));

  // 1. Keyword-based detection
  let needsDataQuery = checkHints(INTENT_HINTS.dataQuery);
  let needsHookDeveloper = checkHints(INTENT_HINTS.hookDeveloper);
  let needsTransaction = checkHints(INTENT_HINTS.transaction);

  if (needsDataQuery) reasons.push('keywords: data query');
  if (needsHookDeveloper) reasons.push('keywords: hook developer');
  if (needsTransaction) reasons.push('keywords: transaction');

  // 2. Transaction state signals
  if (transactionState) {
    // If user is in configuration/review/ready phase, they need transaction context
    if (['configuration', 'review', 'ready'].includes(transactionState.designPhase)) {
      if (!needsTransaction) {
        needsTransaction = true;
        reasons.push(`design phase: ${transactionState.designPhase}`);
      }
    }

    // If they have tiers defined, they're doing NFT work
    if (transactionState.tiers && transactionState.tiers.length > 0) {
      if (!needsTransaction) {
        needsTransaction = true;
        reasons.push('has NFT tiers defined');
      }
    }

    // If they have pending questions about configuration
    if (transactionState.pendingQuestions?.some(q =>
      /ruleset|split|payout|terminal|chain/i.test(q)
    )) {
      if (!needsTransaction) {
        needsTransaction = true;
        reasons.push('pending config questions');
      }
    }
  }

  // 3. User jargon level signals
  if (userJargonLevel === 'advanced') {
    // Advanced users asking technical questions likely need hook context
    if (recentUserMessages.includes('contract') ||
        recentUserMessages.includes('solidity') ||
        recentUserMessages.includes('implement')) {
      if (!needsHookDeveloper) {
        needsHookDeveloper = true;
        reasons.push('advanced user + technical keywords');
      }
    }
  }

  // 4. Fallback: if nothing detected and conversation is short, include data query
  // Most users start by exploring projects before creating/transacting
  if (!needsDataQuery && !needsHookDeveloper && !needsTransaction) {
    if (messages.length <= 4) {
      // New conversation - include data query context by default (users typically explore first)
      needsDataQuery = true;
      reasons.push('new conversation default (exploration)');
    }
  }

  return {
    needsDataQuery,
    needsHookDeveloper,
    needsTransaction,
    reasons,
  };
}

/**
 * Simpler sync version for cases without user/project context
 */
export function detectIntents(messages: ChatMessage[]): DetectedIntents {
  const reasons: string[] = [];

  const recentUserMessages = messages
    .filter(m => m.role === 'user')
    .slice(-5)
    .map(m => typeof m.content === 'string' ? m.content.toLowerCase() : '')
    .join(' ');

  const checkHints = (hints: string[]): boolean =>
    hints.some(hint => recentUserMessages.includes(hint.toLowerCase()));

  const needsDataQuery = checkHints(INTENT_HINTS.dataQuery);
  const needsHookDeveloper = checkHints(INTENT_HINTS.hookDeveloper);
  let needsTransaction = checkHints(INTENT_HINTS.transaction);

  if (needsDataQuery) reasons.push('keywords: data query');
  if (needsHookDeveloper) reasons.push('keywords: hook developer');
  if (needsTransaction) reasons.push('keywords: transaction');

  // Default: include data query for new conversations (users typically explore first)
  if (!needsDataQuery && !needsHookDeveloper && !needsTransaction && messages.length <= 4) {
    needsDataQuery = true;
    reasons.push('new conversation default (exploration)');
  }

  return { needsDataQuery, needsHookDeveloper, needsTransaction, reasons };
}

/**
 * Build modular system prompt based on detected intents
 * Returns BASE_PROMPT + only the modules needed for this conversation
 */
export function buildModularPrompt(intents: DetectedIntents): string {
  const parts: string[] = [BASE_PROMPT];

  // Add context modules based on detected intents
  if (intents.needsDataQuery) {
    parts.push(DATA_QUERY_CONTEXT);
  }

  if (intents.needsHookDeveloper) {
    parts.push(HOOK_DEVELOPER_CONTEXT);
  }

  if (intents.needsTransaction) {
    parts.push(TRANSACTION_CONTEXT);
  }

  // Always include examples for few-shot learning (small cost)
  parts.push(EXAMPLE_INTERACTIONS);

  return parts.join('\n\n');
}

/**
 * Estimate token count for the modular prompt
 */
export function estimateModularPromptTokens(intents: DetectedIntents): number {
  let tokens = MODULE_TOKENS.BASE_PROMPT + MODULE_TOKENS.EXAMPLE_INTERACTIONS;

  if (intents.needsDataQuery) tokens += MODULE_TOKENS.DATA_QUERY_CONTEXT;
  if (intents.needsHookDeveloper) tokens += MODULE_TOKENS.HOOK_DEVELOPER_CONTEXT;
  if (intents.needsTransaction) tokens += MODULE_TOKENS.TRANSACTION_CONTEXT;

  return tokens;
}

/**
 * Get list of module names loaded for given intents
 */
export function getLoadedModules(intents: DetectedIntents): string[] {
  const modules = ['BASE_PROMPT'];
  if (intents.needsDataQuery) modules.push('DATA_QUERY_CONTEXT');
  if (intents.needsHookDeveloper) modules.push('HOOK_DEVELOPER_CONTEXT');
  if (intents.needsTransaction) modules.push('TRANSACTION_CONTEXT');
  modules.push('EXAMPLE_INTERACTIONS');
  return modules;
}

// ============================================================================
// Core Context Building
// ============================================================================

/**
 * Build optimized context for an AI invocation
 */
export async function buildOptimizedContext(
  chatId: string,
  userId?: string
): Promise<OptimizedContext> {
  // Initialize metadata
  const metadata: OptimizedContext['metadata'] = {
    totalTokens: 0,
    recentMessageTokens: 0,
    transactionStateTokens: 0,
    summaryTokens: 0,
    attachmentSummaryTokens: 0,
    userContextTokens: 0,
    participantContextTokens: 0,
    recentMessageCount: 0,
    summaryCount: 0,
    attachmentCount: 0,
    budgetExceeded: false,
    triggeredSummarization: false,
  };

  // Start with fixed allocations (always included)
  let remainingBudget = TOKEN_BUDGET.total;

  // 1. Transaction state (Layer 2)
  const transactionState = await getTransactionState(chatId);
  let transactionStateTokens = 0;
  if (transactionState) {
    const formatted = formatStateForPrompt(transactionState);
    transactionStateTokens = estimateTokens(formatted);
    metadata.transactionStateTokens = Math.min(transactionStateTokens, TOKEN_BUDGET.transactionState);
  }
  remainingBudget -= metadata.transactionStateTokens;

  // 2. User context
  let userContext: string | null = null;
  if (userId) {
    userContext = await getContextForSystemPrompt(userId);
    metadata.userContextTokens = Math.min(
      estimateTokens(userContext),
      TOKEN_BUDGET.userContext
    );
  }
  remainingBudget -= metadata.userContextTokens;

  // 3. Participant context (for multi-user chats)
  const participantContext = await buildParticipantContext(chatId);
  if (participantContext) {
    metadata.participantContextTokens = Math.min(
      estimateTokens(participantContext),
      TOKEN_BUDGET.participantContext
    );
  }
  remainingBudget -= metadata.participantContextTokens;

  // 4. Attachment summaries (Layer 4)
  const allAttachmentSummaries = await getAttachmentSummaries(chatId);
  let attachmentSummaries: AttachmentSummary[] = [];
  let attachmentTokens = 0;

  // Include most recent attachment summaries up to budget
  for (const summary of allAttachmentSummaries) {
    if (attachmentTokens + summary.tokenCount <= TOKEN_BUDGET.attachmentSummaries) {
      attachmentSummaries.push(summary);
      attachmentTokens += summary.tokenCount;
    } else {
      break;
    }
  }
  metadata.attachmentSummaryTokens = attachmentTokens;
  metadata.attachmentCount = attachmentSummaries.length;
  remainingBudget -= attachmentTokens;

  // 5. Context summaries (Layer 3)
  const latestSummary = await getLatestSummary(chatId);
  const summaries: ChatSummary[] = [];
  let summaryTokens = 0;

  if (latestSummary) {
    const tokens = estimateTokens(latestSummary.summaryMd);
    if (tokens <= TOKEN_BUDGET.summaries) {
      summaries.push(latestSummary);
      summaryTokens = tokens;
    }
  }
  metadata.summaryTokens = summaryTokens;
  metadata.summaryCount = summaries.length;
  remainingBudget -= summaryTokens;

  // 6. Recent messages (Layer 1) - fill remaining budget
  const recentMessageBudget = Math.max(0, remainingBudget);
  const { messages: recentMessages, tokenCount: recentTokens } =
    await getRecentMessagesWithBudget(chatId, recentMessageBudget, latestSummary?.coversToCreatedAt);

  metadata.recentMessageTokens = recentTokens;
  metadata.recentMessageCount = recentMessages.length;

  // Calculate total
  metadata.totalTokens =
    metadata.transactionStateTokens +
    metadata.userContextTokens +
    metadata.participantContextTokens +
    metadata.attachmentSummaryTokens +
    metadata.summaryTokens +
    metadata.recentMessageTokens;

  metadata.budgetExceeded = metadata.totalTokens > TOKEN_BUDGET.total;

  return {
    recentMessages,
    transactionState,
    summaries,
    attachmentSummaries,
    userContext,
    participantContext,
    metadata,
  };
}

/**
 * Get recent messages that fit within a token budget
 */
async function getRecentMessagesWithBudget(
  chatId: string,
  tokenBudget: number,
  afterTimestamp?: Date
): Promise<{ messages: ChatMessage[]; tokenCount: number }> {
  // Get more messages than we need, then trim by token count
  const maxMessages = 50;

  const whereClause = afterTimestamp
    ? `AND created_at > $2`
    : '';

  const params = afterTimestamp
    ? [chatId, afterTimestamp, maxMessages]
    : [chatId, maxMessages];

  const dbMessages = await query<{
    role: string;
    content: string;
    token_count: number | null;
    created_at: Date;
  }>(
    `SELECT role, content, token_count, created_at
     FROM multi_chat_messages
     WHERE chat_id = $1
     AND deleted_at IS NULL
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${afterTimestamp ? '3' : '2'}`,
    params
  );

  // Reverse to get chronological order
  dbMessages.reverse();

  // Take messages from the end (most recent) until we hit budget
  const messages: ChatMessage[] = [];
  let totalTokens = 0;

  // Start from the end (most recent) and work backwards
  for (let i = dbMessages.length - 1; i >= 0; i--) {
    const msg = dbMessages[i];
    const tokens = msg.token_count || estimateTokens(msg.content);

    if (totalTokens + tokens > tokenBudget && messages.length > 0) {
      // Would exceed budget and we have at least some messages
      break;
    }

    messages.unshift({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
    totalTokens += tokens;
  }

  return { messages, tokenCount: totalTokens };
}

/**
 * Build context string for participants in multi-user chats
 */
async function buildParticipantContext(chatId: string): Promise<string | null> {
  const participants = await query<{
    member_address: string;
    member_user_id: string | null;
    role: string;
    display_name: string | null;
  }>(
    `SELECT
       mcm.member_address,
       mcm.member_user_id,
       mcm.role::text as role,
       mcm.display_name
     FROM multi_chat_members mcm
     WHERE mcm.chat_id = $1 AND mcm.is_active = true`,
    [chatId]
  );

  if (participants.length <= 1) {
    return null; // Single-user chat, no participant context needed
  }

  const lines: string[] = ['# Chat Participants', ''];

  for (const p of participants) {
    const name = p.display_name || formatAddress(p.member_address);
    const roleLabel = p.role === 'founder' ? '(founder)' : p.role === 'admin' ? '(admin)' : '';
    lines.push(`- ${name} ${roleLabel}`.trim());
  }

  lines.push('');
  lines.push('_Address messages appropriately. Reference participants by name when relevant._');

  return lines.join('\n');
}

// ============================================================================
// Context Formatting for Claude API
// ============================================================================

/**
 * Format optimized context for Claude API consumption
 */
export function formatContextForClaude(
  context: OptimizedContext
): ChatMessage[] {
  // The main messages are the recent messages
  const messages = [...context.recentMessages];

  // If we have summaries, prepend them as a system-like context
  if (context.summaries.length > 0) {
    const summaryContent = formatSummariesForContext(context.summaries);

    // Inject summary as a system message at the start
    // (Claude API requires alternating user/assistant, so we'll include it differently)
    // We'll prepend to the first user message if it exists
    if (messages.length > 0 && messages[0].role === 'user') {
      const originalContent = messages[0].content;
      messages[0] = {
        role: 'user',
        content: typeof originalContent === 'string'
          ? `${summaryContent}\n\n---\n\n${originalContent}`
          : originalContent, // Don't modify multimodal content
      };
    }
  }

  return messages;
}

/**
 * Format summaries for context injection
 */
function formatSummariesForContext(summaries: ChatSummary[]): string {
  const parts: string[] = [];

  parts.push('# Previous Context (Summarized)');
  parts.push('');

  for (const summary of summaries) {
    parts.push(`_Summarized from ${summary.messageCount} messages_`);
    parts.push('');
    parts.push(summary.summaryMd);
  }

  return parts.join('\n');
}

/**
 * Format attachment summaries for system prompt injection
 */
export function formatAttachmentSummariesForPrompt(
  summaries: AttachmentSummary[]
): string {
  if (summaries.length === 0) return '';

  const parts: string[] = [];
  parts.push('# Uploaded Documents');
  parts.push('');

  for (const summary of summaries) {
    const filename = summary.originalFilename || `Attachment`;
    parts.push(`## ${filename}`);
    parts.push('');
    parts.push(summary.summaryMd);
    parts.push('');
  }

  return parts.join('\n');
}

// ============================================================================
// Context Usage Logging
// ============================================================================

/**
 * Log context usage for analytics/tuning
 */
export async function logContextUsage(
  chatId: string,
  messageId: string | null,
  context: OptimizedContext
): Promise<void> {
  try {
    await execute(
      `INSERT INTO context_usage_log (
         chat_id, message_id, total_tokens,
         transaction_state_tokens, user_context_tokens,
         summary_tokens, recent_message_tokens, attachment_summary_tokens,
         recent_message_count, summary_count, attachment_count,
         budget_exceeded, triggered_summarization
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        chatId,
        messageId,
        context.metadata.totalTokens,
        context.metadata.transactionStateTokens,
        context.metadata.userContextTokens,
        context.metadata.summaryTokens,
        context.metadata.recentMessageTokens,
        context.metadata.attachmentSummaryTokens,
        context.metadata.recentMessageCount,
        context.metadata.summaryCount,
        context.metadata.attachmentCount,
        context.metadata.budgetExceeded,
        context.metadata.triggeredSummarization,
      ]
    );
  } catch (error) {
    // Non-critical, just log
    console.error('Failed to log context usage:', error);
  }
}

// ============================================================================
// System Prompt Building
// ============================================================================

/**
 * Build complete system prompt with all context layers
 *
 * Supports two modes:
 * 1. Legacy: Pass basePrompt directly (uses full prompt)
 * 2. Modular: Pass messages array for intent detection (saves tokens)
 */
export async function buildEnhancedSystemPrompt(options: {
  basePrompt?: string;  // Legacy: use this prompt directly
  messages?: ChatMessage[];  // Modular: detect intent and build minimal prompt
  chatId?: string;
  userId?: string;
  includeOmnichain?: boolean;
  omnichainContext?: string;
}): Promise<{ systemPrompt: string; context: OptimizedContext | null; intents?: DetectedIntents }> {
  const parts: string[] = [];
  let context: OptimizedContext | null = null;
  let detectedIntents: DetectedIntents | undefined;
  const config = getConfig();

  // 1. Build base prompt - modular if messages provided, otherwise use legacy
  let basePrompt: string;
  if (options.messages && options.messages.length > 0) {
    // Modular mode: detect intents using full context
    // If we have a chatId, use context-aware detection
    if (options.chatId) {
      const transactionState = await getTransactionState(options.chatId);
      // Get user jargon level if we have userId
      let jargonLevel: string | undefined;
      if (options.userId) {
        const userCtx = await getContextForSystemPrompt(options.userId);
        // Extract jargon level from context markdown
        const levelMatch = userCtx.match(/Jargon level: (\w+)/);
        jargonLevel = levelMatch ? levelMatch[1] : undefined;
      }
      detectedIntents = await detectIntentsWithContext(
        options.messages,
        transactionState,
        jargonLevel
      );
    } else {
      // No chat context, use simple keyword detection
      detectedIntents = detectIntents(options.messages);
    }
    basePrompt = buildModularPrompt(detectedIntents);
  } else {
    // Legacy mode: use provided prompt or import full SYSTEM_PROMPT
    basePrompt = options.basePrompt || BASE_PROMPT;
  }
  if (config.isTestnet) {
    // Replace mainnet chain IDs with testnet equivalents in the base prompt
    basePrompt = basePrompt
      // Replace chainId="1" instruction
      .replace(/chainId="1"/g, 'chainId="11155111"')
      .replace(/chainId='1'/g, "chainId='11155111'")
      // Replace chain ID references in examples
      .replace(/"value":"1","label":"Ethereum"/g, '"value":"11155111","label":"Sepolia"')
      .replace(/"value":"10","label":"Optimism"/g, '"value":"11155420","label":"OP Sepolia"')
      .replace(/"value":"8453","label":"Base"/g, '"value":"84532","label":"Base Sepolia"')
      .replace(/"value":"42161","label":"Arbitrum"/g, '"value":"421614","label":"Arb Sepolia"')
      // Replace chainId in JSON examples
      .replace(/"chainId":\s*"1"/g, '"chainId": "11155111"')
      .replace(/"chainId":\s*"10"/g, '"chainId": "11155420"')
      .replace(/"chainId":\s*"8453"/g, '"chainId": "84532"')
      .replace(/"chainId":\s*"42161"/g, '"chainId": "421614"')
      // Replace numeric chain IDs
      .replace(/"chainId":\s*1([,}\s])/g, '"chainId": 11155111$1')
      .replace(/"chainId":\s*10([,}\s])/g, '"chainId": 11155420$1')
      .replace(/"chainId":\s*8453([,}\s])/g, '"chainId": 84532$1')
      .replace(/"chainId":\s*42161([,}\s])/g, '"chainId": 421614$1')
      // Replace mainnet USDC addresses with testnet USDC
      .replace(/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/gi, '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') // ETH USDC -> Sepolia
      .replace(/0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85/gi, '0x5fd84259d66Cd46123540766Be93DFE6D43130D7') // OP USDC -> OP Sepolia
      .replace(/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/gi, '0x036CbD53842c5426634e7929541eC2318f3dCF7e') // Base USDC -> Base Sepolia
      .replace(/0xaf88d065e77c8cC2239327C5EDb3A432268e5831/gi, '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'); // Arb USDC -> Arb Sepolia
  }
  parts.push(basePrompt);

  // 1.5. Testnet environment context (critical for correct chain IDs)
  if (config.isTestnet) {
    parts.push(`

---

# ENVIRONMENT: TESTNET MODE

**CRITICAL**: You are running on TESTNET. Deploy to ALL 4 testnet chains using chainConfigs:

| Network | Chain ID | USDC Address |
|---------|----------|--------------|
| Sepolia | 11155111 | 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 |
| OP Sepolia | 11155420 | 0x5fd84259d66Cd46123540766Be93DFE6D43130D7 |
| Base Sepolia | 84532 | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |
| Arb Sepolia | 421614 | 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d |

**DO NOT use mainnet chain IDs (1, 10, 8453, 42161).**

**For launchProject/launch721Project, ALWAYS include chainConfigs with ALL 4 testnet chains:**

\`\`\`json
"chainConfigs": [
  {"chainId": "11155111", "label": "Sepolia", "overrides": {
    "terminalConfigurations": [
      {"terminal": "0x52869db3d61dde1e391967f2ce5039ad0ecd371c", "accountingContextsToAccept": [{"token": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", "decimals": 6, "currency": 909516616}]},
      {"terminal": "0x1ce40d201cdec791de05810d17aaf501be167422", "accountingContextsToAccept": []}
    ]
  }},
  {"chainId": "11155420", "label": "OP Sepolia", "overrides": {
    "terminalConfigurations": [
      {"terminal": "0x52869db3d61dde1e391967f2ce5039ad0ecd371c", "accountingContextsToAccept": [{"token": "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", "decimals": 6, "currency": 3530704773}]},
      {"terminal": "0x1ce40d201cdec791de05810d17aaf501be167422", "accountingContextsToAccept": []}
    ]
  }},
  {"chainId": "84532", "label": "Base Sepolia", "overrides": {
    "terminalConfigurations": [
      {"terminal": "0x52869db3d61dde1e391967f2ce5039ad0ecd371c", "accountingContextsToAccept": [{"token": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "decimals": 6, "currency": 3169378579}]},
      {"terminal": "0x1ce40d201cdec791de05810d17aaf501be167422", "accountingContextsToAccept": []}
    ]
  }},
  {"chainId": "421614", "label": "Arb Sepolia", "overrides": {
    "terminalConfigurations": [
      {"terminal": "0x52869db3d61dde1e391967f2ce5039ad0ecd371c", "accountingContextsToAccept": [{"token": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", "decimals": 6, "currency": 1156540465}]},
      {"terminal": "0x1ce40d201cdec791de05810d17aaf501be167422", "accountingContextsToAccept": []}
    ]
  }}
]
\`\`\`

**Terminal addresses (same on mainnet and testnet via CREATE2):**
- JBMultiTerminal5_1: 0x52869db3d61dde1e391967f2ce5039ad0ecd371c
- JBSwapTerminalUSDCRegistry: 0x1ce40d201cdec791de05810d17aaf501be167422

`);
  }

  // 2. Omnichain knowledge (existing functionality)
  if (options.includeOmnichain !== false && options.omnichainContext) {
    parts.push('\n\n---\n\n# Knowledge Base\n');
    parts.push(options.omnichainContext);
  }

  // 3. Build optimized context if we have a chat
  if (options.chatId) {
    context = await buildOptimizedContext(options.chatId, options.userId);

    // 4. User context
    if (context.userContext) {
      parts.push('\n\n---\n\n');
      parts.push(context.userContext);
    }

    // 5. Transaction state (project design)
    if (context.transactionState) {
      const stateFormatted = formatStateForPrompt(context.transactionState);
      if (stateFormatted.length > 50) { // Only include if meaningful
        parts.push('\n\n---\n\n# Current Project Design\n');
        parts.push(stateFormatted);
      }
    }

    // 6. Participant context (multi-user)
    if (context.participantContext) {
      parts.push('\n\n---\n\n');
      parts.push(context.participantContext);
    }

    // 7. Attachment summaries
    if (context.attachmentSummaries.length > 0) {
      parts.push('\n\n---\n\n');
      parts.push(formatAttachmentSummariesForPrompt(context.attachmentSummaries));
    }

    // 8. Add modular prompt info to context metadata
    if (detectedIntents && context) {
      context.metadata.modularPrompt = {
        estimatedTokens: estimateModularPromptTokens(detectedIntents),
        modulesLoaded: getLoadedModules(detectedIntents),
        reasons: detectedIntents.reasons,
      };
    }
  }

  return {
    systemPrompt: parts.join(''),
    context,
    intents: detectedIntents,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// TOKEN_BUDGET is exported at definition
