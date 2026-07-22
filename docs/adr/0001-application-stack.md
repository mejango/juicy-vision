# ADR 0001: Keep the React/Vite and Deno/Hono split

- Status: accepted
- Date: 2026-07-22

## Context

Juicy Vision is pre-production, so framework and infrastructure changes are
still possible. The application is nevertheless large: approximately 459
frontend TypeScript files, 210 TSX components, and 154,000 lines across the
frontend/shared surface. It has contract-derived transaction builders, wagmi
wallet state, Relayr orchestration, PWA behavior, a Deno WebSocket/API service,
and a broad unit/browser safety suite. There is no Next.js coupling.

The review compared:

1. upgrading the existing split in place;
2. moving to Next/another React meta-framework;
3. rewriting the frontend in another UI framework; and
4. replacing Deno/Hono with Node or another backend stack.

## Decision

Keep the static React/Vite frontend and Deno/Hono API as independently
deployable services. Package each as a portable, non-root OCI artifact and keep
Storacha as an optional static copy.

This fits the product:

- The frontend is wallet-heavy and client-side; SSR adds operational and cache
  complexity without improving contract truth or transaction safety.
- A static artifact can run behind any CDN, conventional container platform, or
  IPFS gateway with an explicit SPA rewrite.
- wagmi, viem, Stripe, Router, TanStack Query, and the existing tests are already
  React-oriented. A non-React rewrite would spend risk budget without a user
  benefit.
- Deno/Hono already provides the API, WebSocket, permission, and test model. Its
  small runtime image and explicit permissions are useful security boundaries.
- Separating UI and API lets either side roll back by digest and keeps database
  migrations out of application startup.

## Dependency support boundary

The locked application currently resolves React 18.3, Vite 6.4, TypeScript
5.6, ESLint 9.39, wagmi 2.19, and viem 2.55. Registry compatibility review found
a coherent next target of React 19.2, Vite 8.1, plugin-react 6, PWA plugin 1.3,
Vitest 4.1, and TypeScript 5.9. TypeScript 7 is outside the supported
typescript-eslint range, and wagmi 3 is an API migration rather than a routine
security update.

That coordinated upgrade must be one isolated dependency PR with a regenerated
lockfile and the complete type, unit, build, bundle, browser, and wallet-boundary
suite. Partial Vite upgrades are prohibited because the installed React, PWA,
and polyfill plugins declare older peer ranges. Registry installation was not
available during this infrastructure change, so no unverified major upgrade was
forced into the release work.

The browser Node-polyfill plugin has no direct source consumer and is a removal
candidate in that PR. It stays removed only if the production build and browser
suite prove that wallet transitives do not require it.

Backend imports remain on their already locked versions but are now exact in
`deno.json`. Deno runs with `--frozen`. Because Dependabot does not manage Deno
imports, a maintainer reviews `deno outdated`, release notes, the lock diff, and
the full backend suite in a dedicated monthly PR.

## Infrastructure consequences

- OCI digest is the release identity; no `latest` tag is published.
- The release workflow emits SBOM and provenance attestations.
- API startup validates production configuration but never mutates schema.
- Migrations are a serialized one-shot job.
- Exact CORS origins replace substring/wildcard trust.
- Liveness and database-backed readiness are separate.
- Hook compilation is disabled until it is a separately isolated worker.
- BrowserRouter requires an origin/CDN with SPA fallback; raw CID deep links are
  not presented as production-capable.

## Revisit triggers

Reconsider the frontend framework only if SSR/edge rendering becomes a measured
product requirement, not as routine modernization. Reconsider Deno if a required
library cannot run safely, Deno support becomes materially worse, or operational
telemetry shows a runtime-specific reliability problem. Reconsider the service
split if a stable same-origin edge/API architecture removes more complexity than
it introduces.
