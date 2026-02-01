/**
 * JBOmnichainDeployer transaction encoding service.
 * Encodes calldata for launchProjectFor, queueRulesetsOf, and 721 variants locally.
 */

import { encodeFunctionData } from 'viem'
import { JB_OMNICHAIN_DEPLOYER_ABI, JB_OMNICHAIN_DEPLOYER_ADDRESS } from '../constants/abis'
import { JB_CONTRACTS_5_1 } from '../constants/chains'
import type {
  JBRulesetConfig,
  JBTerminalConfig,
  JBSuckerDeploymentConfig,
} from './relayr'

// 721 Tier configuration for NFT hooks
export interface JB721TierConfig {
  price: string
  initialSupply: number
  votingUnits: number
  reserveFrequency: number
  reserveBeneficiary: string
  encodedIPFSUri: string
  category: number
  discountPercent: number
  allowOwnerMint: boolean
  useReserveBeneficiaryAsDefault: boolean
  transfersPausable: boolean
  useVotingUnits: boolean
  cannotBeRemoved: boolean
  cannotIncreaseDiscountPercent: boolean
}

export interface JB721TiersConfig {
  tiers: JB721TierConfig[]
  currency: number
  decimals: number
  prices: string
}

export interface JB721HookFlags {
  noNewTiersWithReserves: boolean
  noNewTiersWithVotes: boolean
  noNewTiersWithOwnerMinting: boolean
  preventOverspending: boolean
}

export interface JBDeployTiersHookConfig {
  name: string
  symbol: string
  baseUri: string
  tokenUriResolver: string
  contractUri: string
  tiersConfig: JB721TiersConfig
  reserveBeneficiary: string
  flags: JB721HookFlags
}

export interface JBQueueRulesetsConfig {
  projectId: number
  rulesetConfigurations: JBRulesetConfig[]
  memo: string
}

// Default controller address (JBController 5.1)
const DEFAULT_CONTROLLER = JB_CONTRACTS_5_1.JBController5_1

/**
 * Encode launchProjectFor calldata for JBOmnichainDeployer.
 * This creates a project and optionally deploys suckers atomically.
 */
export function encodeLaunchProjectFor(params: {
  owner: `0x${string}`
  projectUri: string
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
  suckerDeploymentConfiguration: JBSuckerDeploymentConfig
  controller?: `0x${string}`
}): `0x${string}` {
  const {
    owner,
    projectUri,
    rulesetConfigurations,
    terminalConfigurations,
    memo,
    suckerDeploymentConfiguration,
    controller = DEFAULT_CONTROLLER,
  } = params

  // Transform ruleset configurations to match ABI format
  // Note: viem handles BigInt conversion, we just need to ensure proper types
  const formattedRulesets = rulesetConfigurations.map(ruleset => ({
    mustStartAtOrAfter: ruleset.mustStartAtOrAfter,
    duration: ruleset.duration,
    weight: BigInt(ruleset.weight),
    weightCutPercent: ruleset.weightCutPercent,
    approvalHook: ruleset.approvalHook as `0x${string}`,
    metadata: {
      reservedPercent: ruleset.metadata.reservedPercent,
      cashOutTaxRate: ruleset.metadata.cashOutTaxRate,
      baseCurrency: ruleset.metadata.baseCurrency,
      pausePay: ruleset.metadata.pausePay,
      pauseCreditTransfers: ruleset.metadata.pauseCreditTransfers,
      allowOwnerMinting: ruleset.metadata.allowOwnerMinting,
      allowSetCustomToken: ruleset.metadata.allowSetCustomToken,
      allowTerminalMigration: ruleset.metadata.allowTerminalMigration,
      allowSetTerminals: ruleset.metadata.allowSetTerminals,
      allowSetController: ruleset.metadata.allowSetController,
      allowAddAccountingContext: ruleset.metadata.allowAddAccountingContext,
      allowAddPriceFeed: ruleset.metadata.allowAddPriceFeed,
      ownerMustSendPayouts: ruleset.metadata.ownerMustSendPayouts,
      holdFees: ruleset.metadata.holdFees,
      useTotalSurplusForCashOuts: ruleset.metadata.useTotalSurplusForCashOuts,
      useDataHookForPay: ruleset.metadata.useDataHookForPay,
      useDataHookForCashOut: ruleset.metadata.useDataHookForCashOut,
      dataHook: ruleset.metadata.dataHook as `0x${string}`,
      metadata: ruleset.metadata.metadata,
    },
    splitGroups: ruleset.splitGroups.map(group => ({
      groupId: BigInt(group.groupId),
      splits: group.splits.map(split => ({
        percent: split.percent,
        projectId: BigInt(split.projectId),
        beneficiary: split.beneficiary as `0x${string}`,
        preferAddToBalance: split.preferAddToBalance,
        lockedUntil: split.lockedUntil,
        hook: split.hook as `0x${string}`,
      })),
    })),
    fundAccessLimitGroups: ruleset.fundAccessLimitGroups.map(group => ({
      terminal: group.terminal as `0x${string}`,
      token: group.token as `0x${string}`,
      payoutLimits: group.payoutLimits.map(limit => ({
        amount: BigInt(limit.amount),
        currency: limit.currency,
      })),
      surplusAllowances: group.surplusAllowances.map(allowance => ({
        amount: BigInt(allowance.amount),
        currency: allowance.currency,
      })),
    })),
  }))

  // Transform terminal configurations
  const formattedTerminals = terminalConfigurations.map(terminal => ({
    terminal: terminal.terminal as `0x${string}`,
    accountingContextsToAccept: terminal.accountingContextsToAccept.map(ctx => ({
      token: ctx.token as `0x${string}`,
      decimals: ctx.decimals,
      currency: ctx.currency,
    })),
  }))

  // Transform sucker deployment configuration
  const formattedSuckerConfig = {
    deployerConfigurations: suckerDeploymentConfiguration.deployerConfigurations.map(config => ({
      deployer: config.deployer as `0x${string}`,
      mappings: config.mappings.map(mapping => ({
        localToken: mapping.localToken as `0x${string}`,
        minGas: mapping.minGas,
        remoteToken: mapping.remoteToken as `0x${string}`,
        minBridgeAmount: BigInt(mapping.minBridgeAmount),
      })),
    })),
    salt: suckerDeploymentConfiguration.salt as `0x${string}`,
  }

  return encodeFunctionData({
    abi: JB_OMNICHAIN_DEPLOYER_ABI,
    functionName: 'launchProjectFor',
    args: [
      owner,
      projectUri,
      formattedRulesets,
      formattedTerminals,
      memo,
      formattedSuckerConfig,
      controller,
    ],
  })
}

/**
 * Build transaction data for launching a project via JBOmnichainDeployer.
 */
export function buildLaunchProjectTransaction(params: {
  chainId: number
  owner: `0x${string}`
  projectUri: string
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
  suckerDeploymentConfiguration: JBSuckerDeploymentConfig
  controller?: `0x${string}`
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeLaunchProjectFor(params)

  return {
    chainId: params.chainId,
    to: JB_OMNICHAIN_DEPLOYER_ADDRESS,
    data,
    value: '0x0',
  }
}

/**
 * Build transactions for launching a project on multiple chains.
 * Each chain gets its own transaction targeting JBOmnichainDeployer.
 */
export function buildOmnichainLaunchTransactions(params: {
  chainIds: number[]
  owner: `0x${string}`
  projectUri: string
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
  suckerDeploymentConfiguration: JBSuckerDeploymentConfig
  controller?: `0x${string}`
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  // Log decoded params before ABI encoding
  console.log('=== OMNICHAIN DEPLOYER PARAMS (DECODED) ===')
  console.log('Owner:', params.owner)
  console.log('Project URI:', params.projectUri)
  console.log('Memo:', params.memo)
  console.log('Chain IDs:', params.chainIds)
  console.log('Controller:', params.controller || DEFAULT_CONTROLLER)
  console.log('Ruleset Configurations:', JSON.stringify(params.rulesetConfigurations, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v, 2))
  console.log('Terminal Configurations:', JSON.stringify(params.terminalConfigurations, null, 2))
  console.log('Sucker Deployment Config:', JSON.stringify(params.suckerDeploymentConfiguration, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v, 2))
  console.log('==========================================')

  return params.chainIds.map(chainId =>
    buildLaunchProjectTransaction({
      ...params,
      chainId,
    })
  )
}

// Launch rulesets config for launch721RulesetsFor
export interface JBLaunchRulesetsConfig {
  projectId: number
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
}

/**
 * Helper to format terminal configurations.
 */
function formatTerminalConfigurations(terminalConfigurations: JBTerminalConfig[]) {
  return terminalConfigurations.map(terminal => ({
    terminal: terminal.terminal as `0x${string}`,
    accountingContextsToAccept: terminal.accountingContextsToAccept.map(ctx => ({
      token: ctx.token as `0x${string}`,
      decimals: ctx.decimals,
      currency: ctx.currency,
    })),
  }))
}

/**
 * Helper to format ruleset configurations consistently across functions.
 */
function formatRulesetConfigurations(rulesetConfigurations: JBRulesetConfig[]) {
  return rulesetConfigurations.map(ruleset => ({
    mustStartAtOrAfter: ruleset.mustStartAtOrAfter,
    duration: ruleset.duration,
    weight: BigInt(ruleset.weight),
    weightCutPercent: ruleset.weightCutPercent,
    approvalHook: ruleset.approvalHook as `0x${string}`,
    metadata: {
      reservedPercent: ruleset.metadata.reservedPercent,
      cashOutTaxRate: ruleset.metadata.cashOutTaxRate,
      baseCurrency: ruleset.metadata.baseCurrency,
      pausePay: ruleset.metadata.pausePay,
      pauseCreditTransfers: ruleset.metadata.pauseCreditTransfers,
      allowOwnerMinting: ruleset.metadata.allowOwnerMinting,
      allowSetCustomToken: ruleset.metadata.allowSetCustomToken,
      allowTerminalMigration: ruleset.metadata.allowTerminalMigration,
      allowSetTerminals: ruleset.metadata.allowSetTerminals,
      allowSetController: ruleset.metadata.allowSetController,
      allowAddAccountingContext: ruleset.metadata.allowAddAccountingContext,
      allowAddPriceFeed: ruleset.metadata.allowAddPriceFeed,
      ownerMustSendPayouts: ruleset.metadata.ownerMustSendPayouts,
      holdFees: ruleset.metadata.holdFees,
      useTotalSurplusForCashOuts: ruleset.metadata.useTotalSurplusForCashOuts,
      useDataHookForPay: ruleset.metadata.useDataHookForPay,
      useDataHookForCashOut: ruleset.metadata.useDataHookForCashOut,
      dataHook: ruleset.metadata.dataHook as `0x${string}`,
      metadata: ruleset.metadata.metadata,
    },
    splitGroups: ruleset.splitGroups.map(group => ({
      groupId: BigInt(group.groupId),
      splits: group.splits.map(split => ({
        percent: split.percent,
        projectId: BigInt(split.projectId),
        beneficiary: split.beneficiary as `0x${string}`,
        preferAddToBalance: split.preferAddToBalance,
        lockedUntil: split.lockedUntil,
        hook: split.hook as `0x${string}`,
      })),
    })),
    fundAccessLimitGroups: ruleset.fundAccessLimitGroups.map(group => ({
      terminal: group.terminal as `0x${string}`,
      token: group.token as `0x${string}`,
      payoutLimits: group.payoutLimits.map(limit => ({
        amount: BigInt(limit.amount),
        currency: limit.currency,
      })),
      surplusAllowances: group.surplusAllowances.map(allowance => ({
        amount: BigInt(allowance.amount),
        currency: allowance.currency,
      })),
    })),
  }))
}

/**
 * Helper to format 721 tiers hook configuration.
 */
function formatDeployTiersHookConfig(config: JBDeployTiersHookConfig) {
  return {
    name: config.name,
    symbol: config.symbol,
    baseUri: config.baseUri,
    tokenUriResolver: config.tokenUriResolver as `0x${string}`,
    contractUri: config.contractUri,
    tiersConfig: {
      tiers: config.tiersConfig.tiers.map(tier => ({
        price: BigInt(tier.price),
        initialSupply: tier.initialSupply,
        votingUnits: tier.votingUnits,
        reserveFrequency: tier.reserveFrequency,
        reserveBeneficiary: tier.reserveBeneficiary as `0x${string}`,
        encodedIPFSUri: tier.encodedIPFSUri as `0x${string}`,
        category: tier.category,
        discountPercent: tier.discountPercent,
        allowOwnerMint: tier.allowOwnerMint,
        useReserveBeneficiaryAsDefault: tier.useReserveBeneficiaryAsDefault,
        transfersPausable: tier.transfersPausable,
        useVotingUnits: tier.useVotingUnits,
        cannotBeRemoved: tier.cannotBeRemoved,
        cannotIncreaseDiscountPercent: tier.cannotIncreaseDiscountPercent,
      })),
      currency: config.tiersConfig.currency,
      decimals: config.tiersConfig.decimals,
      prices: config.tiersConfig.prices as `0x${string}`,
    },
    reserveBeneficiary: config.reserveBeneficiary as `0x${string}`,
    flags: {
      noNewTiersWithReserves: config.flags.noNewTiersWithReserves,
      noNewTiersWithVotes: config.flags.noNewTiersWithVotes,
      noNewTiersWithOwnerMinting: config.flags.noNewTiersWithOwnerMinting,
      preventOverspending: config.flags.preventOverspending,
    },
  }
}

/**
 * Encode launch721RulesetsFor calldata for JBOmnichainDeployer.
 * Launches rulesets with a 721 tiers hook for an existing project.
 */
export function encodeLaunch721RulesetsFor(params: {
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  launchRulesetsConfig: JBLaunchRulesetsConfig
  controller?: `0x${string}`
  salt?: `0x${string}`
}): `0x${string}` {
  const {
    projectId,
    deployTiersHookConfig,
    launchRulesetsConfig,
    controller = DEFAULT_CONTROLLER,
    salt = '0x0000000000000000000000000000000000000000000000000000000000000000',
  } = params

  const formattedDeployConfig = formatDeployTiersHookConfig(deployTiersHookConfig)
  const formattedLaunchConfig = {
    projectId: BigInt(launchRulesetsConfig.projectId),
    rulesetConfigurations: formatRulesetConfigurations(launchRulesetsConfig.rulesetConfigurations),
    terminalConfigurations: formatTerminalConfigurations(launchRulesetsConfig.terminalConfigurations),
    memo: launchRulesetsConfig.memo,
  }

  return encodeFunctionData({
    abi: JB_OMNICHAIN_DEPLOYER_ABI,
    functionName: 'launch721RulesetsFor',
    args: [
      BigInt(projectId),
      formattedDeployConfig,
      formattedLaunchConfig,
      controller,
      salt,
    ],
  })
}

/**
 * Build transaction data for launching 721 rulesets via JBOmnichainDeployer.
 */
export function buildLaunch721RulesetsTransaction(params: {
  chainId: number
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  launchRulesetsConfig: JBLaunchRulesetsConfig
  controller?: `0x${string}`
  salt?: `0x${string}`
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeLaunch721RulesetsFor(params)

  return {
    chainId: params.chainId,
    to: JB_OMNICHAIN_DEPLOYER_ADDRESS,
    data,
    value: '0x0',
  }
}

/**
 * Build transactions for launching 721 rulesets on multiple chains.
 */
export function buildOmnichainLaunch721RulesetsTransactions(params: {
  chainIds: number[]
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  launchRulesetsConfig: JBLaunchRulesetsConfig
  controller?: `0x${string}`
  salt?: `0x${string}`
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  return params.chainIds.map(chainId =>
    buildLaunch721RulesetsTransaction({
      ...params,
      chainId,
    })
  )
}

/**
 * Encode queueRulesetsOf calldata for JBOmnichainDeployer.
 * Queues new rulesets for an existing project (without 721 tiers hook).
 */
export function encodeQueueRulesetsOf(params: {
  projectId: number | bigint
  rulesetConfigurations: JBRulesetConfig[]
  memo: string
  controller?: `0x${string}`
}): `0x${string}` {
  const {
    projectId,
    rulesetConfigurations,
    memo,
    controller = DEFAULT_CONTROLLER,
  } = params

  const formattedRulesets = formatRulesetConfigurations(rulesetConfigurations)

  return encodeFunctionData({
    abi: JB_OMNICHAIN_DEPLOYER_ABI,
    functionName: 'queueRulesetsOf',
    args: [
      BigInt(projectId),
      formattedRulesets,
      memo,
      controller,
    ],
  })
}

/**
 * Build transaction data for queueing rulesets via JBOmnichainDeployer.
 */
export function buildQueueRulesetsTransaction(params: {
  chainId: number
  projectId: number | bigint
  rulesetConfigurations: JBRulesetConfig[]
  memo: string
  controller?: `0x${string}`
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeQueueRulesetsOf(params)

  return {
    chainId: params.chainId,
    to: JB_OMNICHAIN_DEPLOYER_ADDRESS,
    data,
    value: '0x0',
  }
}

/**
 * Build transactions for queueing rulesets on multiple chains.
 */
export function buildOmnichainQueueRulesetsTransactions(params: {
  chainIds: number[]
  projectId: number | bigint
  rulesetConfigurations: JBRulesetConfig[]
  memo: string
  controller?: `0x${string}`
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  return params.chainIds.map(chainId =>
    buildQueueRulesetsTransaction({
      ...params,
      chainId,
    })
  )
}

/**
 * Encode queue721RulesetsOf calldata for JBOmnichainDeployer.
 * Queues new rulesets with a 721 tiers hook for an existing project.
 */
export function encodeQueue721RulesetsOf(params: {
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  queueRulesetsConfig: JBQueueRulesetsConfig
  controller?: `0x${string}`
  salt?: `0x${string}`
}): `0x${string}` {
  const {
    projectId,
    deployTiersHookConfig,
    queueRulesetsConfig,
    controller = DEFAULT_CONTROLLER,
    salt = '0x0000000000000000000000000000000000000000000000000000000000000000',
  } = params

  const formattedDeployConfig = formatDeployTiersHookConfig(deployTiersHookConfig)
  const formattedQueueConfig = {
    projectId: BigInt(queueRulesetsConfig.projectId),
    rulesetConfigurations: formatRulesetConfigurations(queueRulesetsConfig.rulesetConfigurations),
    memo: queueRulesetsConfig.memo,
  }

  return encodeFunctionData({
    abi: JB_OMNICHAIN_DEPLOYER_ABI,
    functionName: 'queue721RulesetsOf',
    args: [
      BigInt(projectId),
      formattedDeployConfig,
      formattedQueueConfig,
      controller,
      salt,
    ],
  })
}

/**
 * Build transaction data for queueing 721 rulesets via JBOmnichainDeployer.
 */
export function buildQueue721RulesetsTransaction(params: {
  chainId: number
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  queueRulesetsConfig: JBQueueRulesetsConfig
  controller?: `0x${string}`
  salt?: `0x${string}`
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeQueue721RulesetsOf(params)

  return {
    chainId: params.chainId,
    to: JB_OMNICHAIN_DEPLOYER_ADDRESS,
    data,
    value: '0x0',
  }
}

/**
 * Build transactions for queueing 721 rulesets on multiple chains.
 */
export function buildOmnichainQueue721RulesetsTransactions(params: {
  chainIds: number[]
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  queueRulesetsConfig: JBQueueRulesetsConfig
  controller?: `0x${string}`
  salt?: `0x${string}`
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  return params.chainIds.map(chainId =>
    buildQueue721RulesetsTransaction({
      ...params,
      chainId,
    })
  )
}
