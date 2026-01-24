/**
 * Claude Service Tests - Agentic Loop
 *
 * Tests tool selection accuracy, multi-tool workflows, error resilience,
 * and no-tool scenarios.
 */

import { assertEquals, assertExists, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

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
  async fn() {
    const chatId = await createTestChat('Test: Sucker Pairs');
    const result = await invokeAI(chatId, 'What are the available bridge destinations for Juicebox project 1?');

    assertExists(result.content);
    assertStringIncludes(result.content, 'Using tool: get_sucker_pairs');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'Tool Selection: get_cross_chain_balance for balance query',
  async fn() {
    const chatId = await createTestChat('Test: Cross Chain Balance');
    const result = await invokeAI(
      chatId,
      'What is my token balance across all chains for sucker group sg_test? My address is 0x1234567890123456789012345678901234567890'
    );

    assertExists(result.content);
    // Should attempt to use balance tool (may fail due to invalid group, but should try)
    assertStringIncludes(result.content, 'Using tool: get_cross_chain_balance');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

Deno.test({
  name: 'Tool Selection: get_bridge_transactions for transaction status',
  async fn() {
    const chatId = await createTestChat('Test: Bridge Transactions');
    const result = await invokeAI(
      chatId,
      'Show me pending bridge transactions for sucker group sg_nana'
    );

    assertExists(result.content);
    assertStringIncludes(result.content, 'Using tool: get_bridge_transactions');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// No-Tool Scenarios (should NOT use tools)
// ============================================================================

Deno.test({
  name: 'No-Tool: General concept question should use knowledge only',
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
  async fn() {
    const chatId = await createTestChat('Test: Multi-Tool Workflow');
    const result = await invokeAI(
      chatId,
      'I want to bridge tokens from project 1 to Optimism. First check if there are any bridge destinations available, and if so, estimate the bridge fee.'
    );

    assertExists(result.content);
    // Should use at least the sucker pairs tool
    assertStringIncludes(result.content, 'Using tool: get_sucker_pairs');
    // May or may not use fee estimation depending on if pairs exist
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Response Quality Tests
// ============================================================================

Deno.test({
  name: 'Response Quality: Should interpret empty results correctly',
  async fn() {
    const chatId = await createTestChat('Test: Empty Results');
    const result = await invokeAI(
      chatId,
      'What bridges are available for project 1?'
    );

    assertExists(result.content);
    // Project 1 has no suckers, should explain this
    const content = result.content.toLowerCase();
    const mentionsNoResults =
      content.includes('no ') ||
      content.includes("doesn't") ||
      content.includes('not available') ||
      content.includes('none');
    assertEquals(mentionsNoResults, true, 'Should explain when no bridges are available');
  },
  sanitizeOps: false,
  sanitizeResources: false,
});

// ============================================================================
// Performance Baseline Test
// ============================================================================

Deno.test({
  name: 'Performance: Response time should be reasonable',
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
