import { isAddress, zeroAddress } from 'viem'
import type { JB721TierConfigInput } from '../services/tiersHook'
import type { NFTTier } from '../services/nft/types'
import { isUsdcCurrency } from './technicalDetails'

const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead'
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`

export type NFTPaymentToken = 'ETH' | 'USDC'

export interface VerifiedNFTPaymentItem {
  tierId: number
  quantity: number
  name: string
  unitPrice: bigint
}

export interface VerifiedNFTPaymentSelection {
  items: VerifiedNFTPaymentItem[]
  totalTierPrice: bigint
  minimumPaymentAmount: bigint
  pricingCurrency: number
  pricingDecimals: number
}

function isTierCurrencyCompatible(currency: number, token: NFTPaymentToken): boolean {
  if (token === 'ETH') return currency === 1 || currency === 61166
  return currency === 2 || isUsdcCurrency(currency)
}

function effectiveTierPrice(tier: Pick<NFTTier, 'price' | 'discountPercent'>): bigint {
  const discountPercent = tier.discountPercent ?? 0
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 200) {
    throw new Error(`Tier has an invalid discount: ${discountPercent}`)
  }
  if (tier.price < 0n) throw new Error('Tier has an invalid price')
  return tier.price - (tier.price * BigInt(discountPercent)) / 200n
}

function rescaleMinimumAmount(value: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return value
  if (fromDecimals < toDecimals) return value * 10n ** BigInt(toDecimals - fromDecimals)

  const divisor = 10n ** BigInt(fromDecimals - toDecimals)
  return (value + divisor - 1n) / divisor
}

/**
 * Re-validates an NFT cart against a fresh tier-store read. USD-priced tiers
 * use the protocol's USD/USDC route; the exact hook-aware preview remains the
 * final authority for any live price-feed conversion.
 */
export function assertSafeNftPaymentSelection(args: {
  tiers: readonly NFTTier[]
  tierIds: readonly number[]
  paymentToken: NFTPaymentToken
  paymentAmount: bigint
  paymentDecimals: number
}): VerifiedNFTPaymentSelection {
  const { tiers, tierIds, paymentToken, paymentAmount, paymentDecimals } = args
  if (tierIds.length === 0) throw new Error('Select at least one NFT')
  if (tierIds.length > 100) throw new Error('An NFT purchase may mint at most 100 items at once')
  if (paymentAmount < 0n) throw new Error('Payment amount cannot be negative')
  if (!Number.isInteger(paymentDecimals) || paymentDecimals < 0 || paymentDecimals > 18) {
    throw new Error('Payment token decimals are invalid')
  }

  const tiersById = new Map(tiers.map(tier => [tier.tierId, tier]))
  if (tiersById.size !== tiers.length) throw new Error('Tier store returned duplicate tier IDs')

  const quantities = new Map<number, number>()
  for (const tierId of tierIds) {
    if (!Number.isInteger(tierId) || tierId <= 0 || tierId > 0xffff) {
      throw new Error(`Invalid NFT tier ID: ${tierId}`)
    }
    quantities.set(tierId, (quantities.get(tierId) ?? 0) + 1)
  }

  let pricingCurrency: number | null = null
  let pricingDecimals: number | null = null
  let totalTierPrice = 0n
  const items: VerifiedNFTPaymentItem[] = []

  for (const [tierId, quantity] of quantities) {
    const tier = tiersById.get(tierId)
    if (!tier) throw new Error(`NFT tier ${tierId} is no longer available`)
    if (!Number.isSafeInteger(tier.remainingSupply) || tier.remainingSupply < quantity) {
      throw new Error(`NFT tier ${tierId} does not have enough supply remaining`)
    }
    if (!Number.isInteger(tier.pricingDecimals) || tier.pricingDecimals < 0 || tier.pricingDecimals > 18) {
      throw new Error(`NFT tier ${tierId} has invalid pricing decimals`)
    }
    if (!isTierCurrencyCompatible(tier.currency, paymentToken)) {
      throw new Error(`NFT tier ${tierId} cannot be bought with ${paymentToken}`)
    }
    if (pricingCurrency !== null && tier.currency !== pricingCurrency) {
      throw new Error('Selected NFT tiers use different pricing currencies')
    }
    if (pricingDecimals !== null && tier.pricingDecimals !== pricingDecimals) {
      throw new Error('Selected NFT tiers use different pricing decimals')
    }

    pricingCurrency = tier.currency
    pricingDecimals = tier.pricingDecimals
    const unitPrice = effectiveTierPrice(tier)
    totalTierPrice += unitPrice * BigInt(quantity)
    items.push({ tierId, quantity, name: tier.name, unitPrice })
  }

  const minimumPaymentAmount = rescaleMinimumAmount(
    totalTierPrice,
    pricingDecimals!,
    paymentDecimals,
  )
  if (paymentAmount < minimumPaymentAmount) {
    throw new Error('Payment amount is below the selected NFT total')
  }

  return {
    items,
    totalTierPrice,
    minimumPaymentAmount,
    pricingCurrency: pricingCurrency!,
    pricingDecimals: pricingDecimals!,
  }
}

export function assertSafeTierAdjustments(
  tiersToAdd: readonly JB721TierConfigInput[],
  tierIdsToRemove: readonly (number | bigint)[],
): void {
  if (tiersToAdd.length === 0 && tierIdsToRemove.length === 0) {
    throw new Error('A tier update must add or remove at least one tier')
  }
  if (tiersToAdd.length > 100 || tierIdsToRemove.length > 100) {
    throw new Error('A tier update may change at most 100 tiers at once')
  }

  const removalIds = new Set<string>()
  for (const id of tierIdsToRemove) {
    let parsed: bigint
    try {
      parsed = BigInt(id)
    } catch {
      throw new Error(`Invalid tier ID to remove: ${String(id)}`)
    }
    if (parsed <= 0n) throw new Error(`Invalid tier ID to remove: ${parsed}`)
    if (removalIds.has(parsed.toString())) throw new Error(`Duplicate tier ID to remove: ${parsed}`)
    removalIds.add(parsed.toString())
  }

  let previousCategory = -1
  tiersToAdd.forEach((tier, index) => {
    const label = `Tier ${index + 1}`
    let price: bigint
    try {
      price = BigInt(tier.price)
    } catch {
      throw new Error(`${label} has an invalid price`)
    }
    if (price < 0n || price >= 1n << 104n) throw new Error(`${label} has an invalid price`)
    if (!Number.isInteger(tier.initialSupply) || tier.initialSupply <= 0 || tier.initialSupply > 999_999_999) {
      throw new Error(`${label} has an invalid supply`)
    }
    if (!Number.isInteger(tier.votingUnits) || tier.votingUnits < 0 || tier.votingUnits > 0xffff_ffff) {
      throw new Error(`${label} has invalid voting units`)
    }
    if (tier.useVotingUnits ? tier.votingUnits === 0 : tier.votingUnits !== 0) {
      throw new Error(`${label} has an irrelevant voting-unit setting`)
    }
    if (!Number.isInteger(tier.reserveFrequency) || tier.reserveFrequency < 0 || tier.reserveFrequency > 0xffff) {
      throw new Error(`${label} has an invalid reserve frequency`)
    }
    if (!isAddress(tier.reserveBeneficiary)) throw new Error(`${label} has an invalid reserve beneficiary`)
    const reserveBeneficiary = tier.reserveBeneficiary.toLowerCase()
    if (tier.reserveFrequency === 0 && reserveBeneficiary !== zeroAddress) {
      throw new Error(`${label} has an irrelevant reserve beneficiary`)
    }
    if (
      tier.reserveFrequency > 0 &&
      (reserveBeneficiary === zeroAddress || reserveBeneficiary === DEAD_ADDRESS)
    ) {
      throw new Error(`${label} must use an explicit reserve beneficiary`)
    }
    if (tier.initialSupply === 1 && tier.reserveFrequency > 0) {
      throw new Error(`${label} has a deadlocked reserve configuration`)
    }
    if (tier.useReserveBeneficiaryAsDefault) {
      throw new Error(`${label} cannot replace the collection-wide reserve beneficiary`)
    }
    if (!Number.isInteger(tier.discountPercent) || tier.discountPercent < 0 || tier.discountPercent > 200) {
      throw new Error(`${label} has an invalid discount`)
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(tier.encodedIPFSUri) || tier.encodedIPFSUri === ZERO_BYTES32) {
      throw new Error(`${label} has no pinned metadata`)
    }
    if (!Number.isInteger(tier.category) || tier.category < previousCategory || tier.category > 0xff_ffff) {
      throw new Error('Tiers must be sorted by a valid category')
    }
    previousCategory = tier.category
    if ((tier.splitPercent ?? 0) !== 0 || (tier.splits?.length ?? 0) !== 0) {
      throw new Error(`${label} uses advanced payment routing, which is not supported in this flow`)
    }
  })
}
