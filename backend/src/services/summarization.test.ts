/**
 * Summarization Service Tests
 *
 * Tests token estimation, summary parsing, and compression logic.
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ============================================================================
// Token Estimation Tests
// ============================================================================

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

Deno.test('estimateTokens - character to token ratio', async (t) => {
  await t.step('handles typical message lengths', () => {
    // Short message
    assertEquals(estimateTokens('Hello'), 2);

    // Medium message
    const medium = 'This is a medium length message with some content.';
    const mediumTokens = estimateTokens(medium);
    assertEquals(mediumTokens > 10, true);
    assertEquals(mediumTokens < 20, true);

    // Long message
    const long = 'x'.repeat(4000);
    assertEquals(estimateTokens(long), 1000);
  });

  await t.step('handles special characters', () => {
    const withEmoji = 'Hello 👋 World 🌍';
    const tokens = estimateTokens(withEmoji);
    assertEquals(tokens > 0, true);
  });

  await t.step('handles newlines and whitespace', () => {
    const multiline = 'Line 1\nLine 2\nLine 3';
    const tokens = estimateTokens(multiline);
    assertEquals(tokens > 0, true);
  });
});

// ============================================================================
// Compression Ratio Tests
// ============================================================================

function calculateCompressionRatio(original: number, compressed: number): number {
  return compressed > 0 ? original / compressed : 0;
}

Deno.test('calculateCompressionRatio - standard cases', async (t) => {
  await t.step('calculates 8:1 compression', () => {
    const ratio = calculateCompressionRatio(8000, 1000);
    assertEquals(ratio, 8);
  });

  await t.step('calculates 4:1 compression', () => {
    const ratio = calculateCompressionRatio(4000, 1000);
    assertEquals(ratio, 4);
  });

  await t.step('handles zero compressed size', () => {
    const ratio = calculateCompressionRatio(1000, 0);
    assertEquals(ratio, 0);
  });

  await t.step('handles 1:1 ratio (no compression)', () => {
    const ratio = calculateCompressionRatio(1000, 1000);
    assertEquals(ratio, 1);
  });
});

// ============================================================================
// Summarization Trigger Tests
// ============================================================================

const SUMMARIZATION_CONFIG = {
  triggerThreshold: 30,
  keepRecentCount: 10,
  targetCompressionRatio: 8,
  maxSummaryTokens: 2000,
};

function shouldTriggerSummarization(unsummarizedCount: number): boolean {
  return unsummarizedCount >= SUMMARIZATION_CONFIG.triggerThreshold;
}

Deno.test('shouldTriggerSummarization - threshold behavior', async (t) => {
  await t.step('returns false below threshold', () => {
    assertEquals(shouldTriggerSummarization(10), false);
    assertEquals(shouldTriggerSummarization(20), false);
    assertEquals(shouldTriggerSummarization(29), false);
  });

  await t.step('returns true at threshold', () => {
    assertEquals(shouldTriggerSummarization(30), true);
  });

  await t.step('returns true above threshold', () => {
    assertEquals(shouldTriggerSummarization(31), true);
    assertEquals(shouldTriggerSummarization(50), true);
    assertEquals(shouldTriggerSummarization(100), true);
  });
});

function getMessagesToSummarize(
  totalMessages: number,
  alreadySummarized: number
): { start: number; end: number; count: number } {
  const unsummarized = totalMessages - alreadySummarized;
  const keepRaw = SUMMARIZATION_CONFIG.keepRecentCount;

  if (unsummarized <= keepRaw) {
    return { start: 0, end: 0, count: 0 };
  }

  const toSummarize = unsummarized - keepRaw;
  return {
    start: alreadySummarized,
    end: alreadySummarized + toSummarize,
    count: toSummarize,
  };
}

Deno.test('getMessagesToSummarize - message selection', async (t) => {
  await t.step('keeps last 10 raw when plenty of messages', () => {
    const result = getMessagesToSummarize(50, 0);
    assertEquals(result.count, 40); // 50 - 10 = 40
  });

  await t.step('skips already summarized', () => {
    const result = getMessagesToSummarize(50, 20);
    // 50 total, 20 summarized, 30 unsummarized
    // Keep 10 raw, summarize 20
    assertEquals(result.count, 20);
    assertEquals(result.start, 20);
    assertEquals(result.end, 40);
  });

  await t.step('returns zero when nothing to summarize', () => {
    const result = getMessagesToSummarize(10, 0);
    assertEquals(result.count, 0);
  });

  await t.step('returns zero when all summarized', () => {
    const result = getMessagesToSummarize(50, 40);
    assertEquals(result.count, 0);
  });
});

// ============================================================================
// Structured Summary Parsing Tests
// ============================================================================

interface StructuredSummary {
  keyDecisions: string[];
  projectDesign: string[];
  artifactReferences: string[];
  pendingItems: string[];
  contextSummary: string;
}

function parseStructuredSummary(markdown: string): Partial<StructuredSummary> {
  const result: Partial<StructuredSummary> = {};

  // Extract Key Decisions section
  const keyDecisionsMatch = markdown.match(/## Key Decisions\s*\n([\s\S]*?)(?=\n##|$)/);
  if (keyDecisionsMatch) {
    result.keyDecisions = extractBulletPoints(keyDecisionsMatch[1]);
  }

  // Extract Project Design section
  const projectDesignMatch = markdown.match(/## Project Design\s*\n([\s\S]*?)(?=\n##|$)/);
  if (projectDesignMatch) {
    result.projectDesign = extractBulletPoints(projectDesignMatch[1]);
  }

  // Extract Artifact References section
  const artifactsMatch = markdown.match(/## Artifact References\s*\n([\s\S]*?)(?=\n##|$)/);
  if (artifactsMatch) {
    result.artifactReferences = extractBulletPoints(artifactsMatch[1]);
  }

  // Extract Pending Items section
  const pendingMatch = markdown.match(/## Pending Items\s*\n([\s\S]*?)(?=\n##|$)/);
  if (pendingMatch) {
    result.pendingItems = extractBulletPoints(pendingMatch[1]);
  }

  // Extract Context Summary section
  const contextMatch = markdown.match(/## Context Summary\s*\n([\s\S]*?)(?=\n##|$)/);
  if (contextMatch) {
    result.contextSummary = contextMatch[1].trim();
  }

  return result;
}

function extractBulletPoints(text: string): string[] {
  const lines = text.split('\n');
  const bullets: string[] = [];

  for (const line of lines) {
    const match = line.match(/^[-*]\s+(.+)$/);
    if (match) {
      bullets.push(match[1].trim());
    }
  }

  return bullets;
}

Deno.test('parseStructuredSummary - extracts sections', async (t) => {
  const sampleSummary = `## Key Decisions
- Chose project name: "Garden Fund"
- Set funding goal at $50,000
- Selected Ethereum and Base chains

## Project Design
- Reserved rate: 10%
- Cash out tax: 5%
- Three contribution tiers

## Artifact References
- pitch-deck.pdf - 12 slides covering business model
- logo.png - green leaf design

## Pending Items
- Final tier pricing confirmation
- Payout split configuration

## Context Summary
The user is creating a community garden project. They've made progress on basic configuration but still need to finalize tiers and splits.`;

  await t.step('extracts key decisions', () => {
    const result = parseStructuredSummary(sampleSummary);
    assertExists(result.keyDecisions);
    assertEquals(result.keyDecisions?.length, 3);
    assertEquals(result.keyDecisions?.[0].includes('Garden Fund'), true);
  });

  await t.step('extracts project design', () => {
    const result = parseStructuredSummary(sampleSummary);
    assertExists(result.projectDesign);
    assertEquals(result.projectDesign?.length, 3);
    assertEquals(result.projectDesign?.some(d => d.includes('10%')), true);
  });

  await t.step('extracts artifact references', () => {
    const result = parseStructuredSummary(sampleSummary);
    assertExists(result.artifactReferences);
    assertEquals(result.artifactReferences?.length, 2);
    assertEquals(result.artifactReferences?.some(a => a.includes('pitch-deck')), true);
  });

  await t.step('extracts pending items', () => {
    const result = parseStructuredSummary(sampleSummary);
    assertExists(result.pendingItems);
    assertEquals(result.pendingItems?.length, 2);
  });

  await t.step('extracts context summary', () => {
    const result = parseStructuredSummary(sampleSummary);
    assertExists(result.contextSummary);
    assertEquals(result.contextSummary?.includes('community garden'), true);
  });
});

Deno.test('parseStructuredSummary - handles missing sections', async (t) => {
  const partialSummary = `## Key Decisions
- Single decision made

## Context Summary
Brief summary.`;

  await t.step('handles missing optional sections', () => {
    const result = parseStructuredSummary(partialSummary);
    assertEquals(result.keyDecisions?.length, 1);
    assertEquals(result.projectDesign, undefined);
    assertEquals(result.artifactReferences, undefined);
    assertEquals(result.pendingItems, undefined);
    assertExists(result.contextSummary);
  });
});

Deno.test('extractBulletPoints - handles various formats', async (t) => {
  await t.step('extracts hyphen bullets', () => {
    const text = `- Item 1
- Item 2
- Item 3`;
    const result = extractBulletPoints(text);
    assertEquals(result.length, 3);
  });

  await t.step('extracts asterisk bullets', () => {
    const text = `* Item A
* Item B`;
    const result = extractBulletPoints(text);
    assertEquals(result.length, 2);
  });

  await t.step('ignores non-bullet lines', () => {
    const text = `Some intro text
- Bullet item
Regular line
- Another bullet`;
    const result = extractBulletPoints(text);
    assertEquals(result.length, 2);
  });

  await t.step('trims whitespace', () => {
    const text = `-   Spaced item   `;
    const result = extractBulletPoints(text);
    assertEquals(result[0], 'Spaced item');
  });

  await t.step('handles empty input', () => {
    const result = extractBulletPoints('');
    assertEquals(result.length, 0);
  });
});

// ============================================================================
// Data Extraction Tests
// ============================================================================

function parseExtractedData(summaryMd: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  const dataMatch = summaryMd.match(/## Extracted Data\s*\n([\s\S]*?)(?=\n##|$)/);
  if (!dataMatch) return data;

  const dataSection = dataMatch[1];

  // Extract addresses
  const addresses = dataSection.match(/0x[a-fA-F0-9]{40}/g);
  if (addresses?.length) {
    data.addresses = [...new Set(addresses)];
  }

  // Extract amounts
  const numberPatterns = [
    /\$[\d,]+(?:\.\d{2})?/g,
    /[\d.]+\s*(?:ETH|USDC|USD)/gi,
    /[\d]+%/g,
  ];

  const numbers: string[] = [];
  for (const pattern of numberPatterns) {
    const matches = dataSection.match(pattern);
    if (matches) numbers.push(...matches);
  }
  if (numbers.length) {
    data.amounts = [...new Set(numbers)];
  }

  return data;
}

Deno.test('parseExtractedData - extracts structured data', async (t) => {
  await t.step('extracts Ethereum addresses', () => {
    const summary = `## Extracted Data
Owner address: 0x1234567890123456789012345678901234567890
Recipient: 0xabcdef1234567890123456789012345678901234`;

    const result = parseExtractedData(summary);
    assertExists(result.addresses);
    const addresses = result.addresses as string[];
    assertEquals(addresses.length, 2);
  });

  await t.step('deduplicates addresses', () => {
    const summary = `## Extracted Data
Address: 0x1234567890123456789012345678901234567890
Same: 0x1234567890123456789012345678901234567890`;

    const result = parseExtractedData(summary);
    const addresses = result.addresses as string[];
    assertEquals(addresses.length, 1);
  });

  await t.step('extracts dollar amounts', () => {
    const summary = `## Extracted Data
Goal: $50,000
Tier 1: $25.00`;

    const result = parseExtractedData(summary);
    assertExists(result.amounts);
    const amounts = result.amounts as string[];
    assertEquals(amounts.some(a => a.includes('50,000')), true);
  });

  await t.step('extracts crypto amounts', () => {
    const summary = `## Extracted Data
Amount: 10 ETH
Fee: 100 USDC`;

    const result = parseExtractedData(summary);
    const amounts = result.amounts as string[];
    assertEquals(amounts.some(a => a.includes('ETH')), true);
    assertEquals(amounts.some(a => a.includes('USDC')), true);
  });

  await t.step('extracts percentages', () => {
    const summary = `## Extracted Data
Reserved: 10%
Tax: 5%`;

    const result = parseExtractedData(summary);
    const amounts = result.amounts as string[];
    assertEquals(amounts.includes('10%'), true);
    assertEquals(amounts.includes('5%'), true);
  });

  await t.step('returns empty object for no data section', () => {
    const summary = `## Key Decisions
- Some decision`;

    const result = parseExtractedData(summary);
    assertEquals(Object.keys(result).length, 0);
  });
});

// ============================================================================
// Summary Merge Tests
// ============================================================================

function mergeSummaryContent(
  existing: string[],
  newItems: string[],
  maxItems: number = 20
): string[] {
  // Combine, deduplicate, and limit
  const combined = [...existing];

  for (const item of newItems) {
    // Simple dedup - check if similar item exists
    const isDupe = combined.some(e =>
      e.toLowerCase().includes(item.toLowerCase().slice(0, 20)) ||
      item.toLowerCase().includes(e.toLowerCase().slice(0, 20))
    );
    if (!isDupe) {
      combined.push(item);
    }
  }

  // Keep most recent if over limit
  return combined.slice(-maxItems);
}

Deno.test('mergeSummaryContent - combines lists', async (t) => {
  await t.step('combines non-overlapping items', () => {
    const existing = ['Item A', 'Item B'];
    const newItems = ['Item C', 'Item D'];
    const result = mergeSummaryContent(existing, newItems);
    assertEquals(result.length, 4);
  });

  await t.step('deduplicates similar items', () => {
    const existing = ['Set funding goal to $50,000'];
    const newItems = ['Set funding goal to $50,000 USD'];
    const result = mergeSummaryContent(existing, newItems);
    assertEquals(result.length, 1); // Should recognize as duplicate
  });

  await t.step('respects max items limit', () => {
    const existing = Array(15).fill(null).map((_, i) => `Item ${i}`);
    const newItems = Array(10).fill(null).map((_, i) => `New ${i}`);
    const result = mergeSummaryContent(existing, newItems, 20);
    assertEquals(result.length, 20);
  });

  await t.step('keeps recent items when trimming', () => {
    const existing = ['Old 1', 'Old 2'];
    const newItems = ['New 1', 'New 2', 'New 3'];
    const result = mergeSummaryContent(existing, newItems, 3);
    assertEquals(result.includes('New 3'), true);
  });
});

// ============================================================================
// Message Formatting for Summarization
// ============================================================================

function formatMessagesForSummarization(
  messages: Array<{ role: string; content: string }>
): string {
  return messages
    .map(m => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 2000)}`)
    .join('\n\n');
}

Deno.test('formatMessagesForSummarization - output format', async (t) => {
  await t.step('includes role prefix', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = formatMessagesForSummarization(messages);
    assertEquals(result.includes('[USER]:'), true);
    assertEquals(result.includes('[ASSISTANT]:'), true);
  });

  await t.step('separates messages with double newline', () => {
    const messages = [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Second' },
    ];
    const result = formatMessagesForSummarization(messages);
    assertEquals(result.includes('\n\n'), true);
  });

  await t.step('truncates long content', () => {
    const longContent = 'x'.repeat(3000);
    const messages = [{ role: 'user', content: longContent }];
    const result = formatMessagesForSummarization(messages);
    assertEquals(result.length < 2100, true); // [USER]: prefix + 2000 chars
  });

  await t.step('handles empty array', () => {
    const result = formatMessagesForSummarization([]);
    assertEquals(result, '');
  });
});
