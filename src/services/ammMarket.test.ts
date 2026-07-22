/**
 * Unit tests for the Market subtab's pure math + encodings: tick math,
 * liquidity amounts, single-sided counterpart calc (order-independent),
 * default-range corridor clamps, 95% remove floors, add-liquidity plan
 * derivation, corridor reverify, and the log-scan folding.
 */

import { describe, expect, it } from 'vitest'
import { decodeAbiParameters, toEventSelector, zeroAddress, type Address } from 'viem'
import {
  assertPlanWithinCorridor,
  collectPoolLogs,
  deriveAddLiquidityPlan,
  lpAlignDown,
  lpAlignUp,
  lpCounterpart,
  lpDefaultRange,
  lpGetAmountsForLiquidity,
  lpGetLiquidityForAmounts,
  lpSqrtAtTick,
  LP_Q96,
  MAX_TICK,
  poolPriceFromSqrtP,
  prepareRemoveLiquidity,
  quotedOutputFloor,
  ticksFromPositionInfo,
  type PairToken,
  type PoolKey,
  type PoolLogScanState,
} from './ammMarket'

const TOKEN: Address = '0x00000000000000000000000000000000000000aa'
const USDC: Address = '0x00000000000000000000000000000000000000bb'
const HOOKS: Address = '0x00000000000000000000000000000000000000cc'
const RECIPIENT: Address = '0x00000000000000000000000000000000000000dd'

const ETH_PAIR: PairToken = { addr: zeroAddress, decimals: 18, symbol: 'ETH', isNative: true }
const USDC_PAIR: PairToken = { addr: USDC, decimals: 6, symbol: 'USDC', isNative: false }

/** ETH pool: native currency0 sorts first, project token is currency1. */
const ETH_KEY: PoolKey = { currency0: zeroAddress, currency1: TOKEN, fee: 10000, tickSpacing: 200, hooks: HOOKS }
/** USDC pool with the PROJECT TOKEN as currency0 (token < usdc here). */
const USDC_KEY_TOKEN_C0: PoolKey = { currency0: TOKEN, currency1: USDC, fee: 10000, tickSpacing: 200, hooks: HOOKS }

describe('lpSqrtAtTick', () => {
  it('returns exactly 2^96 at tick 0', () => {
    expect(lpSqrtAtTick(0)).toBe(LP_Q96)
  })

  it('is monotonically increasing and reciprocal across zero', () => {
    const ticks = [-887200, -100000, -200, -1, 0, 1, 200, 100000, 887200]
    for (let i = 1; i < ticks.length; i++) {
      expect(lpSqrtAtTick(ticks[i]) > lpSqrtAtTick(ticks[i - 1])).toBe(true)
    }
    // sqrt(1.0001^t) * sqrt(1.0001^-t) ≈ 2^96 (within rounding).
    for (const tick of [1, 200, 6931, 100000]) {
      const product = lpSqrtAtTick(tick) * lpSqrtAtTick(-tick)
      const target = LP_Q96 * LP_Q96
      const drift = product > target ? product - target : target - product
      expect(drift < target / 1_000_000_000n).toBe(true)
    }
  })

  it('matches 1.0001^(tick/2) to float precision', () => {
    for (const tick of [-50000, -200, 60, 12345]) {
      const approx = Math.sqrt(1.0001 ** tick) * 2 ** 96
      const exact = Number(lpSqrtAtTick(tick))
      expect(Math.abs(exact - approx) / approx).toBeLessThan(1e-9)
    }
  })

  it('throws beyond the usable tick range', () => {
    expect(() => lpSqrtAtTick(MAX_TICK + 1)).toThrow()
    expect(lpSqrtAtTick(MAX_TICK) > 0n).toBe(true)
  })
})

describe('tick alignment', () => {
  it('aligns down toward negative infinity', () => {
    expect(lpAlignDown(250, 200)).toBe(200)
    expect(lpAlignDown(-250, 200)).toBe(-400)
    expect(lpAlignDown(-200, 200)).toBe(-200)
    expect(lpAlignDown(0, 200)).toBe(0)
  })

  it('aligns up toward positive infinity', () => {
    expect(lpAlignUp(250, 200)).toBe(400)
    expect(lpAlignUp(-250, 200)).toBe(-200)
    expect(lpAlignUp(200, 200)).toBe(200)
  })
})

describe('ticksFromPositionInfo', () => {
  it('unpacks lower/upper ticks from positionInfo', () => {
    // info layout: tickUpper at bits 32-55, tickLower at bits 8-31.
    const tickLower = -600n & 0xffffffn
    const tickUpper = 1200n
    const info = (tickUpper << 32n) | (tickLower << 8n)
    expect(ticksFromPositionInfo(info)).toEqual({ tickLower: -600, tickUpper: 1200 })
  })
})

describe('liquidity amounts round-trip', () => {
  it('symmetric add: amounts for derived liquidity never exceed the inputs', () => {
    const sp = lpSqrtAtTick(0)
    const sa = lpSqrtAtTick(-6000)
    const sb = lpSqrtAtTick(6000)
    const amount0 = 10n ** 18n
    const amount1 = 10n ** 18n
    const liquidity = lpGetLiquidityForAmounts(sp, sa, sb, amount0, amount1)
    expect(liquidity > 0n).toBe(true)
    const need = lpGetAmountsForLiquidity(sp, sa, sb, liquidity)
    expect(need.amount0 <= amount0).toBe(true)
    expect(need.amount1 <= amount1).toBe(true)
    // Symmetric range around spot with equal budgets → both sides used substantially.
    expect(need.amount0 > (amount0 * 9n) / 10n).toBe(true)
    expect(need.amount1 > (amount1 * 9n) / 10n).toBe(true)
  })

  it('price below the range → all currency0; above → all currency1', () => {
    const sa = lpSqrtAtTick(1000)
    const sb = lpSqrtAtTick(2000)
    const liquidity = 10n ** 15n
    const below = lpGetAmountsForLiquidity(lpSqrtAtTick(0), sa, sb, liquidity)
    expect(below.amount1).toBe(0n)
    expect(below.amount0 > 0n).toBe(true)
    const above = lpGetAmountsForLiquidity(lpSqrtAtTick(3000), sa, sb, liquidity)
    expect(above.amount0).toBe(0n)
    expect(above.amount1 > 0n).toBe(true)
  })

  it('is order-independent in the range bounds', () => {
    const sp = lpSqrtAtTick(0)
    const sa = lpSqrtAtTick(-6000)
    const sb = lpSqrtAtTick(6000)
    const liquidity = 123456789n
    expect(lpGetAmountsForLiquidity(sp, sa, sb, liquidity)).toEqual(lpGetAmountsForLiquidity(sp, sb, sa, liquidity))
    expect(lpGetLiquidityForAmounts(sp, sa, sb, 10n ** 18n, 10n ** 18n)).toBe(
      lpGetLiquidityForAmounts(sp, sb, sa, 10n ** 18n, 10n ** 18n),
    )
  })
})

describe('lpCounterpart (single-sided + order-independent)', () => {
  it('round-trips pair→token→pair inside the range', () => {
    const p = 1
    const pa = 0.5
    const pb = 2
    const token = lpCounterpart(3, true, p, pa, pb)
    expect(token).not.toBeNull()
    expect(token! > 0).toBe(true)
    const pairBack = lpCounterpart(token!, false, p, pa, pb)
    expect(pairBack).not.toBeNull()
    expect(Math.abs(pairBack! - 3)).toBeLessThan(1e-9)
  })

  it('is single-sided PAIR at/above the range top (token side is 0)', () => {
    expect(lpCounterpart(3, true, 2, 0.5, 2)).toBe(0) // pair drives → token needed is 0
    expect(lpCounterpart(3, false, 2, 0.5, 2)).toBeNull() // token can't fund it at all
    expect(lpCounterpart(3, true, 5, 0.5, 2)).toBe(0)
  })

  it('is single-sided TOKEN at/below the range bottom (pair side is 0)', () => {
    expect(lpCounterpart(3, false, 0.5, 0.5, 2)).toBe(0) // token drives → pair needed is 0
    expect(lpCounterpart(3, true, 0.5, 0.5, 2)).toBeNull() // pair can't fund it
    expect(lpCounterpart(3, false, 0.1, 0.5, 2)).toBe(0)
  })

  it('rejects malformed inputs', () => {
    expect(lpCounterpart(0, true, 1, 0.5, 2)).toBeNull()
    expect(lpCounterpart(1, true, 0, 0.5, 2)).toBeNull()
    expect(lpCounterpart(1, true, 1, 2, 0.5)).toBeNull() // inverted range
  })
})

describe('lpDefaultRange corridor clamps', () => {
  it('uses the economic floor→ceiling corridor when it straddles spot', () => {
    expect(lpDefaultRange(1, 0.5, 2)).toEqual({ min: 0.5, max: 2, economic: true })
  })

  it('widens around spot when the corridor does not contain it', () => {
    // Spot above the ceiling.
    const above = lpDefaultRange(3, 0.5, 2)
    expect(above.economic).toBe(false)
    expect(above.min).toBe(1.5)
    expect(above.max).toBe(6)
    // Spot below the floor.
    const below = lpDefaultRange(0.4, 0.5, 2)
    expect(below.economic).toBe(false)
    expect(below.min).toBe(0.2)
    expect(below.max).toBeCloseTo(0.8)
  })

  it('handles a missing floor and a missing pool price', () => {
    const noFloor = lpDefaultRange(1, 0, 2)
    expect(noFloor.economic).toBe(false)
    expect(noFloor.min).toBe(0.5)
    expect(noFloor.max).toBe(2)
    const noSpot = lpDefaultRange(0, 0, 2)
    expect(noSpot.min).toBeCloseTo(0.2)
    expect(noSpot.max).toBe(2)
  })
})

describe('quotedOutputFloor (remove min floors)', () => {
  it('takes 95% at 9500 bps', () => {
    expect(quotedOutputFloor(1000n, 9500)).toBe(950n)
    expect(quotedOutputFloor(10n ** 18n, 9500)).toBe((10n ** 18n * 95n) / 100n)
  })

  it('clamps tiny positive quotes to 1 wei and zero to 0', () => {
    expect(quotedOutputFloor(1n, 9500)).toBe(1n)
    expect(quotedOutputFloor(0n, 9500)).toBe(0n)
  })

  it('defaults to 99%', () => {
    expect(quotedOutputFloor(10000n)).toBe(9900n)
  })
})

describe('prepareRemoveLiquidity', () => {
  const base = {
    tokenId: 42n,
    key: ETH_KEY,
    pairAmount: 10n ** 18n,
    tokenAmount: 5n * 10n ** 18n,
  }

  function decodePlan(unlockData: `0x${string}`) {
    const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], unlockData)
    const burn = decodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }],
      params[0],
    )
    const take = decodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], params[1])
    return { actions, burn, take }
  }

  it('encodes BURN_POSITION + TAKE_PAIR with 95% floors (pair = currency0)', () => {
    const plan = prepareRemoveLiquidity({ ...base, pairIsC0: true }, RECIPIENT, 1_000_000)
    expect(plan.pairMin).toBe((base.pairAmount * 95n) / 100n)
    expect(plan.tokenMin).toBe((base.tokenAmount * 95n) / 100n)
    expect(plan.deadline).toBe(1_001_200n)
    const { actions, burn, take } = decodePlan(plan.unlockData)
    expect(actions).toBe('0x0311')
    expect(burn[0]).toBe(42n)
    expect(burn[1]).toBe(plan.pairMin) // amount0Min = pair floor
    expect(burn[2]).toBe(plan.tokenMin) // amount1Min = token floor
    expect(take[2].toLowerCase()).toBe(RECIPIENT)
  })

  it('maps the floors to the opposite currency slots when the token is currency0', () => {
    const plan = prepareRemoveLiquidity({ ...base, key: USDC_KEY_TOKEN_C0, pairIsC0: false }, RECIPIENT, 1_000_000)
    const { burn, take } = decodePlan(plan.unlockData)
    expect(burn[1]).toBe(plan.tokenMin) // amount0Min = token floor
    expect(burn[2]).toBe(plan.pairMin) // amount1Min = pair floor
    expect(take[0].toLowerCase()).toBe(TOKEN)
    expect(take[1].toLowerCase()).toBe(USDC)
  })
})

describe('deriveAddLiquidityPlan', () => {
  // Pool priced 1:1 (raw) → for the 18-dec ETH pair, human price = 1 pair/token.
  const sqrtP = lpSqrtAtTick(0)

  it('two-sided add inside the range (ETH pair, pair = currency0)', () => {
    const plan = deriveAddLiquidityPlan({
      key: ETH_KEY,
      sqrtP,
      pair: ETH_PAIR,
      pairAmount: 10n ** 18n,
      tokenAmount: 10n ** 18n,
      pa: 0.5,
      pb: 2,
      recipient: RECIPIENT,
    })
    expect(plan.pairIsC0).toBe(true)
    expect(plan.liquidity > 0n).toBe(true)
    expect(plan.need.amount0 > 0n).toBe(true)
    expect(plan.need.amount1 > 0n).toBe(true)
    // Ticks aligned to spacing and straddling spot (tick 0).
    expect(plan.tickLower % 200 === 0).toBe(true)
    expect(plan.tickUpper % 200 === 0).toBe(true)
    expect(plan.tickLower < 0).toBe(true)
    expect(plan.tickUpper > 0).toBe(true)
    // 1% headroom maxes.
    expect(plan.amount0Max).toBe(plan.need.amount0 + plan.need.amount0 / 100n + 1n)
    expect(plan.amount1Max).toBe(plan.need.amount1 + plan.need.amount1 / 100n + 1n)
    // Native pair → msg.value is the pair max; only the project token goes through Permit2.
    expect(plan.value).toBe(plan.amount0Max)
    expect(plan.erc20Sides).toHaveLength(1)
    expect(plan.erc20Sides[0].currency.toLowerCase()).toBe(TOKEN)
    // MINT + CLOSE + CLOSE + SWEEP for a native pair.
    const [actions] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], plan.unlockData)
    expect(actions).toBe('0x02121214')
  })

  it('single-sided PAIR: keeps the current price outside (below) the range', () => {
    const plan = deriveAddLiquidityPlan({
      key: ETH_KEY,
      sqrtP,
      pair: ETH_PAIR,
      pairAmount: 10n ** 18n,
      tokenAmount: 0n,
      // Range top equals spot — alignment would nudge spot inside; the plan must push the range above it.
      pa: 0.5,
      pb: 1,
      recipient: RECIPIENT,
    })
    // Pair is currency0; funding only currency0 → range entirely above the current tick.
    expect(plan.tickLower > 0).toBe(true)
    expect(plan.need.amount1).toBe(0n)
    expect(plan.need.amount0 > 0n).toBe(true)
    expect(plan.value).toBe(plan.amount0Max)
    expect(plan.erc20Sides).toHaveLength(0)
  })

  it('single-sided TOKEN: keeps the current price outside (above) the range', () => {
    const plan = deriveAddLiquidityPlan({
      key: ETH_KEY,
      sqrtP,
      pair: ETH_PAIR,
      pairAmount: 0n,
      tokenAmount: 10n ** 18n,
      pa: 1,
      pb: 2,
      recipient: RECIPIENT,
    })
    // Token is currency1; funding only currency1 → range entirely at/below the current tick.
    expect(plan.tickUpper <= 0).toBe(true)
    expect(plan.need.amount0).toBe(0n)
    expect(plan.need.amount1 > 0n).toBe(true)
    // The un-needed NATIVE side still gets the website's `+ 1n` headroom, so
    // msg.value carries 1 wei of dust — SWEEP refunds it. Exact-port behavior.
    expect(plan.value).toBe(1n)
    expect(plan.erc20Sides).toHaveLength(1)
    expect(plan.erc20Sides[0].currency.toLowerCase()).toBe(TOKEN)
    // The pair is native, so SWEEP is still appended (refunds the 1-wei dust).
    const [actions] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], plan.unlockData)
    expect(actions).toBe('0x02121214')
  })

  it('is order-independent: token as currency0 mirrors the single-sided direction', () => {
    // USDC pair (6 decimals), project token is currency0. Human price 1 USDC/token
    // → raw currency1/currency0 = 1e6/1e18 = 1e-12 → tick ≈ log(1e-12)/log(1.0001).
    const rawTick = Math.round(Math.log(1e-12) / Math.log(1.0001) / 200) * 200
    const sqrtUsdc = lpSqrtAtTick(rawTick)
    // The tick the plan derives from the (round-up) sqrt price — can land one
    // below rawTick.
    const curTick = Math.floor((2 * Math.log(Number(sqrtUsdc) / 2 ** 96)) / Math.log(1.0001))
    // Funding only the TOKEN (currency0 here) forces the range ABOVE the current tick —
    // the same "all currency0" geometry as the pair-side case in the ETH pool.
    const plan = deriveAddLiquidityPlan({
      key: USDC_KEY_TOKEN_C0,
      sqrtP: sqrtUsdc,
      pair: USDC_PAIR,
      pairAmount: 0n,
      tokenAmount: 10n ** 18n,
      pa: 0.5,
      pb: 1,
      recipient: RECIPIENT,
    })
    expect(plan.pairIsC0).toBe(false)
    expect(plan.tickLower > curTick).toBe(true)
    expect(plan.need.amount1).toBe(0n) // no USDC needed
    expect(plan.need.amount0 > 0n).toBe(true)
    // ERC-20 pair → no msg.value, no SWEEP.
    expect(plan.value).toBe(0n)
    const [actions] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], plan.unlockData)
    expect(actions).toBe('0x021212')
    // Only the token side needs Permit2 (the USDC side is unfunded).
    expect(plan.erc20Sides).toHaveLength(1)
    expect(plan.erc20Sides[0].currency.toLowerCase()).toBe(TOKEN)
  })

  it('throws when the amounts cannot fund the range', () => {
    expect(() =>
      deriveAddLiquidityPlan({
        key: ETH_KEY,
        sqrtP,
        pair: ETH_PAIR,
        pairAmount: 0n,
        tokenAmount: 0n,
        pa: 0.5,
        pb: 2,
        recipient: RECIPIENT,
      }),
    ).toThrow('Amounts too small')
  })
})

describe('assertPlanWithinCorridor (submit-time reverify)', () => {
  const sqrtP = lpSqrtAtTick(0)
  const plan = deriveAddLiquidityPlan({
    key: ETH_KEY,
    sqrtP,
    pair: ETH_PAIR,
    pairAmount: 10n ** 18n,
    tokenAmount: 10n ** 18n,
    pa: 0.5,
    pb: 2,
    recipient: RECIPIENT,
  })

  it('passes at the reviewed price and within the 1% headroom', () => {
    expect(() => assertPlanWithinCorridor(plan, sqrtP)).not.toThrow()
    // ~0.5 bp move stays inside the 1% corridor.
    expect(() => assertPlanWithinCorridor(plan, lpSqrtAtTick(1))).not.toThrow()
  })

  it('aborts when the price moved beyond the corridor', () => {
    // ~3% price move → one side's requirement exceeds its baked max.
    expect(() => assertPlanWithinCorridor(plan, lpSqrtAtTick(300))).toThrow(/price moved/i)
    expect(() => assertPlanWithinCorridor(plan, lpSqrtAtTick(-300))).toThrow(/price moved/i)
  })

  it('rejects an unreadable pool price', () => {
    expect(() => assertPlanWithinCorridor(plan, 0n)).toThrow()
  })
})

describe('poolPriceFromSqrtP', () => {
  it('inverts for pair-as-currency0 and scales by decimals', () => {
    const sqrtP = lpSqrtAtTick(0) // raw price 1
    expect(poolPriceFromSqrtP(sqrtP, true, 18)).toBeCloseTo(1)
    expect(poolPriceFromSqrtP(sqrtP, false, 18)).toBeCloseTo(1)
    // 6-dec pair, token as c0, raw 1e-12 → human 1 pair/token.
    const rawTick = Math.log(1e-12) / Math.log(1.0001)
    const sqrtUsdc = lpSqrtAtTick(Math.round(rawTick))
    expect(poolPriceFromSqrtP(sqrtUsdc, false, 6)).toBeCloseTo(1, 2)
  })
})

describe('collectPoolLogs', () => {
  const POSM: Address = '0x1111111111111111111111111111111111111111'
  // Same signatures the service hashes — the fold must recognize exactly these.
  const INITIALIZE_TOPIC = toEventSelector('Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)')
  const MODIFY_TOPIC = toEventSelector('ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)')
  const POOL_ID = '0x' + 'ab'.repeat(32)

  function modifyLog(tokenId: bigint, sender: Address, block: number) {
    // data: tickLower, tickUpper, liquidityDelta, salt (4 words).
    const salt = tokenId.toString(16).padStart(64, '0')
    return {
      topics: [MODIFY_TOPIC, POOL_ID, '0x' + sender.slice(2).padStart(64, '0')],
      data: '0x' + '00'.repeat(96) + salt,
      blockNumber: BigInt(block),
    }
  }

  it('collects tokenIds from salts, keyed to the earliest block', () => {
    const state: PoolLogScanState = { initializeBlock: null, tokenIds: new Map() }
    collectPoolLogs([modifyLog(7n, POSM, 100), modifyLog(7n, POSM, 50), modifyLog(9n, POSM, 60)], POSM, state)
    expect([...state.tokenIds.keys()].sort()).toEqual(['7', '9'])
    expect(state.tokenIds.get('7')!.block).toBe(50n)
  })

  it('ignores ModifyLiquidity from senders other than the PositionManager', () => {
    const state: PoolLogScanState = { initializeBlock: null, tokenIds: new Map() }
    const stranger: Address = '0x2222222222222222222222222222222222222222'
    collectPoolLogs([modifyLog(7n, stranger, 100)], POSM, state)
    expect(state.tokenIds.size).toBe(0)
  })

  it('tracks the earliest Initialize block and ignores zero salts', () => {
    const state: PoolLogScanState = { initializeBlock: null, tokenIds: new Map() }
    collectPoolLogs(
      [
        { topics: [INITIALIZE_TOPIC, POOL_ID], data: '0x', blockNumber: 90n },
        { topics: [INITIALIZE_TOPIC, POOL_ID], data: '0x', blockNumber: 40n },
        modifyLog(0n, POSM, 95),
      ],
      POSM,
      state,
    )
    expect(state.initializeBlock).toBe(40n)
    expect(state.tokenIds.size).toBe(0)
  })

  it('throws on malformed ModifyLiquidity data', () => {
    const state: PoolLogScanState = { initializeBlock: null, tokenIds: new Map() }
    const bad = { topics: [MODIFY_TOPIC, POOL_ID, '0x' + POSM.slice(2).padStart(64, '0')], data: '0x1234', blockNumber: 1n }
    expect(() => collectPoolLogs([bad], POSM, state)).toThrow(/malformed/i)
  })
})
