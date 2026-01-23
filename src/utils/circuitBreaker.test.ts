import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCircuitBreaker, type CircuitState } from './circuitBreaker'

// Mock the logger
vi.mock('./logger', () => ({
  logger: {
    context: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}))

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('closed state', () => {
    it('calls pass through when circuit is closed', async () => {
      const breaker = createCircuitBreaker('test')
      const fn = vi.fn().mockResolvedValue('success')

      const result = await breaker.call(fn)

      expect(fn).toHaveBeenCalled()
      expect(result.status).toBe('success')
      expect(result.data).toBe('success')
    })

    it('starts in closed state', () => {
      const breaker = createCircuitBreaker('test')
      expect(breaker.getState()).toBe('closed')
    })

    it('returns failure status when function throws', async () => {
      const breaker = createCircuitBreaker('test')
      const error = new Error('test error')
      const fn = vi.fn().mockRejectedValue(error)

      const result = await breaker.call(fn)

      expect(result.status).toBe('failure')
      expect(result.error).toBe(error)
    })
  })

  describe('failure tracking', () => {
    it('counts failures in window', async () => {
      const breaker = createCircuitBreaker('test', {
        failureThreshold: 5,
        failureWindow: 60_000,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      await breaker.call(fn)
      expect(breaker.getFailureCount()).toBe(1)

      await breaker.call(fn)
      expect(breaker.getFailureCount()).toBe(2)
    })

    it('clears old failures outside window', async () => {
      const breaker = createCircuitBreaker('test', {
        failureThreshold: 5,
        failureWindow: 60_000,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      await breaker.call(fn)
      await breaker.call(fn)
      expect(breaker.getFailureCount()).toBe(2)

      // Move time forward past the failure window
      vi.advanceTimersByTime(61_000)

      expect(breaker.getFailureCount()).toBe(0)
    })
  })

  describe('opening circuit', () => {
    it('opens after reaching failure threshold', async () => {
      const onOpen = vi.fn()
      const breaker = createCircuitBreaker('test', {
        failureThreshold: 3,
        failureWindow: 60_000,
        onOpen,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      await breaker.call(fn) // 1
      expect(breaker.getState()).toBe('closed')

      await breaker.call(fn) // 2
      expect(breaker.getState()).toBe('closed')

      await breaker.call(fn) // 3 - should open
      expect(breaker.getState()).toBe('open')
      expect(onOpen).toHaveBeenCalledTimes(1)
    })

    it('returns circuit_open status when open', async () => {
      const breaker = createCircuitBreaker('test', {
        failureThreshold: 2,
        cooldownPeriod: 300_000,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      // Open the circuit
      await breaker.call(fn)
      await breaker.call(fn)
      expect(breaker.getState()).toBe('open')

      // Next call should be rejected immediately
      fn.mockClear()
      const result = await breaker.call(fn)

      expect(fn).not.toHaveBeenCalled()
      expect(result.status).toBe('circuit_open')
      expect(result.retryAfter).toBeGreaterThan(0)
    })

    it('includes retryAfter time when circuit is open', async () => {
      const breaker = createCircuitBreaker('test', {
        failureThreshold: 2,
        cooldownPeriod: 300_000,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      await breaker.call(fn)
      await breaker.call(fn)

      // Move time forward by 100 seconds
      vi.advanceTimersByTime(100_000)

      const result = await breaker.call(fn)
      expect(result.retryAfter).toBe(200_000) // 300000 - 100000
    })
  })

  describe('half-open state and recovery', () => {
    it('transitions to half-open after cooldown', async () => {
      const breaker = createCircuitBreaker('test', {
        failureThreshold: 2,
        cooldownPeriod: 60_000,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      // Open circuit
      await breaker.call(fn)
      await breaker.call(fn)
      expect(breaker.getState()).toBe('open')

      // Advance past cooldown
      vi.advanceTimersByTime(61_000)

      // Next call should be attempted (half-open test)
      fn.mockResolvedValue('recovered')
      await breaker.call(fn)

      expect(breaker.getState()).toBe('closed')
    })

    it('closes circuit on successful recovery', async () => {
      const onClose = vi.fn()
      const breaker = createCircuitBreaker('test', {
        failureThreshold: 2,
        cooldownPeriod: 60_000,
        onClose,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      // Open circuit
      await breaker.call(fn)
      await breaker.call(fn)

      // Advance past cooldown
      vi.advanceTimersByTime(61_000)

      // Successful recovery
      fn.mockResolvedValue('success')
      const result = await breaker.call(fn)

      expect(result.status).toBe('success')
      expect(breaker.getState()).toBe('closed')
      expect(breaker.getFailureCount()).toBe(0)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('stays in half-open allowing retries after failure', async () => {
      const breaker = createCircuitBreaker('test', {
        failureThreshold: 2,
        cooldownPeriod: 60_000,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      // Open circuit
      await breaker.call(fn)
      await breaker.call(fn)
      expect(breaker.getState()).toBe('open')

      // Advance past cooldown - now half-open
      vi.advanceTimersByTime(61_000)

      // Failed recovery attempt - stays half-open allowing more retries
      // (Note: Old failures are cleared due to time window)
      const result = await breaker.call(fn)
      expect(breaker.getState()).toBe('half_open')
      expect(result.status).toBe('failure')
      expect(breaker.getFailureCount()).toBe(1)
    })
  })

  describe('manual reset', () => {
    it('resets circuit to closed state', async () => {
      const breaker = createCircuitBreaker('test', {
        failureThreshold: 2,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      // Open circuit
      await breaker.call(fn)
      await breaker.call(fn)
      expect(breaker.getState()).toBe('open')

      // Manual reset
      breaker.reset()

      expect(breaker.getState()).toBe('closed')
      expect(breaker.getFailureCount()).toBe(0)
      expect(breaker.getRetryAfter()).toBe(0)
    })

    it('allows calls immediately after reset', async () => {
      const breaker = createCircuitBreaker('test', {
        failureThreshold: 2,
      })
      const fn = vi.fn()

      // Open circuit
      fn.mockRejectedValue(new Error('fail'))
      await breaker.call(fn)
      await breaker.call(fn)

      // Reset and try again
      breaker.reset()
      fn.mockResolvedValue('works')
      const result = await breaker.call(fn)

      expect(result.status).toBe('success')
      expect(result.data).toBe('works')
    })
  })

  describe('getRetryAfter', () => {
    it('returns 0 when circuit is closed', () => {
      const breaker = createCircuitBreaker('test')
      expect(breaker.getRetryAfter()).toBe(0)
    })

    it('returns remaining cooldown time when open', async () => {
      const breaker = createCircuitBreaker('test', {
        failureThreshold: 2,
        cooldownPeriod: 300_000,
      })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      await breaker.call(fn)
      await breaker.call(fn)

      expect(breaker.getRetryAfter()).toBe(300_000)

      vi.advanceTimersByTime(50_000)
      expect(breaker.getRetryAfter()).toBe(250_000)
    })
  })

  describe('error handling', () => {
    it('converts non-Error throws to Error objects', async () => {
      const breaker = createCircuitBreaker('test')
      const fn = vi.fn().mockRejectedValue('string error')

      const result = await breaker.call(fn)

      expect(result.error).toBeInstanceOf(Error)
      expect(result.error?.message).toBe('string error')
    })
  })
})
