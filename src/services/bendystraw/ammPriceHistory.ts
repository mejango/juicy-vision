import { NATIVE_TOKEN, USDC_ADDRESSES, type SupportedChainId } from '../../constants'
import { getNetworkOption, safeRequest } from './client'

const PAGE_SIZE = 1_000
const MAX_SWAPS = 3_000

const BUYBACK_POOLS_QUERY = `
  query IndexedBuybackPools($projectId: Int!, $chainId: Int!, $version: Int!) {
    buybackPoolEvents(
      where: { projectId: $projectId, chainId: $chainId, version: $version }
      orderBy: "timestamp"
      orderDirection: "desc"
      limit: 100
    ) {
      items {
        timestamp
        terminalToken
        poolId
        initialSqrtPriceX96
        projectTokenIsCurrency0
      }
    }
  }
`

const SWAPS_QUERY = `
  query IndexedPoolSwaps(
    $projectId: Int!
    $chainId: Int!
    $version: Int!
    $limit: Int!
    $offset: Int!
  ) {
    swapEvents(
      where: { projectId: $projectId, chainId: $chainId, version: $version }
      orderBy: "timestamp"
      orderDirection: "asc"
      limit: $limit
      offset: $offset
    ) {
      items {
        timestamp
        direction
        poolId
        terminalTokenAmount
        projectTokenAmount
        sqrtPriceX96
        projectTokenIsCurrency0
      }
      totalCount
    }
  }
`

type RawPool = {
  timestamp: number
  terminalToken: string
  poolId: string
  initialSqrtPriceX96: string | null
  projectTokenIsCurrency0: boolean | null
}

type RawSwap = {
  timestamp: number
  direction: string
  poolId: string | null
  terminalTokenAmount: string
  projectTokenAmount: string
  sqrtPriceX96: string | null
  projectTokenIsCurrency0: boolean | null
}

export type IndexedAmmPricePoint = { timestamp: number; price: number }

export type IndexedAmmPriceHistory = {
  hasPool: boolean
  poolId?: string | null
  points: IndexedAmmPricePoint[]
}

export function priceFromSqrtPriceX96(
  sqrtPriceX96: string | bigint,
  projectTokenIsCurrency0: boolean,
  terminalDecimals: number,
  projectTokenDecimals = 18,
): number | null {
  const sqrt = Number(BigInt(sqrtPriceX96))
  if (!Number.isFinite(sqrt) || sqrt <= 0) return null
  const ratio = sqrt / 2 ** 96
  const currency1PerCurrency0 = ratio * ratio
  const raw = projectTokenIsCurrency0
    ? currency1PerCurrency0
    : 1 / currency1PerCurrency0
  const price = raw * 10 ** (projectTokenDecimals - terminalDecimals)
  return Number.isFinite(price) && price > 0 ? price : null
}

function expectedTerminalToken(chainId: number, currency: number): string | null {
  if (currency === 1) return NATIVE_TOKEN.toLowerCase()
  if (currency === 2) {
    return USDC_ADDRESSES[chainId as SupportedChainId]?.toLowerCase() ?? null
  }
  return null
}

export async function fetchIndexedAmmPriceHistory({
  projectId,
  chainId,
  currency,
  terminalDecimals,
}: {
  projectId: string
  chainId: number
  currency: number
  terminalDecimals: number
}): Promise<IndexedAmmPriceHistory> {
  const terminalToken = expectedTerminalToken(chainId, currency)
  if (!terminalToken) return { hasPool: false, poolId: null, points: [] }

  const variables = {
    projectId: Number(projectId),
    chainId,
    version: 6,
  }
  const options = getNetworkOption(chainId)
  const poolData = await safeRequest<{
    buybackPoolEvents: { items: RawPool[] }
  }>(BUYBACK_POOLS_QUERY, variables, options)
  const pool = (poolData.buybackPoolEvents?.items ?? []).find(
    item => item.terminalToken.toLowerCase() === terminalToken,
  )
  if (!pool) return { hasPool: false, poolId: null, points: [] }

  const swaps: RawSwap[] = []
  let totalCount = 0
  while (swaps.length < MAX_SWAPS) {
    const page = await safeRequest<{
      swapEvents: { items: RawSwap[]; totalCount: number }
    }>(
      SWAPS_QUERY,
      {
        ...variables,
        limit: Math.min(PAGE_SIZE, MAX_SWAPS - swaps.length),
        offset: swaps.length,
      },
      options,
    )
    const items = page.swapEvents?.items ?? []
    totalCount = page.swapEvents?.totalCount ?? items.length
    swaps.push(...items)
    if (items.length === 0 || swaps.length >= totalCount) break
  }

  const points: IndexedAmmPricePoint[] = []
  if (
    pool.initialSqrtPriceX96 &&
    pool.projectTokenIsCurrency0 !== null
  ) {
    const price = priceFromSqrtPriceX96(
      pool.initialSqrtPriceX96,
      pool.projectTokenIsCurrency0,
      terminalDecimals,
    )
    if (price) points.push({ timestamp: Number(pool.timestamp), price })
  }

  for (const swap of swaps) {
    if (
      swap.direction === 'mint' ||
      !swap.poolId ||
      swap.poolId.toLowerCase() !== pool.poolId.toLowerCase()
    ) {
      continue
    }

    let price =
      swap.sqrtPriceX96 && swap.projectTokenIsCurrency0 !== null
        ? priceFromSqrtPriceX96(
            swap.sqrtPriceX96,
            swap.projectTokenIsCurrency0,
            terminalDecimals,
          )
        : null
    if (!price) {
      const terminalAmount = Number(BigInt(swap.terminalTokenAmount)) / 10 ** terminalDecimals
      const projectAmount = Number(BigInt(swap.projectTokenAmount)) / 1e18
      price = projectAmount > 0 ? terminalAmount / projectAmount : null
    }
    if (price && Number.isFinite(price)) {
      points.push({ timestamp: Number(swap.timestamp), price })
    }
  }

  points.sort((a, b) => a.timestamp - b.timestamp)
  return { hasPool: true, poolId: pool.poolId, points }
}
