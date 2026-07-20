import { describe, expect, it } from 'vitest'
import { decodeFunctionData } from 'viem'
import { JB_CONTRACTS, USDC_ADDRESSES, type SupportedChainId } from '../../constants'
import { REV_DEPLOYER_ABI } from '../../constants/abis'
import { CHAIN_IDS } from '../../config/environment'
import { NATIVE_TOKEN } from '../../constants'
import {
  buildOmnichainDeployRevnetTransactions,
  type JBDeployRevnetRequest,
  type JBTerminalConfig,
} from './client'

const OPERATOR = '0x1234567890123456789012345678901234567890'
const PROJECT_URI = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3gq2t5lz2wqzzx4m6w6v7s7qm'
const SALT = `0x${'0'.repeat(63)}1`

function terminal(token: string, decimals: number): JBTerminalConfig {
  return {
    terminal: JB_CONTRACTS.JBMultiTerminal,
    accountingContextsToAccept: [{
      token,
      decimals,
      currency: Number(BigInt(token) & 0xffff_ffffn),
    }],
  }
}

function request(chainIds: number[]): JBDeployRevnetRequest {
  return {
    chainIds,
    stageConfigurations: [{
      startsAtOrAfter: 2_000_000_000,
      splitPercent: 2_000,
      initialIssuance: '1000000000000000000000000',
      issuanceCutFrequency: 604_800,
      issuanceCutPercent: 50_000_000,
      cashOutTaxRate: 1_000,
      extraMetadata: 0,
    }],
    splitOperator: OPERATOR,
    description: {
      name: 'Truthful Revnet',
      ticker: 'TRUTH',
      tagline: 'Test fixture',
      uri: PROJECT_URI,
      salt: SALT,
    },
    configureSuckers: false,
    creationFeesWei: Object.fromEntries(chainIds.map(chainId => [chainId, '0'])),
  }
}

function encodedBaseCurrency(deployRequest: JBDeployRevnetRequest): number {
  const [transaction] = buildOmnichainDeployRevnetTransactions(deployRequest).transactions
  const decoded = decodeFunctionData({
    abi: REV_DEPLOYER_ABI,
    data: transaction.txData.data as `0x${string}`,
  })
  const configuration = decoded.args?.[1] as unknown as { baseCurrency: number | bigint }
  return Number(configuration.baseCurrency)
}

describe('revnet accounting configuration', () => {
  it('encodes native-token issuance in ETH', () => {
    expect(encodedBaseCurrency(request([CHAIN_IDS.ethereum]))).toBe(1)
  })

  it('encodes canonical USDC issuance in USD', () => {
    const chainId = CHAIN_IDS.ethereum as SupportedChainId
    const deployRequest = request([chainId])
    deployRequest.terminalConfigurations = [terminal(USDC_ADDRESSES[chainId], 6)]

    expect(encodedBaseCurrency(deployRequest)).toBe(2)
  })

  it('blocks multiple accounting tokens in the simplified flow', () => {
    const chainId = CHAIN_IDS.ethereum as SupportedChainId
    const deployRequest = request([chainId])
    deployRequest.terminalConfigurations = [{
      terminal: JB_CONTRACTS.JBMultiTerminal,
      accountingContextsToAccept: [
        terminal(NATIVE_TOKEN, 18).accountingContextsToAccept[0],
        terminal(USDC_ADDRESSES[chainId], 6).accountingContextsToAccept[0],
      ],
    }]

    expect(() => buildOmnichainDeployRevnetTransactions(deployRequest))
      .toThrow('exactly one recognized accounting token')
  })

  it('blocks an unknown terminal even when its accounting context is valid', () => {
    const deployRequest = request([CHAIN_IDS.ethereum])
    deployRequest.terminalConfigurations = [{
      ...terminal(NATIVE_TOKEN, 18),
      terminal: '0x9999999999999999999999999999999999999999',
    }]

    expect(() => buildOmnichainDeployRevnetTransactions(deployRequest))
      .toThrow('Terminal not recognized')
  })

  it('blocks inconsistent base currencies across chains', () => {
    const chainIds = [CHAIN_IDS.ethereum, CHAIN_IDS.optimism]
    const deployRequest = request(chainIds)
    deployRequest.chainConfigs = [{
      chainId: CHAIN_IDS.optimism,
      terminalConfigurations: [terminal(USDC_ADDRESSES[CHAIN_IDS.optimism as SupportedChainId], 6)],
    }]

    expect(() => buildOmnichainDeployRevnetTransactions(deployRequest))
      .toThrow('same recognized base currency')
  })
})
