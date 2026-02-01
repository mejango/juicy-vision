/**
 * Sucker deployment configuration for multi-chain JB projects.
 * Suckers enable cross-chain token bridging between the same project on different chains.
 *
 * Addresses from: https://docs.juicebox.money/dev/v5/addresses/
 */

import { toHex, toBytes, parseEther } from 'viem'

// Native token address used by Juicebox
export const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

// Default minimum bridge amount (0.01 ETH)
export const DEFAULT_MIN_BRIDGE_AMOUNT = parseEther('0.01')

// Chain IDs
const CHAIN_IDS = {
  mainnet: 1,
  optimism: 10,
  base: 8453,
  arbitrum: 42161,
  sepolia: 11155111,
  optimismSepolia: 11155420,
  baseSepolia: 84532,
  arbitrumSepolia: 421614,
} as const

/**
 * CCIP Sucker Deployer addresses - organized by chain PAIR.
 * Each deployer handles bridging between a specific pair of chains.
 * The same deployer address is used on both chains in the pair.
 *
 * From juice-docs: https://docs.juicebox.money/dev/v5/addresses/
 */

// Sepolia Testnet Deployers (same address on both sides of each pair)
const SEPOLIA_DEPLOYERS = {
  // Ethereum Sepolia <-> Optimism Sepolia
  ETH_OP: '0x172ad9b3df724ee0422ea85b7799a3f7ca761816' as `0x${string}`,
  // Ethereum Sepolia <-> Arbitrum Sepolia
  ETH_ARB: '0xf816d238aef247f86cc73593961cb8fb55ca4bcf' as `0x${string}`,
  // Ethereum Sepolia <-> Base Sepolia
  ETH_BASE: '0x195b4dce646eba3c3e9ae56708558b1a96f88814' as `0x${string}`,
  // Optimism Sepolia <-> Arbitrum Sepolia
  OP_ARB: '0xaa0dbdf6354dd238d289c359c74f998ddec8bcd1' as `0x${string}`,
  // Optimism Sepolia <-> Base Sepolia
  OP_BASE: '0x58683931b146697d094c660aec1f4a8f564a3d7d' as `0x${string}`,
  // Arbitrum Sepolia <-> Base Sepolia
  ARB_BASE: '0xc295a8926f1ed0a6e3b6cbdb1d28b9d6b388c8a7' as `0x${string}`,
}

// TODO: Add mainnet deployer addresses when available
// const MAINNET_DEPLOYERS = {
//   ETH_OP: '0x...',
//   ETH_ARB: '0x...',
//   ETH_BASE: '0x...',
//   OP_ARB: '0x...',
//   OP_BASE: '0x...',
//   ARB_BASE: '0x...',
// }

/**
 * CCIP Sucker Deployer addresses mapping.
 * Structure: CCIP_SUCKER_DEPLOYER_ADDRESSES[targetChainId][remoteChainId] = deployerAddress
 *
 * Each chain pair uses the SAME deployer contract address on both chains.
 */
export const CCIP_SUCKER_DEPLOYER_ADDRESSES: Record<number, Record<number, `0x${string}`>> = {
  // Ethereum Sepolia -> other testnets
  [CHAIN_IDS.sepolia]: {
    [CHAIN_IDS.optimismSepolia]: SEPOLIA_DEPLOYERS.ETH_OP,
    [CHAIN_IDS.arbitrumSepolia]: SEPOLIA_DEPLOYERS.ETH_ARB,
    [CHAIN_IDS.baseSepolia]: SEPOLIA_DEPLOYERS.ETH_BASE,
  },
  // Optimism Sepolia -> other testnets
  [CHAIN_IDS.optimismSepolia]: {
    [CHAIN_IDS.sepolia]: SEPOLIA_DEPLOYERS.ETH_OP,
    [CHAIN_IDS.arbitrumSepolia]: SEPOLIA_DEPLOYERS.OP_ARB,
    [CHAIN_IDS.baseSepolia]: SEPOLIA_DEPLOYERS.OP_BASE,
  },
  // Arbitrum Sepolia -> other testnets
  [CHAIN_IDS.arbitrumSepolia]: {
    [CHAIN_IDS.sepolia]: SEPOLIA_DEPLOYERS.ETH_ARB,
    [CHAIN_IDS.optimismSepolia]: SEPOLIA_DEPLOYERS.OP_ARB,
    [CHAIN_IDS.baseSepolia]: SEPOLIA_DEPLOYERS.ARB_BASE,
  },
  // Base Sepolia -> other testnets
  [CHAIN_IDS.baseSepolia]: {
    [CHAIN_IDS.sepolia]: SEPOLIA_DEPLOYERS.ETH_BASE,
    [CHAIN_IDS.optimismSepolia]: SEPOLIA_DEPLOYERS.OP_BASE,
    [CHAIN_IDS.arbitrumSepolia]: SEPOLIA_DEPLOYERS.ARB_BASE,
  },
  // TODO: Add mainnet mappings when addresses are available
}

// Debug: Log the deployer addresses at module load time
console.log('[suckerConfig] CCIP_SUCKER_DEPLOYER_ADDRESSES loaded:', {
  targetChains: Object.keys(CCIP_SUCKER_DEPLOYER_ADDRESSES).map(Number),
  sepoliaRemotes: CCIP_SUCKER_DEPLOYER_ADDRESSES[11155111] ? Object.keys(CCIP_SUCKER_DEPLOYER_ADDRESSES[11155111]).map(Number) : 'NOT DEFINED',
  sepoliaToOptimism: CCIP_SUCKER_DEPLOYER_ADDRESSES[11155111]?.[11155420],
  sepoliaToBase: CCIP_SUCKER_DEPLOYER_ADDRESSES[11155111]?.[84532],
  sepoliaToArbitrum: CCIP_SUCKER_DEPLOYER_ADDRESSES[11155111]?.[421614],
})

/**
 * Generate a random salt for deterministic sucker deployment.
 * The same salt should be used across all chains in a multi-chain deployment
 * to ensure suckers have matching addresses.
 */
export function createSalt(): `0x${string}` {
  const base = '0x' + Math.random().toString(16).slice(2)
  const salt = toHex(toBytes(base, { size: 32 }))
  return salt as `0x${string}`
}

export interface JBTokenMapping {
  localToken: `0x${string}`
  remoteToken: `0x${string}`
  minGas: number
  minBridgeAmount: bigint
}

export interface JBSuckerDeployerConfig {
  deployer: `0x${string}`
  mappings: JBTokenMapping[]
}

export interface JBSuckerDeploymentConfig {
  deployerConfigurations: JBSuckerDeployerConfig[]
  salt: `0x${string}`
}

export interface ParseSuckerDeployerConfigOptions {
  minBridgeAmount?: bigint
}

/**
 * Parse sucker deployer configuration for a target chain.
 * Creates deployer configurations for connecting to all other chains in the deployment.
 *
 * @param targetChainId - The chain this configuration is for
 * @param allChainIds - All chains in the multi-chain deployment
 * @param opts - Optional configuration (minBridgeAmount)
 * @returns Sucker deployment configuration with deployer configs and salt
 *
 * @example
 * // Deploy to Sepolia, OP Sepolia, Base Sepolia, Arb Sepolia
 * const chains = [11155111, 11155420, 84532, 421614]
 * const salt = createSalt() // Generate once, reuse for all chains
 *
 * // For Sepolia deployment
 * const sepoliaConfig = parseSuckerDeployerConfig(11155111, chains, { salt })
 * // deployerConfigurations will have 3 entries (one for each remote chain)
 */
export function parseSuckerDeployerConfig(
  targetChainId: number,
  allChainIds: number[],
  opts: ParseSuckerDeployerConfigOptions & { salt?: `0x${string}` } = {}
): JBSuckerDeploymentConfig {
  // Get all chains except the target chain
  const remoteChainIds = allChainIds.filter(chainId => chainId !== targetChainId)

  // Debug: Log the lookup details
  console.log('[parseSuckerDeployerConfig] Lookup details:', {
    targetChainId,
    allChainIds,
    remoteChainIds,
    availableTargetChains: Object.keys(CCIP_SUCKER_DEPLOYER_ADDRESSES).map(Number),
    targetChainEntry: CCIP_SUCKER_DEPLOYER_ADDRESSES[targetChainId],
    targetChainEntryKeys: CCIP_SUCKER_DEPLOYER_ADDRESSES[targetChainId] ? Object.keys(CCIP_SUCKER_DEPLOYER_ADDRESSES[targetChainId]).map(Number) : [],
  })

  // Build deployer configurations for each remote chain
  const deployerConfigurations: JBSuckerDeployerConfig[] = remoteChainIds
    .map((remoteChainId): JBSuckerDeployerConfig | null => {
      const deployer = CCIP_SUCKER_DEPLOYER_ADDRESSES[targetChainId]?.[remoteChainId]

      console.log(`[parseSuckerDeployerConfig] Lookup ${targetChainId} -> ${remoteChainId}:`, deployer || 'NOT FOUND')

      if (!deployer) {
        console.warn(`No CCIP sucker deployer found for ${targetChainId} -> ${remoteChainId}`)
        return null
      }

      return {
        deployer,
        mappings: [
          {
            localToken: NATIVE_TOKEN as `0x${string}`,
            remoteToken: NATIVE_TOKEN as `0x${string}`,
            minGas: 200_000,
            minBridgeAmount: opts.minBridgeAmount ?? DEFAULT_MIN_BRIDGE_AMOUNT,
          },
        ],
      }
    })
    .filter((config): config is JBSuckerDeployerConfig => config !== null)

  return {
    deployerConfigurations,
    salt: opts.salt ?? createSalt(),
  }
}

/**
 * Check if a multi-chain deployment should have sucker configuration.
 * Returns true if there are multiple chains (suckers connect chains together).
 */
export function shouldConfigureSuckers(chainIds: number[]): boolean {
  return chainIds.length > 1
}

/**
 * Generate sucker deployment configurations for all chains in a multi-chain deployment.
 * Uses the same salt across all chains for deterministic addresses.
 *
 * @param chainIds - All chains in the deployment
 * @param opts - Optional configuration
 * @returns Map of chainId to sucker deployment config
 */
export function generateOmnichainSuckerConfigs(
  chainIds: number[],
  opts: ParseSuckerDeployerConfigOptions = {}
): Map<number, JBSuckerDeploymentConfig> {
  const configs = new Map<number, JBSuckerDeploymentConfig>()

  if (!shouldConfigureSuckers(chainIds)) {
    return configs
  }

  // Generate a single salt for all chains
  const salt = createSalt()

  for (const chainId of chainIds) {
    const config = parseSuckerDeployerConfig(chainId, chainIds, { ...opts, salt })
    configs.set(chainId, config)
  }

  return configs
}
