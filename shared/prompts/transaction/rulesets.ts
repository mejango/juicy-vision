/**
 * Ruleset Configuration sub-module (~1000 tokens)
 * Hints: ruleset, weight, duration, reserved, metadata
 */

export const RULESETS_CONTEXT = `
### Ruleset Configuration

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

**Standard metadata template:**
\`\`\`json
{"reservedPercent": 0, "cashOutTaxRate": 0, "baseCurrency": 2, "pausePay": false, "pauseCreditTransfers": false, "allowOwnerMinting": false, "allowSetCustomToken": true, "allowTerminalMigration": true, "allowSetTerminals": true, "allowSetController": true, "allowAddAccountingContext": true, "allowAddPriceFeed": true, "ownerMustSendPayouts": false, "holdFees": false, "useTotalSurplusForCashOuts": false, "useDataHookForPay": false, "useDataHookForCashOut": false, "dataHook": "0x0000000000000000000000000000000000000000", "metadata": 0}
\`\`\`

**IMPORTANT: reservedPercent and cashOutTaxRate are uint16! Scale is 10000 = 100%:**
| Project's Cut | Supporters Get | reservedPercent |
|---------------|----------------|-----------------|
| 10% | 90% of tokens | 1000 |
| 20% | 80% of tokens | 2000 |
| 30% | 70% of tokens | 3000 |
| 50% | 50% of tokens | 5000 |

**mustStartAtOrAfter** = Use any integer (e.g., 0 or 1). The frontend automatically sets this to 5 minutes from when the user clicks "Launch Project".

**weight** = Tokens per currency unit (18 decimals). Standard: 1M tokens per dollar = "1000000000000000000000000"

**duration** = Ruleset length in seconds. 0 = no duration (runs until changed).

### queueRulesets (Update Project Rules)

**Use when:** User wants to change ruleset-based properties (fund access, issuance, splits, hooks, etc.)

**Ruleset changes are constrained by the CURRENT ruleset:**
- **duration**: If current ruleset has a duration, new ruleset can only start after current one ends
- **approvalHook**: If current ruleset has an approval hook (e.g., JBDeadline), new ruleset must be approved by it first

**Single-chain project:**
\`\`\`
action="queueRulesets"
contract="JBController5_1"
parameters: {
  "projectId": 123,
  "rulesetConfigurations": [/* new ruleset config */],
  "memo": "Updating project rules"
}
\`\`\`

**Omnichain project (MUST include per-chain projectIds):**
\`\`\`
action="queueRulesets"
contract="JBController5_1"
parameters: {
  "chainProjectMappings": [
    {"chainId": "1", "projectId": "<FROM_HISTORY_OR_BENDYSTRAW>"},
    {"chainId": "10", "projectId": "<FROM_HISTORY_OR_BENDYSTRAW>"}
  ],
  "rulesetConfigurations": [/* new ruleset config */],
  "memo": "Updating project rules"
}
\`\`\`
`;

export const RULESETS_HINTS = [
  'ruleset', 'weight', 'duration', 'reserved', 'metadata', 'issuance',
  'queue ruleset', 'update rules', 'change settings', 'weightCutPercent',
  'baseCurrency', 'pausePay', 'allowOwnerMinting'
];

export const RULESETS_TOKEN_ESTIMATE = 1000;
