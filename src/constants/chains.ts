import { mainnet, optimism, base, arbitrum } from 'viem/chains'

// Viem chain configurations for RPC calls
export const VIEM_CHAINS = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
} as const

// RPC endpoints for each chain (public endpoints - users can configure custom RPCs in settings)
export const RPC_ENDPOINTS: Record<number, string[]> = {
  1: [
    'https://ethereum.publicnode.com',
    'https://eth.drpc.org',
    'https://rpc.ankr.com/eth',
  ],
  10: [
    'https://optimism.publicnode.com',
    'https://mainnet.optimism.io',
    'https://rpc.ankr.com/optimism',
  ],
  8453: [
    'https://base.publicnode.com',
    'https://mainnet.base.org',
    'https://rpc.ankr.com/base',
  ],
  42161: [
    'https://arbitrum-one.publicnode.com',
    'https://arb1.arbitrum.io/rpc',
    'https://rpc.ankr.com/arbitrum',
  ],
}

export type SupportedChainId = keyof typeof VIEM_CHAINS

// USDC contract addresses per chain
export const USDC_ADDRESSES: Record<SupportedChainId, `0x${string}`> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
}

// =============================================================================
// JUICEBOX V5 vs V5.1 CONTRACT SEPARATION
// =============================================================================
// CRITICAL RULE: Versioned contracts must NEVER mix!
// - If a contract has both V5 and V5.1 versions, use matching versions
// - A project with JBController5_1 MUST use JBMultiTerminal5_1 (not V5 terminal)
// - Contracts with only one version (JBTokens, JBProjects, etc.) work with both
// - Revnets: ALWAYS use original V5 contracts (owned by REVDeployer)
// - New non-revnet JB projects: ALWAYS use V5.1 contracts
// =============================================================================

// Shared contracts - work with BOTH V5 and V5.1 projects
// These have no versioned variants, safe to use with any project
export const JB_SHARED_CONTRACTS = {
  JBTokens: '0x4d0edd347fb1fa21589c1e109b3474924be87636' as `0x${string}`,
  JBProjects: '0x885f707efa18d2cb12f05a3a8eba6b4b26c8c1d4' as `0x${string}`,
  JBDirectory: '0x0061e516886a0540f63157f112c0588ee0651dcf' as `0x${string}`,
  JBSplits: '0x7160a322fea44945a6ef9adfd65c322258df3c5e' as `0x${string}`,
  JBFundAccessLimits: '0x3a46b21720c8b70184b0434a2293b2fdcc497ce7' as `0x${string}`,
  JBPermissions: '0xba948dab74e875b19cf0e2ca7a4546c0c2defc40' as `0x${string}`,
  JBPrices: '0x6e92e3b5ce1e7a4344c6d27c0c54efd00df92fb6' as `0x${string}`,
  JBFeelessAddresses: '0xf76f7124f73abc7c30b2f76121afd4c52be19442' as `0x${string}`,
} as const

// Original Juicebox V5 contracts - USE FOR REVNETS
// These are used by REVDeployer and all existing Revnet projects
export const JB_CONTRACTS_V5 = {
  ...JB_SHARED_CONTRACTS,
  JBController: '0x27da30646502e2f642be5281322ae8c394f7668a' as `0x${string}`,
  JBMultiTerminal: '0x2db6d704058e552defe415753465df8df0361846' as `0x${string}`,
  JBRulesets: '0x6292281d69c3593fcf6ea074e5797341476ab428' as `0x${string}`,
} as const

// Juicebox V5.1 contracts - USE FOR NEW NON-REVNET PROJECTS
// Same deterministic addresses on all chains via CREATE2
export const JB_CONTRACTS_5_1 = {
  ...JB_SHARED_CONTRACTS,
  // V5.1 specific contracts with official names
  JBController5_1: '0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1' as `0x${string}`,
  JBMultiTerminal5_1: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c' as `0x${string}`,
  JBRulesets5_1: '0xd4257005ca8d27bbe11f356453b0e4692414b056' as `0x${string}`,
  JBTerminalStore5_1: '0x5cdfcf7f5f25da0dcb0eccd027e5feebada1d964' as `0x${string}`,
  JBOmnichainDeployer5_1: '0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71' as `0x${string}`,
  // Aliases for backward compatibility (code using JB_CONTRACTS.JBRulesets, etc.)
  JBController: '0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1' as `0x${string}`,
  JBMultiTerminal: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c' as `0x${string}`,
  JBRulesets: '0xd4257005ca8d27bbe11f356453b0e4692414b056' as `0x${string}`,
} as const

// Default export for backward compatibility - uses V5.1 for new projects
// IMPORTANT: Check if project is a Revnet before using these addresses!
export const JB_CONTRACTS = JB_CONTRACTS_5_1

// REVDeployer contract address (same on all supported chains via CREATE2)
// This is the owner of all Revnet projects - uses V5 contracts, NOT V5.1
export const REV_DEPLOYER = '0x2ca27bde7e7d33e353b44c27acfcf6c78dde251d' as `0x${string}`

// 721 Hook Contracts (same deterministic address on all chains via CREATE2)
export const JB721_CONTRACTS = {
  // JB721TiersHookStore - stores tier data for all 721 hooks
  JB721TiersHookStore: '0x4ae9af188c2b63cba768e53f7e6c1b62b2e86ce7' as `0x${string}`,
  // JB721TiersHookDeployer - deploys new 721 hooks
  JB721TiersHookDeployer: '0x116e79c39a70ab6ac32399ed59b3b104e4d8df6c' as `0x${string}`,
} as const

// Zero address constant
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`

// JBSwapTerminal addresses - use when paying a project with a different token than its accounting context
// e.g., paying USDC to an ETH-denominated project (swaps USDC → ETH before paying)
export const JB_SWAP_TERMINAL: Record<SupportedChainId, `0x${string}`> = {
  1: '0x259385b97dfbd5576bd717dc7b25967ec8b145dd',      // Ethereum
  10: '0x73d04584bde126242c36c2c7b219cbdec7aad774',     // Optimism
  8453: '0x4fd73d8b285e82471f08a4ef9861d6248b832edd',   // Base
  42161: '0x483c9b12c5bd2da73133aae30642ce0008c752ad',  // Arbitrum
}

// JBSwapTerminal Registry addresses - same on all chains via CREATE2
// Choose based on what currency the PROJECT should RECEIVE after swap:
// - JBSwapTerminalRegistry: TOKEN_OUT = NATIVE_TOKEN (ETH)
// - JBSwapTerminalUSDCRegistry: TOKEN_OUT = USDC
export const JB_SWAP_TERMINAL_REGISTRY = '0x60b4f5595ee509c4c22921c7b7999f1616e6a4f6' as const
export const JB_SWAP_TERMINAL_USDC_REGISTRY = '0x1ce40d201cdec791de05810d17aaf501be167422' as const

// =============================================================================
// SUCKER CONTRACTS (Cross-Chain Token Bridging)
// =============================================================================
// Suckers enable token bridging between chains for the same project.
// After deploying a project on multiple chains, deploy suckers to link them.

// JBSuckerRegistry - manages sucker deployments and mappings
export const JB_SUCKER_REGISTRY = '0x696c7e9b1c821c0200b2e28496f21f09c5447766' as `0x${string}`

// Sucker deployers per bridge type
// Each deployer creates suckers for a specific bridge (OP Messenger, Arbitrum Gateway, etc.)
export const SUCKER_DEPLOYERS = {
  // BPSuckerDeployer - Deploys suckers using native OP Stack messaging (Optimism, Base)
  BPSuckerDeployer: '0xa2e34c2f94b38ec0e394ab69ba0e3d1f84c8e5d4' as `0x${string}`,
  // ARBSuckerDeployer - Deploys suckers using Arbitrum's gateway
  ARBSuckerDeployer: '0x35a69642fa08e35a5c4e7f0e5c0b6e9d05b6c8d2' as `0x${string}`,
  // CCIPSuckerDeployer - Deploys suckers using Chainlink CCIP (cross-ecosystem)
  CCIPSuckerDeployer: '0x8b7a92fa96537fc8c5d1e4a9d5e8c7f2b6a9c3e1' as `0x${string}`,
} as const

// Map chains to their preferred sucker deployer
// OP Stack chains (10, 8453) use BPSuckerDeployer
// Arbitrum (42161) uses ARBSuckerDeployer
// Ethereum (1) can use any deployer as it's the hub
export const CHAIN_SUCKER_DEPLOYER: Record<SupportedChainId, `0x${string}`> = {
  1: SUCKER_DEPLOYERS.BPSuckerDeployer,       // Ethereum - hub, supports all
  10: SUCKER_DEPLOYERS.BPSuckerDeployer,      // Optimism - OP Stack
  8453: SUCKER_DEPLOYERS.BPSuckerDeployer,    // Base - OP Stack
  42161: SUCKER_DEPLOYERS.ARBSuckerDeployer,  // Arbitrum - Arbitrum Gateway
}

// =============================================================================
// OMNICHAIN PROJECT DEPLOYER
// =============================================================================
// Deploy projects on multiple chains with a single transaction

// JBOmnichainDeployer - deploys projects on all chains at once
export const JB_OMNICHAIN_DEPLOYER = '0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71' as `0x${string}`
