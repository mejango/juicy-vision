/**
 * V6 discovery roots sub-module.
 * Hints: deploy, launch, create project, new project, revnet, sucker, bridge
 */

export const V6_ADDRESSES_CONTEXT = `
### Juicebox V6 Discovery Roots

Only JBDirectory and JBProjects are hardcoded protocol discovery roots:

| Contract | Address |
|----------|---------|
| JBProjects | 0x6017d1fba9dc279bfa0b03fd931c22e242ab3691 |
| JBDirectory | 0x5aff29060e023e6fb87be5596652b33c65af535b |

Existing-project routes are derived live from those roots. Trusted deployment and
recognition addresses are runtime-owned and must never be emitted by the model.
Unknown contracts block unconditionally, regardless of ABI compatibility or
simulation success.
`;

export const V6_ADDRESSES_HINTS = [
  'deploy',
  'launch',
  'create project',
  'new project',
  'start project',
  'revnet',
  'autonomous',
  'bridge',
  'cross-chain',
  'controller',
  'terminal address',
  'contract address',
];

export const V6_ADDRESSES_TOKEN_ESTIMATE = 170;
