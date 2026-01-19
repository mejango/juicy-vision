// Uniswap V3 Subgraph service for fetching pool price history

// Subgraph IDs per chain (from The Graph)
const UNISWAP_SUBGRAPH_IDS: Record<number, string> = {
  1: '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV', // Ethereum Mainnet
  10: 'A3Np3RQbaBA6oKJgiwDJeo5T3zrYfGHPWFYayMwtNDum', // Optimism
  42161: '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV', // Arbitrum
  8453: 'ESnjgAG9NjfmHypk4Huu4PVvz55fUwpyrRqHF21thoLJ', // Base
}

const SECONDS_PER_DAY = 86400

export interface PoolPriceDataPoint {
  timestamp: number
  price: number
}

interface PoolHourData {
  periodStartUnix: number
  token0Price: string
  token1Price: string
}

interface PoolDayData {
  date: number
  token0Price: string
  token1Price: string
}

interface PoolDataResponse {
  pool: {
    token0: { id: string }
    token1: { id: string }
    poolHourData?: PoolHourData[]
    poolDayData?: PoolDayData[]
  } | null
}

function getSubgraphUrl(chainId: number): string | null {
  const subgraphId = UNISWAP_SUBGRAPH_IDS[chainId]
  if (!subgraphId) return null

  // Use The Graph's decentralized network
  // Note: In production, you'd want to use an API key
  // For now, use the public gateway which has rate limits
  const apiKey = import.meta.env.VITE_THEGRAPH_API_KEY

  if (apiKey) {
    return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`
  }

  // Fallback to hosted service (deprecated but still works)
  // This is a fallback - the decentralized network is preferred
  return `https://api.thegraph.com/subgraphs/id/${subgraphId}`
}

function buildPoolQuery(poolAddress: string, startTimestamp: number, useHourly: boolean): string {
  const poolId = poolAddress.toLowerCase()

  if (useHourly) {
    return `{
      pool(id: "${poolId}") {
        token0 { id }
        token1 { id }
        poolHourData(
          first: 1000
          orderBy: periodStartUnix
          orderDirection: asc
          where: { periodStartUnix_gte: ${startTimestamp} }
        ) {
          periodStartUnix
          token0Price
          token1Price
        }
      }
    }`
  }

  return `{
    pool(id: "${poolId}") {
      token0 { id }
      token1 { id }
      poolDayData(
        first: 1000
        orderBy: date
        orderDirection: asc
        where: { date_gte: ${startTimestamp} }
      ) {
        date
        token0Price
        token1Price
      }
    }
  }`
}

// Cache for pool data (simple in-memory cache)
const poolDataCache = new Map<string, { data: PoolPriceDataPoint[]; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export async function fetchPoolPriceHistory(
  poolAddress: string,
  projectTokenAddress: string,
  chainId: number,
  startTimestamp: number,
  useHourly: boolean = false
): Promise<PoolPriceDataPoint[]> {
  const cacheKey = `${poolAddress}-${chainId}-${startTimestamp}-${useHourly}`
  const cached = poolDataCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data
  }

  const url = getSubgraphUrl(chainId)
  if (!url) {
    console.warn(`[AMM] No subgraph URL for chain ${chainId}`)
    return []
  }

  try {
    const query = buildPoolQuery(poolAddress, startTimestamp, useHourly)

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    if (!response.ok) {
      console.error(`[AMM] Subgraph request failed: ${response.status}`)
      return []
    }

    const json = await response.json()

    if (json.errors) {
      console.error('[AMM] Subgraph errors:', json.errors)
      return []
    }

    const data = json.data as PoolDataResponse

    if (!data.pool) {
      console.warn(`[AMM] Pool not found: ${poolAddress}`)
      return []
    }

    const { token0, token1, poolHourData, poolDayData } = data.pool

    // Determine if project token is token0 or token1
    const projectTokenLower = projectTokenAddress.toLowerCase()
    const isToken0 = token0.id.toLowerCase() === projectTokenLower
    const isToken1 = token1.id.toLowerCase() === projectTokenLower

    if (!isToken0 && !isToken1) {
      console.warn(`[AMM] Project token ${projectTokenAddress} not found in pool`)
      return []
    }

    // Extract price data
    // If project token is token0, we want token1Price (ETH per project token)
    // If project token is token1, we want token0Price (ETH per project token)
    const rawData = useHourly ? poolHourData : poolDayData

    if (!rawData || rawData.length === 0) {
      return []
    }

    const priceData: PoolPriceDataPoint[] = []

    for (const item of rawData) {
      const timestamp = useHourly
        ? (item as PoolHourData).periodStartUnix
        : (item as PoolDayData).date

      // Get the appropriate price based on token position
      const priceStr = isToken0
        ? (item as PoolHourData | PoolDayData).token1Price
        : (item as PoolHourData | PoolDayData).token0Price

      const price = parseFloat(priceStr)

      // Filter out invalid prices
      if (isNaN(price) || price <= 0 || !isFinite(price)) {
        continue
      }

      // The price from Uniswap is tokens per ETH, we want ETH per token
      // So we need to invert it
      const ethPerToken = 1 / price

      if (isFinite(ethPerToken) && ethPerToken > 0) {
        priceData.push({ timestamp, price: ethPerToken })
      }
    }

    // Sort by timestamp
    priceData.sort((a, b) => a.timestamp - b.timestamp)

    // Cache the result
    poolDataCache.set(cacheKey, { data: priceData, timestamp: Date.now() })

    return priceData
  } catch (err) {
    console.error('[AMM] Failed to fetch pool price history:', err)
    return []
  }
}

// Helper to determine if we should use hourly data based on range
export function shouldUseHourlyData(range: string): boolean {
  return range === '7d' || range === '1d'
}

// Helper to get start timestamp for a range
export function getPoolRangeStartTimestamp(range: string, projectStart?: number): number {
  const now = Math.floor(Date.now() / 1000)

  switch (range) {
    case '1d':
      return now - SECONDS_PER_DAY
    case '7d':
      return now - 7 * SECONDS_PER_DAY
    case '30d':
      return now - 30 * SECONDS_PER_DAY
    case '3m':
    case '90d':
      return now - 90 * SECONDS_PER_DAY
    case '1y':
      return now - 365 * SECONDS_PER_DAY
    case 'all':
      return projectStart || 0
    default:
      return now - 365 * SECONDS_PER_DAY
  }
}
