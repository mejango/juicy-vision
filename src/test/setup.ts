import '@testing-library/jest-dom'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { installDialogShim, resetDialogShim } from './dialogShim'

// jsdom 29 ships no HTMLDialogElement.showModal/close/cancel. Every modal in
// the app is a native <dialog>, so install the shim before any component renders.
installDialogShim()

// Unit fixtures use the deployed Sepolia contract set. Make that test
// environment explicit so CI does not silently switch to mainnet constants
// merely because the developer-only .env file is absent.
vi.stubEnv('VITE_TESTNET_MODE', 'true')

// No unit/component test may depend on a third-party service being reachable.
// Tests that exercise HTTP replace this default with a route-specific mock.
function blockedNetworkConstructor(transport: string) {
  return class {
    constructor(url?: string | URL) {
      throw new Error(
        `Unexpected ${transport} connection in a deterministic unit test: ${String(url ?? 'unknown URL')}. Stub the transport explicitly for this test.`,
      )
    }
  }
}

function installFailClosedNetwork(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    return new Response(JSON.stringify({ error: `External fetch blocked in tests: ${url}` }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
  }))
  vi.stubGlobal('XMLHttpRequest', blockedNetworkConstructor('XMLHttpRequest'))
  vi.stubGlobal('WebSocket', blockedNetworkConstructor('WebSocket'))
  vi.stubGlobal('EventSource', blockedNetworkConstructor('EventSource'))
}

// Protect module-import side effects, then reinstall before every case. Suites
// which use vi.unstubAllGlobals() must never expose the following test to the
// host's real fetch implementation.
installFailClosedNetwork()

// Cleanup after each test
afterEach(() => {
  cleanup()
  resetDialogShim()
})

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
    get length() {
      return Object.keys(store).length
    },
    key: (index: number) => Object.keys(store)[index] || null,
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Clear localStorage before each test
beforeEach(() => {
  installFailClosedNetwork()
  localStorageMock.clear()
})

// Mock ResizeObserver
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

window.ResizeObserver = ResizeObserverMock

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock IntersectionObserver
class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

window.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver

// Mock scrollTo
window.scrollTo = vi.fn()

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
})

// Mock crypto for ID generation
Object.defineProperty(globalThis, 'crypto', {
  value: {
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256)
      }
      return arr
    },
    randomUUID: () => 'test-uuid-' + Math.random().toString(36).substring(7),
  },
})
