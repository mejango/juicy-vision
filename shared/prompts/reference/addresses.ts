/**
 * Contract discovery roots reference module.
 * Hints: address, contract, terminal, controller, deployer
 */

export const ADDRESSES_CONTEXT = `
### Contract Discovery Roots

Only JBDirectory and JBProjects are hardcoded protocol discovery roots:

| Contract | Address |
|----------|---------|
| JBProjects | 0x6017d1fba9dc279bfa0b03fd931c22e242ab3691 |
| JBDirectory | 0x5aff29060e023e6fb87be5596652b33c65af535b |

For existing projects, derive the controller, terminals, dependencies, and hooks
from live state. The guarded runtime owns trusted recognition references and
creation routes. Never place any non-root contract address in model output or use
one as a fallback. Unknown contracts block even if their interfaces match or a
simulation succeeds.
`;

export const ADDRESSES_HINTS = [
  'address',
  'contract',
  'terminal',
  'controller',
  'deployer',
  'JBDirectory',
  'JBProjects',
  'registry',
];

export const ADDRESSES_TOKEN_ESTIMATE = 180;
