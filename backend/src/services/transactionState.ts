/**
 * Transaction State Service
 *
 * Manages "entity memory" for chat sessions - persistent storage of
 * project design decisions that survive even when messages are summarized.
 *
 * This is Layer 2 of the context management system: structured state
 * that persists independently of message history.
 */

import { query, queryOne, execute } from '../db/index.ts';

// ============================================================================
// Types
// ============================================================================

export interface ChatTransactionState {
  // Project identity
  projectName?: string;
  projectDescription?: string;
  projectType?: 'revnet' | 'crowdfund' | 'membership' | 'nft' | 'other';

  // Funding configuration
  fundingGoal?: string; // Amount as string (e.g., "50000 USD", "10 ETH")
  fundingCurrency?: 'ETH' | 'USDC' | 'USD';
  targetChains?: number[]; // Chain IDs (1=mainnet, 10=optimism, 8453=base, etc.)

  // Ruleset configuration
  rulesetConfig?: {
    reservedPercent?: number; // 0-100
    cashOutTaxRate?: number; // 0-100 (bonding curve steepness)
    duration?: number; // Seconds, 0 = unlimited
    payoutLimit?: string; // Amount per cycle
    surplusAllowance?: string;
    decayPercent?: number; // Issuance decay per cycle
    weight?: string; // Starting token issuance rate
  };

  // Tiers/rewards
  tiers?: Array<{
    name: string;
    price: string;
    description?: string;
    supply?: number; // Max supply, undefined = unlimited
    benefitsList?: string[];
  }>;

  // Splits configuration
  payoutSplits?: Array<{
    address: string;
    percent: number; // 0-100
    lockedUntil?: number; // Timestamp
    projectId?: number; // For Juicebox project recipients
  }>;
  reservedSplits?: Array<{
    address: string;
    percent: number;
    lockedUntil?: number;
    projectId?: number;
  }>;

  // Owner/controller
  ownerAddress?: string;
  controllerSafe?: string; // Multisig address if applicable

  // Progress tracking
  designPhase: 'discovery' | 'configuration' | 'review' | 'ready';
  pendingQuestions?: string[];
  confirmedDecisions?: string[];

  // User preferences (for this session)
  userPreferences?: {
    preferredCurrency?: 'ETH' | 'USDC' | 'USD';
    prefersBrevity?: boolean;
    wantsDetailedExplanations?: boolean;
    jargonLevel?: 'beginner' | 'intermediate' | 'advanced';
  };

  // Artifacts discussed
  artifacts?: Array<{
    type: 'document' | 'image' | 'link' | 'file';
    name: string;
    summary?: string;
    messageId?: string; // Reference to where it was discussed
  }>;

  // Metadata
  schemaVersion: number;
  lastUpdatedByMessageId?: string;
}

interface DbTransactionState {
  id: string;
  chat_id: string;
  state: ChatTransactionState;
  schema_version: number;
  last_updated_by_message_id: string | null;
  updated_at: Date;
  created_at: Date;
}

// ============================================================================
// Default State
// ============================================================================

const DEFAULT_STATE: ChatTransactionState = {
  designPhase: 'discovery',
  schemaVersion: 1,
};

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Get transaction state for a chat, creating default if none exists
 */
export async function getTransactionState(chatId: string): Promise<ChatTransactionState> {
  const result = await queryOne<DbTransactionState>(
    'SELECT state FROM chat_transaction_state WHERE chat_id = $1',
    [chatId]
  );

  if (result) {
    return result.state;
  }

  // Create default state
  await execute(
    `INSERT INTO chat_transaction_state (chat_id, state, schema_version)
     VALUES ($1, $2::jsonb, 1)
     ON CONFLICT (chat_id) DO NOTHING`,
    [chatId, JSON.stringify(DEFAULT_STATE)]
  );

  return { ...DEFAULT_STATE };
}

/**
 * Update transaction state with partial updates (merge semantics)
 */
export async function updateTransactionState(
  chatId: string,
  updates: Partial<ChatTransactionState>,
  messageId?: string
): Promise<ChatTransactionState> {
  // Get current state
  const current = await getTransactionState(chatId);

  // Deep merge updates
  const newState: ChatTransactionState = deepMerge(current, updates);
  newState.schemaVersion = 1;
  if (messageId) {
    newState.lastUpdatedByMessageId = messageId;
  }

  // Upsert
  await execute(
    `INSERT INTO chat_transaction_state (chat_id, state, schema_version, last_updated_by_message_id, updated_at)
     VALUES ($1, $2::jsonb, 1, $3, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET
       state = $2::jsonb,
       last_updated_by_message_id = COALESCE($3, chat_transaction_state.last_updated_by_message_id),
       updated_at = NOW()`,
    [chatId, JSON.stringify(newState), messageId || null]
  );

  return newState;
}

/**
 * Add a pending question
 */
export async function addPendingQuestion(chatId: string, question: string): Promise<void> {
  const state = await getTransactionState(chatId);
  const pending = state.pendingQuestions || [];

  if (!pending.includes(question)) {
    pending.push(question);
    await updateTransactionState(chatId, { pendingQuestions: pending });
  }
}

/**
 * Remove a pending question (when answered)
 */
export async function resolvePendingQuestion(chatId: string, question: string): Promise<void> {
  const state = await getTransactionState(chatId);
  const pending = (state.pendingQuestions || []).filter(q => q !== question);
  await updateTransactionState(chatId, { pendingQuestions: pending });
}

/**
 * Add a confirmed decision
 */
export async function addConfirmedDecision(
  chatId: string,
  decision: string,
  messageId?: string
): Promise<void> {
  const state = await getTransactionState(chatId);
  const confirmed = state.confirmedDecisions || [];

  if (!confirmed.includes(decision)) {
    confirmed.push(decision);
    await updateTransactionState(chatId, { confirmedDecisions: confirmed }, messageId);
  }
}

/**
 * Add an artifact reference
 */
export async function addArtifact(
  chatId: string,
  artifact: {
    type: 'document' | 'image' | 'link' | 'file';
    name: string;
    summary?: string;
    messageId?: string;
  }
): Promise<void> {
  const state = await getTransactionState(chatId);
  const artifacts = state.artifacts || [];

  // Don't duplicate same artifact
  if (!artifacts.some(a => a.name === artifact.name && a.type === artifact.type)) {
    artifacts.push(artifact);
    await updateTransactionState(chatId, { artifacts });
  }
}

/**
 * Transition design phase
 */
export async function transitionPhase(
  chatId: string,
  phase: ChatTransactionState['designPhase']
): Promise<void> {
  await updateTransactionState(chatId, { designPhase: phase });
}

// ============================================================================
// AI-Powered State Extraction
// ============================================================================

const STATE_EXTRACTION_PROMPT = `You are analyzing an AI assistant's response to extract any project design decisions that were made or confirmed.

Extract ONLY explicit decisions or configurations mentioned in the response. Do NOT infer or assume.

Return a JSON object with any of these fields that are explicitly mentioned:
{
  "projectName": "string or null",
  "projectType": "revnet | crowdfund | membership | nft | other | null",
  "fundingGoal": "string describing amount or null",
  "fundingCurrency": "ETH | USDC | USD | null",
  "targetChains": [array of chain IDs] or null,
  "ownerAddress": "0x... address or null",
  "rulesetConfig": {
    "reservedPercent": number or null,
    "cashOutTaxRate": number or null,
    "duration": number in seconds or null,
    "decayPercent": number or null
  } or null,
  "tiers": [{
    "name": "string",
    "price": "string",
    "description": "string or null"
  }] or null,
  "payoutSplits": [{
    "address": "0x...",
    "percent": number
  }] or null,
  "confirmedDecisions": ["list of decisions user explicitly agreed to"] or null,
  "pendingQuestions": ["questions waiting for user response"] or null,
  "designPhase": "discovery | configuration | review | ready | null"
}

Return ONLY valid JSON. If nothing was decided/confirmed, return {}.`;

/**
 * Extract state updates from an AI response using Claude
 * This runs asynchronously after each AI response.
 */
export async function extractStateFromResponse(
  chatId: string,
  aiResponse: string,
  messageId: string
): Promise<Partial<ChatTransactionState> | null> {
  // Skip extraction for short or obviously non-decision responses
  if (aiResponse.length < 100) return null;
  if (!containsDesignPatterns(aiResponse)) return null;

  try {
    // Use a fast, cheap model for extraction
    const { sendMessage } = await import('./claude.ts');

    const response = await sendMessage('system', {
      messages: [
        {
          role: 'user',
          content: `Analyze this AI assistant response and extract any project design decisions:\n\n${aiResponse.slice(0, 3000)}`,
        },
      ],
      system: STATE_EXTRACTION_PROMPT,
      maxTokens: 1000,
      temperature: 0,
      includeOmnichainContext: false,
    });

    // Parse the response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const extracted = JSON.parse(jsonMatch[0]) as Partial<ChatTransactionState>;

    // Apply non-null values
    const updates: Partial<ChatTransactionState> = {};
    for (const [key, value] of Object.entries(extracted)) {
      if (value !== null && value !== undefined) {
        (updates as Record<string, unknown>)[key] = value;
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateTransactionState(chatId, updates, messageId);
      return updates;
    }

    return null;
  } catch (error) {
    console.error('Failed to extract state from response:', error);
    return null;
  }
}

/**
 * Quick check if response might contain design decisions (avoid unnecessary API calls)
 */
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

// ============================================================================
// Prompt Formatting
// ============================================================================

/**
 * Format transaction state for injection into system prompt
 */
export function formatStateForPrompt(state: ChatTransactionState): string {
  const sections: string[] = [];

  // Phase indicator
  const phaseLabels: Record<string, string> = {
    discovery: 'Discovery (exploring requirements)',
    configuration: 'Configuration (setting parameters)',
    review: 'Review (confirming settings)',
    ready: 'Ready (awaiting deployment)',
  };
  sections.push(`**Phase:** ${phaseLabels[state.designPhase] || state.designPhase}`);

  // Pending items count
  if (state.pendingQuestions?.length) {
    sections.push(`**Pending Questions:** ${state.pendingQuestions.length}`);
  }

  // Confirmed decisions
  if (state.projectName || state.projectType || state.fundingGoal) {
    sections.push('\n## Confirmed Decisions');

    if (state.projectName) {
      sections.push(`- **Name:** ${state.projectName}`);
    }
    if (state.projectType) {
      sections.push(`- **Type:** ${state.projectType}`);
    }
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

  // Ruleset config
  if (state.rulesetConfig && Object.keys(state.rulesetConfig).length > 0) {
    sections.push('\n## Ruleset Configuration');
    const rc = state.rulesetConfig;

    if (rc.reservedPercent !== undefined) {
      sections.push(`- Reserved rate: ${rc.reservedPercent}%`);
    }
    if (rc.cashOutTaxRate !== undefined) {
      sections.push(`- Cash out tax: ${rc.cashOutTaxRate}%`);
    }
    if (rc.duration !== undefined) {
      sections.push(`- Cycle duration: ${rc.duration === 0 ? 'Unlimited' : `${rc.duration / 86400} days`}`);
    }
    if (rc.decayPercent !== undefined) {
      sections.push(`- Issuance decay: ${rc.decayPercent}% per cycle`);
    }
    if (rc.payoutLimit) {
      sections.push(`- Payout limit: ${rc.payoutLimit}`);
    }
  }

  // Tiers
  if (state.tiers?.length) {
    sections.push('\n## Contribution Tiers');
    state.tiers.forEach((tier, i) => {
      sections.push(`${i + 1}. **${tier.name}** - ${tier.price}${tier.description ? `: ${tier.description}` : ''}`);
    });
  }

  // Splits
  if (state.payoutSplits?.length) {
    sections.push('\n## Payout Splits');
    state.payoutSplits.forEach(split => {
      sections.push(`- ${formatAddress(split.address)}: ${split.percent}%`);
    });
  }

  // Pending questions
  if (state.pendingQuestions?.length) {
    sections.push('\n## Pending Questions');
    state.pendingQuestions.forEach(q => {
      sections.push(`- [ ] ${q}`);
    });
  }

  // Artifacts
  if (state.artifacts?.length) {
    sections.push('\n## Referenced Materials');
    state.artifacts.forEach(a => {
      sections.push(`- **${a.name}** (${a.type})${a.summary ? `: ${a.summary}` : ''}`);
    });
  }

  // User preferences
  if (state.userPreferences) {
    const prefs = state.userPreferences;
    const prefList: string[] = [];
    if (prefs.preferredCurrency) prefList.push(`prefers ${prefs.preferredCurrency}`);
    if (prefs.prefersBrevity) prefList.push('prefers brevity');
    if (prefs.wantsDetailedExplanations) prefList.push('wants detailed explanations');

    if (prefList.length > 0) {
      sections.push(`\n## User Preferences\n${prefList.join(', ')}`);
    }
  }

  return sections.join('\n');
}

// ============================================================================
// Helpers
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

/**
 * Deep merge objects (arrays are replaced, not merged)
 */
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

// All functions are exported at their definitions
