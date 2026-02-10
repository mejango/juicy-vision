/**
 * Terminal Configuration sub-module (~1200 tokens)
 * Hints: terminal, USDC, accountingContext, payment, accept
 */

export const TERMINALS_CONTEXT = `
### Swap Terminals

**NEVER use JBSwapTerminal directly** - different addresses per chain, never use any.

| Registry | Address | Use |
|----------|---------|-----|
| JBSwapTerminalUSDCRegistry | 0x1ce40d201cdec791de05810d17aaf501be167422 | USDC projects |
| JBSwapTerminalRegistry | 0x60b4f5595ee509c4c22921c7b7999f1616e6a4f6 | ETH projects |

### USDC by Chain

| Chain | Address | Currency (uint32) |
|-------|---------|-------------------|
| Ethereum | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 | 909516616 |
| Optimism | 0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85 | 3530704773 |
| Base | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 | 3169378579 |
| Arbitrum | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 | 1156540465 |

NATIVE_TOKEN: 0x000000000000000000000000000000000000EEEe, currency = 4008636142

**Currency in JBAccountingContext** = uint32(uint160(token)). **baseCurrency in metadata** = 1 (ETH) or 2 (USD).

### Terminal Configurations

**terminalConfigurations** = Two terminals with accounting context
- JBMultiTerminal5_1: 0x52869db3d61dde1e391967f2ce5039ad0ecd371c - **MUST include token in accountingContextsToAccept**
- Swap terminal registry (see below) - accountingContextsToAccept stays empty (registry handles it)
- NEVER JBSwapTerminal directly

**Choose based on payment token (default to USDC unless user explicitly wants native token):**

| User wants | JBMultiTerminal accountingContextsToAccept | Swap Terminal Registry |
|------------|-------------------------------------------|------------------------|
| USDC (default) | USDC token + decimals 6 + currency code | JBSwapTerminalUSDCRegistry (0x1ce4...1422) |
| Native token | NATIVE_TOKEN + decimals 18 + currency 61166 | JBSwapTerminalRegistry (0x60b4...6a4f6) |

**USDC example (default):**
\`\`\`json
{"terminal": "0x52869db3d61dde1e391967f2ce5039ad0ecd371c", "accountingContextsToAccept": [
  {"token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "decimals": 6, "currency": 909516616}
]}
\`\`\`
(Use chain-specific USDC address and currency code - see "USDC by Chain" section)

**Native token example (only if user explicitly requests):**
\`\`\`json
{"terminal": "0x52869db3d61dde1e391967f2ce5039ad0ecd371c", "accountingContextsToAccept": [
  {"token": "0x000000000000000000000000000000000000EEEe", "decimals": 18, "currency": 61166}
]}
\`\`\`

**Struct Reference:**

**JBTerminalConfig:** \`{ terminal: address, accountingContextsToAccept: JBAccountingContext[] }\`

**JBAccountingContext:** \`{ token: address, decimals: uint8, currency: uint32 }\`
`;

export const TERMINALS_HINTS = [
  'terminal', 'USDC', 'accountingContext', 'payment', 'accept payments',
  'swap terminal', 'registry', 'currency', 'decimals', 'token address',
  'native token', 'ETH payments'
];

export const TERMINALS_TOKEN_ESTIMATE = 1200;
