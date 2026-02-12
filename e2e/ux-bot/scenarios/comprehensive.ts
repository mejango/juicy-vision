/**
 * Comprehensive UX Bot Test Scenarios
 *
 * These scenarios cover critical user flows that need exploratory testing.
 * Each scenario is designed to discover UX issues through AI-powered navigation.
 */

// ============================================================================
// Ruleset Management Scenarios
// ============================================================================

export const RULESET_SCENARIOS = {
  main: [
    'As a project owner, navigate to the rules tab and queue a new ruleset with a different reserved rate',
    'View pending rulesets on a project and understand when they will take effect',
    'Try to modify a locked ruleset parameter and verify the UI prevents it',
    'Check the ruleset history on a project to see past configurations',
  ],
  edge: [
    'Queue a ruleset with 100% reserved rate and verify the warning',
    'Try to set a redemption rate above 100% and verify validation',
    'Queue a ruleset that starts immediately vs one with a delay',
    'Cancel a pending ruleset before it takes effect',
  ],
}

// ============================================================================
// Payout Distribution Scenarios
// ============================================================================

export const PAYOUT_SCENARIOS = {
  main: [
    'As a project owner, distribute available payouts to configured splits',
    'Check the split breakdown before distributing payouts',
    'Verify payout limits are displayed correctly for each chain',
    'View payout history to see past distributions',
  ],
  edge: [
    'Try to distribute payouts when there are none available',
    'Distribute payouts on a project with multiple chains',
    'Check what happens when a split recipient address is invalid',
    'Verify the transaction preview for a large payout distribution',
  ],
}

// ============================================================================
// Search & Discovery Scenarios
// ============================================================================

export const SEARCH_SCENARIOS = {
  main: [
    'Search for a project by name using the search interface',
    'Browse featured or popular projects on the home page',
    'Filter projects by category or chain',
    'Find a project by its contract address',
  ],
  edge: [
    'Search for a project that does not exist',
    'Search with special characters or emoji',
    'Search with a very long query string',
    'Clear search and verify results reset',
  ],
}

// ============================================================================
// NFT Tier Edge Case Scenarios
// ============================================================================

export const NFT_TIER_SCENARIOS = {
  main: [
    'View all tiers on a project and their details',
    'Add a new tier with name, price, and supply limit',
    'Edit an existing tier to change its price',
    'Try to delete a tier and confirm the action',
  ],
  edge: [
    'Try to edit a tier that has on-chain metadata (tokenUriResolver)',
    'Try to delete a tier marked as cannotBeRemoved',
    'Add a tier with 0 supply limit (unlimited)',
    'Add a tier with a very high price and verify display',
    'View a sold-out tier and verify purchase is disabled',
    'Add multiple tiers in sequence without page refresh',
  ],
}

// ============================================================================
// Reserved Token Scenarios
// ============================================================================

export const RESERVED_TOKEN_SCENARIOS = {
  main: [
    'View reserved tokens available for distribution',
    'Send reserved tokens to a configured recipient',
    'Check token claim status for different recipients',
    'View the token distribution history',
  ],
  edge: [
    'Try to send more reserved tokens than available',
    'Send tokens to multiple recipients in one transaction',
    'Check reserved tokens on a project with 0% reserved rate',
    'Verify token decimals are displayed correctly',
  ],
}

// ============================================================================
// Multi-Chain (Omnichain) Scenarios
// ============================================================================

export const OMNICHAIN_SCENARIOS = {
  main: [
    'Switch between chains on a multi-chain project',
    'View aggregated balances across all chains',
    'Make a payment on a specific chain',
    'Check activity feed showing cross-chain transactions',
  ],
  edge: [
    'Switch to a chain where the project is not deployed',
    'View a project that exists on testnet but not mainnet',
    'Check gas estimates on different chains',
    'Handle a chain RPC being temporarily unavailable',
  ],
}

// ============================================================================
// Chat & AI Scenarios
// ============================================================================

export const CHAT_SCENARIOS = {
  main: [
    'Start a new conversation with the AI assistant',
    'Ask the AI to help create a new project step by step',
    'Ask the AI to explain how redemption rates work',
    'Request help with setting up NFT tiers',
  ],
  edge: [
    'Send a very long message to the chat',
    'Interrupt a streaming response by navigating away',
    'Send multiple messages rapidly before responses complete',
    'Ask the AI about a specific on-chain project by address',
  ],
}

// ============================================================================
// Authentication Edge Cases
// ============================================================================

export const AUTH_EDGE_SCENARIOS = {
  main: [
    'Sign in with email and verify the session persists',
    'Sign out and verify all auth state is cleared',
    'Switch from managed wallet to external wallet',
    'Connect a wallet while already signed in',
  ],
  edge: [
    'Let the session expire and verify re-auth prompt',
    'Sign in on two browser tabs simultaneously',
    'Clear browser storage while signed in',
    'Connect a wallet with insufficient permissions',
  ],
}

// ============================================================================
// Error Recovery Scenarios
// ============================================================================

export const ERROR_RECOVERY_SCENARIOS = {
  main: [
    'Trigger a network error and verify the app recovers gracefully',
    'Submit a transaction that fails and verify the error message',
    'Navigate to a project that does not exist',
    'Load a page with invalid URL parameters',
  ],
  edge: [
    'Disconnect internet mid-operation and verify handling',
    'Submit a form with validation errors and correct them',
    'Click a button multiple times rapidly',
    'Navigate back/forward during an async operation',
  ],
}

// ============================================================================
// All Scenarios Combined
// ============================================================================

export const ALL_COMPREHENSIVE_SCENARIOS = {
  ruleset: RULESET_SCENARIOS,
  payout: PAYOUT_SCENARIOS,
  search: SEARCH_SCENARIOS,
  nftTier: NFT_TIER_SCENARIOS,
  reservedTokens: RESERVED_TOKEN_SCENARIOS,
  omnichain: OMNICHAIN_SCENARIOS,
  chat: CHAT_SCENARIOS,
  authEdge: AUTH_EDGE_SCENARIOS,
  errorRecovery: ERROR_RECOVERY_SCENARIOS,
}

/**
 * Get all main scenarios as a flat array
 */
export function getAllMainScenarios(): string[] {
  return [
    ...RULESET_SCENARIOS.main,
    ...PAYOUT_SCENARIOS.main,
    ...SEARCH_SCENARIOS.main,
    ...NFT_TIER_SCENARIOS.main,
    ...RESERVED_TOKEN_SCENARIOS.main,
    ...OMNICHAIN_SCENARIOS.main,
    ...CHAT_SCENARIOS.main,
    ...AUTH_EDGE_SCENARIOS.main,
    ...ERROR_RECOVERY_SCENARIOS.main,
  ]
}

/**
 * Get all edge case scenarios as a flat array
 */
export function getAllEdgeScenarios(): string[] {
  return [
    ...RULESET_SCENARIOS.edge,
    ...PAYOUT_SCENARIOS.edge,
    ...SEARCH_SCENARIOS.edge,
    ...NFT_TIER_SCENARIOS.edge,
    ...RESERVED_TOKEN_SCENARIOS.edge,
    ...OMNICHAIN_SCENARIOS.edge,
    ...CHAT_SCENARIOS.edge,
    ...AUTH_EDGE_SCENARIOS.edge,
    ...ERROR_RECOVERY_SCENARIOS.edge,
  ]
}

/**
 * Get a random scenario from a category
 */
export function getRandomScenario(category: keyof typeof ALL_COMPREHENSIVE_SCENARIOS): string {
  const scenarios = ALL_COMPREHENSIVE_SCENARIOS[category]
  const all = [...scenarios.main, ...scenarios.edge]
  return all[Math.floor(Math.random() * all.length)]
}
