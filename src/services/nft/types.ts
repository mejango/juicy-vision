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
  initialSupply: number
  remainingSupply: number
  reservedRate: number
  votingUnits: bigint
  category: number
  allowOwnerMint: boolean
  transfersPausable: boolean
  encodedIPFSUri?: string
}

/**
 * Raw tier data from the contract
 */
export interface RawTierData {
  id: bigint
  price: bigint
  remainingSupply: bigint
  initialSupply: bigint
  votingUnits: bigint
  reservedRate: bigint
  reserveFrequency: bigint
  category: bigint
  allowOwnerMint: boolean
  transfersPausable: boolean
  cannotBeRemoved: boolean
  cannotIncreaseDiscountPercent: boolean
  encodedIPFSUri: `0x${string}`
}

/**
 * Tier metadata from IPFS
 */
export interface NFTTierMetadata {
  name: string
  description?: string
  image?: string
  imageUri?: string
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
 * 721 Hook configuration for a project
 */
export interface NFTHookConfig {
  hookAddress: `0x${string}`
  storeAddress: `0x${string}`
  projectId: bigint
  totalTiers: number
}

/**
 * Mint event details
 */
export interface NFTMintEvent {
  txHash: string
  tierId: number
  tokenId: bigint
  beneficiary: `0x${string}`
  amount: bigint
  timestamp: number
}
