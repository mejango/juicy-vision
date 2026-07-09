/**
 * Chain Reader Service
 *
 * Reads Juicebox V6 ruleset and splits data directly from the blockchain.
 * All projects (including Revnets) use the same V6 contract set.
 */

import { createPublicClient, http, type Address } from 'viem'
import { mainnet, optimism, base, arbitrum, sepolia, optimismSepolia, baseSepolia, arbitrumSepolia } from 'viem/chains'
import { getConfig } from '../utils/config.ts'
import type { RulesetData, RulesetMetadata, SplitData, FundAccessLimits } from './rulesetCache.ts'

// ============================================================================
// Chain Configuration
// ============================================================================

const MAINNET_CHAINS = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
} as const

const TESTNET_CHAINS = {
  11155111: sepolia,
  11155420: optimismSepolia,
  84532: baseSepolia,
  421614: arbitrumSepolia,
} as const

const MAINNET_RPC_URLS: Record<number, string> = {
  1: 'https://ethereum.publicnode.com',
  10: 'https://mainnet.optimism.io',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
}

const TESTNET_RPC_URLS: Record<number, string> = {
  11155111: 'https://sepolia.drpc.org',
  11155420: 'https://optimism-sepolia.drpc.org',
  84532: 'https://base-sepolia.drpc.org',
  421614: 'https://arbitrum-sepolia.drpc.org',
}

// ============================================================================
// JB Contract Addresses (same via CREATE2 on all chains)
// ============================================================================

// V6 contracts (same address on every supported chain, mainnets and testnets)
const JB_V6 = {
  JBController: '0x3fcec3572e84b624477bcff4e2cf1f7deab648f1' as const,
  JBRulesets: '0x26f2228a4e8b0079ed1c2a3d22f12ff7f83cdfba' as const,
  JBMultiTerminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53' as const,
  JBDirectory: '0x5aff29060e023e6fb87be5596652b33c65af535b' as const,
  JBSplits: '0x28b3d11fcb8d2ad0a143c5b193cd9f2e4d43f4c3' as const,
  JBFundAccessLimits: '0xc93360158f187fc8fc8f1062a1b31d06f185dbab' as const,
}

const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const
const SPLIT_GROUP_RESERVED = 1n

// USDC addresses per chain
const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
}

// ============================================================================
// ABIs
// ============================================================================

const JB_CONTROLLER_ABI = [
  {
    name: 'currentRulesetOf',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      {
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
      },
      {
        name: 'metadata',
        type: 'tuple',
        components: [
          { name: 'reservedPercent', type: 'uint16' },
          { name: 'cashOutTaxRate', type: 'uint16' },
          { name: 'baseCurrency', type: 'uint32' },
          { name: 'pausePay', type: 'bool' },
          { name: 'pauseCreditTransfers', type: 'bool' },
          { name: 'allowOwnerMinting', type: 'bool' },
          { name: 'allowSetCustomToken', type: 'bool' },
          { name: 'allowTerminalMigration', type: 'bool' },
          { name: 'allowSetTerminals', type: 'bool' },
          { name: 'allowSetController', type: 'bool' },
          { name: 'allowAddAccountingContext', type: 'bool' },
          { name: 'allowAddPriceFeed', type: 'bool' },
          { name: 'ownerMustSendPayouts', type: 'bool' },
          { name: 'holdFees', type: 'bool' },
          { name: 'scopeCashOutsToLocalBalances', type: 'bool' },
          { name: 'useDataHookForPay', type: 'bool' },
          { name: 'useDataHookForCashOut', type: 'bool' },
          { name: 'dataHook', type: 'address' },
          { name: 'metadata', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

const RULESET_COMPONENTS = [
  { name: 'cycleNumber', type: 'uint48' },
  { name: 'id', type: 'uint48' },
  { name: 'basedOnId', type: 'uint48' },
  { name: 'start', type: 'uint48' },
  { name: 'duration', type: 'uint32' },
  { name: 'weight', type: 'uint112' },
  { name: 'weightCutPercent', type: 'uint32' },
  { name: 'approvalHook', type: 'address' },
  { name: 'metadata', type: 'uint256' },
] as const

const JB_RULESETS_ABI = [
  {
    name: 'currentOf',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
    stateMutability: 'view',
  },
  {
    name: 'upcomingOf',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
    stateMutability: 'view',
  },
  {
    name: 'latestQueuedOf',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [
      { name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS },
      { name: 'approvalStatus', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getRulesetOf',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
    ],
    outputs: [{ name: 'ruleset', type: 'tuple', components: RULESET_COMPONENTS }],
    stateMutability: 'view',
  },
  {
    name: 'allOf',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'startingId', type: 'uint256' },
      { name: 'size', type: 'uint256' },
    ],
    outputs: [{ name: 'rulesets', type: 'tuple[]', components: RULESET_COMPONENTS }],
    stateMutability: 'view',
  },
] as const

const JB_SPLITS_ABI = [
  {
    name: 'splitsOf',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'groupId', type: 'uint256' },
    ],
    outputs: [{
      name: 'splits',
      type: 'tuple[]',
      components: [
        { name: 'percent', type: 'uint32' },
        { name: 'projectId', type: 'uint64' },
        { name: 'beneficiary', type: 'address' },
        { name: 'preferAddToBalance', type: 'bool' },
        { name: 'lockedUntil', type: 'uint48' },
        { name: 'hook', type: 'address' },
      ],
    }],
    stateMutability: 'view',
  },
] as const

const JB_FUND_ACCESS_LIMITS_ABI = [
  {
    name: 'payoutLimitsOf',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'terminal', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{
      name: 'limits',
      type: 'tuple[]',
      components: [
        { name: 'amount', type: 'uint224' },
        { name: 'currency', type: 'uint32' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    name: 'surplusAllowancesOf',
    type: 'function',
    inputs: [
      { name: 'projectId', type: 'uint256' },
      { name: 'rulesetId', type: 'uint256' },
      { name: 'terminal', type: 'address' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{
      name: 'allowances',
      type: 'tuple[]',
      components: [
        { name: 'amount', type: 'uint224' },
        { name: 'currency', type: 'uint32' },
      ],
    }],
    stateMutability: 'view',
  },
] as const

// ============================================================================
// Helpers
// ============================================================================

function getPublicClient(chainId: number) {
  const config = getConfig()
  const isTestnet = config.isTestnet

  if (isTestnet) {
    const chain = TESTNET_CHAINS[chainId as keyof typeof TESTNET_CHAINS]
    if (!chain) throw new Error(`Unsupported testnet chain: ${chainId}`)
    return createPublicClient({
      chain,
      transport: http(TESTNET_RPC_URLS[chainId]),
    })
  }

  const chain = MAINNET_CHAINS[chainId as keyof typeof MAINNET_CHAINS]
  if (!chain) throw new Error(`Unsupported mainnet chain: ${chainId}`)
  return createPublicClient({
    chain,
    transport: http(MAINNET_RPC_URLS[chainId]),
  })
}

/**
 * The V6 contracts used for every project. Kept as a function so call sites
 * read the same as before; V6 has a single contract set with no per-project
 * version detection.
 */
function getContractsForProject(_chainId: number, _projectId: number): {
  JBController: `0x${string}`
  JBRulesets: `0x${string}`
  JBMultiTerminal: `0x${string}`
} {
  return {
    JBController: JB_V6.JBController,
    JBRulesets: JB_V6.JBRulesets,
    JBMultiTerminal: JB_V6.JBMultiTerminal,
  }
}

/**
 * Decode packed ruleset metadata from uint256 (V6 bit layout, see
 * nana-core-v6 JBRulesetMetadataResolver)
 */
function decodeRulesetMetadata(packed: bigint): RulesetMetadata {
  return {
    reservedPercent: Number((packed >> 4n) & 0xFFFFn),
    cashOutTaxRate: Number((packed >> 20n) & 0xFFFFn),
    baseCurrency: Number((packed >> 36n) & 0xFFFFFFFFn),
    pausePay: Boolean((packed >> 68n) & 1n),
    pauseCreditTransfers: Boolean((packed >> 69n) & 1n),
    allowOwnerMinting: Boolean((packed >> 70n) & 1n),
    allowSetCustomToken: Boolean((packed >> 71n) & 1n),
    allowTerminalMigration: Boolean((packed >> 72n) & 1n),
    allowSetTerminals: Boolean((packed >> 73n) & 1n),
    allowSetController: Boolean((packed >> 74n) & 1n),
    allowAddAccountingContext: Boolean((packed >> 75n) & 1n),
    allowAddPriceFeed: Boolean((packed >> 76n) & 1n),
    ownerMustSendPayouts: Boolean((packed >> 77n) & 1n),
    holdFees: Boolean((packed >> 78n) & 1n),
    scopeCashOutsToLocalBalances: Boolean((packed >> 79n) & 1n),
    useDataHookForPay: Boolean((packed >> 80n) & 1n),
    useDataHookForCashOut: Boolean((packed >> 81n) & 1n),
    dataHook: `0x${((packed >> 82n) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`,
    metadata: Number((packed >> 242n) & 0xFFFFn),
  }
}

function getPayoutSplitGroup(token: `0x${string}`): bigint {
  return BigInt(token)
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch the current ruleset for a project directly from chain
 */
export async function fetchCurrentRuleset(
  chainId: number,
  projectId: number
): Promise<{ ruleset: RulesetData; metadata: RulesetMetadata } | null> {
  const client = getPublicClient(chainId)
  const contracts = getContractsForProject(chainId, projectId)

  try {
    const [ruleset, metadata] = await client.readContract({
      address: contracts.JBController,
      abi: JB_CONTROLLER_ABI,
      functionName: 'currentRulesetOf',
      args: [BigInt(projectId)],
    })

    if (ruleset.cycleNumber === 0) {
      // Try currentOf from JBRulesets directly
      const currentRuleset = await client.readContract({
        address: contracts.JBRulesets,
        abi: JB_RULESETS_ABI,
        functionName: 'currentOf',
        args: [BigInt(projectId)],
      })

      if (currentRuleset.cycleNumber === 0) return null

      return {
        ruleset: {
          cycleNumber: Number(currentRuleset.cycleNumber),
          id: String(currentRuleset.id),
          start: Number(currentRuleset.start),
          duration: Number(currentRuleset.duration),
          weight: String(currentRuleset.weight),
          weightCutPercent: Number(currentRuleset.weightCutPercent),
          basedOnId: String(currentRuleset.basedOnId),
        },
        metadata: decodeRulesetMetadata(currentRuleset.metadata),
      }
    }

    return {
      ruleset: {
        cycleNumber: Number(ruleset.cycleNumber),
        id: String(ruleset.id),
        start: Number(ruleset.start),
        duration: Number(ruleset.duration),
        weight: String(ruleset.weight),
        weightCutPercent: Number(ruleset.weightCutPercent),
        basedOnId: String(ruleset.basedOnId),
        metadata: {
          reservedPercent: metadata.reservedPercent,
          cashOutTaxRate: metadata.cashOutTaxRate,
          baseCurrency: metadata.baseCurrency,
          pausePay: metadata.pausePay,
          pauseCreditTransfers: metadata.pauseCreditTransfers,
          allowOwnerMinting: metadata.allowOwnerMinting,
          allowSetCustomToken: metadata.allowSetCustomToken,
          allowTerminalMigration: metadata.allowTerminalMigration,
          allowSetTerminals: metadata.allowSetTerminals,
          allowSetController: metadata.allowSetController,
          allowAddAccountingContext: metadata.allowAddAccountingContext,
          allowAddPriceFeed: metadata.allowAddPriceFeed,
          ownerMustSendPayouts: metadata.ownerMustSendPayouts,
          holdFees: metadata.holdFees,
          scopeCashOutsToLocalBalances: metadata.scopeCashOutsToLocalBalances,
          useDataHookForPay: metadata.useDataHookForPay,
          useDataHookForCashOut: metadata.useDataHookForCashOut,
          dataHook: metadata.dataHook,
          metadata: metadata.metadata,
        },
      },
      metadata: {
        reservedPercent: metadata.reservedPercent,
        cashOutTaxRate: metadata.cashOutTaxRate,
        baseCurrency: metadata.baseCurrency,
        pausePay: metadata.pausePay,
        pauseCreditTransfers: metadata.pauseCreditTransfers,
        allowOwnerMinting: metadata.allowOwnerMinting,
        allowSetCustomToken: metadata.allowSetCustomToken,
        allowTerminalMigration: metadata.allowTerminalMigration,
        allowSetTerminals: metadata.allowSetTerminals,
        allowSetController: metadata.allowSetController,
        allowAddAccountingContext: metadata.allowAddAccountingContext,
        allowAddPriceFeed: metadata.allowAddPriceFeed,
        ownerMustSendPayouts: metadata.ownerMustSendPayouts,
        holdFees: metadata.holdFees,
        scopeCashOutsToLocalBalances: metadata.scopeCashOutsToLocalBalances,
        useDataHookForPay: metadata.useDataHookForPay,
        useDataHookForCashOut: metadata.useDataHookForCashOut,
        dataHook: metadata.dataHook,
        metadata: metadata.metadata,
      },
    }
  } catch (err) {
    console.error('Failed to fetch current ruleset:', err)
    return null
  }
}

/**
 * Fetch the queued ruleset for a project
 */
export async function fetchQueuedRuleset(
  chainId: number,
  projectId: number
): Promise<{ ruleset: RulesetData; approvalStatus: number } | null> {
  const client = getPublicClient(chainId)
  const contracts = getContractsForProject(chainId, projectId)

  try {
    const [ruleset, approvalStatus] = await client.readContract({
      address: contracts.JBRulesets,
      abi: JB_RULESETS_ABI,
      functionName: 'latestQueuedOf',
      args: [BigInt(projectId)],
    })

    if (ruleset.cycleNumber === 0) return null

    return {
      ruleset: {
        cycleNumber: Number(ruleset.cycleNumber),
        id: String(ruleset.id),
        start: Number(ruleset.start),
        duration: Number(ruleset.duration),
        weight: String(ruleset.weight),
        weightCutPercent: Number(ruleset.weightCutPercent),
        basedOnId: String(ruleset.basedOnId),
        metadata: decodeRulesetMetadata(ruleset.metadata),
      },
      approvalStatus,
    }
  } catch (err) {
    console.error('Failed to fetch queued ruleset:', err)
    return null
  }
}

/**
 * Fetch all historical rulesets using allOf
 */
export async function fetchRulesetHistory(
  chainId: number,
  projectId: number,
  maxRulesets: number = 100
): Promise<RulesetData[]> {
  const client = getPublicClient(chainId)
  const contracts = getContractsForProject(chainId, projectId)

  try {
    const rulesets = await client.readContract({
      address: contracts.JBRulesets,
      abi: JB_RULESETS_ABI,
      functionName: 'allOf',
      args: [BigInt(projectId), 0n, BigInt(maxRulesets)],
    })

    return rulesets
      .filter((r) => r.cycleNumber > 0)
      .map((r) => ({
        cycleNumber: Number(r.cycleNumber),
        id: String(r.id),
        start: Number(r.start),
        duration: Number(r.duration),
        weight: String(r.weight),
        weightCutPercent: Number(r.weightCutPercent),
        basedOnId: String(r.basedOnId),
        metadata: decodeRulesetMetadata(r.metadata),
      }))
      .sort((a, b) => a.start - b.start)
  } catch (err) {
    console.error('Failed to fetch ruleset history:', err)
    return []
  }
}

/**
 * Get the current cycle number (fast check for cache invalidation)
 */
export async function getCurrentCycleNumber(
  chainId: number,
  projectId: number
): Promise<number | null> {
  const client = getPublicClient(chainId)
  const contracts = getContractsForProject(chainId, projectId)

  try {
    const ruleset = await client.readContract({
      address: contracts.JBRulesets,
      abi: JB_RULESETS_ABI,
      functionName: 'currentOf',
      args: [BigInt(projectId)],
    })

    return Number(ruleset.cycleNumber)
  } catch {
    return null
  }
}

/**
 * Fetch splits for a ruleset
 */
export async function fetchSplits(
  chainId: number,
  projectId: number,
  rulesetId: string
): Promise<{ payoutSplits: SplitData[]; reservedSplits: SplitData[]; fundAccessLimits: FundAccessLimits | null }> {
  const client = getPublicClient(chainId)
  const contracts = getContractsForProject(chainId, projectId)
  const rsId = BigInt(rulesetId)

  const result: { payoutSplits: SplitData[]; reservedSplits: SplitData[]; fundAccessLimits: FundAccessLimits | null } = {
    payoutSplits: [],
    reservedSplits: [],
    fundAccessLimits: null,
  }

  // Fetch reserved splits
  try {
    const reservedRaw = await client.readContract({
      address: JB_V6.JBSplits,
      abi: JB_SPLITS_ABI,
      functionName: 'splitsOf',
      args: [BigInt(projectId), rsId, SPLIT_GROUP_RESERVED],
    })

    result.reservedSplits = reservedRaw.map((s) => ({
      percent: s.percent,
      projectId: Number(s.projectId),
      beneficiary: s.beneficiary,
      preferAddToBalance: s.preferAddToBalance,
      lockedUntil: s.lockedUntil,
      hook: s.hook,
    }))
  } catch {
    // No reserved splits
  }

  // Fetch payout splits (try ETH first, then USDC)
  const ethToken = NATIVE_TOKEN
  const usdcToken = USDC_ADDRESSES[chainId]

  for (const token of [ethToken, usdcToken]) {
    if (!token) continue
    try {
      const payoutGroup = getPayoutSplitGroup(token)
      const payoutRaw = await client.readContract({
        address: JB_V6.JBSplits,
        abi: JB_SPLITS_ABI,
        functionName: 'splitsOf',
        args: [BigInt(projectId), rsId, payoutGroup],
      })

      if (payoutRaw.length > 0) {
        result.payoutSplits = payoutRaw.map((s) => ({
          percent: s.percent,
          projectId: Number(s.projectId),
          beneficiary: s.beneficiary,
          preferAddToBalance: s.preferAddToBalance,
          lockedUntil: s.lockedUntil,
          hook: s.hook,
        }))
        break // Found payout splits, stop trying
      }
    } catch {
      // Continue to next token
    }
  }

  // Fetch fund access limits
  for (const token of [ethToken, usdcToken]) {
    if (!token) continue
    try {
      const [payoutLimits, surplusAllowances] = await Promise.all([
        client.readContract({
          address: JB_V6.JBFundAccessLimits,
          abi: JB_FUND_ACCESS_LIMITS_ABI,
          functionName: 'payoutLimitsOf',
          args: [BigInt(projectId), rsId, contracts.JBMultiTerminal, token],
        }),
        client.readContract({
          address: JB_V6.JBFundAccessLimits,
          abi: JB_FUND_ACCESS_LIMITS_ABI,
          functionName: 'surplusAllowancesOf',
          args: [BigInt(projectId), rsId, contracts.JBMultiTerminal, token],
        }),
      ])

      if (payoutLimits.length > 0 || surplusAllowances.length > 0) {
        result.fundAccessLimits = {
          payoutLimits: payoutLimits.map((p) => ({
            amount: String(p.amount),
            currency: p.currency,
          })),
          surplusAllowances: surplusAllowances.map((s) => ({
            amount: String(s.amount),
            currency: s.currency,
          })),
        }
        break // Found limits, stop trying
      }
    } catch {
      // Continue to next token
    }
  }

  return result
}
