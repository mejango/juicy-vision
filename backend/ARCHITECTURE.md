# Juicy Vision Backend - Architecture

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Deno (TypeScript) |
| Framework | Hono |
| Database | PostgreSQL |
| Auth | Email OTP, Passkey/WebAuthn, SIWE |
| Wallet | ERC-4337 Smart Accounts |
| AI | Claude 3.5 (Anthropic) |
| Payments | Stripe |
| Blockchain | Ethereum, Optimism, Arbitrum, Base |

## Directory Structure

```
src/
├── db/               # Database layer
│   ├── index.ts      # Connection pool, query helpers
│   └── migrations/   # Schema (001_initial_schema.sql)
├── middleware/       # Request middleware
│   ├── auth.ts       # JWT validation
│   └── walletSession.ts
├── routes/           # API endpoints (~25 routes)
│   ├── auth.ts       # Email OTP login
│   ├── siwe.ts       # SIWE authentication
│   ├── passkey.ts    # WebAuthn
│   ├── chat.ts       # Multi-person chat
│   ├── juice.ts      # Stored value system
│   ├── wallet.ts     # Custodial wallet
│   └── ...
├── services/         # Business logic (~25 services)
│   ├── auth.ts       # User & session management
│   ├── passkey.ts    # WebAuthn credential ops
│   ├── smartAccounts.ts  # ERC-4337 accounts
│   ├── juice.ts      # Juice operations
│   ├── settlement.ts # Fiat settlement
│   ├── claude.ts     # AI integration
│   └── ...
├── context/          # Omnichain context builders
├── types/            # TypeScript types & Zod schemas
└── utils/            # Crypto, config, logging
```

## Core Services

### Authentication & Identity

| Service | Responsibility |
|---------|---------------|
| `auth.ts` | Email OTP, JWT tokens, sessions |
| `passkey.ts` | WebAuthn registration/authentication |
| `identity.ts` | Juicy Identity (emoji + username) |
| `encryption.ts` | E2E encryption key management |

### Wallet & Accounts

| Service | Responsibility |
|---------|---------------|
| `smartAccounts.ts` | ERC-4337 smart accounts (CREATE2) |
| `wallet.ts` | Token balances, transfers |
| `transactions.ts` | On-chain tx tracking |

### Payments

| Service | Responsibility |
|---------|---------------|
| `juice.ts` | Stored value operations |
| `settlement.ts` | Fiat→crypto settlement with risk delays |
| `aiBilling.ts` | AI usage billing |

### Chat & AI

| Service | Responsibility |
|---------|---------------|
| `chat.ts` | Multi-person chat, permissions |
| `websocket.ts` | Real-time messaging |
| `claude.ts` | Anthropic API integration |
| `contextManager.ts` | Token budget optimization |
| `summarization.ts` | Chat compression |

## Authentication Flows

### Email OTP (Managed Wallet)

```
User                    Backend                   Database
  │                        │                         │
  │──POST /auth/request────▶│                         │
  │                        │──Create 6-digit OTP────▶│
  │◀──────Email sent───────│                         │
  │                        │                         │
  │──POST /auth/verify─────▶│                         │
  │   (email + code)       │──Verify OTP────────────▶│
  │                        │──Create user if new────▶│
  │                        │──Create session────────▶│
  │◀─────JWT token─────────│                         │
```

### Passkey/WebAuthn

```
Registration:
1. GET /passkey/signup/options → Challenge + credential options
2. User creates credential on device
3. POST /passkey/signup/verify → Verify attestation, create user

Authentication:
1. GET /passkey/authenticate/options → Challenge
2. User signs with credential
3. POST /passkey/authenticate/verify → Verify, issue token
```

### SIWE (Self-Custody)

```
1. POST /auth/siwe/nonce → Random nonce (5-min expiry)
2. User signs message: "Sign in to Juicy... Nonce: abc123"
3. POST /auth/siwe/verify → Verify signature via viem
4. Create 30-day session token
```

## Smart Account Architecture

```
                    ┌─────────────────┐
                    │  User Account   │
                    │  (in database)  │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Ethereum (1)    │ │ Optimism (10)   │ │ Base (8453)     │
│ Smart Account   │ │ Smart Account   │ │ Smart Account   │
│ 0xabc...        │ │ 0xabc...        │ │ 0xabc...        │
└─────────────────┘ └─────────────────┘ └─────────────────┘
         │                   │                   │
         └───────────────────┴───────────────────┘
                             │
                    Same address (CREATE2)
                    Deterministic before deployment
```

**Key Features:**
- Counterfactual addresses (valid before deployment)
- One address per user per chain
- Gas sponsorship via paymaster
- Single-tx custody transfer to user EOA

## Context Management

Multi-layer optimization for AI token budget (50K tokens):

```
┌─────────────────────────────────────┐
│         Recent Messages             │ ← Raw, most volatile
│         (working memory)            │
├─────────────────────────────────────┤
│      Transaction State              │ ← Entity memory (project design)
│      (persistent facts)             │
├─────────────────────────────────────┤
│       Chat Summaries                │ ← Compressed history
│       (anchored to messages)        │
├─────────────────────────────────────┤
│     Attachment Summaries            │ ← Document extracts
│     (PDFs, images, etc.)            │
├─────────────────────────────────────┤
│        User Context                 │ ← Jargon level, preferences
│        (persistent)                 │
└─────────────────────────────────────┘
```

## Payment Settlement Flow

```
Stripe Payment                Risk Assessment           Settlement
     │                              │                       │
     ▼                              ▼                       ▼
┌──────────┐    Radar Score    ┌──────────┐           ┌──────────┐
│ Payment  │──────────────────▶│ Pending  │──(delay)─▶│ Execute  │
│ Received │                   │ Payment  │           │ On-chain │
└──────────┘                   └──────────┘           └──────────┘

Risk Score → Delay:
  0-20   → Immediate
  21-40  → 7 days
  41-60  → 30 days
  61-80  → 60 days
  81-100 → 120 days
```

## Database Schema Overview

### Core Tables

| Category | Tables |
|----------|--------|
| **Auth** | users, sessions, otp_codes |
| **Passkey** | passkey_credentials, passkey_challenges |
| **SIWE** | wallet_sessions |
| **Smart Accounts** | user_smart_accounts, smart_account_balances, smart_account_withdrawals |
| **Juice** | juice_balances, juice_purchases, juice_spends, juice_cash_outs |
| **Payments** | pending_fiat_payments, fiat_payment_disputes |
| **Chat** | multi_chats, multi_chat_members, multi_chat_messages |
| **Context** | chat_summaries, chat_transaction_state, attachment_summaries |

### Key Patterns

- **Row-level security**: All queries include user_id/member checks
- **JSONB**: Flexible data for metadata, state, extracted data
- **Generated columns**: Computed values (compression_ratio)
- **Triggers**: Auto-update timestamps
- **Views**: 15+ views for common queries

## External Integrations

### Blockchain

| Integration | Usage |
|-------------|-------|
| **RPC Providers** | Ankr, llamarpc, official endpoints |
| **Chains** | Ethereum (1), Optimism (10), Arbitrum (42161), Base (8453) |
| **viem** | Transaction signing, contract calls |
| **Chainlink** | ETH/USD price oracle (mainnet) |

### Juicebox Protocol

| Contract | Usage |
|----------|-------|
| **JBMultiTerminal** | Project payments |
| **JBController** | Token distribution |

### APIs

| Service | Purpose |
|---------|---------|
| **Stripe** | Payment processing, Radar fraud detection |
| **Anthropic** | Claude AI for chat |
| **Bendystraw** | Juicebox GraphQL API |
| **The Graph** | Uniswap V3 data |
| **Pinata/web3.storage** | IPFS archival |

## Background Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Session cleanup | Hourly | Remove expired sessions |
| Transfer execution | Hourly | Process pending transfers |
| Juice credit processing | 5 min | Credit cleared purchases |
| Juice spend processing | 2 min | Execute on-chain spends |
| Cash-out processing | 5 min | Process withdrawals |
| Rate limit cleanup | Hourly | Clear old rate limit records |

**Development**: setInterval in main.ts
**Production**: GCP Cloud Scheduler → `/api/cron/*`

## Privacy Modes

| Mode | Chat Storage | Analytics | AI Training | Identity |
|------|:------------:|:---------:|:-----------:|:--------:|
| Open Book | Yes | Yes | Yes | Full |
| Anonymous | Yes | Yes | Yes | Stripped |
| Private | No | Yes | No | Stripped |
| Ghost | No | No | No | Stripped |

## User Identity Resolution

Because users can authenticate via multiple methods, a single user may have different addresses in different contexts:

| Auth Method | Address Type | Storage |
|-------------|--------------|---------|
| **SIWE** | EOA wallet address | `wallet_sessions.wallet_address` |
| **Touch ID / Passkey** | Smart account address | `user_smart_accounts.address` |
| **Anonymous** | Pseudo-address (HMAC-SHA256) | Derived from session ID |

### Identity Matching Rules

When checking if a member/sender is the current user, **always check ALL possible addresses**:

```typescript
// ❌ WRONG - only checks one address type
const isCurrentUser = member.address === walletSession?.address

// ✅ CORRECT - checks all address types with case-insensitive comparison
const isCurrentUser =
  member.address?.toLowerCase() === siweAddress?.toLowerCase() ||
  member.address?.toLowerCase() === smartAccountAddress?.toLowerCase() ||
  member.address?.toLowerCase() === pseudoAddress?.toLowerCase()
```

### Frontend Helper

Use `getCurrentUserAddress()` from `session.ts` which returns the correct address with priority:
1. SIWE wallet address (self-custody)
2. Smart account address (managed mode / Touch ID)
3. Session pseudo-address (anonymous)

### Backend Resolution

Backend routes use middleware that resolves user identity:
- `requireWalletOrAuth`: JWT → Smart account address, SIWE → wallet address
- Session pseudo-addresses generated via `getPseudoAddress(sessionId)` using HMAC-SHA256

### Key Gotchas

1. **Case sensitivity**: Always use `.toLowerCase()` for address comparison
2. **Cache location**: Smart account address cached in `localStorage['juice-smart-account-address']`
3. **Migration**: Users may join a chat anonymously, then sign in later - their member record may have either address

## API Route Structure

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/auth/request-code` | None | Request email OTP |
| `POST /api/auth/verify-code` | None | Verify OTP, get JWT |
| `POST /api/auth/siwe/nonce` | None | Get SIWE nonce |
| `POST /api/auth/siwe/verify` | None | Verify SIWE signature |
| `GET /api/passkey/*/options` | None | Get WebAuthn challenge |
| `POST /api/passkey/*/verify` | None | Verify WebAuthn response |
| `GET /api/chat` | Required | List user's chats |
| `POST /api/chat` | Required | Create chat |
| `WS /api/chat/:id/ws` | Optional | Real-time messaging |
| `POST /api/juice/purchase` | Required | Buy Juice |
| `POST /api/juice/spend` | Required | Spend Juice on project |
| `POST /api/juice/cash-out` | Required | Withdraw to wallet |
| `GET /api/wallet/balances` | Required | Token balances |
| `POST /api/stripe/webhook` | Stripe sig | Payment events |
| `POST /api/cron/*` | OIDC/secret | Background jobs |
