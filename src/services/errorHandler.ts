/**
 * Centralized Error Handler
 *
 * Provides consistent error handling across the application:
 * - Development: Full console logging with stack traces
 * - Production: Minimal logging, optional error reporting (respecting privacy)
 * - User-facing: Returns friendly messages without technical details
 */

import { logger } from '../utils/logger'

interface ErrorContext {
  /** Component or service where the error occurred */
  source?: string
  /** Operation that was being performed */
  operation?: string
  /** Additional data for debugging */
  data?: Record<string, unknown>
  /** Should this error be reported to error tracking? */
  shouldReport?: boolean
}

interface HandledError {
  /** User-friendly error message */
  userMessage: string
  /** Original error for logging */
  originalError: Error | unknown
  /** Whether error was reported */
  reported: boolean
}

const isDev = import.meta.env.DEV

/**
 * Map common error patterns to user-friendly messages
 */
function getUserFriendlyMessage(error: Error | unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()

  // Network errors
  if (lowerMessage.includes('network') || lowerMessage.includes('fetch')) {
    return 'Connection error. Please check your internet and try again.'
  }

  // Auth errors
  if (lowerMessage.includes('unauthorized') || lowerMessage.includes('401')) {
    return 'Please sign in to continue.'
  }
  if (lowerMessage.includes('forbidden') || lowerMessage.includes('403')) {
    return 'You do not have permission to perform this action.'
  }

  // Rate limiting
  if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
    return 'Too many requests. Please wait a moment and try again.'
  }

  // WebSocket errors
  if (lowerMessage.includes('websocket')) {
    return 'Connection interrupted. Reconnecting...'
  }

  // Wallet/transaction errors
  if (lowerMessage.includes('rejected') || lowerMessage.includes('denied')) {
    return 'Transaction was cancelled.'
  }
  if (lowerMessage.includes('insufficient')) {
    return 'Insufficient balance for this transaction.'
  }

  // Server errors
  if (lowerMessage.includes('500') || lowerMessage.includes('server error')) {
    return 'Something went wrong on our end. Please try again.'
  }

  // Timeout
  if (lowerMessage.includes('timeout')) {
    return 'Request timed out. Please try again.'
  }

  // Generic fallback
  return 'Something went wrong. Please try again.'
}

/**
 * Handle an error with optional context
 *
 * @example
 * try {
 *   await fetchData()
 * } catch (err) {
 *   const { userMessage } = errorHandler.handle(err, {
 *     source: 'ChatService',
 *     operation: 'fetchMessages'
 *   })
 *   showToast(userMessage)
 * }
 */
function handleError(error: Error | unknown, context?: ErrorContext): HandledError {
  const errorLog = logger.context(context?.source || 'Error')

  // Log full details in development
  if (isDev) {
    errorLog.error(
      context?.operation || 'An error occurred',
      error instanceof Error ? error : null,
      {
        operation: context?.operation,
        ...context?.data,
      }
    )
  } else {
    // In production, log minimal info
    const message = error instanceof Error ? error.message : String(error)
    errorLog.error(context?.operation || 'Error', null, {
      message,
      operation: context?.operation,
    })
  }

  // Report if configured (placeholder for error reporting service)
  let reported = false
  if (context?.shouldReport !== false) {
    reported = reportToService(error, context)
  }

  return {
    userMessage: getUserFriendlyMessage(error),
    originalError: error,
    reported,
  }
}

/**
 * Placeholder for error reporting service integration
 * In production, this could send to Sentry, LogRocket, etc.
 */
function reportToService(error: Error | unknown, context?: ErrorContext): boolean {
  // TODO: Integrate with error reporting service
  // For now, just return false (not reported)
  // Future: Check privacy settings before reporting

  if (!isDev) {
    // In production, we could send to a service here
    // respecting user privacy settings
  }

  return false
}

/**
 * Create a scoped error handler for a specific component/service
 *
 * @example
 * const chatError = errorHandler.scope('ChatService')
 * chatError.handle(err, { operation: 'sendMessage' })
 */
function createScopedHandler(source: string) {
  return {
    handle: (error: Error | unknown, context?: Omit<ErrorContext, 'source'>) =>
      handleError(error, { ...context, source }),
  }
}

/**
 * Wrap an async function with error handling
 *
 * @example
 * const safeFetch = errorHandler.wrap(fetchData, { source: 'API' })
 * const result = await safeFetch() // Errors are handled automatically
 */
function wrapWithHandler<T extends (...args: never[]) => Promise<unknown>>(
  fn: T,
  context?: ErrorContext
): (...args: Parameters<T>) => Promise<ReturnType<T> | null> {
  return async (...args: Parameters<T>) => {
    try {
      return (await fn(...args)) as ReturnType<T>
    } catch (error) {
      handleError(error, context)
      return null
    }
  }
}

/**
 * Error handler singleton
 */
export const errorHandler = {
  handle: handleError,
  scope: createScopedHandler,
  wrap: wrapWithHandler,
  getUserMessage: getUserFriendlyMessage,
} as const

export type ErrorHandler = typeof errorHandler
