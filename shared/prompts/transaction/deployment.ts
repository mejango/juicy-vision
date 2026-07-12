/**
 * Safe deployment context. The guarded forms own all contract configuration.
 */

export const DEPLOYMENT_CONTEXT = `
### Project Creation

Use create-project-form for a user-controlled project and create-revnet-form only
after the user explicitly chooses autonomous rules. Do not emit raw deployment
parameters, calldata, contract addresses, terminal configurations, bridge
deployers, salts, predicted IDs, or a generic transaction preview.

The guarded form pins final metadata, selects only user-approved chains, builds
recognized terminal and cross-chain configuration, reads JBProjects.creationFee()
fresh on every destination, simulates the exact operations, and exposes execution
only after all checks pass. Default to one low-cost chain; never infer additional
destinations.

Project IDs are accepted only from confirmed canonical launch receipts or a
complete verified connected-project mapping. IDs on different chains are
independent and must never be guessed, copied, or predicted.
`;

export const DEPLOYMENT_HINTS = [
  'deploy',
  'launch',
  'create',
  'omnichain',
  'cross-chain',
  'all chains',
  'multi-chain',
  'projectUri',
  'creation fee',
];

export const DEPLOYMENT_TOKEN_ESTIMATE = 170;
