/**
 * Client-side Juicebox V6 calldata encoding using viem
 * Replaces non-existent /v1/juicebox/* API endpoints
 */

import { encodeFunctionData, pad, type Address, type Hex } from 'viem'
import {
  JB_CONTROLLER_ABI,
  JB_OMNICHAIN_DEPLOYER_ADDRESS,
  REV_DEPLOYER_ABI,
  REV_DEPLOYER_ADDRESS,
} from '../../constants/abis'
import { requireRecognizedController } from '../../utils/paymentTerminal'
import { assertSafeErc20TokenMetadata, requireNonzeroBytes32 } from '../../utils/erc20Safety'
// Type-only import (erased at compile time) — avoids a runtime cycle with the
// relayr barrel that omnichainDeployer imports.
import type { JBDeployTiersHookConfig, JB721TierConfig } from '../omnichainDeployer'

// ============================================================================
// Types (matching client.ts interfaces)
// ============================================================================

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
  /**
   * Signals omnichain data hooks to aggregate cross-chain surplus for cash-out pricing.
   * If true, omnichain cash-out calculations use only the local chain's balances.
   */
  scopeCashOutsToLocalBalances: boolean
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
  queueTarget: string
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
const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex

/**
 * Convert a token address to the bytes32 form V6 sucker mappings expect.
 * Accepts either a 20-byte address or an already-padded 32-byte value.
 */
function toRemoteTokenBytes32(value: string): Hex {
  if (value.length === 66) return value as Hex
  return pad(value as Address, { size: 32 })
}

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
      scopeCashOutsToLocalBalances: config.metadata.scopeCashOutsToLocalBalances,
      useDataHookForPay: config.metadata.useDataHookForPay,
      useDataHookForCashOut: config.metadata.useDataHookForCashOut,
      dataHook: (config.metadata.dataHook || ZERO_ADDRESS) as Address,
      metadata: config.metadata.metadata,
    },
    splitGroups: config.splitGroups.map(sg => ({
      groupId: BigInt(sg.groupId),
      splits: sg.splits.map(s => ({
        percent: s.percent,
        projectId: BigInt(s.projectId),
        beneficiary: s.beneficiary as Address,
        preferAddToBalance: s.preferAddToBalance,
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
 * Encode queueRulesetsOf() calldata for a recognized, live-derived queue target.
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

  const requestedTarget = request.queueTarget.toLowerCase()
  const queueTarget = requestedTarget === JB_OMNICHAIN_DEPLOYER_ADDRESS.toLowerCase()
    ? JB_OMNICHAIN_DEPLOYER_ADDRESS
    : requireRecognizedController(request.queueTarget as Address)

  return {
    txData: {
      to: queueTarget,
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
  salt: string,
  controllerAddress: string,
): JBTransactionResponse {
  assertSafeErc20TokenMetadata(name, symbol)
  const verifiedSalt = requireNonzeroBytes32(salt, 'Token deployment salt')
  const data = encodeFunctionData({
    abi: JB_CONTROLLER_ABI,
    functionName: 'deployERC20For',
    args: [
      BigInt(projectId),
      name,
      symbol,
      verifiedSalt,
    ],
  })

  return {
    txData: {
      to: requireRecognizedController(controllerAddress as Address),
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
  projectId: number,
  controllerAddress: string,
): JBTransactionResponse {
  const data = encodeFunctionData({
    abi: JB_CONTROLLER_ABI,
    functionName: 'sendReservedTokensToSplitsOf',
    args: [BigInt(projectId)],
  })

  return {
    txData: {
      to: requireRecognizedController(controllerAddress as Address),
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

// V6 JBTokenMapping: remoteToken is bytes32 on-chain (a left-padded address);
// callers may pass a plain address and it will be padded at encode time.
export interface JBSuckerTokenMapping {
  localToken: string
  minGas: number
  remoteToken: string
}

export interface JBSuckerDeployerConfig {
  deployer: string
  /** V6: explicit peer sucker (bytes32). Omit/zero for the default same-address peer. */
  peer?: string
  mappings: JBSuckerTokenMapping[]
}

export interface JBSuckerDeploymentConfig {
  deployerConfigurations: JBSuckerDeployerConfig[]
  salt: string
}

export interface REVStageConfig {
  startsAtOrAfter: number
  splitPercent: number
  initialIssuance: string
  issuanceCutFrequency: number
  issuanceCutPercent: number
  cashOutTaxRate: number
  extraMetadata: number
  /** Explicit split rows (out of 1e9, must sum ≤ splitPercent semantics per REVDeployer);
   *  when absent a single 100% operator split is synthesized from splitPercent. */
  splits?: Array<{
    percent: number
    projectId: number | bigint
    beneficiary: string
    preferAddToBalance: boolean
    lockedUntil: number
    hook: string
  }>
  /** Auto-issuance entries minted when the stage starts; dropped when absent. */
  autoIssuances?: Array<{ chainId: number; count: string; beneficiary: string }>
}

export interface JBDeployRevnetRequest {
  chainIds: number[]
  stageConfigurations: REVStageConfig[]
  splitOperator: string
  description: {
    name: string
    ticker: string
    tagline: string
    uri: string
    salt: string
  }
  suckerDeploymentConfiguration?: JBSuckerDeploymentConfig
  /** Exact JBProjects.creationFee(), verified on this destination chain. */
  creationFeeWei: string
  /**
   * V6: when set, encodes the 6-arg REVDeployer.deployFor overload so the revnet
   * deploys with a 721 tiers hook (NFT shop) atomically. Croptop allowedPosts is
   * left empty.
   */
  deployTiersHookConfig?: JBDeployTiersHookConfig
}

// ============================================================================
// Omnichain Deployer Encoders
// ============================================================================

/**
 * Format a sucker deployment config into the V6 tuple shape.
 */
function toSuckerConfigTuple(config?: JBSuckerDeploymentConfig) {
  if (!config) {
    return { deployerConfigurations: [], salt: ZERO_BYTES32 }
  }
  return {
    deployerConfigurations: config.deployerConfigurations.map(dc => ({
      deployer: dc.deployer as Address,
      peer: (dc.peer && dc.peer !== ZERO_ADDRESS ? toRemoteTokenBytes32(dc.peer) : ZERO_BYTES32),
      mappings: dc.mappings.map(m => ({
        localToken: m.localToken as Address,
        minGas: m.minGas,
        remoteToken: toRemoteTokenBytes32(m.remoteToken),
      })),
    })),
    salt: config.salt as Hex,
  }
}

function requireCreationFee(value: string | undefined, chainId: number): string {
  if (value === undefined) {
    throw new Error(`Project creation fee was not verified on chain ${chainId}`)
  }
  try {
    if (BigInt(value) < 0n) throw new Error('negative')
  } catch {
    throw new Error(`Invalid project creation fee on chain ${chainId}`)
  }
  return value
}

// Mirrors omnichainDeployer.formatTierConfig — the V6 JB721TierConfig tuple
// (nested flags, encodedIpfsUri casing, splitPercent + splits). Duplicated here
// rather than imported to keep the revnet encoder free of a runtime import cycle
// with the relayr barrel. The on-chain ABI is frozen, so drift risk is nil.
function toRevTierTuple(tier: JB721TierConfig) {
  return {
    price: BigInt(tier.price),
    initialSupply: tier.initialSupply,
    votingUnits: tier.votingUnits,
    reserveFrequency: tier.reserveFrequency,
    reserveBeneficiary: tier.reserveBeneficiary as Address,
    encodedIpfsUri: tier.encodedIPFSUri as Hex,
    category: tier.category,
    discountPercent: tier.discountPercent,
    flags: {
      allowOwnerMint: tier.allowOwnerMint,
      useReserveBeneficiaryAsDefault: tier.useReserveBeneficiaryAsDefault,
      transfersPausable: tier.transfersPausable,
      useVotingUnits: tier.useVotingUnits,
      cantBeRemoved: tier.cannotBeRemoved,
      cantIncreaseDiscountPercent: tier.cannotIncreaseDiscountPercent,
      cantBuyWithCredits: tier.cannotBuyWithCredits ?? false,
    },
    splitPercent: tier.splitPercent ?? 0,
    splits: (tier.splits ?? []).map(s => ({
      percent: s.percent,
      projectId: BigInt(s.projectId),
      beneficiary: s.beneficiary as Address,
      preferAddToBalance: s.preferAddToBalance,
      lockedUntil: s.lockedUntil,
      hook: (s.hook || ZERO_ADDRESS) as Address,
    })),
  }
}

// Build the REVDeploy721TiersHookConfig tuple (baseline hook + salt + 4
// preventOperator* flags). REV721TiersHookFlags is the 4-flag subset of the
// JB721 hook flags (no issueTokensForSplits). preventOperator* default false —
// the wizard's split operator keeps full post-deploy control of the tiers.
function toRevTiered721Config(config: JBDeployTiersHookConfig, salt: Hex) {
  return {
    baseline721HookConfiguration: {
      name: config.name,
      symbol: config.symbol,
      baseUri: config.baseUri,
      tokenUriResolver: config.tokenUriResolver as Address,
      contractUri: config.contractUri,
      tiersConfig: {
        tiers: config.tiersConfig.tiers.map(toRevTierTuple),
        currency: config.tiersConfig.currency,
        decimals: config.tiersConfig.decimals,
      },
      flags: {
        noNewTiersWithReserves: config.flags.noNewTiersWithReserves,
        noNewTiersWithVotes: config.flags.noNewTiersWithVotes,
        noNewTiersWithOwnerMinting: config.flags.noNewTiersWithOwnerMinting,
        preventOverspending: config.flags.preventOverspending,
      },
    },
    salt,
    preventOperatorAdjustingTiers: false,
    preventOperatorUpdatingMetadata: false,
    preventOperatorMinting: false,
    preventOperatorIncreasingDiscountPercent: false,
  }
}

/**
 * Encode REVDeployer.deployFor() calldata (Juicebox V6).
 *
 * Encoding notes:
 * - `terminalConfigurations` replaced by a flat `accountingContextsToAccept` array
 *   (REVDeployer wires the canonical multi terminal + router terminal registry itself)
 * - buyback hook / pay hook / dataHook params removed from the base overload
 * - stage config renames: issuanceDecayFrequency -> issuanceCutFrequency,
 *   issuanceDecayPercent -> issuanceCutPercent; adds autoIssuances + splits
 * - `operator` (was splitOperator) and `scopeCashOutsToLocalBalances` on REVConfig
 * - payable (project creation fee)
 */
export function encodeDeployRevnetTransaction(
  chainId: number,
  revnetId: number,
  request: JBDeployRevnetRequest,
  accountingContexts: Array<{ token: string; decimals: number; currency: number }>,
  baseCurrency: 1 | 2,
): JBTransactionResponse {
  const descriptionSalt = requireNonzeroBytes32(request.description.salt, 'Revnet salt')
  const configuration = {
    description: {
      name: request.description.name,
      ticker: request.description.ticker,
      uri: request.description.uri,
      salt: descriptionSalt,
    },
    baseCurrency,
    operator: request.splitOperator as Address,
    scopeCashOutsToLocalBalances: false,
    stageConfigurations: request.stageConfigurations.map(sc => ({
      startsAtOrAfter: sc.startsAtOrAfter,
      autoIssuances: (sc.autoIssuances ?? []).map(ai => ({
        chainId: ai.chainId,
        count: BigInt(ai.count),
        beneficiary: ai.beneficiary as Address,
      })),
      splitPercent: sc.splitPercent,
      splits: sc.splits
        ? sc.splits.map(s => ({
            percent: s.percent,
            projectId: BigInt(s.projectId),
            beneficiary: s.beneficiary as Address,
            preferAddToBalance: s.preferAddToBalance,
            lockedUntil: s.lockedUntil,
            hook: s.hook as Address,
          }))
        : sc.splitPercent > 0
          ? [{
              percent: 1_000_000_000,
              projectId: 0n,
              beneficiary: request.splitOperator as Address,
              preferAddToBalance: false,
              lockedUntil: 0,
              hook: ZERO_ADDRESS,
            }]
          : [],
      initialIssuance: BigInt(sc.initialIssuance),
      issuanceCutFrequency: sc.issuanceCutFrequency,
      issuanceCutPercent: sc.issuanceCutPercent,
      cashOutTaxRate: sc.cashOutTaxRate,
      extraMetadata: sc.extraMetadata,
    })),
  }

  const contexts = accountingContexts.map(ctx => ({
    token: ctx.token as Address,
    decimals: ctx.decimals,
    currency: ctx.currency,
  }))

  const suckerConfig = toSuckerConfigTuple(request.suckerDeploymentConfiguration)

  // Base overload args (revnetId, configuration, accountingContexts, suckerConfig).
  // When the shop has tiers, append the 721 hook config + empty Croptop posts to
  // hit the 6-arg deployFor overload — viem selects the overload by arity.
  const args = request.deployTiersHookConfig
    ? [
        BigInt(revnetId),
        configuration,
        contexts,
        suckerConfig,
        toRevTiered721Config(request.deployTiersHookConfig, request.description.salt as Hex),
        [], // allowedPosts (Croptop) — none from the wizard
      ]
    : [BigInt(revnetId), configuration, contexts, suckerConfig]

  const data = encodeFunctionData({
    abi: REV_DEPLOYER_ABI,
    functionName: 'deployFor',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any, // Complex struct + overload arity - viem handles conversion
  })

  return {
    txData: {
      to: REV_DEPLOYER_ADDRESS,
      data,
      value: requireCreationFee(request.creationFeeWei, chainId),
      chainId,
    },
    // 721 hook deployment adds a second contract creation to the revnet deploy.
    estimatedGas: request.deployTiersHookConfig ? '4500000' : '3000000',
    description: `Deploy revnet ${request.description.name}`,
  }
}
