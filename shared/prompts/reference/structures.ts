/**
 * Struct Definitions Reference Module (~600 tokens)
 * Single source of truth for all Juicebox struct definitions
 * Hints: struct, JBRulesetConfig, JBSplit, JBTerminalConfig
 */

export const STRUCTURES_CONTEXT = `
### Struct Definitions

**JBRulesetConfig:**
\`\`\`
{ mustStartAtOrAfter: uint48, duration: uint32, weight: uint112, weightCutPercent: uint32,
  approvalHook: address, metadata: JBRulesetMetadata, splitGroups: JBSplitGroup[], fundAccessLimitGroups: JBFundAccessLimitGroup[] }
\`\`\`
Scales: weight is 18-decimal fixed point (1 = sentinel: inherit the decayed weight; 0 = no issuance); weightCutPercent out of 1_000_000_000.

**JBRulesetMetadata:**
\`\`\`
{ reservedPercent: uint16, cashOutTaxRate: uint16, baseCurrency: uint32, pausePay: bool,
  pauseCreditTransfers: bool, allowOwnerMinting: bool, allowSetCustomToken: bool,
  allowTerminalMigration: bool, allowSetTerminals: bool, allowSetController: bool,
  allowAddAccountingContext: bool, allowAddPriceFeed: bool, ownerMustSendPayouts: bool,
  holdFees: bool, scopeCashOutsToLocalBalances: bool, useDataHookForPay: bool,
  useDataHookForCashOut: bool, dataHook: address, metadata: uint16 }
\`\`\`
Scales: reservedPercent and cashOutTaxRate out of 10_000; metadata has only 14 usable bits (upper 2 masked). Reads return metadata packed into a single uint256, not this struct.

**JBSplitGroup:** \`{ groupId: uint256, splits: JBSplit[] }\`

**JBSplit:** \`{ percent: uint32 (of 1B), projectId: uint64, beneficiary: address, preferAddToBalance: bool, lockedUntil: uint48, hook: address }\`

**JBFundAccessLimitGroup:** \`{ terminal: address, token: address, payoutLimits: JBCurrencyAmount[], surplusAllowances: JBCurrencyAmount[] }\`

**JBCurrencyAmount:** \`{ amount: uint224, currency: uint32 }\`

**JBTerminalConfig:** \`{ terminal: address, accountingContextsToAccept: JBAccountingContext[] }\`

**JBAccountingContext:** \`{ token: address, decimals: uint8, currency: uint32 }\`

**JBSuckerDeploymentConfig:** \`{ deployerConfigurations: JBSuckerDeployerConfig[], salt: bytes32 }\`

**JBSuckerDeployerConfig:** \`{ deployer: address, peer: bytes32, mappings: JBTokenMapping[] }\` (peer = zero bytes32 for the default same-address peer sucker)

**JBTokenMapping:** \`{ localToken: address, minGas: uint32, remoteToken: bytes32 }\` (remoteToken = remote token address left-padded to 32 bytes; NO minBridgeAmount in V6; minGas >= 200_000 for ERC-20 mappings)

**JB721TierConfig (V6):**
\`\`\`
{ price: uint104, initialSupply: uint32, votingUnits: uint32, reserveFrequency: uint16,
  reserveBeneficiary: address, encodedIpfsUri: bytes32, category: uint24, discountPercent: uint8,
  flags: JB721TierConfigFlags, splitPercent: uint32, splits: JBSplit[] }
\`\`\`

**JB721TierConfigFlags:** \`{ allowOwnerMint: bool, useReserveBeneficiaryAsDefault: bool, transfersPausable: bool, useVotingUnits: bool, cantBeRemoved: bool, cantIncreaseDiscountPercent: bool, cantBuyWithCredits: bool }\`

\`discountPercent\` uses a denominator of 200 (20% off = 40 onchain), and tiers must be sorted by category. \`initialSupply\` "unlimited" is the convention 999_999_999 — 0 and uint32 max both revert.

**JB721InitTiersConfig:** \`{ tiers: JB721TierConfig[], currency: uint32, decimals: uint8 }\`

**JBDeploy721TiersHookConfig:**
\`\`\`
{ name: string, symbol: string, baseUri: string, tokenUriResolver: address,
  contractUri: string, tiersConfig: JB721InitTiersConfig, flags: JB721TiersHookFlags }
\`\`\`

**JB721TiersHookFlags:** \`{ noNewTiersWithReserves: bool, noNewTiersWithVotes: bool, noNewTiersWithOwnerMinting: bool, preventOverspending: bool, issueTokensForSplits: bool }\`

**JBLaunchProjectConfig:** \`{ projectUri: string, rulesetConfigurations: JBPayDataHookRulesetConfig[], terminalConfigurations: JBTerminalConfig[], memo: string }\`
(JBPayDataHookRulesetConfig = JBRulesetConfig minus the metadata fields the 721 hook owns; the hook fills dataHook/useDataHookForPay itself.)

**JBPermissionsData:** \`{ operator: address, projectId: uint64, permissionIds: uint8[] }\` — setPermissionsFor REPLACES the operator's whole permission set; always include existing IDs to keep.
`;

export const STRUCTURES_HINTS = [
  'struct',
  'JBRulesetConfig',
  'JBSplit',
  'JBTerminalConfig',
  'JBRulesetMetadata',
  'JBFundAccessLimitGroup',
  'JBAccountingContext',
  'JB721TierConfig',
  'JBDeploy721TiersHookConfig',
  'JBSuckerDeploymentConfig',
];

export const STRUCTURES_TOKEN_ESTIMATE = 700;
