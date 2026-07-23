import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const failures = []

function requireIgnorePatterns(path, patterns) {
  const entries = new Set(
    read(path)
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#')),
  )
  for (const pattern of patterns) {
    if (!entries.has(pattern)) failures.push(`${path}: must exclude private-key material matching ${pattern}`)
  }
}

function requirePattern(path, pattern, description) {
  if (!pattern.test(read(path))) failures.push(`${path}: ${description}`)
}

requirePattern(
  'backend/src/routes/admin.ts',
  /adminRouter\.use\(\s*['"]\*['"]\s*,\s*requireAuth\s*,\s*requireAdmin\s*\)/,
  'the entire admin router must require authentication and admin authorization',
)
requirePattern(
  'backend/src/routes/locale.ts',
  /localeRouter\.get\(\s*['"]\/stats['"]\s*,\s*requireAuth\s*,\s*requireAdmin\s*,/,
  '/locale/stats must require admin authorization',
)
requirePattern(
  'src/admin/AdminApp.tsx',
  /if\s*\(\s*!user\.isAdmin\s*\)\s*{\s*return\s+<AccessDenied\s*\/>/,
  'the admin UI must keep its defense-in-depth role guard',
)

const projects = read('backend/src/routes/projects.ts')
for (const route of ['pin-metadata', 'pin-file']) {
  const protectedRoute = new RegExp(`['"]\\/${route}['"]\\s*,\\s*requireAuth\\s*,`)
  if (!protectedRoute.test(projects)) {
    failures.push(`backend/src/routes/projects.ts: /${route} must require authentication`)
  }
}
if (/optionalAuth/.test(projects)) {
  failures.push('backend/src/routes/projects.ts: anonymous project ownership is not supported')
}
if (!/isProjectOwner\(existing, user\)/.test(projects)) {
  failures.push('backend/src/routes/projects.ts: project mutations must enforce ownership')
}

requirePattern(
  'backend/src/routes/images.ts',
  /authenticate:\s*requireAuth/,
  '/images/generate must require authentication',
)
requirePattern(
  'backend/src/routes/images.ts',
  /rateLimit:\s*rateLimitByUser\(['"]imageGenerate['"]\)/,
  '/images/generate must enforce its per-user quota',
)

function sourceFiles(root) {
  const files = []
  for (const entry of readdirSync(new URL(`../${root}`, import.meta.url), { withFileTypes: true })) {
    const relative = join(root, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(relative))
    else if (['.ts', '.tsx', '.js', '.jsx'].includes(extname(entry.name))) files.push(relative)
  }
  return files
}

for (const path of ['Dockerfile.frontend', 'backend/Dockerfile', 'backend/src/db/Dockerfile.postgres']) {
  const references = [...read(path).matchAll(/^FROM\s+(\S+)/gm)].map(match => match[1])
  if (references.length === 0) failures.push(`${path}: expected at least one container base image`)
  for (const reference of references) {
    if (!/@sha256:[a-f0-9]{64}$/.test(reference)) {
      failures.push(`${path}: container base ${reference} must retain an immutable sha256 digest`)
    }
  }
}

for (const path of ['backend/railway.json', 'backend/railway.staging.json']) {
  const config = JSON.parse(read(path))
  if (
    config.build?.builder !== 'DOCKERFILE' ||
    config.build?.dockerfilePath !== 'backend/Dockerfile' ||
    config.deploy?.startCommand !== null ||
    config.deploy?.healthcheckPath !== '/readyz'
  ) {
    failures.push(
      `${path}: backend Railway services must use backend/Dockerfile, its default CMD, and /readyz`,
    )
  }
}
requirePattern(
  'DEPLOY_RAILWAY.md',
  /\*\*Root Directory\*\* set to `\/`[\s\S]*\*\*Config File Path\*\* to `\/backend\/railway\.json`[\s\S]*`\/backend\/railway\.staging\.json`[\s\S]*Clear \*\*Custom Start Command\*\*[\s\S]*`backend\/Dockerfile`[\s\S]*`\/readyz` healthcheck/,
  'backend Railway setup must retain the repo root, absolute backend config path, Dockerfile CMD, and readiness probe',
)

const privateKeyPatterns = [
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
]
requireIgnorePatterns('.gitignore', privateKeyPatterns)
const nestedPrivateKeyPatterns = privateKeyPatterns.map(pattern => `**/${pattern}`)
for (const path of [
  '.dockerignore',
  'Dockerfile.frontend.dockerignore',
  'backend/Dockerfile.dockerignore',
]) {
  requireIgnorePatterns(path, [...privateKeyPatterns, ...nestedPrivateKeyPatterns])
}

const workflowFiles = readdirSync(new URL('../.github/workflows', import.meta.url))
  .filter(name => ['.yml', '.yaml'].includes(extname(name)))
  .map(name => join('.github/workflows', name))
for (const path of workflowFiles) {
  const actionReferences = [...read(path).matchAll(/^\s*uses:\s*(\S+)/gm)].map(match => match[1])
  for (const reference of actionReferences) {
    if (!reference.startsWith('./') && !/@[a-f0-9]{40}$/.test(reference)) {
      failures.push(`${path}: remote action ${reference} must retain a full commit SHA`)
    }
  }
  const serviceImages = [...read(path).matchAll(/^\s*image:\s*(\S+)/gm)].map(match => match[1])
  for (const reference of serviceImages) {
    if (!/@sha256:[a-f0-9]{64}$/.test(reference)) {
      failures.push(`${path}: service image ${reference} must retain an immutable sha256 digest`)
    }
  }
}

requirePattern(
  '.github/workflows/test.yml',
  /docker network create --internal "\$network_name"[\s\S]*juicy-vision-backend:ci task migrate/,
  'the container gate must migrate an isolated PostgreSQL network with the built backend image',
)
requirePattern(
  '.github/workflows/test.yml',
  /deno task migrate[\s\S]*deno task test:migrate:legacy[\s\S]*deno task test/,
  'the PostgreSQL lane must exercise fresh initialization, legacy upgrade, then the full suite',
)
requirePattern(
  'backend/src/db/migrate.ts',
  /schemaExists[\s\S]*INITIAL_SCHEMA_MIGRATION[\s\S]*ON CONFLICT \(name\) DO NOTHING/,
  'existing legacy schemas must seed the skipped non-idempotent 001 baseline',
)
requirePattern(
  'DEVELOPMENT.md',
  /Quick Start[\s\S]*deno task migrate[\s\S]*deno task dev/,
  'local quick start must run the one-shot migration before starting the backend',
)
if (/automatically run migrations when it starts/i.test(read('DEVELOPMENT.md'))) {
  failures.push('DEVELOPMENT.md: backend startup must not claim to run migrations automatically')
}
requirePattern(
  '.github/workflows/test.yml',
  /docker run --detach\s*\\\s*--name "\$api_name"\s*\\[\s\S]*?--network "\$network_name"\s*\\[\s\S]*?--read-only\s*\\[\s\S]*?--cap-drop ALL\s*\\[\s\S]*?--security-opt no-new-privileges\s*\\[\s\S]*?juicy-vision-backend:ci/,
  'the backend API smoke container must stay read-only and unprivileged',
)
requirePattern(
  '.github/workflows/test.yml',
  /api_probe='[^'\n]*http:\/\/127\.0\.0\.1:8080\/livez[^'\n]*http:\/\/127\.0\.0\.1:8080\/readyz[^'\n]*'[\s\S]*?run_api_probe\(\)\s*{[\s\S]*?docker exec --interactive "\$api_name"[\s\S]*?deno run --no-config --no-lock --allow-net=127\.0\.0\.1:8080 -[\s\S]*?<<<"\$api_probe"[\s\S]*?}[\s\S]*?if ! run_api_probe; then/,
  'the isolated backend container smoke test must verify liveness and readiness from inside the API container',
)

const backendTestFiles = sourceFiles('backend/src').filter(path => path.endsWith('.test.ts'))
const backendTestSource = backendTestFiles.map(path => read(path)).join('\n')
const ignoredBackendTests = backendTestSource.match(/^\s*ignore\s*:/gm)?.length ?? 0
const databaseTestSkips = backendTestSource.match(
  /^\s*ignore\s*:\s*SKIP_DB_TESTS\s*,?\s*$/gm,
)?.length ?? 0
const liveAiTestSkips = backendTestSource.match(
  /^\s*ignore\s*:\s*!RUN_AI_TESTS\s*,?\s*$/gm,
)?.length ?? 0
if (databaseTestSkips !== 119) {
  failures.push(
    `backend/src: expected 119 database integration tests in the fail-closed inventory, found ${databaseTestSkips}`,
  )
}
if (liveAiTestSkips !== 10) {
  failures.push(`backend/src: expected exactly 10 credential-gated live AI tests, found ${liveAiTestSkips}`)
}
if (ignoredBackendTests !== databaseTestSkips + liveAiTestSkips) {
  failures.push('backend/src: ignored tests may use only SKIP_DB_TESTS or !RUN_AI_TESTS')
}
requirePattern(
  'backend/src/test/helpers.ts',
  /REQUIRE_TEST_DATABASE=true but a dedicated, reachable/,
  'required database integration coverage must fail closed when PostgreSQL is unavailable',
)
for (const path of [
  'backend/src/routes/projects.test.ts',
  'backend/src/services/projectCreation.test.ts',
]) {
  requirePattern(
    path,
    /function isolatedDatabaseTest[\s\S]*finally\s*{\s*await cleanupTestProjects\(\)/,
    'mutable project database cases must retain scoped before/after cleanup',
  )
}

for (const path of [...sourceFiles('src'), ...sourceFiles('backend/src'), ...sourceFiles('e2e')]) {
  const source = read(path)
  if (/\b(?:describe|it|test|[A-Za-z_$][\w$]*Test)\.only\s*\(/.test(source)) {
    failures.push(`${path}: focused .only tests are forbidden`)
  }
  if (/\b(?:describe|it|test|[A-Za-z_$][\w$]*Test)\.skip\s*\(\s*['"`]/.test(source)) {
    failures.push(`${path}: unconditional .skip tests are forbidden; use an explicit live-test condition`)
  }
  if (
    path.startsWith('e2e/') &&
    /\b(?:describe|it|test|[A-Za-z_$][\w$]*Test)\.skip\s*\(\s*\)/.test(source)
  ) {
    failures.push(`${path}: bare runtime skips are forbidden; provide an explicit condition and reason`)
  }
}

if (failures.length > 0) {
  console.error(`Source invariant check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log('Source security and test-discipline invariants verified.')
