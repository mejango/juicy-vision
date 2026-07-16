# Port website/ create flow into juicy-vision 1:1

Source of truth: `website/src/create-flow.js` (4,366 lines). Target: replace
`juicy-vision/src/components/dynamic/CreateFlowWizard.tsx` UI with the website's
layout + contents, keeping juicy-vision's deploy plumbing (LaunchProjectModal /
DeployRevnetModal → omnichain Relayr, managed + self-custody signing, backend
IPFS pinning).

## Step/section spec (from inventory)
Steps both flavors: Flavor · Basics · Rulesets(custom)|Stages(revnet) · Shop · Deploy.
Header: "Create a project" + Import/Export .jb + ✕. Dot stepper. Footer ← Back / Next →.

- [ ] 1. Scaffold `src/components/dynamic/create-flow/` directory: state model
      mirroring website `initState()` / `createStage()` / `itemDraft()` (all fields),
      draft autosave (localStorage), .jb import/export (same JSON schema as website
      `parseCreateDraftJson`/`exportDraftFile` so drafts are interchangeable),
      stepper/footer/header chrome in Tailwind matching `.create-*` layout.
- [ ] 2. Flavor step: flavor select + copy; chain pills + "linked" bridge toggle
      (native/CCIP/both + uncovered-pairs warning); Accounting block (accepts pills
      ETH/USDC/Custom, custom-token cross-chain verifier, router-terminal inline
      toggle, immutability notes); Owner (custom) / Operator (revnet) with ENS +
      per-chain overrides.
- [ ] 3. Basics step: name, symbol (¼-width, 11 chars), tagline, description, logo
      picker (pin via juicy backend), Project links collapse (6 fields), Project tags
      collapse (32 tags, max 3), Page customizations collapse (cover image, payment
      notice).
- [ ] 4. Rulesets step (custom): stage cards with bullet summaries; editor = timing
      (duration presets/custom/forever, launch-now vs scheduled, accept payments,
      zero-duration warning) + token section (issuance row w/ baseCurrency select,
      reserved splits w/ recipient picker) + payouts section (single- and multi-token
      paths, percent/amount rows w/ payoutCurrency, surplus allowance, cash-out tax
      chip card + bonding-curve SVG) + Other rules collapse (hold fees + Superpowers
      zone, 6 toggles) + Afterwards row (wait/terminate/cycle/custom + issuance cuts)
      + approval condition (deadline select, custom address, per-chain).
- [ ] 5. Stages step (revnet): stage cards ($TK issuance w/ inherit + auto-cuts,
      splits, auto-issuance rows, cash-out tax card, start-time w/ cut-interval
      snapping), + Add stage.
- [ ] 6. Shared pieces: recipient picker (Address/Project/Hook incl. fund-market),
      split lock rows, per-chain address/number override controls, currencySelect
      with custom-token/USD lock rules, ENS resolution helper.
- [ ] 7. Shop step: store pricing currency; launch-with-items toggle; item cards
      (media picker ≤25MB via backend pin, price, split sales, initial discount,
      inventory, categories w/ add-category, Extra options: reserve inventory w/
      beneficiary warning, owner-mint, transfers pausable, permanent, credit
      purchases, discount editing, voting units); Store config collapse (collection
      name/symbol, exact payment, 4 lock toggles, split-recipient tokens, items
      cash-out redemption, revnet operator store permissions ×4).
- [ ] 8. Deploy step: review summary rows (per-flavor), multichain pink/info notes,
      ToS checkbox + "[copy system audit prompt]" link, Export .jb, disabled-reason
      notes (all 11), Launch button → existing handleDeploy prep → juicy modals.
- [ ] 9. Builder extensions (services): terminal configs for accepts=ETH/USDC/custom
      + router registry terminal; multi-ruleset configs (Afterwards standby stage,
      issuance cuts); richer 721 config from new item model (categories, discounts,
      reserve frequency/beneficiary, flags, voting units, store config + operator
      permissions); revnet auto-issuance; per-chain owner/beneficiary overrides.
- [ ] 10. Wire into ComponentRegistry (`create-flow` type) + dock modal entry; delete
      superseded wizard code.
- [ ] 11. Verify: unit tests for builders; browser walkthrough of every step/flavor
      at desktop + mobile; sim deploy on testnet chains; run existing test suite.

## Deliberate deviations (flagged to user)
1. Deploy execution = juicy-vision's modal flow (payload preview + fee + per-chain
   status live in LaunchProjectModal/DeployRevnetModal, ERC-2771/Relayr, managed
   wallet). Website's inline status-line/quote-choice UI not ported.
2. No mainnet/testnet "Deploy to" select — juicy-vision chains are env-driven
   (VITE_TESTNET_MODE builds).
3. No Pinata JWT field — juicy-vision pins media/metadata through its backend.

## Review (2026-07-16)

Shipped. `src/components/dynamic/create-flow/` (~5,900 lines): state.ts (field-for-field
mirror of website initState/createStage/itemDraft; same `jb-create-draft` key + .jb
schema → drafts interchange), controls/pickers (shared primitives incl. cash-out tax
chip card + hover bonding curve, recipient picker, per-chain overrides), six step
components (copy verbatim), builders.ts (full assembleRuleset port; 29 unit tests),
shell with Import/Export/.jb + stepper + modal handoff. LaunchProjectModal extended
(optional rulesetConfigs[] + chainConfigs); REV encoder extended (real splits +
autoIssuances, was single-operator-split synth). Old CreateFlowWizard.tsx = re-export.

Verified: tsc clean; 1,484 tests pass; browser walkthrough of both flavors at desktop
+ mobile (ruleset editor, tax card + curve, superpowers zone, revnet stages
w/ auto-issuance, shop item editor, operator store permissions, deploy gates, draft
restore across reload incl. step position). Zero page errors.

Known 1:1 gaps — 1-3 CLOSED same day (follow-up commit):
1. CLOSED: encoder accepts USD (2) limits alongside the token currency; builders
   emit the stage's payout/surplus currency (USD amounts 18-dec).
2. CLOSED: PerChainNumControl wired into split rows — per-chain project ids
   (rpid:/ppid:/pkpid:) and single-token payout amounts (num p:stage:idx).
3. CLOSED: metadata.useDataHookForCashOut set with zero dataHook when the shop
   redeems (website parity); encoder permits it on the atomic-721 path.
4. CLOSED: media pins through the backend too — new POST /projects/pin-file
   (multipart, 25MB cap, image/video/audio/pdf/text allow-list, same
   optionalAuth + rate limit as pin-metadata) + pinFileToBackend() in
   services/ipfsPinning; StepBasics/StepShop no longer read the browser
   Pinata JWT.

Follow-up commit also: stepper labels under dots (website layout); removed the
scroll-position compact toggle entirely (compact = WelcomeLayout events only —
mobile chrome scrolls away naturally under the sticky prompt, which gets its
blur/bg on mobile always).
