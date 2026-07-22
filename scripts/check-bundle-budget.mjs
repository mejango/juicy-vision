import { readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const DIST_DIR = resolve(process.env.BUNDLE_DIST_DIR || 'dist')

function positiveBudget(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive byte count`)
  }
  return value
}

const budgets = {
  singleJs: positiveBudget('MAX_SINGLE_JS_BYTES', 1_600_000),
  totalJs: positiveBudget('MAX_TOTAL_JS_BYTES', 7_000_000),
  singleCss: positiveBudget('MAX_SINGLE_CSS_BYTES', 150_000),
  totalCss: positiveBudget('MAX_TOTAL_CSS_BYTES', 250_000),
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  }))
  return nested.flat()
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

let files
try {
  files = await filesUnder(DIST_DIR)
} catch (error) {
  throw new Error(`Production build not found at ${DIST_DIR}. Run npm run build first.`, {
    cause: error,
  })
}

const measured = await Promise.all(files.map(async path => ({
  path: relative(DIST_DIR, path),
  bytes: (await stat(path)).size,
})))
const javascript = measured.filter(file => file.path.endsWith('.js'))
const styles = measured.filter(file => file.path.endsWith('.css'))

if (!javascript.length) throw new Error('Production build contains no JavaScript assets')

const violations = []
for (const file of javascript) {
  if (file.bytes > budgets.singleJs) {
    violations.push(`${file.path} is ${kib(file.bytes)} (single JS budget ${kib(budgets.singleJs)})`)
  }
}
for (const file of styles) {
  if (file.bytes > budgets.singleCss) {
    violations.push(`${file.path} is ${kib(file.bytes)} (single CSS budget ${kib(budgets.singleCss)})`)
  }
}

const totalJs = javascript.reduce((sum, file) => sum + file.bytes, 0)
const totalCss = styles.reduce((sum, file) => sum + file.bytes, 0)
if (totalJs > budgets.totalJs) {
  violations.push(`total JavaScript is ${kib(totalJs)} (budget ${kib(budgets.totalJs)})`)
}
if (totalCss > budgets.totalCss) {
  violations.push(`total CSS is ${kib(totalCss)} (budget ${kib(budgets.totalCss)})`)
}

const largest = javascript
  .toSorted((left, right) => right.bytes - left.bytes)
  .slice(0, 5)
  .map(file => `${file.path} ${kib(file.bytes)}`)

console.log(`Bundle budget: ${javascript.length} JS assets / ${kib(totalJs)}; ${styles.length} CSS assets / ${kib(totalCss)}`)
console.log(`Largest JS assets:\n${largest.map(file => `  ${file}`).join('\n')}`)

if (violations.length) {
  console.error(`Bundle budget exceeded:\n${violations.map(item => `  - ${item}`).join('\n')}`)
  process.exitCode = 1
}
