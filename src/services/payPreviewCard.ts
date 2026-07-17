// Pay-card support logic ported from the website's renderPayCard (website/src/discover.js)
// and pay-preview.js. Everything here is either pure or takes an injected read client so
// the ProjectCard pay panel stays declarative and this logic stays unit-testable.
import type { Address, Hex, PublicClient } from 'viem'
import { quotedOutputFloor, TERMINAL_PREVIEW_PAY_ABI } from '../utils/terminalPreview'
import { JB_CONTRACTS } from '../constants'

type ReadClient = Pick<PublicClient, 'readContract'>

// The probe beneficiary the website uses for route liveness checks. Any non-zero
// address works: previewPayFor is a view and mints nothing.
const PROBE_BENEFICIARY = '0x0000000000000000000000000000000000000001' as Address

// JBRuleset spelled out with wide word types (each static struct field occupies a full
// ABI word, so uint256 decodes the packed uint48/uint32/uint112 fields losslessly).
const RULESET_COMPONENTS = [
  { name: 'cycleNumber', type: 'uint256' },
  { name: 'id', type: 'uint256' },
  { name: 'basedOnId', type: 'uint256' },
  { name: 'start', type: 'uint256' },
  { name: 'duration', type: 'uint256' },
  { name: 'weight', type: 'uint256' },
  { name: 'weightCutPercent', type: 'uint256' },
  { name: 'approvalHook', type: 'address' },
  { name: 'metadata', type: 'uint256' },
] as const

const JB_RULESETS_SCHEDULE_ABI = [
  {
    name: 'currentOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
  },
  {
    name: 'upcomingOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
  },
] as const

interface RulesetSchedule {
  cycleNumber: bigint
  start: bigint
}

function coerceRulesetSchedule(value: unknown): RulesetSchedule | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { cycleNumber?: unknown; start?: unknown }
  try {
    return {
      cycleNumber: BigInt(candidate.cycleNumber as string | number | bigint),
      start: BigInt(candidate.start as string | number | bigint),
    }
  } catch {
    return null
  }
}

export interface PayScheduleGate {
  /**
   * The unix start of the project's first ruleset when it is still in the future,
   * or null when the project is live (or the schedule could not be read — the
   * terminal itself still reverts pre-start payments, so failing open only means
   * no countdown banner).
   */
  startsAt: number | null
}

/**
 * Read whether the project's first ruleset has started. Mirrors the website's
 * "Starts in" countdown gate: paying before the first ruleset starts reverts in
 * the terminal, so the card idles the Pay button behind a countdown.
 */
export async function readPayScheduleGate(
  client: ReadClient,
  projectId: bigint,
): Promise<PayScheduleGate> {
  try {
    const current = coerceRulesetSchedule(
      await client.readContract({
        address: JB_CONTRACTS.JBRulesets,
        abi: JB_RULESETS_SCHEDULE_ABI,
        functionName: 'currentOf',
        args: [projectId],
      }),
    )
    if (current && current.cycleNumber > 0n) return { startsAt: null }

    const upcoming = coerceRulesetSchedule(
      await client.readContract({
        address: JB_CONTRACTS.JBRulesets,
        abi: JB_RULESETS_SCHEDULE_ABI,
        functionName: 'upcomingOf',
        args: [projectId],
      }),
    )
    if (!upcoming || upcoming.cycleNumber <= 0n) return { startsAt: null }
    const start = Number(upcoming.start)
    if (!Number.isFinite(start) || start <= Math.floor(Date.now() / 1000)) {
      return { startsAt: null }
    }
    return { startsAt: start }
  } catch {
    return { startsAt: null }
  }
}

/**
 * Whether the router registry can actually route a pay of `token` into `projectId`
 * right now. Same fail-soft signal as the website's routerPayRouteWorks: a dead
 * route (cold-start cohort, no pool/feed path) previews an all-zero ruleset or
 * reverts, and offering the token there is a trap, not a convenience.
 */
export async function probeRouterPayRoute(
  client: ReadClient,
  registry: Address,
  projectId: bigint,
  token: Address,
  decimals: number,
): Promise<boolean> {
  try {
    const preview = await client.readContract({
      address: registry,
      abi: TERMINAL_PREVIEW_PAY_ABI,
      functionName: 'previewPayFor',
      args: [projectId, token, 10n ** BigInt(decimals), PROBE_BENEFICIARY, '0x'],
    })
    const ruleset = preview[0] as { id?: unknown }
    return BigInt((ruleset?.id as string | number | bigint) ?? 0n) !== 0n
  } catch {
    return false
  }
}

/**
 * A verified zero/zero quote is a legitimate payment (e.g. a balance-funding
 * project whose ruleset weight is 0) — the card hides the meaningless
 * "0 tokens" output instead of blocking. Unavailable or incomplete previews
 * stay blocked elsewhere so an RPC failure is never mistaken for an
 * intentional zero quote.
 */
export function isVerifiedZeroIssuance(
  beneficiaryTokenCount: bigint,
  reservedTokenCount: bigint,
): boolean {
  return beneficiaryTokenCount <= 0n && reservedTokenCount <= 0n
}

export interface DirectSwapOffer {
  poolId: Hex
  /** Full pool output if the buy is routed straight through the pool (no reserved split). */
  quotedOut: bigint
  /** The slippage-floored minimum used for display (matches the 1% AMM floor the pay path enforces). */
  minOut: bigint
  /** How many more tokens the direct swap yields vs paying (which skims the reserved %). */
  advantage: bigint
}

/**
 * Decide whether buying straight from the Uniswap pool beats paying. Ported from
 * the website's maybeOfferDirectSwap cheap branch: when previewPayFor already
 * routed the payment through the buyback AMM, the pool's full output is
 * beneficiary + reserved (pay would split it), so a direct swap keeps the
 * reserved share too. Only for plain buys — no NFT mints, not add-to-balance,
 * and the paid token must be the pool's pair token (a routed/swap currency is
 * not; the AMM preview route already implies the terminal token is the pair).
 */
export function resolveDirectSwapOffer(params: {
  route: 'issuance' | 'amm'
  beneficiaryTokenCount: bigint
  reservedTokenCount: bigint
  poolId: Hex | null
  hasTiers: boolean
  addsToBalance: boolean
  viaRouter: boolean
  slippageBps?: bigint
}): DirectSwapOffer | null {
  if (params.route !== 'amm' || !params.poolId) return null
  if (params.hasTiers || params.addsToBalance || params.viaRouter) return null
  const quotedOut = params.beneficiaryTokenCount + params.reservedTokenCount
  if (quotedOut <= params.beneficiaryTokenCount) return null
  return {
    poolId: params.poolId,
    quotedOut,
    minOut: quotedOutputFloor(quotedOut, 10_000n - (params.slippageBps ?? 100n)),
    advantage: quotedOut - params.beneficiaryTokenCount,
  }
}

const UNISWAP_APP_CHAIN_SLUGS: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  8453: 'base',
  42161: 'arbitrum',
}

/**
 * Link to the pool on the Uniswap app. A Uniswap V4 poolId is a hash, not a
 * contract, so the app's pool explorer is the human destination.
 */
export function uniswapPoolLink(chainId: number, poolId: Hex): string | null {
  const slug = UNISWAP_APP_CHAIN_SLUGS[chainId]
  if (!slug) return null
  return `https://app.uniswap.org/explore/pools/${slug}/${poolId}`
}

/** "2d 03h 14m 09s" style countdown for a future timestamp (seconds remaining). */
export function fmtCountdown(secs: number): string {
  let remaining = Math.max(0, Math.floor(secs))
  const days = Math.floor(remaining / 86400)
  remaining -= days * 86400
  const hours = Math.floor(remaining / 3600)
  remaining -= hours * 3600
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining - minutes * 60
  const pad = (value: number) => (value < 10 ? `0${value}` : String(value))
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (days || hours) parts.push(`${pad(hours)}h`)
  parts.push(`${pad(minutes)}m`)
  parts.push(`${pad(seconds)}s`)
  return parts.join(' ')
}

/** Format an 18-decimal token count with exact bigint math (no float precision loss). */
export function formatExactTokenEstimate(value: bigint, maximumFractionDigits = 2): string {
  const tokenScale = 10n ** 18n
  const displayScale = 10n ** BigInt(maximumFractionDigits)
  const rounded = (value * displayScale + tokenScale / 2n) / tokenScale
  const whole = rounded / displayScale
  const hadFraction = value % tokenScale !== 0n
  const fraction = (rounded % displayScale).toString().padStart(maximumFractionDigits, '0')
  if (hadFraction) return `${whole.toLocaleString('en-US')}.${fraction}`
  return whole.toLocaleString('en-US')
}
