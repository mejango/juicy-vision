/**
 * V5.1 Contract Addresses sub-module (~600 tokens)
 * Hints: deploy, launch, create project, new project
 */

export const V51_ADDRESSES_CONTEXT = `
### V5.1 Contracts (New Projects)

| Contract | Address |
|----------|---------|
| JBController5_1 | 0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1 |
| JBMultiTerminal5_1 | 0x52869db3d61dde1e391967f2ce5039ad0ecd371c |
| JBRulesets5_1 | 0xd4257005ca8d27bbe11f356453b0e4692414b056 |
| JBTerminalStore5_1 | 0x82239c5a21f0e09573942caa41c580fa36e27071 |
| JBOmnichainDeployer5_1 | 0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71 |
| JB721TiersHookDeployer5_1 | 0x7e6e7db5081c59f2df3c83b54eb0c4d029e9898e |

### Shared Contracts (Both Versions)

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

**Version Rules:** V5.0 and V5.1 NEVER mix. V5.1 project = V5.1 terminal. V5.0 project = V5.0 terminal.

**Determine version:** Query JBDirectory.controllerOf(projectId):
- Returns 0x27da30646502e2f642be5281322ae8c394f7668a → V5.0
- Returns 0xf3cc99b11bd73a2e3b8815fb85fe0381b29987e1 → V5.1
`;

export const V51_ADDRESSES_HINTS = [
  'deploy', 'launch', 'create project', 'new project', 'start project',
  'v5.1', 'controller', 'terminal address', 'contract address'
];

export const V51_ADDRESSES_TOKEN_ESTIMATE = 600;
