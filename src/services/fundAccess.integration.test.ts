import { describe, expect, it } from 'vitest'
import { keccak256, type Address } from 'viem'
import { ALL_VIEM_CHAINS, JB_CONTRACTS } from '../constants'
import {
  createFundAccessClient,
  FUND_ACCESS_CONTROLLER_ABI,
  FUND_ACCESS_STORE_ABI,
  FUND_ACCESS_TERMINAL_ABI,
  readFundAccessContexts,
} from './fundAccess'

const RUN_LIVE = process.env.RUN_CHAIN_INTEGRATION === 'true'

// nana-core-v6/deployments/ethereum artifacts identify this release as
// npm:@bananapus/core-v6@1.0.2, solcInputHash cfbbbe1970014dd4b8a333a760a7fc99.
// These are the deployed runtime hashes (including constructor immutables),
// not the artifact's pre-immutable deployedBytecode template hashes.
const EXPECTED_CODE_HASHES = [
  [JB_CONTRACTS.JBMultiTerminal, '0x42858668218d32f236473bf470b30fe4d498fd4a7eb18620aac05bfc484063fb'],
  [JB_CONTRACTS.JBTerminalStore, '0x9feb48869b4c4633ce9198dff564fd137143d7accc5aa21a9204537739df92b6'],
  [JB_CONTRACTS.JBRulesets, '0x0cc3d3bb1058ffeebc2c361b821114a1c94293a90b5f7f88ae0cd962d92637ec'],
  [JB_CONTRACTS.JBPrices, '0x17991e010077b83a8edee63a3f202582d4a8940a5d2fc4609d97c6295f42d432'],
  [JB_CONTRACTS.JBFundAccessLimits, '0x8095da88602baa815a7113fda962cabce73cf1a517398d141375e3f3d0b30381'],
  [JB_CONTRACTS.JBController, '0x4c39ff1b4f602a48afd96307873f723f062518e99c6d6451a120ce0c41e65ad2'],
  [JB_CONTRACTS.JBDirectory, '0x7a4a5068c85e9410aad8c001130d7f3ecdde641988f150f1edfc769af7cca644'],
] as const satisfies readonly (readonly [Address, `0x${string}`])[]

describe.skipIf(!RUN_LIVE)('deployed V6 fund access identities', () => {
  it.each(Object.values(ALL_VIEM_CHAINS))(
    'matches core-v6 1.0.2 bytecode and dependency bindings on $name',
    async chain => {
      const client = createFundAccessClient(chain.id)
      const [hashes, store, prices, rulesets, fundAccessLimits] = await Promise.all([
        Promise.all(EXPECTED_CODE_HASHES.map(async ([address]) => {
          const bytecode = await client.getBytecode({ address })
          if (!bytecode) throw new Error(`No deployed bytecode at ${address}`)
          return keccak256(bytecode)
        })),
        client.readContract({
          address: JB_CONTRACTS.JBMultiTerminal,
          abi: FUND_ACCESS_TERMINAL_ABI,
          functionName: 'STORE',
        }),
        client.readContract({
          address: JB_CONTRACTS.JBTerminalStore,
          abi: FUND_ACCESS_STORE_ABI,
          functionName: 'PRICES',
        }),
        client.readContract({
          address: JB_CONTRACTS.JBTerminalStore,
          abi: FUND_ACCESS_STORE_ABI,
          functionName: 'RULESETS',
        }),
        client.readContract({
          address: JB_CONTRACTS.JBController,
          abi: FUND_ACCESS_CONTROLLER_ABI,
          functionName: 'FUND_ACCESS_LIMITS',
        }),
      ])

      expect(hashes).toEqual(EXPECTED_CODE_HASHES.map(([, hash]) => hash))
      expect(store.toLowerCase()).toBe(JB_CONTRACTS.JBTerminalStore.toLowerCase())
      expect(prices.toLowerCase()).toBe(JB_CONTRACTS.JBPrices.toLowerCase())
      expect(rulesets.toLowerCase()).toBe(JB_CONTRACTS.JBRulesets.toLowerCase())
      expect(fundAccessLimits.toLowerCase()).toBe(JB_CONTRACTS.JBFundAccessLimits.toLowerCase())
    },
    60_000,
  )

  it('reads a complete live accounting/fund-access snapshot for Base Sepolia project 9', async () => {
    const contexts = await readFundAccessContexts(createFundAccessClient(84_532), 84_532, 9n)
    expect(contexts.length).toBeGreaterThan(0)
    for (const context of contexts) {
      expect(context.rulesetId).toBeGreaterThan(0n)
      expect(context.rulesetCycleNumber).toBeGreaterThan(0n)
      expect(context.accountingCurrency).toBeGreaterThanOrEqual(0n)
      expect(context.decimals).toBeGreaterThanOrEqual(0)
      expect(context.balance).toBeGreaterThanOrEqual(0n)
      expect(context.currentSurplus).toBeGreaterThanOrEqual(0n)
      for (const item of [...context.payoutLimits, ...context.surplusAllowances]) {
        expect(item.used).toBeGreaterThanOrEqual(0n)
        expect(item.remaining).toBeGreaterThanOrEqual(0n)
        expect(item.available).toBeLessThanOrEqual(item.remaining)
        expect(item.available).toBeLessThanOrEqual(item.sourceInCurrency)
        expect(item.pricePerUnit).toBeGreaterThan(0n)
      }
    }
  }, 60_000)
})
