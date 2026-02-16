/**
 * Contract Addresses Reference Module (~800 tokens)
 * Single source of truth for all contract addresses
 * Hints: address, contract, terminal, controller, deployer
 */

export const ADDRESSES_CONTEXT = `
### Contract Addresses

**V5.1 Contracts (New Projects):**
| Contract | Address |
|----------|---------|
| JBController5_1 | 0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1 |
| JBMultiTerminal5_1 | 0x52869db3d61dde1e391967f2ce5039ad0ecd371c |
| JBRulesets5_1 | 0xd4257005ca8d27bbe11f356453b0e4692414b056 |
| JBTerminalStore5_1 | 0x82239c5a21f0e09573942caa41c580fa36e27071 |
| JBOmnichainDeployer5_1 | 0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71 |
| JB721TiersHookDeployer5_1 | 0x7e6e7db5081c59f2df3c83b54eb0c4d029e9898e |

**V5.0 Contracts (Revnets):**
| Contract | Address |
|----------|---------|
| JBController | 0x27da30646502e2f642be5281322ae8c394f7668a |
| JBMultiTerminal | 0x2db6d704058e552defe415753465df8df0361846 |
| JBRulesets | 0x6292281d69c3593fcf6ea074e5797341476ab428 |
| REVDeployer | 0x2ca27bde7e7d33e353b44c27acfcf6c78dde251d |
| JB721TiersHookDeployer | 0x7e4f7bfeab74bbae3eb12a62f2298bf2be16fc93 |

**Shared Contracts (Both Versions):**
| Contract | Address |
|----------|---------|
| JBProjects | 0x885f707efa18d2cb12f05a3a8eba6b4b26c8c1d4 |
| JBTokens | 0x4d0edd347fb1fa21589c1e109b3474924be87636 |
| JBDirectory | 0x0061e516886a0540f63157f112c0588ee0651dcf |
| JBSplits | 0x7160a322fea44945a6ef9adfd65c322258df3c5e |
| JBFundAccessLimits | 0x3a46b21720c8b70184b0434a2293b2fdcc497ce7 |
| JBPermissions | 0xba948dab74e875b19cf0e2ca7a4546c0c54efc40 |
| JBPrices | 0x6e92e3b5ce1e7a4344c6d27c0c54efd00df92fb6 |
| JBFeelessAddresses | 0xf76f7124f73abc7c30b2f76121afd4c52be19442 |

**Swap Terminal Registries:**
| Registry | Address | Use |
|----------|---------|-----|
| JBSwapTerminalUSDCRegistry | 0x1ce40d201cdec791de05810d17aaf501be167422 | USDC projects |
| JBSwapTerminalRegistry | 0x60b4f5595ee509c4c22921c7b7999f1616e6a4f6 | ETH projects |

**CCIP Sucker Deployers:**
| From → To | Deployer |
|-----------|----------|
| Ethereum ↔ Optimism | 0x34B40205B249e5733CF93d86B7C9783b015dD3e7 |
| Ethereum ↔ Base | 0xdE901EbaFC70d545F9D43034308C136Ce8c94A5C |
| Ethereum ↔ Arbitrum | 0x9d4858cc9d3552507EEAbce722787AfEf64C615e |
| Optimism ↔ Arbitrum | 0x39132eA75B9eaE5CBfF7BA1997C804302a7fF413 |
| Optimism ↔ Base | 0xb825F2f6995966eB6dD772a8707D4A547028Ac26 |
| Base ↔ Arbitrum | 0x3D7Fb0aa325aD5D2349274f9eF33D4424135d963 |

**Other:**
| Contract | Address |
|----------|---------|
| JBSuckerRegistry | 0x696c7e794fe2a7c2e3b7da4ae91733345fc1bf68 |
| JBBuybackHook | 0xfe9c4f3e5c27ffd8ee523c6ca388aaa95692c25d |

**Version Rules:** V5.0 and V5.1 NEVER mix. V5.1 project = V5.1 terminal. V5.0 project = V5.0 terminal.

**Determine version:** Query JBDirectory.controllerOf(projectId):
- Returns 0x27da30646502e2f642be5281322ae8c394f7668a → V5.0
- Returns 0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1 → V5.1
`;

export const ADDRESSES_HINTS = [
  'address', 'contract', 'terminal', 'controller', 'deployer',
  'JBController', 'JBMultiTerminal', 'REVDeployer', 'sucker',
  'v5.0', 'v5.1', 'version', 'registry'
];

export const ADDRESSES_TOKEN_ESTIMATE = 800;
