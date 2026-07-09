/**
 * JBOmnichainDeployer transaction encoding service (Juicebox V6).
 * Encodes calldata for launchProjectFor, queueRulesetsOf, launchRulesetsFor and 721 variants locally.
 *
 * Encoding notes:
 * - No `controller` parameter on any deployer function (the deployer is wired to the canonical JBController)
 * - launchProjectFor is payable: msg.value must equal JBProjects.creationFee() exactly
 * - 721 variants are overloads of launchProjectFor / launchRulesetsFor / queueRulesetsOf that take a
 *   JBOmnichain721Config `deploy721Config` argument
 * - Sucker mappings: remoteToken is bytes32, config has a `peer` field, minBridgeAmount removed
 */

import { createPublicClient, encodeFunctionData, http, pad } from 'viem'
import {
  JB_OMNICHAIN_DEPLOYER_ABI,
  JB_OMNICHAIN_DEPLOYER_ADDRESS,
  JB_CONTROLLER_ABI,
} from '../constants/abis'
import {
  JB_CONTRACTS,
  JB_ROUTER_TERMINAL,
  JB_ROUTER_TERMINAL_REGISTRY,
  CHAIN_SUCKER_DEPLOYER,
  VIEM_CHAINS,
  MAINNET_VIEM_CHAINS,
  RPC_ENDPOINTS,
  MAINNET_RPC_ENDPOINTS,
  type SupportedChainId,
  ZERO_ADDRESS,
} from '../constants/chains'
import { CHAIN_IDS } from '../config/environment'
import {
  parseSuckerDeployerConfig,
  createSalt,
  shouldConfigureSuckers,
  CCIP_SUCKER_DEPLOYER_ADDRESSES,
  ZERO_BYTES32,
} from '../utils/suckerConfig'
import type {
  JBRulesetConfig,
  JBTerminalConfig,
  JBSuckerDeploymentConfig,
} from './relayr'

// ============================================================================
// PROJECT CREATION FEE (V6)
// ============================================================================

// Minimal ABI for JBProjects.creationFee()
const JB_PROJECTS_CREATION_FEE_ABI = [
  {
    name: 'creationFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

/**
 * Fetch the exact project creation fee from JBProjects on the given chain.
 * V6 launchProjectFor / deployFor calls revert unless msg.value equals this EXACTLY.
 */
export async function fetchProjectCreationFee(chainId: number): Promise<bigint> {
  const chain = VIEM_CHAINS[chainId as SupportedChainId] ||
    MAINNET_VIEM_CHAINS[chainId as keyof typeof MAINNET_VIEM_CHAINS]
  if (!chain) return 0n

  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0] ||
    MAINNET_RPC_ENDPOINTS[chainId as keyof typeof MAINNET_RPC_ENDPOINTS]?.[0]
  const client = createPublicClient({ chain, transport: http(rpcUrl) })

  try {
    return await client.readContract({
      address: JB_CONTRACTS.JBProjects,
      abi: JB_PROJECTS_CREATION_FEE_ABI,
      functionName: 'creationFee',
    })
  } catch (err) {
    console.error(`Failed to read JBProjects.creationFee on chain ${chainId}:`, err)
    return 0n
  }
}

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
 * Build a set of known valid terminal addresses.
 * V6: all terminals have the same address on every chain.
 */
function getKnownTerminalAddresses(_chainId: number): Set<string> {
  const addresses = new Set<string>()

  // JBMultiTerminal - same address on all chains
  addresses.add(JB_CONTRACTS.JBMultiTerminal.toLowerCase())

  // JBRouterTerminal + registry (V6 replacement for the swap terminals)
  // Projects register the REGISTRY (with empty accounting contexts).
  addresses.add(JB_ROUTER_TERMINAL.toLowerCase())
  addresses.add(JB_ROUTER_TERMINAL_REGISTRY.toLowerCase())

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
 * Build a set of known valid sucker deployer addresses
 * (native-bridge deployers + CCIP pair deployers).
 */
function getKnownSuckerDeployers(): Set<string> {
  const addresses = new Set<string>()

  const chainIds = [CHAIN_IDS.ethereum, CHAIN_IDS.optimism, CHAIN_IDS.base, CHAIN_IDS.arbitrum] as SupportedChainId[]
  for (const chainId of chainIds) {
    const deployer = CHAIN_SUCKER_DEPLOYER[chainId]
    if (deployer) {
      addresses.add(deployer.toLowerCase())
    }
  }

  // CCIP pair sucker deployers (same addresses on mainnet and testnet families)
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
 */
function validateTokenAddress(address: string, fieldName: string): `0x${string}` {
  return validateAddress(address, fieldName)
}

/**
 * Validate + normalize a V6 remote token value (bytes32).
 * Accepts a 20-byte address (padded to bytes32) or an already 32-byte value.
 */
function validateRemoteToken(value: string, fieldName: string): `0x${string}` {
  if (typeof value === 'string' && value.startsWith('0x') && value.length === 66) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
      throw new Error(`${fieldName}: Invalid bytes32 value: "${value}"`)
    }
    return value as `0x${string}`
  }
  return pad(validateAddress(value, fieldName), { size: 32 })
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

// 721 Tier configuration for NFT hooks (V6 shape)
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
  /** V6: if true, the tier cannot be bought with pay credits. */
  cannotBuyWithCredits?: boolean
  /** V6: percent of tier price routed to the tier's splits (out of 1e9). */
  splitPercent?: number
  /** V6: splits receiving the tier's splitPercent. */
  splits?: Array<{
    percent: number
    projectId: number
    beneficiary: string
    preferAddToBalance: boolean
    lockedUntil: number
    hook: string
  }>
}

export interface JB721TiersConfig {
  tiers: JB721TierConfig[]
  currency: number
  decimals: number
}

export interface JB721HookFlags {
  noNewTiersWithReserves: boolean
  noNewTiersWithVotes: boolean
  noNewTiersWithOwnerMinting: boolean
  preventOverspending: boolean
  /** V6: if true, paying a tier's splits also issues project tokens. */
  issueTokensForSplits?: boolean
}

export interface JBDeployTiersHookConfig {
  name: string
  symbol: string
  baseUri: string
  tokenUriResolver: string
  contractUri: string
  tiersConfig: JB721TiersConfig
  flags: JB721HookFlags
  /** V6: whether the 721 hook should also be used as the cash out data hook. */
  useDataHookForCashOut?: boolean
}

export interface JBQueueRulesetsConfig {
  projectId: number
  rulesetConfigurations: JBRulesetConfig[]
  memo: string
}

/**
 * Format a sucker deployment configuration into the V6 tuple shape, with validation.
 */
function formatSuckerDeploymentConfiguration(config: JBSuckerDeploymentConfig, prefix: string) {
  return {
    deployerConfigurations: config.deployerConfigurations.map((dc, idx) => ({
      deployer: validateSuckerDeployerAddress(dc.deployer, `${prefix}.deployerConfigurations[${idx}].deployer`),
      // Zero peer = default same-address deterministic peer sucker
      peer: (dc.peer && dc.peer !== ZERO_ADDRESS ? validateRemoteToken(dc.peer, `${prefix}.deployerConfigurations[${idx}].peer`) : ZERO_BYTES32),
      mappings: dc.mappings.map((mapping, mapIdx) => ({
        localToken: validateTokenAddress(mapping.localToken, `${prefix}.deployerConfigurations[${idx}].mappings[${mapIdx}].localToken`),
        minGas: mapping.minGas,
        remoteToken: validateRemoteToken(mapping.remoteToken, `${prefix}.deployerConfigurations[${idx}].mappings[${mapIdx}].remoteToken`),
      })),
    })),
    salt: config.salt as `0x${string}`,
  }
}

/**
 * Encode launchProjectFor calldata for JBOmnichainDeployer (V6).
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
}): `0x${string}` {
  const {
    chainId,
    owner,
    projectUri,
    rulesetConfigurations,
    terminalConfigurations,
    memo,
    suckerDeploymentConfiguration,
  } = params

  // Validate the owner address format
  const validatedOwner = validateUserAddress(owner, 'owner')

  // Use the shared formatting functions with address validation
  const formattedRulesets = formatRulesetConfigurations(rulesetConfigurations, chainId)
  const formattedTerminals = formatTerminalConfigurations(terminalConfigurations, chainId)
  const formattedSuckerConfig = formatSuckerDeploymentConfiguration(suckerDeploymentConfiguration, 'suckerDeploymentConfiguration')

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
    ],
  })
}

/**
 * Build transaction data for launching a project via JBOmnichainDeployer.
 *
 * V6: launchProjectFor is payable — `creationFeeWei` must equal
 * JBProjects.creationFee() exactly (fetch via fetchProjectCreationFee).
 */
export function buildLaunchProjectTransaction(params: {
  chainId: number
  owner: `0x${string}`
  projectUri: string
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
  suckerDeploymentConfiguration: JBSuckerDeploymentConfig
  creationFeeWei?: string
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
    value: params.creationFeeWei || '0x0',
  }
}

/**
 * Per-chain configuration overrides.
 * Allows different terminal configurations per chain (e.g., different USDC addresses).
 * Also supports per-chain tier filtering for limited supply single-chain deployment.
 */
export interface ChainConfigOverride {
  chainId: number
  terminalConfigurations?: JBTerminalConfig[]
  /**
   * Override tiers for this chain. Use this to deploy limited supply tiers
   * only on the primary chain while deploying unlimited tiers on all chains.
   * If not provided, uses the default tiersConfig from deployTiersHookConfig.
   */
  tiers?: JB721TierConfig[]
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
  chainConfigs?: ChainConfigOverride[]  // Per-chain overrides for terminal configs
  /** V6 creation fee (wei) per chain; must equal JBProjects.creationFee() on each chain. */
  creationFeesWei?: Record<number, string>
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
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
          peer: dc.peer,
          mappings: dc.mappings.map(m => ({
            // V6 JBTokenMapping: localToken, minGas, remoteToken (bytes32)
            localToken: m.localToken,
            minGas: m.minGas,
            remoteToken: m.remoteToken,
          })),
        })),
        salt: generatedConfig.salt,
      }
    } else {
      // Single chain deployment - no suckers needed
      suckerConfig = {
        deployerConfigurations: [],
        salt: ZERO_BYTES32,
      }
    }

    return buildLaunchProjectTransaction({
      ...params,
      terminalConfigurations,  // Use per-chain terminal configs
      suckerDeploymentConfiguration: suckerConfig,
      chainId,
      creationFeeWei: params.creationFeesWei?.[chainId],
    })
  })

  return transactions
}

// Launch rulesets config for launchRulesetsFor (721 variant)
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
      scopeCashOutsToLocalBalances: ruleset.metadata.scopeCashOutsToLocalBalances,
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
 * Helper to format a V6 JB721TierConfig (nested flags tuple, encodedIpfsUri casing,
 * splitPercent + splits).
 */
function formatTierConfig(tier: JB721TierConfig) {
  return {
    price: BigInt(tier.price),
    initialSupply: tier.initialSupply,
    votingUnits: tier.votingUnits,
    reserveFrequency: tier.reserveFrequency,
    reserveBeneficiary: tier.reserveBeneficiary as `0x${string}`,
    encodedIpfsUri: tier.encodedIPFSUri as `0x${string}`,
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
      beneficiary: s.beneficiary as `0x${string}`,
      preferAddToBalance: s.preferAddToBalance,
      lockedUntil: s.lockedUntil,
      hook: (s.hook || ZERO_ADDRESS) as `0x${string}`,
    })),
  }
}

/**
 * Helper to format 721 tiers hook configuration (V6 JBDeploy721TiersHookConfig).
 */
function formatDeployTiersHookConfig(config: JBDeployTiersHookConfig) {
  return {
    name: config.name,
    symbol: config.symbol,
    baseUri: config.baseUri,
    tokenUriResolver: config.tokenUriResolver as `0x${string}`,
    contractUri: config.contractUri,
    tiersConfig: {
      tiers: config.tiersConfig.tiers.map(formatTierConfig),
      currency: config.tiersConfig.currency,
      decimals: config.tiersConfig.decimals,
    },
    flags: {
      noNewTiersWithReserves: config.flags.noNewTiersWithReserves,
      noNewTiersWithVotes: config.flags.noNewTiersWithVotes,
      noNewTiersWithOwnerMinting: config.flags.noNewTiersWithOwnerMinting,
      preventOverspending: config.flags.preventOverspending,
      issueTokensForSplits: config.flags.issueTokensForSplits ?? false,
    },
  }
}

/**
 * Helper to format the V6 JBOmnichain721Config wrapper struct.
 */
function formatDeploy721Config(config: JBDeployTiersHookConfig, salt: `0x${string}`) {
  return {
    deployTiersHookConfig: formatDeployTiersHookConfig(config),
    useDataHookForCashOut: config.useDataHookForCashOut ?? false,
    salt,
  }
}

/**
 * Encode the 721 launchRulesetsFor overload for JBOmnichainDeployer (V6).
 * Launches rulesets with a 721 tiers hook for an existing project.
 */
export function encodeLaunch721RulesetsFor(params: {
  chainId: number
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  launchRulesetsConfig: JBLaunchRulesetsConfig
  projectUri?: string
  salt?: `0x${string}`
}): `0x${string}` {
  const {
    chainId,
    projectId,
    deployTiersHookConfig,
    launchRulesetsConfig,
    projectUri = '',
    salt = ZERO_BYTES32,
  } = params

  return encodeFunctionData({
    abi: JB_OMNICHAIN_DEPLOYER_ABI,
    functionName: 'launchRulesetsFor',
    args: [
      BigInt(projectId),
      projectUri,
      formatDeploy721Config(deployTiersHookConfig, salt),
      formatRulesetConfigurations(launchRulesetsConfig.rulesetConfigurations, chainId),
      formatTerminalConfigurations(launchRulesetsConfig.terminalConfigurations, chainId),
      launchRulesetsConfig.memo,
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
  projectUri?: string
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
 *
 * For LIMITED SUPPLY TIERS: Use chainConfigs with per-chain `tiers` to deploy
 * limited tiers only on the primary chain while deploying unlimited tiers on all chains.
 * This ensures "50 available" means exactly 50 total, not 50 per chain.
 */
export function buildOmnichainLaunch721RulesetsTransactions(params: {
  chainIds: number[]
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  launchRulesetsConfig: JBLaunchRulesetsConfig
  projectUri?: string
  salt?: `0x${string}`
  chainConfigs?: ChainConfigOverride[]  // Per-chain overrides for terminal configs and tiers
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  const { chainConfigs = [] } = params

  // Build a map of chainId -> chain configuration from chainConfigs
  const chainConfigMap = new Map<number, ChainConfigOverride>()
  for (const cfg of chainConfigs) {
    chainConfigMap.set(cfg.chainId, cfg)
  }

  return params.chainIds.map(chainId => {
    // Get per-chain terminal configurations (use override if available)
    const chainConfig = chainConfigMap.get(chainId)
    const terminalConfigurations = chainConfig?.terminalConfigurations ?? params.launchRulesetsConfig.terminalConfigurations

    // Get per-chain tier configurations (use override if available)
    // This enables limited supply tiers to be deployed only on primary chain
    const tiers = chainConfig?.tiers ?? params.deployTiersHookConfig.tiersConfig.tiers
    const deployTiersHookConfig: JBDeployTiersHookConfig = {
      ...params.deployTiersHookConfig,
      tiersConfig: {
        ...params.deployTiersHookConfig.tiersConfig,
        tiers,
      },
    }

    return buildLaunch721RulesetsTransaction({
      ...params,
      chainId,
      deployTiersHookConfig,
      launchRulesetsConfig: {
        ...params.launchRulesetsConfig,
        terminalConfigurations,  // Use per-chain terminal configs
      },
    })
  })
}

/**
 * Encode queueRulesetsOf calldata for JBOmnichainDeployer (V6).
 * Queues new rulesets for an existing project (without 721 tiers hook).
 */
export function encodeQueueRulesetsOf(params: {
  chainId: number
  projectId: number | bigint
  rulesetConfigurations: JBRulesetConfig[]
  memo: string
}): `0x${string}` {
  const {
    chainId,
    projectId,
    rulesetConfigurations,
    memo,
  } = params

  const formattedRulesets = formatRulesetConfigurations(rulesetConfigurations, chainId)

  return encodeFunctionData({
    abi: JB_OMNICHAIN_DEPLOYER_ABI,
    functionName: 'queueRulesetsOf',
    args: [
      BigInt(projectId),
      formattedRulesets,
      memo,
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
 * Encode the 721 queueRulesetsOf overload for JBOmnichainDeployer (V6).
 * Queues new rulesets with a 721 tiers hook for an existing project.
 */
export function encodeQueue721RulesetsOf(params: {
  chainId: number
  projectId: number | bigint
  deployTiersHookConfig: JBDeployTiersHookConfig
  queueRulesetsConfig: JBQueueRulesetsConfig
  salt?: `0x${string}`
}): `0x${string}` {
  const {
    chainId,
    projectId,
    deployTiersHookConfig,
    queueRulesetsConfig,
    salt = ZERO_BYTES32,
  } = params

  return encodeFunctionData({
    abi: JB_OMNICHAIN_DEPLOYER_ABI,
    functionName: 'queueRulesetsOf',
    args: [
      BigInt(projectId),
      formatDeploy721Config(deployTiersHookConfig, salt),
      formatRulesetConfigurations(queueRulesetsConfig.rulesetConfigurations, chainId),
      queueRulesetsConfig.memo,
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

// ============================================================================
// SET URI FUNCTIONS
// ============================================================================

/**
 * Encode setUriOf calldata for JBController.
 * Updates the project metadata URI on a single chain.
 */
export function encodeSetUriOf(params: {
  projectId: number | bigint
  uri: string
}): `0x${string}` {
  const { projectId, uri } = params

  return encodeFunctionData({
    abi: JB_CONTROLLER_ABI,
    functionName: 'setUriOf',
    args: [BigInt(projectId), uri],
  })
}

/**
 * Build transaction data for setting project URI via JBController.
 *
 * The controller address should be derived from JBDirectory.controllerOf(projectId)
 * (projects can set a custom controller, though most use the canonical JBController).
 */
export function buildSetUriTransaction(params: {
  chainId: number
  projectId: number | bigint
  uri: string
  controller: `0x${string}` // Fetched from JBDirectory.controllerOf
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeSetUriOf(params)

  return {
    chainId: params.chainId,
    to: params.controller,
    data,
    value: '0x0',
  }
}

/**
 * Per-chain project ID mapping for omnichain projects.
 * Each chain may have a different project ID for the same logical project.
 */
export interface ChainProjectMapping {
  chainId: number
  projectId: number | bigint
  controller: `0x${string}` // Fetched from JBDirectory.controllerOf per chain
}

/**
 * Build transactions for setting project URI on multiple chains.
 * For omnichain projects, each chain may have a different projectId.
 */
export function buildOmnichainSetUriTransactions(params: {
  chainProjectMappings: ChainProjectMapping[]
  uri: string
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  const { chainProjectMappings, uri } = params

  return chainProjectMappings.map(({ chainId, projectId, controller }) =>
    buildSetUriTransaction({
      chainId,
      projectId,
      uri,
      controller,
    })
  )
}
