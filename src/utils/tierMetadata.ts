interface TierCategoryPlan {
  categoryByTierId: Record<string, number>
  storeCategories: Record<string, string>
}

interface TierMetadataInput {
  name: string
  description?: string
  image?: string
  animationUrl?: string
  mediaType?: string
  categoryName?: string
}

export interface StoredTierMetadata {
  name: string
  description?: string
  image?: string
  animation_url?: string
  mediaType?: string
  categoryName?: string
}

export function isSafeTierMediaUri(value: string): boolean {
  const uri = value.trim()
  if (!uri || /\s/.test(uri)) return false
  if (/^ipfs:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})(?:\/[^\s]*)?$/i.test(uri)) return true
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})(?:\/[^\s]*)?$/i.test(uri)) return true
  if (/^data:(image|audio|video)\/[a-z0-9.+-]+[;,]/i.test(uri)) return true
  try {
    const url = new URL(uri)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Build the exact JSON payload pinned for a tier, omitting blank optional fields. */
export function buildTierMetadata(input: TierMetadataInput): StoredTierMetadata {
  const name = input.name.trim()
  if (!name) throw new Error('Tier name is required')

  const optional = (value: string | undefined) => value?.trim() || undefined
  const image = optional(input.image)
  const animationUrl = optional(input.animationUrl)
  const mediaType = optional(input.mediaType)
  if (image && !isSafeTierMediaUri(image)) throw new Error('Image must use IPFS, HTTP, HTTPS, or an image data URI')
  if (animationUrl && !isSafeTierMediaUri(animationUrl)) {
    throw new Error('Animation must use IPFS, HTTP, HTTPS, or an audio, video, or image data URI')
  }
  if (mediaType && !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mediaType)) {
    throw new Error('Media type must be a valid MIME type')
  }
  return {
    name,
    description: optional(input.description),
    image,
    animation_url: animationUrl,
    mediaType,
    categoryName: optional(input.categoryName),
  }
}

/** Assigns stable, first-seen category IDs while leaving blank categories at 0. */
export function buildTierCategoryPlan(
  tiers: ReadonlyArray<{ id: string; categoryName?: string }>,
): TierCategoryPlan {
  const categoryIds = new Map<string, number>()
  const categoryByTierId: Record<string, number> = {}
  const storeCategories: Record<string, string> = {}

  for (const tier of tiers) {
    const name = tier.categoryName?.trim() || ''
    if (!name) {
      categoryByTierId[tier.id] = 0
      continue
    }
    let category = categoryIds.get(name)
    if (category === undefined) {
      category = categoryIds.size + 1
      categoryIds.set(name, category)
      storeCategories[String(category)] = name
    }
    categoryByTierId[tier.id] = category
  }

  return { categoryByTierId, storeCategories }
}
