# Testing and CI

Juicy Vision protects the transaction trust boundary at four layers: contract-derived protocol parity, unit and component behavior, the production browser surface, and backend policy/services. Pull-request checks are deterministic and do not rely on live wallets, RPCs, Bendystraw, Relayr, or other remote application services.

## Supported toolchain

- Frontend: Node `26.5.0` from `.nvmrc` and npm `12.0.x` (`npm@12.0.1` is pinned in `package.json`).
- Backend: Deno `2.9.3` in CI.
- Install frontend dependencies with `npm ci`; do not update the lockfile as part of a test run.

TypeScript 7 supplies the `tsc` binary through the `@typescript/native` npm
alias. The `typescript` package name intentionally remains on TypeScript 5.9.3
so typescript-eslint, the AST-based wallet inventory, and WalletConnect's
optional Coinbase/Solana tooling share a supported compiler API. Source
typechecks and builds still use the TypeScript 7 CLI. WalletConnect's AppKit
also pins an older optional Base Account package than wagmi accepts, so the
lockfile overrides that shared optional package to compatible `2.5.7` while
preserving WalletConnect QR/mobile-wallet connectivity.

## Frontend gates

| Gate | Command | User expectation protected |
|---|---|---|
| Toolchain consistency | `npm run check:toolchain` | Node, npm, TypeScript, CI, and the frontend image cannot drift onto incompatible versions independently. |
| Lint | `npm run lint:ci` | The complete frontend tree must pass with zero warnings; there is no warning budget to hide new debt. |
| Direct dependency tree | `npm run deps:check` | The clean locked install contains every declared direct runtime and tooling dependency at a valid version. |
| Runtime audit | `npm run audit:prod` | High and critical advisories in packages shipped to users block CI; development-only tooling is reported separately. |
| TypeScript | `npm run typecheck` | Component, service, hook, transaction, Playwright fixture, configuration, and e2e interfaces remain compatible. |
| Protocol parity | `npm run check:protocol` | App contract addresses and chain capabilities match the pinned deploy-all-v6 fixture. |
| Wallet-write inventory | `npm run check:writes` | New, moved, or raw review/send/sign/Relayr sites cannot bypass explicit review and test-coverage triage. |
| Unit coverage | `npm run test:ci` | Transaction review, guarded execution, stores, services, hooks, and components retain their tested behavior. |
| Production build | `npm run build` | TypeScript and Vite can produce the deployable PWA. |
| Bundle budget | `npm run check:bundle` | JavaScript and CSS growth remains explicit and reviewable. |
| Browser safety | `npm run test:e2e` | The built app's maintained payment/transaction surfaces remain contained, keyboard-usable, free of Axe color-contrast findings and serious/critical findings in other rules, and free of browser errors at desktop and phone widths. |

Install Chromium once before the browser gate:

```bash
npx playwright install chromium
```

The frontend CI-equivalent sequence is:

```bash
npm ci
npm run check:toolchain
npm run deps:check
npm run audit:prod
npm run lint:ci
npm run typecheck
npm run check:source
npm run check:protocol
npm run check:writes
npm run test:ci
npm run build
npm run check:bundle
npm run test:e2e
```

After `npm ci` and the one-time Chromium install, `npm run check` executes that
complete frontend sequence locally. CI keeps the gates as separate steps so
coverage and browser diagnostics are still uploaded on failure.

`npm run test:all` is a shorter developer loop (typecheck, coverage, and maintained browser tests); it is not a substitute for every CI gate above.

## Contract source of truth

`src/test/protocol-deployments-v6.fixture.json` pins the reviewed deploy-all-v6 commit, normalized addresses, supported chains, explicit deployment absences, and every directional CCIP/native sucker-deployer route. `scripts/verify-protocol-parity.mjs` checks that the application's shared and duplicated address constants, six CCIP pair addresses, three native pair addresses, and shared sucker allowlist agree with that fixture. With `PROTOCOL_DEPLOYMENTS_DIR` set, all 36 directional routes are also checked against their exact external deployment manifests. Bendystraw data may describe indexed protocol state, but it is never used as the oracle for authorization, calldata, or deployment capability.

Maintainers with the matching contracts checkout can additionally compare the fixture to deployment manifests:

```bash
PROTOCOL_DEPLOYMENTS_DIR=/absolute/path/to/deploy-all-v6/deployments \
  npm run check:protocol
```

When contracts change, update the fixture from reviewed deployment manifests, record the new full commit, and update the parity tests in the same pull request. Do not infer missing deployments from indexer results.
Pull-request and deployment CI independently check out the exact recorded
deploy-all-v6 commit and run this artifact comparison, preventing the fixture
and application constants from drifting together.

## Coverage and size ratchets

Vitest explicitly counts every production `src/**/*.{ts,tsx}` module, including
entry points and components that no test imports, plus the three root `shared/`
modules shipped by Vite (`chains`, `addressRegistry`, and `terminalPreview`). The
remaining `shared/prompts/` tree is backend-only. The resulting all-production
no-regression floors are 33% statements, 24% branches, 29% functions, and 34%
lines. Independent per-file floors ratchet all three shipping shared modules;
stronger floors protect the transaction review modal/status
center, guarded execution and transaction executor hooks, exact project request
builders, the ERC-20 deploy and ruleset-queue Relayr adapters, and review model.
Focused tests also decode the exact V6 `setSplitGroupsOf` and `setUriOf` calldata
before those operations can enter Relayr. These baselines are not end-state targets. New
transaction construction, review, authorization, and failure paths should
receive focused tests even when the global percentage already passes.

`src/test/wallet-write-sites.fixture.json` is the committed AST inventory for
every reviewed executor, wallet send/write/sign (including batch calls, raw
transactions, contract batches, message/typed-data/transaction signatures, and
literal `eth_send*` RPCs), Safe proposal, and Relayr submission call under
`src/` and `shared/`. Imported or destructured aliases are normalized before
matching. `npm run check:writes` fails when a site is added, removed, or moved
until the manifest is reviewed. Every write-bearing file must have
`status: "covered"` and at least one existing focused test; partial coverage and
documented gaps fail CI. Update the call-site entry and focused test together
whenever a write path changes.

`src/test/setup.ts` returns a controlled 503 for any fetch that a test did not
explicitly mock and rejects unmocked `XMLHttpRequest`, `WebSocket`, and
`EventSource` construction. The boundary is reinstalled before every case, even
after a test restores globals. Route and service tests must install their own
request-specific mock; silently reaching a live API is a test failure in design
even when that API happens to be available.

The production bundle gate currently caps:

- each JavaScript asset at 1,600,000 bytes and all JavaScript at 7,000,000 bytes;
- each CSS asset at 150,000 bytes and all CSS at 250,000 bytes.

Budget increases require an explicit performance review; they should not be used to make an unrelated change pass.

## Browser suites

The merge gate runs the maintained `smoke` and `critical` Playwright projects against the production preview. Shape and payment-review invariants run at 1280, 768, 390, and 320 pixels wide, including keyboard focus, zero Axe color-contrast findings, and zero serious/critical findings in other Axe rules. Their shared local-only fixture blocks non-local HTTP and WebSocket traffic and service workers, preventing tests from succeeding because a live third party happened to respond.

Historical UI, flow, API, visual, stress, responsive, scenario, and UX-bot
projects remain available through their named scripts/projects. Live API suites
require `LIVE_API_E2E=true` plus a reachable, explicitly seeded authenticated
test API; once enabled, missing fixtures fail instead of silently skipping.
Custom and long AI explorations use the documented `UX_SCENARIO` and
`UX_FULL_REGRESSION` conditions. Source discipline rejects unconditional
named skips and bare runtime skips throughout `e2e/`. Add new critical journeys
to `e2e/critical/` and use `e2e/fixtures/local-only.ts`; it records non-local
HTTP and WebSocket attempts and automatically requires the attempt list to
remain empty after every test. The exact `https://api.ci.invalid` origin used
to validate CI's production configuration is fulfilled with a deterministic
local 503 by that fixture; it never leaves the browser context.

The same source gate rejects mutable base images in the shipping frontend,
backend, and local database Dockerfiles, and rejects remote GitHub Actions that
are not pinned to a full commit SHA.

## Backend gates

Run from `backend/`:

```bash
deno task fmt:check
deno task lint
deno task check
deno task test
```

Formatting and lint gate the complete backend tree. Deno's `require-await`
rule is the sole documented compatibility exception because Hono handlers and
injectable service adapters intentionally preserve promise-returning
interfaces; all other recommended rules apply. The full backend test command
permits network access only to `127.0.0.1` and `localhost` for deterministic
local fixtures; public RPC/API access is denied by Deno permissions.

CI starts PostgreSQL `16.14-alpine3.24` at its reviewed manifest digest, waits
for `pg_isready`, initializes an empty `juicyvision_ci` database with
`deno task migrate`, and runs the suite with `REQUIRE_TEST_DATABASE=true`.
That flag fails the job if PostgreSQL cannot be reached or if `DATABASE_URL`
does not name a dedicated database containing `_test`, `-test`, `_ci`, or
`-ci`. Destructive fixtures therefore cannot run against an ordinary
development or production database by accident. Database suites use reserved
test identities and scoped cleanup before and after mutable cases, and the CI
service is discarded with the job.

The current required CI result is:

```text
ok | 448 passed (1020 steps) | 0 failed | 10 ignored
```

All 119 PostgreSQL integration cases run in that result. The only ignored cases
are the 10 explicit `RUN_AI_TESTS` live-provider checks, which require real
credentials and are not part of deterministic pull-request CI. Source
invariants fail if a new backend skip condition is introduced or either
inventory changes without review. Without a dedicated local database, the
expected developer result is 329 passed and 129 ignored (119 database plus 10
live-provider cases).

Before the full suite, `deno task test:migrate:legacy` reconstructs the database
state left by the former runner: the application schema and migrations 002-010
exist, but the non-idempotent 001 bootstrap is unrecorded and the 011 repair is
absent. The check proves the runner records rather than replays 001, applies and
validates 011, then performs a second migration run with unchanged migration
metadata. This task is destructive and therefore refuses production or any
database name that is not explicitly `_test`/`_ci`-scoped.

To run the same fail-closed database path locally, create an expendable database
whose name is visibly test-only, then run from `backend/`:

```bash
createdb juicyvision_test
DATABASE_URL=postgresql://localhost:5432/juicyvision_test REQUIRE_TEST_DATABASE=true deno task migrate
DATABASE_URL=postgresql://localhost:5432/juicyvision_test REQUIRE_TEST_DATABASE=true deno task test
```

## Writing safety tests

For every new write path, test the review model and the executable request together:

1. derive addresses, capabilities, and ABI shapes from the pinned contracts fixture;
2. assert chain, target, function, account/beneficiary, payable value, token decimals/currency, slippage or minimum output, and deadlines;
3. cover disconnected wallets, wrong chain/account, stale review state, simulation/RPC rejection, user rejection, and duplicate submission;
4. prove untrusted metadata and indexed Bendystraw fields cannot change authorization or calldata;
5. add a production-browser assertion when the change affects layout, focus, responsive containment, or transaction review.

CI uploads coverage and Playwright diagnostics so failures can be investigated without rerunning a flaky live dependency. Playwright retries retain a second diagnostic trace, while `failOnFlakyTests` makes any pass-on-retry fail CI instead of hiding nondeterminism.

All jobs use Ubuntu 24.04, and every reusable GitHub Action in test, deploy, and training workflows is pinned to a full commit SHA. Non-release checkouts disable persisted credentials, and test jobs retain read-only repository permissions.

After the source-level jobs pass, CI builds the frontend, backend, and pinned
PostgreSQL images. It smoke-tests the backend on an internal Docker network by
waiting for PostgreSQL health, running the built backend image's one-shot
migration, and then starting that same image as its non-root `deno` user with a
read-only root filesystem, all Linux capabilities dropped, and
`no-new-privileges`. Both `/livez` and database-backed `/readyz` must answer
successfully. The container job depends on both frontend and backend jobs, so
none of these runtime checks can be bypassed by a release workflow.

The frontend deployment workflow repeats the deterministic frontend gates before
publishing the exact production build to IPFS. A failing audit, protocol parity
check, wallet-write inventory, lint/typecheck, coverage floor, bundle budget, or maintained browser test
therefore prevents publication even if the independently running test workflow
has not completed yet.
