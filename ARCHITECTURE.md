# Architecture

Juicy Vision is a conversational interface for the Juicebox ecosystem. This document covers the core architecture with emphasis on the account system, wallet management, and transaction modeling.

---

## Design Philosophy

**For non-crypto users:** It just works. No wallet, no gas, no confusion.

**For crypto users:** Real assets, real on-chain accounts, real exit rights. Sovereignty when you want it.

**For us:** Operational complexity (managing reserves, gas, exports) but no custodial liability claims. We're a service, not a bank.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Auth Store   │  │ Wallet       │  │ Chat Interface       │  │
│  │ (Zustand)    │  │ (wagmi)      │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend (Deno/Hono)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Auth Service │  │ Juice        │  │ Smart Account        │  │
│  │              │  │ Service      │  │ Service              │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                              │                                  │
│                    ┌─────────┴─────────┐                       │
│                    ▼                   ▼                        │
│             ┌──────────────┐   ┌──────────────┐                │
│             │ PostgreSQL   │   │ Reserves     │                │
│             │              │   │ Wallet       │                │
│             └──────────────┘   └──────────────┘                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Blockchain Layer                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Ethereum     │  │ Optimism     │  │ Base / Arbitrum      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                 │
│  Default Operating Chain: Arbitrum (42161) - lowest fees        │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Model: Managed Accounts with Exit Rights

We operate a **managed service / credits model**, not a custodial wallet:

- Users buy Juice credits (like game tokens or arcade credits)
- We execute Juicebox transactions on their behalf
- They accumulate real on-chain assets in a Smart Account we control
- They can export to self-custody anytime, taking full control

```
┌─────────────────────────────────────────────────────────────────┐
│                      THREE-LAYER SYSTEM                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: JUICE BALANCE                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Database credits ($1 = 1 Juice)                          │   │
│  │ Controlled by: Us                                        │   │
│  │ Stored in: PostgreSQL                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  Layer 2: SMART ACCOUNT (Managed)                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ERC-4337 wallet on-chain                                 │   │
│  │ Controlled by: Us (until export)                         │   │
│  │ Contains: Project tokens, NFTs, ETH                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼ (export)                         │
│  Layer 3: USER'S EOA (Self-Custody)                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ User's own wallet                                        │   │
│  │ Controlled by: User (permanently)                        │   │
│  │ We have: Zero access after export                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## User Journey

### 1. Onboard (No Wallet Needed)

```
User                    Juicy Vision              Stripe
  │                          │                       │
  │── Sign in (passkey) ────►│                       │
  │                          │                       │
  │── "Buy $20 Juice" ──────►│                       │
  │                          │── Payment Intent ────►│
  │                          │◄── Confirmed ────────│
  │                          │                       │
  │◄── 20 Juice credited ───│                       │
```

### 2. Interact (We Handle Everything)

```
User                    Juicy Vision              Blockchain
  │                          │                       │
  │── "Pay Project X        │                       │
  │    5 Juice" ────────────►│                       │
  │                          │── Debit 5 Juice      │
  │                          │── Get ETH/USD rate   │
  │                          │── Execute tx ────────►│
  │                          │   (from Smart Acct)  │
  │                          │◄── Tx confirmed ─────│
  │                          │                       │
  │◄── "Done! You got       │                       │
  │    1,000 $PROJECT" ─────│                       │
```

### 3. Export (When Ready for Sovereignty)

```
User                    Juicy Vision              Blockchain
  │                          │                       │
  │── "Export my account    │                       │
  │    to 0xabc..." ────────►│                       │
  │                          │── Check blockers     │
  │                          │── Build snapshot     │
  │◄── "You have:           │                       │
  │    - 1.5 ETH            │                       │
  │    - 50k $PROJECT       │                       │
  │    Export?" ────────────│                       │
  │                          │                       │
  │── Confirm ──────────────►│                       │
  │                          │── transferOwnership ─►│
  │                          │   (per chain)        │
  │                          │◄── Confirmed ────────│
  │                          │                       │
  │◄── "Done! You now       │                       │
  │    control 0xabc" ──────│                       │
```

---

## Account System

### Dual-Mode Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      User Authentication                        │
├────────────────────────────┬────────────────────────────────────┤
│                            │                                    │
│      Managed Mode          │       Self-Custody Mode            │
│      (Email/Passkey)       │       (Connected Wallets)          │
│                            │                                    │
├────────────────────────────┼────────────────────────────────────┤
│  - Email + OTP auth        │  - SIWE (Sign-In-With-Ethereum)   │
│  - Passkey/WebAuthn        │  - 30-day wallet sessions          │
│  - JWT tokens              │  - User controls private keys      │
│  - Smart Account wallet    │  - Server is read-only             │
│  - We sign transactions    │  - User signs in their wallet      │
│  - Can export anytime      │  - Already sovereign               │
└────────────────────────────┴────────────────────────────────────┘
```

### Authentication Methods

#### 1. Email/OTP (Managed Mode)

- OTP codes expire in 10 minutes
- Invalid codes auto-expire on failure
- JWT token returned for subsequent requests

#### 2. Passkey/WebAuthn (Managed Mode)

- Supports platform (biometric) and cross-platform (hardware key) authenticators
- 5-minute challenge expiry
- Counter tracking for replay protection

#### 3. SIWE (Self-Custody Mode)

- Sign-In-With-Ethereum standard
- 30-day session tokens
- Supports anonymous session linking

### Session Management

| Session Type | Storage | Expiry | Use Case |
|--------------|---------|--------|----------|
| JWT Session | `sessions` table | 7 days | Managed users (email/passkey) |
| Wallet Session | `wallet_sessions` table | 30 days | Self-custody users (SIWE) |
| Anonymous Session | In-memory | Ephemeral | Pre-auth interactions |

### Owner Choice (Dual-Auth Users)

When a user has **both** a connected wallet AND passkey authentication, they can choose which identity to use as project owner:

```
┌─────────────────────────────────────────────────────────────────┐
│                    OWNER CHOICE UI                               │
│             (appears when both auth methods present)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Option 1: Connected Wallet                              │   │
│  │  Address: 0x1234...5678 (susy.eth)                       │   │
│  │  Signing: User signs with wallet (MetaMask, etc.)        │   │
│  │  Owner: Their EOA                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Option 2: Smart Account                                 │   │
│  │  Address: 0xabcd...efgh (managed)                        │   │
│  │  Signing: Server signs on their behalf                   │   │
│  │  Owner: Their Smart Account                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation:**
- `LaunchProjectModal.tsx` detects when `hasBothOptions` is true
- User must explicitly choose before proceeding
- Choice sets `forceSelfCustody: true` for wallet mode
- Choice resets when modal reopens

---

## Transaction Signing Architecture

All omnichain transactions are submitted through [Relayr](https://relayr.network/) for cross-chain bundling. The signing method depends on authentication mode.

### ERC-2771 Meta-Transactions

Both modes use ERC-2771 meta-transactions via a TrustedForwarder:

```
┌─────────────────────────────────────────────────────────────────┐
│                   ERC-2771 FLOW                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Original Transaction                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  to: JBOmnichainDeployer                                 │   │
│  │  data: launchProjectFor(...)                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼ (wrap)                           │
│  ForwardRequest (signed)                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  from: signer address                                    │   │
│  │  to: JBOmnichainDeployer                                 │   │
│  │  data: launchProjectFor(...)                             │   │
│  │  nonce: forwarder nonce                                  │   │
│  │  deadline: 48 hours                                      │   │
│  │  signature: EIP-712 typed data signature                 │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼ (execute)                        │
│  TrustedForwarder.execute()                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  to: 0xc29d6995...acbb566 (same on all chains)           │   │
│  │  data: execute(ForwardRequest)                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Signing Modes

#### 1. Managed Mode (Server Signing)

User authenticates with passkey → server holds their PRF-derived signing key → no signature prompts.

```
User                    Frontend                  Backend                  Relayr
  │                        │                         │                        │
  │── Click "Create" ─────►│                         │                        │
  │                        │── POST /wallet/bundle ─►│                        │
  │                        │   (transactions)        │                        │
  │                        │                         │── Sign ERC-2771       │
  │                        │                         │   (stored key)         │
  │                        │                         │── POST /bundle ───────►│
  │                        │                         │◄── bundle_uuid ────────│
  │                        │◄── { bundleId } ────────│                        │
  │◄── "Processing..." ────│                         │                        │
```

**Key storage:**
- User's signing key is derived from WebAuthn PRF extension during login
- Stored encrypted (AES-GCM) in `user_keypairs` table
- Never leaves the server except for signing operations

#### 2. Self-Custody Mode (Wallet Signing)

User connects wallet → signs each transaction with wallet → no server key storage.

```
User                    Frontend                  Wallet                   Relayr
  │                        │                         │                        │
  │── Click "Create" ─────►│                         │                        │
  │                        │── Read nonce (chain 1) ─►│                        │
  │                        │── Sign request ─────────►│                        │
  │◄── Confirm signature ──│◄────────────────────────│                        │
  │                        │── Read nonce (chain 2) ─►│                        │
  │                        │── Sign request ─────────►│                        │
  │◄── Confirm signature ──│◄────────────────────────│                        │
  │                        │   ... (per chain)       │                        │
  │                        │── POST /bundle ─────────────────────────────────►│
  │                        │◄── bundle_uuid ──────────────────────────────────│
  │◄── "Processing..." ────│                         │                        │
```

**Signature prompts:**
- One signature required per chain
- Shows EIP-712 typed data in wallet
- 48-hour deadline for replay protection

### Transaction Structure

```typescript
// useOmnichainLaunchProject parameters
interface OmnichainLaunchProjectParams {
  chainIds: number[]                    // Chains to deploy on
  owner: string                         // Project owner address
  projectUri: string                    // IPFS CID for metadata
  rulesetConfigurations: JBRulesetConfig[]
  terminalConfigurations: JBTerminalConfig[]
  memo: string
  suckerDeploymentConfiguration?: JBSuckerDeploymentConfig  // Cross-chain bridging
  chainConfigs?: ChainConfigOverride[]  // Per-chain overrides
  forceSelfCustody?: boolean            // Force wallet signing in managed mode
}
```

### Relayr Balance API

Transactions are submitted through Relayr's balance-based bundling API for gas sponsorship:

```
POST https://api.relayr.network/v1/bundle/balance
```

**Request:**
```json
{
  "app_id": "juicy-vision",
  "transactions": [
    {
      "chain": 42161,
      "target": "0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71",
      "data": "0x...",
      "value": "0"
    }
  ],
  "perform_simulation": true,
  "virtual_nonce_mode": "Disabled"
}
```

**Response:**
```json
{
  "bundle_uuid": "abc-123",
  "status": "pending",
  "payment_options": [...]
}
```

**Status Polling:**
```
GET https://api.relayr.network/v1/bundle/{bundle_uuid}/status
```

Returns per-chain execution status including `txHash` and `projectId` (parsed from events).

**Benefits:**
- Single pooled balance to monitor instead of per-chain reserves
- Users don't need native tokens on target chains
- Works for both managed accounts and connected wallets

### forceSelfCustody Parameter

The `forceSelfCustody` parameter overrides the default signing behavior:

| Condition | forceSelfCustody | Signing Method |
|-----------|------------------|----------------|
| Managed mode | false/undefined | Server signing |
| Managed mode | true | Wallet signing |
| Self-custody mode | any | Wallet signing |

**Use case:** When a managed user also has a wallet connected and wants to use their EOA as project owner instead of their Smart Account.

---

## Juice System (Stored Value)

Juice enables non-crypto users to pay Juicebox projects with fiat.

### Key Properties

- **1 Juice = $1 USD**
- **Non-refundable** - Service credits, not deposits
- **Non-transferable** - Can only spend or cash out
- **No guarantees** - We're a service, not a bank

### Database Schema

```sql
-- User balances
CREATE TABLE juice_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  balance DECIMAL(18,2) NOT NULL DEFAULT 0,
  lifetime_purchased DECIMAL(18,2) NOT NULL DEFAULT 0,
  lifetime_spent DECIMAL(18,2) NOT NULL DEFAULT 0,
  lifetime_cashed_out DECIMAL(18,2) NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 year'
);

-- Purchase records (Stripe → Juice)
CREATE TABLE juice_purchases (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  stripe_payment_intent_id VARCHAR(255) NOT NULL,
  fiat_amount DECIMAL(18,2) NOT NULL,
  juice_amount DECIMAL(18,2) NOT NULL,
  status VARCHAR(20) NOT NULL,  -- clearing, credited, disputed, refunded
  clears_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spend records (Juice → Project)
CREATE TABLE juice_spends (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL DEFAULT 42161,  -- Arbitrum
  juice_amount DECIMAL(18,2) NOT NULL,
  status VARCHAR(20) NOT NULL,  -- pending, executing, completed, failed
  tx_hash VARCHAR(66),
  tokens_received VARCHAR(78),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cash out records (Juice → Crypto)
CREATE TABLE juice_cash_outs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  destination_address VARCHAR(42) NOT NULL,
  chain_id INTEGER NOT NULL DEFAULT 42161,
  juice_amount DECIMAL(18,2) NOT NULL,
  status VARCHAR(20) NOT NULL,  -- pending, processing, completed, failed
  available_at TIMESTAMPTZ NOT NULL,  -- 24h delay for fraud protection
  tx_hash VARCHAR(66),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Flow

```
Purchase (Stripe) ──► Balance (Database) ──┬──► Spend (JB Project)
                                           │
                                           └──► Cash Out (Crypto)
```

---

## Smart Account System

### Architecture

Each managed user gets an ERC-4337 Smart Account:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SMART ACCOUNT ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  RESERVES WALLET (your operational key)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ RESERVES_PRIVATE_KEY=0x...                               │   │
│  │ - Holds ETH for gas on each chain                        │   │
│  │ - Signs transactions for all user Smart Accounts         │   │
│  │ - Single key to protect                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              │ owns (until export)              │
│                              ▼                                  │
│  PER-USER SMART ACCOUNTS                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ User 1: 0xabc... (ETH, OP, ARB, BASE)                    │   │
│  │ User 2: 0xdef... (ETH, OP, ARB, BASE)                    │   │
│  │ User 3: 0x123... (ETH, OP, ARB, BASE)                    │   │
│  │                                                          │   │
│  │ - Deterministic address via CREATE2                      │   │
│  │ - Same address on all chains                             │   │
│  │ - Lazy deployment (deploy on first tx)                   │   │
│  │ - Contains: project tokens, NFTs, ETH                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Smart Account Details

- **Factory:** `0x9406Cc6185a346906296840746125a0E44976454` (SimpleAccountFactory)
- **EntryPoint:** `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (v0.7)
- **Salt:** Derived from `keccak256("juicy-vision:{userId}")`
- **Lazy deployment:** Only deploy when user takes first action

### Database Schema

```sql
CREATE TABLE user_smart_accounts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  chain_id INTEGER NOT NULL,
  address VARCHAR(42) NOT NULL,
  salt VARCHAR(66) NOT NULL,
  deployed BOOLEAN DEFAULT FALSE,
  custody_status VARCHAR(20) DEFAULT 'managed',  -- managed, transferring, self_custody
  owner_address VARCHAR(42),  -- NULL = we own, set = user owns
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Export System

### Multi-Chain Coordination

Exports are coordinated across all chains as a single operation:

```sql
CREATE TABLE smart_account_exports (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  new_owner_address VARCHAR(42) NOT NULL,
  chain_ids INTEGER[] NOT NULL,
  chain_status JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL,  -- pending, blocked, processing, completed, partial, failed
  blocked_by_pending_ops BOOLEAN DEFAULT FALSE,
  export_snapshot JSONB,  -- what user is exporting
  user_confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Export Flow

```
1. Request Export
   └── Check for blockers (pending withdrawals, etc.)
   └── Build snapshot of assets
   └── Create export record

2. User Confirms
   └── Show: "You have 1.5 ETH, 50k tokens..."
   └── User clicks confirm

3. Execute Per-Chain
   └── Chain 1: transferOwnership(userAddress) ✓
   └── Chain 10: transferOwnership(userAddress) ✓
   └── Chain 42161: transferOwnership(userAddress) ✓
   └── Chain 8453: transferOwnership(userAddress) ✓

4. Final Status
   └── completed: All chains transferred
   └── partial: Some failed (can retry)
   └── failed: All failed (can retry)
```

### After Export

| | Before Export | After Export |
|-|---------------|--------------|
| On-chain owner | Reserves wallet | User's EOA |
| Can execute txs | Our service | Only user |
| Our access | Full control | **None** |
| DB status | `managed` | `self_custody` |

**The `transferOwnership` call is irreversible.** Once called, our service key can no longer sign transactions for that account.

---

## AI Billing Model ("Squeeze to Pay")

AI requests are metered and billed against the user's Juice balance. This enables a sustainable model where users pay for AI usage without managing separate subscriptions.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                      SQUEEZE TO PAY FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. User sends chat message                                      │
│     │                                                            │
│     ▼                                                            │
│  2. Check Juice balance >= estimated cost                        │
│     │                                                            │
│     ├── Insufficient ──► Prompt to buy Juice                     │
│     │                                                            │
│     ▼                                                            │
│  3. Process AI request (stream response)                         │
│     │                                                            │
│     ▼                                                            │
│  4. Record actual token usage (input + output)                   │
│     │                                                            │
│     ▼                                                            │
│  5. Debit Juice balance: usage × rate                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Rate Limiting

Per-user limits protect against abuse:

| Metric | Limit | Window |
|--------|-------|--------|
| Requests | 100 | 1 hour |
| Tokens (input + output) | 500,000 | 1 hour |

Limits reset on a rolling basis. Users with their own API key (BYOK) bypass server rate limits.

### Cost Tracking

Token usage is tracked per request in the `ai_usage` table:

```sql
CREATE TABLE ai_usage (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  chat_id UUID REFERENCES multi_chats(id),
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  model VARCHAR(50) NOT NULL,
  cost_juice DECIMAL(18,6) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Auto-Refill via NANA Payments

Users can set up automatic balance top-ups by paying the NANA project:

1. User configures auto-refill threshold (e.g., "refill when below 10 Juice")
2. When balance drops below threshold, a payment to NANA project is initiated
3. On successful payment, Juice is credited at 1:1 USD rate
4. User receives NANA tokens as a bonus

This creates a flywheel: AI usage funds the NANA treasury, which funds development.

---

## Risks & Tradeoffs

### Risks We're Taking

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Reserves wallet compromise** | Attacker drains ETH backing all Juice + user Smart Accounts | Secret manager, monitoring, treasury management |
| **Database breach** | Juice balances manipulated | Standard DB security, audits |
| **Smart contract bug** | Affects all user accounts | Using battle-tested SimpleAccount |
| **ETH price crash mid-spend** | User pays $10 Juice, we pay $15 ETH | Chainlink price feed, sanity checks |
| **Gas spike** | Arbitrum fees spike during tx | Queue + retry, absorb cost |
| **Reserves underfunded** | Can't fulfill Juice spends | Monitor Juice liabilities vs reserves balance |

### Risks Users Are Taking

| Risk | Impact | Mitigation |
|------|--------|------------|
| **We disappear** | Users can't access Smart Accounts | Export is always available |
| **We get hacked** | Their Smart Account assets at risk | Encourage export for large holdings |
| **Juice devalues** | Non-refundable credits | Clear terms, no guarantees |
| **Regulatory action** | Service shutdown | Export path always open |

### Tradeoff Matrix

| Decision | Easy for Normies | Crypto-Aligned | Our Complexity |
|----------|-----------------|----------------|-----------------|
| Juice credits (fiat gateway) | ✅ No wallet needed | ⚠️ Centralized until spent | Medium |
| Managed Smart Account | ✅ No gas, no signing | ✅ Real on-chain wallet | High |
| Export to self-custody | ⚠️ Requires EOA | ✅ Full sovereignty | Low |
| Arbitrum default | ✅ Low fees | ✅ Real L2 | Low |
| SimpleAccount (not Safe) | ⚠️ Less ecosystem | ✅ ERC-4337 native | Low |

---

## The Sovereignty Spectrum

```
CENTRALIZED ◄─────────────────────────────────────────────► SOVEREIGN

 Juice      Smart Account     Smart Account      User's EOA
 Balance    (we control)      (user controls)    (pure self-custody)
    │              │                 │                   │
    ▼              ▼                 ▼                   ▼
 ┌──────┐    ┌──────────┐      ┌──────────┐       ┌──────────┐
 │ $$$  │───►│ Assets   │─────►│ Assets   │──────►│ Assets   │
 │      │    │ We sign  │      │ They sign│       │ They sign│
 └──────┘    └──────────┘      └──────────┘       └──────────┘
                                    │
                              ┌─────┴─────┐
                              │  EXPORT   │
                              └───────────┘
```

**Users move right as they become more crypto-native.**

---

## Key Guarantees

### What We Promise

1. **Exit is always available** - User can export anytime
2. **Assets are real** - On-chain, verifiable
3. **Export is complete** - Ownership transfer is irreversible
4. **No hidden custody** - After export, we have zero access

### What We Don't Promise

1. **Not a bank** - Juice is service credits, not deposits
2. **Not insured** - No FDIC, no guarantees
3. **Not refundable** - Juice spent is spent
4. **No price protection** - ETH rate at time of transaction

---

## Multi-Chain Support

| Chain | Chain ID | Use Case |
|-------|----------|----------|
| Ethereum | 1 | High-value, established projects |
| Optimism | 10 | Juicebox-native projects |
| Base | 8453 | Low-fee alternative |
| **Arbitrum** | **42161** | **Default operating chain (lowest fees)** |
| Sepolia | 11155111 | Testnet |

Each managed user has Smart Accounts on all chains (same address via CREATE2).

---

## Privacy Modes

| Mode | Chat Storage | Analytics | AI Training | Self-Custody Required |
|------|--------------|-----------|-------------|----------------------|
| **Open Book** | Yes | Yes | Yes | No |
| **Anonymous** | Yes (anonymized) | Yes | Yes | No |
| **Private** | No | Yes | No | No |
| **Ghost** | No | No | No | **Yes** |

**Ghost Mode Enforcement:**
- Must use connected wallet (self-custody)
- No server-side data storage
- No analytics or telemetry
- Session data ephemeral only

---

## Key Files Reference

| Component | Files |
|-----------|-------|
| **Auth** | `backend/src/services/auth.ts`, `backend/src/routes/auth.ts` |
| **Juice Service** | `backend/src/services/juice.ts`, `backend/src/routes/juice.ts` |
| **Smart Accounts** | `backend/src/services/smartAccounts.ts` |
| **Transactions** | `backend/src/services/transactions.ts` |
| **Passkeys** | `backend/src/services/passkey.ts`, `backend/src/routes/passkey.ts` |
| **SIWE** | `backend/src/routes/siwe.ts` |
| **Stripe Webhook** | `backend/src/routes/stripe-webhook.ts` |
| **Cron Jobs** | `backend/src/routes/cron.ts` |
| **Wagmi Config** | `src/config/wagmi.ts` |
| **DB Migrations** | `backend/src/db/migrations/` |

---

## Security Considerations

### Key Management

**Single Key to Manage:**

```
RESERVES_PRIVATE_KEY=0x...
```

| Responsibility | Risk if Compromised |
|----------------|---------------------|
| Owns all user Smart Accounts | Attacker can drain all accounts |
| Signs JB transactions | Attacker can make unauthorized payments |
| Signs cash-out transfers | Attacker can steal user funds |
| Holds ETH for gas | Attacker can drain reserves |

**Storage Options (in order of security):**

| Level | Method | Production-Ready |
|-------|--------|------------------|
| 1 | Environment variable | No |
| 2 | Secret Manager (Railway, GCP, AWS) | Yes |
| 3 | Hardware wallet + signing service | Overkill for early stage |

**Recommendation:** Use Railway secrets or GCP Secret Manager.

**Reserves Balance:**

The reserves wallet holds more than just gas - it holds the ETH that pays projects when users spend Juice:

```
Juice sold to users     $50,000
Juice already spent    -$30,000
Outstanding Juice       $20,000  ← Reserves must cover this
```

This means the reserves wallet will hold significant funds. Consider:
- **Treasury management:** Keep excess funds in a separate cold wallet
- **Monitoring:** Set up alerts for balance thresholds and unexpected outflows
- **Insurance:** Consider smart contract insurance for large balances

**Production Safeguards:**
- Validation rejects known test keys
- Format validation (must be 0x + 64 hex chars)
- Server fails to start without valid key

### Access Control

- `requireAuth`: JWT-based, managed users only
- `requireWalletAuth`: SIWE session required
- `requireWalletOrAuth`: Accept JWT, SIWE, or anonymous
- `requirePrivacyMode`: Enforce privacy constraints

### Transaction Security

- Chainlink price feed for ETH/USD (with staleness check)
- Sanity bounds on prices ($100 - $100,000 per ETH)
- Row-level locking on spend/cash-out processing
- Retry logic with max attempts
- Automatic refunds on permanent failure

### Export Security

- Check for pending operations before allowing export
- Multi-chain coordination with per-chain status
- Retry mechanism for partial failures
- Irreversible ownership transfer on-chain

---

## API Reference

### Authentication

#### POST /auth/otp/request
Request OTP code for email login.

```json
// Request
{ "email": "user@example.com" }

// Response
{ "success": true, "message": "OTP sent" }
```

#### POST /auth/otp/verify
Verify OTP and get JWT session.

```json
// Request
{ "email": "user@example.com", "code": "123456" }

// Response
{
  "success": true,
  "data": {
    "token": "eyJhbG...",
    "user": { "id": "uuid", "email": "..." }
  }
}
```

#### POST /auth/passkey/register-challenge
Begin passkey registration.

```json
// Request
{ "email": "user@example.com" }

// Response (WebAuthn CredentialCreationOptions)
{
  "challenge": "base64...",
  "rp": { "name": "Juicy Vision", "id": "juicyvision.xyz" },
  "user": { "id": "base64...", "name": "...", "displayName": "..." },
  "pubKeyCredParams": [...],
  "timeout": 300000,
  "attestation": "none"
}
```

#### POST /auth/passkey/register
Complete passkey registration.

```json
// Request
{
  "email": "user@example.com",
  "credential": {
    "id": "base64...",
    "rawId": "base64...",
    "response": {
      "clientDataJSON": "base64...",
      "attestationObject": "base64..."
    },
    "type": "public-key"
  }
}

// Response
{ "success": true, "data": { "token": "eyJhbG...", "user": {...} } }
```

#### POST /auth/passkey/authenticate-challenge
Begin passkey authentication.

#### POST /auth/passkey/authenticate
Complete passkey authentication.

#### POST /auth/siwe/nonce
Get nonce for SIWE signature.

```json
// Response
{ "nonce": "abc123..." }
```

#### POST /auth/siwe/verify
Verify SIWE signature and create wallet session.

```json
// Request
{
  "message": "juicyvision.xyz wants you to sign in...",
  "signature": "0x..."
}

// Response
{
  "success": true,
  "data": {
    "sessionToken": "...",
    "address": "0x...",
    "expiresAt": "ISO8601"
  }
}
```

### Chat Endpoints

#### POST /chat
Create new chat.

```json
// Request
{
  "name": "My Project Discussion",
  "description": "Planning our new revnet",
  "isPublic": false,
  "isPrivate": true,
  "encrypted": false,
  "tokenGate": {
    "chainId": 42161,
    "tokenAddress": "0x...",
    "minBalance": "1000000000000000000"
  }
}

// Response
{
  "success": true,
  "data": {
    "id": "uuid",
    "founderAddress": "0x...",
    "name": "My Project Discussion",
    "isPublic": false,
    "aiEnabled": true,
    "createdAt": "ISO8601"
  }
}
```

#### GET /chat
List user's chats.

Query params: `folderId`, `pinnedOnly`, `limit`, `offset`

#### GET /chat/:chatId
Get specific chat with members.

#### GET /chat/:chatId/messages
Get chat message history.

Query params: `limit` (default 50), `before` (cursor), `after` (cursor)

#### POST /chat/:chatId/messages
Send message to chat.

```json
// Request
{ "content": "Hello world", "replyToId": "uuid (optional)" }
```

#### POST /chat/:chatId/ai
Send message and get AI response (streaming).

```json
// Request
{ "content": "How do I create a revnet?" }

// Response: Server-Sent Events stream
data: {"type":"token","content":"To"}
data: {"type":"token","content":" create"}
data: {"type":"done","messageId":"uuid"}
```

#### POST /chat/:chatId/members
Add member to chat.

```json
// Request
{
  "address": "0x...",
  "role": "member",
  "canInvite": false,
  "canInvokeAi": true
}
```

#### DELETE /chat/:chatId/members/:address
Remove member from chat.

#### PATCH /chat/:chatId
Update chat settings.

```json
// Request
{ "name": "New Name", "isPinned": true, "folderId": "uuid" }
```

### Juice Endpoints

#### GET /juice/balance
Get current Juice balance (requires auth).

```json
// Response
{
  "balance": "150.00",
  "lifetimePurchased": "200.00",
  "lifetimeSpent": "50.00",
  "lifetimeCashedOut": "0.00",
  "expiresAt": "2025-01-01T00:00:00Z"
}
```

#### POST /juice/purchase
Create Stripe checkout session for Juice purchase.

```json
// Request
{ "amount": 50 }

// Response
{
  "sessionId": "cs_...",
  "url": "https://checkout.stripe.com/..."
}
```

#### POST /juice/spend
Spend Juice to pay a JB project.

```json
// Request
{
  "projectId": 123,
  "chainId": 42161,
  "amount": "25.00",
  "memo": "Thanks for building!",
  "beneficiaryAddress": "0x..."
}

// Response
{
  "spendId": "uuid",
  "status": "pending",
  "estimatedTokens": "1000000000000000000000"
}
```

#### POST /juice/cash-out
Cash out Juice to crypto.

```json
// Request
{
  "amount": "100.00",
  "destinationAddress": "0x...",
  "chainId": 42161
}

// Response
{
  "cashOutId": "uuid",
  "status": "pending",
  "availableAt": "ISO8601"  // 24h delay
}
```

### Smart Account Endpoints

#### GET /wallet/address
Get user's smart account address (creates if needed, does not deploy).

Query params: `chainId`

```json
// Response
{
  "address": "0x...",
  "chainId": 42161,
  "deployed": false,
  "custodyStatus": "managed"
}
```

#### GET /wallet/accounts
Get all smart accounts across chains.

#### GET /wallet/balances
Get token balances for smart account.

Query params: `chainId`

#### POST /wallet/bundle
Submit transaction bundle for server signing (managed mode).

```json
// Request
{
  "transactions": [
    {
      "chainId": 42161,
      "to": "0x...",
      "data": "0x...",
      "value": "0"
    }
  ]
}

// Response
{
  "bundleId": "uuid",
  "status": "pending"
}
```

#### GET /wallet/bundle/:bundleId/status
Poll bundle execution status.

#### POST /wallet/export
Request account export to self-custody.

```json
// Request
{ "newOwnerAddress": "0x..." }

// Response
{
  "exportId": "uuid",
  "status": "pending",
  "blockedBy": [],
  "snapshot": {
    "chains": [1, 10, 42161, 8453],
    "assets": [...]
  }
}
```

#### POST /wallet/export/:exportId/confirm
Confirm export after reviewing snapshot.

### Component State Endpoints

#### GET /chat/:chatId/messages/:messageId/component-state/:componentKey
Get component state.

#### PUT /chat/:chatId/messages/:messageId/component-state/:componentKey
Update component state.

```json
// Request
{
  "status": "in_progress",
  "bundleId": "abc-123"
}
```

---

## WebSocket Protocol

### Connection

```
GET /ws?session={token}&chatId={chatId}
```

Session token can be JWT (managed) or wallet session token (SIWE).

### Message Structure

```typescript
interface WsMessage {
  type: 'message' | 'ai_response' | 'typing' | 'member_joined' |
        'member_left' | 'member_update' | 'chat_update' |
        'component_interaction' | 'connection_status' | 'error'
  chatId: string
  data: unknown
  sender?: string
  timestamp: number
}
```

### Message Types

#### message
New message in chat.

```json
{
  "type": "message",
  "chatId": "uuid",
  "data": {
    "id": "uuid",
    "senderAddress": "0x...",
    "role": "user",
    "content": "Hello!",
    "createdAt": "ISO8601"
  }
}
```

#### ai_response
Streaming AI token.

```json
{
  "type": "ai_response",
  "chatId": "uuid",
  "data": {
    "messageId": "uuid",
    "token": "Hello",
    "isDone": false
  }
}
```

Final message:
```json
{
  "type": "ai_response",
  "data": { "messageId": "uuid", "isDone": true }
}
```

#### typing
Typing indicator.

```json
{
  "type": "typing",
  "chatId": "uuid",
  "sender": "0x...",
  "data": { "isTyping": true }
}
```

#### member_joined / member_left
Presence updates.

```json
{
  "type": "member_joined",
  "chatId": "uuid",
  "data": {
    "address": "0x...",
    "role": "member",
    "displayName": "alice.eth"
  }
}
```

#### component_interaction
Real-time collaborative component interaction.

```json
{
  "type": "component_interaction",
  "chatId": "uuid",
  "sender": "0x...",
  "data": {
    "messageId": "uuid",
    "groupId": "options-1",
    "action": "select",
    "value": "option-a"
  }
}
```

### Reconnection

On disconnect, client falls back to HTTP polling (`GET /chat/:chatId/messages`) until WebSocket reconnects.

---

## Frontend State Management

### Zustand Stores

All stores use `persist` middleware with localStorage.

#### chatStore

```typescript
interface ChatState {
  chats: Chat[]
  folders: ChatFolder[]
  activeChatId: string | null
  waitingForAiChatId: string | null
  isConnected: boolean

  // Actions
  setChats(chats: Chat[]): void
  addChat(chat: Chat): void
  updateChat(chatId: string, updates: Partial<Chat>): void
  setActiveChat(chatId: string | null): void
  addMessage(chatId: string, message: ChatMessage): void
  updateMessage(chatId: string, messageId: string, updates: Partial<ChatMessage>): void
}
```

#### authStore

```typescript
interface AuthState {
  user: AuthUser | null
  walletSession: WalletSession | null
  isAuthenticated: boolean

  // Actions
  signInWithEmail(email: string): Promise<void>
  verifyOtp(code: string): Promise<void>
  signInWithPasskey(): Promise<void>
  connectWallet(address: string): Promise<void>
  logout(): Promise<void>
}
```

#### transactionStore

```typescript
interface TransactionState {
  pending: PendingTransaction[]
  completed: CompletedTransaction[]

  addPending(tx: PendingTransaction): void
  markCompleted(txId: string, txHash: string): void
  markFailed(txId: string, error: string): void
}
```

---

## Dynamic Component System

AI responses can include JSON that renders as interactive React components.

### Component State Persistence

Database table `message_component_states`:

```sql
CREATE TABLE message_component_states (
  message_id UUID NOT NULL,
  component_key VARCHAR(64) NOT NULL,
  state JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (message_id, component_key)
);
```

### Lifecycle

1. AI generates: `{ "type": "transaction-preview", "props": {...} }`
2. Message saved with initial component state
3. Frontend renders component from state
4. User interacts → API call updates state
5. State change broadcasts via WebSocket to all participants
6. All clients re-render with new state

### Supported Components

| Component | State Fields |
|-----------|--------------|
| `transaction-preview` | `status`, `bundleId`, `txHashes`, `projectIds`, `error` |
| `options-picker` | `selectedOptions`, `isOpen` |

---

## Context Manager & Prompt System

### Four Memory Layers

| Layer | Storage | Purpose |
|-------|---------|---------|
| Working Memory | In-memory | Last 15-20 messages (raw) |
| Transaction State | `chat_transaction_state` | Project design state |
| Context Summaries | `chat_summaries` | Compressed history |
| Attachment Summaries | `attachment_summaries` | Uploaded file data |

### Token Budget

```typescript
const TOKEN_BUDGET = {
  total: 50000,
  transactionState: 2000,
  userContext: 1000,
  participantContext: 500,
  attachmentSummaries: 2400,  // 3000 × 0.8 safety margin
  summaries: 8000,            // 10000 × 0.8 safety margin
  // Remainder (~36k) for recent messages
}
```

### Intent Detection

Before building context, system detects required modules:

```typescript
interface DetectedIntents {
  needsDataQuery: boolean      // Blockchain queries
  needsHookDeveloper: boolean  // Solidity coding
  needsTransaction: boolean    // Project design
  reasons: string[]
}
```

Modules loaded conditionally:
- `BASE_PROMPT`: Always
- `DATA_QUERY_CONTEXT`: When querying blockchain
- `HOOK_DEVELOPER_CONTEXT`: When writing contracts
- `TRANSACTION_CONTEXT`: When designing projects

---

## Database Schema Reference

### Core Tables

#### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  privacy_mode VARCHAR(20) DEFAULT 'open_book',
  passkey_enabled BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### sessions (JWT, managed mode)
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,  -- 7 days
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### wallet_sessions (SIWE, self-custody)
```sql
CREATE TABLE wallet_sessions (
  id UUID PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL UNIQUE,
  session_token VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,  -- 30 days
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Smart Account Tables

#### user_smart_accounts
```sql
CREATE TABLE user_smart_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  chain_id INTEGER NOT NULL,
  address VARCHAR(42) NOT NULL,
  salt VARCHAR(66) NOT NULL,
  deployed BOOLEAN DEFAULT FALSE,
  custody_status VARCHAR(20) DEFAULT 'managed',
  owner_address VARCHAR(42),
  UNIQUE(user_id, chain_id)
);
```

#### smart_account_exports
```sql
CREATE TABLE smart_account_exports (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  new_owner_address VARCHAR(42) NOT NULL,
  chain_ids INTEGER[] NOT NULL,
  chain_status JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'pending',
  export_snapshot JSONB,
  user_confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
```

### Juice Tables

#### juice_balances
```sql
CREATE TABLE juice_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  balance DECIMAL(20, 2) NOT NULL DEFAULT 0,
  lifetime_purchased DECIMAL(20, 2) NOT NULL DEFAULT 0,
  lifetime_spent DECIMAL(20, 2) NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1000 years'
);
```

#### juice_spends
```sql
CREATE TABLE juice_spends (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  project_id INTEGER NOT NULL,
  chain_id INTEGER NOT NULL,
  juice_amount DECIMAL(20, 2) NOT NULL,
  status VARCHAR(30) DEFAULT 'pending',
  tx_hash VARCHAR(66),
  tokens_received VARCHAR(78)
);
```

### Chat Tables

#### multi_chats
```sql
CREATE TABLE multi_chats (
  id UUID PRIMARY KEY,
  founder_address VARCHAR(42) NOT NULL,
  name VARCHAR(255),
  is_public BOOLEAN DEFAULT FALSE,
  encrypted BOOLEAN DEFAULT FALSE,
  ai_enabled BOOLEAN DEFAULT TRUE,
  folder_id UUID,
  is_pinned BOOLEAN DEFAULT FALSE,
  auto_generated_title VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### multi_chat_messages
```sql
CREATE TABLE multi_chat_messages (
  id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES multi_chats(id),
  sender_address VARCHAR(42) NOT NULL,
  role VARCHAR(20),  -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  is_encrypted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### multi_chat_members
```sql
CREATE TABLE multi_chat_members (
  id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES multi_chats(id),
  member_address VARCHAR(42) NOT NULL,
  role VARCHAR(20) DEFAULT 'member',
  can_invite BOOLEAN DEFAULT FALSE,
  can_invoke_ai BOOLEAN DEFAULT TRUE,
  UNIQUE(chat_id, member_address)
);
```

### Context Tables

#### chat_transaction_state
```sql
CREATE TABLE chat_transaction_state (
  id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES multi_chats(id) UNIQUE,
  state JSONB NOT NULL DEFAULT '{}'
);
```

#### chat_summaries
```sql
CREATE TABLE chat_summaries (
  id UUID PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES multi_chats(id),
  summary_md TEXT NOT NULL,
  message_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Contract Addresses

### ERC-4337 (All Chains)

| Contract | Address |
|----------|---------|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| SimpleAccountFactory | `0x9406Cc6185a346906296840746125a0E44976454` |
| TrustedForwarder | `0xc29d6995ab3b0df4650ad643adeac55e7acbb566` |

### USDC Addresses

**Mainnet:**

| Chain | Address |
|-------|---------|
| Ethereum (1) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Optimism (10) | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` |
| Base (8453) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Arbitrum (42161) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |

**Testnet (Sepolia):**

| Chain | Address |
|-------|---------|
| Sepolia (11155111) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| OP Sepolia (11155420) | `0x5fd84259d66Cd46123540766Be93DFE6D43130D7` |
| Base Sepolia (84532) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Arb Sepolia (421614) | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |

### Juicebox V5 Core (Shared)

| Contract | Address |
|----------|---------|
| JBTokens | `0x4d0edd347fb1fa21589c1e109b3474924be87636` |
| JBProjects | `0x885f707efa18d2cb12f05a3a8eba6b4b26c8c1d4` |
| JBDirectory | `0x0061e516886a0540f63157f112c0588ee0651dcf` |
| JBSplits | `0x7160a322fea44945a6ef9adfd65c322258df3c5e` |
| JBPermissions | `0xba948dab74e875b19cf0e2ca7a4546c0c2defc40` |

### Juicebox V5 (Revnets)

| Contract | Address |
|----------|---------|
| JBController | `0x27da30646502e2f642be5281322ae8c394f7668a` |
| JBMultiTerminal | `0x52869db3d61dde1e391967f2ce5039ad0ecd371c` |

### Juicebox V5.1 (New Projects)

| Contract | Address |
|----------|---------|
| JBController5_1 | `0x3bfa0e1b39a78855e12155a4d6e2f1823fa5f5ad` |
| JBMultiTerminal5_1 | `0x587bf86677ec0d1b766d9ba0d7ac2a51c6c2fc71` |

### Version Rules

**CRITICAL:** Never mix V5 and V5.1 versioned contracts.

- Revnets → Always V5 (owned by REVDeployer)
- New projects → Always V5.1
- Shared contracts (JBTokens, JBSplits, etc.) → Work with both

### External APIs

| Service | Endpoint |
|---------|----------|
| Bendystraw | `https://api.bendystraw.xyz/graphql` |
| Relayr | `https://api.relayr.ba5ed.com` |
| IPFS (Pinata) | `https://gateway.pinata.cloud/ipfs/` |

### Block Explorers

| Chain | Explorer |
|-------|----------|
| Ethereum | `https://etherscan.io` |
| Optimism | `https://optimistic.etherscan.io` |
| Base | `https://basescan.org` |
| Arbitrum | `https://arbiscan.io` |
