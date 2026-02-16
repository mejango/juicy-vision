/**
 * Transaction Context Sub-Modules
 *
 * Granular knowledge modules for transaction-related operations.
 * Each module is ~200-1500 tokens and loaded on demand based on intent detection.
 *
 * Total TRANSACTION_CONTEXT when fully loaded: ~8000 tokens
 * Average request with 2-3 sub-modules: ~2000-3500 tokens
 */

export * from './chains.ts';
export * from './v51Addresses.ts';
export * from './v5Addresses.ts';
export * from './terminals.ts';
export * from './splitsLimits.ts';
export * from './nftTiers.ts';
export * from './revnetParams.ts';
export * from './rulesets.ts';
export * from './deployment.ts';
export * from './metadata.ts';

// Re-export reference modules for convenience
export * from '../reference/index.ts';

import { CHAINS_CONTEXT, CHAINS_HINTS, CHAINS_TOKEN_ESTIMATE } from './chains.ts';
import { V51_ADDRESSES_CONTEXT, V51_ADDRESSES_HINTS, V51_ADDRESSES_TOKEN_ESTIMATE } from './v51Addresses.ts';
import { V5_ADDRESSES_CONTEXT, V5_ADDRESSES_HINTS, V5_ADDRESSES_TOKEN_ESTIMATE } from './v5Addresses.ts';
import { TERMINALS_CONTEXT, TERMINALS_HINTS, TERMINALS_TOKEN_ESTIMATE } from './terminals.ts';
import { SPLITS_LIMITS_CONTEXT, SPLITS_LIMITS_HINTS, SPLITS_LIMITS_TOKEN_ESTIMATE } from './splitsLimits.ts';
import { NFT_TIERS_CONTEXT, NFT_TIERS_HINTS, NFT_TIERS_TOKEN_ESTIMATE } from './nftTiers.ts';
import { REVNET_PARAMS_CONTEXT, REVNET_PARAMS_HINTS, REVNET_PARAMS_TOKEN_ESTIMATE } from './revnetParams.ts';
import { RULESETS_CONTEXT, RULESETS_HINTS, RULESETS_TOKEN_ESTIMATE } from './rulesets.ts';
import { DEPLOYMENT_CONTEXT, DEPLOYMENT_HINTS, DEPLOYMENT_TOKEN_ESTIMATE } from './deployment.ts';
import { METADATA_CONTEXT, METADATA_HINTS, METADATA_TOKEN_ESTIMATE } from './metadata.ts';
import {
  REFERENCE_MODULES,
  ADDRESSES_CONTEXT, ADDRESSES_HINTS, ADDRESSES_TOKEN_ESTIMATE,
  CURRENCIES_CONTEXT, CURRENCIES_HINTS, CURRENCIES_TOKEN_ESTIMATE,
  STRUCTURES_CONTEXT, STRUCTURES_HINTS, STRUCTURES_TOKEN_ESTIMATE,
} from '../reference/index.ts';

/**
 * Sub-module registry for dynamic loading
 */
export interface SubModule {
  id: string;
  content: string;
  hints: string[];
  tokenEstimate: number;
  description: string;
}

export const TRANSACTION_SUB_MODULES: SubModule[] = [
  {
    id: 'chains',
    content: CHAINS_CONTEXT,
    hints: CHAINS_HINTS,
    tokenEstimate: CHAINS_TOKEN_ESTIMATE,
    description: 'Chain IDs and explorers',
  },
  {
    id: 'v51_addresses',
    content: V51_ADDRESSES_CONTEXT,
    hints: V51_ADDRESSES_HINTS,
    tokenEstimate: V51_ADDRESSES_TOKEN_ESTIMATE,
    description: 'V5.1 contract addresses for new projects',
  },
  {
    id: 'v5_addresses',
    content: V5_ADDRESSES_CONTEXT,
    hints: V5_ADDRESSES_HINTS,
    tokenEstimate: V5_ADDRESSES_TOKEN_ESTIMATE,
    description: 'V5.0 contract addresses for revnets',
  },
  {
    id: 'terminals',
    content: TERMINALS_CONTEXT,
    hints: TERMINALS_HINTS,
    tokenEstimate: TERMINALS_TOKEN_ESTIMATE,
    description: 'Terminal configuration and accounting contexts',
  },
  {
    id: 'splits_limits',
    content: SPLITS_LIMITS_CONTEXT,
    hints: SPLITS_LIMITS_HINTS,
    tokenEstimate: SPLITS_LIMITS_TOKEN_ESTIMATE,
    description: 'Split groups and fund access limits',
  },
  {
    id: 'nft_tiers',
    content: NFT_TIERS_CONTEXT,
    hints: NFT_TIERS_HINTS,
    tokenEstimate: NFT_TIERS_TOKEN_ESTIMATE,
    description: 'NFT tier configuration for 721 projects',
  },
  {
    id: 'revnet_params',
    content: REVNET_PARAMS_CONTEXT,
    hints: REVNET_PARAMS_HINTS,
    tokenEstimate: REVNET_PARAMS_TOKEN_ESTIMATE,
    description: 'Revnet deployment parameters',
  },
  {
    id: 'rulesets',
    content: RULESETS_CONTEXT,
    hints: RULESETS_HINTS,
    tokenEstimate: RULESETS_TOKEN_ESTIMATE,
    description: 'Ruleset configuration and queueRulesets',
  },
  {
    id: 'deployment',
    content: DEPLOYMENT_CONTEXT,
    hints: DEPLOYMENT_HINTS,
    tokenEstimate: DEPLOYMENT_TOKEN_ESTIMATE,
    description: 'Deployment configuration and omnichain setup',
  },
  {
    id: 'metadata',
    content: METADATA_CONTEXT,
    hints: METADATA_HINTS,
    tokenEstimate: METADATA_TOKEN_ESTIMATE,
    description: 'Project metadata and setUriOf',
  },
  // Reference modules (single-source-of-truth)
  {
    id: 'ref_addresses',
    content: ADDRESSES_CONTEXT,
    hints: ADDRESSES_HINTS,
    tokenEstimate: ADDRESSES_TOKEN_ESTIMATE,
    description: 'All contract addresses (single source of truth)',
  },
  {
    id: 'ref_currencies',
    content: CURRENCIES_CONTEXT,
    hints: CURRENCIES_HINTS,
    tokenEstimate: CURRENCIES_TOKEN_ESTIMATE,
    description: 'Currency codes and groupId rules (single source of truth)',
  },
  {
    id: 'ref_structures',
    content: STRUCTURES_CONTEXT,
    hints: STRUCTURES_HINTS,
    tokenEstimate: STRUCTURES_TOKEN_ESTIMATE,
    description: 'Struct definitions (single source of truth)',
  },
];

/**
 * Get sub-module by ID
 */
export function getSubModule(id: string): SubModule | undefined {
  return TRANSACTION_SUB_MODULES.find(m => m.id === id);
}

/**
 * Get all sub-module IDs
 */
export function getSubModuleIds(): string[] {
  return TRANSACTION_SUB_MODULES.map(m => m.id);
}

/**
 * Build combined context from selected sub-modules
 */
export function buildTransactionContext(moduleIds: string[]): string {
  const parts: string[] = ['## Contract Reference'];

  for (const id of moduleIds) {
    const module = getSubModule(id);
    if (module) {
      parts.push(module.content);
    }
  }

  return parts.join('\n\n');
}

/**
 * Estimate total tokens for selected sub-modules
 */
export function estimateSubModuleTokens(moduleIds: string[]): number {
  return moduleIds.reduce((total, id) => {
    const module = getSubModule(id);
    return total + (module?.tokenEstimate || 0);
  }, 0);
}

/**
 * Get sub-modules needed based on keyword matching
 */
export function matchSubModulesByKeywords(text: string): string[] {
  const lowerText = text.toLowerCase();
  const matched = new Set<string>();

  for (const module of TRANSACTION_SUB_MODULES) {
    for (const hint of module.hints) {
      if (lowerText.includes(hint.toLowerCase())) {
        matched.add(module.id);
        break;
      }
    }
  }

  return Array.from(matched);
}

/**
 * Core transaction context header (always included when any transaction sub-module is loaded)
 */
export const TRANSACTION_CORE = `
## Transaction Requirements

**SPEED:** When generating transaction-preview, do NOT call any tools. All information should already be in the conversation. Tool calls add latency - just use what you know.

(See "Transaction Safety" section in BASE_PROMPT for the 4 most critical rules and self-validation checklist)

### All Transactions Checklist

- [ ] User CAN execute (permission)
- [ ] Sufficient balance
- [ ] Action explained concisely
- [ ] Parameters with values
- [ ] Fees mentioned (2.5% payouts/allowance)
- [ ] Irreversible warned
- [ ] Chain confirmed
- [ ] Amounts with units

Fails? Don't show button - explain and offer guidance.

**transaction-preview explanation:** Keep it SHORT (1 sentence max). The UI shows rich preview sections for project info, tiers, and funding - the explanation is just a brief summary.

**NEVER mention in explanation:**
- Blockchain names (Ethereum, Optimism, Base, Arbitrum)
- Technical terms (chains, multi-chain, omnichain, cross-chain)
- Contract names or addresses
- IPFS, metadata, parameters

**Good explanation:** "Launch your bike repair collective. Supporters who contribute $5+ get a free tune-up."
**Bad explanation:** "Launch your bike repair collective funding project on Ethereum, Optimism, Base, and Arbitrum..."

### action-button

**REMOVED - NEVER USE.** The transaction-preview component has a built-in action button. NEVER output a separate action-button component.
`;

export const TRANSACTION_CORE_TOKEN_ESTIMATE = 400;
