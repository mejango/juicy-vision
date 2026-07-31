/**
 * Market (Uniswap V4 buyback pool) data + transaction layer for the Owners
 * tab's Market subtab. Ports website/src/discover.js:
 *   - pool state via buyback-hook poolKeyOf + PoolManager extsload slot0 (:20594)
 *   - LP position enumeration via PoolManager ModifyLiquidity log scan
 *     (salt = PositionManager tokenId) + per-position reads (:20725, :20781)
 *   - Uniswap V3/V4 tick + liquidity math, exact integer ports (:20547-20592)
 *   - add-liquidity planning: range corridor, single-sided support with
 *     order-independent counterpart math, MINT_POSITION/CLOSE_CURRENCY
 *     encoding (:21137)
 *   - remove-liquidity planning: BURN_POSITION/TAKE_PAIR with 95% min
 *     floors (:21367)
 *   - BannyLPSplitHook (JBP6FeeLPSplitHook) keeper reads/actions (:15172)
 *
 * Adaptations from the website:
 *   - ERC-20 sides settle through ON-CHAIN Permit2 approvals
 *     (Permit2.approve as a plain transaction) instead of a gasless
 *     signTypedData Permit2 signature folded into a PositionManager
 *     multicall. Managed (passkey smart-account) wallets cannot sign typed
 *     data, and a direct ERC-20 approve to the PositionManager would be
 *     useless — v4 PositionManager pulls ERC-20s exclusively through
 *     Permit2. The on-chain path works identically for both wallet modes
 *     and runs through the shared guarded runner.
 *   - The log scan caps its total range and tolerates RPC failure: it
 *     returns whatever it verified with `complete: false` so the UI can
 *     render a partial list with a note (the website rejects outright).
 */

import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  zeroAddress,
  type Address,
  type Abi,
  type Chain,
  type PublicClient,
} from "viem";
import {
  jbSplitsAbi,
  jbTerminalStoreAbi,
  type JBChainId,
} from "@bananapus/nana-sdk-core";
import {
  RESERVED_TOKEN_SPLIT_GROUP_ID,
  UNISWAP_PERMIT2_ADDRESS,
  UNISWAP_V4_INITIALIZE_TOPIC,
  UNISWAP_V4_MAX_TICK,
  UNISWAP_V4_MODIFY_LIQUIDITY_TOPIC,
  UNISWAP_V4_POOL_MANAGER_ADDRESSES,
  UNISWAP_V4_POSITION_MANAGER_ADDRESSES,
  UNISWAP_V4_Q96,
  UNISWAP_V4_QUOTER_ADDRESSES,
  getAccountingContexts,
  uniswapV4AlignTickDown,
  uniswapV4AlignTickUp,
  uniswapV4AmountsForLiquidity,
  uniswapV4CounterpartAmount,
  uniswapV4DefaultPriceRange,
  uniswapV4LiquidityForAmounts,
  uniswapV4PoolId,
  quoteUniswapV4ExactInputSingle,
  uniswapV4PoolStateSlot,
  uniswapV4PositionTicks,
  uniswapV4PositionTokenIdFromLog,
  uniswapV4PriceFromSqrtPriceX96,
  uniswapV4SqrtPriceX96AtTick,
  uniswapV4SqrtPriceX96FromSlot0,
  tokenCurrencyId,
  type UniswapV4PoolKey,
} from "@bananapus/nana-sdk-core/v6";
import {
  JB_BUYBACK_HOOK,
  JB_BUYBACK_HOOK_REGISTRY,
  JB_CONTRACTS,
  JB_OMNICHAIN_DEPLOYER,
  NATIVE_TOKEN,
  REV_OWNER,
} from "../constants";
import { ALL_VIEM_CHAINS } from "../constants/chains";
import { JB_CONTROLLER_ABI } from "../constants/abis/jbController";
import { getProjectController } from "../utils/paymentTerminal";
import { publicClientFor } from "./projectTx";

// ---------------------------------------------------------------------------
// Addresses (ported from website/src/discover.js; cross-checked against
// hookmate AddressConstants.sol — the address book JB's own router uses).
// ---------------------------------------------------------------------------

type AddressByChain = Readonly<Partial<Record<number, Address>>>;

export const POOL_MANAGER_BY_CHAIN =
  UNISWAP_V4_POOL_MANAGER_ADDRESSES as AddressByChain;

/** OP Sepolia (11155420) has no PositionManager → no LP there. */
export const POSITION_MANAGER_BY_CHAIN =
  UNISWAP_V4_POSITION_MANAGER_ADDRESSES as AddressByChain;

/**
 * Uniswap V4 Quoter (v4-periphery) per chain — the read-only quoter that runs
 * the pool's beforeSwap hook, so `quoteExactInputSingle` already reflects the
 * buyback hook's optimal routing (full AMM output when the AMM wins, the JB
 * issuance beneficiary otherwise). Sourced from website/src/discover.js
 * (V4_QUOTER_BY_CHAIN) and cross-checked against Uniswap's canonical V4Quoter
 * deployments. Chains absent here (e.g. OP Sepolia 11155420 — no V4 Quoter
 * deployed) gate the direct-swap offer OFF rather than guess an address.
 */
const V4_QUOTER_BY_CHAIN = UNISWAP_V4_QUOTER_ADDRESSES as AddressByChain;

/** Canonical Permit2 singleton (same on all chains). */
export const PERMIT2_ADDRESS = UNISWAP_PERMIT2_ADDRESS;

/**
 * BannyLPSplitHook (deployment name JBP6FeeLPSplitHook) — same address on
 * every deployed chain; absent on OP Sepolia (11155420).
 */
const BANNY_LP_SPLIT_HOOK: Address =
  "0xae6705c33c8b46f56878a1d4f1ce4d75fcfb6f62";
const BANNY_LP_SPLIT_HOOK_CHAINS = new Set([
  1, 10, 8453, 42161, 11155111, 84532, 421614,
]);

export function splitHookAddressFor(chainId: number): Address | null {
  return BANNY_LP_SPLIT_HOOK_CHAINS.has(chainId) ? BANNY_LP_SPLIT_HOOK : null;
}

/** Whether a chain has the full V4 LP surface (pool reads + positions). */
export function ammChainAvailable(chainId: number): boolean {
  return Boolean(
    POOL_MANAGER_BY_CHAIN[chainId] && POSITION_MANAGER_BY_CHAIN[chainId],
  );
}

/**
 * The V4 PoolManager (singleton per chain) custodies all pooled tokens, so a
 * buyback pool's project tokens show up in the owners list under the PoolManager
 * address. Flag those rows as the AMM (website isAmmAddress :3151).
 */
const AMM_ADDRESSES = new Set(
  Object.values(POOL_MANAGER_BY_CHAIN)
    .filter((address): address is Address => Boolean(address))
    .map((address) => address.toLowerCase()),
);
export function isAmmAddress(address: string | null | undefined): boolean {
  return Boolean(address && AMM_ADDRESSES.has(address.toLowerCase()));
}

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

const poolKeyOfAbi = [
  {
    type: "function",
    name: "poolKeyOf",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
    outputs: [{ name: "key", type: "tuple", components: POOL_KEY_COMPONENTS }],
  },
] as const;

const extsloadAbi = [
  {
    type: "function",
    name: "extsload",
    stateMutability: "view",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const positionViewAbi = [
  {
    type: "function",
    name: "positionInfo",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getPoolAndPositionInfo",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "poolKey", type: "tuple", components: POOL_KEY_COMPONENTS },
      { name: "info", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getPositionLiquidity",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
] as const;

const positionManagerAbi = [
  {
    type: "function",
    name: "modifyLiquidities",
    stateMutability: "payable",
    inputs: [
      { name: "unlockData", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "address" }],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

const buybackRegistryAbi = [
  {
    type: "function",
    name: "hookOf",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

const omnichainExtraHookAbi = [
  {
    type: "function",
    name: "extraDataHookOf",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "rulesetId", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "dataHook", type: "address" },
          { name: "useDataHookForPay", type: "bool" },
          { name: "useDataHookForCashOut", type: "bool" },
        ],
      },
    ],
  },
] as const;

/**
 * BannyLPSplitHook reads + permissionless keeper actions, with the hook's
 * custom errors so a reverting simulation decodes to the real reason.
 */
const bannyLpSplitHookAbi = [
  {
    type: "function",
    name: "initialWeightOf",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "accumulatedProjectTokens",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "hasDeployedPool",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "claimableFeeTokens",
    stateMutability: "view",
    inputs: [{ name: "projectId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenIdOf",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "activeTickLowerOf",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
    outputs: [{ type: "int24" }],
  },
  {
    type: "function",
    name: "activeTickUpperOf",
    stateMutability: "view",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
    outputs: [{ type: "int24" }],
  },
  {
    type: "function",
    name: "deployPool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "minCashOutReturn", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addLiquidity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
      { name: "minCashOutReturn", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "collectAndRouteLPFees",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimFeeTokensFor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_ZeroLiquidity",
    inputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_InsufficientLiquidity",
    inputs: [{ name: "liquidity", type: "uint128" }],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_InsufficientBalance",
    inputs: [
      { name: "available", type: "uint256" },
      { name: "required", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_NoTokensAccumulated",
    inputs: [{ name: "projectId", type: "uint256" }],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_PoolAlreadyDeployed",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_OnlyOneTerminalTokenSupported",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_InvalidStageForAction",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_TwapUnavailable",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_PriceDeviationTooHigh",
    inputs: [
      { name: "spotTick", type: "int24" },
      { name: "twapTick", type: "int24" },
      { name: "maxDeviationTicks", type: "int24" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHook_InvalidTerminalToken",
    inputs: [
      { name: "projectId", type: "uint256" },
      { name: "terminalToken", type: "address" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHookMath_InvalidTickBounds",
    inputs: [
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
    ],
  },
  {
    type: "error",
    name: "JBUniswapV4LPSplitHookMath_NoTerminalTokenFound",
    inputs: [{ name: "projectId", type: "uint256" }],
  },
] as const;

/** Map a decoded LP-hook revert to plain copy; null falls back to the raw message. */
export function lpHookErrorText(
  message: string,
  symbol: string,
): string | null {
  const m = String(message || "");
  if (/ZeroLiquidity|InvalidTickBounds|InsufficientLiquidity/.test(m)) {
    return `Not enough reserved ${symbol} has accumulated yet to seed a two-sided pool position. Let more reserved ${symbol} collect here, then try again.`;
  }
  if (/NoTokensAccumulated/.test(m))
    return `No reserved ${symbol} has accumulated here yet.`;
  if (/PoolAlreadyDeployed|OnlyOneTerminalTokenSupported/.test(m))
    return "A pool is already deployed for this project — use Add liquidity instead.";
  if (/InvalidStageForAction/.test(m))
    return "No pool exists for this token yet — deploy the pool first.";
  if (/Twap(Unavailable)?|PriceDeviationTooHigh/.test(m))
    return "The pool’s price is off its oracle average right now (or the oracle is still warming up). Try again shortly.";
  if (/InvalidTerminalToken|NoTerminalTokenFound/.test(m))
    return "The project has no priced terminal token to pair against.";
  return null;
}

// ---------------------------------------------------------------------------
// Tick + liquidity math — exact integer ports of v4-core TickMath /
// LiquidityAmounts (website :20547-20592).
// ---------------------------------------------------------------------------

export const LP_Q96 = UNISWAP_V4_Q96;
export const MAX_TICK = UNISWAP_V4_MAX_TICK;
export const lpSqrtAtTick = uniswapV4SqrtPriceX96AtTick;
export const lpGetLiquidityForAmounts = uniswapV4LiquidityForAmounts;
export const lpGetAmountsForLiquidity = uniswapV4AmountsForLiquidity;
export const lpAlignDown = uniswapV4AlignTickDown;
export const lpAlignUp = uniswapV4AlignTickUp;

/**
 * Concentrated-liquidity deposit counterpart (website :20406). Given one
 * side's amount, the current price `p` and the range [pa, pb] (all
 * pair-per-token, human), return the other side's amount. Order-independent:
 * works in human price space so the pool's currency ordering never matters.
 * driverIsPair=true → input is the pair (ETH/USDC), returns project token.
 * Outside the range it's single-sided: 0 for the side that isn't needed,
 * null when the requested side can't fund the position at all.
 */
export const lpCounterpart = uniswapV4CounterpartAmount;

/** Trim a float for an input field (no separators; ~6 significant digits). */
export function lpTrimNum(n: number): string {
  if (!isFinite(n) || n <= 0) return "0";
  if (n >= 1) return String(Math.round(n * 1e4) / 1e4);
  return String(Number(n.toPrecision(6)));
}

/**
 * Default price range (website :20429). Prefer the economic
 * [cash out floor, issuance ceiling] corridor when it contains spot; when it
 * is inverted, degenerate, or spot moved outside it, widen around the live
 * pool price so the default position is genuinely two-sided.
 */
export const lpDefaultRange = uniswapV4DefaultPriceRange;

/** A quoted output's minimum floor: `bps`/10000 of it, clamped to ≥ 1 wei when positive. */
export function quotedOutputFloor(
  quoted: bigint,
  bps: number | bigint = 9900n,
): bigint {
  if (quoted <= 0n) return 0n;
  const floor = (quoted * BigInt(bps)) / 10000n;
  return floor > 0n ? floor : 1n;
}

// ---------------------------------------------------------------------------
// Pair + pool resolution
// ---------------------------------------------------------------------------

/** The pool pair (terminal/accounting) token in Uniswap currency terms. */
export interface PairToken {
  /** Pool-currency address: zero for native ETH, else the ERC-20 (e.g. USDC). */
  addr: Address;
  decimals: number;
  symbol: string;
  isNative: boolean;
}

export type PoolKey = UniswapV4PoolKey;

export interface PoolState {
  key: PoolKey;
  sqrtP: bigint;
  pair: PairToken;
  poolId: `0x${string}`;
  pairIsC0: boolean;
  /** Human pair-per-token price at the current sqrtPriceX96. */
  poolPrice: number;
  /** The project's ERC-20 (the pool's non-pair currency). */
  projectToken: Address;
}

function clientFor(chainId: number): PublicClient {
  return publicClientFor(chainId) as PublicClient;
}

// The default RPCs (publicnode) now 403 the archive eth_getLogs the LP-position
// scan needs ("Archive requests require a personal token") — stranding the LP
// column on "Unavailable". Route the LP-position log scan ONLY through Tenderly's
// public gateways, which serve the address-filtered Initialize/ModifyLiquidity
// scan. All other reads still go through clientFor. Override per chain via
// localStorage['jb-lp-logs-rpc:<id>'] (e.g. your own archive endpoint — keeps
// API-key URLs out of the build). Mirrors website discover.js lpLogsClient.
const LP_LOGS_RPC: Record<number, string> = {
  1: "https://mainnet.gateway.tenderly.co",
  10: "https://optimism.gateway.tenderly.co",
  8453: "https://base.gateway.tenderly.co",
  42161: "https://arbitrum.gateway.tenderly.co",
  11155111: "https://sepolia.gateway.tenderly.co",
  11155420: "https://optimism-sepolia.gateway.tenderly.co",
  84532: "https://base-sepolia.gateway.tenderly.co",
  421614: "https://arbitrum-sepolia.gateway.tenderly.co",
};

function lpLogsClient(chainId: number): PublicClient {
  let override: string | null = null;
  try {
    override = localStorage.getItem(`jb-lp-logs-rpc:${chainId}`);
  } catch {
    /* SSR / no storage */
  }
  const url = override || LP_LOGS_RPC[chainId];
  if (!url) return clientFor(chainId); // no gateway mapped → fall back (best effort)
  const chain = (ALL_VIEM_CHAINS as Record<number, Chain>)[chainId];
  return createPublicClient({ chain, transport: http(url) }) as PublicClient;
}

/**
 * The buyback pool's PAIR token for a project on a chain — its Uniswap
 * pool-currency address (native ETH = zero address), decimals, and symbol.
 * ALWAYS the project's accounting token (workspace-verified: USDC pools key
 * poolKeyOf by the pair token; never assume native).
 */
async function resolvePairToken(
  chainId: number,
  projectId: bigint,
  client: PublicClient = clientFor(chainId),
): Promise<PairToken | null> {
  try {
    const contexts = await getAccountingContexts(client, {
      chainId: chainId as JBChainId,
      projectId,
    });
    if (!contexts.length) return null;
    const context = contexts[0];
    const isNative = context.token.toLowerCase() === NATIVE_TOKEN.toLowerCase();
    let symbol = "TOKEN";
    if (isNative) symbol = "ETH";
    else {
      symbol = await client
        .readContract({
          address: context.token,
          abi: erc20Abi,
          functionName: "symbol",
        })
        .catch(() => "TOKEN");
    }
    return {
      addr: isNative ? zeroAddress : (context.token.toLowerCase() as Address),
      decimals: Number(context.decimals),
      symbol,
      isNative,
    };
  } catch {
    return null;
  }
}

interface DataHookInfo {
  hook: Address;
  rulesetId: bigint;
  weight: bigint;
}

async function projectDataHook(
  projectId: bigint,
  client: PublicClient,
): Promise<DataHookInfo | null> {
  try {
    const controller = await getProjectController(client, projectId);
    if (!controller || controller === zeroAddress) return null;
    const [ruleset, metadata] = await client.readContract({
      address: controller,
      abi: JB_CONTROLLER_ABI,
      functionName: "currentRulesetOf",
      args: [projectId],
    });
    return {
      hook: (metadata.dataHook || zeroAddress) as Address,
      rulesetId: BigInt(ruleset.id),
      weight: BigInt(ruleset.weight),
    };
  } catch {
    return null;
  }
}

/**
 * The project's ACTUAL buyback hook on a chain, or null when it has no
 * buyback pool. Resolution goes by DATA-HOOK RECOGNITION (workspace rule:
 * never trust hookOf/terminalOf registry defaults for a project that doesn't
 * route through the registry):
 *   registry or REVOwner data hook → registry.hookOf(projectId)
 *   omnichain deployer → unwrap extraDataHookOf and recognize THAT
 *   the concrete JBBuybackHook wired directly → itself
 *   anything else → null. readPoolState additionally null-gates on an
 *   uninitialized pool, so a mis-recognized hook can't render a phantom pool.
 */
async function resolveBuybackHook(
  chainId: number,
  projectId: bigint,
  client: PublicClient = clientFor(chainId),
): Promise<Address | null> {
  const lc = (a: string | null | undefined) => (a || "").toLowerCase();

  const recognize = async (
    dataHook: Address | null,
  ): Promise<Address | null> => {
    if (!dataHook || dataHook === zeroAddress) return null;
    const d = lc(dataHook);
    if (d === lc(JB_BUYBACK_HOOK_REGISTRY) || d === lc(REV_OWNER)) {
      try {
        const hook = await client.readContract({
          address: JB_BUYBACK_HOOK_REGISTRY,
          abi: buybackRegistryAbi,
          functionName: "hookOf",
          args: [projectId],
        });
        return hook && hook !== zeroAddress ? hook : null;
      } catch {
        return null;
      }
    }
    if (d === lc(JB_BUYBACK_HOOK)) return dataHook;
    return null;
  };

  const info = await projectDataHook(projectId, client);
  if (!info || info.hook === zeroAddress) return null;
  if (lc(info.hook) === lc(JB_OMNICHAIN_DEPLOYER)) {
    try {
      const extra = await client.readContract({
        address: JB_OMNICHAIN_DEPLOYER,
        abi: omnichainExtraHookAbi,
        functionName: "extraDataHookOf",
        args: [projectId, info.rulesetId],
      });
      return recognize(extra.dataHook as Address);
    } catch {
      return null;
    }
  }
  return recognize(info.hook);
}

const poolIdOf = uniswapV4PoolId;

async function readSlot0SqrtPrice(
  client: PublicClient,
  poolManager: Address,
  poolId: `0x${string}`,
): Promise<bigint> {
  const slot0 = await client.readContract({
    address: poolManager,
    abi: extsloadAbi,
    functionName: "extsload",
    args: [uniswapV4PoolStateSlot(poolId)],
  });
  return uniswapV4SqrtPriceX96FromSlot0(slot0);
}

/** Human pair-per-token price for a sqrtPriceX96 and pool ordering. */
export function poolPriceFromSqrtP(
  sqrtP: bigint,
  pairIsC0: boolean,
  pairDecimals: number,
): number {
  return uniswapV4PriceFromSqrtPriceX96(sqrtP, pairIsC0, pairDecimals) ?? 0;
}

/**
 * Read the buyback pool's key + current price via the given hook. Null when
 * the pool isn't set or isn't price-initialized.
 */
async function readPoolStateViaHook(
  chainId: number,
  projectId: bigint,
  hook: Address,
  client: PublicClient,
): Promise<PoolState | null> {
  const poolManager = POOL_MANAGER_BY_CHAIN[chainId];
  if (!poolManager) return null;
  const pair = await resolvePairToken(chainId, projectId, client);
  if (!pair) return null;
  const key = (await client.readContract({
    address: hook,
    abi: poolKeyOfAbi,
    functionName: "poolKeyOf",
    args: [projectId, pair.addr],
  })) as PoolKey;
  const c0 = (key.currency0 || zeroAddress).toLowerCase();
  const c1 = (key.currency1 || zeroAddress).toLowerCase();
  if (c0 === zeroAddress && c1 === zeroAddress) return null;
  const poolId = poolIdOf(key);
  const sqrtP = await readSlot0SqrtPrice(client, poolManager, poolId);
  if (sqrtP === 0n) return null;
  const pairIsC0 = c0 === pair.addr.toLowerCase();
  return {
    key,
    sqrtP,
    pair,
    poolId,
    pairIsC0,
    poolPrice: poolPriceFromSqrtP(sqrtP, pairIsC0, pair.decimals),
    projectToken: (pairIsC0 ? key.currency1 : key.currency0) as Address,
  };
}

/** Read the project's buyback pool state on a chain (null = no pool). */
export async function readPoolState(
  chainId: number,
  projectId: bigint,
): Promise<PoolState | null> {
  const client = clientFor(chainId);
  const hook = await resolveBuybackHook(chainId, projectId, client);
  if (!hook || !POOL_MANAGER_BY_CHAIN[chainId]) return null;
  try {
    return await readPoolStateViaHook(chainId, projectId, hook, client);
  } catch {
    return null;
  }
}

export interface DirectBuyQuote {
  /** The pool the swap would route through. */
  poolId: `0x${string}`;
  /** Full pool key required to build the executable Universal Router call. */
  poolKey: UniswapV4PoolKey;
  /** Swap direction: pair token into project token. */
  zeroForOne: boolean;
  /** True hook-routed project-token output for the given pair-token input. */
  out: bigint;
}

/**
 * True expected project-token output of buying straight from the buyback pool
 * with `amountIn` of the project's PAIR (accounting) token. Runs the V4 Quoter,
 * which executes the hook's beforeSwap — so the result already reflects the
 * hook's optimal routing (full AMM output when the AMM wins, the JB issuance
 * beneficiary otherwise). Mirrors the website's directSwapPoolFor + quoteDirectSwap.
 *
 * Returns null when: the chain has no verified Quoter (gate OFF, don't guess),
 * there's no initialized pool, the paid token isn't the pool's pair token
 * (a swap-via-router currency never is), or the quote reverts (e.g. 0 liquidity).
 */
export async function quoteDirectBuy(
  chainId: number,
  projectId: bigint,
  inputToken: Address,
  amountIn: bigint,
): Promise<DirectBuyQuote | null> {
  const quoter = V4_QUOTER_BY_CHAIN[chainId];
  if (!quoter || amountIn <= 0n) return null;
  const pool = await readPoolState(chainId, projectId);
  if (!pool) return null;
  // The paid token must BE the pool's pair token (native → zero address).
  const normalizedIn =
    inputToken.toLowerCase() === NATIVE_TOKEN.toLowerCase()
      ? zeroAddress
      : (inputToken.toLowerCase() as Address);
  if (normalizedIn !== pool.pair.addr.toLowerCase()) return null;
  // Buying the project token by spending the pair token: swap pair → token.
  // zeroForOne means currency0 → currency1, so it holds exactly when the pair is currency0.
  const zeroForOne = pool.pairIsC0;
  try {
    const out = await quoteUniswapV4ExactInputSingle(clientFor(chainId), {
      chainId: chainId as JBChainId,
      poolKey: pool.key,
      zeroForOne,
      amountIn,
    });
    if (out <= 0n) return null;
    return { poolId: pool.poolId, poolKey: pool.key, zeroForOne, out };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// LP position enumeration — capped PoolManager log scan
// ---------------------------------------------------------------------------

const LP_INITIALIZE_TOPIC = UNISWAP_V4_INITIALIZE_TOPIC;
const LP_MODIFY_LIQUIDITY_TOPIC = UNISWAP_V4_MODIFY_LIQUIDITY_TOPIC;

const LP_LOG_WINDOW = 45_000n;
const LP_LOG_BATCH_WINDOWS = 8;
/** Hard cap on scanned windows per load — bounded work even on fast L2s. */
const LP_LOG_MAX_WINDOWS = 48;
const LP_LOG_REORG_OVERLAP = 128n;

export interface RawLog {
  topics?: readonly string[];
  data?: string;
  blockNumber?: bigint | string | number;
}

export interface PoolLogScanState {
  initializeBlock: bigint | null;
  tokenIds: Map<string, { id: bigint; block: bigint }>;
}

/**
 * Fold PoolManager logs into the scan state. ModifyLiquidity's fourth
 * non-indexed word (bytes32 salt) is the PositionManager tokenId — but ONLY
 * when the indexed sender is the configured PositionManager: positions
 * created by other senders use arbitrary salts, and treating those as NFT
 * ids would attribute unrelated positions to this pool.
 */
export function collectPoolLogs(
  logs: readonly RawLog[],
  positionManager: Address,
  state: PoolLogScanState,
): void {
  for (const log of logs || []) {
    const topic0 = String(log.topics?.[0] || "").toLowerCase();
    const block = BigInt(log.blockNumber ?? 0);
    if (topic0 === LP_INITIALIZE_TOPIC) {
      if (state.initializeBlock == null || block < state.initializeBlock)
        state.initializeBlock = block;
      continue;
    }
    if (topic0 !== LP_MODIFY_LIQUIDITY_TOPIC) continue;
    const tokenId = uniswapV4PositionTokenIdFromLog(log, positionManager);
    if (tokenId === null) continue;
    const known = state.tokenIds.get(tokenId.toString());
    if (!known || block < known.block)
      state.tokenIds.set(tokenId.toString(), { id: tokenId, block });
  }
}

interface PoolHistoryCacheEntry {
  initializeBlock: bigint;
  throughBlock: bigint;
  entries: Array<{ id: bigint; block: bigint }>;
  complete: boolean;
}

const poolHistoryCache = new Map<string, PoolHistoryCacheEntry>();

async function fetchPoolLogsRange(
  client: PublicClient,
  poolManager: Address,
  poolId: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  onlyInitialize: boolean,
): Promise<RawLog[]> {
  // Raw eth_getLogs keeps the OR'd first topic AND the indexed pool-id filter;
  // viem's multi-event helper drops event args, which would download every
  // PoolManager pool on the chain.
  const topics = [
    onlyInitialize
      ? LP_INITIALIZE_TOPIC
      : [LP_INITIALIZE_TOPIC, LP_MODIFY_LIQUIDITY_TOPIC],
    poolId,
  ];
  return (await client.request({
    method: "eth_getLogs",
    params: [
      {
        address: poolManager,
        topics,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${toBlock.toString(16)}`,
      },
    ],
  } as never)) as RawLog[];
}

interface PoolTokenIdScan {
  tokenIds: bigint[];
  /** False when the scan was range-capped or an RPC window failed — render partial with a note. */
  complete: boolean;
}

/**
 * Every PositionManager NFT id ever used in this pool, from the PoolManager's
 * ModifyLiquidity logs. Scans bounded windows (never trusting one wide request:
 * some gateways silently truncate) and stops at the pool's Initialize event.
 * Unlike the website (which rejects on incomplete history), a capped or
 * partially-failed scan resolves with `complete: false` so the UI can render
 * what was verified alongside a partial-data note.
 */
async function scanPoolPositionTokenIds(
  chainId: number,
  poolManager: Address,
  positionManager: Address,
  poolId: `0x${string}`,
): Promise<PoolTokenIdScan> {
  // getLogs-capable gateway (publicnode 403s the archive scan); reads elsewhere use clientFor.
  const client = lpLogsClient(chainId);
  const latest = await client.getBlockNumber();
  const cacheKey = `${chainId}:${poolManager.toLowerCase()}:${positionManager.toLowerCase()}:${poolId.toLowerCase()}`;
  let cached = poolHistoryCache.get(cacheKey) ?? null;
  if (cached && latest < cached.throughBlock) cached = null;

  const state: PoolLogScanState = {
    initializeBlock: cached?.initializeBlock ?? null,
    tokenIds: new Map(),
  };
  let complete = cached ? cached.complete : true;
  let windowsUsed = 0;

  const scanRange = async (
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<void> => {
    let cursor = fromBlock;
    while (cursor <= toBlock) {
      const ranges: Array<{ lo: bigint; hi: bigint }> = [];
      for (let n = 0; n < LP_LOG_BATCH_WINDOWS && cursor <= toBlock; n++) {
        if (windowsUsed >= LP_LOG_MAX_WINDOWS) {
          complete = false;
          return;
        }
        let hi = cursor + LP_LOG_WINDOW - 1n;
        if (hi > toBlock) hi = toBlock;
        ranges.push({ lo: cursor, hi });
        cursor = hi + 1n;
        windowsUsed++;
      }
      try {
        const batches = await Promise.all(
          ranges.map((range) =>
            fetchPoolLogsRange(
              client,
              poolManager,
              poolId,
              range.lo,
              range.hi,
              false,
            ),
          ),
        );
        for (const logs of batches)
          collectPoolLogs(logs, positionManager, state);
      } catch {
        complete = false;
        return;
      }
    }
  };

  if (
    cached &&
    state.initializeBlock != null &&
    latest >= state.initializeBlock
  ) {
    // Incremental: keep ids minted before the reorg-overlap tail, rescan the tail.
    let overlapStart =
      cached.throughBlock > LP_LOG_REORG_OVERLAP
        ? cached.throughBlock - LP_LOG_REORG_OVERLAP + 1n
        : cached.initializeBlock;
    if (overlapStart < cached.initializeBlock)
      overlapStart = cached.initializeBlock;
    for (const entry of cached.entries) {
      if (entry.block < overlapStart)
        state.tokenIds.set(entry.id.toString(), entry);
    }
    await scanRange(overlapStart, latest);
  } else {
    // A one-shot Initialize lookup is much cheaper when the RPC supports wide indexed ranges.
    try {
      const initializeLogs = await fetchPoolLogsRange(
        client,
        poolManager,
        poolId,
        0n,
        latest,
        true,
      );
      collectPoolLogs(initializeLogs, positionManager, state);
    } catch {
      // fall through to the backwards walk
    }
    if (state.initializeBlock != null) {
      const span = latest - state.initializeBlock + 1n;
      const maxSpan = LP_LOG_WINDOW * BigInt(LP_LOG_MAX_WINDOWS);
      let from = state.initializeBlock;
      if (span > maxSpan) {
        from = latest - maxSpan + 1n;
        complete = false;
      }
      await scanRange(from, latest);
    } else {
      // Range-limited RPC: walk backwards in bounded batches until Initialize
      // is found or the window cap is hit (→ partial).
      let cursor = latest;
      let found = false;
      while (windowsUsed < LP_LOG_MAX_WINDOWS && cursor >= 0n) {
        const ranges: Array<{ lo: bigint; hi: bigint }> = [];
        for (
          let n = 0;
          n < LP_LOG_BATCH_WINDOWS && windowsUsed < LP_LOG_MAX_WINDOWS;
          n++
        ) {
          const lo = cursor >= LP_LOG_WINDOW ? cursor - LP_LOG_WINDOW + 1n : 0n;
          ranges.push({ lo, hi: cursor });
          windowsUsed++;
          if (lo === 0n) break;
          cursor = lo - 1n;
        }
        try {
          const batches = await Promise.all(
            ranges.map((range) =>
              fetchPoolLogsRange(
                client,
                poolManager,
                poolId,
                range.lo,
                range.hi,
                false,
              ),
            ),
          );
          for (const logs of batches)
            collectPoolLogs(logs, positionManager, state);
        } catch {
          complete = false;
          break;
        }
        if (state.initializeBlock != null) {
          found = true;
          break;
        }
        if (ranges[ranges.length - 1].lo === 0n) break;
        cursor = ranges[ranges.length - 1].lo - 1n;
      }
      if (!found && state.initializeBlock == null) complete = false;
    }
  }

  const entries = [...state.tokenIds.values()];
  const tokenIds = entries
    .map((entry) => entry.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (state.initializeBlock != null) {
    poolHistoryCache.set(cacheKey, {
      initializeBlock: state.initializeBlock,
      throughBlock: latest,
      entries,
      complete,
    });
  }
  return { tokenIds, complete };
}

interface PositionDetail {
  tokenId: bigint;
  info: bigint;
  owner: Address | null;
  liquidity: bigint;
}

/**
 * Read each position's packed info, owner, and live liquidity; verify every
 * live position actually belongs to the expected pool (a PositionManager
 * token from another pool must never be attributed here).
 */
async function readPositionDetails(
  client: PublicClient,
  positionManager: Address,
  tokenIds: bigint[],
  expectedPoolId: `0x${string}`,
): Promise<PositionDetail[]> {
  const details = await Promise.all(
    tokenIds.map(async (tokenId) => {
      const [info, ownerResult, liquidity] = await Promise.all([
        client
          .readContract({
            address: positionManager,
            abi: positionViewAbi,
            functionName: "positionInfo",
            args: [tokenId],
          })
          .then(BigInt),
        client
          .readContract({
            address: positionManager,
            abi: positionViewAbi,
            functionName: "ownerOf",
            args: [tokenId],
          })
          .then((owner) => ({
            owner: owner as Address,
            error: null as unknown,
          }))
          .catch((error) => ({ owner: null, error })),
        client
          .readContract({
            address: positionManager,
            abi: positionViewAbi,
            functionName: "getPositionLiquidity",
            args: [tokenId],
          })
          .then(BigInt),
      ]);
      // ownerOf legitimately reverts after an NFT is burned. Any owner failure
      // for a live position is incomplete data.
      if (ownerResult.error && info !== 0n && liquidity !== 0n)
        throw ownerResult.error;
      return { tokenId, info, owner: ownerResult.owner, liquidity };
    }),
  );
  await Promise.all(
    details.map(async (detail) => {
      if (!detail.owner || detail.info === 0n || detail.liquidity === 0n)
        return;
      const [poolKey, info] = await client.readContract({
        address: positionManager,
        abi: positionViewAbi,
        functionName: "getPoolAndPositionInfo",
        args: [detail.tokenId],
      });
      if (BigInt(info) !== detail.info)
        throw new Error(
          "PositionManager returned inconsistent LP position data",
        );
      if (
        poolIdOf(poolKey as PoolKey).toLowerCase() !==
        expectedPoolId.toLowerCase()
      ) {
        throw new Error(
          "PositionManager token does not belong to the expected pool",
        );
      }
    }),
  );
  return details;
}

interface LpPositionEntry {
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  /** Pair-token amount at the current price (raw, pair decimals). */
  pairAmount: bigint;
  /** Project-token amount at the current price (raw, 18 decimals). */
  tokenAmount: bigint;
}

interface LpOwnerRow {
  address: Address;
  /** Total value in pair-token terms (human) for share sorting. */
  valuePair: number;
  pairAmount: bigint;
  tokenAmount: bigint;
  positions: number;
}

export interface LpPositionsSnapshot {
  state: PoolState;
  owners: LpOwnerRow[];
  positions: LpPositionEntry[];
  totalPair: bigint;
  totalToken: bigint;
  /** False when the log scan was capped/partial — show a note. */
  complete: boolean;
}

/** Decode positionInfo's packed ticks (upper at bits 32-55, lower at 8-31). */
export function ticksFromPositionInfo(info: bigint): {
  tickLower: number;
  tickUpper: number;
} {
  const ticks = uniswapV4PositionTicks(info);
  return {
    tickUpper: ticks.upper,
    tickLower: ticks.lower,
  };
}

/**
 * Enumerate the buyback pool's LP positions, aggregated by owner. Null when
 * there is no initialized pool on the chain.
 */
export async function readLpPositions(
  chainId: number,
  projectId: bigint,
): Promise<LpPositionsSnapshot | null> {
  const positionManager = POSITION_MANAGER_BY_CHAIN[chainId];
  const poolManager = POOL_MANAGER_BY_CHAIN[chainId];
  if (!positionManager || !poolManager) return null;
  const state = await readPoolState(chainId, projectId);
  if (!state) return null;
  const client = clientFor(chainId);

  const scan = await scanPoolPositionTokenIds(
    chainId,
    poolManager,
    positionManager,
    state.poolId,
  );
  const empty: LpPositionsSnapshot = {
    state,
    owners: [],
    positions: [],
    totalPair: 0n,
    totalToken: 0n,
    complete: scan.complete,
  };
  if (!scan.tokenIds.length) return empty;

  const details = await readPositionDetails(
    client,
    positionManager,
    scan.tokenIds,
    state.poolId,
  );
  const pairScale = 10 ** state.pair.decimals;
  const byOwner = new Map<string, LpOwnerRow>();
  const positions: LpPositionEntry[] = [];
  let totalPair = 0n;
  let totalToken = 0n;
  for (const detail of details) {
    if (!detail.owner || detail.liquidity <= 0n || detail.info === 0n) continue;
    const { tickLower, tickUpper } = ticksFromPositionInfo(detail.info);
    const amounts = lpGetAmountsForLiquidity(
      state.sqrtP,
      lpSqrtAtTick(tickLower),
      lpSqrtAtTick(tickUpper),
      detail.liquidity,
    );
    const pairAmount = state.pairIsC0 ? amounts.amount0 : amounts.amount1;
    const tokenAmount = state.pairIsC0 ? amounts.amount1 : amounts.amount0;
    totalPair += pairAmount;
    totalToken += tokenAmount;
    positions.push({
      tickLower,
      tickUpper,
      liquidity: detail.liquidity,
      pairAmount,
      tokenAmount,
    });
    const value =
      Number(pairAmount) / pairScale +
      (Number(tokenAmount) / 1e18) * state.poolPrice;
    const key = detail.owner.toLowerCase();
    const row = byOwner.get(key) ?? {
      address: detail.owner,
      valuePair: 0,
      pairAmount: 0n,
      tokenAmount: 0n,
      positions: 0,
    };
    row.valuePair += value;
    row.pairAmount += pairAmount;
    row.tokenAmount += tokenAmount;
    row.positions++;
    byOwner.set(key, row);
  }
  const owners = [...byOwner.values()].sort(
    (a, b) => b.valuePair - a.valuePair,
  );
  return {
    state,
    owners,
    positions,
    totalPair,
    totalToken,
    complete: scan.complete,
  };
}

// ---------------------------------------------------------------------------
// The connected wallet's positions (remove-liquidity source data)
// ---------------------------------------------------------------------------

export interface UserLpPosition {
  tokenId: bigint;
  owner: Address;
  key: PoolKey;
  poolId: `0x${string}`;
  hookIsCurrent: boolean;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  pairAmount: bigint;
  tokenAmount: bigint;
  pairIsC0: boolean;
  pair: PairToken;
}

async function scanPoolPositionsViaHook(
  chainId: number,
  projectId: bigint,
  hook: Address,
  hookIsCurrent: boolean,
): Promise<UserLpPosition[]> {
  const positionManager = POSITION_MANAGER_BY_CHAIN[chainId];
  const poolManager = POOL_MANAGER_BY_CHAIN[chainId];
  if (!positionManager || !poolManager || !hook || hook === zeroAddress)
    return [];
  const client = clientFor(chainId);
  const state = await readPoolStateViaHook(
    chainId,
    projectId,
    hook,
    client,
  ).catch(() => null);
  if (!state) return [];
  const scan = await scanPoolPositionTokenIds(
    chainId,
    poolManager,
    positionManager,
    state.poolId,
  );
  if (!scan.tokenIds.length) return [];
  const details = await readPositionDetails(
    client,
    positionManager,
    scan.tokenIds,
    state.poolId,
  );
  const out: UserLpPosition[] = [];
  for (const detail of details) {
    if (!detail.owner || detail.liquidity <= 0n || detail.info === 0n) continue;
    const { tickLower, tickUpper } = ticksFromPositionInfo(detail.info);
    const amounts = lpGetAmountsForLiquidity(
      state.sqrtP,
      lpSqrtAtTick(tickLower),
      lpSqrtAtTick(tickUpper),
      detail.liquidity,
    );
    out.push({
      tokenId: detail.tokenId,
      owner: detail.owner,
      key: state.key,
      poolId: state.poolId,
      hookIsCurrent,
      tickLower,
      tickUpper,
      liquidity: detail.liquidity,
      pairAmount: state.pairIsC0 ? amounts.amount0 : amounts.amount1,
      tokenAmount: state.pairIsC0 ? amounts.amount1 : amounts.amount0,
      pairIsC0: state.pairIsC0,
      pair: state.pair,
    });
  }
  return out;
}

/**
 * The account's LP positions for a project on a chain — the CURRENT buyback
 * pool AND the default-hook pool (stranded positions from a prior hook stay
 * visible/removable).
 */
export async function readUserLpPositions(
  chainId: number,
  projectId: bigint,
  account: Address,
): Promise<UserLpPosition[]> {
  const client = clientFor(chainId);
  const lc = (a: string | null | undefined) => (a || "").toLowerCase();
  const currentHook = await resolveBuybackHook(chainId, projectId, client);
  const tasks: Array<Promise<UserLpPosition[]>> = [];
  if (currentHook)
    tasks.push(scanPoolPositionsViaHook(chainId, projectId, currentHook, true));
  if (lc(JB_BUYBACK_HOOK) !== lc(currentHook)) {
    tasks.push(
      scanPoolPositionsViaHook(chainId, projectId, JB_BUYBACK_HOOK, false),
    );
  }
  const all = (await Promise.all(tasks)).flat();
  return all.filter((pos) => lc(pos.owner) === lc(account));
}

/**
 * Re-read a position's ownership, liquidity, ticks, and the pool price
 * immediately before presenting/sending the removal — the table can stay
 * open while the market moves or the NFT transfers, and stale values must
 * not become the reviewed expected/minimum returns.
 */
export async function refreshLpPosition(
  chainId: number,
  position: UserLpPosition,
  expectedAccount: Address,
): Promise<UserLpPosition> {
  const positionManager = POSITION_MANAGER_BY_CHAIN[chainId];
  const poolManager = POOL_MANAGER_BY_CHAIN[chainId];
  if (!positionManager || !poolManager)
    throw new Error("Liquidity contracts are unavailable on this chain.");
  const client = clientFor(chainId);
  const [details, sqrtP] = await Promise.all([
    readPositionDetails(
      client,
      positionManager,
      [position.tokenId],
      position.poolId,
    ),
    readSlot0SqrtPrice(client, poolManager, position.poolId),
  ]);
  const detail = details[0];
  if (
    !detail.owner ||
    detail.owner.toLowerCase() !== expectedAccount.toLowerCase()
  ) {
    throw new Error("This wallet no longer owns the position");
  }
  if (detail.info === 0n || detail.liquidity <= 0n)
    throw new Error("This position no longer has liquidity");
  if (sqrtP === 0n) throw new Error("Could not verify the current pool price");
  const { tickLower, tickUpper } = ticksFromPositionInfo(detail.info);
  const amounts = lpGetAmountsForLiquidity(
    sqrtP,
    lpSqrtAtTick(tickLower),
    lpSqrtAtTick(tickUpper),
    detail.liquidity,
  );
  return {
    ...position,
    owner: detail.owner,
    liquidity: detail.liquidity,
    tickLower,
    tickUpper,
    pairAmount: position.pairIsC0 ? amounts.amount0 : amounts.amount1,
    tokenAmount: position.pairIsC0 ? amounts.amount1 : amounts.amount0,
  };
}

// ---------------------------------------------------------------------------
// Add liquidity — plan (pure) + tx payloads
// ---------------------------------------------------------------------------

// v4-periphery Actions byte values.
const ACTION_MINT_POSITION = "02";
const ACTION_BURN_POSITION = "03";
const ACTION_CLOSE_CURRENCY = "12";
const ACTION_SWEEP = "14";
const ACTION_TAKE_PAIR = "11";

export interface AddLiquidityPlan {
  key: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  /** Exact requirement at plan time (currency-ordered). */
  need: { amount0: bigint; amount1: bigint };
  /** 1% headroom maxes baked into the mint params (currency-ordered). */
  amount0Max: bigint;
  amount1Max: bigint;
  /** Native msg.value (the pair side when it's ETH), else 0. */
  value: bigint;
  /** ERC-20 sides that must be routed through Permit2 (project token always; the pair too when it's USDC). */
  erc20Sides: Array<{ currency: Address; max: bigint }>;
  unlockData: `0x${string}`;
  pairIsC0: boolean;
  pair: PairToken;
  recipient: Address;
}

/**
 * Pure derivation of a V4 mint from the pool state + deposit amounts + range
 * (website prepareAddLiquidity :21137, read-only part). `pa`/`pb` are the UI
 * range in human pair-per-token; amounts are raw in their own decimals.
 *
 * Single-sided deposits keep the CURRENT price OUTSIDE the range: tick
 * alignment can nudge the price just inside (e.g. price == range top, but
 * alignDown drops tickLower below it), which would demand a sliver of the
 * un-funded token and make liquidity 0. Only currency0 funded → range
 * entirely above the price; only currency1 → entirely below. Order-agnostic
 * across pair/token orderings — do NOT "fix" this math.
 */
export function deriveAddLiquidityPlan(opts: {
  key: PoolKey;
  sqrtP: bigint;
  pair: PairToken;
  pairAmount: bigint;
  tokenAmount: bigint;
  pa: number;
  pb: number;
  recipient: Address;
}): AddLiquidityPlan {
  const { key, sqrtP, pair, recipient } = opts;
  const pairIsC0 =
    (key.currency0 || "").toLowerCase() === pair.addr.toLowerCase();
  const pairDec = pair.decimals;
  // Map the pair/token deposit amounts onto currency0/currency1 by ordering.
  const amount0 = pairIsC0 ? opts.pairAmount : opts.tokenAmount;
  const amount1 = pairIsC0 ? opts.tokenAmount : opts.pairAmount;

  const spacing = Number(key.tickSpacing);
  const maxUsable = Math.trunc(MAX_TICK / spacing) * spacing;
  const minUsable = Math.trunc(-MAX_TICK / spacing) * spacing;
  // UI range is pair-per-token (q). Pool price is raw currency1/currency0:
  //   pair=c0 → P_raw = 10^(18−pairDec)/q ;  token=c0 → P_raw = q·10^(pairDec−18).
  // Ticks are monotonic in P_raw, so derive both ends and sort.
  const pRawFromQ = (q: number) =>
    pairIsC0 ? 10 ** (18 - pairDec) / q : q * 10 ** (pairDec - 18);
  const tA = Math.log(pRawFromQ(opts.pa)) / Math.log(1.0001);
  const tB = Math.log(pRawFromQ(opts.pb)) / Math.log(1.0001);
  let tickLower = Math.max(
    minUsable,
    lpAlignDown(Math.floor(Math.min(tA, tB)), spacing),
  );
  let tickUpper = Math.min(
    maxUsable,
    lpAlignUp(Math.ceil(Math.max(tA, tB)), spacing),
  );
  if (tickUpper <= tickLower)
    tickUpper = Math.min(maxUsable, tickLower + spacing);
  const curTick = Math.floor(
    (2 * Math.log(Number(sqrtP) / 2 ** 96)) / Math.log(1.0001),
  );
  if (amount1 <= 0n && amount0 > 0n && curTick >= tickLower)
    tickLower = Math.min(maxUsable, lpAlignUp(curTick + 1, spacing));
  if (amount0 <= 0n && amount1 > 0n && curTick < tickUpper)
    tickUpper = Math.max(minUsable, lpAlignDown(curTick, spacing));
  if (tickUpper <= tickLower)
    tickUpper = Math.min(maxUsable, tickLower + spacing);

  const sqrtA = lpSqrtAtTick(tickLower);
  const sqrtB = lpSqrtAtTick(tickUpper);
  const liquidity = lpGetLiquidityForAmounts(
    sqrtP,
    sqrtA,
    sqrtB,
    amount0,
    amount1,
  );
  if (liquidity <= 0n) throw new Error("Amounts too small for this range");
  const need = lpGetAmountsForLiquidity(sqrtP, sqrtA, sqrtB, liquidity);
  // 1% headroom over the exact requirement (SWEEP refunds unused native;
  // Permit2/CLOSE pull the exact ERC-20).
  const amount0Max = need.amount0 + need.amount0 / 100n + 1n;
  const amount1Max = need.amount1 + need.amount1 / 100n + 1n;

  const c0Native = pairIsC0 && pair.isNative;
  const c1Native = !pairIsC0 && pair.isNative;
  const value = c0Native ? amount0Max : c1Native ? amount1Max : 0n;
  const erc20Sides: Array<{ currency: Address; max: bigint }> = [];
  if (!c0Native && amount0Max > 1n)
    erc20Sides.push({ currency: key.currency0, max: amount0Max });
  if (!c1Native && amount1Max > 1n)
    erc20Sides.push({ currency: key.currency1, max: amount1Max });

  const mintParams = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "int24" },
          { type: "address" },
        ],
      },
      { type: "int24" },
      { type: "int24" },
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "address" },
      { type: "bytes" },
    ],
    [
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      recipient,
      "0x",
    ],
  );
  const closeC0 = encodeAbiParameters([{ type: "address" }], [key.currency0]);
  const closeC1 = encodeAbiParameters([{ type: "address" }], [key.currency1]);
  const parts: `0x${string}`[] = [mintParams, closeC0, closeC1];
  let actions =
    `0x${ACTION_MINT_POSITION}${ACTION_CLOSE_CURRENCY}${ACTION_CLOSE_CURRENCY}` as `0x${string}`;
  if (pair.isNative) {
    // Refund unused native (sent as msg.value) to the user. ERC-20 sides need
    // no sweep — CLOSE pulls the exact amount.
    const nativeCurrency = c0Native ? key.currency0 : key.currency1;
    parts.push(
      encodeAbiParameters(
        [{ type: "address" }, { type: "address" }],
        [nativeCurrency, recipient],
      ),
    );
    actions =
      `0x${ACTION_MINT_POSITION}${ACTION_CLOSE_CURRENCY}${ACTION_CLOSE_CURRENCY}${ACTION_SWEEP}` as `0x${string}`;
  }
  const unlockData = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [actions, parts],
  );

  return {
    key,
    tickLower,
    tickUpper,
    liquidity,
    need,
    amount0Max,
    amount1Max,
    value,
    erc20Sides,
    unlockData,
    pairIsC0,
    pair,
    recipient,
  };
}

/**
 * Corridor guard for the submit-time reverify: recompute what the reviewed
 * liquidity needs at the FRESH pool price; if either side exceeds the maxes
 * baked into the mint params, the price moved beyond the reviewed 1%
 * headroom corridor — abort instead of letting the mint revert or consume
 * more than reviewed.
 */
export function assertPlanWithinCorridor(
  plan: AddLiquidityPlan,
  freshSqrtP: bigint,
): void {
  if (freshSqrtP <= 0n)
    throw new Error("Could not verify the current pool price");
  const sqrtA = lpSqrtAtTick(plan.tickLower);
  const sqrtB = lpSqrtAtTick(plan.tickUpper);
  const need = lpGetAmountsForLiquidity(
    freshSqrtP,
    sqrtA,
    sqrtB,
    plan.liquidity,
  );
  if (need.amount0 > plan.amount0Max || need.amount1 > plan.amount1Max) {
    throw new Error(
      "The pool price moved while you were reviewing. Reopen and review the updated amounts.",
    );
  }
}

/** Reverify helper: re-read slot0 for the plan's pool and run the corridor check. */
export async function reverifyAddLiquidity(
  chainId: number,
  plan: AddLiquidityPlan,
): Promise<void> {
  const poolManager = POOL_MANAGER_BY_CHAIN[chainId];
  if (!poolManager)
    throw new Error("Liquidity contracts are unavailable on this chain.");
  const freshSqrtP = await readSlot0SqrtPrice(
    clientFor(chainId),
    poolManager,
    poolIdOf(plan.key),
  );
  assertPlanWithinCorridor(plan, freshSqrtP);
}

export interface PreparedTx {
  to: Address;
  data: `0x${string}`;
  value: bigint;
  review?: { abi: Abi; functionName: string; args: readonly unknown[] };
}

/**
 * On-chain Permit2 allowance for one ERC-20 side: Permit2.approve(token,
 * PositionManager, amount, expiration) as a PLAIN transaction. Used instead
 * of a gasless signTypedData permit because managed wallets cannot sign
 * typed data — and a direct ERC-20 approve to the PositionManager would be
 * useless (it settles ERC-20s exclusively through Permit2).
 */
export function buildPermit2ApproveTx(
  chainId: number,
  token: Address,
  amount: bigint,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): PreparedTx {
  const positionManager = POSITION_MANAGER_BY_CHAIN[chainId];
  if (!positionManager) throw new Error("No position manager on this chain");
  const expiration = nowSeconds + 30 * 24 * 3600;
  const args = [token, positionManager, amount, expiration] as const;
  return {
    to: PERMIT2_ADDRESS,
    data: encodeFunctionData({
      abi: permit2Abi,
      functionName: "approve",
      args,
    }),
    value: 0n,
    review: { abi: permit2Abi, functionName: "approve", args },
  };
}

/** Whether a side's Permit2→PositionManager allowance already covers `amount`. */
export async function permit2AllowanceCovers(
  chainId: number,
  owner: Address,
  token: Address,
  amount: bigint,
): Promise<boolean> {
  const positionManager = POSITION_MANAGER_BY_CHAIN[chainId];
  if (!positionManager) return false;
  const [allowed, expiration] = await clientFor(chainId).readContract({
    address: PERMIT2_ADDRESS,
    abi: permit2Abi,
    functionName: "allowance",
    args: [owner, token, positionManager],
  });
  const now = Math.floor(Date.now() / 1000);
  return BigInt(allowed) >= amount && Number(expiration) > now;
}

/** The mint transaction: PositionManager.modifyLiquidities(unlockData, deadline). */
export function buildModifyLiquiditiesTx(
  chainId: number,
  plan: Pick<AddLiquidityPlan, "unlockData" | "value">,
  deadline: bigint,
): PreparedTx {
  const positionManager = POSITION_MANAGER_BY_CHAIN[chainId];
  if (!positionManager) throw new Error("No position manager on this chain");
  const args = [plan.unlockData, deadline] as const;
  return {
    to: positionManager,
    data: encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "modifyLiquidities",
      args,
    }),
    value: plan.value,
    review: {
      abi: positionManagerAbi,
      functionName: "modifyLiquidities",
      args,
    },
  };
}

// ---------------------------------------------------------------------------
// Remove liquidity — plan (pure) + tx payload
// ---------------------------------------------------------------------------

export interface RemoveLiquidityPlan {
  unlockData: `0x${string}`;
  deadline: bigint;
  /** 95% floors from the freshly displayed amounts (a large adverse move reverts). */
  pairMin: bigint;
  tokenMin: bigint;
}

/**
 * Full-exit remove: BURN_POSITION(tokenId) + TAKE_PAIR(c0, c1, recipient).
 * No approval needed — the NFT owner burns their own position. Each positive
 * side gets a 95% floor from the freshly refreshed amounts, so a large
 * adverse price/composition move reverts instead of returning materially
 * less than reviewed.
 */
export function prepareRemoveLiquidity(
  position: Pick<
    UserLpPosition,
    "tokenId" | "key" | "pairAmount" | "tokenAmount" | "pairIsC0"
  >,
  recipient: Address,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RemoveLiquidityPlan {
  const pairMin = quotedOutputFloor(position.pairAmount, 9500);
  const tokenMin = quotedOutputFloor(position.tokenAmount, 9500);
  const amount0Min = position.pairIsC0 ? pairMin : tokenMin;
  const amount1Min = position.pairIsC0 ? tokenMin : pairMin;
  const burnParams = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint128" },
      { type: "uint128" },
      { type: "bytes" },
    ],
    [position.tokenId, amount0Min, amount1Min, "0x"],
  );
  const takeParams = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [position.key.currency0, position.key.currency1, recipient],
  );
  const unlockData = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [`0x${ACTION_BURN_POSITION}${ACTION_TAKE_PAIR}`, [burnParams, takeParams]],
  );
  return { unlockData, deadline: BigInt(nowSeconds + 1200), pairMin, tokenMin };
}

export function buildRemoveLiquidityTx(
  chainId: number,
  plan: RemoveLiquidityPlan,
): PreparedTx {
  const positionManager = POSITION_MANAGER_BY_CHAIN[chainId];
  if (!positionManager) throw new Error("No position manager on this chain");
  const args = [plan.unlockData, plan.deadline] as const;
  return {
    to: positionManager,
    data: encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "modifyLiquidities",
      args,
    }),
    value: 0n,
    review: {
      abi: positionManagerAbi,
      functionName: "modifyLiquidities",
      args,
    },
  };
}

// ---------------------------------------------------------------------------
// Market context: floor / ceiling / ruleset weight / split-hook state
// ---------------------------------------------------------------------------

const ONE_TOKEN = 10n ** 18n;

/**
 * The cash-out floor as a human pair-per-token price: what one token (1e18)
 * reclaims right now via the terminal store (surplus net of payout limits ÷
 * supply incl. pending reserved). Null when there is no floor yet.
 */
export async function readCashOutFloorPrice(
  chainId: number,
  projectId: bigint,
  pair: PairToken,
): Promise<number | null> {
  try {
    const client = clientFor(chainId);
    const token = pair.isNative ? (NATIVE_TOKEN as Address) : pair.addr;
    // Accounting-context currency ids are uint32(uint160(token)).
    const currency = BigInt(tokenCurrencyId(token));
    const reclaim = await client.readContract({
      address: JB_CONTRACTS.JBTerminalStore,
      abi: jbTerminalStoreAbi,
      functionName: "currentReclaimableSurplusOf",
      args: [
        projectId,
        ONE_TOKEN,
        [],
        [token],
        BigInt(pair.decimals),
        currency,
      ],
    });
    const price = Number(formatUnits(BigInt(reclaim), pair.decimals));
    return isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export interface MarketRulesetFacts {
  rulesetId: bigint;
  weight: bigint;
  /** Issuance ceiling: pair per token at the current weight (website: 1e18/weight). */
  ceiling: number;
  dataHook: Address;
}

export async function readMarketRulesetFacts(
  chainId: number,
  projectId: bigint,
): Promise<MarketRulesetFacts | null> {
  const info = await projectDataHook(projectId, clientFor(chainId));
  if (!info) return null;
  const weightNumber = Number(info.weight);
  return {
    rulesetId: info.rulesetId,
    weight: info.weight,
    ceiling: weightNumber > 0 ? 1e18 / weightNumber : 0,
    dataHook: info.hook,
  };
}

/** Whether the project's CURRENT reserved splits route to the LP split hook on a chain. */
export async function projectUsesLpSplitHook(
  chainId: number,
  projectId: bigint,
): Promise<boolean> {
  const hookAddress = splitHookAddressFor(chainId);
  if (!hookAddress) return false;
  try {
    const client = clientFor(chainId);
    const info = await projectDataHook(projectId, client);
    if (!info) return false;
    const splits = await client.readContract({
      address: JB_CONTRACTS.JBSplits,
      abi: jbSplitsAbi,
      functionName: "splitsOf",
      args: [projectId, info.rulesetId, RESERVED_TOKEN_SPLIT_GROUP_ID],
    });
    return splits.some(
      (split) => (split.hook || "").toLowerCase() === hookAddress.toLowerCase(),
    );
  } catch {
    return false;
  }
}

export interface SplitHookChainState {
  chainId: number;
  hookAddress: Address;
  /** The terminal token the hook keys its pool by (the accounting token). */
  terminalToken: Address;
  /** The terminal (accounting) token's decimals — claimable LP fees are in this unit, NOT 18-dec project token. */
  terminalDecimals: number;
  /** The terminal (accounting) token's display symbol (ETH / USDC / TOKEN). */
  terminalSymbol: string;
  accumulated: bigint;
  hasPool: boolean;
  claimableFees: bigint;
  initialWeight: bigint;
  tokenId: bigint;
  tickLower: number | null;
  tickUpper: number | null;
  /**
   * deployPool is permissionless only once the ruleset weight decays to
   * ≤10% of the accumulation-time weight; until then it needs the owner
   * (SET_BUYBACK_POOL). Mirrors the contract's gate.
   */
  deployGated: boolean;
}

/** Read the LP split hook's keeper-facing state for a project on one chain. */
export async function readSplitHookState(
  chainId: number,
  projectId: bigint,
  currentWeight: bigint,
): Promise<SplitHookChainState | null> {
  const hookAddress = splitHookAddressFor(chainId);
  if (!hookAddress) return null;
  const client = clientFor(chainId);
  const pair = await resolvePairToken(chainId, projectId, client);
  if (!pair) return null;
  const terminalToken = pair.isNative ? (NATIVE_TOKEN as Address) : pair.addr;
  const read = <T>(
    functionName: string,
    args: readonly unknown[],
  ): Promise<T | null> =>
    (
      client.readContract({
        address: hookAddress,
        abi: bannyLpSplitHookAbi,
        functionName,
        args,
      } as never) as Promise<T>
    ).catch(() => null);

  const [
    accumulated,
    hasPool,
    fees,
    initialWeight,
    tokenId,
    tickLower,
    tickUpper,
  ] = await Promise.all([
    read<bigint>("accumulatedProjectTokens", [projectId]),
    read<boolean>("hasDeployedPool", [projectId]),
    read<bigint>("claimableFeeTokens", [projectId]),
    read<bigint>("initialWeightOf", [projectId]),
    read<bigint>("tokenIdOf", [projectId, terminalToken]),
    read<number>("activeTickLowerOf", [projectId, terminalToken]),
    read<number>("activeTickUpperOf", [projectId, terminalToken]),
  ]);
  const initial = initialWeight != null ? BigInt(initialWeight) : 0n;
  return {
    chainId,
    hookAddress,
    terminalToken,
    terminalDecimals: pair.decimals,
    terminalSymbol: pair.symbol,
    accumulated: accumulated != null ? BigInt(accumulated) : 0n,
    hasPool: Boolean(hasPool),
    claimableFees: fees != null ? BigInt(fees) : 0n,
    initialWeight: initial,
    tokenId: tokenId != null ? BigInt(tokenId) : 0n,
    tickLower: tickLower != null ? Number(tickLower) : null,
    tickUpper: tickUpper != null ? Number(tickUpper) : null,
    deployGated: initial === 0n || currentWeight * 10n > initial,
  };
}

/** Encode one of the hook's permissionless keeper actions as a guarded-tx payload. */
export function buildSplitHookActionTx(
  hookAddress: Address,
  action:
    | { kind: "deployPool"; projectId: bigint }
    | { kind: "addLiquidity"; projectId: bigint; terminalToken: Address }
    | { kind: "collectFees"; projectId: bigint; terminalToken: Address }
    | { kind: "claimFees"; projectId: bigint; beneficiary: Address },
): PreparedTx {
  let data: `0x${string}`;
  let review: PreparedTx["review"];
  switch (action.kind) {
    case "deployPool": {
      const args = [action.projectId, 0n] as const;
      data = encodeFunctionData({
        abi: bannyLpSplitHookAbi,
        functionName: "deployPool",
        args,
      });
      review = { abi: bannyLpSplitHookAbi, functionName: "deployPool", args };
      break;
    }
    case "addLiquidity": {
      const args = [action.projectId, action.terminalToken, 0n] as const;
      data = encodeFunctionData({
        abi: bannyLpSplitHookAbi,
        functionName: "addLiquidity",
        args,
      });
      review = { abi: bannyLpSplitHookAbi, functionName: "addLiquidity", args };
      break;
    }
    case "collectFees": {
      const args = [action.projectId, action.terminalToken] as const;
      data = encodeFunctionData({
        abi: bannyLpSplitHookAbi,
        functionName: "collectAndRouteLPFees",
        args,
      });
      review = {
        abi: bannyLpSplitHookAbi,
        functionName: "collectAndRouteLPFees",
        args,
      };
      break;
    }
    case "claimFees": {
      const args = [action.projectId, action.beneficiary] as const;
      data = encodeFunctionData({
        abi: bannyLpSplitHookAbi,
        functionName: "claimFeeTokensFor",
        args,
      });
      review = {
        abi: bannyLpSplitHookAbi,
        functionName: "claimFeeTokensFor",
        args,
      };
      break;
    }
  }
  return { to: hookAddress, data, value: 0n, review };
}
