/**
 * Sucker deployment configuration for multi-chain JB projects.
 * Suckers enable cross-chain token bridging between the same project on different chains.
 *
 * Juicebox V6: CCIP sucker deployers are deployed per chain PAIR, with the SAME
 * address on both sides of the pair — and the same addresses on the mainnet and
 * sepolia families, so no testnet switch is needed.
 *
 * Addresses from deploy-all-v6/deployments (JBCCIPSuckerDeployer__*).
 */

import { toHex, toBytes, pad } from 'viem'

// Native token address used by Juicebox
export const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe' as const

// Zero bytes32 - used for the default `peer` (same-address deterministic peer sucker)
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

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
 * V6 CCIP Sucker Deployer addresses - organized by chain PAIR.
 * Each deployer handles bridging between a specific pair of chains.
 * The same deployer address is used on both chains in the pair, and the
 * mainnet and sepolia families share the same addresses.
 */
const CCIP_PAIR_DEPLOYERS = {
  // Ethereum <-> Optimism
  ETH_OP: '0x41d28bedd5b0fbf65424b48c0e1de92d5c882fc7' as `0x${string}`,
  // Ethereum <-> Arbitrum
  ETH_ARB: '0x36a2e30029d87c46f77f71b7b6b97fec8a760660' as `0x${string}`,
  // Ethereum <-> Base
  ETH_BASE: '0x3955fec11fe15f0be4dfa2b0153feef55d55e1ee' as `0x${string}`,
  // Optimism <-> Arbitrum
  OP_ARB: '0x1d58d56fbdb753de44737be926c33b79cf009afa' as `0x${string}`,
  // Optimism <-> Base
  OP_BASE: '0x8f6f0a70939997310309d7ab66b1b199faafe7f0' as `0x${string}`,
  // Arbitrum <-> Base
  ARB_BASE: '0x2845f919af9ed7d8dab188d42114bd590340a242' as `0x${string}`,
}

/**
 * CCIP Sucker Deployer addresses mapping.
 * Structure: CCIP_SUCKER_DEPLOYER_ADDRESSES[targetChainId][remoteChainId] = deployerAddress
 *
 * Each chain pair uses the SAME deployer contract address on both chains, and
 * the mainnet and sepolia families share addresses — so both are listed here
 * without an IS_TESTNET switch.
 */
export const CCIP_SUCKER_DEPLOYER_ADDRESSES: Record<number, Record<number, `0x${string}`>> = {
  // Ethereum mainnet -> other mainnets
  [CHAIN_IDS.mainnet]: {
    [CHAIN_IDS.optimism]: CCIP_PAIR_DEPLOYERS.ETH_OP,
    [CHAIN_IDS.arbitrum]: CCIP_PAIR_DEPLOYERS.ETH_ARB,
    [CHAIN_IDS.base]: CCIP_PAIR_DEPLOYERS.ETH_BASE,
  },
  [CHAIN_IDS.optimism]: {
    [CHAIN_IDS.mainnet]: CCIP_PAIR_DEPLOYERS.ETH_OP,
    [CHAIN_IDS.arbitrum]: CCIP_PAIR_DEPLOYERS.OP_ARB,
    [CHAIN_IDS.base]: CCIP_PAIR_DEPLOYERS.OP_BASE,
  },
  [CHAIN_IDS.arbitrum]: {
    [CHAIN_IDS.mainnet]: CCIP_PAIR_DEPLOYERS.ETH_ARB,
    [CHAIN_IDS.optimism]: CCIP_PAIR_DEPLOYERS.OP_ARB,
    [CHAIN_IDS.base]: CCIP_PAIR_DEPLOYERS.ARB_BASE,
  },
  [CHAIN_IDS.base]: {
    [CHAIN_IDS.mainnet]: CCIP_PAIR_DEPLOYERS.ETH_BASE,
    [CHAIN_IDS.optimism]: CCIP_PAIR_DEPLOYERS.OP_BASE,
    [CHAIN_IDS.arbitrum]: CCIP_PAIR_DEPLOYERS.ARB_BASE,
  },
  // Sepolia testnets (same pair addresses as mainnet)
  [CHAIN_IDS.sepolia]: {
    [CHAIN_IDS.optimismSepolia]: CCIP_PAIR_DEPLOYERS.ETH_OP,
    [CHAIN_IDS.arbitrumSepolia]: CCIP_PAIR_DEPLOYERS.ETH_ARB,
    [CHAIN_IDS.baseSepolia]: CCIP_PAIR_DEPLOYERS.ETH_BASE,
  },
  [CHAIN_IDS.optimismSepolia]: {
    [CHAIN_IDS.sepolia]: CCIP_PAIR_DEPLOYERS.ETH_OP,
    [CHAIN_IDS.arbitrumSepolia]: CCIP_PAIR_DEPLOYERS.OP_ARB,
    [CHAIN_IDS.baseSepolia]: CCIP_PAIR_DEPLOYERS.OP_BASE,
  },
  [CHAIN_IDS.arbitrumSepolia]: {
    [CHAIN_IDS.sepolia]: CCIP_PAIR_DEPLOYERS.ETH_ARB,
    [CHAIN_IDS.optimismSepolia]: CCIP_PAIR_DEPLOYERS.OP_ARB,
    [CHAIN_IDS.baseSepolia]: CCIP_PAIR_DEPLOYERS.ARB_BASE,
  },
  [CHAIN_IDS.baseSepolia]: {
    [CHAIN_IDS.sepolia]: CCIP_PAIR_DEPLOYERS.ETH_BASE,
    [CHAIN_IDS.optimismSepolia]: CCIP_PAIR_DEPLOYERS.OP_BASE,
    [CHAIN_IDS.arbitrumSepolia]: CCIP_PAIR_DEPLOYERS.ARB_BASE,
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

/**
 * Left-pad an EVM address to bytes32, as expected by the V6 JBTokenMapping.remoteToken field.
 */
export function addressToBytes32(address: `0x${string}`): `0x${string}` {
  return pad(address, { size: 32 })
}

// V6 JBTokenMapping: remoteToken is bytes32 (address left-padded); minBridgeAmount was removed.
export interface JBTokenMapping {
  localToken: `0x${string}`
  minGas: number
  remoteToken: `0x${string}` // bytes32
}

// V6 JBSuckerDeployerConfig: `peer` is the explicit peer sucker address on the
// remote chain as bytes32. Leave zero to use the default same-address deterministic peer.
export interface JBSuckerDeployerConfig {
  deployer: `0x${string}`
  peer: `0x${string}` // bytes32
  mappings: JBTokenMapping[]
}

export interface JBSuckerDeploymentConfig {
  deployerConfigurations: JBSuckerDeployerConfig[]
  salt: `0x${string}`
}

/**
 * The bridge infrastructure to deploy v6 suckers on (mirrors the SDK's
 * JBSuckerBridge — nana-sdk-core 91c2361 — so this call site is a drop-in
 * swap once that release ships):
 *
 * - `"ccip"`: Chainlink CCIP suckers. Connect any pair of supported chains and
 *   can map any supported asset (USDC bridges as canonical USDC via CCTP).
 * - `"native"`: OP/Base/Arbitrum standard-bridge suckers. Strongest trust
 *   guarantees, but only connect Ethereum with an L2 (never L2<->L2), only map
 *   the native token, and L2->L1 exits wait out the ~7-day challenge period.
 * - `"both"`: one native sucker AND one CCIP sucker per pair, for redundancy.
 *   Pairs or assets native bridges can't serve are covered by CCIP alone.
 */
export type JBSuckerBridge = 'ccip' | 'native' | 'both'

/**
 * Native-bridge sucker deployer addresses, keyed by local chain then remote
 * chain. Native bridges only connect Ethereum with an L2, so only L1<->L2
 * edges exist. Addresses from the v6 SDK registry (nana-sdk-core 91c2361),
 * cross-verified against deploy-all-v6/deployments (JBOptimismSuckerDeployer /
 * JBBaseSuckerDeployer / JBArbitrumSuckerDeployer — same address on both
 * sides of each pair).
 */
const NATIVE_OP = '0x298a775c030adcedb641a89d9047ec9972674e1a' as `0x${string}`
const NATIVE_BASE = '0x54140331902de5c3445eb0c26e15099a5a9d59e6' as `0x${string}`
const NATIVE_ARB = '0xa12ebfca3d4e0810e4ed174e4c08277c26917acb' as `0x${string}`

export const NATIVE_SUCKER_DEPLOYER_ADDRESSES: Record<number, Record<number, `0x${string}`>> = {
  1: { 10: NATIVE_OP, 8453: NATIVE_BASE, 42161: NATIVE_ARB },
  10: { 1: NATIVE_OP },
  8453: { 1: NATIVE_BASE },
  42161: { 1: NATIVE_ARB },
  11155111: { 11155420: NATIVE_OP, 84532: NATIVE_BASE, 421614: NATIVE_ARB },
  11155420: { 11155111: NATIVE_OP },
  84532: { 11155111: NATIVE_BASE },
  421614: { 11155111: NATIVE_ARB },
}

export interface ParseSuckerDeployerConfigOptions {
  /**
   * Per-chain token addresses for bridging.
   * Maps chainId -> token address. Required for ERC20 (e.g., USDC) projects.
   * If not provided, defaults to NATIVE_TOKEN for all chains.
   */
  tokenAddresses?: Record<number, `0x${string}`>
  /**
   * The bridge infrastructure to deploy suckers on. Defaults to "ccip"
   * (the previous behavior of every caller).
   */
  bridge?: JBSuckerBridge
}

/**
 * Parse sucker deployer configuration for a target chain.
 * Creates deployer configurations for connecting to all other chains in the deployment.
 *
 * @param targetChainId - The chain this configuration is for
 * @param allChainIds - All chains in the multi-chain deployment
 * @param opts - Optional configuration (tokenAddresses, salt)
 * @returns Sucker deployment configuration with deployer configs and salt
 */
export function parseSuckerDeployerConfig(
  targetChainId: number,
  allChainIds: number[],
  opts: ParseSuckerDeployerConfigOptions & { salt?: `0x${string}` } = {}
): JBSuckerDeploymentConfig {
  // Get all chains except the target chain
  const remoteChainIds = allChainIds.filter(chainId => chainId !== targetChainId)
  const bridge: JBSuckerBridge = opts.bridge ?? 'ccip'

  // Determine local token for this chain
  // Use provided token address if available, otherwise NATIVE_TOKEN
  const localToken = opts.tokenAddresses?.[targetChainId] ?? NATIVE_TOKEN as `0x${string}`
  const localIsNative = localToken.toLowerCase() === NATIVE_TOKEN.toLowerCase()

  // The CCIP sucker config for one (local -> remote) pair, or null when the
  // route-specific deployer is absent (reported, never silently miswired).
  const ccipConfigFor = (remoteChainId: number): JBSuckerDeployerConfig | null => {
    const deployer = CCIP_SUCKER_DEPLOYER_ADDRESSES[targetChainId]?.[remoteChainId]
    if (!deployer) {
      console.warn(`No CCIP sucker deployer found for ${targetChainId} -> ${remoteChainId}`)
      return null
    }
    const remoteToken = opts.tokenAddresses?.[remoteChainId] ?? NATIVE_TOKEN as `0x${string}`
    return {
      deployer,
      // Zero peer = default same-address deterministic peer sucker
      peer: ZERO_BYTES32,
      mappings: [
        {
          localToken,
          minGas: 200_000,
          // V6 expects the remote token as bytes32 (left-padded address)
          remoteToken: addressToBytes32(remoteToken),
        },
      ],
    }
  }

  // The native-bridge sucker config for one pair, or null when the pair/asset
  // can't go native and CCIP covers it (bridge "both"). SDK semantics
  // (nana-sdk-core 91c2361): standard bridges deliver bridge-wrapped tokens
  // (USDC.e, never canonical USDC), which would strand funds on the remote
  // sucker — only the native token may map over a native bridge.
  const nativeConfigFor = (remoteChainId: number): JBSuckerDeployerConfig | null => {
    const deployer = NATIVE_SUCKER_DEPLOYER_ADDRESSES[targetChainId]?.[remoteChainId]
    if (deployer && localIsNative) {
      return {
        deployer,
        peer: ZERO_BYTES32,
        mappings: [
          {
            localToken: NATIVE_TOKEN as `0x${string}`,
            minGas: 200_000,
            remoteToken: addressToBytes32(NATIVE_TOKEN as `0x${string}`),
          },
        ],
      }
    }
    if (bridge === 'both') return null // CCIP config covers this pair/asset
    throw new Error(
      deployer
        ? `Only the native token can bridge over native bridges (they deliver bridge-wrapped tokens like USDC.e); use bridge "ccip" or "both" to map other assets`
        : `No native bridge between ${targetChainId} and ${remoteChainId} (native bridges only connect Ethereum with an L2); use bridge "ccip" or "both"`,
    )
  }

  // One config per (remote chain, bridge kind) pair.
  const deployerConfigurations: JBSuckerDeployerConfig[] = remoteChainIds
    .flatMap((remoteChainId): (JBSuckerDeployerConfig | null)[] => [
      bridge === 'ccip' ? null : nativeConfigFor(remoteChainId),
      bridge === 'native' ? null : ccipConfigFor(remoteChainId),
    ])
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
