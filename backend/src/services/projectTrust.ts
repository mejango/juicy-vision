import { type Address, type PublicClient, zeroAddress } from 'viem';
import { CONTRACTS } from '@shared/chains.ts';
import {
  requireRecognized721CloneIdentity,
  requireRecognizedLpSplitHookClone,
} from './addressRegistry.ts';

const ROOTS = {
  directory: CONTRACTS.JBDirectory as Address,
  projects: CONTRACTS.JBProjects as Address,
};

const RECOGNIZED = {
  controller: CONTRACTS.JBController as Address,
  revOwner: CONTRACTS.REVOwner as Address,
  revDeployer: CONTRACTS.REVDeployer as Address,
  omnichainDeployer: CONTRACTS.JBOmnichainDeployer as Address,
  ctDeployer: CONTRACTS.CTDeployer as Address,
  suckerRegistry: CONTRACTS.JBSuckerRegistry as Address,
};

const DIRECTORY_ABI = [{
  name: 'controllerOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

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

const CONTROLLER_ABI = [{
  name: 'currentRulesetOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [
    { name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS },
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
}] as const;

const RECOGNIZED_RUNTIME_HOOKS = new Set([
  CONTRACTS.JBBuybackHook.toLowerCase(),
]);

const RECOGNIZED_CONFIGURED_HOOKS = new Set([
  CONTRACTS.JBBuybackHook.toLowerCase(),
  CONTRACTS.JBBuybackHookRegistry.toLowerCase(),
  CONTRACTS.CTDeployer.toLowerCase(),
]);

const BUYBACK_HOOK = CONTRACTS.JBBuybackHook as Address;
const BUYBACK_HOOK_REGISTRY = CONTRACTS.JBBuybackHookRegistry as Address;

const RECOGNIZED_APPROVAL_HOOKS = new Set([
  '0xd25264015483caa5c34643942d41f94bed5f1e92',
  '0x3a15ac0bcf4f7dd48359a36b3e293254cf26d4ca',
  '0xcda708c98fbdd15a7ff7f0c5c50f9371ca52c78f',
  '0x540923f7b6166bf9713490719a2210aeebc9fca2',
]);

const RECOGNIZED_SPLIT_HOOKS = new Set([
  '0xae6705c33c8b46f56878a1d4f1ce4d75fcfb6f62',
]);

const PROJECTS_ABI = [{
  name: 'ownerOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const REV_OWNER_ABI = [{
  name: 'deployer',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const OMNICHAIN_DEPLOYER_ABI = [{
  name: 'extraDataHookOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'rulesetId', type: 'uint256' },
  ],
  outputs: [{
    name: '',
    type: 'tuple',
    components: [
      { name: 'dataHook', type: 'address' },
      { name: 'useDataHookForPay', type: 'bool' },
      { name: 'useDataHookForCashOut', type: 'bool' },
    ],
  }],
}] as const;

const OMNICHAIN_TIERED_HOOK_ABI = [{
  name: 'tiered721HookOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'rulesetId', type: 'uint256' },
  ],
  outputs: [
    { name: 'hook', type: 'address' },
    { name: 'useDataHookForCashOut', type: 'bool' },
  ],
}] as const;

const REV_OWNER_TIERED_HOOK_ABI = [{
  name: 'tiered721HookOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'revnetId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const CT_DEPLOYER_ABI = [{
  name: 'dataHookOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const BUYBACK_REGISTRY_ABI = [{
  name: 'hookOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const SUCKER_REGISTRY_GETTER_ABI = [{
  name: 'SUCKER_REGISTRY',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const SUCKER_REGISTRY_ROOTS_ABI = [
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
] as const;

const RECOGNIZED_BRIDGE_HOOKS = new Set([
  RECOGNIZED.revOwner.toLowerCase(),
  RECOGNIZED.omnichainDeployer.toLowerCase(),
  RECOGNIZED.ctDeployer.toLowerCase(),
]);

async function requireRecognized721Hook(params: {
  client: Pick<PublicClient, 'readContract'>;
  hook: Address;
  expectedProjectId?: bigint;
}): Promise<void> {
  await requireRecognized721CloneIdentity({
    client: params.client,
    hook: params.hook,
    expectedProjectId: params.expectedProjectId,
  });
}

export function requireRecognizedApprovalHook(hook: Address): void {
  if (hook.toLowerCase() === zeroAddress) return;
  if (!RECOGNIZED_APPROVAL_HOOKS.has(hook.toLowerCase())) {
    throw new Error(`Rule-change hook not recognized: ${hook}`);
  }
}

export function requireRecognizedSplitHook(hook: Address): void {
  if (hook.toLowerCase() === zeroAddress) return;
  if (!RECOGNIZED_SPLIT_HOOKS.has(hook.toLowerCase())) {
    throw new Error(`Split hook not recognized: ${hook}`);
  }
}

export async function requireRecognizedRuntimeSplitHook(params: {
  client: Pick<PublicClient, 'readContract'>;
  hook: Address;
}): Promise<void> {
  if (
    params.hook.toLowerCase() === zeroAddress ||
    RECOGNIZED_SPLIT_HOOKS.has(params.hook.toLowerCase())
  ) return;
  await requireRecognizedLpSplitHookClone(params.client, params.hook);
}

export async function requireRecognizedConfiguredDataHook(params: {
  client: Pick<PublicClient, 'readContract'>;
  hook: Address;
}): Promise<void> {
  const normalized = params.hook.toLowerCase();
  if (normalized === zeroAddress || RECOGNIZED_CONFIGURED_HOOKS.has(normalized)) return;
  if (
    normalized === RECOGNIZED.revOwner.toLowerCase() ||
    normalized === RECOGNIZED.omnichainDeployer.toLowerCase()
  ) return;
  await requireRecognized721Hook(params);
}

export async function requireRecognizedRuntimeHook(params: {
  client: Pick<PublicClient, 'readContract'>;
  projectId: bigint;
  rulesetId: bigint;
  hook: Address;
  depth?: number;
}): Promise<void> {
  if (params.hook.toLowerCase() === zeroAddress) return;
  const normalized = params.hook.toLowerCase();
  if (RECOGNIZED_RUNTIME_HOOKS.has(normalized)) return;

  if (normalized === BUYBACK_HOOK_REGISTRY.toLowerCase()) {
    const resolvedHook = await params.client.readContract({
      address: params.hook,
      abi: BUYBACK_REGISTRY_ABI,
      functionName: 'hookOf',
      args: [params.projectId],
    });
    if (resolvedHook.toLowerCase() !== BUYBACK_HOOK.toLowerCase()) {
      throw new Error(`Buyback hook not recognized: ${resolvedHook}`);
    }
    return;
  }

  if (normalized === RECOGNIZED.ctDeployer.toLowerCase()) {
    const resolvedHook = await params.client.readContract({
      address: params.hook,
      abi: CT_DEPLOYER_ABI,
      functionName: 'dataHookOf',
      args: [params.projectId],
    });
    if (resolvedHook.toLowerCase() === zeroAddress) {
      throw new Error('Croptop data hook configuration is incomplete');
    }
    await requireRecognized721Hook({
      client: params.client,
      hook: resolvedHook,
      expectedProjectId: params.projectId,
    });
    return;
  }

  if (normalized === RECOGNIZED.revOwner.toLowerCase()) {
    const [owner, deployer] = await Promise.all([
      params.client.readContract({
        address: ROOTS.projects,
        abi: PROJECTS_ABI,
        functionName: 'ownerOf',
        args: [params.projectId],
      }),
      params.client.readContract({
        address: params.hook,
        abi: REV_OWNER_ABI,
        functionName: 'deployer',
      }),
    ]);
    if (
      owner.toLowerCase() !== normalized ||
      deployer.toLowerCase() !== RECOGNIZED.revDeployer.toLowerCase()
    ) {
      throw new Error(`Hook not recognized: ${params.hook}`);
    }
    return;
  }

  if (normalized === RECOGNIZED.omnichainDeployer.toLowerCase()) {
    if ((params.depth ?? 0) > 0) throw new Error(`Hook not recognized: ${params.hook}`);
    const extra = await params.client.readContract({
      address: params.hook,
      abi: OMNICHAIN_DEPLOYER_ABI,
      functionName: 'extraDataHookOf',
      args: [params.projectId, params.rulesetId],
    });
    if (
      !extra.useDataHookForPay && !extra.useDataHookForCashOut && extra.dataHook === zeroAddress
    ) return;
    if (extra.dataHook === zeroAddress) {
      throw new Error('Omnichain hook configuration is incomplete');
    }
    await requireRecognizedRuntimeHook({ ...params, hook: extra.dataHook, depth: 1 });
    return;
  }

  await requireRecognized721Hook({
    client: params.client,
    hook: params.hook,
    expectedProjectId: params.projectId,
  });
}

/**
 * Derive a project's sucker registry from its current recognized data hook.
 * The registry address is never used as a routing fallback: its known address
 * is only a trust check after live project discovery, and its roots must match
 * JBDirectory and JBProjects.
 */
export async function resolveRecognizedSuckerRegistry(params: {
  client: Pick<PublicClient, 'readContract'>;
  projectId: bigint;
}): Promise<Address> {
  if (params.projectId <= 0n) throw new Error('Project ID must be greater than zero');

  const controller = await params.client.readContract({
    address: ROOTS.directory,
    abi: DIRECTORY_ABI,
    functionName: 'controllerOf',
    args: [params.projectId],
  });
  if (controller.toLowerCase() !== RECOGNIZED.controller.toLowerCase()) {
    throw new Error(`Controller not recognized: ${controller}`);
  }

  const [ruleset, metadata] = await params.client.readContract({
    address: controller,
    abi: CONTROLLER_ABI,
    functionName: 'currentRulesetOf',
    args: [params.projectId],
  });
  const rulesetId = BigInt(ruleset.id);
  if (rulesetId === 0n) throw new Error('Current ruleset unavailable');

  const bridgeHook = metadata.dataHook as Address;
  if (!RECOGNIZED_BRIDGE_HOOKS.has(bridgeHook.toLowerCase())) {
    throw new Error(`Project bridge hook not recognized: ${bridgeHook}`);
  }
  await requireRecognizedRuntimeHook({
    client: params.client,
    projectId: params.projectId,
    rulesetId,
    hook: bridgeHook,
  });

  const registry = await params.client.readContract({
    address: bridgeHook,
    abi: SUCKER_REGISTRY_GETTER_ABI,
    functionName: 'SUCKER_REGISTRY',
  });
  if (registry.toLowerCase() !== RECOGNIZED.suckerRegistry.toLowerCase()) {
    throw new Error(`Sucker registry not recognized: ${registry}`);
  }

  const [directory, projects] = await Promise.all([
    params.client.readContract({
      address: registry,
      abi: SUCKER_REGISTRY_ROOTS_ABI,
      functionName: 'DIRECTORY',
    }),
    params.client.readContract({
      address: registry,
      abi: SUCKER_REGISTRY_ROOTS_ABI,
      functionName: 'PROJECTS',
    }),
  ]);
  if (
    directory.toLowerCase() !== ROOTS.directory.toLowerCase() ||
    projects.toLowerCase() !== ROOTS.projects.toLowerCase()
  ) {
    throw new Error(`Sucker registry not recognized: ${registry}`);
  }

  return registry;
}

export async function requireRecognizedProject721Hook(params: {
  client: Pick<PublicClient, 'readContract'>;
  projectId: bigint;
  hook: Address;
}): Promise<void> {
  const controller = await params.client.readContract({
    address: ROOTS.directory,
    abi: DIRECTORY_ABI,
    functionName: 'controllerOf',
    args: [params.projectId],
  });
  if (controller.toLowerCase() !== RECOGNIZED.controller.toLowerCase()) {
    throw new Error(`Controller not recognized: ${controller}`);
  }
  const [ruleset, metadata] = await params.client.readContract({
    address: controller,
    abi: CONTROLLER_ABI,
    functionName: 'currentRulesetOf',
    args: [params.projectId],
  });
  const dataHook = metadata.dataHook.toLowerCase();
  let expectedHook: Address | undefined;
  if (metadata.useDataHookForPay && dataHook === params.hook.toLowerCase()) {
    expectedHook = metadata.dataHook;
  } else if (dataHook === RECOGNIZED.omnichainDeployer.toLowerCase()) {
    [expectedHook] = await params.client.readContract({
      address: RECOGNIZED.omnichainDeployer,
      abi: OMNICHAIN_TIERED_HOOK_ABI,
      functionName: 'tiered721HookOf',
      args: [params.projectId, BigInt(ruleset.id)],
    });
  } else if (dataHook === RECOGNIZED.revOwner.toLowerCase()) {
    expectedHook = await params.client.readContract({
      address: RECOGNIZED.revOwner,
      abi: REV_OWNER_TIERED_HOOK_ABI,
      functionName: 'tiered721HookOf',
      args: [params.projectId],
    });
  }
  if (!expectedHook || expectedHook.toLowerCase() !== params.hook.toLowerCase()) {
    throw new Error(`Hook is not the project's current recognized 721 hook: ${params.hook}`);
  }
  await requireRecognized721Hook({
    client: params.client,
    hook: params.hook,
    expectedProjectId: params.projectId,
  });
}

async function requireRecognizedProjectRuntimeConfiguration(params: {
  client: Pick<PublicClient, 'readContract'>;
  projectId: bigint;
  operation: 'pay' | 'cashOut';
}): Promise<bigint> {
  const controller = await params.client.readContract({
    address: ROOTS.directory,
    abi: DIRECTORY_ABI,
    functionName: 'controllerOf',
    args: [params.projectId],
  });
  if (controller.toLowerCase() !== RECOGNIZED.controller.toLowerCase()) {
    throw new Error(`Controller not recognized: ${controller}`);
  }
  const [ruleset, metadata] = await params.client.readContract({
    address: controller,
    abi: CONTROLLER_ABI,
    functionName: 'currentRulesetOf',
    args: [params.projectId],
  });
  const rulesetId = BigInt(ruleset.id);
  if (rulesetId === 0n) throw new Error('Current project rules are unavailable');
  if (params.operation === 'pay' && metadata.pausePay) {
    throw new Error('Payments are paused by the current project rules');
  }
  if (params.operation === 'cashOut' && Number(metadata.cashOutTaxRate) >= 10_000) {
    throw new Error('Cash outs are disabled by the current project rules');
  }
  const usesHook = params.operation === 'pay'
    ? metadata.useDataHookForPay
    : metadata.useDataHookForCashOut;
  if (usesHook) {
    if (metadata.dataHook.toLowerCase() === zeroAddress) {
      throw new Error(`Project ${params.operation} hook configuration is incomplete`);
    }
    await requireRecognizedRuntimeHook({
      client: params.client,
      projectId: params.projectId,
      rulesetId,
      hook: metadata.dataHook,
    });
  }
  return rulesetId;
}

export function requireRecognizedProjectPayConfiguration(params: {
  client: Pick<PublicClient, 'readContract'>;
  projectId: bigint;
}): Promise<bigint> {
  return requireRecognizedProjectRuntimeConfiguration({ ...params, operation: 'pay' });
}

export function requireRecognizedProjectCashOutConfiguration(params: {
  client: Pick<PublicClient, 'readContract'>;
  projectId: bigint;
}): Promise<bigint> {
  return requireRecognizedProjectRuntimeConfiguration({ ...params, operation: 'cashOut' });
}
