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

function toRulesetConfigTuple(config: JBRulesetConfig) {
  return {
    mustStartAtOrAfter: BigInt(config.mustStartAtOrAfter),
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
        lockedUntil: BigInt(s.lockedUntil),
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
      value: '0',
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
      value: '0',
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
      value: '0',
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
      value: '0',
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
      value: '0',
      chainId,
    },
    estimatedGas: '400000',
    description: `Send reserved tokens for project ${projectId}`,
  }
}
