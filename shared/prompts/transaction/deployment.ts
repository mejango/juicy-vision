/**
 * Deployment Configuration sub-module (~800 tokens)
 * Hints: deploy, launch, create, omnichain, sucker
 */

export const DEPLOYMENT_CONTEXT = `
### Deployment Configuration

**CONTRACTS FOR DEPLOYMENT:**
- **launchProject / launch721Project → JBOmnichainDeployer5_1** (deploys across all chains)
- **NEVER use JBMultiTerminal5_1 for deployment** - that's for payments only
- **NEVER use JBController5_1 for deployment** - use JBOmnichainDeployer5_1 instead

**NEVER USE these hallucinated field names:**
- ~~nftRewardsDeploymentConfiguration~~ → use \`deployTiersHookConfig\`
- ~~hooks~~ → use \`deployTiersHookConfig\`
- ~~projectUri~~ at top level → use \`launchProjectConfig.projectUri\`
- ~~rulesetConfigurations~~ at top level → use \`launchProjectConfig.rulesetConfigurations\`

**suckerDeploymentConfiguration** = Standard 4-chain config:
\`\`\`json
{"deployerConfigurations": [
  {"deployer": "0x34B40205B249e5733CF93d86B7C9783b015dD3e7", "mappings": [{"localToken": "0x000000000000000000000000000000000000EEEe", "remoteToken": "0x000000000000000000000000000000000000EEEe", "minGas": 200000, "minBridgeAmount": "10000000000000000"}]},
  {"deployer": "0xdE901EbaFC70d545F9D43034308C136Ce8c94A5C", "mappings": [{"localToken": "0x000000000000000000000000000000000000EEEe", "remoteToken": "0x000000000000000000000000000000000000EEEe", "minGas": 200000, "minBridgeAmount": "10000000000000000"}]},
  {"deployer": "0x9d4858cc9d3552507EEAbce722787AfEf64C615e", "mappings": [{"localToken": "0x000000000000000000000000000000000000EEEe", "remoteToken": "0x000000000000000000000000000000000000EEEe", "minGas": 200000, "minBridgeAmount": "10000000000000000"}]}
], "salt": "0x0000000000000000000000000000000000000000000000000000000000000001"}
\`\`\`

**salt** = Non-zero bytes32 (e.g., 0x...01). NEVER all zeros.

**projectUri** = Real CID from pin_to_ipfs. NEVER placeholder. Call first, silently.

**Omnichain default:** Deploy all 4 chains unless user requests single-chain.

**chainId:** For multi-chain deployments, use chainId="1" (Ethereum) as the primary chain. NEVER use "undefined" or empty chainId.

**Struct Reference:**

**JBSuckerDeploymentConfig:** \`{ deployerConfigurations: JBSuckerDeployerConfig[], salt: bytes32 }\`

**JBSuckerDeployerConfig:** \`{ deployer: address, mappings: JBTokenMapping[] }\`

**JBTokenMapping:** \`{ localToken: address, minGas: uint32, remoteToken: address, minBridgeAmount: uint256 }\`

**JBLaunchProjectConfig (for 721 projects):**
\`{ projectUri: string, rulesetConfigurations: JBPayDataHookRulesetConfig[], terminalConfigurations: JBTerminalConfig[], memo: string }\`

### Omnichain Project IDs

**CRITICAL: Omnichain Projects Have DIFFERENT projectIds Per Chain**
- Each chain has its OWN projectId because each chain's JBProjects contract assigns the next available ID independently
- **You CANNOT guess, estimate, or derive one chain's projectId from another!** The IDs are completely unrelated across chains.
- **FIRST** check conversation history for a system message like "[SYSTEM: Project #N created... Per-chain projectIds: ...]" - this is the ground truth
- **IF NOT FOUND:** Query the per-chain projectIds from bendystraw/suckerGroups BEFORE generating any transaction
`;

export const DEPLOYMENT_HINTS = [
  'deploy', 'launch', 'create', 'omnichain', 'sucker', 'cross-chain',
  'all chains', 'multi-chain', 'suckerDeploymentConfiguration',
  'JBOmnichainDeployer', 'projectUri', 'salt'
];

export const DEPLOYMENT_TOKEN_ESTIMATE = 800;
