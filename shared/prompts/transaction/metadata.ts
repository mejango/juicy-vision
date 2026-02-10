/**
 * Project Metadata sub-module (~600 tokens)
 * Hints: name, description, logo, setUriOf, rename, update metadata
 */

export const METADATA_CONTEXT = `
### IPFS & Metadata

**Format:**
\`\`\`json
{"name": "Name", "description": "Desc", "tagline": "Short tagline", "tags": ["tag1", "tag2", "tag3"], "infoUri": "https://...", "logoUri": "ipfs://..."}
\`\`\`

**ALWAYS include AI-generated tags!** Tags help with project discovery and search. Generate 3-8 relevant tags based on:
- Project category (farm, art, music, tech, community, dao, etc.)
- Industry/sector (agriculture, food, education, etc.)
- Location if mentioned (sicily, europe, etc.)
- Key offerings (olive-oil, workshops, nfts, etc.)
- Fundraising type (crowdfund, revnet, membership, etc.)

**Example tags for a farm project:**
\`"tags": ["farm", "agriculture", "community", "sicily", "olive-oil", "sustainable", "food", "crowdfund"]\`

**Workflow:**
1. Logo URL → silently pin image first
2. Construct metadata WITH generated tags
3. pin_to_ipfs
4. Use URI as projectUri

### setUriOf (Update Project Metadata)

**Use when:** User wants to change project name, description, logo, or any other metadata. Works for ALL projects including revnets (operator can call).

**DO NOT use queueRulesets for metadata changes.** Metadata is separate from rulesets.

**CRITICAL - DETERMINE IF PROJECT IS OMNICHAIN FIRST!**

**How to tell if a project is omnichain:**
- Check the conversation history - was it deployed with "chainConfigs" containing multiple chains?
- If launchProject used JBOmnichainDeployer5_1 with chainConfigs → IT IS OMNICHAIN
- If deployed to only one chain → IT IS SINGLE-CHAIN

**IF OMNICHAIN (deployed with chainConfigs):**
1. Each chain's JBProjects contract assigns the next available ID independently, so projectIds differ across chains
2. **FIRST** check conversation history for a "[SYSTEM: Project #N created..." message which lists the actual per-chain projectIds
3. **IF NOT IN HISTORY:** Query suckerGroups from bendystraw to get the per-chain projectIds
4. You MUST use "chainProjectMappings" array with the ACTUAL projectIds from each chain

**Omnichain setUriOf parameters (REQUIRED for omnichain projects):**
\`\`\`json
{
  "uri": "ipfs://NEW_METADATA_CID",
  "chainProjectMappings": [
    {"chainId": "1", "projectId": "<FROM_HISTORY_OR_BENDYSTRAW>"},
    {"chainId": "10", "projectId": "<FROM_HISTORY_OR_BENDYSTRAW>"}
  ]
}
\`\`\`

**Single-chain setUriOf parameters:**
\`\`\`json
{"projectId": 123, "uri": "ipfs://NEW_METADATA_CID"}
\`\`\`
`;

export const METADATA_HINTS = [
  'name', 'description', 'logo', 'setUriOf', 'rename', 'update metadata',
  'change name', 'update description', 'project info', 'tags', 'tagline',
  'logoUri', 'infoUri'
];

export const METADATA_TOKEN_ESTIMATE = 600;
