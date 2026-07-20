// NFT Tier types for Juicebox 721 Hook

/**
 * NFT Tier data structure from the 721 tier store
 */
export interface NFTTier {
  tierId: number
  name: string
  description?: string
  imageUri?: string
  price: bigint
  currency: number // 1=ETH, 2=USD
  pricingDecimals: number
  initialSupply: number
  remainingSupply: number
  reservedRate: number
  reserveBeneficiary?: string
  votingUnits: bigint
  category: number
  allowOwnerMint: boolean
  transfersPausable: boolean
  encodedIPFSUri?: string
  /** Canonical DAG-PB first, then the recoverable legacy raw-CID candidate. */
  metadataUris?: string[]
  animationUrl?: string
  mediaType?: string
  // Additional tier config fields
  discountPercent?: number
  cannotBeRemoved?: boolean
  cannotIncreaseDiscountPercent?: boolean
  cannotBuyWithCredits?: boolean
  splitPercent?: number
}

/**
 * Tier metadata from IPFS
 */
export interface NFTTierMetadata {
  name: string
  productName?: string
  categoryName?: string
  description?: string
  image?: string
  imageUri?: string
  animation_url?: string
  animationUrl?: string
  mediaType?: string
  external_url?: string
  attributes?: Array<{
    trait_type: string
    value: string | number
  }>
}

/**
 * Full tier with resolved metadata
 */
export interface ResolvedNFTTier extends NFTTier {
  metadata?: NFTTierMetadata
}

/**
 * Collection-wide permission flags for JB721TiersHook
 * These flags control what operations are allowed on the entire collection
 */
export interface JB721HookFlags {
  /** If true, new tiers with reserve frequencies cannot be added */
  noNewTiersWithReserves: boolean
  /** If true, new tiers with voting units cannot be added */
  noNewTiersWithVotes: boolean
  /** If true, new tiers with owner minting enabled cannot be added */
  noNewTiersWithOwnerMinting: boolean
  /** If true, overspending (paying more than tier price) is prevented */
  preventOverspending: boolean
  /** Whether token issuance includes the portion routed through tier splits */
  issueTokensForSplits: boolean
}

/**
 * Per-tier permission flags (from contract tier data)
 */
export interface TierPermissions {
  /** If true, this tier cannot be removed from the collection */
  cannotBeRemoved: boolean
  /** If true, the discount percent for this tier cannot be increased */
  cannotIncreaseDiscountPercent: boolean
}

/**
 * Extended tier data that includes permission flags
 */
export interface NFTTierWithPermissions extends NFTTier {
  permissions: TierPermissions
}

/**
 * Result of validating a tier change against permissions
 */
export interface TierChangeValidation {
  /** Whether the change is allowed */
  allowed: boolean
  /** If not allowed, the reason why */
  blockedReason?: string
  /** If true, user should consider deploying a new hook with different flags */
  suggestNewHook: boolean
}
