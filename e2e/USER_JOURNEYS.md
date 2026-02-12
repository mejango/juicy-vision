# User Journeys for E2E Testing

Prioritized by likelihood and business impact. Each journey includes happy path and edge cases.

---

## Priority 1: Critical Path (Daily Active Users)

### 1.1 New User Lands on App
**Likelihood: Very High** | **Impact: Critical**

**Happy Path:**
- User lands on home page
- Sees suggestion pills (project ideas)
- Chat input is visible and ready
- Can click a suggestion pill to start conversation
- Theme toggle works (light/dark)

**Edge Cases:**
- [ ] Slow network - app shows loading states gracefully
- [ ] JavaScript disabled - graceful degradation message
- [ ] Mobile viewport - responsive layout, no horizontal scroll
- [ ] Very small screen (320px) - still usable
- [ ] Very large screen (4K) - content doesn't stretch awkwardly

---

### 1.2 User Signs Up with Passkey (Managed Wallet)
**Likelihood: Very High** | **Impact: Critical**

**Happy Path:**
- User clicks "Sign in" or similar CTA
- Passkey creation flow initiates
- Smart account is created/linked
- User sees their wallet address
- Balance is displayed
- Auth persists across page reload

**Edge Cases:**
- [ ] Passkey creation fails (user cancels browser prompt)
- [ ] User already has account - links correctly
- [ ] Browser doesn't support WebAuthn - shows fallback
- [ ] Network error during account creation
- [ ] Multiple passkeys for same user

---

### 1.3 User Connects External Wallet (Self-Custody)
**Likelihood: High** | **Impact: Critical**

**Happy Path:**
- User clicks "Connect Wallet"
- Wallet selection modal appears
- User selects MetaMask/WalletConnect/etc
- SIWE prompt appears
- User signs message
- Wallet connected, address shown

**Edge Cases:**
- [ ] User rejects connection request
- [ ] User rejects signature request
- [ ] Wallet is on wrong network
- [ ] Wallet has no ETH for gas
- [ ] User disconnects mid-flow
- [ ] Multiple wallets installed - correct one selected
- [ ] WalletConnect QR code timeout

---

### 1.4 User Asks AI to Create a Project
**Likelihood: High** | **Impact: Critical**

**Happy Path:**
- User types "create a project called X"
- AI responds with project configuration
- Transaction preview appears
- User reviews and confirms
- Transaction executes successfully
- Dashboard link appears
- User can navigate to new project

**Edge Cases:**
- [ ] AI misunderstands request - user can clarify
- [ ] User cancels at transaction preview
- [ ] Transaction fails (reverts)
- [ ] User has insufficient balance
- [ ] Network congestion - long confirmation time
- [ ] User closes tab during transaction
- [ ] AI rate limited
- [ ] Very long project name/description
- [ ] Special characters in project name
- [ ] Multi-chain deployment partial failure

---

### 1.5 User Pays Into a Project
**Likelihood: High** | **Impact: Critical**

**Happy Path:**
- User navigates to project page
- Enters payment amount
- Sees token amount they'll receive
- Confirms payment
- Transaction succeeds
- Balance updates
- Activity shows new contribution

**Edge Cases:**
- [ ] Payment below minimum
- [ ] Payment above project cap
- [ ] Project is paused
- [ ] User pays with wrong token (USDC vs ETH)
- [ ] Slippage on swap terminal
- [ ] Reserved rate affects token amount
- [ ] Redemption rate displayed correctly
- [ ] Multi-chain - user on different chain than project

---

### 1.6 User Browses NFT Shop and Mints
**Likelihood: High** | **Impact: High**

**Happy Path:**
- User navigates to project dashboard
- Clicks "Shop" tab
- Sees available tiers with prices
- Clicks to view tier details
- Adds to cart or mints directly
- Transaction succeeds
- NFT appears in their collection

**Edge Cases:**
- [ ] Tier sold out
- [ ] Limited supply updates in real-time
- [ ] Price in different currency (USDC)
- [ ] User mints multiple of same tier
- [ ] User mints from multiple tiers
- [ ] Discount applied correctly
- [ ] On-chain metadata loads (SVG)
- [ ] IPFS image fails to load - fallback shown
- [ ] Tier has cannotBeRemoved flag
- [ ] Category grouping displays correctly

---

## Priority 2: Core Owner Actions (Project Creators)

### 2.1 Owner Queues New Ruleset
**Likelihood: Medium** | **Impact: High**

**Happy Path:**
- Owner navigates to their project
- Opens ruleset/rules tab
- Clicks to queue new ruleset
- AI helps configure parameters
- Transaction preview shown
- Owner confirms
- Pending ruleset displayed

**Edge Cases:**
- [ ] Ruleset already queued - shows warning
- [ ] Approval hook rejects change
- [ ] Reserved rate change restrictions
- [ ] Redemption rate change restrictions
- [ ] Duration validation (minimum/maximum)
- [ ] Decay rate calculations shown correctly

---

### 2.2 Owner Distributes Payouts
**Likelihood: Medium** | **Impact: High**

**Happy Path:**
- Owner sees available payout amount
- Clicks "Send Payouts"
- Sees split breakdown
- Confirms transaction
- Funds distributed to splits
- UI updates with new balances

**Edge Cases:**
- [ ] No payouts available
- [ ] Payout limit reached
- [ ] Split recipient is contract that reverts
- [ ] Multi-chain payouts (different limits per chain)
- [ ] Currency conversion display (ETH/USD)

---

### 2.3 Owner Manages NFT Tiers
**Likelihood: Medium** | **Impact: High**

**Happy Path:**
- Owner opens Shop tab
- Sees "Sell something" button
- Adds new tier via chat
- Edits existing tier (name, discount)
- Removes tier
- Changes persist

**Edge Cases:**
- [ ] Tier has on-chain metadata (tokenUriResolver) - edit disabled
- [ ] Tier has cannotBeRemoved flag - remove disabled
- [ ] Discount > 100% rejected
- [ ] Negative discount rejected
- [ ] Adding tier with same price as existing
- [ ] Image generation for tier
- [ ] Category assignment

---

### 2.4 Owner Uses Surplus Allowance
**Likelihood: Low-Medium** | **Impact: Medium**

**Happy Path:**
- Owner has surplus in project
- Opens surplus allowance modal
- Specifies amount and recipient
- Confirms transaction
- Funds transferred

**Edge Cases:**
- [ ] No surplus available
- [ ] Allowance limit reached
- [ ] Recipient address invalid
- [ ] Amount exceeds allowance

---

### 2.5 Owner Deploys ERC20 Token
**Likelihood: Low** | **Impact: High**

**Happy Path:**
- Project has no token yet
- Owner clicks "Deploy ERC20"
- Specifies token name/symbol
- Transaction executes
- Token deployed and linked

**Edge Cases:**
- [ ] Project already has token - button hidden
- [ ] Token name/symbol too long
- [ ] Reserved characters in symbol
- [ ] Deployment fails - rollback state

---

### 2.6 Owner Sends Reserved Tokens
**Likelihood: Low-Medium** | **Impact: Medium**

**Happy Path:**
- Project has reserved tokens pending
- Owner opens reserved tokens modal
- Specifies recipient(s)
- Tokens distributed

**Edge Cases:**
- [ ] No reserved tokens available
- [ ] Multiple recipients in splits
- [ ] Recipient is smart contract

---

## Priority 3: Token Holder Actions

### 3.1 User Cashes Out (Redeems Tokens)
**Likelihood: Medium** | **Impact: High**

**Happy Path:**
- User holds project tokens
- Navigates to project
- Clicks "Cash out"
- Sees redemption rate/amount
- Confirms transaction
- Receives ETH/tokens back

**Edge Cases:**
- [ ] Redemption rate is 0 (tokens worthless)
- [ ] Project has no overflow
- [ ] Bonding curve calculation shown
- [ ] User redeems partial amount
- [ ] User redeems all tokens
- [ ] Tax/fee displayed correctly

---

### 3.2 User Claims Airdrop/Reserved Allocation
**Likelihood: Low-Medium** | **Impact: Medium**

**Happy Path:**
- User is in reserved token splits
- Sees claimable amount
- Claims tokens
- Balance updates

**Edge Cases:**
- [ ] User not in splits - nothing to claim
- [ ] Already claimed
- [ ] Proof verification fails

---

## Priority 4: Discovery & Navigation

### 4.1 User Searches for Projects
**Likelihood: Medium** | **Impact: Medium**

**Happy Path:**
- User types in search/chat
- AI suggests relevant projects
- User clicks project link
- Navigates to project page

**Edge Cases:**
- [ ] No matching projects
- [ ] Ambiguous search term
- [ ] Project on different chain than expected
- [ ] Archived/inactive project

---

### 4.2 User Views Project Activity
**Likelihood: Medium** | **Impact: Low**

**Happy Path:**
- User on project dashboard
- Activity feed shows recent events
- Can see payments, redemptions, etc
- Links to transactions work

**Edge Cases:**
- [ ] Very old project with lots of activity
- [ ] No activity yet (new project)
- [ ] Activity from multiple chains

---

### 4.3 User Switches Chains
**Likelihood: Medium** | **Impact: Medium**

**Happy Path:**
- User viewing project on Ethereum
- Switches to Optimism view
- Data refreshes for new chain
- Balances update

**Edge Cases:**
- [ ] Project not on selected chain
- [ ] User wallet on wrong chain
- [ ] Chain RPC is slow/down

---

## Priority 5: Chat & AI Interactions

### 5.1 User Has Multi-Turn Conversation
**Likelihood: High** | **Impact: Medium**

**Happy Path:**
- User asks question
- AI responds
- User follows up
- Context maintained
- Can reference previous messages

**Edge Cases:**
- [ ] Very long conversation (context limit)
- [ ] User edits previous message
- [ ] AI hallucinates - user corrects
- [ ] Streaming response interrupted
- [ ] Rate limiting kicks in

---

### 5.2 User Manages Chat History
**Likelihood: Medium** | **Impact: Low**

**Happy Path:**
- User sees previous chats in sidebar
- Can switch between chats
- Can start new chat
- Can delete old chat

**Edge Cases:**
- [ ] Many chats - scroll/pagination
- [ ] Delete active chat
- [ ] Chat with pending transaction

---

### 5.3 User Shares Chat
**Likelihood: Low** | **Impact: Low**

**Happy Path:**
- User creates shareable link
- Recipient can view conversation
- Permissions work correctly

**Edge Cases:**
- [ ] Share private chat
- [ ] Recipient not authenticated
- [ ] Chat updated after sharing

---

## Priority 6: Edge Cases & Error Handling

### 6.1 Network Errors
- [ ] API returns 500
- [ ] API returns 429 (rate limit)
- [ ] API timeout
- [ ] WebSocket disconnects
- [ ] Partial response (streaming)

### 6.2 Transaction Failures
- [ ] User rejects in wallet
- [ ] Transaction reverts
- [ ] Out of gas
- [ ] Nonce too low
- [ ] Transaction stuck pending

### 6.3 State Synchronization
- [ ] Data stale after long idle
- [ ] Concurrent updates (two tabs)
- [ ] Optimistic UI rollback
- [ ] Cache invalidation

### 6.4 Input Validation
- [ ] XSS attempt in chat
- [ ] SQL injection in search
- [ ] Overflow numbers
- [ ] Unicode/emoji handling
- [ ] Empty required fields
- [ ] Very long inputs

### 6.5 Session Management
- [ ] Token expires during use
- [ ] Force logout from another device
- [ ] Browser storage cleared
- [ ] Incognito mode

---

## Priority 7: Omnichain Specific

### 7.1 Cross-Chain Payment
**Likelihood: Low-Medium** | **Impact: High**

**Happy Path:**
- User on Optimism
- Project primary on Ethereum
- Pays via Relayr
- Transaction routes correctly
- Tokens appear on correct chain

**Edge Cases:**
- [ ] Bridge delays
- [ ] Partial bridge failure
- [ ] Fee estimation across chains
- [ ] Different token decimals

---

### 7.2 Aggregated Project View
**Likelihood: Medium** | **Impact: Medium**

**Happy Path:**
- Project deployed on 3 chains
- Dashboard shows aggregate stats
- Can filter by chain
- All data consistent

**Edge Cases:**
- [ ] One chain RPC down
- [ ] Data sync delays between chains
- [ ] Different project IDs per chain

---

## Test Implementation Priority

### Phase 1 (This Week)
1. 1.1 New User Landing
2. 1.2 Passkey Signup
3. 1.4 Project Creation via Chat
4. 1.6 NFT Shop & Minting

### Phase 2 (Next Week)
1. 1.3 External Wallet Connection
2. 1.5 Paying Into Project
3. 2.3 Owner Manages Tiers
4. 3.1 Cash Out Flow

### Phase 3 (Following Weeks)
1. 2.1 Queue Ruleset
2. 2.2 Distribute Payouts
3. 5.1 Multi-Turn Chat
4. 6.x Error Handling Suite

### Phase 4 (Ongoing)
1. Edge cases as bugs found
2. Regression tests for fixes
3. Performance testing
4. Accessibility testing

---

## Notes

- Each journey should have both **deterministic E2E tests** (mocked APIs) and **UX bot exploration** (AI-driven)
- Focus on user-visible behavior, not implementation details
- Tests should be independent and parallelizable
- Use realistic test data (real project names, reasonable amounts)
- Consider mobile-first for new tests
