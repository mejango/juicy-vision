import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const FIXTURE_PATH = resolve('src/test/protocol-deployments-v6.fixture.json')
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
const failures = []

function fail(message) {
  failures.push(message)
}

function address(value) {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value)
}

if (fixture.schemaVersion !== 1) fail('unsupported protocol fixture schema')
if (!/^[0-9a-f]{40}$/.test(fixture.source?.commit || '')) {
  fail('fixture source must pin a full deploy-all-v6 commit')
}

const chainIds = Object.keys(fixture.chains).map(Number)
const chainIdSet = new Set(chainIds)
const absences = new Set(
  fixture.knownAbsences.map(item => `${item.chainId}:${item.contract}`),
)

for (const [name, contract] of Object.entries(fixture.contracts)) {
  if (!address(contract.address)) fail(`${name} has a malformed or non-normalized address`)
  const deployed = new Set(contract.deployedOn)
  if (deployed.size !== contract.deployedOn.length) fail(`${name} repeats a chain capability`)
  for (const chainId of contract.deployedOn) {
    if (!chainIdSet.has(chainId)) fail(`${name} references unknown chain ${chainId}`)
    if (absences.has(`${chainId}:${name}`)) fail(`${name} is both present and absent on ${chainId}`)
  }
  for (const chainId of chainIds) {
    const absent = absences.has(`${chainId}:${name}`)
    if (!deployed.has(chainId) && !absent) {
      fail(`${name} is missing on ${chainId} without an explicit knownAbsences entry`)
    }
  }
}

for (const item of fixture.knownAbsences) {
  if (!chainIdSet.has(item.chainId)) fail(`absence references unknown chain ${item.chainId}`)
  if (!fixture.contracts[item.contract]) fail(`absence references unknown contract ${item.contract}`)
  if (!item.reason) fail(`absence ${item.chainId}:${item.contract} needs a reason`)
}

const suckerDeployers = fixture.suckerDeployers
if (!suckerDeployers || !Array.isArray(suckerDeployers.ccip) || !Array.isArray(suckerDeployers.native)) {
  fail('fixture must declare CCIP and native sucker deployer routes')
}

const suckerRoutes = []
const suckerAddresses = new Set()
for (const kind of ['ccip', 'native']) {
  const pairs = suckerDeployers?.[kind] || []
  const pairNames = new Set()
  const routeKeys = new Set()
  for (const deployer of pairs) {
    if (pairNames.has(deployer.pair)) fail(`${kind} repeats pair ${deployer.pair}`)
    pairNames.add(deployer.pair)
    if (!address(deployer.address)) fail(`${kind} ${deployer.pair} has a malformed address`)
    suckerAddresses.add(deployer.address)
    if (!Array.isArray(deployer.routes) || deployer.routes.length !== 4) {
      fail(`${kind} ${deployer.pair} must describe both directions on mainnet and testnet`)
      continue
    }
    for (const route of deployer.routes) {
      const key = `${route.chainId}:${route.remoteChainId}`
      if (routeKeys.has(key)) fail(`${kind} repeats route ${key}`)
      routeKeys.add(key)
      if (!chainIdSet.has(route.chainId)) fail(`${kind} route ${key} starts on an unknown chain`)
      if (!chainIdSet.has(route.remoteChainId)) fail(`${kind} route ${key} ends on an unknown chain`)
      if (route.chainId === route.remoteChainId) fail(`${kind} route ${key} cannot bridge to itself`)
      if (typeof route.manifest !== 'string' || !/^JB[A-Za-z0-9_]+\.json$/.test(route.manifest)) {
        fail(`${kind} route ${key} has an invalid deployment manifest name`)
      }
      suckerRoutes.push({ kind, pair: deployer.pair, address: deployer.address, ...route })
    }
  }
}
if ((suckerDeployers?.ccip.length || 0) !== 6) fail('fixture must cover all six CCIP chain pairs')
if ((suckerDeployers?.native.length || 0) !== 3) fail('fixture must cover all three native L1/L2 pairs')

const suckerSource = readFileSync(resolve('src/utils/suckerConfig.ts'), 'utf8')
const ccipPairBody = suckerSource.match(/const CCIP_PAIR_DEPLOYERS = \{([\s\S]*?)\n\}/)?.[1]
if (!ccipPairBody) {
  fail('could not parse src/utils/suckerConfig.ts CCIP_PAIR_DEPLOYERS')
} else {
  const appPairs = Object.fromEntries(
    [...ccipPairBody.matchAll(/^\s*([A-Z_]+):\s*['"](0x[a-fA-F0-9]{40})['"]/gm)]
      .map(match => [match[1], match[2].toLowerCase()]),
  )
  const fixturePairs = Object.fromEntries(
    suckerDeployers.ccip.map(deployer => [deployer.pair, deployer.address]),
  )
  if (
    Object.keys(appPairs).length !== Object.keys(fixturePairs).length ||
    Object.entries(appPairs).some(([pair, appAddress]) => fixturePairs[pair] !== appAddress)
  ) {
    fail('src/utils/suckerConfig.ts CCIP pair addresses differ from the pinned fixture')
  }
}

const constantsSource = readFileSync(resolve('src/constants/chains.ts'), 'utf8')
const nativeBody = constantsSource.match(/export const SUCKER_DEPLOYERS = \{([\s\S]*?)\n\} as const/)?.[1]
if (!nativeBody) {
  fail('could not parse src/constants/chains.ts SUCKER_DEPLOYERS')
} else {
  const appNativeAddresses = new Set(
    [...nativeBody.matchAll(/0x[a-fA-F0-9]{40}/g)].map(match => match[0].toLowerCase()),
  )
  const fixtureNativeAddresses = new Set(suckerDeployers.native.map(deployer => deployer.address))
  if (
    appNativeAddresses.size !== fixtureNativeAddresses.size ||
    [...appNativeAddresses].some(value => !fixtureNativeAddresses.has(value))
  ) {
    fail('src/constants/chains.ts native sucker deployers differ from the pinned fixture')
  }
}

const sharedSource = readFileSync(resolve('shared/chains.ts'), 'utf8')
const contractsBody = sharedSource.match(/export const CONTRACTS = \{([\s\S]*?)\n\} as const;/)?.[1]
if (!contractsBody) {
  fail('could not parse shared/chains.ts CONTRACTS')
} else {
  const sharedContracts = Object.fromEntries(
    [...contractsBody.matchAll(/^\s*([A-Za-z0-9_]+):\s*['"](0x[a-fA-F0-9]{40})['"]/gm)]
      .map(match => [match[1], match[2].toLowerCase()]),
  )
  for (const [name, appAddress] of Object.entries(sharedContracts)) {
    const canonical = fixture.contracts[name]
    if (!canonical) fail(`shared/chains.ts ${name} is absent from the protocol fixture`)
    else if (appAddress !== canonical.address) {
      fail(`shared/chains.ts ${name} is ${appAddress}, expected ${canonical.address}`)
    }
  }
  for (const name of Object.keys(fixture.contracts)) {
    if (name !== 'ERC2771Forwarder' && !sharedContracts[name]) {
      fail(`fixture contract ${name} is not represented in shared/chains.ts`)
    }
  }
}

const suckerAllowlistBody = sharedSource.match(/export const SUCKER_DEPLOYERS = \[([\s\S]*?)\n\] as const/)?.[1]
if (!suckerAllowlistBody) {
  fail('could not parse shared/chains.ts SUCKER_DEPLOYERS allowlist')
} else {
  const allowlisted = new Set(
    [...suckerAllowlistBody.matchAll(/0x[a-fA-F0-9]{40}/g)].map(match => match[0].toLowerCase()),
  )
  if (
    allowlisted.size !== suckerAddresses.size ||
    [...allowlisted].some(value => !suckerAddresses.has(value))
  ) {
    fail('shared/chains.ts sucker allowlist differs from the pinned fixture')
  }
}

const duplicatedAddresses = [
  ['src/constants/abis/erc2771Forwarder.ts', 'ERC2771_FORWARDER_ADDRESS', 'ERC2771Forwarder'],
  ['src/constants/abis/jbController.ts', 'JB_CONTROLLER_ADDRESS', 'JBController'],
  ['src/constants/abis/jbOmnichainDeployer.ts', 'JB_OMNICHAIN_DEPLOYER_ADDRESS', 'JBOmnichainDeployer'],
  ['src/constants/abis/revDeployer.ts', 'REV_DEPLOYER_ADDRESS', 'REVDeployer'],
  ['src/constants/abis/revDeployer.ts', 'REV_OWNER_ADDRESS', 'REVOwner'],
]
for (const [file, constant, contract] of duplicatedAddresses) {
  const source = readFileSync(resolve(file), 'utf8')
  const match = source.match(new RegExp(`export const ${constant} = ['"](0x[a-fA-F0-9]{40})['"]`))
  if (!match) fail(`${file} no longer exposes ${constant} as a literal address`)
  else if (match[1].toLowerCase() !== fixture.contracts[contract].address) {
    fail(`${file} ${constant} does not match canonical ${contract}`)
  }
}

// Optional maintainer/CI check against an independent checkout of the pinned
// repository. Validate the checkout itself before trusting any artifact in it.
const deploymentsDir = process.env.PROTOCOL_DEPLOYMENTS_DIR
if (deploymentsDir) {
  const resolvedDeploymentsDir = resolve(deploymentsDir)
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: resolvedDeploymentsDir,
    encoding: 'utf8',
  }).trim()
  if (sourceCommit !== fixture.source.commit) {
    fail(
      `deployment source is at ${sourceCommit}; fixture requires ${fixture.source.commit}`,
    )
  }
  for (const [contractName, contract] of Object.entries(fixture.contracts)) {
    for (const [chainId, chain] of Object.entries(fixture.chains)) {
      const manifest = join(resolvedDeploymentsDir, chain.deploymentDir, `${contractName}.json`)
      const expectedPresent = contract.deployedOn.includes(Number(chainId))
      if (existsSync(manifest) !== expectedPresent) {
        fail(`${manifest} presence differs from the pinned capability fixture`)
        continue
      }
      if (expectedPresent) {
        const deployedAddress = JSON.parse(readFileSync(manifest, 'utf8')).address?.toLowerCase()
        if (deployedAddress !== contract.address) {
          fail(`${manifest} is ${deployedAddress}, expected ${contract.address}`)
        }
      }
    }
  }
  for (const route of suckerRoutes) {
    const chain = fixture.chains[route.chainId]
    if (!chain) continue
    const manifest = join(resolvedDeploymentsDir, chain.deploymentDir, route.manifest)
    if (!existsSync(manifest)) {
      fail(`${manifest} is missing for ${route.kind} ${route.chainId}->${route.remoteChainId}`)
      continue
    }
    const deployedAddress = JSON.parse(readFileSync(manifest, 'utf8')).address?.toLowerCase()
    if (deployedAddress !== route.address) {
      fail(`${manifest} is ${deployedAddress}, expected ${route.address}`)
    }
  }
}

if (failures.length) {
  console.error(`Protocol parity failed:\n${failures.map(item => `  - ${item}`).join('\n')}`)
  process.exitCode = 1
} else {
  console.log(
    `Protocol parity verified at deploy-all-v6 ${fixture.source.commit.slice(0, 12)}: ` +
      `${Object.keys(fixture.contracts).length} contracts, ${chainIds.length} chains, ` +
      `${fixture.knownAbsences.length} explicit capability absences, and ` +
      `${suckerRoutes.length} directional sucker deployer routes.`,
  )
  for (const item of fixture.knownAbsences) {
    console.log(`  unavailable: ${item.contract} on ${fixture.chains[item.chainId].name}`)
  }
}
