/**
 * Safe terminal-routing context. Addresses and calldata are runtime-owned.
 */

export const TERMINALS_CONTEXT = `
### Payment And Accounting Routes

For an existing project, Juicy Vision reads terminals from JBDirectory and reads
the selected terminal's live accounting contexts. It supports only terminals in
the runtime trust registry and only the native token or canonical USDC context
whose address, decimals, and currency all match. Unknown or ambiguous routes block.

Never provide a terminal, registry, token address, currency code, or raw terminal
configuration in model output. A successful read, interface match, quote, or
simulation does not make an unknown terminal trustworthy.

For a new project, render the guarded create form. It defaults to the native token
and uses USDC only after the user explicitly selects it; the form constructs the
exact per-chain accounting and router configuration.
`;

export const TERMINALS_HINTS = [
  'terminal',
  'USDC',
  'accountingContext',
  'payment',
  'accept payments',
  'router terminal',
  'currency',
  'native token',
  'ETH payments',
];

export const TERMINALS_TOKEN_ESTIMATE = 150;
