import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const packageJson = JSON.parse(read('package.json'))
const lockfile = JSON.parse(read('package-lock.json'))
const failures = []

function expectEqual(actual, expected, location) {
  if (actual !== expected) {
    failures.push(`${location}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`)
  }
}

function expectPattern(path, pattern, description) {
  if (!pattern.test(read(path))) failures.push(`${path}: ${description}`)
}

expectEqual(packageJson.packageManager, 'npm@12.0.1', 'package.json packageManager')
expectEqual(packageJson.engines?.node, '26.5.x', 'package.json engines.node')
expectEqual(packageJson.engines?.npm, '12.0.x', 'package.json engines.npm')
expectEqual(packageJson.devDependencies?.['@typescript/native'], 'npm:typescript@7.0.2', 'package.json @typescript/native')
expectEqual(packageJson.devDependencies?.typescript, '5.9.3', 'package.json typescript')
expectEqual(packageJson.overrides?.['@base-org/account'], '2.5.7', 'package.json @base-org/account override')
expectEqual(read('.nvmrc').trim(), '26.5.0', '.nvmrc')
expectPattern(
  '.npmrc',
  /^node-options=--no-experimental-webstorage$/m,
  'local Node lifecycle processes must disable experimental Web Storage',
)
expectPattern(
  '.npmrc',
  /^ignore-scripts=true$/m,
  'dependency lifecycle scripts must remain disabled',
)

const lockedRoot = lockfile.packages?.['']
expectEqual(lockedRoot?.engines?.node, '26.5.x', 'package-lock.json engines.node')
expectEqual(lockedRoot?.engines?.npm, '12.0.x', 'package-lock.json engines.npm')
expectEqual(lockedRoot?.devDependencies?.['@typescript/native'], 'npm:typescript@7.0.2', 'package-lock.json @typescript/native')
expectEqual(lockedRoot?.devDependencies?.typescript, '5.9.3', 'package-lock.json typescript')
expectEqual(lockfile.packages?.['node_modules/@base-org/account']?.version, '2.5.7', 'package-lock.json @base-org/account')

expectPattern(
  'Dockerfile.frontend',
  /^FROM node:26\.5\.0-bookworm-slim@sha256:2d49d876e96237d76de412761cf05dbfe5aee325cc4406a4d41d5824c5bb8beb AS build$/m,
  'the frontend build image must use the reviewed Node 26.5.0 manifest',
)
expectPattern(
  'Dockerfile.frontend',
  /^RUN npm install --global npm@12\.0\.1 --no-audit --no-fund$/m,
  'the frontend image must install the package-manager version pinned by package.json',
)
expectPattern(
  'Dockerfile.frontend',
  /^COPY package\.json package-lock\.json \.npmrc \.\/$/m,
  'the frontend image must inherit the repository Node and lifecycle-script policy',
)

for (const path of ['.github/workflows/test.yml', '.github/workflows/deploy-frontend.yml']) {
  expectPattern(
    path,
    /node-version-file:\s*['"]?\.nvmrc['"]?/,
    'frontend jobs must use the Node version pinned by .nvmrc',
  )
  expectPattern(
    path,
    /run:\s*npm install --global npm@12\.0\.1 --no-audit --no-fund/,
    'frontend jobs must install the package-manager version pinned by package.json',
  )
}

if (failures.length > 0) {
  console.error(`Toolchain consistency check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('Node, npm, TypeScript, container, and CI toolchain definitions are consistent.')
