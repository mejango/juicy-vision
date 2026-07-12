/**
 * Safe splits and fund-access guidance.
 */

export const SPLITS_LIMITS_CONTEXT = `
### Payouts, Splits, And Fund Access

A payout limit controls the gross amount that may leave. Splits only distribute a
payout among recipients the user explicitly chose. Never add a Juicy, platform,
protocol, donation, support, or owner split implicitly; an unallocated remainder
already goes to the project owner. Splits are not equity or revenue sharing.

For existing projects, render the dedicated guarded form. It reloads the current
ruleset, terminals, accounting contexts, split groups, hooks, balances, limits,
and permissions before review and again before execution. Unknown terminals,
hooks, currencies, project routing, incomplete groups, or changed state block.

Never emit raw split groups, terminal/token addresses, group IDs, currency codes,
or fund-access structs from the model. Preserve locked or advanced routing without
offering to modify it. Payout percentages may total at most 100 percent, amounts
must use the live token decimals, and the review must distinguish the user-approved
gross amount from the expected net after any protocol fee.
`;

export const SPLITS_LIMITS_HINTS = [
  'payout',
  'split',
  'withdraw',
  'fund access',
  'goal',
  'surplus',
  'allowance',
  'limit',
  'fee',
  'beneficiary',
  'splitGroups',
];

export const SPLITS_LIMITS_TOKEN_ESTIMATE = 190;
