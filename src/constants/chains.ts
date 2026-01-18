import { mainnet, optimism, base, arbitrum } from 'viem/chains'

// Viem chain configurations for RPC calls
export const VIEM_CHAINS = {
  1: mainnet,
  10: optimism,
  8453: base,
  42161: arbitrum,
} as const

export type SupportedChainId = keyof typeof VIEM_CHAINS

// USDC contract addresses per chain
export const USDC_ADDRESSES: Record<SupportedChainId, `0x${string}`> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
}

// Juicebox V5 contract addresses (same on all supported chains)
export const JB_CONTRACTS = {
  JBTokens: '0x4d0edd347fb1fa21589c1e109b3474924be87636' as `0x${string}`,
  JBController: '0x0f7c6c1d9a6b4b5c3e8f9a0b1c2d3e4f5a6b7c8d' as `0x${string}`, // placeholder
  JBDirectory: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' as `0x${string}`, // placeholder
} as const

// Zero address constant
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`
