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
export * from './v6Addresses.ts';
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
import {
  V6_ADDRESSES_CONTEXT,
  V6_ADDRESSES_HINTS,
  V6_ADDRESSES_TOKEN_ESTIMATE,
} from './v6Addresses.ts';
import { TERMINALS_CONTEXT, TERMINALS_HINTS, TERMINALS_TOKEN_ESTIMATE } from './terminals.ts';
import {
  SPLITS_LIMITS_CONTEXT,
  SPLITS_LIMITS_HINTS,
  SPLITS_LIMITS_TOKEN_ESTIMATE,
} from './splitsLimits.ts';
import { NFT_TIERS_CONTEXT, NFT_TIERS_HINTS, NFT_TIERS_TOKEN_ESTIMATE } from './nftTiers.ts';
import {
  REVNET_PARAMS_CONTEXT,
  REVNET_PARAMS_HINTS,
  REVNET_PARAMS_TOKEN_ESTIMATE,
} from './revnetParams.ts';
import { RULESETS_CONTEXT, RULESETS_HINTS, RULESETS_TOKEN_ESTIMATE } from './rulesets.ts';
import { DEPLOYMENT_CONTEXT, DEPLOYMENT_HINTS, DEPLOYMENT_TOKEN_ESTIMATE } from './deployment.ts';
import { METADATA_CONTEXT, METADATA_HINTS, METADATA_TOKEN_ESTIMATE } from './metadata.ts';
import {
  ADDRESSES_CONTEXT,
  ADDRESSES_HINTS,
  ADDRESSES_TOKEN_ESTIMATE,
  CURRENCIES_CONTEXT,
  CURRENCIES_HINTS,
  CURRENCIES_TOKEN_ESTIMATE,
  STRUCTURES_CONTEXT,
  STRUCTURES_HINTS,
  STRUCTURES_TOKEN_ESTIMATE,
} from '../reference/index.ts';

/**
 * Sub-module registry for dynamic loading
 */
interface SubModule {
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
    id: 'v6_addresses',
    content: V6_ADDRESSES_CONTEXT,
    hints: V6_ADDRESSES_HINTS,
    tokenEstimate: V6_ADDRESSES_TOKEN_ESTIMATE,
    description: 'V6 discovery roots and runtime-owned routing policy',
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
    description: 'JBDirectory/JBProjects discovery roots',
  },
  {
    id: 'ref_currencies',
    content: CURRENCIES_CONTEXT,
    hints: CURRENCIES_HINTS,
    tokenEstimate: CURRENCIES_TOKEN_ESTIMATE,
    description: 'Currency and group semantics; values are runtime-derived',
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
function getSubModule(id: string): SubModule | undefined {
  return TRANSACTION_SUB_MODULES.find((m) => m.id === id);
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

**FRESHNESS AND TRUST:** For an existing project, use only JBDirectory and JBProjects as hardcoded discovery roots. Immediately before the action, derive the current controller, terminals, accounting contexts, dependencies, ruleset hooks, 721 hook, and split hooks from live project state. Every actionable singleton must both match that live state and be explicitly recognized by Juicy. For clone-type 721, Defifa, and LP split hooks, derive the address registry from a recognized deployer and require that registry to identify the same recognized deployer for the clone. Any unknown contract blocks unconditionally. ABI compatibility, ERC-165/interface support, bytecode shape, successful reads, and successful simulation do not establish trust. Never call \`pay\` or any other function on an unknown contract, guess a fallback, or auto-correct an address. Also verify permissions, active ruleset, token/currency, and amounts from Bendystraw or chain unless that exact state was just fetched.

(See "Transaction Safety" section in BASE_PROMPT for the 5 most critical rules and self-validation checklist)

### All Transactions Checklist

- [ ] User CAN execute (permission)
- [ ] Sufficient balance
- [ ] Action explained concisely
- [ ] Parameters with values
- [ ] Fees mentioned (2.5% payouts/allowance)
- [ ] Irreversible warned
- [ ] Chain confirmed
- [ ] Amounts with units
- [ ] Existing-project targets freshly discovered and explicitly recognized

Fails? Do not show an execution button. State the unavailable or unsupported
configuration plainly without suggesting a fallback contract.

Use only the dedicated guarded form for the requested operation. Never emit raw
calldata, target addresses, or a generic raw-transaction component for an
existing-project write.

**NEVER mention in explanation:**
- Blockchain names (Ethereum, Optimism, Base, Arbitrum)
- Technical terms (chains, multi-chain, omnichain, cross-chain)
- Contract names or addresses
- IPFS, metadata, parameters

**Good explanation:** "Launch your bike repair fundraiser with a $5 tune-up reward."
**Bad explanation:** "Deploy these parameters to this contract on four chains."

`;

export const TRANSACTION_CORE_TOKEN_ESTIMATE = 400;
