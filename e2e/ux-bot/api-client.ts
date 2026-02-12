import type { APITestResult, APITestSuite } from './types'

/**
 * API testing client for direct endpoint testing.
 * Used by the UX bot to verify API contracts alongside UI testing.
 */
export class APITestClient {
  private baseUrl: string
  private authToken: string | null = null

  constructor(baseUrl: string = process.env.VITE_API_URL || 'http://localhost:3001') {
    this.baseUrl = baseUrl
  }

  /**
   * Set authentication token for API requests.
   */
  setAuthToken(token: string) {
    this.authToken = token
  }

  /**
   * Make an API request and return test result.
   */
  async request<T = unknown>(
    method: string,
    endpoint: string,
    data?: Record<string, unknown>
  ): Promise<APITestResult & { data?: T }> {
    const startTime = Date.now()
    const url = `${this.baseUrl}${endpoint}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
      })

      const responseTime = Date.now() - startTime
      let responseData: unknown

      try {
        responseData = await response.json()
      } catch {
        responseData = await response.text()
      }

      const result: APITestResult & { data?: T } = {
        endpoint,
        method,
        status: response.status,
        responseTime,
        success: response.ok,
      }

      if (responseData) {
        result.data = responseData as T
      }

      if (!response.ok) {
        result.error = typeof responseData === 'object' && responseData !== null
          ? (responseData as Record<string, unknown>).error?.toString() || 'Request failed'
          : 'Request failed'
      }

      return result
    } catch (error) {
      return {
        endpoint,
        method,
        status: 0,
        responseTime: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      }
    }
  }

  // Convenience methods
  async get<T = unknown>(endpoint: string): Promise<APITestResult & { data?: T }> {
    return this.request<T>('GET', endpoint)
  }

  async post<T = unknown>(endpoint: string, data?: Record<string, unknown>): Promise<APITestResult & { data?: T }> {
    return this.request<T>('POST', endpoint, data)
  }

  async patch<T = unknown>(endpoint: string, data?: Record<string, unknown>): Promise<APITestResult & { data?: T }> {
    return this.request<T>('PATCH', endpoint, data)
  }

  async delete<T = unknown>(endpoint: string): Promise<APITestResult & { data?: T }> {
    return this.request<T>('DELETE', endpoint)
  }

  /**
   * Run a suite of API tests.
   */
  async runSuite(name: string, tests: Array<{
    name: string
    method: string
    endpoint: string
    data?: Record<string, unknown>
    expectedStatus?: number
    validate?: (result: APITestResult) => boolean
  }>): Promise<APITestSuite> {
    const results: APITestResult[] = []
    const startTime = Date.now()

    for (const test of tests) {
      const result = await this.request(test.method, test.endpoint, test.data)

      // Apply custom validation if provided
      if (test.validate && !test.validate(result)) {
        result.success = false
        result.error = result.error || 'Custom validation failed'
      }

      // Check expected status
      if (test.expectedStatus && result.status !== test.expectedStatus) {
        result.success = false
        result.error = `Expected status ${test.expectedStatus}, got ${result.status}`
      }

      results.push(result)
    }

    return {
      name,
      results,
      passed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      duration: Date.now() - startTime,
    }
  }

  /**
   * Test chat API endpoints.
   */
  async testChatAPI(): Promise<APITestSuite> {
    return this.runSuite('Chat API', [
      {
        name: 'Create chat',
        method: 'POST',
        endpoint: '/chat',
        data: { name: 'Test Chat' },
      },
      {
        name: 'Get chats',
        method: 'GET',
        endpoint: '/chat',
      },
    ])
  }

  /**
   * Test project API endpoints.
   */
  async testProjectAPI(): Promise<APITestSuite> {
    return this.runSuite('Project API', [
      {
        name: 'Create project',
        method: 'POST',
        endpoint: '/projects',
        data: { name: 'Test Project', chainId: 1 },
      },
      {
        name: 'Get projects',
        method: 'GET',
        endpoint: '/projects',
      },
    ])
  }

  /**
   * Test wallet API endpoints.
   */
  async testWalletAPI(): Promise<APITestSuite> {
    return this.runSuite('Wallet API', [
      {
        name: 'Get wallet address',
        method: 'GET',
        endpoint: '/wallet/address',
      },
      {
        name: 'Get wallet balances',
        method: 'GET',
        endpoint: '/wallet/balances',
      },
    ])
  }

  /**
   * Test health/status endpoints.
   */
  async testHealthAPI(): Promise<APITestSuite> {
    return this.runSuite('Health API', [
      {
        name: 'Health check',
        method: 'GET',
        endpoint: '/health',
        expectedStatus: 200,
      },
    ])
  }

  /**
   * Run all API test suites.
   */
  async runAllSuites(): Promise<APITestSuite[]> {
    const suites: APITestSuite[] = []

    try {
      suites.push(await this.testHealthAPI())
    } catch {
      suites.push({
        name: 'Health API',
        results: [],
        passed: 0,
        failed: 1,
        duration: 0,
      })
    }

    try {
      suites.push(await this.testChatAPI())
    } catch {
      suites.push({
        name: 'Chat API',
        results: [],
        passed: 0,
        failed: 1,
        duration: 0,
      })
    }

    try {
      suites.push(await this.testProjectAPI())
    } catch {
      suites.push({
        name: 'Project API',
        results: [],
        passed: 0,
        failed: 1,
        duration: 0,
      })
    }

    try {
      suites.push(await this.testWalletAPI())
    } catch {
      suites.push({
        name: 'Wallet API',
        results: [],
        passed: 0,
        failed: 1,
        duration: 0,
      })
    }

    return suites
  }

  /**
   * Print API test results to console.
   */
  static printResults(suites: APITestSuite[]) {
    console.log('\n' + '='.repeat(60))
    console.log('API TEST RESULTS')
    console.log('='.repeat(60))

    let totalPassed = 0
    let totalFailed = 0

    for (const suite of suites) {
      console.log(`\n${suite.name}:`)
      console.log(`  Passed: ${suite.passed}/${suite.results.length}`)
      console.log(`  Duration: ${suite.duration}ms`)

      totalPassed += suite.passed
      totalFailed += suite.failed

      for (const result of suite.results) {
        const status = result.success ? 'PASS' : 'FAIL'
        const icon = result.success ? '\u2714' : '\u2718'
        console.log(`  ${icon} [${status}] ${result.method} ${result.endpoint} (${result.responseTime}ms)`)
        if (!result.success && result.error) {
          console.log(`      Error: ${result.error}`)
        }
      }
    }

    console.log('\n' + '-'.repeat(60))
    console.log(`TOTAL: ${totalPassed} passed, ${totalFailed} failed`)
    console.log('='.repeat(60) + '\n')
  }
}
