/**
 * Chain configuration sub-module (~200 tokens)
 * Hints: chain, network, ethereum, optimism, base, arbitrum
 */

export const CHAINS_CONTEXT = `
### Chains

| Chain | ID | Explorer |
|-------|-----|----------|
| Ethereum | 1 | etherscan.io |
| Optimism | 10 | optimistic.etherscan.io |
| Base | 8453 | basescan.org |
| Arbitrum | 42161 | arbiscan.io |
`;

export const CHAINS_HINTS = [
  'chain', 'network', 'ethereum', 'optimism', 'base', 'arbitrum',
  'mainnet', 'which chain', 'what chain', 'explorer'
];

export const CHAINS_TOKEN_ESTIMATE = 200;
