/**
 * V5.0 Contract Addresses sub-module (~600 tokens)
 * Hints: revnet, REVDeployer, autonomous, existing project
 */

export const V5_ADDRESSES_CONTEXT = `
### V5 Contracts (Revnets)

| Contract | Address |
|----------|---------|
| JBController | 0x27da30646502e2f642be5281322ae8c394f7668a |
| JBMultiTerminal | 0x2db6d704058e552defe415753465df8df0361846 |
| JBRulesets | 0x6292281d69c3593fcf6ea074e5797341476ab428 |
| REVDeployer | 0x2ca27bde7e7d33e353b44c27acfcf6c78dde251d |
| JB721TiersHookDeployer | 0x7e4f7bfeab74bbae3eb12a62f2298bf2be16fc93 |

Note: Owner === REVDeployer means revnet (always V5.0), but some non-revnet projects also use V5.0.

### CCIP Sucker Deployers

| From → To | Deployer |
|-----------|----------|
| Ethereum → Optimism | 0x34B40205B249e5733CF93d86B7C9783b015dD3e7 |
| Ethereum → Base | 0xdE901EbaFC70d545F9D43034308C136Ce8c94A5C |
| Ethereum → Arbitrum | 0x9d4858cc9d3552507EEAbce722787AfEf64C615e |
| Optimism → Ethereum | 0x34B40205B249e5733CF93d86B7C9783b015dD3e7 |
| Optimism → Arbitrum | 0x39132eA75B9eaE5CBfF7BA1997C804302a7fF413 |
| Optimism → Base | 0xb825F2f6995966eB6dD772a8707D4A547028Ac26 |
| Base → Ethereum | 0xdE901EbaFC70d545F9D43034308C136Ce8c94A5C |
| Base → Optimism | 0xb825F2f6995966eB6dD772a8707D4A547028Ac26 |
| Base → Arbitrum | 0x3D7Fb0aa325aD5D2349274f9eF33D4424135d963 |
| Arbitrum → Ethereum | 0x9d4858cc9d3552507EEAbce722787AfEf64C615e |
| Arbitrum → Optimism | 0x39132eA75B9eaE5CBfF7BA1997C804302a7fF413 |
| Arbitrum → Base | 0x3D7Fb0aa325aD5D2349274f9eF33D4424135d963 |

| Other | Address |
|-------|---------|
| JBSuckerRegistry | 0x696c7e794fe2a7c2e3b7da4ae91733345fc1bf68 |
| JBBuybackHook | 0xfe9c4f3e5c27ffd8ee523c6ca388aaa95692c25d |
`;

export const V5_ADDRESSES_HINTS = [
  'revnet', 'autonomous', 'REVDeployer', 'v5.0', 'v5 project',
  'sucker', 'bridge', 'cross-chain', 'buyback hook'
];

export const V5_ADDRESSES_TOKEN_ESTIMATE = 600;
