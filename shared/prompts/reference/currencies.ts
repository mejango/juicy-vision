/**
 * Currency Reference Module (~400 tokens)
 * Single source of truth for token currency codes
 * Hints: currency, groupId, USDC, ETH, token address
 */

export const CURRENCIES_CONTEXT = `
### Token Currency Codes

**⚠️ CRITICAL: currency (uint32) ≠ groupId (uint256) for most tokens!**

- **currency** (JBAccountingContext): \`uint32(uint160(tokenAddress))\` - lower 32 bits only
- **groupId** (JBSplitGroup): \`uint256(uint160(tokenAddress))\` - full 160-bit address as uint256

For NATIVE_TOKEN (0x...EEEe), these happen to be the same (61166) because the address fits in 32 bits.
For USDC and other tokens, they are DIFFERENT values!

**USDC by Chain:**
| Chain | Token Address | currency (uint32) | groupId (uint256) |
|-------|---------------|-------------------|-------------------|
| Ethereum | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 | 909516616 | 918893084697899778867092505822379350428204718920 |
| Optimism | 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85 | 3530704773 | 63677651975084090027219091430485431588927 |
| Base | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 | 3169378579 | 750055151264976176895681429887502848627 |
| Arbitrum | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 | 1156540465 | 1002219449704601020763871664628665988657 |

**Native Token (ETH):**
| Token | Token Address | currency (uint32) | groupId (uint256) |
|-------|---------------|-------------------|-------------------|
| Native ETH | 0x000000000000000000000000000000000000EEEe | 61166 | 61166 |

**baseCurrency in ruleset metadata:**
- 1 = ETH (price oracle uses ETH)
- 2 = USD (price oracle uses USD - default)

**Where to use which:**
- JBAccountingContext.currency → use uint32 currency code
- JBCurrencyAmount.currency → use uint32 currency code
- JBSplitGroup.groupId → use uint256 groupId (full address value)

⚠️ **Reserved token splits use groupId = 1** (JBSplitGroupIds.RESERVED_TOKENS), NOT a token address!
`;

export const CURRENCIES_HINTS = [
  'currency', 'groupId', 'USDC', 'ETH', 'token address',
  'currency code', 'uint160', 'native token', 'baseCurrency'
];

export const CURRENCIES_TOKEN_ESTIMATE = 400;
