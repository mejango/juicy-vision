/**
 * User Context Service
 *
 * Maintains a personalized CONTEXT.md for each user that captures:
 * - Observed preferences and patterns
 * - Explicit instructions from the user
 * - Communication style indicators
 * - Jargon familiarity level
 *
 * Key principle: DO NOT use more jargon than the user is ready for.
 * Mirror the user's language. Let them lead the complexity.
 */

import { query, queryOne, execute } from '../db/index.ts';

// ============================================================================
// Types
// ============================================================================

export interface UserContext {
  userId: string;
  walletAddress?: string;

  // Communication style
  jargonLevel: 'beginner' | 'intermediate' | 'advanced';
  prefersBrevity: boolean;
  prefersExamples: boolean;

  // Observed interests
  interests: string[];
  projectTypes: string[]; // e.g., "music", "fashion", "dao", "defi"

  // Experience indicators
  hasConnectedWallet: boolean;
  hasMadePayment: boolean;
  hasCreatedProject: boolean;
  familiarTerms: string[]; // Terms they've used or understood

  // Explicit preferences (user stated)
  explicitPreferences: string[];

  // Observations (AI noted, timestamped)
  observations: Observation[];

  // Last updated
  updatedAt: Date;
}

export interface Observation {
  content: string;
  confidence: 'high' | 'medium' | 'low';
  timestamp: Date;
  supersedes?: string; // ID of observation this replaces
}

// ============================================================================
// Default Context Template
// ============================================================================

const DEFAULT_CONTEXT = `# User Context

## Communication Style
- Jargon level: beginner (mirror user's language, introduce concepts gradually)
- Avoid: tokens, issuance, cuts, redemption, bonding curves (until user uses them)
- Prefer: "share", "ownership", "value", "support", "contribution"

## Core Principles
1. DO NOT use more jargon than the user is ready for
2. Let the user lead the complexity - if they use "token", you can use "token"
3. Explain mechanisms through outcomes, not implementation details
4. Focus on what they GET, not how it WORKS (unless they ask)

## Observed Interests
(none yet)

## Explicit Preferences
(none yet)

## Observations
(will be populated as we learn about this user)

## Experience Level
- Wallet connected: no
- Payment made: no
- Project created: no

---
Last updated: ${new Date().toISOString()}
`;

// ============================================================================
// Jargon Mapping (plain language alternatives)
// ============================================================================

export const JARGON_ALTERNATIVES: Record<string, { beginner: string; intermediate: string }> = {
  'token': {
    beginner: 'share in the project',
    intermediate: 'project token',
  },
  'issuance': {
    beginner: 'how many shares get created when someone contributes',
    intermediate: 'token issuance rate',
  },
  'issuance cut': {
    beginner: 'a gradual decrease that rewards early supporters',
    intermediate: 'issuance reduction over time',
  },
  'redemption': {
    beginner: 'getting your share of the treasury back',
    intermediate: 'cashing out your tokens',
  },
  'cash out': {
    beginner: 'withdraw your share',
    intermediate: 'redeem for treasury value',
  },
  'bonding curve': {
    beginner: 'automatic pricing that rewards early supporters',
    intermediate: 'price curve based on supply',
  },
  'treasury': {
    beginner: 'the project\'s funds',
    intermediate: 'treasury',
  },
  'revnet': {
    beginner: 'a transparent funding system',
    intermediate: 'revenue network (revnet)',
  },
  'ruleset': {
    beginner: 'the project\'s settings',
    intermediate: 'ruleset configuration',
  },
  'splits': {
    beginner: 'how funds are distributed',
    intermediate: 'payout splits',
  },
  'reserved rate': {
    beginner: 'portion set aside for the team',
    intermediate: 'reserved token rate',
  },
  'payout limit': {
    beginner: 'how much can be withdrawn per period',
    intermediate: 'payout limit',
  },
  'terminal': {
    beginner: 'payment system',
    intermediate: 'payment terminal',
  },
  'hook': {
    beginner: 'custom action',
    intermediate: 'hook contract',
  },
};

// ============================================================================
// Database Schema Addition (migration 007)
// ============================================================================

// Add to migrations/007_user_context.sql:
// CREATE TABLE user_contexts (
//   user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
//   wallet_address VARCHAR(42),
//   context_md TEXT NOT NULL,
//   jargon_level VARCHAR(20) NOT NULL DEFAULT 'beginner',
//   familiar_terms TEXT[] DEFAULT '{}',
//   observations JSONB DEFAULT '[]',
//   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
// );

// ============================================================================
// Context Management
// ============================================================================

/**
 * Get or create user context
 */
export async function getUserContext(userId: string): Promise<string> {
  const result = await queryOne<{ context_md: string }>(
    'SELECT context_md FROM user_contexts WHERE user_id = $1',
    [userId]
  );

  if (result) {
    return result.context_md;
  }

  // Create default context
  await execute(
    `INSERT INTO user_contexts (user_id, context_md)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, DEFAULT_CONTEXT]
  );

  return DEFAULT_CONTEXT;
}

/**
 * Update user context with new observation
 */
export async function addObservation(
  userId: string,
  observation: string,
  confidence: 'high' | 'medium' | 'low' = 'medium',
  supersedes?: string
): Promise<void> {
  const newObs: Observation = {
    content: observation,
    confidence,
    timestamp: new Date(),
    supersedes,
  };

  // Get current observations
  const current = await queryOne<{ observations: Observation[] }>(
    'SELECT observations FROM user_contexts WHERE user_id = $1',
    [userId]
  );

  let observations = current?.observations || [];

  // If this supersedes another observation, mark it
  if (supersedes) {
    observations = observations.filter((o) => o.content !== supersedes);
  }

  // Add new observation
  observations.push(newObs);

  // Keep only last 50 observations, favoring recent ones
  if (observations.length > 50) {
    observations = observations.slice(-50);
  }

  await execute(
    `UPDATE user_contexts
     SET observations = $1::jsonb, updated_at = NOW()
     WHERE user_id = $2`,
    [JSON.stringify(observations), userId]
  );

  // Regenerate context markdown
  await regenerateContextMd(userId);
}

/**
 * Record that user used/understood a term (upgrades jargon level for that term)
 */
export async function recordFamiliarTerm(userId: string, term: string): Promise<void> {
  await execute(
    `UPDATE user_contexts
     SET familiar_terms = array_append(
       COALESCE(familiar_terms, '{}'),
       $1
     ),
     updated_at = NOW()
     WHERE user_id = $2`,
    [term.toLowerCase(), userId]
  );

  // Check if we should upgrade jargon level
  await maybeUpgradeJargonLevel(userId);
}

/**
 * Get the appropriate language for a term based on user's level
 */
export async function getTermForUser(
  userId: string,
  jargonTerm: string
): Promise<string> {
  const context = await queryOne<{
    jargon_level: string;
    familiar_terms: string[];
  }>(
    'SELECT jargon_level, familiar_terms FROM user_contexts WHERE user_id = $1',
    [userId]
  );

  const level = context?.jargon_level || 'beginner';
  const familiarTerms = context?.familiar_terms || [];

  // If user has used this term, they're familiar with it
  if (familiarTerms.includes(jargonTerm.toLowerCase())) {
    return jargonTerm;
  }

  // Otherwise, use appropriate alternative
  const alternatives = JARGON_ALTERNATIVES[jargonTerm.toLowerCase()];
  if (!alternatives) return jargonTerm;

  return level === 'advanced' ? jargonTerm :
         level === 'intermediate' ? alternatives.intermediate :
         alternatives.beginner;
}

/**
 * Check if jargon level should be upgraded based on familiar terms
 */
async function maybeUpgradeJargonLevel(userId: string): Promise<void> {
  const context = await queryOne<{
    jargon_level: string;
    familiar_terms: string[];
  }>(
    'SELECT jargon_level, familiar_terms FROM user_contexts WHERE user_id = $1',
    [userId]
  );

  if (!context) return;

  const familiarCount = context.familiar_terms?.length || 0;

  let newLevel = context.jargon_level;
  if (familiarCount >= 15 && context.jargon_level !== 'advanced') {
    newLevel = 'advanced';
  } else if (familiarCount >= 5 && context.jargon_level === 'beginner') {
    newLevel = 'intermediate';
  }

  if (newLevel !== context.jargon_level) {
    await execute(
      'UPDATE user_contexts SET jargon_level = $1, updated_at = NOW() WHERE user_id = $2',
      [newLevel, userId]
    );
  }
}

/**
 * Record explicit user preference
 */
export async function addExplicitPreference(
  userId: string,
  preference: string
): Promise<void> {
  await addObservation(userId, `[EXPLICIT] ${preference}`, 'high');
}

/**
 * Record user milestone (wallet connected, payment made, etc.)
 */
export async function recordMilestone(
  userId: string,
  milestone: 'wallet_connected' | 'payment_made' | 'project_created'
): Promise<void> {
  const milestoneMessages = {
    wallet_connected: 'User connected a wallet',
    payment_made: 'User completed their first payment',
    project_created: 'User created a project',
  };

  await addObservation(userId, milestoneMessages[milestone], 'high');
}

/**
 * Regenerate the context markdown from structured data
 */
async function regenerateContextMd(userId: string): Promise<void> {
  const data = await queryOne<{
    jargon_level: string;
    familiar_terms: string[];
    observations: Observation[];
  }>(
    'SELECT jargon_level, familiar_terms, observations FROM user_contexts WHERE user_id = $1',
    [userId]
  );

  if (!data) return;

  // Separate explicit preferences from observations
  const explicit = data.observations?.filter((o) => o.content.startsWith('[EXPLICIT]')) || [];
  const observed = data.observations?.filter((o) => !o.content.startsWith('[EXPLICIT]')) || [];

  // Sort observations by timestamp, most recent first
  observed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const contextMd = `# User Context

## Communication Style
- Jargon level: ${data.jargon_level}
- Familiar terms: ${data.familiar_terms?.join(', ') || 'none yet'}

## Core Principles
1. DO NOT use more jargon than the user is ready for
2. Mirror the user's language - if they say "share", say "share"
3. Explain through outcomes, not implementation
4. Focus on what they GET, not how it WORKS

## Explicit Preferences
${explicit.length > 0
  ? explicit.map((o) => `- ${o.content.replace('[EXPLICIT] ', '')}`).join('\n')
  : '(none stated)'}

## Observations (newest first)
${observed.length > 0
  ? observed.slice(0, 20).map((o) => {
      const age = getRelativeTime(new Date(o.timestamp));
      return `- [${o.confidence}] ${o.content} (${age})`;
    }).join('\n')
  : '(none yet)'}

---
Last updated: ${new Date().toISOString()}
`;

  await execute(
    'UPDATE user_contexts SET context_md = $1, updated_at = NOW() WHERE user_id = $2',
    [contextMd, userId]
  );
}

/**
 * Analyze a user message for jargon usage
 */
export function detectJargonInMessage(message: string): string[] {
  const jargonTerms = Object.keys(JARGON_ALTERNATIVES);
  const found: string[] = [];

  const lowerMessage = message.toLowerCase();
  for (const term of jargonTerms) {
    if (lowerMessage.includes(term)) {
      found.push(term);
    }
  }

  return found;
}

/**
 * Process user message to update context
 */
export async function processUserMessage(
  userId: string,
  message: string
): Promise<void> {
  // Detect and record any jargon the user uses
  const usedJargon = detectJargonInMessage(message);
  for (const term of usedJargon) {
    await recordFamiliarTerm(userId, term);
  }

  // TODO: Use Claude to extract observations from the message
  // This would be an async background task
}

// ============================================================================
// Input Placeholder Prompts (rotate these, don't use "What's your juicy vision?")
// ============================================================================

export const INPUT_PROMPTS = {
  // Initial/general prompts
  general: [
    "What are you building?",
    "Tell me about your project",
    "What's on your mind?",
    "How can I help?",
    "What would you like to create?",
    "Describe what you're working on",
  ],

  // After user describes a project
  projectDiscovery: [
    "What's the next step?",
    "How do you want supporters to participate?",
    "What does success look like?",
    "Who's your audience?",
    "What makes this special?",
  ],

  // During configuration
  configuring: [
    "Any adjustments?",
    "What else should we consider?",
    "Does this feel right?",
    "Anything to change?",
    "Ready to continue?",
  ],

  // Near payment/launch
  prePayment: [
    "Ready to launch?",
    "Any final tweaks?",
    "Looking good?",
    "Shall we proceed?",
  ],

  // After successful action
  postSuccess: [
    "What's next?",
    "Anything else?",
    "How else can I help?",
    "What now?",
  ],

  // When user seems stuck
  encouragement: [
    "Take your time",
    "No rush - what questions do you have?",
    "Want me to explain anything?",
    "Need a different approach?",
  ],
};

export type PromptContext = keyof typeof INPUT_PROMPTS;

/**
 * Get a contextual input prompt (not "What's your juicy vision?")
 */
export function getInputPrompt(
  context: PromptContext = 'general',
  exclude?: string[]
): string {
  const prompts = INPUT_PROMPTS[context];
  const available = exclude
    ? prompts.filter((p) => !exclude.includes(p))
    : prompts;

  if (available.length === 0) {
    return INPUT_PROMPTS.general[0];
  }

  return available[Math.floor(Math.random() * available.length)];
}

/**
 * Determine appropriate prompt context based on conversation state
 */
export function inferPromptContext(state: {
  hasDescribedProject?: boolean;
  isConfiguring?: boolean;
  nearPayment?: boolean;
  justSucceeded?: boolean;
  seemsStuck?: boolean;
}): PromptContext {
  if (state.justSucceeded) return 'postSuccess';
  if (state.seemsStuck) return 'encouragement';
  if (state.nearPayment) return 'prePayment';
  if (state.isConfiguring) return 'configuring';
  if (state.hasDescribedProject) return 'projectDiscovery';
  return 'general';
}

// ============================================================================
// Helpers
// ============================================================================

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// ============================================================================
// System Prompt Integration
// ============================================================================

/**
 * Generate system prompt section for user context
 */
export async function getContextForSystemPrompt(userId: string): Promise<string> {
  const contextMd = await getUserContext(userId);

  return `
<user-context>
${contextMd}
</user-context>

CRITICAL: Follow the communication style guidelines above. Match the user's jargon level.
If they haven't used crypto/token terminology, use plain language alternatives.
`;
}
