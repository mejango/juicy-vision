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
