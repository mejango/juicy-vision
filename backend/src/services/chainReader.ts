/**
 * Chain Reader Service
 *
 * Reads Juicebox V5 ruleset and splits data directly from the blockchain.
 * Supports both V5 (Revnets) and V5.1 (standard JB projects) contracts.
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

// Map testnet chain IDs to mainnet equivalents for contract addresses
const TESTNET_TO_MAINNET: Record<number, number> = {
  11155111: 1,
  11155420: 10,
  84532: 8453,
  421614: 42161,
}

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

// V5 contracts (for Revnets)
const JB_V5 = {
  JBController: '0x27da30646502e2f642be5281322ae8c394f7668a' as const,
  JBRulesets: '0x6292281d69c3593fcf6ea074e5797341476ab428' as const,
  JBMultiTerminal: '0x2db6d704058e552defe415753465df8df0361846' as const,
}

// V5.1 contracts (for standard JB projects)
const JB_V5_1 = {
  JBController: '0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1' as const,
  JBRulesets: '0xd4257005ca8d27bbe11f356453b0e4692414b056' as const,
  JBMultiTerminal: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c' as const,
}

// Shared contracts (work with both V5 and V5.1)
const JB_SHARED = {
  JBDirectory: '0x0061e516886a0540f63157f112c0588ee0651dcf' as const,
  JBSplits: '0x7160a322fea44945a6ef9adfd65c322258df3c5e' as const,
  JBFundAccessLimits: '0x3a46b21720c8b70184b0434a2293b2fdcc497ce7' as const,
}

const REV_DEPLOYER = '0x2ca27bde7e7d33e353b44c27acfcf6c78dde251d' as const
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

const JB_DIRECTORY_ABI = [
  {
    name: 'controllerOf',
    type: 'function',
    inputs: [{ name: 'projectId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const

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
          { name: 'pauseCashOut', type: 'bool' },
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
          { name: 'useTotalSurplusForCashOuts', type: 'bool' },
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
 * Get the correct JB contracts for a project (V5 for Revnets, V5.1 for others)
 */
async function getContractsForProject(chainId: number, projectId: number): Promise<{
  JBController: `0x${string}`
  JBRulesets: `0x${string}`
  JBMultiTerminal: `0x${string}`
}> {
  const client = getPublicClient(chainId)

  try {
    const controllerAddress = await client.readContract({
      address: JB_SHARED.JBDirectory,
      abi: JB_DIRECTORY_ABI,
      functionName: 'controllerOf',
      args: [BigInt(projectId)],
    })

    // V5 controller means Revnet → use V5 contracts
    if (controllerAddress.toLowerCase() === JB_V5.JBController.toLowerCase()) {
      return {
        JBController: JB_V5.JBController,
        JBRulesets: JB_V5.JBRulesets,
        JBMultiTerminal: JB_V5.JBMultiTerminal,
      }
    }

    // Otherwise use V5.1 contracts
    return {
      JBController: controllerAddress as `0x${string}`,
      JBRulesets: JB_V5_1.JBRulesets,
      JBMultiTerminal: JB_V5_1.JBMultiTerminal,
    }
  } catch {
    // Default to V5.1 on error
    return {
      JBController: JB_V5_1.JBController,
      JBRulesets: JB_V5_1.JBRulesets,
      JBMultiTerminal: JB_V5_1.JBMultiTerminal,
    }
  }
}

/**
 * Decode packed ruleset metadata from uint256
 */
function decodeRulesetMetadata(packed: bigint): RulesetMetadata {
  return {
    reservedPercent: Number((packed >> 4n) & 0xFFFFn),
    cashOutTaxRate: Number((packed >> 20n) & 0xFFFFn),
    baseCurrency: Number((packed >> 36n) & 0xFFFFFFFFn),
    pausePay: Boolean((packed >> 68n) & 1n),
    pauseCashOut: Boolean((packed >> 69n) & 1n),
    pauseCreditTransfers: Boolean((packed >> 70n) & 1n),
    allowOwnerMinting: Boolean((packed >> 71n) & 1n),
    allowSetCustomToken: Boolean((packed >> 72n) & 1n),
    allowTerminalMigration: Boolean((packed >> 73n) & 1n),
    allowSetTerminals: Boolean((packed >> 74n) & 1n),
    allowSetController: Boolean((packed >> 75n) & 1n),
    allowAddAccountingContext: Boolean((packed >> 76n) & 1n),
    allowAddPriceFeed: Boolean((packed >> 77n) & 1n),
    ownerMustSendPayouts: Boolean((packed >> 78n) & 1n),
    holdFees: Boolean((packed >> 79n) & 1n),
    useTotalSurplusForCashOuts: Boolean((packed >> 80n) & 1n),
    useDataHookForPay: Boolean((packed >> 81n) & 1n),
    useDataHookForCashOut: Boolean((packed >> 82n) & 1n),
    dataHook: `0x${((packed >> 83n) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`,
    metadata: Number((packed >> 243n) & 0xFFFFn),
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
  const contracts = await getContractsForProject(chainId, projectId)

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
          pauseCashOut: metadata.pauseCashOut,
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
          useTotalSurplusForCashOuts: metadata.useTotalSurplusForCashOuts,
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
        pauseCashOut: metadata.pauseCashOut,
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
        useTotalSurplusForCashOuts: metadata.useTotalSurplusForCashOuts,
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
  const contracts = await getContractsForProject(chainId, projectId)

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
  const contracts = await getContractsForProject(chainId, projectId)

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
  const contracts = await getContractsForProject(chainId, projectId)

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
  const contracts = await getContractsForProject(chainId, projectId)
  const rsId = BigInt(rulesetId)

  const result: { payoutSplits: SplitData[]; reservedSplits: SplitData[]; fundAccessLimits: FundAccessLimits | null } = {
    payoutSplits: [],
    reservedSplits: [],
    fundAccessLimits: null,
  }

  // Fetch reserved splits
  try {
    const reservedRaw = await client.readContract({
      address: JB_SHARED.JBSplits,
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
        address: JB_SHARED.JBSplits,
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
          address: JB_SHARED.JBFundAccessLimits,
          abi: JB_FUND_ACCESS_LIMITS_ABI,
          functionName: 'payoutLimitsOf',
          args: [BigInt(projectId), rsId, contracts.JBMultiTerminal, token],
        }),
        client.readContract({
          address: JB_SHARED.JBFundAccessLimits,
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
