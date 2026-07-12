import { describe, expect, it } from 'vitest'
import { zeroAddress } from 'viem'
import {
  fetchProject,
  fetchProjectSplits,
  fetchProjectWithRuleset,
} from './bendystraw'
import {
  fetchResolvedNFTTiers,
  getProjectDataHook,
} from './nft'

const RUN_LIVE = process.env.RUN_CHAIN_INTEGRATION === 'true'

describe.skipIf(!RUN_LIVE)('live Base Sepolia project fixture', () => {
  it('verifies project 9 metadata, 721 shop, and project payout configuration', async () => {
    const chainId = 84532
    const projectId = '9'
    const [project, projectWithRuleset, hook] = await Promise.all([
      fetchProject(projectId, chainId),
      fetchProjectWithRuleset(projectId, chainId),
      getProjectDataHook(projectId, chainId),
    ])

    const rulesetId = projectWithRuleset?.currentRuleset?.id
    expect(project?.name).toBeTruthy()
    expect(rulesetId).toMatch(/^\d+$/)
    expect(hook).toMatch(/^0x[a-fA-F0-9]{40}$/)
    if (!rulesetId || !hook) {
      throw new Error('Live project fixture is missing its current ruleset or data hook')
    }

    const [tiers, splitConfiguration] = await Promise.all([
      fetchResolvedNFTTiers(hook, chainId),
      fetchProjectSplits(projectId, chainId, rulesetId),
    ])

    expect(tiers.length).toBeGreaterThan(0)
    expect(tiers.some(tier => tier.name !== `Tier ${tier.tierId}` && Boolean(tier.imageUri))).toBe(true)
    expect(splitConfiguration.configurationComplete).toBe(true)
    expect(splitConfiguration.payoutSplits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        projectId: 8,
        beneficiary: zeroAddress,
        preferAddToBalance: false,
      }),
    ]))
  }, 60_000)
})
