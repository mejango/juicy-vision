import { mainnet, optimism, base, arbitrum } from 'viem/chains'

// Viem chain configurations for RPC calls
export const VIEM_CHAINS = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
} as const

// Ankr API key for RPC endpoints
const ANKR_API_KEY = '4157139e2df23efe70685c5f1d9e63aac4862abca52613777308041e997f0d74'

// RPC endpoints for each chain (Ankr with API key as primary)
export const RPC_ENDPOINTS: Record<number, string[]> = {
  1: [
    `https://rpc.ankr.com/eth/${ANKR_API_KEY}`,
    'https://ethereum.publicnode.com',
    'https://eth.drpc.org',
  ],
  10: [
    `https://rpc.ankr.com/optimism/${ANKR_API_KEY}`,
    'https://optimism.publicnode.com',
    'https://mainnet.optimism.io',
  ],
  8453: [
    `https://rpc.ankr.com/base/${ANKR_API_KEY}`,
    'https://base.publicnode.com',
    'https://mainnet.base.org',
  ],
  42161: [
    `https://rpc.ankr.com/arbitrum/${ANKR_API_KEY}`,
    'https://arbitrum-one.publicnode.com',
    'https://arb1.arbitrum.io/rpc',
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

// Zero address constant
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`
