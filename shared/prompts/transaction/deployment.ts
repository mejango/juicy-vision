/**
 * Deployment Configuration sub-module (~800 tokens)
 * Hints: deploy, launch, create, omnichain, sucker
 */

export const DEPLOYMENT_CONTEXT = `
### Deployment Configuration

**CONTRACTS FOR DEPLOYMENT:**
- **launchProject / launch721Project → JBOmnichainDeployer** (0xb853758a70a6b4216c09f1d071ea2344aba0a34f, same address on every chain)
- **NEVER use JBMultiTerminal for deployment** - that's for payments only
- **NEVER use JBController for deployment** - use JBOmnichainDeployer instead

**Creation fee:** \`launchProjectFor\` (JBController, JBOmnichainDeployer) and \`REVDeployer.deployFor\` are payable and require \`msg.value == JBProjects.creationFee()\` EXACTLY (currently ≤ 0.001 ETH). The fee must be read from chain at execution time - never hardcode it. The frontend attaches it automatically.

**JBOmnichainDeployer.launchProjectFor signature:** \`(owner, projectUri, rulesetConfigurations, terminalConfigurations, memo, suckerDeploymentConfiguration)\` - there is NO trailing controller param. The 721 overload inserts a \`deploy721Config\` struct as the 3rd argument.

**NEVER USE these hallucinated field names:**
- ~~nftRewardsDeploymentConfiguration~~ → use \`deployTiersHookConfig\`
- ~~hooks~~ → use \`deployTiersHookConfig\`
- ~~projectUri~~ at top level → use \`launchProjectConfig.projectUri\`
- ~~rulesetConfigurations~~ at top level → use \`launchProjectConfig.rulesetConfigurations\`

**suckerDeploymentConfiguration** = Standard 4-chain config (from Ethereum, using the CCIP pair deployers):
\`\`\`json
{"deployerConfigurations": [
  {"deployer": "0x41d28bedd5b0fbf65424b48c0e1de92d5c882fc7", "peer": "0x0000000000000000000000000000000000000000000000000000000000000000", "mappings": [{"localToken": "0x000000000000000000000000000000000000EEEe", "minGas": 200000, "remoteToken": "0x000000000000000000000000000000000000000000000000000000000000EEEe"}]},
  {"deployer": "0x36a2e30029d87c46f77f71b7b6b97fec8a760660", "peer": "0x0000000000000000000000000000000000000000000000000000000000000000", "mappings": [{"localToken": "0x000000000000000000000000000000000000EEEe", "minGas": 200000, "remoteToken": "0x000000000000000000000000000000000000000000000000000000000000EEEe"}]},
  {"deployer": "0x3955fec11fe15f0be4dfa2b0153feef55d55e1ee", "peer": "0x0000000000000000000000000000000000000000000000000000000000000000", "mappings": [{"localToken": "0x000000000000000000000000000000000000EEEe", "minGas": 200000, "remoteToken": "0x000000000000000000000000000000000000000000000000000000000000EEEe"}]}
], "salt": "0x0000000000000000000000000000000000000000000000000000000000000001"}
\`\`\`
- **remoteToken** is bytes32: the remote token ADDRESS left-padded with zeros to 32 bytes
- **peer** = zero bytes32 to use the default deterministic peer (sucker has the same address on both chains)
- There is NO minBridgeAmount field in V6

**salt** = Non-zero bytes32 (e.g., 0x...01). NEVER all zeros.

**projectUri** = Real CID from pin_to_ipfs. NEVER placeholder. Call first, silently.

**Omnichain default:** Deploy all 4 chains unless user requests single-chain.

**chainId:** For multi-chain deployments, use chainId="1" (Ethereum) as the primary chain. NEVER use "undefined" or empty chainId.

**Struct Reference:**

**JBSuckerDeploymentConfig:** \`{ deployerConfigurations: JBSuckerDeployerConfig[], salt: bytes32 }\`

**JBSuckerDeployerConfig:** \`{ deployer: address, peer: bytes32, mappings: JBTokenMapping[] }\`

**JBTokenMapping:** \`{ localToken: address, minGas: uint32, remoteToken: bytes32 }\`

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
  'JBOmnichainDeployer', 'projectUri', 'salt', 'creation fee'
];

export const DEPLOYMENT_TOKEN_ESTIMATE = 800;
