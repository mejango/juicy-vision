import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTRACTS,
  SUCKER_DEPLOYERS as SHARED_SUCKER_DEPLOYERS,
} from '../../shared/chains'
import {
  CHAIN_SUCKER_DEPLOYER,
  SUCKER_DEPLOYERS as NATIVE_SUCKER_CONSTANTS,
} from './chains'
import {
  CCIP_SUCKER_DEPLOYER_ADDRESSES,
  NATIVE_SUCKER_DEPLOYER_ADDRESSES,
} from '../utils/suckerConfig'

interface SuckerDeployerFixture {
  pair: string
  address: `0x${string}`
  routes: Array<{
    chainId: number
    remoteChainId: number
    manifest: string
  }>
}

interface ProtocolFixture {
  source: { commit: string }
  chains: Record<string, { name: string; deploymentDir: string }>
  contracts: Record<string, { address: string; deployedOn: number[] }>
  suckerDeployers: {
    ccip: SuckerDeployerFixture[]
    native: SuckerDeployerFixture[]
  }
  knownAbsences: Array<{ chainId: number; contract: string; reason: string }>
}

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), 'src/test/protocol-deployments-v6.fixture.json'),
  'utf8',
)) as ProtocolFixture

describe('deploy-all-v6 protocol fixture', () => {
  it('pins every application contract address to the canonical deployment snapshot', () => {
    expect(fixture.source.commit).toMatch(/^[0-9a-f]{40}$/)
    for (const [name, appAddress] of Object.entries(CONTRACTS)) {
      expect(fixture.contracts[name], `${name} missing from fixture`).toBeDefined()
      expect(appAddress.toLowerCase()).toBe(fixture.contracts[name].address)
    }
  })

  it('represents every missing chain capability explicitly', () => {
    const chainIds = Object.keys(fixture.chains).map(Number)
    const recordedAbsences = fixture.knownAbsences
      .map(item => `${item.chainId}:${item.contract}`)
      .sort()
    const derivedAbsences = Object.entries(fixture.contracts)
      .flatMap(([contract, deployment]) => chainIds
        .filter(chainId => !deployment.deployedOn.includes(chainId))
        .map(chainId => `${chainId}:${contract}`))
      .sort()

    expect(recordedAbsences).toEqual(derivedAbsences)
    expect(recordedAbsences).toEqual([
      '11155420:JBBuybackHook',
      '11155420:JBRouterTerminal',
    ])
    expect(fixture.knownAbsences.every(item => item.reason.length > 0)).toBe(true)
  })

  it('keeps transaction-authority contracts available on every supported chain', () => {
    const allChains = Object.keys(fixture.chains).map(Number).sort((a, b) => a - b)
    for (const name of [
      'JBController',
      'JBDirectory',
      'JBMultiTerminal',
      'JBProjects',
      'JBRulesets',
      'JBTokens',
      'ERC2771Forwarder',
    ]) {
      expect([...fixture.contracts[name].deployedOn].sort((a, b) => a - b)).toEqual(allChains)
    }
  })

  it('pins every directional CCIP and native route used by the app', () => {
    const routeTuples = (deployers: SuckerDeployerFixture[]) => deployers
      .flatMap(deployer => deployer.routes.map(route =>
        `${route.chainId}:${route.remoteChainId}:${deployer.address.toLowerCase()}`))
      .sort()
    const mapTuples = (mapping: Record<number, Record<number, `0x${string}`>>) =>
      Object.entries(mapping).flatMap(([chainId, remote]) =>
        Object.entries(remote).map(([remoteChainId, address]) =>
          `${chainId}:${remoteChainId}:${address.toLowerCase()}`))
        .sort()

    expect(mapTuples(CCIP_SUCKER_DEPLOYER_ADDRESSES)).toEqual(
      routeTuples(fixture.suckerDeployers.ccip),
    )
    expect(mapTuples(NATIVE_SUCKER_DEPLOYER_ADDRESSES)).toEqual(
      routeTuples(fixture.suckerDeployers.native),
    )
  })

  it('keeps both app allowlists exact: no missing or unpinned sucker deployer', () => {
    const fixtureAddresses = [...new Set([
      ...fixture.suckerDeployers.ccip,
      ...fixture.suckerDeployers.native,
    ].map(deployer => deployer.address.toLowerCase()))].sort()
    const fixtureNative = [...new Set(fixture.suckerDeployers.native
      .map(deployer => deployer.address.toLowerCase()))].sort()

    expect([...new Set(SHARED_SUCKER_DEPLOYERS.map(address => address.toLowerCase()))].sort())
      .toEqual(fixtureAddresses)
    expect(Object.values(NATIVE_SUCKER_CONSTANTS).map(address => address.toLowerCase()).sort())
      .toEqual(fixtureNative)
    expect([...new Set(Object.values(CHAIN_SUCKER_DEPLOYER)
      .map(address => address.toLowerCase()))].sort())
      .toEqual(fixtureNative)
  })
})
