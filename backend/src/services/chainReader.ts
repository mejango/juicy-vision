/**
 * Chain Reader Service
 *
 * Reads Juicebox V6 ruleset and splits data directly from the blockchain.
 * All projects (including Revnets) use the same V6 contract set.
 */

import {
  type Address,
  createPublicClient,
  http,
  isAddress,
  type PublicClient,
  zeroAddress,
} from 'viem';
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  sepolia,
} from '../constants/chains.ts';
import {
  CANONICAL_USDC_BY_CHAIN,
  CONTRACTS,
  NATIVE_TOKEN as SHARED_NATIVE_TOKEN,
} from '@shared/chains.ts';
import { getConfig } from '../utils/config.ts';
import type { FundAccessLimits, RulesetData, RulesetMetadata, SplitData } from './rulesetCache.ts';
import { requireRecognizedRuntimeSplitHook } from './projectTrust.ts';

// ============================================================================
// Chain Configuration
// ============================================================================

const MAINNET_CHAINS = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
} as const;

const TESTNET_CHAINS = {
  11155111: sepolia,
  11155420: optimismSepolia,
  84532: baseSepolia,
  421614: arbitrumSepolia,
} as const;

const MAINNET_RPC_URLS: Record<number, string> = {
  1: 'https://ethereum.publicnode.com',
  10: 'https://mainnet.optimism.io',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
};

const TESTNET_RPC_URLS: Record<number, string> = {
  11155111: 'https://sepolia.drpc.org',
  11155420: 'https://optimism-sepolia.drpc.org',
  84532: 'https://base-sepolia.drpc.org',
  421614: 'https://arbitrum-sepolia.drpc.org',
};

// Combined chain/RPC maps shared with other services (e.g. smartAccounts)
export const VIEM_CHAINS = { ...MAINNET_CHAINS, ...TESTNET_CHAINS } as const;

export const PUBLIC_RPC_URLS: Record<number, string> = {
  ...MAINNET_RPC_URLS,
  ...TESTNET_RPC_URLS,
};

// ============================================================================
// Discovery roots and recognized implementations (same via CREATE2 on all chains)
// ============================================================================

// Existing projects are discovered only through these two roots. Other addresses
// below are allowlist entries, never discovery fallbacks.
const JB_ROOTS = {
  JBDirectory: CONTRACTS.JBDirectory,
  JBProjects: CONTRACTS.JBProjects,
};

const RECOGNIZED = {
  JBController: CONTRACTS.JBController,
  JBMultiTerminal: CONTRACTS.JBMultiTerminal,
  JBRouterTerminal: CONTRACTS.JBRouterTerminal,
  JBRouterTerminalRegistry: CONTRACTS.JBRouterTerminalRegistry,
  JBRulesets: CONTRACTS.JBRulesets,
  JBSplits: CONTRACTS.JBSplits,
  JBFundAccessLimits: CONTRACTS.JBFundAccessLimits,
  JBTokens: CONTRACTS.JBTokens,
};

const SPLIT_GROUP_RESERVED = 1n;
const NATIVE_TOKEN = SHARED_NATIVE_TOKEN.toLowerCase();
const CANONICAL_USDC = Object.fromEntries(
  Object.entries(CANONICAL_USDC_BY_CHAIN).map(([chainId, address]) => [
    Number(chainId),
    address.toLowerCase(),
  ]),
) as Record<number, string>;

// ============================================================================
// ABIs
// ============================================================================

const JB_CONTROLLER_ABI = [
  {
    name: 'currentRulesetOf',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      {
        name: 'ruleset',
        type: 'tuple',
        components: [
          { name: 'cycleNumber', type: 'uint48' },
          { name: 'id', type: 'uint48' },
          { name: 'basedOnId', type: 'uint48' },
          { name: 'start', type: 'uint48' },
          { name: 'duration', type: 'uint32' },
          { name: 'weight', type: 'uint112' },
          { name: 'weightCutPercent', type: 'uint32' },
          { name: 'approvalHook', type: 'address' },
          { name: 'metadata', type: 'uint256' },
        ],
      },
      {
        name: 'metadata',
        type: 'tuple',
        components: [
          { name: 'reservedPercent', type: 'uint16' },
          { name: 'cashOutTaxRate', type: 'uint16' },
          { name: 'baseCurrency', type: 'uint32' },
          { name: 'pausePay', type: 'bool' },
          { name: 'pauseCreditTransfers', type: 'bool' },
          { name: 'allowOwnerMinting', type: 'bool' },
          { name: 'allowSetCustomToken', type: 'bool' },
          { name: 'allowTerminalMigration', type: 'bool' },
          { name: 'allowSetTerminals', type: 'bool' },
          { name: 'allowSetController', type: 'bool' },
          { name: 'allowAddAccountingContext', type: 'bool' },
          { name: 'allowAddPriceFeed', type: 'bool' },
          { name: 'ownerMustSendPayouts', type: 'bool' },
          { name: 'holdFees', type: 'bool' },
          { name: 'scopeCashOutsToLocalBalances', type: 'bool' },
          { name: 'useDataHookForPay', type: 'bool' },
          { name: 'useDataHookForCashOut', type: 'bool' },
          { name: 'dataHook', type: 'address' },
          { name: 'metadata', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

const RULESET_COMPONENTS = [
  { name: 'cycleNumber', type: 'uint48' },
  { name: 'id', type: 'uint48' },
  { name: 'basedOnId', type: 'uint48' },
  { name: 'start', type: 'uint48' },
  { name: 'duration', type: 'uint32' },
  { name: 'weight', type: 'uint112' },
  { name: 'weightCutPercent', type: 'uint32' },
  { name: 'approvalHook', type: 'address' },
  { name: 'metadata', type: 'uint256' },
] as const;

const JB_RULESETS_ABI = [
  {
    name: 'currentOf',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
    stateMutability: 'view',
  },
  {
    name: 'upcomingOf',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
    stateMutability: 'view',
  },
  {
    name: 'latestQueuedOf',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      { name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS },
      { name: 'approvalStatus', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getRulesetOf',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
    ],
    outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
    stateMutability: 'view',
  },
  {
    name: 'allOf',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'startingId', type: 'uint256' },
      { name: 'size', type: 'uint256' },
    ],
    outputs: [{ name: 'rulesets', type: 'tuple[]', components: RULESET_COMPONENTS }],
    stateMutability: 'view',
  },
] as const;

const JB_SPLITS_ABI = [
  {
    name: 'splitsOf',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'groupId', type: 'uint256' },
    ],
    outputs: [{
      name: 'splits',
      type: 'tuple[]',
      components: [
        { name: 'percent', type: 'uint32' },
        { name: 'projectId', type: 'uint64' },
        { name: 'beneficiary', type: 'address' },
        { name: 'preferAddToBalance', type: 'bool' },
        { name: 'lockedUntil', type: 'uint48' },
        { name: 'hook', type: 'address' },
      ],
    }],
    stateMutability: 'view',
  },
] as const;

const JB_FUND_ACCESS_LIMITS_ABI = [
  {
    name: 'payoutLimitsOf',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'terminal', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{
      name: 'limits',
      type: 'tuple[]',
      components: [
        { name: 'amount', type: 'uint224' },
        { name: 'currency', type: 'uint32' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    name: 'surplusAllowancesOf',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'terminal', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{
      name: 'allowances',
      type: 'tuple[]',
      components: [
        { name: 'amount', type: 'uint224' },
        { name: 'currency', type: 'uint32' },
      ],
    }],
    stateMutability: 'view',
  },
] as const;

// ============================================================================
// Helpers
// ============================================================================

const publicClients = new Map<number, PublicClient>();

export function getPublicClient(chainId: number): PublicClient {
  const cached = publicClients.get(chainId);
  if (cached) return cached;

  const config = getConfig();
  const isTestnet = config.isTestnet;

  if (isTestnet) {
    const chain = TESTNET_CHAINS[chainId as keyof typeof TESTNET_CHAINS];
    if (!chain) throw new Error(`Unsupported testnet chain: ${chainId}`);
    const client = createPublicClient({
      chain,
      transport: http(TESTNET_RPC_URLS[chainId]),
    }) as PublicClient;
    publicClients.set(chainId, client);
    return client;
  }

  const chain = MAINNET_CHAINS[chainId as keyof typeof MAINNET_CHAINS];
  if (!chain) throw new Error(`Unsupported mainnet chain: ${chainId}`);
  const client = createPublicClient({
    chain,
    transport: http(MAINNET_RPC_URLS[chainId]),
  }) as PublicClient;
  publicClients.set(chainId, client);
  return client;
}

const JB_DIRECTORY_ABI = [
  {
    name: 'controllerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'terminalsOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'primaryTerminalOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const JB_PROJECTS_ABI = [{
  name: 'ownerOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

export function getProjectOwner(chainId: number, projectId: number): Promise<Address> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error('Project ID is invalid');
  }
  return getPublicClient(chainId).readContract({
    address: JB_ROOTS.JBProjects,
    abi: JB_PROJECTS_ABI,
    functionName: 'ownerOf',
    args: [BigInt(projectId)],
  });
}

const FORWARDING_TERMINAL_ABI = [{
  name: 'terminalOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const JB_CONTROLLER_DEPENDENCIES_ABI = [
  {
    name: 'DIRECTORY',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'PROJECTS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'RULESETS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'SPLITS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'FUND_ACCESS_LIMITS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'TOKENS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const JB_TERMINAL_ABI = [
  {
    name: 'accountingContextsOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{
      name: '',
      type: 'tuple[]',
      components: [
        { name: 'token', type: 'address' },
        { name: 'decimals', type: 'uint8' },
        { name: 'currency', type: 'uint32' },
      ],
    }],
  },
  {
    name: 'STORE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const JB_TERMINAL_STORE_ABI = [{
  name: 'usedSurplusAllowanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'terminal', type: 'address' },
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'rulesetId', type: 'uint256' },
    { name: 'currency', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}, {
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'terminal', type: 'address' },
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

const JB_TOKENS_SUPPLY_ABI = [{
  name: 'totalSupplyOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'uint256' }],
}, {
  name: 'totalBalanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'holder', type: 'address' },
    { name: 'projectId', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

function recognizedPaymentTerminal(address: Address): 'multi' | 'router' | 'registry' | null {
  const normalized = address.toLowerCase();
  if (normalized === RECOGNIZED.JBMultiTerminal.toLowerCase()) return 'multi';
  if (normalized === RECOGNIZED.JBRouterTerminal.toLowerCase()) return 'router';
  if (normalized === RECOGNIZED.JBRouterTerminalRegistry.toLowerCase()) return 'registry';
  return null;
}

async function requireRecognizedRegistryDestination(
  client: Pick<PublicClient, 'readContract'>,
  projectId: bigint,
  registry: Address,
): Promise<{ destination: Address; type: 'multi' | 'router' }> {
  const destination = await client.readContract({
    address: registry,
    abi: FORWARDING_TERMINAL_ABI,
    functionName: 'terminalOf',
    args: [projectId],
  });
  if (destination === zeroAddress) {
    throw new Error('The payment router has no destination for this project');
  }
  const type = recognizedPaymentTerminal(destination);
  if (type !== 'multi' && type !== 'router') {
    throw new Error(`Terminal not recognized in payment route: ${destination}`);
  }
  return { destination, type };
}

export async function assertRecognizedPaymentRouteWithClient(
  client: Pick<PublicClient, 'readContract'>,
  projectId: bigint,
  terminal: Address,
): Promise<void> {
  if (!recognizedPaymentTerminal(terminal)) throw new Error(`Terminal not recognized: ${terminal}`);

  const terminals = await client.readContract({
    address: JB_ROOTS.JBDirectory,
    abi: JB_DIRECTORY_ABI,
    functionName: 'terminalsOf',
    args: [projectId],
  });
  if (terminals.length === 0) throw new Error('This project has no payment routes');

  let requestedRouteFound = false;
  for (const routeTerminal of terminals) {
    const routeType = recognizedPaymentTerminal(routeTerminal);
    if (!routeType) {
      throw new Error(`Terminal not recognized in payment route: ${routeTerminal}`);
    }
    if (routeType === 'registry') {
      const route = await requireRecognizedRegistryDestination(client, projectId, routeTerminal);
      if (
        routeTerminal.toLowerCase() === terminal.toLowerCase() ||
        route.destination.toLowerCase() === terminal.toLowerCase()
      ) requestedRouteFound = true;
    } else if (routeTerminal.toLowerCase() === terminal.toLowerCase()) {
      requestedRouteFound = true;
    }
  }
  if (!requestedRouteFound) {
    throw new Error('The requested terminal is not in the live project route');
  }
}

export async function fetchPrimaryTerminal(
  chainId: number,
  projectId: number,
  token: Address,
): Promise<Address> {
  const client = getPublicClient(chainId);
  const terminal = await client.readContract({
    address: JB_ROOTS.JBDirectory,
    abi: JB_DIRECTORY_ABI,
    functionName: 'primaryTerminalOf',
    args: [BigInt(projectId), token],
  });
  if (terminal === '0x0000000000000000000000000000000000000000') {
    throw new Error('Project has no terminal for the requested payment token');
  }
  await assertRecognizedPaymentRouteWithClient(client, BigInt(projectId), terminal);
  return terminal;
}

async function getContractsForProject(chainId: number, projectId: number): Promise<{
  JBController: `0x${string}`;
  JBRulesets: `0x${string}`;
  JBSplits: `0x${string}`;
  JBFundAccessLimits: `0x${string}`;
  JBTokens: `0x${string}`;
}> {
  const client = getPublicClient(chainId);
  const controller = await client.readContract({
    address: JB_ROOTS.JBDirectory,
    abi: JB_DIRECTORY_ABI,
    functionName: 'controllerOf',
    args: [BigInt(projectId)],
  });

  if (controller === '0x0000000000000000000000000000000000000000') {
    throw new Error('Project has no controller');
  }
  if (controller.toLowerCase() !== RECOGNIZED.JBController.toLowerCase()) {
    throw new Error(`Controller not recognized: ${controller}`);
  }

  const readDependency = (
    functionName:
      | 'DIRECTORY'
      | 'PROJECTS'
      | 'RULESETS'
      | 'SPLITS'
      | 'FUND_ACCESS_LIMITS'
      | 'TOKENS',
  ) =>
    client.readContract({
      address: controller,
      abi: JB_CONTROLLER_DEPENDENCIES_ABI,
      functionName,
    });
  const [directory, projects, rulesets, splits, fundAccessLimits, tokens] = await Promise.all([
    readDependency('DIRECTORY'),
    readDependency('PROJECTS'),
    readDependency('RULESETS'),
    readDependency('SPLITS'),
    readDependency('FUND_ACCESS_LIMITS'),
    readDependency('TOKENS'),
  ]);

  if (
    directory.toLowerCase() !== JB_ROOTS.JBDirectory.toLowerCase() ||
    projects.toLowerCase() !== JB_ROOTS.JBProjects.toLowerCase()
  ) {
    throw new Error(`Controller not recognized: ${controller}`);
  }
  const dependencies = [
    ['Rulesets', rulesets, RECOGNIZED.JBRulesets],
    ['Splits', splits, RECOGNIZED.JBSplits],
    ['Fund access limits', fundAccessLimits, RECOGNIZED.JBFundAccessLimits],
    ['Tokens', tokens, RECOGNIZED.JBTokens],
  ] as const;
  for (const [name, discovered, recognized] of dependencies) {
    if (discovered.toLowerCase() !== recognized.toLowerCase()) {
      throw new Error(`${name} contract not recognized: ${discovered}`);
    }
  }

  return {
    JBController: controller,
    JBRulesets: rulesets,
    JBSplits: splits,
    JBFundAccessLimits: fundAccessLimits,
    JBTokens: tokens,
  };
}

/** Validate the live project controller and its derived dependency roots. */
export async function assertRecognizedProjectContracts(
  chainId: number,
  projectId: number | bigint,
): Promise<void> {
  if (typeof projectId === 'bigint' && projectId > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Project ID exceeds the supported range');
  }
  await getContractsForProject(chainId, Number(projectId));
}

/**
 * Decode packed ruleset metadata from uint256 (V6 bit layout, see
 * nana-core-v6 JBRulesetMetadataResolver)
 */
function decodeRulesetMetadata(packed: bigint): RulesetMetadata {
  return {
    reservedPercent: Number((packed >> 4n) & 0xFFFFn),
    cashOutTaxRate: Number((packed >> 20n) & 0xFFFFn),
    baseCurrency: Number((packed >> 36n) & 0xFFFFFFFFn),
    pausePay: Boolean((packed >> 68n) & 1n),
    pauseCreditTransfers: Boolean((packed >> 69n) & 1n),
    allowOwnerMinting: Boolean((packed >> 70n) & 1n),
    allowSetCustomToken: Boolean((packed >> 71n) & 1n),
    allowTerminalMigration: Boolean((packed >> 72n) & 1n),
    allowSetTerminals: Boolean((packed >> 73n) & 1n),
    allowSetController: Boolean((packed >> 74n) & 1n),
    allowAddAccountingContext: Boolean((packed >> 75n) & 1n),
    allowAddPriceFeed: Boolean((packed >> 76n) & 1n),
    ownerMustSendPayouts: Boolean((packed >> 77n) & 1n),
    holdFees: Boolean((packed >> 78n) & 1n),
    scopeCashOutsToLocalBalances: Boolean((packed >> 79n) & 1n),
    useDataHookForPay: Boolean((packed >> 80n) & 1n),
    useDataHookForCashOut: Boolean((packed >> 81n) & 1n),
    dataHook: `0x${((packed >> 82n) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`,
    metadata: Number((packed >> 242n) & 0xFFFFn),
  };
}

function getPayoutSplitGroup(token: `0x${string}`): bigint {
  return BigInt(token);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch the current ruleset for a project directly from chain
 */
export async function fetchCurrentRuleset(
  chainId: number,
  projectId: number,
): Promise<{ ruleset: RulesetData; metadata: RulesetMetadata } | null> {
  const client = getPublicClient(chainId);
  const contracts = await getContractsForProject(chainId, projectId);

  try {
    const [ruleset, metadata] = await client.readContract({
      address: contracts.JBController,
      abi: JB_CONTROLLER_ABI,
      functionName: 'currentRulesetOf',
      args: [BigInt(projectId)],
    });

    if (ruleset.cycleNumber === 0) {
      // Try currentOf from JBRulesets directly
      const currentRuleset = await client.readContract({
        address: contracts.JBRulesets,
        abi: JB_RULESETS_ABI,
        functionName: 'currentOf',
        args: [BigInt(projectId)],
      });

      if (currentRuleset.cycleNumber === 0) return null;

      return {
        ruleset: {
          cycleNumber: Number(currentRuleset.cycleNumber),
          id: String(currentRuleset.id),
          start: Number(currentRuleset.start),
          duration: Number(currentRuleset.duration),
          weight: String(currentRuleset.weight),
          weightCutPercent: Number(currentRuleset.weightCutPercent),
          approvalHook: currentRuleset.approvalHook,
          basedOnId: String(currentRuleset.basedOnId),
        },
        metadata: decodeRulesetMetadata(currentRuleset.metadata),
      };
    }

    const decodedMetadata: RulesetMetadata = {
      reservedPercent: metadata.reservedPercent,
      cashOutTaxRate: metadata.cashOutTaxRate,
      baseCurrency: metadata.baseCurrency,
      pausePay: metadata.pausePay,
      pauseCreditTransfers: metadata.pauseCreditTransfers,
      allowOwnerMinting: metadata.allowOwnerMinting,
      allowSetCustomToken: metadata.allowSetCustomToken,
      allowTerminalMigration: metadata.allowTerminalMigration,
      allowSetTerminals: metadata.allowSetTerminals,
      allowSetController: metadata.allowSetController,
      allowAddAccountingContext: metadata.allowAddAccountingContext,
      allowAddPriceFeed: metadata.allowAddPriceFeed,
      ownerMustSendPayouts: metadata.ownerMustSendPayouts,
      holdFees: metadata.holdFees,
      scopeCashOutsToLocalBalances: metadata.scopeCashOutsToLocalBalances,
      useDataHookForPay: metadata.useDataHookForPay,
      useDataHookForCashOut: metadata.useDataHookForCashOut,
      dataHook: metadata.dataHook,
      metadata: metadata.metadata,
    };

    return {
      ruleset: {
        cycleNumber: Number(ruleset.cycleNumber),
        id: String(ruleset.id),
        start: Number(ruleset.start),
        duration: Number(ruleset.duration),
        weight: String(ruleset.weight),
        weightCutPercent: Number(ruleset.weightCutPercent),
        approvalHook: ruleset.approvalHook,
        basedOnId: String(ruleset.basedOnId),
        metadata: decodedMetadata,
      },
      metadata: decodedMetadata,
    };
  } catch (err) {
    console.error('Failed to fetch current ruleset:', err);
    throw new Error(
      `Current ruleset unavailable: ${
        err instanceof Error ? err.message : 'Unknown chain read failure'
      }`,
    );
  }
}

export interface LiveProjectAccountingBalance {
  terminal: Address;
  token: Address;
  decimals: number;
  currency: number;
  balance: bigint;
  symbol: 'ETH' | 'USDC';
}

/**
 * Read current project balances and circulating supply from the project's live,
 * recognized controller and terminal dependencies.
 */
export async function fetchProjectAccountingState(
  chainId: number,
  projectId: number,
): Promise<{ balances: LiveProjectAccountingBalance[]; totalSupply: bigint }> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error('Project ID is invalid');
  }
  const client = getPublicClient(chainId);
  const contracts = await getContractsForProject(chainId, projectId);
  const id = BigInt(projectId);
  const terminals = await client.readContract({
    address: JB_ROOTS.JBDirectory,
    abi: JB_DIRECTORY_ABI,
    functionName: 'terminalsOf',
    args: [id],
  });
  if (terminals.length === 0) throw new Error('Project has no payment routes');
  const uniqueTerminals = new Set(terminals.map((terminal) => terminal.toLowerCase()));
  if (uniqueTerminals.size !== terminals.length) {
    throw new Error('Project terminal configuration is ambiguous');
  }
  for (const terminal of terminals) {
    await assertRecognizedPaymentRouteWithClient(client, id, terminal);
  }

  const accountingTerminals = terminals.filter(
    (terminal) => terminal.toLowerCase() === RECOGNIZED.JBMultiTerminal.toLowerCase(),
  );
  if (accountingTerminals.length !== 1) {
    throw new Error('Recognized accounting terminal is unavailable or ambiguous');
  }
  const terminal = accountingTerminals[0];
  const [contexts, store, totalSupply] = await Promise.all([
    client.readContract({
      address: terminal,
      abi: JB_TERMINAL_ABI,
      functionName: 'accountingContextsOf',
      args: [id],
    }),
    client.readContract({
      address: terminal,
      abi: JB_TERMINAL_ABI,
      functionName: 'STORE',
    }),
    client.readContract({
      address: contracts.JBTokens,
      abi: JB_TOKENS_SUPPLY_ABI,
      functionName: 'totalSupplyOf',
      args: [id],
    }),
  ]);
  if (contexts.length === 0) throw new Error('Project has no accounting context configured');

  const seenTokens = new Set<string>();
  const balances = await Promise.all(contexts.map(async (context) => {
    const token = context.token.toLowerCase();
    const isNative = token === NATIVE_TOKEN;
    const isUsdc = token === CANONICAL_USDC[chainId];
    if (!isNative && !isUsdc) throw new Error(`Accounting token not recognized: ${context.token}`);
    if (seenTokens.has(token)) throw new Error(`Duplicate accounting context: ${context.token}`);
    seenTokens.add(token);
    const expectedDecimals = isNative ? 18 : 6;
    const expectedCurrency = Number(BigInt(context.token) & 0xffff_ffffn);
    if (
      Number(context.decimals) !== expectedDecimals ||
      Number(context.currency) !== expectedCurrency
    ) {
      throw new Error(`Accounting context is not recognized for token: ${context.token}`);
    }
    const balance = await client.readContract({
      address: store,
      abi: JB_TERMINAL_STORE_ABI,
      functionName: 'balanceOf',
      args: [terminal, id, context.token],
    });
    return {
      terminal,
      token: context.token,
      decimals: expectedDecimals,
      currency: expectedCurrency,
      balance,
      symbol: isNative ? 'ETH' as const : 'USDC' as const,
    };
  }));

  return { balances, totalSupply };
}

/** Read a holder's current claimed-token plus credit balance for a project. */
export async function fetchProjectTokenBalance(
  chainId: number,
  projectId: number,
  holder: Address,
): Promise<bigint> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error('Project ID is invalid');
  }
  if (!isAddress(holder)) throw new Error('Project token holder is invalid');
  const contracts = await getContractsForProject(chainId, projectId);
  return getPublicClient(chainId).readContract({
    address: contracts.JBTokens,
    abi: JB_TOKENS_SUPPLY_ABI,
    functionName: 'totalBalanceOf',
    args: [holder, BigInt(projectId)],
  });
}

/**
 * Fetch the queued ruleset for a project
 */
export async function fetchQueuedRuleset(
  chainId: number,
  projectId: number,
): Promise<{ ruleset: RulesetData; approvalStatus: number } | null> {
  const client = getPublicClient(chainId);
  const contracts = await getContractsForProject(chainId, projectId);

  try {
    const [ruleset, approvalStatus] = await client.readContract({
      address: contracts.JBRulesets,
      abi: JB_RULESETS_ABI,
      functionName: 'latestQueuedOf',
      args: [BigInt(projectId)],
    });

    if (ruleset.cycleNumber === 0) return null;

    return {
      ruleset: {
        cycleNumber: Number(ruleset.cycleNumber),
        id: String(ruleset.id),
        start: Number(ruleset.start),
        duration: Number(ruleset.duration),
        weight: String(ruleset.weight),
        weightCutPercent: Number(ruleset.weightCutPercent),
        basedOnId: String(ruleset.basedOnId),
        metadata: decodeRulesetMetadata(ruleset.metadata),
      },
      approvalStatus,
    };
  } catch (err) {
    console.error('Failed to fetch queued ruleset:', err);
    throw new Error(
      `Queued ruleset unavailable: ${
        err instanceof Error ? err.message : 'Unknown chain read failure'
      }`,
    );
  }
}

/**
 * Fetch all historical rulesets using allOf
 */
export async function fetchRulesetHistory(
  chainId: number,
  projectId: number,
  maxRulesets: number = 1000,
): Promise<RulesetData[]> {
  const client = getPublicClient(chainId);
  const contracts = await getContractsForProject(chainId, projectId);

  if (!Number.isSafeInteger(maxRulesets) || maxRulesets < 1 || maxRulesets > 1000) {
    throw new Error('Ruleset history limit must be between 1 and 1000');
  }

  try {
    const rulesets = await client.readContract({
      address: contracts.JBRulesets,
      abi: JB_RULESETS_ABI,
      functionName: 'allOf',
      args: [BigInt(projectId), 0n, BigInt(maxRulesets + 1)],
    });

    if (rulesets.length > maxRulesets) {
      throw new Error(`Ruleset history exceeds the ${maxRulesets}-item safety limit`);
    }

    return rulesets
      .filter((r) => r.cycleNumber > 0)
      .map((r) => ({
        cycleNumber: Number(r.cycleNumber),
        id: String(r.id),
        start: Number(r.start),
        duration: Number(r.duration),
        weight: String(r.weight),
        weightCutPercent: Number(r.weightCutPercent),
        basedOnId: String(r.basedOnId),
        metadata: decodeRulesetMetadata(r.metadata),
      }))
      .sort((a, b) => a.start - b.start);
  } catch (err) {
    console.error('Failed to fetch ruleset history:', err);
    throw new Error(
      `Ruleset history unavailable: ${
        err instanceof Error ? err.message : 'Unknown chain read failure'
      }`,
    );
  }
}

/**
 * Get the current cycle number (fast check for cache invalidation)
 */
export async function getCurrentCycleNumber(
  chainId: number,
  projectId: number,
): Promise<number | null> {
  const client = getPublicClient(chainId);
  const contracts = await getContractsForProject(chainId, projectId);

  try {
    const ruleset = await client.readContract({
      address: contracts.JBRulesets,
      abi: JB_RULESETS_ABI,
      functionName: 'currentOf',
      args: [BigInt(projectId)],
    });

    const cycleNumber = Number(ruleset.cycleNumber);
    return cycleNumber === 0 ? null : cycleNumber;
  } catch (err) {
    throw new Error(
      `Current cycle unavailable: ${
        err instanceof Error ? err.message : 'Unknown chain read failure'
      }`,
    );
  }
}

/**
 * Fetch splits for a ruleset
 */
export async function fetchSplits(
  chainId: number,
  projectId: number,
  rulesetId: string,
): Promise<{
  payoutSplits: SplitData[];
  reservedSplits: SplitData[];
  fundAccessLimits: FundAccessLimits | null;
  splitGroups: Array<{ groupId: string; splits: SplitData[] }>;
  fundAccessLimitGroups: FundAccessLimits[];
  accountingContexts: Array<{
    terminal: Address;
    token: Address;
    tokenDecimals: number;
    currency: number;
  }>;
  configurationComplete: true;
}> {
  if (!Number.isSafeInteger(projectId) || projectId < 1 || !/^\d+$/.test(rulesetId)) {
    throw new Error('Treasury configuration identifiers are invalid');
  }
  const client = getPublicClient(chainId);
  const contracts = await getContractsForProject(chainId, projectId);
  const rsId = BigInt(rulesetId);
  if (rsId < 1n) throw new Error('Ruleset ID is invalid');

  const terminals = await client.readContract({
    address: JB_ROOTS.JBDirectory,
    abi: JB_DIRECTORY_ABI,
    functionName: 'terminalsOf',
    args: [BigInt(projectId)],
  });
  if (terminals.length === 0) throw new Error('Project has no terminal configured');
  const uniqueTerminals = new Set(terminals.map((terminal) => terminal.toLowerCase()));
  if (uniqueTerminals.size !== terminals.length) {
    throw new Error('Project terminal configuration is ambiguous');
  }
  await assertRecognizedPaymentRouteWithClient(client, BigInt(projectId), terminals[0]);
  const terminalContexts = (await Promise.all(terminals.map(async (terminal) => {
    const normalized = terminal.toLowerCase();
    const isMultiTerminal = normalized === RECOGNIZED.JBMultiTerminal.toLowerCase();
    const isRecognizedRouter = normalized === RECOGNIZED.JBRouterTerminal.toLowerCase() ||
      normalized === RECOGNIZED.JBRouterTerminalRegistry.toLowerCase();
    if (!isMultiTerminal && !isRecognizedRouter) {
      throw new Error(`Terminal not recognized: ${terminal}`);
    }
    const contexts = await client.readContract({
      address: terminal,
      abi: JB_TERMINAL_ABI,
      functionName: 'accountingContextsOf',
      args: [BigInt(projectId)],
    });
    if (contexts.length === 0) return [];
    if (!isMultiTerminal) {
      throw new Error(`Terminal not recognized for accounting contexts: ${terminal}`);
    }
    const store = await client.readContract({
      address: terminal,
      abi: JB_TERMINAL_ABI,
      functionName: 'STORE',
    });
    return contexts.map((context) => ({
      terminal,
      store,
      token: context.token,
      tokenDecimals: Number(context.decimals),
      currency: Number(context.currency),
    }));
  }))).flat();
  if (terminalContexts.length === 0) {
    throw new Error('Project has no accounting context configured');
  }
  const seenTokens = new Set<string>();
  for (const context of terminalContexts) {
    const token = context.token.toLowerCase();
    if (
      !Number.isInteger(context.tokenDecimals) ||
      context.tokenDecimals < 0 ||
      context.tokenDecimals > 77 ||
      !Number.isInteger(context.currency) ||
      context.currency < 0 ||
      context.currency > 0xffff_ffff
    ) {
      throw new Error(`Accounting context is invalid for token: ${context.token}`);
    }
    if (seenTokens.has(token)) {
      throw new Error(`Duplicate accounting context for token: ${context.token}`);
    }
    seenTokens.add(token);
  }

  const mapSplit = (s: {
    percent: number;
    projectId: bigint;
    beneficiary: Address;
    preferAddToBalance: boolean;
    lockedUntil: number;
    hook: Address;
  }): SplitData => {
    if (!Number.isSafeInteger(s.percent) || s.percent <= 0 || s.percent > 1_000_000_000) {
      throw new Error('Split percentage is invalid');
    }
    if (s.projectId < 0n || s.projectId > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Split project ID cannot be represented safely');
    }
    if (!isAddress(s.beneficiary) || !isAddress(s.hook)) {
      throw new Error('Split contains an invalid address');
    }
    if (!Number.isSafeInteger(s.lockedUntil) || s.lockedUntil < 0 || s.lockedUntil > 2 ** 48 - 1) {
      throw new Error('Split lock time is invalid');
    }
    return {
      percent: s.percent,
      projectId: Number(s.projectId),
      beneficiary: s.beneficiary,
      preferAddToBalance: s.preferAddToBalance,
      lockedUntil: s.lockedUntil,
      hook: s.hook,
    };
  };
  const validateSplitGroup = (splits: SplitData[], label: string): void => {
    const total = splits.reduce((sum, split) => sum + BigInt(split.percent), 0n);
    if (total > 1_000_000_000n) throw new Error(`${label} splits exceed 100%`);
  };

  const reservedRaw = await client.readContract({
    address: contracts.JBSplits,
    abi: JB_SPLITS_ABI,
    functionName: 'splitsOf',
    args: [BigInt(projectId), rsId, SPLIT_GROUP_RESERVED],
  });
  const reservedSplits = reservedRaw.map(mapSplit);
  validateSplitGroup(reservedSplits, 'Reserved token');

  const uniqueTokens = [...new Map(
    terminalContexts.map((context) => [context.token.toLowerCase(), context.token] as const),
  ).values()];
  const payoutGroups = await Promise.all(uniqueTokens.map(async (token) => {
    const groupId = getPayoutSplitGroup(token);
    const payoutRaw = await client.readContract({
      address: contracts.JBSplits,
      abi: JB_SPLITS_ABI,
      functionName: 'splitsOf',
      args: [BigInt(projectId), rsId, groupId],
    });
    const splits = payoutRaw.map(mapSplit);
    validateSplitGroup(splits, 'Payout');
    return { groupId: groupId.toString(), splits };
  }));
  await Promise.all(
    [reservedSplits, ...payoutGroups.map((group) => group.splits)]
      .flat()
      .map((split) => requireRecognizedRuntimeSplitHook({ client, hook: split.hook as Address })),
  );

  const fundAccessLimitGroups = await Promise.all(terminalContexts.map(async (context) => {
    const [payoutLimits, surplusAllowances] = await Promise.all([
      client.readContract({
        address: contracts.JBFundAccessLimits,
        abi: JB_FUND_ACCESS_LIMITS_ABI,
        functionName: 'payoutLimitsOf',
        args: [BigInt(projectId), rsId, context.terminal, context.token],
      }),
      client.readContract({
        address: contracts.JBFundAccessLimits,
        abi: JB_FUND_ACCESS_LIMITS_ABI,
        functionName: 'surplusAllowancesOf',
        args: [BigInt(projectId), rsId, context.terminal, context.token],
      }),
    ]);
    const payoutCurrencies = new Set(payoutLimits.map((limit) => String(limit.currency)));
    const allowanceCurrencies = new Set(surplusAllowances.map((limit) => String(limit.currency)));
    if (
      payoutCurrencies.size !== payoutLimits.length ||
      allowanceCurrencies.size !== surplusAllowances.length
    ) {
      throw new Error(`Fund access currencies are duplicated for token: ${context.token}`);
    }
    const allowancesWithUsage = await Promise.all(surplusAllowances.map(async (allowance) => ({
      amount: String(allowance.amount),
      currency: Number(allowance.currency),
      usedAmount: String(
        await client.readContract({
          address: context.store,
          abi: JB_TERMINAL_STORE_ABI,
          functionName: 'usedSurplusAllowanceOf',
          args: [
            context.terminal,
            BigInt(projectId),
            context.token,
            rsId,
            BigInt(allowance.currency),
          ],
        }),
      ),
    })));
    return {
      terminal: context.terminal,
      token: context.token,
      tokenDecimals: context.tokenDecimals,
      payoutLimits: payoutLimits.map((limit) => ({
        amount: String(limit.amount),
        currency: Number(limit.currency),
      })),
      surplusAllowances: allowancesWithUsage,
    };
  }));

  const nonEmptyPayoutGroups = payoutGroups.filter((group) => group.splits.length > 0);
  return {
    payoutSplits: nonEmptyPayoutGroups[0]?.splits ?? [],
    reservedSplits,
    fundAccessLimits:
      fundAccessLimitGroups.find((group) =>
        group.payoutLimits.length > 0 || group.surplusAllowances.length > 0
      ) ?? null,
    splitGroups: [
      { groupId: SPLIT_GROUP_RESERVED.toString(), splits: reservedSplits },
      ...payoutGroups,
    ],
    fundAccessLimitGroups,
    accountingContexts: terminalContexts.map(({ terminal, token, tokenDecimals, currency }) => ({
      terminal,
      token,
      tokenDecimals,
      currency,
    })),
    configurationComplete: true,
  };
}
