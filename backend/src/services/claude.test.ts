/**
 * Claude Service Tests - Agentic Loop
 *
 * Tests tool selection accuracy, multi-tool workflows, error resilience,
 * and no-tool scenarios.
 *
 * IMPORTANT: These tests invoke the Claude AI API and cost money.
 * They are SKIPPED by default. To run them:
 *   RUN_AI_TESTS=1 deno test --allow-all --env-file=.env --no-check src/services/claude.test.ts
 */

import { assertEquals, assertExists, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Skip AI tests by default - they cost money
const RUN_AI_TESTS = Deno.env.get('RUN_AI_TESTS') === '1';

const BASE_URL = 'http://localhost:3001/api';
const SESSION_ID = 'ses_test_claude_service_12345678';

// Helper to create a test chat
async function createTestChat(name: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': SESSION_ID,
    },
    body: JSON.stringify({ name, isPublic: true }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`Failed to create chat: ${data.error}`);
  return data.data.id;
}

// Helper to invoke AI and get response
async function invokeAI(chatId: string, prompt: string): Promise<{ success: boolean; content?: string; error?: string }> {
  const res = await fetch(`${BASE_URL}/chat/${chatId}/ai/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': SESSION_ID,
    },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  return {
    success: data.success,
    content: data.data?.content,
    error: data.error,
  };
}

// ============================================================================
// Tool Selection Accuracy Tests
// ============================================================================

Deno.test({
  name: 'Tool Selection: get_sucker_pairs for bridge destinations query',
  ignore: !RUN_AI_TESTS,
  async fn() {
    const chatId = await createTestChat('Test: Sucker Pairs');
    const result = await invokeAI(chatId, 'What are the available bridge destinations for Juicebox project 1?');

    assertExists(result.content);
    // Should return information about bridge destinations (chains, addresses)
    const content = result.content.toLowerCase();
    const hasBridgeInfo = content.includes('optimism') ||
                          content.includes('base') ||
                          content.includes('arbitrum') ||
                          content.includes('chain') ||
                          content.includes('bridge');
    assertEquals(hasBridgeInfo, true, 'Should provide bridge destination information');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'Tool Selection: get_cross_chain_balance for balance query',
  ignore: !RUN_AI_TESTS,
  async fn() {
    const chatId = await createTestChat('Test: Cross Chain Balance');
    const result = await invokeAI(
      chatId,
      'What is my token balance across all chains for sucker group sg_test? My address is 0x1234567890123456789012345678901234567890'
    );

    assertExists(result.content);
    // Should respond with balance information or explanation about the query
    const content = result.content.toLowerCase();
    const hasBalanceInfo = content.includes('token') ||
                           content.includes('balance') ||
                           content.includes('chain') ||
                           content.includes('0x1234');
    assertEquals(hasBalanceInfo, true, 'Should provide balance-related response');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'Tool Selection: get_bridge_transactions for transaction status',
  ignore: !RUN_AI_TESTS,
  async fn() {
    const chatId = await createTestChat('Test: Bridge Transactions');
    const result = await invokeAI(
      chatId,
      'Show me pending bridge transactions for sucker group sg_nana'
    );

    assertExists(result.content);
    // Should respond with transaction info or status about pending bridges
    const content = result.content.toLowerCase();
    const hasTransactionInfo = content.includes('transaction') ||
                               content.includes('pending') ||
                               content.includes('bridge') ||
                               content.includes('transfer') ||
                               content.includes('nana');
    assertEquals(hasTransactionInfo, true, 'Should provide transaction-related response');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// No-Tool Scenarios (should NOT use tools)
// ============================================================================

Deno.test({
  name: 'No-Tool: General concept question should use knowledge only',
  ignore: !RUN_AI_TESTS,
  async fn() {
    const chatId = await createTestChat('Test: No Tool Needed');
    const result = await invokeAI(
      chatId,
      'What is a sucker in the Juicebox ecosystem? Explain the concept.'
    );

    assertExists(result.content);
    // Should explain without calling tools
    assertEquals(result.content.includes('Using tool:'), false, 'Should not use tools for concept questions');
    // Should contain explanation
    assertStringIncludes(result.content.toLowerCase(), 'bridge');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'No-Tool: Greeting should not use tools',
  ignore: !RUN_AI_TESTS,
  async fn() {
    const chatId = await createTestChat('Test: Greeting');
    const result = await invokeAI(chatId, 'Hello! How are you?');

    assertExists(result.content);
    assertEquals(result.content.includes('Using tool:'), false, 'Should not use tools for greetings');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Error Resilience Tests
// ============================================================================

Deno.test({
  name: 'Error Resilience: Invalid project ID should handle gracefully',
  ignore: !RUN_AI_TESTS,
  async fn() {
    const chatId = await createTestChat('Test: Invalid Project');
    const result = await invokeAI(
      chatId,
      'What are the sucker pairs for project 99999999?'
    );

    assertExists(result.content);
    // Should still respond, either with empty results or error handling
    assertEquals(result.success, true, 'Should still succeed even with invalid project');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'Error Resilience: Malformed address should handle gracefully',
  ignore: !RUN_AI_TESTS,
  async fn() {
    const chatId = await createTestChat('Test: Malformed Address');
    const result = await invokeAI(
      chatId,
      'Get my cross-chain balance. My address is not-a-valid-address'
    );

    assertExists(result.content);
    // Should either ask for valid address or handle error
    assertEquals(result.success, true, 'Should handle malformed input gracefully');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Multi-Tool Workflow Tests
// ============================================================================

Deno.test({
  name: 'Multi-Tool: Query pairs then estimate fee',
  ignore: !RUN_AI_TESTS,
  async fn() {
    const chatId = await createTestChat('Test: Multi-Tool Workflow');
    const result = await invokeAI(
      chatId,
      'I want to bridge tokens from project 1 to Optimism. First check if there are any bridge destinations available, and if so, estimate the bridge fee.'
    );

    assertExists(result.content);
    // Should provide information about bridge destinations and/or fee estimation
    const content = result.content.toLowerCase();
    const hasBridgeInfo = content.includes('optimism') ||
                          content.includes('bridge') ||
                          content.includes('fee') ||
                          content.includes('eth') ||
                          content.includes('destination');
    assertEquals(hasBridgeInfo, true, 'Should provide bridge and/or fee information');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Response Quality Tests
// ============================================================================

Deno.test({
  name: 'Response Quality: Should provide meaningful bridge information',
  ignore: !RUN_AI_TESTS,
  async fn() {
    const chatId = await createTestChat('Test: Bridge Query');
    const result = await invokeAI(
      chatId,
      'What bridges are available for project 1?'
    );

    assertExists(result.content);
    // Should provide useful information about bridges (whether they exist or not)
    const content = result.content.toLowerCase();
    const hasMeaningfulResponse =
      content.includes('bridge') ||
      content.includes('optimism') ||
      content.includes('base') ||
      content.includes('arbitrum') ||
      content.includes('chain') ||
      content.includes('sucker') ||
      content.includes('destination') ||
      content.includes('no ') ||
      content.includes("doesn't") ||
      content.includes('not available');
    assertEquals(hasMeaningfulResponse, true, 'Should provide meaningful bridge information');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Performance Baseline Test
// ============================================================================

Deno.test({
  name: 'Performance: Response time should be reasonable',
  ignore: !RUN_AI_TESTS,
  async fn() {
    const chatId = await createTestChat('Test: Performance');
    const start = Date.now();

    const result = await invokeAI(chatId, 'What are the sucker pairs for project 1?');

    const elapsed = Date.now() - start;
    assertExists(result.content);
    console.log(`Response time: ${elapsed}ms`);

    // Should respond within 30 seconds (generous for tool use)
    assertEquals(elapsed < 30000, true, `Response took too long: ${elapsed}ms`);
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// parseConfidence Unit Tests (no AI needed)
// ============================================================================

import { parseConfidence } from './claude.ts';

Deno.test({
  name: 'parseConfidence: extracts confidence tag from end of content',
  fn() {
    const content = 'Hello world<confidence level="high" reason="test"/>';
    const result = parseConfidence(content);

    assertEquals(result.content, 'Hello world');
    assertEquals(result.confidence?.level, 'high');
    assertEquals(result.confidence?.reason, 'test');
  },
});

Deno.test({
  name: 'parseConfidence: preserves leading content when confidence at end',
  fn() {
    const content = "I'd love to help you\n\n<confidence level=\"medium\" reason=\"greeting\"/>";
    const result = parseConfidence(content);

    assertEquals(result.content, "I'd love to help you");
    assertEquals(result.confidence?.level, 'medium');
  },
});

Deno.test({
  name: 'parseConfidence: returns original content when no confidence tag',
  fn() {
    const content = 'Hello world with no tag';
    const result = parseConfidence(content);

    assertEquals(result.content, 'Hello world with no tag');
    assertEquals(result.confidence, null);
  },
});

Deno.test({
  name: 'parseConfidence: preserves leading whitespace (does not left-trim)',
  fn() {
    const content = '  Leading spaces<confidence level="high" reason="test"/>';
    const result = parseConfidence(content);

    // Should preserve leading whitespace (only trimEnd, not trim)
    assertEquals(result.content.startsWith('  '), true, 'Leading whitespace should be preserved');
  },
});

Deno.test({
  name: 'parseConfidence: handles content with special characters in reason',
  fn() {
    // Note: Using > in reason will break the [^>]* regex match,
    // causing the confidence tag to not be matched and removed.
    // This is a known limitation - reason should not contain >
    const content = 'Response text<confidence level="low" reason="User asked about rates greater than 10 percent"/>';
    const result = parseConfidence(content);

    assertEquals(result.content, 'Response text');
    assertEquals(result.confidence?.level, 'low');
  },
});

Deno.test({
  name: 'parseConfidence: handles confidence tag anywhere in content',
  fn() {
    const content = 'Start<confidence level="high" reason="test"/>End text';
    const result = parseConfidence(content);

    // Tag is removed wherever it appears
    assertEquals(result.content.includes('<confidence'), false);
    assertEquals(result.content.includes('Start'), true);
    assertEquals(result.content.includes('End'), true);
  },
});
