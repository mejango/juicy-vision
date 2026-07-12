import { type Address, type PublicClient, zeroAddress } from 'viem';

export type RecognizedCloneKind = '721-hook' | 'defifa-hook' | 'lp-split-hook';

export interface RecognizedCloneProvenance {
  kind: RecognizedCloneKind;
  deployer: Address;
  registry: Address;
}

interface RecognizedCloneDeployer {
  kind: RecognizedCloneKind;
  registryGetter: 'ADDRESS_REGISTRY' | 'REGISTRY';
  chainIds: readonly number[];
}

const ALL_SUPPORTED_CHAIN_IDS = [1, 10, 8453, 42161, 11155111, 11155420, 84532, 421614] as const;
const MAINNET_CHAIN_IDS = [1, 10, 8453, 42161] as const;
const TESTNET_CHAIN_IDS = [11155111, 11155420, 84532, 421614] as const;
const LP_SPLIT_CHAIN_IDS = [1, 10, 8453, 42161, 11155111, 84532, 421614] as const;

const RECOGNIZED_CLONE_DEPLOYERS = new Map<string, RecognizedCloneDeployer>([
  [
    '0xb7b8ec35e2dd84afff04ee769c6189e7a4d44a78',
    { kind: '721-hook', registryGetter: 'ADDRESS_REGISTRY', chainIds: ALL_SUPPORTED_CHAIN_IDS },
  ],
  [
    '0x375afb2a4b1cadae99f8863f96fc1aebcbaf8bde',
    { kind: 'defifa-hook', registryGetter: 'REGISTRY', chainIds: MAINNET_CHAIN_IDS },
  ],
  [
    '0xbfa54a97099485c134f06c9a08a4909c26fd7318',
    { kind: 'defifa-hook', registryGetter: 'REGISTRY', chainIds: TESTNET_CHAIN_IDS },
  ],
  [
    '0x1b79a25ee77a79469f20c98fa410f85f6027f4cf',
    { kind: 'lp-split-hook', registryGetter: 'ADDRESS_REGISTRY', chainIds: LP_SPLIT_CHAIN_IDS },
  ],
]);

const ADDRESS_REGISTRY_ABI = [{
  name: 'deployerOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'addr', type: 'address' }],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const ADDRESS_REGISTRY_GETTER_ABI = [{
  name: 'ADDRESS_REGISTRY',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const REGISTRY_GETTER_ABI = [{
  name: 'REGISTRY',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}] as const;

const STANDARD_721_DEPLOYER_IDENTITY_ABI = [
  {
    name: 'HOOK',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'STORE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const DEFIFA_DEPLOYER_IDENTITY_ABI = [
  {
    name: 'HOOK_CODE_ORIGIN',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'HOOK_STORE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

const STANDARD_721_HOOK_IDENTITY_ABI = [
  {
    name: 'STORE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'METADATA_ID_TARGET',
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
] as const;

const DEFIFA_HOOK_STORE_ABI = [{
  name: 'store',
  type: 'function',
  stateMutability: 'view',
  inputs: [],
  outputs: [{ name: '', type: 'address' }],
}] as const;

export interface Recognized721HookIdentity extends RecognizedCloneProvenance {
  store: Address;
  metadataIdTarget: Address;
  projectId: bigint;
}

function registryOf(
  client: Pick<PublicClient, 'readContract'>,
  deployer: Address,
  deployment: RecognizedCloneDeployer,
): Promise<Address> {
  return deployment.registryGetter === 'REGISTRY'
    ? client.readContract({
      address: deployer,
      abi: REGISTRY_GETTER_ABI,
      functionName: 'REGISTRY',
    })
    : client.readContract({
      address: deployer,
      abi: ADDRESS_REGISTRY_GETTER_ABI,
      functionName: 'ADDRESS_REGISTRY',
    });
}

export async function requireRecognizedCloneProvenance(params: {
  client: Pick<PublicClient, 'readContract'>;
  instance: Address;
  allowedKinds: readonly RecognizedCloneKind[];
  label: string;
}): Promise<RecognizedCloneProvenance> {
  if (params.instance.toLowerCase() === zeroAddress) {
    throw new Error(`${params.label} is missing`);
  }

  const chainId = (params.client as { chain?: { id?: number } }).chain?.id;
  for (const [candidateAddress, candidate] of RECOGNIZED_CLONE_DEPLOYERS) {
    if (!params.allowedKinds.includes(candidate.kind)) continue;
    if (chainId !== undefined && !candidate.chainIds.includes(chainId)) continue;

    try {
      const registry = await registryOf(params.client, candidateAddress as Address, candidate);
      if (registry.toLowerCase() === zeroAddress) continue;

      const recordedDeployer = await params.client.readContract({
        address: registry,
        abi: ADDRESS_REGISTRY_ABI,
        functionName: 'deployerOf',
        args: [params.instance],
      });
      const deployment = RECOGNIZED_CLONE_DEPLOYERS.get(recordedDeployer.toLowerCase());
      if (!deployment || !params.allowedKinds.includes(deployment.kind)) continue;
      if (chainId !== undefined && !deployment.chainIds.includes(chainId)) continue;

      const recordedRegistry = await registryOf(params.client, recordedDeployer, deployment);
      if (recordedRegistry.toLowerCase() !== registry.toLowerCase()) continue;

      return {
        kind: deployment.kind,
        deployer: recordedDeployer,
        registry,
      };
    } catch {
      // A recognized deployer may not exist on every supported chain.
    }
  }

  throw new Error(`${params.label} not recognized: ${params.instance}`);
}

export async function requireRecognizedClone(params: {
  client: Pick<PublicClient, 'readContract'>;
  instance: Address;
  allowedKinds: readonly RecognizedCloneKind[];
  label: string;
}): Promise<RecognizedCloneKind> {
  return (await requireRecognizedCloneProvenance(params)).kind;
}

export function requireRecognized721Clone(
  client: Pick<PublicClient, 'readContract'>,
  hook: Address,
): Promise<RecognizedCloneKind> {
  return requireRecognizedClone({
    client,
    instance: hook,
    allowedKinds: ['721-hook', 'defifa-hook'],
    label: '721 hook',
  });
}

export async function requireRecognized721CloneIdentity(params: {
  client: Pick<PublicClient, 'readContract'>;
  hook: Address;
  expectedProjectId?: bigint;
}): Promise<Recognized721HookIdentity> {
  const provenance = await requireRecognizedCloneProvenance({
    client: params.client,
    instance: params.hook,
    allowedKinds: ['721-hook', 'defifa-hook'],
    label: '721 hook',
  });

  const [expectedStore, expectedMetadataIdTarget] = provenance.kind === 'defifa-hook'
    ? await Promise.all([
      params.client.readContract({
        address: provenance.deployer,
        abi: DEFIFA_DEPLOYER_IDENTITY_ABI,
        functionName: 'HOOK_STORE',
      }),
      params.client.readContract({
        address: provenance.deployer,
        abi: DEFIFA_DEPLOYER_IDENTITY_ABI,
        functionName: 'HOOK_CODE_ORIGIN',
      }),
    ])
    : await Promise.all([
      params.client.readContract({
        address: provenance.deployer,
        abi: STANDARD_721_DEPLOYER_IDENTITY_ABI,
        functionName: 'STORE',
      }),
      params.client.readContract({
        address: provenance.deployer,
        abi: STANDARD_721_DEPLOYER_IDENTITY_ABI,
        functionName: 'HOOK',
      }),
    ]);

  const [store, metadataIdTarget, projectId] = await Promise.all([
    provenance.kind === 'defifa-hook'
      ? params.client.readContract({
        address: params.hook,
        abi: DEFIFA_HOOK_STORE_ABI,
        functionName: 'store',
      })
      : params.client.readContract({
        address: params.hook,
        abi: STANDARD_721_HOOK_IDENTITY_ABI,
        functionName: 'STORE',
      }),
    params.client.readContract({
      address: params.hook,
      abi: STANDARD_721_HOOK_IDENTITY_ABI,
      functionName: 'METADATA_ID_TARGET',
    }),
    params.client.readContract({
      address: params.hook,
      abi: STANDARD_721_HOOK_IDENTITY_ABI,
      functionName: 'projectId',
    }),
  ]);

  if (store.toLowerCase() !== expectedStore.toLowerCase()) {
    throw new Error(`721 hook store not recognized: ${store}`);
  }
  if (metadataIdTarget.toLowerCase() !== expectedMetadataIdTarget.toLowerCase()) {
    throw new Error(`721 hook implementation target not recognized: ${metadataIdTarget}`);
  }
  if (projectId <= 0n) throw new Error('721 hook project ID is invalid');
  if (params.expectedProjectId !== undefined && projectId !== params.expectedProjectId) {
    throw new Error(
      `721 hook belongs to project ${projectId}, not project ${params.expectedProjectId}`,
    );
  }

  return { ...provenance, store, metadataIdTarget, projectId };
}

export function requireRecognizedLpSplitHookClone(
  client: Pick<PublicClient, 'readContract'>,
  hook: Address,
): Promise<RecognizedCloneKind> {
  return requireRecognizedClone({
    client,
    instance: hook,
    allowedKinds: ['lp-split-hook'],
    label: 'Split hook',
  });
}
