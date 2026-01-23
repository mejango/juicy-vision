import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock import.meta.env
vi.mock('import.meta.env', () => ({
  DEV: true,
}))

describe('logger', () => {
  const originalConsole = {
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
    log: console.log,
  }

  beforeEach(() => {
    console.debug = vi.fn()
    console.info = vi.fn()
    console.warn = vi.fn()
    console.error = vi.fn()
    console.log = vi.fn()
  })

  afterEach(() => {
    console.debug = originalConsole.debug
    console.info = originalConsole.info
    console.warn = originalConsole.warn
    console.error = originalConsole.error
    console.log = originalConsole.log
    vi.resetModules()
  })

  describe('basic logging', () => {
    it('logs debug messages', async () => {
      const { logger } = await import('./logger')
      logger.debug('test debug message')
      expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('DEBUG'))
      expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('test debug message'))
    })

    it('logs info messages', async () => {
      const { logger } = await import('./logger')
      logger.info('test info message')
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining('INFO'))
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining('test info message'))
    })

    it('logs warning messages', async () => {
      const { logger } = await import('./logger')
      logger.warn('test warning message')
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('WARNING'))
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('test warning message'))
    })

    it('logs error messages', async () => {
      const { logger } = await import('./logger')
      logger.error('test error message')
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ERROR'))
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('test error message'))
    })
  })

  describe('with data', () => {
    it('includes extra data in log output', async () => {
      const { logger } = await import('./logger')
      logger.info('test message', { userId: '123', action: 'login' })
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining('userId'))
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining('123'))
    })
  })

  describe('error logging with Error object', () => {
    it('includes error message and stack', async () => {
      const { logger } = await import('./logger')
      const error = new Error('something went wrong')
      logger.error('operation failed', error)
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('operation failed'))
    })

    it('handles null error gracefully', async () => {
      const { logger } = await import('./logger')
      logger.error('operation failed', null)
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('operation failed'))
    })
  })

  describe('context logger', () => {
    it('creates logger with context prefix', async () => {
      const { logger } = await import('./logger')
      const wsLogger = logger.context('WebSocket')

      wsLogger.info('connected')
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining('[WebSocket]'))
      expect(console.info).toHaveBeenCalledWith(expect.stringContaining('connected'))
    })

    it('context logger includes additional data', async () => {
      const { logger } = await import('./logger')
      const authLogger = logger.context('Auth')

      authLogger.debug('user logged in', { userId: '456' })
      expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('[Auth]'))
      expect(console.debug).toHaveBeenCalledWith(expect.stringContaining('userId'))
    })

    it('context logger handles errors', async () => {
      const { logger } = await import('./logger')
      const apiLogger = logger.context('API')

      const error = new Error('request failed')
      apiLogger.error('fetch error', error, { endpoint: '/users' })
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[API]'))
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('fetch error'))
    })
  })

  describe('timestamp', () => {
    it('includes ISO timestamp in log output', async () => {
      const { logger } = await import('./logger')
      logger.info('test')
      // ISO timestamp format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/))
    })
  })
})
