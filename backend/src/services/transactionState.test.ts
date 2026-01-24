/**
 * Transaction State Service Tests
 *
 * Tests state manipulation, merging, and prompt formatting.
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ============================================================================
// Types (mirrored from service)
// ============================================================================

interface ChatTransactionState {
  projectName?: string;
  projectDescription?: string;
  projectType?: 'revnet' | 'crowdfund' | 'membership' | 'nft' | 'other';
  fundingGoal?: string;
  fundingCurrency?: 'ETH' | 'USDC' | 'USD';
  targetChains?: number[];
  rulesetConfig?: {
    reservedPercent?: number;
    cashOutTaxRate?: number;
    duration?: number;
    payoutLimit?: string;
    decayPercent?: number;
  };
  tiers?: Array<{
    name: string;
    price: string;
    description?: string;
  }>;
  payoutSplits?: Array<{
    address: string;
    percent: number;
  }>;
  ownerAddress?: string;
  designPhase: 'discovery' | 'configuration' | 'review' | 'ready';
  pendingQuestions?: string[];
  confirmedDecisions?: string[];
  artifacts?: Array<{
    type: 'document' | 'image' | 'link' | 'file';
    name: string;
    summary?: string;
  }>;
  userPreferences?: {
    preferredCurrency?: 'ETH' | 'USDC' | 'USD';
    prefersBrevity?: boolean;
  };
  schemaVersion: number;
}

// ============================================================================
// Deep Merge Tests
// ============================================================================

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (sourceValue === undefined) continue;

    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue as object, sourceValue as object) as T[keyof T];
    } else {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

Deno.test('deepMerge - basic merging', async (t) => {
  await t.step('merges top-level properties', () => {
    const target = { a: 1, b: 2, c: 0 };
    const source = { b: 3, c: 4 };
    const result = deepMerge(target, source);
    assertEquals(result, { a: 1, b: 3, c: 4 });
  });

  await t.step('preserves unmodified properties', () => {
    const target = { a: 1, b: 2, c: 3 };
    const source = { b: 5 };
    const result = deepMerge(target, source);
    assertEquals(result.a, 1);
    assertEquals(result.c, 3);
  });

  await t.step('ignores undefined values in source', () => {
    const target = { a: 1, b: 2 };
    const source = { a: undefined, b: 3 };
    const result = deepMerge(target, source);
    assertEquals(result.a, 1);
    assertEquals(result.b, 3);
  });
});

Deno.test('deepMerge - nested objects', async (t) => {
  await t.step('recursively merges nested objects', () => {
    // Test using Record type for dynamic key testing
    const target: Record<string, Record<string, number>> = {
      outer: { inner1: 1, inner2: 2 },
    };
    const source: Partial<Record<string, Record<string, number>>> = {
      outer: { inner2: 3, inner3: 4 },
    };
    const result = deepMerge(target, source);
    assertEquals(result.outer.inner1, 1);
    assertEquals(result.outer.inner2, 3);
    assertEquals(result.outer.inner3, 4);
  });

  await t.step('handles deeply nested objects', () => {
    const target = {
      level1: { level2: { level3: { value: 1 } } },
    };
    const source = {
      level1: { level2: { level3: { value: 2 } } },
    };
    const result = deepMerge(target, source);
    assertEquals(result.level1.level2.level3.value, 2);
  });
});

Deno.test('deepMerge - arrays', async (t) => {
  await t.step('replaces arrays entirely (no merge)', () => {
    const target = { items: [1, 2, 3] };
    const source = { items: [4, 5] };
    const result = deepMerge(target, source);
    assertEquals(result.items, [4, 5]);
  });

  await t.step('handles empty arrays', () => {
    const target = { items: [1, 2, 3] };
    const source = { items: [] as number[] };
    const result = deepMerge(target, source);
    assertEquals(result.items, []);
  });
});

Deno.test('deepMerge - transaction state specific', async (t) => {
  await t.step('merges ruleset config', () => {
    const target: ChatTransactionState = {
      designPhase: 'discovery',
      schemaVersion: 1,
      rulesetConfig: { reservedPercent: 10 },
    };
    const source: Partial<ChatTransactionState> = {
      rulesetConfig: { cashOutTaxRate: 5 },
    };
    const result = deepMerge(target, source);
    assertEquals(result.rulesetConfig?.reservedPercent, 10);
    assertEquals(result.rulesetConfig?.cashOutTaxRate, 5);
  });

  await t.step('replaces tiers array', () => {
    const target: ChatTransactionState = {
      designPhase: 'discovery',
      schemaVersion: 1,
      tiers: [{ name: 'Tier 1', price: '$10' }],
    };
    const source: Partial<ChatTransactionState> = {
      tiers: [
        { name: 'Tier A', price: '$25' },
        { name: 'Tier B', price: '$50' },
      ],
    };
    const result = deepMerge(target, source);
    assertEquals(result.tiers?.length, 2);
    assertEquals(result.tiers?.[0].name, 'Tier A');
  });
});

// ============================================================================
// State Formatting Tests
// ============================================================================

function chainIdToName(chainId: number): string {
  const names: Record<number, string> = {
    1: 'Ethereum',
    10: 'Optimism',
    8453: 'Base',
    42161: 'Arbitrum',
    11155111: 'Sepolia',
  };
  return names[chainId] || `Chain ${chainId}`;
}

function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

Deno.test('chainIdToName - maps known chains', async (t) => {
  await t.step('maps Ethereum mainnet', () => {
    assertEquals(chainIdToName(1), 'Ethereum');
  });

  await t.step('maps Optimism', () => {
    assertEquals(chainIdToName(10), 'Optimism');
  });

  await t.step('maps Base', () => {
    assertEquals(chainIdToName(8453), 'Base');
  });

  await t.step('maps Arbitrum', () => {
    assertEquals(chainIdToName(42161), 'Arbitrum');
  });

  await t.step('handles unknown chain', () => {
    assertEquals(chainIdToName(999), 'Chain 999');
  });
});

Deno.test('formatAddress - truncates correctly', async (t) => {
  await t.step('formats standard address', () => {
    const address = '0x1234567890123456789012345678901234567890';
    assertEquals(formatAddress(address), '0x1234...7890');
  });

  await t.step('preserves 0x prefix', () => {
    const address = '0xabcdef1234567890123456789012345678901234';
    const result = formatAddress(address);
    assertEquals(result.startsWith('0x'), true);
  });
});

// ============================================================================
// Prompt Formatting Tests
// ============================================================================

function formatStateForPrompt(state: ChatTransactionState): string {
  const sections: string[] = [];

  const phaseLabels: Record<string, string> = {
    discovery: 'Discovery (exploring requirements)',
    configuration: 'Configuration (setting parameters)',
    review: 'Review (confirming settings)',
    ready: 'Ready (awaiting deployment)',
  };
  sections.push(`**Phase:** ${phaseLabels[state.designPhase] || state.designPhase}`);

  if (state.pendingQuestions?.length) {
    sections.push(`**Pending Questions:** ${state.pendingQuestions.length}`);
  }

  if (state.projectName || state.projectType || state.fundingGoal) {
    sections.push('\n## Confirmed Decisions');
    if (state.projectName) sections.push(`- **Name:** ${state.projectName}`);
    if (state.projectType) sections.push(`- **Type:** ${state.projectType}`);
    if (state.fundingGoal) {
      sections.push(`- **Goal:** ${state.fundingGoal}${state.fundingCurrency ? ` ${state.fundingCurrency}` : ''}`);
    }
    if (state.targetChains?.length) {
      const chainNames = state.targetChains.map(chainIdToName).join(', ');
      sections.push(`- **Chains:** ${chainNames}`);
    }
    if (state.ownerAddress) {
      sections.push(`- **Owner:** ${formatAddress(state.ownerAddress)}`);
    }
  }

  if (state.rulesetConfig && Object.keys(state.rulesetConfig).length > 0) {
    sections.push('\n## Ruleset Configuration');
    const rc = state.rulesetConfig;
    if (rc.reservedPercent !== undefined) sections.push(`- Reserved rate: ${rc.reservedPercent}%`);
    if (rc.cashOutTaxRate !== undefined) sections.push(`- Cash out tax: ${rc.cashOutTaxRate}%`);
    if (rc.duration !== undefined) {
      sections.push(`- Cycle duration: ${rc.duration === 0 ? 'Unlimited' : `${rc.duration / 86400} days`}`);
    }
    if (rc.decayPercent !== undefined) sections.push(`- Issuance decay: ${rc.decayPercent}% per cycle`);
    if (rc.payoutLimit) sections.push(`- Payout limit: ${rc.payoutLimit}`);
  }

  if (state.tiers?.length) {
    sections.push('\n## Contribution Tiers');
    state.tiers.forEach((tier, i) => {
      sections.push(`${i + 1}. **${tier.name}** - ${tier.price}${tier.description ? `: ${tier.description}` : ''}`);
    });
  }

  if (state.payoutSplits?.length) {
    sections.push('\n## Payout Splits');
    state.payoutSplits.forEach(split => {
      sections.push(`- ${formatAddress(split.address)}: ${split.percent}%`);
    });
  }

  if (state.pendingQuestions?.length) {
    sections.push('\n## Pending Questions');
    state.pendingQuestions.forEach(q => sections.push(`- [ ] ${q}`));
  }

  if (state.artifacts?.length) {
    sections.push('\n## Referenced Materials');
    state.artifacts.forEach(a => {
      sections.push(`- **${a.name}** (${a.type})${a.summary ? `: ${a.summary}` : ''}`);
    });
  }

  return sections.join('\n');
}

Deno.test('formatStateForPrompt - phase display', async (t) => {
  await t.step('shows discovery phase', () => {
    const state: ChatTransactionState = { designPhase: 'discovery', schemaVersion: 1 };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('Discovery'), true);
  });

  await t.step('shows configuration phase', () => {
    const state: ChatTransactionState = { designPhase: 'configuration', schemaVersion: 1 };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('Configuration'), true);
  });

  await t.step('shows pending questions count', () => {
    const state: ChatTransactionState = {
      designPhase: 'discovery',
      schemaVersion: 1,
      pendingQuestions: ['Question 1', 'Question 2'],
    };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('Pending Questions:** 2'), true);
  });
});

Deno.test('formatStateForPrompt - confirmed decisions', async (t) => {
  await t.step('includes project name', () => {
    const state: ChatTransactionState = {
      designPhase: 'configuration',
      schemaVersion: 1,
      projectName: 'My Awesome Project',
    };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('## Confirmed Decisions'), true);
    assertEquals(result.includes('My Awesome Project'), true);
  });

  await t.step('includes funding goal with currency', () => {
    const state: ChatTransactionState = {
      designPhase: 'configuration',
      schemaVersion: 1,
      fundingGoal: '50000',
      fundingCurrency: 'USD',
    };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('50000 USD'), true);
  });

  await t.step('includes chain names', () => {
    const state: ChatTransactionState = {
      designPhase: 'configuration',
      schemaVersion: 1,
      projectName: 'Test',
      targetChains: [1, 10, 8453],
    };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('Ethereum'), true);
    assertEquals(result.includes('Optimism'), true);
    assertEquals(result.includes('Base'), true);
  });
});

Deno.test('formatStateForPrompt - ruleset configuration', async (t) => {
  await t.step('includes reserved rate', () => {
    const state: ChatTransactionState = {
      designPhase: 'configuration',
      schemaVersion: 1,
      rulesetConfig: { reservedPercent: 10 },
    };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('Reserved rate: 10%'), true);
  });

  await t.step('handles unlimited duration', () => {
    const state: ChatTransactionState = {
      designPhase: 'configuration',
      schemaVersion: 1,
      rulesetConfig: { duration: 0 },
    };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('Unlimited'), true);
  });

  await t.step('converts duration to days', () => {
    const state: ChatTransactionState = {
      designPhase: 'configuration',
      schemaVersion: 1,
      rulesetConfig: { duration: 604800 }, // 7 days in seconds
    };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('7 days'), true);
  });
});

Deno.test('formatStateForPrompt - tiers', async (t) => {
  await t.step('lists tiers with numbering', () => {
    const state: ChatTransactionState = {
      designPhase: 'configuration',
      schemaVersion: 1,
      tiers: [
        { name: 'Bronze', price: '$25' },
        { name: 'Silver', price: '$100' },
        { name: 'Gold', price: '$500' },
      ],
    };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('1. **Bronze**'), true);
    assertEquals(result.includes('2. **Silver**'), true);
    assertEquals(result.includes('3. **Gold**'), true);
  });

  await t.step('includes tier descriptions', () => {
    const state: ChatTransactionState = {
      designPhase: 'configuration',
      schemaVersion: 1,
      tiers: [{ name: 'VIP', price: '$1000', description: 'All access pass' }],
    };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('All access pass'), true);
  });
});

Deno.test('formatStateForPrompt - artifacts', async (t) => {
  await t.step('lists referenced materials', () => {
    const state: ChatTransactionState = {
      designPhase: 'configuration',
      schemaVersion: 1,
      artifacts: [
        { type: 'document', name: 'pitch-deck.pdf', summary: 'Project overview' },
        { type: 'image', name: 'logo.png' },
      ],
    };
    const result = formatStateForPrompt(state);
    assertEquals(result.includes('## Referenced Materials'), true);
    assertEquals(result.includes('pitch-deck.pdf'), true);
    assertEquals(result.includes('(document)'), true);
    assertEquals(result.includes('logo.png'), true);
  });
});

// ============================================================================
// Design Pattern Detection Tests
// ============================================================================

function containsDesignPatterns(text: string): boolean {
  const patterns = [
    /project (name|called|titled)/i,
    /funding goal/i,
    /\$[\d,]+|[\d.]+ ETH|[\d.]+ USDC/i,
    /reserved (rate|percent)/i,
    /cash out|redemption/i,
    /tier|reward|benefit/i,
    /payout|split/i,
    /0x[a-fA-F0-9]{40}/,
    /chain|mainnet|base|optimism/i,
    /confirm|agree|decide|set to|configured/i,
  ];

  return patterns.some(p => p.test(text));
}

Deno.test('containsDesignPatterns - detects project decisions', async (t) => {
  await t.step('detects project name mentions', () => {
    assertEquals(containsDesignPatterns('The project called Sunrise Garden'), true);
    assertEquals(containsDesignPatterns('Project name: Community Fund'), true);
    assertEquals(containsDesignPatterns('A project titled Dreams'), true);
  });

  await t.step('detects funding goals', () => {
    assertEquals(containsDesignPatterns('The funding goal is $50,000'), true);
    assertEquals(containsDesignPatterns('We need 10 ETH'), true);
    assertEquals(containsDesignPatterns('Target: 5000 USDC'), true);
  });

  await t.step('detects configuration terms', () => {
    assertEquals(containsDesignPatterns('Set the reserved rate to 10%'), true);
    assertEquals(containsDesignPatterns('Configure cash out tax'), true);
    assertEquals(containsDesignPatterns('Add a tier for early supporters'), true);
  });

  await t.step('detects Ethereum addresses', () => {
    assertEquals(containsDesignPatterns('Send to 0x1234567890123456789012345678901234567890'), true);
  });

  await t.step('detects chain references', () => {
    assertEquals(containsDesignPatterns('Deploy on mainnet'), true);
    assertEquals(containsDesignPatterns('Use Base for lower fees'), true);
    assertEquals(containsDesignPatterns('Support Optimism chain'), true);
  });

  await t.step('detects confirmation language', () => {
    assertEquals(containsDesignPatterns("I confirm these settings"), true);
    assertEquals(containsDesignPatterns("Agreed on the configuration"), true);
    assertEquals(containsDesignPatterns("The rate is set to 5%"), true);
  });

  await t.step('returns false for unrelated text', () => {
    assertEquals(containsDesignPatterns('Hello, how are you?'), false);
    assertEquals(containsDesignPatterns('What is the weather like?'), false);
    assertEquals(containsDesignPatterns('Tell me a joke'), false);
  });
});

// ============================================================================
// Pending Questions Tests
// ============================================================================

function addPendingQuestion(
  state: ChatTransactionState,
  question: string
): ChatTransactionState {
  const pending = state.pendingQuestions || [];
  if (!pending.includes(question)) {
    pending.push(question);
  }
  return { ...state, pendingQuestions: pending };
}

function resolvePendingQuestion(
  state: ChatTransactionState,
  question: string
): ChatTransactionState {
  const pending = (state.pendingQuestions || []).filter(q => q !== question);
  return { ...state, pendingQuestions: pending };
}

Deno.test('addPendingQuestion - adds new questions', async (t) => {
  await t.step('adds question to empty list', () => {
    const state: ChatTransactionState = { designPhase: 'discovery', schemaVersion: 1 };
    const result = addPendingQuestion(state, 'What is your budget?');
    assertEquals(result.pendingQuestions?.length, 1);
    assertEquals(result.pendingQuestions?.[0], 'What is your budget?');
  });

  await t.step('appends to existing questions', () => {
    const state: ChatTransactionState = {
      designPhase: 'discovery',
      schemaVersion: 1,
      pendingQuestions: ['Question 1'],
    };
    const result = addPendingQuestion(state, 'Question 2');
    assertEquals(result.pendingQuestions?.length, 2);
  });

  await t.step('does not duplicate existing questions', () => {
    const state: ChatTransactionState = {
      designPhase: 'discovery',
      schemaVersion: 1,
      pendingQuestions: ['Same question'],
    };
    const result = addPendingQuestion(state, 'Same question');
    assertEquals(result.pendingQuestions?.length, 1);
  });
});

Deno.test('resolvePendingQuestion - removes questions', async (t) => {
  await t.step('removes matching question', () => {
    const state: ChatTransactionState = {
      designPhase: 'discovery',
      schemaVersion: 1,
      pendingQuestions: ['Question 1', 'Question 2', 'Question 3'],
    };
    const result = resolvePendingQuestion(state, 'Question 2');
    assertEquals(result.pendingQuestions?.length, 2);
    assertEquals(result.pendingQuestions?.includes('Question 2'), false);
  });

  await t.step('handles non-existent question gracefully', () => {
    const state: ChatTransactionState = {
      designPhase: 'discovery',
      schemaVersion: 1,
      pendingQuestions: ['Question 1'],
    };
    const result = resolvePendingQuestion(state, 'Non-existent');
    assertEquals(result.pendingQuestions?.length, 1);
  });

  await t.step('handles empty list', () => {
    const state: ChatTransactionState = {
      designPhase: 'discovery',
      schemaVersion: 1,
      pendingQuestions: [],
    };
    const result = resolvePendingQuestion(state, 'Any question');
    assertEquals(result.pendingQuestions?.length, 0);
  });
});
