/**
 * Modular Prompt System
 *
 * This module provides a scalable routing system for specialist knowledge.
 * Instead of loading 8,500-19,500 tokens of static knowledge per request,
 * it loads only the sub-modules needed for the specific intent.
 *
 * Architecture:
 * - BASE_PROMPT: Always loaded (~6k tokens)
 * - Domain contexts: DATA_QUERY, HOOK_DEVELOPER, TRANSACTION
 * - Sub-modules: Granular knowledge chunks (200-1500 tokens each)
 *
 * Usage:
 * 1. Detect intents using keyword matching or semantic similarity
 * 2. Load only the domain contexts needed
 * 3. For TRANSACTION domain, load only specific sub-modules
 * 4. Combine with BASE_PROMPT for final system prompt
 */

// Keyword hints shared with intent detection.
export { INTENT_HINTS } from '../prompts.ts';

// Transaction sub-module registry + loaders.
export {
  TRANSACTION_SUB_MODULES,
  TRANSACTION_CORE,
  TRANSACTION_CORE_TOKEN_ESTIMATE,
  buildTransactionContext,
  estimateSubModuleTokens,
  matchSubModulesByKeywords,
} from './transaction/index.ts';

/**
 * Semantic descriptions for embedding-based matching
 */
export const SUB_MODULE_DESCRIPTIONS = {
  chains: 'Information about blockchain networks, chain IDs, and block explorers',
  v6_addresses: 'V6 contract addresses (same on every chain) for projects, revnets, and sucker deployers',
  terminals: 'Terminal configuration, USDC addresses, accounting contexts, and the router terminal registry',
  splits_limits: 'Split groups, fund access limits, payout configuration, and withdrawal settings',
  nft_tiers: 'NFT tier configuration for 721 projects with perks and rewards',
  revnet_params: 'Revnet deployment parameters including issuance decay and split percentages',
  rulesets: 'Ruleset configuration, weight, duration, and queueRulesets operation',
  deployment: 'Deployment configuration, omnichain setup, and sucker deployment',
  metadata: 'Project metadata, IPFS, setUriOf operation, and project name/description updates',
};

/**
 * Example queries for each sub-module (for training embedding similarity)
 */
export const SUB_MODULE_EXAMPLES = {
  chains: [
    'What chains does this support?',
    'Which blockchain should I use?',
    'What is the chain ID for Base?',
    'Show me the explorer link',
  ],
  v6_addresses: [
    'Deploy a new project',
    'Launch my project',
    'What contract do I use to create a project?',
    'Give me the JBController address',
    'I want to create a revnet',
    'What is the REVDeployer address?',
    'How do I bridge tokens?',
    'Set up cross-chain for my project',
  ],
  terminals: [
    'Accept USDC payments',
    'What terminal should I use?',
    'Configure payment tokens',
    'Set up accounting context',
  ],
  splits_limits: [
    'How much can I withdraw?',
    'Set up payout limits',
    'Configure splits for my team',
    'I have a funding goal of $10,000',
  ],
  nft_tiers: [
    'Add perks to my project',
    'Create reward tiers',
    'Set up NFT rewards',
    'What do supporters get?',
  ],
  revnet_params: [
    'Create an autonomous project',
    'Set up issuance decay',
    'Configure revnet parameters',
    'No human control over the project',
  ],
  rulesets: [
    'Change my project settings',
    'Update the issuance rate',
    'Queue a new ruleset',
    'Modify reserved percentage',
  ],
  deployment: [
    'Deploy to all chains',
    'Set up omnichain project',
    'Configure cross-chain bridging',
    'What is the sucker configuration?',
  ],
  metadata: [
    'Change my project name',
    'Update the description',
    'Add a logo',
    'How do I rename my project?',
  ],
};
