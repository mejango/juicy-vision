/**
 * Test User Seeding and Authentication
 *
 * This module seeds test users in the database and retrieves real
 * authentication tokens for E2E testing against the full backend.
 *
 * Usage:
 *   npx tsx e2e/fixtures/seed-users.ts
 *
 * Or programmatically:
 *   import { seedTestUsers, getTestUserToken } from './seed-users'
 */

const API_BASE = process.env.API_URL || 'http://localhost:3001'

export interface TestUserConfig {
  id: string
  email: string
  name: string
  isAdmin: boolean
  privacyMode: 'open_book' | 'anonymous' | 'private' | 'ghost'
}

// Predefined test users matching seed-test-users.sql
export const TEST_USERS: Record<string, TestUserConfig> = {
  standard: {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'e2e-user@test.juicy.vision',
    name: 'E2E Test User',
    isAdmin: false,
    privacyMode: 'open_book',
  },
  admin: {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'e2e-admin@test.juicy.vision',
    name: 'E2E Admin',
    isAdmin: true,
    privacyMode: 'open_book',
  },
  anonymous: {
    id: '33333333-3333-3333-3333-333333333333',
    email: 'e2e-anon@test.juicy.vision',
    name: 'E2E Anonymous',
    isAdmin: false,
    privacyMode: 'anonymous',
  },
  ghost: {
    id: '44444444-4444-4444-4444-444444444444',
    email: 'e2e-ghost@test.juicy.vision',
    name: 'E2E Ghost',
    isAdmin: false,
    privacyMode: 'ghost',
  },
}

export interface AuthResult {
  user: TestUserConfig
  token: string
  sessionId: string
}

/**
 * Request an OTP code for a test user email.
 * In development mode, the API returns the code directly.
 */
export async function requestOtpCode(email: string): Promise<{ code: string; expiresIn: number }> {
  const response = await fetch(`${API_BASE}/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })

  const data = await response.json()

  if (!data.success) {
    throw new Error(`Failed to request OTP: ${data.error || 'Unknown error'}`)
  }

  // In development mode, code is returned directly
  if (!data.data.code) {
    throw new Error('OTP code not returned - ensure DENO_ENV=development on backend')
  }

  return {
    code: data.data.code,
    expiresIn: data.data.expiresIn,
  }
}

/**
 * Verify OTP code and get authentication token.
 */
export async function verifyOtpAndLogin(email: string, code: string): Promise<{ token: string; user: any }> {
  const response = await fetch(`${API_BASE}/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  })

  const data = await response.json()

  if (!data.success) {
    throw new Error(`Failed to verify OTP: ${data.error || 'Unknown error'}`)
  }

  return {
    token: data.data.token,
    user: data.data.user,
  }
}

/**
 * Get authentication token for a test user.
 * Uses OTP flow to authenticate.
 */
export async function getTestUserToken(userKey: keyof typeof TEST_USERS): Promise<AuthResult> {
  const userConfig = TEST_USERS[userKey]

  if (!userConfig) {
    throw new Error(`Unknown test user: ${userKey}`)
  }

  console.log(`Authenticating test user: ${userConfig.email}`)

  // Request OTP code
  const { code } = await requestOtpCode(userConfig.email)
  console.log(`  OTP code received: ${code}`)

  // Verify and get token
  const { token, user } = await verifyOtpAndLogin(userConfig.email, code)
  console.log(`  Token received: ${token.substring(0, 20)}...`)

  return {
    user: userConfig,
    token,
    sessionId: user.id,
  }
}

/**
 * Authenticate all test users and return their tokens.
 */
export async function getAllTestUserTokens(): Promise<Record<string, AuthResult>> {
  const results: Record<string, AuthResult> = {}

  for (const key of Object.keys(TEST_USERS) as (keyof typeof TEST_USERS)[]) {
    try {
      results[key] = await getTestUserToken(key)
    } catch (error) {
      console.error(`Failed to authenticate ${key}:`, error)
    }
  }

  return results
}

/**
 * Check if the backend is healthy and accessible.
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`)
    const data = await response.json()
    return data.status === 'healthy'
  } catch {
    return false
  }
}

/**
 * Seed test users via SQL (requires database access).
 * This is done via the backend's debug endpoint in development.
 */
export async function seedTestUsersViaApi(): Promise<boolean> {
  try {
    // The backend has a debug endpoint for seeding test data
    const response = await fetch(`${API_BASE}/api/debug/seed-test-users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (response.status === 404) {
      console.log('Debug endpoint not available - seed users manually via SQL')
      return false
    }

    const data = await response.json()
    return data.success
  } catch (error) {
    console.error('Failed to seed via API:', error)
    return false
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  async function main() {
    console.log('='.repeat(60))
    console.log('Test User Authentication')
    console.log('='.repeat(60))
    console.log()

    // Check backend health
    const healthy = await checkBackendHealth()
    if (!healthy) {
      console.error('Backend is not healthy or not running')
      console.error(`Tried: ${API_BASE}/health`)
      process.exit(1)
    }
    console.log(`Backend healthy at ${API_BASE}`)
    console.log()

    // Try to seed users first
    console.log('Attempting to seed test users...')
    const seeded = await seedTestUsersViaApi()
    if (seeded) {
      console.log('Test users seeded successfully')
    } else {
      console.log('Could not seed via API - ensure users exist in database')
      console.log('Run: psql -U postgres -d juicyvision -f e2e/fixtures/seed-test-users.sql')
    }
    console.log()

    // Authenticate all test users
    console.log('Authenticating test users...')
    console.log()

    const tokens = await getAllTestUserTokens()

    console.log()
    console.log('='.repeat(60))
    console.log('Results')
    console.log('='.repeat(60))
    console.log()

    for (const [key, result] of Object.entries(tokens)) {
      console.log(`${key}:`)
      console.log(`  Email: ${result.user.email}`)
      console.log(`  Token: ${result.token}`)
      console.log()
    }

    // Output as JSON for programmatic use
    console.log('JSON output:')
    console.log(JSON.stringify(tokens, null, 2))
  }

  main().catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
