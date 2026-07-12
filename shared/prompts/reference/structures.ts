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

**JBRulesetMetadata:**
\`\`\`
{ reservedPercent: uint16, cashOutTaxRate: uint16, baseCurrency: uint32, pausePay: bool,
  pauseCreditTransfers: bool, allowOwnerMinting: bool, allowSetCustomToken: bool,
  allowTerminalMigration: bool, allowSetTerminals: bool, allowSetController: bool,
  allowAddAccountingContext: bool, allowAddPriceFeed: bool, ownerMustSendPayouts: bool,
  holdFees: bool, scopeCashOutsToLocalBalances: bool, useDataHookForPay: bool,
  useDataHookForCashOut: bool, dataHook: address, metadata: uint16 }
\`\`\`

**JBSplitGroup:** \`{ groupId: uint256, splits: JBSplit[] }\`

**JBSplit:** \`{ percent: uint32 (of 1B), projectId: uint64, beneficiary: address, preferAddToBalance: bool, lockedUntil: uint48, hook: address }\`

**JBFundAccessLimitGroup:** \`{ terminal: address, token: address, payoutLimits: JBCurrencyAmount[], surplusAllowances: JBCurrencyAmount[] }\`

**JBCurrencyAmount:** \`{ amount: uint224, currency: uint32 }\`

**JBTerminalConfig:** \`{ terminal: address, accountingContextsToAccept: JBAccountingContext[] }\`

**JBAccountingContext:** \`{ token: address, decimals: uint8, currency: uint32 }\`

**JBSuckerDeploymentConfig:** \`{ deployerConfigurations: JBSuckerDeployerConfig[], salt: bytes32 }\`

**JBSuckerDeployerConfig:** \`{ deployer: address, peer: bytes32, mappings: JBTokenMapping[] }\` (peer = zero bytes32 for the default same-address peer sucker)

**JBTokenMapping:** \`{ localToken: address, minGas: uint32, remoteToken: bytes32 }\` (remoteToken = remote token address left-padded to 32 bytes; NO minBridgeAmount in V6)

**JB721TierConfig (V6):**
\`\`\`
{ price: uint104, initialSupply: uint32, votingUnits: uint32, reserveFrequency: uint16,
  reserveBeneficiary: address, encodedIpfsUri: bytes32, category: uint24, discountPercent: uint8,
  flags: JB721TierConfigFlags, splitPercent: uint32, splits: JBSplit[] }
\`\`\`

**JB721TierConfigFlags:** \`{ allowOwnerMint: bool, useReserveBeneficiaryAsDefault: bool, transfersPausable: bool, useVotingUnits: bool, cantBeRemoved: bool, cantIncreaseDiscountPercent: bool, cantBuyWithCredits: bool }\`

\`discountPercent\` uses a denominator of 200 (20% off = 40 onchain), and tiers must be sorted by category.

**JB721InitTiersConfig:** \`{ tiers: JB721TierConfig[], currency: uint32, decimals: uint8 }\`

**JBDeploy721TiersHookConfig:**
\`\`\`
{ name: string, symbol: string, baseUri: string, tokenUriResolver: address,
  contractUri: string, tiersConfig: JB721InitTiersConfig, flags: JB721TiersHookFlags }
\`\`\`

**JB721TiersHookFlags:** \`{ noNewTiersWithReserves: bool, noNewTiersWithVotes: bool, noNewTiersWithOwnerMinting: bool, preventOverspending: bool, issueTokensForSplits: bool }\`

**JBLaunchProjectConfig:** \`{ projectUri: string, rulesetConfigurations: JBPayDataHookRulesetConfig[], terminalConfigurations: JBTerminalConfig[], memo: string }\`
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

export const STRUCTURES_TOKEN_ESTIMATE = 600;
