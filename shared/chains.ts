/**
 * Single source of truth for chain and contract configuration
 *
 * Used by both prompts and application code to ensure consistency.
 * Environment (mainnet/testnet) is determined at runtime.
 */

// =============================================================================
// Chain Configuration
// =============================================================================

export interface ChainConfig {
  id: number;
  name: string;
  shortName: string;
  explorer: string;
  usdc: {
    address: string;
    currency: number; // uint32(uint160(address))
  };
  native: {
    symbol: string;
    decimals: number;
  };
}

export const MAINNET_CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    id: 1,
    name: 'Ethereum',
    shortName: 'ETH',
    explorer: 'https://etherscan.io',
    usdc: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      currency: 906423112,
    },
    native: { symbol: 'ETH', decimals: 18 },
  },
  optimism: {
    id: 10,
    name: 'Optimism',
    shortName: 'OP',
    explorer: 'https://optimistic.etherscan.io',
    usdc: {
      address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      currency: 3499622277,
    },
    native: { symbol: 'ETH', decimals: 18 },
  },
  base: {
    id: 8453,
    name: 'Base',
    shortName: 'BASE',
    explorer: 'https://basescan.org',
    usdc: {
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      currency: 3181390099,
    },
    native: { symbol: 'ETH', decimals: 18 },
  },
  arbitrum: {
    id: 42161,
    name: 'Arbitrum',
    shortName: 'ARB',
    explorer: 'https://arbiscan.io',
    usdc: {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      currency: 646862897,
    },
    native: { symbol: 'ETH', decimals: 18 },
  },
};

export const TESTNET_CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    id: 11155111,
    name: 'Sepolia',
    shortName: 'SEP',
    explorer: 'https://sepolia.etherscan.io',
    usdc: {
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      currency: 932999736,
    },
    native: { symbol: 'ETH', decimals: 18 },
  },
  optimism: {
    id: 11155420,
    name: 'OP Sepolia',
    shortName: 'OP-SEP',
    explorer: 'https://sepolia-optimism.etherscan.io',
    usdc: {
      address: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
      currency: 3559993559,
    },
    native: { symbol: 'ETH', decimals: 18 },
  },
  base: {
    id: 84532,
    name: 'Base Sepolia',
    shortName: 'BASE-SEP',
    explorer: 'https://sepolia.basescan.org',
    usdc: {
      address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      currency: 2403192702,
    },
    native: { symbol: 'ETH', decimals: 18 },
  },
  arbitrum: {
    id: 421614,
    name: 'Arb Sepolia',
    shortName: 'ARB-SEP',
    explorer: 'https://sepolia.arbiscan.io',
    usdc: {
      address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      currency: 3460737613,
    },
    native: { symbol: 'ETH', decimals: 18 },
  },
};

// =============================================================================
// Contract Addresses (Juicebox V6 - same address on ALL chains, mainnet and testnet)
// =============================================================================

export const CONTRACTS = {
  // Core contracts
  JBController: '0x3fcec3572e84b624477bcff4e2cf1f7deab648f1',
  JBMultiTerminal: '0x130f5dd2bd8805443cf41755253d778a75a67f53',
  JBRulesets: '0x26f2228a4e8b0079ed1c2a3d22f12ff7f83cdfba',
  JBTerminalStore: '0x7497ae014a60561925b51c0a3b4ade7460b9927c',
  JBProjects: '0x6017d1fba9dc279bfa0b03fd931c22e242ab3691',
  JBTokens: '0x1f80d8f057ee36b4c2656d107e4e4558b71ba7d9',
  JBDirectory: '0x5aff29060e023e6fb87be5596652b33c65af535b',
  JBSplits: '0x28b3d11fcb8d2ad0a143c5b193cd9f2e4d43f4c3',
  JBFundAccessLimits: '0xc93360158f187fc8fc8f1062a1b31d06f185dbab',
  JBPermissions: '0xf92ac1ab5a00033e35a3975739124f61928c36b0',
  JBPrices: '0xad45e4627f068d1e6b21e5301870d807543a8401',
  JBFeelessAddresses: '0x657d0e588fca6f8c49394c9ca8a1cf6505b10314',
  JBHeldFees: '0x62e77076b6e902e7aec8b2925acc9b46058e3d38',

  // Deployers
  JBOmnichainDeployer: '0xb853758a70a6b4216c09f1d071ea2344aba0a34f',
  REVDeployer: '0xb552eb94284f94b833837d4b2cbb237128415d4e',
  REVOwner: '0x2ba4705ad0332cdfb299b452068438bcba3faaf3',
  REVLoans: '0x056265c31157748818f0910d1859acd2f7d427de',
  CTDeployer: '0xf21b8717cb50e497e90f375ec532557dd9022655',
  JB721TiersHookDeployer: '0xb7b8ec35e2dd84afff04ee769c6189e7a4d44a78',
  JB721TiersHookProjectDeployer: '0x3ffdc94e7f1de4b74c52158ec9dd3b965585f451',
  JB721TiersHookStore: '0x69913acf79dbba170d9efafe605ee62b42164f9c',

  // Router terminal (routes swaps into a project's accounting token)
  JBRouterTerminal: '0x0fbcbb3d10c8f524840d74ef81c1a9f161c418d7',
  JBRouterTerminalRegistry: '0xe0427f250fdb0379c8e98e884ee4570521208cbc',

  // Suckers + hooks
  JBSuckerRegistry: '0x7903a854ae91eaf635430d120a1a434085cef297',
  JBBuybackHook: '0x77bee1ad2ac0ace98a9b5b58d75685c8b4d94948',
  JBBuybackHookRegistry: '0x72f55a54cd53410a5ff175508a5a384227081788',
} as const;

// Native token address
export const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe';
export const NATIVE_TOKEN_CURRENCY = 61166;
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';

/** Canonical USDC address for every chain the app can inspect. */
export const CANONICAL_USDC_BY_CHAIN: Readonly<Record<number, string>> = Object.fromEntries(
  [...Object.values(MAINNET_CHAINS), ...Object.values(TESTNET_CHAINS)].map((chain) => [
    chain.id,
    chain.usdc.address,
  ]),
);

/** Every reviewed native-bridge and CCIP sucker deployer. */
export const SUCKER_DEPLOYERS = [
  '0xa12ebfca3d4e0810e4ed174e4c08277c26917acb',
  '0x298a775c030adcedb641a89d9047ec9972674e1a',
  '0x54140331902de5c3445eb0c26e15099a5a9d59e6',
  '0x41d28bedd5b0fbf65424b48c0e1de92d5c882fc7',
  '0x36a2e30029d87c46f77f71b7b6b97fec8a760660',
  '0x3955fec11fe15f0be4dfa2b0153feef55d55e1ee',
  '0x1d58d56fbdb753de44737be926c33b79cf009afa',
  '0x8f6f0a70939997310309d7ab66b1b199faafe7f0',
  '0x2845f919af9ed7d8dab188d42114bd590340a242',
] as const;

// =============================================================================
// Helper Functions
// =============================================================================

export function getChains(isTestnet: boolean): Record<string, ChainConfig> {
  return isTestnet ? TESTNET_CHAINS : MAINNET_CHAINS;
}

export function getChainById(chainId: number, isTestnet: boolean): ChainConfig | undefined {
  const chains = getChains(isTestnet);
  return Object.values(chains).find((c) => c.id === chainId);
}

export function getAllChainIds(isTestnet: boolean): number[] {
  return Object.values(getChains(isTestnet)).map((c) => c.id);
}

export function getPrimaryChainId(isTestnet: boolean): number {
  return isTestnet ? 11155111 : 1; // Sepolia or Ethereum mainnet
}

// =============================================================================
// Prompt Generation Helpers
// =============================================================================

export function generateChainTable(isTestnet: boolean): string {
  const chains = getChains(isTestnet);
  const rows = Object.values(chains)
    .map((c) => `| ${c.name} | ${c.id} | ${c.usdc.address} | ${c.usdc.currency} |`)
    .join('\n');

  return `| Chain | ID | USDC Address | Currency |
|-------|-----|--------------|----------|
${rows}`;
}

export function generateTerminalConfigExample(
  isTestnet: boolean,
  chainKey: string = 'ethereum',
): string {
  const chains = getChains(isTestnet);
  const chain = chains[chainKey];
  if (!chain) throw new Error(`Unknown chain: ${chainKey}`);

  return JSON.stringify(
    [
      {
        terminal: CONTRACTS.JBMultiTerminal,
        accountingContextsToAccept: [{
          token: chain.usdc.address,
          decimals: 6,
          currency: chain.usdc.currency,
        }],
      },
      {
        terminal: CONTRACTS.JBRouterTerminalRegistry,
        accountingContextsToAccept: [],
      },
    ],
    null,
    2,
  );
}

export function generateChainConfigs(isTestnet: boolean): string {
  const chains = getChains(isTestnet);
  const configs = Object.values(chains).map((chain) => ({
    chainId: String(chain.id),
    label: chain.name,
    overrides: {
      terminalConfigurations: [
        {
          terminal: CONTRACTS.JBMultiTerminal,
          accountingContextsToAccept: [{
            token: chain.usdc.address,
            decimals: 6,
            currency: chain.usdc.currency,
          }],
        },
        {
          terminal: CONTRACTS.JBRouterTerminalRegistry,
          accountingContextsToAccept: [],
        },
      ],
    },
  }));

  return JSON.stringify(configs, null, 2);
}

export function generateOptionsPickerChains(isTestnet: boolean): string {
  const chains = getChains(isTestnet);
  const options = Object.values(chains).map((c) => ({
    value: String(c.id),
    label: c.name,
    selected: true,
  }));

  return JSON.stringify(options);
}
