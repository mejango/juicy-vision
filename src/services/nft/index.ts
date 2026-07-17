// NFT tier fetching service for Juicebox 721 hooks

import { createPublicClient, http, zeroAddress, type PublicClient } from 'viem'
import { VIEM_CHAINS, MAINNET_VIEM_CHAINS, RPC_ENDPOINTS, MAINNET_RPC_ENDPOINTS, JB_CONTRACTS, JB_OMNICHAIN_DEPLOYER, JB_BUYBACK_HOOK, JB_BUYBACK_HOOK_REGISTRY, type SupportedChainId } from '../../constants/chains'
import { REV_OWNER_ADDRESS, REV_OWNER_TIERED_721_HOOK_ABI } from '../../constants/abis/revDeployer'
import {
  decodeEncodedIPFSUriCandidates,
  fetchIpfsJson,
  inlineSvgImages,
} from '../../utils/ipfs'
import {
  requireRecognized721CloneIdentity,
  type Recognized721HookIdentity,
} from '../../utils/addressRegistry'
import {
  JB721TierStoreAbi,
  JBControllerRulesetAbi,
} from './queries'
import type {
  NFTTier,
  NFTTierMetadata,
  ResolvedNFTTier,
  JB721HookFlags,
  TierPermissions,
  TierChangeValidation,
  NFTTierWithPermissions,
} from './types'
import type { JB721TierConfigInput } from '../tiersHook'

const CT_DEPLOYER = '0xf21b8717cb50e497e90f375ec532557dd9022655' as const
const RECOGNIZED_NON_721_DATA_HOOKS = new Set([
  JB_BUYBACK_HOOK.toLowerCase(),
  JB_BUYBACK_HOOK_REGISTRY.toLowerCase(),
])
const DIRECTORY_ABI = [{
  name: 'controllerOf', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }],
}] as const
const PROJECTS_ABI = [{
  name: 'ownerOf', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }],
}] as const
const CT_DEPLOYER_ABI = [{
  name: 'dataHookOf', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'projectId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }],
}] as const
const OMNICHAIN_TIERED_HOOK_ABI = [{
  name: 'tiered721HookOf', type: 'function', stateMutability: 'view',
  inputs: [
    { name: 'projectId', type: 'uint256' },
    { name: 'rulesetId', type: 'uint256' },
  ],
  outputs: [
    { name: 'hook', type: 'address' },
    { name: 'useDataHookForCashOut', type: 'bool' },
  ],
}] as const
const HOOK_PRICING_CONTEXT_ABI = [{
  name: 'pricingContext', type: 'function', stateMutability: 'view',
  inputs: [],
  outputs: [
    { name: 'currency', type: 'uint256' },
    { name: 'decimals', type: 'uint256' },
  ],
}] as const

const MAX_REVIEWABLE_TIER_ID = 1_000

function nftChainConfig(chainId: number) {
  const chain = VIEM_CHAINS[chainId as SupportedChainId] ||
    MAINNET_VIEM_CHAINS[chainId as keyof typeof MAINNET_VIEM_CHAINS]
  if (!chain) throw new Error(`NFT configuration unavailable on unsupported chain ${chainId}`)
  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0] ||
    MAINNET_RPC_ENDPOINTS[chainId as keyof typeof MAINNET_RPC_ENDPOINTS]?.[0]
  if (!rpcUrl) throw new Error(`NFT configuration unavailable: no RPC endpoint for chain ${chainId}`)
  return { chain, rpcUrl }
}

function nftReadError(label: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : 'Unknown chain read failure'
  return new Error(`${label} unavailable: ${detail}`)
}

async function completeTierReadSize(
  client: Pick<PublicClient, 'readContract'>,
  storeAddress: `0x${string}`,
  hookAddress: `0x${string}`,
  maxTiers: number,
): Promise<bigint> {
  if (!Number.isSafeInteger(maxTiers) || maxTiers < 1 || maxTiers > MAX_REVIEWABLE_TIER_ID) {
    throw new Error(`Tier review limit must be between 1 and ${MAX_REVIEWABLE_TIER_ID}`)
  }
  const maxTierId = await client.readContract({
    address: storeAddress,
    abi: JB721TierStoreAbi,
    functionName: 'maxTierIdOf',
    args: [hookAddress],
  })
  if (maxTierId > BigInt(maxTiers)) {
    throw new Error(
      `Collection has ${maxTierId} historical tier IDs; Juicy Vision safely reviews at most ${maxTiers}`,
    )
  }
  return maxTierId
}

async function readPricingContext(
  client: Pick<PublicClient, 'readContract'>,
  hookAddress: `0x${string}`,
): Promise<{ currency: number; decimals: number }> {
  const pricing = await client.readContract({
    address: hookAddress,
    abi: HOOK_PRICING_CONTEXT_ABI,
    functionName: 'pricingContext',
  })
  const currency = Number(pricing[0])
  const decimals = Number(pricing[1])
  if (!Number.isSafeInteger(currency) || currency < 0 || currency > 0xffffffff) {
    throw new Error(`Invalid tier pricing currency: ${pricing[0]}`)
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(`Invalid tier pricing decimals: ${pricing[1]}`)
  }
  return { currency, decimals }
}

export async function fetchNFTPricingContext(
  hookAddress: `0x${string}`,
  chainId: number,
): Promise<{ currency: number; decimals: number }> {
  const { chain, rpcUrl } = nftChainConfig(chainId)
  const client = createPublicClient({ chain, transport: http(rpcUrl) })
  await requireRecognized721Hook(client, hookAddress)
  return readPricingContext(client, hookAddress)
}

export function getEffectiveTierPrice(
  tier: Pick<NFTTier, 'price' | 'discountPercent'>,
): bigint {
  const discountPercent = tier.discountPercent ?? 0
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 200) {
    throw new Error(`Invalid tier discount: ${discountPercent}`)
  }
  const discount = BigInt(discountPercent)
  return tier.price - (tier.price * discount) / 200n
}

export async function requireRecognized721Hook(
  client: Pick<PublicClient, 'readContract'>,
  hookAddress: `0x${string}`,
  expectedProjectId?: bigint,
): Promise<`0x${string}`> {
  await requireRecognized721HookIdentity(client, hookAddress, expectedProjectId)
  return hookAddress
}

export function requireRecognized721HookIdentity(
  client: Pick<PublicClient, 'readContract'>,
  hookAddress: `0x${string}`,
  expectedProjectId?: bigint,
): Promise<Recognized721HookIdentity> {
  return requireRecognized721CloneIdentity({
    client,
    hook: hookAddress,
    expectedProjectId,
  })
}

export * from './types'
export * from './queries'
export * from './multichain'

/**
 * Get the 721 data hook address for a project.
 * Wrapper data hooks expose their project-specific 721 clone. Direct tier and
 * Defifa clones are recognized from their JBAddressRegistry provenance.
 */
export async function getProjectDataHook(
  projectId: string,
  chainId: number
): Promise<`0x${string}` | null> {
  if (!/^[1-9]\d*$/.test(projectId)) throw new Error(`Invalid project ID: ${projectId}`)
  const numericProjectId = BigInt(projectId)
  const { chain, rpcUrl } = nftChainConfig(chainId)
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    console.log('[NFT] getProjectDataHook starting:', { projectId, chainId })

    const [controller, projectOwner] = await Promise.all([
      client.readContract({
        address: JB_CONTRACTS.JBDirectory,
        abi: DIRECTORY_ABI,
        functionName: 'controllerOf',
        args: [numericProjectId],
      }),
      client.readContract({
        address: JB_CONTRACTS.JBProjects,
        abi: PROJECTS_ABI,
        functionName: 'ownerOf',
        args: [numericProjectId],
      }),
    ])
    if (controller.toLowerCase() !== JB_CONTRACTS.JBController.toLowerCase()) {
      throw new Error(`Controller not recognized: ${controller}`)
    }

    const projectIsRevnet = projectOwner.toLowerCase() === REV_OWNER_ADDRESS.toLowerCase()

    if (projectIsRevnet) {
      // For revnets, query the REVOwner singleton's tiered721HookOf function
      // (V6: revnet project NFTs are owned by REVOwner, which tracks the 721 hook)
      const hookAddress = await client.readContract({
        address: projectOwner,
        abi: REV_OWNER_TIERED_721_HOOK_ABI,
        functionName: 'tiered721HookOf',
        args: [numericProjectId],
      })
      if (hookAddress && hookAddress !== zeroAddress) {
        return await requireRecognized721Hook(client, hookAddress, numericProjectId)
      }
      return null
    }

    // For non-revnets, get data hook from ruleset
    const result = await client.readContract({
      address: controller,
      abi: JBControllerRulesetAbi,
      functionName: 'currentRulesetOf',
      args: [numericProjectId],
    })
    if (BigInt(result[0].id) === 0n) throw new Error('Current project rules are unavailable')

    // result is [ruleset, metadata]
    const metadata = result[1]
    const dataHook = metadata.dataHook

    if (dataHook.toLowerCase() === JB_OMNICHAIN_DEPLOYER.toLowerCase()) {
      const [hookAddress] = await client.readContract({
        address: dataHook,
        abi: OMNICHAIN_TIERED_HOOK_ABI,
        functionName: 'tiered721HookOf',
        args: [numericProjectId, BigInt(result[0].id)],
      })
      if (hookAddress && hookAddress !== zeroAddress) {
        return await requireRecognized721Hook(client, hookAddress, numericProjectId)
      }
      return null
    }

    if (dataHook.toLowerCase() === CT_DEPLOYER.toLowerCase()) {
      const hookAddress = await client.readContract({
        address: CT_DEPLOYER,
        abi: CT_DEPLOYER_ABI,
        functionName: 'dataHookOf',
        args: [numericProjectId],
      })
      if (hookAddress && hookAddress !== zeroAddress) {
        return await requireRecognized721Hook(client, hookAddress, numericProjectId)
      }
      throw new Error('Croptop 721 hook configuration is incomplete')
    }

    // Check if data hook is set and it's using data hook for pay
    if (dataHook && dataHook !== zeroAddress && metadata.useDataHookForPay) {
      if (RECOGNIZED_NON_721_DATA_HOOKS.has(dataHook.toLowerCase())) return null
      return await requireRecognized721Hook(client, dataHook, numericProjectId)
    }

    return null
  } catch (err) {
    console.error('Failed to get project data hook:', err)
    throw nftReadError('Project NFT configuration', err)
  }
}

/**
 * Whether a project's 721 shop has item cash out (redemption) enabled — the
 * AUTHORITATIVE flag, not the bare ruleset `useDataHookForCashOut`.
 *
 * On an omnichain project the ruleset data hook is JBOmnichainDeployer, whose
 * `useDataHookForCashOut` only means "consult the deployer"; the real 721
 * cash-out opt-in is the deployer's per-ruleset tiered721 config
 * (`tiered721HookOf(...).useDataHookForCashOut`). When the 721 hook is the ruleset
 * data hook directly (single-chain custom), the ruleset flag is authoritative.
 * Revnets are token-based (cash-out hook is REVOwner) — item redemption is never
 * offered, so this returns false.
 */
export async function get721ItemsCashOutEnabled(
  projectId: string,
  chainId: number,
): Promise<boolean> {
  if (!/^[1-9]\d*$/.test(projectId)) return false
  const numericProjectId = BigInt(projectId)
  const { chain, rpcUrl } = nftChainConfig(chainId)
  const client = createPublicClient({ chain, transport: http(rpcUrl) })

  const [controller, projectOwner] = await Promise.all([
    client.readContract({ address: JB_CONTRACTS.JBDirectory, abi: DIRECTORY_ABI, functionName: 'controllerOf', args: [numericProjectId] }),
    client.readContract({ address: JB_CONTRACTS.JBProjects, abi: PROJECTS_ABI, functionName: 'ownerOf', args: [numericProjectId] }),
  ])
  if (controller.toLowerCase() !== JB_CONTRACTS.JBController.toLowerCase()) return false
  // Revnet: token-based, no item redemption.
  if (projectOwner.toLowerCase() === REV_OWNER_ADDRESS.toLowerCase()) return false

  const result = await client.readContract({
    address: controller,
    abi: JBControllerRulesetAbi,
    functionName: 'currentRulesetOf',
    args: [numericProjectId],
  })
  if (BigInt(result[0].id) === 0n) return false
  const metadata = result[1]
  const dataHook = metadata.dataHook

  // Omnichain: the authoritative flag is the deployer's per-ruleset tiered721 config.
  if (dataHook.toLowerCase() === JB_OMNICHAIN_DEPLOYER.toLowerCase()) {
    const [, useDataHookForCashOut] = await client.readContract({
      address: dataHook,
      abi: OMNICHAIN_TIERED_HOOK_ABI,
      functionName: 'tiered721HookOf',
      args: [numericProjectId, BigInt(result[0].id)],
    })
    return Boolean(useDataHookForCashOut)
  }

  // Direct 721 data hook (single-chain custom): the ruleset flag is the 721 flag.
  return Boolean(metadata.useDataHookForCashOut)
}

/**
 * Fetch all NFT tiers for a project's 721 hook
 * Fetches without resolved URIs (fast, low gas) - use resolveTierUri for on-chain SVGs
 */
export async function fetchNFTTiers(
  hookAddress: `0x${string}`,
  chainId: number,
  maxTiers: number = MAX_REVIEWABLE_TIER_ID
): Promise<NFTTier[]> {
  const { chain, rpcUrl } = nftChainConfig(chainId)
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    const identity = await requireRecognized721HookIdentity(client, hookAddress)
    const pricing = await readPricingContext(client, hookAddress)
    const storeAddress = identity.store
    console.log('[NFT] Store address:', storeAddress)

    if (!storeAddress || storeAddress === zeroAddress) throw new Error('721 hook store is missing')

    const readSize = await completeTierReadSize(client, storeAddress, hookAddress, maxTiers)
    if (readSize === 0n) return []

    // Fetch all tiers without resolved URIs (fast, works on public RPCs)
    console.log('[NFT] Fetching tiers from store:', storeAddress)
    const tiers = await client.readContract({
      address: storeAddress,
      abi: JB721TierStoreAbi,
      functionName: 'tiersOf',
      args: [
        hookAddress,
        [], // All categories
        false, // Don't include resolved URI (gas intensive for on-chain SVGs)
        0n,
        readSize,
      ],
    })

    console.log('[NFT] Fetched', tiers.length, 'tiers')

    // Map raw tier data to our NFTTier type (V6: per-tier booleans live in a
    // nested `flags` tuple; encodedIpfsUri casing changed)
    const seenTierIds = new Set<number>()
    return tiers.map((tier) => {
      const tierId = Number(tier.id)
      if (!Number.isSafeInteger(tierId) || tierId < 1 || BigInt(tierId) > readSize) {
        throw new Error(`Tier store returned an invalid tier ID: ${tier.id}`)
      }
      if (seenTierIds.has(tierId)) throw new Error(`Tier store returned duplicate tier ID ${tierId}`)
      seenTierIds.add(tierId)
      return {
        tierId,
        name: `Tier ${tier.id}`,
        price: BigInt(tier.price),
        currency: pricing.currency,
        pricingDecimals: pricing.decimals,
        initialSupply: Number(tier.initialSupply),
        remainingSupply: Number(tier.remainingSupply),
        reservedRate: Number(tier.reserveFrequency),
        reserveBeneficiary: tier.reserveBeneficiary,
        votingUnits: BigInt(tier.votingUnits),
        category: Number(tier.category),
        allowOwnerMint: tier.flags.allowOwnerMint,
        transfersPausable: tier.flags.transfersPausable,
        encodedIPFSUri: decodeEncodedIPFSUriCandidates(tier.encodedIpfsUri)?.[0],
        metadataUris: decodeEncodedIPFSUriCandidates(tier.encodedIpfsUri) ?? undefined,
        discountPercent: Number(tier.discountPercent),
        cannotBeRemoved: tier.flags.cantBeRemoved,
        cannotIncreaseDiscountPercent: tier.flags.cantIncreaseDiscountPercent,
        cannotBuyWithCredits: tier.flags.cantBuyWithCredits,
        splitPercent: Number(tier.splitPercent),
      }
    })
  } catch (err) {
    console.error('[NFT] Failed to fetch NFT tiers:', err)
    throw nftReadError('NFT tiers', err)
  }
}

/**
 * Resolve a single tier's URI (for on-chain SVGs like Banny)
 * This calls the tokenUriResolver with tierId * 1_000_000_000 + 0
 * Returns a data: URI containing the SVG/metadata
 */
export async function resolveTierUri(
  hookAddress: `0x${string}`,
  tierId: number,
  chainId: number
): Promise<string | null> {
  const chain = VIEM_CHAINS[chainId as SupportedChainId] ||
    MAINNET_VIEM_CHAINS[chainId as keyof typeof MAINNET_VIEM_CHAINS]
  if (!chain) return null

  const rpcUrl = RPC_ENDPOINTS[chainId]?.[0] ||
    MAINNET_RPC_ENDPOINTS[chainId as keyof typeof MAINNET_RPC_ENDPOINTS]?.[0]
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    const identity = await requireRecognized721HookIdentity(client, hookAddress)
    const storeAddress = identity.store

    if (!storeAddress || storeAddress === zeroAddress) return null

    // Check if there's a tokenUriResolver
    const resolverAddress = await client.readContract({
      address: storeAddress,
      abi: [
        {
          name: 'tokenUriResolverOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'hook', type: 'address' }],
          outputs: [{ name: '', type: 'address' }],
        },
      ] as const,
      functionName: 'tokenUriResolverOf',
      args: [hookAddress],
    })

    if (!resolverAddress || resolverAddress === zeroAddress) return null

    // Generate the synthetic token ID: tierId * 1_000_000_000 + 0
    const syntheticTokenId = BigInt(tierId) * 1_000_000_000n

    // Call tokenUriOf on the resolver
    const uri = await client.readContract({
      address: resolverAddress,
      abi: [
        {
          name: 'tokenUriOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [
            { name: 'hook', type: 'address' },
            { name: 'tokenId', type: 'uint256' },
          ],
          outputs: [{ name: '', type: 'string' }],
        },
      ] as const,
      functionName: 'tokenUriOf',
      args: [hookAddress, syntheticTokenId],
    })

    return uri || null
  } catch (err) {
    console.warn('[NFT] Failed to resolve tier URI:', err)
    if (err instanceof Error && /not recognized/i.test(err.message)) throw err
    return null
  }
}

/**
 * Check if a hook has a tokenUriResolver configured
 * If it does, tier metadata is managed on-chain and cannot be edited via IPFS URI
 */
export async function hasTokenUriResolver(
  hookAddress: `0x${string}`,
  chainId: number
): Promise<boolean> {
  const { chain, rpcUrl } = nftChainConfig(chainId)
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    const identity = await requireRecognized721HookIdentity(client, hookAddress)
    const storeAddress = identity.store

    if (!storeAddress || storeAddress === zeroAddress) throw new Error('721 hook store is missing')

    // Check if there's a tokenUriResolver
    const resolverAddress = await client.readContract({
      address: storeAddress,
      abi: [
        {
          name: 'tokenUriResolverOf',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'hook', type: 'address' }],
          outputs: [{ name: '', type: 'address' }],
        },
      ] as const,
      functionName: 'tokenUriResolverOf',
      args: [hookAddress],
    })

    return Boolean(resolverAddress && resolverAddress !== zeroAddress)
  } catch (err) {
    console.warn('[NFT] Failed to check tokenUriResolver:', err)
    throw nftReadError('Token URI resolver configuration', err)
  }
}

/**
 * Fetch a single NFT tier
 */
export async function fetchNFTTier(
  hookAddress: `0x${string}`,
  tierId: number,
  chainId: number
): Promise<NFTTier | null> {
  if (!Number.isSafeInteger(tierId) || tierId < 1 || tierId > 0xffff) {
    throw new Error(`Invalid tier ID: ${tierId}`)
  }
  const { chain, rpcUrl } = nftChainConfig(chainId)
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    const identity = await requireRecognized721HookIdentity(client, hookAddress)
    const pricing = await readPricingContext(client, hookAddress)
    const storeAddress = identity.store

    if (!storeAddress || storeAddress === zeroAddress) throw new Error('721 hook store is missing')

    const tier = await client.readContract({
      address: storeAddress,
      abi: JB721TierStoreAbi,
      functionName: 'tierOf',
      args: [hookAddress, BigInt(tierId), false], // Don't include resolved URI
    })

    const returnedTierId = Number(tier.id)
    if (returnedTierId === 0) return null
    if (returnedTierId !== tierId) throw new Error('Tier store returned a different tier')
    return {
      tierId: returnedTierId,
      name: `Tier ${tier.id}`,
      price: BigInt(tier.price),
      currency: pricing.currency,
      pricingDecimals: pricing.decimals,
      initialSupply: Number(tier.initialSupply),
      remainingSupply: Number(tier.remainingSupply),
      reservedRate: Number(tier.reserveFrequency),
      reserveBeneficiary: tier.reserveBeneficiary,
      votingUnits: BigInt(tier.votingUnits),
      category: Number(tier.category),
      allowOwnerMint: tier.flags.allowOwnerMint,
      transfersPausable: tier.flags.transfersPausable,
      encodedIPFSUri: decodeEncodedIPFSUriCandidates(tier.encodedIpfsUri)?.[0],
      metadataUris: decodeEncodedIPFSUriCandidates(tier.encodedIpfsUri) ?? undefined,
      discountPercent: Number(tier.discountPercent),
      cannotBeRemoved: tier.flags.cantBeRemoved,
      cannotIncreaseDiscountPercent: tier.flags.cantIncreaseDiscountPercent,
      cannotBuyWithCredits: tier.flags.cantBuyWithCredits,
      splitPercent: Number(tier.splitPercent),
    }
  } catch (err) {
    console.error('Failed to fetch NFT tier:', err)
    throw nftReadError('NFT tier', err)
  }
}

/**
 * Fetch tier metadata from IPFS
 */
export async function fetchTierMetadata(
  uri: string | readonly string[],
): Promise<NFTTierMetadata | null> {
  const candidates = typeof uri === 'string' ? [uri] : uri
  for (const candidate of candidates) {
    const metadata = normalizeTierMetadata(await fetchIpfsJson<unknown>(candidate))
    if (metadata) return metadata
  }
  return null
}

function normalizeTierMetadata(value: unknown): NFTTierMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const optionalString = (field: string, maxLength = 4_000) => {
    const candidate = record[field]
    return typeof candidate === 'string' && candidate.length <= maxLength ? candidate : undefined
  }
  const attributes = Array.isArray(record.attributes)
    ? record.attributes.flatMap(attribute => {
        if (!attribute || typeof attribute !== 'object' || Array.isArray(attribute)) return []
        const item = attribute as Record<string, unknown>
        if (typeof item.trait_type !== 'string' || item.trait_type.length > 200) return []
        if (typeof item.value !== 'string' && typeof item.value !== 'number') return []
        return [{ trait_type: item.trait_type, value: item.value }]
      })
    : undefined

  return {
    name: optionalString('name', 500) ?? '',
    productName: optionalString('productName', 500),
    categoryName: optionalString('categoryName', 500),
    description: optionalString('description', 20_000),
    image: optionalString('image', 2_000_000),
    imageUri: optionalString('imageUri', 2_000_000),
    animation_url: optionalString('animation_url', 2_000_000),
    animationUrl: optionalString('animationUrl', 2_000_000),
    mediaType: optionalString('mediaType', 200),
    external_url: optionalString('external_url'),
    attributes,
  }
}

/**
 * Fetch NFT tiers with resolved metadata
 * Uses batched fetching to avoid rate limiting
 */
export async function fetchResolvedNFTTiers(
  hookAddress: `0x${string}`,
  chainId: number,
  maxTiers: number = MAX_REVIEWABLE_TIER_ID
): Promise<ResolvedNFTTier[]> {
  const tiers = await fetchNFTTiers(hookAddress, chainId, maxTiers)

  // Batch metadata fetches to avoid rate limiting (5 concurrent requests)
  const BATCH_SIZE = 5
  const resolvedTiers: ResolvedNFTTier[] = []

  for (let i = 0; i < tiers.length; i += BATCH_SIZE) {
    const batch = tiers.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (tier) => {
        let metadata: NFTTierMetadata | null = null

        if (tier.metadataUris?.length || tier.encodedIPFSUri) {
          metadata = await fetchTierMetadata(tier.metadataUris ?? [tier.encodedIPFSUri!])
        }

        // Get the image URI from metadata
        let imageUri = metadata?.image || metadata?.imageUri

        // If the image is an SVG data URI, inline any external images
        // Browsers block external <image> refs in SVG data URIs for security
        if (imageUri?.startsWith('data:image/svg+xml')) {
          try {
            imageUri = await inlineSvgImages(imageUri)
          } catch (e) {
            console.warn(`[NFT] Failed to inline SVG images for tier ${tier.tierId}:`, e)
          }
        }

        return {
          ...tier,
          name: metadata?.name || tier.name,
          description: metadata?.description,
          imageUri,
          animationUrl: metadata?.animation_url || metadata?.animationUrl,
          mediaType: metadata?.mediaType,
          metadata: metadata || undefined,
        }
      })
    )
    resolvedTiers.push(...batchResults)
  }

  return resolvedTiers
}

/**
 * Fetch all NFT tiers for a project (by project ID)
 * This looks up the 721 hook from the project's ruleset
 */
export async function fetchProjectNFTTiers(
  projectId: string,
  chainId: number
): Promise<ResolvedNFTTier[]> {
  const hookAddress = await getProjectDataHook(projectId, chainId)
  if (!hookAddress) return []

  return fetchResolvedNFTTiers(hookAddress, chainId)
}

/**
 * Check if a project has a 721 hook configured
 */
export async function hasNFTHook(
  projectId: string,
  chainId: number
): Promise<boolean> {
  console.log('[NFT] hasNFTHook called:', { projectId, chainId })
  const hookAddress = await getProjectDataHook(projectId, chainId)
  console.log('[NFT] hasNFTHook result:', { projectId, hookAddress, hasHook: hookAddress !== null })
  return hookAddress !== null
}

/**
 * Fetch the hook flags for a JB721TiersHook contract
 * These flags determine what operations are allowed on the collection
 * Note: Flags are stored on the STORE contract, not the hook itself
 */
export async function fetchHookFlags(
  hookAddress: `0x${string}`,
  chainId: number
): Promise<JB721HookFlags> {
  const { chain, rpcUrl } = nftChainConfig(chainId)
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    const identity = await requireRecognized721HookIdentity(client, hookAddress)
    const storeAddress = identity.store

    if (!storeAddress || storeAddress === zeroAddress) throw new Error('721 hook store is missing')

    // Then get flags from the store using flagsOf(hookAddress)
    const flags = await client.readContract({
      address: storeAddress,
      abi: JB721TierStoreAbi,
      functionName: 'flagsOf',
      args: [hookAddress],
    })

    return {
      noNewTiersWithReserves: flags.noNewTiersWithReserves,
      noNewTiersWithVotes: flags.noNewTiersWithVotes,
      noNewTiersWithOwnerMinting: flags.noNewTiersWithOwnerMinting,
      preventOverspending: flags.preventOverspending,
      issueTokensForSplits: flags.issueTokensForSplits,
    }
  } catch (err) {
    console.error('Failed to fetch hook flags:', err)
    throw nftReadError('721 hook flags', err)
  }
}

/**
 * Fetch NFT tiers with their permission flags
 */
export async function fetchNFTTiersWithPermissions(
  hookAddress: `0x${string}`,
  chainId: number,
  maxTiers: number = MAX_REVIEWABLE_TIER_ID
): Promise<NFTTierWithPermissions[]> {
  const { chain, rpcUrl } = nftChainConfig(chainId)
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  try {
    const identity = await requireRecognized721HookIdentity(client, hookAddress)
    const pricing = await readPricingContext(client, hookAddress)
    const storeAddress = identity.store

    if (!storeAddress || storeAddress === zeroAddress) throw new Error('721 hook store is missing')

    const readSize = await completeTierReadSize(client, storeAddress, hookAddress, maxTiers)
    if (readSize === 0n) return []

    const tiers = await client.readContract({
      address: storeAddress,
      abi: JB721TierStoreAbi,
      functionName: 'tiersOf',
      args: [
        hookAddress,
        [], // All categories
        false, // Don't include resolved URI (can cause reverts)
        0n, // Starting from tier 0
        readSize,
      ],
    })

    const seenTierIds = new Set<number>()
    return tiers.map((tier) => {
      const tierId = Number(tier.id)
      if (!Number.isSafeInteger(tierId) || tierId < 1 || BigInt(tierId) > readSize) {
        throw new Error(`Tier store returned an invalid tier ID: ${tier.id}`)
      }
      if (seenTierIds.has(tierId)) throw new Error(`Tier store returned duplicate tier ID ${tierId}`)
      seenTierIds.add(tierId)
      return {
        tierId,
        name: `Tier ${tier.id}`,
        price: BigInt(tier.price),
        currency: pricing.currency,
        pricingDecimals: pricing.decimals,
        initialSupply: Number(tier.initialSupply),
        remainingSupply: Number(tier.remainingSupply),
        reservedRate: Number(tier.reserveFrequency),
        reserveBeneficiary: tier.reserveBeneficiary,
        votingUnits: BigInt(tier.votingUnits),
        category: Number(tier.category),
        allowOwnerMint: tier.flags.allowOwnerMint,
        transfersPausable: tier.flags.transfersPausable,
        encodedIPFSUri: decodeEncodedIPFSUriCandidates(tier.encodedIpfsUri)?.[0],
        metadataUris: decodeEncodedIPFSUriCandidates(tier.encodedIpfsUri) ?? undefined,
        discountPercent: Number(tier.discountPercent),
        cannotBeRemoved: tier.flags.cantBeRemoved,
        cannotIncreaseDiscountPercent: tier.flags.cantIncreaseDiscountPercent,
        cannotBuyWithCredits: tier.flags.cantBuyWithCredits,
        splitPercent: Number(tier.splitPercent),
        permissions: {
          cannotBeRemoved: tier.flags.cantBeRemoved,
          cannotIncreaseDiscountPercent: tier.flags.cantIncreaseDiscountPercent,
        },
      }
    })
  } catch (err) {
    console.error('Failed to fetch NFT tiers with permissions:', err)
    throw nftReadError('NFT tiers and permissions', err)
  }
}

/**
 * Validate a tier configuration change against hook flags and tier permissions
 *
 * @param tier - The tier configuration being added or modified
 * @param hookFlags - The collection-wide flags from the hook contract
 * @param existingTier - If modifying an existing tier, its current permissions
 * @param isRemoval - If true, this is a tier removal operation
 * @returns Validation result with allowed status and any block reason
 */
export function validateTierChange(
  tier: JB721TierConfigInput | null,
  hookFlags: JB721HookFlags,
  existingTier?: TierPermissions,
  isRemoval: boolean = false
): TierChangeValidation {
  // Tier removal validation
  if (isRemoval) {
    if (existingTier?.cannotBeRemoved) {
      return {
        allowed: false,
        blockedReason: 'This tier has been configured to be non-removable',
        suggestNewHook: false,
      }
    }
    return { allowed: true, suggestNewHook: false }
  }

  // New tier validation
  if (!tier) {
    return { allowed: true, suggestNewHook: false }
  }

  // Check hook-level restrictions for new tiers
  if (tier.reserveFrequency > 0 && hookFlags.noNewTiersWithReserves) {
    return {
      allowed: false,
      blockedReason: 'This collection does not allow new tiers with reserved NFT minting',
      suggestNewHook: true,
    }
  }

  if (tier.votingUnits > 0 && hookFlags.noNewTiersWithVotes) {
    return {
      allowed: false,
      blockedReason: 'This collection does not allow new tiers with voting power',
      suggestNewHook: true,
    }
  }

  if (tier.allowOwnerMint && hookFlags.noNewTiersWithOwnerMinting) {
    return {
      allowed: false,
      blockedReason: 'This collection does not allow new tiers with owner minting enabled',
      suggestNewHook: true,
    }
  }

  return { allowed: true, suggestNewHook: false }
}

/**
 * Validate a discount percent change against tier permissions
 *
 * @param newDiscountPercent - The new discount percent value
 * @param currentDiscountPercent - The current discount percent value
 * @param tierPermissions - The tier's permission flags
 * @returns Validation result
 */
export function validateDiscountChange(
  newDiscountPercent: number,
  currentDiscountPercent: number,
  tierPermissions: TierPermissions
): TierChangeValidation {
  // Increasing discount is restricted if cannotIncreaseDiscountPercent is set
  if (newDiscountPercent > currentDiscountPercent && tierPermissions.cannotIncreaseDiscountPercent) {
    return {
      allowed: false,
      blockedReason: 'This tier does not allow increasing the discount percentage',
      suggestNewHook: false,
    }
  }

  return { allowed: true, suggestNewHook: false }
}

/**
 * Get a summary of what operations are blocked by hook flags
 */
export function getBlockedOperations(flags: JB721HookFlags): string[] {
  const blocked: string[] = []

  if (flags.noNewTiersWithReserves) {
    blocked.push('Adding tiers with reserved NFT minting')
  }
  if (flags.noNewTiersWithVotes) {
    blocked.push('Adding tiers with voting power')
  }
  if (flags.noNewTiersWithOwnerMinting) {
    blocked.push('Adding tiers with owner minting')
  }
  if (flags.preventOverspending) {
    blocked.push('Overspending on tier purchases')
  }

  return blocked
}
