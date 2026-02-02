/**
 * JBOmnichainDeployer transaction encoding service.
 * Encodes calldata for launchProjectFor, queueRulesetsOf, and 721 variants locally.
 */

import { encodeFunctionData } from 'viem'
import { JB_OMNICHAIN_DEPLOYER_ABI, JB_OMNICHAIN_DEPLOYER_ADDRESS } from '../constants/abis'
import {
  JB_CONTRACTS_5_1,
  JB_SWAP_TERMINAL,
  JB_SWAP_TERMINAL_USDC,
  JB_SWAP_TERMINAL_REGISTRY,
  JB_SWAP_TERMINAL_USDC_REGISTRY,
  CHAIN_SUCKER_DEPLOYER,
  type SupportedChainId,
  ZERO_ADDRESS,
} from '../constants/chains'
import { CHAIN_IDS } from '../config/environment'
import {
  parseSuckerDeployerConfig,
  createSalt,
  shouldConfigureSuckers,
  CCIP_SUCKER_DEPLOYER_ADDRESSES,
  type JBSuckerDeploymentConfig as SuckerConfig,
} from '../utils/suckerConfig'
import type {
  JBRulesetConfig,
  JBTerminalConfig,
  JBSuckerDeploymentConfig,
} from './relayr'

// ============================================================================
// ADDRESS VALIDATION
// ============================================================================

/**
 * Validate that an address is a proper 40-character hex string.
 * Throws an error if invalid, providing the field name for debugging.
 */
function validateAddress(address: string, fieldName: string): `0x${string}` {
  if (!address || typeof address !== 'string') {
    throw new Error(`${fieldName}: Address is required but got ${typeof address}`)
  }
  const normalized = address.toLowerCase()
  if (!normalized.startsWith('0x')) {
    throw new Error(`${fieldName}: Address must start with 0x, got "${address}"`)
  }
  const hexPart = normalized.slice(2)
  if (hexPart.length !== 40) {
    throw new Error(`${fieldName}: Address must be 40 hex characters (got ${hexPart.length}): "${address}"`)
  }
  if (!/^[0-9a-f]+$/.test(hexPart)) {
    throw new Error(`${fieldName}: Address contains invalid characters: "${address}"`)
  }
  return address as `0x${string}`
}

/**
 * Build a set of known valid terminal addresses for a given chain.
 */
function getKnownTerminalAddresses(chainId: number): Set<string> {
  const addresses = new Set<string>()
  const cid = chainId as SupportedChainId

  // Add all known terminal addresses (lowercase for comparison)
  // JBMultiTerminal 5.1 - same address on all chains via CREATE2
  if (JB_CONTRACTS_5_1.JBMultiTerminal5_1) {
    addresses.add(JB_CONTRACTS_5_1.JBMultiTerminal5_1.toLowerCase())
  }

  // JBSwapTerminal variants - chain-specific addresses
  if (JB_SWAP_TERMINAL[cid]) addresses.add(JB_SWAP_TERMINAL[cid].toLowerCase())
  if (JB_SWAP_TERMINAL_USDC[cid]) addresses.add(JB_SWAP_TERMINAL_USDC[cid].toLowerCase())

  // JBSwapTerminal registries - same address on all chains via CREATE2
  // Used for omnichain projects to configure swap terminals
  addresses.add(JB_SWAP_TERMINAL_REGISTRY.toLowerCase())
  addresses.add(JB_SWAP_TERMINAL_USDC_REGISTRY.toLowerCase())

  return addresses
}

/**
 * Validate that a terminal address is a known Juicebox terminal.
 * This prevents hallucinated terminal addresses from being used.
 */
function validateTerminalAddress(address: string, chainId: number, fieldName: string): `0x${string}` {
  const validated = validateAddress(address, fieldName)
  const knownTerminals = getKnownTerminalAddresses(chainId)

  if (!knownTerminals.has(validated.toLowerCase())) {
    const knownList = Array.from(knownTerminals).join(', ')
    throw new Error(
      `${fieldName}: Terminal address "${address}" is not a known Juicebox terminal for chain ${chainId}. ` +
      `Known terminals: ${knownList || 'none configured for this chain'}`
    )
  }

  return validated
}

/**
 * Build a set of known valid sucker deployer addresses.
 * Includes both mainnet deployers (from chains.ts) and testnet CCIP deployers (from suckerConfig.ts).
 */
function getKnownSuckerDeployers(): Set<string> {
  const addresses = new Set<string>()

  // Add mainnet sucker deployers from all chains
  const chainIds = [CHAIN_IDS.ethereum, CHAIN_IDS.optimism, CHAIN_IDS.base, CHAIN_IDS.arbitrum] as SupportedChainId[]
  for (const chainId of chainIds) {
    const deployer = CHAIN_SUCKER_DEPLOYER[chainId]
    if (deployer) {
      addresses.add(deployer.toLowerCase())
    }
  }

  // Add testnet CCIP sucker deployers (from suckerConfig.ts)
  for (const targetChain of Object.values(CCIP_SUCKER_DEPLOYER_ADDRESSES)) {
    for (const deployerAddress of Object.values(targetChain)) {
      addresses.add(deployerAddress.toLowerCase())
    }
  }

  return addresses
}

/**
 * Validate that a sucker deployer address is a known deployer.
 */
function validateSuckerDeployerAddress(address: string, fieldName: string): `0x${string}` {
  const validated = validateAddress(address, fieldName)
  const knownDeployers = getKnownSuckerDeployers()

  if (!knownDeployers.has(validated.toLowerCase())) {
    throw new Error(
      `${fieldName}: Sucker deployer address "${address}" is not a known deployer. ` +
      `This may be a hallucinated address.`
    )
  }

  return validated
}

/**
 * Validate an address that can be user-controlled (beneficiary, owner, etc.)
 * Only validates format, not against known list.
 */
function validateUserAddress(address: string, fieldName: string): `0x${string}` {
  return validateAddress(address, fieldName)
}

/**
 * Validate a token address. Allows native token (0xEEEE...) and validates format.
 * For ERC20 tokens on testnet/mainnet, we could add known token validation.
 */
function validateTokenAddress(address: string, fieldName: string): `0x${string}` {
  return validateAddress(address, fieldName)
}

/**
 * Validate a hook address. Can be zero address (no hook) or any valid address.
 */
function validateHookAddress(address: string, fieldName: string): `0x${string}` {
  // Zero address is valid for "no hook"
  if (address.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
    return ZERO_ADDRESS
  }
  return validateAddress(address, fieldName)
}

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
  chainId: number
  owner: `0x${string}`
  projectUri: string
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
  suckerDeploymentConfiguration: JBSuckerDeploymentConfig
  controller?: `0x${string}`
}): `0x${string}` {
  const {
    chainId,
    owner,
    projectUri,
    rulesetConfigurations,
    terminalConfigurations,
    memo,
    suckerDeploymentConfiguration,
    controller = DEFAULT_CONTROLLER,
  } = params

  // Validate the owner address format
  const validatedOwner = validateUserAddress(owner, 'owner')

  // Use the shared formatting functions with address validation
  const formattedRulesets = formatRulesetConfigurations(rulesetConfigurations, chainId)
  const formattedTerminals = formatTerminalConfigurations(terminalConfigurations, chainId)

  // Transform sucker deployment configuration with validation
  const formattedSuckerConfig = {
    deployerConfigurations: suckerDeploymentConfiguration.deployerConfigurations.map((config, idx) => ({
      deployer: validateSuckerDeployerAddress(config.deployer, `suckerDeploymentConfiguration.deployerConfigurations[${idx}].deployer`),
      mappings: config.mappings.map((mapping, mapIdx) => ({
        localToken: validateTokenAddress(mapping.localToken, `suckerDeploymentConfiguration.deployerConfigurations[${idx}].mappings[${mapIdx}].localToken`),
        minGas: mapping.minGas,
        remoteToken: validateTokenAddress(mapping.remoteToken, `suckerDeploymentConfiguration.deployerConfigurations[${idx}].mappings[${mapIdx}].remoteToken`),
        minBridgeAmount: BigInt(mapping.minBridgeAmount),
      })),
    })),
    salt: suckerDeploymentConfiguration.salt as `0x${string}`,
  }

  // Log the exact args being passed to encodeFunctionData
  // Use contract parameter names for clarity
  console.log('\n=== ENCODE ARGS (JSON) ===')
  console.log(JSON.stringify({
    owner: validatedOwner,
    projectUri,
    rulesetConfigurations: formattedRulesets,
    terminalConfigurations: formattedTerminals,
    memo,
    suckerDeploymentConfiguration: formattedSuckerConfig,
    controller,
  }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2))
  console.log('==========================\n')

  return encodeFunctionData({
    abi: JB_OMNICHAIN_DEPLOYER_ABI,
    functionName: 'launchProjectFor',
    args: [
      validatedOwner,
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
 * Per-chain configuration overrides.
 * Allows different terminal configurations per chain (e.g., different USDC addresses).
 */
export interface ChainConfigOverride {
  chainId: number
  terminalConfigurations?: JBTerminalConfig[]
}

/**
 * Build transactions for launching a project on multiple chains.
 * Each chain gets its own transaction targeting JBOmnichainDeployer.
 *
 * IMPORTANT: For multi-chain deployments, each chain needs DIFFERENT sucker
 * deployer configurations (connecting to the other chains). This function
 * auto-generates per-chain sucker configs when deploying to multiple chains.
 *
 * For ERC20-based projects (e.g., USDC), pass chainConfigs with per-chain
 * terminal configurations to ensure correct token addresses on each chain.
 */
export function buildOmnichainLaunchTransactions(params: {
  chainIds: number[]
  owner: `0x${string}`
  projectUri: string
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]  // Default terminal configs (used if no chain override)
  memo: string
  suckerDeploymentConfiguration?: JBSuckerDeploymentConfig
  controller?: `0x${string}`
  chainConfigs?: ChainConfigOverride[]  // Per-chain overrides for terminal configs
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  const controller = params.controller || DEFAULT_CONTROLLER
  const { chainIds, chainConfigs = [] } = params

  // Generate a shared salt for all chains (ensures deterministic sucker addresses)
  const sharedSalt = (params.suckerDeploymentConfiguration?.salt as `0x${string}` | undefined) || createSalt()

  // Build a map of chainId -> terminal configurations from chainConfigs
  const chainConfigMap = new Map<number, ChainConfigOverride>()
  for (const cfg of chainConfigs) {
    chainConfigMap.set(cfg.chainId, cfg)
  }

  // Extract per-chain token addresses from terminal configurations for sucker config
  // This enables proper ERC20 bridging (e.g., USDC on each chain)
  const tokenAddresses: Record<number, `0x${string}`> = {}
  for (const chainId of chainIds) {
    const chainConfig = chainConfigMap.get(chainId)
    const terminalConfigs = chainConfig?.terminalConfigurations ?? params.terminalConfigurations
    // Look for the first non-native token in terminal configs
    for (const terminal of terminalConfigs) {
      for (const ctx of terminal.accountingContextsToAccept) {
        // Skip native token (0xEEEe...) - we want ERC20 tokens
        if (ctx.token && ctx.token.toLowerCase() !== '0x000000000000000000000000000000000000eeee') {
          tokenAddresses[chainId] = ctx.token as `0x${string}`
          break
        }
      }
      if (tokenAddresses[chainId]) break
    }
  }

  // Log decoded params in readable JSON format
  const debugParams = {
    owner: params.owner,
    projectUri: params.projectUri,
    memo: params.memo,
    chainIds: params.chainIds,
    controller,
    rulesetConfigurations: params.rulesetConfigurations,
    terminalConfigurations: params.terminalConfigurations,
    chainConfigs: params.chainConfigs,
    tokenAddresses,
    sharedSalt,
    autoGeneratingSuckers: shouldConfigureSuckers(chainIds) && !params.suckerDeploymentConfiguration,
  }

  console.log('\n=== OMNICHAIN DEPLOYER PARAMS ===')
  console.log(JSON.stringify(debugParams, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2))
  console.log('=================================\n')

  const transactions = params.chainIds.map(chainId => {
    // Get per-chain terminal configurations (use override if available)
    const chainConfig = chainConfigMap.get(chainId)
    const terminalConfigurations = chainConfig?.terminalConfigurations ?? params.terminalConfigurations

    // Generate per-chain sucker configuration
    // Each chain needs deployers for the OTHER chains in the deployment
    let suckerConfig: JBSuckerDeploymentConfig

    // Check if we have a non-empty provided config
    const hasProvidedConfig = (params.suckerDeploymentConfiguration?.deployerConfigurations?.length ?? 0) > 0

    if (hasProvidedConfig) {
      // Use provided config (for custom configurations)
      suckerConfig = params.suckerDeploymentConfiguration!
    } else if (shouldConfigureSuckers(chainIds)) {
      // Auto-generate sucker config for this chain connecting to other chains
      // Pass token addresses for ERC20-based projects
      const hasTokenAddresses = Object.keys(tokenAddresses).length > 0
      const generatedConfig = parseSuckerDeployerConfig(chainId, chainIds, {
        salt: sharedSalt,
        tokenAddresses: hasTokenAddresses ? tokenAddresses : undefined,
      })
      suckerConfig = {
        deployerConfigurations: generatedConfig.deployerConfigurations.map(dc => ({
          deployer: dc.deployer,
          mappings: dc.mappings.map(m => ({
            // Order must match Solidity JBTokenMapping: localToken, minGas, remoteToken, minBridgeAmount
            localToken: m.localToken,
            minGas: m.minGas,
            remoteToken: m.remoteToken,
            minBridgeAmount: m.minBridgeAmount.toString(),
          })),
        })),
        salt: generatedConfig.salt,
      }
    } else {
      // Single chain deployment - no suckers needed
      suckerConfig = {
        deployerConfigurations: [],
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
      }
    }

    const tx = buildLaunchProjectTransaction({
      ...params,
      terminalConfigurations,  // Use per-chain terminal configs
      suckerDeploymentConfiguration: suckerConfig,
      controller,
      chainId,
    })

    // Log each transaction's calldata with function selector
    const selector = tx.data.slice(0, 10)
    console.log(`Chain ${chainId}: selector=${selector}, to=${tx.to}, terminalConfigs=${JSON.stringify(terminalConfigurations.map(t => t.accountingContextsToAccept.map(c => c.token)))}`)

    return tx
  })

  return transactions
}

// Launch rulesets config for launch721RulesetsFor
export interface JBLaunchRulesetsConfig {
  projectId: number
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
}

/**
 * Helper to format terminal configurations with validation.
 * Validates terminal addresses against known Juicebox terminals to prevent hallucinated addresses.
 */
function formatTerminalConfigurations(terminalConfigurations: JBTerminalConfig[], chainId: number) {
  return terminalConfigurations.map((terminal, idx) => ({
    terminal: validateTerminalAddress(terminal.terminal, chainId, `terminalConfigurations[${idx}].terminal`),
    accountingContextsToAccept: terminal.accountingContextsToAccept.map((ctx, ctxIdx) => ({
      token: validateTokenAddress(ctx.token, `terminalConfigurations[${idx}].accountingContextsToAccept[${ctxIdx}].token`),
      decimals: ctx.decimals,
      currency: ctx.currency,
    })),
  }))
}

/**
 * Helper to format ruleset configurations consistently across functions.
 * Validates all addresses to prevent hallucinated values.
 */
function formatRulesetConfigurations(rulesetConfigurations: JBRulesetConfig[], chainId: number) {
  return rulesetConfigurations.map((ruleset, rulesetIdx) => ({
    mustStartAtOrAfter: ruleset.mustStartAtOrAfter,
    duration: ruleset.duration,
    weight: BigInt(ruleset.weight),
    weightCutPercent: ruleset.weightCutPercent,
    approvalHook: validateHookAddress(ruleset.approvalHook, `rulesetConfigurations[${rulesetIdx}].approvalHook`),
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
      dataHook: validateHookAddress(ruleset.metadata.dataHook, `rulesetConfigurations[${rulesetIdx}].metadata.dataHook`),
      metadata: ruleset.metadata.metadata,
    },
    splitGroups: ruleset.splitGroups.map((group, groupIdx) => ({
      groupId: BigInt(group.groupId),
      splits: group.splits.map((split, splitIdx) => ({
        percent: split.percent,
        projectId: BigInt(split.projectId),
        beneficiary: validateUserAddress(split.beneficiary, `rulesetConfigurations[${rulesetIdx}].splitGroups[${groupIdx}].splits[${splitIdx}].beneficiary`),
        preferAddToBalance: split.preferAddToBalance,
        lockedUntil: split.lockedUntil,
        hook: validateHookAddress(split.hook, `rulesetConfigurations[${rulesetIdx}].splitGroups[${groupIdx}].splits[${splitIdx}].hook`),
      })),
    })),
    fundAccessLimitGroups: ruleset.fundAccessLimitGroups.map((group, groupIdx) => ({
      terminal: validateTerminalAddress(group.terminal, chainId, `rulesetConfigurations[${rulesetIdx}].fundAccessLimitGroups[${groupIdx}].terminal`),
      token: validateTokenAddress(group.token, `rulesetConfigurations[${rulesetIdx}].fundAccessLimitGroups[${groupIdx}].token`),
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
  chainId: number
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  launchRulesetsConfig: JBLaunchRulesetsConfig
  controller?: `0x${string}`
  salt?: `0x${string}`
}): `0x${string}` {
  const {
    chainId,
    projectId,
    deployTiersHookConfig,
    launchRulesetsConfig,
    controller = DEFAULT_CONTROLLER,
    salt = '0x0000000000000000000000000000000000000000000000000000000000000000',
  } = params

  const formattedDeployConfig = formatDeployTiersHookConfig(deployTiersHookConfig)
  const formattedLaunchConfig = {
    projectId: BigInt(launchRulesetsConfig.projectId),
    rulesetConfigurations: formatRulesetConfigurations(launchRulesetsConfig.rulesetConfigurations, chainId),
    terminalConfigurations: formatTerminalConfigurations(launchRulesetsConfig.terminalConfigurations, chainId),
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
 *
 * For ERC20-based projects (e.g., USDC), pass chainConfigs with per-chain
 * terminal configurations to ensure correct token addresses on each chain.
 */
export function buildOmnichainLaunch721RulesetsTransactions(params: {
  chainIds: number[]
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  launchRulesetsConfig: JBLaunchRulesetsConfig
  controller?: `0x${string}`
  salt?: `0x${string}`
  chainConfigs?: ChainConfigOverride[]  // Per-chain overrides for terminal configs
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  const { chainConfigs = [] } = params

  // Build a map of chainId -> terminal configurations from chainConfigs
  const chainConfigMap = new Map<number, ChainConfigOverride>()
  for (const cfg of chainConfigs) {
    chainConfigMap.set(cfg.chainId, cfg)
  }

  return params.chainIds.map(chainId => {
    // Get per-chain terminal configurations (use override if available)
    const chainConfig = chainConfigMap.get(chainId)
    const terminalConfigurations = chainConfig?.terminalConfigurations ?? params.launchRulesetsConfig.terminalConfigurations

    return buildLaunch721RulesetsTransaction({
      ...params,
      chainId,
      launchRulesetsConfig: {
        ...params.launchRulesetsConfig,
        terminalConfigurations,  // Use per-chain terminal configs
      },
    })
  })
}

/**
 * Encode queueRulesetsOf calldata for JBOmnichainDeployer.
 * Queues new rulesets for an existing project (without 721 tiers hook).
 */
export function encodeQueueRulesetsOf(params: {
  chainId: number
  projectId: number | bigint
  rulesetConfigurations: JBRulesetConfig[]
  memo: string
  controller?: `0x${string}`
}): `0x${string}` {
  const {
    chainId,
    projectId,
    rulesetConfigurations,
    memo,
    controller = DEFAULT_CONTROLLER,
  } = params

  const formattedRulesets = formatRulesetConfigurations(rulesetConfigurations, chainId)

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
  chainId: number
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  queueRulesetsConfig: JBQueueRulesetsConfig
  controller?: `0x${string}`
  salt?: `0x${string}`
}): `0x${string}` {
  const {
    chainId,
    projectId,
    deployTiersHookConfig,
    queueRulesetsConfig,
    controller = DEFAULT_CONTROLLER,
    salt = '0x0000000000000000000000000000000000000000000000000000000000000000',
  } = params

  const formattedDeployConfig = formatDeployTiersHookConfig(deployTiersHookConfig)
  const formattedQueueConfig = {
    projectId: BigInt(queueRulesetsConfig.projectId),
    rulesetConfigurations: formatRulesetConfigurations(queueRulesetsConfig.rulesetConfigurations, chainId),
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
