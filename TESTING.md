# Testing Guide for Juicy Vision

This document describes the testing infrastructure and how to run tests for the Juicy Vision project.

## Overview

The project has comprehensive testing coverage across three layers:

1. **Frontend Unit Tests** (Vitest + React Testing Library)
2. **End-to-End Tests** (Playwright)
3. **Backend Tests** (Deno test)

## Quick Start

```bash
# Run frontend unit tests
npm test

# Run frontend tests in watch mode (for development)
npm run test:watch

# Run E2E tests
npm run test:e2e

# Run all tests (frontend + E2E)
npm run test:all

# Run backend tests (requires Deno)
cd backend && deno task test
```

## Frontend Unit Tests

### Configuration

- **Test Framework**: Vitest 4.x
- **Testing Library**: @testing-library/react
- **Environment**: jsdom
- **Config File**: `vitest.config.ts`
- **Setup File**: `src/test/setup.ts`

### Test Locations

```
src/
├── components/
│   ├── ui/
│   │   ├── Button.test.tsx      # Button component tests
│   │   ├── Input.test.tsx       # Input component tests
│   │   └── Modal.test.tsx       # Modal component tests
│   └── dynamic/
│       ├── TransactionPreview.test.tsx  # Transaction preview formatting
│       └── TransactionStatus.test.tsx   # Transaction status display
├── stores/
│   ├── transactionStore.test.ts  # Transaction state management
│   └── themeStore.test.ts        # Theme state management
└── test/
    ├── setup.ts                  # Test setup and mocks
    └── test-utils.tsx            # Custom render utilities
```

### Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Open Vitest UI
npm run test:ui
```

### Writing New Tests

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useThemeStore } from '../../stores'
import MyComponent from './MyComponent'

describe('MyComponent', () => {
  beforeEach(() => {
    // Reset stores before each test
    useThemeStore.setState({ theme: 'dark' })
    localStorage.clear()
  })

  it('renders correctly', () => {
    render(<MyComponent />)
    expect(screen.getByText('Expected Text')).toBeInTheDocument()
  })
})
```

### Key Test Areas

#### Transaction Preview (Critical)
The `TransactionPreview` component has extensive tests for:
- Parameter formatting (wei to ETH, percentages, durations)
- Address label mapping (JB contracts, USDC per chain)
- Chain-specific formatting
- Nested object rendering
- Edge cases and error handling

#### Zustand Stores
Store tests verify:
- State initialization
- Action mutations
- Selector functions
- Persistence behavior

## End-to-End Tests (Playwright)

### Configuration

- **Framework**: Playwright
- **Browser**: Chromium
- **Config File**: `playwright.config.ts`
- **Test Directory**: `e2e/`

### Running E2E Tests

```bash
# Run E2E tests (starts dev server automatically)
npm run test:e2e

# Run E2E tests with UI
npm run test:e2e:ui

# Run specific test file
npx playwright test e2e/app.spec.ts
```

### E2E Test Coverage

The E2E tests cover:
- App loading and initialization
- Theme persistence
- Chat interface interactions
- Mobile responsive behavior
- Navigation and routing
- Error handling

## Backend Tests (Deno)

### Prerequisites

Install Deno: https://deno.land/manual/getting_started/installation

### Configuration

- **Test Framework**: Deno built-in test runner
- **Config File**: `backend/deno.json`

### Test Locations

```
backend/src/
├── routes/
│   └── auth.test.ts     # Auth route handler tests
├── types/
│   └── index.test.ts    # Zod schema validation tests
└── test/
    └── helpers.ts       # Test utilities and mocks
```

### Running Backend Tests

```bash
cd backend
deno task test
```

### Test Coverage

Backend tests cover:
- Zod schema validation for all types
- API route request/response handling
- Auth flow (OTP request, verification, session management)
- Privacy mode validation
- Wallet balance/transfer schemas
- Chat message and session schemas

## Test Utilities

### Frontend Test Utils (`src/test/test-utils.tsx`)

```typescript
import { render } from '@/test/test-utils'

// Renders component with all providers (QueryClient, Router)
render(<MyComponent />)

// Reset Zustand stores
import { resetZustandStores } from '@/test/test-utils'
resetZustandStores()
```

### Backend Test Helpers (`backend/src/test/helpers.ts`)

```typescript
import { mockUser, mockSession, mockUuid } from './helpers.ts'

const user = mockUser({ email: 'test@example.com' })
const session = mockSession(user.id)
```

## Continuous Integration

### GitHub Actions Workflow

Create `.github/workflows/test.yml`:

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test
      - run: npm run test:e2e

  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v1
        with:
          deno-version: v1.x
      - run: cd backend && deno task test
```

## Coverage Goals

| Area | Target | Current |
|------|--------|---------|
| UI Components | 80% | Core components covered |
| Stores | 90% | Transaction + Theme covered |
| Transaction Logic | 95% | Critical path covered |
| API Routes | 80% | Auth routes covered |
| Type Schemas | 100% | All schemas validated |

## Adding Tests for New Features

When adding new features:

1. **Components**: Create `ComponentName.test.tsx` next to the component
2. **Stores**: Create `storeName.test.ts` next to the store
3. **Hooks**: Create `hookName.test.ts` with mock dependencies
4. **Backend Routes**: Create `routeName.test.ts` with mock handlers
5. **Services**: Create `serviceName.test.ts` with database mocks

## Known Issues / Clarification Needed

If tests fail and you suspect the test might be correct but implementation wrong, document them here:

- [ ] _(No issues currently documented)_

## Best Practices

1. **Isolation**: Each test should be independent
2. **Reset State**: Clear stores and localStorage in `beforeEach`
3. **Mock External**: Mock network requests and external services
4. **Test Behavior**: Focus on user-visible behavior, not implementation
5. **Descriptive Names**: Use clear, descriptive test names
6. **Coverage**: Prioritize critical paths (transactions, auth)
