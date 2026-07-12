import { describe, expect, it } from 'vitest'
import { encodeEventTopics, encodeAbiParameters, type Address, type Hex } from 'viem'
import { JB_CONTRACTS } from '../constants'
import { decodeRecognizedLaunchProjectLog } from './launchReceipt'

const EVENT = {
  name: 'LaunchProject',
  type: 'event',
  inputs: [
    { name: 'rulesetId', type: 'uint256', indexed: false },
    { name: 'projectId', type: 'uint256', indexed: false },
    { name: 'projectUri', type: 'string', indexed: false },
    { name: 'memo', type: 'string', indexed: false },
    { name: 'caller', type: 'address', indexed: false },
  ],
} as const

function launchLog(address: Address) {
  return {
    address,
    topics: encodeEventTopics({ abi: [EVENT], eventName: 'LaunchProject' }) as Hex[],
    data: encodeAbiParameters(
      EVENT.inputs.map(input => ({ type: input.type })),
      [123n, 42n, 'ipfs://bafybeigdyrzt', 'Launch', '0x1111111111111111111111111111111111111111'],
    ),
  }
}

describe('V6 project launch receipt decoding', () => {
  it('decodes the unindexed V6 project ID from the recognized controller', () => {
    expect(decodeRecognizedLaunchProjectLog(launchLog(JB_CONTRACTS.JBController))).toBe(42)
  })

  it('rejects an otherwise identical event from an unknown contract', () => {
    expect(decodeRecognizedLaunchProjectLog(
      launchLog('0x9999999999999999999999999999999999999999'),
    )).toBeNull()
  })
})
