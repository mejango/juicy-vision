import { assertEquals, assertRejects } from 'std/assert/mod.ts';
import { type Address, type PublicClient } from 'viem';
import {
  requireRecognizedProjectCashOutConfiguration,
  requireRecognizedProjectPayConfiguration,
  resolveRecognizedSuckerRegistry,
} from './projectTrust.ts';

const DIRECTORY = '0x5aff29060e023e6fb87be5596652b33c65af535b' as Address;
const PROJECTS = '0x6017d1fba9dc279bfa0b03fd931c22e242ab3691' as Address;
const CONTROLLER = '0x3fcec3572e84b624477bcff4e2cf1f7deab648f1' as Address;
const CT_DEPLOYER = '0xf21b8717cb50e497e90f375ec532557dd9022655' as Address;
const TIERED_HOOK = '0x1111111111111111111111111111111111111111' as Address;
const TIERS_DEPLOYER = '0xb7b8ec35e2dd84afff04ee769c6189e7a4d44a78' as Address;
const ADDRESS_REGISTRY = '0x581bfd1ead279e0a27b736e49494db3a7d85993c' as Address;
const HOOK_STORE = '0x69913acf79dbba170d9efafe605ee62b42164f9c' as Address;
const HOOK_IMPLEMENTATION = '0x2222222222222222222222222222222222222222' as Address;
const BUYBACK_REGISTRY = '0x72f55a54cd53410a5ff175508a5a384227081788' as Address;
const SUCKER_REGISTRY = '0x7903a854ae91eaf635430d120a1a434085cef297' as Address;
const UNKNOWN = '0x9999999999999999999999999999999999999999' as Address;

function readerReturning(...values: unknown[]): Pick<PublicClient, 'readContract'> {
  return {
    readContract: (() => Promise.resolve(values.shift())) as PublicClient['readContract'],
  };
}

function readerByFunction(
  handler: (functionName: string) => unknown,
): Pick<PublicClient, 'readContract'> {
  return {
    readContract:
      (({ functionName }: { functionName: string }) =>
        Promise.resolve(handler(functionName))) as PublicClient['readContract'],
  };
}

function activeRules(dataHook: Address) {
  return [{ id: 1n }, {
    pausePay: false,
    cashOutTaxRate: 0,
    useDataHookForPay: true,
    useDataHookForCashOut: false,
    dataHook,
  }];
}

Deno.test('sucker registry is derived from the current recognized project hook and trusted roots', async () => {
  const registry = await resolveRecognizedSuckerRegistry({
    client: readerReturning(
      CONTROLLER,
      [{ id: 1n }, { dataHook: CT_DEPLOYER }],
      TIERED_HOOK,
      ADDRESS_REGISTRY,
      TIERS_DEPLOYER,
      ADDRESS_REGISTRY,
      HOOK_STORE,
      HOOK_IMPLEMENTATION,
      HOOK_STORE,
      HOOK_IMPLEMENTATION,
      1n,
      SUCKER_REGISTRY,
      DIRECTORY,
      PROJECTS,
    ),
    projectId: 1n,
  });

  assertEquals(registry, SUCKER_REGISTRY);
});

Deno.test('sucker registry discovery blocks an unknown controller', async () => {
  await assertRejects(
    () =>
      resolveRecognizedSuckerRegistry({
        client: readerReturning(UNKNOWN),
        projectId: 1n,
      }),
    Error,
    'Controller not recognized',
  );
});

Deno.test('sucker registry discovery blocks an unknown bridge hook even if it has the same getter', async () => {
  await assertRejects(
    () =>
      resolveRecognizedSuckerRegistry({
        client: readerReturning(
          CONTROLLER,
          [{ id: 1n }, { dataHook: UNKNOWN }],
          SUCKER_REGISTRY,
        ),
        projectId: 1n,
      }),
    Error,
    'Project bridge hook not recognized',
  );
});

Deno.test('sucker registry discovery blocks an unknown registry returned by a recognized hook', async () => {
  await assertRejects(
    () =>
      resolveRecognizedSuckerRegistry({
        client: readerReturning(
          CONTROLLER,
          [{ id: 1n }, { dataHook: CT_DEPLOYER }],
          TIERED_HOOK,
          ADDRESS_REGISTRY,
          TIERS_DEPLOYER,
          ADDRESS_REGISTRY,
          HOOK_STORE,
          HOOK_IMPLEMENTATION,
          HOOK_STORE,
          HOOK_IMPLEMENTATION,
          1n,
          UNKNOWN,
        ),
        projectId: 1n,
      }),
    Error,
    'Sucker registry not recognized',
  );
});

Deno.test('sucker registry discovery blocks a recognized address wired to different roots', async () => {
  await assertRejects(
    () =>
      resolveRecognizedSuckerRegistry({
        client: readerReturning(
          CONTROLLER,
          [{ id: 1n }, { dataHook: CT_DEPLOYER }],
          TIERED_HOOK,
          ADDRESS_REGISTRY,
          TIERS_DEPLOYER,
          ADDRESS_REGISTRY,
          HOOK_STORE,
          HOOK_IMPLEMENTATION,
          HOOK_STORE,
          HOOK_IMPLEMENTATION,
          1n,
          SUCKER_REGISTRY,
          DIRECTORY,
          UNKNOWN,
        ),
        projectId: 1n,
      }),
    Error,
    'Sucker registry not recognized',
  );
});

Deno.test('current project trust blocks paused payments', async () => {
  await assertRejects(
    () =>
      requireRecognizedProjectPayConfiguration({
        client: readerReturning(
          CONTROLLER,
          [{ id: 1n }, {
            pausePay: true,
            cashOutTaxRate: 0,
            useDataHookForPay: false,
            useDataHookForCashOut: false,
          }],
        ),
        projectId: 1n,
      }),
    Error,
    'Payments are paused',
  );
});

Deno.test('current project trust blocks disabled cash outs', async () => {
  await assertRejects(
    () =>
      requireRecognizedProjectCashOutConfiguration({
        client: readerReturning(
          CONTROLLER,
          [{ id: 1n }, {
            pausePay: false,
            cashOutTaxRate: 10_000,
            useDataHookForPay: false,
            useDataHookForCashOut: false,
          }],
        ),
        projectId: 1n,
      }),
    Error,
    'Cash outs are disabled',
  );
});

Deno.test('current project trust verifies the 721 clone behind Croptop', async () => {
  const client = readerByFunction((functionName) => {
    if (functionName === 'controllerOf') return CONTROLLER;
    if (functionName === 'currentRulesetOf') return activeRules(CT_DEPLOYER);
    if (functionName === 'dataHookOf') return TIERED_HOOK;
    if (functionName === 'deployerOf') return TIERS_DEPLOYER;
    if (functionName === 'ADDRESS_REGISTRY') return ADDRESS_REGISTRY;
    if (functionName === 'STORE') return HOOK_STORE;
    if (functionName === 'HOOK' || functionName === 'METADATA_ID_TARGET') {
      return HOOK_IMPLEMENTATION;
    }
    if (functionName === 'projectId') return 1n;
    throw new Error(`Unexpected read: ${functionName}`);
  });

  assertEquals(
    await requireRecognizedProjectPayConfiguration({ client, projectId: 1n }),
    1n,
  );
});

Deno.test('current project trust blocks an unknown hook behind the buyback registry', async () => {
  const client = readerByFunction((functionName) => {
    if (functionName === 'controllerOf') return CONTROLLER;
    if (functionName === 'currentRulesetOf') return activeRules(BUYBACK_REGISTRY);
    if (functionName === 'hookOf') return UNKNOWN;
    throw new Error(`Unexpected read: ${functionName}`);
  });

  await assertRejects(
    () => requireRecognizedProjectPayConfiguration({ client, projectId: 1n }),
    Error,
    'Buyback hook not recognized',
  );
});
