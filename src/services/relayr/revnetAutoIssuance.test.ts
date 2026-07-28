/**
 * Regression: wizard-configured revnet auto-issuances must survive all the way
 * into the REVDeployer.deployFor calldata. REVDeployer ground truth
 * (revnet-core-v6 REVDeployer.sol): EVERY chain's config carries ALL rows
 * byte-identically (encodedConfiguration parity); the deployer mints only the
 * rows whose chainId == block.chainid. Rows are never filtered per chain.
 */

import { describe, it, expect } from 'vitest'
import { decodeFunctionData, parseEther } from 'viem'
import { encodeDeployRevnetTransaction, type JBDeployRevnetRequest } from './encoder'
import { REV_DEPLOYER_ABI } from '../../constants/abis'
import { ALL_CHAIN_IDS, NATIVE_TOKEN } from '../../constants'
import { initState } from '../../components/dynamic/create-flow/state'
import { buildRevnetStageConfigs } from '../../components/dynamic/create-flow/builders'

const A1 = '0x1111111111111111111111111111111111111111'
const A2 = '0x2222222222222222222222222222222222222222'
const SALT = `0x${'ab'.repeat(32)}`

const NATIVE_CONTEXT = [{ token: NATIVE_TOKEN, decimals: 18, currency: 61166 }]

interface DecodedAutoIssuance {
  chainId: number
  count: bigint
  beneficiary: string
}

function decodeStageAutoIssuances(data: `0x${string}`): DecodedAutoIssuance[][] {
  const { functionName, args } = decodeFunctionData({ abi: REV_DEPLOYER_ABI, data })
  expect(functionName).toBe('deployFor')
  const configuration = args[1] as unknown as {
    stageConfigurations: Array<{ autoIssuances: DecodedAutoIssuance[] }>
  }
  return configuration.stageConfigurations.map((sc) => sc.autoIssuances)
}

describe('REVDeployer.deployFor calldata — auto-issuance regression', () => {
  it('encodes every configured automint row into every chain calldata byte-identically', () => {
    const [chainA, chainB, chainC] = [ALL_CHAIN_IDS[0], ALL_CHAIN_IDS[1], ALL_CHAIN_IDS[2]]
    const s = initState()
    s.projectType = 'revnet'
    s.chainIds = [chainA, chainB, chainC]
    s.stages[0].autoIssuances = [
      { count: '100', address: A1, chainId: chainA },
      { count: '50', address: A2, chainId: chainC },
    ]

    const stageConfigurations = buildRevnetStageConfigs(s, 1_900_000_000)
    const request = {
      chainIds: [chainA, chainB, chainC],
      stageConfigurations,
      splitOperator: A1,
      description: { name: 'Rev', ticker: 'REV', tagline: '', uri: 'ipfs://uri', salt: SALT },
      creationFeeWei: '1000',
    } as unknown as JBDeployRevnetRequest & { creationFeeWei: string }

    const txs = [chainA, chainB, chainC].map((chainId) =>
      encodeDeployRevnetTransaction(chainId, 0, request, NATIVE_CONTEXT, 1),
    )

    // The calldata actually CONTAINS the automint rows (the historical drop).
    const expected = [
      { chainId: chainA, count: parseEther('100'), beneficiary: A1 },
      { chainId: chainC, count: parseEther('50'), beneficiary: A2 },
    ]
    for (const tx of txs) {
      const stages = decodeStageAutoIssuances(tx.txData.data as `0x${string}`)
      expect(stages[0]).toEqual(expected)
    }

    // encodedConfiguration parity: identical stage bytes on every chain.
    expect(txs[1].txData.data).toBe(txs[0].txData.data)
    expect(txs[2].txData.data).toBe(txs[0].txData.data)
  })
})
