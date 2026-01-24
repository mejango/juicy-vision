#!/usr/bin/env -S deno run --allow-net
/**
 * Manual AI Testing Script
 *
 * Quick spot-checks for the agentic loop. Run after changes to verify basic functionality.
 *
 * Usage:
 *   deno run --allow-net scripts/test-ai-manual.ts
 *
 * Or make it executable:
 *   chmod +x scripts/test-ai-manual.ts
 *   ./scripts/test-ai-manual.ts
 */

const BASE_URL = Deno.env.get('API_URL') || 'http://localhost:3001/api';
const SESSION_ID = `ses_manual_test_${Date.now()}`;

// ANSI colors
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

interface TestCase {
  name: string;
  prompt: string;
  shouldUseTool?: string;
  shouldNotUseTool?: boolean;
  validate?: (content: string) => boolean;
}

const TEST_CASES: TestCase[] = [
  {
    name: 'Tool: get_sucker_pairs',
    prompt: 'What bridge destinations are available for project 1?',
    shouldUseTool: 'get_sucker_pairs',
  },
  {
    name: 'Tool: get_bridge_transactions',
    prompt: 'Show me pending bridge transactions for sucker group sg_nana',
    shouldUseTool: 'get_bridge_transactions',
  },
  {
    name: 'No Tool: Concept explanation',
    prompt: 'Explain what a sucker is in Juicebox',
    shouldNotUseTool: true,
    validate: (content) => content.toLowerCase().includes('bridge'),
  },
  {
    name: 'No Tool: Greeting',
    prompt: 'Hi there!',
    shouldNotUseTool: true,
  },
  {
    name: 'Error handling: Invalid project',
    prompt: 'Get sucker pairs for project 999999999',
    shouldUseTool: 'get_sucker_pairs',
    // Should handle gracefully, not crash
  },
];

async function createChat(): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': SESSION_ID,
    },
    body: JSON.stringify({ name: `Manual Test ${new Date().toISOString()}`, isPublic: true }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`Failed to create chat: ${data.error}`);
  return data.data.id;
}

async function invokeAI(chatId: string, prompt: string): Promise<{ success: boolean; content?: string; error?: string }> {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/chat/${chatId}/ai/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': SESSION_ID,
    },
    body: JSON.stringify({ prompt }),
  });
  const elapsed = Date.now() - start;
  const data = await res.json();
  console.log(dim(`  Response time: ${elapsed}ms`));
  return {
    success: data.success,
    content: data.data?.content,
    error: data.error,
  };
}

async function runTest(test: TestCase, chatId: string): Promise<boolean> {
  console.log(`\n${cyan('▶')} ${test.name}`);
  console.log(dim(`  Prompt: "${test.prompt.substring(0, 50)}..."`));

  try {
    const result = await invokeAI(chatId, test.prompt);

    if (!result.success) {
      console.log(red(`  ✗ API Error: ${result.error}`));
      return false;
    }

    const content = result.content || '';

    // Check tool usage
    if (test.shouldUseTool) {
      if (content.includes(`Using tool: ${test.shouldUseTool}`)) {
        console.log(green(`  ✓ Used tool: ${test.shouldUseTool}`));
      } else {
        console.log(red(`  ✗ Expected tool: ${test.shouldUseTool}`));
        console.log(dim(`  Content: ${content.substring(0, 200)}...`));
        return false;
      }
    }

    if (test.shouldNotUseTool) {
      if (!content.includes('Using tool:')) {
        console.log(green(`  ✓ No tool used (as expected)`));
      } else {
        console.log(red(`  ✗ Unexpectedly used a tool`));
        console.log(dim(`  Content: ${content.substring(0, 200)}...`));
        return false;
      }
    }

    // Custom validation
    if (test.validate) {
      if (test.validate(content)) {
        console.log(green(`  ✓ Custom validation passed`));
      } else {
        console.log(red(`  ✗ Custom validation failed`));
        console.log(dim(`  Content: ${content.substring(0, 200)}...`));
        return false;
      }
    }

    return true;
  } catch (err) {
    console.log(red(`  ✗ Exception: ${err}`));
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('              AI AGENTIC LOOP - MANUAL TESTS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`API: ${BASE_URL}`);
  console.log(`Session: ${SESSION_ID}`);

  // Check if server is running
  try {
    await fetch(`${BASE_URL}/chat`);
  } catch {
    console.log(red('\n✗ Cannot connect to server. Is it running?'));
    console.log(dim(`  Start with: cd backend && deno task dev`));
    Deno.exit(1);
  }

  // Create test chat
  console.log('\nCreating test chat...');
  const chatId = await createChat();
  console.log(dim(`Chat ID: ${chatId}`));

  // Run tests
  let passed = 0;
  let failed = 0;

  for (const test of TEST_CASES) {
    const success = await runTest(test, chatId);
    if (success) passed++;
    else failed++;
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`Results: ${green(`${passed} passed`)}, ${failed > 0 ? red(`${failed} failed`) : dim('0 failed')}`);
  console.log('═══════════════════════════════════════════════════════════');

  // Check metrics
  console.log('\n📊 Fetching AI metrics...');
  try {
    const metricsRes = await fetch(`${BASE_URL.replace('/api', '')}/api/debug/ai/metrics?hours=1`);
    const metrics = await metricsRes.json();
    if (metrics.success) {
      console.log(`  Total invocations: ${metrics.data.totalInvocations}`);
      console.log(`  Avg response time: ${Math.round(metrics.data.avgResponseTimeMs)}ms`);
      console.log(`  Tool usage: ${JSON.stringify(metrics.data.toolUsageCounts)}`);
      console.log(`  With tools: ${metrics.data.invocationsWithTools} / Without: ${metrics.data.invocationsWithoutTools}`);
    }
  } catch {
    console.log(dim('  (Could not fetch metrics)'));
  }

  Deno.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(red(`Fatal error: ${err}`));
  Deno.exit(1);
});
