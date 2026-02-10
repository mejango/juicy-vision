/**
 * NFT Tiers sub-module (~1500 tokens)
 * Hints: tier, NFT, 721, perks, rewards, collectible, adjustTiers, setDiscount
 */

export const NFT_TIERS_CONTEXT = `
### NFT Tier Configuration

#### For New Projects: launch721Project


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
- tiers: MUST be sorted by category (least to greatest)
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

---

#### For Existing Projects: Managing Tiers

**Adding or Removing Tiers (adjustTiers)**

Use \`adjustTiers\` on the project's 721 hook contract to add new tiers or remove existing ones.

**Function signature:**
\`adjustTiers(JB721TierConfig[] tiersToAdd, uint256[] tierIdsToRemove)\`

**Adding new tiers:**
- tiersToAdd: Array of JB721TierConfig structs (same structure as launch721Project)
- New tiers are assigned the next available tier ID
- Tiers MUST be sorted by category (lowest to highest) - reverts with InvalidCategorySortOrder otherwise

**Removing tiers:**
- tierIdsToRemove: Array of tier IDs to remove
- A tier can only be removed if \`cannotBeRemoved\` was set to false when created
- Removed tiers stop appearing in the shop but existing NFTs remain valid

**Handling limited quantities (internal logic - don't expose to user):**
When a project exists in multiple locations, each location maintains separate inventory.
If user wants 100 total and project is on 4 chains: set initialSupply to 25 per chain.
If user wants 100 available everywhere: set initialSupply to 100.

Default behavior: Ask "how many do you want available?" and set that as initialSupply.
Don't mention chains, networks, or locations. Just make it work.
For truly limited editions (numbered collectibles), divide by chain count to get true total scarcity.

**Setting Discounts (setDiscountPercentsOf)**

Use \`setDiscountPercentsOf\` on the 721 hook to update discounts for multiple tiers at once.

**Function signature:**
\`setDiscountPercentsOf(uint256[] tierIds, uint8[] discountPercents)\`

- tierIds: Array of tier IDs to update
- discountPercents: Matching array of new discount percentages (0-100)
- Can only DECREASE discounts if \`cannotIncreaseDiscountPercent\` was set to true

**Single tier discount:**
\`setDiscountPercentOf(uint256 tierId, uint8 discountPercent)\`

**Execution:**
Both adjustTiers and setDiscountPercentsOf are applied everywhere the project exists.
Bundle via Relayr automatically - user doesn't need to know about this.

**Chat flow guidance:**
When helping users add tiers:
1. Ask what they want to sell (name, description)
2. Ask them to upload or describe an image
3. Ask for the price (default to USD for simplicity)
4. Ask "how many do you want available?" (or unlimited)
5. Show preview and confirm before building transaction

When helping users set discounts:
1. Show current tier info including any existing discount
2. Ask for the new discount percentage (e.g., "20% off")
3. Build and submit the transaction

Keep it simple. Don't mention technical details unless the user asks.
`;

export const NFT_TIERS_HINTS = [
  'tier', 'NFT', '721', 'perks', 'rewards', 'collectible', 'membership',
  'launch721Project', 'tiersConfig', 'initialSupply', 'tier price',
  'founding member', 'supporter level',
  'adjustTiers', 'add tier', 'remove tier', 'delete tier', 'sell something',
  'setDiscount', 'discount', 'sale', 'price reduction',
  'edit tier', 'update tier', 'tier metadata'
];

export const NFT_TIERS_TOKEN_ESTIMATE = 1500;
