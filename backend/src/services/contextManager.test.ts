/**
 * Context Manager Service Tests
 *
 * Tests token budgeting, context building, and formatting logic.
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ============================================================================
// Token Estimation Tests
// ============================================================================

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

Deno.test('estimateTokens - basic estimation', async (t) => {
  await t.step('estimates ~4 chars per token', () => {
    assertEquals(estimateTokens('1234'), 1);
    assertEquals(estimateTokens('12345678'), 2);
    assertEquals(estimateTokens('123456789012'), 3);
  });

  await t.step('rounds up partial tokens', () => {
    assertEquals(estimateTokens('12345'), 2); // 5/4 = 1.25 -> 2
    assertEquals(estimateTokens('1234567'), 2); // 7/4 = 1.75 -> 2
  });

  await t.step('handles empty string', () => {
    assertEquals(estimateTokens(''), 0);
  });

  await t.step('handles long text', () => {
    const longText = 'x'.repeat(1000);
    assertEquals(estimateTokens(longText), 250);
  });
});

// ============================================================================
// Token Budget Tests
// ============================================================================

const TOKEN_BUDGET = {
  total: 50000,
  transactionState: 2000,
  userContext: 1000,
  participantContext: 500,
  attachmentSummaries: 3000,
  summaries: 10000,
};

Deno.test('TOKEN_BUDGET - allocations sum correctly', async (t) => {
  await t.step('fixed allocations leave room for messages', () => {
    const fixedTotal =
      TOKEN_BUDGET.transactionState +
      TOKEN_BUDGET.userContext +
      TOKEN_BUDGET.participantContext +
      TOKEN_BUDGET.attachmentSummaries +
      TOKEN_BUDGET.summaries;

    const remainingForMessages = TOKEN_BUDGET.total - fixedTotal;

    // Should leave at least 30k for recent messages
    assertEquals(remainingForMessages >= 30000, true);
    assertEquals(remainingForMessages, 33500);
  });

  await t.step('each allocation is reasonable', () => {
    // Transaction state should be enough for detailed project config
    assertEquals(TOKEN_BUDGET.transactionState >= 1000, true);

    // Summaries should be enough to compress significant history
    assertEquals(TOKEN_BUDGET.summaries >= 5000, true);
  });
});

// ============================================================================
// Context Metadata Tests
// ============================================================================

interface ContextMetadata {
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
}

function calculateTotalTokens(metadata: Omit<ContextMetadata, 'totalTokens' | 'budgetExceeded' | 'triggeredSummarization'>): number {
  return (
    metadata.recentMessageTokens +
    metadata.transactionStateTokens +
    metadata.summaryTokens +
    metadata.attachmentSummaryTokens +
    metadata.userContextTokens +
    metadata.participantContextTokens
  );
}

Deno.test('ContextMetadata - total calculation', async (t) => {
  await t.step('sums all token counts', () => {
    const metadata = {
      recentMessageTokens: 20000,
      transactionStateTokens: 1500,
      summaryTokens: 5000,
      attachmentSummaryTokens: 2000,
      userContextTokens: 800,
      participantContextTokens: 300,
      recentMessageCount: 25,
      summaryCount: 1,
      attachmentCount: 2,
    };

    const total = calculateTotalTokens(metadata);
    assertEquals(total, 29600);
  });

  await t.step('handles zero values', () => {
    const metadata = {
      recentMessageTokens: 10000,
      transactionStateTokens: 0,
      summaryTokens: 0,
      attachmentSummaryTokens: 0,
      userContextTokens: 0,
      participantContextTokens: 0,
      recentMessageCount: 10,
      summaryCount: 0,
      attachmentCount: 0,
    };

    const total = calculateTotalTokens(metadata);
    assertEquals(total, 10000);
  });
});

// ============================================================================
// Budget Enforcement Tests
// ============================================================================

function enforceTokenBudget(
  items: Array<{ tokenCount: number }>,
  budget: number
): Array<{ tokenCount: number }> {
  const result: Array<{ tokenCount: number }> = [];
  let used = 0;

  for (const item of items) {
    if (used + item.tokenCount <= budget) {
      result.push(item);
      used += item.tokenCount;
    } else {
      break;
    }
  }

  return result;
}

Deno.test('enforceTokenBudget - respects limits', async (t) => {
  await t.step('includes items within budget', () => {
    const items = [
      { tokenCount: 100 },
      { tokenCount: 200 },
      { tokenCount: 150 },
    ];
    const result = enforceTokenBudget(items, 500);
    assertEquals(result.length, 3);
  });

  await t.step('stops at budget limit', () => {
    const items = [
      { tokenCount: 100 },
      { tokenCount: 200 },
      { tokenCount: 300 },
    ];
    const result = enforceTokenBudget(items, 350);
    assertEquals(result.length, 2);
  });

  await t.step('handles exact budget match', () => {
    const items = [
      { tokenCount: 100 },
      { tokenCount: 200 },
    ];
    const result = enforceTokenBudget(items, 300);
    assertEquals(result.length, 2);
  });

  await t.step('handles empty input', () => {
    const result = enforceTokenBudget([], 1000);
    assertEquals(result.length, 0);
  });

  await t.step('handles first item exceeding budget', () => {
    const items = [{ tokenCount: 500 }];
    const result = enforceTokenBudget(items, 100);
    assertEquals(result.length, 0);
  });
});

// ============================================================================
// Summary Formatting Tests
// ============================================================================

interface ChatSummary {
  summaryMd: string;
  messageCount: number;
}

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

Deno.test('formatSummariesForContext - output structure', async (t) => {
  await t.step('includes header', () => {
    const summaries = [{ summaryMd: 'Test summary', messageCount: 10 }];
    const result = formatSummariesForContext(summaries);
    assertEquals(result.includes('# Previous Context (Summarized)'), true);
  });

  await t.step('includes message count', () => {
    const summaries = [{ summaryMd: 'Test summary', messageCount: 42 }];
    const result = formatSummariesForContext(summaries);
    assertEquals(result.includes('Summarized from 42 messages'), true);
  });

  await t.step('includes summary content', () => {
    const summaries = [{ summaryMd: '## Key Decisions\n- Decision 1', messageCount: 10 }];
    const result = formatSummariesForContext(summaries);
    assertEquals(result.includes('## Key Decisions'), true);
    assertEquals(result.includes('- Decision 1'), true);
  });

  await t.step('handles multiple summaries', () => {
    const summaries = [
      { summaryMd: 'Summary 1', messageCount: 10 },
      { summaryMd: 'Summary 2', messageCount: 20 },
    ];
    const result = formatSummariesForContext(summaries);
    assertEquals(result.includes('Summary 1'), true);
    assertEquals(result.includes('Summary 2'), true);
  });

  await t.step('handles empty array', () => {
    const result = formatSummariesForContext([]);
    assertEquals(result.includes('# Previous Context'), true);
    assertEquals(result.length > 0, true);
  });
});

// ============================================================================
// Attachment Summary Formatting Tests
// ============================================================================

interface AttachmentSummary {
  originalFilename?: string;
  summaryMd: string;
}

function formatAttachmentSummariesForPrompt(summaries: AttachmentSummary[]): string {
  if (summaries.length === 0) return '';

  const parts: string[] = [];
  parts.push('# Uploaded Documents');
  parts.push('');

  for (const summary of summaries) {
    const filename = summary.originalFilename || 'Attachment';
    parts.push(`## ${filename}`);
    parts.push('');
    parts.push(summary.summaryMd);
    parts.push('');
  }

  return parts.join('\n');
}

Deno.test('formatAttachmentSummariesForPrompt - output structure', async (t) => {
  await t.step('returns empty string for no attachments', () => {
    const result = formatAttachmentSummariesForPrompt([]);
    assertEquals(result, '');
  });

  await t.step('includes header for attachments', () => {
    const summaries = [{ summaryMd: 'PDF summary', originalFilename: 'doc.pdf' }];
    const result = formatAttachmentSummariesForPrompt(summaries);
    assertEquals(result.includes('# Uploaded Documents'), true);
  });

  await t.step('includes filename as heading', () => {
    const summaries = [{ summaryMd: 'Summary content', originalFilename: 'pitch-deck.pdf' }];
    const result = formatAttachmentSummariesForPrompt(summaries);
    assertEquals(result.includes('## pitch-deck.pdf'), true);
  });

  await t.step('uses default name when filename missing', () => {
    const summaries = [{ summaryMd: 'Summary content' }];
    const result = formatAttachmentSummariesForPrompt(summaries);
    assertEquals(result.includes('## Attachment'), true);
  });

  await t.step('includes summary content', () => {
    const summaries = [{
      summaryMd: '## Content Type\nBusiness plan document',
      originalFilename: 'plan.pdf',
    }];
    const result = formatAttachmentSummariesForPrompt(summaries);
    assertEquals(result.includes('Business plan document'), true);
  });
});

// ============================================================================
// Participant Context Tests
// ============================================================================

interface ParticipantInfo {
  address: string;
  displayName?: string;
  role: string;
}

function formatParticipantsForPrompt(participants: ParticipantInfo[]): string | null {
  if (participants.length <= 1) return null;

  const lines: string[] = ['# Chat Participants', ''];

  for (const p of participants) {
    const name = p.displayName || formatAddress(p.address);
    const roleLabel = p.role === 'founder' ? '(founder)' : p.role === 'admin' ? '(admin)' : '';
    lines.push(`- ${name} ${roleLabel}`.trim());
  }

  lines.push('');
  lines.push('_Address messages appropriately. Reference participants by name when relevant._');

  return lines.join('\n');
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

Deno.test('formatParticipantsForPrompt - output structure', async (t) => {
  await t.step('returns null for single participant', () => {
    const participants = [{ address: '0x1234567890123456789012345678901234567890', role: 'founder' }];
    const result = formatParticipantsForPrompt(participants);
    assertEquals(result, null);
  });

  await t.step('returns null for empty array', () => {
    const result = formatParticipantsForPrompt([]);
    assertEquals(result, null);
  });

  await t.step('includes header for multiple participants', () => {
    const participants = [
      { address: '0x1234567890123456789012345678901234567890', role: 'founder' },
      { address: '0xabcdef1234567890123456789012345678901234', role: 'member' },
    ];
    const result = formatParticipantsForPrompt(participants);
    assertExists(result);
    assertEquals(result.includes('# Chat Participants'), true);
  });

  await t.step('uses display name when available', () => {
    const participants = [
      { address: '0x1234567890123456789012345678901234567890', displayName: 'Alice', role: 'founder' },
      { address: '0xabcdef1234567890123456789012345678901234', displayName: 'Bob', role: 'member' },
    ];
    const result = formatParticipantsForPrompt(participants);
    assertExists(result);
    assertEquals(result.includes('Alice'), true);
    assertEquals(result.includes('Bob'), true);
  });

  await t.step('formats address when no display name', () => {
    const participants = [
      { address: '0x1234567890123456789012345678901234567890', role: 'founder' },
      { address: '0xabcdef1234567890123456789012345678901234', role: 'member' },
    ];
    const result = formatParticipantsForPrompt(participants);
    assertExists(result);
    assertEquals(result.includes('0x1234...7890'), true);
  });

  await t.step('includes role labels', () => {
    const participants = [
      { address: '0x1234567890123456789012345678901234567890', role: 'founder' },
      { address: '0xabcdef1234567890123456789012345678901234', role: 'admin' },
      { address: '0x9876543210987654321098765432109876543210', role: 'member' },
    ];
    const result = formatParticipantsForPrompt(participants);
    assertExists(result);
    assertEquals(result.includes('(founder)'), true);
    assertEquals(result.includes('(admin)'), true);
  });
});

// ============================================================================
// Message Selection Tests
// ============================================================================

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  tokenCount?: number;
}

function selectMessagesWithBudget(
  messages: ChatMessage[],
  budget: number
): { messages: ChatMessage[]; tokenCount: number } {
  const result: ChatMessage[] = [];
  let totalTokens = 0;

  // Start from the end (most recent) and work backwards
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = msg.tokenCount || estimateTokens(msg.content);

    if (totalTokens + tokens > budget && result.length > 0) {
      break;
    }

    result.unshift(msg);
    totalTokens += tokens;
  }

  return { messages: result, tokenCount: totalTokens };
}

Deno.test('selectMessagesWithBudget - respects budget', async (t) => {
  await t.step('includes all messages within budget', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello', tokenCount: 100 },
      { role: 'assistant', content: 'Hi there', tokenCount: 100 },
      { role: 'user', content: 'How are you?', tokenCount: 100 },
    ];
    const result = selectMessagesWithBudget(messages, 500);
    assertEquals(result.messages.length, 3);
    assertEquals(result.tokenCount, 300);
  });

  await t.step('prioritizes recent messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Old message 1', tokenCount: 100 },
      { role: 'assistant', content: 'Old message 2', tokenCount: 100 },
      { role: 'user', content: 'Recent message', tokenCount: 100 },
    ];
    const result = selectMessagesWithBudget(messages, 150);
    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0].content, 'Recent message');
  });

  await t.step('maintains chronological order', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'First', tokenCount: 50 },
      { role: 'assistant', content: 'Second', tokenCount: 50 },
      { role: 'user', content: 'Third', tokenCount: 50 },
    ];
    const result = selectMessagesWithBudget(messages, 200);
    assertEquals(result.messages[0].content, 'First');
    assertEquals(result.messages[1].content, 'Second');
    assertEquals(result.messages[2].content, 'Third');
  });

  await t.step('handles empty array', () => {
    const result = selectMessagesWithBudget([], 1000);
    assertEquals(result.messages.length, 0);
    assertEquals(result.tokenCount, 0);
  });

  await t.step('estimates tokens when not provided', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(400) }, // ~100 tokens
    ];
    const result = selectMessagesWithBudget(messages, 200);
    assertEquals(result.messages.length, 1);
    assertEquals(result.tokenCount, 100);
  });
});

// ============================================================================
// Context Injection Tests
// ============================================================================

function injectSummaryIntoMessages(
  messages: ChatMessage[],
  summaryContent: string
): ChatMessage[] {
  if (messages.length === 0) return messages;

  const result = [...messages];

  // Inject into first user message
  if (result[0].role === 'user') {
    const originalContent = result[0].content;
    result[0] = {
      ...result[0],
      content: `${summaryContent}\n\n---\n\n${originalContent}`,
    };
  }

  return result;
}

Deno.test('injectSummaryIntoMessages - prepends to first user message', async (t) => {
  await t.step('prepends summary to first user message', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ];
    const result = injectSummaryIntoMessages(messages, '# Summary');
    assertEquals(result[0].content.startsWith('# Summary'), true);
    assertEquals(result[0].content.includes('Hello'), true);
  });

  await t.step('includes separator', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
    ];
    const result = injectSummaryIntoMessages(messages, '# Summary');
    assertEquals(result[0].content.includes('---'), true);
  });

  await t.step('returns original if first message is assistant', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'Welcome' },
      { role: 'user', content: 'Hello' },
    ];
    const result = injectSummaryIntoMessages(messages, '# Summary');
    assertEquals(result[0].content, 'Welcome');
  });

  await t.step('handles empty array', () => {
    const result = injectSummaryIntoMessages([], '# Summary');
    assertEquals(result.length, 0);
  });

  await t.step('preserves other message properties', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello', tokenCount: 50 },
    ];
    const result = injectSummaryIntoMessages(messages, '# Summary');
    assertEquals(result[0].role, 'user');
  });
});
