import { expect, test as base } from '@playwright/test'

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1'])
const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:'])
const CI_API_SENTINEL_HOSTNAME = 'api.ci.invalid'

function isLocalRequest(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return !NETWORK_PROTOCOLS.has(url.protocol) || LOCAL_HOSTNAMES.has(url.hostname)
  } catch {
    return false
  }
}

function isCiApiSentinelRequest(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname === CI_API_SENTINEL_HOSTNAME
}

function localRpcResult(method: string): unknown {
  switch (method) {
    case 'eth_chainId': return '0x1'
    case 'net_version': return '1'
    case 'eth_blockNumber':
    case 'eth_getBalance':
    case 'eth_getTransactionCount':
    case 'eth_gasPrice':
    case 'eth_maxPriorityFeePerGas': return '0x0'
    case 'eth_getCode':
    case 'eth_call': return '0x'
    case 'eth_getLogs': return []
    case 'eth_feeHistory': return {
      oldestBlock: '0x0',
      baseFeePerGas: ['0x0'],
      gasUsedRatio: [0],
      reward: [['0x0']],
    }
    default: return null
  }
}

/**
 * Hermetic browser fixture for the maintained CI suites.
 *
 * Production data providers must never influence these shape and transaction
 * safety gates. Local preview/backend traffic is allowed; every remote HTTP or
 * WebSocket connection is aborted before it can leave the browser context.
 */
type LocalOnlyFixtures = {
  /** Captured attempted egress, asserted empty automatically after each test. */
  nonLocalNetworkAttempts: string[]
}

export const test = base.extend<LocalOnlyFixtures>({
  nonLocalNetworkAttempts: [async ({}, use) => {
    const attempts: string[] = []
    await use(attempts)
    expect(
      attempts,
      `Maintained browser test attempted non-local network access:\n${attempts.join('\n')}`,
    ).toEqual([])
  }, { auto: true }],

  page: async ({ page, nonLocalNetworkAttempts }, use) => {
    // Generated demo content must be stable for exact accessibility ratchets.
    await page.addInitScript(() => {
      Object.defineProperty(window, '__JUICY_LOCAL_ONLY_TEST__', {
        configurable: false,
        value: true,
      })

      let state = 0x6d2b79f5
      Math.random = () => {
        state += 0x6d2b79f5
        let value = state
        value = Math.imul(value ^ (value >>> 15), value | 1)
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
      }
    })

    await page.route('**/*', async route => {
      const request = route.request()
      const requestUrl = new URL(request.url())

      // CI compiles the production bundle with a deliberately unreachable API
      // origin so release validation exercises a non-local HTTPS configuration.
      // Fulfill that exact sentinel locally: the browser still runs the same
      // artifact that CI would publish, while no request can escape the test.
      if (isCiApiSentinelRequest(requestUrl)) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'CI API sentinel is unavailable' }),
        })
        return
      }

      if (requestUrl.pathname === '/__juicy_test_rpc__') {
        const payload = request.postDataJSON() as
          | { id?: string | number | null; method?: string }
          | Array<{ id?: string | number | null; method?: string }>
        const responseFor = (call: { id?: string | number | null; method?: string }) => ({
          jsonrpc: '2.0',
          id: call.id ?? null,
          result: localRpcResult(call.method ?? ''),
        })
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(Array.isArray(payload) ? payload.map(responseFor) : responseFor(payload)),
        })
        return
      }

      if (isLocalRequest(request.url())) {
        await route.continue()
        return
      }

      nonLocalNetworkAttempts.push(
        `HTTP ${request.method()} ${request.url()}`,
      )
      await route.abort('blockedbyclient')
    })

    await page.routeWebSocket(/.*/, async webSocket => {
      if (isLocalRequest(webSocket.url())) {
        webSocket.connectToServer()
        return
      }

      nonLocalNetworkAttempts.push(`WebSocket ${webSocket.url()}`)
      await webSocket.close({
        code: 1008,
        reason: 'External network access is disabled in maintained browser tests',
      })
    })

    await use(page)
  },
})

export { expect }
