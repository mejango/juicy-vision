/**
 * User-facing 721 tier guidance. Hook configuration is runtime-owned.
 */

export const NFT_TIERS_CONTEXT = `
### Rewards And Shop Items

Use a 721-enabled create flow only when the user explicitly configures at least
one concrete reward, product, membership, collectible, or service. Otherwise use
the plain project create form; never deploy an unused hook.

Collect only information the user can review: item name, description, image,
exact price and unit, and limited or unlimited quantity. A limited quantity is
chain-local, so the current safe flow requires one destination and blocks a
multi-chain launch that would silently multiply inventory. Never imply that an
on-chain item automatically handles shipping, fulfillment, legal rights, or
off-chain access.

For an existing project, render manage-tiers-form. The guarded runtime derives
the live ruleset data hook, verifies the recognized 721 hook and store, checks its
pricing context and permissions, reloads tiers, and simulates the exact change.
Unknown hooks, pricing, stores, or changed state block. The current form supports
only adding and removing eligible tiers; do not offer price, supply, discount, or
metadata edits and never emit raw hook calldata.

Use categories only when the user needs them. Keep technical hook and NFT language
out of the explanation unless the user asks for it.
`;

export const NFT_TIERS_HINTS = [
  'tier',
  'NFT',
  '721',
  'perks',
  'rewards',
  'collectible',
  'membership',
  'add tier',
  'remove tier',
  'sell',
  'inventory',
  'merchandise',
  'products',
  'store',
  'shop',
  'category',
];

export const NFT_TIERS_TOKEN_ESTIMATE = 190;
