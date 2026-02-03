# This is the product spec.

## TLDR

Rich interactions with the juicebox ecosystem, via chat.

## User Features
- anyone can start a chat
- chats by default are private. anyone can share a chat by inviting others, optionally also giving write and invite permissions to whoever clicks the link.
- when multiple people are in the chat, have all users' queries come from the right, and the AI's responsed come from the left.
- each users' message should be labeled with account info (address, ENS, Anonymous, or You).
- the site should allow users to connect to it via passkeys to instantiate a new local wallet, or SIWE. Connecting a wallet but not signing in shows a connected state but not "on".
- the site needs a user to be 'on' in order to save their chat history in a way that can be access on another device. otherwise the chats only can be accessed by a session id that is cached locally.
- allow a user to add their email in settings, confirmed after an OTP. this helps a user log in on another device later. allow an account to have many auth methods.
- users can send transactions from inline the chat, either from an "on" account in the server or from a connected wallet. if there's no connected account, the chat prompts for the user to connect an account in order to proceed.
- if sending a tx from an 'on' account, the server handles all transaction processing on the users' behalf. using a connected wallet, the user conducts things themselves, and the chat should standby to interpret results emited from the blockchain.

## Chat History & Organization
- all user chats appear in the Recent list in the sidebar, sorted by most recently updated
- chats are auto-named by AI as the conversation evolves - after AI responses, the system generates a contextual title (3-6 words) to help users reference the chat later
- users can manually rename any chat, which overrides the auto-generated title
- users can delete chats from their history (founder only for multi-person chats)
- users can create folders to organize chats, with support for nested folders (folders within folders)
- folders can be manually named, or left to be auto-named based on their contents
- chats and folders can be pinned for quick access - pinned items appear at the top of their respective sections
- pinned chats and folders can be reordered by the user for custom organization
- right-click context menu provides quick access to: pin/unpin, rename, move to folder, and delete
- chat organization state syncs across devices for authenticated users 


## Privacy Modes

Juicy Vision supports four distinct privacy modes for different user needs:

| Mode | Description | Data Handling |
|------|-------------|---------------|
| **open_book** | Full collaboration mode | Conversations shared, messages visible to all participants |
| **anonymous** | Participate without identity | Session-based tracking only, no persistent identity |
| **private** | End-to-end encrypted | Group keys for multi-person chats, server cannot read messages |
| **ghost** | Maximum privacy | Minimal data retention, ephemeral sessions |

## Quality Priorities
- **speed**: fast initial load, minimal bundle size, aggressive code splitting, optimized caching
- **stability**: graceful error handling, resilient WebSocket reconnection, offline-first PWA patterns
- **testability**: comprehensive unit tests, E2E coverage, isolated components, mockable services
- **mobile-first**: responsive design prioritizing chat views, golden ratio spacing, touch-friendly interactions
- **error handling**: centralized error handler, user-friendly messages, structured logging in prod

## Client Features
- built with React 18, TypeScript, Vite, and Tailwind CSS
- PWA support with offline caching and service worker
- dark/light theme toggle
- local chat history persisted in localStorage via Zustand
- multi-person server-based chats with end-to-end encryption
- streaming AI responses with thinking indicator
- dynamic component rendering from AI-generated JSON (transaction previews, charts, project cards, NFT galleries, etc.)
- real-time Juicebox protocol activity feed in sidebar
- wallet connection via WalletConnect and injected providers
- multi-chain support: Mainnet, Optimism, Base, Arbitrum
- conversation export and shareable links for local chats
- invite modal for multi-person chat member management
- auth options modal (passkey, SIWE, email OTP)
- interactive mascot panel with quick suggestions
- i18n support with browser language detection

## Server Features
- Deno runtime with Hono framework
- PostgreSQL database with migrations
- allow full sessions without the user being authenticated. auth just helps a user access progress.
- all normie users get a smart account wallet (GCP KMS-backed key derivation)
- users can pay projects either in crypto or with Stripe. if with stripe, account for the increment to the project's balance, and when deemed risk-appropriate, pay the project from our own balance and account for the users' tokens correctly.
- "Squeeze to Pay" AI billing model: chat AI balance tracking, cost per request, auto-refill on NANA payments
- WebSocket-based real-time chat with presence tracking, typing indicators, and message broadcasting
- end-to-end encryption for multi-person chats with group key rotation
- JWT-based session management (7-day duration)
- email OTP authentication (6-digit codes, 10-min expiry)
- WebAuthn/passkey credential storage and verification
- Sign-In-With-Ethereum (SIWE) support
- token gating for chat invites (ERC20 balance verification)
- Claude API integration with streaming, tool calling, and rate limiting (100 requests/100k tokens per hour per user)
- IPFS integration via Pinata for chat archive storage
- Stripe webhook handler for payment processing
- API proxies for Bendystraw (Juicebox GraphQL) and multi-chain RPC
- background cron jobs: rate limit cleanup, session expiration, pending transfers, passkey challenge cleanup
- Relayr balance integration for gas sponsorship: fund a single pooled balance, sponsor gas for both managed accounts and connected wallets across all EVM chains
- zero-gas UX: users transact without needing native tokens, server submits bundles via Relayr `/v1/bundle/balance` endpoint
- centralized gas accounting: track per-user gas costs alongside AI token usage, single balance to monitor/replenish instead of per-chain reserves

## Data Features

### Implemented
- user context profiles track jargon familiarity level (beginner/intermediate/advanced), familiar terms, and timestamped observations
- training pipeline scripts (`backend/scripts/training/`) that export conversations, analyze patterns, and generate optimization outputs
- pipeline outputs include: training reports, prompt patches (additions/modifications), and few-shot examples
- training run tracking in database (`training_runs` table)

### Planned
- weekly automated training pipeline via GitHub Actions (Sundays at midnight UTC)
- effectiveness scores (0.00-1.00) for applied suggestions with feedback loops
- automatic GitHub issue creation for critical findings
- 90-day artifact retention policy
- severity prioritization (critical/high/medium/low) for prompt improvement suggestions

## Environment Features
- Docker Compose for local dev (PostgreSQL 16, backend on port 3001)
- Vite build with manual code splitting (vendor-react, vendor-ui, vendor-state, vendor-web3)
- GitHub Actions CI/CD: frontend tests, E2E tests, backend deploy to GCP Cloud Run
- frontend deployed to IPFS gateway
- backend deployed to GCP Cloud Run (serverless)
- database on Google Cloud SQL
- secrets managed via GCP Secret Manager + KMS
- Vitest for frontend unit tests, Playwright for E2E, Deno test runner for backend
- workbox caching with 5MB limit, network-only for Anthropic API

## Deployment

Production deployment uses a multi-platform approach:

| Component | Platform | Notes |
|-----------|----------|-------|
| Frontend | Railway / IPFS | Static site with CDN |
| Backend | Railway / GCP Cloud Run | Serverless containers |
| Database | Railway / GCP Cloud SQL | Managed PostgreSQL 16 |
| Secrets | GCP Secret Manager + KMS | Secure key management |

See [Deployment Guide](./docs/DEPLOYMENT.md) for detailed architecture and [Railway Deployment](./DEPLOY_RAILWAY.md) for step-by-step setup.

## Architecture

For code standards, design principles, and contribution guidelines, see [PRINCIPLES.md](./PRINCIPLES.md).

Key architectural decisions:
- **Chat-first**: All interactions flow through the chat interface
- **Security-first**: API keys never in browser, all sensitive calls proxied through backend
- **Privacy by design**: Four privacy modes with appropriate data handling
- **Type safety**: Full TypeScript with strict mode, no unsafe type assertions
