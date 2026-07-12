import { describe, expect, it } from 'vitest'
import { decodeFunctionData, encodeFunctionData, zeroAddress } from 'viem'
import { JB_CONTROLLER_ABI } from '../constants/abis/jbController'
import { buildSplit, buildSplitGroup, type SplitInput } from './splitSafety'

const RECIPIENT = '0x1234567890123456789012345678901234567890'

function split(overrides: Partial<SplitInput> = {}): SplitInput {
  return {
    percent: '50',
    beneficiary: RECIPIENT,
    projectId: '',
    preferAddToBalance: false,
    lockedUntil: 0,
    hook: zeroAddress,
    isNew: true,
    ...overrides,
  }
}

describe('splitSafety', () => {
  it('encodes a plain wallet recipient exactly', () => {
    expect(buildSplit(split(), 'Split', { kind: 'payout', sourceProjectId: 1 })).toEqual({
      percent: 500_000_000,
      projectId: 0n,
      beneficiary: RECIPIENT,
      preferAddToBalance: false,
      lockedUntil: 0,
      hook: zeroAddress,
    })
  })

  it('encodes percentages without floating-point rounding', () => {
    expect(buildSplit(split({ percent: '33.3333333' }), 'Split', {
      kind: 'payout',
      sourceProjectId: 1,
    }).percent).toBe(333_333_333)
    expect(() => buildSplit(split({ percent: '0.00000001' }), 'Split', {
      kind: 'payout',
      sourceProjectId: 1,
    })).toThrow('more precision')
  })

  it('supports project pay and add-to-balance payout routes', () => {
    expect(buildSplit(split({ projectId: '2' }), 'Split', {
      kind: 'payout',
      sourceProjectId: 1,
    })).toMatchObject({ projectId: 2n, beneficiary: RECIPIENT, preferAddToBalance: false })

    expect(buildSplit(split({ projectId: '2', beneficiary: '', preferAddToBalance: true }), 'Split', {
      kind: 'payout',
      sourceProjectId: 1,
    })).toMatchObject({ projectId: 2n, beneficiary: zeroAddress, preferAddToBalance: true })
  })

  it('requires beneficiaries for new project-pay and reserved project routes', () => {
    expect(() => buildSplit(split({ projectId: '2', beneficiary: '' }), 'Split', {
      kind: 'payout',
      sourceProjectId: 1,
    })).toThrow('destination-token beneficiary')
    expect(() => buildSplit(split({ projectId: '2', beneficiary: '' }), 'Split', {
      kind: 'reserved',
      sourceProjectId: 1,
    })).toThrow('fallback beneficiary')
  })

  it('preserves an existing zero-beneficiary project route and split hook', () => {
    expect(buildSplit(split({
      projectId: '2',
      beneficiary: '',
      hook: RECIPIENT,
      isNew: false,
    }), 'Split', { kind: 'payout', sourceProjectId: 1 })).toMatchObject({
      projectId: 2n,
      beneficiary: zeroAddress,
      hook: RECIPIENT,
    })
  })

  it('blocks same-project routes and irrelevant reserved add-to-balance flags', () => {
    expect(() => buildSplit(split({ projectId: '1' }), 'Split', {
      kind: 'payout',
      sourceProjectId: 1,
    })).toThrow('source project')
    expect(() => buildSplit(split({ projectId: '2', preferAddToBalance: true }), 'Split', {
      kind: 'reserved',
      sourceProjectId: 1,
    })).toThrow('irrelevant add-to-balance')
  })

  it('blocks split totals over 100%', () => {
    expect(() => buildSplitGroup([
      split({ percent: '60' }),
      split({ percent: '50' }),
    ], 'Payout splits', { kind: 'payout', sourceProjectId: 1 })).toThrow('exceed 100%')
  })

  it('ABI round-trips project-pay and add-to-balance fields exactly', () => {
    const payout = buildSplit(split({ projectId: '2' }), 'Payout', {
      kind: 'payout',
      sourceProjectId: 1,
    })
    const addToBalance = buildSplit(split({
      projectId: '3',
      beneficiary: '',
      preferAddToBalance: true,
    }), 'Payout', { kind: 'payout', sourceProjectId: 1 })
    const data = encodeFunctionData({
      abi: JB_CONTROLLER_ABI,
      functionName: 'setSplitGroupsOf',
      args: [1n, 9n, [{ groupId: 1n, splits: [payout, addToBalance] }]],
    })
    const decoded = decodeFunctionData({ abi: JB_CONTROLLER_ABI, data })
    expect(decoded.functionName).toBe('setSplitGroupsOf')
    if (decoded.functionName !== 'setSplitGroupsOf' || !decoded.args) {
      throw new Error('setSplitGroupsOf did not decode')
    }
    const groups = decoded.args[2] as readonly [{
      groupId: bigint
      splits: readonly ReturnType<typeof buildSplit>[]
    }]
    expect(groups[0].splits[0]).toMatchObject({
      projectId: 2n,
      beneficiary: RECIPIENT,
      preferAddToBalance: false,
    })
    expect(groups[0].splits[1]).toMatchObject({
      projectId: 3n,
      beneficiary: zeroAddress,
      preferAddToBalance: true,
    })
  })
})
