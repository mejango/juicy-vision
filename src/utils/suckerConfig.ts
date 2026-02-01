/**
 * Sucker deployment configuration for multi-chain JB projects.
 * Suckers enable cross-chain token bridging between the same project on different chains.
 *
 * Based on juice-sdk-core implementation:
 * https://github.com/jbx-protocol/juice-sdk-v5/blob/main/packages/core/src/utils/deploy.ts
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

// CCIP Sucker Deployer addresses by chain
// From juice-sdk-core/dist/esm/generated/juicebox.js
const jbccipSuckerDeployerAddress: Record<number, `0x${string}`> = {
  1: '0x34B40205B249e5733CF93d86B7C9783b015dD3e7',
  10: '0x34B40205B249e5733CF93d86B7C9783b015dD3e7',
  8453: '0xdE901EbaFC70d545F9D43034308C136Ce8c94A5C',
  42161: '0x9d4858cc9d3552507EEAbce722787AfEf64C615e',
  84532: '0xdE901EbaFC70d545F9D43034308C136Ce8c94A5C',
  421614: '0x9d4858cc9d3552507EEAbce722787AfEf64C615e',
  11155111: '0x34B40205B249e5733CF93d86B7C9783b015dD3e7',
  11155420: '0x34B40205B249e5733CF93d86B7C9783b015dD3e7',
}

const jbccipSuckerDeployer_1Address: Record<number, `0x${string}`> = {
  1: '0xdE901EbaFC70d545F9D43034308C136Ce8c94A5C',
  10: '0x39132eA75B9eaE5CBfF7BA1997C804302a7fF413',
  8453: '0xb825F2f6995966eB6dD772a8707D4A547028Ac26',
  42161: '0x39132eA75B9eaE5CBfF7BA1997C804302a7fF413',
  84532: '0xb825F2f6995966eB6dD772a8707D4A547028Ac26',
  421614: '0x39132eA75B9eaE5CBfF7BA1997C804302a7fF413',
  11155111: '0xdE901EbaFC70d545F9D43034308C136Ce8c94A5C',
  11155420: '0x39132eA75B9eaE5CBfF7BA1997C804302a7fF413',
}

const jbccipSuckerDeployer_2Address: Record<number, `0x${string}`> = {
  1: '0x9d4858cc9d3552507EEAbce722787AfEf64C615e',
  10: '0xb825F2f6995966eB6dD772a8707D4A547028Ac26',
  8453: '0x3D7Fb0aa325aD5D2349274f9eF33D4424135d963',
  42161: '0x3D7Fb0aa325aD5D2349274f9eF33D4424135d963',
  84532: '0x3D7Fb0aa325aD5D2349274f9eF33D4424135d963',
  421614: '0x3D7Fb0aa325aD5D2349274f9eF33D4424135d963',
  11155111: '0x9d4858cc9d3552507EEAbce722787AfEf64C615e',
  11155420: '0xb825F2f6995966eB6dD772a8707D4A547028Ac26',
}

/**
 * CCIP Sucker Deployer addresses mapping.
 * Structure: CCIP_SUCKER_DEPLOYER_ADDRESSES[targetChainId][remoteChainId] = deployerAddress
 *
 * Each chain pair uses a specific deployer contract based on the CCIP lane configuration.
 */
export const CCIP_SUCKER_DEPLOYER_ADDRESSES: Record<number, Record<number, `0x${string}`>> = {
  // Sepolia -> other testnets
  [CHAIN_IDS.sepolia]: {
    [CHAIN_IDS.optimismSepolia]: jbccipSuckerDeployerAddress[CHAIN_IDS.sepolia],
    [CHAIN_IDS.baseSepolia]: jbccipSuckerDeployer_1Address[CHAIN_IDS.sepolia],
    [CHAIN_IDS.arbitrumSepolia]: jbccipSuckerDeployer_2Address[CHAIN_IDS.sepolia],
  },
  // Mainnet -> other mainnets
  [CHAIN_IDS.mainnet]: {
    [CHAIN_IDS.optimism]: jbccipSuckerDeployerAddress[CHAIN_IDS.mainnet],
    [CHAIN_IDS.base]: jbccipSuckerDeployer_1Address[CHAIN_IDS.mainnet],
    [CHAIN_IDS.arbitrum]: jbccipSuckerDeployer_2Address[CHAIN_IDS.mainnet],
  },
  // Arbitrum Sepolia -> other testnets
  [CHAIN_IDS.arbitrumSepolia]: {
    [CHAIN_IDS.sepolia]: jbccipSuckerDeployerAddress[CHAIN_IDS.arbitrumSepolia],
    [CHAIN_IDS.optimismSepolia]: jbccipSuckerDeployer_1Address[CHAIN_IDS.arbitrumSepolia],
    [CHAIN_IDS.baseSepolia]: jbccipSuckerDeployer_2Address[CHAIN_IDS.arbitrumSepolia],
  },
  // Arbitrum -> other mainnets
  [CHAIN_IDS.arbitrum]: {
    [CHAIN_IDS.mainnet]: jbccipSuckerDeployerAddress[CHAIN_IDS.arbitrum],
    [CHAIN_IDS.optimism]: jbccipSuckerDeployer_1Address[CHAIN_IDS.arbitrum],
    [CHAIN_IDS.base]: jbccipSuckerDeployer_2Address[CHAIN_IDS.arbitrum],
  },
  // OP Sepolia -> other testnets
  [CHAIN_IDS.optimismSepolia]: {
    [CHAIN_IDS.sepolia]: jbccipSuckerDeployerAddress[CHAIN_IDS.optimismSepolia],
    [CHAIN_IDS.arbitrumSepolia]: jbccipSuckerDeployer_1Address[CHAIN_IDS.optimismSepolia],
    [CHAIN_IDS.baseSepolia]: jbccipSuckerDeployer_2Address[CHAIN_IDS.optimismSepolia],
  },
  // Optimism -> other mainnets
  [CHAIN_IDS.optimism]: {
    [CHAIN_IDS.mainnet]: jbccipSuckerDeployerAddress[CHAIN_IDS.optimism],
    [CHAIN_IDS.arbitrum]: jbccipSuckerDeployer_1Address[CHAIN_IDS.optimism],
    [CHAIN_IDS.base]: jbccipSuckerDeployer_2Address[CHAIN_IDS.optimism],
  },
  // Base Sepolia -> other testnets
  [CHAIN_IDS.baseSepolia]: {
    [CHAIN_IDS.sepolia]: jbccipSuckerDeployerAddress[CHAIN_IDS.baseSepolia],
    [CHAIN_IDS.optimismSepolia]: jbccipSuckerDeployer_1Address[CHAIN_IDS.baseSepolia],
    [CHAIN_IDS.arbitrumSepolia]: jbccipSuckerDeployer_2Address[CHAIN_IDS.baseSepolia],
  },
  // Base -> other mainnets
  [CHAIN_IDS.base]: {
    [CHAIN_IDS.mainnet]: jbccipSuckerDeployerAddress[CHAIN_IDS.base],
    [CHAIN_IDS.optimism]: jbccipSuckerDeployer_1Address[CHAIN_IDS.base],
    [CHAIN_IDS.arbitrum]: jbccipSuckerDeployer_2Address[CHAIN_IDS.base],
  },
}

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

  // Build deployer configurations for each remote chain
  const deployerConfigurations: JBSuckerDeployerConfig[] = remoteChainIds
    .map((remoteChainId): JBSuckerDeployerConfig | null => {
      const deployer = CCIP_SUCKER_DEPLOYER_ADDRESSES[targetChainId]?.[remoteChainId]

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
