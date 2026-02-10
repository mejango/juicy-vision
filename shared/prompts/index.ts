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

// Re-export everything from the original prompts.ts for backward compatibility
export {
  BASE_PROMPT,
  DATA_QUERY_CONTEXT,
  HOOK_DEVELOPER_CONTEXT,
  TRANSACTION_CONTEXT,
  EXAMPLE_INTERACTIONS,
  SYSTEM_PROMPT,
  INTENT_HINTS,
  MODULE_TOKENS,
} from '../prompts.ts';

// Export transaction sub-modules
export {
  TRANSACTION_SUB_MODULES,
  TRANSACTION_CORE,
  TRANSACTION_CORE_TOKEN_ESTIMATE,
  getSubModule,
  getSubModuleIds,
  buildTransactionContext,
  estimateSubModuleTokens,
  matchSubModulesByKeywords,
  type SubModule,
} from './transaction/index.ts';

// Export individual sub-modules for direct access
export {
  CHAINS_CONTEXT,
  CHAINS_HINTS,
  CHAINS_TOKEN_ESTIMATE,
} from './transaction/chains.ts';

export {
  V51_ADDRESSES_CONTEXT,
  V51_ADDRESSES_HINTS,
  V51_ADDRESSES_TOKEN_ESTIMATE,
} from './transaction/v51Addresses.ts';

export {
  V5_ADDRESSES_CONTEXT,
  V5_ADDRESSES_HINTS,
  V5_ADDRESSES_TOKEN_ESTIMATE,
} from './transaction/v5Addresses.ts';

export {
  TERMINALS_CONTEXT,
  TERMINALS_HINTS,
  TERMINALS_TOKEN_ESTIMATE,
} from './transaction/terminals.ts';

export {
  SPLITS_LIMITS_CONTEXT,
  SPLITS_LIMITS_HINTS,
  SPLITS_LIMITS_TOKEN_ESTIMATE,
} from './transaction/splitsLimits.ts';

export {
  NFT_TIERS_CONTEXT,
  NFT_TIERS_HINTS,
  NFT_TIERS_TOKEN_ESTIMATE,
} from './transaction/nftTiers.ts';

export {
  REVNET_PARAMS_CONTEXT,
  REVNET_PARAMS_HINTS,
  REVNET_PARAMS_TOKEN_ESTIMATE,
} from './transaction/revnetParams.ts';

export {
  RULESETS_CONTEXT,
  RULESETS_HINTS,
  RULESETS_TOKEN_ESTIMATE,
} from './transaction/rulesets.ts';

export {
  DEPLOYMENT_CONTEXT,
  DEPLOYMENT_HINTS,
  DEPLOYMENT_TOKEN_ESTIMATE,
} from './transaction/deployment.ts';

export {
  METADATA_CONTEXT,
  METADATA_HINTS,
  METADATA_TOKEN_ESTIMATE,
} from './transaction/metadata.ts';

/**
 * Intent detection hints for sub-modules
 * Used for granular routing within TRANSACTION domain
 */
export const SUB_MODULE_HINTS = {
  chains: ['chain', 'network', 'ethereum', 'optimism', 'base', 'arbitrum'],
  v51_addresses: ['deploy', 'launch', 'create project', 'new project', 'v5.1'],
  v5_addresses: ['revnet', 'autonomous', 'REVDeployer', 'v5.0', 'sucker'],
  terminals: ['terminal', 'USDC', 'accountingContext', 'payment', 'accept'],
  splits_limits: ['payout', 'split', 'withdraw', 'fund access', 'goal', 'surplus'],
  nft_tiers: ['tier', 'NFT', '721', 'perks', 'rewards', 'collectible'],
  revnet_params: ['revnet', 'issuance decay', 'autonomous', 'splitPercent'],
  rulesets: ['ruleset', 'weight', 'duration', 'reserved', 'queue ruleset'],
  deployment: ['deploy', 'launch', 'create', 'omnichain', 'sucker'],
  metadata: ['name', 'description', 'logo', 'setUriOf', 'rename'],
};

/**
 * Semantic descriptions for embedding-based matching
 */
export const SUB_MODULE_DESCRIPTIONS = {
  chains: 'Information about blockchain networks, chain IDs, and block explorers',
  v51_addresses: 'Contract addresses for deploying new V5.1 projects',
  v5_addresses: 'Contract addresses for revnets and V5.0 projects, including sucker deployers',
  terminals: 'Terminal configuration, USDC addresses, accounting contexts, and swap terminals',
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
  v51_addresses: [
    'Deploy a new project',
    'Launch my project',
    'What contract do I use to create a project?',
    'Give me the JBController address',
  ],
  v5_addresses: [
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
