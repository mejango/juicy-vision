import { decodeEventLog, isAddressEqual, type Address, type Hex } from 'viem'
import { JB_CONTRACTS } from '../constants'

const LAUNCH_PROJECT_EVENT_ABI = [{
  name: 'LaunchProject',
  type: 'event',
  inputs: [
    { name: 'rulesetId', type: 'uint256', indexed: false },
    { name: 'projectId', type: 'uint256', indexed: false },
    { name: 'projectUri', type: 'string', indexed: false },
    { name: 'memo', type: 'string', indexed: false },
    { name: 'caller', type: 'address', indexed: false },
  ],
}] as const

export function decodeRecognizedLaunchProjectLog(log: {
  address: Address
  data: Hex
  topics: readonly Hex[]
}): number | null {
  if (!isAddressEqual(log.address, JB_CONTRACTS.JBController)) return null

  try {
    const decoded = decodeEventLog({
      abi: LAUNCH_PROJECT_EVENT_ABI,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
      strict: true,
    })
    if (decoded.eventName !== 'LaunchProject') return null
    const projectId = Number(decoded.args.projectId)
    return Number.isSafeInteger(projectId) && projectId > 0 ? projectId : null
  } catch {
    return null
  }
}
