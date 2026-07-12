/**
 * User-facing Revnet guidance. Exact stage encoding is form-owned.
 */

export const REVNET_PARAMS_CONTEXT = `
### Autonomous Projects

Show create-revnet-form only after the user explicitly chooses an autonomous
project. Do not emit deploy actions, stage structs, addresses, predicted IDs, or a
generic transaction preview.

Explain that a Revnet has staged issuance and cash-out rules with no wallet owner
who can later rewrite them. The operator role is limited and does not make the
operator the project owner. The guarded form collects bounded user-facing stage
settings, requires explicit destination chains, constructs recognized routes,
reads each exact JBProjects creation fee, and validates all stages before review.

For an existing project, identify it as a Revnet only when JBProjects reports the
recognized REVOwner and live operator authority can be verified. Never trust an
indexer owner/operator flag by itself. Revnet rules cannot be queued through the
ordinary project rules form; a verified current operator may update project
details through the dedicated guarded form.
`;

export const REVNET_PARAMS_HINTS = [
  'revnet',
  'issuance cut',
  'issuance decay',
  'autonomous',
  'decay',
  'no human control',
  'early supporter',
];

export const REVNET_PARAMS_TOKEN_ESTIMATE = 180;
