import { describe, expect, it, vi } from 'vitest'
import type { GuardedTxRequest } from '../../services/projectTx'
import { submitReviewedErc20Deployment } from './DeployERC20Modal'
import { submitReviewedTierOperation } from './ManageTiersModal'
import { submitReviewedRulesetQueue } from './QueueRulesetModal'
import { submitReviewedReservedTokenDistribution } from './SendReservedTokensModal'
import { submitReviewedSplitUpdate } from './SetSplitsModal'

const ACCOUNT_TARGET = '0x1111111111111111111111111111111111111111' as const
const HASH = `0x${'ab'.repeat(32)}` as const

const boundaries = [
  ['ERC-20 deployment', submitReviewedErc20Deployment],
  ['NFT tier operation', submitReviewedTierOperation],
  ['ruleset queue', submitReviewedRulesetQueue],
  ['reserved-token distribution', submitReviewedReservedTokenDistribution],
  ['split update', submitReviewedSplitUpdate],
] as const

describe.each(boundaries)('%s guarded modal boundary', (_name, submit) => {
  const request: GuardedTxRequest = {
    chainId: 1,
    to: ACCOUNT_TARGET,
    data: '0x12345678',
    review: { title: `Review ${_name}`, label: `Submit ${_name}` },
    reverify: vi.fn().mockResolvedValue(undefined),
  }

  it('delegates the exact reviewed request once and returns its confirmed hash', async () => {
    const run = vi.fn().mockResolvedValue(HASH)
    await expect(submit({ run }, request)).resolves.toBe(HASH)
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(request)
  })

  it('propagates review cancellation without retrying submission', async () => {
    const run = vi.fn().mockRejectedValue(new Error('Transaction review cancelled'))
    await expect(submit({ run }, request)).rejects.toThrow('review cancelled')
    expect(run).toHaveBeenCalledOnce()
  })
})
