# Juicy Vision Architecture Principles

This document defines the core architectural principles and code standards for the Juicy Vision codebase. All contributors should follow these guidelines.

## Core Philosophy

### 1. Chat-First Design
Every user interaction flows through the chat interface. The chat is the primary UI and all features should be accessible through conversation.

### 2. Privacy by Design
Four distinct privacy modes govern data handling:
- **open_book**: Full data sharing and collaboration
- **anonymous**: Participate without identity attachment
- **private**: End-to-end encrypted multi-person chats
- **ghost**: Maximum privacy, minimal data retention

### 3. Custodial Flexibility
Support both managed and self-custody wallets:
- **Managed wallets**: Server-managed passkey wallets for seamless UX
- **Self-custody**: SIWE (Sign-In With Ethereum) for users who prefer full control

## Security Principles

### 1. API Keys Never in Browser
All sensitive API calls (Claude, blockchain RPCs, external services) MUST be proxied through the backend. The frontend bundle must never contain API keys or secrets.

### 2. Session-Based Authentication
- JWT tokens with 7-day expiration
- Session ID fallback for anonymous users
- Multiple auth methods per account (passkey, SIWE, email OTP)

### 3. End-to-End Encryption
- Group keys for multi-person chats
- Key rotation on member changes
- Encryption happens client-side

## Robustness Principles

### 1. Server as Source of Truth
The server owns the data; the client is a cache. This means:
- Client state loss (refresh, crash) should never lose user data
- Server-rendered state is authoritative; client reflects it
- Optimistic updates are fine, but server confirms or reverts
- If client and server disagree, server wins

**Pattern:**
```
Bad:  Client creates message → syncs to server → hopes it persists
Good: Client sends to server → server persists → client reflects result
```

### 2. WebSocket as Enhancement
Real-time features enhance but don't gatekeep. The app must work without WebSocket:
- HTTP polling as automatic fallback when WS fails
- "Last updated X seconds ago" instead of broken real-time
- Core flows (send message, view history) work via REST
- WS adds live updates, not core functionality

**Degradation levels:**
1. WebSocket connected → instant updates
2. WebSocket dropped → poll every 5s, show "reconnecting..."
3. Offline → show cached data, queue actions for sync

### 3. Circuit Breakers for External Services
External dependencies fail. Plan for it:
- **Claude API**: If 3 failures in 60s, pause for 5 min. Show "AI temporarily unavailable"
- **RPC providers**: Rotate through fallbacks (Ankr → Infura → public)
- **Stripe**: Queue payment intent, retry later
- **Bendystraw**: Cache recent data, serve stale if fresh fails

**Pattern:**
```typescript
// Track failures, trip circuit after threshold
if (failures > 3 && timeSinceFirstFailure < 60_000) {
  return { status: 'circuit_open', retryAfter: 300_000 }
}
```

### 4. Progressive Enhancement
The app should provide value even when parts fail:
- Server renders meaningful HTML (not empty div waiting for JS)
- Core information visible before JavaScript loads
- JavaScript enhances interactivity, doesn't enable it
- Error screens show useful information, not just "Something went wrong"

**Hierarchy of needs:**
1. Content visible (HTML)
2. Navigation works (links)
3. Forms submit (HTTP POST)
4. Real-time updates (JS + WS)

Each level enhances the previous; failure falls back gracefully.

## Code Standards

### 1. File Size Limits
No single file should exceed 500 lines. Large files indicate too many responsibilities and should be split:
- Extract custom hooks from components
- Split components by concern
- Create dedicated service modules

### 2. Single Responsibility
Each service, component, and hook should have one clear purpose:
- Services handle data fetching and business logic
- Components handle rendering
- Hooks encapsulate reusable stateful logic
- Stores manage global state

### 3. Centralized Configuration
Magic numbers and configuration values belong in `src/constants/`:
- WebSocket retry delays and limits
- Pagination defaults
- UI timing constants
- API endpoints

### 4. Type Safety
TypeScript should be used to its full potential:
- No `as unknown as` bypasses without documented justification
- Proper type guards for runtime checks
- Explicit types for function parameters and returns

### 5. Error Handling
All errors should flow through centralized handling:
- Development: Console logging with full context
- Production: Error reporting (respecting privacy mode)
- User-facing: Friendly messages without technical details

## Performance Principles

### 1. Lazy Loading
Dynamic components are loaded on-demand via code splitting:
```typescript
const COMPONENT_REGISTRY = {
  'project-card': lazy(() => import('./ProjectCard')),
}
```

### 2. Bundle Optimization
Vendor code is split into logical chunks:
- `vendor-react`: React core
- `vendor-ui`: UI libraries
- `vendor-state`: State management
- `vendor-web3`: Blockchain libraries

### 3. WebSocket Efficiency
- Exponential backoff with jitter for reconnection
- Batch updates debounced at 50ms
- Presence tracking for efficient message delivery

### 4. Caching Strategy
- ENS names cached with TTL
- API responses cached where appropriate
- Service worker for offline support

## State Management

### 1. Zustand Stores
Global state lives in dedicated stores:
- `authStore`: Authentication and user session
- `chatStore`: Chat history and active conversation
- `settingsStore`: User preferences
- `themeStore`: Visual theme

### 2. Local State
Component-specific state uses React hooks:
- `useState` for simple values
- `useReducer` for complex state logic
- Custom hooks for reusable patterns

### 3. Server State
Remote data syncs through WebSocket connections:
- Real-time message delivery
- Presence updates
- Typing indicators

## Testing Standards

### 1. Coverage Targets
- Services and stores: 70%+
- Components: 50%+
- Critical paths: 90%+

### 2. Test Structure
- Unit tests for pure functions
- Integration tests for service interactions
- E2E tests for critical user flows

### 3. Test Files
- Co-located with source: `module.test.ts`
- Shared fixtures in `__fixtures__/`
- Mock factories for complex objects

## Related Documentation

- [PRODUCT.md](./PRODUCT.md) - Product specification and features
- [SECURITY.md](./SECURITY.md) - Security protocols and audit notes
- [TESTING.md](./TESTING.md) - Testing strategy and guidelines
- [STYLE.md](./STYLE.md) - Visual design system
