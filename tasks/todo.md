# Project-page parity build — website/ tabs + pay card + full transaction surface

Branch: `feat/project-page-parity` (isolated worktree at `../juicy-vision-parity`, based on main).
Goal: juicy-vision project pages copy website/'s tabs and pay-card organization exactly,
revnet-aware, SDK-backed where possible, with juicy's natural-language explainers as the
only difference. Every transaction reachable from website/'s project page ships complete
and safe. Then a full adversarial audit across custom projects and revnets.

Reference maps (from exploration agents, 2026-07-16):
- website/src/discover.js is the source (21,948 lines); pay-preview.js, component-base.js.
- Tab sets — revnet: Overview | Terms | Owners | Shop | Extras | Operator; custom:
  Overview | Rulesets | Funds | Tokens | Shop | Extras | Owner. Activity first tab on mobile.
- Owners/Tokens subtabs — revnet: Accounts | Market | Settlement | Splits | Auto Issuance | Loans;
  custom: Accounts | Market | Settlement | Reserved.
- 35 transactions inventoried (§3 of the website map in session transcript).
- Juicy already ships guarded: pay (721/router/credits), cash out, send payouts, surplus
  allowance, reserved distribution, deploy ERC-20, queue ruleset, set splits, set URI,
  manage tiers. Missing: claim credits, loans (open/repay), bridge move/claim/execute/sync,
  LP add/remove/keeper, transfer authority, permissions editor, owner powers, buyback/router
  config, add accounting context, payer deploy, direct AMM swap, add-to-balance UI entry,
  copy-project export.
- SDK (@bananapus/nana-sdk-core 1.2.0, installed): builders for pay/cashout/claim/transfer
  credits/permissions/suckers (prepare/claim/toRemote)/loans (borrow/repay/reallocate)/
  revnet reads (cashOutDelay, isRevnetOperator, tiered721Hook)/queue rulesets/splits/
  deploy ERC-20; full canonical ABIs + addresses for 30 contracts × 8 chains.
  NOT in SDK: sendPayoutsOf/useAllowanceOf arg builders, permit2 pay flows, LP/UniversalRouter,
  Safe flows, bendystraw queries (react pkg only).

## Doctrine
- 1:1 with website/ for layout, contents, ordering, copy; juicy explainer sentences
  (ExplainerMessage + one inline caveat at each action) are additive, never structural.
- Safety conventions are non-negotiable (from both codebases): reviewed-state fingerprints
  re-verified after every await, displayed min == submitted min (never 0), simulate before
  write, quotes re-fetched at submit for pool routes, success dispatches project-updated events.
- Use SDK ABIs/addresses/builders everywhere they exist; keep juicy plumbing (managed wallet,
  Relayr hooks, useTransactionExecutor, PaymentReviewModal) as the execution layer.
- Admin tab is protocol-wide on website (not a project-page tab) — OUT of scope.
- Safe-owner queue flows: port the Owner-tab Safe cards only if time allows after audit;
  they need a safe.js equivalent (new infra). Flag in PR if deferred. [decision pending]

## Phases

### Phase 0 — foundation (orchestrator)
- [x] Worktree + deps install
- [x] Tab model: flavor-dependent tab sets + hash routing (src/components/project/flavor.ts)
- [x] Guarded tx runner: src/services/projectTx.ts + src/hooks/useGuardedTx.ts
      (reverify → approve → simulate → send → confirm; managed + self-custody)
- [x] Revnet flavor: existing isRevnetProject (owner == REVOwner, website parity) kept

### Phase 1 — parallel batch A (disjoint files)
- [ ] Pay card reorg (ProjectCard → website pay-card structure: mini-shop strip, mode
      select pay|add-to-balance, chain+currency selects incl. via-router, preview,
      direct-swap offer, feedback block, min-received, starts-in gate)
- [x] Rulesets tab: carousel card (6626c95 — 21 tests: projection math, signature, diffs)
- [x] Funds tab: per-kind cards (f2d4996 — 9 tests: unlimited sentinel, partial-failure
      suppression, USDC 6-dec)
- [x] Overview + Terms tabs (305cd75 — 22 tests: stage decode, issuance cuts)
- [ ] Extras tab: copy-project .jb export + payer-address card [agent running]

### Phase 2 — parallel batch B
- [x] Owners/Tokens shell + Accounts subtab (203267d — 19 tests; claim-credits guarded;
      renderSubtab(id) contract for other subtab builders)
- [x] Settlement subtab + Move-between-chains (3057765 — 36 tests: merkle vectors,
      fee escalation, movement classification)
- [x] Loans (revnet) (31d1018 — 20 tests: permil fee ramp, loan-id churn)
- [x] Market subtab + LP (6be8914 partial + finish — 36 tests: tick math, counterpart)
- [x] Splits/Reserved + Auto Issuance (5679f91 — 14 tests)
- [x] Owner/Operator back office (3f06cf3 — 25 tests; Safe-queue cards deferred)

### Phase 2.5 — graphs (user directive 2026-07-17)
- [ ] Port ALL website charts in juicy's SVG style: revnet price ladder (issuance +
      cash-out floor + AMM spot, range buttons), Terms issuance schedule chart;
      LP depth/composition/ownership charts ride with the Market agent
- [ ] KEEP juicy-only charts website lacks: VolumeChart + BalanceChart (Funds tab),
      TokenPriceChart/PriceChart history (Rulesets), HoldersChart (Accounts)
- [ ] Chart inventory table in PR body

### Phase 3 — integration (orchestrator)
- [ ] Wire tabs into ProjectDashboard (desktop + mobile), event bus parity
      (project-updated refresh), header parity (authority per chain, contract warnings,
      rule-change notice)
- [ ] Explainer pass: ExplainerMessage intros per tab + inline caveats per action
- [ ] tsc + full vitest suite + targeted new tests per tx builder
- [ ] UI smoke on dev server

### Phase 4 — adversarial audit (parallel skeptics)
- [ ] Tx-safety audit: every ported transaction — min params, fingerprint re-verification,
      simulation, approval pre-steps, currency/decimals, revnet vs custom
- [ ] Parity audit: tab-by-tab against website/ source
- [ ] Revnet-flavor audit: everything §4 of the website map changes
- [ ] Fix confirmed findings, re-run suite

## Review

Build complete + wired (PR #26). 1,690 tests pass; tsc + eslint clean. 16 commits.

### Audit status — PARTIAL (session limit hit)
8 adversarial agents launched (tx-safety, parity, revnet semantics, integration);
ALL terminated on the session limit (resets 2:20am). Completed a manual pass on
the highest-risk invariants instead:
- Guarded runner sound: 2nd reverify after switch+approval; exact-amount approval
  re-read; managed-mode does NOT race (backend waitForTransactionReceipt blocks);
  account/chain drift aborts at send.
- CRITICAL regression found + FIXED (ce5d4d2): mobile lost the pay/cash-out card
  (old mobile About tab embedded ProjectCard; renderTabs didn't). Restored.
- switch-tab 'tokens'→'owners' remap for revnets: correct.
- No dangerouslySetInnerHTML in ported tabs; loans have no interest-rate language;
  no hardcoded-18-dec in owner subtabs; loans grant BURN_TOKENS not SDK ROOT.

### STILL TODO before merge
- Re-run the full tab-by-tab parity sweep + exhaustive tx-safety audit after the
  session limit resets. The manual pass was not exhaustive.

### Deferred (flagged in PR, not bugs)
Safe-queue cards; direct-swap execution (link-out); LP partial-exit; copy-project
refuses on 721 shops.

### Upstream
SDK loans.d.ts REVLOANS_PERMISSION_ID=1 (ROOT) is wrong for borrow — fix in juice-sdk-v4.
