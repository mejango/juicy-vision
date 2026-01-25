// Uniswap V3 service for pool discovery and price history
import { createPublicClient, http, type Address } from 'viem'
import { mainnet, optimism, arbitrum, base } from 'viem/chains'

// Subgraph IDs per chain (from The Graph - matching revnet-app)
const UNISWAP_SUBGRAPH_IDS: Record<number, string> = {
  1: '6XvRX3WHSvzBVTiPdF66XSBVbxWuHqijWANbjJxRDyzr', // Ethereum Mainnet
  10: '38P996LTWvW4SKb8BP6bbJZ8pqsa6efRzreNMzaYkUCH', // Optimism
  42161: '3SvHymr16c2tfWziXuGYfa4kaRGDV7XbBb85hMeBHE9p', // Arbitrum
  8453: 'HMuAwufqZ1YCRmzL2SfHTVkzZovC9VL2UAKhjvRqKiR1', // Base
}

// WETH addresses per chain
const WETH_ADDRESSES: Record<number, Address> = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Ethereum Mainnet
  10: '0x4200000000000000000000000000000000000006', // Optimism
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // Arbitrum
  8453: '0x4200000000000000000000000000000000000006', // Base
}

// USDC addresses per chain (native USDC where available)
const USDC_ADDRESSES: Record<number, Address> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum Mainnet
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // Optimism (native USDC)
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum (native USDC)
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base (native USDC)
}

// Quote tokens to check for pools (in order of preference)
export type QuoteToken = 'WETH' | 'USDC'

// Uniswap V3 Factory addresses per chain
// Note: Base uses a different factory address than other chains
const UNISWAP_V3_FACTORY: Record<number, Address> = {
  1: '0x1F98431c8aD98523631AE4a59f267346ea31F984',     // Ethereum Mainnet
  10: '0x1F98431c8aD98523631AE4a59f267346ea31F984',    // Optimism
  42161: '0x1F98431c8aD98523631AE4a59f267346ea31F984', // Arbitrum
  8453: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',  // Base (different!)
}

// Fee tiers to check (in basis points: 500 = 0.05%, 3000 = 0.3%, 10000 = 1%)
const FEE_TIERS = [10000, 3000, 500] as const

// Uniswap V3 Factory ABI (just getPool function)
const FACTORY_ABI = [
  {
    name: 'getPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
] as const

// Viem chains mapping - using Record with union of supported chain types
const VIEM_CHAINS: Record<number, typeof mainnet | typeof optimism | typeof arbitrum | typeof base> = {
  1: mainnet,
  10: optimism,
  42161: arbitrum,
  8453: base,
}

// RPC endpoints (using Ankr for reliability)
const RPC_ENDPOINTS: Record<number, string> = {
  1: 'https://rpc.ankr.com/eth',
  10: 'https://rpc.ankr.com/optimism',
  42161: 'https://rpc.ankr.com/arbitrum',
  8453: 'https://rpc.ankr.com/base',
}

// Cache for pool addresses
const poolAddressCache = new Map<string, { address: Address | null; timestamp: number }>()
const POOL_CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export interface PoolInfo {
  address: Address
  fee: number
  projectTokenAddress: Address
  quoteToken: QuoteToken
  quoteTokenAddress: Address
}

// Discover Uniswap V3 pool for a project token
export async function discoverUniswapPool(
  projectTokenAddress: string,
  chainId: number
): Promise<PoolInfo | null> {
  const cacheKey = `${projectTokenAddress.toLowerCase()}-${chainId}`
  const cached = poolAddressCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < POOL_CACHE_DURATION) {
    if (!cached.address) return null
    // Note: we don't cache quoteToken info, so we return WETH as default
    return {
      address: cached.address,
      fee: 10000,
      projectTokenAddress: projectTokenAddress as Address,
      quoteToken: 'WETH',
      quoteTokenAddress: WETH_ADDRESSES[chainId],
    }
  }

  const weth = WETH_ADDRESSES[chainId]
  const usdc = USDC_ADDRESSES[chainId]
  const chain = VIEM_CHAINS[chainId]
  const rpc = RPC_ENDPOINTS[chainId]
  const factory = UNISWAP_V3_FACTORY[chainId]

  if (!chain || !rpc || !factory) {
    console.warn(`[AMM] Unsupported chain ${chainId} for pool discovery`)
    return null
  }

  try {
    const client = createPublicClient({
      chain,
      transport: http(rpc),
    })

    const tokenAddress = projectTokenAddress as Address

    // Build list of quote tokens to check
    const quoteTokens: { token: QuoteToken; address: Address }[] = []
    if (weth) quoteTokens.push({ token: 'WETH', address: weth })
    if (usdc) quoteTokens.push({ token: 'USDC', address: usdc })

    // Try each quote token and fee tier to find a pool
    for (const { token: quoteToken, address: quoteAddress } of quoteTokens) {
      for (const fee of FEE_TIERS) {
        const poolAddress = await client.readContract({
          address: factory,
          abi: FACTORY_ABI,
          functionName: 'getPool',
          args: [tokenAddress, quoteAddress, fee],
        })

        // Check if pool exists (not zero address)
        if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
          poolAddressCache.set(cacheKey, { address: poolAddress, timestamp: Date.now() })
          return {
            address: poolAddress,
            fee,
            projectTokenAddress: tokenAddress,
            quoteToken,
            quoteTokenAddress: quoteAddress,
          }
        }
      }
    }

    // No pool found
    poolAddressCache.set(cacheKey, { address: null, timestamp: Date.now() })
    return null
  } catch (err) {
    console.error('[AMM] Failed to discover pool:', err)
    return null
  }
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

// Returns { url, useProxy } for TheGraph requests
function getSubgraphConfig(chainId: number, apiKey?: string): { url: string; useProxy: boolean } | null {
  const subgraphId = UNISWAP_SUBGRAPH_IDS[chainId]
  if (!subgraphId) return null

  // If backend API is configured, use the proxy endpoint to keep API keys secure
  const backendUrl = import.meta.env.VITE_API_URL
  if (backendUrl) {
    return { url: `${backendUrl}/api/proxy/thegraph/uniswap`, useProxy: true }
  }

  // Use The Graph's decentralized network with API key (direct access)
  const key = apiKey || import.meta.env.VITE_THEGRAPH_API_KEY
  if (key) {
    return { url: `https://gateway.thegraph.com/api/${key}/subgraphs/id/${subgraphId}`, useProxy: false }
  }

  // No API key available - cannot access decentralized network
  console.warn('[AMM] No Graph API key available - pool price history unavailable')
  return null
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
  useHourly: boolean = false,
  theGraphApiKey?: string
): Promise<PoolPriceDataPoint[]> {
  const cacheKey = `${poolAddress}-${chainId}-${startTimestamp}-${useHourly}`
  const cached = poolDataCache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data
  }

  const config = getSubgraphConfig(chainId, theGraphApiKey)
  if (!config) {
    console.warn(`[AMM] No subgraph URL for chain ${chainId}`)
    return []
  }

  try {
    const query = buildPoolQuery(poolAddress, startTimestamp, useHourly)

    // Use different request format for proxy vs direct access
    const body = config.useProxy
      ? JSON.stringify({ chainId, query })  // Proxy expects chainId + query
      : JSON.stringify({ query })            // Direct access just needs query

    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
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
    // Uniswap V3 subgraph price semantics:
    // - token0Price = how many token0 you get for 1 token1
    // - token1Price = how many token1 you get for 1 token0
    //
    // If project token is token0, token1Price gives us "quote per project token" (e.g., USDC per PROJECT)
    // If project token is token1, token0Price gives us "quote per project token" (e.g., ETH per PROJECT)
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
      // If project is token0: token1Price = quote per project (what we want)
      // If project is token1: token0Price = quote per project (what we want)
      const priceStr = isToken0
        ? (item as PoolHourData | PoolDayData).token1Price
        : (item as PoolHourData | PoolDayData).token0Price

      const quotePerToken = parseFloat(priceStr)

      // Filter out invalid prices
      if (isNaN(quotePerToken) || quotePerToken <= 0 || !isFinite(quotePerToken)) {
        continue
      }

      priceData.push({ timestamp, price: quotePerToken })
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
