/**
 * Client-side Juicebox calldata encoding using viem
 * Replaces non-existent /v1/juicebox/* API endpoints
 */

import { encodeFunctionData, type Address, type Hex } from 'viem'
import {
  JB_CONTROLLER_ABI,
  JB_CONTROLLER_ADDRESS,
  JB_MULTI_TERMINAL_ABI,
  JB_MULTI_TERMINAL_ADDRESS,
  JB_OMNICHAIN_DEPLOYER_ABI,
  JB_OMNICHAIN_DEPLOYER_ADDRESS,
  JB_SUCKER_REGISTRY_ABI,
  JB_SUCKER_REGISTRY_ADDRESS,
  REV_DEPLOYER_ABI,
  REV_DEPLOYER_ADDRESS,
  NATIVE_TOKEN,
} from '../../constants/abis'

// ============================================================================
// Types (matching client.ts interfaces)
// ============================================================================

export interface JBPayRequest {
  chainId: number
  projectId: number
  amount: string // in wei
  beneficiary: string
  minReturnedTokens: string
  memo: string
  metadata?: string
}

export interface JBCashOutRequest {
  chainId: number
  projectId: number
  tokenAmount: string
  beneficiary: string
  minReclaimedTokens: string
  metadata?: string
}

export interface JBSendPayoutsRequest {
  chainId: number
  projectId: number
  amount: string
  currency: number // 1 = ETH
  minTokensPaidOut: string
}

export interface JBRulesetMetadataConfig {
  reservedPercent: number
  cashOutTaxRate: number
  baseCurrency: number
  pausePay: boolean
  pauseCreditTransfers: boolean
  allowOwnerMinting: boolean
  allowSetCustomToken: boolean
  allowTerminalMigration: boolean
  allowSetTerminals: boolean
  allowSetController: boolean
  allowAddAccountingContext: boolean
  allowAddPriceFeed: boolean
  ownerMustSendPayouts: boolean
  holdFees: boolean
  useTotalSurplusForCashOuts: boolean
  useDataHookForPay: boolean
  useDataHookForCashOut: boolean
  dataHook: string
  metadata: number
}

export interface JBSplitConfig {
  percent: number
  projectId: number
  beneficiary: string
  preferAddToBalance: boolean
  lockedUntil: number
  hook: string
}

export interface JBSplitGroupConfig {
  groupId: string
  splits: JBSplitConfig[]
}

export interface JBCurrencyAmountConfig {
  amount: string
  currency: number
}

export interface JBFundAccessLimitGroupConfig {
  terminal: string
  token: string
  payoutLimits: JBCurrencyAmountConfig[]
  surplusAllowances: JBCurrencyAmountConfig[]
}

export interface JBRulesetConfig {
  mustStartAtOrAfter: number
  duration: number
  weight: string
  weightCutPercent: number
  approvalHook: string
  metadata: JBRulesetMetadataConfig
  splitGroups: JBSplitGroupConfig[]
  fundAccessLimitGroups: JBFundAccessLimitGroupConfig[]
}

export interface JBQueueRulesetRequest {
  chainId: number
  projectId: number
  rulesetConfigurations: JBRulesetConfig[]
  memo: string
}

export interface JBTransactionData {
  to: string
  data: string
  value: string
  chainId: number
}

export interface JBTransactionResponse {
  txData: JBTransactionData
  estimatedGas: string
  description: string
}

// ============================================================================
// Helpers
// ============================================================================

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRulesetConfigTuple(config: JBRulesetConfig): any {
  return {
    mustStartAtOrAfter: config.mustStartAtOrAfter,
    duration: config.duration,
    weight: BigInt(config.weight),
    weightCutPercent: config.weightCutPercent,
    approvalHook: (config.approvalHook || ZERO_ADDRESS) as Address,
    metadata: {
      reservedPercent: config.metadata.reservedPercent,
      cashOutTaxRate: config.metadata.cashOutTaxRate,
      baseCurrency: config.metadata.baseCurrency,
      pausePay: config.metadata.pausePay,
      pauseCreditTransfers: config.metadata.pauseCreditTransfers,
      allowOwnerMinting: config.metadata.allowOwnerMinting,
      allowSetCustomToken: config.metadata.allowSetCustomToken,
      allowTerminalMigration: config.metadata.allowTerminalMigration,
      allowSetTerminals: config.metadata.allowSetTerminals,
      allowSetController: config.metadata.allowSetController,
      allowAddAccountingContext: config.metadata.allowAddAccountingContext,
      allowAddPriceFeed: config.metadata.allowAddPriceFeed,
      ownerMustSendPayouts: config.metadata.ownerMustSendPayouts,
      holdFees: config.metadata.holdFees,
      useTotalSurplusForCashOuts: config.metadata.useTotalSurplusForCashOuts,
      useDataHookForPay: config.metadata.useDataHookForPay,
      useDataHookForCashOut: config.metadata.useDataHookForCashOut,
      dataHook: (config.metadata.dataHook || ZERO_ADDRESS) as Address,
      metadata: config.metadata.metadata,
    },
    splitGroups: config.splitGroups.map(sg => ({
      groupId: BigInt(sg.groupId),
      splits: sg.splits.map(s => ({
        preferAddToBalance: s.preferAddToBalance,
        percent: s.percent,
        projectId: BigInt(s.projectId),
        beneficiary: s.beneficiary as Address,
        lockedUntil: s.lockedUntil,
        hook: (s.hook || ZERO_ADDRESS) as Address,
      })),
    })),
    fundAccessLimitGroups: config.fundAccessLimitGroups.map(falg => ({
      terminal: falg.terminal as Address,
      token: falg.token as Address,
      payoutLimits: falg.payoutLimits.map(pl => ({
        amount: BigInt(pl.amount),
        currency: pl.currency,
      })),
      surplusAllowances: falg.surplusAllowances.map(sa => ({
        amount: BigInt(sa.amount),
        currency: sa.currency,
      })),
    })),
  }
}

// ============================================================================
// Encoders
// ============================================================================

/**
 * Encode JBMultiTerminal.pay() calldata
 */
export function encodePayTransaction(request: JBPayRequest): JBTransactionResponse {
  const data = encodeFunctionData({
    abi: JB_MULTI_TERMINAL_ABI,
    functionName: 'pay',
    args: [
      BigInt(request.projectId),
      NATIVE_TOKEN as Address, // token (native ETH)
      BigInt(request.amount),
      request.beneficiary as Address,
      BigInt(request.minReturnedTokens),
      request.memo,
      (request.metadata || '0x') as Hex,
    ],
  })

  return {
    txData: {
      to: JB_MULTI_TERMINAL_ADDRESS,
      data,
      value: request.amount,
      chainId: request.chainId,
    },
    estimatedGas: '250000', // Conservative estimate
    description: `Pay ${request.amount} wei to project ${request.projectId}`,
  }
}

/**
 * Encode JBMultiTerminal.cashOutTokensOf() calldata
 */
export function encodeCashOutTransaction(request: JBCashOutRequest): JBTransactionResponse {
  const data = encodeFunctionData({
    abi: JB_MULTI_TERMINAL_ABI,
    functionName: 'cashOutTokensOf',
    args: [
      request.beneficiary as Address, // holder
      BigInt(request.projectId),
      BigInt(request.tokenAmount),
      NATIVE_TOKEN as Address, // tokenToReclaim (native ETH)
      BigInt(request.minReclaimedTokens),
      request.beneficiary as Address,
      (request.metadata || '0x') as Hex,
    ],
  })

  return {
    txData: {
      to: JB_MULTI_TERMINAL_ADDRESS,
      data,
      value: '0x0',
      chainId: request.chainId,
    },
    estimatedGas: '300000',
    description: `Cash out ${request.tokenAmount} tokens from project ${request.projectId}`,
  }
}

/**
 * Encode JBMultiTerminal.sendPayoutsOf() calldata
 */
export function encodeSendPayoutsTransaction(request: JBSendPayoutsRequest): JBTransactionResponse {
  const data = encodeFunctionData({
    abi: JB_MULTI_TERMINAL_ABI,
    functionName: 'sendPayoutsOf',
    args: [
      BigInt(request.projectId),
      NATIVE_TOKEN as Address, // token (native ETH)
      BigInt(request.amount),
      BigInt(request.currency),
      BigInt(request.minTokensPaidOut),
    ],
  })

  return {
    txData: {
      to: JB_MULTI_TERMINAL_ADDRESS,
      data,
      value: '0x0',
      chainId: request.chainId,
    },
    estimatedGas: '400000',
    description: `Send payouts of ${request.amount} from project ${request.projectId}`,
  }
}

/**
 * Encode JBController.queueRulesetsOf() calldata
 */
export function encodeQueueRulesetTransaction(request: JBQueueRulesetRequest): JBTransactionResponse {
  const rulesetConfigs = request.rulesetConfigurations.map(toRulesetConfigTuple)

  const data = encodeFunctionData({
    abi: JB_CONTROLLER_ABI,
    functionName: 'queueRulesetsOf',
    args: [
      BigInt(request.projectId),
      rulesetConfigs,
      request.memo,
    ],
  })

  return {
    txData: {
      to: JB_CONTROLLER_ADDRESS,
      data,
      value: '0x0',
      chainId: request.chainId,
    },
    estimatedGas: '500000',
    description: `Queue ${request.rulesetConfigurations.length} ruleset(s) for project ${request.projectId}`,
  }
}

/**
 * Encode JBController.deployERC20For() calldata
 */
export function encodeDeployERC20Transaction(
  chainId: number,
  projectId: number,
  name: string,
  symbol: string,
  salt: string
): JBTransactionResponse {
  const data = encodeFunctionData({
    abi: JB_CONTROLLER_ABI,
    functionName: 'deployERC20For',
    args: [
      BigInt(projectId),
      name,
      symbol,
      salt as Hex,
    ],
  })

  return {
    txData: {
      to: JB_CONTROLLER_ADDRESS,
      data,
      value: '0x0',
      chainId,
    },
    estimatedGas: '300000',
    description: `Deploy ERC20 ${symbol} for project ${projectId}`,
  }
}

/**
 * Encode JBController.sendReservedTokensToSplitsOf() calldata
 */
export function encodeSendReservesTransaction(
  chainId: number,
  projectId: number
): JBTransactionResponse {
  const data = encodeFunctionData({
    abi: JB_CONTROLLER_ABI,
    functionName: 'sendReservedTokensToSplitsOf',
    args: [BigInt(projectId)],
  })

  return {
    txData: {
      to: JB_CONTROLLER_ADDRESS,
      data,
      value: '0x0',
      chainId,
    },
    estimatedGas: '400000',
    description: `Send reserved tokens for project ${projectId}`,
  }
}

// ============================================================================
// Omnichain Deployer Types
// ============================================================================

export interface JBTerminalConfig {
  terminal: string
  accountingContextsToAccept: Array<{
    token: string
    decimals: number
    currency: number
  }>
}

export interface JBSuckerTokenMapping {
  localToken: string
  remoteToken: string
  minGas: number
  minBridgeAmount: string
}

export interface JBSuckerDeployerConfig {
  deployer: string
  mappings: JBSuckerTokenMapping[]
}

export interface JBSuckerDeploymentConfig {
  deployerConfigurations: JBSuckerDeployerConfig[]
  salt: string
}

export interface JBLaunchProjectRequest {
  chainIds: number[]
  owner: string
  projectUri: string
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
  suckerDeploymentConfiguration?: JBSuckerDeploymentConfig
}

export interface REVStageConfig {
  startsAtOrAfter: number
  splitPercent: number
  initialIssuance: string
  issuanceDecayFrequency: number
  issuanceDecayPercent: number
  cashOutTaxRate: number
  extraMetadata: number
}

export interface JBDeployRevnetRequest {
  chainIds: number[]
  stageConfigurations: REVStageConfig[]
  splitOperator: string
  description: {
    name: string
    tagline: string
    salt: string
  }
  suckerDeploymentConfiguration?: JBSuckerDeploymentConfig
  initialTokenReceivers?: Array<{
    beneficiary: string
    count: number
  }>
}

export interface JBDeploySuckersRequest {
  chainIds: number[]
  projectIds: Record<number, number>
  salt: string
  tokenMappings: JBSuckerTokenMapping[]
  deployerOverrides?: Record<number, string>
}

// ============================================================================
// Omnichain Deployer Encoders
// ============================================================================

/**
 * Encode JBOmnichainDeployer.launchProjectFor() calldata
 */
export function encodeLaunchProjectTransaction(
  chainId: number,
  request: JBLaunchProjectRequest
): JBTransactionResponse {
  const rulesetConfigs = request.rulesetConfigurations.map(toRulesetConfigTuple)

  const terminalConfigs = request.terminalConfigurations.map(tc => ({
    terminal: tc.terminal as Address,
    accountingContextsToAccept: tc.accountingContextsToAccept.map(ctx => ({
      token: ctx.token as Address,
      decimals: ctx.decimals,
      currency: ctx.currency,
    })),
  }))

  const suckerConfig = request.suckerDeploymentConfiguration
    ? {
        deployerConfigurations: request.suckerDeploymentConfiguration.deployerConfigurations.map(dc => ({
          deployer: dc.deployer as Address,
          mappings: dc.mappings.map(m => ({
            localToken: m.localToken as Address,
            remoteToken: m.remoteToken as Address,
            minGas: m.minGas,
            minBridgeAmount: BigInt(m.minBridgeAmount),
          })),
        })),
        salt: request.suckerDeploymentConfiguration.salt as Hex,
      }
    : {
        deployerConfigurations: [],
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = encodeFunctionData({
    abi: JB_OMNICHAIN_DEPLOYER_ABI,
    functionName: 'launchProjectFor',
    args: [
      request.owner as Address,
      request.projectUri,
      rulesetConfigs as any, // Complex struct - viem handles conversion
      terminalConfigs,
      request.memo,
      suckerConfig,
      JB_CONTROLLER_ADDRESS, // controller
    ],
  })

  return {
    txData: {
      to: JB_OMNICHAIN_DEPLOYER_ADDRESS,
      data,
      value: '0x0',
      chainId,
    },
    estimatedGas: '2000000', // Complex deployment needs more gas
    description: `Launch project for ${request.owner}`,
  }
}

/**
 * Encode REVDeployer.deployFor() calldata
 */
export function encodeDeployRevnetTransaction(
  chainId: number,
  revnetId: number,
  request: JBDeployRevnetRequest,
  terminalConfigurations: JBTerminalConfig[]
): JBTransactionResponse {
  const configuration = {
    description: {
      name: request.description.name,
      ticker: request.description.tagline,
      uri: '', // Project URI - typically IPFS
      salt: request.description.salt as Hex,
    },
    baseCurrency: 1, // ETH
    splitOperator: request.splitOperator as Address,
    stageConfigurations: request.stageConfigurations.map(sc => ({
      startsAtOrAfter: sc.startsAtOrAfter,
      splitPercent: sc.splitPercent,
      initialIssuance: BigInt(sc.initialIssuance),
      issuanceDecayFrequency: sc.issuanceDecayFrequency,
      issuanceDecayPercent: sc.issuanceDecayPercent,
      cashOutTaxRate: sc.cashOutTaxRate,
      extraMetadata: sc.extraMetadata,
    })),
    loanSources: [],
    loans: [],
    allowCrosschainSuckerExtension: true,
  }

  const terminalConfigs = terminalConfigurations.map(tc => ({
    terminal: tc.terminal as Address,
    accountingContextsToAccept: tc.accountingContextsToAccept.map(ctx => ({
      token: ctx.token as Address,
      decimals: ctx.decimals,
      currency: ctx.currency,
    })),
  }))

  const buybackHookConfig = {
    hook: ZERO_ADDRESS,
    pools: [],
  }

  const suckerConfig = request.suckerDeploymentConfiguration
    ? {
        deployerConfigurations: request.suckerDeploymentConfiguration.deployerConfigurations.map(dc => ({
          deployer: dc.deployer as Address,
          mappings: dc.mappings.map(m => ({
            localToken: m.localToken as Address,
            minGas: m.minGas,
            remoteToken: m.remoteToken as Address,
            minBridgeAmount: BigInt(m.minBridgeAmount),
          })),
        })),
        salt: request.suckerDeploymentConfiguration.salt as Hex,
      }
    : {
        deployerConfigurations: [],
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = encodeFunctionData({
    abi: REV_DEPLOYER_ABI,
    functionName: 'deployFor',
    args: [
      BigInt(revnetId),
      configuration as any, // Complex struct - viem handles conversion
      terminalConfigs,
      buybackHookConfig,
      suckerConfig,
      [] as any, // hookConfiguration (empty tuple - ABI expects tuple, not object)
      [], // otherPayHooksSpecifications
      0, // extraHookMetadata
      ZERO_ADDRESS, // dataHook
    ],
  })

  return {
    txData: {
      to: REV_DEPLOYER_ADDRESS,
      data,
      value: '0x0',
      chainId,
    },
    estimatedGas: '3000000', // Revnet deployment is complex
    description: `Deploy revnet ${request.description.name}`,
  }
}

/**
 * Encode JBSuckerRegistry.deploySuckersFor() calldata
 */
export function encodeDeploySuckersTransaction(
  chainId: number,
  projectId: number,
  salt: string,
  configurations: JBSuckerDeployerConfig[]
): JBTransactionResponse {
  const configs = configurations.map(c => ({
    deployer: c.deployer as Address,
    mappings: c.mappings.map(m => ({
      localToken: m.localToken as Address,
      minGas: m.minGas,
      remoteToken: m.remoteToken as Address,
      minBridgeAmount: BigInt(m.minBridgeAmount),
    })),
  }))

  const data = encodeFunctionData({
    abi: JB_SUCKER_REGISTRY_ABI,
    functionName: 'deploySuckersFor',
    args: [
      BigInt(projectId),
      salt as Hex,
      configs,
    ],
  })

  return {
    txData: {
      to: JB_SUCKER_REGISTRY_ADDRESS,
      data,
      value: '0x0',
      chainId,
    },
    estimatedGas: '1500000',
    description: `Deploy suckers for project ${projectId}`,
  }
}
