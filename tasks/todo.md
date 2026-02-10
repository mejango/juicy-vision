# Cost Management, Vibeengineering, and Security Hardening

## Latest: Shop Owner Controls (Tier Management)

**Status: Complete**

Added owner controls to the Shop tab for managing NFT tiers, including AI prompt updates for chat-based tier management.

### AI Prompt Updates (`shared/prompts/transaction/nftTiers.ts`)

Extended the NFT tiers prompt module to support existing project tier management:

1. **adjustTiers documentation** - Function signature, adding/removing tiers
2. **setDiscountPercentsOf documentation** - Batch discount updates
3. **Multi-chain inventory explanation** - Jargon-free guidance: "If you set a limited quantity, each chain will have its own stock. For example, 50 available means 50 on each chain where your project runs."
4. **Chat flow guidance** - Step-by-step instructions for guiding users through tier operations
5. **Extended hints** - Added: adjustTiers, add tier, remove tier, delete tier, sell something, setDiscount, discount, sale, price reduction, edit tier, update tier, tier metadata

### UI Implementation

**ShopTab changes (`src/components/dynamic/ShopTab.tsx`):**
1. Added "Sell something" button (green, top right) for owners - triggers chat flow to add new tier
2. Added `hasTokenUriResolver()` check to determine if tier metadata can be edited
3. Added handler functions for tier actions that trigger chat-based flows:
   - `handleEditMetadata` - Edit tier name/description/image
   - `handleSetDiscount` - Set discount percentage
   - `handleRemoveTier` - Remove tier from shop

**NFTTierCard changes (`src/components/dynamic/NFTTierCard.tsx`):**
1. Added three-dot owner menu with:
   - **Edit info** - Disabled if hook has tokenUriResolver (on-chain metadata)
   - **Set discount** - Shows current discount if set
   - **Remove** - Disabled if `cannotBeRemoved` flag is set
2. Added click-outside handler to close menu
3. New props: `hasTokenUriResolver`, `onEditMetadata`, `onSetDiscount`, `onRemoveTier`

**NFT Service changes (`src/services/nft/index.ts`):**
1. Added `hasTokenUriResolver()` function to check if hook uses on-chain URI resolver

**Conditional Guards:**
- "Edit info" disabled when hook has tokenUriResolver
- "Remove" disabled when tier has `cannotBeRemoved` flag
- "Deploy ERC20" hidden when project already has token

---

## Previous: Owner Actions Menu in Project Dashboard

**Status: Complete**

Added a gear icon button next to the "You" badge on the Project Dashboard that opens a dropdown menu with all owner actions:

**Implementation in `src/pages/ProjectDashboard.tsx`:**

1. Extended `ModalType` to include: `reservedTokens`, `deployErc20`, `surplusAllowance`, `manageTiers`, `setSplits`, `setUri`
2. Added owner action form imports: `SendReservedTokensForm`, `DeployERC20Form`, `UseSurplusAllowanceForm`, `ManageTiersForm`, `SetSplitsForm`, `SetUriForm`
3. Added `showOwnerMenu` state and `ownerMenuRef` for click-outside handling
4. Added `hasErc20Token` computed property (from `project.tokenSymbol`)
5. Added gear icon button next to "You" badge (desktop and mobile layouts)
6. Added grouped owner actions dropdown menu:
   - **Funds**: Send Payouts, Use Surplus Allowance
   - **Tokens**: Send Reserved Tokens, Deploy ERC20 (conditional: only if no token)
   - **Configuration**: Queue Ruleset, Configure Splits, Update Metadata
   - **Inventory**: Manage NFT Tiers (conditional: only if hasNftHook)
7. Added modal wrappers for each form component (desktop and mobile styles)

**Conditional Guards:**
- Deploy ERC20: Only shown if `!hasErc20Token`
- Manage NFT Tiers: Only shown if `hasNftHook`

---

## Previous: Ruleset Caching for Revnets

**Status: Complete**

Added client-side caching to bendystraw for ruleset history and revnet stages:
- Revnets: Permanent cache (immutable data)
- Regular projects: 1-hour TTL cache

**Changes in `src/services/bendystraw/client.ts`:**
1. Added `rulesetHistoryCache` (TTL), `revnetRulesetHistoryCache` (permanent), `revnetStagesCache` (permanent)
2. Modified `fetchRevnetStages()` - checks cache first, recomputes time-dependent flags on hit
3. Modified `fetchRulesetHistory()` - checks both caches, stores in appropriate cache based on project type

---

## Completed Tasks

### Phase 1: Cost Management

- [x] **Dynamic Model Selection** (`claude.ts`)
  - Added `selectModel()` function that chooses between Haiku 3.5 ($1/1M) and Sonnet 4 ($15/1M)
  - Uses intent detection patterns: complex queries → Sonnet, simple queries → Haiku
  - Considers tool usage and token count in decision

- [x] **PostgreSQL Rate Limiting** (`claude.ts`, `rateLimit.ts`)
  - Removed in-memory rate limits from `claude.ts`
  - Now uses existing `rateLimit.ts` PostgreSQL implementation
  - Survives restarts, works across instances

- [x] **Token-Based Billing** (`aiBilling.ts`, `config.ts`, `types/index.ts`)
  - Added `AI_FREE_MODE` environment variable (default: `true` for beta)
  - Added `calculateTokenCost()` for per-model cost calculation
  - Updated `deductAiCost()` to use actual token counts

### Phase 2: Security Hardening

- [x] **Per-Tool Rate Limits** (`rateLimit.ts`)
  - Added limits for sensitive AI tools:
    - `pin_to_ipfs`: 10/hour
    - `execute_bridge_transaction`: 5/hour
    - `prepare_bridge_transaction`: 20/hour
    - `claim_bridge_transaction`: 20/hour
  - Added `checkToolRateLimit()` helper function

- [x] **GraphQL Query Sanitization** (`omnichain.ts`)
  - Added `sanitizeForGraphQL()` function
  - Removes quotes, backslashes, and control characters
  - Limits query length to 100 chars

- [x] **Structured Error Types** (`errors/AppError.ts`)
  - Created `AppError` base class with code, message, statusCode
  - Added specialized errors: `RateLimitError`, `AuthError`, `ForbiddenError`, `NotFoundError`, `ValidationError`, `ConflictError`, `ExternalServiceError`, `CircuitBreakerError`, `InsufficientBalanceError`
  - Added `isAppError()` type guard

- [x] **Global Error Handler** (`main.ts`)
  - Updated `app.onError()` to detect `AppError` instances
  - Returns structured JSON with error code and proper status
  - Sets `Retry-After` header for rate limits

### Phase 3: Code Hardening

- [x] **Circuit Breaker** (`utils/circuitBreaker.ts`)
  - Created `CircuitBreaker` class with closed/open/half-open states
  - Pre-configured breakers for: Bendystraw, IPFS, Juicerkle, MCP Docs
  - Added `getAllCircuitStats()` for monitoring

### Phase 4: AI Confidence Escalation System

- [x] **Confidence Signal in Prompts** (`shared/prompts.ts`)
  - Added confidence signal instruction to BASE_PROMPT
  - AI now ends responses with `<confidence level="high|medium|low" reason="..."/>`
  - Low confidence triggers user-facing uncertainty message

- [x] **Confidence Parsing** (`backend/src/services/claude.ts`)
  - Added `parseConfidence()` function to extract and strip confidence tags
  - Returns cleaned content and confidence metadata

- [x] **Escalation Service** (`backend/src/services/escalation.ts`)
  - `createEscalation()` - Auto-create on low confidence
  - `getEscalationQueue()` - List pending for admin with filtering
  - `getEscalation()` - Get single with conversation context
  - `resolveEscalation()` - Admin marks approved/corrected
  - `getEscalationStats()` - Queue statistics

- [x] **Trending Context Service** (`backend/src/services/trendingContext.ts`)
  - Fetches top 10 projects from Bendystraw by trendingScore
  - Caches in PostgreSQL with 1-hour TTL
  - Injects into AI system prompt to prevent hallucination

- [x] **Context Manager Update** (`backend/src/services/contextManager.ts`)
  - Imports trending context and injects into buildEnhancedSystemPrompt

- [x] **Admin Escalation Routes** (`backend/src/routes/admin.ts`)
  - GET `/admin/escalations` - Queue with filtering
  - GET `/admin/escalations/stats` - Queue statistics
  - GET `/admin/escalations/:id` - Detail with context
  - POST `/admin/escalations/:id/resolve` - Resolve escalation

- [x] **Trending Refresh Cron** (`backend/src/routes/cron.ts`)
  - POST `/cron/trending` - Hourly refresh of trending projects

- [x] **Chat Flow Integration** (`backend/src/routes/chat.ts`)
  - Parses confidence from AI responses
  - Stores confidence metadata with messages
  - Auto-creates escalations for low-confidence responses

- [x] **Admin UI: EscalationsPage** (`src/admin/pages/EscalationsPage.tsx`)
  - Stats cards (pending, approved, corrected, avg review time)
  - Filterable table by status
  - Click to view details

- [x] **Admin UI: EscalationViewer** (`src/admin/components/EscalationViewer.tsx`)
  - Shows user query, AI response, confidence reason
  - Displays surrounding conversation context
  - Approve/correct actions with notes

- [x] **Admin Navigation** (`src/admin/AdminApp.tsx`, `src/admin/AdminLayout.tsx`)
  - Added escalations route and navigation link

- [x] **Database Migration** (`backend/src/db/migrations/004_escalation.sql`)
  - Added ai_confidence, ai_confidence_reason to multi_chat_messages
  - Created ai_escalations table
  - Created context_cache table for trending data

### Phase 5: Specialist Knowledge Routing System

- [x] **Sub-Module System** (`shared/prompts/transaction/*.ts`)
  - Decomposed TRANSACTION_CONTEXT (8k tokens) into 10 granular modules (~200-1500 tokens each)
  - Created: chains, v51Addresses, v5Addresses, terminals, splitsLimits, nftTiers, revnetParams, rulesets, deployment, metadata
  - Each module has its own hints, token estimate, and description

- [x] **Sub-Module Aggregator** (`shared/prompts/index.ts`, `shared/prompts/transaction/index.ts`)
  - Module registry with `TRANSACTION_SUB_MODULES` array
  - `matchSubModulesByKeywords()` for keyword-based selection
  - `buildTransactionContext()` to assemble selected modules
  - `estimateSubModuleTokens()` for token counting

- [x] **Context Manager Updates** (`backend/src/services/contextManager.ts`)
  - Extended `DetectedIntents` with `transactionSubModules` field
  - `detectIntentsWithContext()` now detects granular sub-modules
  - `buildModularPromptWithSubModules()` for token-efficient prompts
  - Updated `buildEnhancedSystemPrompt()` with `useSubModules` option

- [x] **Intent Embeddings Migration** (`backend/src/db/migrations/005_intent_embeddings.sql`)
  - pgvector extension for similarity search
  - `intent_embeddings` table with domain, sub_module, embedding vector(1024)
  - IVFFlat index for fast approximate nearest neighbor search

- [x] **Embedding Service** (`backend/src/services/embeddingService.ts`)
  - Voyage AI API wrapper for generating embeddings
  - In-memory LRU cache for embedding results
  - Batch embedding support for seeding
  - Cosine similarity calculation

- [x] **Semantic Intent Detection** (`backend/src/services/intentDetection.ts`)
  - Hybrid semantic + keyword intent detection
  - `detectSemanticIntents()` queries pgvector for similar intents
  - Combines with keyword matching for fallback/boost
  - `seedIntentEmbeddings()` for populating the database

- [x] **Intent Metrics** (`backend/src/db/migrations/006_intent_metrics.sql`, `backend/src/services/intentMetrics.ts`)
  - `intent_detection_metrics` table for per-invocation logging
  - `intent_detection_stats` table for aggregated statistics
  - `logIntentDetection()`, `updateIntentMetrics()` for tracking
  - `aggregateHourlyStats()`, `aggregateDailyStats()` for cron jobs
  - `getStatsSummary()`, `getTopSubModules()` for analytics

- [x] **MCP Server Integration** (`.claude/plugins/jb-knowledge/.mcp.json`)
  - Registered existing docs.juicebox.money MCP server
  - Provides: search_docs, get_doc, get_contract_addresses, get_sdk_reference, etc.

- [x] **Chat Route Integration** (`backend/src/routes/chat.ts`)
  - Enabled sub-module loading in `buildEnhancedPrompt()`
  - Intent metrics logging on each AI invocation
  - AI confidence level tracking in metrics

- [x] **Cron Job** (`backend/src/routes/cron.ts`)
  - Added `/cron/intent-metrics/aggregate` endpoint
  - Hourly aggregation with daily rollup at midnight
  - Cleanup of old detailed metrics (30-day retention)

## Expected Outcomes

| Metric | Before | After |
|--------|--------|-------|
| Avg tokens per request | ~14,500 | ~8,500 (-41%) |
| Intent detection accuracy | ~70% (keyword) | ~90% (hybrid) |
| Time to add new domain | Modify prompts.ts | Add sub-module or use MCP |

## Deferred Tasks

- [ ] Split `chat.ts` (1,484 lines) → 4 files
- [ ] Split `smartAccounts.ts` (1,783 lines) → 3 files

## Verification Results

- [x] TypeScript compiles: `npx tsc --noEmit` ✓
- [x] All modified files pass type check ✓

## Files Modified

| File | Changes |
|------|---------|
| `services/claude.ts` | Model selection, PostgreSQL rate limits, confidence parsing |
| `services/aiBilling.ts` | Token-based billing, env var control |
| `services/rateLimit.ts` | Tool-specific rate limits |
| `services/omnichain.ts` | GraphQL sanitization |
| `services/contextManager.ts` | Trending context injection |
| `routes/admin.ts` | Escalation endpoints |
| `routes/cron.ts` | Trending refresh job |
| `routes/chat.ts` | Confidence integration |
| `shared/prompts.ts` | Confidence signal instruction |
| `utils/config.ts` | Added `aiFreeMode` config |
| `types/index.ts` | Added `aiFreeMode` to `EnvConfig` |
| `main.ts` | Structured error handling |
| `src/admin/AdminApp.tsx` | Escalations route |
| `src/admin/AdminLayout.tsx` | Escalations nav link |

## New Files

| File | Purpose |
|------|---------|
| `errors/AppError.ts` | Structured error types |
| `utils/circuitBreaker.ts` | Circuit breaker for external services |
| `backend/src/services/escalation.ts` | Escalation queue logic |
| `backend/src/services/trendingContext.ts` | Fetch/cache trending projects |
| `backend/src/db/migrations/004_escalation.sql` | Schema changes |
| `src/admin/pages/EscalationsPage.tsx` | Admin queue UI |
| `src/admin/components/EscalationViewer.tsx` | Detail view |
