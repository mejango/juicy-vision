import type { JBChainId } from '@bananapus/nana-sdk-core'
import { decodeLaunchProjectId } from '@bananapus/nana-sdk-core/v6'
import type { Address, Hex } from 'viem'

export function decodeRecognizedLaunchProjectLog(
  log: { address: Address; data: Hex; topics: readonly Hex[] },
  chainId: JBChainId,
): number | null {
  const projectId = decodeLaunchProjectId(log, { chainId })
  if (
    projectId === null ||
    projectId <= 0n ||
    projectId > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return null
  }
  return Number(projectId)
}
