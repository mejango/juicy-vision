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

**Handling limited quantities:**
When user selects "Limited quantity" for a tier, you MUST ask "How many should be available?"

**IMPORTANT: Limited tiers go on ONE chain only to preserve true scarcity.**
- Limited supply tiers (specific quantity): Deploy ONLY on the primary chain
- Unlimited tiers: Deploy on all chains
- Chain preference order for limited tiers: Ethereum → Arbitrum → Base → Optimism
- This ensures "50 available" means exactly 50 total, not 50 per chain

When building the transaction for a project with mixed tier types:
- Include unlimited tiers in the omnichain deployment (all chains)
- Include limited tiers ONLY in the primary chain configuration
- Don't mention chains to the user - just make it work correctly

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
2. Ask them to upload an image OR offer to auto-generate one:
   - "Upload an image for this tier, or I can generate one for you"
   - If user wants auto-generate, create a prompt based on tier name/description
3. Ask for the price - ALWAYS use USD ($) unless user explicitly requests ETH:
   - Display as "$10" not "0.003 ETH"
   - Store internally with currency=2 (USD) and decimals=6
4. Ask if limited or unlimited:
   - If LIMITED: Ask "How many should be available?" (REQUIRED - don't skip this!)
   - If UNLIMITED: Set initialSupply to 4294967295
5. Show preview with prices in USD and confirm before building transaction

**Price display rules:**
- ALWAYS show prices in USD by default (e.g., "$25", "$100")
- Only show ETH if user explicitly requests it
- In transaction preview, display as "$X" not "X ETH"

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
