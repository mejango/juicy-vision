// The pay-side interpretation lives in shared/ so the Deno backend — whose
// import map resolves @shared/ but no npm packages — can consume it too. The
// cash-out fee/floor/metadata math is canonical in @bananapus/nana-sdk-core/v6;
// the frontend uses the SDK directly, with thin wrappers preserving this
// module's original signatures. (The backend keeps shared/'s cash-out copy for
// the same import-map reason.)
import type { Address, Hex } from 'viem'
import {
  buildBuybackCashOutMetadata as sdkBuildBuybackCashOutMetadata,
  slippageFloor,
} from '@bananapus/nana-sdk-core/v6'

export {
  resolvePayPreviewOutcome,
  TERMINAL_PREVIEW_CASH_OUT_ABI,
  TERMINAL_PREVIEW_PAY_ABI,
  type TerminalHookSpecification,
} from '../../shared/terminalPreview.ts'

export {
  cashOutProtocolFee,
  resolveCashOutRoute as resolveCashOutPreviewOutcome,
  type CashOutRoute as CashOutPreviewOutcome,
} from '@bananapus/nana-sdk-core/v6'

/**
 * Floor a quoted output to `retainedBps`/10,000 of itself, never below 1 for a
 * positive quote. The retained-bps convention is the complement of the SDK's
 * slippage-bps convention (retained 9,900 = slippage 100).
 */
export function quotedOutputFloor(quoted: bigint, retainedBps: bigint = 9_900n): bigint {
  return slippageFloor(quoted, 10_000n - retainedBps)
}

/** Positional-argument form of the SDK's `buildBuybackCashOutMetadata`. */
export function buildBuybackCashOutMetadata(
  hook: Address,
  minimumSwapAmountOut: bigint,
  skip = false,
): Hex {
  return sdkBuildBuybackCashOutMetadata({ hook, minimumSwapAmountOut, skip })
}
