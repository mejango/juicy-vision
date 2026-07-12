import { describe, expect, it } from 'vitest'
import { createPublicClient, http } from 'viem'
import { baseSepolia, sepolia } from 'viem/chains'
import { JB_CONTRACTS, RPC_ENDPOINTS, USDC_ADDRESSES } from '../constants'
import {
  resolveCashOutPreviewOutcome,
  resolvePayPreviewOutcome,
  TERMINAL_PREVIEW_CASH_OUT_ABI,
  TERMINAL_PREVIEW_PAY_ABI,
} from '../utils/terminalPreview'
import { getPaymentTerminal } from '../utils/paymentTerminal'
import { fetchProjectSplits } from './bendystraw'
import {
  fetchResolvedNFTTiers,
  getProjectDataHook,
} from './nft'

const RUN_LIVE = process.env.RUN_CHAIN_INTEGRATION === 'true'
const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const
const FIXTURE_ACCOUNT = '0x9Ff805Ca04238ca6D954aD0D1e3D380666A85C4C' as const

const CURRENT_RULESET_ABI = [{
  name: 'currentOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }],
  outputs: [{
    name: 'ruleset',
    type: 'tuple',
    components: [
      { name: 'cycleNumber', type: 'uint48' },
      { name: 'id', type: 'uint48' },
      { name: 'basedOnId', type: 'uint48' },
      { name: 'start', type: 'uint48' },
      { name: 'duration', type: 'uint32' },
      { name: 'weight', type: 'uint112' },
      { name: 'weightCutPercent', type: 'uint32' },
      { name: 'approvalHook', type: 'address' },
      { name: 'metadata', type: 'uint256' },
    ],
  }],
}] as const

const TERMINAL_FEE_CONTEXT_ABI = [{
  name: 'feeFreeSurplusOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
  ],
  outputs: [{ name: '', type: 'uint256' }],
}] as const

const FEELESS_ABI = [{
  name: 'isFeelessFor',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'addr', type: 'address' },
    { name: 'projectId', type: 'uint256' },
    { name: 'caller', type: 'address' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}] as const

describe.skipIf(!RUN_LIVE)('live Base Sepolia project fixture', () => {
  it('verifies project 9 NFT metadata and current payout configuration', async () => {
    const chainId = 84532
    const projectId = '9'
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_ENDPOINTS[chainId][0]),
    })
    const [ruleset, hook] = await Promise.all([
      client.readContract({
        address: JB_CONTRACTS.JBRulesets,
        abi: CURRENT_RULESET_ABI,
        functionName: 'currentOf',
        args: [BigInt(projectId)],
      }),
      getProjectDataHook(projectId, chainId),
    ])

    const rulesetId = ruleset.id.toString()
    expect(rulesetId).toMatch(/^\d+$/)
    expect(hook).toMatch(/^0x[a-fA-F0-9]{40}$/)
    if (!hook) {
      throw new Error('Live project fixture is missing its current ruleset or data hook')
    }

    const [tiers, splitConfiguration] = await Promise.all([
      fetchResolvedNFTTiers(hook, chainId),
      fetchProjectSplits(projectId, chainId, rulesetId),
    ])

    expect(tiers.length).toBeGreaterThan(0)
    expect(tiers.some(tier => tier.name !== `Tier ${tier.tierId}` && Boolean(tier.imageUri))).toBe(true)
    expect(splitConfiguration.configurationComplete).toBe(true)
    expect(splitConfiguration.payoutSplits).toEqual(expect.any(Array))
  }, 60_000)
})

describe.skipIf(!RUN_LIVE)('live Sepolia terminal route fixture', () => {
  it('previews native, USDC/router, and hook-aware cash-out routes', async () => {
    const chainId = 11155111
    const projectId = 7n
    const client = createPublicClient({
      chain: sepolia,
      transport: http(RPC_ENDPOINTS[chainId][0]),
    })
    const usdc = USDC_ADDRESSES[chainId]
    const [nativeRoute, usdcRoute] = await Promise.all([
      getPaymentTerminal(client, chainId, projectId, NATIVE_TOKEN),
      getPaymentTerminal(client, chainId, projectId, usdc),
    ])

    expect(nativeRoute.type).toBe('multi')
    expect(nativeRoute.address.toLowerCase()).toBe(JB_CONTRACTS.JBMultiTerminal.toLowerCase())
    expect(usdcRoute.type).toBe('router')

    const [nativePreview, usdcPreview] = await Promise.all([
      client.readContract({
        account: FIXTURE_ACCOUNT,
        address: nativeRoute.address,
        abi: TERMINAL_PREVIEW_PAY_ABI,
        functionName: 'previewPayFor',
        args: [projectId, NATIVE_TOKEN, 1_000_000_000_000n, FIXTURE_ACCOUNT, '0x'],
      }),
      client.readContract({
        account: FIXTURE_ACCOUNT,
        address: usdcRoute.address,
        abi: TERMINAL_PREVIEW_PAY_ABI,
        functionName: 'previewPayFor',
        args: [projectId, usdc, 10_000n, FIXTURE_ACCOUNT, '0x'],
      }),
    ])
    for (const preview of [nativePreview, usdcPreview]) {
      const outcome = resolvePayPreviewOutcome({
        beneficiaryTokenCount: preview[1],
        reservedTokenCount: preview[2],
        hookSpecifications: preview[3],
      })
      expect(outcome.beneficiaryTokenCount).toBeGreaterThan(0n)
      expect(outcome.minReturnedTokens).toBeGreaterThan(0n)
      expect(outcome.minReturnedTokens).toBeLessThanOrEqual(outcome.beneficiaryTokenCount)
    }

    const [cashOutPreview, feeFreeSurplus, beneficiaryIsFeeless] = await Promise.all([
      client.readContract({
        account: FIXTURE_ACCOUNT,
        address: nativeRoute.address,
        abi: TERMINAL_PREVIEW_CASH_OUT_ABI,
        functionName: 'previewCashOutFrom',
        args: [FIXTURE_ACCOUNT, projectId, 1_000_000_000_000_000n, NATIVE_TOKEN, FIXTURE_ACCOUNT, '0x'],
      }),
      client.readContract({
        address: nativeRoute.address,
        abi: TERMINAL_FEE_CONTEXT_ABI,
        functionName: 'feeFreeSurplusOf',
        args: [projectId, NATIVE_TOKEN],
      }),
      client.readContract({
        address: JB_CONTRACTS.JBFeelessAddresses,
        abi: FEELESS_ABI,
        functionName: 'isFeelessFor',
        args: [FIXTURE_ACCOUNT, projectId, FIXTURE_ACCOUNT],
      }),
    ])
    const cashOutOutcome = resolveCashOutPreviewOutcome({
      reclaimAmount: cashOutPreview[1],
      cashOutTaxRate: cashOutPreview[2],
      hookSpecifications: cashOutPreview[3],
      beneficiaryIsFeeless,
      feeFreeSurplus,
    })
    expect(cashOutOutcome.expectedReturn).toBeGreaterThan(0n)
    expect(cashOutOutcome.minimumReturn).toBeGreaterThan(0n)
    expect(cashOutOutcome.minimumReturn).toBeLessThanOrEqual(cashOutOutcome.expectedReturn)
  }, 60_000)
})
