/**
 * Terminal Configuration sub-module (~1200 tokens)
 * Hints: terminal, USDC, accountingContext, payment, accept
 */

export const TERMINALS_CONTEXT = `
### Router Terminal

Token conversion (paying with a token the project doesn't hold) is handled by **JBRouterTerminal**, resolved through **JBRouterTerminalRegistry**. Same address on every chain, for both ETH and USDC projects - no per-token variants.

| Contract | Address (same on every chain) |
|----------|-------------------------------|
| JBRouterTerminal | 0x0fbcbb3d10c8f524840d74ef81c1a9f161c418d7 |
| JBRouterTerminalRegistry | 0xe0427f250fdb0379c8e98e884ee4570521208cbc |

In terminalConfigurations, always use the REGISTRY (0xe042...8cbc) as the second terminal with empty accountingContextsToAccept - regardless of ETH vs USDC.

### USDC by Chain

| Chain | Address | Currency (uint32) |
|-------|---------|-------------------|
| Ethereum | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 | 909516616 |
| Optimism | 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85 | 3530704773 |
| Base | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 | 3169378579 |
| Arbitrum | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 | 1156540465 |

NATIVE_TOKEN: 0x000000000000000000000000000000000000EEEe, currency = 61166

**Currency in JBAccountingContext** = uint32(uint160(token)). **baseCurrency in metadata** = 1 (ETH) or 2 (USD).

### Terminal Configurations

**terminalConfigurations** = Two terminals with accounting context
- JBMultiTerminal: 0x130f5dd2bd8805443cf41755253d778a75a67f53 - **MUST include token in accountingContextsToAccept**
- JBRouterTerminalRegistry: 0xe0427f250fdb0379c8e98e884ee4570521208cbc - accountingContextsToAccept stays empty (registry handles it)

**Second terminal is ALWAYS the same, whatever the payment token:**
\`\`\`json
{"terminal": "0xe0427f250fdb0379c8e98e884ee4570521208cbc", "accountingContextsToAccept": []}
\`\`\`

**Choose the JBMultiTerminal accounting context based on payment token (default to USDC unless user explicitly wants native token):**

| User wants | JBMultiTerminal accountingContextsToAccept |
|------------|-------------------------------------------|
| USDC (default) | USDC token + decimals 6 + currency code |
| Native token | NATIVE_TOKEN + decimals 18 + currency 61166 |

**USDC example (default):**
\`\`\`json
{"terminal": "0x130f5dd2bd8805443cf41755253d778a75a67f53", "accountingContextsToAccept": [
  {"token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "decimals": 6, "currency": 909516616}
]}
\`\`\`
(Use chain-specific USDC address and currency code - see "USDC by Chain" section)

**Native token example (only if user explicitly requests):**
\`\`\`json
{"terminal": "0x130f5dd2bd8805443cf41755253d778a75a67f53", "accountingContextsToAccept": [
  {"token": "0x000000000000000000000000000000000000EEEe", "decimals": 18, "currency": 61166}
]}
\`\`\`

**Struct Reference:**

**JBTerminalConfig:** \`{ terminal: address, accountingContextsToAccept: JBAccountingContext[] }\`

**JBAccountingContext:** \`{ token: address, decimals: uint8, currency: uint32 }\`
`;

export const TERMINALS_HINTS = [
  'terminal', 'USDC', 'accountingContext', 'payment', 'accept payments',
  'router terminal', 'registry', 'currency', 'decimals', 'token address',
  'native token', 'ETH payments'
];

export const TERMINALS_TOKEN_ESTIMATE = 1200;
