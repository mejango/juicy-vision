/**
 * Omnichain/Sucker Knowledge Base
 *
 * Comprehensive context about how Juicebox V6 omnichain projects work,
 * including the V6 contract set, suckers, cross-chain token bridging, and user flows.
 */

export const OMNICHAIN_CONTEXT = `
## Juicebox V6

Juicebox V6 is the protocol. There is a single contract set — every project, including Revnets, uses the same V6 contracts. There is no per-project version detection: resolve a project's controller and terminals through JBDirectory, never by guessing a version.

### V6 Core Contracts (same address on every supported chain — mainnets and Sepolia testnets — via CREATE2)

| Contract | Address | Role |
|----------|---------|------|
| JBController | 0x3fcec3572e84b624477bcff4e2cf1f7deab648f1 | Rulesets, token issuance, reserved splits, project URI |
| JBMultiTerminal | 0x130f5dd2bd8805443cf41755253d778a75a67f53 | Payments, cash outs, payouts, surplus allowance |
| JBRulesets | 0x26f2228a4e8b0079ed1c2a3d22f12ff7f83cdfba | Ruleset storage and cycling |
| JBTerminalStore | 0x7497ae014a60561925b51c0a3b4ade7460b9927c | Terminal balance/accounting reads |
| JBTokens | 0x1f80d8f057ee36b4c2656d107e4e4558b71ba7d9 | Project token + credit balances |
| JBProjects | 0x6017d1fba9dc279bfa0b03fd931c22e242ab3691 | Project ownership NFTs |
| JBDirectory | 0x5aff29060e023e6fb87be5596652b33c65af535b | controllerOf / terminalsOf / primaryTerminalOf |
| JBSplits | 0x28b3d11fcb8d2ad0a143c5b193cd9f2e4d43f4c3 | Split storage |
| JBPermissions | 0xf92ac1ab5a00033e35a3975739124f61928c36b0 | Operator permissions |
| JBOmnichainDeployer | 0xb853758a70a6b4216c09f1d071ea2344aba0a34f | Project deployment (use this to deploy, not the controller) |
| JBRouterTerminal | 0x0fbcbb3d10c8f524840d74ef81c1a9f161c418d7 | Routes arbitrary-token payments (V6 has NO swap terminal — the router terminal replaces it) |
| JBSuckerRegistry | 0x7903a854ae91eaf635430d120a1a434085cef297 | Sucker deployments and pair discovery |
| REVDeployer | 0xb552eb94284f94b833837d4b2cbb237128415d4e | Revnet deployment |
| REVLoans | 0x056265c31157748818f0910d1859acd2f7d427de | Loans against revnet tokens |

### V6 Flows in Brief

- **Pay**: \`JBMultiTerminal.pay(projectId, token, amount, beneficiary, minReturnedTokens, memo, metadata)\`. The terminal must have an accounting context for the token; use JBRouterTerminal for tokens the project doesn't accept natively.
- **Cash out**: \`JBMultiTerminal.cashOutTokensOf(holder, projectId, cashOutCount, tokenToReclaim, minTokensReclaimed, beneficiary, metadata)\`. The ruleset's cashOutTaxRate is a bonding-curve parameter, not a flat fee.
- **Payouts**: \`JBMultiTerminal.sendPayoutsOf(...)\` distributes up to the ruleset's payout limit to the payout splits.
- **Rulesets**: queue with \`JBController.queueRulesetsOf(...)\`; metadata includes reservedPercent, cashOutTaxRate, baseCurrency, pause flags, and \`scopeCashOutsToLocalBalances\` (whether omnichain cash outs use only local-chain balances).

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
   - Sucker cashes out from terminal, receiving proportional ETH/USDC
   - Transaction added as a leaf to the outbox merkle tree
   - Status: "pending"

2. **Execute Phase** (Cross-Chain Message)
   - User or relayer calls \`toRemote(token)\`
   - Sucker computes merkle root of all pending leaves
   - Root + funds sent via bridge (OP Messenger, Arbitrum Inbox, or CCIP)
   - Status: "claimable" on destination chain

3. **Claim Phase** (Destination Chain)
   - User calls \`claim()\` with merkle proof
   - Sucker verifies proof against inbox root
   - Project tokens minted to beneficiary
   - ETH/USDC credited to project's terminal balance
   - Status: "claimed"

### Bridge Fee Structure

Bridge fees vary by chain and protocol:
- **OP Stack (Optimism, Base)**: Native bridge, minimal fees (~0.0005-0.002 ETH)
- **Arbitrum**: Retryable tickets with dynamic gas pricing
- **CCIP (L2↔L2)**: Chainlink fees, typically higher

Fees are discovered dynamically via contract simulation before execution.

### Transaction States

| Status | Meaning | User Action |
|--------|---------|-------------|
| pending | Prepared but not sent | Execute bridge |
| claimable | Root sent, awaiting claim | Claim on destination |
| claimed | Complete | None |

### Token Mapping

Projects must explicitly map which tokens can be bridged:
- Local token address → Remote token address
- Minimum bridge amount (prevents dust)
- Minimum gas for cross-chain call

Common mappings:
- Native ETH on one chain → Native ETH on another
- USDC on Ethereum → USDC on Optimism (different addresses)

### Emergency Procedures

If a bridge becomes non-functional:
1. Project owner can enable "emergency hatch" for specific tokens
2. Users can exit locally via \`exitThroughEmergencyHatch()\`
3. Funds recovered on original chain without bridging

### Key Addresses

**JBSuckerRegistry** (0x7903a854ae91eaf635430d120a1a434085cef297, same on all chains): Manages sucker deployments and tracks all sucker pairs for each project.

**Sucker Discovery**: Call \`suckerPairsOf(projectId)\` on JBSuckerRegistry to get all available bridge destinations. Each pair's \`remote\` is a bytes32 (EVM addresses occupy the low 20 bytes).

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
A: Only to chains where the project has deployed suckers. Check the sucker registry.

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
 * Bridge protocol used per chain pair
 */
export const BRIDGE_PROTOCOLS: Record<string, string> = {
  '1-10': 'OP Messenger (native)',
  '1-8453': 'OP Messenger (native)',
  '1-42161': 'Arbitrum Inbox/Outbox',
  '10-42161': 'Chainlink CCIP',
  '10-8453': 'Chainlink CCIP',
  '8453-42161': 'Chainlink CCIP',
};

/**
 * V6 JBSuckerRegistry address (same on all chains via CREATE2)
 */
export const SUCKER_REGISTRY_ADDRESS = '0x7903a854ae91eaf635430d120a1a434085cef297' as const;

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
          description: 'Chain ID: 1 (Ethereum), 10 (Optimism), 8453 (Base), 42161 (Arbitrum), or all',
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
          description: 'The chain ID (1=Ethereum, 10=Optimism, 8453=Base, 42161=Arbitrum). Default: 1',
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
    name: 'estimate_bridge_fee',
    description:
      'Estimate the fee required to execute a bridge (toRemote call). Returns the estimated ETH cost.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sourceChainId: {
          type: 'number',
          description: 'The source chain ID',
        },
        destinationChainId: {
          type: 'number',
          description: 'The destination chain ID',
        },
        suckerAddress: {
          type: 'string',
          description: 'The sucker contract address on the source chain',
        },
        token: {
          type: 'string',
          description: 'The terminal token address being bridged',
        },
      },
      required: ['sourceChainId', 'destinationChainId', 'suckerAddress', 'token'],
    },
  },
  {
    name: 'prepare_bridge_transaction',
    description:
      'Generate transaction data for preparing a token bridge (first step). Returns calldata for the prepare() function.',
    input_schema: {
      type: 'object' as const,
      properties: {
        chainId: {
          type: 'number',
          description: 'The source chain ID',
        },
        suckerAddress: {
          type: 'string',
          description: 'The sucker contract address',
        },
        projectTokenAmount: {
          type: 'string',
          description: 'Amount of project tokens to bridge (in wei/smallest unit)',
        },
        beneficiary: {
          type: 'string',
          description: 'Recipient address on the destination chain',
        },
        minTokensReclaimed: {
          type: 'string',
          description: 'Minimum terminal tokens to receive (slippage protection)',
        },
        terminalToken: {
          type: 'string',
          description: 'Terminal token address (ETH or ERC20)',
        },
      },
      required: [
        'chainId',
        'suckerAddress',
        'projectTokenAmount',
        'beneficiary',
        'minTokensReclaimed',
        'terminalToken',
      ],
    },
  },
  {
    name: 'execute_bridge_transaction',
    description:
      'Generate transaction data for executing the bridge (toRemote step). Returns calldata and required ETH value.',
    input_schema: {
      type: 'object' as const,
      properties: {
        chainId: {
          type: 'number',
          description: 'The source chain ID',
        },
        suckerAddress: {
          type: 'string',
          description: 'The sucker contract address',
        },
        token: {
          type: 'string',
          description: 'Terminal token address to bridge',
        },
      },
      required: ['chainId', 'suckerAddress', 'token'],
    },
  },
  {
    name: 'claim_bridge_transaction',
    description:
      'Generate transaction data for claiming bridged tokens on the destination chain. Returns calldata with merkle proof.',
    input_schema: {
      type: 'object' as const,
      properties: {
        chainId: {
          type: 'number',
          description: 'The destination chain ID',
        },
        suckerAddress: {
          type: 'string',
          description: 'The sucker contract address on destination',
        },
        token: {
          type: 'string',
          description: 'Terminal token address',
        },
        beneficiary: {
          type: 'string',
          description: 'The beneficiary address to claim for',
        },
      },
      required: ['chainId', 'suckerAddress', 'token', 'beneficiary'],
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
          description: 'The JSON object to pin to IPFS (e.g., project metadata with name, description, logoUri, infoUri). Must contain actual user-provided values, not placeholders.',
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
 * V6 JBSucker ABI fragments for encoding transactions.
 * Note: beneficiaries are bytes32 (EVM addresses left-padded to 32 bytes),
 * and prepare/leaves carry an opaque bytes32 metadata field.
 */
export const SUCKER_ABI = [
  {
    name: 'prepare',
    type: 'function',
    inputs: [
      { name: 'projectTokenCount', type: 'uint256' },
      { name: 'beneficiary', type: 'bytes32' },
      { name: 'minTokensReclaimed', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'metadata', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'toRemote',
    type: 'function',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'claim',
    type: 'function',
    inputs: [
      {
        name: 'claimData',
        type: 'tuple',
        components: [
          { name: 'token', type: 'address' },
          {
            name: 'leaf',
            type: 'tuple',
            components: [
              { name: 'index', type: 'uint256' },
              { name: 'beneficiary', type: 'bytes32' },
              { name: 'projectTokenCount', type: 'uint256' },
              { name: 'terminalTokenAmount', type: 'uint256' },
              { name: 'metadata', type: 'bytes32' },
            ],
          },
          { name: 'proof', type: 'bytes32[32]' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'outboxOf',
    type: 'function',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'nonce', type: 'uint64' },
      { name: 'balance', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

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
