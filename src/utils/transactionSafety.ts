import {
  createPublicClient,
  fallback,
  http,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
} from 'viem'
import {
  MAINNET_RPC_ENDPOINTS,
  MAINNET_VIEM_CHAINS,
  RPC_ENDPOINTS,
  VIEM_CHAINS,
  type SupportedChainId,
} from '../constants'

export function getSafetyPublicClient(chainId: number): PublicClient {
  const chain = (VIEM_CHAINS[chainId as SupportedChainId] ||
    MAINNET_VIEM_CHAINS[chainId as keyof typeof MAINNET_VIEM_CHAINS]) as Chain | undefined
  const rpcUrls = RPC_ENDPOINTS[chainId] || MAINNET_RPC_ENDPOINTS[chainId] || []

  if (!chain || rpcUrls.length === 0) {
    throw new Error(`Unsupported chain ${chainId}`)
  }

  return createPublicClient({
    chain,
    transport: fallback(rpcUrls.map(url => http(url))),
  }) as PublicClient
}

/**
 * Use twice the RPC estimate for all client-submitted transactions. Terminal
 * calls can catch an out-of-gas internal fee payment, making that cheaper
 * fallback path appear successful to eth_estimateGas. Unused gas is not spent.
 */
export function gasWithHeadroom(estimate: bigint): bigint {
  return estimate * 2n
}

export async function estimateTransactionGasWithHeadroom(params: {
  chainId: number
  account: Address
  to: Address
  data: Hex
  value?: bigint
}): Promise<bigint> {
  const estimate = await getSafetyPublicClient(params.chainId).estimateGas({
    account: params.account,
    to: params.to,
    data: params.data,
    value: params.value ?? 0n,
  })
  return gasWithHeadroom(estimate)
}

export async function simulateTransaction(params: {
  chainId: number
  account: Address
  to: Address
  data: Hex
  value?: bigint
}): Promise<void> {
  const client = getSafetyPublicClient(params.chainId)
  await client.call({
    account: params.account,
    to: params.to,
    data: params.data,
    value: params.value || 0n,
  })
}

export async function waitForSuccessfulTransaction(chainId: number, hash: Hash): Promise<void> {
  const receipt = await getSafetyPublicClient(chainId).waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    throw new Error('Transaction reverted')
  }
}
