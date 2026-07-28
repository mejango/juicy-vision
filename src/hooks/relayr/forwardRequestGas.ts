import type { Address, Hex } from 'viem'
import { getSafetyPublicClient } from '../../utils/transactionSafety'

/**
 * The ERC-2771 ForwardRequest `gas` field is signature-bound — the relayer
 * cannot raise it after the user signs — so an undersized cap kills the inner
 * call on every retry. Estimate the inner call on its chain and buffer it
 * 1.5x (the forwarder adds ERC-2771 suffix decoding and cold-account
 * overhead); when estimation is unavailable, fall back to a deliberately
 * high per-operation constant instead of a guess that can run out.
 */
export async function estimateForwardRequestGas(params: {
  chainId: number
  account: Address
  to: Address
  data: Hex
  value: bigint
  fallbackGas: bigint
}): Promise<bigint> {
  try {
    const estimate = await getSafetyPublicClient(params.chainId).estimateGas({
      account: params.account,
      to: params.to,
      data: params.data,
      value: params.value,
    })
    return (estimate * 3n) / 2n
  } catch {
    return params.fallbackGas
  }
}
