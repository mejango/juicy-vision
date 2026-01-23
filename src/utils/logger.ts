/**
 * Frontend Logger
 *
 * Structured logging service that matches backend format for consistency.
 * In development, logs to console with formatting.
 * In production, can be extended to send logs to external service.
 */

type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'

interface LogData {
  [key: string]: unknown
}

interface LogEntry {
  severity: Severity
  message: string
  timestamp: string
  context?: string
  [key: string]: unknown
}

const isDev = import.meta.env.DEV

/**
 * Format log entry for console output in development
 */
function formatForConsole(entry: LogEntry): string {
  const { severity, message, timestamp, context, ...rest } = entry
  const prefix = context ? `[${context}]` : ''
  const dataStr = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : ''
  return `${timestamp} ${severity} ${prefix} ${message}${dataStr}`
}

/**
 * Core logging function
 */
function log(severity: Severity, message: string, data?: LogData) {
  const entry: LogEntry = {
    severity,
    message,
    timestamp: new Date().toISOString(),
    ...data,
  }

  if (isDev) {
    // Development: formatted console output
    const formatted = formatForConsole(entry)
    switch (severity) {
      case 'DEBUG':
        console.debug(formatted)
        break
      case 'INFO':
        console.info(formatted)
        break
      case 'WARNING':
        console.warn(formatted)
        break
      case 'ERROR':
        console.error(formatted)
        break
    }
  } else {
    // Production: JSON format (can be sent to logging service)
    // Suppress DEBUG logs in production
    if (severity === 'DEBUG') return

    // For now, still log to console in production
    // TODO: Send to logging service when configured
    console.log(JSON.stringify(entry))
  }
}

/**
 * Create a logger with a specific context prefix
 */
function createContextLogger(context: string) {
  return {
    debug: (msg: string, data?: LogData) => log('DEBUG', msg, { context, ...data }),
    info: (msg: string, data?: LogData) => log('INFO', msg, { context, ...data }),
    warn: (msg: string, data?: LogData) => log('WARNING', msg, { context, ...data }),
    error: (msg: string, err?: Error | null, data?: LogData) =>
      log('ERROR', msg, {
        context,
        ...data,
        error: err ? { message: err.message, stack: err.stack } : undefined,
      }),
  }
}

/**
 * Main logger instance
 */
export const logger = {
  debug: (msg: string, data?: LogData) => log('DEBUG', msg, data),
  info: (msg: string, data?: LogData) => log('INFO', msg, data),
  warn: (msg: string, data?: LogData) => log('WARNING', msg, data),
  error: (msg: string, err?: Error | null, data?: LogData) =>
    log('ERROR', msg, {
      ...data,
      error: err ? { message: err.message, stack: err.stack } : undefined,
    }),
  /**
   * Create a logger with a specific context prefix
   * @example
   * const wsLogger = logger.context('WebSocket')
   * wsLogger.info('Connected') // logs: "[WebSocket] Connected"
   */
  context: createContextLogger,
}

export type Logger = typeof logger
export type ContextLogger = ReturnType<typeof createContextLogger>
