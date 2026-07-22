import { decodeFunctionData, zeroAddress } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { JB_CONTROLLER_ABI } from '../../constants/abis/jbController'
import { SPLIT_GROUP_RESERVED } from '../../constants/abis/jbSplits'
import {
  buildSetSplitsTransaction,
  submitManagedSplitsBundle,
  type FormSplit,
} from './useOmnichainSetSplits'

const CONTROLLER = '0x3fcec3572e84b624477bcff4e2cf1f7deab648f1'
const BENEFICIARY = '0x1111111111111111111111111111111111111111'
const SECOND_BENEFICIARY = '0x2222222222222222222222222222222222222222'

function split(overrides: Partial<FormSplit> = {}): FormSplit {
  return {
    percent: '25',
    beneficiary: BENEFICIARY,
    projectId: '',
    preferAddToBalance: false,
    lockedUntil: 0,
    hook: zeroAddress,
    ...overrides,
  }
}

describe('buildSetSplitsTransaction', () => {
  it('encodes the exact V6 controller route, reviewed ruleset, group IDs, and split tuples', () => {
    const transaction = buildSetSplitsTransaction({
      chainId: 10,
      projectId: 19,
      rulesetId: '1700000001',
      payoutGroupId: '61166',
      payoutSplits: [
        split({ percent: '60.5' }),
        split({
          percent: '39.5',
          beneficiary: SECOND_BENEFICIARY,
          projectId: '23',
          preferAddToBalance: true,
        }),
      ],
      reservedSplits: [split({ percent: '12.3456789' })],
      controller: CONTROLLER,
    })

    expect(transaction).toMatchObject({
      chain: 10,
      target: CONTROLLER,
      value: '0',
    })
    const decoded = decodeFunctionData({ abi: JB_CONTROLLER_ABI, data: transaction.data })
    expect(decoded.functionName).toBe('setSplitGroupsOf')
    const [projectId, rulesetId, groups] = decoded.args as unknown as readonly [
      bigint,
      bigint,
      ReadonlyArray<{
        groupId: bigint
        splits: ReadonlyArray<{
          percent: number
          projectId: bigint
          beneficiary: `0x${string}`
          preferAddToBalance: boolean
          lockedUntil: number
          hook: `0x${string}`
        }>
      }>,
    ]
    expect(projectId).toBe(19n)
    expect(rulesetId).toBe(1_700_000_001n)
    expect(groups).toHaveLength(2)
    expect(groups[0].groupId).toBe(61_166n)
    expect(groups[0].splits).toEqual([
      {
        percent: 605_000_000,
        projectId: 0n,
        beneficiary: BENEFICIARY,
        preferAddToBalance: false,
        lockedUntil: 0,
        hook: zeroAddress,
      },
      {
        percent: 395_000_000,
        projectId: 23n,
        beneficiary: SECOND_BENEFICIARY,
        preferAddToBalance: true,
        lockedUntil: 0,
        hook: zeroAddress,
      },
    ])
    expect(groups[1].groupId).toBe(SPLIT_GROUP_RESERVED)
    expect(groups[1].splits[0].percent).toBe(123_456_789)
  })

  it('blocks an absent live payout group before encoding', () => {
    expect(() => buildSetSplitsTransaction({
      chainId: 10,
      projectId: 19,
      rulesetId: '1700000001',
      payoutGroupId: null,
      payoutSplits: [split()],
      reservedSplits: [],
      controller: CONTROLLER,
    })).toThrow('Payout split group unavailable on chain 10')
  })

  it('inherits split safety validation before any Relayr transaction exists', () => {
    expect(() => buildSetSplitsTransaction({
      chainId: 10,
      projectId: 19,
      rulesetId: '1700000001',
      payoutGroupId: '61166',
      payoutSplits: [split({ percent: '75' }), split({ percent: '30' })],
      reservedSplits: [],
      controller: CONTROLLER,
    })).toThrow('Payout splits recipients exceed 100%')
  })
})

describe('managed set-splits Relayr submission', () => {
  it('hands the exact simulated controller calls to the managed boundary', async () => {
    const submit = vi.fn().mockResolvedValue({ bundleId: 'splits-bundle' })
    const transactions = [{ chainId: 10, target: CONTROLLER, data: '0x12345678', value: '0' }]
    await expect(submitManagedSplitsBundle(transactions, BENEFICIARY, BENEFICIARY, submit))
      .resolves.toEqual({ bundleId: 'splits-bundle' })
    expect(submit).toHaveBeenCalledWith(transactions, BENEFICIARY, BENEFICIARY)
  })
})
