/**
 * Safe project metadata guidance.
 */

export const METADATA_CONTEXT = `
### Project Details

Project details may include a name, description, short tagline, relevant search
tags, public information link, logo, and category labels. Never fabricate a link,
identity, affiliation, or media URI. Pin final user-approved content before review.

For an existing project, render set-uri-form with only the project and chain
identity. Do not emit a controller address, raw setUriOf parameters, calldata, or
a generic transaction preview. The guarded form reads ownership from JBProjects,
derives and recognizes the current controller from JBDirectory, loads the complete
verified connected-project mapping, checks Revnet operator authority when needed,
simulates every exact update, and revalidates before execution.

Never infer connected chains from conversation history or copy one chain's project
ID to another. If the mapping, authority, controller, pinning result, or simulation
is unavailable, block the update and say that project details cannot be verified.
Metadata updates do not require a ruleset change.
`;

export const METADATA_HINTS = [
  'name',
  'description',
  'logo',
  'setUriOf',
  'rename',
  'update metadata',
  'change name',
  'update description',
  'project info',
  'tags',
  'tagline',
  'logoUri',
  'infoUri',
  'category names',
];

export const METADATA_TOKEN_ESTIMATE = 170;
