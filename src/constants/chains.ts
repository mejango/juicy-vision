import { mainnet, optimism, base, arbitrum, sepolia, optimismSepolia, baseSepolia, arbitrumSepolia } from 'viem/chains'
import { IS_TESTNET, CHAIN_IDS } from '../config/environment'

// =============================================================================
// CHAIN CONFIGURATION
// =============================================================================
// Environment-aware chain configuration. Uses Sepolia testnets when IS_TESTNET is true.

// Viem chain configurations for RPC calls
export const VIEM_CHAINS = IS_TESTNET
  ? ({
      [CHAIN_IDS.ethereum]: sepolia,
      [CHAIN_IDS.optimism]: optimismSepolia,
      [CHAIN_IDS.base]: baseSepolia,
      [CHAIN_IDS.arbitrum]: arbitrumSepolia,
    } as const)
  : ({
      [CHAIN_IDS.ethereum]: mainnet,
      [CHAIN_IDS.optimism]: optimism,
      [CHAIN_IDS.base]: base,
      [CHAIN_IDS.arbitrum]: arbitrum,
    } as const)

// Transaction components also run in tests and can display records created in
// either environment. Keep one canonical lookup for all deployed V6 chains;
// RPC and wallet configuration still decide which environment is executable.
export const ALL_VIEM_CHAINS = {
  [mainnet.id]: mainnet,
  [optimism.id]: optimism,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
  [sepolia.id]: sepolia,
  [optimismSepolia.id]: optimismSepolia,
  [baseSepolia.id]: baseSepolia,
  [arbitrumSepolia.id]: arbitrumSepolia,
} as const

// RPC endpoints for each chain (public endpoints - users can configure custom RPCs in settings)
export const RPC_ENDPOINTS: Record<number, string[]> = IS_TESTNET
  ? {
      [CHAIN_IDS.ethereum]: ['https://sepolia.drpc.org', 'https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.ankr.com/eth_sepolia'],
      [CHAIN_IDS.optimism]: ['https://sepolia.optimism.io', 'https://optimism-sepolia.drpc.org', 'https://rpc.ankr.com/optimism_sepolia'],
      [CHAIN_IDS.base]: ['https://sepolia.base.org', 'https://base-sepolia.drpc.org', 'https://rpc.ankr.com/base_sepolia'],
      [CHAIN_IDS.arbitrum]: ['https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia.drpc.org', 'https://rpc.ankr.com/arbitrum_sepolia'],
    }
  : {
      [CHAIN_IDS.ethereum]: ['https://ethereum.publicnode.com', 'https://eth.drpc.org', 'https://rpc.ankr.com/eth'],
      [CHAIN_IDS.optimism]: ['https://optimism.publicnode.com', 'https://mainnet.optimism.io', 'https://rpc.ankr.com/optimism'],
      [CHAIN_IDS.base]: ['https://base.publicnode.com', 'https://mainnet.base.org', 'https://rpc.ankr.com/base'],
      [CHAIN_IDS.arbitrum]: ['https://arbitrum-one.publicnode.com', 'https://arb1.arbitrum.io/rpc', 'https://rpc.ankr.com/arbitrum'],
    }

export type SupportedChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS]

// Mainnet chain IDs (always available, even in staging mode for cross-network queries)
export const MAINNET_CHAIN_IDS = {
  ethereum: 1,
  optimism: 10,
  base: 8453,
  arbitrum: 42161,
} as const

// Mainnet viem chain configs (always available for on-chain reads of mainnet data in staging)
export const MAINNET_VIEM_CHAINS = {
  [MAINNET_CHAIN_IDS.ethereum]: mainnet,
  [MAINNET_CHAIN_IDS.optimism]: optimism,
  [MAINNET_CHAIN_IDS.base]: base,
  [MAINNET_CHAIN_IDS.arbitrum]: arbitrum,
} as const

// Mainnet RPC endpoints (always available for on-chain reads of mainnet data in staging)
export const MAINNET_RPC_ENDPOINTS: Record<number, string[]> = {
  [MAINNET_CHAIN_IDS.ethereum]: ['https://ethereum.publicnode.com', 'https://eth.drpc.org', 'https://rpc.ankr.com/eth'],
  [MAINNET_CHAIN_IDS.optimism]: ['https://optimism.publicnode.com', 'https://mainnet.optimism.io', 'https://rpc.ankr.com/optimism'],
  [MAINNET_CHAIN_IDS.base]: ['https://base.publicnode.com', 'https://mainnet.base.org', 'https://rpc.ankr.com/base'],
  [MAINNET_CHAIN_IDS.arbitrum]: ['https://arbitrum-one.publicnode.com', 'https://arb1.arbitrum.io/rpc', 'https://rpc.ankr.com/arbitrum'],
}

// USDC contract addresses per chain
// Testnet uses test USDC tokens (may need faucet or minting)
export const USDC_ADDRESSES: Record<SupportedChainId, `0x${string}`> = IS_TESTNET
  ? {
      [CHAIN_IDS.ethereum]: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // Sepolia USDC
      [CHAIN_IDS.optimism]: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7', // OP Sepolia USDC
      [CHAIN_IDS.base]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia USDC
      [CHAIN_IDS.arbitrum]: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // Arb Sepolia USDC
    }
  : {
      [CHAIN_IDS.ethereum]: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      [CHAIN_IDS.optimism]: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      [CHAIN_IDS.base]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      [CHAIN_IDS.arbitrum]: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    }

// =============================================================================
// JUICEBOX V6 CONTRACTS
// =============================================================================
// V6 ships ONE contract set. Every core contract has the SAME address on all
// 8 supported chains (ethereum, optimism, base, arbitrum + their sepolias),
// so contract addresses need no IS_TESTNET switches. Only RPCs, chain IDs,
// and USDC addresses remain environment-dependent.
// =============================================================================

export const JB_CONTRACTS = {
  JBController: '0x3fcec3572e84b624477bcff4e2cf1f7deab648f1' as `0x${string}`,
  JBMultiTerminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53' as `0x${string}`,
  JBRulesets: '0x26f2228a4e8b0079ed1c2a3d22f12ff7f83cdfba' as `0x${string}`,
  JBTerminalStore: '0x7497ae014a60561925b51c0a3b4ade7460b9927c' as `0x${string}`,
  JBTokens: '0x1f80d8f057ee36b4c2656d107e4e4558b71ba7d9' as `0x${string}`,
  JBProjects: '0x6017d1fba9dc279bfa0b03fd931c22e242ab3691' as `0x${string}`,
  JBDirectory: '0x5aff29060e023e6fb87be5596652b33c65af535b' as `0x${string}`,
  JBSplits: '0x28b3d11fcb8d2ad0a143c5b193cd9f2e4d43f4c3' as `0x${string}`,
  JBFundAccessLimits: '0xc93360158f187fc8fc8f1062a1b31d06f185dbab' as `0x${string}`,
  JBPermissions: '0xf92ac1ab5a00033e35a3975739124f61928c36b0' as `0x${string}`,
  JBPrices: '0xad45e4627f068d1e6b21e5301870d807543a8401' as `0x${string}`,
  JBFeelessAddresses: '0x657d0e588fca6f8c49394c9ca8a1cf6505b10314' as `0x${string}`,
  JBHeldFees: '0x62e77076b6e902e7aec8b2925acc9b46058e3d38' as `0x${string}`,
} as const

// REVDeployer contract address (same on all chains)
// Deploys revnets. In V6, revnet project NFTs are owned by the singleton
// REVOwner contract (not the deployer itself).
export const REV_DEPLOYER = '0xb552eb94284f94b833837d4b2cbb237128415d4e' as `0x${string}`

// REVOwner - singleton owner of all V6 revnet project NFTs.
// Exposes tiered721HookOf(revnetId) and operator checks.
export const REV_OWNER = '0x2ba4705ad0332cdfb299b452068438bcba3faaf3' as `0x${string}`

// REVLoans - revnet loans (same on all chains)
export const REV_LOANS = '0x056265c31157748818f0910d1859acd2f7d427de' as `0x${string}`

// 721 Hook Contracts (same address on all chains)
export const JB721_CONTRACTS = {
  // JB721TiersHookStore - stores tier data for all 721 hooks
  JB721TiersHookStore: '0x69913acf79dbba170d9efafe605ee62b42164f9c' as `0x${string}`,
  // JB721TiersHookDeployer - deploys new 721 hooks
  JB721TiersHookDeployer: '0xb7b8ec35e2dd84afff04ee769c6189e7a4d44a78' as `0x${string}`,
  // JB721TiersHookProjectDeployer - launches projects with a 721 hook
  JB721TiersHookProjectDeployer: '0x3ffdc94e7f1de4b74c52158ec9dd3b965585f451' as `0x${string}`,
} as const

// Zero address constant
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`

// =============================================================================
// ROUTER TERMINAL (replaces JBSwapTerminal in V6)
// =============================================================================
// JBSwapTerminal does not exist in V6. Its replacement is JBRouterTerminal +
// JBRouterTerminalRegistry: a universal payment terminal that accepts any
// token and converts it into whatever token the project accepts, plus a
// forwarding registry that lets each project choose which router terminal
// receives its payments.
//
// Both have the SAME address on every chain — no per-chain or ETH/USDC
// variants like the old swap terminals.
//
// When configuring project terminals, register the REGISTRY with empty
// accountingContextsToAccept (it delegates per-project); route "pay with a
// token the project doesn't accept" payments through the registry.

export const JB_ROUTER_TERMINAL = '0x0fbcbb3d10c8f524840d74ef81c1a9f161c418d7' as `0x${string}`
export const JB_ROUTER_TERMINAL_REGISTRY = '0xe0427f250fdb0379c8e98e884ee4570521208cbc' as `0x${string}`

// =============================================================================
// BUYBACK HOOK (same address on all chains in V6)
// =============================================================================

export const JB_BUYBACK_HOOK = '0x77bee1ad2ac0ace98a9b5b58d75685c8b4d94948' as `0x${string}`
export const JB_BUYBACK_HOOK_REGISTRY = '0x72f55a54cd53410a5ff175508a5a384227081788' as `0x${string}`

// =============================================================================
// SUCKER CONTRACTS (Cross-Chain Token Bridging)
// =============================================================================
// Suckers enable token bridging between chains for the same project.
// After deploying a project on multiple chains, deploy suckers to link them.

// JBSuckerRegistry - manages sucker deployments and mappings (same address on all chains)
export const JB_SUCKER_REGISTRY = '0x7903a854ae91eaf635430d120a1a434085cef297' as `0x${string}`

// Native-bridge sucker deployers (same address wherever deployed).
// Each deployer creates suckers for a specific bridge (OP Messenger, Arbitrum
// Gateway, etc.) connecting an L2 with Ethereum L1.
export const SUCKER_DEPLOYERS = {
  // JBArbitrumSuckerDeployer (Ethereum <-> Arbitrum)
  ARBSuckerDeployer: '0xa12ebfca3d4e0810e4ed174e4c08277c26917acb' as `0x${string}`,
  // JBOptimismSuckerDeployer (Ethereum <-> Optimism)
  OPSuckerDeployer: '0x298a775c030adcedb641a89d9047ec9972674e1a' as `0x${string}`,
  // JBBaseSuckerDeployer (Ethereum <-> Base)
  BaseSuckerDeployer: '0x54140331902de5c3445eb0c26e15099a5a9d59e6' as `0x${string}`,
} as const

// Map chains to their preferred native-bridge sucker deployer (for L1<->L2 pairs).
// L2<->L2 pairs use the CCIP deployers in utils/suckerConfig.ts.
export const CHAIN_SUCKER_DEPLOYER: Record<SupportedChainId, `0x${string}`> = {
  [CHAIN_IDS.ethereum]: SUCKER_DEPLOYERS.OPSuckerDeployer, // Ethereum - hub, supports all
  [CHAIN_IDS.optimism]: SUCKER_DEPLOYERS.OPSuckerDeployer, // Optimism - OP Stack
  [CHAIN_IDS.base]: SUCKER_DEPLOYERS.BaseSuckerDeployer, // Base - OP Stack
  [CHAIN_IDS.arbitrum]: SUCKER_DEPLOYERS.ARBSuckerDeployer, // Arbitrum - Arbitrum Gateway
}

// =============================================================================
// OMNICHAIN PROJECT DEPLOYER
// =============================================================================
// Deploy projects on multiple chains with a single transaction

// JBOmnichainDeployer - deploys projects on all chains at once (same address on all chains)
export const JB_OMNICHAIN_DEPLOYER = '0xb853758a70a6b4216c09f1d071ea2344aba0a34f' as `0x${string}`
