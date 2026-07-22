import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const ROOT = resolve('.')
const MANIFEST_PATH = resolve('src/test/wallet-write-sites.fixture.json')
const SOURCE_ROOTS = ['src', 'shared']
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])
const EXCLUDED_FILE = /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[cm]?[jt]sx?$/

const CALLEE_KINDS = new Map([
  ['requireTransactionReview', 'review-gate'],
  ['requireContractTransactionReview', 'review-gate'],
  ['runGuardedTx', 'reviewed-executor'],
  ['executeManagedTransaction', 'managed-wallet-write'],
  ['createManagedRelayrBundle', 'relayr-managed-submit'],
  ['createReviewedForwarderBundle', 'relayr-reviewed-submit'],
  ['createBalanceBundle', 'relayr-raw-submit'],
  ['proposeSafeTransactions', 'safe-proposal'],
  ['sendTransaction', 'wallet-send'],
  ['sendTransactionAsync', 'wallet-send'],
  ['sendRawTransaction', 'wallet-send'],
  ['sendRawTransactionAsync', 'wallet-send'],
  ['sendCalls', 'wallet-send'],
  ['sendCallsAsync', 'wallet-send'],
  ['writeContract', 'wallet-write'],
  ['writeContractAsync', 'wallet-write'],
  ['writeContracts', 'wallet-write'],
  ['writeContractsAsync', 'wallet-write'],
  ['signMessage', 'wallet-signature'],
  ['signMessageAsync', 'wallet-signature'],
  ['signTypedData', 'wallet-signature'],
  ['signTypedDataAsync', 'wallet-signature'],
  ['signTransaction', 'wallet-signature'],
  ['signTransactionAsync', 'wallet-signature'],
])

const RPC_CALLEES = new Set(['request', 'send', 'sendAsync'])

const SAFE_RPC_KINDS = new Map([
  ['sendTransactions', 'safe-proposal'],
  ['signMessage', 'wallet-signature'],
  ['signTypedMessage', 'wallet-signature'],
])

const EIP1193_KINDS = new Map([
  ['eth_sendTransaction', 'wallet-send'],
  ['eth_sendRawTransaction', 'wallet-send'],
  ['personal_sign', 'wallet-signature'],
  ['eth_sign', 'wallet-signature'],
  ['eth_signTypedData', 'wallet-signature'],
  ['eth_signTypedData_v3', 'wallet-signature'],
  ['eth_signTypedData_v4', 'wallet-signature'],
])

function sourceFiles(directory) {
  return readdirSync(resolve(directory), { withFileTypes: true })
    .flatMap(entry => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      const normalized = path.replaceAll('\\', '/')
      return SOURCE_EXTENSIONS.has(extname(entry.name)) && !EXCLUDED_FILE.test(normalized)
        ? [normalized]
        : []
    })
}

function propertyName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    (ts.isStringLiteral(expression.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
  ) {
    return expression.argumentExpression.text
  }
  return null
}

function literalText(node) {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

function objectLiteralStringProperty(node, name) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    const key = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      ? property.name.text
      : null
    if (key === name) return literalText(property.initializer)
  }
  return null
}

function discoverSites() {
  const sites = []
  for (const file of SOURCE_ROOTS.flatMap(sourceFiles).sort()) {
    const sourceText = readFileSync(resolve(file), 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const aliases = new Map()

    function collectAliases(node) {
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text
          if (CALLEE_KINDS.has(imported) || RPC_CALLEES.has(imported)) {
            aliases.set(element.name.text, imported)
          }
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const imported = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name && ts.isIdentifier(element.name) ? element.name.text : null
          const local = element.name && ts.isIdentifier(element.name) ? element.name.text : null
          if (imported && local && (CALLEE_KINDS.has(imported) || RPC_CALLEES.has(imported))) {
            aliases.set(local, imported)
          }
        }
      }
      ts.forEachChild(node, collectAliases)
    }
    collectAliases(sourceFile)

    function visit(node) {
      if (ts.isCallExpression(node)) {
        const rawName = propertyName(node.expression)
        const canonicalName = rawName ? aliases.get(rawName) ?? rawName : null
        let kind = canonicalName ? CALLEE_KINDS.get(canonicalName) : undefined
        let callee = node.expression.getText(sourceFile).replaceAll(/\s+/g, '')

        if (callee === 'guarded.run') kind = 'reviewed-executor'
        if (callee === 'safeRpc') {
          const operation = literalText(node.arguments[0])
          kind = operation ? SAFE_RPC_KINDS.get(operation) : undefined
          if (operation) callee = `safeRpc:${operation}`
        }
        if (canonicalName && RPC_CALLEES.has(canonicalName)) {
          const method = canonicalName === 'request'
            ? objectLiteralStringProperty(node.arguments[0], 'method')
            : literalText(node.arguments[0])
          kind = method
            ? EIP1193_KINDS.get(method) ?? (method.startsWith('eth_send') ? 'wallet-send' : undefined)
            : undefined
          if (method) callee = `${canonicalName}:${method}`
        }

        if (kind) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          sites.push({ file, line: line + 1, kind, callee })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return sites.sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line || left.callee.localeCompare(right.callee))
}

const discovered = discoverSites()
if (process.argv.includes('--print')) {
  console.log(JSON.stringify(discovered, null, 2))
  process.exit(0)
}

if (!existsSync(MANIFEST_PATH)) {
  console.error(`Wallet-write inventory is missing: ${relative(ROOT, MANIFEST_PATH)}`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
const failures = []
if (manifest.schemaVersion !== 1) failures.push('unsupported wallet-write inventory schema')
if (JSON.stringify(manifest.sourceRoots) !== JSON.stringify(SOURCE_ROOTS)) {
  failures.push(`inventory sourceRoots must be exactly ${JSON.stringify(SOURCE_ROOTS)}`)
}

const expected = Array.isArray(manifest.sites) ? manifest.sites : []
if (JSON.stringify(expected) !== JSON.stringify(discovered)) {
  const key = site => `${site.file}:${site.line} [${site.kind}] ${site.callee}`
  const expectedKeys = new Set(expected.map(key))
  const discoveredKeys = new Set(discovered.map(key))
  const added = [...discoveredKeys].filter(item => !expectedKeys.has(item))
  const removed = [...expectedKeys].filter(item => !discoveredKeys.has(item))
  if (added.length) failures.push(`uninventoried write/sign/review sites:\n    ${added.join('\n    ')}`)
  if (removed.length) failures.push(`inventoried sites moved or disappeared:\n    ${removed.join('\n    ')}`)
}

const coverage = Array.isArray(manifest.coverage) ? manifest.coverage : []
const siteFiles = new Set(discovered.map(site => site.file))
const coverageFiles = new Set()
for (const item of coverage) {
  if (coverageFiles.has(item.file)) failures.push(`duplicate coverage inventory for ${item.file}`)
  coverageFiles.add(item.file)
  if (!siteFiles.has(item.file)) failures.push(`coverage inventory has no current write site: ${item.file}`)
  if (item.status !== 'covered') {
    failures.push(`${item.file} must be covered; received status ${item.status}`)
  }
  if (!item.note || typeof item.note !== 'string') failures.push(`${item.file} needs a coverage note`)
  for (const testFile of item.tests || []) {
    if (!existsSync(resolve(testFile))) failures.push(`${item.file} references missing test ${testFile}`)
  }
  if (item.status === 'covered' && (!Array.isArray(item.tests) || item.tests.length === 0)) {
    failures.push(`${item.file} claims covered without a test file`)
  }
}
for (const file of siteFiles) {
  if (!coverageFiles.has(file)) failures.push(`${file} has no transaction coverage inventory entry`)
}

if (failures.length) {
  console.error(`Wallet-write inventory failed:\n  - ${failures.join('\n  - ')}\n\nRun npm run check:writes -- --print to inspect the current AST inventory.`)
  process.exit(1)
}

console.log(
  `Wallet-write inventory verified: ${discovered.length} sites across ${siteFiles.size} files ` +
  `(all ${coverage.length} write-bearing files have focused coverage).`,
)
