/**
 * Omnichain/Sucker Knowledge Base
 *
 * Comprehensive context about how Juicebox V6 omnichain projects work,
 * including the V6 contract set, suckers, cross-chain token bridging, and user flows.
 */

import { CONTRACTS } from '@shared/chains.ts';

export const OMNICHAIN_CONTEXT = `
## Juicebox V6

Juicebox V6 is the protocol. There is a single contract set — every project, including Revnets, uses the same V6 contracts. There is no per-project version detection. JBDirectory and JBProjects are the only hardcoded discovery roots. For every existing-project action, derive the current controller, terminals, accounting contexts, dependencies, and hooks from live project state. Require every singleton to be explicitly recognized. For clone-type 721, Defifa, and LP split hooks, derive the address registry from a recognized deployer and require that registry to identify the same recognized deployer for the clone. Any unknown controller, terminal, hook, dependency, or other target blocks unconditionally. ABI/interface compatibility, successful reads, and successful simulation never establish trust and must never authorize a transaction.

Juicy Vision exposes bridge discovery and status as read-only information. It does not prepare \`prepare\`, \`toRemote\`, or \`claim\` transactions. Never construct raw bridge calldata or prompt a user to send a bridge transaction from tool output.

### V6 Core Contracts (same address on every supported chain — mainnets and Sepolia testnets — via CREATE2)

Except for JBDirectory and JBProjects, these are deployment and recognition references, not existing-project routing fallbacks.

| Contract | Address | Role |
|----------|---------|------|
| JBController | ${CONTRACTS.JBController} | Rulesets, token issuance, reserved splits, project URI |
| JBMultiTerminal | ${CONTRACTS.JBMultiTerminal} | Payments, cash outs, payouts, surplus allowance |
| JBRulesets | ${CONTRACTS.JBRulesets} | Ruleset storage and cycling |
| JBTerminalStore | ${CONTRACTS.JBTerminalStore} | Terminal balance/accounting reads |
| JBTokens | ${CONTRACTS.JBTokens} | Project token + credit balances |
| JBProjects | ${CONTRACTS.JBProjects} | Project ownership NFTs |
| JBDirectory | ${CONTRACTS.JBDirectory} | controllerOf / terminalsOf / primaryTerminalOf |
| JBSplits | ${CONTRACTS.JBSplits} | Split storage |
| JBPermissions | ${CONTRACTS.JBPermissions} | Operator permissions |
| JBOmnichainDeployer | ${CONTRACTS.JBOmnichainDeployer} | Project deployment (use this to deploy, not the controller) |
| JBRouterTerminal | ${CONTRACTS.JBRouterTerminal} | Routes arbitrary-token payments (V6 has NO swap terminal — the router terminal replaces it) |
| JBSuckerRegistry | ${CONTRACTS.JBSuckerRegistry} | Sucker deployments and pair discovery |
| REVDeployer | ${CONTRACTS.REVDeployer} | Revnet deployment |
| REVLoans | ${CONTRACTS.REVLoans} | Loans against revnet tokens |

### V6 Flows in Brief

- **Pay**: Resolve the project's live terminal route through JBDirectory, require the returned terminal to be recognized, and only then call \`pay(projectId, token, amount, beneficiary, minReturnedTokens, memo, metadata)\` with a fresh non-zero output floor. If no recognized live route exists, block; never direct a payment to a hardcoded or merely interface-compatible terminal.
- **Cash out**: Resolve the selected accounting token's terminal from JBDirectory and require it to be the recognized accounting terminal before using \`cashOutTokensOf(...)\`. The ruleset's cashOutTaxRate is a bonding-curve parameter, not a flat fee.
- **Payouts**: Resolve and recognize the current accounting terminal before \`sendPayoutsOf(...)\`; use the current limit and split group for that exact terminal/token context.
- **Rulesets**: Resolve the current controller and data-hook route live. Direct projects queue through their recognized controller. Projects whose current ruleset is wrapped by the recognized JBOmnichainDeployer queue through that derived wrapper so its next-ruleset hook mappings are configured. Unknown routes and Revnets block. Metadata includes reservedPercent, cashOutTaxRate, baseCurrency, pause flags, and \`scopeCashOutsToLocalBalances\` (whether omnichain cash outs use only local-chain balances).

## Omnichain Juicebox Projects

### What is an Omnichain Project?

An omnichain project exists as multiple independent instances across different blockchain networks (Ethereum mainnet, Optimism, Arbitrum, Base — plus their Sepolia testnets). Each chain has its own:
- Project ID (may differ per chain)
- ERC-20 token contract
- Terminal (handles payments and cash outs)
- Treasury balance

The key innovation: when users bridge tokens between chains, they take their proportional share of the treasury with them. This maintains each token's backing value regardless of which chain it's on.

### What are Suckers?

Suckers are specialized bridge contracts that connect project instances across chains. Unlike standard token bridges, suckers:
- Bridge project tokens AND their proportional treasury backing simultaneously
- Use merkle trees to batch and verify cross-chain transfers
- Support multiple bridge protocols (OP Stack, Arbitrum, Chainlink CCIP)

Each chain pair has a sucker contract on both ends that communicate as peers.

### How Token Bridging Works

**The Complete Flow:**

1. **Prepare Phase** (Source Chain)
   - User calls \`prepare(projectTokenCount, beneficiary, minTokensReclaimed, token, metadata)\`
   - \`beneficiary\` is a bytes32 (an EVM address left-padded to 32 bytes, for cross-VM compatibility); \`metadata\` is an opaque bytes32 attribution payload — pass zero for ordinary bridges
   - Sucker burns the user's project tokens
   - Sucker cashes out through the project's live accounting terminal, receiving the selected mapped backing token
   - Transaction added as a leaf to the outbox merkle tree
   - Status: "pending"

2. **Execute Phase** (Cross-Chain Message)
   - User or relayer calls \`toRemote(token)\`
   - Sucker computes merkle root of all pending leaves
   - Root + funds sent via bridge (OP Messenger, Arbitrum Inbox, or CCIP)
   - The transfer becomes "claimable" only after the root arrives on the destination chain

3. **Claim Phase** (Destination Chain)
   - User calls \`claim()\` with merkle proof
   - Sucker verifies proof against inbox root
   - Project tokens minted to beneficiary
   - ETH/USDC credited to project's terminal balance
   - Status: "claimed"

### Bridge Fee Structure

Bridge fees vary by route. Native suckers require the registry's exact \`toRemoteFee\`; adding a buffer can make them revert. CCIP suckers also require a live transport budget, which must be discovered by simulating the exact verified sucker, token, and caller. A successful simulation never makes an otherwise unknown sucker trusted.

### Transaction States

| Status | Meaning | User Action |
|--------|---------|-------------|
| pending | Prepared but not sent | Execute bridge |
| claimable | Root sent, awaiting claim | Claim on destination |
| claimed | Complete | None |

### Token Mapping

Projects must explicitly map which tokens can be bridged:
- Local token address → Remote token address
- Minimum gas for cross-chain call

Common mappings:
- Native ETH on one chain → Native ETH on another
- USDC on Ethereum → USDC on Optimism (different addresses)

### Emergency Procedures

If a bridge becomes non-functional:
1. Project owner can enable "emergency hatch" for specific tokens
2. Users can exit locally via \`exitThroughEmergencyHatch()\`
3. Funds recovered on original chain without bridging

### Bridge Discovery

Derive the project's current controller from JBDirectory, derive its current recognized bridge-aware data hook, then read that hook's \`SUCKER_REGISTRY()\`. The derived registry must be a recognized deployment whose \`DIRECTORY()\` and \`PROJECTS()\` are the two trusted roots. Only then may \`suckerPairsOf(projectId)\` be used. Every returned sucker must also be registered for that project and report the same roots, registry, project ID, peer, and peer chain. If any check fails, report that the bridge route is not recognized and stop.

### Important Considerations for Users

1. **Value Preservation**: When bridging, the token's backing (treasury share) moves with it. The token maintains the same value.

2. **Timing**:
   - Prepare: Immediate
   - Execute: Depends on bridge finality (minutes to hours)
   - Claim: Immediate once root arrives

3. **Batching**: Multiple users' prepares can be batched into one \`toRemote()\` call, sharing gas costs.

4. **Slippage**: The \`minTokensReclaimed\` parameter protects against unfavorable cash-out rates during prepare.

### Cross-Chain Balance Queries

To check a user's project tokens across all chains:
1. Get sucker pairs from registry
2. Query each chain's token contract for balance
3. Sum for total cross-chain holdings

### Common User Questions

**Q: Why do I need to claim separately?**
A: Cross-chain messaging is asynchronous. The claim step verifies your proof after the root arrives.

**Q: Can I bridge to any chain?**
A: Only to chains exposed by the project's live, recognized sucker registry. Juicy Vision can show those verified routes and their status, but does not prepare bridge transactions.

**Q: What happens if the bridge fails?**
A: Your funds stay in the outbox on the source chain. Wait for the bridge to recover, or use emergency hatch if enabled.

**Q: Why is my bridge "pending" for a long time?**
A: The \`toRemote()\` step hasn't been executed yet. Either you or a relayer needs to call it.

**Q: Can I cancel a prepared bridge?**
A: No. Once prepared, tokens are burned. You must complete the bridge or wait for emergency hatch.
`;

/**
 * Supported chains for omnichain projects
 */
export const SUPPORTED_CHAINS = {
  1: { name: 'Ethereum', native: 'ETH', explorer: 'https://etherscan.io' },
  10: { name: 'Optimism', native: 'ETH', explorer: 'https://optimistic.etherscan.io' },
  8453: { name: 'Base', native: 'ETH', explorer: 'https://basescan.org' },
  42161: { name: 'Arbitrum', native: 'ETH', explorer: 'https://arbiscan.io' },
} as const;

/**
 * Tool definitions for omnichain operations
 */
export const OMNICHAIN_TOOLS = [
  // === Documentation Tools (via docs.juicebox.money MCP API) ===
  {
    name: 'search_docs',
    description:
      'Search Juicebox documentation for concepts, guides, and API reference. Use when users ask "how does X work?" or need technical explanations about the protocol.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query - what to find in the docs',
        },
        category: {
          type: 'string',
          enum: ['developer', 'user', 'dao', 'ecosystem', 'all'],
          description: 'Category to search within (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_doc',
    description:
      'Get a specific documentation page by path or title. Use when you need the full content of a known doc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Document path like "dev/v6/build/examples/pay"',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_contracts',
    description:
      'Get Juicebox V6 contract addresses. Use when users ask for contract addresses on specific chains.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contract: {
          type: 'string',
          description: 'Contract name filter like "JBController", "JBMultiTerminal", "REVDeployer"',
        },
        chainId: {
          type: 'string',
          enum: ['1', '10', '8453', '42161', 'all'],
          description:
            'Chain ID: 1 (Ethereum), 10 (Optimism), 8453 (Base), 42161 (Arbitrum), or all',
        },
        category: {
          type: 'string',
          enum: ['core', 'revnet', 'hooks', 'suckers', 'all'],
          description: 'Contract category filter',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_patterns',
    description:
      'Get integration patterns and best practices for building on Juicebox. Use when helping users implement specific features.',
    input_schema: {
      type: 'object' as const,
      properties: {
        projectType: {
          type: 'string',
          description: 'Type of project: crowdfund, dao, creator, nft, revnet',
        },
      },
      required: [],
    },
  },
  // === Project Data ===
  {
    name: 'get_project_data',
    description:
      'Get detailed project data including balance, token total supply, and cash out tax rate. USE THIS when users ask for specific project values like "what is project X\'s balance?" or "what is the cash out rate for project Y?"',
    input_schema: {
      type: 'object' as const,
      properties: {
        projectId: {
          type: 'number',
          description: 'The Juicebox project ID',
        },
        chainId: {
          type: 'number',
          description:
            'The chain ID (1=Ethereum, 10=Optimism, 8453=Base, 42161=Arbitrum). Default: 1',
        },
      },
      required: ['projectId'],
    },
  },
  // === Project Search ===
  {
    name: 'search_projects',
    description:
      'Search for Juicebox projects by name, description, or tags. Use this when users ask about projects by name or want to find projects matching certain keywords.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query - matches against project name, description, and tags',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10, max: 50)',
        },
      },
      required: ['query'],
    },
  },
  // === Omnichain/Bridge Tools ===
  {
    name: 'get_sucker_pairs',
    description:
      'Get all available bridge destinations for a project. Returns chain IDs and sucker contract addresses for each supported chain.',
    input_schema: {
      type: 'object' as const,
      properties: {
        projectId: {
          type: 'number',
          description: 'The Juicebox project ID',
        },
        chainId: {
          type: 'number',
          description: 'The chain ID to query the registry on (default: 1 for Ethereum)',
        },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_bridge_transactions',
    description:
      'Get pending, claimable, or claimed bridge transactions for a project. Use to show users their cross-chain transfer status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        suckerGroupId: {
          type: 'string',
          description: 'The sucker group ID (from project metadata)',
        },
        status: {
          type: 'string',
          enum: ['pending', 'claimable', 'claimed'],
          description: 'Filter by transaction status',
        },
        beneficiary: {
          type: 'string',
          description: 'Filter by beneficiary address',
        },
      },
      required: ['suckerGroupId'],
    },
  },
  {
    name: 'get_cross_chain_balance',
    description:
      "Get a user's project token balance across all chains where the project exists. Returns per-chain and total balances.",
    input_schema: {
      type: 'object' as const,
      properties: {
        suckerGroupId: {
          type: 'string',
          description: 'The sucker group ID',
        },
        userAddress: {
          type: 'string',
          description: 'The user wallet address',
        },
      },
      required: ['suckerGroupId', 'userAddress'],
    },
  },
  // === IPFS Tools ===
  {
    name: 'pin_to_ipfs',
    description:
      'Pin JSON metadata to IPFS and get a real CID. IMPORTANT: Only use AFTER collecting all required information from the user. For setUriOf (changing name/description), ASK the user what they want FIRST using options-picker, then pin with their actual values. NEVER pin with made-up or placeholder values.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'object',
          description:
            'The JSON object to pin to IPFS (e.g., project metadata with name, description, logoUri, infoUri). Must contain actual user-provided values, not placeholders.',
        },
        name: {
          type: 'string',
          description: 'Optional name for the pin (helps identify it in Pinata dashboard)',
        },
      },
      required: ['content'],
    },
  },
];

/**
 * V6 JBSuckerRegistry ABI fragment (remote is bytes32 for cross-VM support)
 */
export const SUCKER_REGISTRY_ABI = [
  {
    name: 'suckerPairsOf',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      {
        name: 'pairs',
        type: 'tuple[]',
        components: [
          { name: 'local', type: 'address' },
          { name: 'remote', type: 'bytes32' },
          { name: 'remoteChainId', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;
