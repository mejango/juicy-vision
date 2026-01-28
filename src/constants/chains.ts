import { mainnet, optimism, base, arbitrum, sepolia, optimismSepolia, baseSepolia, arbitrumSepolia } from 'viem/chains'
import { IS_TESTNET, CHAIN_IDS } from '../config/environment'

// =============================================================================
// CHAIN CONFIGURATION
// =============================================================================
// Environment-aware chain configuration. Uses Sepolia testnets when IS_TESTNET is true.

// Viem chain configurations for RPC calls
export const VIEM_CHAINS = IS_TESTNET
  ? {
      [CHAIN_IDS.ethereum]: sepolia,
      [CHAIN_IDS.optimism]: optimismSepolia,
      [CHAIN_IDS.base]: baseSepolia,
      [CHAIN_IDS.arbitrum]: arbitrumSepolia,
    } as const
  : {
      [CHAIN_IDS.ethereum]: mainnet,
      [CHAIN_IDS.optimism]: optimism,
      [CHAIN_IDS.base]: base,
      [CHAIN_IDS.arbitrum]: arbitrum,
    } as const

// RPC endpoints for each chain (public endpoints - users can configure custom RPCs in settings)
export const RPC_ENDPOINTS: Record<number, string[]> = IS_TESTNET
  ? {
      [CHAIN_IDS.ethereum]: [
        'https://rpc.sepolia.org',
        'https://sepolia.drpc.org',
        'https://rpc.ankr.com/eth_sepolia',
      ],
      [CHAIN_IDS.optimism]: [
        'https://sepolia.optimism.io',
        'https://optimism-sepolia.drpc.org',
        'https://rpc.ankr.com/optimism_sepolia',
      ],
      [CHAIN_IDS.base]: [
        'https://sepolia.base.org',
        'https://base-sepolia.drpc.org',
        'https://rpc.ankr.com/base_sepolia',
      ],
      [CHAIN_IDS.arbitrum]: [
        'https://sepolia-rollup.arbitrum.io/rpc',
        'https://arbitrum-sepolia.drpc.org',
        'https://rpc.ankr.com/arbitrum_sepolia',
      ],
    }
  : {
      [CHAIN_IDS.ethereum]: [
        'https://ethereum.publicnode.com',
        'https://eth.drpc.org',
        'https://rpc.ankr.com/eth',
      ],
      [CHAIN_IDS.optimism]: [
        'https://optimism.publicnode.com',
        'https://mainnet.optimism.io',
        'https://rpc.ankr.com/optimism',
      ],
      [CHAIN_IDS.base]: [
        'https://base.publicnode.com',
        'https://mainnet.base.org',
        'https://rpc.ankr.com/base',
      ],
      [CHAIN_IDS.arbitrum]: [
        'https://arbitrum-one.publicnode.com',
        'https://arb1.arbitrum.io/rpc',
        'https://rpc.ankr.com/arbitrum',
      ],
    }

export type SupportedChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS]

// USDC contract addresses per chain
// Testnet uses test USDC tokens (may need faucet or minting)
export const USDC_ADDRESSES: Record<SupportedChainId, `0x${string}`> = IS_TESTNET
  ? {
      [CHAIN_IDS.ethereum]: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia USDC
      [CHAIN_IDS.optimism]: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', // OP Sepolia USDC
      [CHAIN_IDS.base]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',    // Base Sepolia USDC
      [CHAIN_IDS.arbitrum]: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // Arb Sepolia USDC
    }
  : {
      [CHAIN_IDS.ethereum]: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      [CHAIN_IDS.optimism]: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      [CHAIN_IDS.base]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      [CHAIN_IDS.arbitrum]: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
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
//
// NOTE: JB core contracts use CREATE2 deterministic deployment, so addresses
// are the SAME on mainnet and Sepolia testnets.
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

// =============================================================================
// SWAP TERMINAL (Chain-specific addresses)
// =============================================================================
// JBSwapTerminal addresses - use when paying a project with a different token than its accounting context
// e.g., paying USDC to an ETH-denominated project (swaps USDC → ETH before paying)
// NOTE: These have DIFFERENT addresses on mainnet vs testnet

export const JB_SWAP_TERMINAL: Record<SupportedChainId, `0x${string}`> = IS_TESTNET
  ? {
      [CHAIN_IDS.ethereum]: '0xca3f2cc5a35c0412e8147746602b76ba4ac29fc5',  // Sepolia
      [CHAIN_IDS.optimism]: '0xc7369f75bd678e1a9a46b82e2512e84489d4d32d',  // OP Sepolia
      [CHAIN_IDS.base]: '0xc7369f75bd678e1a9a46b82e2512e84489d4d32d',      // Base Sepolia
      [CHAIN_IDS.arbitrum]: '0x5f820a86d63eb1b98c562728719dc1e30967c41c',  // Arb Sepolia
    }
  : {
      [CHAIN_IDS.ethereum]: '0x259385b97dfbd5576bd717dc7b25967ec8b145dd',
      [CHAIN_IDS.optimism]: '0x73d04584bde126242c36c2c7b219cbdec7aad774',
      [CHAIN_IDS.base]: '0x4fd73d8b285e82471f08a4ef9861d6248b832edd',
      [CHAIN_IDS.arbitrum]: '0x483c9b12c5bd2da73133aae30642ce0008c752ad',
    }

// JBSwapTerminalUSDC addresses (chain-specific, different on testnet)
export const JB_SWAP_TERMINAL_USDC: Record<SupportedChainId, `0x${string}`> = IS_TESTNET
  ? {
      [CHAIN_IDS.ethereum]: '0x30aed19aeBb892Ecc9fCc5E6bC14E52b13b251b5',  // Sepolia
      [CHAIN_IDS.optimism]: '0x7D7b1ed2B6c21bDA664f5b4B6b2Ce4063759e552',  // OP Sepolia
      [CHAIN_IDS.base]: '0x6294Ebd426739a47776bD4dAA798b8Fa29112f73',      // Base Sepolia
      [CHAIN_IDS.arbitrum]: '0xD7503B0F276a72df561eC96daea5e130c62fd0f6',  // Arb Sepolia
    }
  : {
      [CHAIN_IDS.ethereum]: '0x642F6fF15462A5803E9b3bfa6d79F47bCd378F80',
      [CHAIN_IDS.optimism]: '0x7bA67a138A63FF72fB5f5dbfb16E3C49CCf4a0eD',
      [CHAIN_IDS.base]: '0x7E000Ed6fa38E19bBf9c7343103BcA377DbeE8Ab',
      [CHAIN_IDS.arbitrum]: '0x36379B28E67B73F5ae9e3dE320cE1DBd7fd99c08',
    }

// JBSwapTerminal Registry addresses - same on all chains via CREATE2
// Choose based on what currency the PROJECT should RECEIVE after swap:
// - JBSwapTerminalRegistry: TOKEN_OUT = NATIVE_TOKEN (ETH)
// - JBSwapTerminalUSDCRegistry: TOKEN_OUT = USDC
export const JB_SWAP_TERMINAL_REGISTRY = '0x60b4f5595ee509c4c22921c7b7999f1616e6a4f6' as const
export const JB_SWAP_TERMINAL_USDC_REGISTRY = '0x1ce40d201cdec791de05810d17aaf501be167422' as const

// =============================================================================
// BUYBACK HOOK (Chain-specific addresses)
// =============================================================================
// JBBuybackHook addresses - different on each chain/testnet

export const JB_BUYBACK_HOOK: Record<SupportedChainId, `0x${string}`> = IS_TESTNET
  ? {
      [CHAIN_IDS.ethereum]: '0xf082e3218a690ea6386506bed338f6878d21815f',  // Sepolia
      [CHAIN_IDS.optimism]: '0x79e5ca5ebe4f110965248afad88b8e539e1aa8fd',  // OP Sepolia
      [CHAIN_IDS.base]: '0x79e5ca5ebe4f110965248afad88b8e539e1aa8fd',      // Base Sepolia
      [CHAIN_IDS.arbitrum]: '0xb35ab801c008a64d8f3eea0a8a6209b0d176f2df',  // Arb Sepolia
    }
  : {
      [CHAIN_IDS.ethereum]: '0xd342490ec41d5982c23951253a74a1c940fe0f9b',
      [CHAIN_IDS.optimism]: '0x318f8aa6a95cb83419985c0d797c762f5a7824f3',
      [CHAIN_IDS.base]: '0xb6133a222315f8e9d25e7c77bac5ddeb3451d088',
      [CHAIN_IDS.arbitrum]: '0x4ac3e20edd1d398def0dfb44d3adb9fc244f0320',
    }

// =============================================================================
// SUCKER CONTRACTS (Cross-Chain Token Bridging)
// =============================================================================
// Suckers enable token bridging between chains for the same project.
// After deploying a project on multiple chains, deploy suckers to link them.

// JBSuckerRegistry - manages sucker deployments and mappings (CREATE2 - same address)
export const JB_SUCKER_REGISTRY = '0x07c8c5bf08f0361883728a8a5f8824ba5724ece3' as `0x${string}`

// Sucker deployers per bridge type (CREATE2 - same addresses on mainnet and testnet)
// Each deployer creates suckers for a specific bridge (OP Messenger, Arbitrum Gateway, etc.)
export const SUCKER_DEPLOYERS = {
  // JBArbitrumSuckerDeployer
  ARBSuckerDeployer: '0xea06bd663a1cec97b5bdec9375ab9a63695c9699' as `0x${string}`,
  // JBOptimismSuckerDeployer
  OPSuckerDeployer: '0x77cdb0f5eef8febd67dd6e594ff654fb12cc3057' as `0x${string}`,
  // JBBaseSuckerDeployer
  BaseSuckerDeployer: '0xd9f35d8dd36046f14479e6dced03733724947efd' as `0x${string}`,
} as const

// Map chains to their preferred sucker deployer
export const CHAIN_SUCKER_DEPLOYER: Record<SupportedChainId, `0x${string}`> = {
  [CHAIN_IDS.ethereum]: SUCKER_DEPLOYERS.OPSuckerDeployer,  // Ethereum - hub, supports all
  [CHAIN_IDS.optimism]: SUCKER_DEPLOYERS.OPSuckerDeployer,  // Optimism - OP Stack
  [CHAIN_IDS.base]: SUCKER_DEPLOYERS.BaseSuckerDeployer,    // Base - OP Stack
  [CHAIN_IDS.arbitrum]: SUCKER_DEPLOYERS.ARBSuckerDeployer, // Arbitrum - Arbitrum Gateway
}

// =============================================================================
// OMNICHAIN PROJECT DEPLOYER
// =============================================================================
// Deploy projects on multiple chains with a single transaction

// JBOmnichainDeployer - deploys projects on all chains at once (CREATE2 - same address)
export const JB_OMNICHAIN_DEPLOYER = '0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71' as `0x${string}`
