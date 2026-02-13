/**
 * NFT Tiers sub-module (~1500 tokens)
 * Hints: tier, NFT, 721, perks, rewards, collectible, adjustTiers, setDiscount
 */

export const NFT_TIERS_CONTEXT = `
### NFT Tier Configuration

#### For New Projects: ALWAYS use launch721Project

**IMPORTANT: ALL projects should use launch721Project, even if no tiers are configured initially.**
This makes it easy for project owners to add inventory, rewards, or merchandise later without redeploying.
Assume every project will eventually want to sell something.

**The 721 hook is your selling machine.** Use it for:
- **Rewards**: Thank-you perks for supporters (stickers, t-shirts, exclusive content)
- **Inventory**: Physical or digital products the project sells
- **Collectibles**: Limited edition items, art, memorabilia
- **Memberships**: Access passes, subscriptions, VIP tiers
- **Services**: Consultations, lessons, commissioned work

**launch721Project requires:**
- deployTiersHookConfig: JBDeploy721TiersHookConfig (NFT collection + tiers - can be empty array initially)
- launchProjectConfig: JBLaunchProjectConfig (project metadata + rulesets + terminals)
- salt: bytes32 for deterministic hook deployment
- suckerDeploymentConfiguration: JBSuckerDeploymentConfig for cross-chain

#### Category System (Organizing Items for Sale)

**Categories let projects organize their items into groups.**

**Category namespace (uint24):**
| Range | Purpose |
|-------|---------|
| 0 - 16,777,115 | **User-defined** - Project owners define freely (start at 0) |
| 16,777,116 - 16,777,215 | **Reserved/Official** - Apps recognize these (last 100) |

**Official categories (apps should recognize these):**
- 16,777,215: Content/Updates (posts, articles, announcements)
- 16,777,214: Membership (access passes, subscriptions)
- 16,777,213: Governance (voting NFTs)

**User-defined categories (start at 0):**
- Category 0: Default (use for most items)
- Category 1+: Additional categories if needed (e.g., "Merch", "Services")
- Store category names in projectUri metadata using \`721Categories\` field

**projectUri metadata with categories:**
\`\`\`json
{
  "name": "My Project",
  "description": "...",
  "721Categories": {
    "0": "Rewards",
    "1": "Merchandise",
    "2": "Digital Goods",
    "3": "Services"
  }
}
\`\`\`

**When adding tiers:**
- **Default to category 0** unless the user has a specific reason to organize items differently
- Only introduce multiple categories if the project clearly needs to separate different types of items (e.g., rewards vs merchandise vs services)
- If using multiple categories, update projectUri metadata with category names via setUriOf

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
- initialSupply: Max NFTs available (use 999999999 for unlimited - contract max is 1 billion - 1)
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
{"name": "Tier Name", "description": "What supporters get", "price": 5000000, "initialSupply": 999999999,
  "media": "ipfs://TIER_IMAGE_CID", "encodedIPFSUri": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "votingUnits": 0, "reserveFrequency": 0, "reserveBeneficiary": "0x0000000000000000000000000000000000000000",
  "category": 0, "discountPercent": 0, "allowOwnerMint": false, "useReserveBeneficiaryAsDefault": false,
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
When user selects "Limited quantity", check if they provided the amount in the inline input (e.g. "tier_quantity_amount: 50").
- If amount IS provided: use that value, don't ask again
- If amount is NOT provided: ask "How many should be available?"

**CRITICAL: Limited supply tiers must only exist on ONE chain to preserve true scarcity.**

If you deploy "10 available" to all chains, you get 10 per chain (40 total across 4 chains), breaking scarcity.

**Rules for tier distribution across chains:**
1. **Project stays omnichain** - Deploy with suckers so project exists on all chains
2. **Unlimited tiers (initialSupply >= 999999999)** → Deploy on ALL chains
3. **Limited supply tiers (specific quantity)** → Deploy on PRIMARY chain ONLY

**Chain preference order for limited tiers:**
- Mainnet: Ethereum (1) → Arbitrum (42161) → Base (8453) → Optimism (10)
- Testnet: Sepolia (11155111) → Arbitrum Sepolia (421614) → Base Sepolia (84532) → OP Sepolia (11155420)

**How to configure per-chain 721 tiers:**
- Primary chain: ALL tiers (both limited and unlimited)
- Other chains: ONLY unlimited tiers (filter out any tier with initialSupply < 999999999)

**Example:**
If project has "Early Supporter" (10 available) and "Fan" (unlimited):
- Sepolia: both tiers
- Other chains: only "Fan" tier

Don't mention chains to the user - just configure correctly based on their tier supply choices.

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
   - If LIMITED and quantity already provided in inline input: use that value
   - If LIMITED but no quantity provided: ask "How many should be available?"
   - If UNLIMITED: Set initialSupply to 999999999
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
  'edit tier', 'update tier', 'tier metadata',
  'sell', 'selling', 'inventory', 'merchandise', 'merch', 'products',
  'store', 'shop', 'category', 'categories', 'goods', 'items'
];

export const NFT_TIERS_TOKEN_ESTIMATE = 1500;
