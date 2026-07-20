/**
 * Bridge-aware sucker config generation — mirrors the v6 SDK's semantics
 * (nana-sdk-core 91c2361) so this stays a drop-in swap for the SDK release.
 */

import { describe, expect, it } from 'vitest'
import {
  parseSuckerDeployerConfig,
  NATIVE_SUCKER_DEPLOYER_ADDRESSES,
  CCIP_SUCKER_DEPLOYER_ADDRESSES,
  NATIVE_TOKEN,
} from './suckerConfig'

const SALT = `0x${'ab'.repeat(32)}` as `0x${string}`
const USDC_MAINNET = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as `0x${string}`
const USDC_OP = '0x0b2c639c533813f4aa9d7837caf62653d097ff85' as `0x${string}`

describe('parseSuckerDeployerConfig bridge selection', () => {
  it('defaults to CCIP-only (previous behavior of every caller)', () => {
    const cfg = parseSuckerDeployerConfig(1, [1, 10], { salt: SALT })
    expect(cfg.deployerConfigurations).toHaveLength(1)
    expect(cfg.deployerConfigurations[0].deployer).toBe(CCIP_SUCKER_DEPLOYER_ADDRESSES[1][10])
  })

  it('native: L1<->L2 uses the verified native deployer and maps only the native token', () => {
    const cfg = parseSuckerDeployerConfig(1, [1, 10], { salt: SALT, bridge: 'native' })
    expect(cfg.deployerConfigurations).toHaveLength(1)
    expect(cfg.deployerConfigurations[0].deployer).toBe(NATIVE_SUCKER_DEPLOYER_ADDRESSES[1][10])
    expect(cfg.deployerConfigurations[0].mappings[0].localToken.toLowerCase()).toBe(NATIVE_TOKEN.toLowerCase())
  })

  it('native: L2<->L2 throws (native bridges only connect Ethereum with an L2)', () => {
    expect(() => parseSuckerDeployerConfig(10, [10, 8453], { salt: SALT, bridge: 'native' }))
      .toThrow(/No native bridge/)
  })

  it('native: USDC mapping throws (bridge-wrapped tokens would strand funds)', () => {
    expect(() => parseSuckerDeployerConfig(1, [1, 10], {
      salt: SALT,
      bridge: 'native',
      tokenAddresses: { 1: USDC_MAINNET, 10: USDC_OP },
    })).toThrow(/native bridges/)
  })

  it('both: L1<->L2 emits one native AND one CCIP config', () => {
    const cfg = parseSuckerDeployerConfig(1, [1, 10], { salt: SALT, bridge: 'both' })
    const deployers = cfg.deployerConfigurations.map((c) => c.deployer)
    expect(deployers).toContain(NATIVE_SUCKER_DEPLOYER_ADDRESSES[1][10])
    expect(deployers).toContain(CCIP_SUCKER_DEPLOYER_ADDRESSES[1][10])
    expect(cfg.deployerConfigurations).toHaveLength(2)
  })

  it('both: pairs/assets native cannot serve fall back to CCIP alone', () => {
    // L2<->L2 pair: CCIP only.
    const l2 = parseSuckerDeployerConfig(10, [10, 8453], { salt: SALT, bridge: 'both' })
    expect(l2.deployerConfigurations).toHaveLength(1)
    expect(l2.deployerConfigurations[0].deployer).toBe(CCIP_SUCKER_DEPLOYER_ADDRESSES[10][8453])
    // USDC accounting: CCIP only, even on an L1<->L2 pair.
    const usdc = parseSuckerDeployerConfig(1, [1, 10], {
      salt: SALT,
      bridge: 'both',
      tokenAddresses: { 1: USDC_MAINNET, 10: USDC_OP },
    })
    expect(usdc.deployerConfigurations).toHaveLength(1)
    expect(usdc.deployerConfigurations[0].deployer).toBe(CCIP_SUCKER_DEPLOYER_ADDRESSES[1][10])
    expect(usdc.deployerConfigurations[0].mappings[0].localToken).toBe(USDC_MAINNET)
  })

  it('testnet pairs resolve the same native deployers as their mainnet twins', () => {
    const cfg = parseSuckerDeployerConfig(11155111, [11155111, 84532], { salt: SALT, bridge: 'native' })
    expect(cfg.deployerConfigurations[0].deployer).toBe(NATIVE_SUCKER_DEPLOYER_ADDRESSES[11155111][84532])
    expect(cfg.deployerConfigurations[0].deployer).toBe(NATIVE_SUCKER_DEPLOYER_ADDRESSES[8453][1])
  })
})
