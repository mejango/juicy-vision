import { describe, expect, it } from 'vitest'
import { encodeFunctionData } from 'viem'
import { CHAIN_IDS, RELAYR_APP_ID } from '../../config/environment'
import { JB_CONTRACTS } from '../../constants'
import {
  ERC2771_FORWARDER_ABI,
  ERC2771_FORWARDER_ADDRESS,
  JB_CONTROLLER_ABI,
} from '../../constants/abis'
import { createReviewedForwarderBundle, type BalanceBundleRequest } from './client'

const SIGNER = '0x1234567890123456789012345678901234567890'
const UNKNOWN = '0x9999999999999999999999999999999999999999'

function setUriData() {
  return encodeFunctionData({
    abi: JB_CONTROLLER_ABI,
    functionName: 'setUriOf',
    args: [1n, 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm'],
  })
}

function request(innerTarget: `0x${string}`, innerData = setUriData()): BalanceBundleRequest {
  const data = encodeFunctionData({
    abi: ERC2771_FORWARDER_ABI,
    functionName: 'execute',
    args: [{
      from: SIGNER,
      to: innerTarget,
      value: 0n,
      gas: 500_000n,
      deadline: Math.floor(Date.now() / 1000) + 3_600,
      data: innerData,
      signature: `0x${'11'.repeat(65)}`,
    }],
  })
  return {
    app_id: RELAYR_APP_ID,
    transactions: [{
      chain: CHAIN_IDS.ethereum,
      target: ERC2771_FORWARDER_ADDRESS,
      data,
      value: '0',
    }],
    perform_simulation: true,
    virtual_nonce_mode: 'Disabled',
  }
}

describe('reviewed self-custody Relayr bundles', () => {
  it('blocks an unknown inner contract even when its interface is valid', async () => {
    await expect(createReviewedForwarderBundle(request(UNKNOWN)))
      .rejects.toThrow('Forwarded contract not recognized')
  })

  it('blocks an unknown outer forwarder', async () => {
    const bundle = request(JB_CONTRACTS.JBController)
    bundle.transactions[0].target = UNKNOWN

    await expect(createReviewedForwarderBundle(bundle))
      .rejects.toThrow('Forwarder not recognized')
  })

  it('blocks an unreviewed function on a recognized controller', async () => {
    const unknownData = '0x12345678' as `0x${string}`

    await expect(createReviewedForwarderBundle(request(JB_CONTRACTS.JBController, unknownData)))
      .rejects.toThrow()
  })
})
