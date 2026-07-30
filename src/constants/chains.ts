import { JB_CHAINS, type JBChainId } from '@bananapus/nana-sdk-core'
import type { Chain } from 'viem'
import { IS_TESTNET, IS_LOCAL_ONLY_BROWSER_TEST, CHAIN_IDS } from '../config/environment'
import {
  CONTRACTS,
  KNOWN_BUYBACK_HOOKS,
  MAINNET_CHAINS as SHARED_MAINNET_CHAINS,
  TESTNET_CHAINS as SHARED_TESTNET_CHAINS,
} from '../../shared/chains'

// =============================================================================
// CHAIN CONFIGURATION
// =============================================================================
// Environment-aware chain configuration. Uses Sepolia testnets when IS_TESTNET is true.

type SupportedChain<ChainId extends JBChainId> = Chain & { id: ChainId }

function supportedChain<const ChainId extends JBChainId>(
  chainId: ChainId,
): SupportedChain<ChainId> {
  return JB_CHAINS[chainId].chain as SupportedChain<ChainId>
}

export const mainnet = supportedChain(1)
export const optimism = supportedChain(10)
export const arbitrum = supportedChain(42161)
export const base = supportedChain(8453)
export const sepolia = supportedChain(11155111)
export const optimismSepolia = supportedChain(11155420)
export const arbitrumSepolia = supportedChain(421614)
export const baseSepolia = supportedChain(84532)

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
const LOCAL_ONLY_RPC_ENDPOINT = IS_LOCAL_ONLY_BROWSER_TEST && typeof window !== 'undefined'
  ? `${window.location.origin}/__juicy_test_rpc__`
  : null

function rpcEndpoints(...productionEndpoints: string[]): string[] {
  return LOCAL_ONLY_RPC_ENDPOINT ? [LOCAL_ONLY_RPC_ENDPOINT] : productionEndpoints
}

export const MAINNET_RPC_ENDPOINTS: Record<number, string[]> = {
  [MAINNET_CHAIN_IDS.ethereum]: rpcEndpoints('https://ethereum.publicnode.com', 'https://eth.drpc.org', 'https://rpc.ankr.com/eth'),
  [MAINNET_CHAIN_IDS.optimism]: rpcEndpoints('https://optimism.publicnode.com', 'https://mainnet.optimism.io', 'https://rpc.ankr.com/optimism'),
  [MAINNET_CHAIN_IDS.base]: rpcEndpoints('https://base.publicnode.com', 'https://mainnet.base.org', 'https://rpc.ankr.com/base'),
  [MAINNET_CHAIN_IDS.arbitrum]: rpcEndpoints('https://arbitrum-one.publicnode.com', 'https://arb1.arbitrum.io/rpc', 'https://rpc.ankr.com/arbitrum'),
}

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
      [CHAIN_IDS.ethereum]: rpcEndpoints('https://sepolia.drpc.org', 'https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.ankr.com/eth_sepolia'),
      [CHAIN_IDS.optimism]: rpcEndpoints('https://sepolia.optimism.io', 'https://optimism-sepolia.drpc.org', 'https://rpc.ankr.com/optimism_sepolia'),
      [CHAIN_IDS.base]: rpcEndpoints('https://sepolia.base.org', 'https://base-sepolia.drpc.org', 'https://rpc.ankr.com/base_sepolia'),
      [CHAIN_IDS.arbitrum]: rpcEndpoints('https://sepolia-rollup.arbitrum.io/rpc', 'https://arbitrum-sepolia.drpc.org', 'https://rpc.ankr.com/arbitrum_sepolia'),
    }
  : MAINNET_RPC_ENDPOINTS

export type SupportedChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS]

// USDC contract addresses per chain, derived from the shared canonical tables.
// Testnet uses test USDC tokens (may need faucet or minting).
export const USDC_ADDRESSES: Record<SupportedChainId, `0x${string}`> = Object.fromEntries(
  Object.values(IS_TESTNET ? SHARED_TESTNET_CHAINS : SHARED_MAINNET_CHAINS).map(chain => [
    chain.id,
    chain.usdc.address as `0x${string}`,
  ]),
) as Record<SupportedChainId, `0x${string}`>

// =============================================================================
// JUICEBOX V6 CONTRACTS
// =============================================================================
// V6 ships ONE contract set. Every core contract has the SAME address on all
// 8 supported chains (ethereum, optimism, base, arbitrum + their sepolias),
// so contract addresses need no IS_TESTNET switches. Only RPCs, chain IDs,
// and USDC addresses remain environment-dependent.
// =============================================================================

export const JB_CONTRACTS = {
  JBController: CONTRACTS.JBController as `0x${string}`,
  JBMultiTerminal: CONTRACTS.JBMultiTerminal as `0x${string}`,
  JBRulesets: CONTRACTS.JBRulesets as `0x${string}`,
  JBTerminalStore: CONTRACTS.JBTerminalStore as `0x${string}`,
  JBTokens: CONTRACTS.JBTokens as `0x${string}`,
  JBProjects: CONTRACTS.JBProjects as `0x${string}`,
  JBDirectory: CONTRACTS.JBDirectory as `0x${string}`,
  JBSplits: CONTRACTS.JBSplits as `0x${string}`,
  JBFundAccessLimits: CONTRACTS.JBFundAccessLimits as `0x${string}`,
  JBPermissions: CONTRACTS.JBPermissions as `0x${string}`,
  JBPrices: CONTRACTS.JBPrices as `0x${string}`,
  JBFeelessAddresses: CONTRACTS.JBFeelessAddresses as `0x${string}`,
  JBHeldFees: CONTRACTS.JBHeldFees as `0x${string}`,
} as const

// REVDeployer contract address (same on all chains)
// Deploys revnets. In V6, revnet project NFTs are owned by the singleton
// REVOwner contract (not the deployer itself).
export const REV_DEPLOYER = CONTRACTS.REVDeployer as `0x${string}`

// REVOwner - singleton owner of all V6 revnet project NFTs.
// Exposes tiered721HookOf(revnetId) and operator checks.
export const REV_OWNER = CONTRACTS.REVOwner as `0x${string}`

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

export const JB_ROUTER_TERMINAL = CONTRACTS.JBRouterTerminal as `0x${string}`
export const JB_ROUTER_TERMINAL_REGISTRY = CONTRACTS.JBRouterTerminalRegistry as `0x${string}`

// =============================================================================
// BUYBACK HOOK (same address on all chains in V6)
// =============================================================================

export const JB_BUYBACK_HOOK = CONTRACTS.JBBuybackHook as `0x${string}`
export const JB_BUYBACK_HOOK_REGISTRY = CONTRACTS.JBBuybackHookRegistry as `0x${string}`

// Known-good buyback hook SET (current + pre-upgrade instance the registry can
// pin projects to). Use for recognition/receipt checks; new routing always
// targets JB_BUYBACK_HOOK, the chain's canonical hook.
export const JB_BUYBACK_HOOKS = KNOWN_BUYBACK_HOOKS as readonly `0x${string}`[]

// =============================================================================
// SUCKER CONTRACTS (Cross-Chain Token Bridging)
// =============================================================================
// Suckers enable token bridging between chains for the same project.
// After deploying a project on multiple chains, deploy suckers to link them.

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
export const JB_OMNICHAIN_DEPLOYER = CONTRACTS.JBOmnichainDeployer as `0x${string}`
