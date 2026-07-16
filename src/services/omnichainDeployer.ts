/**
 * JBOmnichainDeployer transaction encoding service (Juicebox V6).
 * Encodes calldata for new-project launches and recognized management targets locally.
 *
 * Encoding notes:
 * - No `controller` parameter on any deployer function (the deployer is wired to the canonical JBController)
 * - launchProjectFor is payable: msg.value must equal JBProjects.creationFee() exactly
 * - The 721 launch variant takes a JBOmnichain721Config `deploy721Config` argument
 * - Existing-project ruleset writes are intentionally absent: callers must derive the live
 *   controller from JBDirectory and require that controller to be recognized
 * - Sucker mappings: remoteToken is bytes32, config has a `peer` field, minBridgeAmount removed
 */

import { createPublicClient, encodeFunctionData, http, pad } from 'viem'
import { tokenCurrencyId } from '@bananapus/nana-sdk-core/v6'
import {
  JB_OMNICHAIN_DEPLOYER_ABI,
  JB_OMNICHAIN_DEPLOYER_ADDRESS,
  JB_CONTROLLER_ABI,
} from '../constants/abis'
import {
  JB_CONTRACTS,
  JB_ROUTER_TERMINAL_REGISTRY,
  CHAIN_SUCKER_DEPLOYER,
  USDC_ADDRESSES,
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
import {
  requireRecognizedApprovalHook,
  requireRecognizedNewProjectDataHook,
  requireRecognizedSplitHook,
} from '../utils/projectTrust'
import { isIpfsUri } from '../utils/ipfs'
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
  if (!chain) throw new Error(`Unsupported chain for project creation fee: ${chainId}`)

  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0] ||
    MAINNET_RPC_ENDPOINTS[chainId as keyof typeof MAINNET_RPC_ENDPOINTS]?.[0]
  if (!rpcUrl) throw new Error(`No RPC endpoint for project creation fee on chain ${chainId}`)
  const client = createPublicClient({ chain, transport: http(rpcUrl) })

  try {
    return await client.readContract({
      address: JB_CONTRACTS.JBProjects,
      abi: JB_PROJECTS_CREATION_FEE_ABI,
      functionName: 'creationFee',
    })
  } catch (err) {
    console.error(`Failed to read JBProjects.creationFee on chain ${chainId}:`, err)
    throw new Error(`Could not verify the project creation fee on chain ${chainId}`)
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

  // Projects register the router REGISTRY, never the router implementation.
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

function requireRecognizedAccountingToken(
  token: `0x${string}`,
  chainId: number,
  fieldName: string,
): 6 | 18 {
  if (token.toLowerCase() === '0x000000000000000000000000000000000000eeee') return 18
  const usdc = USDC_ADDRESSES[chainId as SupportedChainId]
  if (usdc && token.toLowerCase() === usdc.toLowerCase()) return 6
  throw new Error(`${fieldName}: Accounting token not recognized on chain ${chainId}: ${token}`)
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

/** JBPrices standard currency id for USD — usable in fund-access limits via the core USD feed. */
const USD_CURRENCY_ID = 2

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

/**
 * Format a sucker deployment configuration into the V6 tuple shape, with validation.
 */
function formatSuckerDeploymentConfiguration(
  config: JBSuckerDeploymentConfig,
  prefix: string,
  chainId: number,
) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(config.salt)) {
    throw new Error(`${prefix}.salt: Invalid bytes32 salt`)
  }
  if (config.deployerConfigurations.length === 0) {
    if (config.salt.toLowerCase() !== ZERO_BYTES32.toLowerCase()) {
      throw new Error(`${prefix}.salt: Empty sucker configuration must use the zero salt`)
    }
    return { deployerConfigurations: [], salt: ZERO_BYTES32 }
  }
  if (config.salt.toLowerCase() === ZERO_BYTES32.toLowerCase()) {
    throw new Error(`${prefix}.salt: Sucker deployments require a non-zero salt`)
  }

  const seenDeployers = new Set<string>()
  return {
    deployerConfigurations: config.deployerConfigurations.map((dc, idx) => {
      const field = `${prefix}.deployerConfigurations[${idx}]`
      const deployer = validateSuckerDeployerAddress(dc.deployer, `${field}.deployer`)
      if (seenDeployers.has(deployer.toLowerCase())) {
        throw new Error(`${field}.deployer: Duplicate sucker deployer`)
      }
      seenDeployers.add(deployer.toLowerCase())
      if (dc.peer && dc.peer !== ZERO_ADDRESS && dc.peer.toLowerCase() !== ZERO_BYTES32.toLowerCase()) {
        throw new Error(`${field}.peer: Explicit sucker peers are not supported`)
      }
      if (dc.mappings.length === 0) throw new Error(`${field}.mappings: At least one token mapping is required`)

      const seenLocalTokens = new Set<string>()
      return {
        deployer,
        peer: ZERO_BYTES32,
        mappings: dc.mappings.map((mapping, mapIdx) => {
          const mappingField = `${field}.mappings[${mapIdx}]`
          const localToken = validateTokenAddress(mapping.localToken, `${mappingField}.localToken`)
          requireRecognizedAccountingToken(localToken, chainId, `${mappingField}.localToken`)
          if (seenLocalTokens.has(localToken.toLowerCase())) {
            throw new Error(`${mappingField}.localToken: Duplicate token mapping`)
          }
          seenLocalTokens.add(localToken.toLowerCase())
          if (!Number.isSafeInteger(mapping.minGas) || mapping.minGas <= 0 || mapping.minGas > 5_000_000) {
            throw new Error(`${mappingField}.minGas: Invalid sucker gas limit`)
          }
          const remoteToken = validateRemoteToken(mapping.remoteToken, `${mappingField}.remoteToken`)
          if (remoteToken.slice(2, 26) !== '0'.repeat(24)) {
            throw new Error(`${mappingField}.remoteToken: Expected a left-padded EVM address`)
          }
          const remoteAddress = `0x${remoteToken.slice(-40)}`.toLowerCase()
          const recognizedRemote = remoteAddress === '0x000000000000000000000000000000000000eeee' ||
            Object.values(USDC_ADDRESSES).some(address => address.toLowerCase() === remoteAddress)
          if (!recognizedRemote) {
            throw new Error(`${mappingField}.remoteToken: Remote accounting token not recognized`)
          }
          const localIsNative = localToken.toLowerCase() === '0x000000000000000000000000000000000000eeee'
          const remoteIsNative = remoteAddress === '0x000000000000000000000000000000000000eeee'
          if (localIsNative !== remoteIsNative) {
            throw new Error(`${mappingField}: Token mapping must preserve the accounting-token family`)
          }
          return { localToken, minGas: mapping.minGas, remoteToken }
        }),
      }
    }),
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
  const formattedTerminals = formatTerminalConfigurations(terminalConfigurations, chainId)
  const acceptedTokens = new Set(formattedTerminals.flatMap(terminal =>
    terminal.accountingContextsToAccept.map(context => context.token.toLowerCase())
  ))
  const formattedRulesets = formatRulesetConfigurations(rulesetConfigurations, chainId, acceptedTokens)
  const formattedSuckerConfig = formatSuckerDeploymentConfiguration(
    suckerDeploymentConfiguration,
    'suckerDeploymentConfiguration',
    chainId,
  )

  if (!isIpfsUri(projectUri)) throw new Error('Project metadata URI must be a pinned IPFS CID')

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
  creationFeeWei: string
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
    value: requireCreationFee(params.creationFeeWei, params.chainId),
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
  creationFeesWei: Record<number, string>
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
      creationFeeWei: requireCreationFee(params.creationFeesWei[chainId], chainId),
    })
  })

  return transactions
}

/**
 * Helper to format terminal configurations with validation.
 * Validates terminal addresses against known Juicebox terminals to prevent hallucinated addresses.
 */
function formatTerminalConfigurations(terminalConfigurations: JBTerminalConfig[], chainId: number) {
  const seen = new Set<string>()
  const acceptedTokens = new Set<string>()
  if (terminalConfigurations.length === 0) throw new Error('At least one terminal is required')
  const formatted = terminalConfigurations.map((terminal, idx) => {
    const field = `terminalConfigurations[${idx}]`
    const address = validateTerminalAddress(terminal.terminal, chainId, `${field}.terminal`)
    const normalized = address.toLowerCase()
    if (seen.has(normalized)) throw new Error(`${field}.terminal: Duplicate terminal`)
    seen.add(normalized)

    if (normalized === JB_ROUTER_TERMINAL_REGISTRY.toLowerCase()) {
      if (terminal.accountingContextsToAccept.length !== 0) {
        throw new Error(`${field}: Router terminal registry must not define accounting contexts`)
      }
      return { terminal: address, accountingContextsToAccept: [] }
    }
    if (terminal.accountingContextsToAccept.length === 0) {
      throw new Error(`${field}: JBMultiTerminal requires at least one accounting context`)
    }

    return {
      terminal: address,
      accountingContextsToAccept: terminal.accountingContextsToAccept.map((ctx, ctxIdx) => {
        const contextField = `${field}.accountingContextsToAccept[${ctxIdx}]`
        const token = validateTokenAddress(ctx.token, `${contextField}.token`)
        const expectedDecimals = requireRecognizedAccountingToken(token, chainId, `${contextField}.token`)
        const expectedCurrency = tokenCurrencyId(token)
        if (acceptedTokens.has(token.toLowerCase())) {
          throw new Error(`${contextField}.token: Duplicate accounting token`)
        }
        acceptedTokens.add(token.toLowerCase())
        if (ctx.decimals !== expectedDecimals) {
          throw new Error(`${contextField}.decimals: Expected ${expectedDecimals} for ${token}`)
        }
        if (ctx.currency !== expectedCurrency) {
          throw new Error(`${contextField}.currency: Expected ${expectedCurrency} for ${token}`)
        }
        return { token, decimals: ctx.decimals, currency: ctx.currency }
      }),
    }
  })
  if (acceptedTokens.size === 0) {
    throw new Error('At least one recognized accounting token is required')
  }
  return formatted
}

/**
 * Helper to format ruleset configurations consistently across functions.
 * Validates all addresses to prevent hallucinated values.
 */
function formatRulesetConfigurations(
  rulesetConfigurations: JBRulesetConfig[],
  chainId: number,
  acceptedTokens?: Set<string>,
  options?: {
    /** A 721 hook deploys atomically with the project: the omnichain deployer
     *  rewires metadata.dataHook itself, so hook flags with a zero hook are valid. */
    hasAtomic721?: boolean
  },
) {
  if (rulesetConfigurations.length === 0) throw new Error('At least one ruleset is required')
  return rulesetConfigurations.map((ruleset, rulesetIdx) => {
    const prefix = `rulesetConfigurations[${rulesetIdx}]`
    const requireInteger = (value: number, field: string, min: number, max: number) => {
      if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${field}: Value must be an integer between ${min} and ${max}`)
      }
    }
    requireInteger(ruleset.mustStartAtOrAfter, `${prefix}.mustStartAtOrAfter`, 0, 2 ** 48 - 1)
    requireInteger(ruleset.duration, `${prefix}.duration`, 0, 2 ** 32 - 1)
    requireInteger(ruleset.weightCutPercent, `${prefix}.weightCutPercent`, 0, 1_000_000_000)
    requireInteger(ruleset.metadata.reservedPercent, `${prefix}.metadata.reservedPercent`, 0, 10_000)
    requireInteger(ruleset.metadata.cashOutTaxRate, `${prefix}.metadata.cashOutTaxRate`, 0, 10_000)
    requireInteger(ruleset.metadata.baseCurrency, `${prefix}.metadata.baseCurrency`, 1, 2 ** 32 - 1)
    const weight = BigInt(ruleset.weight)
    if (weight < 0n || weight >= 1n << 112n) throw new Error(`${prefix}.weight: Value exceeds uint112`)

    requireRecognizedApprovalHook(ruleset.approvalHook)
    requireRecognizedNewProjectDataHook(ruleset.metadata.dataHook)
    if (
      !options?.hasAtomic721 &&
      (ruleset.metadata.useDataHookForPay || ruleset.metadata.useDataHookForCashOut) &&
      ruleset.metadata.dataHook.toLowerCase() === ZERO_ADDRESS.toLowerCase()
    ) {
      throw new Error(`${prefix}.metadata.dataHook: Enabled hook is missing`)
    }

    const splitGroupIds = new Set<string>()
    const splitGroups = ruleset.splitGroups.map((group, groupIdx) => {
      const groupField = `${prefix}.splitGroups[${groupIdx}]`
      const groupId = BigInt(group.groupId)
      if (splitGroupIds.has(groupId.toString())) throw new Error(`${groupField}: Duplicate split group`)
      splitGroupIds.add(groupId.toString())
      if (groupId !== 1n) {
        const token = `0x${groupId.toString(16).padStart(40, '0')}`.toLowerCase()
        requireRecognizedAccountingToken(token as `0x${string}`, chainId, `${groupField}.groupId`)
        if (acceptedTokens && !acceptedTokens.has(token)) {
          throw new Error(`${groupField}.groupId: Payout group token is not accepted by the terminal`)
        }
      }
      if (group.splits.length === 0) throw new Error(`${groupField}: Split group is empty`)

      let totalPercent = 0
      const splits = group.splits.map((split, splitIdx) => {
        const splitField = `${groupField}.splits[${splitIdx}]`
        requireInteger(split.percent, `${splitField}.percent`, 1, 1_000_000_000)
        totalPercent += split.percent
        const projectId = BigInt(split.projectId)
        if (projectId < 0n || projectId >= 1n << 64n) {
          throw new Error(`${splitField}.projectId: Value exceeds uint64`)
        }
        requireInteger(split.lockedUntil, `${splitField}.lockedUntil`, 0, 2 ** 48 - 1)
        const beneficiary = validateUserAddress(split.beneficiary, `${splitField}.beneficiary`)
        const hook = validateHookAddress(split.hook, `${splitField}.hook`)
        requireRecognizedSplitHook(hook)
        if (
          projectId === 0n &&
          beneficiary.toLowerCase() === ZERO_ADDRESS.toLowerCase() &&
          hook.toLowerCase() === ZERO_ADDRESS.toLowerCase()
        ) {
          throw new Error(`${splitField}: Split has no explicit recipient`)
        }
        return {
          percent: split.percent,
          projectId,
          beneficiary,
          preferAddToBalance: split.preferAddToBalance,
          lockedUntil: split.lockedUntil,
          hook,
        }
      })
      if (totalPercent > 1_000_000_000) throw new Error(`${groupField}: Splits exceed 100%`)
      return { groupId, splits }
    })

    const fundTokens = new Set<string>()
    const fundAccessLimitGroups = ruleset.fundAccessLimitGroups.map((group, groupIdx) => {
      const groupField = `${prefix}.fundAccessLimitGroups[${groupIdx}]`
      if (group.terminal.toLowerCase() !== JB_CONTRACTS.JBMultiTerminal.toLowerCase()) {
        throw new Error(`Fund access terminal not recognized: ${group.terminal}`)
      }
      const terminal = validateTerminalAddress(group.terminal, chainId, `${groupField}.terminal`)
      const token = validateTokenAddress(group.token, `${groupField}.token`)
      requireRecognizedAccountingToken(token, chainId, `${groupField}.token`)
      if (acceptedTokens && !acceptedTokens.has(token.toLowerCase())) {
        throw new Error(`${groupField}.token: Fund access token is not accepted by the terminal`)
      }
      if (fundTokens.has(token.toLowerCase())) throw new Error(`${groupField}.token: Duplicate fund access token`)
      fundTokens.add(token.toLowerCase())
      if (group.payoutLimits.length === 0 && group.surplusAllowances.length === 0) {
        throw new Error(`${groupField}: Empty fund access group`)
      }
      const expectedCurrency = tokenCurrencyId(token)
      const formatLimits = (
        limits: Array<{ amount: string; currency: number }>,
        kind: 'payoutLimits' | 'surplusAllowances',
      ) => {
        const currencies = new Set<number>()
        return limits.map((limit, limitIdx) => {
          const limitField = `${groupField}.${kind}[${limitIdx}]`
          const amount = BigInt(limit.amount)
          if (amount <= 0n || amount >= 1n << 224n) {
            throw new Error(`${limitField}.amount: Amount must be a positive uint224`)
          }
          // The token's own currency id is identity (no feed); USD (2) converts
          // via JBPrices — the core deployments ship the USD feed the website's
          // create flow relies on for USD-denominated limits.
          if (limit.currency !== expectedCurrency && limit.currency !== USD_CURRENCY_ID) {
            throw new Error(`${limitField}.currency: Only the accounting token's currency or USD (2) is supported`)
          }
          if (currencies.has(limit.currency)) throw new Error(`${limitField}.currency: Duplicate currency`)
          currencies.add(limit.currency)
          return { amount, currency: limit.currency }
        })
      }
      return {
        terminal,
        token,
        payoutLimits: formatLimits(group.payoutLimits, 'payoutLimits'),
        surplusAllowances: formatLimits(group.surplusAllowances, 'surplusAllowances'),
      }
    })

    return {
    mustStartAtOrAfter: ruleset.mustStartAtOrAfter,
    duration: ruleset.duration,
    weight,
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
    splitGroups,
    fundAccessLimitGroups,
    }
  })
}

/**
 * Helper to format a V6 JB721TierConfig (nested flags tuple, encodedIpfsUri casing,
 * splitPercent + splits).
 */
function formatTierConfig(tier: JB721TierConfig) {
  for (const split of tier.splits ?? []) requireRecognizedSplitHook(split.hook || ZERO_ADDRESS)
  return {
    price: BigInt(tier.price),
    initialSupply: tier.initialSupply,
    votingUnits: tier.votingUnits,
    reserveFrequency: tier.reserveFrequency,
    reserveBeneficiary: validateUserAddress(tier.reserveBeneficiary, 'tier.reserveBeneficiary'),
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
      beneficiary: validateUserAddress(s.beneficiary, 'tier.splits[].beneficiary'),
      preferAddToBalance: s.preferAddToBalance,
      lockedUntil: s.lockedUntil,
      hook: validateHookAddress(s.hook || ZERO_ADDRESS, 'tier.splits[].hook'),
    })),
  }
}

/**
 * Helper to format 721 tiers hook configuration (V6 JBDeploy721TiersHookConfig).
 */
function validateTiersHookConfiguration(config: JBDeployTiersHookConfig, chainId: number): void {
  if (!config.name.trim() || !config.symbol.trim()) {
    throw new Error('Tier collection name and symbol are required')
  }
  if (!isIpfsUri(config.contractUri)) {
    throw new Error('Tier collection URI must be a pinned IPFS URI')
  }
  if (config.tiersConfig.tiers.length === 0) {
    throw new Error('An unused tiers hook is not allowed')
  }

  const currency = config.tiersConfig.currency
  const decimals = config.tiersConfig.decimals
  const canonicalUsdc = USDC_ADDRESSES[chainId as SupportedChainId]
  const recognizedPricing = (currency === 1 && decimals === 18) ||
    (currency === 2 && decimals === 6) ||
    (currency === 61166 && decimals === 18) ||
    (!!canonicalUsdc && currency === tokenCurrencyId(canonicalUsdc) && decimals === 6)
  if (!recognizedPricing) throw new Error('Tier pricing context is not recognized')

  let previousCategory = -1
  let defaultReserveBeneficiary = ZERO_ADDRESS.toLowerCase()
  config.tiersConfig.tiers.forEach((tier, index) => {
    const price = BigInt(tier.price)
    if (price < 0n || price > (1n << 104n) - 1n) {
      throw new Error(`Tier ${index + 1} has an invalid price`)
    }
    if (!Number.isInteger(tier.initialSupply) || tier.initialSupply <= 0 || tier.initialSupply > 999_999_999) {
      throw new Error(`Tier ${index + 1} has an invalid supply`)
    }
    if (!Number.isInteger(tier.votingUnits) || tier.votingUnits < 0 || tier.votingUnits > 0xffff_ffff) {
      throw new Error(`Tier ${index + 1} has invalid voting units`)
    }
    if (!Number.isInteger(tier.reserveFrequency) || tier.reserveFrequency < 0 || tier.reserveFrequency > 0xffff) {
      throw new Error(`Tier ${index + 1} has an invalid reserve frequency`)
    }
    if (tier.initialSupply === 1 && tier.reserveFrequency > 0) {
      throw new Error(`Tier ${index + 1} has a deadlocked reserve configuration`)
    }
    const reserveBeneficiary = validateUserAddress(
      tier.reserveBeneficiary,
      `tiers[${index}].reserveBeneficiary`,
    ).toLowerCase()
    if (tier.reserveFrequency === 0 && (
      reserveBeneficiary !== ZERO_ADDRESS.toLowerCase() || tier.useReserveBeneficiaryAsDefault
    )) {
      throw new Error(`Tier ${index + 1} has an irrelevant reserve beneficiary`)
    }
    if (
      tier.reserveFrequency > 0 &&
      reserveBeneficiary === ZERO_ADDRESS.toLowerCase() &&
      defaultReserveBeneficiary === ZERO_ADDRESS.toLowerCase()
    ) {
      throw new Error(`Tier ${index + 1} has no reserve beneficiary`)
    }
    if (tier.reserveFrequency > 0 && tier.useReserveBeneficiaryAsDefault) {
      if (reserveBeneficiary === ZERO_ADDRESS.toLowerCase()) {
        throw new Error(`Tier ${index + 1} cannot set an empty default reserve beneficiary`)
      }
      defaultReserveBeneficiary = reserveBeneficiary
    }
    if (config.flags.noNewTiersWithReserves && tier.reserveFrequency > 0) {
      throw new Error(`Tier ${index + 1} uses reserves disabled by the collection`)
    }
    if (
      config.flags.noNewTiersWithVotes &&
      ((tier.useVotingUnits && tier.votingUnits !== 0) || (!tier.useVotingUnits && price !== 0n))
    ) {
      throw new Error(`Tier ${index + 1} uses voting units disabled by the collection`)
    }
    if (config.flags.noNewTiersWithOwnerMinting && tier.allowOwnerMint) {
      throw new Error(`Tier ${index + 1} enables owner minting disabled by the collection`)
    }
    if (!Number.isInteger(tier.discountPercent) || tier.discountPercent < 0 || tier.discountPercent > 200) {
      throw new Error(`Tier ${index + 1} has an invalid discount`)
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(tier.encodedIPFSUri) || BigInt(tier.encodedIPFSUri) === 0n) {
      throw new Error(`Tier ${index + 1} has no pinned metadata`)
    }
    if (!Number.isInteger(tier.category) || tier.category < previousCategory || tier.category > 0xff_ffff) {
      throw new Error('Tiers must be sorted by a valid category')
    }
    previousCategory = tier.category

    const splitPercent = tier.splitPercent ?? 0
    const splits = tier.splits ?? []
    if (!Number.isInteger(splitPercent) || splitPercent < 0 || splitPercent > 1_000_000_000) {
      throw new Error(`Tier ${index + 1} has an invalid split percentage`)
    }
    if ((splitPercent === 0) !== (splits.length === 0)) {
      throw new Error(`Tier ${index + 1} has an inconsistent split configuration`)
    }
    const totalSplitPercent = splits.reduce((total, split) => {
      if (!Number.isInteger(split.percent) || split.percent <= 0 || split.percent > 1_000_000_000) {
        throw new Error(`Tier ${index + 1} has an invalid recipient percentage`)
      }
      const projectId = BigInt(split.projectId)
      if (projectId < 0n || projectId >= 1n << 64n) {
        throw new Error(`Tier ${index + 1} has an invalid split project`)
      }
      if (!Number.isSafeInteger(split.lockedUntil) || split.lockedUntil < 0 || split.lockedUntil > 2 ** 48 - 1) {
        throw new Error(`Tier ${index + 1} has an invalid split lock time`)
      }
      const beneficiary = validateUserAddress(split.beneficiary, `tiers[${index}].splits[].beneficiary`)
      const hook = validateHookAddress(split.hook || ZERO_ADDRESS, `tiers[${index}].splits[].hook`)
      requireRecognizedSplitHook(hook)
      if (
        projectId === 0n &&
        beneficiary.toLowerCase() === ZERO_ADDRESS.toLowerCase() &&
        hook.toLowerCase() === ZERO_ADDRESS.toLowerCase()
      ) {
        throw new Error(`Tier ${index + 1} has a split without an explicit recipient`)
      }
      return total + split.percent
    }, 0)
    if (totalSplitPercent > 1_000_000_000) {
      throw new Error(`Tier ${index + 1} splits exceed 100%`)
    }
  })
}

function formatDeployTiersHookConfig(config: JBDeployTiersHookConfig, chainId: number) {
  validateTiersHookConfiguration(config, chainId)
  if (config.tokenUriResolver.toLowerCase() !== ZERO_ADDRESS.toLowerCase()) {
    throw new Error(`Token URI resolver not recognized: ${config.tokenUriResolver}`)
  }
  return {
    name: config.name,
    symbol: config.symbol,
    baseUri: config.baseUri,
    tokenUriResolver: ZERO_ADDRESS,
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
function formatDeploy721Config(
  config: JBDeployTiersHookConfig,
  salt: `0x${string}`,
  chainId: number,
) {
  return {
    deployTiersHookConfig: formatDeployTiersHookConfig(config, chainId),
    useDataHookForCashOut: config.useDataHookForCashOut ?? false,
    salt,
  }
}

/**
 * ABI containing ONLY the 721 launchProjectFor overload of JBOmnichainDeployer (V6).
 *
 * The `rulesetConfigurations.metadata` components are copied verbatim from
 * JB_OMNICHAIN_DEPLOYER_ABI.launchProjectFor (the FULL JBRulesetMetadata variant —
 * has scopeCashOutsToLocalBalances / useDataHookForPay / useDataHookForCashOut /
 * dataHook) so the tuple hashing matches exactly what formatRulesetConfigurations
 * produces for the non-721 encoder. Keeping this ABI to a single overload avoids
 * viem overload-resolution ambiguity when encoding.
 */
const JB_OMNICHAIN_DEPLOYER_721_ABI = [
  {
    "type": "function",
    "name": "launchProjectFor",
    "inputs": [
      { "name": "owner", "type": "address", "internalType": "address" },
      { "name": "projectUri", "type": "string", "internalType": "string" },
      {
        "name": "deploy721Config",
        "type": "tuple",
        "internalType": "struct JBOmnichain721Config",
        "components": [
          {
            "name": "deployTiersHookConfig",
            "type": "tuple",
            "internalType": "struct JBDeploy721TiersHookConfig",
            "components": [
              { "name": "name", "type": "string", "internalType": "string" },
              { "name": "symbol", "type": "string", "internalType": "string" },
              { "name": "baseUri", "type": "string", "internalType": "string" },
              { "name": "tokenUriResolver", "type": "address", "internalType": "contract IJB721TokenUriResolver" },
              { "name": "contractUri", "type": "string", "internalType": "string" },
              {
                "name": "tiersConfig",
                "type": "tuple",
                "internalType": "struct JB721InitTiersConfig",
                "components": [
                  {
                    "name": "tiers",
                    "type": "tuple[]",
                    "internalType": "struct JB721TierConfig[]",
                    "components": [
                      { "name": "price", "type": "uint104", "internalType": "uint104" },
                      { "name": "initialSupply", "type": "uint32", "internalType": "uint32" },
                      { "name": "votingUnits", "type": "uint32", "internalType": "uint32" },
                      { "name": "reserveFrequency", "type": "uint16", "internalType": "uint16" },
                      { "name": "reserveBeneficiary", "type": "address", "internalType": "address" },
                      { "name": "encodedIpfsUri", "type": "bytes32", "internalType": "bytes32" },
                      { "name": "category", "type": "uint24", "internalType": "uint24" },
                      { "name": "discountPercent", "type": "uint8", "internalType": "uint8" },
                      {
                        "name": "flags",
                        "type": "tuple",
                        "internalType": "struct JB721TierConfigFlags",
                        "components": [
                          { "name": "allowOwnerMint", "type": "bool", "internalType": "bool" },
                          { "name": "useReserveBeneficiaryAsDefault", "type": "bool", "internalType": "bool" },
                          { "name": "transfersPausable", "type": "bool", "internalType": "bool" },
                          { "name": "useVotingUnits", "type": "bool", "internalType": "bool" },
                          { "name": "cantBeRemoved", "type": "bool", "internalType": "bool" },
                          { "name": "cantIncreaseDiscountPercent", "type": "bool", "internalType": "bool" },
                          { "name": "cantBuyWithCredits", "type": "bool", "internalType": "bool" }
                        ]
                      },
                      { "name": "splitPercent", "type": "uint32", "internalType": "uint32" },
                      {
                        "name": "splits",
                        "type": "tuple[]",
                        "internalType": "struct JBSplit[]",
                        "components": [
                          { "name": "percent", "type": "uint32", "internalType": "uint32" },
                          { "name": "projectId", "type": "uint64", "internalType": "uint64" },
                          { "name": "beneficiary", "type": "address", "internalType": "address payable" },
                          { "name": "preferAddToBalance", "type": "bool", "internalType": "bool" },
                          { "name": "lockedUntil", "type": "uint48", "internalType": "uint48" },
                          { "name": "hook", "type": "address", "internalType": "contract IJBSplitHook" }
                        ]
                      }
                    ]
                  },
                  { "name": "currency", "type": "uint32", "internalType": "uint32" },
                  { "name": "decimals", "type": "uint8", "internalType": "uint8" }
                ]
              },
              {
                "name": "flags",
                "type": "tuple",
                "internalType": "struct JB721TiersHookFlags",
                "components": [
                  { "name": "noNewTiersWithReserves", "type": "bool", "internalType": "bool" },
                  { "name": "noNewTiersWithVotes", "type": "bool", "internalType": "bool" },
                  { "name": "noNewTiersWithOwnerMinting", "type": "bool", "internalType": "bool" },
                  { "name": "preventOverspending", "type": "bool", "internalType": "bool" },
                  { "name": "issueTokensForSplits", "type": "bool", "internalType": "bool" }
                ]
              }
            ]
          },
          { "name": "useDataHookForCashOut", "type": "bool", "internalType": "bool" },
          { "name": "salt", "type": "bytes32", "internalType": "bytes32" }
        ]
      },
      {
        "name": "rulesetConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBRulesetConfig[]",
        "components": [
          { "name": "mustStartAtOrAfter", "type": "uint48", "internalType": "uint48" },
          { "name": "duration", "type": "uint32", "internalType": "uint32" },
          { "name": "weight", "type": "uint112", "internalType": "uint112" },
          { "name": "weightCutPercent", "type": "uint32", "internalType": "uint32" },
          { "name": "approvalHook", "type": "address", "internalType": "contract IJBRulesetApprovalHook" },
          {
            "name": "metadata",
            "type": "tuple",
            "internalType": "struct JBRulesetMetadata",
            "components": [
              { "name": "reservedPercent", "type": "uint16", "internalType": "uint16" },
              { "name": "cashOutTaxRate", "type": "uint16", "internalType": "uint16" },
              { "name": "baseCurrency", "type": "uint32", "internalType": "uint32" },
              { "name": "pausePay", "type": "bool", "internalType": "bool" },
              { "name": "pauseCreditTransfers", "type": "bool", "internalType": "bool" },
              { "name": "allowOwnerMinting", "type": "bool", "internalType": "bool" },
              { "name": "allowSetCustomToken", "type": "bool", "internalType": "bool" },
              { "name": "allowTerminalMigration", "type": "bool", "internalType": "bool" },
              { "name": "allowSetTerminals", "type": "bool", "internalType": "bool" },
              { "name": "allowSetController", "type": "bool", "internalType": "bool" },
              { "name": "allowAddAccountingContext", "type": "bool", "internalType": "bool" },
              { "name": "allowAddPriceFeed", "type": "bool", "internalType": "bool" },
              { "name": "ownerMustSendPayouts", "type": "bool", "internalType": "bool" },
              { "name": "holdFees", "type": "bool", "internalType": "bool" },
              { "name": "scopeCashOutsToLocalBalances", "type": "bool", "internalType": "bool" },
              { "name": "useDataHookForPay", "type": "bool", "internalType": "bool" },
              { "name": "useDataHookForCashOut", "type": "bool", "internalType": "bool" },
              { "name": "dataHook", "type": "address", "internalType": "address" },
              { "name": "metadata", "type": "uint16", "internalType": "uint16" }
            ]
          },
          {
            "name": "splitGroups",
            "type": "tuple[]",
            "internalType": "struct JBSplitGroup[]",
            "components": [
              { "name": "groupId", "type": "uint256", "internalType": "uint256" },
              {
                "name": "splits",
                "type": "tuple[]",
                "internalType": "struct JBSplit[]",
                "components": [
                  { "name": "percent", "type": "uint32", "internalType": "uint32" },
                  { "name": "projectId", "type": "uint64", "internalType": "uint64" },
                  { "name": "beneficiary", "type": "address", "internalType": "address payable" },
                  { "name": "preferAddToBalance", "type": "bool", "internalType": "bool" },
                  { "name": "lockedUntil", "type": "uint48", "internalType": "uint48" },
                  { "name": "hook", "type": "address", "internalType": "contract IJBSplitHook" }
                ]
              }
            ]
          },
          {
            "name": "fundAccessLimitGroups",
            "type": "tuple[]",
            "internalType": "struct JBFundAccessLimitGroup[]",
            "components": [
              { "name": "terminal", "type": "address", "internalType": "address" },
              { "name": "token", "type": "address", "internalType": "address" },
              {
                "name": "payoutLimits",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  { "name": "amount", "type": "uint224", "internalType": "uint224" },
                  { "name": "currency", "type": "uint32", "internalType": "uint32" }
                ]
              },
              {
                "name": "surplusAllowances",
                "type": "tuple[]",
                "internalType": "struct JBCurrencyAmount[]",
                "components": [
                  { "name": "amount", "type": "uint224", "internalType": "uint224" },
                  { "name": "currency", "type": "uint32", "internalType": "uint32" }
                ]
              }
            ]
          }
        ]
      },
      {
        "name": "terminalConfigurations",
        "type": "tuple[]",
        "internalType": "struct JBTerminalConfig[]",
        "components": [
          { "name": "terminal", "type": "address", "internalType": "contract IJBTerminal" },
          {
            "name": "accountingContextsToAccept",
            "type": "tuple[]",
            "internalType": "struct JBAccountingContext[]",
            "components": [
              { "name": "token", "type": "address", "internalType": "address" },
              { "name": "decimals", "type": "uint8", "internalType": "uint8" },
              { "name": "currency", "type": "uint32", "internalType": "uint32" }
            ]
          }
        ]
      },
      { "name": "memo", "type": "string", "internalType": "string" },
      {
        "name": "suckerDeploymentConfiguration",
        "type": "tuple",
        "internalType": "struct JBSuckerDeploymentConfig",
        "components": [
          {
            "name": "deployerConfigurations",
            "type": "tuple[]",
            "internalType": "struct JBSuckerDeployerConfig[]",
            "components": [
              { "name": "deployer", "type": "address", "internalType": "contract IJBSuckerDeployer" },
              { "name": "peer", "type": "bytes32", "internalType": "bytes32" },
              {
                "name": "mappings",
                "type": "tuple[]",
                "internalType": "struct JBTokenMapping[]",
                "components": [
                  { "name": "localToken", "type": "address", "internalType": "address" },
                  { "name": "minGas", "type": "uint32", "internalType": "uint32" },
                  { "name": "remoteToken", "type": "bytes32", "internalType": "bytes32" }
                ]
              }
            ]
          },
          { "name": "salt", "type": "bytes32", "internalType": "bytes32" }
        ]
      }
    ],
    "outputs": [
      { "name": "projectId", "type": "uint256", "internalType": "uint256" },
      { "name": "hook", "type": "address", "internalType": "contract IJB721TiersHook" },
      { "name": "suckers", "type": "address[]", "internalType": "address[]" }
    ],
    "stateMutability": "payable"
  }
] as const

/**
 * Encode the 721 launchProjectFor overload for JBOmnichainDeployer (V6).
 * Creates a NEW project WITH a 721 tiers hook (and optionally suckers) atomically.
 *
 * Mirrors encodeLaunchProjectFor exactly, with the JBOmnichain721Config
 * `deploy721Config` argument inserted after projectUri.
 */
export function encodeLaunch721ProjectFor(params: {
  chainId: number
  owner: `0x${string}`
  projectUri: string
  deployTiersHookConfig: JBDeployTiersHookConfig
  salt: `0x${string}`
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
  suckerDeploymentConfiguration: JBSuckerDeploymentConfig
}): `0x${string}` {
  const {
    chainId,
    owner,
    projectUri,
    deployTiersHookConfig,
    salt,
    rulesetConfigurations,
    terminalConfigurations,
    memo,
    suckerDeploymentConfiguration,
  } = params

  // Validate the owner address format
  const validatedOwner = validateUserAddress(owner, 'owner')

  // Reuse the shared formatting helpers (identical FULL metadata as the non-721 encoder)
  const formattedTerminals = formatTerminalConfigurations(terminalConfigurations, chainId)
  const acceptedTokens = new Set(formattedTerminals.flatMap(terminal =>
    terminal.accountingContextsToAccept.map(context => context.token.toLowerCase())
  ))
  const formattedRulesets = formatRulesetConfigurations(rulesetConfigurations, chainId, acceptedTokens, { hasAtomic721: true })
  const formattedSuckerConfig = formatSuckerDeploymentConfiguration(
    suckerDeploymentConfiguration,
    'suckerDeploymentConfiguration',
    chainId,
  )

  if (!isIpfsUri(projectUri)) throw new Error('Project metadata URI must be a pinned IPFS CID')

  return encodeFunctionData({
    abi: JB_OMNICHAIN_DEPLOYER_721_ABI,
    functionName: 'launchProjectFor',
    args: [
      validatedOwner,
      projectUri,
      formatDeploy721Config(deployTiersHookConfig, salt, chainId),
      formattedRulesets,
      formattedTerminals,
      memo,
      formattedSuckerConfig,
    ],
  })
}

/**
 * Build transaction data for launching a NEW project WITH 721 tiers via
 * JBOmnichainDeployer.
 *
 * V6: launchProjectFor is payable — `creationFeeWei` must equal
 * JBProjects.creationFee() exactly (fetch via fetchProjectCreationFee).
 */
export function buildLaunch721ProjectTransaction(params: {
  chainId: number
  owner: `0x${string}`
  projectUri: string
  deployTiersHookConfig: JBDeployTiersHookConfig
  salt: `0x${string}`
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
  suckerDeploymentConfiguration: JBSuckerDeploymentConfig
  creationFeeWei: string
}): {
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
} {
  const data = encodeLaunch721ProjectFor(params)

  return {
    chainId: params.chainId,
    to: JB_OMNICHAIN_DEPLOYER_ADDRESS,
    data,
    value: requireCreationFee(params.creationFeeWei, params.chainId),
  }
}

/**
 * Build transactions for launching a NEW project WITH 721 tiers on one or more chains.
 *
 * 721 twin of buildOmnichainLaunchTransactions: same per-chain sucker auto-generation,
 * per-chain terminal overrides, creation-fee handling and shared deterministic salt,
 * but threads the deployTiersHookConfig (with per-chain `tiers` override) and calls
 * buildLaunch721ProjectTransaction.
 *
 * Single-chain works through this same JBOmnichainDeployer path (empty sucker config),
 * exactly as buildOmnichainLaunchTransactions does when suckers aren't configured.
 *
 * For LIMITED SUPPLY TIERS: use chainConfigs with per-chain `tiers` to deploy limited
 * tiers only on the primary chain while unlimited tiers deploy on all chains.
 */
export function buildOmnichainLaunch721Transactions(params: {
  chainIds: number[]
  owner: `0x${string}`
  projectUri: string
  deployTiersHookConfig: JBDeployTiersHookConfig
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]  // Default terminal configs (used if no chain override)
  memo: string
  suckerDeploymentConfiguration?: JBSuckerDeploymentConfig
  chainConfigs?: ChainConfigOverride[]  // Per-chain overrides for terminal configs and tiers
  /** V6 creation fee (wei) per chain; must equal JBProjects.creationFee() on each chain. */
  creationFeesWei: Record<number, string>
}): Array<{
  chainId: number
  to: `0x${string}`
  data: `0x${string}`
  value: string
}> {
  const { chainIds, chainConfigs = [] } = params

  // Shared deterministic salt for all chains — used for BOTH the 721 hook deploy
  // (formatDeploy721Config) and the sucker deployment so peer addresses match.
  const sharedSalt = (params.suckerDeploymentConfiguration?.salt as `0x${string}` | undefined) || createSalt()

  // Build a map of chainId -> chain configuration from chainConfigs
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

  return chainIds.map(chainId => {
    // Get per-chain terminal configurations (use override if available)
    const chainConfig = chainConfigMap.get(chainId)
    const terminalConfigurations = chainConfig?.terminalConfigurations ?? params.terminalConfigurations

    // Get per-chain tier configurations (use override if available)
    // This enables limited supply tiers to be deployed only on the primary chain
    const tiers = chainConfig?.tiers ?? params.deployTiersHookConfig.tiersConfig.tiers
    const deployTiersHookConfig: JBDeployTiersHookConfig = {
      ...params.deployTiersHookConfig,
      tiersConfig: {
        ...params.deployTiersHookConfig.tiersConfig,
        tiers,
      },
    }

    // Generate per-chain sucker configuration
    let suckerConfig: JBSuckerDeploymentConfig

    const hasProvidedConfig = (params.suckerDeploymentConfiguration?.deployerConfigurations?.length ?? 0) > 0

    if (hasProvidedConfig) {
      suckerConfig = params.suckerDeploymentConfiguration!
    } else if (shouldConfigureSuckers(chainIds)) {
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

    return buildLaunch721ProjectTransaction({
      chainId,
      owner: params.owner,
      projectUri: params.projectUri,
      deployTiersHookConfig,
      // Same deterministic salt as the sucker sharedSalt
      salt: sharedSalt,
      rulesetConfigurations: params.rulesetConfigurations,
      terminalConfigurations,  // Use per-chain terminal configs
      memo: params.memo,
      suckerDeploymentConfiguration: suckerConfig,
      creationFeeWei: requireCreationFee(params.creationFeesWei[chainId], chainId),
    })
  })
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
 * The controller address must be derived from JBDirectory.controllerOf(projectId)
 * and must match the controller implementation this client recognizes.
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
  if (!/^ipfs:\/\/(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})$/.test(params.uri)) {
    throw new Error('Project metadata URI must be a valid IPFS CID')
  }
  if (params.controller.toLowerCase() !== JB_CONTRACTS.JBController.toLowerCase()) {
    throw new Error(`Controller not recognized: ${params.controller}`)
  }
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
