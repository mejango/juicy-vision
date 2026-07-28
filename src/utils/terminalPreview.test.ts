import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, type Address, type Hex } from 'viem'
import { JB_CONTRACTS } from '../constants'
import { CONTRACTS } from '../../shared/chains'
import { buildBuybackCashOutMetadata, cashOutProtocolFee, quotedOutputFloor, resolveCashOutPreviewOutcome, resolvePayPreviewOutcome, type TerminalHookSpecification } from './terminalPreview'

const BUYBACK = CONTRACTS.JBBuybackHook as Address
const POOL_ID = `0x${'12'.repeat(32)}` as Hex

function payMetadata(
  params: {
    beneficiary?: bigint
    reserved?: bigint
    minimumSwap?: bigint
    rawQuote?: bigint
  } = {}
): Hex {
  return encodeAbiParameters(
    [
      { type: 'bool' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'bool' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'int24' },
      { type: 'uint128' },
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'bool' },
    ],
    [
      true,
      0n,
      params.minimumSwap ?? 1_100n,
      false,
      JB_CONTRACTS.JBController,
      900n,
      10n ** 18n,
      100n,
      123,
      456n,
      POOL_ID,
      params.beneficiary ?? 1_000n,
      params.reserved ?? 100n,
      params.rawQuote ?? 1_200n,
      false,
    ]
  )
}

function cashOutMetadata(
  params: {
    minimumSwap?: bigint
    cashOutCount?: bigint
    netDirect?: bigint
    rawQuote?: bigint
    userSpecified?: boolean
  } = {}
): Hex {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'int24' }, { type: 'uint128' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'bool' }],
    [params.minimumSwap ?? 1_100n, params.cashOutCount ?? 100n, params.netDirect ?? 900n, -123, 456n, POOL_ID, params.rawQuote ?? 1_200n, params.userSpecified ?? false]
  )
}

function specification(noop: boolean, metadata: Hex): TerminalHookSpecification {
  return { hook: BUYBACK, noop, amount: 0n, metadata }
}

describe('website-compatible terminal preview outcomes', () => {
  it('floors the issuance minimum 1% below the quoted beneficiary count', () => {
    // Issuance can change between the final preview and inclusion (weight-cut
    // rollover, revnet stage boundary, queued ruleset activation) — an exact
    // minimum turns every boundary crossing into JBMultiTerminal_UnderMin.
    expect(
      resolvePayPreviewOutcome({
        beneficiaryTokenCount: 1_000n,
        reservedTokenCount: 100n,
        hookSpecifications: [],
      })
    ).toEqual({
      route: 'issuance',
      beneficiaryTokenCount: 1_000n,
      reservedTokenCount: 100n,
      minReturnedTokens: 990n,
      buyback: null,
    })
  })

  it('keeps a verified zero issuance quote at a zero minimum', () => {
    const outcome = resolvePayPreviewOutcome({
      beneficiaryTokenCount: 0n,
      reservedTokenCount: 0n,
      hookSpecifications: [],
    })
    expect(outcome.route).toBe('issuance')
    expect(outcome.minReturnedTokens).toBe(0n)
  })

  it('uses buyback metadata when the AMM route zeroes the top-level pay counts', () => {
    const outcome = resolvePayPreviewOutcome({
      beneficiaryTokenCount: 0n,
      reservedTokenCount: 0n,
      hookSpecifications: [specification(false, payMetadata())],
    })
    expect(outcome.route).toBe('amm')
    expect(outcome.beneficiaryTokenCount).toBe(1_000n)
    expect(outcome.reservedTokenCount).toBe(100n)
    expect(outcome.minReturnedTokens).toBe(990n)
    expect(outcome.buyback?.rawSwapQuote).toBe(1_200n)
  })

  it('keeps a noop buyback payment on issuance, with the same 1% floor', () => {
    const outcome = resolvePayPreviewOutcome({
      beneficiaryTokenCount: 900n,
      reservedTokenCount: 100n,
      hookSpecifications: [specification(true, payMetadata())],
    })
    expect(outcome.route).toBe('issuance')
    expect(outcome.minReturnedTokens).toBe(891n)
  })

  it.each([
    ['non-zero tax', 1_000n, 1n, false, 0n, 25n],
    ['zero tax without fee-free surplus', 1_000n, 0n, false, 0n, 0n],
    ['zero tax with partial fee-free surplus', 1_000n, 0n, false, 400n, 10n],
    ['zero tax with excess fee-free surplus', 1_000n, 0n, false, 2_000n, 25n],
    ['feeless beneficiary', 1_000n, 1n, true, 2_000n, 0n],
  ])('calculates the exact protocol fee for %s', (_label, reclaim, tax, feeless, feeFree, expected) => {
    expect(
      cashOutProtocolFee({
        reclaimAmount: reclaim,
        cashOutTaxRate: tax,
        beneficiaryIsFeeless: feeless,
        feeFreeSurplus: feeFree,
      })
    ).toBe(expected)
  })

  it('floors the exact fee-adjusted treasury net', () => {
    const outcome = resolveCashOutPreviewOutcome({
      reclaimAmount: 1_000n,
      cashOutTaxRate: 1n,
      hookSpecifications: [],
      beneficiaryIsFeeless: false,
      feeFreeSurplus: 0n,
    })
    expect(outcome.route).toBe('treasury')
    expect(outcome.treasuryProtocolFee).toBe(25n)
    expect(outcome.expectedReturn).toBe(975n)
    expect(outcome.terminalMinimum).toBe(965n)
  })

  it('moves the buyback floor into hook metadata and sets terminal minimum to zero', () => {
    const outcome = resolveCashOutPreviewOutcome({
      reclaimAmount: 0n,
      cashOutTaxRate: 10_000n,
      hookSpecifications: [specification(false, cashOutMetadata())],
      buybackHookAddress: BUYBACK,
      beneficiaryIsFeeless: false,
      feeFreeSurplus: 0n,
    })
    expect(outcome.route).toBe('amm')
    expect(outcome.expectedReturn).toBe(1_200n)
    expect(outcome.minimumReturn).toBe(1_188n)
    expect(outcome.terminalMinimum).toBe(0n)
    expect(outcome.metadata).not.toBe('0x')
    expect(outcome.metadata.slice(66, 74)).toBe('f10fae59')
  })

  it('preserves an explicit buyback cash-out floor when the locked route is re-previewed', () => {
    const outcome = resolveCashOutPreviewOutcome({
      reclaimAmount: 0n,
      cashOutTaxRate: 10_000n,
      hookSpecifications: [
        specification(
          false,
          cashOutMetadata({
            minimumSwap: 1_188n,
            rawQuote: 0n,
            userSpecified: true,
          })
        ),
      ],
      buybackHookAddress: BUYBACK,
      beneficiaryIsFeeless: false,
      feeFreeSurplus: 0n,
    })
    expect(outcome.route).toBe('amm')
    expect(outcome.minimumReturn).toBe(1_188n)
    expect(outcome.metadata).toBe(buildBuybackCashOutMetadata(BUYBACK, 1_188n))
  })

  it('keeps a noop buyback cash out on the exact treasury path', () => {
    const outcome = resolveCashOutPreviewOutcome({
      reclaimAmount: 1_000n,
      cashOutTaxRate: 1n,
      hookSpecifications: [specification(true, cashOutMetadata())],
      beneficiaryIsFeeless: false,
      feeFreeSurplus: 0n,
    })
    expect(outcome.route).toBe('treasury')
    expect(outcome.metadata).toBe('0x')
    expect(outcome.expectedReturn).toBe(975n)
  })

  it('matches website output-floor rounding', () => {
    expect(quotedOutputFloor(1n, 9_900n)).toBe(1n)
    expect(quotedOutputFloor(0n, 9_900n)).toBe(0n)
    expect(quotedOutputFloor(1_000n, 9_900n)).toBe(990n)
  })

  it('builds the canonical cashOut metadata envelope', () => {
    const metadata = buildBuybackCashOutMetadata(BUYBACK, 123n)
    expect(metadata.slice(2, 66)).toBe('00'.repeat(32))
    expect(metadata.slice(66, 74)).toBe('f10fae59')
    expect(metadata.length).toBe(2 + (32 + 32 + 64) * 2)
  })
})
