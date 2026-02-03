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
      currency: 909516616,
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
      currency: 3530704773,
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
      currency: 3169378579,
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
      currency: 1156540465,
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
      currency: 909516616, // Same currency code, different address
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
      currency: 3530704773,
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
      currency: 3169378579,
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
      currency: 1156540465,
    },
    native: { symbol: 'ETH', decimals: 18 },
  },
};

// =============================================================================
// Contract Addresses (same on mainnet and testnet via CREATE2)
// =============================================================================

export const CONTRACTS = {
  // Shared contracts (both V5 and V5.1)
  JBProjects: '0x885f707efa18d2cb12f05a3a8eba6b4b26c8c1d4',
  JBTokens: '0x4d0edd347fb1fa21589c1e109b3474924be87636',
  JBDirectory: '0x0061e516886a0540f63157f112c0588ee0651dcf',
  JBSplits: '0x7160a322fea44945a6ef9adfd65c322258df3c5e',
  JBFundAccessLimits: '0x3a46b21720c8b70184b0434a2293b2fdcc497ce7',
  JBPermissions: '0xba948dab74e875b19cf0e2ca7a4546c0c2defc40',
  JBPrices: '0x6e92e3b5ce1e7a4344c6d27c0c54efd00df92fb6',
  JBFeelessAddresses: '0xf76f7124f73abc7c30b2f76121afd4c52be19442',

  // V5.1 contracts (new projects)
  JBController5_1: '0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1',
  JBMultiTerminal5_1: '0x52869db3d61dde1e391967f2ce5039ad0ecd371c',
  JBRulesets5_1: '0xd4257005ca8d27bbe11f356453b0e4692414b056',
  JBTerminalStore5_1: '0x82239c5a21f0e09573942caa41c580fa36e27071',
  JBOmnichainDeployer5_1: '0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71',
  JB721TiersHookDeployer5_1: '0x7e6e7db5081c59f2df3c83b54eb0c4d029e9898e',

  // V5 contracts (revnets)
  JBController: '0x27da30646502e2f642be5281322ae8c394f7668a',
  JBMultiTerminal: '0x2db6d704058e552defe415753465df8df0361846',
  JBRulesets: '0x6292281d69c3593fcf6ea074e5797341476ab428',
  REVDeployer: '0x2ca27bde7e7d33e353b44c27acfcf6c78dde251d',
  JB721TiersHookDeployer: '0x7e4f7bfeab74bbae3eb12a62f2298bf2be16fc93',

  // Swap terminal registries
  JBSwapTerminalUSDCRegistry: '0x1ce40d201cdec791de05810d17aaf501be167422',
  JBSwapTerminalRegistry: '0x60b4f5595ee509c4c22921c7b7999f1616e6a4f6',

  // Sucker registry
  JBSuckerRegistry: '0x696c7e794fe2a7c2e3b7da4ae91733345fc1bf68',
  JBBuybackHook: '0xfe9c4f3e5c27ffd8ee523c6ca388aaa95692c25d',
} as const;

// Native token address
export const NATIVE_TOKEN = '0x000000000000000000000000000000000000EEEe';
export const NATIVE_TOKEN_CURRENCY = 4008636142;

// =============================================================================
// Helper Functions
// =============================================================================

export function getChains(isTestnet: boolean): Record<string, ChainConfig> {
  return isTestnet ? TESTNET_CHAINS : MAINNET_CHAINS;
}

export function getChainById(chainId: number, isTestnet: boolean): ChainConfig | undefined {
  const chains = getChains(isTestnet);
  return Object.values(chains).find(c => c.id === chainId);
}

export function getAllChainIds(isTestnet: boolean): number[] {
  return Object.values(getChains(isTestnet)).map(c => c.id);
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
    .map(c => `| ${c.name} | ${c.id} | ${c.usdc.address} | ${c.usdc.currency} |`)
    .join('\n');

  return `| Chain | ID | USDC Address | Currency |
|-------|-----|--------------|----------|
${rows}`;
}

export function generateTerminalConfigExample(isTestnet: boolean, chainKey: string = 'ethereum'): string {
  const chains = getChains(isTestnet);
  const chain = chains[chainKey];
  if (!chain) throw new Error(`Unknown chain: ${chainKey}`);

  return JSON.stringify([
    {
      terminal: CONTRACTS.JBMultiTerminal5_1,
      accountingContextsToAccept: [{
        token: chain.usdc.address,
        decimals: 6,
        currency: chain.usdc.currency,
      }],
    },
    {
      terminal: CONTRACTS.JBSwapTerminalUSDCRegistry,
      accountingContextsToAccept: [],
    },
  ], null, 2);
}

export function generateChainConfigs(isTestnet: boolean): string {
  const chains = getChains(isTestnet);
  const configs = Object.values(chains).map(chain => ({
    chainId: String(chain.id),
    label: chain.name,
    overrides: {
      terminalConfigurations: [
        {
          terminal: CONTRACTS.JBMultiTerminal5_1,
          accountingContextsToAccept: [{
            token: chain.usdc.address,
            decimals: 6,
            currency: chain.usdc.currency,
          }],
        },
        {
          terminal: CONTRACTS.JBSwapTerminalUSDCRegistry,
          accountingContextsToAccept: [],
        },
      ],
    },
  }));

  return JSON.stringify(configs, null, 2);
}

export function generateOptionsPickerChains(isTestnet: boolean): string {
  const chains = getChains(isTestnet);
  const options = Object.values(chains).map(c => ({
    value: String(c.id),
    label: c.name,
    selected: true,
  }));

  return JSON.stringify(options);
}
