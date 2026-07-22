import { decodeFunctionData } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { JB_CONTROLLER_ABI } from '../constants/abis/jbController'
import { JB_CONTRACTS } from '../constants/chains'
import {
  buildOmnichainSetUriTransactions,
  buildSetUriTransaction,
} from './omnichainDeployer'
import { submitManagedSetUriBundle } from '../hooks/relayr/useOmnichainSetUri'

const URI = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm'

describe('omnichain setUri transaction boundary', () => {
  it('encodes each chain-specific project ID against only the canonical live controller', () => {
    const transactions = buildOmnichainSetUriTransactions({
      chainProjectMappings: [
        { chainId: 1, projectId: 7, controller: JB_CONTRACTS.JBController },
        { chainId: 10, projectId: 19n, controller: JB_CONTRACTS.JBController },
      ],
      uri: URI,
    })

    expect(transactions.map(tx => ({ chainId: tx.chainId, to: tx.to, value: tx.value }))).toEqual([
      { chainId: 1, to: JB_CONTRACTS.JBController, value: '0x0' },
      { chainId: 10, to: JB_CONTRACTS.JBController, value: '0x0' },
    ])
    const decoded = transactions.map(tx => decodeFunctionData({
      abi: JB_CONTROLLER_ABI,
      data: tx.data,
    }))
    expect(decoded.map(call => call.functionName)).toEqual(['setUriOf', 'setUriOf'])
    expect(decoded.map(call => call.args)).toEqual([[7n, URI], [19n, URI]])
  })

  it('rejects non-IPFS metadata before producing calldata', () => {
    expect(() => buildSetUriTransaction({
      chainId: 1,
      projectId: 7,
      uri: 'https://example.com/project.json',
      controller: JB_CONTRACTS.JBController,
    })).toThrow('valid IPFS CID')
  })

  it('rejects an unrecognized controller route even when the call arguments are valid', () => {
    expect(() => buildSetUriTransaction({
      chainId: 1,
      projectId: 7,
      uri: URI,
      controller: '0x1111111111111111111111111111111111111111',
    })).toThrow('Controller not recognized')
  })
})

describe('managed setUri Relayr submission', () => {
  it('binds exact calls and the reviewed operation key to the managed submit', async () => {
    const submit = vi.fn().mockResolvedValue({ bundleId: 'uri-bundle' })
    const transactions = [{ chainId: 1, target: JB_CONTRACTS.JBController, data: '0x1234', value: '0' }]
    await expect(submitManagedSetUriBundle(
      transactions,
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      'set-uri-project-7',
      submit,
    )).resolves.toEqual({ bundleId: 'uri-bundle' })
    expect(submit).toHaveBeenCalledWith(
      transactions,
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      'set-uri-project-7',
    )
  })
})
