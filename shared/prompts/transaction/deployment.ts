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
only after all checks pass. Non-revnet projects default to one low-cost chain;
revnets are designed for network effects, so recommend all supported chains unless
the user asks for single-chain. Either way, never infer destinations the user has
not confirmed in the form.

When suckers bridge across chains: canonical USDC must use CCIP lanes (native L2
bridges deliver bridged USDC.e, which strands funds); only the native token may
use the OP/Base/Arbitrum native-bridge deployers, which never connect L2 to L2.
Payout limits are per chain, not aggregate — a 10 ETH limit on 4 chains allows
40 ETH total.

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

export const DEPLOYMENT_TOKEN_ESTIMATE = 290;
