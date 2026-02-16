/**
 * Splits and Fund Access Limits sub-module (~1500 tokens)
 * Hints: payout, split, withdraw, fund access, goal, surplus
 */

export const SPLITS_LIMITS_CONTEXT = `
### Fund Access Limits & Splits

**When the owner keeps control and has a funding goal, configure BOTH splits and payout limits!**

**Wallet placeholder:** Use \`"USER_WALLET"\` as the beneficiary address in splits - it gets automatically replaced with the user's actual wallet address at execution time. Never use a literal 0x address for the user.

**Splits - Always include 2.5% platform fee:**
\`\`\`json
"splitGroups": [{
  "groupId": "918893084697899778867092505822379350428204718920",
  "splits": [
    {"percent": 975000000, "projectId": 0, "beneficiary": "USER_WALLET", "preferAddToBalance": false, "lockedUntil": 0, "hook": "0x0000000000000000000000000000000000000000"},
    {"percent": 25000000, "projectId": 1, "beneficiary": "USER_WALLET", "preferAddToBalance": true, "lockedUntil": 0, "hook": "0x0000000000000000000000000000000000000000"}
  ]
}]
\`\`\`
Note: groupId for USDC on Ethereum = uint256(uint160(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48))
- First split: 97.5% to owner (projectId: 0, beneficiary: user's wallet)
- Second split: 2.5% to NANA (projectId: 1, beneficiary: user's wallet, preferAddToBalance: true) - user receives NANA tokens as the beneficiary
- **groupId**: See JBSplitGroup in Struct Reference

**CRITICAL: Only add split groups for tokens the project actually accepts!**
- If user only accepts USDC (default): ONLY include the USDC split group (use full uint256 groupId, not truncated currency)
- If user explicitly asks for ETH payments: add ETH split group (groupId: 61166) with SAME structure (97.5% owner + 2.5% Juicy)
- NEVER add an ETH split group if user didn't mention ETH payments
- NEVER use "revenue share percentage" as a split percent - that goes in reservedPercent, not splits
- Payout splits ALWAYS sum to 100% (975000000 + 25000000 = 1000000000)

**Payout Limits - Set to ceil(goal ÷ 0.975) so user gets their full goal after fee:**
\`\`\`json
"fundAccessLimitGroups": [{
  "terminal": "0x52869db3d61dde1e391967f2ce5039ad0ecd371c",
  "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "payoutLimits": [{"amount": "5129000000", "currency": 909516616}],
  "surplusAllowances": []
}]
\`\`\`
- **token** = must match what terminal accepts (USDC token address for USDC payments)
- **currency** = token's currency code (909516616 for Ethereum USDC)

| User Goal | Payout Limit (ceil(goal ÷ 0.975)) | Amount in 6 decimals |
|-----------|----------------------------------|---------------------|
| $1,000 | $1,026 | "1026000000" |
| $5,000 | $5,129 | "5129000000" |
| $10,000 | $10,257 | "10257000000" |
| $25,000 | $25,642 | "25642000000" |
| $50,000 | $51,283 | "51283000000" |
| Unlimited | max uint224 | "26959946667150639794667015087019630673637144422540572481103610249215" |

**IMPORTANT: Always round UP (ceil) so owner receives at least their full goal after the 2.5% fee.**

**Common mistakes:**
- Empty \`fundAccessLimitGroups\` = owner CANNOT withdraw any funds
- Missing 2.5% fee split = protocol doesn't get compensated
- Payout limit = exact goal = user only gets 97.5% of their goal after fee

**Struct Reference:**

**JBSplitGroup:** \`{ groupId: uint256, splits: JBSplit[] }\`

**JBSplitGroup groupId rules:**
- **Payout splits:** groupId = uint256(uint160(token)) - the FULL token address as uint256
  - USDC on Ethereum: 918893084697899778867092505822379350428204718920
  - USDC on Optimism: 63677651975084090027219091430485431588927
  - USDC on Base: 750055151264976176895681429887502848627
  - USDC on Arbitrum: 1002219449704601020763871664628665988657
  - Native ETH: 61166 (coincidentally same as currency because address fits in 32 bits)
- **Reserved token splits:** groupId = 1 (JBSplitGroupIds.RESERVED_TOKENS)

⚠️ groupId ≠ currency! currency is uint32 (truncated), groupId is uint256 (full address).
⚠️ Group 1 is ONLY for reserved token distribution, NEVER for payouts!

**JBSplit:** \`{ percent: uint32 (of 1B), projectId: uint64, beneficiary: address, preferAddToBalance: bool, lockedUntil: uint48, hook: address }\`

**JBFundAccessLimitGroup:** \`{ terminal: address, token: address, payoutLimits: JBCurrencyAmount[], surplusAllowances: JBCurrencyAmount[] }\`

**JBCurrencyAmount:** \`{ amount: uint224, currency: uint32 }\`
`;

export const SPLITS_LIMITS_HINTS = [
  'payout', 'split', 'withdraw', 'fund access', 'goal', 'surplus',
  'allowance', 'limit', 'fee', '2.5%', 'platform fee', 'beneficiary',
  'fundAccessLimitGroups', 'splitGroups', 'how much can withdraw'
];

export const SPLITS_LIMITS_TOKEN_ESTIMATE = 1500;
