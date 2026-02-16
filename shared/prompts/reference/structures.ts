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
  holdFees: bool, useTotalSurplusForCashOuts: bool, useDataHookForPay: bool,
  useDataHookForCashOut: bool, dataHook: address, metadata: uint16 }
\`\`\`

**JBSplitGroup:** \`{ groupId: uint256, splits: JBSplit[] }\`

**JBSplit:** \`{ percent: uint32 (of 1B), projectId: uint64, beneficiary: address, preferAddToBalance: bool, lockedUntil: uint48, hook: address }\`

**JBFundAccessLimitGroup:** \`{ terminal: address, token: address, payoutLimits: JBCurrencyAmount[], surplusAllowances: JBCurrencyAmount[] }\`

**JBCurrencyAmount:** \`{ amount: uint224, currency: uint32 }\`

**JBTerminalConfig:** \`{ terminal: address, accountingContextsToAccept: JBAccountingContext[] }\`

**JBAccountingContext:** \`{ token: address, decimals: uint8, currency: uint32 }\`

**JBSuckerDeploymentConfig:** \`{ deployerConfigurations: JBSuckerDeployerConfig[], salt: bytes32 }\`

**JBSuckerDeployerConfig:** \`{ deployer: address, mappings: JBTokenMapping[] }\`

**JBTokenMapping:** \`{ localToken: address, minGas: uint32, remoteToken: address, minBridgeAmount: uint256 }\`

**JB721TierConfig:**
\`\`\`
{ name: string, description: string, media: string, price: uint104, initialSupply: uint32,
  votingUnits: uint32, reserveFrequency: uint16, reserveBeneficiary: address,
  encodedIPFSUri: bytes32, category: uint24, discountPercent: uint8,
  allowOwnerMint: bool, useReserveBeneficiaryAsDefault: bool, transfersPausable: bool,
  useVotingUnits: bool, cannotBeRemoved: bool, cannotIncreaseDiscountPercent: bool }
\`\`\`

**JB721InitTiersConfig:** \`{ tiers: JB721TierConfig[], currency: uint32, decimals: uint8, prices: address }\`

**JBDeploy721TiersHookConfig:**
\`\`\`
{ name: string, symbol: string, baseUri: string, tokenUriResolver: address,
  contractUri: string, tiersConfig: JB721InitTiersConfig, reserveBeneficiary: address,
  flags: JB721TiersHookFlags }
\`\`\`

**JB721TiersHookFlags:** \`{ noNewTiersWithReserves: bool, noNewTiersWithVotes: bool, noNewTiersWithOwnerMinting: bool, preventOverspending: bool }\`

**JBLaunchProjectConfig:** \`{ projectUri: string, rulesetConfigurations: JBPayDataHookRulesetConfig[], terminalConfigurations: JBTerminalConfig[], memo: string }\`
`;

export const STRUCTURES_HINTS = [
  'struct', 'JBRulesetConfig', 'JBSplit', 'JBTerminalConfig',
  'JBRulesetMetadata', 'JBFundAccessLimitGroup', 'JBAccountingContext',
  'JB721TierConfig', 'JBDeploy721TiersHookConfig', 'JBSuckerDeploymentConfig'
];

export const STRUCTURES_TOKEN_ESTIMATE = 600;
