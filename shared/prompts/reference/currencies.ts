/**
 * Currency semantics. Exact token data is runtime-owned and chain-specific.
 */

export const CURRENCIES_CONTEXT = `
### Currency Semantics

An accounting-context currency is the low 32 bits of its token address, while a
payout split group uses the full token address as an integer. They are not
interchangeable. Reserved-token splits use the protocol's reserved group instead
of an accounting token group.

Well-known base currency IDs: 1 = ETH, 2 = USD. These are standard IDs, distinct
from token-derived accounting-context currencies (native-token pays convert
through a 1:1 feed — never compare IDs for equality across the two vocabularies).
Token-derived currency IDs differ per chain, so an omnichain project that wants
uniform issuance pricing should use baseCurrency 1 or 2.

Ruleset baseCurrency denominates issuance pricing; it does not select a payment
token. For existing projects, use only the complete live accounting context. For
new projects, the guarded form derives the exact native or canonical USDC token,
decimals, currency, and group IDs for each selected chain. Never emit or calculate
those addresses or numeric identifiers in model output.
`;

export const CURRENCIES_HINTS = [
  'currency',
  'groupId',
  'USDC',
  'ETH',
  'token address',
  'currency code',
  'native token',
  'baseCurrency',
];

export const CURRENCIES_TOKEN_ESTIMATE = 210;
