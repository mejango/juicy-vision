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

// Juicebox V5 contract addresses (same on all supported chains via CREATE2)
// Source: https://docs.juicebox.money/dev/v5/addresses/
export const JB_CONTRACTS = {
  JBTokens: '0x4d0edd347fb1fa21589c1e109b3474924be87636' as `0x${string}`,
  JBRulesets: '0x6292281d69c3593fcf6ea074e5797341476ab428' as `0x${string}`,
  JBController: '0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1' as `0x${string}`, // JBController5_1
  JBDirectory: '0x0061e516886a0540f63157f112c0588ee0651dcf' as `0x${string}`,
  JBMultiTerminal: '0x2db6d704058e552defe415753465df8df0361846' as `0x${string}`,
  JBFundAccessLimits: '0x3a46b21720c8b70184b0434a2293b2fdcc497ce7' as `0x${string}`,
  JBSplits: '0xbe6ec7c01a36ae0b00fceaa72fbf35f7696dd38c' as `0x${string}`,
} as const

// REVDeployer contract address (same on all supported chains via CREATE2)
// This is the owner of all Revnet projects
export const REV_DEPLOYER = '0x2ca27bde7e7d33e353b44c27acfcf6c78dde251d' as `0x${string}`

// Zero address constant
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`
