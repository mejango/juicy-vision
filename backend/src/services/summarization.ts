/**
 * Summarization Service
 *
 * Implements anchored iterative summarization for long conversation context.
 * Key insight: Merge new summaries into existing rather than regenerating.
 * Structure forces preservation - dedicated sections prevent silent loss.
 *
 * This is Layer 3 of the context management system.
 */

import { query, queryOne, execute, transaction } from '../db/index.ts';

// ============================================================================
// Types
// ============================================================================

export interface StructuredSummary {
  keyDecisions: string[];
  projectDesign: string[];
  artifactReferences: string[];
  pendingItems: string[];
  contextSummary: string;
}

export interface ChatSummary {
  id: string;
  chatId: string;
  summaryMd: string;
  coversFromMessageId?: string;
  coversToMessageId?: string;
  coversFromCreatedAt?: Date;
  coversToCreatedAt?: Date;
  messageCount: number;
  originalTokenCount: number;
  summaryTokenCount: number;
  compressionRatio?: number;
  modelUsed?: string;
  createdAt: Date;
}

export interface AttachmentSummary {
  id: string;
  messageId: string;
  chatId: string;
  attachmentIndex: number;
  originalFilename?: string;
  originalMimeType?: string;
  summaryMd: string;
  extractedData?: Record<string, unknown>;
  tokenCount: number;
  createdAt: Date;
}

interface DbChatSummary {
  id: string;
  chat_id: string;
  summary_md: string;
  covers_from_message_id: string | null;
  covers_to_message_id: string | null;
  covers_from_created_at: Date | null;
  covers_to_created_at: Date | null;
  message_count: number;
  original_token_count: number;
  summary_token_count: number;
  compression_ratio: number | null;
  model_used: string | null;
  generation_latency_ms: number | null;
  created_at: Date;
}

interface DbAttachmentSummary {
  id: string;
  message_id: string;
  chat_id: string;
  attachment_index: number;
  original_filename: string | null;
  original_mime_type: string | null;
  summary_md: string;
  extracted_data: Record<string, unknown> | null;
  token_count: number;
  model_used: string | null;
  created_at: Date;
}

// ============================================================================
// Configuration
// ============================================================================

const SUMMARIZATION_CONFIG = {
  // Trigger summarization when recent messages exceed this count
  triggerThreshold: 30,

  // Keep this many recent messages as raw (not summarized)
  keepRecentCount: 10,

  // Target compression ratio (original tokens / summary tokens)
  targetCompressionRatio: 8,

  // Max tokens for a single summary
  maxSummaryTokens: 2000,

  // Model to use for summarization
  model: 'claude-sonnet-4-20250514',
};

// ============================================================================
// Summarization Prompt
// ============================================================================

const SUMMARIZATION_PROMPT = `You are summarizing a conversation segment for context preservation in an ongoing chat.

CRITICAL: You MUST populate each section below. Empty sections indicate LOST information.
If a section truly has nothing, write "(none in this segment)".

## Key Decisions
[List EVERY decision made - project names, amounts, configurations, agreements, confirmations]
- Use bullet points
- Be specific: "Chose 10% reserved rate" not "discussed reserved rate"
- Include WHO decided and WHAT they chose

## Project Design
[ALL project parameters discussed - tiers, rates, chains, addresses, splits, etc.]
- List concrete values, not just topics
- Include partial/tentative values too

## Artifact References
[ALL files, documents, links, images mentioned - preserve EXACT names and types]
- pitch-deck.pdf - 12 slides covering...
- logo.png - red/orange gradient design
- https://example.com - competitor reference

## Pending Items
[Questions asked but not answered, items to follow up on, incomplete decisions]
- Mark clearly if something was asked but not resolved
- Include who needs to answer

## Context Summary
[2-3 sentence narrative of the conversation flow - what happened, who said what, where did the conversation leave off?]

---

REMEMBER:
- Preserve specific numbers, addresses, amounts, percentages
- Keep exact artifact/file names
- Note who said what for key decisions
- Mark pending vs confirmed items clearly
- If unsure, include it rather than omit it`;

// ============================================================================
// Core Summarization
// ============================================================================

/**
 * Generate a structured summary from a set of messages
 */
export async function generateSummary(
  messages: Array<{ role: string; content: string; createdAt?: Date }>,
  existingSummary?: string
): Promise<{ summary: string; tokenCount: number }> {
  const { sendMessage } = await import('./claude.ts');

  // Build the message content to summarize
  const conversationText = messages
    .map(m => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 2000)}`)
    .join('\n\n');

  // If we have an existing summary, we're doing anchored merge
  let prompt = `Summarize this conversation segment:\n\n${conversationText}`;

  if (existingSummary) {
    prompt = `You have an EXISTING summary of earlier messages. Now summarize NEW messages and MERGE them together.

EXISTING SUMMARY:
${existingSummary}

NEW MESSAGES TO INTEGRATE:
${conversationText}

Create a MERGED summary that:
1. Preserves all key info from existing summary
2. Adds new information from the messages
3. Updates any items that changed (e.g., pending -> decided)
4. Removes truly outdated/superseded information`;
  }

  const startTime = Date.now();

  try {
    const response = await sendMessage('system', {
      messages: [{ role: 'user', content: prompt }],
      system: SUMMARIZATION_PROMPT,
      maxTokens: SUMMARIZATION_CONFIG.maxSummaryTokens,
      temperature: 0.3,
      includeOmnichainContext: false,
    });

    const summary = response.content;
    const tokenCount = response.usage.outputTokens;
    const latency = Date.now() - startTime;

    console.log(`Generated summary: ${tokenCount} tokens in ${latency}ms`);

    return { summary, tokenCount };
  } catch (error) {
    console.error('Failed to generate summary:', error);
    throw error;
  }
}

/**
 * Check if a chat needs summarization and trigger if so
 */
export async function checkAndTriggerSummarization(chatId: string): Promise<boolean> {
  // Get message count and last summarized position
  const stats = await queryOne<{
    total_count: number;
    last_summarized_id: string | null;
    unsummarized_count: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM multi_chat_messages WHERE chat_id = $1 AND deleted_at IS NULL) as total_count,
       mc.last_summarized_message_id as last_summarized_id,
       (SELECT COUNT(*) FROM multi_chat_messages m
        WHERE m.chat_id = $1
        AND m.deleted_at IS NULL
        AND (mc.last_summarized_message_id IS NULL OR m.created_at > (
          SELECT created_at FROM multi_chat_messages WHERE id = mc.last_summarized_message_id
        ))
       ) as unsummarized_count
     FROM multi_chats mc
     WHERE mc.id = $1`,
    [chatId]
  );

  if (!stats) return false;

  // Check if we need to summarize
  if (stats.unsummarized_count < SUMMARIZATION_CONFIG.triggerThreshold) {
    return false;
  }

  console.log(`Triggering summarization for chat ${chatId}: ${stats.unsummarized_count} unsummarized messages`);

  // Run summarization asynchronously
  performSummarization(chatId).catch(err => {
    console.error(`Summarization failed for chat ${chatId}:`, err);
  });

  return true;
}

/**
 * Perform the actual summarization
 */
async function performSummarization(chatId: string): Promise<void> {
  // Get the latest summary (for anchored merge)
  const latestSummary = await queryOne<DbChatSummary>(
    `SELECT * FROM chat_summaries
     WHERE chat_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [chatId]
  );

  // Get messages to summarize
  // Keep the last N messages raw, summarize the rest
  const messagesToSummarize = await query<{
    id: string;
    role: string;
    content: string;
    created_at: Date;
    token_count: number | null;
  }>(
    `WITH ordered_messages AS (
       SELECT id, role, content, created_at, token_count,
              ROW_NUMBER() OVER (ORDER BY created_at DESC) as rn
       FROM multi_chat_messages
       WHERE chat_id = $1
       AND deleted_at IS NULL
       ${latestSummary?.covers_to_created_at
         ? `AND created_at > $2`
         : ''}
     )
     SELECT id, role, content, created_at, token_count
     FROM ordered_messages
     WHERE rn > $${latestSummary?.covers_to_created_at ? '3' : '2'}
     ORDER BY created_at ASC`,
    latestSummary?.covers_to_created_at
      ? [chatId, latestSummary.covers_to_created_at, SUMMARIZATION_CONFIG.keepRecentCount]
      : [chatId, SUMMARIZATION_CONFIG.keepRecentCount]
  );

  if (messagesToSummarize.length === 0) {
    return;
  }

  // Calculate original token count (estimate if not stored)
  const originalTokenCount = messagesToSummarize.reduce((sum, m) => {
    return sum + (m.token_count || estimateTokens(m.content));
  }, 0);

  // Generate summary (merge with existing if present)
  const { summary, tokenCount } = await generateSummary(
    messagesToSummarize.map(m => ({
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
    })),
    latestSummary?.summary_md
  );

  // Store the summary
  const firstMessage = messagesToSummarize[0];
  const lastMessage = messagesToSummarize[messagesToSummarize.length - 1];

  await execute(
    `INSERT INTO chat_summaries (
       chat_id, summary_md, covers_from_message_id, covers_to_message_id,
       covers_from_created_at, covers_to_created_at, message_count,
       original_token_count, summary_token_count, model_used
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      chatId,
      summary,
      firstMessage.id,
      lastMessage.id,
      firstMessage.created_at,
      lastMessage.created_at,
      messagesToSummarize.length,
      originalTokenCount,
      tokenCount,
      SUMMARIZATION_CONFIG.model,
    ]
  );

  // Update the chat's last summarized message pointer
  await execute(
    `UPDATE multi_chats SET last_summarized_message_id = $1 WHERE id = $2`,
    [lastMessage.id, chatId]
  );

  console.log(
    `Summarized ${messagesToSummarize.length} messages for chat ${chatId}: ` +
    `${originalTokenCount} -> ${tokenCount} tokens (${(originalTokenCount / tokenCount).toFixed(1)}x compression)`
  );
}

// ============================================================================
// Attachment Summarization
// ============================================================================

const ATTACHMENT_SUMMARY_PROMPT = `You are analyzing an uploaded document/image. Extract and summarize the key information.

Return a structured summary:

## Content Type
[What kind of document is this? Pitch deck, business plan, financial statement, screenshot, logo, etc.]

## Key Information
[Bullet points of the most important facts, figures, names, dates]

## Notable Quotes or Sections
[Any particularly relevant quotes or sections, verbatim if important]

## Extracted Data
[Any structured data you can extract: numbers, addresses, dates, lists]

## Context Relevance
[How does this relate to project creation/fundraising?]

Be concise but comprehensive. Preserve specific numbers, names, and key facts.`;

/**
 * Generate summary for an attachment
 */
export async function summarizeAttachment(
  messageId: string,
  chatId: string,
  attachmentIndex: number,
  attachment: {
    type: 'image' | 'document';
    mimeType: string;
    data: string; // base64
    filename?: string;
  }
): Promise<AttachmentSummary> {
  const { sendMessage } = await import('./claude.ts');

  // Check if already summarized
  const existing = await queryOne<DbAttachmentSummary>(
    `SELECT * FROM attachment_summaries WHERE message_id = $1 AND attachment_index = $2`,
    [messageId, attachmentIndex]
  );

  if (existing) {
    return dbToAttachmentSummary(existing);
  }

  // Build multimodal message
  const content = attachment.type === 'image'
    ? [
        { type: 'image' as const, source: { type: 'base64' as const, media_type: attachment.mimeType, data: attachment.data } },
        { type: 'text' as const, text: 'Analyze and summarize this image.' },
      ]
    : [
        { type: 'document' as const, source: { type: 'base64' as const, media_type: attachment.mimeType, data: attachment.data } },
        { type: 'text' as const, text: 'Analyze and summarize this document.' },
      ];

  try {
    const response = await sendMessage('system', {
      messages: [{ role: 'user', content }],
      system: ATTACHMENT_SUMMARY_PROMPT,
      maxTokens: 1500,
      temperature: 0.3,
      includeOmnichainContext: false,
    });

    const summaryMd = response.content;
    const tokenCount = response.usage.outputTokens;

    // Try to extract structured data from the summary
    const extractedData = parseExtractedData(summaryMd);

    // Store the summary
    const result = await queryOne<DbAttachmentSummary>(
      `INSERT INTO attachment_summaries (
         message_id, chat_id, attachment_index, original_filename,
         original_mime_type, summary_md, extracted_data, token_count, model_used
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       RETURNING *`,
      [
        messageId,
        chatId,
        attachmentIndex,
        attachment.filename || null,
        attachment.mimeType,
        summaryMd,
        JSON.stringify(extractedData),
        tokenCount,
        SUMMARIZATION_CONFIG.model,
      ]
    );

    if (!result) {
      throw new Error('Failed to store attachment summary');
    }

    return dbToAttachmentSummary(result);
  } catch (error) {
    console.error('Failed to summarize attachment:', error);
    throw error;
  }
}

/**
 * Queue attachment for background summarization
 */
export function queueAttachmentSummary(
  messageId: string,
  chatId: string,
  attachmentIndex: number,
  attachment: {
    type: 'image' | 'document';
    mimeType: string;
    data: string;
    filename?: string;
  }
): void {
  // Run in background, don't block
  summarizeAttachment(messageId, chatId, attachmentIndex, attachment)
    .then(() => {
      console.log(`Summarized attachment ${attachmentIndex} for message ${messageId}`);
    })
    .catch(err => {
      console.error(`Failed to summarize attachment ${attachmentIndex} for message ${messageId}:`, err);
    });
}

// ============================================================================
// Retrieval
// ============================================================================

/**
 * Get all summaries for a chat
 */
export async function getChatSummaries(chatId: string): Promise<ChatSummary[]> {
  const results = await query<DbChatSummary>(
    `SELECT * FROM chat_summaries
     WHERE chat_id = $1
     ORDER BY created_at DESC`,
    [chatId]
  );

  return results.map(dbToChatSummary);
}

/**
 * Get the most recent summary for a chat
 */
export async function getLatestSummary(chatId: string): Promise<ChatSummary | null> {
  const result = await queryOne<DbChatSummary>(
    `SELECT * FROM chat_summaries
     WHERE chat_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [chatId]
  );

  return result ? dbToChatSummary(result) : null;
}

/**
 * Get all attachment summaries for a chat
 */
export async function getAttachmentSummaries(chatId: string): Promise<AttachmentSummary[]> {
  const results = await query<DbAttachmentSummary>(
    `SELECT * FROM attachment_summaries
     WHERE chat_id = $1
     ORDER BY created_at DESC`,
    [chatId]
  );

  return results.map(dbToAttachmentSummary);
}

/**
 * Get attachment summaries for a specific message
 */
export async function getMessageAttachmentSummaries(messageId: string): Promise<AttachmentSummary[]> {
  const results = await query<DbAttachmentSummary>(
    `SELECT * FROM attachment_summaries
     WHERE message_id = $1
     ORDER BY attachment_index`,
    [messageId]
  );

  return results.map(dbToAttachmentSummary);
}

// ============================================================================
// Helpers
// ============================================================================

function dbToChatSummary(db: DbChatSummary): ChatSummary {
  return {
    id: db.id,
    chatId: db.chat_id,
    summaryMd: db.summary_md,
    coversFromMessageId: db.covers_from_message_id || undefined,
    coversToMessageId: db.covers_to_message_id || undefined,
    coversFromCreatedAt: db.covers_from_created_at || undefined,
    coversToCreatedAt: db.covers_to_created_at || undefined,
    messageCount: db.message_count,
    originalTokenCount: db.original_token_count,
    summaryTokenCount: db.summary_token_count,
    compressionRatio: db.compression_ratio || undefined,
    modelUsed: db.model_used || undefined,
    createdAt: db.created_at,
  };
}

function dbToAttachmentSummary(db: DbAttachmentSummary): AttachmentSummary {
  return {
    id: db.id,
    messageId: db.message_id,
    chatId: db.chat_id,
    attachmentIndex: db.attachment_index,
    originalFilename: db.original_filename || undefined,
    originalMimeType: db.original_mime_type || undefined,
    summaryMd: db.summary_md,
    extractedData: db.extracted_data || undefined,
    tokenCount: db.token_count,
    createdAt: db.created_at,
  };
}

/**
 * Estimate token count from text (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough estimate: 4 characters per token on average
  return Math.ceil(text.length / 4);
}

/**
 * Parse extracted data from summary text
 */
function parseExtractedData(summaryMd: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  // Look for ## Extracted Data section
  const dataMatch = summaryMd.match(/## Extracted Data\s*\n([\s\S]*?)(?=\n##|$)/);
  if (!dataMatch) return data;

  const dataSection = dataMatch[1];

  // Extract addresses
  const addresses = dataSection.match(/0x[a-fA-F0-9]{40}/g);
  if (addresses?.length) {
    data.addresses = [...new Set(addresses)];
  }

  // Extract numbers with context
  const numberPatterns = [
    /\$[\d,]+(?:\.\d{2})?/g, // Dollar amounts
    /[\d.]+\s*(?:ETH|USDC|USD)/gi, // Crypto amounts
    /[\d]+%/g, // Percentages
  ];

  const numbers: string[] = [];
  for (const pattern of numberPatterns) {
    const matches = dataSection.match(pattern);
    if (matches) numbers.push(...matches);
  }
  if (numbers.length) {
    data.amounts = [...new Set(numbers)];
  }

  // Extract dates
  const datePatterns = dataSection.match(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/gi);
  if (datePatterns?.length) {
    data.dates = [...new Set(datePatterns)];
  }

  return data;
}

// All functions are exported at their definitions
