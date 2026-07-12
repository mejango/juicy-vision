/**
 * Safe ruleset guidance. Exact protocol structures are handled by the form.
 */

export const RULESETS_CONTEXT = `
### Project Rules

Use ruleset-schedule for verified read-only history and
queue-ruleset-form for a requested change. Never emit raw ruleset structs,
hook addresses, controller targets, calldata, or a generic transaction preview.

Explain the user-facing effects precisely:
- issuance controls how many project shares a payment receives
- the reserved rate is the portion of newly issued shares routed to reserved
  recipients, not a payout or ownership percentage
- payout limits reserve a gross amount for payouts
- surplus allowances draw from funds that may otherwise support cash outs
- cash-out tax changes the curve and its maximum disables cash outs
- duration controls cycling; an approval hook may delay or reject the next rules

The guarded form reloads the current and upcoming rules, recognized approval/data
hooks, live accounting contexts, every split and fund-access group, connected
project IDs, permissions, and the queue route. It preserves configuration Juicy
Vision does not safely edit. Unknown hooks/routes, Revnets, incomplete history,
changed state, unsupported currency conversion, or unavailable reads block.

Do not describe a queued rule as current. An upcoming auto-cycle is a forecast
only while the current configuration remains unchanged.
`;

export const RULESETS_HINTS = [
  'ruleset',
  'weight',
  'duration',
  'reserved',
  'metadata',
  'issuance',
  'queue ruleset',
  'update rules',
  'change settings',
  'cash out tax',
  'pause payments',
  'end date',
  'schedule',
];

export const RULESETS_TOKEN_ESTIMATE = 210;
