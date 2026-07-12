import { describe, expect, it, vi } from 'vitest'
import { type Address, type PublicClient, zeroAddress } from 'viem'
import {
  JB_CONTRACTS,
  JB721_CONTRACTS,
  JB_BUYBACK_HOOK,
  JB_BUYBACK_HOOK_REGISTRY,
  JB_OMNICHAIN_DEPLOYER,
  REV_OWNER,
} from '../constants'
import {
  assertCurrentProjectCashOutConfigurationTrusted,
  assertCurrentProjectPayConfigurationTrusted,
  resolveRulesetQueueRoute,
} from './projectTrust'

const PROJECT_ID = 7n
const RULESET_ID = 123n
const TIERED_HOOK = '0x1111111111111111111111111111111111111111' as Address
const ADDRESS_REGISTRY = '0x581bfd1ead279e0a27b736e49494db3a7d85993c' as Address
const HOOK_IMPLEMENTATION = '0x2222222222222222222222222222222222222222' as Address
const CT_DEPLOYER = '0xf21b8717cb50e497e90f375ec532557dd9022655' as Address
const UNKNOWN = '0x9999999999999999999999999999999999999999' as Address

function currentRuleset(
  dataHook: Address,
  usePay: boolean,
  useCashOut: boolean,
  overrides: { pausePay?: boolean; cashOutTaxRate?: number } = {},
) {
  return [
    {
      cycleNumber: 1,
      id: RULESET_ID,
      basedOnId: 0,
      start: 0,
      duration: 0,
      weight: 1n,
      weightCutPercent: 0,
      approvalHook: zeroAddress,
      metadata: 0n,
    },
    {
      dataHook,
      useDataHookForPay: usePay,
      useDataHookForCashOut: useCashOut,
      pausePay: overrides.pausePay ?? false,
      cashOutTaxRate: overrides.cashOutTaxRate ?? 0,
    },
  ] as const
}

function mockClient(handler: (functionName: string) => unknown): Pick<PublicClient, 'readContract'> {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => handler(functionName)),
  } as unknown as Pick<PublicClient, 'readContract'>
}

describe('resolveRulesetQueueRoute', () => {
  it('uses the live recognized controller for a direct ruleset', async () => {
    const client = mockClient((functionName) => {
      if (functionName === 'controllerOf') return JB_CONTRACTS.JBController
      if (functionName === 'currentRulesetOf') return currentRuleset(zeroAddress, false, false)
      throw new Error(`Unexpected read: ${functionName}`)
    })

    await expect(resolveRulesetQueueRoute({
      client,
      projectId: PROJECT_ID,
      expectedRulesetId: RULESET_ID,
    })).resolves.toMatchObject({
      target: JB_CONTRACTS.JBController,
      dataHook: zeroAddress,
      useDataHookForPay: false,
      useDataHookForCashOut: false,
    })
  })

  it('derives the recognized omnichain wrapper and unwraps its extra hook', async () => {
    const client = mockClient((functionName) => {
      if (functionName === 'controllerOf') return JB_CONTRACTS.JBController
      if (functionName === 'currentRulesetOf') {
        return currentRuleset(JB_OMNICHAIN_DEPLOYER, true, true)
      }
      if (functionName === 'extraDataHookOf') {
        return { dataHook: zeroAddress, useDataHookForPay: false, useDataHookForCashOut: false }
      }
      if (functionName === 'tiered721HookOf') return [TIERED_HOOK, true] as const
      if (functionName === 'ADDRESS_REGISTRY') return ADDRESS_REGISTRY
      if (functionName === 'deployerOf') return JB721_CONTRACTS.JB721TiersHookDeployer
      if (functionName === 'STORE') return JB721_CONTRACTS.JB721TiersHookStore
      if (functionName === 'HOOK' || functionName === 'METADATA_ID_TARGET') return HOOK_IMPLEMENTATION
      if (functionName === 'projectId') return PROJECT_ID
      throw new Error(`Unexpected read: ${functionName}`)
    })

    await expect(resolveRulesetQueueRoute({
      client,
      projectId: PROJECT_ID,
      expectedRulesetId: RULESET_ID,
    })).resolves.toMatchObject({
      target: JB_OMNICHAIN_DEPLOYER,
      dataHook: zeroAddress,
      useDataHookForPay: false,
      useDataHookForCashOut: false,
    })
  })

  it('blocks revnet rules instead of routing them through the generic controller', async () => {
    const client = mockClient((functionName) => {
      if (functionName === 'controllerOf') return JB_CONTRACTS.JBController
      if (functionName === 'currentRulesetOf') return currentRuleset(REV_OWNER, true, true)
      throw new Error(`Unexpected read: ${functionName}`)
    })

    await expect(resolveRulesetQueueRoute({
      client,
      projectId: PROJECT_ID,
      expectedRulesetId: RULESET_ID,
    })).rejects.toThrow('Revnet rules cannot be changed through this ruleset editor')
  })
})

describe('current project operation safety', () => {
  it('blocks a payment paused by the current rules', async () => {
    const client = mockClient((functionName) => {
      if (functionName === 'controllerOf') return JB_CONTRACTS.JBController
      if (functionName === 'currentRulesetOf') {
        return currentRuleset(zeroAddress, false, false, { pausePay: true })
      }
      throw new Error(`Unexpected read: ${functionName}`)
    })

    await expect(assertCurrentProjectPayConfigurationTrusted({ client, projectId: PROJECT_ID }))
      .rejects.toThrow('Payments are paused')
  })

  it('blocks a cash out disabled by the current rules', async () => {
    const client = mockClient((functionName) => {
      if (functionName === 'controllerOf') return JB_CONTRACTS.JBController
      if (functionName === 'currentRulesetOf') {
        return currentRuleset(zeroAddress, false, false, { cashOutTaxRate: 10_000 })
      }
      throw new Error(`Unexpected read: ${functionName}`)
    })

    await expect(assertCurrentProjectCashOutConfigurationTrusted({ client, projectId: PROJECT_ID }))
      .rejects.toThrow('Cash outs are disabled')
  })

  it('verifies the 721 clone behind the Croptop wrapper', async () => {
    const client = mockClient((functionName) => {
      if (functionName === 'controllerOf') return JB_CONTRACTS.JBController
      if (functionName === 'currentRulesetOf') return currentRuleset(CT_DEPLOYER, true, true)
      if (functionName === 'dataHookOf') return TIERED_HOOK
      if (functionName === 'deployerOf') return JB721_CONTRACTS.JB721TiersHookDeployer
      if (functionName === 'ADDRESS_REGISTRY') return ADDRESS_REGISTRY
      if (functionName === 'STORE') return JB721_CONTRACTS.JB721TiersHookStore
      if (functionName === 'HOOK' || functionName === 'METADATA_ID_TARGET') return HOOK_IMPLEMENTATION
      if (functionName === 'projectId') return PROJECT_ID
      throw new Error(`Unexpected read: ${functionName}`)
    })

    await expect(assertCurrentProjectPayConfigurationTrusted({ client, projectId: PROJECT_ID }))
      .resolves.toBe(RULESET_ID)
  })

  it('blocks an unrecognized hook behind the buyback registry', async () => {
    const client = mockClient((functionName) => {
      if (functionName === 'controllerOf') return JB_CONTRACTS.JBController
      if (functionName === 'currentRulesetOf') {
        return currentRuleset(JB_BUYBACK_HOOK_REGISTRY, true, true)
      }
      if (functionName === 'hookOf') return UNKNOWN
      throw new Error(`Unexpected read: ${functionName}`)
    })

    await expect(assertCurrentProjectPayConfigurationTrusted({ client, projectId: PROJECT_ID }))
      .rejects.toThrow(`Buyback hook not recognized: ${UNKNOWN}`)
  })

  it('accepts the canonical hook behind the buyback registry', async () => {
    const client = mockClient((functionName) => {
      if (functionName === 'controllerOf') return JB_CONTRACTS.JBController
      if (functionName === 'currentRulesetOf') {
        return currentRuleset(JB_BUYBACK_HOOK_REGISTRY, true, true)
      }
      if (functionName === 'hookOf') return JB_BUYBACK_HOOK
      throw new Error(`Unexpected read: ${functionName}`)
    })

    await expect(assertCurrentProjectPayConfigurationTrusted({ client, projectId: PROJECT_ID }))
      .resolves.toBe(RULESET_ID)
  })
})
