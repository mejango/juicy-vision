# juicy-vision maintainability/cleanliness/efficiency review — 2026-07-20

Parallel review pass (7 agents: dynamic components, other frontend components + pages,
frontend services/stores, utils/hooks/constants/shared, backend services, backend
routes + hygiene, charts). Every finding grep/read-verified by the reporting agent.
All findings are behavior-preserving unless a caveat says otherwise. Security/
validation paths were explicitly excluded from all suggestions.

> **STATUS 2026-07-20: APPLIED** on branch `chore/ponytail-cleanup` (commits
> 38d31fd..5164044): net −16.6k lines, all gates green (tsc, vitest, deno check
> per-file, deno test 304, vite build). Items each fix agent skipped after
> re-verification (behavior differences, refuted findings) are recorded in this
> session's reports; notable refutations: revDeployer `tiered721HookOf` is LIVE,
> `projectConversations.ts` has two live exports, QueueRulesetForm 'in_progress'
> branch is reachable via persisted state, rendered suggestion count is 58 not 59.

**Net estimate after de-duplicating overlapping findings: ~13,000–14,000 removable
lines** (~7% of the 195k-line TS codebase), plus the `ethers` dependency, dist.zip
(8.5 MB) untracked from git, and several real perf wins.

---

## Tier 1 — whole-file / whole-block deletes (zero callers, grep-verified)

| What | Lines |
|---|---|
| `src/components/chat/WelcomeScreen.tsx` dead data: `allSuggestions` (~1000 entries filtered to 59 by `SAFE_WELCOME_SUGGESTIONS` L2247), `suggestionKeyMap` (921 entries, ~72 used), badge sets L2250 (480 lines, intersect with live 59), 18/31 unreachable traits | ~-2,400 |
| `src/components/dynamic/HookProjectEditor.tsx`, `HookSecurityReport.tsx`, `HookTestRunner.tsx`, `HookCodeViewer.tsx` — all four unreferenced (not in ComponentRegistry or any import) | -1,330 |
| `src/constants/abis/jbOmnichainDeployer.ts`: `launchRulesetsFor` overloads L1070-1902, `queueRulesetsOf` overloads L1903-2657, `deploySuckersFor` L14-83 — zero encode/decode sites. Caveat: ABI doubles as decode-allowlist; after trim, unknown selectors reject via decode-throw instead of name-check (same outcome). Keep `extraDataHookOf`/`tiered721HookOf` (used by transactionPolicy L1996/2002) | ~-1,660 |
| `src/hooks/useRulesetCache.ts` — only `rulesetKeys` + `getShopStaleTime` consumed (ShopTab); everything else dead incl. 5 types + hooks/index.ts block | ~-415 |
| `backend/src/test/fuzz-data.ts` — imported by nothing | -346 |
| `src/constants/abis/jbMultiTerminal.ts` — only `NATIVE_TOKEN` consumed (identical value already in constants/index.ts:171); re-export and delete file | ~-238 |
| `backend/src/utils/circuitBreaker.ts` — entire module dead (class + 4 singletons) | ~-230 |
| `src/components/payment/ChainPaymentSelector.tsx` — zero importers | -219 |
| `src/services/errorHandler.ts` — barrel-only, zero consumers | -199 |
| root `debug-splits.ts` — referenced by nothing | -194 |
| `src/hooks/useProjectData.ts` — zero consumers | -141 |
| `src/constants/abis/jbSuckerRegistry.ts` — zero consumers | -121 |
| `src/api/projectConversations.ts` — all 6 exports zero-ref (file likely fully removable) | ~-120 |
| `src/hooks/useMobileKeyboard.ts` — zero consumers | -113 |
| `src/constants/abis/revDeployer.ts` L787-923: `deploySuckersFor`/`cashOutDelayOf`/`isOperatorOf`/`tiered721HookOf` entries unused | ~-137 |
| `src/utils/transactionVerification.ts:L347-465` `verifyPayParams` — no non-test importer | ~-119 |

## Tier 2 — dead exports/state (smaller, all grep-verified zero-ref)

Backend services (~-1,200 total): intentDetection `seedIntentEmbeddings` (-120) +
`toDetectedIntents` (-43); intentMetrics stats quartet (-115); ipfs archiving trio
(-99); juice `processExpiredCredits` (-90, confirm not pending wiring); terminal
`completeSessionFromSpend`/`failSessionFromSpend` (-75); settlement pending-balance
pair (-66); identity 4 fns (-59); smartAccounts `syncAccountBalances` (-49) +
`recordProjectRole` chain (-26); hookProjects `getFile/addFile/updateFile` (-45) +
`getProjectStats` (-42); transactions 4 fns (-40); forge `proxyRpcRequest` (-37);
encryption `deriveSharedSecret`/`getUserPrivateKey` (-37); wallet `getTokenBalance`
(-35); componentState pair (-32); embeddingService `cosineSimilarity`+friends (-30);
userContext `getTermForUser` (-28); rulesetCache pair (-26); summarization pair
(-20); websocket `sendToAddress` (-16); chat `ChatPermissionLevel` (-23).

Backend routes/types (~-700): types/index.ts dead schemas (-110); AppError 9 unused
subclasses (-100); test/helpers all but SKIP_DB_TESTS (-90); context/omnichain
`BRIDGE_PROTOCOLS`+`SUCKER_ABI` (-90); templates `getAllTemplates`+`TEMPLATE_METADATA`
(-45); auth `requirePrivacyMode` (-20); config `validateConfigForClaude/Cron` (-12 —
or wire into boot gate: they're checks, decide intent); crypto stale cache (-4); db
`TransactionClient` (-3).

Frontend services (~-700): relayr/client dead API surface L35+ (-95); tiersHook 4
encoders (-115); chat.ts 7 fns (-70); bendystraw `fetchAggregatedParticipants` (-67)
+ `fetchCashOutEventsHistory` (-42) + `arePaymentsEnabled` (-20) + `isProjectOwner`
(-15) + barrel query block (-13); passkeyWallet `getPasskeyAccount`+`signTypedData`
(-62); relayr/encoder `encodeLaunchProjectTransaction` (-58); nft/types + misc (-45);
session.ts 4 fns (-25).

Utils/constants/shared (~-350): frontend circuitBreaker 3 unused circuits (-22);
shared/prompts compat shim (-78) + reference/index exports (-38) + `getSubModuleIds`
(-7); abis/index 5 Params types (-46); `PAGINATION` (-13); ipfs `testPinataConnection`
(-14); messageParser `extractComponents` (-36); addressRegistry
`requireRecognized721Clone` (-11); charts/utils `shortenAddress` + 6 dead
CHART_COLORS keys (-10); de-export ~20 internal-only symbols (-5).

Component-level dead code: Storefront `priceRange` + dead filter (-10); ActivityFeed
`displayCountRef` + `_limit` (-6); SharedChatContainer `showInviteModal` (-20 — UI
change: Invite button visibly does nothing today, needs explicit OK); BuyJuiceModal
dead `step==='error'` branch (-25); WalletButton.tsx (-24); RulesetSchedule
`_currentStageNum` (-2) + `fieldName` prop (-6); QueueRulesetForm dead
`decimalsFor` + unreachable 'in_progress' branch (-4); SendReservedTokensForm +
TokensTab dead `ruleset` fields (-7); CreateProjectForm `acceptUsdc` (-6);
TierDetailModal + TransactionWarning identical-ternary-branches (-2);
dynamic/index.ts barrel (-11, verify no bundler-alias import).

## Tier 3 — duplication (the dominant theme)

**Cross-cutting:**
- `CHAIN_INFO` map hand-copied in **14 files** (DeployERC20Form, ManageTiersForm,
  SetSplitsForm, QueueRulesetForm, SendPayoutsForm, TokensTab, ProjectCard,
  SendReservedTokensForm, FundsSection, TopProjects, UseSurplusAllowanceForm,
  NoteCard, SetUriForm, RulesetSchedule) + 3 payment modals + FundsSection/
  QueueRulesetForm variants — same data as constants `MAINNET_CHAINS`/`CHAINS`. (~-120)
- `truncateAddress` re-rolled inline in ~12+ files while `utils/ens.ts:164` exists. (~-30)
- `InlineChainSelector`/`ChainSelector` component copy-pasted 5x (DeployERC20Form,
  RulesetSchedule, SendReservedTokensForm, SendPayoutsForm, UseSurplusAllowanceForm). (~-140)
- USDC address table exists 3x (`shared/chains.ts`, `constants/chains.ts`,
  `technicalDetails.ts` — which also duplicates it *twice internally* as
  `CHAIN_TOKENS`+`USDC_ADDRESSES`); `JB_CONTRACTS` restates shared `CONTRACTS`;
  `NATIVE_TOKEN` defined 4x; RPC/viem mainnet tables duplicated. (~-125)
- sessionId→pseudo-address derivation inline ~12x (WalletPanel x5, SettingsPanel x4,
  etc.) → one `getPseudoAddress()`. (-25)
- Five hand-rolled K/M abbreviators with drifting thresholds → one `abbreviate()`.
  (~-30, unify formats deliberately)
- Anchor-popover math hand-rolled ~7x, byte-identical to ui/Modal.tsx:64 →
  `useAnchoredPopoverStyle`. (-80)
- Wallet-session auth: `extractWalletSession`/`requireWalletOrAuth` exist 4x
  (middleware/walletSession.ts is canonical; routes/chat.ts, routes/invite.ts,
  main.ts WS copy). Canonical is a strict superset — no auth weakened. (-250)
- Uint224-max literal pasted 4x → `UINT224_MAX` const.

**Per-area (largest):**
- ProjectDashboard: 8 action modals + owner menu + tooltip duplicated verbatim
  desktop vs mobile. (-507)
- ProjectCard: entire pay-input/tier-carousel/funding-popover block duplicated
  between the two return branches. (~-300)
- WalletPanel: `BuyJuiceView` reimplements BuyJuiceModal (-180); JuicyId/Settings
  identity logic (-110); `fetchAllBalances` x2 (-55); identity-listener effect x4
  incl. ChatContainer (-60); EmailAuth ignores store actions (-15).
- Payment modals: per-chain tx-status row re-implemented in 6 modals (-120);
  controller-fetch effect x2 (-33); status-callback effect x3 + inline
  single-function ABIs already in `JB_CONTROLLER_ABI` (-37); QueueRulesetModal
  90-line inline ABI dup (-90); slow-chain detection + creation-fee effects
  duplicated in Launch/DeployRevnet modals (-52).
- bendystraw/client.ts: 5 identical cursor-pagination loops → generic helper (-90);
  page-fetcher pair (-30); 4x local-fallback literal (-45); duplicated ABIs of
  existing consts (-40); queued/upcoming ruleset fetchers overlap (-35);
  `transformEvent` 11 branches → table (-22); tokenSymbol re-implements
  tokenAddress lookup (-15).
- backend moonshot.ts agentic loop copies claude.ts (-150); terminal.ts inline row
  types 14x + 6x (-195); smartAccounts CHAINS/RPC tables duplicate chainReader
  (-30) + row-mapper x4 (-25) + export-loop x2 (-25); contextManager intent core
  (-40); claude.ts content-block mapper x2 (-35) + token estimator x3 (-10);
  chainReader metadata object built twice (-21); transactionPolicy repeated
  prologue x4 + verification loop x2 (-25).
- routes/chat.ts: ~33 identical catch blocks → one helper or app.onError (-100);
  permission-fallback block x4 (-40); folder-ownership block x4 (-30); attachment
  pinning duplicated + serial (-25); optional: move 410-line ai/invoke body to a
  service (~-350 from routes file) and 265-line debug dashboard HTML to a static
  file.
- charts: range selector x3, loading/error/empty x4, tooltip shell x4, footer x3,
  chain-toggle handlers x2, breakdown toggle x2 → 5 small shared components (~-150).
- create-flow: StepDeploy re-implements StepRulesets' stage summary (-100);
  PayoutKind/round2/tsToLocal/afterApplies/tickerLabel/accounting-sym chains each
  duplicated 2-4x across steps (-120 total); AcceptPill = Pill (-18).
- OptionsPicker: typing indicators x3, selection indicators x2, context-builder x2,
  spinner x3 (-53). FundsSection: chevron SVG x5, payout-split row dup, formatTaxRate
  body dup (-45).
- chat: dock controls dup (-80); `formatTimeAgo` x3 + canonical in utils (caveat:
  utils adds "w ago" tier >7d — display change, decide); chat title/summary dup
  ChatHistorySidebar vs ConversationHistory (-20); `getChatSummary` 85-line keyword
  guesser → keep excerpt fallback (-60); ChatInput paste/file loops dup (-48);
  SharedChatContainer avatar strip re-implements ParticipantAvatars (-28);
  passkey/SIWE merge sequence dup (-50); hidden-message invoke dup (-20).
- nft service: `fetchNFTTiersWithPermissions` re-implements `fetchNFTTiers` (-65);
  tier mapper pasted 3x (-30); tokenUriResolver ABI/read dup (-25).
  omnichainDeployer 721-launch copies launch block (3rd copy in relayr/client) (-60).
  relayr/client types = encoder types (-70). passkey finalize sequence x2 (-30) +
  base64url helper x2, storage.ts double exports (-25). apiRequest x3 (-30+).
  useEnsName.ts duplicates utils/ens resolveEnsName incl. second cache (-70).

## Tier 4 — stdlib/native swaps

- `ethers` v5 dep exists for ONE BigNumber XOR in `nftPayMetadata.ts` → native
  BigInt XOR; drop dep (~300KB bundle). (both agents flagged independently)
- `validateAddress` re-implements viem `isAddress` (omnichainDeployer, -25).
- Hand-rolled multi-RPC failover loop → viem `fallback()` transport (bendystraw, -15).
- `findApplicableTaxRate` manual scan → `sort().findLast()` (-10).
- `substr` → `slice`/`crypto.randomUUID()`; `!== null && !== undefined` → `!= null`;
  `generateId` → `crypto.randomUUID()`.
- settingsStore migrate blocks v<6..v<10 redundant with zustand persist default
  merge — keep v<2, v<5 (-30).

## Tier 5 — perf (no line change, real wins)

- **RulesetSchedule: `Section` component defined inside render + countdown ticking
  every second → full subtree unmount/remount per tick.** Hoist to module scope.
  Also: interval recreated every tick (dep on `remainingSeconds`); 5 independent
  awaits in revnet branch → Promise.all; ENS await blocks loadData.
- **backend chat.ts `debugLog` writes /tmp/invite-debug.log on every getMember call**
  (hot permission path) — delete helper + call sites.
- routes/chat.ts logs full member list on every GET in all envs → debugLog;
  main.ts logDebugEvent middleware registered in prod (no-op wrapper) → dev-only.
- Sequential awaits → Promise.all: uniswap discoverUniswapPool (6 serial reads),
  bendystraw fetchRevnetOperator / fetchProjectAccountingContexts /
  fetchLiveProjectBalance, TokenPriceChart symbol fetch, attachment IPFS pinning.
- transactionPolicy: requireCurrentTiersHook double controllerOf read (one fewer
  RPC, identical accept/reject set); hoist invariant Set out of loop.
- smartAccounts: cache viem clients per chain; thread loaded account through
  executeTransaction (3x same row fetch).
- SetSplitsForm buildSplit called ~2x per split per render un-memoized → memoize.
- MessageList `lastAssistantIndex` reduce inside map → O(n²) per render; hoist.
- relayr transformBundleResponse JSON.stringify's full bundle every status poll.

## Hygiene

- `dist.zip` (8.5 MB) tracked → git rm --cached + .gitignore.
- `test-results/` partially tracked → untrack + ignore.
- `.env.staging` tracked despite .gitignore entry (no secrets, but dead-letter
  ignore — pick one).
- Deps: remove `i18next-browser-languagedetector`, `juicebox-metadata-helper`
  (zero imports), `ethers` (after XOR fix); move `@anthropic-ai/sdk` to
  devDependencies (only e2e uses it). backend/deno.json: drop `bcrypt`,
  `hono/deno` mappings. Keep `workbox-window` (virtual:pwa-register) and
  `fast-check`.

## Needs verification / conflicts (do NOT apply blind)

1. **ProjectCard `buyMoreButtonRef`**: one agent says never attached (always-null
   anchor → delete), rollup says used as anchorRef at L1855/L2307. Both true —
   passed as prop but possibly never attached via `ref=`. Check for `ref={buyMoreButtonRef}`.
2. **Explorer URLs**: hand-rolled `base.etherscan.io`-style URLs in SetSplitsForm/
   ManageTiersForm/SendReservedTokensForm differ from constants' `basescan.org`
   values — NOT a mechanical swap; pick canonical explorer per chain first.
3. **formatTimeAgo consolidation** changes display >7d ("w ago" tier). Decide.
4. **TokensTab/ActivityFeed formatTokenAmount** thresholds differ — unify deliberately.
5. **WelcomeScreen catalog**: if the ~1000-suggestion catalog is meant to be
   re-enabled, move to a lazy-loaded data module instead of deleting.
6. **juice.ts `processExpiredCredits` / config validate fns**: dead OR unwired-
   but-intended — confirm intent before deleting.

## Explicitly NOT flagged (checked, live/load-bearing)

Safety modules (rulesetSafety/splitSafety/tierSafety/projectTrust/terminalPreview),
all backend auth/validation/policy paths, `protectedManagedFundAccessMinimum`
(test-exercised), `buildSystemPromptSync`, `recoverOrphanedJobs`, useOmnichain*
one-caller hooks (intended shape), payment modal kind-wrappers, the two differing
infinite-scroll implementations, TransactionHistory `shortHash` (distinct 8/6 format).
