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

export const TOKEN_BUDGET = {
  // Total context budget (conservative to leave room for response)
  total: 50000,

  // Fixed allocations (always included)
  transactionState: 2000,
  userContext: 1000,
  participantContext: 500,

  // Variable allocations
  attachmentSummaries: 3000,
  summaries: 10000,

  // Remainder goes to recent messages
  // recentMessages = total - fixed - variable = ~33500
};

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
 */
export async function buildEnhancedSystemPrompt(options: {
  basePrompt: string;
  chatId?: string;
  userId?: string;
  includeOmnichain?: boolean;
  omnichainContext?: string;
}): Promise<{ systemPrompt: string; context: OptimizedContext | null }> {
  const parts: string[] = [];
  let context: OptimizedContext | null = null;
  const config = getConfig();

  // 1. Base system prompt (transformed for testnet if needed)
  let basePrompt = options.basePrompt;
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
  }

  return {
    systemPrompt: parts.join(''),
    context,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// TOKEN_BUDGET is exported at definition
