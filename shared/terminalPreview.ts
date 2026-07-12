import {
  type Address,
  decodeAbiParameters,
  encodeAbiParameters,
  type Hex,
  keccak256,
  toHex,
} from 'viem';
import { CONTRACTS } from './chains.ts';

export interface TerminalHookSpecification {
  hook: Address;
  noop: boolean;
  amount: bigint;
  metadata: Hex;
}

const TERMINAL_RULESET_PREVIEW_COMPONENTS = [
  { name: 'cycleNumber', type: 'uint256' },
  { name: 'id', type: 'uint256' },
  { name: 'basedOnId', type: 'uint256' },
  { name: 'start', type: 'uint256' },
  { name: 'duration', type: 'uint256' },
  { name: 'weight', type: 'uint256' },
  { name: 'weightCutPercent', type: 'uint256' },
  { name: 'approvalHook', type: 'address' },
  { name: 'metadata', type: 'uint256' },
] as const;

const TERMINAL_HOOK_SPECIFICATION_COMPONENTS = [
  { name: 'hook', type: 'address' },
  { name: 'noop', type: 'bool' },
  { name: 'amount', type: 'uint256' },
  { name: 'metadata', type: 'bytes' },
] as const;

/** Canonical ABI fragments shared by every pay-preview entry point. */
export const TERMINAL_PREVIEW_PAY_ABI = [{
  name: 'previewPayFor',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'beneficiary', type: 'address' },
    { name: 'metadata', type: 'bytes' },
  ],
  outputs: [
    { name: 'ruleset', type: 'tuple', components: TERMINAL_RULESET_PREVIEW_COMPONENTS },
    { name: 'beneficiaryTokenCount', type: 'uint256' },
    { name: 'reservedTokenCount', type: 'uint256' },
    {
      name: 'hookSpecifications',
      type: 'tuple[]',
      components: TERMINAL_HOOK_SPECIFICATION_COMPONENTS,
    },
  ],
}] as const;

/** Canonical ABI fragments shared by every cash-out-preview entry point. */
export const TERMINAL_PREVIEW_CASH_OUT_ABI = [{
  name: 'previewCashOutFrom',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'holder', type: 'address' },
    { name: 'projectId', type: 'uint256' },
    { name: 'cashOutCount', type: 'uint256' },
    { name: 'tokenToReclaim', type: 'address' },
    { name: 'beneficiary', type: 'address' },
    { name: 'metadata', type: 'bytes' },
  ],
  outputs: [
    { name: 'ruleset', type: 'tuple', components: TERMINAL_RULESET_PREVIEW_COMPONENTS },
    { name: 'reclaimAmount', type: 'uint256' },
    { name: 'cashOutTaxRate', type: 'uint256' },
    {
      name: 'hookSpecifications',
      type: 'tuple[]',
      components: TERMINAL_HOOK_SPECIFICATION_COMPONENTS,
    },
  ],
}] as const;

export const TERMINAL_PREVIEW_ABI = [
  ...TERMINAL_PREVIEW_PAY_ABI,
  ...TERMINAL_PREVIEW_CASH_OUT_ABI,
] as const;

const BUYBACK_PAY_METADATA = [
  { name: 'projectTokenIs0', type: 'bool' },
  { name: 'amountToMintWith', type: 'uint256' },
  { name: 'minimumSwapAmountOut', type: 'uint256' },
  { name: 'hasUserSpecifiedQuote', type: 'bool' },
  { name: 'controller', type: 'address' },
  { name: 'tokenCountWithoutHook', type: 'uint256' },
  { name: 'weightRatio', type: 'uint256' },
  { name: 'quotedAmountToSwapWith', type: 'uint256' },
  { name: 'twapTick', type: 'int24' },
  { name: 'twapLiquidity', type: 'uint128' },
  { name: 'poolId', type: 'bytes32' },
  { name: 'minimumBeneficiaryTokenCount', type: 'uint256' },
  { name: 'minimumReservedTokenCount', type: 'uint256' },
  { name: 'rawSwapQuote', type: 'uint256' },
  { name: 'oracleUnseeded', type: 'bool' },
] as const;

const BUYBACK_CASH_OUT_METADATA = [
  { name: 'minimumSwapAmountOut', type: 'uint256' },
  { name: 'cashOutCountToSell', type: 'uint256' },
  { name: 'netDirectCashOutAmount', type: 'uint256' },
  { name: 'twapTick', type: 'int24' },
  { name: 'twapLiquidity', type: 'uint128' },
  { name: 'poolId', type: 'bytes32' },
  { name: 'rawSwapQuote', type: 'uint256' },
  { name: 'hasUserSpecifiedMinimumSwapAmountOut', type: 'bool' },
] as const;

const BUYBACK_HOOK = CONTRACTS.JBBuybackHook.toLowerCase();
const BPS = 10_000n;

function requireBps(value: bigint): bigint {
  if (value < 0n || value > BPS) throw new Error('Slippage basis points are out of range');
  return value;
}

export function quotedOutputFloor(quoted: bigint, retainedBps: bigint = 9_900n): bigint {
  requireBps(retainedBps);
  if (quoted <= 0n) return 0n;
  const floor = (quoted * retainedBps) / BPS;
  return floor > 0n ? floor : 1n;
}

function buybackSpecification(
  specifications: readonly TerminalHookSpecification[],
): TerminalHookSpecification | null {
  return specifications.find((specification) =>
    specification.hook.toLowerCase() === BUYBACK_HOOK
  ) ?? null;
}

export interface PayPreviewOutcome {
  route: 'issuance' | 'amm';
  beneficiaryTokenCount: bigint;
  reservedTokenCount: bigint;
  minReturnedTokens: bigint;
  buyback: null | {
    hook: Address;
    minimumSwapAmountOut: bigint;
    rawSwapQuote: bigint;
    tokenCountWithoutHook: bigint;
    quotedAmountToSwapWith: bigint;
    poolId: Hex;
    oracleUnseeded: boolean;
  };
}

/**
 * Interpret JBMultiTerminal.previewPayFor exactly as the complete website flow does.
 * When the buyback hook wins, the terminal's top-level token counts are zero and
 * the beneficiary/reserved minima live in the hook specification metadata.
 */
export function resolvePayPreviewOutcome(params: {
  beneficiaryTokenCount: bigint;
  reservedTokenCount: bigint;
  hookSpecifications: readonly TerminalHookSpecification[];
  ammSlippageBps?: bigint;
}): PayPreviewOutcome {
  const specification = buybackSpecification(params.hookSpecifications);
  if (!specification || specification.noop) {
    return {
      route: 'issuance',
      beneficiaryTokenCount: params.beneficiaryTokenCount,
      reservedTokenCount: params.reservedTokenCount,
      // Issuance is deterministic. The website protects the exact preview.
      minReturnedTokens: params.beneficiaryTokenCount,
      buyback: null,
    };
  }
  if (specification.metadata === '0x') {
    throw new Error('Buyback payment preview metadata is missing');
  }

  const decoded = decodeAbiParameters(BUYBACK_PAY_METADATA, specification.metadata);
  const beneficiaryTokenCount = decoded[11];
  const reservedTokenCount = decoded[12];
  const slippageBps = requireBps(params.ammSlippageBps ?? 100n);

  return {
    route: 'amm',
    beneficiaryTokenCount,
    reservedTokenCount,
    minReturnedTokens: quotedOutputFloor(beneficiaryTokenCount, BPS - slippageBps),
    buyback: {
      hook: specification.hook,
      minimumSwapAmountOut: decoded[2],
      rawSwapQuote: decoded[13],
      tokenCountWithoutHook: decoded[5],
      quotedAmountToSwapWith: decoded[7],
      poolId: decoded[10],
      oracleUnseeded: decoded[14],
    },
  };
}

export function cashOutProtocolFee(params: {
  reclaimAmount: bigint;
  cashOutTaxRate: bigint;
  beneficiaryIsFeeless: boolean;
  feeFreeSurplus: bigint;
}): bigint {
  if (params.reclaimAmount <= 0n || params.beneficiaryIsFeeless) return 0n;
  if (params.cashOutTaxRate > 0n) return params.reclaimAmount / 40n;
  const feeable = params.reclaimAmount < params.feeFreeSurplus
    ? params.reclaimAmount
    : params.feeFreeSurplus;
  return feeable / 40n;
}

function metadataId(target: Address, purpose: string): string {
  const addressPrefix = target.slice(2, 10).toLowerCase();
  const purposePrefix = keccak256(toHex(purpose)).slice(2, 10);
  let result = '';
  for (let index = 0; index < 8; index += 2) {
    result += (
      Number.parseInt(addressPrefix.slice(index, index + 2), 16) ^
      Number.parseInt(purposePrefix.slice(index, index + 2), 16)
    ).toString(16).padStart(2, '0');
  }
  return result;
}

export function buildBuybackCashOutMetadata(
  hook: Address,
  minimumSwapAmountOut: bigint,
  skip = false,
): Hex {
  if (minimumSwapAmountOut < 0n) throw new Error('Cash out minimum cannot be negative');
  const encoded = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'bool' }],
    [minimumSwapAmountOut, skip],
  );
  return `0x${'00'.repeat(32)}${metadataId(hook, 'cashOut')}02${'00'.repeat(27)}${
    encoded.slice(2)
  }`;
}

export interface CashOutPreviewOutcome {
  route: 'treasury' | 'amm';
  expectedReturn: bigint;
  minimumReturn: bigint;
  terminalMinimum: bigint;
  metadata: Hex;
  treasuryGross: bigint;
  treasuryProtocolFee: bigint;
  treasuryNet: bigint;
  buyback: null | {
    hook: Address;
    cashOutCountToSell: bigint;
    netDirectCashOutAmount: bigint;
    minimumSwapAmountOut: bigint;
    rawSwapQuote: bigint;
    poolId: Hex;
    hasUserSpecifiedMinimumSwapAmountOut: boolean;
  };
}

/** Interpret a hook-aware cash-out preview and prepare the same protected route as website. */
export function resolveCashOutPreviewOutcome(params: {
  reclaimAmount: bigint;
  cashOutTaxRate: bigint;
  hookSpecifications: readonly TerminalHookSpecification[];
  beneficiaryIsFeeless: boolean;
  feeFreeSurplus: bigint;
  slippageBps?: bigint;
}): CashOutPreviewOutcome {
  const slippageBps = requireBps(params.slippageBps ?? 100n);
  const protocolFee = cashOutProtocolFee({
    reclaimAmount: params.reclaimAmount,
    cashOutTaxRate: params.cashOutTaxRate,
    beneficiaryIsFeeless: params.beneficiaryIsFeeless,
    feeFreeSurplus: params.feeFreeSurplus,
  });
  const treasuryNet = params.reclaimAmount - protocolFee;
  const specification = buybackSpecification(params.hookSpecifications);

  if (!specification) {
    return {
      route: 'treasury',
      expectedReturn: treasuryNet,
      minimumReturn: quotedOutputFloor(treasuryNet, BPS - slippageBps),
      terminalMinimum: quotedOutputFloor(treasuryNet, BPS - slippageBps),
      metadata: '0x',
      treasuryGross: params.reclaimAmount,
      treasuryProtocolFee: protocolFee,
      treasuryNet,
      buyback: null,
    };
  }
  if (specification.metadata === '0x') {
    throw new Error('Buyback cash out preview metadata is missing');
  }

  const decoded = decodeAbiParameters(BUYBACK_CASH_OUT_METADATA, specification.metadata);
  const buyback = {
    hook: specification.hook,
    minimumSwapAmountOut: decoded[0],
    cashOutCountToSell: decoded[1],
    netDirectCashOutAmount: decoded[2],
    poolId: decoded[5],
    rawSwapQuote: decoded[6],
    hasUserSpecifiedMinimumSwapAmountOut: decoded[7],
  };

  if (!specification.noop) {
    const quote = buyback.rawSwapQuote > 0n ? buyback.rawSwapQuote : buyback.minimumSwapAmountOut;
    // A re-preview with our metadata reports the already-protected explicit
    // minimum and no raw quote. Preserve that floor instead of discounting it
    // a second time.
    const minimumReturn = buyback.rawSwapQuote > 0n &&
        !buyback.hasUserSpecifiedMinimumSwapAmountOut
      ? quotedOutputFloor(quote, BPS - slippageBps)
      : buyback.minimumSwapAmountOut;
    if (quote <= 0n || minimumReturn <= buyback.netDirectCashOutAmount) {
      throw new Error('Buyback cash out route has no safe market advantage');
    }
    return {
      route: 'amm',
      expectedReturn: quote,
      minimumReturn,
      terminalMinimum: 0n,
      metadata: buildBuybackCashOutMetadata(specification.hook, minimumReturn),
      treasuryGross: params.reclaimAmount,
      treasuryProtocolFee: protocolFee,
      treasuryNet: buyback.netDirectCashOutAmount,
      buyback,
    };
  }

  return {
    route: 'treasury',
    expectedReturn: treasuryNet,
    minimumReturn: quotedOutputFloor(treasuryNet, BPS - slippageBps),
    terminalMinimum: quotedOutputFloor(treasuryNet, BPS - slippageBps),
    metadata: '0x',
    treasuryGross: params.reclaimAmount,
    treasuryProtocolFee: protocolFee,
    treasuryNet,
    buyback,
  };
}
