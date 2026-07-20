import { assertEquals, assertRejects } from 'std/assert/mod.ts';
import type { Address, PublicClient } from 'viem';
import {
  requireRecognizedClone,
  requireRecognized721CloneIdentity,
  requireRecognizedLpSplitHookClone,
} from './addressRegistry.ts';

// Exercise the generic clone-recognition path with the 721 kinds the app uses.
const requireRecognized721Clone = (
  client: Pick<PublicClient, 'readContract'>,
  hook: Address,
) => requireRecognizedClone({
  client,
  instance: hook,
  allowedKinds: ['721-hook', 'defifa-hook'],
  label: '721 hook',
});

const INSTANCE = '0x1111111111111111111111111111111111111111' as Address;
const REGISTRY = '0x581bfd1ead279e0a27b736e49494db3a7d85993c' as Address;
const TIERS_DEPLOYER = '0xb7b8ec35e2dd84afff04ee769c6189e7a4d44a78' as Address;
const DEFIFA_TESTNET_DEPLOYER = '0xbfa54a97099485c134f06c9a08a4909c26fd7318' as Address;
const DEFIFA_MAINNET_DEPLOYER = '0x375afb2a4b1cadae99f8863f96fc1aebcbaf8bde' as Address;
const LP_SPLIT_DEPLOYER = '0x1b79a25ee77a79469f20c98fa410f85f6027f4cf' as Address;
const UNKNOWN = '0x9999999999999999999999999999999999999999' as Address;
const STORE = '0x2222222222222222222222222222222222222222' as Address;
const IMPLEMENTATION = '0x3333333333333333333333333333333333333333' as Address;

function reader(
  deployer: Address,
  options: {
    registryByDeployer?: Record<string, Address>;
    deployerByRegistry?: Record<string, Address>;
    chainId?: number;
  } = {},
) {
  return {
    chain: options.chainId === undefined ? undefined : { id: options.chainId },
    readContract: ({ address, functionName }: { address: Address; functionName: string }) => {
      if (functionName === 'deployerOf') {
        return Promise.resolve(
          options.deployerByRegistry?.[address.toLowerCase()] ??
            (address.toLowerCase() === REGISTRY.toLowerCase() ? deployer : UNKNOWN),
        );
      }
      if (functionName === 'ADDRESS_REGISTRY' || functionName === 'REGISTRY') {
        return Promise.resolve(options.registryByDeployer?.[address.toLowerCase()] ?? REGISTRY);
      }
      return Promise.reject(new Error(`Unexpected read: ${functionName}`));
    },
  } as unknown as Pick<PublicClient, 'readContract'>;
}

function identityReader(params: {
  deployer?: Address;
  kind?: '721-hook' | 'defifa-hook';
  store?: Address;
  metadataIdTarget?: Address;
  projectId?: bigint;
}) {
  const deployer = params.deployer ?? TIERS_DEPLOYER;
  const kind = params.kind ?? '721-hook';
  return {
    readContract: ({ address, functionName }: { address: Address; functionName: string }) => {
      if (functionName === 'deployerOf') return Promise.resolve(deployer);
      if (functionName === 'ADDRESS_REGISTRY' || functionName === 'REGISTRY') {
        return Promise.resolve(REGISTRY);
      }
      if (functionName === 'HOOK' || functionName === 'HOOK_CODE_ORIGIN') {
        return Promise.resolve(IMPLEMENTATION);
      }
      if (functionName === 'HOOK_STORE') return Promise.resolve(STORE);
      if (functionName === 'STORE') {
        return Promise.resolve(
          address.toLowerCase() === INSTANCE.toLowerCase() ? params.store ?? STORE : STORE,
        );
      }
      if (functionName === 'store') {
        if (kind !== 'defifa-hook') return Promise.reject(new Error('Unexpected lowercase store'));
        return Promise.resolve(params.store ?? STORE);
      }
      if (functionName === 'METADATA_ID_TARGET') {
        return Promise.resolve(params.metadataIdTarget ?? IMPLEMENTATION);
      }
      if (functionName === 'projectId') return Promise.resolve(params.projectId ?? 7n);
      return Promise.reject(new Error(`Unexpected read: ${functionName}`));
    },
  } as unknown as Pick<PublicClient, 'readContract'>;
}

Deno.test('address registry recognizes tier-hook and Defifa clones', async () => {
  assertEquals(await requireRecognized721Clone(reader(TIERS_DEPLOYER), INSTANCE), '721-hook');
  assertEquals(
    await requireRecognized721Clone(
      reader(DEFIFA_TESTNET_DEPLOYER, { chainId: 11155111 }),
      INSTANCE,
    ),
    'defifa-hook',
  );
});

Deno.test('address registry enforces chain-specific canonical deployers', async () => {
  await assertRejects(
    () => requireRecognized721Clone(reader(DEFIFA_TESTNET_DEPLOYER, { chainId: 1 }), INSTANCE),
    Error,
    'not recognized',
  );
  assertEquals(
    await requireRecognized721Clone(reader(DEFIFA_MAINNET_DEPLOYER, { chainId: 1 }), INSTANCE),
    'defifa-hook',
  );
  await assertRejects(
    () =>
      requireRecognizedLpSplitHookClone(reader(LP_SPLIT_DEPLOYER, { chainId: 11155420 }), INSTANCE),
    Error,
    'not recognized',
  );
});

Deno.test('address registry recognizes LP clones only as split hooks', async () => {
  assertEquals(
    await requireRecognizedLpSplitHookClone(reader(LP_SPLIT_DEPLOYER), INSTANCE),
    'lp-split-hook',
  );
  await assertRejects(
    () => requireRecognized721Clone(reader(LP_SPLIT_DEPLOYER), INSTANCE),
    Error,
    'not recognized',
  );
});

Deno.test('address registry blocks unknown deployers', async () => {
  await assertRejects(
    () => requireRecognized721Clone(reader(UNKNOWN), INSTANCE),
    Error,
    'not recognized',
  );
});

Deno.test('address registry is derived from a known deployer', async () => {
  assertEquals(
    await requireRecognized721Clone(
      reader(TIERS_DEPLOYER, {
        registryByDeployer: {
          [TIERS_DEPLOYER.toLowerCase()]: UNKNOWN,
        },
        deployerByRegistry: {
          [UNKNOWN.toLowerCase()]: TIERS_DEPLOYER,
        },
      }),
      INSTANCE,
    ),
    '721-hook',
  );
});

Deno.test('address registry blocks inconsistent provenance', async () => {
  await assertRejects(
    () =>
      requireRecognized721Clone(
        reader(DEFIFA_TESTNET_DEPLOYER, {
          registryByDeployer: {
            [DEFIFA_TESTNET_DEPLOYER.toLowerCase()]: UNKNOWN,
          },
        }),
        INSTANCE,
      ),
    Error,
    'not recognized',
  );
});

Deno.test('address registry verifies standard and Defifa 721 identities', async () => {
  const standard = await requireRecognized721CloneIdentity({
    client: identityReader({}),
    hook: INSTANCE,
    expectedProjectId: 7n,
  });
  assertEquals(standard.kind, '721-hook');
  assertEquals(standard.store, STORE);
  assertEquals(standard.metadataIdTarget, IMPLEMENTATION);

  const defifa = await requireRecognized721CloneIdentity({
    client: identityReader({ deployer: DEFIFA_TESTNET_DEPLOYER, kind: 'defifa-hook' }),
    hook: INSTANCE,
    expectedProjectId: 7n,
  });
  assertEquals(defifa.kind, 'defifa-hook');
});

Deno.test('address registry blocks 721 identity mismatches', async () => {
  await assertRejects(
    () =>
      requireRecognized721CloneIdentity({
        client: identityReader({ store: UNKNOWN }),
        hook: INSTANCE,
        expectedProjectId: 7n,
      }),
    Error,
    'store not recognized',
  );
  await assertRejects(
    () =>
      requireRecognized721CloneIdentity({
        client: identityReader({ metadataIdTarget: UNKNOWN }),
        hook: INSTANCE,
        expectedProjectId: 7n,
      }),
    Error,
    'implementation target not recognized',
  );
  await assertRejects(
    () =>
      requireRecognized721CloneIdentity({
        client: identityReader({ projectId: 8n }),
        hook: INSTANCE,
        expectedProjectId: 7n,
      }),
    Error,
    'belongs to project 8, not project 7',
  );
});
