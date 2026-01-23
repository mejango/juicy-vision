/**
 * Circuit Breaker Utility
 *
 * Prevents cascading failures by tracking errors and temporarily
 * disabling calls to failing services.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service failing, requests rejected immediately
 * - HALF_OPEN: Testing if service recovered
 *
 * @example
 * const claudeBreaker = createCircuitBreaker('claude', {
 *   failureThreshold: 3,
 *   failureWindow: 60_000,
 *   cooldownPeriod: 300_000,
 * })
 *
 * const result = await claudeBreaker.call(async () => {
 *   return await callClaudeAPI(prompt)
 * })
 *
 * if (result.status === 'circuit_open') {
 *   showMessage('AI temporarily unavailable')
 * }
 */

import { logger } from './logger'

export type CircuitState = 'closed' | 'open' | 'half_open'

export interface CircuitBreakerOptions {
  /** Number of failures before opening circuit (default: 3) */
  failureThreshold?: number
  /** Time window for counting failures in ms (default: 60_000) */
  failureWindow?: number
  /** How long to wait before testing recovery in ms (default: 300_000) */
  cooldownPeriod?: number
  /** Called when circuit opens */
  onOpen?: () => void
  /** Called when circuit closes (recovered) */
  onClose?: () => void
}

export interface CircuitBreakerResult<T> {
  status: 'success' | 'failure' | 'circuit_open'
  data?: T
  error?: Error
  retryAfter?: number
}

interface FailureRecord {
  timestamp: number
}

interface CircuitBreaker<T> {
  /** Execute a function through the circuit breaker */
  call: (fn: () => Promise<T>) => Promise<CircuitBreakerResult<T>>
  /** Get current circuit state */
  getState: () => CircuitState
  /** Get time until circuit might close (0 if closed) */
  getRetryAfter: () => number
  /** Manually reset the circuit to closed */
  reset: () => void
  /** Get failure count in current window */
  getFailureCount: () => number
}

const DEFAULT_OPTIONS: Required<Omit<CircuitBreakerOptions, 'onOpen' | 'onClose'>> = {
  failureThreshold: 3,
  failureWindow: 60_000, // 1 minute
  cooldownPeriod: 300_000, // 5 minutes
}

export function createCircuitBreaker<T = unknown>(
  name: string,
  options: CircuitBreakerOptions = {}
): CircuitBreaker<T> {
  const config = { ...DEFAULT_OPTIONS, ...options }
  const log = logger.context(`CircuitBreaker:${name}`)

  let state: CircuitState = 'closed'
  let failures: FailureRecord[] = []
  let openedAt: number | null = null

  const getRecentFailures = (): FailureRecord[] => {
    const cutoff = Date.now() - config.failureWindow
    failures = failures.filter(f => f.timestamp > cutoff)
    return failures
  }

  const recordFailure = (): void => {
    failures.push({ timestamp: Date.now() })
    const recentFailures = getRecentFailures()

    if (recentFailures.length >= config.failureThreshold && state === 'closed') {
      state = 'open'
      openedAt = Date.now()
      log.warn(`Circuit opened after ${recentFailures.length} failures`)
      options.onOpen?.()
    }
  }

  const recordSuccess = (): void => {
    if (state === 'half_open') {
      state = 'closed'
      failures = []
      openedAt = null
      log.info('Circuit closed - service recovered')
      options.onClose?.()
    }
  }

  const shouldAttempt = (): boolean => {
    if (state === 'closed') return true

    if (state === 'open' && openedAt) {
      const elapsed = Date.now() - openedAt
      if (elapsed >= config.cooldownPeriod) {
        state = 'half_open'
        log.info('Circuit half-open - testing recovery')
        return true
      }
      return false
    }

    // half_open - allow one attempt
    return state === 'half_open'
  }

  const getRetryAfter = (): number => {
    if (state === 'closed' || state === 'half_open') return 0
    if (!openedAt) return 0
    const elapsed = Date.now() - openedAt
    return Math.max(0, config.cooldownPeriod - elapsed)
  }

  const call = async (fn: () => Promise<T>): Promise<CircuitBreakerResult<T>> => {
    if (!shouldAttempt()) {
      return {
        status: 'circuit_open',
        retryAfter: getRetryAfter(),
      }
    }

    try {
      const data = await fn()
      recordSuccess()
      return { status: 'success', data }
    } catch (error) {
      recordFailure()
      const err = error instanceof Error ? error : new Error(String(error))

      // If we just opened the circuit, return circuit_open
      if (state === 'open') {
        return {
          status: 'circuit_open',
          error: err,
          retryAfter: getRetryAfter(),
        }
      }

      return { status: 'failure', error: err }
    }
  }

  return {
    call,
    getState: () => state,
    getRetryAfter,
    reset: () => {
      state = 'closed'
      failures = []
      openedAt = null
      log.info('Circuit manually reset')
    },
    getFailureCount: () => getRecentFailures().length,
  }
}

// =============================================================================
// Pre-configured Circuit Breakers for External Services
// =============================================================================

/** Circuit breaker for Claude API calls */
export const claudeCircuit = createCircuitBreaker('claude', {
  failureThreshold: 3,
  failureWindow: 60_000,
  cooldownPeriod: 300_000, // 5 minutes
})

/** Circuit breaker for RPC provider calls */
export const rpcCircuit = createCircuitBreaker('rpc', {
  failureThreshold: 5,
  failureWindow: 30_000,
  cooldownPeriod: 60_000, // 1 minute - RPCs recover faster
})

/** Circuit breaker for Bendystraw GraphQL API */
export const bendystrawCircuit = createCircuitBreaker('bendystraw', {
  failureThreshold: 3,
  failureWindow: 60_000,
  cooldownPeriod: 120_000, // 2 minutes
})

/** Circuit breaker for Stripe API */
export const stripeCircuit = createCircuitBreaker('stripe', {
  failureThreshold: 2,
  failureWindow: 60_000,
  cooldownPeriod: 300_000, // 5 minutes - payments are sensitive
})
