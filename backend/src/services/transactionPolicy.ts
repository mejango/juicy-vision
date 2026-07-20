import { type Address, decodeAbiParameters, decodeFunctionData, type Hex, zeroAddress } from 'viem';
import {
  CANONICAL_USDC_BY_CHAIN,
  CONTRACTS,
  DEAD_ADDRESS as SHARED_DEAD_ADDRESS,
  NATIVE_TOKEN as SHARED_NATIVE_TOKEN,
  SUCKER_DEPLOYERS,
} from '@shared/chains.ts';
import {
  quotedOutputFloor,
  resolveCashOutPreviewOutcome,
  resolvePayPreviewOutcome,
  TERMINAL_PREVIEW_ABI,
} from '@shared/terminalPreview.ts';
import { JB_OMNICHAIN_DEPLOYER_ABI } from '../../../src/constants/abis/jbOmnichainDeployer.ts';
import { REV_DEPLOYER_ABI } from '../../../src/constants/abis/revDeployer.ts';
import {
  assertRecognizedPaymentRouteWithClient,
  assertRecognizedProjectContracts,
  fetchCurrentRuleset,
  fetchSplits,
  getPublicClient,
} from './chainReader.ts';
import {
  requireRecognizedApprovalHook,
  requireRecognizedConfiguredDataHook,
  requireRecognizedProject721Hook,
  requireRecognizedProjectCashOutConfiguration,
  requireRecognizedProjectPayConfiguration,
  requireRecognizedRuntimeHook,
  requireRecognizedRuntimeSplitHook,
} from './projectTrust.ts';
import type { RulesetMetadata } from './rulesetCache.ts';

const ROOTS = {
  directory: CONTRACTS.JBDirectory as Address,
  projects: CONTRACTS.JBProjects as Address,
};

export function protectedManagedFundAccessMinimum(
  quotedAmount: bigint,
  configuredCurrency: bigint,
  accountingCurrency: bigint,
): bigint {
  return configuredCurrency === accountingCurrency ? quotedAmount : quotedOutputFloor(quotedAmount);
}

const RECOGNIZED = {
  controller: CONTRACTS.JBController as Address,
  multiTerminal: CONTRACTS.JBMultiTerminal as Address,
  routerTerminal: CONTRACTS.JBRouterTerminal as Address,
  routerTerminalRegistry: CONTRACTS.JBRouterTerminalRegistry as Address,
  omnichainDeployer: CONTRACTS.JBOmnichainDeployer as Address,
  revDeployer: CONTRACTS.REVDeployer as Address,
  revOwner: CONTRACTS.REVOwner as Address,
};

const NATIVE_TOKEN = SHARED_NATIVE_TOKEN.toLowerCase() as Address;
const DEAD_ADDRESS = SHARED_DEAD_ADDRESS.toLowerCase() as Address;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as Hex;
const USDC_BY_CHAIN = Object.fromEntries(
  Object.entries(CANONICAL_USDC_BY_CHAIN).map(([chainId, address]) => [
    Number(chainId),
    address.toLowerCase() as Address,
  ]),
) as Record<number, Address>;
const RECOGNIZED_SUCKER_DEPLOYERS = new Set(
  SUCKER_DEPLOYERS.map((address) => address.toLowerCase()),
);

const SELECTORS = {
  pay: '0xfef43257',
  addToBalance: '0x9e6eec05',
  cashOut: '0x13da8317',
  sendPayouts: '0xcfaf5839',
  useAllowance: '0x748e821c',
  queueRulesets: '0x3141db70',
  deployErc20: '0x58178191',
  sendReserved: '0x090db2f1',
  setSplitGroups: '0x8a36dffd',
  setUri: '0x702a3977',
  adjustTiers: '0x437aa91a',
  setTierDiscounts: '0xcf7f4936',
  launchProject: '0x670d99be',
  launchProjectWithTiers: '0x2d993173',
  deployRevnet: '0x54ca091d',
  deployRevnetWithTiers: '0x86dbf9c7',
} as const;

const DIRECTORY_ABI = [
  {
    name: 'controllerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
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
  {
    name: 'terminalsOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
] as const;

const TERMINAL_ACCOUNTING_CONTEXTS_ABI = [{
  name: 'accountingContextsOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{
    name: 'contexts',
    type: 'tuple[]',
    components: [
      { name: 'token', type: 'address' },
      { name: 'decimals', type: 'uint8' },
      { name: 'currency', type: 'uint32' },
    ],
  }],
}] as const;

const PROJECTS_ABI = [{
  name: 'creationFee',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

const FEELESS_ADDRESSES_ABI = [{
  name: 'isFeelessFor',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'addr', type: 'address' },
    { name: 'projectId', type: 'uint256' },
    { name: 'caller', type: 'address' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

const FEE_FREE_SURPLUS_ABI = [{
  name: 'feeFreeSurplusOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

const MANAGED_FUND_ACCESS_ABI = [
  {
    name: 'sendPayoutsOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'currency', type: 'uint256' },
      { name: 'minTokensPaidOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountPaidOut', type: 'uint256' }],
  },
  {
    name: 'useAllowanceOf',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'currency', type: 'uint256' },
      { name: 'minTokensPaidOut', type: 'uint256' },
      { name: 'beneficiary', type: 'address' },
      { name: 'feeBeneficiary', type: 'address' },
      { name: 'memo', type: 'string' },
    ],
    outputs: [{ name: 'netAmountPaidOut', type: 'uint256' }],
  },
  {
    name: 'JBMultiTerminal_UnderMin',
    type: 'error',
    inputs: [
      { name: 'value', type: 'uint256' },
      { name: 'min', type: 'uint256' },
    ],
  },
  {
    name: 'JBTerminalStore_InadequateControllerAllowance',
    type: 'error',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'allowance', type: 'uint256' },
    ],
  },
  {
    name: 'JBTerminalStore_InadequateTerminalStoreBalance',
    type: 'error',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'balance', type: 'uint256' },
    ],
  },
] as const;

const TIERS_HOOK_ABI = [
  {
    name: 'DIRECTORY',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'projectId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'STORE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const TIER_COMPONENTS = [
  { name: 'id', type: 'uint32' },
  { name: 'price', type: 'uint104' },
  { name: 'remainingSupply', type: 'uint32' },
  { name: 'initialSupply', type: 'uint32' },
  { name: 'votingUnits', type: 'uint104' },
  { name: 'reserveFrequency', type: 'uint16' },
  { name: 'reserveBeneficiary', type: 'address' },
  { name: 'encodedIpfsUri', type: 'bytes32' },
  { name: 'category', type: 'uint24' },
  { name: 'discountPercent', type: 'uint8' },
  {
    name: 'flags',
    type: 'tuple',
    components: [
      { name: 'allowOwnerMint', type: 'bool' },
      { name: 'transfersPausable', type: 'bool' },
      { name: 'cantBeRemoved', type: 'bool' },
      { name: 'cantIncreaseDiscountPercent', type: 'bool' },
      { name: 'cantBuyWithCredits', type: 'bool' },
    ],
  },
  { name: 'splitPercent', type: 'uint32' },
  { name: 'resolvedUri', type: 'string' },
] as const;

const TIERS_STORE_ABI = [{
  name: 'tierOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'hook', type: 'address' },
    { name: 'id', type: 'uint256' },
    { name: 'includeResolvedUri', type: 'bool' },
  ],
  outputs: [{ name: 'tier', type: 'tuple', components: TIER_COMPONENTS }],
}] as const;

const CONTROLLER_RESERVED_BALANCE_ABI = [{
  name: 'pendingReservedTokenBalanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'uint256' }],
}] as const;

const SPLIT_COMPONENTS = [
  { name: 'percent', type: 'uint32' },
  { name: 'projectId', type: 'uint64' },
  { name: 'beneficiary', type: 'address' },
  { name: 'preferAddToBalance', type: 'bool' },
  { name: 'lockedUntil', type: 'uint48' },
  { name: 'hook', type: 'address' },
] as const;

const TIER_CONFIG_COMPONENTS = [
  { name: 'price', type: 'uint104' },
  { name: 'initialSupply', type: 'uint32' },
  { name: 'votingUnits', type: 'uint32' },
  { name: 'reserveFrequency', type: 'uint16' },
  { name: 'reserveBeneficiary', type: 'address' },
  { name: 'encodedIpfsUri', type: 'bytes32' },
  { name: 'category', type: 'uint24' },
  { name: 'discountPercent', type: 'uint8' },
  {
    name: 'flags',
    type: 'tuple',
    components: [
      { name: 'allowOwnerMint', type: 'bool' },
      { name: 'useReserveBeneficiaryAsDefault', type: 'bool' },
      { name: 'transfersPausable', type: 'bool' },
      { name: 'useVotingUnits', type: 'bool' },
      { name: 'cantBeRemoved', type: 'bool' },
      { name: 'cantIncreaseDiscountPercent', type: 'bool' },
      { name: 'cantBuyWithCredits', type: 'bool' },
    ],
  },
  { name: 'splitPercent', type: 'uint32' },
  { name: 'splits', type: 'tuple[]', components: SPLIT_COMPONENTS },
] as const;

const SPLIT_GROUPS_PARAMETER = {
  name: 'splitGroups',
  type: 'tuple[]',
  components: [
    { name: 'groupId', type: 'uint256' },
    { name: 'splits', type: 'tuple[]', components: SPLIT_COMPONENTS },
  ],
} as const;

const RULESET_CONFIGURATIONS_PARAMETER = {
  name: 'rulesetConfigurations',
  type: 'tuple[]',
  components: [
    { name: 'mustStartAtOrAfter', type: 'uint48' },
    { name: 'duration', type: 'uint32' },
    { name: 'weight', type: 'uint112' },
    { name: 'weightCutPercent', type: 'uint32' },
    { name: 'approvalHook', type: 'address' },
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
    SPLIT_GROUPS_PARAMETER,
    {
      name: 'fundAccessLimitGroups',
      type: 'tuple[]',
      components: [
        { name: 'terminal', type: 'address' },
        { name: 'token', type: 'address' },
        {
          name: 'payoutLimits',
          type: 'tuple[]',
          components: [
            { name: 'amount', type: 'uint224' },
            { name: 'currency', type: 'uint32' },
          ],
        },
        {
          name: 'surplusAllowances',
          type: 'tuple[]',
          components: [
            { name: 'amount', type: 'uint224' },
            { name: 'currency', type: 'uint32' },
          ],
        },
      ],
    },
  ],
} as const;

type Numeric = bigint | number;

interface ManagedSplit {
  percent: Numeric;
  projectId: Numeric;
  beneficiary: Address;
  preferAddToBalance: boolean;
  lockedUntil: Numeric;
  hook: Address;
}

interface ManagedAccountingContext {
  token: Address;
  decimals: Numeric;
  currency: Numeric;
}

interface ManagedTerminalConfiguration {
  terminal: Address;
  accountingContextsToAccept: readonly ManagedAccountingContext[];
}

interface ManagedRulesetConfiguration {
  mustStartAtOrAfter: Numeric;
  duration: Numeric;
  weight: Numeric;
  weightCutPercent: Numeric;
  approvalHook: Address;
  metadata: {
    reservedPercent: Numeric;
    cashOutTaxRate: Numeric;
    baseCurrency: Numeric;
    pausePay: boolean;
    pauseCreditTransfers: boolean;
    allowOwnerMinting: boolean;
    allowSetCustomToken: boolean;
    allowTerminalMigration: boolean;
    allowSetTerminals: boolean;
    allowSetController: boolean;
    allowAddAccountingContext: boolean;
    allowAddPriceFeed: boolean;
    ownerMustSendPayouts: boolean;
    holdFees: boolean;
    scopeCashOutsToLocalBalances: boolean;
    useDataHookForPay: boolean;
    useDataHookForCashOut: boolean;
    dataHook: Address;
    metadata: Numeric;
  };
  splitGroups: readonly {
    groupId: Numeric;
    splits: readonly ManagedSplit[];
  }[];
  fundAccessLimitGroups: readonly {
    terminal: Address;
    token: Address;
    payoutLimits: readonly { amount: Numeric; currency: Numeric }[];
    surplusAllowances: readonly { amount: Numeric; currency: Numeric }[];
  }[];
}

interface ManagedSuckerConfiguration {
  deployerConfigurations: readonly {
    deployer: Address;
    peer: Hex;
    mappings: readonly {
      localToken: Address;
      minGas: Numeric;
      remoteToken: Hex;
    }[];
  }[];
  salt: Hex;
}

interface ManagedTierConfiguration {
  price: Numeric;
  initialSupply: Numeric;
  votingUnits: Numeric;
  reserveFrequency: Numeric;
  reserveBeneficiary: Address;
  encodedIpfsUri: Hex;
  category: Numeric;
  discountPercent: Numeric;
  flags: {
    allowOwnerMint: boolean;
    useReserveBeneficiaryAsDefault: boolean;
    transfersPausable: boolean;
    useVotingUnits: boolean;
    cantBeRemoved: boolean;
    cantIncreaseDiscountPercent: boolean;
    cantBuyWithCredits: boolean;
  };
  splitPercent: Numeric;
  splits: readonly ManagedSplit[];
}

interface ManagedTierDiscount {
  tierId: Numeric;
  discountPercent: Numeric;
}

interface ManagedTiersHookConfiguration {
  name: string;
  symbol: string;
  tokenUriResolver: Address;
  contractUri: string;
  tiersConfig: {
    tiers: readonly ManagedTierConfiguration[];
    currency: Numeric;
    decimals: Numeric;
  };
  flags: {
    noNewTiersWithReserves: boolean;
    noNewTiersWithVotes: boolean;
    noNewTiersWithOwnerMinting: boolean;
  };
}

function asBigInt(value: Numeric): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function requireIpfsUri(uri: string, field: string): void {
  if (!/^ipfs:\/\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})(?:\/[^\s]*)?$/.test(uri)) {
    throw new Error(`${field} must be a pinned IPFS URI`);
  }
}

function requireErc20Metadata(name: string, symbol: string, salt: Hex): void {
  if (name !== name.trim() || name.length === 0 || new TextEncoder().encode(name).length > 64) {
    throw new Error('Token name must be 1-64 bytes with no surrounding whitespace');
  }
  if (symbol !== symbol.trim() || !/^[A-Za-z0-9]{2,10}$/.test(symbol)) {
    throw new Error('Token symbol must be 2-10 letters or numbers');
  }
  if (salt === ZERO_BYTES32) throw new Error('Token deployment salt cannot be zero');
}

function requireNonzeroAddress(address: Address, field: string): void {
  if (address.toLowerCase() === zeroAddress) throw new Error(`${field} cannot be the zero address`);
}

function requireAccountingContext(
  chainId: number,
  context: ManagedAccountingContext,
  field: string,
): void {
  requireRecognizedAccountingToken(chainId, context.token);
  const expectedDecimals = context.token.toLowerCase() === NATIVE_TOKEN ? 18n : 6n;
  if (asBigInt(context.decimals) !== expectedDecimals) {
    throw new Error(`${field} has incorrect token decimals`);
  }
  if (asBigInt(context.currency) !== tokenCurrency(context.token)) {
    throw new Error(`${field} has an incorrect accounting currency`);
  }
}

function requireSplit(split: ManagedSplit, field: string): void {
  const percent = asBigInt(split.percent);
  if (percent <= 0n || percent > 1_000_000_000n) {
    throw new Error(`${field} has an invalid percentage`);
  }
  if (
    asBigInt(split.projectId) === 0n &&
    split.beneficiary.toLowerCase() === zeroAddress &&
    split.hook.toLowerCase() === zeroAddress
  ) {
    throw new Error(`${field} has no explicit recipient`);
  }
}

function requireSplitGroup(
  splits: readonly ManagedSplit[],
  field: string,
): void {
  if (splits.length === 0) throw new Error(`${field} is empty`);
  let total = 0n;
  splits.forEach((split, index) => {
    requireSplit(split, `${field}.splits[${index}]`);
    total += asBigInt(split.percent);
  });
  if (total > 1_000_000_000n) throw new Error(`${field} exceeds 100%`);
}

function requireProjectSplitGroup(
  splits: readonly ManagedSplit[],
  field: string,
  options: { kind: 'payout' | 'reserved'; sourceProjectId: bigint },
): void {
  let total = 0n;
  splits.forEach((split, index) => {
    const splitField = `${field}.splits[${index}]`;
    requireSplit(split, splitField);
    const projectId = asBigInt(split.projectId);
    if (projectId < 0n || projectId > (1n << 64n) - 1n) {
      throw new Error(`${splitField} has an invalid project ID`);
    }
    if (asBigInt(split.lockedUntil) < 0n || asBigInt(split.lockedUntil) > (1n << 48n) - 1n) {
      throw new Error(`${splitField} has an invalid lock time`);
    }
    const beneficiary = split.beneficiary.toLowerCase();
    if (projectId === 0n) {
      if (beneficiary === zeroAddress || beneficiary === DEAD_ADDRESS) {
        throw new Error(`${splitField} must use an explicit wallet recipient`);
      }
      if (split.preferAddToBalance) {
        throw new Error(`${splitField} has an irrelevant add-to-balance preference`);
      }
    } else {
      if (projectId === options.sourceProjectId) {
        throw new Error(`${splitField} cannot route back to its source project`);
      }
      if (options.kind === 'reserved' && split.preferAddToBalance) {
        throw new Error(`${splitField} has an irrelevant add-to-balance preference`);
      }
    }
    total += asBigInt(split.percent);
  });
  if (total > 1_000_000_000n) throw new Error(`${field} exceeds 100%`);
}

function hasExactSplit(splits: readonly ManagedSplit[], candidate: ManagedSplit): boolean {
  const fingerprint = splitFingerprint(candidate);
  return splits.some((split) => splitFingerprint(split) === fingerprint);
}

function requireExplicitBeneficiariesForNewProjectRoutes(params: {
  submitted: readonly ManagedSplit[];
  current: readonly ManagedSplit[];
  kind: 'payout' | 'reserved';
  field: string;
}): void {
  params.submitted.forEach((split, index) => {
    if (asBigInt(split.projectId) === 0n || hasExactSplit(params.current, split)) return;
    const beneficiary = split.beneficiary.toLowerCase();
    const missing = beneficiary === zeroAddress || beneficiary === DEAD_ADDRESS;
    if (!missing) return;
    if (params.kind === 'payout' && split.preferAddToBalance) return;
    const role = params.kind === 'reserved'
      ? 'fallback beneficiary'
      : 'destination-token beneficiary';
    throw new Error(`${params.field}.splits[${index}] needs an explicit ${role}`);
  });
}

function requireTerminalConfigurations(
  chainId: number,
  configurations: readonly ManagedTerminalConfiguration[],
): Set<string> {
  if (configurations.length === 0) throw new Error('At least one terminal is required');
  const terminals = new Set<string>();
  const acceptedTokens = new Set<string>();
  configurations.forEach((configuration, index) => {
    const terminal = configuration.terminal.toLowerCase();
    if (terminals.has(terminal)) throw new Error('Duplicate terminal configuration');
    terminals.add(terminal);
    if (terminal === RECOGNIZED.multiTerminal.toLowerCase()) {
      if (configuration.accountingContextsToAccept.length === 0) {
        throw new Error('The recognized multi terminal needs an accounting context');
      }
      configuration.accountingContextsToAccept.forEach((context, contextIndex) => {
        requireAccountingContext(
          chainId,
          context,
          `terminalConfigurations[${index}].contexts[${contextIndex}]`,
        );
        const token = context.token.toLowerCase();
        if (acceptedTokens.has(token)) throw new Error('Duplicate accounting token');
        acceptedTokens.add(token);
      });
      return;
    }
    if (terminal === RECOGNIZED.routerTerminalRegistry.toLowerCase()) {
      if (configuration.accountingContextsToAccept.length !== 0) {
        throw new Error('The router terminal registry must not define accounting contexts');
      }
      return;
    }
    throw new Error(`Terminal not recognized: ${configuration.terminal}`);
  });
  return acceptedTokens;
}

async function requireRulesetConfigurations(
  chainId: number,
  configurations: readonly ManagedRulesetConfiguration[],
  acceptedTokens: Set<string>,
): Promise<void> {
  if (configurations.length === 0) throw new Error('At least one ruleset is required');
  const client = getPublicClient(chainId);
  const acceptedCurrencies = new Set(
    [...acceptedTokens].map((token) => tokenCurrency(token as Address).toString()),
  );
  for (let index = 0; index < configurations.length; index++) {
    const configuration = configurations[index];
    const prefix = `rulesets[${index}]`;
    const mustStartAtOrAfter = asBigInt(configuration.mustStartAtOrAfter);
    const duration = asBigInt(configuration.duration);
    const weight = asBigInt(configuration.weight);
    const weightCutPercent = asBigInt(configuration.weightCutPercent);
    if (mustStartAtOrAfter < 0n || mustStartAtOrAfter >= 1n << 48n) {
      throw new Error(`${prefix} has an invalid start time`);
    }
    if (duration < 0n || duration >= 1n << 32n) {
      throw new Error(`${prefix} has an invalid duration`);
    }
    if (weight < 0n || weight >= 1n << 112n) {
      throw new Error(`${prefix} has an invalid issuance weight`);
    }
    if (weightCutPercent < 0n || weightCutPercent > 1_000_000_000n) {
      throw new Error(`${prefix} has an invalid issuance decay`);
    }
    const reservedPercent = asBigInt(configuration.metadata.reservedPercent);
    const cashOutTaxRate = asBigInt(configuration.metadata.cashOutTaxRate);
    if (reservedPercent < 0n || reservedPercent > 10_000n) {
      throw new Error(`${prefix} has an invalid reserved rate`);
    }
    if (cashOutTaxRate < 0n || cashOutTaxRate > 10_000n) {
      throw new Error(`${prefix} has an invalid cash-out curve rate`);
    }
    if (!acceptedCurrencies.has(asBigInt(configuration.metadata.baseCurrency).toString())) {
      throw new Error(`${prefix} base currency is not tied to a recognized live accounting token`);
    }
    requireRecognizedApprovalHook(configuration.approvalHook);
    await requireRecognizedConfiguredDataHook({ client, hook: configuration.metadata.dataHook });
    if (
      (configuration.metadata.useDataHookForPay || configuration.metadata.useDataHookForCashOut) &&
      configuration.metadata.dataHook.toLowerCase() === zeroAddress
    ) {
      throw new Error(`${prefix} enables a missing data hook`);
    }

    const splitGroupIds = new Set<string>();
    for (let groupIndex = 0; groupIndex < configuration.splitGroups.length; groupIndex++) {
      const group = configuration.splitGroups[groupIndex];
      const groupId = asBigInt(group.groupId);
      if (splitGroupIds.has(groupId.toString())) throw new Error('Duplicate split group');
      splitGroupIds.add(groupId.toString());
      const isReserved = groupId === 1n;
      const isAcceptedPayoutToken = [...acceptedTokens].some((token) => BigInt(token) === groupId);
      if (!isReserved && !isAcceptedPayoutToken) {
        throw new Error(`Split group is not tied to an accepted token: ${groupId}`);
      }
      requireSplitGroup(group.splits, `${prefix}.splitGroups[${groupIndex}]`);
      for (const split of group.splits) {
        await requireRecognizedRuntimeSplitHook({ client, hook: split.hook });
      }
    }

    const fundTokens = new Set<string>();
    for (
      let groupIndex = 0;
      groupIndex < configuration.fundAccessLimitGroups.length;
      groupIndex++
    ) {
      const group = configuration.fundAccessLimitGroups[groupIndex];
      if (group.terminal.toLowerCase() !== RECOGNIZED.multiTerminal.toLowerCase()) {
        throw new Error(`Fund access terminal not recognized: ${group.terminal}`);
      }
      requireRecognizedAccountingToken(chainId, group.token);
      const token = group.token.toLowerCase();
      if (!acceptedTokens.has(token)) {
        throw new Error('Fund access token is not accepted by the terminal');
      }
      if (fundTokens.has(token)) throw new Error('Duplicate fund access token');
      fundTokens.add(token);
      const expectedCurrency = tokenCurrency(group.token);
      if (group.payoutLimits.length === 0 && group.surplusAllowances.length === 0) {
        throw new Error('Empty fund access group');
      }
      for (
        const [kind, limits] of [
          ['payout', group.payoutLimits],
          ['allowance', group.surplusAllowances],
        ] as const
      ) {
        const currencies = new Set<string>();
        for (const limit of limits) {
          const currency = asBigInt(limit.currency);
          if (currency !== expectedCurrency) {
            throw new Error('Fund access currency conversion is not supported');
          }
          if (asBigInt(limit.amount) <= 0n) throw new Error('Fund access amount must be positive');
          const key = currency.toString();
          if (currencies.has(key)) throw new Error(`Duplicate ${kind} currency`);
          currencies.add(key);
        }
      }
    }
  }
}

function requireRemoteToken(token: Hex): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(token)) throw new Error('Invalid remote token');
  if (token.slice(2, 26) !== '0'.repeat(24)) {
    throw new Error('Remote token must be a left-padded EVM address');
  }
  const address = `0x${token.slice(-40)}`.toLowerCase();
  const recognized = address === NATIVE_TOKEN ||
    Object.values(USDC_BY_CHAIN).some((usdc) => usdc.toLowerCase() === address);
  if (!recognized) throw new Error(`Remote accounting token not recognized: ${address}`);
}

function requireSuckerConfiguration(
  chainId: number,
  configuration: ManagedSuckerConfiguration,
): void {
  if (configuration.deployerConfigurations.length > 0 && configuration.salt === ZERO_BYTES32) {
    throw new Error('Sucker salt cannot be zero');
  }
  if (configuration.deployerConfigurations.length === 0 && configuration.salt !== ZERO_BYTES32) {
    throw new Error('Empty sucker configuration must use the zero salt');
  }
  const deployers = new Set<string>();
  configuration.deployerConfigurations.forEach((deployerConfiguration, index) => {
    const deployer = deployerConfiguration.deployer.toLowerCase();
    if (!RECOGNIZED_SUCKER_DEPLOYERS.has(deployer)) {
      throw new Error(`Sucker deployer not recognized: ${deployerConfiguration.deployer}`);
    }
    if (deployers.has(deployer)) throw new Error('Duplicate sucker deployer');
    deployers.add(deployer);
    if (deployerConfiguration.peer !== ZERO_BYTES32) {
      throw new Error('Explicit sucker peers are not supported in this flow');
    }
    if (deployerConfiguration.mappings.length === 0) throw new Error('Sucker mapping is required');
    const localTokens = new Set<string>();
    const remoteTokens = new Set<string>();
    deployerConfiguration.mappings.forEach((mapping, mappingIndex) => {
      requireRecognizedAccountingToken(chainId, mapping.localToken);
      const localToken = mapping.localToken.toLowerCase();
      if (localTokens.has(localToken)) throw new Error('Duplicate local sucker token mapping');
      localTokens.add(localToken);
      const minGas = asBigInt(mapping.minGas);
      if (minGas <= 0n || minGas > 5_000_000n) {
        throw new Error(`Invalid sucker gas limit at ${index}:${mappingIndex}`);
      }
      requireRemoteToken(mapping.remoteToken);
      const remoteToken = `0x${mapping.remoteToken.slice(-40)}`.toLowerCase();
      if (remoteTokens.has(remoteToken)) throw new Error('Duplicate remote sucker token mapping');
      remoteTokens.add(remoteToken);
      const localIsNative = localToken === NATIVE_TOKEN;
      const remoteIsNative = remoteToken === NATIVE_TOKEN;
      if (localIsNative !== remoteIsNative) {
        throw new Error('Sucker token mappings must preserve the accounting-token family');
      }
    });
  });
}

function requireTiersHookConfiguration(
  chainId: number,
  configuration: ManagedTiersHookConfiguration,
): void {
  if (!configuration.name.trim() || !configuration.symbol.trim()) {
    throw new Error('Tier collection name and symbol are required');
  }
  if (configuration.tokenUriResolver.toLowerCase() !== zeroAddress) {
    throw new Error(`Token URI resolver not recognized: ${configuration.tokenUriResolver}`);
  }
  requireIpfsUri(configuration.contractUri, 'Tier collection URI');
  if (configuration.tiersConfig.tiers.length === 0) {
    throw new Error('An unused tiers hook is not allowed');
  }
  const currency = asBigInt(configuration.tiersConfig.currency);
  const decimals = asBigInt(configuration.tiersConfig.decimals);
  const usdc = USDC_BY_CHAIN[chainId];
  if (!usdc) throw new Error(`Unsupported chain ${chainId}`);
  const usdcCurrency = tokenCurrency(usdc);
  const recognizedPricing = (currency === 1n && decimals === 18n) ||
    (currency === 2n && decimals === 6n) ||
    (currency === tokenCurrency(NATIVE_TOKEN) && decimals === 18n) ||
    (currency === usdcCurrency && decimals === 6n);
  if (!recognizedPricing) throw new Error('Tier pricing context is not recognized');
  let previousCategory = -1n;
  let defaultReserveBeneficiary: string = zeroAddress;
  configuration.tiersConfig.tiers.forEach((tier, index) => {
    const price = asBigInt(tier.price);
    if (price < 0n || price >= 1n << 104n) {
      throw new Error(`Tier ${index + 1} has an invalid price`);
    }
    const initialSupply = asBigInt(tier.initialSupply);
    if (initialSupply <= 0n || initialSupply > 999_999_999n) {
      throw new Error(`Tier ${index + 1} has an invalid supply`);
    }
    const votingUnits = asBigInt(tier.votingUnits);
    if (votingUnits < 0n || votingUnits > 0xffff_ffffn) {
      throw new Error(`Tier ${index + 1} has invalid voting units`);
    }
    const reserveFrequency = asBigInt(tier.reserveFrequency);
    if (reserveFrequency < 0n || reserveFrequency > 0xffffn) {
      throw new Error(`Tier ${index + 1} has an invalid reserve frequency`);
    }
    if (initialSupply === 1n && reserveFrequency > 0n) {
      throw new Error(`Tier ${index + 1} has a deadlocked reserve configuration`);
    }
    const reserveBeneficiary = tier.reserveBeneficiary.toLowerCase();
    if (
      reserveFrequency === 0n &&
      (reserveBeneficiary !== zeroAddress || tier.flags.useReserveBeneficiaryAsDefault)
    ) {
      throw new Error(`Tier ${index + 1} has an irrelevant reserve beneficiary`);
    }
    if (
      reserveFrequency > 0n &&
      reserveBeneficiary === zeroAddress &&
      defaultReserveBeneficiary === zeroAddress
    ) {
      throw new Error(`Tier ${index + 1} has no reserve beneficiary`);
    }
    if (reserveFrequency > 0n && tier.flags.useReserveBeneficiaryAsDefault) {
      if (reserveBeneficiary === zeroAddress) {
        throw new Error(`Tier ${index + 1} cannot set an empty default reserve beneficiary`);
      }
      defaultReserveBeneficiary = reserveBeneficiary;
    }
    if (configuration.flags.noNewTiersWithReserves && reserveFrequency > 0n) {
      throw new Error(`Tier ${index + 1} uses reserves disabled by the collection`);
    }
    if (
      configuration.flags.noNewTiersWithVotes &&
      ((tier.flags.useVotingUnits && votingUnits !== 0n) ||
        (!tier.flags.useVotingUnits && price !== 0n))
    ) {
      throw new Error(`Tier ${index + 1} uses voting units disabled by the collection`);
    }
    if (configuration.flags.noNewTiersWithOwnerMinting && tier.flags.allowOwnerMint) {
      throw new Error(`Tier ${index + 1} enables owner minting disabled by the collection`);
    }
    const discountPercent = asBigInt(tier.discountPercent);
    if (discountPercent < 0n || discountPercent > 200n) {
      throw new Error(`Tier ${index + 1} has an invalid discount`);
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(tier.encodedIpfsUri) || tier.encodedIpfsUri === ZERO_BYTES32) {
      throw new Error(`Tier ${index + 1} has no metadata`);
    }
    const category = asBigInt(tier.category);
    if (category < previousCategory || category > 0xff_ffffn) {
      throw new Error('Tiers must be sorted by a valid category');
    }
    previousCategory = category;
    const splitPercent = asBigInt(tier.splitPercent);
    if (splitPercent < 0n || splitPercent > 1_000_000_000n) {
      throw new Error(`Tier ${index + 1} has an invalid split percentage`);
    }
    if ((splitPercent === 0n) !== (tier.splits.length === 0)) {
      throw new Error(`Tier ${index + 1} has an inconsistent split configuration`);
    }
    if (splitPercent > 0n) {
      requireSplitGroup(tier.splits, `tiers[${index}]`);
    }
  });
}

function requireSafeTierAdjustments(
  tiersToAdd: readonly ManagedTierConfiguration[],
  tierIdsToRemove: readonly Numeric[],
): void {
  if (tiersToAdd.length === 0 && tierIdsToRemove.length === 0) {
    throw new Error('A tier update must add or remove at least one tier');
  }
  if (tiersToAdd.length > 100 || tierIdsToRemove.length > 100) {
    throw new Error('A tier update may change at most 100 tiers at once');
  }

  const removalIds = new Set<string>();
  for (const rawId of tierIdsToRemove) {
    const id = asBigInt(rawId);
    if (id <= 0n) throw new Error(`Invalid tier ID to remove: ${id}`);
    if (removalIds.has(id.toString())) throw new Error(`Duplicate tier ID to remove: ${id}`);
    removalIds.add(id.toString());
  }

  let previousCategory = -1n;
  tiersToAdd.forEach((tier, index) => {
    const label = `Tier ${index + 1}`;
    const price = asBigInt(tier.price);
    if (price < 0n || price >= 1n << 104n) throw new Error(`${label} has an invalid price`);
    const initialSupply = asBigInt(tier.initialSupply);
    if (initialSupply <= 0n || initialSupply > 999_999_999n) {
      throw new Error(`${label} has an invalid supply`);
    }
    const votingUnits = asBigInt(tier.votingUnits);
    if (votingUnits < 0n || votingUnits > 0xffff_ffffn) {
      throw new Error(`${label} has invalid voting units`);
    }
    if (tier.flags.useVotingUnits ? votingUnits === 0n : votingUnits !== 0n) {
      throw new Error(`${label} has an irrelevant voting-unit setting`);
    }
    const reserveFrequency = asBigInt(tier.reserveFrequency);
    if (reserveFrequency < 0n || reserveFrequency > 0xffffn) {
      throw new Error(`${label} has an invalid reserve frequency`);
    }
    const reserveBeneficiary = tier.reserveBeneficiary.toLowerCase();
    if (reserveFrequency === 0n && reserveBeneficiary !== zeroAddress) {
      throw new Error(`${label} has an irrelevant reserve beneficiary`);
    }
    if (
      reserveFrequency > 0n &&
      (reserveBeneficiary === zeroAddress || reserveBeneficiary === DEAD_ADDRESS)
    ) {
      throw new Error(`${label} must use an explicit reserve beneficiary`);
    }
    if (initialSupply === 1n && reserveFrequency > 0n) {
      throw new Error(`${label} has a deadlocked reserve configuration`);
    }
    if (tier.flags.useReserveBeneficiaryAsDefault) {
      throw new Error(`${label} cannot replace the collection-wide reserve beneficiary`);
    }
    const discountPercent = asBigInt(tier.discountPercent);
    if (discountPercent < 0n || discountPercent > 200n) {
      throw new Error(`${label} has an invalid discount`);
    }
    if (tier.encodedIpfsUri === ZERO_BYTES32) throw new Error(`${label} has no pinned metadata`);
    const category = asBigInt(tier.category);
    if (category < previousCategory || category > 0xff_ffffn) {
      throw new Error('Tiers must be sorted by a valid category');
    }
    previousCategory = category;
    if (asBigInt(tier.splitPercent) !== 0n || tier.splits.length !== 0) {
      throw new Error(
        `${label} uses advanced payment routing, which is not supported in this flow`,
      );
    }
  });
}

function requireSafeTierDiscounts(configs: readonly ManagedTierDiscount[]): void {
  if (configs.length === 0) throw new Error('At least one tier discount is required');
  if (configs.length > 100) throw new Error('At most 100 tier discounts can be changed at once');

  const tierIds = new Set<string>();
  for (const config of configs) {
    const tierId = asBigInt(config.tierId);
    const discountPercent = asBigInt(config.discountPercent);
    if (tierId <= 0n || tierId > 0xffff_ffffn) {
      throw new Error(`Invalid tier ID: ${tierId}`);
    }
    if (discountPercent < 0n || discountPercent > 200n) {
      throw new Error(`Invalid discount for tier ${tierId}`);
    }
    if (tierIds.has(tierId.toString())) {
      throw new Error(`Duplicate discount for tier ${tierId}`);
    }
    tierIds.add(tierId.toString());
  }
}

interface ManagedRevnetConfiguration {
  description: { name: string; ticker: string; uri: string; salt: Hex };
  baseCurrency: Numeric;
  operator: Address;
  scopeCashOutsToLocalBalances: boolean;
  stageConfigurations: readonly {
    startsAtOrAfter: Numeric;
    autoIssuances: readonly {
      chainId: Numeric;
      count: Numeric;
      beneficiary: Address;
    }[];
    splitPercent: Numeric;
    splits: readonly ManagedSplit[];
    initialIssuance: Numeric;
    issuanceCutFrequency: Numeric;
    issuanceCutPercent: Numeric;
    cashOutTaxRate: Numeric;
    extraMetadata: Numeric;
  }[];
}

function requireRevnetConfiguration(configuration: ManagedRevnetConfiguration): void {
  if (
    !configuration.description.name.trim() ||
    !/^[A-Za-z0-9]{1,11}$/.test(configuration.description.ticker)
  ) {
    throw new Error('Revnet name and ticker are required');
  }
  requireIpfsUri(configuration.description.uri, 'Revnet metadata URI');
  if (configuration.description.salt === ZERO_BYTES32) {
    throw new Error('Revnet salt cannot be zero');
  }
  const baseCurrency = asBigInt(configuration.baseCurrency);
  if (baseCurrency !== 1n && baseCurrency !== 2n) {
    throw new Error('Revnet base currency is not recognized');
  }
  requireNonzeroAddress(configuration.operator, 'Revnet operator');
  if (configuration.scopeCashOutsToLocalBalances) {
    throw new Error('Chain-local revnet cash outs are not supported in this flow');
  }
  if (configuration.stageConfigurations.length === 0) throw new Error('Revnet stages are required');
  let previousStart = -1n;
  configuration.stageConfigurations.forEach((stage, stageIndex) => {
    const start = asBigInt(stage.startsAtOrAfter);
    if (stageIndex > 0 && start <= previousStart) {
      throw new Error('Revnet stage start times must increase');
    }
    previousStart = start;
    if (asBigInt(stage.initialIssuance) <= 0n || asBigInt(stage.initialIssuance) >= 1n << 112n) {
      throw new Error(`Revnet stage ${stageIndex + 1} has no issuance`);
    }
    const issuanceCutFrequency = asBigInt(stage.issuanceCutFrequency);
    if (issuanceCutFrequency < 86_400n || issuanceCutFrequency > 0xffff_ffffn) {
      throw new Error(`Revnet stage ${stageIndex + 1} has an invalid issuance cut frequency`);
    }
    if (asBigInt(stage.issuanceCutPercent) > 1_000_000_000n) {
      throw new Error(`Revnet stage ${stageIndex + 1} has an invalid issuance cut`);
    }
    if (asBigInt(stage.cashOutTaxRate) >= 10_000n) {
      throw new Error(`Revnet stage ${stageIndex + 1} disables cash outs`);
    }
    if (asBigInt(stage.extraMetadata) !== 0n) {
      throw new Error(`Revnet stage ${stageIndex + 1} uses unsupported metadata`);
    }
    const splitPercent = asBigInt(stage.splitPercent);
    if (splitPercent > 10_000n) {
      throw new Error(`Revnet stage ${stageIndex + 1} has an invalid split`);
    }
    if (splitPercent > 0n) {
      requireSplitGroup(stage.splits, `revnet.stages[${stageIndex}]`);
      if (stage.splits.length !== 1) {
        throw new Error(`Revnet stage ${stageIndex + 1} must route its operator split directly`);
      }
      const split = stage.splits[0];
      if (
        asBigInt(split.percent) !== 1_000_000_000n ||
        asBigInt(split.projectId) !== 0n ||
        split.beneficiary.toLowerCase() !== configuration.operator.toLowerCase() ||
        split.preferAddToBalance ||
        asBigInt(split.lockedUntil) !== 0n ||
        split.hook.toLowerCase() !== zeroAddress
      ) {
        throw new Error(`Revnet stage ${stageIndex + 1} operator split is not recognized`);
      }
    } else if (stage.splits.length > 0) {
      throw new Error(`Revnet stage ${stageIndex + 1} has irrelevant splits`);
    }
    if (stage.autoIssuances.length > 0) {
      throw new Error('Automatic token issuances are not supported in this flow');
    }
  });
}

async function requireOmnichainLaunchCalldata(
  chainId: number,
  data: Hex,
  expectedOwner?: Address,
): Promise<void> {
  const decoded = decodeFunctionData({ abi: JB_OMNICHAIN_DEPLOYER_ABI, data });
  if (decoded.functionName !== 'launchProjectFor' || !decoded.args) {
    throw new Error('Project launch calldata is not recognized');
  }
  const args = decoded.args as readonly unknown[];
  if (args.length !== 6 && args.length !== 7) {
    throw new Error('Project launch overload is not recognized');
  }
  const owner = args[0] as Address;
  const projectUri = args[1] as string;
  requireNonzeroAddress(owner, 'Project owner');
  if (expectedOwner && owner.toLowerCase() !== expectedOwner.toLowerCase()) {
    throw new Error('Project owner must be the managed account');
  }
  requireIpfsUri(projectUri, 'Project metadata URI');

  let rulesets: readonly ManagedRulesetConfiguration[];
  let terminals: readonly ManagedTerminalConfiguration[];
  let suckerConfiguration: ManagedSuckerConfiguration;
  if (args.length === 7) {
    const deploy721 = args[2] as {
      deployTiersHookConfig: ManagedTiersHookConfiguration;
      salt: Hex;
    };
    if (deploy721.salt === ZERO_BYTES32) throw new Error('Tier hook salt cannot be zero');
    requireTiersHookConfiguration(chainId, deploy721.deployTiersHookConfig);
    const client = getPublicClient(chainId);
    for (const tier of deploy721.deployTiersHookConfig.tiersConfig.tiers) {
      for (const split of tier.splits) {
        await requireRecognizedRuntimeSplitHook({ client, hook: split.hook });
      }
    }
    rulesets = args[3] as readonly ManagedRulesetConfiguration[];
    terminals = args[4] as readonly ManagedTerminalConfiguration[];
    suckerConfiguration = args[6] as ManagedSuckerConfiguration;
  } else {
    rulesets = args[2] as readonly ManagedRulesetConfiguration[];
    terminals = args[3] as readonly ManagedTerminalConfiguration[];
    suckerConfiguration = args[5] as ManagedSuckerConfiguration;
  }
  const acceptedTokens = requireTerminalConfigurations(chainId, terminals);
  await requireRulesetConfigurations(chainId, rulesets, acceptedTokens);
  requireSuckerConfiguration(chainId, suckerConfiguration);
}

function requireRevnetLaunchCalldata(
  chainId: number,
  data: Hex,
  expectedOperator?: Address,
): void {
  const decoded = decodeFunctionData({ abi: REV_DEPLOYER_ABI, data });
  if (decoded.functionName !== 'deployFor' || !decoded.args) {
    throw new Error('Revnet launch calldata is not recognized');
  }
  const args = decoded.args as readonly unknown[];
  if (args.length !== 4 && args.length !== 6) {
    throw new Error('Revnet launch overload is not recognized');
  }
  if (asBigInt(args[0] as Numeric) !== 0n) {
    throw new Error('This flow only supports creating a new revnet');
  }
  const configuration = args[1] as ManagedRevnetConfiguration;
  requireRevnetConfiguration(configuration);
  if (expectedOperator && configuration.operator.toLowerCase() !== expectedOperator.toLowerCase()) {
    throw new Error('Revnet operator must be the managed account');
  }
  const contexts = args[2] as readonly ManagedAccountingContext[];
  if (contexts.length !== 1) {
    throw new Error('This revnet flow supports exactly one recognized accounting token');
  }
  const tokens = new Set<string>();
  contexts.forEach((context, index) => {
    requireAccountingContext(chainId, context, `accountingContexts[${index}]`);
    const token = context.token.toLowerCase();
    if (tokens.has(token)) throw new Error('Duplicate revnet accounting token');
    tokens.add(token);
  });
  const expectedBaseCurrency = contexts[0].token.toLowerCase() === NATIVE_TOKEN ? 1n : 2n;
  if (asBigInt(configuration.baseCurrency) !== expectedBaseCurrency) {
    throw new Error('Revnet base currency does not match its accounting token');
  }
  requireSuckerConfiguration(chainId, args[3] as ManagedSuckerConfiguration);
  if (args.length === 6) {
    const tieredConfiguration = args[4] as {
      baseline721HookConfiguration: ManagedTiersHookConfiguration;
      salt: Hex;
    };
    if (tieredConfiguration.salt === ZERO_BYTES32) throw new Error('Tier hook salt cannot be zero');
    requireTiersHookConfiguration(chainId, tieredConfiguration.baseline721HookConfiguration);
    const allowedPosts = args[5] as readonly unknown[];
    if (allowedPosts.length > 0) {
      throw new Error('Revnet post permissions are not supported in this flow');
    }
  }
}

function selectorOf(data: Hex): string {
  if (data.length < 10) throw new Error('Transaction calldata is missing a function selector');
  return data.slice(0, 10).toLowerCase();
}

function argsOf(data: Hex): Hex {
  return `0x${data.slice(10)}` as Hex;
}

function requirePositiveProjectId(projectId: bigint): bigint {
  if (projectId <= 0n) throw new Error('Invalid project ID');
  return projectId;
}

function requireZeroValue(value: bigint): void {
  if (value !== 0n) throw new Error('This operation must not send native currency');
}

function requireRecognizedAccountingToken(chainId: number, token: Address): void {
  const normalized = token.toLowerCase();
  if (
    normalized !== NATIVE_TOKEN &&
    normalized !== USDC_BY_CHAIN[chainId]?.toLowerCase()
  ) {
    throw new Error(`Accounting token not recognized: ${token}`);
  }
}

function tokenCurrency(token: Address): bigint {
  return BigInt(token) & 0xffff_ffffn;
}

async function requireControllerTarget(
  chainId: number,
  projectId: bigint,
  target: Address,
): Promise<void> {
  requirePositiveProjectId(projectId);
  if (target.toLowerCase() !== RECOGNIZED.controller.toLowerCase()) {
    throw new Error(`Controller not recognized: ${target}`);
  }
  const client = getPublicClient(chainId);
  const controller = await client.readContract({
    address: ROOTS.directory,
    abi: DIRECTORY_ABI,
    functionName: 'controllerOf',
    args: [projectId],
  });
  if (controller === zeroAddress) throw new Error('Project has no controller');
  if (controller.toLowerCase() !== RECOGNIZED.controller.toLowerCase()) {
    throw new Error(`Controller not recognized: ${controller}`);
  }
  if (target.toLowerCase() !== controller.toLowerCase()) {
    throw new Error('Transaction target is not the project controller');
  }
  await assertRecognizedProjectContracts(chainId, projectId);
}

async function requireTerminalTarget(params: {
  chainId: number;
  projectId: bigint;
  token: Address;
  target: Address;
  operation: 'pay' | 'accounting';
}): Promise<{ decimals: number; currency: bigint } | void> {
  requirePositiveProjectId(params.projectId);
  const recognized = params.operation === 'pay'
    ? [
      RECOGNIZED.multiTerminal,
      RECOGNIZED.routerTerminal,
      RECOGNIZED.routerTerminalRegistry,
    ]
    : [RECOGNIZED.multiTerminal];
  if (!recognized.some((address) => address.toLowerCase() === params.target.toLowerCase())) {
    throw new Error(`Terminal not recognized: ${params.target}`);
  }
  const client = getPublicClient(params.chainId);
  if (params.operation === 'accounting') {
    const terminals = await client.readContract({
      address: ROOTS.directory,
      abi: DIRECTORY_ABI,
      functionName: 'terminalsOf',
      args: [params.projectId],
    });
    if (terminals.length === 0) throw new Error('Project has no accounting terminal');
    for (const terminal of terminals) {
      await assertRecognizedPaymentRouteWithClient(client, params.projectId, terminal);
    }
    if (!terminals.some((terminal) => terminal.toLowerCase() === params.target.toLowerCase())) {
      throw new Error('Transaction target is not a listed project terminal');
    }
    const contexts = await client.readContract({
      address: params.target,
      abi: TERMINAL_ACCOUNTING_CONTEXTS_ABI,
      functionName: 'accountingContextsOf',
      args: [params.projectId],
    });
    const matching = contexts.filter(
      (context) => context.token.toLowerCase() === params.token.toLowerCase(),
    );
    if (matching.length !== 1) {
      throw new Error('The selected token is not a unique live accounting context');
    }
    const decimals = Number(matching[0].decimals);
    const currency = BigInt(matching[0].currency);
    if (
      !Number.isInteger(decimals) || decimals < 0 || decimals > 77 || currency < 0n ||
      currency > 0xffff_ffffn
    ) {
      throw new Error(`Accounting context not recognized: ${params.token}`);
    }
    return { decimals, currency };
  }

  const terminal = await client.readContract({
    address: ROOTS.directory,
    abi: DIRECTORY_ABI,
    functionName: 'primaryTerminalOf',
    args: [params.projectId, params.token],
  });
  if (terminal === zeroAddress) throw new Error('Project has no terminal for this token');
  if (params.target.toLowerCase() !== terminal.toLowerCase()) {
    throw new Error('Transaction target is not the project terminal');
  }
  await assertRecognizedPaymentRouteWithClient(client, params.projectId, params.target);
}

async function requireCurrentFundAccessConfiguration(params: {
  chainId: number;
  projectId: bigint;
  terminal: Address;
  token: Address;
  currency: bigint;
  accountingCurrency: bigint;
  accountingDecimals: number;
  kind: 'payout' | 'allowance';
}): Promise<void> {
  if (params.projectId > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Project ID exceeds the supported range');
  }
  const numericProjectId = Number(params.projectId);
  const currentRuleset = await fetchCurrentRuleset(params.chainId, numericProjectId);
  if (!currentRuleset) throw new Error('Current ruleset is unavailable');
  const configuration = await fetchSplits(
    params.chainId,
    numericProjectId,
    currentRuleset.ruleset.id,
  );

  const contexts = configuration.accountingContexts.filter((context) =>
    context.terminal.toLowerCase() === params.terminal.toLowerCase() &&
    context.token.toLowerCase() === params.token.toLowerCase()
  );
  if (contexts.length !== 1) {
    throw new Error('The selected accounting context is no longer uniquely configured');
  }
  if (
    !Number.isInteger(contexts[0].tokenDecimals) ||
    contexts[0].tokenDecimals < 0 ||
    contexts[0].tokenDecimals > 77 ||
    !Number.isInteger(contexts[0].currency) ||
    contexts[0].currency < 0 ||
    contexts[0].currency > 0xffff_ffff
  ) {
    throw new Error('The selected accounting context is not recognized');
  }
  if (
    BigInt(contexts[0].currency) !== params.accountingCurrency ||
    contexts[0].tokenDecimals !== params.accountingDecimals
  ) {
    throw new Error('The selected accounting context changed during transaction preparation');
  }

  const groups = configuration.fundAccessLimitGroups.filter((group) =>
    group.terminal?.toLowerCase() === params.terminal.toLowerCase() &&
    group.token?.toLowerCase() === params.token.toLowerCase()
  );
  if (groups.length !== 1) {
    throw new Error('The selected fund access configuration is no longer unique');
  }
  const limits = params.kind === 'payout' ? groups[0].payoutLimits : groups[0].surplusAllowances;
  if (limits.filter((limit) => BigInt(limit.currency) === params.currency).length !== 1) {
    throw new Error(`The selected ${params.kind} limit is no longer uniquely configured`);
  }

  if (params.kind === 'payout') {
    const groupId = BigInt(params.token).toString();
    const splitGroups = configuration.splitGroups.filter((group) => group.groupId === groupId);
    if (splitGroups.length > 1) throw new Error('The payout split group is no longer unique');
    if (splitGroups.length === 1) {
      requireSplitGroup(
        splitGroups[0].splits as unknown as readonly ManagedSplit[],
        'currentPayoutSplits',
      );
    }
  }
}

async function requireCurrentReservedTokenConfiguration(params: {
  chainId: number;
  projectId: bigint;
  controller: Address;
}): Promise<void> {
  if (params.projectId > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Project ID exceeds the supported range');
  }
  const numericProjectId = Number(params.projectId);
  const currentRuleset = await fetchCurrentRuleset(params.chainId, numericProjectId);
  if (!currentRuleset) throw new Error('Current ruleset is unavailable');
  const configuration = await fetchSplits(
    params.chainId,
    numericProjectId,
    currentRuleset.ruleset.id,
  );
  const reservedGroups = configuration.splitGroups.filter((group) => group.groupId === '1');
  if (reservedGroups.length > 1) throw new Error('Reserved split group is not uniquely configured');
  if (reservedGroups.length === 1) {
    requireSplitGroup(
      reservedGroups[0].splits as unknown as readonly ManagedSplit[],
      'currentReservedSplits',
    );
  }
  const pending = await getPublicClient(params.chainId).readContract({
    address: params.controller,
    abi: CONTROLLER_RESERVED_BALANCE_ABI,
    functionName: 'pendingReservedTokenBalanceOf',
    args: [params.projectId],
  });
  if (pending <= 0n) throw new Error('No reserved tokens are ready to distribute');
}

async function requireCurrentTiersHook(
  chainId: number,
  target: Address,
): Promise<void> {
  const client = getPublicClient(chainId);
  const [directory, projectId] = await Promise.all([
    client.readContract({
      address: target,
      abi: TIERS_HOOK_ABI,
      functionName: 'DIRECTORY',
    }),
    client.readContract({
      address: target,
      abi: TIERS_HOOK_ABI,
      functionName: 'projectId',
    }),
  ]);
  if (directory.toLowerCase() !== ROOTS.directory.toLowerCase()) {
    throw new Error(`Hook not recognized: ${target}`);
  }
  // requireControllerTarget reads controllerOf itself and requires it to equal
  // RECOGNIZED.controller, so passing the recognized controller as the target
  // accepts/rejects exactly the same set without a duplicate controllerOf read.
  await requireControllerTarget(chainId, projectId, RECOGNIZED.controller);
  await requireRecognizedProject721Hook({
    client,
    projectId,
    hook: target,
  });
}

async function requireCurrentTierDiscounts(
  chainId: number,
  hook: Address,
  configs: readonly ManagedTierDiscount[],
): Promise<void> {
  const client = getPublicClient(chainId);
  const store = await client.readContract({
    address: hook,
    abi: TIERS_HOOK_ABI,
    functionName: 'STORE',
  });
  if (store.toLowerCase() !== CONTRACTS.JB721TiersHookStore.toLowerCase()) {
    throw new Error(`721 tiers store not recognized: ${store}`);
  }

  const tiers = await Promise.all(configs.map((config) =>
    client.readContract({
      address: store,
      abi: TIERS_STORE_ABI,
      functionName: 'tierOf',
      args: [hook, asBigInt(config.tierId), false],
    })
  ));
  tiers.forEach((tier, index) => {
    const config = configs[index];
    const tierId = asBigInt(config.tierId);
    if (BigInt(tier.id) !== tierId) throw new Error(`Tier ${tierId} is not live`);
    if (
      tier.flags.cantIncreaseDiscountPercent &&
      asBigInt(config.discountPercent) > BigInt(tier.discountPercent)
    ) {
      throw new Error(`Tier ${tierId} has permanently locked discount increases`);
    }
  });
}

function splitFingerprint(split: ManagedSplit): string {
  return [
    asBigInt(split.percent),
    asBigInt(split.projectId),
    split.beneficiary.toLowerCase(),
    split.preferAddToBalance,
    asBigInt(split.lockedUntil),
    split.hook.toLowerCase(),
  ].join(':');
}

function requirePreservedSimpleSplitGroups(
  submitted: readonly ManagedRulesetConfiguration['splitGroups'][number][],
  current: Array<{
    groupId: string;
    splits: Array<{
      percent: number;
      projectId: number;
      beneficiary: string;
      preferAddToBalance: boolean;
      lockedUntil: number;
      hook: string;
    }>;
  }>,
): void {
  const currentNonEmpty = current.filter((group) => group.splits.length > 0);
  const currentById = new Map(currentNonEmpty.map((group) => [group.groupId, group]));
  const submittedById = new Map(
    submitted.map((group) => [asBigInt(group.groupId).toString(), group]),
  );
  if (submittedById.size !== submitted.length) throw new Error('Duplicate split group');
  if (submittedById.size !== currentById.size) {
    throw new Error('Queued ruleset must preserve the verified current split groups');
  }
  for (const [groupId, currentGroup] of currentById) {
    const submittedGroup = submittedById.get(groupId);
    if (!submittedGroup || submittedGroup.splits.length !== currentGroup.splits.length) {
      throw new Error('Queued ruleset must preserve the verified current split groups');
    }
    requireSplitGroup(
      currentGroup.splits as unknown as readonly ManagedSplit[],
      `currentSplitGroups[${groupId}]`,
    );
    requireSplitGroup(submittedGroup.splits, `splitGroups[${groupId}]`);
    for (let index = 0; index < currentGroup.splits.length; index++) {
      if (
        splitFingerprint(submittedGroup.splits[index]) !==
          splitFingerprint(currentGroup.splits[index] as unknown as ManagedSplit)
      ) {
        throw new Error('Queued ruleset must preserve the verified current split recipients');
      }
    }
  }
}

function requirePreservedQueueMetadata(params: {
  configuration: ManagedRulesetConfiguration;
  current: RulesetMetadata;
  approvalHook: string;
  dataHook: Address;
  useDataHookForPay: boolean;
  useDataHookForCashOut: boolean;
}): void {
  const { configuration, current } = params;
  if (configuration.approvalHook.toLowerCase() !== params.approvalHook.toLowerCase()) {
    throw new Error('Rule-change hook must be preserved by this flow');
  }
  if (
    configuration.metadata.dataHook.toLowerCase() !== params.dataHook.toLowerCase() ||
    configuration.metadata.useDataHookForPay !== params.useDataHookForPay ||
    configuration.metadata.useDataHookForCashOut !== params.useDataHookForCashOut
  ) {
    throw new Error('Data-hook routing must be preserved by this flow');
  }
  if (
    asBigInt(configuration.metadata.baseCurrency) !== BigInt(current.baseCurrency) ||
    configuration.metadata.pauseCreditTransfers !== current.pauseCreditTransfers ||
    configuration.metadata.allowSetCustomToken !== current.allowSetCustomToken ||
    configuration.metadata.allowTerminalMigration !== current.allowTerminalMigration ||
    configuration.metadata.allowSetTerminals !== current.allowSetTerminals ||
    configuration.metadata.allowSetController !== current.allowSetController ||
    configuration.metadata.allowAddAccountingContext !== current.allowAddAccountingContext ||
    configuration.metadata.allowAddPriceFeed !== current.allowAddPriceFeed ||
    configuration.metadata.holdFees !== current.holdFees ||
    configuration.metadata.scopeCashOutsToLocalBalances !== current.scopeCashOutsToLocalBalances ||
    asBigInt(configuration.metadata.metadata) !== BigInt(current.metadata)
  ) {
    throw new Error('Advanced ruleset settings must be preserved by this flow');
  }
}

function requireCreationTarget(
  target: Address,
  expectedTarget: Address,
): void {
  if (target.toLowerCase() !== expectedTarget.toLowerCase()) {
    throw new Error(`Deployment contract not recognized: ${target}`);
  }
}

async function requireCreationFee(chainId: number, value: bigint): Promise<void> {
  const fee = await getPublicClient(chainId).readContract({
    address: ROOTS.projects,
    abi: PROJECTS_ABI,
    functionName: 'creationFee',
  });
  if (value !== fee) throw new Error('Project creation fee changed; refresh before continuing');
}

/**
 * Validate every live accounting context on a project before trusting it.
 * Shared by the queue-rulesets and set-split-groups policy branches.
 */
function requireLiveAccountingContexts(
  chainId: number,
  contexts: Awaited<ReturnType<typeof fetchSplits>>['accountingContexts'],
): void {
  contexts.forEach((context, index) => {
    requireAccountingContext(chainId, {
      token: context.token,
      decimals: context.tokenDecimals,
      currency: context.currency,
    }, `accountingContexts[${index}]`);
  });
}

/**
 * Verify every non-noop hook specification returned by a terminal preview.
 * Shared by the pay and cash-out policy branches.
 */
async function requireRecognizedPreviewHookSpecifications(
  client: ReturnType<typeof getPublicClient>,
  projectId: bigint,
  rulesetId: bigint,
  specifications: readonly { noop: boolean; hook: Address }[],
): Promise<void> {
  for (const specification of specifications) {
    if (!specification.noop) {
      await requireRecognizedRuntimeHook({
        client,
        projectId,
        rulesetId,
        hook: specification.hook,
      });
    }
  }
}

export async function assertManagedTransactionAllowed(params: {
  chainId: number;
  to: Address;
  data: Hex;
  value: bigint;
  expectedAccount?: Address;
}): Promise<void> {
  const selector = selectorOf(params.data);
  const encodedArgs = argsOf(params.data);

  if (selector === SELECTORS.pay) {
    const [projectId, token, amount, beneficiary, minReturnedTokens, , metadata] =
      decodeAbiParameters([
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'string' },
        { type: 'bytes' },
      ], encodedArgs);
    if (amount <= 0n) throw new Error('Payment amount must be greater than zero');
    requireRecognizedAccountingToken(params.chainId, token);
    const nativePayment = token.toLowerCase() === NATIVE_TOKEN;
    if (!nativePayment) {
      throw new Error('Managed onchain payments currently support the native token only');
    }
    if ((nativePayment && params.value !== amount) || (!nativePayment && params.value !== 0n)) {
      throw new Error('Payment value does not match the selected token amount');
    }
    if (
      params.expectedAccount && beneficiary.toLowerCase() !== params.expectedAccount.toLowerCase()
    ) {
      throw new Error('Payment beneficiary must be the managed account');
    }
    await requireTerminalTarget({
      ...params,
      projectId,
      token,
      operation: 'pay',
      target: params.to,
    });
    await requireRecognizedProjectPayConfiguration({
      client: getPublicClient(params.chainId),
      projectId,
    });
    const client = getPublicClient(params.chainId);
    const preview = await client.readContract({
      account: params.expectedAccount ?? beneficiary,
      address: params.to,
      abi: TERMINAL_PREVIEW_ABI,
      functionName: 'previewPayFor',
      args: [projectId, token, amount, beneficiary, metadata],
    });
    await requireRecognizedPreviewHookSpecifications(
      client,
      projectId,
      BigInt(preview[0].id),
      preview[3],
    );
    const previewOutcome = resolvePayPreviewOutcome({
      beneficiaryTokenCount: preview[1],
      reservedTokenCount: preview[2],
      hookSpecifications: preview[3],
    });
    if (previewOutcome.beneficiaryTokenCount <= 0n) {
      throw new Error('The payment quote returns no project tokens');
    }
    if (
      minReturnedTokens < previewOutcome.minReturnedTokens ||
      minReturnedTokens > previewOutcome.beneficiaryTokenCount
    ) {
      throw new Error('Minimum project tokens returned is not safe');
    }
    return;
  }

  if (selector === SELECTORS.addToBalance) {
    const [projectId, token, amount, shouldReturnHeldFees, , metadata] = decodeAbiParameters([
      { type: 'uint256' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'bool' },
      { type: 'string' },
      { type: 'bytes' },
    ], encodedArgs);
    if (amount <= 0n) throw new Error('Balance contribution must be greater than zero');
    requireRecognizedAccountingToken(params.chainId, token);
    if (token.toLowerCase() !== NATIVE_TOKEN) {
      throw new Error('Managed balance contributions currently support the native token only');
    }
    if (params.value !== amount) throw new Error('Balance contribution value is incorrect');
    if (shouldReturnHeldFees) {
      throw new Error('Returning held fees is not supported in this contribution flow');
    }
    if (metadata !== '0x') throw new Error('Balance contribution metadata is not supported');
    await requireTerminalTarget({
      ...params,
      projectId,
      token,
      operation: 'accounting',
      target: params.to,
    });
    return;
  }

  if (selector === SELECTORS.cashOut) {
    requireZeroValue(params.value);
    const [holder, projectId, cashOutCount, token, minTokensReclaimed, beneficiary, metadata] =
      decodeAbiParameters([
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes' },
      ], encodedArgs);
    if (cashOutCount <= 0n) throw new Error('Cash out amount must be greater than zero');
    if (
      params.expectedAccount &&
      (holder.toLowerCase() !== params.expectedAccount.toLowerCase() ||
        beneficiary.toLowerCase() !== params.expectedAccount.toLowerCase())
    ) {
      throw new Error('Cash out holder and beneficiary must be the managed account');
    }
    requireRecognizedAccountingToken(params.chainId, token);
    await requireTerminalTarget({
      ...params,
      projectId,
      token,
      operation: 'accounting',
      target: params.to,
    });
    await requireRecognizedProjectCashOutConfiguration({
      client: getPublicClient(params.chainId),
      projectId,
    });
    const client = getPublicClient(params.chainId);
    const [preview, feeFreeSurplus, beneficiaryIsFeeless] = await Promise.all([
      client.readContract({
        account: params.expectedAccount ?? holder,
        address: params.to,
        abi: TERMINAL_PREVIEW_ABI,
        functionName: 'previewCashOutFrom',
        args: [holder, projectId, cashOutCount, token, beneficiary, metadata],
      }),
      client.readContract({
        address: params.to,
        abi: FEE_FREE_SURPLUS_ABI,
        functionName: 'feeFreeSurplusOf',
        args: [projectId, token],
      }),
      client.readContract({
        address: CONTRACTS.JBFeelessAddresses as Address,
        abi: FEELESS_ADDRESSES_ABI,
        functionName: 'isFeelessFor',
        args: [beneficiary, projectId, params.expectedAccount ?? holder],
      }),
    ]);
    await requireRecognizedPreviewHookSpecifications(
      client,
      projectId,
      BigInt(preview[0].id),
      preview[3],
    );
    const previewOutcome = resolveCashOutPreviewOutcome({
      reclaimAmount: preview[1],
      cashOutTaxRate: preview[2],
      hookSpecifications: preview[3],
      beneficiaryIsFeeless,
      feeFreeSurplus,
    });
    if (previewOutcome.expectedReturn <= 0n || previewOutcome.minimumReturn <= 0n) {
      throw new Error('No funds are currently reclaimable');
    }
    if (metadata.toLowerCase() !== previewOutcome.metadata.toLowerCase()) {
      throw new Error('Cash out route metadata is not the current protected quote');
    }
    if (
      minTokensReclaimed !== previewOutcome.terminalMinimum ||
      (previewOutcome.route === 'treasury' && minTokensReclaimed > previewOutcome.expectedReturn)
    ) {
      throw new Error('Minimum cash out return is not safe');
    }
    return;
  }

  if (selector === SELECTORS.sendPayouts || selector === SELECTORS.useAllowance) {
    requireZeroValue(params.value);
    const commonParameters = [
      { type: 'uint256' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
    ] as const;
    const [projectId, token, amount, currency, minTokensPaidOut] = decodeAbiParameters(
      commonParameters,
      encodedArgs,
    );
    if (amount <= 0n) throw new Error('Transaction amount must be greater than zero');
    if (minTokensPaidOut <= 0n) throw new Error('Minimum tokens paid out must be nonzero');

    let beneficiary: Address | undefined;
    let feeBeneficiary: Address | undefined;
    let memo = '';
    if (selector === SELECTORS.useAllowance) {
      const decoded = decodeAbiParameters([
        ...commonParameters,
        { type: 'address' },
        { type: 'address' },
        { type: 'string' },
      ], encodedArgs);
      beneficiary = decoded[5];
      feeBeneficiary = decoded[6];
      memo = decoded[7];
      if (
        params.expectedAccount &&
        (beneficiary.toLowerCase() !== params.expectedAccount.toLowerCase() ||
          feeBeneficiary.toLowerCase() !== params.expectedAccount.toLowerCase())
      ) {
        throw new Error('Allowance beneficiaries must be the managed account');
      }
      if (memo !== '') throw new Error('Allowance memos are not supported in this flow');
    }
    const context = await requireTerminalTarget({
      ...params,
      projectId,
      token,
      operation: 'accounting',
      target: params.to,
    });
    if (!context) throw new Error('Accounting context is unavailable');
    await requireCurrentFundAccessConfiguration({
      chainId: params.chainId,
      projectId,
      terminal: params.to,
      token,
      currency,
      accountingCurrency: context.currency,
      accountingDecimals: context.decimals,
      kind: selector === SELECTORS.sendPayouts ? 'payout' : 'allowance',
    });
    const client = getPublicClient(params.chainId);
    const account = params.expectedAccount ?? zeroAddress;
    const quotedAmount = selector === SELECTORS.sendPayouts
      ? (await client.simulateContract({
        account,
        address: params.to,
        abi: MANAGED_FUND_ACCESS_ABI,
        functionName: 'sendPayoutsOf',
        args: [projectId, token, amount, currency, 0n],
      })).result
      : (await client.simulateContract({
        account,
        address: params.to,
        abi: MANAGED_FUND_ACCESS_ABI,
        functionName: 'useAllowanceOf',
        args: [
          projectId,
          token,
          amount,
          currency,
          0n,
          beneficiary!,
          feeBeneficiary!,
          memo,
        ],
      })).result;
    if (quotedAmount <= 0n) throw new Error('Fund access simulation returned zero tokens');
    const requiredMinimum = protectedManagedFundAccessMinimum(
      quotedAmount,
      currency,
      context.currency,
    );
    if (minTokensPaidOut < requiredMinimum || minTokensPaidOut > quotedAmount) {
      throw new Error('Minimum tokens paid out is not protected by the current live simulation');
    }
    return;
  }

  if (selector === SELECTORS.queueRulesets) {
    requireZeroValue(params.value);
    const normalizedTarget = params.to.toLowerCase();
    if (
      normalizedTarget !== RECOGNIZED.controller.toLowerCase() &&
      normalizedTarget !== RECOGNIZED.omnichainDeployer.toLowerCase()
    ) {
      throw new Error(`Ruleset queue target not recognized: ${params.to}`);
    }
    const [projectId, configurations, memo] = decodeAbiParameters([
      { type: 'uint256' },
      RULESET_CONFIGURATIONS_PARAMETER,
      { type: 'string' },
    ], encodedArgs);
    requirePositiveProjectId(projectId);
    if (projectId > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Project ID exceeds the supported range');
    }
    if (configurations.length !== 1) throw new Error('This flow queues exactly one ruleset');
    if (memo.length > 280) throw new Error('Ruleset memo is too long');

    const client = getPublicClient(params.chainId);
    await requireControllerTarget(
      params.chainId,
      projectId,
      normalizedTarget === RECOGNIZED.controller.toLowerCase() ? params.to : RECOGNIZED.controller,
    );
    const currentRuleset = await fetchCurrentRuleset(params.chainId, Number(projectId));
    if (!currentRuleset) throw new Error('Current ruleset is unavailable');
    const currentRulesetId = BigInt(currentRuleset.ruleset.id);
    const currentDataHook = currentRuleset.metadata.dataHook.toLowerCase();
    if (currentDataHook === RECOGNIZED.revOwner.toLowerCase()) {
      throw new Error('Revnet rules cannot be changed through this ruleset editor');
    }

    let expectedDataHook = currentRuleset.metadata.dataHook as Address;
    let expectedUseDataHookForPay = currentRuleset.metadata.useDataHookForPay;
    let expectedUseDataHookForCashOut = currentRuleset.metadata.useDataHookForCashOut;
    if (normalizedTarget === RECOGNIZED.omnichainDeployer.toLowerCase()) {
      if (currentDataHook !== normalizedTarget) {
        throw new Error('The recognized omnichain deployer is not the project current queue route');
      }
      if (!expectedUseDataHookForPay || !expectedUseDataHookForCashOut) {
        throw new Error('Omnichain hook configuration is incomplete');
      }
      await requireRecognizedRuntimeHook({
        client,
        projectId,
        rulesetId: currentRulesetId,
        hook: params.to,
      });
      const [extra, tiered] = await Promise.all([
        client.readContract({
          address: params.to,
          abi: JB_OMNICHAIN_DEPLOYER_ABI,
          functionName: 'extraDataHookOf',
          args: [projectId, currentRulesetId],
        }),
        client.readContract({
          address: params.to,
          abi: JB_OMNICHAIN_DEPLOYER_ABI,
          functionName: 'tiered721HookOf',
          args: [projectId, currentRulesetId],
        }),
      ]);
      if (tiered[0].toLowerCase() === zeroAddress) {
        throw new Error('Omnichain 721 hook configuration is incomplete');
      }
      await requireRecognizedProject721Hook({ client, projectId, hook: tiered[0] });
      expectedDataHook = extra.dataHook;
      expectedUseDataHookForPay = extra.useDataHookForPay;
      expectedUseDataHookForCashOut = extra.useDataHookForCashOut;
    } else {
      if (currentDataHook === RECOGNIZED.omnichainDeployer.toLowerCase()) {
        throw new Error(
          'Omnichain projects must queue through their recognized live data-hook route',
        );
      }
      await requireRecognizedRuntimeHook({
        client,
        projectId,
        rulesetId: currentRulesetId,
        hook: expectedDataHook,
      });
    }

    const currentConfiguration = await fetchSplits(
      params.chainId,
      Number(projectId),
      currentRuleset.ruleset.id,
    );
    requireLiveAccountingContexts(params.chainId, currentConfiguration.accountingContexts);
    const acceptedTokens = new Set(
      currentConfiguration.accountingContexts.map((context) => context.token.toLowerCase()),
    );
    await requireRulesetConfigurations(params.chainId, configurations, acceptedTokens);
    const configuration = configurations[0];
    if (asBigInt(configuration.mustStartAtOrAfter) < BigInt(Math.floor(Date.now() / 1000))) {
      throw new Error('Ruleset start time has passed; refresh before continuing');
    }
    requirePreservedQueueMetadata({
      configuration,
      current: currentRuleset.metadata,
      approvalHook: currentRuleset.ruleset.approvalHook ?? zeroAddress,
      dataHook: expectedDataHook,
      useDataHookForPay: expectedUseDataHookForPay,
      useDataHookForCashOut: expectedUseDataHookForCashOut,
    });
    requirePreservedSimpleSplitGroups(configuration.splitGroups, currentConfiguration.splitGroups);
    return;
  }

  if (selector === SELECTORS.setSplitGroups) {
    requireZeroValue(params.value);
    const [projectId, rulesetId, splitGroups] = decodeAbiParameters([
      { type: 'uint256' },
      { type: 'uint256' },
      SPLIT_GROUPS_PARAMETER,
    ], encodedArgs);

    if (splitGroups.length !== 2) {
      throw new Error('This flow requires one payout group and one reserved-token group');
    }
    const submittedGroups = new Map<string, typeof splitGroups[number]>();
    for (const group of splitGroups) {
      const groupId = asBigInt(group.groupId).toString();
      if (submittedGroups.has(groupId)) throw new Error('Duplicate split group');
      submittedGroups.set(groupId, group);
      requireProjectSplitGroup(group.splits, `splitGroups[${groupId}]`, {
        kind: asBigInt(group.groupId) === 1n ? 'reserved' : 'payout',
        sourceProjectId: projectId,
      });
    }
    if (!submittedGroups.has('1')) throw new Error('Reserved-token split group is missing');
    const payoutGroups = splitGroups.filter((group) => asBigInt(group.groupId) !== 1n);
    if (payoutGroups.length !== 1) throw new Error('Payout split group is ambiguous');

    await requireControllerTarget(params.chainId, projectId, params.to);
    if (projectId > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Project ID exceeds the supported range');
    }
    const currentRuleset = await fetchCurrentRuleset(params.chainId, Number(projectId));
    if (!currentRuleset || BigInt(currentRuleset.ruleset.id) !== rulesetId) {
      throw new Error('Ruleset changed; refresh before changing payout recipients');
    }

    const currentConfiguration = await fetchSplits(
      params.chainId,
      Number(projectId),
      currentRuleset.ruleset.id,
    );
    requireLiveAccountingContexts(params.chainId, currentConfiguration.accountingContexts);
    const acceptedPayoutGroups = new Set(
      currentConfiguration.accountingContexts.map((context) => BigInt(context.token).toString()),
    );
    const payoutGroupId = asBigInt(payoutGroups[0].groupId).toString();
    if (!acceptedPayoutGroups.has(payoutGroupId)) {
      throw new Error('Payout split group is not tied to a recognized live accounting token');
    }

    const client = getPublicClient(params.chainId);

    for (const group of splitGroups) {
      const groupId = asBigInt(group.groupId).toString();
      const currentGroups = currentConfiguration.splitGroups.filter(
        (candidate) => candidate.groupId === groupId,
      );
      if (currentGroups.length !== 1) {
        throw new Error(`Current split group is not uniquely configured: ${groupId}`);
      }
      const kind = asBigInt(group.groupId) === 1n ? 'reserved' : 'payout';
      requireProjectSplitGroup(
        currentGroups[0].splits as unknown as readonly ManagedSplit[],
        `currentSplitGroups[${groupId}]`,
        { kind, sourceProjectId: projectId },
      );
      requireExplicitBeneficiariesForNewProjectRoutes({
        submitted: group.splits,
        current: currentGroups[0].splits as unknown as readonly ManagedSplit[],
        kind,
        field: `splitGroups[${groupId}]`,
      });
      for (const split of group.splits) {
        await requireRecognizedRuntimeSplitHook({ client, hook: split.hook });
      }
      if (currentGroups[0].splits.length > 0 && group.splits.length === 0) {
        throw new Error(
          'Clearing effective splits is ambiguous because default splits may remain active',
        );
      }
    }
    return;
  }

  if (selector === SELECTORS.deployErc20) {
    requireZeroValue(params.value);
    const [projectId, name, symbol, salt] = decodeAbiParameters([
      { type: 'uint256' },
      { type: 'string' },
      { type: 'string' },
      { type: 'bytes32' },
    ], encodedArgs);
    requireErc20Metadata(name, symbol, salt);
    await requireControllerTarget(params.chainId, projectId, params.to);
    return;
  }

  if (selector === SELECTORS.sendReserved) {
    requireZeroValue(params.value);
    const [projectId] = decodeAbiParameters([{ type: 'uint256' }], encodedArgs);
    await requireControllerTarget(params.chainId, projectId, params.to);
    await requireCurrentReservedTokenConfiguration({
      chainId: params.chainId,
      projectId,
      controller: params.to,
    });
    return;
  }

  if (selector === SELECTORS.setUri) {
    requireZeroValue(params.value);
    const [projectId, uri] = decodeAbiParameters([
      { type: 'uint256' },
      { type: 'string' },
    ], encodedArgs);
    requireIpfsUri(uri, 'Project metadata URI');
    await requireControllerTarget(params.chainId, projectId, params.to);
    return;
  }

  if (selector === SELECTORS.adjustTiers) {
    requireZeroValue(params.value);
    const [tiersToAdd, tierIdsToRemove] = decodeAbiParameters([
      { name: 'tiersToAdd', type: 'tuple[]', components: TIER_CONFIG_COMPONENTS },
      { name: 'tierIdsToRemove', type: 'uint256[]' },
    ], encodedArgs);
    requireSafeTierAdjustments(tiersToAdd, tierIdsToRemove);
    await requireCurrentTiersHook(params.chainId, params.to);
    return;
  }

  if (selector === SELECTORS.setTierDiscounts) {
    requireZeroValue(params.value);
    const [configs] = decodeAbiParameters([{
      name: 'configs',
      type: 'tuple[]',
      components: [
        { name: 'tierId', type: 'uint32' },
        { name: 'discountPercent', type: 'uint16' },
      ],
    }], encodedArgs);
    requireSafeTierDiscounts(configs);
    await requireCurrentTiersHook(params.chainId, params.to);
    await requireCurrentTierDiscounts(params.chainId, params.to, configs);
    return;
  }

  if (selector === SELECTORS.launchProject || selector === SELECTORS.launchProjectWithTiers) {
    requireCreationTarget(params.to, RECOGNIZED.omnichainDeployer);
    await requireOmnichainLaunchCalldata(params.chainId, params.data, params.expectedAccount);
    await requireCreationFee(params.chainId, params.value);
    return;
  }

  if (selector === SELECTORS.deployRevnet || selector === SELECTORS.deployRevnetWithTiers) {
    requireCreationTarget(params.to, RECOGNIZED.revDeployer);
    requireRevnetLaunchCalldata(params.chainId, params.data, params.expectedAccount);
    await requireCreationFee(params.chainId, params.value);
    return;
  }

  throw new Error(`Transaction function not supported: ${selector}`);
}
