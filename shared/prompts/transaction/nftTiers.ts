/**
 * NFT Tiers sub-module (~1000 tokens)
 * Hints: tier, NFT, 721, perks, rewards, collectible
 */

export const NFT_TIERS_CONTEXT = `
### NFT Tier Configuration (launch721Project)

**Project Type Decision Tree:**
| User chose... | Action | Contract |
|---------------|--------|----------|
| "Nothing - it's a donation/gift" | launchProject | JBOmnichainDeployer5_1 |
| "Pay them back later" | launchProject | JBOmnichainDeployer5_1 |
| "Stake in the project" | launchProject | JBOmnichainDeployer5_1 |
| **"Perks or rewards"** | **launch721Project** | JBOmnichainDeployer5_1 |

**launch721Project requires:**
- deployTiersHookConfig: JBDeploy721TiersHookConfig (NFT collection + tiers)
- launchProjectConfig: JBLaunchProjectConfig (project metadata + rulesets + terminals)
- salt: bytes32 for deterministic hook deployment
- suckerDeploymentConfiguration: JBSuckerDeploymentConfig for cross-chain

**Struct Reference:**

**JB721TierConfig:**
\`\`\`
{ name: string, description: string, media: string, price: uint104, initialSupply: uint32,
  votingUnits: uint32, reserveFrequency: uint16, reserveBeneficiary: address,
  encodedIPFSUri: bytes32, category: uint24, discountPercent: uint8,
  allowOwnerMint: bool, useReserveBeneficiaryAsDefault: bool, transfersPausable: bool,
  useVotingUnits: bool, cannotBeRemoved: bool, cannotIncreaseDiscountPercent: bool }
\`\`\`
- **name**: Tier name for display (e.g., "Founding Member") - REQUIRED
- **description**: What supporters get at this tier - REQUIRED
- **media**: Raw IPFS URI for tier image (e.g., "ipfs://Qm...") - REQUIRED for preview
- price: Cost in terminal token (6 decimals for USDC, 18 for ETH)
- initialSupply: Max NFTs available (max uint32 = 4,294,967,295 for practical "unlimited")
- discountPercent: Price decrease per cycle (0-100)
- encodedIPFSUri: Set to zero ("0x0...0") - frontend encodes the media URI
- reserveFrequency: Mint 1 reserved NFT per N minted (0 = no reserves)

**JB721InitTiersConfig:**
\`{ tiers: JB721TierConfig[], currency: uint32, decimals: uint8, prices: address }\`
- tiers: MUST be sorted by price (least to greatest)
- currency: 1=ETH, 2=USD
- decimals: 6 for USDC, 18 for ETH
- prices: Zero address for single currency only

**JBDeploy721TiersHookConfig:**
\`\`\`
{ name: string, symbol: string, baseUri: string, tokenUriResolver: address,
  contractUri: string, tiersConfig: JB721InitTiersConfig, reserveBeneficiary: address,
  flags: JB721TiersHookFlags }
\`\`\`

**JB721TiersHookFlags:**
\`{ noNewTiersWithReserves: bool, noNewTiersWithVotes: bool, noNewTiersWithOwnerMinting: bool, preventOverspending: bool }\`

**Complete Tier Structure:**
\`\`\`json
{"name": "Tier Name", "description": "What supporters get", "price": 5000000, "initialSupply": 4294967295,
  "media": "ipfs://TIER_IMAGE_CID", "encodedIPFSUri": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "votingUnits": 0, "reserveFrequency": 0, "reserveBeneficiary": "0x0000000000000000000000000000000000000000",
  "category": 1, "discountPercent": 0, "allowOwnerMint": false, "useReserveBeneficiaryAsDefault": false,
  "transfersPausable": false, "useVotingUnits": false, "cannotBeRemoved": false, "cannotIncreaseDiscountPercent": false}
\`\`\`
`;

export const NFT_TIERS_HINTS = [
  'tier', 'NFT', '721', 'perks', 'rewards', 'collectible', 'membership',
  'launch721Project', 'tiersConfig', 'initialSupply', 'tier price',
  'founding member', 'supporter level'
];

export const NFT_TIERS_TOKEN_ESTIMATE = 1000;
