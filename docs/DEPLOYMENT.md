# Deployment and operations

Juicy Vision ships as two independent, portable artifacts:

- a static React bundle, either served by the non-root Nginx image or uploaded
  as the reviewed `dist/` artifact; and
- a non-root Deno/Hono API image backed by PostgreSQL.

The primary release unit is an OCI digest. Storacha/IPFS remains an optional
copy of the static frontend, not the control plane for the API or database.
No workflow in this repository deploys the backend automatically.

## Railway branch environments

Each Railway environment contains two services from this repository: the root
frontend service uses `railway.json`, and the backend service uses
`backend/railway.json`.

| Git branch | Railway environment | Frontend origin | API origin |
| --- | --- | --- | --- |
| `staging` | staging | `https://staging.juicy.vision` | `https://api.staging.juicy.vision` |
| `main` | production | `https://juicy.vision` | `https://api.juicy.vision` |

Connect both staging services to `staging` and both production services to `main`.
Enable automatic deploys only after CI succeeds and disable overlap. The
frontend gets the matching API origin in `VITE_API_URL`; the backend gets the
matching frontend origin in `ALLOWED_ORIGINS`. Do not configure `BUILD_SHA` in
Railway: both Dockerfiles consume Railway's automatically injected
`RAILWAY_GIT_COMMIT_SHA`. Keep separate databases and secrets in staging and
production, run migrations once before each backend rollout, and promote by
merging `staging` into `main`.

## Release invariants

Every production release must satisfy all of these:

1. `.github/workflows/test.yml` is green, including contract parity, wallet
   write inventory, unit/coverage, browser egress, the fail-closed PostgreSQL
   migration/integration lane, both OCI builds, and the frontend container
   smoke test plus backend migration/liveness/readiness smoke test.
2. The backend production configuration passes `deno task config:check`.
3. Database migrations run once as a release job before API rollout. API
   replicas never migrate on startup.
4. Images are selected by `@sha256:` digest, not `latest` or a mutable tag.
5. `/livez` is used for process liveness and `/readyz` for traffic readiness.
6. The exact frontend origin is present in backend `ALLOWED_ORIGINS` before the
   frontend is made public.
7. A rollback digest and a current database backup are recorded before rollout.

## Toolchains

- Node `26.5.0` and npm `12.0.1` (`.nvmrc` and `packageManager`)
- Deno `2.9.3`
- Ubuntu `24.04` in GitHub Actions

Use the lockfiles. CI uses `npm ci` and Deno `--frozen`; a lockfile drift is a
failure, not something the release job repairs.

## Configuration

### Frontend build variables

| Variable | Production rule |
| --- | --- |
| `VITE_API_URL` | Exact HTTPS API origin, without a trailing slash. It may be empty only when the API is deliberately reverse-proxied on the frontend origin and `ALLOW_SAME_ORIGIN_API=true`. |
| `VITE_WALLETCONNECT_PROJECT_ID` | Required 32-character WalletConnect project ID. The source fallback is for local development only. |
| `VITE_TESTNET_MODE` | Sets the default network for a new browser. Users can still switch network mode. |
| `VITE_RELAYR_APP_ID` | Optional explicit Relayr application ID. |
| `BUILD_SHA` | Optional non-Railway revision override; Railway and the release workflows set revision metadata automatically. |
| `SOURCE_DATE_EPOCH` | Commit timestamp used for reproducible build metadata. |

Validate without building:

```sh
DEPLOY_ENV=production \
VITE_API_URL=https://api.juicy.vision \
VITE_WALLETCONNECT_PROJECT_ID=0123456789abcdef0123456789abcdef \
npm run check:release-config
```

### Required backend production variables

| Variable | Rule |
| --- | --- |
| `DENO_ENV` | Exactly `production`. |
| `PORT` | Defaults to `8080` in the OCI image. |
| `DATABASE_URL` | Non-local `postgres://` or `postgresql://` URL. Store it as a secret. |
| `ALLOWED_ORIGINS` | Comma-separated exact HTTPS origins. No wildcard or substring matching. |
| `TRUST_PROXY` | Keep `false` unless every request arrives through a trusted proxy that overwrites client-supplied forwarding headers. |
| `JWT_SECRET` | Independent random value, at least 32 characters. |
| `ENCRYPTION_MASTER_KEY` | Independent random value, at least 32 characters and different from `JWT_SECRET`. |
| `CRON_SECRET` | Independent random value, at least 32 characters. |
| `RESERVES_PRIVATE_KEY` | 32-byte hex key. Never use a development key. Prefer a constrained signer/HSM before holding meaningful reserves. |

Feature credentials such as Stripe, Anthropic/Moonshot, Relayr, Bendystraw,
The Graph, Ankr, Replicate, and Voyage are conditional. IPFS uses the same
contract as the other webclients: keep `IPFS_PINNING_ENABLED=false` or provide
both `FILEBASE_IPFS_RPC_TOKEN` and `PINATA_JWT`. Filebase creates the canonical
DAG-PB CID and Pinata pins that exact CID. Leave every feature disabled until
all of its credentials, limits, and monitoring are configured.
`FORGE_DOCKER_ENABLED` and `SEMGREP_ENABLED` must remain `false` in the API
container.

Authentication is mandatory for admin, project persistence/mutation, IPFS pin,
and image-generation routes. Cost-bearing quotas fail closed with `503` when
their database-backed limiter is unavailable; do not bypass that response at a
proxy. With `TRUST_PROXY=false`, client-supplied `CF-Connecting-IP` and
`X-Forwarded-For` headers are ignored. If proxy trust is enabled, configure the
edge to erase and replace both headers before forwarding traffic.

The example file is safe to commit and contains placeholders only:

```sh
cp backend/.env.example backend/.env
cd backend
deno task config:check
```

Never bake an env file into an image. Both Docker ignore policies explicitly
exclude env files.

## CI and release artifacts

`.github/workflows/release-images.yml` builds both components on `v*` tags. A
manual run is build-only unless the operator explicitly selects `publish`.
Before either image can be pushed, the workflow calls the complete reusable
quality workflow: frontend dependency/protocol/write/unit/build/bundle/browser
gates, backend frozen fmt/lint/check/tests, and local container validation. The
backend lane uses deterministic non-secret CI credentials and a health-checked
PostgreSQL `16.14-alpine3.24` service pinned to its manifest digest. It migrates
an empty `juicyvision_ci` database before tests and sets
`REQUIRE_TEST_DATABASE=true`, so a missing database, unsafe database name, or
skipped database suite fails the release dependency. Its current expected
summary is `448 passed (1020 steps), 0 failed, 10 ignored`; only the 10
credential-gated live-AI cases may be ignored. Both images are built for
`linux/amd64` and `linux/arm64`.

That backend lane also reconstructs the former migration runner's metadata gap
on the ephemeral database: schema and migrations 002-010 present, 001
unrecorded, and 011 absent. It must seed 001 without replaying its non-idempotent
DDL, apply and validate 011, then complete a second no-op migration run before
backend tests begin. This protects upgrades from pre-release/local databases
created by the legacy runner as well as clean first deployments.

The portable-image job separately starts the built pinned PostgreSQL image on
an internal Docker network, migrates it with the built backend image, and runs
the API image as its non-root `deno` user with a read-only root filesystem,
all capabilities dropped, and `no-new-privileges`. The job requires both
`/livez` and database-backed `/readyz` before it succeeds and always removes
the ephemeral containers and network.
Published packages are:

```text
ghcr.io/OWNER/REPOSITORY-frontend:sha-FULL_COMMIT_SHA
ghcr.io/OWNER/REPOSITORY-backend:sha-FULL_COMMIT_SHA
```

The workflow records each registry digest in the job summary and attaches an
SBOM, BuildKit provenance, and GitHub build-provenance attestation. It never
creates `latest`. Deploy the digest shown in the summary:

```text
ghcr.io/OWNER/REPOSITORY-backend@sha256:...
```

The separate frontend publication workflow also runs only for a release tag or
an explicit manual request and is attached to the GitHub `production`
environment for both artifact validation and publication. Its reviewed build
reads `PRODUCTION_API_URL` and `WALLETCONNECT_PROJECT_ID` from that environment,
then fails release-config validation if either is unsuitable. Configure required
reviewers there before adding variables or Storacha secrets; ordinary pushes to
`main` use deterministic non-local placeholders, test the same production
configuration path, and retain CI diagnostics without publishing.

The Node, Deno, unprivileged Nginx, and local-development PostgreSQL base images
are pinned by their reviewed official multi-platform manifest digests.
Dependabot monitors the npm, GitHub Actions, and Docker surfaces weekly,
grouping minor/patch updates while keeping major upgrades in separate reviewable
pull requests. Every Docker update must retain both the human-readable version
tag and immutable digest. Deno imports retain their dedicated manual monthly
review described in the stack ADR.

## Local image validation

From the repository root:

```sh
docker build -f Dockerfile.frontend -t juicy-vision-frontend:local .
docker run --rm -p 8080:8080 juicy-vision-frontend:local
curl --fail http://127.0.0.1:8080/healthz

docker build -f backend/Dockerfile -t juicy-vision-backend:local .
docker run --rm \
  --env-file backend/.env \
  juicy-vision-backend:local task config:check
```

The frontend image is Nginx running as UID 101. The backend runs as the Deno
user with network, environment, and read permissions only. It has no Docker
client/socket, subprocess permission, or filesystem-write permission.

## Database migrations

Migrations are serialized with a PostgreSQL advisory lock and each incremental
migration is transactional. A new database starts from the reviewed
`schema.sql` snapshot and records its explicit migration baseline so old
non-idempotent changes are not replayed.

Run the exact backend release image once:

```sh
docker run --rm \
  --env-file /secure/path/backend-production.env \
  ghcr.io/OWNER/REPOSITORY-backend@sha256:... \
  task migrate
```

Operational rules:

- Take and verify a database backup first.
- Run one migration job, even though the advisory lock also prevents overlap.
- Save its logs with the release record.
- Do not start a new API revision if migration fails.
- Prefer backward-compatible expand/contract schema changes. Do not run an
  automatic down migration during rollback.
- Update `schema.sql`, `SCHEMA_SNAPSHOT_BASELINE`, and the migration test when a
  new reviewed snapshot supersedes the current baseline.

## Rollout order

1. Record the currently deployed frontend and backend digests.
2. Verify PostgreSQL backup/PITR and available storage.
3. Run the new backend image's `task config:check` with production secrets.
4. Run its one-shot `task migrate` job.
5. Deploy one backend canary by digest.
6. Wait for `/livez`, then `/readyz`; exercise auth and a read-only project query.
7. Roll out remaining backend replicas.
8. Build/publish the frontend with the final API origin and WalletConnect ID.
9. Deploy the frontend digest or static artifact and exercise the maintained
   browser journeys at desktop and mobile widths.
10. Observe errors, latency, PostgreSQL connections, scheduler results, and
    wallet/Relayr failures before declaring the release complete.

### Health endpoints

| Endpoint | Meaning | Use |
| --- | --- | --- |
| `GET /livez` | Deno process can answer HTTP; no dependency check. | Container liveness/restart probe. |
| `GET /health` | Compatibility alias with the same payload as `/livez`. | Platforms that require `/health`. |
| `GET /readyz` | PostgreSQL is reachable and the core schema/tracking table exists. | Load-balancer readiness probe. |
| `GET /healthz` on frontend | Nginx is serving. | Frontend container health probe. |

Do not use `/livez` as readiness: it intentionally stays healthy during a
database incident so the platform does not create a restart storm.

## Frontend hosting and routing

The Nginx image implements BrowserRouter fallback (`try_files ... /index.html`),
one-year immutable caching for hashed assets, and no-cache behavior for HTML,
the manifest, and service workers.

Equivalent static hosts must rewrite every non-file route to `index.html`.
Test at least `/pay/:sessionId`, `/merchant`, `/join/:code`, `/chat/:id`, and a
project route directly from a fresh browser URL.

Raw IPFS gateways do not generally provide this rewrite. An immutable Storacha
directory is therefore safe as an archival/root-link copy, but raw CID deep
links are not a production BrowserRouter host. Put a stable gateway/CDN with SPA
fallback in front of the CID, and add that exact stable HTTPS origin to
`ALLOWED_ORIGINS`. Do not add broad `*.ipfs` CORS patterns when credentials are
enabled.

## Scheduled work

Production does not use in-process timers. Configure one external scheduler to
call the reviewed endpoints, normally:

```text
POST /cron/maintenance
X-Cron-Secret: <CRON_SECRET>
```

Use a secret-manager reference rather than embedding the value in scheduler
configuration. Alert on non-2xx results and prevent overlapping invocations.
Payment settlements, credits, spends, cash-outs, and transfers affect user
funds; reconcile scheduler output against Stripe, PostgreSQL, Relayr, and chain
receipts.

## Rollback

1. Stop the rollout and keep the failing digest for investigation.
2. Restore the previous backend digest. Do not reverse a migration unless a
   separately reviewed recovery procedure requires it.
3. Confirm `/readyz` and the read-only/auth canary.
4. Restore the previous frontend digest or static artifact.
5. Purge only HTML/service-worker CDN entries; hashed assets are immutable.
6. Record impact, transaction state, and any reconciliation required.

If a migration is not backward-compatible, rollback is blocked: ship a forward
fix or restore the database under an incident procedure.

## Platform adapters

Railway, Cloud Run, Kubernetes, Fly, and a conventional VM may all run the same
OCI digests. Platform configuration should only provide secrets, networking,
replica counts, probes, and scheduler integration; it should not rebuild source
with a different toolchain. Configure termination grace long enough for Deno's
SIGTERM handler to drain and close the PostgreSQL pool.

## Initial-production exclusions

Hook compilation is unavailable in the initial production release. The old
Docker-in-Docker path is quarantined under `docker/forge/` as a development
experiment and cannot be enabled in the API process. A production version needs
an authenticated separate worker, digest-pinned Foundry/V6 dependencies, a
queue, strict resource limits, and method-filtered RPC egress.

Before accepting stored value or operating a reserves key, complete the
financial controls in `backend/RISKS.md`: signer isolation, balance/liability
reconciliation, Stripe dispute handling, scheduler alerts, backup restore drill,
and an incident pause procedure.
